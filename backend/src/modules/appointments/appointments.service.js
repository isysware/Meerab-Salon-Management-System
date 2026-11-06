// src/modules/appointments/appointments.service.js
// Booking calendar: sequential slot scheduling, staff conflict/leave/shift checks, status flow,
// reschedule audit trail and the POS hand-off queue. Rules mirror the frontend mock.

import crypto from 'crypto';
import { assertBookingConflicts } from '../bookings/bookings.scheduling.js';
import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly } from '../../lib/dates.js';
import { add, round2, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { formatPhoneNumber, normalizePhoneDigits } from '../../lib/phone.js';
import { parseTimeToMinutes, formatMinutesToTime } from '../../lib/calculations/attendanceCalculations.js';
import { findOrCreateClient } from '../clients/clients.service.js';
import { toAppointmentDTO } from './appointments.mapper.js';

export const include = {
  items:       { include: { components: true } },
  reschedules: true,
};

const DAY = 24 * 60;
const INACTIVE_STATUSES = ['CANCELLED', 'NO_SHOW'];

// Allowed manual status transitions (billing flips BILLED via the POS, not here).
const TRANSITIONS = {
  PENDING:    ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED:  ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_SERVICE', 'COMPLETED', 'CANCELLED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED'],
  COMPLETED:  [],
  CANCELLED:  [],
  NO_SHOW:    [],
};

const newId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 13)}`;

const branchNames = async (tx, ids) => {
  const rows = await tx.branch.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
};

export const toDTOs = async (appointments, tx = prisma) => {
  const names = await branchNames(tx, appointments.map((a) => a.branchId));
  return appointments.map((a) => toAppointmentDTO(a, names.get(a.branchId)));
};

const loadOrThrow = async (tx, id) => {
  const apt = await tx.appointment.findUnique({ where: { id }, include });
  if (!apt) throw notFound('APPOINTMENT_NOT_FOUND', `Appointment '${id}' not found.`);
  return apt;
};

const assertBookingRole = (actor) => {
  if (!['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(actor.role)) {
    throw forbidden('FORBIDDEN', 'Access Denied: You do not have permission to manage appointments.');
  }
};

/** Serialise bookings per branch+date so two concurrent requests cannot double-book a stylist. */
const lockBranchDay = (tx, branchId, date) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`apt:${branchId}:${date}`}::text))`;

/**
 * Builds the sequential schedule for the requested items and validates staff availability.
 * Every item/component runs back-to-back from `startTime`. Package price is the package's
 * own selling price — assigning more staff never multiplies it.
 */
