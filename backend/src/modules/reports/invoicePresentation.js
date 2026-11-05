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

/** Presentation only: keeps dated original invoices and separate subsequent payment rows without squashing payment history. */
export function groupLedgerInvoices(rows, context) {
  const result = [];
  for (const row of rows) {
    if (row.type !== 'INCOME' || !['POS Invoice', 'POS Dues Collection', 'Sales Refund'].includes(row.source)) {
      result.push({
        ...row,
        recordType: row.recordType || (row.type === 'OPERATING_EXPENSE' ? 'OPERATING_EXPENSE' : row.type === 'SALARY_EXPENSE' ? 'SALARY_EXPENSE' : row.type === 'COMMISSION_EXPENSE' ? 'COMMISSION_EXPENSE' : row.type === 'SETTLEMENT' ? 'SETTLEMENT' : row.type === 'SUPPLIER_PAYMENT' ? 'SUPPLIER_PAYMENT' : 'EXPENSE'),
        recordTypeLabel: row.recordTypeLabel || (row.type === 'OPERATING_EXPENSE' ? 'Operating Expense' : row.type === 'SALARY_EXPENSE' ? 'Salary' : row.type === 'COMMISSION_EXPENSE' ? 'Commission' : row.type === 'SETTLEMENT' ? (row.source === 'Staff Loan' ? 'Staff Loan' : 'Settlement') : row.type === 'SUPPLIER_PAYMENT' ? 'Supplier Payment' : 'Expense'),
      });
      continue;
    }
    const key = row.invoiceId || row.invoiceNumber || row.reference;
    const snapshot = context?.get(key);

    if (row.source === 'POS Invoice') {
      const collectedServiceAmt = row.collectedService ?? (row.totalReceived > 0 ? (row.income ?? row.paid ?? 0) : 0);
      const collectedTaxAmt = row.collectedTax ?? 0;
      result.push({
        ...row,
        id: row.id || `inv-${key}`,
        source: 'POS Invoice',
        recordType: 'ORIGINAL_INVOICE',
        recordTypeLabel: row.recordTypeLabel || 'Original Invoice',
        reference: snapshot?.invoice.invoiceNumber || row.invoiceNumber || row.reference,
        invoiceNumber: snapshot?.invoice.invoiceNumber || row.invoiceNumber || row.reference,
        date: snapshot?.originalDate || row.date,
        originalInvoiceDate: snapshot?.originalDate || row.date,
        customerName: snapshot?.invoice.clientName || row.customerName,
        branchId: snapshot?.invoice.branchId || row.branchId,
        serviceCollection: collectedServiceAmt,
        serviceAmount: collectedServiceAmt,
        tax: collectedTaxAmt,
        totalBill: snapshot?.originalBill ?? row.invoiceBillTotal ?? row.totalBill,
        invoiceBillTotal: snapshot?.originalBill ?? row.invoiceBillTotal ?? row.totalBill,
        balanceAfterPayment: row.balanceAfterPayment,
        currentOutstanding: snapshot?.outstanding ?? row.currentOutstanding ?? row.remainingDues ?? 0,
        remainingDues: row.balanceAfterPayment !== undefined ? row.balanceAfterPayment : (snapshot?.outstanding ?? row.remainingDues ?? 0),
        status: snapshot ? (snapshot.lifecycle === 'ACTIVE' ? snapshot.status : snapshot.lifecycle) : row.status,
        refundHistory: snapshot?.refundHistory || [],
      });
    } else if (row.source === 'POS Dues Collection') {
      const collectedServiceAmt = row.collectedService ?? row.paid ?? row.totalReceived ?? 0;
      const collectedTaxAmt = row.collectedTax ?? 0;
      result.push({
        ...row,
        id: row.id,
        source: 'POS Dues Collection',
        recordType: 'SUBSEQUENT_PAYMENT',
        recordTypeLabel: row.recordTypeLabel || 'Subsequent Payment',
        reference: snapshot?.invoice.invoiceNumber || row.invoiceNumber || row.reference,
        invoiceNumber: snapshot?.invoice.invoiceNumber || row.invoiceNumber || row.reference,
        originalInvoiceDate: snapshot?.originalDate || row.originalInvoiceDate,
        customerName: snapshot?.invoice.clientName || row.customerName,
        branchId: snapshot?.invoice.branchId || row.branchId,
        serviceCollection: collectedServiceAmt,
        serviceAmount: collectedServiceAmt,
        tax: collectedTaxAmt,
        totalBill: 0,
        invoiceBillTotal: snapshot?.originalBill ?? row.invoiceBillTotal,
        balanceAfterPayment: row.balanceAfterPayment,
        currentOutstanding: snapshot?.outstanding ?? row.currentOutstanding ?? 0,
        remainingDues: row.balanceAfterPayment !== undefined ? row.balanceAfterPayment : (snapshot?.outstanding ?? row.remainingDues ?? 0),
        status: snapshot ? (snapshot.lifecycle === 'ACTIVE' ? snapshot.status : snapshot.lifecycle) : row.status,
      });
    } else if (row.source === 'Sales Refund') {
      const refService = -Math.abs(row.collectedService ?? row.serviceAmount ?? 0);
      const refTax = -Math.abs(row.collectedTax ?? row.tax ?? 0);
      result.push({
        ...row,
        id: row.id,
        source: 'Sales Refund',
        recordType: 'REFUND_REVERSAL',
        recordTypeLabel: 'Refund / Reversal',
        reference: row.reference,
        invoiceNumber: snapshot?.invoice.invoiceNumber || row.invoiceNumber,
        customerName: snapshot?.invoice.clientName || row.customerName || 'Client Refund',
        branchId: snapshot?.invoice.branchId || row.branchId,
        serviceCollection: refService,
        serviceAmount: refService,
        tax: refTax,
        totalBill: -Math.abs(row.totalBill ?? 0),
        currentOutstanding: snapshot?.outstanding ?? 0,
        remainingDues: snapshot?.outstanding ?? 0,
        status: snapshot?.lifecycle || 'REFUNDED',
      });
    }
  }

  // Resolve Remaining Dues: show remaining balance ONLY on the latest visible applicable payment row per invoice group
  const invoiceGroups = new Map();
  for (const row of result) {
    if (row.type === 'INCOME' && ['POS Invoice', 'POS Dues Collection'].includes(row.source)) {
      const key = row.invoiceId || row.invoiceNumber || row.reference;
      if (!invoiceGroups.has(key)) invoiceGroups.set(key, []);
      invoiceGroups.get(key).push(row);
    }
  }

  for (const [key, groupRows] of invoiceGroups.entries()) {
    // Sort in chronological order (oldest to newest)
    groupRows.sort((a, b) => {
      const seqA = a.paymentSequence ?? (a.source === 'POS Invoice' ? 1 : 2);
      const seqB = b.paymentSequence ?? (b.source === 'POS Invoice' ? 1 : 2);
      if (seqA !== seqB) return seqA - seqB;
      const dDiff = (a.date || '').localeCompare(b.date || '');
      if (dDiff !== 0) return dDiff;
      return (a.id || '').localeCompare(b.id || '');
    });

    // The latest visible row is the last one in chronological order
    const latestRow = groupRows[groupRows.length - 1];
    const snapshot = context?.get(key);
    latestRow.remainingDues = typeof latestRow.balanceAfterPayment === 'number'
      ? latestRow.balanceAfterPayment
      : (snapshot?.outstanding ?? latestRow.remainingDues ?? 0);

    // All earlier rows for this invoice group get null (rendered as '—')
    for (let idx = 0; idx < groupRows.length - 1; idx++) {
      groupRows[idx].remainingDues = null;
    }
  }

  return result.sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt && a.createdAt ? new Date(b.createdAt) - new Date(a.createdAt) : 0) || a.id.localeCompare(b.id));
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
