// src/modules/commission/commission.service.js
// Commission runs are built from the dated CommissionEvent stream written by POS (EARN on posting,
// REVERSAL on refund/void — spec §4.3). A refund in October lands in October's run; September's
// finalized statement is never rewritten. Finalizing consumes the events so they can't be paid twice.

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { num, opt, iso } from '../../lib/dto.js';
import { isCompensationEligibleForCommission } from '../../lib/calculations/commissionCalculations.js';
import { payoutMoney, reverseMoney } from '../cash/cash.service.js';
import { lockCommissionBranch, assertCommissionAvailable } from './payrollCommission.js';

const runInclude = { statements: { include: { payments: true } } };
const noAccountant = (actor) => {
  if (actor.role === 'ACCOUNTANT') throw forbidden('FORBIDDEN', 'Access Denied: Accountants are not authorized to access staff commission.');
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot manage commission runs.');
};

const toPaymentDTO = (p) => ({
  id: p.id, paymentNumber: p.paymentNumber, commissionRunId: p.runId, statementId: p.statementId, staffId: p.staffId, staffName: p.staffName,
  branchId: p.branchId, amount: num(p.amount), method: p.method, cashDrawerId: opt(p.cashDrawerId), onlineAccountId: opt(p.onlineAccountId),
  onlineAccountName: opt(p.onlineAccountName), paidAt: iso(p.paidAt), paidByUserId: p.paidByUserId, paidByName: p.paidByName,
  reference: p.reference, notes: opt(p.notes), status: p.status, reversedAt: iso(p.reversedAt), reversedByUserId: opt(p.reversedByUserId),
  reversedByName: opt(p.reversedByName), reversalReason: opt(p.reversalReason),
});

const statementStatus = (runStatus, net, paid) => {
  if (['DRAFT', 'CANCELLED'].includes(runStatus)) return runStatus;
  if (paid.greaterThanOrEqualTo(net) && net.greaterThan(0)) return 'PAID';
  return paid.greaterThan(0) ? 'PARTIALLY_PAID' : 'FINALIZED';
};

const toStatementDTO = (st, run) => {
  const paid = round2((st.payments ?? []).filter((p) => p.status === 'COMPLETED').reduce((s, p) => s.plus(p.amount), toDec(0)));
  const net = toDec(st.netPayable);
  return {
    ...st.snapshot, id: st.id, commissionRunId: st.runId, statementNumber: st.statementNumber, netCommissionPayable: net.toNumber(), payrollPayslipId: opt(st.payrollPayslipId),
    paidAmount: paid.toNumber(), outstandingAmount: round2(net.minus(paid)).toNumber(), status: statementStatus(run.status, net, paid),
    attributionLines: st.snapshot.lineItems, payments: (st.payments ?? []).sort((a, b) => a.paidAt - b.paidAt).map(toPaymentDTO),
  };
};

const toRunDTO = (run, branchName, consumedIds = []) => {
  const statements = run.statements.map((s) => toStatementDTO(s, run));
  const sum = (f) => round2(statements.reduce((t, s) => t.plus(s[f]), toDec(0)));
  const payable = sum('netCommissionPayable');
  const paid = sum('paidAmount');
  return {
    id: run.id, commissionNumber: run.commissionNumber, branchId: run.branchId, branchName, startDate: ymd(run.startDate), endDate: ymd(run.endDate),
    status: statementStatus(run.status, payable, paid), totalEligibleNetSales: sum('attributedNetSales').toNumber(),
    totalCommissionPayable: payable.toNumber(), totalPaid: paid.toNumber(), totalOutstanding: round2(payable.minus(paid)).toNumber(),
    staffCount: statements.length, statements, consumedAttributionLineIds: consumedIds, generatedAt: iso(run.generatedAt),
    generatedByUserId: run.generatedByUserId, generatedByName: run.generatedByName, finalizedAt: iso(run.finalizedAt),
    finalizedByUserId: opt(run.finalizedByUserId), finalizedByName: opt(run.finalizedByName), cancelledAt: iso(run.cancelledAt),
    cancelledByUserId: opt(run.cancelledByUserId), cancelledByName: opt(run.cancelledByName), cancellationReason: opt(run.cancellationReason),
  };
};

