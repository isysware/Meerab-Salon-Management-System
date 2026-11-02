// src/modules/attendance/attendance.service.js
// Attendance, leaves and holidays. Punches record physical presence only — they NEVER create payable
// overtime (spec §11.1); overtime is a separate manual, approved record (overtime module).
// Lateness / early-exit / deduction previews use the same engine as the frontend.

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, ymd } from '../../lib/dates.js';
import { nextSequence } from '../../lib/sequence.js';
import { num, opt, iso } from '../../lib/dto.js';
import {
  parseTimeToMinutes, formatMinutesToTime, evaluateLateness, evaluateEarlyExit, calculateWorkedHours,
  calculateScheduledHours, calculateDeductionSnapshot, evaluateLeaveAllowance, isWorkingDay,
} from '../../lib/calculations/attendanceCalculations.js';
import { roundCurrency } from '../../lib/calculations/taxCalculations.js';
import { toStaffDTO } from '../staff/staff.mapper.js';
import { lockStaffPayBranch, assertPayrollPeriodOpen } from '../../lib/hrTransactions.js';

const recordInclude = { punches: true, corrections: true };
const LEAVE_STATUSES = ['PAID_LEAVE', 'UNPAID_LEAVE'];

const shiftLabel = (s) => `${formatMinutesToTime(parseTimeToMinutes(s.startTime))} - ${formatMinutesToTime(parseTimeToMinutes(s.endTime))}`;

export const toAttendanceDTO = (a, staff) => ({
  id: a.id, staffId: a.staffId, staffName: staff?.name ?? '', employeeCode: staff?.employeeCode, designation: staff?.designation,
  branchId: a.branchId, date: ymd(a.workDate), checkIn: a.checkIn, checkOut: opt(a.checkOut),
  scheduledHours: num(a.scheduledHours), workedHours: num(a.workedHours), status: a.status,
  isLate: a.isLate, lateMinutes: a.lateMinutes, isEarlyExit: a.isEarlyExit, earlyExitMinutes: a.earlyExitMinutes,
  isMissingPunch: a.isMissingPunch, source: a.source, rawEventRef: opt(a.rawEventRef),
  punches: [...(a.punches ?? [])].sort((x, y) => x.createdAt - y.createdAt).map((p) => ({
    id: p.id, type: p.type, timestamp: p.timestamp, source: p.source, deviceId: opt(p.deviceId),
  })),
  correctionHistory: [...(a.corrections ?? [])].sort((x, y) => x.editedAt - y.editedAt).map((c) => ({
    id: c.id, editedAt: iso(c.editedAt), editedByUserId: c.editedByUserId, editedByName: c.editedByName, reason: c.reason,
    beforeSnapshot: c.beforeSnapshot, afterSnapshot: c.afterSnapshot,
  })),
  calculationSnapshot: a.calculationSnapshot ?? undefined, notes: opt(a.notes), isOvernightShift: a.isOvernightShift,
  scheduledShift: staff ? shiftLabel(staff) : undefined, isFinalized: a.isFinalized,
});

export const toLeaveDTO = (l, staff) => ({
  id: l.id, leaveNumber: l.leaveNumber, branchId: l.branchId, staffId: l.staffId, staffName: staff?.name ?? '',
  employeeCode: staff?.employeeCode, startDate: ymd(l.startDate), endDate: ymd(l.endDate), totalDays: l.totalDays,
  type: l.type, reason: l.reason, status: l.status, createdByUserId: l.createdByUserId, createdByName: l.createdByName,
  createdAt: iso(l.createdAt), cancelledAt: iso(l.cancelledAt), cancelledByUserId: opt(l.cancelledByUserId),
  cancelledByName: opt(l.cancelledByName), cancellationReason: opt(l.cancellationReason),
});

const toHolidayDTO = (h) => ({ id: h.id, branchId: h.branchId, date: ymd(h.date), title: h.title });

const staffMap = async (tx, ids) => {
  const rows = await tx.staff.findMany({ where: { id: { in: [...new Set(ids)] } } });
  return new Map(rows.map((s) => [s.id, s]));
};

const holidaysFor = async (tx, branchId) =>
  (await tx.branchHoliday.findMany({ where: { branchId: { in: ['ALL', branchId] } } })).map(toHolidayDTO);

