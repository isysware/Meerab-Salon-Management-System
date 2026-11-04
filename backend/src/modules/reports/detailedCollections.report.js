import prisma from '../../config/prisma.js';
import { forbidden } from '../../lib/AppError.js';
import { round2, toDec } from '../../lib/money.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';
import { loadCollectionEvents } from './collectionEvents.js';

const n = value => round2(value ?? 0).toNumber();

export async function detailedIncomeReport(actor, query = {}) {
  if (!['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(actor.role)) throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access detailed income report.');
  const ctx = await resolveReportContext(actor, query, 'PAYMENT_DATE');
  const scope = { ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id }
      : query.soldByUserId && query.soldByUserId !== 'ALL' ? { processedByUserId: query.soldByUserId } : {}) };
  const [events, branches] = await Promise.all([
    loadCollectionEvents(scope, ctx.fromStr, ctx.toStr),
    prisma.branch.findMany({ where: ctx.branchId ? { id: ctx.branchId } : {}, select: { id: true, name: true } }),
  ]);
  const names = new Map(branches.map(b => [b.id, b.name]));
  const search = query.search?.trim().toLowerCase();
  const rows = [];
  for (const e of events) {
    const inv = e.invoice, line = e.line;
    if (query.paymentStatus && query.paymentStatus !== 'ALL' && inv.status !== query.paymentStatus) continue;
    if (query.lifecycle && query.lifecycle !== 'ALL' && inv.lifecycle !== query.lifecycle) continue;
    if (query.paymentMethod && query.paymentMethod !== 'ALL' && e.record.method !== query.paymentMethod) continue;
    const source = line.type === 'CUSTOM_SERVICE' ? 'SERVICE' : line.type;
    if (query.sourceType && query.sourceType !== 'ALL' && source !== query.sourceType) continue;
    if (search && ![inv.invoiceNumber, inv.clientName, inv.clientPhone, line.name, e.record.receiptNumber, e.record.refundNumber]
      .some(value => value?.toLowerCase().includes(search))) continue;
    let net = e.collectedNet, tax = e.collectedTax, tip = e.tip;
    if (query.staffId && query.staffId !== 'ALL') {
      const selected = e.staffAllocations.filter(s => s.staffId === query.staffId);
      if (!selected.length) continue;
      net = selected.reduce((s, c) => s.plus(c.net), toDec(0));
      tax = selected.reduce((s, c) => s.plus(c.tax), toDec(0));
      tip = selected.reduce((s, c) => s.plus(c.tip), toDec(0));
    }
    const fraction = toDec(line.netSales).gt(0) ? net.div(line.netSales) : toDec(0);
    const discount = round2(toDec(line.discountAllocated).times(fraction));
    rows.push({
      id: e.id, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, date: e.date, time: e.record.time || '',
      eventType: e.kind, branchId: inv.branchId, branchName: names.get(inv.branchId) || 'Branch',
      incomeSource: source, clientId: inv.clientId, clientName: inv.clientName || 'Walk-in Customer', clientPhone: inv.clientPhone,
      itemCode: line.code || '', itemName: line.name, staffId: query.staffId !== 'ALL' && query.staffId ? query.staffId : line.staffId,
      staffName: (line.components || []).filter(c => !query.staffId || query.staffId === 'ALL' || c.staffId === query.staffId)
        .map(c => c.staffName).filter(Boolean).join(', ') || line.staffName || 'House / Salon',
      quantity: Number(line.quantity || 1), unitPrice: n(line.unitPrice),
      gross: n(net.plus(discount)), discount: n(discount), netSales: n(net), refundedNet: net.lt(0) ? n(net.negated()) : 0,
      recognizedNet: n(net), collectedNet: n(net), taxRate: n(toDec(line.taxRate).times(100)),
      tax: n(tax), netTax: n(tax), total: n(net.plus(tax)), tip: n(tip), outstanding: n(e.outstanding),
      paymentStatus: inv.status, lifecycle: inv.lifecycle, createdByName: inv.processedByName,
      payments: [{ id: e.id, receiptNumber: e.record.receiptNumber || e.record.refundNumber,
        amount: n(net.plus(tax).plus(tip)), method: e.record.method || 'CASH',
        paymentAccountId: e.record.paymentAccountId || e.record.accountId,
        paymentAccountName: e.record.paymentAccountName || (e.record.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
        date: e.date, time: e.record.time || '', kind: e.kind }],
      refunds: e.kind === 'REFUND' ? [{ ...e.record, refundDate: e.date,
        netReversed: n(e.record.netReversed), taxReversed: n(e.record.taxReversed), tipReversed: n(e.record.tipReversed),
        cashOut: n(e.record.cashOut), receivableCancelled: n(e.record.receivableCancelled),
        lineRefund: (e.record.lines || []).filter(r => r.lineId === line.id).map(r => ({ quantity: Number(r.quantity), net: n(r.net), tax: n(r.tax) }))[0] || null }] : [],
      components: (line.components || []).map(c => ({ ...c, allocatedAmount: n(c.allocatedAmount), allocationPercentage: Number(c.allocationPercentage) })),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const sum = (field, selected = rows) => n(selected.reduce((s, r) => s.plus(r[field] || 0), toDec(0)));
  const totals = Object.fromEntries(['gross', 'discount', 'netSales', 'refundedNet', 'recognizedNet', 'tax', 'netTax'].map(k => [k, sum(k)]));
  const kpis = { totalTransactions: rows.length, grossSales: totals.gross, totalDiscounts: totals.discount,
    netSales: totals.netSales, totalRefunded: totals.refundedNet, recognizedNetRevenue: totals.recognizedNet,
    collectedRevenue: totals.recognizedNet, totalTaxCharged: totals.tax, netTaxLiability: totals.netTax,
    tipsCollected: sum('tip'), totalPaid: n(toDec(sum('total')).plus(sum('tip'))) };
  for (const type of ['SERVICE', 'PRODUCT', 'PACKAGE']) {
    const selected = rows.filter(r => r.incomeSource === type);
    kpis[`${type.toLowerCase()}Revenue`] = sum('recognizedNet', selected);
    const countedLines = new Set();
    let unitCount = 0;
    for (const r of selected) {
      const lineKey = `${r.invoiceId}:${r.itemCode || r.itemName}`;
      if (!countedLines.has(lineKey)) {
        countedLines.add(lineKey);
        unitCount += Number(r.quantity || 1);
      }
    }
    kpis[`${type.toLowerCase()}Count`] = unitCount;
  }
  return formatReportResponse(ctx.meta, { kpis, rows, totals });
}
