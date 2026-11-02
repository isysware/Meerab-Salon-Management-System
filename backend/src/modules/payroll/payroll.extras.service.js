// src/modules/payroll/payroll.extras.service.js
// Inputs that feed a payslip besides attendance/overtime (payroll.md §3.7–3.8):
//  • StaffAllowance     — recurring monthly allowance, added to every payslip while active
//  • PayrollAdjustment  — one-off ALLOWANCE | BONUS | DEDUCTION for a staff member + month (locked on finalize)
//  • SalaryAdvance      — money paid early (custody receivable, NOT an expense), recovered by payroll deductions

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch } from '../../lib/scope.js';
import { getBusinessDate, dateOnly, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { num, opt, iso } from '../../lib/dto.js';
import { payoutMoney, reverseMoney } from '../cash/cash.service.js';
import { lockStaffPayBranch, replayMoneyRequest, saveMoneyResponse } from '../../lib/hrTransactions.js';

const noAccountant = (actor) => {
  if (actor.role === 'ACCOUNTANT' || actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Payroll data is confidential.');
};

const staffInScope = async (tx, actor, staffId) => {
  const staff = await tx.staff.findUnique({ where: { id: staffId } });
  if (!staff) throw notFound('STAFF_NOT_FOUND', `Employee '${staffId}' not found.`);
  assertBranchAccess(actor, staff.branchId, 'Access Denied: Cannot manage payroll items of another branch.');
  return staff;
};

/** Payroll month already finalized (or being paid) for this branch → its inputs are frozen. */
const assertMonthOpen = async (tx, branchId, month) => {
  const run = await tx.payrollRun.findFirst({ where: { branchId, month, status: { notIn: ['DRAFT', 'CANCELLED'] } } });
  if (run) throw conflict('PAYROLL_MONTH_LOCKED', `Payroll for ${month} is already finalized (${run.payrollNumber}). Cancel that run first to change its inputs.`);
};

// ── DTOs ─────────────────────────────────────────────────────────────────────

const toAllowanceDTO = (a) => ({
  id: a.id, branchId: a.branchId, staffId: a.staffId, name: a.name, amount: num(a.amount), isActive: a.isActive,
  createdByName: a.createdByName, createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
});

const toAdjustmentDTO = (a) => ({
  id: a.id, branchId: a.branchId, staffId: a.staffId, month: a.month, type: a.type, title: a.title, amount: num(a.amount),
  notes: opt(a.notes), status: a.status, payrollRunId: opt(a.payrollRunId), locked: !!a.payrollRunId,
  createdByName: a.createdByName, createdAt: iso(a.createdAt), cancelledAt: iso(a.cancelledAt), cancelledByName: opt(a.cancelledByName),
});

export const advanceBalance = (a) =>
  round2(toDec(a.amount).minus((a.recoveries ?? []).filter((r) => r.status === 'ACTIVE').reduce((s, r) => s.plus(r.amount), toDec(0))));

const toAdvanceDTO = (a) => {
  const active = (a.recoveries ?? []).filter((r) => r.status === 'ACTIVE');
  return {
    id: a.id, advanceNumber: a.advanceNumber, branchId: a.branchId, staffId: a.staffId, staffName: a.staffName,
    amount: num(a.amount), recoveryPerMonth: num(a.recoveryPerMonth), startMonth: a.startMonth,
    recoveredAmount: num(round2(active.reduce((s, r) => s.plus(r.amount), toDec(0)))),
    balance: a.status === 'REVERSED' ? 0 : num(advanceBalance(a)),
    method: a.method, cashDrawerId: opt(a.cashDrawerId), onlineAccountId: opt(a.onlineAccountId), onlineAccountName: opt(a.onlineAccountName),
    reason: a.reason, status: a.status, issueDate: ymd(a.issueDate), issuedAt: iso(a.issuedAt), issuedByName: a.issuedByName,
    reversedAt: iso(a.reversedAt), reversedByName: opt(a.reversedByName), reversalReason: opt(a.reversalReason),
    recoveries: active.map((r) => ({ id: r.id, month: r.month, amount: num(r.amount), payrollRunId: r.payrollRunId })),
  };
};

// ── Engine inputs ────────────────────────────────────────────────────────────

/** Allowances / adjustments / advances for every staff member in `staffIds` for the month, keyed by staffId. */
export const loadPayrollExtras = async (tx, branchId, month, staffIds) => {
  const [allowances, adjustments, advances] = await Promise.all([
    tx.staffAllowance.findMany({ where: { staffId: { in: staffIds }, isActive: true }, orderBy: { createdAt: 'asc' } }),
    tx.payrollAdjustment.findMany({ where: { branchId, month, status: 'ACTIVE', payrollRunId: null, staffId: { in: staffIds } }, orderBy: { createdAt: 'asc' } }),
    tx.salaryAdvance.findMany({
      where: { branchId, status: 'ACTIVE', startMonth: { lte: month }, staffId: { in: staffIds } },
      include: { recoveries: true }, orderBy: { issuedAt: 'asc' },
    }),
  ]);
  const by = (rows, map) => (id) => rows.filter((r) => r.staffId === id).map(map);
  const a = by(allowances, (x) => ({ id: x.id, name: x.name, amount: num(x.amount) }));
  const j = by(adjustments, (x) => ({ id: x.id, type: x.type, title: x.title, amount: num(x.amount) }));
  const v = by(advances, (x) => {
    const activeThisMonth = (x.recoveries || []).filter((r) => r.status === 'ACTIVE' && r.month === month);
    const recoveredThisMonth = num(activeThisMonth.reduce((s, r) => s.plus(r.amount), toDec(0)));
    return {
      id: x.id,
      advanceNumber: x.advanceNumber,
      recoveryPerMonth: num(x.recoveryPerMonth),
      balance: num(advanceBalance(x)),
      recoveredThisMonth,
    };
  });
  return new Map(staffIds.map((id) => [id, { allowances: a(id), adjustments: j(id), advances: v(id).filter((x) => x.balance > 0) }]));
};

/** Finalize: freeze adjustments to the run and record advance recoveries. */
export const lockPayrollExtras = async (tx, runId, month, payslip) => {
  const adjIds = (payslip.adjustments ?? []).map((x) => x.id);
  if (adjIds.length) await tx.payrollAdjustment.updateMany({ where: { id: { in: adjIds } }, data: { payrollRunId: runId } });
  for (const r of payslip.advanceRecoveries ?? []) {
    await tx.advanceRecovery.create({ data: { advanceId: r.advanceId, payrollRunId: runId, staffId: payslip.staffId, month, amount: round2(r.amount) } });
    const adv = await tx.salaryAdvance.findUnique({ where: { id: r.advanceId }, include: { recoveries: true } });
    if (advanceBalance(adv).lessThanOrEqualTo(0)) await tx.salaryAdvance.update({ where: { id: adv.id }, data: { status: 'RECOVERED' } });
  }
};

/** Cancel run: unlock adjustments and release recoveries (advances become ACTIVE again). */
/** Cancel single staff payslip: unlock adjustments and release recoveries for that staff only. */
export const releasePayrollExtrasForStaff = async (tx, runId, staffId) => {
  await tx.payrollAdjustment.updateMany({ where: { payrollRunId: runId, staffId }, data: { payrollRunId: null } });
  const recs = await tx.advanceRecovery.findMany({ where: { payrollRunId: runId, staffId, status: 'ACTIVE' } });
  if (!recs.length) return;
  await tx.advanceRecovery.updateMany({ where: { payrollRunId: runId, staffId, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
  await tx.salaryAdvance.updateMany({ where: { id: { in: [...new Set(recs.map((r) => r.advanceId))] }, status: 'RECOVERED' }, data: { status: 'ACTIVE' } });
};

export const releasePayrollExtras = async (tx, runId) => {
  await tx.payrollAdjustment.updateMany({ where: { payrollRunId: runId }, data: { payrollRunId: null } });
  const recs = await tx.advanceRecovery.findMany({ where: { payrollRunId: runId, status: 'ACTIVE' } });
  if (!recs.length) return;
  await tx.advanceRecovery.updateMany({ where: { payrollRunId: runId, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
  await tx.salaryAdvance.updateMany({ where: { id: { in: [...new Set(recs.map((r) => r.advanceId))] }, status: 'RECOVERED' }, data: { status: 'ACTIVE' } });
};

// ── Allowances ───────────────────────────────────────────────────────────────

export const listAllowances = async (actor, { branchId, staffId } = {}) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.staffAllowance.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(staffId ? { staffId } : {}) }, orderBy: [{ staffId: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toAllowanceDTO);
};

export const createAllowance = async (actor, { staffId, name, amount }) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const staff = await staffInScope(tx, actor, staffId);
    const row = await tx.staffAllowance.create({
      data: { branchId: staff.branchId, staffId, name, amount: round2(amount), createdByUserId: actor.id, createdByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'ALLOWANCE_CREATED', entity: 'StaffAllowance', entityId: row.id, branchId: staff.branchId, after: { staffId, name, amount } });
    return toAllowanceDTO(row);
  });
};

export const updateAllowance = async (actor, id, input) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const before = await tx.staffAllowance.findUnique({ where: { id } });
    if (!before) throw notFound('ALLOWANCE_NOT_FOUND', `Allowance '${id}' not found.`);
    assertBranchAccess(actor, before.branchId);
    const data = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.amount !== undefined) data.amount = round2(input.amount);
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const row = await tx.staffAllowance.update({ where: { id }, data });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'ALLOWANCE_UPDATED', entity: 'StaffAllowance', entityId: id, branchId: row.branchId, before, after: row });
    return toAllowanceDTO(row);
  });
};