/** Leaves in the shape the shared allowance engine expects. */
const leavesForEngine = async (tx, staffId) => {
  const rows = await tx.leaveRecord.findMany({ where: { staffId } });
  const days = await tx.attendanceRecord.findMany({ where: { leaveId: { in: rows.map((l) => l.id) } }, select: { leaveId: true, workDate: true } });
  return rows.map((l) => {
    const workingDates = days.filter((d) => d.leaveId === l.id).map((d) => ymd(d.workDate));
    return { staffId: l.staffId, status: l.status, type: l.type, startDate: ymd(l.startDate), endDate: ymd(l.endDate), totalDays: l.totalDays, ...(workingDates.length ? { workingDates } : {}) };
  });
};

/** Who the request is about: staff users are always pinned to their own profile. */
const resolveStaffFilter = (actor, staffId) => {
  if (actor.role === 'ACCOUNTANT') throw forbidden('FORBIDDEN', 'Access Denied: Accountants do not have permission to view staff attendance.');
  if (actor.role === 'STAFF') {
    if (!actor.staffId) throw forbidden('FORBIDDEN', 'Staff record associated with the authenticated user could not be found.');
    if (staffId && staffId !== actor.staffId) throw forbidden('FORBIDDEN', 'Access Denied: Staff members can only view their own attendance records.');
    return actor.staffId;
  }
  return staffId;
};

/** Lateness, early exit, worked hours and deduction preview for one day. */
const evaluateDay = (staffDTO, checkIn, checkOut, isOvernight, status, workDate) => {
  if (checkOut && !isOvernight && checkIn && parseTimeToMinutes(checkOut) < parseTimeToMinutes(checkIn)) {
    throw badRequest('INVALID_PUNCH', 'Check-out time cannot be earlier than check-in time unless marked as an overnight shift.');
  }
  const { isLate, lateMinutes } = evaluateLateness(checkIn, staffDTO.startTime, staffDTO.lateGraceMinutes);
  const early = checkOut ? evaluateEarlyExit(checkOut, staffDTO.endTime, staffDTO.earlyGraceMinutes, isOvernight) : { isEarlyExit: false, earlyExitMinutes: 0 };
  const sched = calculateScheduledHours(staffDTO.startTime, staffDTO.endTime, isOvernight);
  let worked = (checkIn && checkOut) ? calculateWorkedHours(checkIn, checkOut, isOvernight) : 0;
  if (status === 'HALF_DAY' && (!checkIn || !checkOut)) {
    worked = roundCurrency(sched / 2);
  }
  return {
    isLate, lateMinutes, isEarlyExit: early.isEarlyExit, earlyExitMinutes: early.earlyExitMinutes,
    workedHours: worked,
    scheduledHours: sched,
    calculationSnapshot: calculateDeductionSnapshot(staffDTO, isLate, lateMinutes, early.isEarlyExit, early.earlyExitMinutes, workDate),
    isMissingPunch: status === 'HALF_DAY' ? false : (!checkIn || !checkOut),
  };
};

// ═══ ATTENDANCE ═══════════════════════════════════════════════════════════════

export const listAttendance = async (actor, { branchId, date, startDate, endDate, staffId } = {}) => {
  const sid = resolveStaffFilter(actor, staffId);
  const b = actor.role === 'STAFF' ? null : resolveReadBranch(actor, branchId);
  const range = {};
  if (date) range.equals = dateOnly(date);
  if (startDate) range.gte = dateOnly(startDate);
  if (endDate) range.lte = dateOnly(endDate);
  const rows = await prisma.attendanceRecord.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(sid ? { staffId: sid } : {}), ...(Object.keys(range).length ? { workDate: range } : {}) },
    include: recordInclude, orderBy: [{ workDate: 'desc' }],
  });
  const staff = await staffMap(prisma, rows.map((r) => r.staffId));
  return rows.map((r) => toAttendanceDTO(r, staff.get(r.staffId)));
};

