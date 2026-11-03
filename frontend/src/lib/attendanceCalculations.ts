import Decimal from 'decimal.js';
import {
  StaffMember,
  AttendanceDeductionSnapshot,
  LeaveRecord,
  BranchHoliday,
} from '../types/salon';
import { roundCurrency } from './taxCalculations';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
const d = (v: any) => new Decimal(v ?? 0);

export function getCalendarDaysInMonth(yearMonth: string): number {
  const [yearStr, monthStr] = yearMonth.split('-');
  return new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
}

/**
 * Parses time string like "09:00 AM", "9:30 PM", "14:15", or "09:00" to minutes from midnight (0-1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.trim()) return 0;
  const clean = timeStr.trim().toUpperCase();

  const is12Hour = clean.includes('AM') || clean.includes('PM');
  if (is12Hour) {
    const isPM = clean.includes('PM');
    const withoutPeriod = clean.replace(/AM|PM/g, '').trim();
    const [hStr, mStr] = withoutPeriod.split(':');
    let hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr || '0', 10);
    if (isNaN(hours)) hours = 0;
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    return hours * 60 + (isNaN(minutes) ? 0 : minutes);
  }

  // 24-hour format
  const [hStr, mStr] = clean.split(':');
  const hours = parseInt(hStr, 10) || 0;
  const minutes = parseInt(mStr || '0', 10) || 0;
  return hours * 60 + minutes;
}

/**
 * Formats minutes from midnight into 12-hour format e.g. "09:15 AM".
 */
