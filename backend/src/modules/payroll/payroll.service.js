// src/modules/payroll/payroll.service.js
// Payroll (spec §10.2): preview (DRAFT, recalculated any time) → finalize (immutable payslip snapshots,
// overtime locked, salary liability recognised — NO money moves) → payments (cash/online, money moves)
// → reversal (dated, money comes back). Uses the same calculation engine as the frontend.

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { getBusinessDate, dateOnly, ymd, isYmd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { nextSequence, nextPeriodSequence } from '../../lib/sequence.js';
import { num, opt, iso } from '../../lib/dto.js';
import { evaluateEmployeePayroll, getCalendarDaysInMonth, getDatesInRange, resolveTermsAt } from '../../lib/calculations/payrollCalculations.js';
import { advanceBalance, loadPayrollExtras, lockPayrollExtras, releasePayrollExtras, releasePayrollExtrasForStaff } from './payroll.extras.service.js';
import { payoutMoney, reverseMoney } from '../cash/cash.service.js';
import { getPayrollPolicy } from '../settings/settings.service.js';
import { toStaffDTO } from '../staff/staff.mapper.js';
import { toAttendanceDTO } from '../attendance/attendance.service.js';
import { toOvertimeDTO } from '../attendance/overtime.service.js';
import { lockCommissionBranch, combinedContract, payrollCommission, assertCommissionAvailable, completedAmount } from '../commission/payrollCommission.js';

const runInclude = { payslips: { include: { payments: true } } };
const noAccountant = (actor) => {
  if (actor.role === 'ACCOUNTANT') throw forbidden('FORBIDDEN', 'Access Denied: Accountants are not authorized to access confidential payroll.');
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access payroll run management.');
};

export const toPaymentDTO = (p) => ({
  id: p.id, paymentNumber: p.paymentNumber, payrollRunId: p.runId, payslipId: p.payslipId, staffId: p.staffId, staffName: p.staffName,
  branchId: p.branchId, amount: round2(toDec(p.amount).plus(p.commissionAmount ?? 0)).toNumber(), salaryAmount: num(p.amount), commissionAmount: num(p.commissionAmount ?? 0), method: p.method, cashDrawerId: opt(p.cashDrawerId), onlineAccountId: opt(p.onlineAccountId),
  onlineAccountName: opt(p.onlineAccountName), paidAt: iso(p.paidAt), paidByUserId: p.paidByUserId, paidByName: p.paidByName,
  reference: p.reference, notes: opt(p.notes), status: p.status, reversedAt: iso(p.reversedAt), reversedByUserId: opt(p.reversedByUserId),
  reversedByName: opt(p.reversedByName), reversalReason: opt(p.reversalReason),
});

/** Payslip DTO: frozen calculation snapshot + live payment state. */
const toPayslipDTO = (ps, run) => {
  const completed = (ps.payments ?? []).filter((p) => p.status === 'COMPLETED');
  const salaryPaid = completedAmount(completed);
  // Preserve legacy finalized payments if commission was historically paid in payroll
  const legacyCommissionPaid = completed.reduce((s, p) => s.plus(p.commissionAmount ?? 0), toDec(0));
  const hasLegacyCommission = legacyCommissionPaid.greaterThan(0);

  const paid = hasLegacyCommission
    ? round2(completed.reduce((s, p) => s.plus(p.amount).plus(p.commissionAmount ?? 0), toDec(0)))
    : salaryPaid;
  const commission = hasLegacyCommission ? toDec(ps.snapshot.commissionPayable ?? 0) : toDec(0);
  const net = hasLegacyCommission ? toDec(ps.netPayable).plus(commission) : toDec(ps.netPayable);
  const outstanding = round2(net.minus(paid));
  const status = run.status === 'DRAFT' || run.status === 'CANCELLED' ? run.status
    : outstanding.lessThanOrEqualTo(0) && net.greaterThan(0) ? 'PAID' : paid.greaterThan(0) ? 'PARTIALLY_PAID' : 'FINALIZED';
  const snapshot = ps.snapshot;
  const money = (value) => num(value ?? 0).toLocaleString();
  const formula = hasLegacyCommission
    ? `Base (Rs. ${money(snapshot.baseEarnings)}) + Paid Leave/Holidays (Rs. ${money((snapshot.leaveEarnings ?? 0) + (snapshot.holidayEarnings ?? 0))}) + OT (Rs. ${money(snapshot.approvedOvertimeAmount)}) + Allowances (Rs. ${money(snapshot.allowancesTotal)}) + Legacy Commission (Rs. ${money(commission)}) - Deductions (Rs. ${money((snapshot.absenceDeductions ?? 0) + (snapshot.attendancePenaltyDeductions ?? 0) + (snapshot.otherDeductions ?? 0))}) - Loan (Rs. ${money(snapshot.advanceRecoveryAmount)}) = Net Payable (Rs. ${money(net)})`
    : (snapshot.calculationDetails?.formula || `Base (Rs. ${money(snapshot.baseEarnings)}) + Paid Leave/Holidays (Rs. ${money((snapshot.leaveEarnings ?? 0) + (snapshot.holidayEarnings ?? 0))}) + OT (Rs. ${money(snapshot.approvedOvertimeAmount)}) + Allowances (Rs. ${money(snapshot.allowancesTotal)}) - Deductions (Rs. ${money((snapshot.absenceDeductions ?? 0) + (snapshot.attendancePenaltyDeductions ?? 0) + (snapshot.otherDeductions ?? 0))}) - Loan (Rs. ${money(snapshot.advanceRecoveryAmount)}) = Net Payable (Rs. ${money(net)})`);

  return {
    ...ps.snapshot, id: ps.id, payrollRunId: ps.runId, payslipNumber: ps.payslipNumber, netPayable: net.toNumber(),
    salaryNetPayable: num(ps.netPayable), salaryPaidAmount: salaryPaid.toNumber(), commissionPayable: commission.toNumber(), combinedNetPayable: net.toNumber(),
    paidAmount: paid.toNumber(), outstandingAmount: outstanding.toNumber(), status,
    calculationDetails: { ...snapshot.calculationDetails, formula },
    payments: (ps.payments ?? []).sort((a, b) => a.paidAt - b.paidAt).map(toPaymentDTO),
  };
};

export const toRunDTO = (run, branchName) => {
  const payslips = run.payslips.map((ps) => toPayslipDTO(ps, run));
  const totalPayable = round2(payslips.reduce((s, p) => s.plus(p.netPayable), toDec(0)));
  const totalPaid = round2(payslips.reduce((s, p) => s.plus(p.paidAmount), toDec(0)));
  const outstanding = round2(totalPayable.minus(totalPaid));
  const status = ['DRAFT', 'CANCELLED'].includes(run.status) ? run.status
    : outstanding.lessThanOrEqualTo(0) && totalPayable.greaterThan(0) ? 'PAID' : totalPaid.greaterThan(0) ? 'PARTIALLY_PAID' : 'FINALIZED';
  return {
    id: run.id, payrollNumber: run.payrollNumber, branchId: run.branchId, branchName, month: run.month, status,
    totalPayable: totalPayable.toNumber(), totalPaid: totalPaid.toNumber(), totalOutstanding: outstanding.toNumber(),
    employeeCount: payslips.length, payslips, policySnapshot: run.policySnapshot, generatedAt: iso(run.generatedAt),
    startDate: run.policySnapshot?.startDate,
    endDate: run.policySnapshot?.endDate,
    runType: run.policySnapshot?.runType || 'MONTHLY',
    compensationTypeFilter: run.policySnapshot?.compensationTypeFilter,
    generatedByUserId: run.generatedByUserId, generatedByName: run.generatedByName, finalizedAt: iso(run.finalizedAt),
    finalizedByUserId: opt(run.finalizedByUserId), finalizedByName: opt(run.finalizedByName), cancelledAt: iso(run.cancelledAt),
    cancelledByUserId: opt(run.cancelledByUserId), cancelledByName: opt(run.cancelledByName), cancellationReason: opt(run.cancellationReason),
    notes: opt(run.notes),
  };
};

const runDTO = async (tx, id) => {
  const run = await tx.payrollRun.findUnique({ where: { id }, include: runInclude });
  const branch = await tx.branch.findUnique({ where: { id: run.branchId } });
  return toRunDTO(run, branch?.name);
};

/**
 * Evaluate staff employed in the branch during the period with the shared engine: active staff who
 * joined on/before period end, plus staff who left during the period (exitDate ≥ period start).
 * Pay terms are the ones in force on the last employed day of the period (StaffCompensationHistory).
 */
const evaluateBranchMonth = async (tx, actor, branchId, month, staffId, options = {}) => {
  const totalDays = getCalendarDaysInMonth(month);
  const defaultStart = `${month}-01`;
  const defaultEnd = `${month}-${String(totalDays).padStart(2, '0')}`;
  const startDate = options.startDate || defaultStart;
  const selectedEnd = options.endDate || (options.runType === 'DAILY' ? startDate : defaultEnd);
  const today = await getBusinessDate(tx);
  const endDate = selectedEnd > today ? today : selectedEnd;
  if (startDate > endDate) throw badRequest('FUTURE_PAYROLL', 'Payroll cannot include future salary days. Select a period on or before the business date.');
  const runType = options.runType || (startDate === endDate ? 'DAILY' : (startDate !== defaultStart || endDate !== defaultEnd) ? 'CUSTOM_RANGE' : 'MONTHLY');
  const compensationType = options.compensationType;
  const staffIds = options.staffIds;
  const includeDaily = options.includeDaily ?? true;

  const from = dateOnly(startDate);
  const to = dateOnly(endDate);
  const policy = await getPayrollPolicy({ ...actor, role: 'SUPER_ADMIN' }, branchId);

  // Load existing finalized runs to prevent duplicate salary or overtime on overlapping dates
  const finalizedRuns = await tx.payrollRun.findMany({
    where: {
      branchId,
      status: { notIn: ['DRAFT', 'CANCELLED'] },
      ...(options.excludeRunId ? { id: { not: options.excludeRunId } } : {}),
      month,
    },
    include: { payslips: true },
  });

  const alreadyFinalizedByStaff = new Map();
  const finalizedBaseByStaff = new Map();
  for (const fr of finalizedRuns) {
    for (const ps of fr.payslips) {
      finalizedBaseByStaff.set(ps.staffId, round2(toDec(finalizedBaseByStaff.get(ps.staffId) || 0).plus(ps.snapshot?.baseEarnings || 0)).toNumber());
      if (!alreadyFinalizedByStaff.has(ps.staffId)) {
        alreadyFinalizedByStaff.set(ps.staffId, new Set());
      }
      const set = alreadyFinalizedByStaff.get(ps.staffId);
      const dCount = getCalendarDaysInMonth(fr.month);
      getDatesInRange(fr.policySnapshot?.startDate || ps.snapshot?.startDate || `${fr.month}-01`, fr.policySnapshot?.endDate || ps.snapshot?.endDate || `${fr.month}-${String(dCount).padStart(2, '0')}`)
        .filter((d) => (!ps.snapshot?.joiningDate || ps.snapshot.joiningDate <= d) && (!ps.snapshot?.exitDate || ps.snapshot.exitDate >= d))
        .forEach((d) => set.add(d));
    }
  }

  const staffRows = await tx.staff.findMany({
    where: {
      branchId,
      joiningDate: { lte: to },
      ...(staffIds && staffIds.length ? { id: { in: staffIds } } : staffId ? { id: staffId } : {}),
      OR: [{ isActive: true }, { exitDate: { gte: from } }],
    },
    include: { compensationHistory: true },
    orderBy: { employeeCode: 'asc' },
  });

  const attendanceRows = await tx.attendanceRecord.findMany({
    where: { branchId, workDate: { gte: from, lte: to } },
    include: { punches: true, corrections: true },
  });
  const otRows = await tx.overtimeRecord.findMany({
    where: { branchId, workDate: { gte: from, lte: to }, status: 'APPROVED', payrollRunId: null },
  });
  const holidays = (await tx.branchHoliday.findMany({ where: { branchId: { in: ['ALL', branchId] } } }))
    .map((h) => ({ id: h.id, branchId: h.branchId, date: h.date.toISOString().slice(0, 10), title: h.title }));
  const extras = await loadPayrollExtras(tx, branchId, month, staffRows.map((s) => s.id));

  const byId = new Map(staffRows.map((s) => [s.id, s]));
  const attendance = attendanceRows.map((a) => toAttendanceDTO(a, byId.get(a.staffId)));
  const overtime = otRows.map((o) => toOvertimeDTO(o, byId.get(o.staffId)));

  const results = [];
  for (const s of staffRows) {
    const dto = toStaffDTO(s);
    if (dto.exitDate && dto.exitDate < startDate) continue;
    const lastDay = dto.exitDate && dto.exitDate < endDate ? dto.exitDate : endDate;
    const history = s.compensationHistory.map((h) => ({ effectiveDate: ymd(h.effectiveDate), snapshot: h.snapshot }));
    const terms = resolveTermsAt(dto, history, lastDay);

    const isDaily = ['DAILY_SALARY', 'DAILY_PLUS_COMMISSION'].includes(terms.compensationType);
    const isMonthly = ['MONTHLY_SALARY', 'MONTHLY_PLUS_COMMISSION', 'COMMISSION_ONLY'].includes(terms.compensationType);

    if (compensationType && compensationType !== 'ALL') {
      if (terms.compensationType !== compensationType) continue;
    }
    if (runType === 'MONTHLY') {
      if (!isMonthly && !includeDaily) continue;
    }

    const staffFinalizedDates = alreadyFinalizedByStaff.get(s.id) || new Set();
    const evalResult = evaluateEmployeePayroll(
      terms,
      month,
      policy,
      attendance,
      overtime,
      holidays,
      extras.get(s.id),
      {
        startDate,
        endDate,
        runType,
        alreadyFinalizedDates: staffFinalizedDates,
        alreadyFinalizedBaseEarnings: finalizedBaseByStaff.get(s.id) || 0,
      }
    );

    results.push({ staff: s, ...evalResult });
  }

  return {
    policy,
    results,
    alreadyFinalizedByStaff,
    startDate,
    endDate,
    runType,
    compensationType,
  };
};

// ── Queries ──────────────────────────────────────────────────────────────────

export const listRuns = async (actor, { branchId, month } = {}) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, branchId);
  const runs = await prisma.payrollRun.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(month ? { month } : {}) }, include: runInclude, orderBy: [{ month: 'desc' }, { generatedAt: 'desc' }],
  });
  const branches = new Map((await prisma.branch.findMany()).map((x) => [x.id, x.name]));
  return runs.map((r) => toRunDTO(r, branches.get(r.branchId)));
};