const scheduleItems = async (tx, { branchId, date, startTime, rawItems, excludeAppointmentId }) => {
  if (!rawItems?.length) throw badRequest('NO_ITEMS', 'At least one service or package must be selected.');

  const serviceIds = rawItems.filter((i) => i.type === 'SERVICE').map((i) => i.itemId);
  const packageIds = rawItems.filter((i) => i.type === 'PACKAGE').map((i) => i.itemId);
  const [services, packages, staff] = await Promise.all([
    tx.service.findMany({ where: { id: { in: serviceIds }, branchId } }),
    tx.package.findMany({ where: { id: { in: packageIds }, branchId }, include: { components: { include: { service: true } } } }),
    tx.staff.findMany({ where: { branchId } }),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const requireStaff = (staffId, label) => {
    const s = staffId && staffById.get(staffId);
    if (!s || !s.isActive) throw badRequest('STAFF_INVALID', `Assigned staff member for ${label} is inactive or invalid.`);
    return s;
  };

  const startMinutes = parseTimeToMinutes(startTime);
  let pointer = startMinutes;
  let totalPrice = toDec(0);
  const items = [];
  const intervals = [];

  for (const [index, raw] of rawItems.entries()) {
    const lineInstanceId = raw.lineInstanceId || newId('line');

    if (raw.type === 'SERVICE') {
      const srv = services.find((s) => s.id === raw.itemId);
      if (!srv || !srv.isActive) throw badRequest('SERVICE_INVALID', `Service '${raw.itemId}' is inactive or not found in branch catalogue.`);
      if (!raw.staffId) throw badRequest('STAFF_REQUIRED', `Staff member must be assigned for service '${srv.name}'.`);
      const st = requireStaff(raw.staffId, `service '${srv.name}'`);

      const start = pointer;
      const end = start + (srv.durationMinutes || 30);
      pointer = end;
      totalPrice = add(totalPrice, srv.price);
      items.push({
        lineInstanceId, sortOrder: index, type: 'SERVICE', itemId: srv.id, code: srv.code, name: srv.name,
        durationMinutes: end - start, unitPrice: srv.price, staffId: st.id, staffName: st.name,
        startTime: formatMinutesToTime(start), endTime: formatMinutesToTime(end), components: [],
      });
      intervals.push({ staff: st, start, end });
    } else {
      const pkg = packages.find((p) => p.id === raw.itemId);
      if (!pkg || !pkg.isActive) throw badRequest('PACKAGE_INVALID', `Package '${raw.itemId}' is inactive or not found in branch catalogue.`);
      if (!pkg.components.length) throw badRequest('PACKAGE_EMPTY', `Package '${pkg.name}' has no configured components.`);

      const pkgStart = pointer;
      const components = [];
      for (const [cIdx, def] of [...pkg.components].sort((a, b) => a.sortOrder - b.sortOrder).entries()) {
        const assignment = raw.packageComponents?.find((c) => c.serviceId === def.serviceId);
        const assignedStaffId = assignment?.staffId || (raw.assignedStaff && raw.assignedStaff[cIdx % raw.assignedStaff.length]?.staffId) || raw.staffId;
        if (!assignedStaffId) {
          throw badRequest('STAFF_REQUIRED', `Staff assignment is required for component '${def.service.name}' in package '${pkg.name}'.`);
        }
        const st = requireStaff(assignedStaffId, `component '${def.service.name}'`);
        const start = pointer;
        const end = start + (def.service.durationMinutes || 30);
        pointer = end;
        components.push({
          componentInstanceId: assignment?.componentInstanceId || newId('comp'), sortOrder: cIdx,
          serviceId: def.serviceId, serviceCode: def.service.code, serviceName: def.service.name,
          durationMinutes: end - start, allocationPercentage: def.allocationPercentage,
          staffId: st.id, staffName: st.name, startTime: formatMinutesToTime(start), endTime: formatMinutesToTime(end),
        });
        intervals.push({ staff: st, start, end });
      }
      totalPrice = add(totalPrice, pkg.price);
      const packageStaffName = raw.assignedStaff && raw.assignedStaff.length > 0
        ? raw.assignedStaff.map((s) => s.staffName || s.name).filter(Boolean).join(', ')
        : components[0].staffName;
      items.push({
        lineInstanceId, sortOrder: index, type: 'PACKAGE', itemId: pkg.id, code: pkg.code, name: pkg.name,
        durationMinutes: pointer - pkgStart, unitPrice: pkg.price,
        staffId: components[0].staffId, staffName: packageStaffName,
        startTime: formatMinutesToTime(pkgStart), endTime: formatMinutesToTime(pointer), components,
      });
    }
  }

  // Leave and working-shift checks per staff interval.
  const staffIds = [...new Set(intervals.map((i) => i.staff.id))];
  const leaves = await tx.leaveRecord.findMany({
    where: { staffId: { in: staffIds }, status: 'APPROVED', startDate: { lte: dateOnly(date) }, endDate: { gte: dateOnly(date) } },
    select: { staffId: true },
  });
  for (const { staff: st, start, end } of intervals) {
    if (leaves.some((l) => l.staffId === st.id)) {
      throw conflict('STAFF_ON_LEAVE', `Staff member '${st.name}' is on approved leave on ${date}. Cannot schedule booking.`);
    }
    const shiftStart = parseTimeToMinutes(st.startTime);
    const shiftEnd = parseTimeToMinutes(st.endTime);
    const overnight = st.isOvernightShift || shiftEnd < shiftStart;
    const startMod = start % DAY;
    const endMod = end % DAY;
    const outside = !overnight
      ? startMod < shiftStart || (end > shiftEnd && end <= DAY)
      : !(startMod >= shiftStart || startMod <= shiftEnd) && !(endMod >= shiftStart || endMod <= shiftEnd || end >= DAY);
    if (outside) {
      throw badRequest(
        'OUTSIDE_SHIFT',
        `Scheduled time (${formatMinutesToTime(start)} - ${formatMinutesToTime(end)}) is outside ${st.name}'s ${overnight ? 'overnight ' : ''}working shift (${st.startTime} - ${st.endTime}).`
      );
    }
  }

  // Overlap check against other active bookings for the same day (adjacent slots are fine).
  const others = await tx.appointment.findMany({
    where: {
      branchId, date: dateOnly(date), status: { notIn: INACTIVE_STATUSES },
      ...(excludeAppointmentId ? { NOT: { id: excludeAppointmentId } } : {}),
    },
    include: { items: { include: { components: true } } },
  });
  for (const apt of others) {
    const busy = apt.items.flatMap((it) =>
      it.type === 'PACKAGE'
        ? it.components.map((c) => ({ staffId: c.staffId, start: parseTimeToMinutes(c.startTime), end: parseTimeToMinutes(c.endTime) }))
        : [{ staffId: it.staffId, start: parseTimeToMinutes(it.startTime), end: parseTimeToMinutes(it.endTime) }]
    );
    for (const mine of intervals) {
      for (const b of busy) {
        if (mine.staff.id === b.staffId && mine.start < b.end && mine.end > b.start) {
          throw conflict(
            'STAFF_SLOT_CONFLICT',
            `Scheduling Conflict: ${mine.staff.name} is already booked from ${formatMinutesToTime(b.start)} to ${formatMinutesToTime(b.end)} on ${date} (Appointment: ${apt.appointmentNumber}). Adjacent bookings are allowed, but time slots cannot overlap.`
          );
        }
      }
    }
  }

  await assertBookingConflicts(tx, branchId, date, intervals.map(i => ({ staffId: i.staff.id, start: i.start, end: i.end })));
  return {
    items,
    durationMinutes: pointer - startMinutes,
    endTime: formatMinutesToTime(pointer),
    price: round2(totalPrice),
  };
};

const itemCreateData = (items) =>
  items.map(({ components, ...it }) => ({
    ...it,
    ...(components.length ? { components: { create: components } } : {}),
  }));

const toRawItems = (apt) =>
  [...apt.items].sort((a, b) => a.sortOrder - b.sortOrder).map((it) => ({
    lineInstanceId: it.lineInstanceId,
    type:           it.type,
    itemId:         it.itemId,
    staffId:        it.staffId,
    packageComponents: it.components.map((c) => ({ componentInstanceId: c.componentInstanceId, serviceId: c.serviceId, staffId: c.staffId })),
  }));

const assertNotBilled = (apt, verb) => {
  if (apt.billingStatus === 'BILLED') {
    throw conflict('APPOINTMENT_BILLED', `Cannot ${verb} an appointment that has already been billed under invoice ${apt.linkedInvoiceNumber || 'N/A'}.`);
  }
};

// ── Queries ──────────────────────────────────────────────────────────────────

export const listAppointments = async (actor, q = {}) => {
  const b = resolveReadBranch(actor, q.branchId);
  const dateFilter = {};
  if (q.date) dateFilter.equals = dateOnly(q.date);
  if (q.startDate) dateFilter.gte = dateOnly(q.startDate);
  if (q.endDate) dateFilter.lte = dateOnly(q.endDate);

  const digits = q.search?.replace(/\D/g, '');
  const where = {
    ...(b ? { branchId: b } : {}),
    ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.clientId ? { clientId: q.clientId } : {}),
    ...(q.staffId ? {
      items: { some: { OR: [{ staffId: q.staffId }, { components: { some: { staffId: q.staffId } } }] } },
    } : {}),
    ...(q.search ? {
      OR: [
        { clientName: { contains: q.search, mode: 'insensitive' } },
        { appointmentNumber: { contains: q.search, mode: 'insensitive' } },
        ...(digits ? [{ clientPhone: { contains: digits } }] : []),
      ],
    } : {}),
  };

  const list = await prisma.appointment.findMany({ where, include, orderBy: [{ date: 'asc' }] });
  list.sort((x, y) => x.date - y.date || parseTimeToMinutes(x.startTime) - parseTimeToMinutes(y.startTime));
  return toDTOs(list);
};

export const getAppointment = async (actor, id) => {
  const apt = await prisma.appointment.findUnique({ where: { id }, include });
  if (!apt) return null;
  assertBranchAccess(actor, apt.branchId, 'Access Denied: Cannot view appointments from another branch.');
  return (await toDTOs([apt]))[0];
};

/** POS queue: unbilled, active appointments of the day (oldest slot first). */
export const getQueue = async (actor, { branchId, date }) => {
  const b = resolveReadBranch(actor, branchId);
  if (!b) throw badRequest('BRANCH_REQUIRED', 'Please select a specific branch to load the POS queue.');
  const list = await prisma.appointment.findMany({
    where: {
      branchId: b, date: dateOnly(date), billingStatus: 'UNBILLED', linkedInvoiceId: null,
      status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED'] },
    },
    include,
  });
  list.sort((x, y) => parseTimeToMinutes(x.startTime) - parseTimeToMinutes(y.startTime));
  return toDTOs(list);
};

// ── Commands ─────────────────────────────────────────────────────────────────

export const createAppointment = async (input, actor) => {
  assertBookingRole(actor);
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot book appointments for another branch.');
  const norm = normalizePhoneDigits(input.clientPhone);
  if (!norm || norm.length < 10) {
    throw badRequest('INVALID_PHONE', 'Valid customer phone number (at least 10 digits) is required for appointment booking.');
  }

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch || !branch.isActive) throw badRequest('BRANCH_INACTIVE', `Branch '${branchId}' is invalid or deactivated.`);

    await lockBranchDay(tx, branchId, input.date);
    const plan = await scheduleItems(tx, { branchId, date: input.date, startTime: input.startTime, rawItems: input.items });

    const client = await findOrCreateClient(tx, {
      branchId, clientId: input.clientId, name: input.clientName, phone: input.clientPhone,
      email: input.clientEmail, source: input.customerSource, sourceDetails: input.customerSourceDetails,
    });

    const status = input.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING';
    const now = new Date();
    const apt = await tx.appointment.create({
      data: {
        appointmentNumber:     await nextSequence(tx, branch.code, 'APT', Number(input.date.slice(0, 4))),
        branchId,
        clientId:              client.id,
        clientName:            client.name,
        clientPhone:           client.phone,
        clientEmail:           client.email || input.clientEmail || null,
        customerSource:        client.source || input.customerSource || null,
        customerSourceDetails: client.sourceDetails || input.customerSourceDetails || null,
        date:                  dateOnly(input.date),
        startTime:             formatMinutesToTime(parseTimeToMinutes(input.startTime)),
        endTime:               plan.endTime,
        durationMinutes:       plan.durationMinutes,
        price:                 plan.price,
        status,
        notes:                 input.notes || null,
        createdById:           actor.id,
        createdByName:         actor.name,
        ...(status === 'CONFIRMED' ? { confirmedById: actor.id, confirmedByName: actor.name, confirmedAt: now } : {}),
        items:                 { create: itemCreateData(plan.items) },
      },
      include,
    });

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'APPOINTMENT_CREATED', entity: 'Appointment',
      entityId: apt.id, branchId, after: { appointmentNumber: apt.appointmentNumber, date: input.date, price: plan.price },
    });
    return toAppointmentDTO(apt, branch.name);
  });
};

