import prisma from '../../config/prisma.js';
import { dateOnly, ymd } from '../../lib/dates.js';
import { toDec, max0, round2 } from '../../lib/money.js';
import { allocatePaymentToInvoice, allocateRounded } from '../../lib/calculations/collectionAllocation.js';

/** Accounting-only full service obligation from immutable invoice attribution/rate snapshots.
 * Credits reduce the original obligation; collections and payouts never affect recognition.
 * This function does not create commission events or payout entitlements.
 */
export function fullCommissionSnapshot(invoice, cutoff, inclusive = true) {
  const within = date => !cutoff || (inclusive ? ymd(date) <= cutoff : ymd(date) < cutoff);
  if (!within(invoice.date)) return { totalEarnedCommission: toDec(0), commissionsToRecord: [] };
  const credits = new Map();
  for (const refund of (invoice.refunds || []).filter(r => within(r.refundDate))) {
    for (const item of refund.lines || []) {
      const prior = credits.get(item.lineId) || { net: toDec(0), tax: toDec(0) };
      credits.set(item.lineId, { net: prior.net.plus(item.net), tax: prior.tax.plus(item.tax) });
    }
  }
  const lines = (invoice.lines || []).map(line => {
    const credit = credits.get(line.id);
    const net = max0(toDec(line.netSales).minus(credit?.net || 0));
    const parts = allocateRounded(net, (line.components || []).map(c => c.allocatedAmount));
    return { ...line, netSales: net, tax: max0(toDec(line.tax).minus(credit?.tax || 0)),
      components: (line.components || []).map((c, i) => ({ ...c, allocatedAmount: parts[i] })) };
  });
  const netSales = lines.reduce((sum, l) => sum.plus(l.netSales), toDec(0));
  const tax = lines.reduce((sum, l) => sum.plus(l.tax), toDec(0));
  return allocatePaymentToInvoice({ invoice: { ...invoice, lines, netSales, tax }, paymentAmount: netSales.plus(tax) });
}

export async function accruedCommissionForPeriod(scope, from, to) {
  const dates = { gte: dateOnly(from), lte: dateOnly(to) };
  const invoices = await prisma.invoice.findMany({
    where: { ...scope, OR: [{ date: dates }, { refunds: { some: { refundDate: dates } } }] },
    include: { lines: { include: { components: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      refunds: { include: { lines: true } } },
  });
  return round2(invoices.reduce((sum, invoice) => sum
    .plus(fullCommissionSnapshot(invoice, to).totalEarnedCommission)
    .minus(fullCommissionSnapshot(invoice, from, false).totalEarnedCommission), toDec(0)));
}