// ── Preview / finalize / cancel ──────────────────────────────────────────────

export const generatePreview = async (actor, { branchId: requested, month: reqMonth, staffId, staffIds, startDate, endDate, runType, compensationType, includeDaily }) => {
  noAccountant(actor);
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot generate payroll for another branch.');
  return prisma.$transaction(async (tx) => {
    await lockCommissionBranch(tx, branchId);
    const today = await getBusinessDate(tx);
    const month = reqMonth || (startDate ? startDate.slice(0, 7) : today.slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('INVALID_MONTH', 'Select a valid payroll month.');
    const totalDays = getCalendarDaysInMonth(month);
    const defaultStart = `${month}-01`;
    const defaultEnd = `${month}-${String(totalDays).padStart(2, '0')}`;

    let effStartDate = startDate || defaultStart;
    let effEndDate = endDate || (runType === 'DAILY' ? effStartDate : defaultEnd);
    if (!isYmd(effStartDate) || !isYmd(effEndDate) || effStartDate > effEndDate) throw badRequest('INVALID_RANGE', 'Select a valid start date and end date in order.');
    if (effStartDate.slice(0, 7) !== month || effEndDate.slice(0, 7) !== month) throw badRequest('INVALID_RANGE', 'Payroll dates must fall within the selected payroll month.');
    if (runType === 'DAILY' && effStartDate !== effEndDate) throw badRequest('INVALID_RANGE', 'Daily payroll must cover exactly one day.');
    let effRunType = runType;
    if (!effRunType) {
      if (effStartDate === effEndDate) effRunType = 'DAILY';
      else if (effStartDate !== defaultStart || effEndDate !== defaultEnd) effRunType = 'CUSTOM_RANGE';
      else effRunType = 'MONTHLY';
    }
    if (effRunType === 'MONTHLY' && (effStartDate !== defaultStart || effEndDate !== defaultEnd)) effRunType = 'CUSTOM_RANGE';
    // Keep the monthly selection, but reserve and calculate only elapsed business days.
    if (effEndDate > today) effEndDate = today;
    if (effStartDate > effEndDate) throw badRequest('FUTURE_PAYROLL', 'Payroll cannot include future salary days. Select a period on or before the business date.');

    const { policy, results } = await evaluateBranchMonth(tx, actor, branchId, month, staffId, {
      startDate: effStartDate,
      endDate: effEndDate,
      runType: effRunType,
      compensationType,
      staffIds,
      includeDaily: includeDaily ?? true,
    });
    if (!results.length) throw badRequest('NO_ELIGIBLE_STAFF', 'No employees match this payroll period and compensation type.');

    // Salary does not include commission; commission is managed separately via Commission page.
    // Replace only an equivalent draft; preserve drafts for other employees, types and periods.
    await tx.payrollRun.deleteMany({ where: { branchId, month, status: 'DRAFT', AND: [
      { policySnapshot: { path: ['startDate'], equals: effStartDate } },
      { policySnapshot: { path: ['endDate'], equals: effEndDate } },
      { policySnapshot: { path: ['runType'], equals: effRunType } },
      { policySnapshot: { path: ['compensationTypeFilter'], equals: compensationType || 'ALL' } },
      { policySnapshot: { path: ['staffIdFilter'], equals: staffId || null } },
      { policySnapshot: { path: ['staffIdsFilter'], equals: staffIds || null } },
    ] } });
    const run = await tx.payrollRun.create({
      data: {
        branchId, month, status: 'DRAFT',
        policySnapshot: {
          ...policy,
          startDate: effStartDate,
          endDate: effEndDate,
          runType: effRunType,
          compensationTypeFilter: compensationType || 'ALL',
          staffIdFilter: staffId || null,
          staffIdsFilter: staffIds || null,
          includeDaily: includeDaily ?? true,
        },
        generatedByUserId: actor.id,
        generatedByName: actor.name,
        payslips: {
          create: results.map((r) => ({
            staffId: r.staff.id, snapshot: { ...r.payslip, commissionPayable: 0, canFinalize: r.canFinalize, blockReason: r.blockReason },
            netPayable: toDec(r.payslip.netPayable), grossPayable: toDec(r.payslip.grossPayable),
          })),
        },
      },
    });
    return runDTO(tx, run.id);
  });
};

export const finalizeRun = async (actor, runId, options = {}) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!header) throw notFound('PAYROLL_NOT_FOUND', 'Payroll run not found.');
    await lockCommissionBranch(tx, header.branchId);
    await tx.$executeRaw`SELECT 1 FROM "PayrollRun" WHERE id = ${runId} FOR UPDATE`;
    const draft = await tx.payrollRun.findUnique({ where: { id: runId }, include: { payslips: true } });
    if (!draft) throw notFound('PAYROLL_NOT_FOUND', `Payroll run '${runId}' not found. Please generate a preview first.`);
    assertBranchAccess(actor, draft.branchId, 'Access Denied: Cannot finalize payroll for another branch.');
    if (draft.status !== 'DRAFT') throw conflict('NOT_DRAFT', `Payroll run is already in status '${draft.status}' and cannot be finalized.`);

    const draftPayslips = draft.payslips || [];
    const targetStaffId = options?.staffId || (options?.payslipId ? draftPayslips.find((p) => p.id === options.payslipId)?.staffId : undefined);

    // ── CASE A: Finalize ONLY a single staff member from the draft ──
    if (targetStaffId) {
      const hasStaff = draftPayslips.some((p) => p.staffId === targetStaffId);
      if (!hasStaff) throw badRequest('STAFF_NOT_IN_DRAFT', 'Selected employee is not part of this draft payroll.');

      const otherStaffPayslips = draftPayslips.filter((p) => p.staffId !== targetStaffId);

      const { policy, results, alreadyFinalizedByStaff, startDate: actualStart, endDate: actualEnd } = await evaluateBranchMonth(
        tx,
        actor,
        draft.branchId,
        draft.month,
        targetStaffId,
        {
          startDate: draft.policySnapshot?.startDate,
          endDate: draft.policySnapshot?.endDate,
          runType: draft.policySnapshot?.runType,
          compensationType: draft.policySnapshot?.compensationTypeFilter,
          staffIds: [targetStaffId],
          includeDaily: draft.policySnapshot?.includeDaily ?? true,
          excludeRunId: runId,
        }
      );

      if (!results.length) throw conflict('NO_ELIGIBLE_STAFF', 'Selected employee is not eligible in this payroll period.');
      const r = results[0];
      if (!r.canFinalize) throw conflict('PAYROLL_BLOCKED', `Cannot finalize payroll for ${r.staff.name}: ${r.blockReason}`);

      const alreadyDates = alreadyFinalizedByStaff?.get(r.staff.id);
      if (alreadyDates) {
        for (const d of r.payslip.consumedAttendanceDates || []) {
          if (alreadyDates.has(d)) {
            throw conflict('DUPLICATE_PAYROLL', `Staff member ${r.staff.name} already has finalized payroll covering date ${d}.`);
          }
        }
      }

      const branch = await tx.branch.findUnique({ where: { id: draft.branchId } });

      if (otherStaffPayslips.length > 0) {
        // Remove only this staff member from the current draft run
        await tx.payslip.deleteMany({ where: { runId, staffId: targetStaffId } });

        // Create a new independent FINALIZED run for this staff member
        const finalizedRunNumber = await nextPeriodSequence(tx, branch.code, 'PAY', draft.month);
        const newFinalizedRun = await tx.payrollRun.create({
          data: {
            branchId: draft.branchId,
            month: draft.month,
            status: 'FINALIZED',
            payrollNumber: finalizedRunNumber,
            policySnapshot: {
              ...policy,
              startDate: actualStart,
              endDate: actualEnd,
              runType: draft.policySnapshot?.runType,
              compensationTypeFilter: draft.policySnapshot?.compensationTypeFilter,
              staffIdFilter: targetStaffId,
              staffIdsFilter: [targetStaffId],
              includeDaily: draft.policySnapshot?.includeDaily,
            },
            generatedByUserId: draft.generatedByUserId,
            generatedByName: draft.generatedByName,
            finalizedAt: new Date(),
            finalizedByUserId: actor.id,
            finalizedByName: actor.name,
          },
        });

        await tx.payslip.create({
          data: {
            runId: newFinalizedRun.id,
            staffId: r.staff.id,
            payslipNumber: await nextPeriodSequence(tx, branch.code, 'PS', draft.month),
            snapshot: { ...r.payslip, commissionPayable: 0, commissionLinks: [], canFinalize: true, blockReason: undefined },
            netPayable: toDec(r.payslip.netPayable),
            grossPayable: toDec(r.payslip.grossPayable),
          },
        });

        if (r.payslip.consumedOvertimeIds?.length) {
          const claimed = await tx.overtimeRecord.updateMany({
            where: { id: { in: r.payslip.consumedOvertimeIds }, status: 'APPROVED', payrollRunId: null },
            data: { payrollRunId: newFinalizedRun.id },
          });
          if (claimed.count !== r.payslip.consumedOvertimeIds.length) {
            throw conflict('OVERTIME_ALREADY_CONSUMED', 'Approved overtime changed or was reserved by another payroll. Regenerate payroll.');
          }
        }

        await lockPayrollExtras(tx, newFinalizedRun.id, draft.month, r.payslip);
        await auditLog(tx, {
          userId: actor.id,
          userName: actor.name,
          action: 'PAYROLL_FINALIZED',
          entity: 'PayrollRun',
          entityId: newFinalizedRun.id,
          branchId: draft.branchId,
          after: { month: draft.month, staffId: targetStaffId, staffName: r.staff.name },
        });

        return runDTO(tx, newFinalizedRun.id);
      } else {
        // This staff is the only one in the draft, finalize this run directly
        await tx.payslip.deleteMany({ where: { runId } });
        await tx.payslip.create({
          data: {
            runId,
            staffId: r.staff.id,
            payslipNumber: await nextPeriodSequence(tx, branch.code, 'PS', draft.month),
            snapshot: { ...r.payslip, commissionPayable: 0, commissionLinks: [], canFinalize: true, blockReason: undefined },
            netPayable: toDec(r.payslip.netPayable),
            grossPayable: toDec(r.payslip.grossPayable),
          },
        });

        if (r.payslip.consumedOvertimeIds?.length) {
          const claimed = await tx.overtimeRecord.updateMany({
            where: { id: { in: r.payslip.consumedOvertimeIds }, status: 'APPROVED', payrollRunId: null },
            data: { payrollRunId: runId },
          });
          if (claimed.count !== r.payslip.consumedOvertimeIds.length) {
            throw conflict('OVERTIME_ALREADY_CONSUMED', 'Approved overtime changed or was reserved by another payroll. Regenerate payroll.');
          }
        }

        await lockPayrollExtras(tx, runId, draft.month, r.payslip);
        await tx.payrollRun.update({
          where: { id: runId },
          data: {
            status: 'FINALIZED',
            payrollNumber: await nextPeriodSequence(tx, branch.code, 'PAY', draft.month),
            policySnapshot: {
              ...policy,
              startDate: actualStart,
              endDate: actualEnd,
              runType: draft.policySnapshot?.runType,
              compensationTypeFilter: draft.policySnapshot?.compensationTypeFilter,
              staffIdFilter: targetStaffId,
              staffIdsFilter: [targetStaffId],
              includeDaily: draft.policySnapshot?.includeDaily,
            },
            finalizedAt: new Date(),
            finalizedByUserId: actor.id,
            finalizedByName: actor.name,
          },
        });

        await auditLog(tx, {
          userId: actor.id,
          userName: actor.name,
          action: 'PAYROLL_FINALIZED',
          entity: 'PayrollRun',
          entityId: runId,
          branchId: draft.branchId,
          after: { month: draft.month, staffId: targetStaffId, staffName: r.staff.name },
        });

        return runDTO(tx, runId);
      }
    }

    // ── CASE B: Bulk Finalize ALL staff in this draft run ──
    const { policy, results, alreadyFinalizedByStaff, startDate: actualStart, endDate: actualEnd } = await evaluateBranchMonth(
      tx,
      actor,
      draft.branchId,
      draft.month,
      draft.policySnapshot?.staffIdFilter || undefined,
      {
        startDate: draft.policySnapshot?.startDate,
        endDate: draft.policySnapshot?.endDate,
        runType: draft.policySnapshot?.runType,
        compensationType: draft.policySnapshot?.compensationTypeFilter,
        staffIds: draft.policySnapshot?.staffIdsFilter || undefined,
        includeDaily: draft.policySnapshot?.includeDaily ?? true,
        excludeRunId: runId,
      }
    );

    if (!results.length) throw conflict('NO_ELIGIBLE_STAFF', 'No eligible employees remain in this payroll period.');
    const blocked = results.find((r) => !r.canFinalize);
    if (blocked) throw conflict('PAYROLL_BLOCKED', `Cannot finalize payroll: ${blocked.blockReason}`);

    for (const r of results) {
      const alreadyDates = alreadyFinalizedByStaff?.get(r.staff.id);
      if (alreadyDates) {
        for (const d of r.payslip.consumedAttendanceDates || []) {
          if (alreadyDates.has(d)) {
            throw conflict('DUPLICATE_PAYROLL', `Staff member ${r.staff.name} already has finalized payroll covering date ${d}.`);
          }
        }
      }
    }

    const branch = await tx.branch.findUnique({ where: { id: draft.branchId } });
    await tx.payslip.deleteMany({ where: { runId } });
    for (const r of results) {
      await tx.payslip.create({
        data: {
          runId, staffId: r.staff.id, payslipNumber: await nextPeriodSequence(tx, branch.code, 'PS', draft.month),
          snapshot: { ...r.payslip, commissionPayable: 0, commissionLinks: [], canFinalize: true, blockReason: undefined }, netPayable: toDec(r.payslip.netPayable), grossPayable: toDec(r.payslip.grossPayable),
        },
      });
      if (r.payslip.consumedOvertimeIds?.length) {
        const claimed = await tx.overtimeRecord.updateMany({ where: { id: { in: r.payslip.consumedOvertimeIds }, status: 'APPROVED', payrollRunId: null }, data: { payrollRunId: runId } });
        if (claimed.count !== r.payslip.consumedOvertimeIds.length) throw conflict('OVERTIME_ALREADY_CONSUMED', 'Approved overtime changed or was reserved by another payroll. Regenerate payroll.');
      }
      await lockPayrollExtras(tx, runId, draft.month, r.payslip);
    }
    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'FINALIZED',
        payrollNumber: await nextPeriodSequence(tx, branch.code, 'PAY', draft.month),
        policySnapshot: {
          ...policy,
          startDate: actualStart,
          endDate: actualEnd,
          runType: draft.policySnapshot?.runType,
          compensationTypeFilter: draft.policySnapshot?.compensationTypeFilter,
          staffIdFilter: draft.policySnapshot?.staffIdFilter,
          staffIdsFilter: draft.policySnapshot?.staffIdsFilter,
          includeDaily: draft.policySnapshot?.includeDaily,
        },
        finalizedAt: new Date(),
        finalizedByUserId: actor.id,
        finalizedByName: actor.name,
      },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'PAYROLL_FINALIZED', entity: 'PayrollRun', entityId: runId, branchId: draft.branchId, after: { month: draft.month } });
    return runDTO(tx, runId);
  });
};

