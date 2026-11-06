// src/modules/settlements/settlements.service.js
// Cash custody statement ("My Balance Sheet") and shift settlement (spec §7.2):
//   submit  → drawer locked (SETTLEMENT_PENDING), expected vs counted frozen
//   approve → variance adjustment (audited), handover drawer → vault, retained float → successor drawer
//   reject  → drawer unlocked, no money moves
// Settlements move custody only — never income or expense. Nobody may approve their own settlement.

import prisma from '../../config/prisma.js';
import { isStaffLoanMovement } from '../reports/staffLoanMovements.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, startOfDay, endOfDay, toDateString, toTimeString, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { num, opt, iso } from '../../lib/dto.js';
import { formatMinutesToTime, parseTimeToMinutes } from '../../lib/calculations/attendanceCalculations.js';
import { drawerDTOs, ensureVault, getActiveDrawer, holderBalance, lockHolder, postCashMovement } from '../cash/cash.service.js';
import { toUserDTO } from '../auth/auth.mapper.js';
import * as branches from '../branches/branches.service.js';

const clockTime = (d = new Date()) => formatMinutesToTime(parseTimeToMinutes(toTimeString(d)));

export const toSettlementDTO = (s) => ({
  id: s.id, settlementNumber: s.settlementNumber, branchId: s.branchId, drawerId: s.drawerId, date: ymd(s.date), time: s.time,
  cutoffTime: iso(s.submittedAt), expectedCash: num(s.expectedCash), countedCash: num(s.countedCash), variance: num(s.variance),
  varianceExplanation: opt(s.varianceExplanation), handoverAmount: num(s.handoverAmount), retainedFloat: num(s.retainedFloat),
  amount: num(s.handoverAmount), destinationVaultId: opt(s.destinationVaultId), destinationVaultName: opt(s.destinationVaultName),
  denominationBreakdown: s.denominationBreakdown ?? undefined, submittedByUserId: s.submittedByUserId, submittedByName: s.submittedByName,
  submittedByRole: s.submittedByRole, submittedAt: iso(s.submittedAt), receivedByUserId: opt(s.receivedByUserId),
  receivedByName: opt(s.receivedByName), reviewedAt: iso(s.reviewedAt), rejectionReason: opt(s.rejectionReason), status: s.status,
  notes: s.notes ?? '', varianceAdjustmentRecordId: opt(s.varianceAdjustmentRecordId), successorDrawerId: opt(s.successorDrawerId),
  createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
});

const toVarianceDTO = (v) => ({
  id: v.id, adjustmentNumber: v.adjustmentNumber, settlementId: v.settlementId, settlementNumber: v.settlementNumber,
  branchId: v.branchId, date: ymd(v.date), time: v.time, varianceAmount: num(v.varianceAmount), explanation: v.explanation,
  approvedByUserId: v.approvedByUserId, approvedByName: v.approvedByName, createdAt: iso(v.createdAt),
});

// ═══ CUSTODY STATEMENT ════════════════════════════════════════════════════════

const CUSTODY_TYPE = {
  BOOKING_ADVANCE: 'BOOKING_ADVANCE', BOOKING_REFUND: 'BOOKING_REFUND',
  OPENING_FLOAT: 'OPENING_FLOAT', TRANSFER_IN: 'FLOAT_RECEIVED', SETTLEMENT_IN: 'FLOAT_RECEIVED', CASH_SALE: 'POS_SALE', DUES_COLLECTION: 'DUES_COLLECTION',
  CASH_TIP: 'TIP_RECEIVED', EXPENSE: 'EXPENSE_PAID', PAYROLL_PAYOUT: 'EXPENSE_PAID', SALARY_ADVANCE: 'EXPENSE_PAID', COMMISSION_PAYOUT: 'EXPENSE_PAID',
  TIP_PAYOUT: 'EXPENSE_PAID', SUPPLIER_PAYMENT: 'EXPENSE_PAID', EXPENSE_REVERSAL: 'EXPENSE_REVERSAL_REFUND', REVERSAL: 'EXPENSE_REVERSAL_REFUND',
  SUPPLIER_REFUND: 'EXPENSE_REVERSAL_REFUND', CASH_REFUND: 'INVOICE_REFUND', SETTLEMENT_OUT: 'HANDOVER_SETTLEMENT',
  TRANSFER_OUT: 'HANDOVER_SETTLEMENT', VARIANCE_ADJUSTMENT: 'VARIANCE_ADJUSTMENT', ADJUSTMENT: 'VARIANCE_ADJUSTMENT',
};
const DOC_TYPE = { BOOKING: 'BOOKING', POS: 'INVOICE', EXPENSE: 'EXPENSE', SETTLEMENT: 'SETTLEMENT', TRANSFER: 'TRANSFER', INVENTORY: 'EXPENSE', OPENING_BALANCE: 'DRAWER' };

