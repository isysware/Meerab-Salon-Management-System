import prisma from '../../config/prisma.js';
import { dateOnly, ymd } from '../../lib/dates.js';
import { toDec, round2 } from '../../lib/money.js';
import { invoiceBalanceAsOf } from './collectionEvents.js';

const n = value => round2(value ?? 0).toNumber();
const sum = (rows, key) => rows.reduce((total, row) => total.plus(row[key] || 0), toDec(0));

/** Read-only historical context. Future refunds never change an earlier period's label. */
export function invoicePresentation(invoice, to) {
  const refunds = (invoice.refunds || []).filter(r => ymd(r.refundDate) <= to);
  const bill = toDec(invoice.netSales).plus(invoice.tax || 0);
  const credited = sum(refunds, 'netReversed').plus(sum(refunds, 'taxReversed'));
  const balance = invoiceBalanceAsOf(invoice, to);
  const lifecycle = credited.gt(0) ? credited.gte(bill) ?
    (refunds.some(r => r.type === 'VOID') ? 'VOIDED' : 'REFUNDED') : 'PARTIALLY_REFUNDED' : 'ACTIVE';
  return { originalDate: ymd(invoice.date), originalNet: n(invoice.netSales), originalTax: n(invoice.tax),
    originalBill: n(bill), outstanding: n(balance.outstanding), lifecycle,
    status: balance.outstanding.isZero() ? 'PAID' : balance.retainedBill.gt(0) ? 'PARTIAL' : 'UNPAID',
    refundHistory: refunds.map(r => ({ id: r.id, reference: r.refundNumber, date: ymd(r.refundDate),
      amount: n(toDec(r.netReversed).plus(r.taxReversed || 0).plus(r.tipReversed || 0)), cashOut: n(r.cashOut),
      net: n(r.netReversed), tax: n(r.taxReversed), tip: n(r.tipReversed), method: r.method, reason: r.reason })) };
}

export async function loadInvoicePresentation(scope, ids, to) {
  if (!ids.length) return new Map();
  const invoices = await prisma.invoice.findMany({ where: { ...scope, id: { in: ids }, date: { lte: dateOnly(to) } },
    include: { lines: { include: { components: true } }, payments: true, refunds: { include: { lines: true } },
      booking: { include: { payments: true } } } });
  return new Map(invoices.map(inv => [inv.id, { invoice: inv, ...invoicePresentation(inv, to) }]));
}

/** Presentation only: every signed amount is summed exactly once from the selected dated rows. */
export function groupLedgerInvoices(rows, context) {
  const groups = new Map(), result = [];
  for (const row of rows) {
    if (row.type !== 'INCOME' || !['POS Invoice', 'POS Dues Collection', 'Sales Refund'].includes(row.source)) {
      result.push(row); continue;
    }
    const key = row.invoiceId || row.invoiceNumber || row.reference;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [key, events] of groups) {
    const original = events.find(e => e.source === 'POS Invoice') || events[0];
    const snapshot = context.get(key);
    const refundEvents = events.filter(e => e.source === 'Sales Refund');
    const row = { ...original, id: `invoice-${key}`, source: 'POS Invoice', reference: original.invoiceNumber || original.reference,
      date: snapshot?.originalDate || original.date, originalInvoiceDate: snapshot?.originalDate || original.date,
      customerName: snapshot?.invoice.clientName || original.customerName,
      serviceAmount: snapshot?.originalNet ?? original.serviceAmount,
      tax: snapshot?.originalTax ?? original.tax, totalBill: snapshot?.originalBill ?? original.invoiceBillTotal ?? original.totalBill,
      invoiceBillTotal: snapshot?.originalBill ?? original.invoiceBillTotal,
      remaining: snapshot?.outstanding ?? original.remaining, remainingDues: snapshot?.outstanding ?? original.remainingDues,
      status: snapshot ? snapshot.lifecycle === 'ACTIVE' ? snapshot.status : snapshot.lifecycle : original.status,
      refundAmount: n(refundEvents.reduce((s, e) => s.minus(e.totalBill || 0).minus(e.tipAmount || 0), toDec(0))),
      refundCashOut: n(refundEvents.reduce((s, e) => s.minus(e.collectionAmount || 0), toDec(0))),
      refundHistory: snapshot?.refundHistory || [],
      reportEvents: events.map(e => ({ id: e.id, reference: e.reference, date: e.date, type: e.source,
        amount: e.cashFlow ?? e.collectionAmount ?? e.paid ?? 0, net: e.income, tax: e.collectedTax || 0, tip: e.tipAmount || 0,
        method: e.paymentMethod })),
    };
    for (const field of ['income','recognizedIncome','collectedService','collectedTax','totalReceived','paid','collectionAmount','discount','tipAmount']) row[field] = n(sum(events, field));
    row.cashFlow = row.collectionAmount;
    const methods = [...new Set(events.map(e => e.paymentMethod).filter(Boolean))];
    row.paymentMethod = methods.length === 1 ? methods[0] : 'MULTIPLE';
    result.push(row);
  }
  return result.sort((a,b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
}

export function groupIncomeLines(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.invoiceId}:${row.lineId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, events]) => {
    const row = { ...events[0], id: `line-${key}`, date: events[0].originalInvoiceDate || events[0].date,
      payments: events.flatMap(e => e.payments || []),
      refunds: [...new Map(events.flatMap(e => e.refunds || []).map(r => [r.id, r])).values()],
    };
    for (const field of ['gross','discount','netSales','refundedNet','recognizedNet','collectedNet','tax','netTax','total','tip']) row[field] = n(sum(events, field));
    row.refundAmount = n(row.refunds.reduce((s,r) => s.plus(r.lineRefund?.net || 0).plus(r.lineRefund?.tax || 0), toDec(0)));
    return row;
  });
}