export function formatMinutesToTime(totalMinutes: number): string {
  let normalized = totalMinutes % (24 * 60);
  if (normalized < 0) normalized += 24 * 60;
  let hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Evaluates lateness against scheduled start time and grace period.
 * Rule: Arriving exactly at the late threshold is NOT late.
 */
export function evaluateLateness(
  checkInTimeStr: string,
  scheduledStartTimeStr: string,
  lateGraceMinutes: number = 15
): { isLate: boolean; lateMinutes: number } {
  if (!checkInTimeStr || !scheduledStartTimeStr) {
    return { isLate: false, lateMinutes: 0 };
  }

  const checkInMin = parseTimeToMinutes(checkInTimeStr);
  const startMin = parseTimeToMinutes(scheduledStartTimeStr);
  const diff = checkInMin - startMin;

  // Arriving on or before startMin + lateGraceMinutes is NOT late
  if (diff <= lateGraceMinutes) {
    return { isLate: false, lateMinutes: 0 };
  }

  return { isLate: true, lateMinutes: diff };
}

/**
 * Evaluates early exit against scheduled end time and grace period.
 * Rule: Leaving exactly at the early threshold is NOT an early exit.
 */
export function evaluateEarlyExit(
  checkOutTimeStr: string,
  scheduledEndTimeStr: string,
  earlyGraceMinutes: number = 15,
  isOvernightShift: boolean = false
): { isEarlyExit: boolean; earlyExitMinutes: number } {
  if (!checkOutTimeStr || !scheduledEndTimeStr) {
    return { isEarlyExit: false, earlyExitMinutes: 0 };
  }

  let checkOutMin = parseTimeToMinutes(checkOutTimeStr);
  let endMin = parseTimeToMinutes(scheduledEndTimeStr);

  if (isOvernightShift) {
    // If shift spans midnight (e.g. 21:00 to 05:00), endMin is next day
    if (checkOutMin < 12 * 60) checkOutMin += 24 * 60;
    if (endMin < 12 * 60) endMin += 24 * 60;
  }

  const diff = endMin - checkOutMin;

  // Leaving on or after endMin - earlyGraceMinutes is NOT early exit
  if (diff <= earlyGraceMinutes) {
    return { isEarlyExit: false, earlyExitMinutes: 0 };
  }

  return { isEarlyExit: true, earlyExitMinutes: diff };
}

/**
 * Calculates worked hours between check-in and check-out.
 */
export function calculateWorkedHours(
  checkInTimeStr: string,
  checkOutTimeStr?: string,
  isOvernightShift: boolean = false
): number {
  if (!checkInTimeStr || !checkOutTimeStr) return 0;

  const inMin = parseTimeToMinutes(checkInTimeStr);
  let outMin = parseTimeToMinutes(checkOutTimeStr);

  if (isOvernightShift || outMin < inMin) {
    outMin += 24 * 60;
  }

  const workedMinutes = Math.max(0, outMin - inMin);
  return roundCurrency(workedMinutes / 60);
}

/**
 * Computes scheduled duration in hours.
 */
export function calculateScheduledHours(
  startTimeStr: string,
  endTimeStr: string,
  isOvernightShift: boolean = false
): number {
  if (!startTimeStr || !endTimeStr) return 8.0;

  const inMin = parseTimeToMinutes(startTimeStr);
  let outMin = parseTimeToMinutes(endTimeStr);

  if (isOvernightShift || outMin < inMin) {
    outMin += 24 * 60;
  }

  return roundCurrency(Math.max(0, outMin - inMin) / 60);
}

/**
 * Generates an auditable deduction preview snapshot based on staff's effective compensation policy.
 * Important: Commission-only staff never have salary penalties deducted from commission or tips.
 * Monthly staff daily rate derives dynamically from actual calendar days (28/29/30/31).
 */
export function calculateDeductionSnapshot(
  staff: StaffMember,
  isLate: boolean,
  lateMinutes: number,
  isEarlyExit: boolean,
  earlyExitMinutes: number,
  workDate?: string
): AttendanceDeductionSnapshot {
  const calculatedAt = new Date().toISOString();

  // Commission Only: strictly zero salary deduction
  if (staff.compensationType === 'COMMISSION_ONLY') {
    return {
      calculatedAt,
      compensationType: staff.compensationType,
      baseSalary: 0,
      dailySalaryRate: 0,
      payrollDivisor: staff.payrollDivisor,
      effectiveDailyBase: 0,
      lateDeductionAmount: 0,
      earlyExitDeductionAmount: 0,
      totalDeductionAmount: 0,
      combinationPolicy: staff.combinationPolicy || 'HIGHEST_ONLY',
      notes: 'Commission Only staff have zero salary deductions; commission and tips are protected.',
    };
  }

  let effectiveDailyBase = d(0);
  let divisorUsed: number | undefined = undefined;

  if (staff.compensationType === 'DAILY_SALARY' || staff.compensationType === 'DAILY_PLUS_COMMISSION') {
    effectiveDailyBase = d(staff.dailySalaryRate || 0);
  } else if (staff.compensationType === 'MONTHLY_SALARY' || staff.compensationType === 'MONTHLY_PLUS_COMMISSION') {
    const ym = workDate ? String(workDate).slice(0, 7) : new Date().toISOString().slice(0, 7);
    divisorUsed = getCalendarDaysInMonth(ym);
    effectiveDailyBase = d(staff.baseSalary || 0).dividedBy(divisorUsed);
  }

  let lateDeductionAmount = d(0);
  if (isLate && staff.lateInDeduction?.enabled) {
    if (staff.lateInDeduction.type === 'FIXED') {
      lateDeductionAmount = d(staff.lateInDeduction.amount || 0);
    } else if (staff.lateInDeduction.type === 'PERCENTAGE') {
      const pct = d(staff.lateInDeduction.amount || 0).dividedBy(100);
      lateDeductionAmount = effectiveDailyBase.times(pct);
    }
  }

  let earlyExitDeductionAmount = d(0);
  if (isEarlyExit && staff.earlyExitDeduction?.enabled) {
    if (staff.earlyExitDeduction.type === 'FIXED') {
      earlyExitDeductionAmount = d(staff.earlyExitDeduction.amount || 0);
    } else if (staff.earlyExitDeduction.type === 'PERCENTAGE') {
      const pct = d(staff.earlyExitDeduction.amount || 0).dividedBy(100);
      earlyExitDeductionAmount = effectiveDailyBase.times(pct);
    }
  }

  let totalDeductionAmount = d(0);
  const policy = staff.combinationPolicy || 'HIGHEST_ONLY';
  if (policy === 'BOTH') {
    totalDeductionAmount = lateDeductionAmount.plus(earlyExitDeductionAmount);
  } else {
    // HIGHEST_ONLY
    totalDeductionAmount = Decimal.max(lateDeductionAmount, earlyExitDeductionAmount);
  }

  let notes = '';
  if (isLate && isEarlyExit) {
    notes = `Late by ${lateMinutes}m & Early exit by ${earlyExitMinutes}m. Applied policy: ${policy}. Daily base: PKR ${effectiveDailyBase.toString()} (Divisor: ${divisorUsed || 'Daily'}).`;
  } else if (isLate) {
    notes = `Late arrival by ${lateMinutes}m. Daily base: PKR ${effectiveDailyBase.toString()} (Divisor: ${divisorUsed || 'Daily'}).`;
  } else if (isEarlyExit) {
    notes = `Early departure by ${earlyExitMinutes}m. Daily base: PKR ${effectiveDailyBase.toString()} (Divisor: ${divisorUsed || 'Daily'}).`;
  } else {
    notes = 'On time attendance. No deductions.';
  }

  return {
    calculatedAt,
    compensationType: staff.compensationType,
    baseSalary: staff.baseSalary || 0,
    dailySalaryRate: staff.dailySalaryRate || 0,
    payrollDivisor: divisorUsed || staff.payrollDivisor,
    effectiveDailyBase: effectiveDailyBase.toNumber(),
    lateDeductionAmount: lateDeductionAmount.toNumber(),
    earlyExitDeductionAmount: earlyExitDeductionAmount.toNumber(),
    totalDeductionAmount: totalDeductionAmount.toNumber(),
    combinationPolicy: policy,
    notes,
  };
}

/**
 * Evaluates leave allowance for a staff member within their configured allowance period.
 * Does not treat unconfigured allowance as zero; displays "Not configured".
 */
export function evaluateLeaveAllowance(
  staff: StaffMember,
  existingLeaves: LeaveRecord[],
  targetDate: string,
  branchHolidays: BranchHoliday[] = []
): {
  isConfigured: boolean;
  allowedDays: number;
  period: 'MONTHLY' | 'YEARLY';
  usedDays: number;
  remainingDays: number;
} {
  const period = staff.leaveAllowancePeriod || 'MONTHLY';
  const allowed = staff.allowedLeaveDays ?? (staff as any).leaveAllowanceDays;
  const isConfigured = typeof allowed === 'number' && allowed > 0;

  if (!isConfigured) {
    return {
      isConfigured: false,
      allowedDays: 0,
      period,
      usedDays: 0,
      remainingDays: 0,
    };
  }

  const year = Number(targetDate.slice(0, 4));
  const month = Number(targetDate.slice(5, 7));
  const from = period === 'MONTHLY' ? `${targetDate.slice(0, 7)}-01` : `${year}-01-01`;
  const to = period === 'MONTHLY' ? `${targetDate.slice(0, 7)}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` : `${year}-12-31`;
  const activeLeaves = existingLeaves.filter((l) => l.staffId === staff.id && l.status === 'APPROVED' && l.type === 'PAID' && l.startDate <= to && l.endDate >= from);
  const usedDays = activeLeaves.reduce((sum, l) => {
    if (l.workingDates) return sum + l.workingDates.filter((date) => date >= from && date <= to).length;
    if (l.startDate >= from && l.endDate <= to) return sum + l.totalDays;
    let days = 0;
    for (const day = new Date(`${l.startDate > from ? l.startDate : from}T00:00:00Z`); day.toISOString().slice(0, 10) <= (l.endDate < to ? l.endDate : to); day.setUTCDate(day.getUTCDate() + 1)) {
      if (isWorkingDay(day.toISOString().slice(0, 10), staff, branchHolidays).isWorking) days++;
    }
    return sum + Math.min(days, l.totalDays);
  }, 0);
  const remainingDays = Math.max(0, allowed - usedDays);

  return {
    isConfigured: true,
    allowedDays: allowed,
    period,
    usedDays,
    remainingDays,
  };
}

/**
 * Checks if a specific date is a working day for the staff member.
 * Checks branch holidays and weekly off days (defaulting Sunday = 0 as weekly off unless configured).
 */
export function isWorkingDay(
  dateStr: string,
  staff: StaffMember,
  branchHolidays: BranchHoliday[] = []
): { isWorking: boolean; reason?: string } {
  // Check branch holiday
  const holiday = branchHolidays.find(
    (h) => (h.branchId === 'ALL' || h.branchId === staff.branchId) && h.date === dateStr
  );
  if (holiday) {
    return { isWorking: false, reason: `Holiday: ${holiday.title}` };
  }

  // If staff has joined after dateStr, not working
  if (staff.joiningDate && staff.joiningDate > dateStr) {
    return { isWorking: false, reason: 'Prior to employment start date' };
  }

  return { isWorking: true };
}
