// src/modules/payroll/payroll.routes.js — Accountants and staff have no access (confidential).

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import * as s from './payroll.service.js';
import * as x from './payroll.extras.service.js';
import { isYmd } from '../../lib/dates.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');
const reason = z.object({ reason: z.string().trim().min(1, 'A reason is required.') });
const send = (fn, status = 200) => asyncHandler(async (req, res) => res.status(status).json({ data: await fn(req) }));

const router = Router();
router.get('/payslips/me', authenticate, authorize('STAFF'), send((req) => s.personalPayslips(req.user)));

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));
router.get('/runs', validate(z.object({ branchId: z.string().optional(), month: month.optional() }), 'query'), send((req) => s.listRuns(req.user, req.query)));
router.post('/preview', validate(z.object({
  branchId: z.string().optional(),
  month: month.optional(),
  staffId: z.string().optional(),
  staffIds: z.array(z.string()).optional(),
  startDate: z.string().refine(isYmd, 'startDate must be a valid YYYY-MM-DD date').optional(),
  endDate: z.string().refine(isYmd, 'endDate must be a valid YYYY-MM-DD date').optional(),
  runType: z.enum(['MONTHLY', 'DAILY', 'CUSTOM_RANGE']).optional(),
  compensationType: z.enum(['ALL', 'DAILY_SALARY', 'DAILY_PLUS_COMMISSION', 'MONTHLY_SALARY', 'MONTHLY_PLUS_COMMISSION', 'COMMISSION_ONLY']).optional(),
  includeDaily: z.boolean().optional(),
})), send((req) => s.generatePreview(req.user, req.body), 201));
router.post('/runs/:id/finalize', send((req) => s.finalizeRun(req.user, req.params.id)));
router.post('/runs/:id/cancel', validate(reason), send((req) => s.cancelRun(req.user, req.params.id, req.body.reason)));
router.post('/payslips/:id/cancel', validate(reason), send((req) => s.cancelPayslip(req.user, req.params.id, req.body.reason)));
router.delete('/payslips/:id', send((req) => s.cancelPayslip(req.user, req.params.id, req.query.reason || 'Staff salary cancelled')));
router.post('/payments', idempotency, validate(z.object({
  payrollRunId: z.string().min(1), payslipId: z.string().min(1), amount: z.number().positive('Payment amount must be greater than zero.'),
  method: z.enum(['CASH', 'ONLINE']), onlineAccountId: z.string().optional(), cashDrawerId: z.string().optional(),
  reference: z.string().optional(), notes: z.string().optional(),
})), send((req) => s.recordPayment(req.user, { ...req.body, idempotencyKey: req.idempotencyKey }), 201));
router.post('/payments/:id/reverse', validate(reason), send((req) => s.reversePayment(req.user, req.params.id, req.body.reason)));
router.post('/payslips/:id/deductions', validate(z.object({
  amount: z.number().positive('Deduction amount must be greater than zero.'),
  title: z.string().trim().min(1, 'Title or reason is required.'),
  notes: z.string().optional(),
})), send((req) => s.applyManualDeduction(req.user, req.params.id, req.body), 201));

router.get('/monthly-summary', validate(z.object({ branchId: z.string().optional(), month }), 'query'), send((req) => s.monthlySummary(req.user, req.query)));

// Recurring allowances
router.get('/allowances', validate(z.object({ branchId: z.string().optional(), staffId: z.string().optional() }), 'query'), send((req) => x.listAllowances(req.user, req.query)));
router.post('/allowances', validate(z.object({
  staffId: z.string().min(1), name: z.string().trim().min(1, 'Allowance name is required.'), amount: z.number().positive('Amount must be greater than zero.'),
})), send((req) => x.createAllowance(req.user, req.body), 201));
router.put('/allowances/:id', validate(z.object({
  name: z.string().trim().min(1).optional(), amount: z.number().positive('Amount must be greater than zero.').optional(), isActive: z.boolean().optional(),
})), send((req) => x.updateAllowance(req.user, req.params.id, req.body)));

// One-off adjustments (bonus / extra allowance / deduction) for a month
router.get('/adjustments', validate(z.object({ branchId: z.string().optional(), month: month.optional(), staffId: z.string().optional() }), 'query'), send((req) => x.listAdjustments(req.user, req.query)));
router.post('/adjustments', validate(z.object({
  staffId: z.string().min(1), month, type: z.enum(['ALLOWANCE', 'BONUS', 'DEDUCTION']), title: z.string().trim().min(1, 'Title is required.'),
  amount: z.number().positive('Amount must be greater than zero.'), notes: z.string().optional(),
})), send((req) => x.createAdjustment(req.user, req.body), 201));
router.post('/adjustments/:id/cancel', send((req) => x.cancelAdjustment(req.user, req.params.id)));

// Salary advances (money moves now; recovered through payroll)
router.get('/advances', validate(z.object({ branchId: z.string().optional(), staffId: z.string().optional(), status: z.string().optional() }), 'query'), send((req) => x.listAdvances(req.user, req.query)));
router.post('/advances', idempotency, validate(z.object({
  staffId: z.string().min(1), amount: z.number().positive('Advance amount must be greater than zero.'),
  recoveryPerMonth: z.number().positive('Monthly recovery must be greater than zero.').optional(), startMonth: month.optional(),
  method: z.enum(['CASH', 'ONLINE']), onlineAccountId: z.string().optional(), reason: z.string().trim().min(1, 'A reason is required.'),
})), send((req) => x.issueAdvance(req.user, { ...req.body, idempotencyKey: req.idempotencyKey }), 201));
router.post('/advances/:id/reverse', validate(reason), send((req) => x.reverseAdvance(req.user, req.params.id, req.body.reason)));

export default router;
