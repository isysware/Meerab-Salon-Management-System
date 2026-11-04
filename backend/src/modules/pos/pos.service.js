// src/modules/pos/pos.service.js
// POS checkout & outstanding-dues collection — ONE database transaction per posting (spec §3, §4, §7):
//   invoice snapshot (+ lines, package components, cost layers) → payments → cash drawer / bank
//   account movements → FEFO stock-out with COGS → commission EARN events → tip receipts →
//   client link → appointment marked BILLED.
// Tax and tips are liabilities: they are never part of netSales or the commission base.

import { invoiceBalanceAsOf } from '../reports/collectionEvents.js';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import prisma from '../../config/prisma.js';
import { paymentPosting } from '../../lib/paymentPosting.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertInvoiceAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, toTimeString } from '../../lib/dates.js';
import { round2, splitWithRemainder, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { consumeStock } from '../../lib/stock.js';
import { normalizePhoneDigits } from '../../lib/phone.js';
import { formatMinutesToTime, parseTimeToMinutes } from '../../lib/calculations/attendanceCalculations.js';
import { isCompensationEligibleForCommission } from '../../lib/calculations/commissionCalculations.js';
import { allocatePaymentToInvoice } from '../../lib/calculations/collectionAllocation.js';
import { getActiveDrawer, postCashMovement, postAccountMovement } from '../cash/cash.service.js';
import { loadBooking, reviseBooking, bookingHistory } from '../bookings/bookings.service.js';
import { netPayments } from '../bookings/bookings.pricing.js';
import { findOrCreateClient } from '../clients/clients.service.js';
import { toInvoiceDTO } from './pos.mapper.js';

export const invoiceInclude = {
  lines:    { include: { components: true, batches: true } },
  payments: true,
  refunds: { include: { lines: true } },
};

const clockTime = () => formatMinutesToTime(parseTimeToMinutes(toTimeString(new Date())));
const isWalkIn = (name) => !name || ['walk-in', 'walk-in customer'].includes(name.trim().toLowerCase());

const loadInvoice = async (tx, id) => {
  const inv = await tx.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!inv) throw notFound('INVOICE_NOT_FOUND', `Invoice '${id}' not found.`);
  return inv;
};

// ═══ QUERIES ══════════════════════════════════════════════════════════════════

export const listInvoices = async (actor, { branchId, status, date, startDate, endDate, clientId, soldByUserId, processedByUserId } = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access invoices.');
  const b = resolveReadBranch(actor, branchId);
  const dateFilter = {};
  if (date) dateFilter.equals = dateOnly(date);
  if (startDate) dateFilter.gte = dateOnly(startDate);
  if (endDate) dateFilter.lte = dateOnly(endDate);

  const userFilter = actor.role === 'ACCOUNTANT' ? actor.id : (soldByUserId || processedByUserId);
  const rows = await prisma.invoice.findMany({
    where: {
      ...(b ? { branchId: b } : {}),
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
      ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
      ...(userFilter && userFilter !== 'ALL' ? { processedByUserId: userFilter } : {}),
    },
    include: invoiceInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toInvoiceDTO);
};

export const getInvoice = async (actor, id) => {
  const inv = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!inv) return null;
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access invoices.');
  assertInvoiceAccess(actor, inv);
  return toInvoiceDTO(inv);
};

/** Open invoices of a client, matched by client id or by phone digits (walk-ins without a profile). */
export const clientOutstanding = async (actor, { branchId, clientIdOrPhone }) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Staff cannot access customer dues.');
  const b = resolveWriteBranch(actor, branchId);
  if (!b) throw forbidden('BRANCH_REQUIRED', 'A branch assignment is required to access customer dues.');
  const digits = normalizePhoneDigits(clientIdOrPhone);
  const rows = await prisma.invoice.findMany({
    where: { branchId: b, ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}), lifecycle: { not: 'VOIDED' } },
    include: invoiceInclude,
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  return rows
    .filter((i) => i.clientId === clientIdOrPhone || (digits.length >= 10 && normalizePhoneDigits(i.clientPhone) === digits))
    .map(i => {
      const balance = invoiceBalanceAsOf(i);
      return { ...toInvoiceDTO(i), amountDue: balance.outstanding.toNumber(),
        status: balance.outstanding.isZero() ? 'PAID' : balance.retainedBill.gt(0) ? 'PARTIAL' : 'UNPAID' };
    }).filter(i => i.amountDue > 0);
};

// ═══ SHARED PAYMENT HANDLING ══════════════════════════════════════════════════

