import assert from 'node:assert/strict';
import { evaluateEmployeePayroll } from './src/lib/calculations/payrollCalculations.js';

console.log('--- RUNNING ATTENDANCE CLASSIFICATION & FINALIZATION REGRESSION TESTS ---');

// TEST 1: Aaliyan October 2026 (Monthly Staff)
// Expected: Present 5, Paid Leave 3, Unpaid Leave 2, Holidays 2, Weekly Off 1, Absent 18
const staffAaliyan = {
  id: 'staff-aaliyan',
  name: 'Aaliyan',
  employeeCode: 'EMP1-0002',
  compensationType: 'MONTHLY_PLUS_COMMISSION',
  baseSalary: 30000,
  dailySalaryRate: 0,
};

const attendanceAaliyan = [
  { staffId: 'staff-aaliyan', date: '2026-10-01', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-02', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-03', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-04', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-05', status: 'PRESENT' },
  { staffId: 'staff-aaliyan', date: '2026-10-06', status: 'PAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-07', status: 'PAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-08', status: 'PAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-09', status: 'UNPAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-10', status: 'UNPAID_LEAVE' },
  { staffId: 'staff-aaliyan', date: '2026-10-11', status: 'HOLIDAY' }, // Holiday explicitly marked
  { staffId: 'staff-aaliyan', date: '2026-10-12', status: 'HOLIDAY' }, // Holiday explicitly marked
  { staffId: 'staff-aaliyan', date: '2026-10-13', status: 'WEEKLY_OFF' } // Weekly off explicitly marked
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
  absentDays: p.absentDays,
  netPayable: p.netPayable,
  canFinalize: resAaliyan.canFinalize
});

// Assertions matching user's exact specification
assert.equal(p.presentDays, 5, 'Present days must be exactly 5');
assert.equal(p.paidLeaveDays, 3, 'Paid leave days must be exactly 3');
assert.equal(p.unpaidLeaveDays, 2, 'Unpaid leave days must be exactly 2');
assert.equal(p.holidayDays, 2, 'Holiday days must be exactly 2 (Oct 11 + Oct 12)');
assert.equal(p.weeklyOffDays, 1, 'Weekly off days must be exactly 1 (Oct 13)');
assert.equal(p.absentDays, 18, 'Absent/unrecorded days must be 18 (Oct 14-31)');
assert.equal(resAaliyan.canFinalize, true, 'Unmarked past days must NOT block finalization');

// Reconcile all 31 days
const totalDays = p.presentDays + p.paidLeaveDays + p.unpaidLeaveDays + p.holidayDays + p.weeklyOffDays + p.absentDays;
assert.equal(totalDays, 31, 'All 31 calendar days must be reconciled without duplicate or missing days');

// Financial assertions
const dailyRate = 30000 / 31;
const expectedDeductions = 20 * dailyRate; // 18 unrecorded working days + 2 unpaid leave days
assert.equal(Math.round(p.absenceDeductions * 100) / 100, Math.round(expectedDeductions * 100) / 100);
const expectedNet = 30000 - expectedDeductions;
assert.equal(Math.round(p.netPayable * 100) / 100, Math.round(expectedNet * 100) / 100);

console.log('✅ Test 1 Passed: Aaliyan 31-day reconciliation & breakdown matches perfectly!');

// TEST 2: Huzaifa (Explicit weekly offs apply only when marked)
const staffHuzaifa = {
  id: 'staff-huzaifa',
  name: 'Huzaifa',
  employeeCode: 'EMP1-0001',
  compensationType: 'MONTHLY_SALARY',
  baseSalary: 60000,
  joiningDate: '2026-09-01'
};