export const updateAppointment = async (id, input, actor) => {
  assertBookingRole(actor);
  return prisma.$transaction(async (tx) => {
    const before = await loadOrThrow(tx, id);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot modify appointments from another branch.');
    assertNotBilled(before, 'modify');
    if (INACTIVE_STATUSES.includes(before.status)) {
      throw conflict('APPOINTMENT_CLOSED', `Cannot modify a ${before.status.toLowerCase().replace('_', '-')} appointment.`);
    }

    const date = input.date || before.date.toISOString().slice(0, 10);
    const startTime = input.startTime || before.startTime;
    await lockBranchDay(tx, before.branchId, date);
    const plan = await scheduleItems(tx, {
      branchId: before.branchId, date, startTime,
      rawItems: input.items?.length ? input.items : toRawItems(before),
      excludeAppointmentId: id,
    });

    const data = {
      date: dateOnly(date),
      startTime: formatMinutesToTime(parseTimeToMinutes(startTime)),
      endTime: plan.endTime,
      durationMinutes: plan.durationMinutes,
      price: plan.price,
      updatedById: actor.id,
      updatedByName: actor.name,
    };
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (input.clientName) data.clientName = input.clientName;
    if (input.clientPhone) data.clientPhone = formatPhoneNumber(input.clientPhone);
    if (input.clientEmail !== undefined) data.clientEmail = input.clientEmail || null;
    if (input.customerSource) data.customerSource = input.customerSource;
    if (input.customerSourceDetails !== undefined) data.customerSourceDetails = input.customerSourceDetails || null;

    await tx.appointmentItem.deleteMany({ where: { appointmentId: id } });
    const apt = await tx.appointment.update({
      where: { id }, data: { ...data, items: { create: itemCreateData(plan.items) } }, include,
    });

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'APPOINTMENT_UPDATED', entity: 'Appointment', entityId: id,
      branchId: apt.branchId, before: { date: before.date, startTime: before.startTime, price: before.price }, after: data,
    });
    return (await toDTOs([apt], tx))[0];
  });
};

