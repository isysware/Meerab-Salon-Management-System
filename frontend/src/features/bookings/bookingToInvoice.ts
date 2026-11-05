import { Booking } from '@/types/booking';
import { Invoice, InvoiceLineItem, Branch } from '@/types/salon';

/**
 * Converts a Booking record into a full Invoice representation for generating
 * advance payment receipts, thermal prints, A4/PDF invoices, and WhatsApp messages.
 */
export function bookingToInvoice(booking: Booking, branch?: Branch | null): Invoice {
  const advance =
    booking.advancePaid ||
    (booking.payments && booking.payments.length > 0
      ? booking.payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0)
      : 0);

  const remaining = booking.remainingBalance ?? Math.max(0, (booking.totalAmount || 0) - advance);

  const lineItems: InvoiceLineItem[] = (booking.items || []).map((it, idx) => {
    const unitPrice = it.unitPrice || 0;
    const quantity = it.quantity || 1;
    const total = unitPrice * quantity;

    return {
      id: it.id || `bkg-item-${idx}`,
      lineInstanceId: it.lineInstanceId || `li-${idx}`,
      itemId: it.itemId || undefined,
      type: it.type || 'SERVICE',
      name: it.name || 'Service',
      quantity,
      unitPrice,
      tax: 0,
      staffId: it.staffId || '',
      staffName: it.staffName || '',
      packageComponents: it.components?.map(c => ({
        serviceId: c.serviceId,
        serviceCode: '',
        serviceName: c.serviceName,
        staffId: c.staffId,
        staffName: c.staffName,
        quantity: 1,
        allocationPercentage: c.allocationPercentage,
        allocatedAmount: 0,
        staffCommissionRate: 0,
      })) || [],
      packageComponentsSnapshot: it.components?.map(c => ({
        serviceId: c.serviceId,
        serviceCode: '',
        serviceName: c.serviceName,
        staffId: c.staffId,
        staffName: c.staffName,
        quantity: 1,
        allocationPercentage: c.allocationPercentage,
        allocatedAmount: 0,
        staffCommissionRate: 0,
      })) || [],
      netSales: total,
      total,
      batchAllocations: [],
    };
  });

  const firstPayment = booking.payments && booking.payments.length > 0 ? booking.payments[0] : null;
  const paymentMethod = firstPayment?.method === 'ONLINE_ACCOUNT' ? 'ONLINE' : 'CASH';
  const paymentAccountName = firstPayment?.paymentAccountName;

  const typeLabel =
    booking.type === 'BRIDAL'
      ? 'Bridal Event'
      : booking.type === 'GROOM'
      ? 'Groom Event'
      : 'Salon Booking';

  const isFullyPaid = remaining <= 0;
  const isPartial = advance > 0 && !isFullyPaid;

  return {
    id: booking.id,
    bookingId: booking.id,
    invoiceNumber: booking.bookingNumber,
    branchId: booking.branchId,
    date: booking.eventDate || new Date().toISOString().slice(0, 10),
    time: booking.serviceTime || '10:00 AM',
    clientId: booking.clientId,
    clientName: booking.clientName,
    clientPhone: booking.clientPhone,
    staffId: booking.assignedStaffId || '',
    staffName: booking.assignedStaffName || 'Team',
    lineItems,
    lines: lineItems,
    subtotal: booking.subtotal || booking.totalAmount,
    discount: booking.discount || 0,
    discountType: booking.discountType,
    discountValue: booking.discountValue,
    netSales: (booking.totalAmount || 0) - (booking.discount || 0),
    tax: booking.taxAmount || 0,
    tip: 0,
    total: booking.totalAmount,
    paymentMethod: paymentMethod as any,
    paymentAccountId: firstPayment?.paymentAccountId,
    paymentAccountName,
    cashTendered: advance,
    changeReturned: 0,
    status: isFullyPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'UNPAID',
    amountPaid: advance,
    amountDue: remaining,
    advanceAdjusted: advance,
    lifecycle: booking.status === 'CANCELLED' ? 'VOIDED' : 'ACTIVE',
    payments: (booking.payments || []).map((p) => ({
      id: p.id,
      invoiceId: booking.id,
      branchId: booking.branchId,
      receiptNumber: p.receiptNumber,
      amount: p.amount,
      method: (p.method === 'ONLINE_ACCOUNT' ? 'ONLINE_ACCOUNT' : 'CASH') as any,
      paymentAccountId: p.paymentAccountId,
      paymentAccountName: p.paymentAccountName,
      processedByUserId: p.processedByUserId || '',
      processedByName: p.processedByName || 'Staff',
      date: p.date,
      time: p.time,
    })),
    notes:
      booking.notes ||
      `Advance Booking Invoice (${typeLabel}). Remaining balance of PKR ${Number(
        remaining
      ).toLocaleString('en-PK')} due on event date.`,
    isBookingInvoice: true,
    bookingType: booking.type,
  };
}

