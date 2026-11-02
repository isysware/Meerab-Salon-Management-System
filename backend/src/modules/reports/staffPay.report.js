// src/modules/reports/staffPay.report.js
// Spec §10.2 Staff Salary Report and §10.3 Staff Commission Report (read-only, SA + ADMIN).
//  • Salary: finalized payroll snapshots only (drafts/cancelled never count); payment date shown separately.
//  • Commission: dated EARN/REVERSAL events (event date basis); payouts by paid date;
//    liability = earned − reversed − paid (opening before `from`, closing at `to`).

import prisma from '../../config/prisma.js';
import { forbidden } from '../../lib/AppError.js';
import { resolveReadBranch } from '../../lib/scope.js';
import { dateOnly, endOfDay, startOfDay, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { num } from '../../lib/dto.js';

const noAccountant = (actor) => {
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') throw forbidden('FORBIDDEN', 'Access Denied: Staff pay reports are confidential.');
};
const d0 = () => toDec(0);
const sumBy = (rows, f) => round2(rows.reduce((s, r) => s.plus(toDec(f(r) ?? 0)), d0()));

// ── §10.2 Staff Salary ───────────────────────────────────────────────────────

export const staffSalaryReport = async (actor, q) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, q.branchId);
  const fromMonth = q.fromMonth || q.month;
  const toMonth = q.toMonth || q.month || fromMonth;
  const slips = await prisma.payslip.findMany({
    where: {
      run: { status: { notIn: ['DRAFT', 'CANCELLED'] }, ...(b ? { branchId: b } : {}), month: { gte: fromMonth, lte: toMonth } },
      ...(q.staffId ? { staffId: q.staffId } : {}),
    },
    include: { payments: true, run: true },
  });
  const branches = new Map((await prisma.branch.findMany()).map((x) => [x.id, x.name]));

  let rows = slips.map((ps) => {
    const s = ps.snapshot;
    const done = ps.payments.filter((p) => p.status === 'COMPLETED' && (!q.paymentMethod || q.paymentMethod === 'ALL' || p.method === q.paymentMethod));
    const paid = sumBy(done, (p) => p.amount);
    const net = toDec(ps.netPayable);
    const outstanding = round2(net.minus(sumBy(ps.payments.filter((p) => p.status === 'COMPLETED'), (p) => p.amount)));
    const lastPaid = done.sort((a, b2) => b2.paidAt - a.paidAt)[0];
    const otherDeductions = round2(toDec(s.otherDeductions ?? 0).plus(s.advanceRecoveryAmount ?? 0));
    return {
      payslipId: ps.id, payslipNumber: ps.payslipNumber, payrollNumber: ps.run.payrollNumber, period: ps.run.month,
      staffId: ps.staffId, staffName: s.staffName, employeeCode: s.employeeCode, designation: s.designation,
      branchId: ps.run.branchId, branchName: branches.get(ps.run.branchId), compensationType: s.compensationType,
      presentDays: num(s.presentDays ?? 0),
      absentDays: num(s.absentDays ?? 0),
      paidLeaveDays: num(s.paidLeaveDays ?? 0),
      unpaidLeaveDays: num(s.unpaidLeaveDays ?? 0),
      holidayDays: num(s.holidayDays ?? s.paidHolidayDays ?? 0),
      paidHolidayDays: num(s.paidHolidayDays ?? 0),
      weeklyOffDays: num(s.weeklyOffDays ?? s.paidWeeklyOffDays ?? 0),
      paidWeeklyOffDays: num(s.paidWeeklyOffDays ?? 0),
      workedWeeklyOffDays: num(s.workedWeeklyOffDays ?? 0),
      workedHolidayDays: num(s.workedHolidayDays ?? 0),
      overtimeHours: num(s.approvedOvertimeHours ?? (s.approvedOvertimeMinutes ? s.approvedOvertimeMinutes / 60 : 0)),
      basic: toDec(s.baseEarnings ?? 0).plus(s.leaveEarnings ?? 0).plus(s.holidayEarnings ?? 0).toNumber(),
      attendance: num(s.attendanceImpact ?? -((s.absenceDeductions ?? 0) + (s.attendancePenaltyDeductions ?? 0))),
      overtime: num(s.approvedOvertimeAmount ?? 0), allowances: num(s.allowancesTotal ?? 0),
      deductions: otherDeductions.toNumber(), advanceRecovery: num(s.advanceRecoveryAmount ?? 0),
      gross: num(ps.grossPayable), net: net.toNumber(), paid: paid.toNumber(), outstanding: outstanding.toNumber(),
      status: outstanding.lessThanOrEqualTo(0) && net.greaterThan(0) ? 'PAID' : paid.greaterThan(0) ? 'PARTIALLY_PAID' : 'FINALIZED',
      finalizedAt: ps.run.finalizedAt, paidDate: lastPaid ? ymd(lastPaid.paidAt) : null, processedBy: ps.run.finalizedByName,
    };
  });
  if (q.designation && q.designation !== 'ALL') rows = rows.filter((r) => r.designation === q.designation);
  if (q.paymentStatus && q.paymentStatus !== 'ALL') rows = rows.filter((r) => r.status === q.paymentStatus);
  if (q.paymentMethod && q.paymentMethod !== 'ALL') rows = rows.filter((r) => r.paid > 0);
  rows.sort((a, b2) => b2.period.localeCompare(a.period) || a.employeeCode.localeCompare(b2.employeeCode));

  const totals = Object.fromEntries(['presentDays', 'absentDays', 'paidLeaveDays', 'unpaidLeaveDays', 'holidayDays', 'weeklyOffDays', 'overtimeHours', 'basic', 'attendance', 'overtime', 'allowances', 'deductions', 'advanceRecovery', 'gross', 'net', 'paid', 'outstanding']
    .map((f) => [f, sumBy(rows, (r) => r[f]).toNumber()]));
  return {
    filters: { branchId: b ?? 'ALL', fromMonth, toMonth, staffId: q.staffId, designation: q.designation, paymentStatus: q.paymentStatus, paymentMethod: q.paymentMethod },
    dateBasis: 'Payroll period (finalized runs only); paid date shown separately.',
    summary: { ...totals, payslips: rows.length },
    rows, totals,
  };
};