export const updateStatus = async (id, { status, cancelReason }, actor) => {
  assertBookingRole(actor);
  return prisma.$transaction(async (tx) => {
    const before = await loadOrThrow(tx, id);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot modify appointments from another branch.');

    if (before.billingStatus === 'BILLED' && INACTIVE_STATUSES.includes(status)) {
      throw conflict('APPOINTMENT_BILLED', `Cannot cancel or mark no-show an appointment that has already been billed under invoice ${before.linkedInvoiceNumber || 'N/A'}. Invoice must be reviewed first.`);
    }
    if (status === before.status) return (await toDTOs([before], tx))[0];
    if (!TRANSITIONS[before.status]?.includes(status)) {
      throw badRequest('INVALID_STATUS_TRANSITION', `Cannot change appointment status from ${before.status} to ${status}.`);
    }

    const now = new Date();
    const data = { status, updatedById: actor.id, updatedByName: actor.name };
    if (status === 'CONFIRMED' && !before.confirmedAt) {
      Object.assign(data, { confirmedAt: now, confirmedById: actor.id, confirmedByName: actor.name });
    } else if (INACTIVE_STATUSES.includes(status)) {
      Object.assign(data, {
        cancelledAt: now, cancelledById: actor.id, cancelledByName: actor.name,
        cancelReason: cancelReason || (status === 'NO_SHOW' ? 'Client did not arrive for scheduled slot' : 'Appointment cancelled by salon'),
      });
    }

    const apt = await tx.appointment.update({ where: { id }, data, include });
    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: `APPOINTMENT_${status}`, entity: 'Appointment', entityId: id,
      branchId: apt.branchId, before: { status: before.status }, after: { status, cancelReason: data.cancelReason },
    });
    return (await toDTOs([apt], tx))[0];
  });
};

