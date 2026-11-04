import { describe, expect, it, vi } from 'vitest';
import { evaluateEmployeePayroll } from '../src/lib/calculations/payrollCalculations.js';
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
import { incomeExpenseReport, computePeriodMetrics } from '../src/modules/reports/reports.service.js';
import Decimal from 'decimal.js';

describe('Step 3: Salary Double-Counting Prevention & Reconciliation', () => {
  const staffMonthly = {
    id: 'staff-dec-01',
    name: 'Sarah Khan',
    employeeCode: 'EMP-001',
    designation: 'Senior Stylist',
    branchId: 'branch-1',
    compensationType: 'MONTHLY_SALARY',
    baseSalary: 30000,
    joiningDate: '2026-12-01',
  };

  const defaultPolicy = {
    branchId: 'branch-1',
    prorationMethod: 'CUSTOM_DIVISOR',
    customDivisorDays: 30,
    monthlyAbsenceDivisor: 30,
    nonWorkedWeeklyOffPaid: true,
    nonWorkedHolidayPaid: true,
  };

  // Helper to generate full attendance for any range
  const generateAttendance = (startDate, endDate, status = 'PRESENT') => {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const records = [];
    for (let day = sd; day <= ed; day++) {
      const dateStr = `${sy}-${String(sm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      records.push({
        staffId: staffMonthly.id,
        date: dateStr,
        status,
      });
    }
    return records;
  };

  it('evaluates mandatory custom salary payment for Dec 1-10: exactly PKR 10,000 for 10 calendar days', () => {
    const attendance = generateAttendance('2026-12-01', '2026-12-10');
    const result = evaluateEmployeePayroll(
      staffMonthly,
      '2026-12',
      defaultPolicy,
      attendance,
      [],
      [],
      {},
      {
        startDate: '2026-12-01',
        endDate: '2026-12-10',
        runType: 'CUSTOM_RANGE',
      }
    );

    expect(result.canFinalize).toBe(true);
    expect(result.payslip.daysInPeriod).toBe(10);
    // 10 days @ 1,000/day = 10,000
    expect(result.payslip.grossPayable).toBe(10000);
    expect(result.payslip.netPayable).toBe(10000);
  });

  it('reconciles monthly payroll after Dec 1-10 custom salary is paid: Earned 30,000, Paid 10,000, Remaining 20,000', () => {
    // Dec 1-10 already finalized and paid: 10,000
    const finalizedDates = new Set([
      '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05',
      '2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10'
    ]);

    // Attendance for the remaining unfinalized days (Dec 11..31)
    const attendance = generateAttendance('2026-12-11', '2026-12-31');

    const result = evaluateEmployeePayroll(
      staffMonthly,
      '2026-12',
      defaultPolicy,
      attendance,
      [],
      [],
      {},
      {
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        runType: 'MONTHLY',
        alreadyFinalizedDates: finalizedDates,
        alreadyPaidSalary: 10000,
        alreadyFinalizedNet: 10000,
      }
    );

    // Mandatory Example Assertions:
    expect(result.canFinalize).toBe(true);
    expect(result.payslip.monthlyEarnedSalary).toBe(30000);
    expect(result.payslip.previouslyPaidCustomSalary).toBe(10000);
    expect(result.payslip.remainingMonthlySalary).toBe(20000);
    expect(result.payslip.netPayable).toBe(20000);
    expect(result.payslip.grossPayable).toBe(20000);

    // Total for December across all runs:
    const customPayslipNet = 10000;
    const monthlyPayslipNet = result.payslip.netPayable;
    const totalDecemberSalaryExpense = customPayslipNet + monthlyPayslipNet;
    const totalDecemberSalaryPayments = 10000 + 20000;

    expect(totalDecemberSalaryExpense).toBe(30000);
    expect(totalDecemberSalaryPayments).toBe(30000);
    expect(totalDecemberSalaryExpense - 30000).toBe(0); // Duplicate Expense = 0
    expect(totalDecemberSalaryPayments - 30000).toBe(0); // Duplicate Payment = 0
  });

  it('prevents overlapping custom salary runs from being finalized twice (Dec 5-15 overlapping with Dec 1-10)', () => {
    const finalizedDates = new Set([
      '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05',
      '2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10'
    ]);

    const attendance = generateAttendance('2026-12-05', '2026-12-15');

    // User attempts another custom range Dec 5-15 (colliding on Dec 5..10)
    const result = evaluateEmployeePayroll(
      staffMonthly,
      '2026-12',
      defaultPolicy,
      attendance,
      [],
      [],
      {},
      {
        startDate: '2026-12-05',
        endDate: '2026-12-15',
        runType: 'CUSTOM_RANGE',
        alreadyFinalizedDates: finalizedDates,
        alreadyPaidSalary: 10000,
      }
    );

    expect(result.canFinalize).toBe(false);
    expect(result.blockReason).toContain('Salary days have already been paid or reserved');
  });

  it('prevents duplicate finalization when the entire month is already finalized', () => {
    // All 31 days already finalized
    const allDays = Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    const finalizedDates = new Set(allDays);
    const attendance = generateAttendance('2026-12-01', '2026-12-31');

    const result = evaluateEmployeePayroll(
      staffMonthly,
      '2026-12',
      defaultPolicy,
      attendance,
      [],
      [],
      {},
      {
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        runType: 'MONTHLY',
        alreadyFinalizedDates: finalizedDates,
        alreadyPaidSalary: 30000,
      }
    );

    expect(result.canFinalize).toBe(false);
    expect(result.blockReason).toBe('All salary days for this employee in this month have already been finalized.');
  });
});

describe('Step 3: F11 — Loan Recovery Does Not Reduce Accrual Salary Expense', () => {
  it('correctly reports full earned wages in accrual salary expense while deducting loan from cash payable', () => {
    const staffWithLoan = {
      id: 'staff-loan-01',
      name: 'Ali Raza',
      employeeCode: 'EMP-002',
      designation: 'Barber',
      branchId: 'branch-1',
      compensationType: 'MONTHLY_SALARY',
      baseSalary: 30000,
      joiningDate: '2026-12-01',
    };

    const policy = {
      branchId: 'branch-1',
      prorationMethod: 'CUSTOM_DIVISOR',
      customDivisorDays: 30,
      monthlyAbsenceDivisor: 30,
      nonWorkedWeeklyOffPaid: true,
      nonWorkedHolidayPaid: true,
    };

    const attendance = Array.from({ length: 31 }, (_, i) => ({
      staffId: staffWithLoan.id,
      date: `2026-12-${String(i + 1).padStart(2, '0')}`,
      status: 'PRESENT',
    }));

    const extrasWithAdvance = {
      advances: [
        {
          id: 'adv-001',
          advanceNumber: 'ADV-001',
          balance: 15000,
          recoveryPerMonth: 5000,
          recoveredThisMonth: 0,
        },
      ],
    };

    const result = evaluateEmployeePayroll(
      staffWithLoan,
      '2026-12',
      policy,
      attendance,
      [],
      [],
      extrasWithAdvance,
      {
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        runType: 'MONTHLY',
      }
    );

    expect(result.canFinalize).toBe(true);
    expect(result.payslip.grossPayable).toBe(30000);
    expect(result.payslip.advanceRecoveryAmount).toBe(5000);
    expect(result.payslip.netPayable).toBe(25000);

    // Accrual wage expense is netPayable + advanceRecoveryAmount = 25000 + 5000 = 30000
    const accrualWageExpense = result.payslip.netPayable + result.payslip.advanceRecoveryAmount;
    expect(accrualWageExpense).toBe(30000);
    // Cash payout is netPayable = 25000
    const cashOutflowAtPayroll = result.payslip.netPayable;
    expect(cashOutflowAtPayroll).toBe(25000);
  });
});

describe('Step 3: Approved Collection Commission Formula & Dues Reconciliation', () => {
  it('allocates partial payment and subsequent dues collection without duplicating commission', () => {
    const mockInvoice = {
      id: 'inv-test-01',
      subtotal: 1000,
      discount: 0,
      netSales: 1000,
      tax: 100,
      total: 1100,
      lines: [
        {
          id: 'line-1',
          type: 'SERVICE',
          name: 'Hair Cut',
          unitPrice: 1000,
          quantity: 1,
          discountAllocated: 0,
          netSales: 1000,
          tax: 100,
          staffId: 'staff-1',
          staffName: 'Huzaifa',
          staffCommissionRate: 10, // 10%
        },
      ],
    };

    // Payment 1: Customer pays 550 out of 1100
    const alloc1 = allocatePaymentToInvoice({
      invoice: mockInvoice,
      paymentAmount: new Decimal(550),
      previousBillPaid: new Decimal(0),
    });

    expect(alloc1.totalCollectedNet.toNumber()).toBe(500);
    expect(alloc1.totalCollectedTax.toNumber()).toBe(50);
    expect(alloc1.totalEarnedCommission.toNumber()).toBe(50);
    expect(alloc1.commissionsToRecord[0].amount.toNumber()).toBe(50);

    // Remaining dues = 1100 - 550 = 550
    const remainingDues = 1100 - 550;
    expect(remainingDues).toBe(550);

    // Payment 2: Customer pays remaining dues 550
    const alloc2 = allocatePaymentToInvoice({
      invoice: mockInvoice,
      paymentAmount: new Decimal(550),
      previousBillPaid: new Decimal(550),
    });

    expect(alloc2.totalCollectedNet.toNumber()).toBe(500);
    expect(alloc2.totalCollectedTax.toNumber()).toBe(50);
    expect(alloc2.totalEarnedCommission.toNumber()).toBe(50);
    expect(alloc2.commissionsToRecord[0].amount.toNumber()).toBe(50);

    // Total across both installments:
    const totalRevenue = alloc1.totalCollectedNet.plus(alloc2.totalCollectedNet).toNumber();
    const totalTax = alloc1.totalCollectedTax.plus(alloc2.totalCollectedTax).toNumber();
    const totalCommission = alloc1.totalEarnedCommission.plus(alloc2.totalEarnedCommission).toNumber();

    expect(totalRevenue).toBe(1000);
    expect(totalTax).toBe(100);
    expect(totalCommission).toBe(100);
    // Duplicate commission = 0
    expect(totalCommission - 100).toBe(0);
  });
});
