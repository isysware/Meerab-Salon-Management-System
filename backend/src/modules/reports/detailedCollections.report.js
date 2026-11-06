import prisma from '../../config/prisma.js';
import { forbidden } from '../../lib/AppError.js';
import { round2, toDec } from '../../lib/money.js';
import { dateOnly, ymd } from '../../lib/dates.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';
import { loadCollectionEvents } from './collectionEvents.js';
import { invoicePresentation, groupIncomeLines } from './invoicePresentation.js';

const n = value => round2(value ?? 0).toNumber();

export async function detailedIncomeReport(actor, query = {}) {
  if (!['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(actor.role)) throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access detailed income report.');
  const ctx = await resolveReportContext(actor, query, 'PAYMENT_DATE');
  const scope = { ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id }
      : query.soldByUserId && query.soldByUserId !== 'ALL' ? { processedByUserId: query.soldByUserId } : {}) };

  const bookingPaymentScope = {
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id }
      : query.soldByUserId && query.soldByUserId !== 'ALL' ? { processedByUserId: query.soldByUserId } : {}),
    date: {
      gte: dateOnly(ctx.fromStr),
      lte: dateOnly(ctx.toStr),
    },
  };

  const [events, branches, bookingPayments] = await Promise.all([
    loadCollectionEvents(scope, ctx.fromStr, ctx.toStr),
    prisma.branch.findMany({ where: ctx.branchId ? { id: ctx.branchId } : {}, select: { id: true, name: true } }),
    prisma.bookingPayment.findMany({
      where: bookingPaymentScope,
      include: {
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            clientId: true,
            clientName: true,
            clientPhone: true,
            branchId: true,
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  const names = new Map(branches.map(b => [b.id, b.name]));
  const search = query.search?.trim().toLowerCase();
  const rows = [];
  const contexts = new Map();

  for (const e of events) {
    const inv = e.invoice, line = e.line;
    if (!contexts.has(inv.id)) contexts.set(inv.id, invoicePresentation(inv, ctx.toStr));
    const snapshot = contexts.get(inv.id);
    if (query.paymentStatus && query.paymentStatus !== 'ALL' && snapshot.status !== query.paymentStatus) continue;
    if (query.lifecycle && query.lifecycle !== 'ALL' && snapshot.lifecycle !== query.lifecycle) continue;
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
    const isAdvanceApplied = e.kind === 'BOOKING_PAYMENT';

    rows.push({
      id: e.id, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, bookingNumber: inv.booking?.bookingNumber || undefined,
      bookingReference: inv.booking?.bookingNumber || undefined, date: e.date, time: e.record.time || '',
      lineId: line.id, originalInvoiceDate: snapshot.originalDate,
      originalNetAmount: n(line.netSales), originalBillAmount: n(toDec(line.netSales).plus(line.tax || 0)),
      refundHistory: snapshot.refundHistory,
      eventType: isAdvanceApplied ? 'BOOKING_ADVANCE_APPLIED' : e.kind,
      branchId: inv.branchId, branchName: names.get(inv.branchId) || 'Branch',
      incomeSource: source, clientId: inv.clientId, clientName: inv.clientName || 'Walk-in Customer', clientPhone: inv.clientPhone,
      itemCode: line.code || '', itemName: line.name, staffId: query.staffId !== 'ALL' && query.staffId ? query.staffId : line.staffId,
      staffName: (line.components || []).filter(c => !query.staffId || query.staffId === 'ALL' || c.staffId === query.staffId)
        .map(c => c.staffName).filter(Boolean).join(', ') || line.staffName || 'House / Salon',
      quantity: Number(line.quantity || 1), unitPrice: n(line.unitPrice),
      gross: n(net.plus(discount)), discount: n(discount), netSales: n(net), refundedNet: net.lt(0) ? n(net.negated()) : 0,
      recognizedNet: n(net), collectedNet: isAdvanceApplied ? 0 : n(net), taxRate: n(toDec(line.taxRate).times(100)),
      tax: n(tax), netTax: n(tax),
      total: isAdvanceApplied ? 0 : n(net.plus(tax)),
      appliedAdvance: isAdvanceApplied ? n(net.plus(tax)) : 0,
      tip: n(tip), outstanding: snapshot.outstanding,
      paymentStatus: isAdvanceApplied ? 'ADVANCE_APPLIED' : snapshot.status,
      lifecycle: snapshot.lifecycle, createdByName: inv.processedByName,
      collectedByName: e.record.processedByName || inv.processedByName,
      payments: isAdvanceApplied ? [] : [{ id: e.id, receiptNumber: e.record.receiptNumber || e.record.refundNumber,
        amount: n(net.plus(tax).plus(tip)), method: e.record.method || 'CASH',
        paymentAccountId: e.record.paymentAccountId || e.record.accountId,
        paymentAccountName: e.record.paymentAccountName || (e.record.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
        date: e.date, time: e.record.time || '', kind: e.kind,
        processedByName: e.record.processedByName || inv.processedByName }],
      refunds: e.kind === 'REFUND' ? [{ ...e.record, refundDate: e.date,
        netReversed: n(e.record.netReversed), taxReversed: n(e.record.taxReversed), tipReversed: n(e.record.tipReversed),
        cashOut: n(e.record.cashOut), receivableCancelled: n(e.record.receivableCancelled),
        lineRefund: (e.record.lines || []).filter(r => r.lineId === line.id).map(r => ({ quantity: Number(r.quantity), net: n(r.net), tax: n(r.tax) }))[0] || null }] : [],
      components: (line.components || []).map(c => ({ ...c, allocatedAmount: n(c.allocatedAmount), allocationPercentage: Number(c.allocationPercentage) })),
    });
  }

  // Booking Advance Collections & Refunds (Discrete Customer Deposit Receipts)
  for (const bp of bookingPayments) {
    if (query.sourceType && query.sourceType !== 'ALL' && query.sourceType !== 'BOOKING_ADVANCE') continue;
    if (query.paymentStatus && query.paymentStatus !== 'ALL' && query.paymentStatus !== 'PAID') continue;
    if (query.paymentMethod && query.paymentMethod !== 'ALL' && bp.method !== query.paymentMethod) continue;
    if (query.staffId && query.staffId !== 'ALL') continue;
    if (search && ![bp.receiptNumber, bp.booking?.bookingNumber, bp.booking?.clientName, bp.booking?.clientPhone, bp.reference]
      .some(val => val?.toLowerCase().includes(search))) continue;

    const amt = n(bp.amount);
    const signedAmt = bp.isRefund ? -amt : amt;
    const dateStr = ymd(bp.date);

    rows.push({
      id: `bpr-${bp.id}`,
      invoiceId: null,
      invoiceNumber: bp.receiptNumber,
      bookingNumber: bp.booking?.bookingNumber || undefined,
      bookingReference: bp.booking?.bookingNumber || undefined,
      date: dateStr,
      time: bp.time || '',
      lineId: null,
      originalInvoiceDate: dateStr,
      originalNetAmount: 0,
      originalBillAmount: amt,
      refundHistory: [],
      eventType: bp.isRefund ? 'BOOKING_REFUND' : 'BOOKING_ADVANCE',
      branchId: bp.branchId,
      branchName: bp.branch?.name || names.get(bp.branchId) || 'Branch',
      incomeSource: 'BOOKING_ADVANCE',
      clientId: bp.booking?.clientId,
      clientName: bp.booking?.clientName || 'Customer',
      clientPhone: bp.booking?.clientPhone,
      itemCode: bp.receiptNumber,
      itemName: bp.isRefund ? 'Booking Advance Refund' : 'Booking Advance / Customer Deposit',
      staffId: null,
      staffName: '—',
      quantity: 1,
      unitPrice: amt,
      gross: 0,
      discount: 0,
      netSales: 0,
      refundedNet: bp.isRefund ? amt : 0,
      recognizedNet: 0,
      collectedNet: signedAmt,
      taxRate: 0,
      tax: 0,
      netTax: 0,
      total: signedAmt,
      appliedAdvance: 0,
      tip: 0,
      outstanding: 0,
      paymentStatus: bp.isRefund ? 'REFUNDED' : 'PAID',
      lifecycle: 'ACTIVE',
      createdByName: bp.processedByName,
      collectedByName: bp.processedByName,
      payments: [{
        id: bp.id,
        receiptNumber: bp.receiptNumber,
        amount: signedAmt,
        method: bp.method || 'CASH',
        paymentAccountId: bp.paymentAccountId,
        paymentAccountName: bp.paymentAccountName || (bp.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
        date: dateStr,
        time: bp.time || '',
        kind: bp.isRefund ? 'BOOKING_REFUND' : 'BOOKING_ADVANCE',
        processedByName: bp.processedByName,
      }],
      refunds: [],
      components: [],
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const sum = (field, selected = rows) => n(selected.reduce((s, r) => s.plus(r[field] || 0), toDec(0)));
  const totals = Object.fromEntries(['gross', 'discount', 'netSales', 'refundedNet', 'recognizedNet', 'tax', 'netTax'].map(k => [k, sum(k)]));
  const bookingAdvancesSum = sum('total', rows.filter(r => r.incomeSource === 'BOOKING_ADVANCE'));
  const kpis = {
    totalTransactions: rows.length,
    grossSales: totals.gross,
    totalDiscounts: totals.discount,
    netSales: totals.netSales,
    totalRefunded: totals.refundedNet,
    recognizedNetRevenue: totals.recognizedNet,
    collectedRevenue: totals.recognizedNet,
    totalTaxCharged: totals.tax,
    netTaxLiability: totals.netTax,
    tipsCollected: sum('tip'),
    bookingAdvanceCollections: bookingAdvancesSum,
    totalPaid: n(toDec(sum('total')).plus(sum('tip'))),
  };

  for (const type of ['SERVICE', 'PRODUCT', 'PACKAGE']) {
    const selected = rows.filter(r => r.incomeSource === type);
    kpis[`${type.toLowerCase()}Revenue`] = sum('recognizedNet', selected);
    const countedLines = new Set();
    let unitCount = 0;
    for (const r of selected) {
      const lineKey = `${r.invoiceId}:${r.lineId}`;
      if (!countedLines.has(lineKey)) {
        countedLines.add(lineKey);
        unitCount += Number(r.quantity || 1);
      }
    }
    kpis[`${type.toLowerCase()}Count`] = unitCount;
  }

  return formatReportResponse(ctx.meta, { kpis, rows, displayRows: groupIncomeLines(rows), totals });
}
