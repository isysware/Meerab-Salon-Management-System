// Payroll engine (spec §10.2).
// Implements actual calendar days model (28/29/30/31) and strict worked-days only for daily staff.
// All calculations use Decimal with 20-digit precision — zero manual roundCurrency truncations.

import Decimal from 'decimal.js';
import {
  StaffMember,
  AttendanceRecord,
  OvertimeRecord,
  PayrollPolicyConfig,
  PayslipRecord,
  BranchHoliday,
} from '../types/salon';
import { isWorkingDay } from './attendanceCalculations';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const d = (v: any) => new Decimal(v ?? 0);
const PRESENT_STATUSES = ['PRESENT', 'ON_TIME', 'LATE', 'HALF_DAY', 'COMPLETED'];

export interface EvaluateEmployeePayrollResult {
  payslip: Omit<PayslipRecord, 'id' | 'payrollRunId' | 'payslipNumber' | 'status' | 'payments'>;
  canFinalize: boolean;
  blockReason?: string;
}

/**
 * Returns total calendar days in a given YYYY-MM month.
 */
export function getCalendarDaysInMonth(yearMonth: string): number {
  const [yearStr, monthStr] = yearMonth.split('-');
  return new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
}

/**
 * Returns ISO date strings between startStr and endStr inclusive.
 */
export function getDatesInRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const curr = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

// Format decimal preserving available precision (up to 4 fraction digits if present, min 2)
function fmtDec(val: any): string {
  const dec = d(val);
  const num = dec.toNumber();
  const hasSubCents = !dec.times(100).modulo(1).isZero();
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: hasSubCents ? 4 : 2,
  });
}

/**
 * Evaluates an employee's payroll entitlement with high decimal precision.
 */