export const cancelPayslip = async (actor, payslipId, reason) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const ps = await tx.payslip.findUnique({
      where: { id: payslipId },
      include: {
        run: { include: { payslips: true, payments: true } },
        payments: true,
      },
    });
    if (!ps) throw notFound('PAYSLIP_NOT_FOUND', `Payslip '${payslipId}' not found.`);
    assertBranchAccess(actor, ps.run.branchId, 'Access Denied: Cannot cancel payslip for another branch.');
    if (ps.run.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'The payroll run containing this payslip is already cancelled.');

    if (ps.payments.some((p) => p.status === 'COMPLETED')) {
      throw conflict('HAS_PAYMENTS', `Cannot delete salary for ${ps.snapshot?.staffName || 'this staff'} because it has completed payments. Please reverse payments first.`);
    }

    // 1. Release overtime locked by this payslip
    if (ps.snapshot?.consumedOvertimeIds?.length) {
      await tx.overtimeRecord.updateMany({
        where: { id: { in: ps.snapshot.consumedOvertimeIds }, payrollRunId: ps.runId },
        data: { payrollRunId: null },
      });
    }
    await tx.overtimeRecord.updateMany({
      where: { payrollRunId: ps.runId, staffId: ps.staffId },
      data: { payrollRunId: null },
    });

    // 2. Release payroll adjustments & advance recoveries for this staff only
    await releasePayrollExtrasForStaff(tx, ps.runId, ps.staffId);

    // 3. Release commission links if any
    const createdIds = (ps.snapshot?.commissionLinks ?? []).filter((s) => s.createdByPayroll).map((s) => s.id);
    if (createdIds.length) {
      const created = await tx.commissionStatement.findMany({ where: { id: { in: createdIds } }, select: { runId: true } });
      const commissionRunIds = [...new Set(created.map((s) => s.runId))];
      await tx.commissionStatement.updateMany({ where: { payrollPayslipId: ps.id }, data: { payrollPayslipId: null } });
      await tx.commissionEvent.updateMany({ where: { consumedByRunId: { in: commissionRunIds } }, data: { consumedByRunId: null } });
      await tx.commissionRun.updateMany({
        where: { id: { in: commissionRunIds } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actor.id, cancelledByName: actor.name, cancellationReason: reason },
      });
    }

    // 4. Audit log
    await auditLog(tx, {
      userId: actor.id,
      userName: actor.name,
      action: 'PAYSLIP_DELETED',
      entity: 'Payslip',
      entityId: ps.id,
      branchId: ps.run.branchId,
      after: { staffId: ps.staffId, staffName: ps.snapshot?.staffName, reason },
    });

    // 5. Clean up reversed payments on this payslip if any
    await tx.payrollPayment.deleteMany({ where: { payslipId: ps.id } });

    // 6. Delete the payslip record
    await tx.payslip.delete({ where: { id: ps.id } });

    // 7. Check if any payslips remain in this run
    const remainingCount = ps.run.payslips.length - 1;
    if (remainingCount <= 0) {
      await tx.payrollRun.update({
        where: { id: ps.runId },
        data: {
          status: 'CANCELLED',
          cancellationReason: reason || 'All staff payslips cancelled',
          cancelledAt: new Date(),
          cancelledByUserId: actor.id,
          cancelledByName: actor.name,
        },
      });
      return { deletedPayslipId: ps.id, runCancelled: true, runId: ps.runId };
    }

    return { deletedPayslipId: ps.id, runCancelled: false, run: await runDTO(tx, ps.runId) };
  });
};