const validatePaymentShape = (p, { allowTip, expectedTip } = {}) => {
  const amount = round2(p.amount);
  let bill = p.billAllocation !== undefined ? round2(p.billAllocation) : null;
  let tip = p.tipAllocation !== undefined ? round2(p.tipAllocation) : null;
  if (bill === null && tip === null) {
    if (allowTip && expectedTip && expectedTip.gt(0)) {
      tip = round2(Decimal.min(amount, expectedTip));
      bill = round2(amount.minus(tip));
    } else {
      bill = amount;
      tip = toDec(0);
    }
  } else if (bill === null) {
    bill = round2(amount.minus(tip || 0));
  } else if (tip === null) {
    tip = round2(amount.minus(bill || 0));
  }
  if ([amount, bill, tip].some((v) => v.lessThan(0))) throw badRequest('INVALID_PAYMENT', 'All payment amounts must be finite, non-negative numbers.');
  if (!bill.plus(tip).equals(amount)) {
    throw badRequest('PAYMENT_ALLOCATION_MISMATCH', `Payment receipt error: bill allocation (${bill}) + tip allocation (${tip}) must equal payment amount (${amount}).`);
  }
  if (!allowTip && tip.greaterThan(0)) throw badRequest('TIP_NOT_ALLOWED', 'Outstanding bill collections are bill-only. Tip allocation must be zero.');
  if (p.method === 'ONLINE_ACCOUNT' && toDec(p.changeReturned || 0).greaterThan(0)) {
    throw badRequest('CHANGE_ON_ONLINE', 'Change cannot be returned on digital/online payment accounts. Change can only be returned in cash.');
  }
  if (p.method === 'CASH') {
    const tendered = round2(p.cashTendered || amount);
    const change = round2(p.changeReturned || 0);
    if (tendered.lessThan(amount)) throw badRequest('INSUFFICIENT_TENDER', `Insufficient cash tendered (${tendered} PKR) for cash payment (${amount} PKR).`);
    if (!tendered.minus(change).equals(amount)) {
      throw badRequest('CHANGE_MISMATCH', `Cash tendered minus change returned (${tendered.minus(change)} PKR) must equal retained cash payment (${amount} PKR).`);
    }
  }
  return { amount, bill, tip };
};

/**
 * Records one payment row and moves the money. Cash → actor's drawer (bill = CASH_SALE / DUES_COLLECTION,
 * tip = CASH_TIP). Online → named branch account. Returns the created InvoicePayment.
 */
const receivePayment = async (tx, actor, { invoice, branchId, p, amounts, kind, date, time, previousBalance, notes }) => {
  let drawerId = null;
  let accountName = null;
  const billType = kind === 'DUES_COLLECTION' ? 'DUES_COLLECTION' : 'CASH_SALE';
  const paymentId = randomUUID();
  const common = { sourceModule: 'POS', sourceId: paymentId, reference: invoice.invoiceNumber, actor, transactionDate: date };

  if (p.method === 'CASH') {
    const drawer = await getActiveDrawer(tx, actor, branchId, { autoOpen: kind !== 'DUES_COLLECTION' });
    drawerId = drawer.id;
    if (amounts.bill.greaterThan(0)) await postCashMovement(tx, { ...common, holderId: drawer.id, type: billType, direction: 'IN', amount: amounts.bill, description: `${kind === 'DUES_COLLECTION' ? 'Dues collection' : 'POS sale'} ${invoice.invoiceNumber}` });
    if (amounts.tip.greaterThan(0)) await postCashMovement(tx, { ...common, holderId: drawer.id, type: 'CASH_TIP', direction: 'IN', amount: amounts.tip, description: `Tip on ${invoice.invoiceNumber} (staff liability)` });
  } else {
    if (!p.paymentAccountId) throw badRequest('ACCOUNT_REQUIRED', 'Online payment must reference a valid payment account.');
    if (amounts.bill.greaterThan(0)) {
      const { account } = await postAccountMovement(tx, { ...common, accountId: p.paymentAccountId, branchId, type: billType, direction: 'IN', amount: amounts.bill, description: `${kind === 'DUES_COLLECTION' ? 'Dues collection' : 'POS sale'} ${invoice.invoiceNumber}` });
      accountName = account.name;
    }
    if (amounts.tip.greaterThan(0)) {
      const { account } = await postAccountMovement(tx, { ...common, accountId: p.paymentAccountId, branchId, type: 'CASH_TIP', direction: 'IN', amount: amounts.tip, description: `Tip on ${invoice.invoiceNumber} (staff liability)` });
      accountName = account.name;
    }
  }

  return tx.invoicePayment.create({
    data: {
      receiptNumber: await nextSequence(tx, '', 'RCP'),
      id: paymentId, invoiceId: invoice.id, branchId, date, time, amount: amounts.amount, billAmountAllocated: amounts.bill, tipAmountAllocated: amounts.tip,
      method: p.method, paymentAccountId: p.method === 'ONLINE_ACCOUNT' ? p.paymentAccountId : null, paymentAccountName: accountName, drawerId,
      cashTendered: p.method === 'CASH' ? round2(p.cashTendered || amounts.amount) : null,
      changeReturned: p.method === 'CASH' ? round2(p.changeReturned || 0) : null,
      previousBalance, kind, processedByUserId: actor.id, processedByName: actor.name, notes: notes || null,
    },
  });
};

// ═══ CHECKOUT ═════════════════════════════════════════════════════════════════

const resolveTaxRate = (treatment, specificRuleId, branch, rules) => {
  if (treatment === 'EXEMPT') return toDec(0);
  if (treatment === 'SPECIFIC_RULE') {
    const rule = rules.find((r) => r.id === specificRuleId);
    if (!rule || !rule.isActive) throw badRequest('TAX_RULE_INVALID', `Specific tax rule '${specificRuleId}' is missing or inactive.`);
    return toDec(rule.rate);
  }
  return branch.taxEnabled ? toDec(branch.taxRate) : toDec(0);
};