// ── One-off adjustments ──────────────────────────────────────────────────────

export const listAdjustments = async (actor, { branchId, month, staffId } = {}) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.payrollAdjustment.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(month ? { month } : {}), ...(staffId ? { staffId } : {}) }, orderBy: { createdAt: 'desc' },
  });
  return rows.map(toAdjustmentDTO);
};

export const createAdjustment = async (actor, { staffId, month, type, title, amount, notes }) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const staff = await staffInScope(tx, actor, staffId);
    await assertMonthOpen(tx, staff.branchId, month);
    const row = await tx.payrollAdjustment.create({
      data: { branchId: staff.branchId, staffId, month, type, title, amount: round2(amount), notes: notes || null, createdByUserId: actor.id, createdByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'PAYROLL_ADJUSTMENT_CREATED', entity: 'PayrollAdjustment', entityId: row.id, branchId: staff.branchId, after: { staffId, month, type, title, amount } });
    return toAdjustmentDTO(row);
  });
};

export const cancelAdjustment = async (actor, id) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const adj = await tx.payrollAdjustment.findUnique({ where: { id } });
    if (!adj) throw notFound('ADJUSTMENT_NOT_FOUND', `Payroll adjustment '${id}' not found.`);
    assertBranchAccess(actor, adj.branchId);
    if (adj.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'This adjustment is already cancelled.');
    if (adj.payrollRunId) throw conflict('PAYROLL_MONTH_LOCKED', 'This adjustment is part of a finalized payroll run. Cancel the run first.');
    const row = await tx.payrollAdjustment.update({
      where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actor.id, cancelledByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'PAYROLL_ADJUSTMENT_CANCELLED', entity: 'PayrollAdjustment', entityId: id, branchId: adj.branchId });
    return toAdjustmentDTO(row);
  });
};

