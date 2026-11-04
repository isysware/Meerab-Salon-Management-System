// Read-only adapters around the same allocator used by Income/Expense and collection P&L.
// No commission ledger, invoice snapshot, or payment history is rewritten by reporting.
import prisma from '../../config/prisma.js';
import { dateOnly, ymd, toDateString } from '../../lib/dates.js';
import { max0, round2, toDec } from '../../lib/money.js';
import { allocatePaymentToInvoice, allocateRounded } from '../../lib/calculations/collectionAllocation.js';

const num = value => round2(value ?? 0).toNumber();
const day = value => typeof value === 'string' ? value.slice(0, 10) : ymd(value);
const sum = (rows, field) => rows.reduce((total, row) => total.plus(row[field] ?? 0), toDec(0));

/** Staff attribution is based on stored net allocations, never discounted a second time. */
export function staffShares(line, net) {
  const components = line.components || [];
  if (components.length) {
    const shares = allocateRounded(net, components.map(c => c.allocatedAmount));
    return components.map((c, index) => ({ ...c, componentId: c.id, net: shares[index] }));
  }
  return [{ staffId: line.staffId, staffName: line.staffName, componentId: null,
    staffCommissionRate: line.staffCommissionRate, net: toDec(net) }];
}

/**
 * Replay signed receipts and credits to derive cumulative allocations at each event.
 * Differences use the canonical allocator; a refund of unpaid dues is not a cash refund.
 * Original payments remain visible in their original period after a later reversal.
 */