export const postInvoice = async (input, actor, idempotencyKey, request) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot perform POS billing or cash collections.');
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot perform operations for another branch.');

  return paymentPosting(actor, request, async (tx) => {
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch?.isActive) throw badRequest('BRANCH_INACTIVE', `Branch '${branchId}' is invalid or deactivated.`);
    const today = await getBusinessDate(tx);
    const time = clockTime();

    let booking = null;
    let advanceAdjusted = toDec(0);
    if (input.bookingId) {
      if (input.appointmentId) throw badRequest('MULTIPLE_RESERVATIONS', 'Choose either a booking or an appointment.');
      booking = await loadBooking(tx, actor, input.bookingId, { lock: true, editable: true });
      if (booking.branchId !== branchId) throw badRequest('BOOKING_BRANCH', 'Booking belongs to another branch.');
      if (booking.revision !== input.bookingRevision) throw conflict('BOOKING_OUTDATED', 'Booking changed. Refresh checkout.');
      if (input.bookingUpdate) booking = await reviseBooking(tx, booking, input.bookingUpdate, actor);
      advanceAdjusted = netPayments(booking.payments);
      const retailItems = input.cartItems.filter(c => c.type === 'PRODUCT');
      input = { ...input, clientId: booking.clientId, clientName: booking.clientName, clientPhone: booking.clientPhone,
        discountType: booking.discountType, discountValue: Number(booking.discountValue), applyTax: input.applyTax !== false,
        cartItems: [...booking.items.map(i => ({ type: i.type, item: { id: i.itemId, name: i.name, price: Number(i.unitPrice) }, quantity: i.quantity, staffId: i.staffId || 'house',
          packageComponents: i.components.map(c => ({ serviceId: c.serviceId, staffId: c.staffId || 'house' })), bookingLineId: i.lineInstanceId })), ...retailItems] };
    } else if (input.bookingUpdate) throw badRequest('BOOKING_REQUIRED', 'Booking changes require a booking checkout.');

    // ── Appointment hand-off guard ──
    let appointment = null;
    if (input.appointmentId) {
      appointment = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
      if (!appointment) throw notFound('APPOINTMENT_NOT_FOUND', `Linked appointment '${input.appointmentId}' not found.`);
      if (appointment.branchId !== branchId) throw badRequest('APPOINTMENT_BRANCH', `Appointment belongs to another branch, cannot bill under branch '${branch.name}'.`);
      if (appointment.billingStatus === 'BILLED') {
        throw conflict('APPOINTMENT_BILLED', `Appointment '${appointment.appointmentNumber}' has already been billed under invoice ${appointment.linkedInvoiceNumber}. Duplicate invoices are prohibited.`);
      }
      if (['CANCELLED', 'NO_SHOW'].includes(appointment.status)) throw conflict('APPOINTMENT_CLOSED', 'Cancelled or no-show appointments cannot be billed.');
    }

    // ── Load canonical catalogue rows (prices/tax/weights always come from the DB, never the cart) ──
    const ids = (t) => input.cartItems.filter((c) => c.type === t).map((c) => c.item.id);
    const [services, packages, products, staffRows, rules] = await Promise.all([
      tx.service.findMany({ where: { id: { in: ids('SERVICE') } } }),
      tx.package.findMany({ where: { id: { in: ids('PACKAGE') } }, include: { components: { include: { service: true } } } }),
      tx.inventoryItem.findMany({ where: { id: { in: ids('PRODUCT') } } }),
      tx.staff.findMany({ where: { branchId } }),
      tx.taxRule.findMany({ where: { OR: [{ branchId }, { branches: { some: { id: branchId } } }] } }),
    ]);
    const staffById = new Map(staffRows.map((s) => [s.id, s]));
    const requireStaff = (id, label) => {
      if (!id || id === 'unassigned' || id === 'house' || id === 'none' || id === '' || id === 'salon') {
        return {
          id: 'house',
          name: 'House / Salon',
          commissionRate: 0,
          compensationType: 'SALARY_ONLY',
          isActive: true,
        };
      }
      const s = staffById.get(id);
      if (!s || !s.isActive) throw badRequest('STAFF_INVALID', `Assigned staff for '${label}' is inactive or from another branch.`);
      return s;
    };
    const commissionRate = (s) => (s && s.id !== 'house' && isCompensationEligibleForCommission(s.compensationType) ? toDec(s.commissionRate) : toDec(0));

    // ── Build line drafts ──
    const drafts = input.cartItems.map((c) => {
      if (booking && c.bookingLineId) {
        const saved = booking.items.find(i => i.lineInstanceId === c.bookingLineId);
        const catalogue = { id: saved.itemId, code: saved.code, name: saved.name, price: saved.unitPrice, taxTreatment: saved.taxTreatment,
          components: saved.components.map((k, index) => ({ serviceId: k.serviceId, service: { code: k.serviceCode, name: k.serviceName }, quantity: c.quantity, sortOrder: index, allocationPercentage: k.allocationPercentage })) };
        const price = toDec(saved.unitPrice), staff = requireStaff(saved.staffId, saved.name);
        const taxRate = input.applyTax === false ? toDec(0) : toDec(saved.taxRate);
        return { c, catalogue, staff, unitPrice: price, gross: round2(price.times(c.quantity)), taxRate };
      }
      if (!Number.isInteger(c.quantity) || c.quantity <= 0) throw badRequest('INVALID_QUANTITY', `Item '${c.item.name}' must have a positive whole quantity.`);
      let catalogue;
      if (c.type === 'SERVICE') {
        catalogue = services.find((s) => s.id === c.item.id);
        if (!catalogue || !catalogue.isActive || catalogue.branchId !== branchId) throw badRequest('ITEM_INVALID', `Service '${c.item.name}' is inactive or invalid for this branch.`);
      } else if (c.type === 'PACKAGE') {
        catalogue = packages.find((p) => p.id === c.item.id);
        if (!catalogue || !catalogue.isActive || catalogue.branchId !== branchId) throw badRequest('ITEM_INVALID', `Package '${c.item.name}' is inactive or invalid for this branch.`);
        const inactive = catalogue.components.find((k) => !k.service.isActive);
        if (inactive) throw badRequest('COMPONENT_INACTIVE', `Cannot sell package '${catalogue.name}': component service '${inactive.service.name}' is deactivated.`);
      } else {
        catalogue = products.find((p) => p.id === c.item.id);
        if (!catalogue || !catalogue.isActive) throw badRequest('ITEM_INVALID', `Product '${c.item.name}' is inactive or invalid.`);
        if (!(catalogue.branchAvailability.includes('ALL') || catalogue.branchAvailability.includes(branchId))) {
          throw badRequest('ITEM_NOT_IN_BRANCH', `Product '${catalogue.name}' is not available for sale in this branch.`);
        }
        if (catalogue.itemType === 'SALON_CONSUMABLE') throw badRequest('NOT_FOR_SALE', `'${catalogue.name}' is a salon consumable and cannot be sold.`);
      }
      const price = toDec(c.type === 'PRODUCT' ? catalogue.sellingPrice : catalogue.price);
      if (!round2(c.item.price ?? c.item.sellingPrice ?? 0).equals(round2(price))) {
        throw conflict('PRICE_OUTDATED', `Cart price quote for '${catalogue.name}' is outdated. Please refresh your cart.`);
      }
      const staff = requireStaff(c.staffId, catalogue.name);
      const taxRate = input.applyTax === false
        ? toDec(0)
        : resolveTaxRate(catalogue.taxTreatment, catalogue.specificTaxRuleId, branch, rules);
      return { c, catalogue, staff, unitPrice: price, gross: round2(price.times(c.quantity)), taxRate };
    });
    if (!drafts.length) throw badRequest('EMPTY_CART', 'Cannot post invoice with an empty cart.');

    // ── Discount: proportional to line gross, remainder on the largest line ──
    const subtotal = round2(drafts.reduce((s, d) => s.plus(d.gross), toDec(0)));
    const discountValue = toDec(input.discountValue || 0);
    const totalDiscount = input.discountType === 'PERCENTAGE'
      ? round2(subtotal.times(Decimal.max(0, Decimal.min(100, discountValue))).dividedBy(100))
      : round2(Decimal.max(0, Decimal.min(subtotal, discountValue)));
    const discounts = subtotal.isZero() ? drafts.map(() => toDec(0)) : splitWithRemainder(totalDiscount, drafts.map((d) => d.gross));

    drafts.forEach((d, i) => {
      d.discount = discounts[i];
      d.net = round2(d.gross.minus(d.discount));
      d.tax = round2(d.net.times(d.taxRate));
    });
    const netSales = round2(drafts.reduce((s, d) => s.plus(d.net), toDec(0)));
    const tax = round2(drafts.reduce((s, d) => s.plus(d.tax), toDec(0)));
    const billTotal = round2(netSales.plus(tax));
    const tip = round2(Decimal.max(0, toDec(input.tip || 0)));
    const total = round2(billTotal.plus(tip));

    // ── Payments ──
    let remainingTipTarget = tip;
    const payments = (input.payments || []).map((p) => {
      const amounts = validatePaymentShape(p, { allowTip: true, expectedTip: remainingTipTarget });
      remainingTipTarget = round2(Decimal.max(0, remainingTipTarget.minus(amounts.tip)));
      return { p, amounts };
    });
    const sum = (f) => round2(payments.reduce((s, x) => s.plus(x.amounts[f]), toDec(0)));
    const received = sum('amount');
    const billPaid = sum('bill');
    const tipPaid = sum('tip');
    const onlineTotal = round2(payments.filter((x) => x.p.method === 'ONLINE_ACCOUNT').reduce((s, x) => s.plus(x.amounts.amount), toDec(0)));
    if (onlineTotal.greaterThan(total)) throw badRequest('ONLINE_OVERPAYMENT', `Digital payment (${onlineTotal} PKR) cannot exceed total invoice due (${total} PKR).`);
    if (received.greaterThan(total)) throw badRequest('OVERPAYMENT', `Total retained payment (${received} PKR) cannot exceed total invoice due (${total} PKR). Any excess physical cash must be returned as change.`);
    if (billPaid.greaterThan(billTotal)) throw badRequest('BILL_OVERPAYMENT', `Bill allocation (${billPaid} PKR) cannot exceed the bill total (${billTotal} PKR).`);
    if (tipPaid.greaterThan(tip)) throw badRequest('TIP_OVERPAYMENT', `Tip allocation (${tipPaid} PKR) cannot exceed the tip (${tip} PKR).`);
    if (advanceAdjusted.plus(billPaid).greaterThan(billTotal)) throw badRequest('BOOKING_OVERPAYMENT', 'Advance plus new collection exceeds the final bill.');
    const amountDue = round2(billTotal.minus(billPaid).minus(advanceAdjusted));
    const status = amountDue.isZero() ? 'PAID' : billPaid.plus(advanceAdjusted).greaterThan(0) ? 'PARTIAL' : 'UNPAID';

    // ── Customer: dues need a named, reachable customer ──
    let clientName = input.clientName?.trim();
    let clientPhone = input.clientPhone?.trim();
    const phoneDigits = normalizePhoneDigits(clientPhone);
    if (amountDue.greaterThan(0)) {
      if (isWalkIn(clientName)) throw badRequest('CUSTOMER_REQUIRED', 'A specific customer name is required for unpaid or partial balance invoices so outstanding amounts can be followed up.');
      if (!clientPhone || phoneDigits.length < 10) throw badRequest('PHONE_REQUIRED', 'A contact phone number (at least 10 digits) is required for unpaid or partial balance invoices.');
    }
    let client = null;
    if (input.clientId || (!isWalkIn(clientName) && phoneDigits.length >= 10)) {
      client = await findOrCreateClient(tx, {
        branchId, clientId: input.clientId, name: clientName, phone: clientPhone,
        source: input.customerSource, sourceDetails: input.customerSourceDetails,
      });
      clientName = client.name;
      clientPhone = client.phone;
    } else {
      clientName = clientName || 'Walk-in Customer';
      clientPhone = clientPhone || 'N/A';
    }

    // ── Invoice header ──
    const invoiceNumber = await nextSequence(tx, branch.code, 'INV', Number(today.slice(0, 4)));
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber, branchId, appointmentId: appointment?.id ?? null, date: dateOnly(today), time,
        clientId: client?.id ?? null, clientName, clientPhone,
        customerSource: input.customerSource || client?.source || 'WALK_IN', customerSourceDetails: input.customerSourceDetails || null,
        staffId: drafts[0].staff.id === 'house' ? null : drafts[0].staff.id,
        staffName: drafts[0].staff.id === 'house' ? 'House / Salon' : drafts[0].staff.name,
        subtotal, discount: totalDiscount, discountType: input.discountType || 'FIXED', discountValue: round2(discountValue),
        netSales, tax, tip: tipPaid, total: round2(billTotal.plus(tipPaid)), status, amountPaid: received.plus(advanceAdjusted), amountDue,
        bookingId: booking?.id || null, advanceAdjusted,
        paymentMethod: payments.filter((x) => x.amounts.amount.greaterThan(0)).length > 1 ? 'SPLIT' : payments.find((x) => x.amounts.amount.greaterThan(0))?.p.method ?? 'CASH',
        processedByUserId: actor.id, processedByName: actor.name, idempotencyKey: idempotencyKey ?? input.idempotencyKey ?? null,
        notes: input.notes || null,
      },
    });

    // ── Lines (+ package/multi-staff allocation, stock & COGS) ──
    for (const [i, d] of drafts.entries()) {
      const lineStaffName = d.c.assignedStaff && d.c.assignedStaff.length > 1
        ? d.c.assignedStaff.map((s) => s.staffName || s.name).filter(Boolean).join(', ')
        : d.staff.name;

      const line = await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id, sortOrder: i, type: d.c.type, itemId: d.catalogue.id, code: d.c.type === 'PRODUCT' ? d.catalogue.sku : d.catalogue.code,
          name: d.catalogue.name, staffId: d.staff.id, staffName: lineStaffName, staffCommissionRate: commissionRate(d.staff),
          quantity: d.c.quantity, unitPrice: d.unitPrice, discountAllocated: d.discount, netSales: d.net,
          taxTreatment: d.catalogue.taxTreatment, taxRate: d.taxRate, tax: d.tax, total: round2(d.net.plus(d.tax)),
        },
      });

      if (d.c.type === 'SERVICE' || d.c.type === 'CUSTOM_SERVICE') {
        const rawAssigned = d.c.assignedStaff && d.c.assignedStaff.length > 0
          ? d.c.assignedStaff.filter((s) => s.staffId && s.staffId !== 'house' && s.staffId !== 'unassigned')
          : null;

        if (rawAssigned && rawAssigned.length > 0) {
          const assignedStaffList = rawAssigned.map((s) => {
            const staff = requireStaff(s.staffId, d.catalogue.name);
            return {
              ...s,
              id: staff.id,
              name: staff.name,
              commissionRate: staff.commissionRate,
              staff,
            };
          });

          const hasCustomAllocation = assignedStaffList.some(
            (s) => typeof s.allocatedAmount === 'number' && s.allocatedAmount > 0
          );
          const discountRatio = (d.discount && d.discount.greaterThan(0) && d.unitPrice && d.unitPrice.greaterThan(0))
            ? d.net.dividedBy(d.unitPrice.times(d.c.quantity))
            : toDec(1);

          let shares;
          if (hasCustomAllocation) {
            shares = assignedStaffList.map((st) => {
              const customAmount = typeof st.allocatedAmount === 'number' && st.allocatedAmount > 0 ? toDec(st.allocatedAmount) : toDec(0);
              return round2(customAmount.times(discountRatio));
            });
          } else {
            shares = splitWithRemainder(d.net, assignedStaffList.map(() => toDec(1)));
          }

          for (const [si, st] of assignedStaffList.entries()) {
            const staffNet = shares[si];
            const allocPct = d.net.greaterThan(0) ? round2(staffNet.times(100).dividedBy(d.net)) : toDec(0);
            await tx.invoiceLineComponent.create({
              data: {
                lineId: line.id,
                sortOrder: si,
                serviceId: d.catalogue.id,
                serviceCode: d.c.type === 'PRODUCT' ? (d.catalogue.sku || '') : (d.catalogue.code || ''),
                serviceName: d.catalogue.name,
                quantity: d.c.quantity,
                staffId: st.id,
                staffName: st.name,
                allocationPercentage: allocPct,
                allocatedAmount: staffNet,
                staffCommissionRate: commissionRate(st.staff),
              },
            });
          }
        }
      }

      if (d.c.type === 'PACKAGE') {
        if (booking) {
          const comps = [...d.catalogue.components].sort((a, b) => a.sortOrder - b.sortOrder);
          const shares = splitWithRemainder(d.net, comps.map(k => toDec(k.allocationPercentage)));
          for (const [ci, k] of comps.entries()) {
            const assigned = d.c.packageComponents.find(pc => pc.serviceId === k.serviceId);
            const st = requireStaff(assigned?.staffId, k.service.name);
            await tx.invoiceLineComponent.create({ data: { lineId: line.id, sortOrder: ci, serviceId: k.serviceId, serviceCode: k.service.code, serviceName: k.service.name,
              quantity: d.c.quantity, staffId: st.id, staffName: st.name, allocationPercentage: k.allocationPercentage, allocatedAmount: shares[ci], staffCommissionRate: commissionRate(st) } });
          }
        } else {
          const rawAssigned = d.c.assignedStaff && d.c.assignedStaff.length > 0
            ? d.c.assignedStaff.filter((s) => s.staffId && s.staffId !== 'house' && s.staffId !== 'unassigned')
            : null;
          const assignedStaffList = rawAssigned && rawAssigned.length > 0
            ? rawAssigned.map((s) => {
                const staff = requireStaff(s.staffId, d.catalogue.name);
                return {
                  ...s,
                  id: staff.id,
                  name: staff.name,
                  commissionRate: staff.commissionRate,
                  staff,
                };
              })
            : (d.c.packageComponents?.length && d.c.packageComponents.some((pc) => pc.staffId && pc.staffId !== d.staff.id)
                ? null
                : (d.staff && d.staff.id !== 'house' && d.staff.id !== 'unassigned'
                    ? [{ staffId: d.staff.id, id: d.staff.id, name: d.staff.name, commissionRate: d.staff.commissionRate, staff: d.staff, allocatedAmount: d.net.toNumber() }]
                    : []));

          if (assignedStaffList && assignedStaffList.length > 0) {
            const hasCustomAllocation = assignedStaffList.some(
              (s) => typeof s.allocatedAmount === 'number' && s.allocatedAmount > 0
            );
            const discountRatio = (d.discount && d.discount.greaterThan(0) && d.unitPrice && d.unitPrice.greaterThan(0))
              ? d.net.dividedBy(d.unitPrice.times(d.c.quantity))
              : toDec(1);

            let shares;
            if (hasCustomAllocation) {
              shares = assignedStaffList.map((st) => {
                const customAmount = typeof st.allocatedAmount === 'number' && st.allocatedAmount > 0 ? toDec(st.allocatedAmount) : toDec(0);
                return round2(customAmount.times(discountRatio));
              });
            } else {
              shares = splitWithRemainder(d.net, assignedStaffList.map(() => toDec(1)));
            }

            for (const [si, st] of assignedStaffList.entries()) {
              const staffNet = shares[si];
              const allocPct = d.net.greaterThan(0) ? round2(staffNet.times(100).dividedBy(d.net)) : toDec(0);
              await tx.invoiceLineComponent.create({
                data: {
                  lineId: line.id,
                  sortOrder: si,
                  serviceId: d.catalogue.id,
                  serviceCode: d.catalogue.code || '',
                  serviceName: d.catalogue.name,
                  quantity: d.c.quantity,
                  staffId: st.id,
                  staffName: st.name,
                  allocationPercentage: allocPct,
                  allocatedAmount: staffNet,
                  staffCommissionRate: commissionRate(st.staff),
                },
              });
            }
          } else if (d.c.packageComponents?.length && d.c.packageComponents.some((pc) => pc.staffId && pc.staffId !== d.staff.id)) {
            // Fallback legacy per-component split
            const comps = [...d.catalogue.components].sort((a, b) => a.sortOrder - b.sortOrder);
            const shares = splitWithRemainder(d.net, comps.map((k) => toDec(k.allocationPercentage)));
            for (const [ci, k] of comps.entries()) {
              const assigned = d.c.packageComponents?.find((pc) => pc.serviceId === k.serviceId);
              const staff = assigned ? requireStaff(assigned.staffId, k.service.name) : d.staff;
              await tx.invoiceLineComponent.create({
                data: {
                  lineId: line.id, sortOrder: ci, serviceId: k.serviceId, serviceCode: k.service.code, serviceName: k.service.name,
                  quantity: k.quantity, staffId: staff.id, staffName: staff.name, allocationPercentage: k.allocationPercentage,
                  allocatedAmount: shares[ci], staffCommissionRate: commissionRate(staff),
                },
              });
            }
          }
        }
      }
      if (d.c.type === 'PRODUCT') {
        const movements = await consumeStock(tx, {
          itemId: d.catalogue.id, branchId, branchCode: branch.code, quantity: d.c.quantity, businessDate: today,
          movementType: 'POS_SALE_OUT', source: { type: 'INVOICE', id: invoice.id, number: invoiceNumber }, reason: 'POS Retail Product Sale', actor,
        });
        let cogs = toDec(0);
        for (const m of movements) {
          const batch = await tx.inventoryBatch.findUnique({ where: { id: m.batchId } });
          await tx.invoiceLineBatch.create({ data: { lineId: line.id, batchId: m.batchId, batchNumber: batch.batchNumber, qty: m.quantity, unitCost: m.unitCost } });
          cogs = cogs.plus(m.totalCost);
        }
        await tx.invoiceLine.update({
          where: { id: line.id },
          data: { cogsAmount: round2(cogs), unitCostSnapshot: cogs.dividedBy(d.c.quantity).toDecimalPlaces(4) },
        });
      }
    }

    // ── Payments, money movements and tip receipts ──
    for (const { p, amounts } of payments) {
      if (amounts.amount.isZero()) continue;
      const payment = await receivePayment(tx, actor, {
        invoice, branchId, p, amounts, kind: 'POS', date: dateOnly(today), time, notes: `POS receipt processed by ${actor.name}`,
      });
      if (amounts.tip.greaterThan(0)) {
        const isHouse = !drafts[0].staff || drafts[0].staff.id === 'house' || drafts[0].staff.id === 'unassigned';
        await tx.tipReceipt.create({
          data: {
            receiptNumber: await nextSequence(tx, branch.code, 'TR'), branchId, invoiceId: invoice.id, invoiceNumber, paymentId: payment.id,
            collectionDate: dateOnly(today), collectionTime: time, clientName, method: p.method,
            paymentAccountId: payment.paymentAccountId, paymentAccountName: payment.paymentAccountName, cashDrawerId: payment.drawerId,
            collectedByUserId: actor.id, collectedByName: actor.name, collectedAmount: amounts.tip,
            directStaffId: isHouse ? null : drafts[0].staff.id,
            directStaffName: isHouse ? 'House / Salon' : drafts[0].staff.name,
            unallocatedAmount: amounts.tip,
          },
        });
      }
    }

    // ── Collection-based Commission EARN ──
    const initialCollection = round2(billPaid.plus(advanceAdjusted));
    if (initialCollection.greaterThan(0)) {
      const freshInvoice = await loadInvoice(tx, invoice.id);
      const { commissionsToRecord } = allocatePaymentToInvoice({
        invoice: freshInvoice,
        paymentAmount: initialCollection,
        previousBillPaid: 0,
      });

      for (const comm of commissionsToRecord) {
        if (comm.staffId && comm.staffId !== 'house' && comm.staffId !== 'unassigned' && toDec(comm.amount).greaterThan(0)) {
          await tx.commissionEvent.create({
            data: {
              branchId,
              staffId: comm.staffId,
              invoiceId: invoice.id,
              invoiceNumber,
              lineId: comm.lineId,
              componentId: comm.componentId ?? null,
              type: 'EARN',
              attributedNet: comm.attributedNet,
              rate: comm.rate,
              amount: comm.amount,
              eventDate: dateOnly(today),
            },
          });
        }
      }
    }

    if (booking) {
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED', revision: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      await bookingHistory(tx, booking, actor, 'BOOKING_CONVERTED_TO_POS', null, { invoiceId: invoice.id, invoiceNumber, advanceAdjusted: advanceAdjusted.toNumber(), amountDue: amountDue.toNumber() });
    }
    // ── Appointment becomes BILLED (no second visit is counted) ──
    if (appointment) {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          billingStatus: 'BILLED', linkedInvoiceId: invoice.id, linkedInvoiceNumber: invoiceNumber, status: 'COMPLETED',
          updatedById: actor.id, updatedByName: actor.name,
        },
      });
    }

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'INVOICE_POSTED', entity: 'Invoice', entityId: invoice.id, branchId,
      after: { invoiceNumber, netSales: netSales.toNumber(), tax: tax.toNumber(), tip: tip.toNumber(), total: total.toNumber(), status },
    });
    return toInvoiceDTO(await loadInvoice(tx, invoice.id));
  });
};