/**
 * Cash custody statement for one user (their drawers in one branch). Every row is a real drawer
 * movement, so the closing balance always equals the drawers' derived expected cash.
 */
export const custodyStatement = async (actor, { userId, branchId, drawerId, startDate, endDate } = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access cash custody statements.');
  const b = actor.role === 'SUPER_ADMIN' ? (branchId && branchId !== 'ALL' ? branchId : (await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' } })).id) : actor.branchId;
  if (actor.role !== 'SUPER_ADMIN' && branchId && branchId !== 'ALL' && branchId !== actor.branchId) {
    throw forbidden('BRANCH_FORBIDDEN', 'Access Denied: Cannot access balance sheet for another branch.');
  }

  let targetUserId = actor.id;
  if (userId && userId !== actor.id) {
    if (actor.role === 'SUPER_ADMIN') targetUserId = userId;
    else if (actor.role === 'ADMIN' && (await prisma.user.findFirst({ where: { id: userId, branchId: actor.branchId } }))) targetUserId = userId;
  }
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, include: { branch: { select: { name: true } } } });

  const drawers = await prisma.cashDrawer.findMany({
    where: { kind: 'DRAWER', branchId: b, custodianUserId: targetUserId, ...(drawerId ? { id: drawerId } : {}) }, orderBy: { createdAt: 'asc' },
  });
  const current = drawers.find((d) => d.status !== 'SETTLED') ?? drawers.at(-1);
  const movements = await prisma.drawerMovement.findMany({ where: { drawerId: { in: drawers.map((d) => d.id) } }, orderBy: { createdAt: 'asc' } });

  let opening = toDec(0);
  let running = toDec(0);
  const transactions = [];
  const from = startDate ? startOfDay(startDate) : null;
  const to = endDate ? endOfDay(endDate) : null;
  for (const m of movements) {
    const signed = m.direction === 'IN' ? toDec(m.amount) : toDec(m.amount).negated();
    if (from && m.createdAt < from) { opening = opening.plus(signed); continue; }
    if (to && m.createdAt > to) continue;
    if (!transactions.length) running = opening;
    running = running.plus(signed);
    transactions.push({
      id: m.id, date: toDateString(m.createdAt), time: clockTime(m.createdAt),
      type: isStaffLoanMovement(m) ? (m.direction === 'OUT' ? 'STAFF_LOAN_DISBURSEMENT' : 'STAFF_LOAN_REVERSAL') : CUSTODY_TYPE[m.type] ?? 'VARIANCE_ADJUSTMENT',
      referenceNumber: m.reference ?? m.type, description: m.description ?? m.type,
      debit: m.direction === 'IN' ? num(m.amount) : 0, credit: m.direction === 'OUT' ? num(m.amount) : 0,
      cashIn: m.direction === 'IN' ? num(m.amount) : 0, cashOut: m.direction === 'OUT' ? num(m.amount) : 0,
      runningBalance: running.toNumber(), actorUserId: m.userId, actorName: m.userName,
      documentType: DOC_TYPE[m.sourceModule] ?? 'DRAWER', documentId: m.sourceId ?? m.drawerId, movementType: m.type,
    });
  }
  if (!transactions.length) running = opening;

  const total = (types, dir) => round2(transactions.filter((t) => types.includes(t.type) && (dir === 'IN' ? t.cashIn : t.cashOut) > 0)
    .reduce((s, t) => s.plus(dir === 'IN' ? t.cashIn : t.cashOut), toDec(0))).toNumber();

  // Online collections are listed separately — they never touch physical cash custody.
  const online = await prisma.accountMovement.findMany({
    where: {
      branchId: b, userId: targetUserId, direction: 'IN', type: { in: ['CASH_SALE', 'DUES_COLLECTION', 'CASH_TIP', 'BOOKING_ADVANCE'] },
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: { account: { select: { name: true } } },
  });
  const breakdown = new Map();
  for (const o of online) {
    const row = breakdown.get(o.accountId) ?? { paymentAccountId: o.accountId, paymentAccountName: o.account.name, amount: 0, count: 0 };
    row.amount = round2(toDec(row.amount).plus(o.amount)).toNumber();
    row.count += 1;
    breakdown.set(o.accountId, row);
  }

  const branch = await branches.getBranch(b);
  const [drawerDTO] = current ? await drawerDTOs(prisma, [current]) : [];
  return {
    summary: {
      drawer: drawerDTO, user: toUserDTO(targetUser), branch,
      openingCash: startDate ? opening.toNumber() : total(['OPENING_FLOAT'], 'IN'),
      cashSalesTotal: total(['POS_SALE'], 'IN'), previousDuesCollectedTotal: total(['DUES_COLLECTION'], 'IN'),
      bookingAdvancesTotal: total(['BOOKING_ADVANCE'], 'IN'), bookingRefundsTotal: total(['BOOKING_REFUND'], 'OUT'),
      cashTipsTotal: total(['TIP_RECEIVED'], 'IN'), floatReceivedTotal: total(['FLOAT_RECEIVED'], 'IN'),
      cashExpensesPaidTotal: total(['EXPENSE_PAID'], 'OUT'),
      staffLoanDisbursementsTotal: total(['STAFF_LOAN_DISBURSEMENT'], 'OUT'),
      staffLoanReversalsTotal: total(['STAFF_LOAN_REVERSAL'], 'IN'),
      cashRefundsPaidTotal: total(['INVOICE_REFUND'], 'OUT'),
      cashReversalsRefundTotal: total(['EXPENSE_REVERSAL_REFUND'], 'IN'),
      approvedHandoversTotal: total(['HANDOVER_SETTLEMENT'], 'OUT'), expectedCashInCustody: running.toNumber(),
      lastCountedCash: current?.lastCountedCash === null || !current ? undefined : num(current.lastCountedCash),
      lastCountedTimestamp: iso(current?.lastCountedAt), lastVariance: current?.lastVariance === null || !current ? undefined : num(current.lastVariance),
      onlineCollectionsTotal: round2([...breakdown.values()].reduce((s, r) => s.plus(r.amount), toDec(0))).toNumber(),
      onlineCollectionsBreakdown: [...breakdown.values()],
    },
    transactions,
    openingBalanceCarriedForward: opening.toNumber(),
  };
};

// ═══ SETTLEMENTS ══════════════════════════════════════════════════════════════

export const listSettlements = async (actor, q = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot view account settlements.');
  const b = resolveReadBranch(actor, q.branchId);

  // If reviewPendingOnly is requested:
  // - Admin: incoming settlements submitted by ACCOUNTANT in their branch
  // - Super Admin: incoming settlements submitted by ADMIN
  const pendingFilter = q.reviewPendingOnly === 'true'
    ? (actor.role === 'ADMIN'
        ? { status: 'SUBMITTED', submittedByRole: 'ACCOUNTANT', submittedByUserId: { not: actor.id } }
        : actor.role === 'SUPER_ADMIN'
        ? { status: 'SUBMITTED', submittedByRole: 'ADMIN', submittedByUserId: { not: actor.id } }
        : { submittedByUserId: actor.id })
    : {};

  const rows = await prisma.settlement.findMany({
    where: {
      ...(b ? { branchId: b } : {}),
      ...(actor.role === 'ACCOUNTANT' ? { submittedByUserId: actor.id } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.submitterId ? { submittedByUserId: q.submitterId } : {}),
      ...(q.drawerId ? { drawerId: q.drawerId } : {}),
      ...(q.submittedByRole ? { submittedByRole: q.submittedByRole } : {}),
      ...(q.startDate || q.endDate ? { date: { ...(q.startDate ? { gte: dateOnly(q.startDate) } : {}), ...(q.endDate ? { lte: dateOnly(q.endDate) } : {}) } } : {}),
      ...pendingFilter,
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toSettlementDTO);
};

export const getSettlement = async (actor, id) => {
  const s = await prisma.settlement.findUnique({ where: { id } });
  if (!s) return null;
  assertBranchAccess(actor, s.branchId, 'Access Denied: Cannot access settlements for another branch.');
  if (actor.role === 'ACCOUNTANT' && s.submittedByUserId !== actor.id) throw forbidden('FORBIDDEN', 'Access Denied: Accountants can only view their own settlements.');
  return toSettlementDTO(s);
};

const validateSplit = ({ countedCash, handoverAmount, retainedFloat }) => {
  const counted = round2(countedCash);
  const handover = round2(handoverAmount);
  const retained = round2(retainedFloat || 0);
  if ([counted, handover, retained].some((v) => v.lessThan(0))) throw badRequest('INVALID_AMOUNT', 'All settlement amounts must be non-negative finite numbers.');
  if (!handover.plus(retained).equals(counted)) {
    throw badRequest('SPLIT_MISMATCH', `Handover amount (PKR ${handover}) + Retained float (PKR ${retained}) must equal counted cash (PKR ${counted}).`);
  }
  return { counted, handover, retained };
};

export const submitSettlement = async (input, actor, { draft = false } = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot submit account settlements.');
  const branchId = resolveWriteBranch(actor, input.branchId);
  const { counted, handover, retained } = validateSplit(input);

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch?.isActive) throw badRequest('BRANCH_INACTIVE', `Branch '${branchId}' is invalid or deactivated.`);
    const drawer = await lockHolder(tx, input.drawerId);
    if (drawer.kind !== 'DRAWER' || drawer.branchId !== branchId) throw badRequest('DRAWER_INVALID', 'Select a cash drawer of this branch.');
    if (drawer.custodianUserId !== actor.id && actor.role !== 'SUPER_ADMIN') {
      throw forbidden('FORBIDDEN', 'Access Denied: You can only submit settlements for your own cash drawer.');
    }
    if (drawer.status === 'SETTLEMENT_PENDING') throw conflict('DRAWER_LOCKED', 'This cash drawer is already locked pending settlement review. Overlapping submissions are prevented.');
    if (drawer.status === 'SETTLED') throw conflict('DRAWER_CLOSED', 'This cash drawer has already been settled and closed.');

    const expected = round2(await holderBalance(tx, drawer.id));
    const variance = round2(counted.minus(expected));
    if (!draft && !variance.isZero() && !input.varianceExplanation?.trim()) {
      throw badRequest('VARIANCE_EXPLANATION_REQUIRED', `A non-zero variance of PKR ${variance} requires an explanation before the settlement can be submitted.`);
    }

    const now = new Date();
    const today = await getBusinessDate(tx);
    const destVaultId = input.destinationVaultId || (actor.role === 'ACCOUNTANT' ? `admin-${branchId}` : `vault-${branchId}`);
    const destVaultName = input.destinationVaultName || (actor.role === 'ACCOUNTANT' ? `${branch.name} Branch Admin` : `${branch.name} Super Admin / Main Vault`);
    const s = await tx.settlement.create({
      data: {
        settlementNumber: await nextSequence(tx, branch.code, 'SET', Number(today.slice(0, 4))), branchId, drawerId: drawer.id,
        date: dateOnly(today), time: clockTime(now), expectedCash: expected, countedCash: counted, variance,
        varianceExplanation: input.varianceExplanation || null, handoverAmount: handover, retainedFloat: retained,
        destinationVaultId: destVaultId, destinationVaultName: destVaultName,
        denominationBreakdown: input.denominationBreakdown ?? undefined, notes: input.notes || (draft ? 'Draft settlement record' : `Settlement submitted by ${actor.name}`),
        submittedByUserId: actor.id, submittedByName: actor.name, submittedByRole: actor.role,
        submittedAt: draft ? null : now, status: draft ? 'DRAFT' : 'SUBMITTED',
      },
    });
    if (!draft) {
      // Freeze the count and lock the drawer: no cash may move until review.
      await tx.cashDrawer.update({
        where: { id: drawer.id }, data: { status: 'SETTLEMENT_PENDING', lastCountedCash: counted, lastCountedAt: now, lastVariance: variance },
      });
    }
    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: draft ? 'SETTLEMENT_DRAFTED' : 'SETTLEMENT_SUBMITTED', entity: 'Settlement',
      entityId: s.id, branchId, after: { expected: expected.toNumber(), counted: counted.toNumber(), variance: variance.toNumber() },
    });
    return toSettlementDTO(s);
  });
};