const runDTO = async (tx, id) => {
  const run = await tx.commissionRun.findUnique({ where: { id }, include: runInclude });
  const branch = await tx.branch.findUnique({ where: { id: run.branchId } });
  const consumed = await tx.commissionEvent.findMany({ where: { consumedByRunId: id }, select: { id: true } });
  return toRunDTO(run, branch?.name, consumed.map((e) => e.id));
};

/** Build one statement per eligible staff member from unconsumed events in the window. */
export const buildStatements = async (tx, branchId, startDate, endDate, staffId, payrollStaffIds, staffIds, compensationType) => {
  const targetStaffIds = payrollStaffIds || (staffIds && staffIds.length > 0 ? staffIds : (staffId && staffId !== 'ALL' ? [staffId] : null));
  const where = {
    branchId,
    ...(targetStaffIds ? { id: { in: targetStaffIds } } : { isActive: true }),
    ...(compensationType && compensationType !== 'ALL' ? { compensationType } : {})
  };
  const staffRows = await tx.staff.findMany({ where, orderBy: { employeeCode: 'asc' } });
  const eligible = targetStaffIds ? staffRows : staffRows.filter((s) => isCompensationEligibleForCommission(s.compensationType));
  const events = await tx.commissionEvent.findMany({
    where: { branchId, consumedByRunId: null, eventDate: { gte: dateOnly(startDate), lte: dateOnly(endDate) }, staffId: { in: eligible.map((s) => s.id) } },
    orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }],
  });
  const lineIds = [...new Set(events.map((e) => e.lineId))];
  const lines = await tx.invoiceLine.findMany({ where: { id: { in: lineIds } }, include: { components: true, invoice: { select: { clientName: true } } } });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  return eligible.map((s) => {
    const mine = events.filter((e) => e.staffId === s.id);
    let earned = toDec(0);
    let reversed = toDec(0);
    let attributed = toDec(0);
    let services = 0;
    const lineItems = mine.map((e) => {
      const line = lineById.get(e.lineId);
      const comp = e.componentId ? line?.components.find((c) => c.id === e.componentId) : null;
      const sign = e.type === 'EARN' ? 1 : -1;
      if (e.type === 'EARN') { earned = earned.plus(e.amount); attributed = attributed.plus(e.attributedNet); services += comp ? comp.quantity : num(line?.quantity ?? 1); }
      else { reversed = reversed.plus(e.amount); attributed = attributed.minus(e.attributedNet); }
      const catalogue = comp ? num(comp.allocatedAmount) : num(toDec(line?.unitPrice ?? 0).times(line?.quantity ?? 1));
      return {
        id: e.id, invoiceId: e.invoiceId, invoiceNumber: e.invoiceNumber, date: ymd(e.eventDate), clientName: line?.invoice.clientName ?? '',
        serviceOrPackageId: comp ? comp.serviceId : line?.itemId, serviceOrPackageName: comp ? comp.serviceName : line?.name,
        itemType: comp ? 'PACKAGE' : 'SERVICE', isPackageComponent: !!comp, componentPackageName: comp ? line?.name : undefined,
        cataloguePrice: catalogue, discountAllocation: comp ? 0 : num(line?.discountAllocated ?? 0),
        netAttributedAmount: sign * num(e.attributedNet), commissionRatePercent: num(e.rate), commissionEarned: sign * num(e.amount),
        eventType: e.type,
      };
    });
    const net = Decimal_max0(round2(earned.minus(reversed)));
    return {
      staff: s, eventIds: mine.map((e) => e.id), net,
      snapshot: {
        staffId: s.id, staffName: s.name, employeeCode: s.employeeCode, designation: s.designation, branchId, startDate, endDate,
        compensationType: s.compensationType, commissionRatePercent: num(s.commissionRate), servicesCompletedCount: services,
        attributedNetSales: round2(attributed).toNumber(), grossCommissionEarned: round2(earned).toNumber(),
        refundAdjustments: round2(reversed.negated()).toNumber(), lineItems,
      },
    };
  });
};