export const createAttendance = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot record attendance for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockStaffPayBranch(tx, branchId);
    const staff = await tx.staff.findUnique({ where: { id: input.staffId } });
    if (!staff || !staff.isActive) throw badRequest('STAFF_INVALID', `Staff member '${input.staffId}' is inactive or not found.`);
    if (staff.branchId !== branchId) throw badRequest('STAFF_BRANCH', `Staff member '${staff.name}' does not belong to this branch.`);
    await assertPayrollPeriodOpen(tx, staff.id, input.date);
    if (await tx.attendanceRecord.findUnique({ where: { staffId_workDate: { staffId: staff.id, workDate: dateOnly(input.date) } } })) {
      throw conflict('ATTENDANCE_EXISTS', `An attendance record for ${staff.name} on ${input.date} already exists. Use edit/correction to update existing punches.`);
    }
    const leave = await tx.leaveRecord.findFirst({
      where: { staffId: staff.id, status: 'APPROVED', startDate: { lte: dateOnly(input.date) }, endDate: { gte: dateOnly(input.date) } },
    });
    if (leave) throw conflict('ON_LEAVE', `Cannot record attendance: ${staff.name} is on approved leave (${leave.leaveNumber}) on ${input.date}.`);

    const dto = toStaffDTO(staff);
    const isOvernight = input.isOvernightShift ?? staff.isOvernightShift;
    const day = evaluateDay(dto, input.checkIn, input.checkOut, isOvernight, input.status, input.date);
    const source = input.source || 'MANUAL';
    const record = await tx.attendanceRecord.create({
      data: {
        branchId, staffId: staff.id, workDate: dateOnly(input.date), checkIn: input.checkIn, checkOut: input.checkOut || null,
        ...day, status: input.status || (input.checkIn && !input.checkOut ? 'MISSING_PUNCH' : 'PRESENT'), source, isOvernightShift: isOvernight, notes: input.notes || null,
        punches: {
          create: [
            { type: 'CHECK_IN', timestamp: input.checkIn, source },
            ...(input.checkOut ? [{ type: 'CHECK_OUT', timestamp: input.checkOut, source }] : []),
          ],
        },
      },
      include: recordInclude,
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'ATTENDANCE_RECORDED', entity: 'AttendanceRecord', entityId: record.id, branchId });
    return toAttendanceDTO(record, staff);
  });
};

export const correctAttendance = async (id, input, actor) =>
  prisma.$transaction(async (tx) => {
    const header = await tx.attendanceRecord.findUnique({ where: { id } });
    if (!header) throw notFound('ATTENDANCE_NOT_FOUND', `Attendance record '${id}' not found.`);
    await lockStaffPayBranch(tx, header.branchId);
    const record = await tx.attendanceRecord.findUnique({ where: { id }, include: recordInclude });
    if (!record) throw notFound('ATTENDANCE_NOT_FOUND', `Attendance record '${id}' not found.`);
    assertBranchAccess(actor, record.branchId, 'Access Denied: Cannot correct attendance for another branch.');
    await assertPayrollPeriodOpen(tx, record.staffId, ymd(record.workDate));
    if (record.leaveId) throw conflict('ON_LEAVE', 'Cancel the approved leave before changing its attendance.');
    const staff = await tx.staff.findUnique({ where: { id: record.staffId } });

    const snap = (r) => ({
      checkIn: r.checkIn, checkOut: r.checkOut ?? undefined, status: r.status, workedHours: num(r.workedHours),
      isLate: r.isLate, lateMinutes: r.lateMinutes, isEarlyExit: r.isEarlyExit, earlyExitMinutes: r.earlyExitMinutes,
    });
    const day = evaluateDay(toStaffDTO(staff), input.checkIn, input.checkOut, record.isOvernightShift, input.status || record.status, ymd(record.workDate));
    const updated = await tx.attendanceRecord.update({
      where: { id },
      data: {
        checkIn: input.checkIn, checkOut: input.checkOut || null, ...day, scheduledHours: undefined,
        status: input.status || record.status || (input.checkIn && !input.checkOut ? 'MISSING_PUNCH' : 'PRESENT'),
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: recordInclude,
    });
    // Corrections are an audit trail (before/after), never a silent overwrite.
    await tx.attendanceCorrection.create({
      data: { recordId: id, beforeSnapshot: snap(record), afterSnapshot: snap(updated), reason: input.reason, editedByUserId: actor.id, editedByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'ATTENDANCE_CORRECTED', entity: 'AttendanceRecord', entityId: id, branchId: record.branchId, before: snap(record), after: snap(updated) });
    return toAttendanceDTO(await tx.attendanceRecord.findUnique({ where: { id }, include: recordInclude }), staff);
  });

export const finalizeDay = async ({ branchId: requested, date }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot finalize attendance for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockStaffPayBranch(tx, branchId);
    if (date > (await getBusinessDate(tx))) throw badRequest('FUTURE_DATE', 'Cannot finalize attendance for a future date. Wait until the workday is completed.');
    const holidays = await holidaysFor(tx, branchId);
    const staffRows = await tx.staff.findMany({ where: { branchId, isActive: true } });
    const absent = [];
    let finalizedCount = 0;
    for (const s of staffRows) {
      const dto = toStaffDTO(s);
      if (!isWorkingDay(date, dto, holidays).isWorking) continue;
      await assertPayrollPeriodOpen(tx, s.id, date);
      const rec = await tx.attendanceRecord.findUnique({ where: { staffId_workDate: { staffId: s.id, workDate: dateOnly(date) } } });
      if (!rec) {
        await tx.attendanceRecord.create({
          data: {
            branchId, staffId: s.id, workDate: dateOnly(date), checkIn: 'ABSENT', checkOut: 'ABSENT', status: 'ABSENT',
            scheduledHours: calculateScheduledHours(s.startTime, s.endTime), notes: 'Marked absent upon end-of-day finalization.', isFinalized: true,
          },
        });
        absent.push(s.name);
      } else {
        await tx.attendanceRecord.update({
          where: { id: rec.id },
          data: { isFinalized: true, ...(rec.checkIn && rec.checkIn !== 'ABSENT' && !rec.checkOut && rec.status === 'PRESENT' ? { status: 'MISSING_PUNCH', isMissingPunch: true } : {}) },
        });
      }
      finalizedCount += 1;
    }
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'ATTENDANCE_DAY_FINALIZED', entity: 'AttendanceRecord', entityId: date, branchId, after: { finalizedCount, absent } });
    return { finalizedCount, markedAbsentStaffNames: absent };
  });
};

