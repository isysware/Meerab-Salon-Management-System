import prisma from '../../config/prisma.js';
import { forbidden } from '../../lib/AppError.js';
import { dateOnly, ymd } from '../../lib/dates.js';
import { toDec, round2 } from '../../lib/money.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';
import { invoiceBalanceAsOf, collectionTotals, collectionReceipts } from './collectionEvents.js';

const n = v => round2(v ?? 0).toNumber();
const sum = (rows, key) => rows.reduce((s, r) => s.plus(r[key] ?? 0), toDec(0));

export const salesInvoicesReport = async (actor, q = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Staff cannot access sales reports.');
  const ctx = await resolveReportContext(actor, q, 'INVOICE_POSTING_AND_PAYMENT_DATE');
  const seller = actor.role === 'ACCOUNTANT' ? actor.id : q.soldByUserId || q.accountantId || q.userId;
  const scope = { ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    ...(seller && seller !== 'ALL' ? { processedByUserId: seller } : {}),
    ...(q.clientId ? { clientId: q.clientId } : {}),
    ...(q.lifecycle && q.lifecycle !== 'ALL' ? { lifecycle: q.lifecycle } : {}),
    ...(q.staffId && q.staffId !== 'ALL' ? { OR: [{ staffId: q.staffId },
      { lines: { some: { OR: [{ staffId: q.staffId }, { components: { some: { staffId: q.staffId } } }] } } }] } : {}),
  };
  // Include old invoices with new receipts/credits; retain original invoice fields unchanged.
  const [invoices, branches] = await Promise.all([
    prisma.invoice.findMany({ where: { ...scope, date: { lte: dateOnly(ctx.toStr) } },
      include: { lines: { include: { components: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        payments: true, refunds: { include: { lines: true } }, booking: { include: { payments: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(branches.map(b => [b.id, b.name]));
  const inPeriod = date => date >= ctx.fromStr && date <= ctx.toStr;
  const search = q.search?.trim().toLowerCase();
  const rows = [], events = [];
  for (const inv of invoices) {
    if (search && ![inv.invoiceNumber, inv.clientName, inv.clientPhone].some(v => v?.toLowerCase().includes(search))) continue;
    const balance = invoiceBalanceAsOf(inv, ctx.toStr);
    const status = balance.outstanding.isZero() ? 'PAID' : balance.retainedBill.gt(0) ? 'PARTIAL' : 'UNPAID';
    if (q.paymentStatus && q.paymentStatus !== 'ALL' && q.paymentStatus !== status) continue;
    const receipts = balance.events.filter(e => inPeriod(e.date)
      && (!q.paymentMethod || q.paymentMethod === 'ALL' || e.record.method === q.paymentMethod));
    const posted = inPeriod(ymd(inv.date));
    const refunds = (inv.refunds || []).filter(r => inPeriod(ymd(r.refundDate)));
    if (!posted && !receipts.length && !refunds.length) continue;
    if (q.paymentMethod && q.paymentMethod !== 'ALL' && !receipts.length && inv.paymentMethod !== q.paymentMethod) continue;
    events.push(...receipts);
    const collection = collectionTotals(receipts);
    const refundNet = sum(refunds, 'netReversed'), refundTax = sum(refunds, 'taxReversed');
    const cash = collectionTotals(receipts.filter(e => e.record.method === 'CASH')).actualCollections;
    const postedTax = posted ? toDec(inv.tax) : toDec(0);
    rows.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, date: ymd(inv.date), time: inv.time,
      branchId: inv.branchId, branchName: names.get(inv.branchId) || 'Branch', clientId: inv.clientId,
      clientName: inv.clientName, clientPhone: inv.clientPhone, customerSource: inv.customerSource,
      soldByUserId: inv.processedByUserId, soldByName: inv.processedByName,
      staffSummary: [...new Set(inv.lines.flatMap(l => [l.staffName, ...(l.components || []).map(c => c.staffName)]).filter(Boolean))].join(', ') || 'Unassigned',
      linesSummary: inv.lines.map(l => `${l.name} (${l.quantity})`).join(', '),
      paymentMethod: inv.paymentMethod, paymentStatus: status, lifecycle: inv.lifecycle,
      gross: n(inv.subtotal), discount: n(inv.discount), netSales: n(inv.netSales), tax: n(inv.tax), tip: n(inv.tip), total: n(inv.total),
      taxCharged: n(postedTax), taxReversed: n(refundTax), netTaxLiability: n(postedTax.minus(refundTax)),
      paid: collection.actualCollections, cashPaid: cash, onlinePaid: n(toDec(collection.actualCollections).minus(cash)),
      ...collection, outstanding: n(balance.outstanding), refunded: n(refundNet.plus(refundTax).plus(sum(refunds, 'tipReversed'))),
      refundedAmount: n(refundNet.plus(refundTax).plus(sum(refunds, 'tipReversed'))), refundedCashOut: n(sum(refunds, 'cashOut')),
      refundCount: refunds.length, notes: inv.notes,
      postedInPeriod: posted, periodNetSales: n((posted ? toDec(inv.netSales) : toDec(0)).minus(refundNet)),
      payments: collectionReceipts(receipts).map(e => ({ id: e.id, date: e.date, amount: n(e.billCollected.plus(e.tip)),
        method: e.record.method, paymentAccountId: e.record.paymentAccountId || e.record.accountId,
        paymentAccountName: e.record.paymentAccountName, kind: e.kind })),
    });
  }
  const collection = collectionTotals(events);
  const cash = collectionTotals(events.filter(e => e.record.method === 'CASH')).actualCollections;
  const online = toDec(collection.actualCollections).minus(cash);
  const accounts = new Map();
  for (const e of events.filter(e => e.record.method !== 'CASH')) {
    const id = e.record.paymentAccountId || e.record.accountId || 'unknown';
    const entry = accounts.get(id) || { accountId: id, accountName: e.record.paymentAccountName || 'Online Account', amount: toDec(0), eventIds: new Set() };
    entry.amount = entry.amount.plus(e.billCollected).plus(e.tip);
    entry.eventIds.add(`${e.kind}:${e.record.id}`); accounts.set(id, entry);
  }
  const posted = rows.filter(r => r.postedInPeriod);
  const totals = { gross: n(sum(posted, 'gross')), discount: n(sum(posted, 'discount')),
    netSales: n(sum(rows, 'periodNetSales')), tax: n(sum(rows, 'taxCharged')), taxCharged: n(sum(rows, 'taxCharged')),
    taxReversed: n(sum(rows, 'taxReversed')), netTaxLiability: n(sum(rows, 'netTaxLiability')),
    tip: collection.tipsCollected, total: n(sum(posted, 'total')), paid: collection.actualCollections,
    refunded: n(sum(rows, 'refunded')), outstanding: n(sum(rows, 'outstanding')),
    cashCollected: cash, onlineCollected: n(online), ...collection };
  const kpis = { totalInvoices: rows.length, grossSales: totals.gross, totalDiscounts: totals.discount,
    netSales: totals.netSales, taxCharged: totals.taxCharged, taxReversed: totals.taxReversed,
    netTaxLiability: totals.netTaxLiability, ...collection, invoiceTotal: totals.total,
    totalPaid: totals.paid, totalRefunded: totals.refunded, totalOutstanding: totals.outstanding,
    totalCashCollected: cash, totalOnlineCollected: n(online),
    ...Object.fromEntries(['ACTIVE', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'].map((v, i) =>
      [['activeCount', 'partiallyRefundedCount', 'refundedCount', 'voidedCount'][i], rows.filter(r => r.lifecycle === v).length])) };
  return formatReportResponse({ ...ctx.meta, basisNote: 'Original invoice columns are unchanged. Sales/tax totals use invoice and credit dates; collections use receipt/refund/reversal dates. Outstanding is as of period end for displayed invoices.' },
    { rows, totals, kpis, tenderBreakdown: { totalCash: cash, totalOnline: n(online), grandTotal: collection.actualCollections,
      onlineAccounts: [...accounts.values()].map(({ eventIds, amount, ...a }) => ({ ...a, amount: n(amount), count: eventIds.size })) } });
};