const Decimal_max0 = (d) => (d.lessThan(0) ? toDec(0) : d);

// ── Queries ──────────────────────────────────────────────────────────────────

export const listRuns = async (actor, { branchId } = {}) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, branchId);
  const runs = await prisma.commissionRun.findMany({
    where: {
      status: { not: 'DRAFT' },
      commissionNumber: { not: 'DRAFT' },
      ...(b ? { branchId: b } : {}),
    },
    include: runInclude,
    orderBy: { generatedAt: 'desc' },
  });
  const branches = new Map((await prisma.branch.findMany()).map((x) => [x.id, x.name]));
  const consumed = await prisma.commissionEvent.findMany({ where: { consumedByRunId: { in: runs.map((r) => r.id) } }, select: { id: true, consumedByRunId: true } });
  return runs.map((r) => toRunDTO(r, branches.get(r.branchId), consumed.filter((e) => e.consumedByRunId === r.id).map((e) => e.id)));
};

// ── Preview / finalize / cancel ──────────────────────────────────────────────

export const generatePreview = async (actor, { branchId: requested, startDate, endDate, staffId, staffIds, compensationType }) => {
  noAccountant(actor);
  if (startDate > endDate) throw badRequest('INVALID_RANGE', 'Start date must be on or before end date.');
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot generate commission for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockCommissionBranch(tx, branchId);
    const built = await buildStatements(tx, branchId, startDate, endDate, staffId, null, staffIds, compensationType);
    await tx.commissionRun.deleteMany({ where: { branchId, status: 'DRAFT', startDate: dateOnly(startDate), endDate: dateOnly(endDate) } });
    const run = await tx.commissionRun.create({
      data: {
        branchId, startDate: dateOnly(startDate), endDate: dateOnly(endDate), generatedByUserId: actor.id, generatedByName: actor.name,
        statements: { create: built.map((b) => ({ staffId: b.staff.id, snapshot: b.snapshot, netPayable: b.net })) },
      },
    });
    return runDTO(tx, run.id);
  });
};

export const finalizeRun = async (actor, runId) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.commissionRun.findUnique({ where: { id: runId } });
    if (!header) throw notFound('COMMISSION_NOT_FOUND', 'Commission run not found.');
    await lockCommissionBranch(tx, header.branchId);
    await tx.$executeRaw`SELECT 1 FROM "CommissionRun" WHERE id = ${runId} FOR UPDATE`;
    const draft = await tx.commissionRun.findUnique({ where: { id: runId } });
    if (!draft) throw notFound('COMMISSION_NOT_FOUND', `Commission run '${runId}' not found. Please generate a preview first.`);
    assertBranchAccess(actor, draft.branchId, 'Access Denied: Cannot finalize commission for another branch.');
    if (draft.status !== 'DRAFT') throw conflict('NOT_DRAFT', `Commission run is already in status '${draft.status}' and cannot be finalized.`);

    // Serialise finalizations per branch so two runs can never consume the same events.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commission:${draft.branchId}`}::text))`;
    const draftStatements = await tx.commissionStatement.findMany({ where: { runId }, select: { staffId: true } });
    const draftStaffIds = draftStatements.map((s) => s.staffId);
    const built = await buildStatements(tx, draft.branchId, ymd(draft.startDate), ymd(draft.endDate), null, null, draftStaffIds.length > 0 ? draftStaffIds : null);
    const branch = await tx.branch.findUnique({ where: { id: draft.branchId } });
    const year = Number(ymd(draft.startDate).slice(0, 4));
    await tx.commissionStatement.deleteMany({ where: { runId } });
    for (const b of built) {
      await tx.commissionStatement.create({
        data: { runId, staffId: b.staff.id, statementNumber: await nextSequence(tx, branch.code, 'CS', year), snapshot: b.snapshot, netPayable: b.net },
      });
      if (b.eventIds.length) await tx.commissionEvent.updateMany({ where: { id: { in: b.eventIds } }, data: { consumedByRunId: runId } });
    }
    await tx.commissionRun.update({
      where: { id: runId },
      data: { status: 'FINALIZED', commissionNumber: await nextSequence(tx, branch.code, 'COM', year), finalizedAt: new Date(), finalizedByUserId: actor.id, finalizedByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'COMMISSION_FINALIZED', entity: 'CommissionRun', entityId: runId, branchId: draft.branchId });
    return runDTO(tx, runId);
  });
};