export const markAllAttendance = async ({ branchId: requested, date, status = 'PRESENT', checkIn, checkOut, staffIds, notes }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot record attendance for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockStaffPayBranch(tx, branchId);
    const where = { branchId, isActive: true };
    if (staffIds && staffIds.length > 0) {
      where.id = { in: staffIds };
    }
    const staffRows = await tx.staff.findMany({ where, orderBy: { name: 'asc' } });
    let markedCount = 0;
    let skippedCount = 0;
    const markedNames = [];
    const skippedNames = [];

    for (const s of staffRows) {
      await assertPayrollPeriodOpen(tx, s.id, date);
      // Check if already has an attendance record on this date
      const existing = await tx.attendanceRecord.findUnique({
        where: { staffId_workDate: { staffId: s.id, workDate: dateOnly(date) } },
      });
      if (existing) {
        skippedCount++;
        skippedNames.push(`${s.name} (Already marked)`);
        continue;
      }

      // Check if on approved leave
      const leave = await tx.leaveRecord.findFirst({
        where: { staffId: s.id, status: 'APPROVED', startDate: { lte: dateOnly(date) }, endDate: { gte: dateOnly(date) } },
      });
      if (leave) {
        skippedCount++;
        skippedNames.push(`${s.name} (On approved leave)`);
        continue;
      }

      const cIn = checkIn || '';
      const cOut = checkOut || null;
      if (cOut && !cIn) throw badRequest('INVALID_PUNCH', 'Enter check-in before check-out.');
      const isOvernight = s.isOvernightShift;

      if (status === 'PRESENT') {
        const day = evaluateDay(toStaffDTO(s), cIn, cOut, isOvernight, undefined, date);
        await tx.attendanceRecord.create({
          data: {
            branchId,
            staffId: s.id,
            workDate: dateOnly(date),
            checkIn: cIn,
            checkOut: cOut,
            ...day,
            status: 'PRESENT',
            source: 'MANUAL',
            isOvernightShift: isOvernight,
            notes: notes || 'Bulk marked present by manager.',
            punches: {
              create: [
                ...(cIn ? [{ type: 'CHECK_IN', timestamp: cIn, source: 'MANUAL' }] : []),
                ...(cOut ? [{ type: 'CHECK_OUT', timestamp: cOut, source: 'MANUAL' }] : []),
              ],
            },
          },
        });
      } else {
        await tx.attendanceRecord.create({
          data: {
            branchId,
            staffId: s.id,
            workDate: dateOnly(date),
            checkIn: 'ABSENT',
            checkOut: 'ABSENT',
            status: 'ABSENT',
            scheduledHours: calculateScheduledHours(s.startTime, s.endTime),
            source: 'MANUAL',
            notes: notes || 'Bulk marked absent by manager.',
          },
        });
      }

      markedCount++;
      markedNames.push(s.name);
    }

    if (markedCount > 0) {
      await auditLog(tx, {
        userId: actor.id,
        userName: actor.name,
        action: 'ATTENDANCE_BULK_RECORDED',
        entity: 'AttendanceRecord',
        entityId: date,
        branchId,
        after: { markedCount, skippedCount, markedNames },
      });
    }

    return { markedCount, skippedCount, markedNames, skippedNames };
  });
};