export const cancelRun = async (actor, runId, reason) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!header) throw notFound('PAYROLL_NOT_FOUND', 'Payroll run not found.');
    await lockCommissionBranch(tx, header.branchId);
    const run = await tx.payrollRun.findUnique({ where: { id: runId }, include: { payments: true, payslips: true } });
    if (!run) throw notFound('PAYROLL_NOT_FOUND', `Payroll run '${runId}' not found.`);
    assertBranchAccess(actor, run.branchId, 'Access Denied: Cannot cancel payroll run for another branch.');
    if (run.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'This payroll run is already cancelled.');
    if (run.payments.some((p) => p.status === 'COMPLETED')) {
      throw conflict('HAS_PAYMENTS', 'Runs with payments cannot be cancelled until all payments are properly reversed.');
    }
    await tx.overtimeRecord.updateMany({ where: { payrollRunId: runId }, data: { payrollRunId: null } });
    await releasePayrollExtras(tx, runId);
    const createdIds = run.payslips.flatMap((ps) => ps.snapshot.commissionLinks ?? []).filter((s) => s.createdByPayroll).map((s) => s.id);
    const created = await tx.commissionStatement.findMany({ where: { id: { in: createdIds } }, select: { runId: true } });
    const commissionRunIds = [...new Set(created.map((s) => s.runId))];
    await tx.commissionStatement.updateMany({ where: { payrollPayslipId: { in: run.payslips.map((ps) => ps.id) } }, data: { payrollPayslipId: null } });
    await tx.commissionEvent.updateMany({ where: { consumedByRunId: { in: commissionRunIds } }, data: { consumedByRunId: null } });
    await tx.commissionRun.updateMany({ where: { id: { in: commissionRunIds } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actor.id, cancelledByName: actor.name, cancellationReason: reason } });
    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED', cancellationReason: reason, cancelledAt: new Date(), cancelledByUserId: actor.id, cancelledByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'PAYROLL_CANCELLED', entity: 'PayrollRun', entityId: runId, branchId: run.branchId, after: { reason } });
    return runDTO(tx, runId);
  });
};