export const cancelRun = async (actor, runId, reason) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.commissionRun.findUnique({ where: { id: runId } });
    if (!header) throw notFound('COMMISSION_NOT_FOUND', 'Commission run not found.');
    await lockCommissionBranch(tx, header.branchId);
    const run = await tx.commissionRun.findUnique({ where: { id: runId }, include: { payments: true, statements: true } });
    if (!run) throw notFound('COMMISSION_NOT_FOUND', `Commission run '${runId}' not found.`);
    assertBranchAccess(actor, run.branchId, 'Access Denied: Cannot cancel commission run for another branch.');

    // If this is an unfinalized draft, delete it completely so it leaves no footprint
    if (run.status === 'DRAFT' || run.commissionNumber === 'DRAFT') {
      await tx.commissionStatement.deleteMany({ where: { runId } });
      await tx.commissionRun.delete({ where: { id: runId } });
      return { id: runId, status: 'DELETED' };
    }

    if (run.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'This commission run is already cancelled.');
    if (run.statements.some((s) => s.payrollPayslipId)) throw conflict('COMMISSION_LINKED_TO_PAYROLL', 'Cancel the linked payroll before cancelling this commission run.');
    if (run.payments.some((p) => p.status === 'COMPLETED')) throw conflict('HAS_PAYMENTS', 'Runs with payments cannot be cancelled until all payments are properly reversed.');
    await tx.commissionEvent.updateMany({ where: { consumedByRunId: runId }, data: { consumedByRunId: null } });
    await tx.commissionRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED', cancellationReason: reason, cancelledAt: new Date(), cancelledByUserId: actor.id, cancelledByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'COMMISSION_CANCELLED', entity: 'CommissionRun', entityId: runId, branchId: run.branchId, after: { reason } });
    return runDTO(tx, runId);
  });
};

// ── Payments ─────────────────────────────────────────────────────────────────