export const bulkSaveAttendance = async ({ branchId: requested, date, records }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot record attendance for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockStaffPayBranch(tx, branchId);
    let savedCount = 0;
    const staffIds = records.map((r) => r.staffId);
    const staffRows = await tx.staff.findMany({ where: { id: { in: staffIds }, branchId, isActive: true } });
    const staffMap = new Map(staffRows.map((s) => [s.id, s]));

    for (const item of records) {
      const staff = staffMap.get(item.staffId);
      if (!staff) continue;

      await assertPayrollPeriodOpen(tx, staff.id, date);

      const status = item.status || 'PRESENT';
      let checkIn = item.checkIn?.trim() || '';
      let checkOut = item.checkOut?.trim() || '';
      let isLate = false;
      let lateMinutes = 0;
      let isEarlyExit = false;
      let earlyExitMinutes = 0;
      let workedHours = 0;
      let scheduledHours = calculateScheduledHours(staff.startTime, staff.endTime, staff.isOvernightShift);
      let calculationSnapshot = null;
      let isMissingPunch = false;

      if (status === 'PRESENT' || status === 'HALF_DAY') {
        if (checkOut && !checkIn) throw badRequest('INVALID_PUNCH', 'Enter check-in before check-out.');
        const dto = toStaffDTO(staff);
        const day = evaluateDay(dto, checkIn, checkOut, staff.isOvernightShift, status, date);
        isLate = day.isLate;
        lateMinutes = day.lateMinutes;
        isEarlyExit = day.isEarlyExit;
        earlyExitMinutes = day.earlyExitMinutes;
        workedHours = day.workedHours;
        scheduledHours = day.scheduledHours;
        calculationSnapshot = day.calculationSnapshot;
        isMissingPunch = day.isMissingPunch;
      } else if (status === 'ABSENT') {
        checkIn = 'ABSENT';
        checkOut = 'ABSENT';
        workedHours = 0;
      } else if (status === 'HOLIDAY' || status === 'WEEKLY_OFF') {
        checkIn = status;
        checkOut = status;
        workedHours = 0;
      } else if (status === 'PAID_LEAVE' || status === 'UNPAID_LEAVE') {
        checkIn = status;
        checkOut = status;
        workedHours = 0;
      }

      const existing = await tx.attendanceRecord.findUnique({
        where: { staffId_workDate: { staffId: staff.id, workDate: dateOnly(date) } },
      });

      if (existing) {
        await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            checkIn,
            checkOut: checkOut || null,
            status,
            isLate,
            lateMinutes,
            isEarlyExit,
            earlyExitMinutes,
            workedHours,
            scheduledHours,
            calculationSnapshot,
            isMissingPunch,
            notes: item.notes !== undefined ? item.notes : existing.notes,
          },
        });
      } else {
        await tx.attendanceRecord.create({
          data: {
            branchId,
            staffId: staff.id,
            workDate: dateOnly(date),
            checkIn,
            checkOut: checkOut || null,
            status,
            isLate,
            lateMinutes,
            isEarlyExit,
            earlyExitMinutes,
            workedHours,
            scheduledHours,
            calculationSnapshot,
            isMissingPunch,
            source: 'MANUAL',
            isOvernightShift: staff.isOvernightShift,
            notes: item.notes || null,
            punches: {
              create: [
                ...(checkIn && !['ABSENT', 'HOLIDAY', 'WEEKLY_OFF', 'PAID_LEAVE', 'UNPAID_LEAVE'].includes(checkIn)
                  ? [{ type: 'CHECK_IN', timestamp: checkIn, source: 'MANUAL' }]
                  : []),
                ...(checkOut && !['ABSENT', 'HOLIDAY', 'WEEKLY_OFF', 'PAID_LEAVE', 'UNPAID_LEAVE'].includes(checkOut)
                  ? [{ type: 'CHECK_OUT', timestamp: checkOut, source: 'MANUAL' }]
                  : []),
              ],
            },
          },
        });
      }
      savedCount++;
    }

    if (savedCount > 0) {
      await auditLog(tx, {
        userId: actor.id,
        userName: actor.name,
        action: 'ATTENDANCE_DAILY_SHEET_SAVED',
        entity: 'AttendanceRecord',
        entityId: date,
        branchId,
        after: { savedCount, totalRequested: records.length },
      });
    }

    return { savedCount };
  });
};

