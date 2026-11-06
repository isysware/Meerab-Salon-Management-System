import { netPayments } from './bookings.pricing.js';
import { toNum, round2, toDec } from '../../lib/money.js';
import { ymd } from '../../lib/dates.js';
export const bookingInclude = { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } }, history: { orderBy: { createdAt: 'asc' } }, invoice: { include: { payments: true, refunds: true } } };
export const toBookingDTO = b => {
  const advance = netPayments(b.payments || []);
  const closed = ['CANCELLED', 'NO_SHOW'].includes(b.status);
  const charges = closed ? b.cancellationCharge : b.totalAmount;
  const remaining = b.invoice ? toDec(b.invoice.amountDue) : round2(toDec(charges).minus(advance));
  const paid = b.invoice ? toDec(b.invoice.amountPaid) : advance;
  const received = b.invoice
    ? round2(b.invoice.payments.filter(p => !p.reversedAt).reduce((sum, p) => sum.plus(p.billAmountAllocated), toDec(b.invoice.advanceAdjusted))
      .minus(b.invoice.refunds.reduce((sum, r) => sum.plus(r.cashOut).minus(r.tipReversed), toDec(0))))
    : advance;
  return { ...b, eventDate: ymd(b.eventDate),
    subtotal: toNum(b.invoice?.subtotal ?? b.subtotal), discount: toNum(b.invoice?.discount ?? b.discount), discountValue: toNum(b.discountValue), taxAmount: toNum(b.invoice?.tax ?? b.taxAmount), totalAmount: b.invoice ? round2(toDec(b.invoice.total).minus(b.invoice.tip)).toNumber() : toNum(b.totalAmount), cancellationCharge: toNum(b.cancellationCharge),
    advancePaid: advance.toNumber(), receivedAmount: received.toNumber(), remainingBalance: remaining.toNumber(),
    status: (b.status === 'COMPLETED' && remaining.greaterThan(0)) ? (b.invoice ? 'IN_PROGRESS' : 'CONFIRMED') : b.status,
    paymentStatus: b.invoice ? ({ PAID: 'FULLY_PAID', PARTIAL: 'PARTIALLY_PAID', UNPAID: 'UNPAID' }[b.invoice.status]) : remaining.lessThanOrEqualTo(0) ? 'FULLY_PAID' : paid.greaterThan(0) ? 'PARTIALLY_PAID' : 'UNPAID',
    linkedInvoiceId: b.invoice?.id, linkedInvoiceNumber: b.invoice?.invoiceNumber,
    invoice: undefined,
    items: (b.items || []).map(i => ({ ...i, unitPrice: toNum(i.unitPrice), taxRate: toNum(i.taxRate), totalPrice: round2(toDec(i.unitPrice).times(i.quantity)).toNumber() })),
    payments: (b.payments || []).map(p => ({ ...p, amount: toNum(p.amount), date: ymd(p.date) })),
  };
};