export const recordPayment = async (actor, input) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.commissionRun.findUnique({ where: { id: input.commissionRunId } });
    if (!header) throw notFound('COMMISSION_NOT_FOUND', 'Commission run not found.');
    await lockCommissionBranch(tx, header.branchId);
    const requestKey = input.idempotencyKey ? `${actor.id}:commission:${input.idempotencyKey}` : null;
    if (requestKey) {
      const replay = await tx.commissionPayment.findUnique({ where: { requestKey } });
      if (replay) return { commissionRun: await runDTO(tx, replay.runId), payment: toPaymentDTO(replay) };
    }
    await tx.$executeRaw`SELECT 1 FROM "CommissionStatement" WHERE id = ${input.statementId} FOR UPDATE`;
    const run = await tx.commissionRun.findUnique({ where: { id: input.commissionRunId }, include: runInclude });
    if (!run) throw notFound('COMMISSION_NOT_FOUND', `Commission run '${input.commissionRunId}' not found.`);
    assertBranchAccess(actor, run.branchId, 'Access Denied: Cannot record payment for another branch.');
    if (['DRAFT', 'CANCELLED'].includes(run.status)) throw conflict('RUN_NOT_PAYABLE', `Cannot record payment on a commission run in '${run.status}' status.`);
    const st = run.statements.find((s) => s.id === input.statementId);
    if (!st) throw notFound('STATEMENT_NOT_FOUND', `Statement '${input.statementId}' not found in this commission run.`);
    if (st.payrollPayslipId) throw conflict('COMMISSION_LINKED_TO_PAYROLL', 'This commission is included in payroll. Pay or reverse it through the linked payslip.');
    const dto = toStatementDTO(st, run);
    const amount = round2(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw badRequest('INVALID_AMOUNT', 'Payment must be greater than zero.');
    if (amount.greaterThan(dto.outstandingAmount)) throw badRequest('OVERPAYMENT', `Payment amount (${amount}) exceeds outstanding commission balance (${dto.outstandingAmount}).`);
    await assertCommissionAvailable(tx, run.branchId, st.staffId, amount);

    const branch = await tx.branch.findUnique({ where: { id: run.branchId } });
    const paymentNumber = await nextSequence(tx, branch.code, 'COMPAY', Number((await getBusinessDate(tx)).slice(0, 4)));
    const source = await payoutMoney(tx, actor, {
      branchId: run.branchId, method: input.method, onlineAccountId: input.onlineAccountId, amount, type: 'COMMISSION_PAYOUT',
      sourceModule: 'COMMISSION', sourceId: st.id, reference: paymentNumber, description: `Commission payout — ${dto.staffName}`,
    });
    const payment = await tx.commissionPayment.create({
      data: {
        paymentNumber, runId: run.id, statementId: st.id, staffId: st.staffId, staffName: dto.staffName, branchId: run.branchId, amount, requestKey,
        method: input.method, ...source, reference: input.reference || '', notes: input.notes || null, paidByUserId: actor.id, paidByName: actor.name,
      },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'COMMISSION_PAID', entity: 'CommissionPayment', entityId: payment.id, branchId: run.branchId, after: { amount: amount.toNumber() } });
    return { commissionRun: await runDTO(tx, run.id), payment: toPaymentDTO(payment) };
  });
};

export const reversePayment = async (actor, paymentId, reason) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.commissionPayment.findUnique({ where: { id: paymentId } });
    if (!header) throw notFound('PAYMENT_NOT_FOUND', 'Commission payment not found.');
    await lockCommissionBranch(tx, header.branchId);
    await tx.$executeRaw`SELECT 1 FROM "CommissionPayment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.commissionPayment.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', `Commission payment '${paymentId}' not found.`);
    assertBranchAccess(actor, p.branchId, 'Access Denied: Cannot reverse payments of another branch.');
    if (p.payrollPaymentId) throw conflict('COMMISSION_LINKED_TO_PAYROLL', 'Reverse the combined payment through Payroll.');
    const statement = await tx.commissionStatement.findUnique({ where: { id: p.statementId } });
    if (statement.payrollPayslipId) throw conflict('COMMISSION_LINKED_TO_PAYROLL', 'Cancel the linked payroll before reversing an earlier standalone commission payout.');
    if (p.status === 'REVERSED') throw conflict('ALREADY_REVERSED', 'This commission payment is already reversed.');
    await reverseMoney(tx, actor, {
      branchId: p.branchId, method: p.method, onlineAccountId: p.onlineAccountId, amount: p.amount, sourceModule: 'COMMISSION',
      sourceId: p.id, reference: p.paymentNumber, description: `Reversal of commission payment ${p.paymentNumber}: ${reason}`,
    });
    const updated = await tx.commissionPayment.update({
      where: { id: paymentId },
      data: { status: 'REVERSED', reversalReason: reason, reversedAt: new Date(), reversedByUserId: actor.id, reversedByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'COMMISSION_PAYMENT_REVERSED', entity: 'CommissionPayment', entityId: paymentId, branchId: p.branchId, after: { reason } });
    return toPaymentDTO(updated);
  });
};

export const personalStatements = async (actor) => {
  if (!actor.staffId) throw forbidden('FORBIDDEN', 'Staff record associated with the authenticated user could not be found.');
  const rows = await prisma.commissionStatement.findMany({
    where: { staffId: actor.staffId, run: { status: { notIn: ['DRAFT', 'CANCELLED'] } } }, include: { payments: true, run: true },
  });
  return rows.map((st) => toStatementDTO(st, st.run)).sort((a, b) => b.endDate.localeCompare(a.endDate));
};