export const importCSV = async ({ branchId: requested, rows }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot import attendance for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockStaffPayBranch(tx, branchId);
    const staffRows = await tx.staff.findMany({ where: { branchId } });
    const byCode = new Map(staffRows.map((s) => [s.employeeCode.toUpperCase(), s]));
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const details = [];
    for (const row of rows) {
      const staff = byCode.get((row.employeeCode || '').trim().toUpperCase());
      if (!staff || !staff.isActive) {
        rejected += 1;
        details.push({ ...row, status: 'INVALID', rejectionReason: `Employee code '${row.employeeCode}' not found in active branch.` });
        continue;
      }
      const match = { matchedStaffId: staff.id, matchedStaffName: staff.name };
      if (await tx.attendanceRecord.findUnique({ where: { staffId_workDate: { staffId: staff.id, workDate: dateOnly(row.date) } } })) {
        duplicates += 1;
        details.push({ ...row, ...match, status: 'DUPLICATE', rejectionReason: `Attendance record for ${staff.name} on ${row.date} already exists.` });
        continue;
      }
      let day;
      try {
        await assertPayrollPeriodOpen(tx, staff.id, row.date);
        const leave = await tx.leaveRecord.findFirst({ where: { staffId: staff.id, status: 'APPROVED', startDate: { lte: dateOnly(row.date) }, endDate: { gte: dateOnly(row.date) } } });
        if (leave) throw conflict('ON_LEAVE', 'Cannot import attendance during approved leave.');
        day = evaluateDay(toStaffDTO(staff), row.checkIn, row.checkOut, staff.isOvernightShift, undefined, row.date);
      } catch (e) {
        rejected += 1;
        details.push({ ...row, ...match, status: 'INVALID', rejectionReason: e.message });
        continue;
      }
      await tx.attendanceRecord.create({
        data: {
          branchId, staffId: staff.id, workDate: dateOnly(row.date), checkIn: row.checkIn, checkOut: row.checkOut || null, ...day,
          status: row.checkOut ? 'PRESENT' : 'MISSING_PUNCH', source: 'IMPORT', isOvernightShift: staff.isOvernightShift,
          rawEventRef: row.deviceId ? `DEV:${row.deviceId}|ROW:${row.rowNumber}` : null,
          punches: {
            create: [
              { type: 'CHECK_IN', timestamp: row.checkIn, source: 'IMPORT', deviceId: row.deviceId || null },
              ...(row.checkOut ? [{ type: 'CHECK_OUT', timestamp: row.checkOut, source: 'IMPORT', deviceId: row.deviceId || null }] : []),
            ],
          },
        },
      });
      accepted += 1;
      details.push({ ...row, ...match, status: 'VALID' });
    }
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'ATTENDANCE_IMPORTED', entity: 'AttendanceRecord', entityId: 'csv', branchId, after: { accepted, duplicates, rejected } });
    return { totalRows: rows.length, acceptedRows: accepted, duplicateRows: duplicates, rejectedRows: rejected, details };
  });
};

// ═══ LEAVES ═══════════════════════════════════════════════════════════════════

export const listLeaves = async (actor, { branchId, staffId, date, startDate, endDate } = {}) => {
  const sid = resolveStaffFilter(actor, staffId);
  const b = actor.role === 'STAFF' ? null : resolveReadBranch(actor, branchId);
  const rows = await prisma.leaveRecord.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(sid ? { staffId: sid } : {}),
      ...(date || endDate ? { startDate: { lte: dateOnly(date || endDate) } } : {}),
      ...(date || startDate ? { endDate: { gte: dateOnly(date || startDate) } } : {}) }, orderBy: { startDate: 'desc' },
  });
  const staff = await staffMap(prisma, rows.map((r) => r.staffId));
  return rows.map((l) => toLeaveDTO(l, staff.get(l.staffId)));
};

