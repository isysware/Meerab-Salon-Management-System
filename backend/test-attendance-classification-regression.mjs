import assert from 'node:assert/strict';
import { evaluateEmployeePayroll } from './src/lib/calculations/payrollCalculations.js';

console.log('--- RUNNING ATTENDANCE CLASSIFICATION REGRESSION TESTS ---');

// TEST 1: Aaliyan October 2026 (Monthly Staff)
// Expected: Present 5, Paid Leave 3, Unpaid Leave 2, Holidays 2, Weekly Off 1, Worked Off Detail 1, Absent 18
const staffAaliyan = {
  id: 'staff-aaliyan',
  name: 'Aaliyan',
  employeeCode: 'EMP1-0002',
  compensationType: 'MONTHLY_PLUS_COMMISSION',
  baseSalary: 30000,
  dailySalaryRate: 0,
  workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] // Sunday off
};

const attendanceAaliyan = [
  { staffId: 'staff-aaliyan', date: '2026-10-01', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-02', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-03', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-04', status: 'PRESENT' }, // Worked Sunday (Weekly off)
  { staffId: 'staff-aaliyan', date: '2026-10-05', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-06', status: 'PAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-07', status: 'PAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-08', status: 'PAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-09', status: 'UNPAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-10', status: 'UNPAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-11', status: 'HOLIDAY' }, // Holiday on Sunday
  { staffId: 'staff-aaliyan', date: '2026-10-12', status: 'HOLIDAY' }, // Holiday on Monday
  { staffId: 'staff-aaliyan', date: '2026-10-13', status: 'WEEKLY_OFF' } // Weekly off on Tuesday
];

const resAaliyan = evaluateEmployeePayroll(staffAaliyan, '2026-10', {}, attendanceAaliyan, [], [], {}, {
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  runType: 'MONTHLY'
});

const p = resAaliyan.payslip;

console.log('Test 1 - Aaliyan Counts:', {
  presentDays: p.presentDays,
  paidLeaveDays: p.paidLeaveDays,
  unpaidLeaveDays: p.unpaidLeaveDays,
  holidayDays: p.holidayDays,
  weeklyOffDays: p.weeklyOffDays,
  workedWeeklyOffDays: p.workedWeeklyOffDays,
  absentDays: p.absentDays,
  netPayable: p.netPayable
});

// Assertions matching user's exact specification
assert.equal(p.presentDays, 5, 'Present days must be exactly 5');
assert.equal(p.paidLeaveDays, 3, 'Paid leave days must be exactly 3');
assert.equal(p.unpaidLeaveDays, 2, 'Unpaid leave days must be exactly 2');
assert.equal(p.holidayDays, 2, 'Holiday days must be exactly 2 (Oct 11 + Oct 12)');
assert.equal(p.weeklyOffDays, 1, 'Weekly off days must be exactly 1 (Oct 13)');
assert.equal(p.workedWeeklyOffDays, 1, 'Worked weekly off detail must be 1 (Oct 4)');
assert.equal(p.absentDays, 18, 'Absent/unrecorded days must be 18 (Oct 14-31)');

// Reconcile all 31 days
const totalDays = p.presentDays + p.paidLeaveDays + p.unpaidLeaveDays + p.holidayDays + p.weeklyOffDays + p.absentDays;
assert.equal(totalDays, 31, 'All 31 calendar days must be reconciled without duplicate or missing days');

// Financial assertions
const dailyRate = 30000 / 31;
const expectedDeductions = 18 * dailyRate; // 16 unrecorded working days + 2 unpaid leave days
assert.equal(Math.round(p.absenceDeductions * 100) / 100, Math.round(expectedDeductions * 100) / 100);
const expectedNet = 30000 - expectedDeductions;
assert.equal(Math.round(p.netPayable * 100) / 100, Math.round(expectedNet * 100) / 100);

console.log('✅ Test 1 Passed: Aaliyan 31-day reconciliation & breakdown matches perfectly!');

// TEST 2: Huzaifa (10 present + 4 weekly offs in regular period)
const staffHuzaifa = {
  id: 'staff-huzaifa',
  name: 'Huzaifa',
  employeeCode: 'EMP1-0001',
  compensationType: 'MONTHLY_SALARY',
  baseSalary: 60000,
  workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
};

// 14 days run with 10 present, 2 weekly offs within period, 2 absent
const attendanceHuzaifa = [
  { staffId: 'staff-huzaifa', date: '2026-09-01', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-02', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-03', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-04', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-05', status: 'PRESENT' },
  // 2026-09-06 is Sunday
  { staffId: 'staff-huzaifa', date: '2026-09-07', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-08', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-09', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-10', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-11', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-12', status: 'ABSENT' },
  // 2026-09-13 is Sunday
  { staffId: 'staff-huzaifa', date: '2026-09-14', status: 'ABSENT' }
];

const resHuzaifa = evaluateEmployeePayroll(staffHuzaifa, '2026-09', {}, attendanceHuzaifa, [], [], {}, {
  startDate: '2026-09-01',
  endDate: '2026-09-14'
});

assert.equal(resHuzaifa.payslip.presentDays, 10);
assert.equal(resHuzaifa.payslip.weeklyOffDays, 2);
assert.equal(resHuzaifa.payslip.absentDays, 2);
console.log('✅ Test 2 Passed: Huzaifa scheduled weekly offs preserved!');

console.log('--- ALL REGRESSION TESTS PASSED SUCCESSFULLY ---');

