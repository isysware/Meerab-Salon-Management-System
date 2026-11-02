// src/modules/attendance/attendance.routes.js
// Attendance, leaves, holidays, manual overtime. Accountants have no access (confidential HR data);
// staff can only read their own records.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import * as a from './attendance.service.js';
import * as ot from './overtime.service.js';
import { isYmd } from '../../lib/dates.js';

const ymd = z.string().refine(isYmd, 'Date must be a valid YYYY-MM-DD calendar date');
const time = z.string().trim().regex(/^(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2]):[0-5]\d\s?[AaPp][Mm])$/, 'Time must be a valid HH:MM or HH:MM AM/PM');
const source = z.enum(['MANUAL', 'IMPORT', 'BIOMETRIC']);
const reason = (label) => z.string().trim().min(1, `A ${label} reason is required.`);

const createSchema = z.object({
  staffId: z.string().min(1), branchId: z.string().optional(), date: ymd, checkIn: time, checkOut: time.optional(),
  notes: z.string().trim().optional(), source: source.optional(), isOvernightShift: z.boolean().optional(),
});
const correctSchema = z.object({ checkIn: time, checkOut: time.optional(), status: z.string().optional(), reason: reason('correction'), notes: z.string().optional() });
const finalizeSchema = z.object({ branchId: z.string().optional(), date: ymd });
const markAllSchema = z.object({
  branchId: z.string().optional(),
  date: ymd,
  status: z.enum(['PRESENT', 'ABSENT']).optional(),
  checkIn: time.optional(),
  checkOut: time.optional(),
  staffIds: z.array(z.string()).optional(),
  notes: z.string().trim().optional(),
});
const importSchema = z.object({
  branchId: z.string().optional(),
  rows: z.array(z.object({
    rowNumber: z.number().int(), employeeCode: z.string(), date: ymd, checkIn: time, checkOut: time.optional().or(z.literal('').transform(() => undefined)),
    deviceId: z.string().optional(),
  }).passthrough()).min(1, 'The import file has no rows.').max(5000),
});
const leaveSchema = z.object({
  staffId: z.string().min(1), branchId: z.string().optional(), startDate: ymd, endDate: ymd, type: z.enum(['PAID', 'UNPAID']), reason: reason('leave'), allowOverride: z.boolean().optional(),
});
const cancelSchema = z.object({ reason: reason('cancellation') });
const holidaySchema = z.object({ branchId: z.string().optional(), date: ymd, title: z.string().trim().min(1, 'Holiday title is required.') });
const listQuery = z.object({ branchId: z.string().optional(), date: ymd.optional(), startDate: ymd.optional(), endDate: ymd.optional(), staffId: z.string().optional() });

const minutes = z.number().int('Overtime minutes must be a positive whole number.').positive('Overtime minutes must be a positive whole number.').max(24 * 60);
const otCreate = z.object({
  staffId: z.string().min(1), branchId: z.string().optional(), date: ymd, minutes, reason: reason('overtime'),
  notes: z.string().optional(), status: z.enum(['DRAFT', 'SUBMITTED']).optional(),
});
const otUpdate = z.object({ minutes: minutes.optional(), reason: z.string().trim().min(1).optional(), notes: z.string().optional(), status: z.enum(['DRAFT', 'SUBMITTED']).optional() });

const send = (fn, status = 200) => asyncHandler(async (req, res) => res.status(status).json({ data: await fn(req) }));
const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const READERS = [...ADMINS, 'STAFF'];

const bulkSaveSchema = z.object({
  branchId: z.string().optional(),
  date: ymd,
  records: z.array(z.object({
    staffId: z.string().min(1),
    status: z.string().min(1),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    notes: z.string().optional(),
  })).min(1, 'No attendance records provided.'),
});

// ── /attendance ──────────────────────────────────────────────────────────────
export const attendanceRoutes = Router();
attendanceRoutes.use(authenticate);
attendanceRoutes.get('/leave-allowances', authorize(...READERS, 'ACCOUNTANT'), send((req) => a.getBranchLeaveAllowances(req.user, req.query)));
attendanceRoutes.get('/',               authorize(...READERS, 'ACCOUNTANT'), validate(listQuery, 'query'), send((req) => a.listAttendance(req.user, req.query)));
attendanceRoutes.get('/me',             authorize('STAFF'), send((req) => a.personalAttendance(req.user)));
attendanceRoutes.post('/',              authorize(...ADMINS), validate(createSchema), send((req) => a.createAttendance(req.body, req.user), 201));
attendanceRoutes.post('/mark-all',      authorize(...ADMINS), validate(markAllSchema), send((req) => a.markAllAttendance(req.body, req.user)));
attendanceRoutes.post('/bulk-save',     authorize(...ADMINS), validate(bulkSaveSchema), send((req) => a.bulkSaveAttendance(req.body, req.user)));
attendanceRoutes.put('/:id/correct',    authorize(...ADMINS), validate(correctSchema), send((req) => a.correctAttendance(req.params.id, req.body, req.user)));
attendanceRoutes.post('/finalize-day',  authorize(...ADMINS), validate(finalizeSchema), send((req) => a.finalizeDay(req.body, req.user)));
attendanceRoutes.post('/import-csv',    authorize(...ADMINS), validate(importSchema), send((req) => a.importCSV(req.body, req.user)));

// ── /leaves ──────────────────────────────────────────────────────────────────
export const leaveRoutes = Router();
leaveRoutes.use(authenticate);
leaveRoutes.get('/',            authorize(...READERS, 'ACCOUNTANT'), validate(listQuery, 'query'), send((req) => a.listLeaves(req.user, req.query)));
leaveRoutes.post('/',           authorize(...ADMINS), validate(leaveSchema), send((req) => a.markLeave(req.body, req.user), 201));
leaveRoutes.post('/:id/cancel', authorize(...ADMINS), validate(cancelSchema), send((req) => a.cancelLeave(req.params.id, req.body.reason, req.user)));

// ── /holidays ────────────────────────────────────────────────────────────────
export const holidayRoutes = Router();
holidayRoutes.use(authenticate);
holidayRoutes.get('/',  send((req) => a.listHolidays(req.user, req.query.branchId)));
holidayRoutes.post('/', authorize(...ADMINS), validate(holidaySchema), send((req) => a.addHoliday(req.body, req.user), 201));

// ── /overtime ────────────────────────────────────────────────────────────────
export const overtimeRoutes = Router();
overtimeRoutes.use(authenticate);
overtimeRoutes.get('/',             authorize(...READERS, 'ACCOUNTANT'), validate(listQuery, 'query'), send((req) => ot.listOvertime(req.user, req.query)));
overtimeRoutes.get('/me',           authorize('STAFF'), send((req) => ot.personalOvertime(req.user)));
overtimeRoutes.post('/',            authorize(...ADMINS), validate(otCreate), send((req) => ot.createOvertime(req.body, req.user), 201));
overtimeRoutes.put('/:id',          authorize(...ADMINS), validate(otUpdate), send((req) => ot.updateOvertime(req.params.id, req.body, req.user)));
overtimeRoutes.post('/:id/approve', authorize(...ADMINS), send((req) => ot.approveOvertime(req.params.id, req.user)));
overtimeRoutes.post('/:id/reject',  authorize(...ADMINS), validate(cancelSchema), send((req) => ot.rejectOvertime(req.params.id, req.body.reason, req.user)));
overtimeRoutes.post('/:id/cancel',  authorize(...ADMINS), validate(cancelSchema), send((req) => ot.cancelOvertime(req.params.id, req.body.reason, req.user)));