// ── Payments ─────────────────────────────────────────────────────────────────

export const recordPayment = async (actor, input) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.payrollRun.findUnique({ where: { id: input.payrollRunId } });
    if (!header) throw notFound('PAYROLL_NOT_FOUND', 'Payroll run not found.');
    await lockCommissionBranch(tx, header.branchId);
    const requestKey = input.idempotencyKey ? `${actor.id}:payroll:${input.idempotencyKey}` : null;
    if (requestKey) {
      const replay = await tx.payrollPayment.findUnique({ where: { requestKey } });
      if (replay) return { payrollRun: await runDTO(tx, replay.runId), payment: toPaymentDTO(replay) };
    }
    await tx.$executeRaw`SELECT 1 FROM "Payslip" WHERE id = ${input.payslipId} FOR UPDATE`;
    const run = await tx.payrollRun.findUnique({ where: { id: input.payrollRunId }, include: runInclude });
    if (!run) throw notFound('PAYROLL_NOT_FOUND', `Payroll run '${input.payrollRunId}' not found.`);
    assertBranchAccess(actor, run.branchId, 'Access Denied: Cannot record payment for another branch.');
    if (['DRAFT', 'CANCELLED'].includes(run.status)) throw conflict('RUN_NOT_PAYABLE', `Cannot record payment on a payroll run in '${run.status}' status.`);
    const ps = run.payslips.find((p) => p.id === input.payslipId);
    if (!ps) throw notFound('PAYSLIP_NOT_FOUND', `Payslip '${input.payslipId}' not found in this payroll run.`);
    const slip = toPayslipDTO(ps, run);
    const amount = round2(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw badRequest('INVALID_AMOUNT', 'Payment must be greater than zero.');
    if (amount.greaterThan(slip.outstandingAmount)) {
      throw badRequest('OVERPAYMENT', `Payment amount (${amount}) exceeds outstanding payslip balance (${slip.outstandingAmount}).`);
    }
    const branch = await tx.branch.findUnique({ where: { id: run.branchId } });
    const paymentNumber = await nextSequence(tx, branch.code, 'PAYMT', Number((await getBusinessDate(tx)).slice(0, 4)));
    // Salary payments strictly pay salary. Commission is paid through Commission page.
    const salaryOutstanding = toDec(ps.netPayable).minus(completedAmount(ps.payments));
    const salaryAmount = amount.lessThan(salaryOutstanding) ? amount : salaryOutstanding;
    const commissionAmount = round2(toDec(0));
    const source = salaryAmount.greaterThan(0) ? await payoutMoney(tx, actor, {
      branchId: run.branchId, method: input.method, onlineAccountId: input.onlineAccountId, amount: salaryAmount, type: 'PAYROLL_PAYOUT',
      sourceModule: 'PAYROLL', sourceId: ps.id, reference: paymentNumber, description: `Salary ${run.month} — ${slip.staffName}`,
    }) : {};
    const payment = await tx.payrollPayment.create({
      data: {
        paymentNumber, runId: run.id, payslipId: ps.id, staffId: ps.staffId, staffName: slip.staffName, branchId: run.branchId, amount: salaryAmount, commissionAmount, requestKey,
        method: input.method, ...source, reference: input.reference || '', notes: input.notes || null, paidByUserId: actor.id, paidByName: actor.name,
      },
    });
    let remainder = commissionAmount;
    const linked = await tx.commissionStatement.findMany({ where: { payrollPayslipId: ps.id }, include: { payments: true, run: true }, orderBy: { id: 'asc' } });
    for (const st of linked) {
      if (remainder.lessThanOrEqualTo(0)) break;
      if (st.run.status !== 'FINALIZED') throw conflict('COMMISSION_NOT_PAYABLE', 'Linked commission is not finalized.');
      const outstanding = round2(toDec(st.netPayable).minus(completedAmount(st.payments)));
      const part = remainder.lessThan(outstanding) ? remainder : outstanding;
      if (part.lessThanOrEqualTo(0)) continue;
      const commissionNumber = await nextSequence(tx, branch.code, 'COMPAY', Number((await getBusinessDate(tx)).slice(0, 4)));
      const commissionSource = await payoutMoney(tx, actor, { branchId: run.branchId, method: input.method, onlineAccountId: input.onlineAccountId, amount: part,
        type: 'COMMISSION_PAYOUT', sourceModule: 'COMMISSION', sourceId: st.id, reference: commissionNumber, description: `Commission with payroll ${paymentNumber} — ${slip.staffName}` });
      await tx.commissionPayment.create({ data: { paymentNumber: commissionNumber, runId: st.runId, statementId: st.id, staffId: ps.staffId, staffName: slip.staffName,
        branchId: run.branchId, amount: part, payrollPaymentId: payment.id, method: input.method, ...commissionSource,
        reference: input.reference || '', notes: input.notes || null, paidByUserId: actor.id, paidByName: actor.name } });
      if (!salaryAmount.greaterThan(0)) await tx.payrollPayment.update({ where: { id: payment.id }, data: commissionSource });
      remainder = round2(remainder.minus(part));
    }
    if (remainder.greaterThan(0)) throw conflict('COMMISSION_BALANCE_CHANGED', 'Linked commission balance changed. Regenerate payroll.');
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'PAYROLL_PAID', entity: 'PayrollPayment', entityId: payment.id, branchId: run.branchId, after: { amount: amount.toNumber(), method: input.method } });
    return { payrollRun: await runDTO(tx, run.id), payment: toPaymentDTO(await tx.payrollPayment.findUnique({ where: { id: payment.id } })) };
  });
};

