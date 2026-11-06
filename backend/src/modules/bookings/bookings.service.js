import { randomUUID } from 'node:crypto';
import prisma from '../../config/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { auditLog } from '../../lib/audit.js';
import { dateOnly, getBusinessDate, toTimeString, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { paymentPosting } from '../../lib/paymentPosting.js';
import { parseTimeToMinutes as minutes, formatMinutesToTime as time } from '../../lib/calculations/attendanceCalculations.js';
import { findOrCreateClient } from '../clients/clients.service.js';
import { getActiveDrawer, postCashMovement, postAccountMovement } from '../cash/cash.service.js';
import { netPayments, priceBooking } from './bookings.pricing.js';
import { bookingInclude, toBookingDTO } from './bookings.mapper.js';
import { lockScheduleDay, validateBookingSchedule } from './bookings.scheduling.js';

const json = v => JSON.parse(JSON.stringify(v));
const admin = actor => { if (!['ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'STAFF'].includes(actor.role)) throw forbidden('FORBIDDEN', 'Booking access denied.'); };
const reader = actor => { if (!['ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'STAFF'].includes(actor.role)) throw forbidden('FORBIDDEN', 'Booking access denied.'); };
export const loadBooking = async (tx, actor, id, { lock = false, editable = false } = {}) => {
  reader(actor);
  if (lock) await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${id} FOR UPDATE`;
  const b = await tx.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found.');
  assertBranchAccess(actor, b.branchId);
  if (editable && (b.invoice || ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(b.status))) throw conflict('BOOKING_CLOSED', 'This booking is closed or already invoiced.');
  return b;
};
export const bookingHistory = async (tx, b, actor, type, before, after, reason) => {
  await tx.bookingHistory.create({ data: { bookingId: b.id, type, before: before ? json(before) : undefined, after: after ? json(after) : undefined, reason, userId: actor.id, userName: actor.name } });
  await auditLog(tx, { userId: actor.id, userName: actor.name, action: type, entity: 'Booking', entityId: b.id, branchId: b.branchId, before: before ? json(before) : undefined, after: after ? json(after) : undefined });
};
const assertRevision = (b, revision) => { if (b.revision !== revision) throw conflict('BOOKING_OUTDATED', 'Booking changed. Refresh before continuing.'); };

export const buildBookingItems = async (tx, branch, input, previous = []) => {
  const staffRows = await tx.staff.findMany({ where: { branchId: branch.id } });
  const staff = id => {
    if (!id || ['house', 'unassigned'].includes(id)) return null;
    const s = staffRows.find(s => s.id === id && s.isActive);
    if (!s) throw badRequest('STAFF_INVALID', 'Assigned staff is inactive or belongs to another branch.');
    return s;
  };
  const lead = staff(input.assignedStaffId);
  let pointer = minutes(input.serviceTime);
  const start = pointer;
  const items = [];
  const rules = await tx.taxRule.findMany({ where: { isActive: true, OR: [{ branchId: branch.id }, { branches: { some: { id: branch.id } } }] } });
  for (const [index, raw] of input.items.entries()) {
    const old = previous.find(i => i.lineInstanceId === raw.lineInstanceId && i.type === raw.type && i.itemId === (raw.itemId || null));
    let catalog = null;
    if (!old && raw.type !== 'CUSTOM_SERVICE') {
      catalog = raw.type === 'SERVICE'
        ? await tx.service.findFirst({ where: { id: raw.itemId, branchId: branch.id, isActive: true } })
        : await tx.package.findFirst({ where: { id: raw.itemId, branchId: branch.id, isActive: true }, include: { components: { include: { service: true }, orderBy: { sortOrder: 'asc' } } } });
      if (!catalog) throw badRequest('ITEM_INVALID', 'Select an active service/package from this branch.');
    }
    const assigned = raw.staffId === null ? null : staff(raw.staffId ?? lead?.id);
    const components = [];
    const lineStart = pointer;
    if (raw.type === 'PACKAGE') {
      const definitions = old ? old.components : catalog.components.map(c => ({ serviceId: c.serviceId, serviceCode: c.service.code, serviceName: c.service.name, durationMinutes: c.service.durationMinutes || 30, allocationPercentage: Number(c.allocationPercentage), isActive: c.service.isActive }));
      if (!definitions.length || definitions.some(c => c.isActive === false)) throw badRequest('PACKAGE_INVALID', 'Package has no services or contains inactive services.');
      const weight = definitions.reduce((s, c) => s.plus(c.allocationPercentage), toDec(0));
      if (!weight.equals(100)) throw badRequest('PACKAGE_ALLOCATION', 'Package component allocations must total 100%.');
      for (const c of definitions) {
        const override = raw.packageComponents?.find(p => p.serviceId === c.serviceId);
        const cs = override ? staff(override.staffId) : staff(old ? c.staffId : assigned?.id);
        const length = c.durationMinutes * raw.quantity;
        components.push({ serviceId: c.serviceId, serviceCode: c.serviceCode, serviceName: c.serviceName, durationMinutes: c.durationMinutes, allocationPercentage: Number(c.allocationPercentage), staffId: cs?.id || null, staffName: cs?.name || null, startTime: time(pointer), endTime: time(pointer + length) });
        pointer += length;
      }
    } else pointer += (raw.durationMinutes ?? old?.durationMinutes ?? catalog?.durationMinutes ?? 60) * raw.quantity;
    if (pointer > 1440) throw badRequest('BOOKING_TIME_RANGE', 'Services must finish within the selected event day.');
    const treatment = old?.taxTreatment ?? catalog?.taxTreatment ?? 'BRANCH_DEFAULT';
    let taxRate = old ? toDec(old.taxRate) : treatment === 'EXEMPT' ? toDec(0) : toDec(branch.taxEnabled ? branch.taxRate : 0);
    if (!old && treatment === 'SPECIFIC_RULE') {
      const rule = rules.find(r => r.id === catalog.specificTaxRuleId);
      if (!rule) throw badRequest('TAX_RULE_INVALID', 'Selected service tax rule is unavailable.');
      taxRate = toDec(rule.rate);
    }
    items.push({ lineInstanceId: raw.lineInstanceId || randomUUID(), sortOrder: index, type: raw.type, itemId: raw.type === 'CUSTOM_SERVICE' ? null : raw.itemId,
      code: old?.code ?? catalog?.code ?? null, name: raw.type === 'CUSTOM_SERVICE' ? raw.name : old?.name ?? catalog.name,
      description: raw.description ?? old?.description ?? null, quantity: raw.quantity,
      durationMinutes: raw.type === 'PACKAGE' ? (pointer - lineStart) / raw.quantity : raw.durationMinutes ?? old?.durationMinutes ?? catalog?.durationMinutes ?? 60,
      unitPrice: round2(raw.unitPrice ?? old?.unitPrice ?? catalog?.price ?? 0), taxTreatment: treatment, taxRate,
      staffId: assigned?.id || null, staffName: assigned?.name || null, startTime: time(lineStart), endTime: time(pointer), components });
  }
  if (new Set(items.map(i => i.lineInstanceId)).size !== items.length) throw badRequest('DUPLICATE_LINE', 'Each booking line must have a unique identifier.');
  await lockScheduleDay(tx, branch.id, input.eventDate);
  await validateBookingSchedule(tx, branch.id, input.eventDate, items, staffRows, input.excludeBookingId);
  return { items, durationMinutes: pointer - start, endTime: time(pointer), assignedStaffId: lead?.id || null, assignedStaffName: lead?.name || null };
};

const createItems = items => items.map(i => ({ ...i, components: json(i.components) }));
const branchForWrite = async (tx, branchId) => {
  const b = await tx.branch.findUnique({ where: { id: branchId } });
  if (!b?.isActive) throw badRequest('BRANCH_INACTIVE', 'Select an active branch.');
  return b;
};
export const createBooking = (input, actor, request) => {
  admin(actor);
  const branchId = resolveWriteBranch(actor, input.branchId);
  return paymentPosting(actor, request, async tx => {
    const branch = await branchForWrite(tx, branchId);
    const plan = await buildBookingItems(tx, branch, input);
    const client = await findOrCreateClient(tx, { branchId, clientId: input.clientId, name: input.clientName, phone: input.clientPhone });
    const b = await tx.booking.create({ data: { bookingNumber: await nextSequence(tx, branch.code, 'BKG'), branchId, clientId: client.id, clientName: client.name, clientPhone: client.phone,
      type: input.type, eventDate: dateOnly(input.eventDate), serviceTime: time(minutes(input.serviceTime)), endTime: plan.endTime, durationMinutes: plan.durationMinutes,
      assignedStaffId: plan.assignedStaffId, assignedStaffName: plan.assignedStaffName, notes: input.notes, specialRequirements: input.specialRequirements,
      ...priceBooking(plan.items, input.discountType, input.discountValue), createdById: actor.id, createdByName: actor.name, items: { create: createItems(plan.items) } }, include: bookingInclude });
    await bookingHistory(tx, b, actor, 'BOOKING_CREATED', null, { totalAmount: Number(b.totalAmount), date: await getBusinessDate(tx), items: plan.items });
    if (input.advancePayment) await recordPaymentInTx(tx, b, input.advancePayment, actor);
    return toBookingDTO(await loadBooking(tx, actor, b.id));
  });
};
export const reviseBooking = async (tx, b, input, actor) => {
  assertRevision(b, input.revision);
  if (input.branchId && input.branchId !== b.branchId) throw badRequest('BOOKING_BRANCH', 'A booking cannot move between branches.');
  if (input.clientId && input.clientId !== b.clientId) throw badRequest('BOOKING_CLIENT', 'A saved booking cannot be transferred to another client.');
  const branch = await branchForWrite(tx, b.branchId);
  const plan = await buildBookingItems(tx, branch, { ...input, excludeBookingId: b.id }, b.items);
  const prices = priceBooking(plan.items, input.discountType, input.discountValue);
  if (prices.totalAmount.lessThan(netPayments(b.payments))) throw conflict('REFUND_EXCESS_FIRST', 'Refund excess advance before reducing the booking below the amount received.');
  await tx.bookingItem.deleteMany({ where: { bookingId: b.id } });
  await tx.booking.update({ where: { id: b.id }, data: { type: input.type, eventDate: dateOnly(input.eventDate), serviceTime: time(minutes(input.serviceTime)),
    endTime: plan.endTime, durationMinutes: plan.durationMinutes, assignedStaffId: plan.assignedStaffId, assignedStaffName: plan.assignedStaffName,
    notes: input.notes, specialRequirements: input.specialRequirements, ...prices, revision: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name,
    items: { create: createItems(plan.items) } } });
  await bookingHistory(tx, b, actor, 'BOOKING_REVISED', { totalAmount: Number(b.totalAmount), eventDate: ymd(b.eventDate), serviceTime: b.serviceTime, items: b.items }, { totalAmount: Number(prices.totalAmount), date: await getBusinessDate(tx), eventDate: input.eventDate, serviceTime: input.serviceTime, items: plan.items }, input.reason);
  return loadBooking(tx, actor, b.id);
};
export const updateBooking = (id, input, actor) => { admin(actor); return prisma.$transaction(async tx => toBookingDTO(await reviseBooking(tx, await loadBooking(tx, actor, id, { lock: true, editable: true }), input, actor))); };
export const getBooking = async (actor, id) => toBookingDTO(await loadBooking(prisma, actor, id));
export const listBookings = async (actor, q = {}) => {
  reader(actor);
  const branchId = resolveReadBranch(actor, q.branchId);
  const rows = await prisma.booking.findMany({ where: { ...(branchId ? { branchId } : {}), ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}),
    ...(q.startDate || q.endDate ? { eventDate: { ...(q.startDate ? { gte: dateOnly(q.startDate) } : {}), ...(q.endDate ? { lte: dateOnly(q.endDate) } : {}) } } : {}),
    ...(q.search ? { OR: [{ clientName: { contains: q.search, mode: 'insensitive' } }, { clientPhone: { contains: q.search } }, { bookingNumber: { contains: q.search, mode: 'insensitive' } }] } : {}) }, include: bookingInclude, orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(toBookingDTO).filter(b => !q.paymentStatus || b.paymentStatus === q.paymentStatus);
};

export const recordPaymentInTx = async (tx, b, input, actor, isRefund = false) => {
  await branchForWrite(tx, b.branchId);
  const amount = round2(input.amount), net = netPayments(b.payments);
  const remaining = round2(toDec(b.totalAmount).minus(net));
  if (amount.lessThanOrEqualTo(0) || amount.greaterThan(isRefund ? net : remaining)) throw badRequest('INVALID_AMOUNT', isRefund ? 'Refund cannot exceed the held advance.' : 'Payment cannot exceed the remaining booking balance.');
  const businessDate = await getBusinessDate(tx);
  const date = input.date || businessDate;
  const reservationDate = b.history?.find(h => h.type === 'BOOKING_CREATED')?.after?.date || businessDate;
  if (date > businessDate || date < reservationDate) throw badRequest('INVALID_PAYMENT_DATE', 'Payment date must be between booking creation and the current business date.');
  const receiptNumber = await nextSequence(tx, '', 'BPR');
  const paymentId = randomUUID();
  const common = { type: isRefund ? 'BOOKING_REFUND' : 'BOOKING_ADVANCE', direction: isRefund ? 'OUT' : 'IN', amount, sourceModule: 'BOOKING', sourceId: paymentId, reference: receiptNumber, description: `${isRefund ? 'Refund' : 'Advance'} for ${b.bookingNumber}`, actor, transactionDate: dateOnly(date) };
  let movement, drawerId = null, paymentAccountName = null;
  if (input.method === 'CASH') {
    const drawer = await getActiveDrawer(tx, actor, b.branchId, { autoOpen: !isRefund });
    drawerId = drawer.id;
    movement = await postCashMovement(tx, { ...common, holderId: drawerId });
  } else {
    const posted = await postAccountMovement(tx, { ...common, accountId: input.paymentAccountId, branchId: b.branchId });
    movement = posted.movement; paymentAccountName = posted.account.name;
  }
  const p = await tx.bookingPayment.create({ data: { id: paymentId, receiptNumber, bookingId: b.id, branchId: b.branchId, isRefund, amount, date: dateOnly(date), time: toTimeString(), method: input.method,
    paymentAccountId: input.method === 'ONLINE_ACCOUNT' ? input.paymentAccountId : null, paymentAccountName, drawerId, movementId: movement.id,
    reference: input.reference, notes: input.notes, processedByUserId: actor.id, processedByName: actor.name } });
  await tx.booking.update({ where: { id: b.id }, data: { revision: { increment: 1 } } });
  await bookingHistory(tx, b, actor, isRefund ? 'BOOKING_REFUNDED' : 'BOOKING_ADVANCE_COLLECTED', null, { receiptNumber, amount: amount.toNumber(), date, method: input.method });
  return p;
};
export const recordPayment = (id, input, actor, request) => { reader(actor); return paymentPosting(actor, request, async tx => {
  const b = await loadBooking(tx, actor, id, { lock: true, editable: true });
  await recordPaymentInTx(tx, b, input, actor);
  return toBookingDTO(await loadBooking(tx, actor, id));
}); };
export const refundPayment = (id, input, actor, request) => { admin(actor); return paymentPosting(actor, request, async tx => {
  const b = await loadBooking(tx, actor, id, { lock: true, editable: true });
  await recordPaymentInTx(tx, b, { ...input.payment, notes: input.reason }, actor, true);
  return toBookingDTO(await loadBooking(tx, actor, id));
}); };
export const cancelBooking = (id, input, actor, request) => { admin(actor); return paymentPosting(actor, request, async tx => {
  const b = await loadBooking(tx, actor, id, { lock: true, editable: true }); assertRevision(b, input.revision);
  const net = netPayments(b.payments), fee = round2(input.cancellationCharge), refund = round2(input.refundPayment?.amount || 0);
  if (!fee.plus(refund).equals(net)) throw badRequest('CANCELLATION_ALLOCATION', 'Refund plus retained cancellation charge must equal the held advance.');
  if (refund.greaterThan(0)) await recordPaymentInTx(tx, b, { ...input.refundPayment, notes: input.reason }, actor, true);
  await tx.booking.update({ where: { id }, data: { status: input.status, cancellationCharge: fee, cancellationReason: input.reason, revision: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
  await bookingHistory(tx, b, actor, 'BOOKING_CANCELLED', { totalAmount: Number(b.totalAmount) }, { totalAmount: fee.toNumber(), date: await getBusinessDate(tx), refund: refund.toNumber(), status: input.status }, input.reason);
  return toBookingDTO(await loadBooking(tx, actor, id));
}); };
export const updateStatus = (id, input, actor) => { admin(actor); return prisma.$transaction(async tx => {
  const b = await loadBooking(tx, actor, id, { lock: true, editable: true }); assertRevision(b, input.revision);
  if (b.status !== 'CONFIRMED') throw conflict('INVALID_STATUS_TRANSITION', 'Only a confirmed booking may start service.');
  await tx.booking.update({ where: { id }, data: { status: 'IN_PROGRESS', revision: { increment: 1 } } });
  await bookingHistory(tx, b, actor, 'BOOKING_IN_PROGRESS', null, { status: 'IN_PROGRESS' });
  return toBookingDTO(await loadBooking(tx, actor, id));
}); };
export const getLedger = async (actor, id) => {
  const b = await loadBooking(prisma, actor, id);
  const stamp = (date, clock) => {
    const value = minutes(clock || '00:00');
    return new Date(`${ymd(date instanceof Date ? date : dateOnly(date))}T${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}:00+05:00`);
  };
  const events = b.history.filter(h => ['BOOKING_CREATED', 'BOOKING_REVISED', 'BOOKING_CANCELLED'].includes(h.type));
  const rows = events.map(h => ({ id: h.id, date: h.after?.date ? stamp(h.after.date, toTimeString(h.createdAt)) : h.createdAt, reference: b.bookingNumber, description: h.type, debit: round2(toDec(h.after?.totalAmount).minus(h.before?.totalAmount || 0)).toNumber(), credit: 0, byName: h.userName, notes: h.reason }));
  rows.push(...b.payments.map(p => ({ id: p.id, date: new Date(`${ymd(p.date)}T${p.time}:00+05:00`), reference: p.receiptNumber, description: p.isRefund ? 'Refund' : 'Installment', debit: p.isRefund ? Number(p.amount) : 0, credit: p.isRefund ? 0 : Number(p.amount), byName: p.processedByName, notes: p.notes })));
  if (b.invoice) {
    const inv = b.invoice;
    rows.push({ id: `transfer-${inv.id}`, date: stamp(inv.date, inv.time), reference: inv.invoiceNumber, description: 'Booking transferred to final invoice (including POS additions)', debit: round2(toDec(inv.total).minus(inv.tip).minus(b.totalAmount)).toNumber(), credit: 0, byName: inv.processedByName });
    for (const p of inv.payments) {
      rows.push({ id: p.id, date: stamp(p.date, p.time), reference: p.receiptNumber, description: p.kind === 'DUES_COLLECTION' ? 'Invoice dues collection' : 'Final checkout collection', debit: 0, credit: Number(p.billAmountAllocated), byName: p.processedByName });
      if (p.reversedAt) rows.push({ id: `reversal-${p.id}`, date: p.reversalDate ? stamp(p.reversalDate, toTimeString(p.reversedAt)) : p.reversedAt, reference: p.receiptNumber, description: 'Invoice collection reversed', debit: Number(p.billAmountAllocated), credit: 0, byName: p.reversedByName });
    }
    for (const r of inv.refunds) rows.push({ id: r.id, date: stamp(r.refundDate, toTimeString(r.createdAt)), reference: r.refundNumber, description: 'Invoice refund / void adjustment', debit: Number(r.cashOut) - Number(r.tipReversed), credit: Number(r.netReversed) + Number(r.taxReversed), byName: r.byName, notes: r.reason });
  }
  rows.sort((a, c) => new Date(a.date) - new Date(c.date));
  let balance = toDec(0);
  return { booking: toBookingDTO(b), rows: rows.map(r => { balance = balance.plus(r.debit).minus(r.credit); return { ...r, balance: round2(balance).toNumber() }; }), invoiceReference: b.invoice?.invoiceNumber };
};
export const getHandoff = async (actor, id) => toBookingDTO(await loadBooking(prisma, actor, id, { editable: true }));

export const getCollections = async (actor, q = {}) => {
  reader(actor);
  const branchId = resolveReadBranch(actor, q.branchId);
  const rows = await prisma.bookingPayment.findMany({ where: {
    ...(branchId ? { branchId } : {}),
    ...(q.startDate || q.endDate ? { date: { ...(q.startDate ? { gte: dateOnly(q.startDate) } : {}), ...(q.endDate ? { lte: dateOnly(q.endDate) } : {}) } } : {}),
    booking: { ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}), ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.search ? { OR: [{ clientName: { contains: q.search, mode: 'insensitive' } }, { bookingNumber: { contains: q.search, mode: 'insensitive' } }, { clientPhone: { contains: q.search } }] } : {}) },
  }, include: { booking: { select: { bookingNumber: true, type: true, clientName: true, clientPhone: true } } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(p => ({ ...p, date: ymd(p.date), amount: Number(p.amount), ...p.booking, booking: undefined }));
};