// 14 days run with 10 present, 2 explicit weekly offs, 2 absent
const attendanceHuzaifa = [
  { staffId: 'staff-huzaifa', date: '2026-09-01', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-02', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-03', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-04', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-05', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-06', status: 'WEEKLY_OFF' }, // Explicit weekly off
  { staffId: 'staff-huzaifa', date: '2026-09-07', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-08', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-09', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-10', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-11', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-12', status: 'ABSENT' },
  { staffId: 'staff-huzaifa', date: '2026-09-13', status: 'WEEKLY_OFF' }, // Explicit weekly off
  { staffId: 'staff-huzaifa', date: '2026-09-14', status: 'ABSENT' }
];

const resHuzaifa = evaluateEmployeePayroll(staffHuzaifa, '2026-09', {}, attendanceHuzaifa, [], [], {}, {
  startDate: '2026-09-01',
  endDate: '2026-09-14'
});

assert.equal(resHuzaifa.payslip.presentDays, 10);
assert.equal(resHuzaifa.payslip.weeklyOffDays, 2);
assert.equal(resHuzaifa.payslip.absentDays, 2);
assert.equal(resHuzaifa.canFinalize, true);
console.log('✅ Test 2 Passed: Explicit weekly offs honored and finalization allowed!');

// TEST 3: Huzaifa October 2026 (Unmarked past days count as Absent and do NOT block finalization)
const attendanceOctHuzaifa = [
  { staffId: 'staff-huzaifa', date: '2026-10-01', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-10-02', status: 'PRESENT' },
  { staffId: 'staff-huzaifa', date: '2026-10-03', status: 'PAID_LEAVE' },
  { staffId: 'staff-huzaifa', date: '2026-10-04', status: 'PAID_LEAVE' },
  { staffId: 'staff-huzaifa', date: '2026-10-05', status: 'UNPAID_LEAVE' },
  { staffId: 'staff-huzaifa', date: '2026-10-06', status: 'UNPAID_LEAVE' },
  { staffId: 'staff-huzaifa', date: '2026-10-07', status: 'WEEKLY_OFF' },
  // Oct 8 to Oct 31 (24 days) are UNMARKED!
];

const resOctHuzaifa = evaluateEmployeePayroll({
  id: 'staff-huzaifa',
  name: 'Huzaifa',
  employeeCode: 'EMP1-0001',
  compensationType: 'MONTHLY_PLUS_COMMISSION',
  baseSalary: 30000,
  joiningDate: '2026-10-01'
}, '2026-10', {}, attendanceOctHuzaifa, [], [], {}, {
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  runType: 'MONTHLY'
});

const p3 = resOctHuzaifa.payslip;
console.log('Test 3 - Huzaifa Oct 2026 Counts:', {
  presentDays: p3.presentDays,
  paidLeaveDays: p3.paidLeaveDays,
  unpaidLeaveDays: p3.unpaidLeaveDays,
  weeklyOffDays: p3.weeklyOffDays,
  absentDays: p3.absentDays,
  netPayable: p3.netPayable,
  canFinalize: resOctHuzaifa.canFinalize,
  blockReason: resOctHuzaifa.blockReason
});

assert.equal(p3.presentDays, 2);
assert.equal(p3.paidLeaveDays, 2);
assert.equal(p3.unpaidLeaveDays, 2);
assert.equal(p3.weeklyOffDays, 1);
assert.equal(p3.absentDays, 24, '24 unmarked days must count as absent');
assert.equal(resOctHuzaifa.canFinalize, true, 'Unmarked past days must NOT block finalization');
assert.equal(resOctHuzaifa.blockReason, undefined, 'No block reason for unmarked past days');

// Paid days = 2 Present + 2 Paid Leave + 1 Weekly Off = 5 paid days
// 30,000 / 31 * 5 = 4838.709677...
const expectedOctNet = (30000 / 31) * 5;
assert.equal(Math.round(p3.netPayable * 100) / 100, Math.round(expectedOctNet * 100) / 100);

console.log('✅ Test 3 Passed: Huzaifa Oct 2026 5 paid days (PKR 4,838.71) unblocked and ready to finalize!');
console.log('--- ALL REGRESSION TESTS PASSED SUCCESSFULLY ---');