const loadForReview = async (tx, actor, id) => {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) {
    throw forbidden('FORBIDDEN', 'Access Denied: Only Super Admin and Branch Admin can review settlements.');
  }
  await tx.$executeRaw`SELECT 1 FROM "Settlement" WHERE id = ${id} FOR UPDATE`;
  const s = await tx.settlement.findUnique({ where: { id }, include: { drawer: true } });
  if (!s) throw notFound('SETTLEMENT_NOT_FOUND', `Settlement '${id}' not found.`);
  assertBranchAccess(actor, s.branchId, 'Access Denied: Cannot review settlements from another branch.');
  if (s.submittedByUserId === actor.id || s.drawer.custodianUserId === actor.id) {
    throw forbidden('SELF_APPROVAL_NOT_ALLOWED', 'Access Denied: You cannot review your own settlement or a settlement for your own cash drawer. An independent administrator must review.');
  }
  if (s.status !== 'SUBMITTED') throw conflict('NOT_SUBMITTED', `Cannot review settlement with status '${s.status}'. Only SUBMITTED settlements can be reviewed.`);

  // Routing hierarchy:
  // Branch Admin reviews Accountant / Sales settlements from their branch.
  // Super Admin reviews Admin settlements.
  if (actor.role === 'ADMIN' && s.submittedByRole !== 'ACCOUNTANT') {
    throw forbidden('FORBIDDEN', 'Access Denied: Branch Admins can only review settlements submitted by Branch Accountants.');
  }
  if (actor.role === 'SUPER_ADMIN' && s.submittedByRole === 'ACCOUNTANT') {
    throw forbidden('FORBIDDEN', 'Access Denied: Accountant settlements must be reviewed by the Branch Admin first.');
  }

  return s;
};