// ═══ OUTSTANDING DUES COLLECTION ══════════════════════════════════════════════

export const collectPayment = async (input, actor, request) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot collect bill payments.');
  return paymentPosting(actor, request, async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;
    const invoice = await loadInvoice(tx, input.invoiceId);
    assertInvoiceAccess(actor, invoice);
    if (invoice.lifecycle === 'VOIDED') throw conflict('INVOICE_VOIDED', `Invoice '${invoice.invoiceNumber}' has been voided.`);
    if (invoice.status === 'PAID' || toDec(invoice.amountDue).lessThanOrEqualTo(0)) {
      throw conflict('INVOICE_PAID', `Invoice '${invoice.invoiceNumber}' is already fully paid.`);
    }
    if (!input.payments?.length) throw badRequest('NO_PAYMENT', 'No payment amount provided.');

    const payments = input.payments.map((p) => {
      const amounts = validatePaymentShape(p, { allowTip: false });
      if (!amounts.bill.equals(amounts.amount)) throw badRequest('BILL_ONLY', 'For bill collection, bill allocation must equal payment amount.');
      return { p, amounts };
    });
    const collected = round2(payments.reduce((s, x) => s.plus(x.amounts.bill), toDec(0)));
    if (collected.lessThanOrEqualTo(0)) throw badRequest('ZERO_COLLECTION', 'Payment collection amount must be greater than zero.');
    if (collected.greaterThan(invoice.amountDue)) {
      throw badRequest('OVER_COLLECTION', `Collected payment (${collected}) exceeds outstanding balance (${toDec(invoice.amountDue)}).`);
    }

    const today = input.paymentDate || await getBusinessDate(tx);
    const time = clockTime();
    const previousBalance = toDec(invoice.amountDue);
    const previousBillPaid = invoice.payments
      .filter((p) => !p.reversedAt)
      .reduce((s, p) => s.plus(p.billAmountAllocated), toDec(invoice.advanceAdjusted));
    const remaining = round2(previousBalance.minus(collected));
    for (const { p, amounts } of payments) {
      if (amounts.amount.isZero()) continue;
      const pay = await receivePayment(tx, actor, {
        invoice, branchId: invoice.branchId, p, amounts, kind: 'DUES_COLLECTION', date: dateOnly(today), time, previousBalance,
        notes: input.notes || `Outstanding collection received by ${actor.name}`,
      });
      await tx.invoicePayment.update({ where: { id: pay.id }, data: { remainingBalance: remaining } });
    }

    // ── Incremental Commission Earned on Dues Collection ──
    const { commissionsToRecord } = allocatePaymentToInvoice({
      invoice,
      paymentAmount: collected,
      previousBillPaid,
    });
    for (const comm of commissionsToRecord) {
      if (comm.staffId && comm.staffId !== 'house' && comm.staffId !== 'unassigned' && toDec(comm.amount).greaterThan(0)) {
        await tx.commissionEvent.create({
          data: {
            branchId: invoice.branchId,
            staffId: comm.staffId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            lineId: comm.lineId,
            componentId: comm.componentId ?? null,
            type: 'EARN',
            attributedNet: comm.attributedNet,
            rate: comm.rate,
            amount: comm.amount,
            eventDate: dateOnly(today),
          },
        });
      }
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: round2(toDec(invoice.amountPaid).plus(collected)), amountDue: remaining, status: remaining.isZero() ? 'PAID' : 'PARTIAL' },
    });
    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'DUES_COLLECTED', entity: 'Invoice', entityId: invoice.id, branchId: invoice.branchId,
      after: { invoiceNumber: invoice.invoiceNumber, collected: collected.toNumber(), remaining: remaining.toNumber() },
    });
    return toInvoiceDTO(await loadInvoice(tx, invoice.id));
  });
};

