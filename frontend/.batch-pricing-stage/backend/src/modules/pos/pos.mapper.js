// src/modules/pos/pos.mapper.js
// Invoice rows → frontend `Invoice` / `PaymentRecord` types.

import { num, opt, iso } from '../../lib/dto.js';
import { ymd } from '../../lib/dates.js';

export const toPaymentDTO = (p) => ({
  id:                  p.id,
  receiptNumber:       p.receiptNumber,
  invoiceId:           p.invoiceId,
  branchId:            p.branchId,
  date:                ymd(p.date),
  time:                p.time,
  amount:              num(p.amount),
  billAmountAllocated: num(p.billAmountAllocated),
  tipAmountAllocated:  num(p.tipAmountAllocated),
  method:              p.method,
  paymentAccountId:    opt(p.paymentAccountId),
  paymentAccountName:  opt(p.paymentAccountName),
  processedByUserId:   p.processedByUserId,
  processedByName:     p.processedByName,
  cashTendered:        p.cashTendered === null ? undefined : num(p.cashTendered),
  changeReturned:      p.changeReturned === null ? undefined : num(p.changeReturned),
  previousBalance:     p.previousBalance === null ? undefined : num(p.previousBalance),
  remainingBalance:    p.remainingBalance === null ? undefined : num(p.remainingBalance),
  notes:               opt(p.notes),
  kind:                p.kind,
  drawerId: p.drawerId,
  reference: p.receiptNumber,
  reversedAt: p.reversedAt ? iso(p.reversedAt) : undefined,
  reversedByName: p.reversedByName,
  reversalReason: p.reversalReason,
  reversalDate: p.reversalDate ? ymd(p.reversalDate) : undefined,
});

const toComponentDTO = (c) => ({
  serviceId:            c.serviceId,
  serviceCode:          c.serviceCode,
  serviceName:          c.serviceName,
  staffId:              c.staffId,
  staffName:            c.staffName,
  quantity:             c.quantity,
  allocationPercentage: num(c.allocationPercentage),
  allocatedAmount:      num(c.allocatedAmount),
  staffCommissionRate:  num(c.staffCommissionRate),
});

const toLineDTO = (l) => {
  const components = [...(l.components ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(toComponentDTO);
  const batches = l.batches ?? [];
  return {
    id:                  l.id,
    name:                l.name,
    type:                l.type,
    itemId:              l.itemId,
    code:                opt(l.code),
    staffId:             l.staffId,
    staffName:           l.staffName,
    staffCommissionRate: num(l.staffCommissionRate),
    quantity:            num(l.quantity),
    unitPrice:           num(l.unitPrice),
    discountAllocated:   num(l.discountAllocated),
    netSales:            num(l.netSales),
    taxTreatment:        l.taxTreatment,
    taxRate:             num(l.taxRate),
    tax:                 num(l.tax),
    total:               num(l.total),
    ...(l.type === 'PACKAGE' ? { packageComponents: components, packageComponentsSnapshot: components } : {}),
    ...(l.type === 'PRODUCT' ? {
      batchAllocations: [...batches].sort((a,b) => a.sortOrder - b.sortOrder).map(b => ({
        batchId: b.batchId, batchNumber: b.batchNumber, quantity: num(b.qty), unitCost: num(b.unitCost),
        sellingPrice: b.sellingPrice == null ? num(l.unitPrice) : num(b.sellingPrice),
        discountAllocated: b.discountAllocated == null ? undefined : num(b.discountAllocated),
        taxAllocated: b.taxAllocated == null ? undefined : num(b.taxAllocated),
      })),
      batchId:          batches[0]?.batchId,
      batchNumber:      batches.map((b) => b.batchNumber).join(', ') || undefined,
      unitCostSnapshot: l.unitCostSnapshot === null ? undefined : num(l.unitCostSnapshot),
      cogsAmount:       num(l.cogsAmount),
    } : {}),
  };
};

export const toInvoiceDTO = (inv) => {
  const lines = [...(inv.lines ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(toLineDTO);
  const payments = [...(inv.payments ?? [])].sort((a, b) => a.createdAt - b.createdAt).map(toPaymentDTO);
  const cashPays = payments.filter((p) => p.method === 'CASH');
  const tendered = cashPays.reduce((s, p) => s + (p.cashTendered ?? 0), 0);
  const change = cashPays.reduce((s, p) => s + (p.changeReturned ?? 0), 0);
  return {
    id:                    inv.id,
    invoiceNumber:         inv.invoiceNumber,
    branchId:              inv.branchId,
    appointmentId:         opt(inv.appointmentId),
    bookingId:             opt(inv.bookingId),
    advanceAdjusted:       num(inv.advanceAdjusted),
    date:                  ymd(inv.date),
    time:                  inv.time,
    clientId:              opt(inv.clientId),
    clientName:            inv.clientName,
    clientPhone:           inv.clientPhone,
    customerSource:        opt(inv.customerSource),
    customerSourceDetails: opt(inv.customerSourceDetails),
    staffId:               inv.staffId ?? '',
    staffName:             inv.staffName ?? '',
    lineItems:             lines,
    lines,
    subtotal:              num(inv.subtotal),
    discount:              num(inv.discount),
    discountType:          opt(inv.discountType),
    discountValue:         inv.discountValue === null ? undefined : num(inv.discountValue),
    netSales:              num(inv.netSales),
    tax:                   num(inv.tax),
    tip:                   num(inv.tip),
    total:                 num(inv.total),
    paymentMethod:         inv.paymentMethod,
    paymentAccountId:      payments[0]?.paymentAccountId,
    paymentAccountName:    payments[0]?.paymentAccountName,
    cashTendered:          tendered > 0 ? tendered : undefined,
    changeReturned:        change > 0 ? change : undefined,
    status:                inv.status,
    lifecycle:             inv.lifecycle,
    amountPaid:            num(inv.amountPaid),
    amountDue:             num(inv.amountDue),
    payments,
    refunds: (inv.refunds || []).map(r => ({ id: r.id, refundNumber: r.refundNumber, type: r.type, refundDate: ymd(r.refundDate),
      netReversed: num(r.netReversed), taxReversed: num(r.taxReversed), tipReversed: num(r.tipReversed), cashOut: num(r.cashOut), receivableCancelled: num(r.receivableCancelled),
      method: opt(r.method), reason: r.reason, byName: r.byName, createdAt: iso(r.createdAt),
      lines: (r.lines || []).map(l => ({ lineId: l.lineId, quantity: num(l.quantity), net: num(l.net), tax: num(l.tax), restock: l.restock })) })),
    processedByUserId:     inv.processedByUserId,
    processedByName:       inv.processedByName,
    idempotencyKey:        opt(inv.idempotencyKey),
    notes:                 opt(inv.notes),
    createdAt:             iso(inv.createdAt),
  };
};