export const rejectSettlement = async (id, reason, actor) =>
  prisma.$transaction(async (tx) => {
    const s = await loadForReview(tx, actor, id);
    const updated = await tx.settlement.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason, receivedByUserId: actor.id, receivedByName: actor.name, reviewedAt: new Date() },
    });
    // Unlock so the custodian can recount and resubmit. No money moves.
    await tx.cashDrawer.update({ where: { id: s.drawerId }, data: { status: 'OPEN' } });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'SETTLEMENT_REJECTED', entity: 'Settlement', entityId: id, branchId: s.branchId, after: { reason } });
    return toSettlementDTO(updated);
  });

export const approveSettlement = async (id, input, actor) =>
  prisma.$transaction(async (tx) => {
    const s = await loadForReview(tx, actor, id);
    const branch = await tx.branch.findUnique({ where: { id: s.branchId } });
    const handover = toDec(s.handoverAmount);
    const retained = toDec(s.retainedFloat);
    const variance = toDec(s.variance);

    if (input.actualCashReceived !== undefined && !round2(input.actualCashReceived).equals(handover)) {
      throw conflict('COUNT_DISPUTED', `Count disputed: Actual cash received (PKR ${round2(input.actualCashReceived)}) does not match submitted handover amount (PKR ${handover}). Reject the settlement so the custodian can recount and resubmit.`);
    }
    // The drawer may not have changed since submission (it was locked) — re-verify anyway.
    const expectedNow = round2(await holderBalance(tx, s.drawerId));
    if (!expectedNow.equals(s.expectedCash)) throw conflict('DRAWER_CHANGED', 'Drawer balance changed since submission. Reject and resubmit the settlement.');

    const today = await getBusinessDate(tx);
    const time = clockTime();
    const common = { sourceModule: 'SETTLEMENT', sourceId: s.id, reference: s.settlementNumber, actor, allowLocked: true };

    let varianceAdjustment;
    if (!variance.isZero()) {
      if (!input.acceptVariance) {
        throw badRequest('VARIANCE_NOT_ACCEPTED', `Explicit manager acceptance is required to approve a settlement with a cash variance of PKR ${variance}.`);
      }
      // Audited variance makes the drawer ledger equal the physical count.
      await postCashMovement(tx, {
        ...common, holderId: s.drawerId, type: 'VARIANCE_ADJUSTMENT', direction: variance.greaterThan(0) ? 'IN' : 'OUT', amount: variance.abs(),
        description: `Audited cash ${variance.greaterThan(0) ? 'overage' : 'shortage'} accepted (${s.settlementNumber})`,
      });
      varianceAdjustment = await tx.cashVarianceAdjustment.create({
        data: {
          adjustmentNumber: await nextSequence(tx, branch.code, 'CVA'), settlementId: s.id, settlementNumber: s.settlementNumber,
          branchId: s.branchId, date: dateOnly(today), time, varianceAmount: variance,
          explanation: s.varianceExplanation || 'Audited cash variance accepted upon settlement review', approvedByUserId: actor.id, approvedByName: actor.name,
        },
      });
    }

    // Custody Transfer:
    // When Admin accepts Accountant's settlement -> money moves into the Branch Admin's active cash drawer.
    // When Super Admin accepts Admin's settlement -> money moves into Super Admin's active cash drawer.
    const receivingHolder = await getActiveDrawer(tx, actor, s.branchId, { autoOpen: true });

    if (handover.greaterThan(0)) {
      await postCashMovement(tx, {
        ...common,
        holderId: s.drawerId,
        type: 'SETTLEMENT_OUT',
        direction: 'OUT',
        amount: handover,
        description: `Settlement handover to ${actor.name} (${s.settlementNumber})`
      });
      await postCashMovement(tx, {
        ...common,
        holderId: receivingHolder.id,
        type: 'SETTLEMENT_IN',
        direction: 'IN',
        amount: handover,
        description: `Handover received from ${s.submittedByName} (${s.settlementNumber})`
      });
    }

    const now = new Date();
    let successor;
    if (retained.greaterThan(0)) {
      successor = await tx.cashDrawer.create({
        data: { kind: 'DRAWER', branchId: s.branchId, custodianUserId: s.drawer.custodianUserId, custodianName: s.drawer.custodianName, date: dateOnly(today) },
      });
      await postCashMovement(tx, { ...common, holderId: s.drawerId, type: 'TRANSFER_OUT', direction: 'OUT', amount: retained, description: `Retained float carried to new drawer (${s.settlementNumber})` });
      await postCashMovement(tx, { ...common, holderId: successor.id, type: 'OPENING_FLOAT', direction: 'IN', amount: retained, description: `Retained float carried forward from ${s.settlementNumber}` });
    }

    await tx.cashDrawer.update({
      where: { id: s.drawerId }, data: { status: 'SETTLED', closedAt: now, settledAt: now, successorDrawerId: successor?.id ?? null },
    });
    const updated = await tx.settlement.update({
      where: { id },
      data: {
        status: 'APPROVED',
        receivedByUserId: actor.id,
        receivedByName: actor.name,
        reviewedAt: now,
        destinationVaultId: receivingHolder.id,
        destinationVaultName: actor.role === 'ADMIN' ? `${actor.name} (Branch Admin Custody)` : `${actor.name} (Super Admin Custody)`,
        successorDrawerId: successor?.id ?? null,
        varianceAdjustmentRecordId: varianceAdjustment?.id ?? null,
        ...(input.notes ? { notes: `${s.notes ? `${s.notes} | ` : ''}Review notes: ${input.notes}` } : {}),
      },
    });
    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'SETTLEMENT_APPROVED', entity: 'Settlement', entityId: id, branchId: s.branchId,
      after: { handover: handover.toNumber(), retained: retained.toNumber(), variance: variance.toNumber() },
    });
    return {
      settlement: toSettlementDTO(updated),
      successorDrawer: successor ? (await drawerDTOs(tx, [successor]))[0] : undefined,
      varianceAdjustment: varianceAdjustment ? toVarianceDTO(varianceAdjustment) : undefined,
    };
  });