export function evaluateEmployeePayroll(
  staff: StaffMember,
  month: string,
  policy: PayrollPolicyConfig,
  attendanceRecords: AttendanceRecord[],
  overtimeRecords: OvertimeRecord[],
  branchHolidays: BranchHoliday[] = [],
  extras: any = {},
  options: any = {}
): EvaluateEmployeePayrollResult {
  const totalCalendarDays = getCalendarDaysInMonth(month);
  const startDateStr = `${month}-01`;
  const endDateStr = `${month}-${String(totalCalendarDays).padStart(2, '0')}`;
  const exitDate = staff.exitDate || null;
  const employed = (dStr: string) => !(staff.joiningDate && staff.joiningDate > dStr) && !(exitDate && exitDate < dStr);

  const isMonthly = staff.compensationType === 'MONTHLY_SALARY' || staff.compensationType === 'MONTHLY_PLUS_COMMISSION';
  const isDaily = staff.compensationType === 'DAILY_SALARY' || staff.compensationType === 'DAILY_PLUS_COMMISSION';
  const isCommissionOnly = staff.compensationType === 'COMMISSION_ONLY';

  // Period range:
  const periodStartDate = options.startDate || startDateStr;
  const selectedEndDate = options.endDate || endDateStr;
  const periodEndDate = options.asOfDate && selectedEndDate > options.asOfDate ? options.asOfDate : selectedEndDate;
  const isPeriodRun = periodStartDate !== startDateStr || periodEndDate !== endDateStr;
  const runType = options.runType || (periodStartDate === periodEndDate ? 'DAILY' : isPeriodRun ? 'CUSTOM_RANGE' : 'MONTHLY');

  // Dates for working days in month (used for reference)
  const allMonthDates = Array.from({ length: totalCalendarDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const fullMonthStaff = { ...staff, joiningDate: '1970-01-01' };
  const workingDaysInMonth = allMonthDates.filter((dateStr) => isWorkingDay(dateStr, fullMonthStaff, branchHolidays).isWorking).length;

  // Actual dates evaluated:
  const datesToEvaluate = isPeriodRun
    ? getDatesInRange(periodStartDate, periodEndDate)
    : allMonthDates;

  // Filter attendance within evaluation period
  const empAttendance = attendanceRecords.filter((a) => {
    if (a.staffId !== staff.id) return false;
    if (isPeriodRun) {
      return a.date >= periodStartDate && a.date <= periodEndDate;
    }
    return a.date.startsWith(month);
  });

  let presentDays = 0;
  let halfDayUnpaidDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let absentDays = 0;
  let missingPunchDays = 0;
  let unrecordedDays = 0;
  let paidHolidayDays = 0;
  let paidWeeklyOffDays = 0;
  let workedWeeklyOffDays = 0;
  let workedHolidayDays = 0;
  let workedDayEquivalents = d(0);

  const exceptionDetails: string[] = [];
  const overlapDates: string[] = [];
  const consumedAttendanceDates: string[] = [];
  let attendancePenaltyDeductions = d(0);
  let totalAbsenceDeductions = d(0);

  // Month days cache for cross-month date splitting
  const monthDaysMap = new Map<string, number>();
  const getDaysForDate = (dateStr: string) => {
    const ym = dateStr.slice(0, 7);
    if (!monthDaysMap.has(ym)) {
      monthDaysMap.set(ym, getCalendarDaysInMonth(ym));
    }
    return monthDaysMap.get(ym)!;
  };

  // Daily rate resolver per date (for monthly staff, daily rate = baseSalary / actualDaysInThatDateMonth)
  const getDailyRateForDate = (dateStr: string) => {
    if (isMonthly) {
      const days = getDaysForDate(dateStr);
      return d(staff.baseSalary || 0).dividedBy(days);
    }
    if (isDaily) {
      return d(staff.dailySalaryRate || 0);
    }
    return d(0);
  };

  const attDates = empAttendance.map((a) => a.date);
  const minAttDate = attDates.length ? attDates.reduce((min, d) => (d < min ? d : min), attDates[0]) : null;
  const maxAttDate = attDates.length ? attDates.reduce((max, d) => (d > max ? d : max), attDates[0]) : null;

  for (const dateStr of datesToEvaluate) {
    if (!employed(dateStr)) continue;

    // Check if this date was ALREADY finalized in another payroll run
    if (options.alreadyFinalizedDates?.has?.(dateStr)) {
      overlapDates.push(dateStr);
      continue;
    }

    const check = isWorkingDay(dateStr, staff, branchHolidays);
    const att = empAttendance.find((a) => a.date === dateStr);
    const dateRate = getDailyRateForDate(dateStr);

    if (isMonthly) {
      // ════════════ MONTHLY STAFF ATTENDANCE RULES ════════════
      if (att) {
        consumedAttendanceDates.push(dateStr);

        if (att.status === 'HOLIDAY') {
          paidHolidayDays++;
        } else if (att.status === 'WEEKLY_OFF' || att.status === 'OFF_DAY') {
          paidWeeklyOffDays++;
        } else if (att.status === 'PAID_LEAVE') {
          paidLeaveDays++;
        } else if (att.status === 'UNPAID_LEAVE') {
          unpaidLeaveDays++;
          totalAbsenceDeductions = totalAbsenceDeductions.plus(dateRate);
        } else if (att.status === 'MISSING_PUNCH' || (att.isMissingPunch && att.status !== 'PRESENT' && att.status !== 'HALF_DAY')) {
          absentDays++;
          missingPunchDays++;
          totalAbsenceDeductions = totalAbsenceDeductions.plus(dateRate);
          exceptionDetails.push(`Missing Punch on ${dateStr}. Incomplete punch must be resolved before finalization.`);
        } else if (att.status === 'ABSENT') {
          absentDays++;
          totalAbsenceDeductions = totalAbsenceDeductions.plus(dateRate);
        } else if (PRESENT_STATUSES.includes(att.status)) {
          if (att.status === 'HALF_DAY') {
            presentDays += 0.5;
            halfDayUnpaidDays += 0.5;
            unpaidLeaveDays += 0.5;
            totalAbsenceDeductions = totalAbsenceDeductions.plus(dateRate.times(0.5));
            if (att.calculationSnapshot?.lateDeductionAmount) {
              attendancePenaltyDeductions = attendancePenaltyDeductions.plus(d(att.calculationSnapshot.lateDeductionAmount));
            }
            if (!check.isWorking) {
              if (check.reason?.startsWith('Holiday')) workedHolidayDays += 0.5;
              else if (check.reason?.startsWith('Weekly off')) workedWeeklyOffDays += 0.5;
            }
          } else {
            presentDays += 1;
            if (att.calculationSnapshot?.totalDeductionAmount) {
              attendancePenaltyDeductions = attendancePenaltyDeductions.plus(d(att.calculationSnapshot.totalDeductionAmount));
            }
            if (!check.isWorking) {
              if (check.reason?.startsWith('Holiday')) workedHolidayDays += 1;
              else if (check.reason?.startsWith('Weekly off')) workedWeeklyOffDays += 1;
            }
          }
        }
      } else {
        // No attendance record on this date
        if (check.isWorking) {
          absentDays++;
          unrecordedDays++;
          totalAbsenceDeductions = totalAbsenceDeductions.plus(dateRate);
        } else {
          // Non-working day with no record:
          if (minAttDate && maxAttDate && dateStr >= minAttDate && dateStr <= maxAttDate) {
            // Normal non-worked weekly off/holiday within the active attendance period
            if (check.reason?.startsWith('Holiday')) paidHolidayDays++;
            else paidWeeklyOffDays++;
          } else {
            // Unrecorded period: tracked as absent/unrecorded with deduction
            absentDays++;
            unrecordedDays++;
            totalAbsenceDeductions = totalAbsenceDeductions.plus(dateRate);
          }
        }
      }
    } else if (isDaily) {
      // ════════════ DAILY STAFF RULES (STRICT WORKED-DAYS ONLY) ════════════
      if (att) {
        consumedAttendanceDates.push(dateStr);
        if (PRESENT_STATUSES.includes(att.status)) {
          if (att.status === 'HALF_DAY') {
            presentDays += 0.5;
            halfDayUnpaidDays += 0.5;
            workedDayEquivalents = workedDayEquivalents.plus(0.5);
            if (att.calculationSnapshot?.lateDeductionAmount) {
              attendancePenaltyDeductions = attendancePenaltyDeductions.plus(d(att.calculationSnapshot.lateDeductionAmount));
            }
            if (!check.isWorking) {
              if (check.reason?.startsWith('Holiday')) workedHolidayDays += 0.5;
              else if (check.reason?.startsWith('Weekly off')) workedWeeklyOffDays += 0.5;
            }
          } else {
            presentDays += 1;
            workedDayEquivalents = workedDayEquivalents.plus(1);
            if (att.calculationSnapshot?.totalDeductionAmount) {
              attendancePenaltyDeductions = attendancePenaltyDeductions.plus(d(att.calculationSnapshot.totalDeductionAmount));
            }
            if (!check.isWorking) {
              if (check.reason?.startsWith('Holiday')) workedHolidayDays += 1;
              else if (check.reason?.startsWith('Weekly off')) workedWeeklyOffDays += 1;
            }
          }
        } else {
          // Non-worked day on daily contract earns zero
          if (att.status === 'HOLIDAY') paidHolidayDays++;
          else if (att.status === 'WEEKLY_OFF' || att.status === 'OFF_DAY') paidWeeklyOffDays++;
          else if (att.status === 'PAID_LEAVE') paidLeaveDays++;
          else if (att.status === 'UNPAID_LEAVE') unpaidLeaveDays++;
          else if (att.status === 'ABSENT') absentDays++;
          else if (att.status === 'MISSING_PUNCH') {
            missingPunchDays++;
            exceptionDetails.push(`Missing Punch on ${dateStr}. Incomplete punch must be resolved before finalization.`);
          }
        }
      } else {
        if (check.isWorking) {
          absentDays++;
          unrecordedDays++;
        } else {
          if (minAttDate && maxAttDate && dateStr >= minAttDate && dateStr <= maxAttDate) {
            if (check.reason?.startsWith('Holiday')) paidHolidayDays++;
            else paidWeeklyOffDays++;
          } else {
            absentDays++;
            unrecordedDays++;
          }
        }
      }
    }
  }

  // ── Overtime (approved, not locked by finalized run, in period) ──
  const empOvertime = overtimeRecords.filter((ot) => {
    if (ot.staffId !== staff.id) return false;
    if (ot.status !== 'APPROVED' || ot.payrollId || (ot as any).payrollRunId) return false;
    if (!employed(ot.date)) return false;
    if (options.alreadyFinalizedOvertimeIds?.has?.(ot.id)) return false;
    if (isPeriodRun) {
      return ot.date >= periodStartDate && ot.date <= periodEndDate;
    }
    return ot.date.startsWith(month);
  });

  const hourlyRateSnapshot = staff.overtimeHourlyRate ?? 0;
  let approvedOvertimeMinutes = 0;
  let approvedOvertimeAmount = d(0);
  const consumedOvertimeIds: string[] = [];
  for (const ot of empOvertime) {
    const mins = ot.approvedMinutes || ot.minutes || 0;
    approvedOvertimeMinutes += mins;
    const rate = d(ot.hourlyRate ?? hourlyRateSnapshot);
    const otAmt = ot.amount !== undefined && ot.amount !== null
      ? d(ot.amount)
      : d(mins).dividedBy(60).times(rate);
    approvedOvertimeAmount = approvedOvertimeAmount.plus(otAmt);
    consumedOvertimeIds.push(ot.id);
  }
  const approvedOvertimeHours = approvedOvertimeMinutes > 0
    ? d(approvedOvertimeMinutes).dividedBy(60).toNumber()
    : 0;

  // ── Basic Pay & Proration ──
  const employedDates = datesToEvaluate.filter(employed);
  const effectiveStartDate = employedDates[0] || periodStartDate;
  const effectiveEndDate = employedDates[employedDates.length - 1] || periodEndDate;
  const payableDays = employedDates.length;
  const excludedAttendanceDays = empAttendance.filter((a) => !employed(a.date)).length;

  let baseEarnings = d(0);
  let leaveEarnings = d(0);
  let holidayEarnings = d(0);
  let absenceDeductions = d(0);
  let isProrated = false;
  let prorationFormula = '';

  const joinedMidMonth = !!staff.joiningDate && staff.joiningDate > startDateStr && staff.joiningDate <= endDateStr;
  const leftMidMonth = !!exitDate && exitDate >= startDateStr && exitDate < endDateStr;

  if (isMonthly) {
    const fullMonthlyBase = d(staff.baseSalary || 0);
    const isFullEmployedMonth = !isPeriodRun && !joinedMidMonth && !leftMidMonth && employedDates.length === totalCalendarDays;

    if (isFullEmployedMonth) {
      // Full calendar month: Full configured monthly base salary exactly.
      baseEarnings = fullMonthlyBase;
      prorationFormula = `Full calendar month (${totalCalendarDays} days): PKR ${fmtDec(fullMonthlyBase)}`;
    } else {
      isProrated = true;
      // Partial month (joined/left mid-month or period run): Sum daily rates of employed dates.
      // Daily rate for each date = baseSalary / actualCalendarDaysInThatMonth.
      let sumBase = d(0);
      for (const dateStr of employedDates) {
        sumBase = sumBase.plus(getDailyRateForDate(dateStr));
      }
      baseEarnings = sumBase;
      const sampleDailyRate = getDailyRateForDate(employedDates[0] || periodStartDate);
      prorationFormula = `Prorated: ${employedDates.length} eligible days @ PKR ${fmtDec(sampleDailyRate)}/day = PKR ${fmtDec(baseEarnings)}`;
    }

    // Absence deductions cannot exceed base earnings:
    absenceDeductions = Decimal.min(baseEarnings, totalAbsenceDeductions);
  } else if (isDaily) {
    // Daily Staff: Strict worked-days only!
    const dailyRate = d(staff.dailySalaryRate || 0);
    baseEarnings = dailyRate.times(workedDayEquivalents);
    leaveEarnings = d(0);
    holidayEarnings = d(0);
    absenceDeductions = d(0); // Zero deduction: non-worked days earned zero base pay.
    prorationFormula = `Strict worked days: ${workedDayEquivalents.toString()} verified day equivalents @ PKR ${fmtDec(dailyRate)}/day = PKR ${fmtDec(baseEarnings)}`;
  } else if (isCommissionOnly) {
    baseEarnings = d(0);
    leaveEarnings = d(0);
    holidayEarnings = d(0);
    absenceDeductions = d(0);
    prorationFormula = 'Commission-Only Contract: Zero base salary entitlement.';
  }

  // ── Allowances & One-off Adjustments ──
  const daysInPeriod = datesToEvaluate.length;
  const allowanceLines = (extras.allowances || []).map((a: any) => {
    let amt = d(a.amount);
    if (isPeriodRun && isMonthly) {
      const span = datesToEvaluate.filter(employed);
      const fraction = d(span.length).dividedBy(totalCalendarDays);
      amt = amt.times(fraction);
    } else if (isPeriodRun && isDaily) {
      amt = amt.dividedBy(totalCalendarDays).times(daysInPeriod);
    }
    return { id: a.id, name: a.name, amount: amt.toNumber() };
  });

  const adjustments = (extras.adjustments || []).map((a: any) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    amount: d(a.amount).toNumber(),
  }));

  const recurringAllowances = allowanceLines.reduce((s: Decimal, a: any) => s.plus(d(a.amount)), d(0));
  const oneOffAllowances = (extras.adjustments || []).filter((a: any) => a.type === 'ALLOWANCE').reduce((s: Decimal, a: any) => s.plus(d(a.amount)), d(0));
  const bonusAmount = (extras.adjustments || []).filter((a: any) => a.type === 'BONUS').reduce((s: Decimal, a: any) => s.plus(d(a.amount)), d(0));
  const otherDeductions = (extras.adjustments || []).filter((a: any) => a.type === 'DEDUCTION').reduce((s: Decimal, a: any) => s.plus(d(a.amount)), d(0));
  const allowancesTotal = recurringAllowances.plus(oneOffAllowances).plus(bonusAmount);

  // Salary gross payable: NO commission is added to salary.
  const grossPayable = baseEarnings
    .plus(leaveEarnings)
    .plus(holidayEarnings)
    .plus(approvedOvertimeAmount)
    .plus(allowancesTotal);

  const preAdvanceDeductions = absenceDeductions
    .plus(attendancePenaltyDeductions)
    .plus(otherDeductions);

  // ── Advance Recovery ──
  let room = Decimal.max(0, grossPayable.minus(preAdvanceDeductions));
  const advanceRecoveries: any[] = [];
  for (const adv of extras.advances || []) {
    const recoveredThisMonth = d(adv.recoveredThisMonth || 0);
    const maxMonthlyAllowance = Decimal.max(0, d(adv.recoveryPerMonth).minus(recoveredThisMonth));
    if (maxMonthlyAllowance.lessThanOrEqualTo(0)) continue;

    let planned;
    if (runType === 'DAILY' || (periodStartDate === periodEndDate)) {
      const dailyInstallment = d(adv.recoveryPerMonth).dividedBy(totalCalendarDays);
      planned = Decimal.min(dailyInstallment, maxMonthlyAllowance, d(adv.balance));
    } else if (isPeriodRun) {
      const rangeInstallment = d(adv.recoveryPerMonth).dividedBy(totalCalendarDays).times(daysInPeriod);
      planned = Decimal.min(rangeInstallment, maxMonthlyAllowance, d(adv.balance));
    } else {
      planned = Decimal.min(maxMonthlyAllowance, d(adv.balance));
    }

    const amt = Decimal.min(planned, room);
    if (amt.greaterThan(0)) {
      advanceRecoveries.push({
        advanceId: adv.id,
        advanceNumber: adv.advanceNumber,
        amount: amt.toNumber(),
        balanceBefore: d(adv.balance).toNumber(),
        balanceAfter: d(adv.balance).minus(amt).toNumber(),
      });
      room = Decimal.max(0, room.minus(amt));
    }
  }
  const advanceRecoveryAmount = advanceRecoveries.reduce((s: Decimal, a: any) => s.plus(d(a.amount)), d(0));

  const totalDeductions = preAdvanceDeductions.plus(advanceRecoveryAmount);
  const standardNetPayable = Decimal.max(0, grossPayable.minus(totalDeductions));
  const attendanceImpact = d(0).minus(absenceDeductions.plus(attendancePenaltyDeductions));

  // STEP 3: Reconciliation for previously finalized or paid custom salary in the same month
  const alreadyPaidSalary = d((options as any).alreadyPaidSalary || 0);
  const alreadyFinalizedNet = d((options as any).alreadyFinalizedNet || 0);
  const previouslyPaidCustomSalary = Decimal.max(alreadyPaidSalary, alreadyFinalizedNet);

  let monthlyEarnedSalary = standardNetPayable;
  let remainingMonthlySalary = standardNetPayable;
  let effectiveGrossPayable = grossPayable;
  let netPayable = standardNetPayable;

  if (isMonthly && previouslyPaidCustomSalary.gt(0)) {
    remainingMonthlySalary = Decimal.max(0, standardNetPayable.minus(previouslyPaidCustomSalary));
    effectiveGrossPayable = Decimal.max(0, grossPayable.minus(previouslyPaidCustomSalary));
    netPayable = remainingMonthlySalary;
  }

  let canFinalize = true;
  let blockReason: string | undefined;
  if (overlapDates.length) {
    if (runType === 'MONTHLY' && isMonthly && overlapDates.length < employedDates.length && previouslyPaidCustomSalary.gt(0)) {
      // Monthly reconciliation run: earlier dates were already finalized in a custom range and deducted above!
      // This is an intentional reconciliation, not a blocking conflict.
    } else if (overlapDates.length >= employedDates.length) {
      canFinalize = false;
      blockReason = 'All salary days for this employee in this month have already been finalized.';
    } else {
      canFinalize = false;
      blockReason = `Salary days have already been paid or reserved in an earlier finalized payroll run: ${overlapDates.join(', ')}.`;
    }
  }
  const hasExceptions = exceptionDetails.length > 0;
  if (hasExceptions) {
    canFinalize = false;
    blockReason = `Unresolved attendance exceptions: ${exceptionDetails.join(' ')}`;
  }
  if (grossPayable.minus(totalDeductions).isNegative()) {
    canFinalize = false;
    blockReason = `Negative salary entitlement detected. Deductions exceed gross earnings. Review penalties/adjustments before finalization.`;
  }

  const extrasText = ` + Allowances (PKR ${fmtDec(allowancesTotal)}) - Other Deductions (PKR ${fmtDec(otherDeductions)}) - Advance Recovery (PKR ${fmtDec(advanceRecoveryAmount)})`;
  let formula = '';
  const currentDailyRate = getDailyRateForDate(employedDates[0] || periodStartDate);

  if (isMonthly) {
    formula = `${prorationFormula}. Base (PKR ${fmtDec(baseEarnings)}) - Absences (${absentDays + unpaidLeaveDays + halfDayUnpaidDays}d @ PKR ${fmtDec(currentDailyRate)}/d = PKR ${fmtDec(absenceDeductions)}) - Penalties (PKR ${fmtDec(attendancePenaltyDeductions)}) + Overtime (${approvedOvertimeMinutes}m = PKR ${fmtDec(approvedOvertimeAmount)})${extrasText} = Net PKR ${fmtDec(netPayable)}`;
  } else if (isDaily) {
    formula = `${prorationFormula}. Base (PKR ${fmtDec(baseEarnings)}) - Penalties (PKR ${fmtDec(attendancePenaltyDeductions)}) + Overtime (PKR ${fmtDec(approvedOvertimeAmount)})${extrasText} = Net PKR ${fmtDec(netPayable)}`;
  } else {
    formula = `Commission-Only Contract: Base = PKR 0. Approved Overtime = PKR ${fmtDec(approvedOvertimeAmount)}${extrasText}. Net PKR ${fmtDec(netPayable)}. Commission earned is processed separately via Commission page.`;
  }

  if (isMonthly && previouslyPaidCustomSalary.gt(0)) {
    formula += ` [Reconciliation: Full Month Earned PKR ${fmtDec(monthlyEarnedSalary)} - Previously Paid Custom Salary PKR ${fmtDec(previouslyPaidCustomSalary)} = Remaining Net PKR ${fmtDec(netPayable)}]`;
  }

  return {
    canFinalize,
    blockReason,
    payslip: {
      staffId: staff.id,
      staffName: staff.name,
      employeeCode: staff.employeeCode,
      designation: staff.designation || (staff as any).roleTitle,
      branchId: staff.branchId,
      month,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      runType,
      compensationType: staff.compensationType,
      effectiveBaseSalary: staff.baseSalary || 0,
      effectiveDailyRate: currentDailyRate.toNumber(),
      termsEffectiveDate: staff.effectiveDate,
      joiningDate: staff.joiningDate,
      employmentNotes: excludedAttendanceDays > 0
        ? [`${excludedAttendanceDays} attendance record(s) outside employment dates excluded. Verify joining/exit dates before finalizing.`] : [],
      exitDate: exitDate || undefined,
      workingDaysInMonth,
      calendarDaysInMonth: totalCalendarDays,
      presentDays,
      halfDayDays: halfDayUnpaidDays * 2,
      lateDays: empAttendance.filter((a) => consumedAttendanceDates.includes(a.date) && a.isLate).length,
      earlyExitDays: empAttendance.filter((a) => consumedAttendanceDates.includes(a.date) && a.isEarlyExit).length,
      paidLeaveDays,
      unpaidLeaveDays,
      absentDays,
      paidHolidayDays,
      paidWeeklyOffDays,
      holidayDays: paidHolidayDays,
      weeklyOffDays: paidWeeklyOffDays,
      workedWeeklyOffDays,
      workedHolidayDays,
      workedDayEquivalents: isDaily ? workedDayEquivalents.toNumber() : presentDays,
      missingPunchDays,
      unrecordedDays,
      hasExceptions,
      exceptionDetails: hasExceptions ? exceptionDetails : undefined,
      baseEarnings: baseEarnings.toNumber(),
      leaveEarnings: leaveEarnings.toNumber(),
      holidayEarnings: holidayEarnings.toNumber(),
      absenceDeductions: absenceDeductions.toNumber(),
      lateEarlyDeductions: attendancePenaltyDeductions.toNumber(),
      attendancePenaltyDeductions: attendancePenaltyDeductions.toNumber(),
      attendanceImpact: attendanceImpact.toNumber(),
      approvedOvertimeMinutes,
      approvedOvertimeHours,
      approvedOvertimeHourlyRate: hourlyRateSnapshot,
      approvedOvertimeAmount: approvedOvertimeAmount.toNumber(),
      consumedOvertimeIds,
      consumedAttendanceDates,
      allowanceLines,
      adjustments,
      recurringAllowances: recurringAllowances.toNumber(),
      oneOffAllowances: oneOffAllowances.toNumber(),
      bonusAmount: bonusAmount.toNumber(),
      allowancesTotal: allowancesTotal.toNumber(),
      otherDeductions: otherDeductions.toNumber(),
      advanceRecoveries,
      advanceRecoveryAmount: advanceRecoveryAmount.toNumber(),
      monthlyEarnedSalary: isMonthly && previouslyPaidCustomSalary.gt(0) ? monthlyEarnedSalary.toNumber() : undefined,
      previouslyPaidCustomSalary: previouslyPaidCustomSalary.gt(0) ? previouslyPaidCustomSalary.toNumber() : 0,
      remainingMonthlySalary: isMonthly && previouslyPaidCustomSalary.gt(0) ? remainingMonthlySalary.toNumber() : undefined,
      grossPayable: effectiveGrossPayable.toNumber(),
      totalDeductions: totalDeductions.toNumber(),
      netPayable: netPayable.toNumber(),
      paidAmount: 0,
      outstandingAmount: netPayable.toNumber(),
      calculationDetails: {
        formula,
        monthlyCalculationVersion: 3,
        divisorRule: isMonthly ? `Actual Calendar Days (${totalCalendarDays})` : 'Strict Worked Days',
        divisorUsed: isMonthly ? totalCalendarDays : undefined,
        payableDays: isMonthly
          ? Decimal.max(0, d(totalCalendarDays).minus(absentDays + unpaidLeaveDays + halfDayUnpaidDays)).toNumber()
          : workedDayEquivalents.toNumber(),
        prorationDivisor: isMonthly ? totalCalendarDays : undefined,
        prorationDays: isMonthly
          ? Decimal.max(0, d(totalCalendarDays).minus(absentDays + unpaidLeaveDays + halfDayUnpaidDays)).toNumber()
          : undefined,
        prorationApplied: isProrated,
        prorationFormula: isMonthly ? prorationFormula : undefined,
        dailyRateUsed: currentDailyRate.toNumber(),
        periodType: runType,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        policyNotes: isMonthly
          ? `Actual Calendar Days Model (Divisor: /${totalCalendarDays}). Full month entitlement = PKR ${fmtDec(staff.baseSalary || 0)}. Paid leaves and weekly offs covered by monthly salary.`
          : `Strict Worked Days Model. Daily rate = PKR ${fmtDec(currentDailyRate)}/day. Non-worked days, leaves, and holidays earn Rs. 0 and are never deducted. Half-day earns 0.5×.`,
      },
    },
  };
}