// ── Salary advances ──────────────────────────────────────────────────────────

export const listAdvances = async (actor, { branchId, staffId, status } = {}) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.salaryAdvance.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(staffId ? { staffId } : {}), ...(status ? { status } : {}) },
    include: { recoveries: true }, orderBy: { issuedAt: 'desc' },
  });
  return rows.map(toAdvanceDTO);
};

export const issueAdvance = async (actor, input) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const replay = await replayMoneyRequest(tx, actor, input.idempotencyKey, 'POST /api/v1/payroll/advances');
    if (replay) return replay;
    const staff = await staffInScope(tx, actor, input.staffId);
    await lockStaffPayBranch(tx, staff.branchId);
    if (!staff.isActive) throw badRequest('STAFF_INACTIVE', 'Cannot issue an advance to an inactive employee.');
    const amount = round2(input.amount);
    const perMonth = round2(input.recoveryPerMonth ?? input.amount);
    if (amount.lessThanOrEqualTo(0) || perMonth.lessThanOrEqualTo(0)) throw badRequest('INVALID_AMOUNT', 'Advance and monthly recovery must be greater than zero after rounding.');
    if (perMonth.greaterThan(amount)) throw badRequest('INVALID_RECOVERY', 'Monthly recovery cannot exceed the advance amount.');
    const today = await getBusinessDate(tx);
    const startMonth = input.startMonth || today.slice(0, 7);
    await assertMonthOpen(tx, staff.branchId, startMonth);
    const branch = await tx.branch.findUnique({ where: { id: staff.branchId } });
    const advanceNumber = await nextSequence(tx, branch.code, 'ADV', Number(today.slice(0, 4)));
    const source = await payoutMoney(tx, actor, {
      branchId: staff.branchId, method: input.method, onlineAccountId: input.onlineAccountId, amount, type: 'SALARY_ADVANCE',
      sourceModule: 'PAYROLL', sourceId: advanceNumber, reference: advanceNumber, description: `Salary advance — ${staff.name}`,
    });
    const adv = await tx.salaryAdvance.create({
      data: {
        advanceNumber, branchId: staff.branchId, staffId: staff.id, staffName: staff.name, amount, recoveryPerMonth: perMonth, startMonth,
        method: input.method, ...source, reason: input.reason, issueDate: dateOnly(today), issuedByUserId: actor.id, issuedByName: actor.name,
      },
      include: { recoveries: true },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'SALARY_ADVANCE_ISSUED', entity: 'SalaryAdvance', entityId: adv.id, branchId: staff.branchId, after: { amount: amount.toNumber(), perMonth: perMonth.toNumber(), startMonth } });
    return saveMoneyResponse(tx, actor, input.idempotencyKey, 'POST /api/v1/payroll/advances', toAdvanceDTO(adv));
  });
};