export const reschedule = async (id, { date, startTime, reason }, actor) => {
  assertBookingRole(actor);
  return prisma.$transaction(async (tx) => {
    const before = await loadOrThrow(tx, id);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot reschedule appointments for another branch.');
    assertNotBilled(before, 'reschedule');
    if (INACTIVE_STATUSES.includes(before.status)) {
      throw conflict('APPOINTMENT_CLOSED', `Cannot reschedule a ${before.status.toLowerCase()} appointment. Please create a new appointment.`);
    }

    await lockBranchDay(tx, before.branchId, date);
    const plan = await scheduleItems(tx, {
      branchId: before.branchId, date, startTime, rawItems: toRawItems(before), excludeAppointmentId: id,
    });
    const newStart = formatMinutesToTime(parseTimeToMinutes(startTime));

    await tx.appointmentReschedule.create({
      data: {
        appointmentId: id,
        previousDate: before.date, previousStartTime: before.startTime, previousEndTime: before.endTime,
        newDate: dateOnly(date), newStartTime: newStart, newEndTime: plan.endTime,
        reason: reason || 'Schedule adjustment requested', byUserId: actor.id, byName: actor.name,
      },
    });
    await tx.appointmentItem.deleteMany({ where: { appointmentId: id } });
    const apt = await tx.appointment.update({
      where: { id },
      data: {
        date: dateOnly(date), startTime: newStart, endTime: plan.endTime, durationMinutes: plan.durationMinutes,
        updatedById: actor.id, updatedByName: actor.name, items: { create: itemCreateData(plan.items) },
      },
      include,
    });

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'APPOINTMENT_RESCHEDULED', entity: 'Appointment', entityId: id,
      branchId: apt.branchId, before: { date: before.date, startTime: before.startTime }, after: { date, startTime: newStart, reason },
    });
    return (await toDTOs([apt], tx))[0];
  });
};