export const reversePayment = async (actor, paymentId, reason) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.payrollPayment.findUnique({ where: { id: paymentId } });
    if (!header) throw notFound('PAYMENT_NOT_FOUND', 'Payroll payment not found.');
    await lockCommissionBranch(tx, header.branchId);
    await tx.$executeRaw`SELECT 1 FROM "PayrollPayment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payrollPayment.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', `Payroll payment '${paymentId}' not found.`);
    assertBranchAccess(actor, p.branchId, 'Access Denied: Cannot reverse payments of another branch.');
    if (p.status === 'REVERSED') throw conflict('ALREADY_REVERSED', 'This payroll payment is already reversed.');
    if (toDec(p.amount).greaterThan(0)) await reverseMoney(tx, actor, {
      branchId: p.branchId, method: p.method, onlineAccountId: p.onlineAccountId, amount: p.amount, sourceModule: 'PAYROLL',
      sourceId: p.id, reference: p.paymentNumber, description: `Reversal of salary payment ${p.paymentNumber}: ${reason}`,
    });
    const commissionPayments = await tx.commissionPayment.findMany({ where: { payrollPaymentId: p.id, status: 'COMPLETED' } });
    for (const cp of commissionPayments) {
      await reverseMoney(tx, actor, { branchId: cp.branchId, method: cp.method, onlineAccountId: cp.onlineAccountId, amount: cp.amount, sourceModule: 'COMMISSION',
        sourceId: cp.id, reference: cp.paymentNumber, description: `Reversal with payroll ${p.paymentNumber}: ${reason}` });
      await tx.commissionPayment.update({ where: { id: cp.id }, data: { status: 'REVERSED', reversalReason: reason, reversedAt: new Date(), reversedByUserId: actor.id, reversedByName: actor.name } });
    }
    const updated = await tx.payrollPayment.update({
      where: { id: paymentId },
      data: { status: 'REVERSED', reversalReason: reason, reversedAt: new Date(), reversedByUserId: actor.id, reversedByName: actor.name },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'PAYROLL_PAYMENT_REVERSED', entity: 'PayrollPayment', entityId: paymentId, branchId: p.branchId, after: { reason } });
    return toPaymentDTO(updated);
  });
};

// ── Manual Deductions on Generated Payslips ─────────────────────────────────

export const applyManualDeduction = async (actor, payslipId, { amount: rawAmount, title, notes }) => {
  noAccountant(actor);
  return prisma.$transaction(async (tx) => {
    const header = await tx.payslip.findUnique({ where: { id: payslipId }, include: { run: true } });
    if (!header) throw notFound('PAYSLIP_NOT_FOUND', `Payslip '${payslipId}' not found.`);
    await lockCommissionBranch(tx, header.run.branchId);
    await tx.$executeRaw`SELECT 1 FROM "Payslip" WHERE id = ${payslipId} FOR UPDATE`;
    const ps = await tx.payslip.findUnique({
      where: { id: payslipId },
      include: { run: true, payments: true },
    });
    if (!ps) throw notFound('PAYSLIP_NOT_FOUND', `Payslip '${payslipId}' not found.`);
    assertBranchAccess(actor, ps.run.branchId, 'Access Denied: Cannot deduct from payslip of another branch.');
    if (ps.run.status !== 'DRAFT') {
      throw conflict('PAYROLL_IMMUTABLE', 'Finalized payroll history is immutable. Add deductions before finalization.');
    }

    const amount = round2(rawAmount);
    if (amount.lessThanOrEqualTo(0)) {
      throw badRequest('INVALID_AMOUNT', 'Deduction amount must be greater than zero.');
    }

    const currentSlip = toPayslipDTO(ps, ps.run);
    if (amount.greaterThan(ps.netPayable)) {
      throw badRequest('EXCEEDS_OUTSTANDING', `Deduction amount (Rs. ${amount}) exceeds unpaid outstanding payslip balance (Rs. ${currentSlip.outstandingAmount}).`);
    }

    // 1. Create a PayrollAdjustment record for tracking
    const adjustment = await tx.payrollAdjustment.create({
      data: {
        branchId: ps.run.branchId,
        staffId: ps.staffId,
        month: ps.run.month,
        type: 'DEDUCTION',
        title: title.trim(),
        amount,
        notes: notes ? notes.trim() : null,
        payrollRunId: null,
        status: 'ACTIVE',
        createdByUserId: actor.id,
        createdByName: actor.name,
      },
    });

    // 2. Update payslip snapshot and netPayable
    const prevSnapshot = (typeof ps.snapshot === 'object' && ps.snapshot !== null) ? { ...ps.snapshot } : {};
    const existingAdjustments = Array.isArray(prevSnapshot.adjustments) ? [...prevSnapshot.adjustments] : [];
    existingAdjustments.push({
      id: adjustment.id,
      type: 'DEDUCTION',
      title: adjustment.title,
      amount: amount.toNumber(),
      notes: adjustment.notes,
    });

    const newOtherDeductions = round2(toDec(prevSnapshot.otherDeductions ?? 0).plus(amount)).toNumber();
    const newTotalDeductions = round2(toDec(prevSnapshot.totalDeductions ?? 0).plus(amount)).toNumber();
    const newNetPayable = round2(toDec(ps.netPayable).minus(amount));
    const newOutstanding = round2(toDec(currentSlip.outstandingAmount).minus(amount)).toNumber();

    const updatedSnapshot = {
      ...prevSnapshot,
      adjustments: existingAdjustments,
      otherDeductions: newOtherDeductions,
      totalDeductions: newTotalDeductions,
      netPayable: newNetPayable.toNumber(),
      outstandingAmount: Math.max(0, newOutstanding),
    };

    const updatedPayslip = await tx.payslip.update({
      where: { id: payslipId },
      data: {
        netPayable: newNetPayable,
        snapshot: updatedSnapshot,
      },
      include: { payments: true, run: true },
    });

    await auditLog(tx, {
      userId: actor.id,
      userName: actor.name,
      action: 'PAYROLL_MANUAL_DEDUCTION_ADDED',
      entity: 'Payslip',
      entityId: payslipId,
      branchId: ps.run.branchId,
      after: {
        adjustmentId: adjustment.id,
        amount: amount.toNumber(),
        title: adjustment.title,
        notes: adjustment.notes,
        newNetPayable: newNetPayable.toNumber(),
        newOutstanding,
      },
    });

    return {
      payslip: toPayslipDTO(updatedPayslip, updatedPayslip.run),
      payrollRun: await runDTO(tx, ps.runId),
      adjustment,
    };
  });
};


// ── Staff portal ─────────────────────────────────────────────────────────────

export const personalPayslips = async (actor) => {
  if (!actor.staffId) throw forbidden('FORBIDDEN', 'Staff record associated with the authenticated user could not be found.');
  // Draft and cancelled runs are never visible to staff.
  const slips = await prisma.payslip.findMany({
    where: { staffId: actor.staffId, run: { status: { notIn: ['DRAFT', 'CANCELLED'] } } },
    include: { payments: true, run: true },
  });
  return slips.map((ps) => toPayslipDTO(ps, ps.run)).sort((a, b) => b.month.localeCompare(a.month));
};

// ── Monthly earnings summary (salary + commission, kept as separate liabilities) ──

/**
 * One row per staff member for the month: salary from the month's finalized payroll run (a draft only
 * fills salaryEstimate — no liability yet), commission from finalized commission runs whose period lies inside
 * the month, plus not-yet-run commission events of the month as "pending".
 */
export const monthlySummary = async (actor, { branchId: requested, month }) => {
  noAccountant(actor);
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot view payroll for another branch.');
  const from = dateOnly(`${month}-01`);
  const to = dateOnly(`${month}-${String(getCalendarDaysInMonth(month)).padStart(2, '0')}`);
  const runs = await prisma.payrollRun.findMany({ where: { branchId, month, status: { not: 'CANCELLED' } }, include: runInclude });
  const run = runs.find((r) => r.status !== 'DRAFT') ?? runs.find((r) => r.status === 'DRAFT');
  const slips = runs.flatMap((r) => toRunDTO(r).payslips);
  const comRuns = await prisma.commissionRun.findMany({
    where: { branchId, status: { notIn: ['DRAFT', 'CANCELLED'] }, startDate: { gte: from }, endDate: { lte: to } },
    include: { statements: { include: { payments: true } } },
  });
  const pending = await prisma.commissionEvent.groupBy({
    by: ['staffId', 'type'], where: { branchId, consumedByRunId: null, eventDate: { gte: from, lte: to } }, _sum: { amount: true },
  });
  const advances = await prisma.salaryAdvance.findMany({ where: { branchId, status: 'ACTIVE' }, include: { recoveries: true } });
  // Everyone employed during the month (joined by month end; active, or left on/after the 1st).
  const staff = await prisma.staff.findMany({ where: { branchId, joiningDate: { lte: to }, OR: [{ isActive: true }, { exitDate: { gte: from } }] }, orderBy: { employeeCode: 'asc' } });

  const rows = staff.map((s) => {
    const mine = slips.filter((p) => p.staffId === s.id);
    const salarySlips = mine.filter((p) => p.status !== 'DRAFT');
    const stmts = comRuns.flatMap((r) => r.statements).filter((st) => st.staffId === s.id);
    const comNet = round2(stmts.reduce((x, st) => x.plus(st.netPayable), toDec(0)));
    const comPaid = round2(stmts.flatMap((st) => st.payments).filter((p) => p.status === 'COMPLETED').reduce((x, p) => x.plus(p.amount), toDec(0)));
    const ev = (type) => toDec(pending.find((p) => p.staffId === s.id && p.type === type)?._sum.amount ?? 0);
    const comPending = Decimal_max0(round2(ev('EARN').minus(ev('REVERSAL'))));
    // A DRAFT payslip is only an estimate: shown as salaryEstimate, never as earned/outstanding liability.
    const salaryEstimate = round2(mine.filter((p) => p.status === 'DRAFT').reduce((x, p) => x.plus(p.salaryNetPayable), toDec(0)));
    const salaryNet = round2(salarySlips.reduce((x, p) => x.plus(p.salaryNetPayable), toDec(0)));
    const salaryPaid = round2(salarySlips.reduce((x, p) => x.plus(p.salaryPaidAmount), toDec(0)));
    const salaryStatus = salarySlips.length ? (salaryNet.greaterThan(0) && salaryPaid.greaterThanOrEqualTo(salaryNet) ? 'PAID' : salaryPaid.greaterThan(0) ? 'PARTIALLY_PAID' : 'FINALIZED') : mine.length ? 'DRAFT' : 'NOT_GENERATED';
    const advBal = round2(advances.filter((a) => a.staffId === s.id).reduce((x, a) => x.plus(advanceBalance(a)), toDec(0)));
    return {
      staffId: s.id, staffName: s.name, employeeCode: s.employeeCode, designation: s.designation, compensationType: s.compensationType,
      salaryStatus, salaryEstimate: salaryEstimate.toNumber(), salaryNet: salaryNet.toNumber(), salaryPaid: salaryPaid.toNumber(),
      salaryOutstanding: round2(salaryNet.minus(salaryPaid)).toNumber(),
      commissionNet: comNet.toNumber(), commissionPaid: comPaid.toNumber(), commissionOutstanding: round2(comNet.minus(comPaid)).toNumber(),
      commissionPending: comPending.toNumber(),
      totalEarnings: round2(salaryNet.plus(comNet)).toNumber(), totalPaid: round2(salaryPaid.plus(comPaid)).toNumber(),
      totalOutstanding: round2(salaryNet.minus(salaryPaid).plus(comNet).minus(comPaid)).toNumber(),
      advanceBalance: advBal.toNumber(),
    };
  });
  const total = (f) => round2(rows.reduce((x, r) => x.plus(r[f]), toDec(0))).toNumber();
  return {
    branchId, month, payrollRunId: run?.id ?? null, payrollStatus: run ? toRunDTO(run).status : 'NOT_GENERATED',
    commissionRunIds: comRuns.map((r) => r.id), rows,
    totals: Object.fromEntries(['salaryEstimate', 'salaryNet', 'salaryPaid', 'salaryOutstanding', 'commissionNet', 'commissionPaid', 'commissionOutstanding', 'commissionPending', 'totalEarnings', 'totalPaid', 'totalOutstanding', 'advanceBalance'].map((f) => [f, total(f)])),
  };
};

const Decimal_max0 = (d) => (d.lessThan(0) ? toDec(0) : d);