export const reverseAdvance = async (actor, id, reason) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.salaryAdvance.findUnique({ where: { id } });
    if (!header) throw notFound('ADVANCE_NOT_FOUND', `Salary advance '${id}' not found.`);
    await lockStaffPayBranch(tx, header.branchId);
    await tx.$executeRaw`SELECT 1 FROM "SalaryAdvance" WHERE id = ${id} FOR UPDATE`;
    const adv = await tx.salaryAdvance.findUnique({ where: { id }, include: { recoveries: true } });
    if (!adv) throw notFound('ADVANCE_NOT_FOUND', `Salary advance '${id}' not found.`);
    assertBranchAccess(actor, adv.branchId);
    if (adv.status === 'REVERSED') throw conflict('ALREADY_REVERSED', 'This advance is already reversed.');
    if (adv.recoveries.some((r) => r.status === 'ACTIVE')) {
      throw conflict('ADVANCE_HAS_RECOVERIES', 'This advance has already been partly recovered through payroll and cannot be reversed.');
    }
    await reverseMoney(tx, actor, {
      branchId: adv.branchId, method: adv.method, onlineAccountId: adv.onlineAccountId, amount: adv.amount, sourceModule: 'PAYROLL',
      sourceId: adv.advanceNumber, reference: adv.advanceNumber, description: `Reversal of salary advance ${adv.advanceNumber}: ${reason}`,
    });
    const row = await tx.salaryAdvance.update({
      where: { id }, include: { recoveries: true },
      data: { status: 'REVERSED', reversalReason: reason, reversedAt: new Date(), reversedByUserId: actor.id, reversedByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'SALARY_ADVANCE_REVERSED', entity: 'SalaryAdvance', entityId: id, branchId: adv.branchId, after: { reason } });
    return toAdvanceDTO(row);
  });
};