export const reverseCollection = (input, actor, request) => paymentPosting(actor, request, async (tx) => {
  await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;
  const invoice = await loadInvoice(tx, input.invoiceId);
  assertInvoiceAccess(actor, invoice);
  const payment = invoice.payments.find((p) => p.id === input.paymentId);
  if (!payment || payment.kind !== 'DUES_COLLECTION') throw badRequest('INVALID_COLLECTION', 'Only outstanding invoice collections can be reversed here.');
  if (payment.reversedAt) throw conflict('PAYMENT_REVERSED', 'Collection has already been reversed.');
  if (invoice.lifecycle !== 'ACTIVE' || await tx.invoiceRefund.count({ where: { invoiceId: invoice.id } }) > 0) throw conflict('INVOICE_CHANGED', 'Refunded or voided invoices cannot have collections reversed.');
  const date = dateOnly(input.reversalDate);
  if (date < payment.date) throw badRequest('REVERSAL_DATE', 'Reversal date cannot precede the collection date.');
  const common = { type: 'REVERSAL', direction: 'OUT', amount: payment.amount, sourceModule: 'POS', sourceId: payment.id, reference: invoice.invoiceNumber, description: input.reason, actor, transactionDate: date };
  if (payment.method === 'CASH') await postCashMovement(tx, { ...common, holderId: payment.drawerId });
  else await postAccountMovement(tx, { ...common, accountId: payment.paymentAccountId, branchId: invoice.branchId });
  const currentBillPaid = invoice.payments
    .filter((p) => !p.reversedAt)
    .reduce((s, p) => s.plus(p.billAmountAllocated), toDec(invoice.advanceAdjusted));
  const billPaidAfterReversal = Decimal.max(0, currentBillPaid.minus(payment.billAmountAllocated));

  // ── Reverse incremental commission earned on this payment ──
  const { commissionsToRecord } = allocatePaymentToInvoice({
    invoice,
    paymentAmount: payment.billAmountAllocated,
    previousBillPaid: billPaidAfterReversal,
  });
  for (const comm of commissionsToRecord) {
    if (comm.staffId && comm.staffId !== 'house' && comm.staffId !== 'unassigned' && toDec(comm.amount).greaterThan(0)) {
      await tx.commissionEvent.create({
        data: {
          branchId: invoice.branchId,
          staffId: comm.staffId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          lineId: comm.lineId,
          componentId: comm.componentId ?? null,
          type: 'REVERSAL',
          attributedNet: comm.attributedNet,
          rate: comm.rate,
          amount: comm.amount,
          eventDate: date,
        },
      });
    }
  }

  await tx.invoicePayment.update({ where: { id: payment.id }, data: { reversedAt: new Date(), reversedById: actor.id, reversedByName: actor.name, reversalReason: input.reason, reversalDate: date } });
  const paid = round2(toDec(invoice.amountPaid).minus(payment.billAmountAllocated));
  const due = round2(toDec(invoice.amountDue).plus(payment.billAmountAllocated));
  await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: paid, amountDue: due, status: due.isZero() ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : 'UNPAID' } });
  await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'COLLECTION_REVERSED', entity: 'InvoicePayment', entityId: payment.id, branchId: invoice.branchId, after: { reason: input.reason, amount: payment.amount.toString() } });
  return toInvoiceDTO(await loadInvoice(tx, invoice.id));
});