export const confirmationMessage = async (actor, id) => {
  const apt = await getAppointment(actor, id);
  if (!apt) throw notFound('APPOINTMENT_NOT_FOUND', `Appointment '${id}' not found.`);
  const branch = await prisma.branch.findUnique({ where: { id: apt.branchId } });

  const servicesList = apt.items.map((it) => (it.type === 'PACKAGE' ? `${it.name} (Package)` : it.name));
  const messageText =
    `Dear ${apt.clientName},\nYour appointment at ${branch.name} is confirmed!\n\n` +
    `Reference: ${apt.appointmentNumber}\nDate: ${apt.date}\n` +
    `Services: ${servicesList.join(', ')}\nEstimated Total: PKR ${apt.price.toLocaleString('en-PK')}\n` +
    `Branch Contact: ${branch.phone}\n\nWe look forward to serving you!`;

  const digits = normalizePhoneDigits(apt.clientPhone);
  const intl = digits.startsWith('92') ? digits : digits.startsWith('0') ? `92${digits.slice(1)}` : `92${digits}`;

  return {
    appointmentId:       apt.id,
    appointmentNumber:   apt.appointmentNumber,
    clientName:          apt.clientName,
    clientPhone:         apt.clientPhone,
    branchName:          branch.name,
    branchPhone:         branch.phone,
    date:                apt.date,
    time:                apt.startTime,
    servicesList,
    totalEstimatedPrice: apt.price,
    messageText,
    whatsappUrl:         `https://wa.me/${intl}?text=${encodeURIComponent(messageText)}`,
  };
};