export function invoiceCollectionEvents(invoice, { asOf, onBalance } = {}) {
  const events = [];
  for (const payment of invoice.payments || []) {
    events.push({ id: payment.id, date: day(payment.date), createdAt: payment.createdAt,
      kind: 'PAYMENT', record: payment, bill: toDec(payment.billAmountAllocated), tip: toDec(payment.tipAmountAllocated || 0) });
    if (payment.reversedAt) events.push({ id: `${payment.id}-reversal`,
      date: payment.reversalDate ? day(payment.reversalDate) : toDateString(payment.reversedAt),
      createdAt: payment.reversedAt, kind: 'PAYMENT_REVERSAL', record: payment,
      bill: toDec(payment.billAmountAllocated).negated(), tip: toDec(payment.tipAmountAllocated || 0).negated() });
  }
  // Applied booking deposits are sourced from their actual receipts, never counted again at checkout.
  let advanceLeft = toDec(invoice.advanceAdjusted || 0);
  const bookingPayments = [...(invoice.booking?.payments || [])].sort((a, b) => day(a.date).localeCompare(day(b.date)) || new Date(a.createdAt) - new Date(b.createdAt));
  let bookingRefund = bookingPayments.filter(p => p.isRefund).reduce((total, p) => total.plus(p.amount), toDec(0));
  for (const p of bookingPayments.filter(p => !p.isRefund)) {
    const offset = toDec(p.amount).lessThan(bookingRefund) ? toDec(p.amount) : bookingRefund;
    bookingRefund = bookingRefund.minus(offset);
    const available = toDec(p.amount).minus(offset);
    const applied = available.lessThan(advanceLeft) ? available : advanceLeft;
    if (applied.gt(0)) events.push({ id: `advance-${p.id}`, date: day(p.date), createdAt: p.createdAt,
      kind: 'BOOKING_PAYMENT', record: p, bill: applied, tip: toDec(0) });
    advanceLeft = advanceLeft.minus(applied);
  }
  // Legacy deposits without receipts are an application of liability, not fresh cash.
  // Seed allocation at conversion, but do not fabricate a customer receipt or payment date.
  if (advanceLeft.gt(0)) events.push({ id: `advance-credit-${invoice.id}`, date: day(invoice.date),
    createdAt: invoice.createdAt, kind: 'ADVANCE_CREDIT', record: {}, bill: advanceLeft, tip: toDec(0) });
  for (const refund of invoice.refunds || []) events.push({ id: refund.id, date: day(refund.refundDate),
    createdAt: refund.createdAt, kind: 'REFUND', record: refund,
    bill: max0(toDec(refund.cashOut || 0).minus(refund.tipReversed || 0)).negated(),
    tip: toDec(refund.tipReversed || 0).negated() });
  const priority = event => event.kind === 'REFUND' || event.kind === 'PAYMENT_REVERSAL' ? 1 : 0;
  events.sort((a, b) => a.date.localeCompare(b.date)
    || new Date(a.createdAt || `${a.date}T00:00:00Z`) - new Date(b.createdAt || `${b.date}T00:00:00Z`)
    || priority(a) - priority(b)
    || a.id.localeCompare(b.id));

  let held = toDec(0);
  let creditedNet = toDec(0);
  let creditedTax = toDec(0);
  const credits = new Map();
  let previous = new Map();
  const rows = [];
  for (const event of events) {
    if (asOf && event.date > asOf) continue;
    held = max0(held.plus(event.bill));
    if (event.kind === 'REFUND') {
      creditedNet = creditedNet.plus(event.record.netReversed || 0);
      creditedTax = creditedTax.plus(event.record.taxReversed || 0);
      for (const r of event.record.lines || []) {
        const prior = credits.get(r.lineId) || { net: toDec(0), tax: toDec(0) };
        credits.set(r.lineId, { net: prior.net.plus(r.net), tax: prior.tax.plus(r.tax) });
      }
    }
    const effectiveLines = (invoice.lines || []).map(line => {
      const credit = credits.get(line.id);
      const net = max0(toDec(line.netSales).minus(credit?.net || 0));
      const parts = (line.components || []).length
        ? allocateRounded(net, line.components.map(c => c.allocatedAmount)) : [];
      return { ...line, netSales: net, tax: max0(toDec(line.tax).minus(credit?.tax || 0)),
        components: (line.components || []).map((c, i) => ({ ...c, allocatedAmount: parts[i] })) };
    });
    const effective = { ...invoice, lines: effectiveLines,
      netSales: max0(toDec(invoice.netSales).minus(creditedNet)), tax: max0(toDec(invoice.tax).minus(creditedTax)) };
    const allocated = allocatePaymentToInvoice({ invoice: effective, paymentAmount: held });
    const current = new Map(allocated.lineAllocations.map(a => [a.lineId, a]));
    const outstanding = max0(toDec(effective.netSales).plus(effective.tax).minus(held));
    onBalance?.({ outstanding, retainedBill: held, credits: creditedNet.plus(creditedTax) });
    const tips = allocateRounded(event.tip, (invoice.lines || []).map(l => toDec(l.netSales).plus(l.tax)));
    for (const [index, line] of (invoice.lines || []).entries()) {
      const before = previous.get(line.id);
      const after = current.get(line.id);
      const net = toDec(after?.collectedNet || 0).minus(before?.collectedNet || 0);
      const tax = toDec(after?.collectedTax || 0).minus(before?.collectedTax || 0);
      const attribution = staffShares(after?.line || line, after?.collectedNet || 0).map((share, i) => ({
        ...share,
        net: share.net.minus(staffShares(before?.line || line, before?.collectedNet || 0)[i]?.net || 0),
        tax: staffShares(after?.line || line, after?.collectedTax || 0)[i].net
          .minus(staffShares(before?.line || line, before?.collectedTax || 0)[i]?.net || 0),
        tip: staffShares(line, tips[index])[i].net,
      }));
      const staffSnapshot = allocation => line.type === 'PRODUCT' ? new Map() : new Map(
        staffShares(allocation?.line || line, allocation?.collectedNet || 0)
          .filter(c => c.staffId && !['house', 'unassigned'].includes(c.staffId) && toDec(c.staffCommissionRate || 0).gt(0))
          .map(c => {
            const commission = allocation?.commissions.find(a => a.staffId === c.staffId && a.componentId === c.componentId);
            return [`${c.staffId}:${c.componentId}`, { ...c, lineId: line.id,
              amount: commission?.amount || toDec(0), attributedNet: c.net, rate: toDec(c.staffCommissionRate) }];
          }));
      const staffBefore = staffSnapshot(before);
      const staffAfter = staffSnapshot(after);
      const commissions = [...new Set([...staffBefore.keys(), ...staffAfter.keys()])].map(key => {
        const a = staffAfter.get(key), b = staffBefore.get(key), c = a || b;
        return { ...c, amount: toDec(a?.amount || 0).minus(b?.amount || 0),
          attributedNet: toDec(a?.attributedNet || 0).minus(b?.attributedNet || 0) };
      }).filter(c => !c.amount.isZero() || !c.attributedNet.isZero());
      if (event.kind !== 'ADVANCE_CREDIT' && (!net.isZero() || !tax.isZero() || !tips[index].isZero() || commissions.length)) {
        rows.push({ id: `${event.id}:${line.id}`, invoice, line, date: event.date,
          kind: event.kind, record: event.record, collectedNet: net, collectedTax: tax,
          billCollected: net.plus(tax), tip: tips[index], commissions, staffAllocations: attribution, outstanding });
      }
    }
    previous = current;
  }
  return rows;
}

