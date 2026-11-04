// src/modules/reports/staffPay.report.js
// Spec §10.2 Staff Salary Report and §10.3 Staff Commission Report (read-only, SA + ADMIN).
//  • Salary: finalized payroll snapshots only (drafts/cancelled never count); payment date shown separately.
//  • Commission: dated EARN/REVERSAL events (event date basis); payouts by paid date;
//    liability = earned − reversed − paid (opening before `from`, closing at `to`).

import prisma from '../../config/prisma.js';
import { loadCollectionEvents, payoutEvents } from './collectionEvents.js';
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
  const scope = b ? { branchId: b } : {};
  const staffFilter = q.staffId && q.staffId !== 'ALL' ? { staffId: q.staffId } : {};
  const [collections, payments, staff, recordedEvents] = await Promise.all([
    loadCollectionEvents(scope, null, q.endDate),
    prisma.commissionPayment.findMany({ where: { ...scope, ...staffFilter, status: { in: ['COMPLETED', 'REVERSED'] }, paidAt: { lte: endOfDay(q.endDate) } } }),
    prisma.staff.findMany({ where: { ...scope, ...(staffFilter.staffId ? { id: staffFilter.staffId } : {}) }, select: { id: true, name: true, employeeCode: true } }),
    prisma.commissionEvent.findMany({ where: { ...scope, ...staffFilter, eventDate: { gte: dateOnly(q.startDate), lte: dateOnly(q.endDate) } },
      select: { invoiceId: true, lineId: true, staffId: true, componentId: true, eventDate: true, consumedByRunId: true } }),
  ]);
  const staffById = new Map(staff.map(s => [s.id, s]));
  const recordedStatus = new Map();
  const eventKey = (invoiceId, lineId, staffId, componentId, date) => [invoiceId, lineId, staffId, componentId || '', date].join(':');
  for (const event of recordedEvents) {
    const key = eventKey(event.invoiceId, event.lineId, event.staffId, event.componentId, ymd(event.eventDate));
    recordedStatus.set(key, event.consumedByRunId || recordedStatus.get(key) === 'IN_RUN' ? 'IN_RUN' : 'NOT_RUN');
  }
  const allRows = collections.flatMap(event => event.commissions.map(c => {
    const comp = event.line.components?.find(component => component.id === c.componentId);
    return {
      eventId: event.id + ':' + c.staffId + ':' + (c.componentId || ''), date: event.date,
      staffId: c.staffId, staffName: staffById.get(c.staffId)?.name || c.staffName || '',
      invoiceId: event.invoice.id, invoiceNumber: event.invoice.invoiceNumber, customer: event.invoice.clientName || '',
      itemName: comp ? event.line.name + ' / ' + comp.serviceName : event.line.name,
      source: event.line.type === 'CUSTOM_SERVICE' ? 'SERVICE' : event.line.type,
      eventType: c.amount.lt(0) || c.attributedNet.lt(0) ? 'REVERSAL' : 'EARN', attributedNetSales: num(c.attributedNet), rateSnapshot: num(c.rate),
      earned: c.amount.gt(0) ? num(c.amount) : 0, reversed: c.amount.lt(0) ? num(c.amount.negated()) : 0,
      net: num(c.amount), runStatus: recordedStatus.get(eventKey(event.invoice.id, event.line.id, c.staffId, c.componentId, event.date)) || 'CALCULATED',
    };
  })).filter(r => staffById.has(r.staffId));
  const period = allRows.filter(r => r.date >= q.startDate && r.date <= q.endDate);
  const rows = period.filter(r => (!q.source || q.source === 'ALL' || r.source === q.source)
    && (!q.invoiceNumber || r.invoiceNumber === q.invoiceNumber));
  const paidEvents = payoutEvents(payments).filter(p => p.date <= q.endDate);
  // Source/invoice filters select detail rows only. Staff balances include all sources:
  // payouts have no invoice allocation and must not be arbitrarily assigned to a line.
  const byStaff = staff.map(st => {
    const mine = period.filter(r => r.staffId === st.id);
    const paid = paidEvents.filter(p => p.staffId === st.id);
    const openingLiability = sumBy(allRows.filter(r => r.staffId === st.id && r.date < q.startDate), r => r.net)
      .minus(sumBy(paid.filter(p => p.date < q.startDate), p => p.signedAmount));
    const earned = sumBy(mine, r => r.earned), reversed = sumBy(mine, r => r.reversed);
    const settled = sumBy(paid.filter(p => p.date >= q.startDate), p => p.signedAmount);
    return { staffId: st.id, staffName: st.name, employeeCode: st.employeeCode,
      attributedNetSales: num(sumBy(mine, r => r.attributedNetSales)), earned: num(earned), reversed: num(reversed),
      net: num(earned.minus(reversed)), paid: num(settled), openingLiability: num(openingLiability),
      outstanding: num(openingLiability.plus(earned).minus(reversed).minus(settled)) };
  }).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const totals = Object.fromEntries(['attributedNetSales', 'earned', 'reversed', 'net', 'paid', 'openingLiability', 'outstanding']
    .map(key => [key, num(sumBy(byStaff, row => row[key]))]));
  return { filters: { ...q, branchId: b || 'ALL' },
    dateBasis: 'Actual customer payment/refund/reversal dates; net of tax and tips. Staff balances include all sources; source/invoice filters apply to detail rows only.',
    summary: totals, byStaff, rows, totals };
};
