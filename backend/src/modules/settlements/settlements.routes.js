// src/modules/settlements/settlements.routes.js

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { notFound } from '../../lib/AppError.js';
import * as s from './settlements.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const nonNeg = z.number({ message: 'Amounts must be numbers.' }).min(0, 'All settlement amounts must be non-negative.').finite();
const submitSchema = z.object({
  drawerId:              z.string().min(1, 'Select the cash drawer to settle.'),
  branchId:              z.string().optional(),
  countedCash:           nonNeg,
  handoverAmount:        nonNeg,
  retainedFloat:         nonNeg.default(0),
  varianceExplanation:   z.string().trim().optional(),
  destinationVaultId:    z.string().optional(),
  destinationVaultName:  z.string().optional(),
  denominationBreakdown: z.record(z.string(), z.number()).optional(),
  notes:                 z.string().trim().optional(),
  isDraft:               z.boolean().optional(),
});
const approveSchema = z.object({
  destinationVaultId: z.string().optional(), destinationVaultName: z.string().optional(),
  actualCashReceived: z.number().optional(), acceptVariance: z.boolean().optional(), notes: z.string().trim().optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().min(1, 'A rejection reason is required to reject a settlement.') });
const listQuery = z.object({
  branchId: z.string().optional(), status: z.string().optional(), submitterId: z.string().optional(),
  drawerId: z.string().optional(), startDate: ymd.optional(), endDate: ymd.optional(),
  reviewPendingOnly: z.enum(['true', 'false']).optional(),
  submittedByRole: z.string().optional(),
});
const statementQuery = z.object({
  userId: z.string().optional(), branchId: z.string().optional(), drawerId: z.string().optional(),
  startDate: ymd.optional(), endDate: ymd.optional(),
});

const send = (fn, status = 200) => asyncHandler(async (req, res) => res.status(status).json({ data: await fn(req) }));
const HANDLERS = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];

// ── /custody ─────────────────────────────────────────────────────────────────
export const custodyRoutes = Router();
custodyRoutes.use(authenticate, authorize(...HANDLERS));
custodyRoutes.get('/statement', validate(statementQuery, 'query'), send((req) => s.custodyStatement(req.user, req.query)));

// ── /settlements ─────────────────────────────────────────────────────────────
export const settlementRoutes = Router();
settlementRoutes.use(authenticate, authorize(...HANDLERS));
settlementRoutes.get('/', validate(listQuery, 'query'), send((req) => s.listSettlements(req.user, req.query)));
settlementRoutes.get('/:id', send(async (req) => {
  const r = await s.getSettlement(req.user, req.params.id);
  if (!r) throw notFound('SETTLEMENT_NOT_FOUND', `Settlement '${req.params.id}' not found.`);
  return r;
}));
settlementRoutes.post('/drafts', authorize('ADMIN', 'ACCOUNTANT'), validate(submitSchema), send((req) => s.submitSettlement(req.body, req.user, { draft: true }), 201));
settlementRoutes.post('/', authorize('ADMIN', 'ACCOUNTANT'), idempotency, validate(submitSchema), send((req) => s.submitSettlement(req.body, req.user, { draft: !!req.body.isDraft }), 201));
settlementRoutes.put('/:id/approve', authorize('SUPER_ADMIN', 'ADMIN'), validate(approveSchema), send((req) => s.approveSettlement(req.params.id, req.body, req.user)));
settlementRoutes.put('/:id/reject', authorize('SUPER_ADMIN', 'ADMIN'), validate(rejectSchema), send((req) => s.rejectSettlement(req.params.id, req.body.reason, req.user)));
