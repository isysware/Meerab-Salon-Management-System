import { loadCollectionEvents, collectionTotals } from './collectionEvents.js';
import prisma from '../../config/prisma.js';
import { dateOnly, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';

const number = value => round2(value).toNumber();
const invoiceSelect = {
  id: true, invoiceNumber: true, date: true, time: true, branchId: true,
  clientName: true, paymentMethod: true, status: true, lifecycle: true,
  lines: { select: {
    id: true, type: true, name: true, staffName: true, quantity: true,
    unitPrice: true, discountAllocated: true, netSales: true, taxRate: true, tax: true,
  } },
};

export const taxReport = async (actor, query = {}) => {
  const ctx = await resolveReportContext(actor, query, 'RECOGNITION');
  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const scope = {
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}),
  };
  const [branches, invoices, refunds, collections] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.invoice.findMany({
      // Keep original recognition even after a void. Its dated reversal offsets it once.
      where: { date: dateRange, tax: { gt: 0 }, ...scope },
      select: invoiceSelect, orderBy: { date: 'desc' },
    }),
    prisma.invoiceRefund.findMany({
      where: { refundDate: dateRange, invoice: { tax: { gt: 0 }, ...scope } },
      select: {
        id: true, refundNumber: true, refundDate: true, type: true,
        lines: { select: { lineId: true, quantity: true, net: true, tax: true } },
        invoice: { select: invoiceSelect },
      },
      orderBy: { refundDate: 'asc' },
    }),
    loadCollectionEvents(scope, ctx.fromStr, ctx.toStr),
  ]);
  const branchNames = new Map(branches.map(b => [b.id, b.name]));
  const lines = new Map();
  const add = (invoice, line, event, refund) => {
    const key = `${invoice.id}:${line.id}`;
    const row = lines.get(key) || {
      id: `line-${line.id}`, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      date: ymd(refund ? refund.refundDate : invoice.date), time: refund ? '' : invoice.time || '',
      branchId: invoice.branchId, branchName: branchNames.get(invoice.branchId) || 'Branch',
      clientName: invoice.clientName || 'Walk-in Customer', serviceName: line.name,
      serviceType: line.type, staffName: line.staffName || 'Staff', unitPrice: number(line.unitPrice),
      taxRate: number(toDec(line.taxRate).times(100)), paymentMethod: invoice.paymentMethod || 'CASH',
      status: invoice.status, quantity: toDec(0), discount: toDec(0), taxableBase: toDec(0),
      taxAmount: toDec(0), grossTax: toDec(0), refundedTax: toDec(0), references: [],
    };
    const sign = refund ? -1 : 1;
    row.quantity = row.quantity.plus(toDec(event.quantity).times(sign));
    row.taxableBase = row.taxableBase.plus(toDec(event.net).times(sign));
    row.taxAmount = row.taxAmount.plus(toDec(event.tax).times(sign));
    const discount = refund
      ? toDec(line.discountAllocated).times(event.quantity).dividedBy(line.quantity)
      : toDec(line.discountAllocated);
    row.discount = row.discount.plus(discount.times(sign));
    if (refund) {
      row.refundedTax = row.refundedTax.plus(event.tax);
      row.references.push(refund.refundNumber);
      row.status = refund.type === 'VOID' ? 'VOIDED' : 'REFUNDED';
    } else row.grossTax = row.grossTax.plus(event.tax);
    lines.set(key, row);
  };
  for (const invoice of invoices) {
    for (const line of invoice.lines) add(invoice, line, { quantity: line.quantity, net: line.netSales, tax: line.tax });
  }
  for (const refund of refunds) {
    for (const reversal of refund.lines) {
      const line = refund.invoice.lines.find(l => l.id === reversal.lineId);
      if (line) add(refund.invoice, line, reversal, refund);
    }
  }

  // Filter once so visible rows, summaries, KPIs and exports always reconcile.
  const search = query.search?.trim().toLowerCase();
  const selected = [...lines.values()].filter(row => !search || [
    row.invoiceNumber, row.serviceName, row.clientName, row.branchName, row.staffName,
    row.paymentMethod, ...row.references,
  ].some(value => value?.toLowerCase().includes(search)));
  selected.sort((a, b) => b.date.localeCompare(a.date) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  const serviceRows = selected.map(({ grossTax, refundedTax, references, ...row }) => ({
    ...row, quantity: row.quantity.toNumber(), discount: number(row.discount),
    taxableBase: number(row.taxableBase), taxAmount: number(row.taxAmount),
    total: number(row.taxableBase.plus(row.taxAmount)),
    status: row.status === 'REFUNDED' && row.quantity.greaterThan(0) ? 'PARTIALLY_REFUNDED' : row.status,
  }));
  const invoiceMap = new Map();
  const summaryMap = new Map();
  for (const row of selected) {
    const invoice = invoiceMap.get(row.invoiceId) || {
      id: `inv-${row.invoiceId}`, date: row.date, time: row.time, reference: row.invoiceNumber,
      branchId: row.branchId, branchName: row.branchName, clientName: row.clientName,
      paymentMethod: row.paymentMethod, status: row.status, taxRate: row.taxRate,
      taxableBase: toDec(0), taxAmount: toDec(0), quantity: toDec(0), refundedTax: toDec(0),
    };
    invoice.taxableBase = invoice.taxableBase.plus(row.taxableBase);
    invoice.taxAmount = invoice.taxAmount.plus(row.taxAmount);
    invoice.quantity = invoice.quantity.plus(row.quantity);
    invoice.refundedTax = invoice.refundedTax.plus(row.refundedTax);
    invoice.taxRate = Math.max(invoice.taxRate, row.taxRate);
    if (row.status === 'VOIDED') invoice.status = 'VOIDED';
    invoiceMap.set(row.invoiceId, invoice);
    const key = `${row.serviceType}:${row.serviceName}:${row.taxRate}`;
    const summary = summaryMap.get(key) || {
      serviceName: row.serviceName, serviceType: row.serviceType, taxRate: row.taxRate,
      count: toDec(0), taxableBase: toDec(0), taxAmount: toDec(0),
    };
    summary.count = summary.count.plus(row.quantity);
    summary.taxableBase = summary.taxableBase.plus(row.taxableBase);
    summary.taxAmount = summary.taxAmount.plus(row.taxAmount);
    summaryMap.set(key, summary);
  }
  const invoiceRows = [...invoiceMap.values()].map(({ quantity, refundedTax, ...row }) => ({
    ...row, taxableBase: number(row.taxableBase), taxAmount: number(row.taxAmount),
    total: number(row.taxableBase.plus(row.taxAmount)),
    status: row.status === 'VOIDED' ? row.status : refundedTax.greaterThan(0)
      ? quantity.greaterThan(0) ? 'PARTIALLY_REFUNDED' : 'REFUNDED' : row.status,
  }));
  const serviceSummary = [...summaryMap.values()].map(row => ({
    ...row, count: row.count.toNumber(), taxableBase: number(row.taxableBase), taxAmount: number(row.taxAmount),
  }));
  const sum = field => selected.reduce((total, row) => total.plus(row[field]), toDec(0));
  const collectionRows = collections.filter(e => !search || [e.invoice.invoiceNumber, e.line.name, e.invoice.clientName, branchNames.get(e.invoice.branchId), e.line.staffName, e.record.method, e.record.refundNumber].some(v => v?.toLowerCase().includes(search)));
  const collected = collectionTotals(collectionRows);
  const tax = sum('taxAmount');
  const base = sum('taxableBase');
  return formatReportResponse(ctx.meta, {
    collectionRows: collectionRows.map(e => ({ id: e.id, invoiceNumber: e.invoice.invoiceNumber, date: e.date, method: e.record.method, eventType: e.kind, collectedNet: number(e.collectedNet), taxCollected: number(e.collectedTax) })),
    rows: serviceRows, serviceRows, serviceSummary, invoiceRows,
    kpis: {
      totalInvoicesTaxed: invoiceRows.length, totalServicesTaxed: serviceRows.length,
      totalTaxableSales: number(base), totalTaxCharged: number(sum('grossTax')),
      totalTaxCollected: collected.taxCollected, collectedRevenue: collected.collectedRevenue,
      totalTaxRefunded: number(sum('refundedTax')), netTaxLiability: number(tax),
    },
    totals: {
      totalServices: serviceRows.length, taxableBase: number(base),
      taxCollected: collected.taxCollected, taxAmount: number(tax), netTax: number(tax), total: number(base.plus(tax)),
    },
  });
};
