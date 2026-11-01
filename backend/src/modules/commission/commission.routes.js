// src/modules/commission/commission.routes.js — Accountants and staff have no access (confidential).

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import * as s from './commission.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const reason = z.object({ reason: z.string().trim().min(1, 'A reason is required.') });
const send = (fn, status = 200) => asyncHandler(async (req, res) => res.status(status).json({ data: await fn(req) }));

const router = Router();
router.get('/statements/me', authenticate, authorize('STAFF'), send((req) => s.personalStatements(req.user)));

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));
router.get('/runs', validate(z.object({ branchId: z.string().optional() }), 'query'), send((req) => s.listRuns(req.user, req.query)));
// Period = explicit startDate/endDate, or `month` (YYYY-MM) → 1st..last day of that month.
const monthRange = (body) => {
  if (!body.month) return body;
  const [y, m] = body.month.split('-').map(Number);
  return { ...body, startDate: `${body.month}-01`, endDate: `${body.month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};
router.post('/preview', validate(z.object({
  branchId: z.string().optional(), startDate: ymd.optional(), endDate: ymd.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM').optional(), staffId: z.string().optional(),
  staffIds: z.array(z.string()).optional(), compensationType: z.string().optional(),
}).refine((b) => b.month || (b.startDate && b.endDate), { message: 'Provide a month or both startDate and endDate.' })),
send((req) => s.generatePreview(req.user, monthRange(req.body)), 201));
router.post('/runs/:id/finalize', send((req) => s.finalizeRun(req.user, req.params.id)));
router.post('/runs/:id/cancel', validate(reason), send((req) => s.cancelRun(req.user, req.params.id, req.body.reason)));
router.post('/payments', idempotency, validate(z.object({
  commissionRunId: z.string().min(1), statementId: z.string().min(1), amount: z.number().positive('Payment amount must be greater than zero.'),
  method: z.enum(['CASH', 'ONLINE']), onlineAccountId: z.string().optional(), cashDrawerId: z.string().optional(),
  reference: z.string().optional(), notes: z.string().optional(),
})), send((req) => s.recordPayment(req.user, { ...req.body, idempotencyKey: req.idempotencyKey }), 201));
router.post('/payments/:id/reverse', validate(reason), send((req) => s.reversePayment(req.user, req.params.id, req.body.reason)));

export default router;