// ── §10.3 Staff Commission ───────────────────────────────────────────────────

export const staffCommissionReport = async (actor, q) => {
  noAccountant(actor);
  const b = resolveReadBranch(actor, q.branchId);
  const where = { ...(b ? { branchId: b } : {}), ...(q.staffId ? { staffId: q.staffId } : {}) };
  const from = dateOnly(q.startDate);
  const to = dateOnly(q.endDate);

  const [events, opening, payments, openingPaid, staff] = await Promise.all([
    prisma.commissionEvent.findMany({ where: { ...where, eventDate: { gte: from, lte: to }, ...(q.invoiceNumber ? { invoiceNumber: q.invoiceNumber } : {}) }, orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }] }),
    prisma.commissionEvent.groupBy({ by: ['staffId', 'type'], where: { ...where, eventDate: { lt: from } }, _sum: { amount: true } }),
    prisma.commissionPayment.findMany({ where: { ...where, status: 'COMPLETED', paidAt: { gte: startOfDay(q.startDate), lte: endOfDay(q.endDate) } } }),
    prisma.commissionPayment.groupBy({ by: ['staffId'], where: { ...where, status: 'COMPLETED', paidAt: { lt: startOfDay(q.startDate) } }, _sum: { amount: true } }),
    prisma.staff.findMany({ where: b ? { branchId: b } : {}, select: { id: true, name: true, employeeCode: true } }),
  ]);
  const lines = await prisma.invoiceLine.findMany({
    where: { id: { in: [...new Set(events.map((e) => e.lineId))] } }, include: { components: true, invoice: { select: { clientName: true } } },
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const staffById = new Map(staff.map((s) => [s.id, s]));

  let rows = events.map((e) => {
    const line = lineById.get(e.lineId);
    const comp = e.componentId ? line?.components.find((c) => c.id === e.componentId) : null;
    const earn = e.type === 'EARN';
    return {
      eventId: e.id, date: ymd(e.eventDate), staffId: e.staffId, staffName: staffById.get(e.staffId)?.name ?? '', invoiceId: e.invoiceId,
      invoiceNumber: e.invoiceNumber, customer: line?.invoice.clientName ?? '', itemName: comp ? `${line?.name} › ${comp.serviceName}` : line?.name ?? '',
      source: comp ? 'PACKAGE' : (line?.type ?? 'SERVICE'), eventType: e.type,
      attributedNetSales: (earn ? 1 : -1) * num(e.attributedNet), rateSnapshot: num(e.rate),
      earned: earn ? num(e.amount) : 0, reversed: earn ? 0 : num(e.amount), net: (earn ? 1 : -1) * num(e.amount),
      runStatus: e.consumedByRunId ? 'IN_RUN' : 'NOT_RUN',
    };
  });
  if (q.source) rows = rows.filter((r) => r.source === q.source);

  const ids = [...new Set([...rows.map((r) => r.staffId), ...payments.map((p) => p.staffId), ...opening.map((o) => o.staffId), ...openingPaid.map((o) => o.staffId)])];
  const byStaff = ids.map((id) => {
    const mine = rows.filter((r) => r.staffId === id);
    const op = (t) => toDec(opening.find((o) => o.staffId === id && o.type === t)?._sum.amount ?? 0);
    const openingLiability = round2(op('EARN').minus(op('REVERSAL')).minus(openingPaid.find((o) => o.staffId === id)?._sum.amount ?? 0));
    const earned = sumBy(mine, (r) => r.earned);
    const reversed = sumBy(mine, (r) => r.reversed);
    const paid = sumBy(payments.filter((p) => p.staffId === id), (p) => p.amount);
    return {
      staffId: id, staffName: staffById.get(id)?.name ?? '', employeeCode: staffById.get(id)?.employeeCode ?? '',
      attributedNetSales: sumBy(mine, (r) => r.attributedNetSales).toNumber(), earned: earned.toNumber(), reversed: reversed.toNumber(),
      net: round2(earned.minus(reversed)).toNumber(), paid: paid.toNumber(), openingLiability: openingLiability.toNumber(),
      outstanding: round2(openingLiability.plus(earned).minus(reversed).minus(paid)).toNumber(),
    };
  }).sort((a, b2) => a.employeeCode.localeCompare(b2.employeeCode));

  const totals = Object.fromEntries(['attributedNetSales', 'earned', 'reversed', 'net', 'paid', 'openingLiability', 'outstanding']
    .map((f) => [f, sumBy(byStaff, (r) => r[f]).toNumber()]));
  return {
    filters: { branchId: b ?? 'ALL', startDate: q.startDate, endDate: q.endDate, staffId: q.staffId, source: q.source, invoiceNumber: q.invoiceNumber },
    dateBasis: 'Commission earn/reversal event date; payouts by paid date. Base excludes discounts, tax and tips.',
    summary: totals, byStaff, rows, totals,
  };
};