export const markLeave = async (input, actor) =>
  prisma.$transaction(async (tx) => {
    const staff = await tx.staff.findUnique({ where: { id: input.staffId } });
    if (!staff || !staff.isActive) throw badRequest('STAFF_INVALID', `Staff member '${input.staffId}' is inactive or not found.`);
    const branchId = resolveWriteBranch(actor, input.branchId || staff.branchId, 'Access Denied: Cannot mark leave for another branch.');
    if (staff.branchId !== branchId) throw badRequest('STAFF_BRANCH', `Staff member '${staff.name}' does not belong to this branch.`);
    await lockStaffPayBranch(tx, branchId);
    if (input.startDate > input.endDate) throw badRequest('INVALID_RANGE', 'Leave start date must be on or before end date.');
    await assertPayrollPeriodOpen(tx, staff.id, input.startDate, input.endDate);
    const attended = await tx.attendanceRecord.findFirst({ where: { staffId: staff.id, workDate: { gte: dateOnly(input.startDate), lte: dateOnly(input.endDate) }, status: { in: ['PRESENT', 'LATE', 'MISSING_PUNCH'] } } });
    if (attended) throw conflict('LEAVE_ATTENDANCE_CONFLICT', 'This leave overlaps recorded attendance. Correct the attendance before marking leave.');

    const overlap = await tx.leaveRecord.findFirst({
      where: { staffId: staff.id, status: 'APPROVED', startDate: { lte: dateOnly(input.endDate) }, endDate: { gte: dateOnly(input.startDate) } },
    });
    if (overlap) {
      throw conflict('LEAVE_OVERLAP', `Conflicting leave (${overlap.leaveNumber}) already exists for ${staff.name} between ${ymd(overlap.startDate)} and ${ymd(overlap.endDate)}.`);
    }

    const dto = toStaffDTO(staff);
    const holidays = await holidaysFor(tx, branchId);
    const dates = [];
    for (let d = new Date(`${input.startDate}T00:00:00Z`); d <= new Date(`${input.endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (isWorkingDay(ds, dto, holidays).isWorking) dates.push(ds);
    }
    if (!dates.length) throw badRequest('NO_WORKING_DAYS', 'Selected date range does not contain any scheduled working days.');

    if (input.type === 'PAID') {
      const existingLeaves = await leavesForEngine(tx, staff.id);
      const periods = new Map();
      for (const date of dates) {
        const key = dto.leaveAllowancePeriod === 'YEARLY' ? date.slice(0, 4) : date.slice(0, 7);
        const bucket = periods.get(key) || [];
        bucket.push(date);
        periods.set(key, bucket);
      }
      for (const [period, days] of periods) {
        const allowance = evaluateLeaveAllowance(dto, existingLeaves, days[0], holidays);
        if (!allowance.isConfigured && !input.allowOverride) {
          throw badRequest('NO_ALLOWANCE', `Cannot mark paid leave: Paid leave allowance is not configured for ${staff.name}. Use unpaid leave or configure allowance first.`);
        }
        if (days.length > allowance.remainingDays && !input.allowOverride) {
          throw conflict('ALLOWANCE_EXCEEDED', `Cannot mark paid leave: ${staff.name} only has ${allowance.remainingDays} paid leave day(s) remaining for ${period} (requested: ${days.length} days).`);
        }
      }
    }

    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    const leave = await tx.leaveRecord.create({
      data: {
        leaveNumber: await nextSequence(tx, branch.code, 'LV', Number(input.startDate.slice(0, 4))), branchId, staffId: staff.id,
        startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate), totalDays: dates.length, type: input.type,
        reason: input.reason, createdByUserId: actor.id, createdByName: actor.name,
      },
    });
    const status = input.type === 'PAID' ? 'PAID_LEAVE' : 'UNPAID_LEAVE';
    const scheduledHours = calculateScheduledHours(staff.startTime, staff.endTime);
    for (const d of dates) {
      await tx.attendanceRecord.upsert({
        where: { staffId_workDate: { staffId: staff.id, workDate: dateOnly(d) } },
        update: { status, workedHours: 0, leaveId: leave.id, notes: `Leave voucher: ${leave.leaveNumber} - ${input.reason}` },
        create: {
          branchId, staffId: staff.id, workDate: dateOnly(d), checkIn: 'LEAVE', checkOut: 'LEAVE', status, scheduledHours,
          leaveId: leave.id, notes: `Leave voucher: ${leave.leaveNumber} - ${input.reason}`,
        },
      });
    }
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'LEAVE_MARKED', entity: 'LeaveRecord', entityId: leave.id, branchId, after: { days: dates.length, type: input.type } });
    return toLeaveDTO(leave, staff);
  });

export const cancelLeave = async (id, reason, actor) =>
  prisma.$transaction(async (tx) => {
    const header = await tx.leaveRecord.findUnique({ where: { id } });
    if (!header) throw notFound('LEAVE_NOT_FOUND', `Leave record '${id}' not found.`);
    await lockStaffPayBranch(tx, header.branchId);
    const leave = await tx.leaveRecord.findUnique({ where: { id } });
    if (!leave) throw notFound('LEAVE_NOT_FOUND', `Leave record '${id}' not found.`);
    assertBranchAccess(actor, leave.branchId, 'Access Denied: Cannot cancel leave from another branch.');
    if (leave.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', `Leave '${leave.leaveNumber}' is already cancelled.`);
    await assertPayrollPeriodOpen(tx, leave.staffId, ymd(leave.startDate), ymd(leave.endDate));
    const updated = await tx.leaveRecord.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actor.id, cancelledByName: actor.name, cancellationReason: reason },
    });
    // Remove only the synthetic leave days this voucher created.
    await tx.attendanceRecord.deleteMany({ where: { leaveId: id, status: { in: LEAVE_STATUSES }, checkIn: 'LEAVE' } });
    // Leave may have replaced an existing absent row; restore absence rather than leaving paid leave behind.
    await tx.attendanceRecord.updateMany({ where: { leaveId: id, status: { in: LEAVE_STATUSES } }, data: { status: 'ABSENT', workedHours: 0, leaveId: null } });
    await tx.attendanceRecord.updateMany({ where: { leaveId: id }, data: { leaveId: null } });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'LEAVE_CANCELLED', entity: 'LeaveRecord', entityId: id, branchId: leave.branchId, after: { reason } });
    return toLeaveDTO(updated, await tx.staff.findUnique({ where: { id: leave.staffId } }));
  });

// ═══ HOLIDAYS ═════════════════════════════════════════════════════════════════

export const listHolidays = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.branchHoliday.findMany({ where: b ? { branchId: { in: ['ALL', b] } } : {}, orderBy: { date: 'asc' } });
  return rows.map(toHolidayDTO);
};

export const addHoliday = async ({ branchId, date, title }, actor) => {
  const target = actor.role === 'SUPER_ADMIN' ? branchId || 'ALL' : resolveWriteBranch(actor, branchId);
  const h = await prisma.branchHoliday.create({ data: { branchId: target, date: dateOnly(date), title } }).catch((e) => {
    if (e.code === 'P2002') throw conflict('HOLIDAY_EXISTS', `A holiday is already configured on ${date}.`);
    throw e;
  });
  return toHolidayDTO(h);
};

// ═══ STAFF PORTAL ═════════════════════════════════════════════════════════════

export const personalAttendance = async (actor) => {
  if (!actor.staffId) throw forbidden('FORBIDDEN', 'Staff record associated with the authenticated user could not be found.');
  const staff = await prisma.staff.findUnique({ where: { id: actor.staffId } });
  const records = await prisma.attendanceRecord.findMany({ where: { staffId: staff.id }, include: recordInclude, orderBy: { workDate: 'desc' } });
  const leaves = await prisma.leaveRecord.findMany({ where: { staffId: staff.id }, orderBy: { startDate: 'desc' } });
  const allowance = evaluateLeaveAllowance(toStaffDTO(staff), await leavesForEngine(prisma, staff.id), await getBusinessDate());
  return {
    records: records.map((r) => toAttendanceDTO(r, staff)),
    leaves: leaves.map((l) => toLeaveDTO(l, staff)),
    summary: { staffName: staff.name, roleTitle: staff.roleTitle, startTime: staff.startTime, endTime: staff.endTime, isOvernightShift: staff.isOvernightShift, allowance },
  };
};

export const getBranchLeaveAllowances = async (actor, { branchId, date } = {}) => {
  const bId = actor.role === 'STAFF' ? actor.branchId : resolveReadBranch(actor, branchId);
  const targetDate = date || await getBusinessDate();
  const staffList = await prisma.staff.findMany({
    where: { ...(bId ? { branchId: bId } : {}), isActive: true },
  });

  const holidays = await prisma.branchHoliday.findMany({
    where: { ...(bId ? { branchId: { in: [bId, 'ALL'] } } : {}) },
  });

  const year = Number(targetDate.slice(0, 4));
  const yearStart = dateOnly(`${year}-01-01`);
  const yearEnd = dateOnly(`${year}-12-31`);

  const staffIds = staffList.map((s) => s.id);
  const leaves = await prisma.leaveRecord.findMany({
    where: {
      staffId: { in: staffIds },
      status: 'APPROVED',
      startDate: { lte: yearEnd },
      endDate: { gte: yearStart },
    },
  });

  const paidAttendance = await prisma.attendanceRecord.findMany({
    where: {
      staffId: { in: staffIds },
      status: 'PAID_LEAVE',
      workDate: { gte: yearStart, lte: yearEnd },
    },
    select: { id: true, staffId: true, workDate: true, leaveId: true },
  });

  const result = {};
  for (const staff of staffList) {
    const dto = toStaffDTO(staff);
    const staffLeaves = leaves.filter((l) => l.staffId === staff.id);
    const staffAtt = paidAttendance.filter((a) => a.staffId === staff.id);

    const engineLeaves = staffLeaves.map((l) => ({
      staffId: l.staffId,
      status: l.status,
      type: l.type,
      startDate: ymd(l.startDate),
      endDate: ymd(l.endDate),
      totalDays: l.totalDays,
    }));

    const standaloneAtt = staffAtt.filter((a) => !a.leaveId);
    for (const att of standaloneAtt) {
      const dStr = ymd(att.workDate);
      engineLeaves.push({
        staffId: staff.id,
        status: 'APPROVED',
        type: 'PAID',
        startDate: dStr,
        endDate: dStr,
        totalDays: 1,
      });
    }

    const allowance = evaluateLeaveAllowance(dto, engineLeaves, targetDate, holidays);
    result[staff.id] = allowance;
  }

  return result;
};