/** Scope is supplied only by trusted report context, never raw query branch IDs. */
export async function loadCollectionEvents(scope, from, to, db = prisma) {
  const invoices = await db.invoice.findMany({
    where: { ...scope, OR: [
      { payments: { some: { OR: [{ date: { lte: dateOnly(to) } }, { reversalDate: { lte: dateOnly(to) } }] } } },
      { refunds: { some: { refundDate: { lte: dateOnly(to) } } } },
      { advanceAdjusted: { gt: 0 }, date: { lte: dateOnly(to) } },
    ] },
    include: { lines: { include: { components: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      payments: true, refunds: { include: { lines: true } }, booking: { include: { payments: true } } },
  });
  return invoices.flatMap(invoiceCollectionEvents).filter(e => (!from || e.date >= from) && e.date <= to);
}

export const collectionTotals = events => ({
  collectedRevenue: num(sum(events, 'collectedNet')), taxCollected: num(sum(events, 'collectedTax')),
  tipsCollected: num(sum(events, 'tip')), billCollected: num(sum(events, 'billCollected')),
  actualCollections: num(sum(events, 'billCollected').plus(sum(events, 'tip'))),
});

/** Payouts retain the original payment date and a separate negative reversal date. */
export function payoutEvents(payments) {
  return payments.flatMap(payment => [
    { ...payment, eventId: payment.id, date: toDateString(payment.paidAt), signedAmount: toDec(payment.amount), reversal: false },
    ...(payment.reversedAt ? [{ ...payment, eventId: `${payment.id}-reversal`, date: toDateString(payment.reversedAt),
      signedAmount: toDec(payment.amount).negated(), reversal: true }] : []),
  ]);
}

/** Invoice receivable snapshot uses the exact same event replay, including non-cash credits. */
export function invoiceBalanceAsOf(invoice, asOf) {
  let balance = { outstanding: max0(toDec(invoice.netSales).plus(invoice.tax)), retainedBill: toDec(0), credits: toDec(0) };
  const events = invoiceCollectionEvents(invoice, { asOf, onBalance: value => { balance = value; } });
  return { ...balance, events };
}

/** Recombine allocated line rows into one dated receipt; amounts are never counted twice. */
export function collectionReceipts(events) {
  const receipts = new Map();
  for (const event of events) {
    const id = `${event.invoice.id}:${event.kind}:${event.record.id}:${event.date}`;
    const row = receipts.get(id) || { ...event, id, billCollected: toDec(0), tip: toDec(0) };
    row.billCollected = row.billCollected.plus(event.billCollected);
    row.tip = row.tip.plus(event.tip);
    receipts.set(id, row);
  }
  return [...receipts.values()];
}
