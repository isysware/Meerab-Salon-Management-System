import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

const { db } = vi.hoisted(() => {
  const models = [
    'invoice', 'branch', 'expense', 'expenseCategory', 'payrollPayment', 'commissionPayment', 'payslip',
    'staff', 'invoiceLine', 'commissionStatement', 'tipAllocation', 'tipPayout', 'attendanceRecord', 'overtimeRecord',
    'invoiceRefund', 'invoicePayment', 'appointment', 'cashDrawer', 'paymentAccount', 'commissionEvent', 'accountMovement',
    'drawerMovement', 'booking', 'stockMovement', 'payrollRun', 'supplier', 'supplierLedger', 'inventoryItem', 'inventoryBatch',
    'systemSetting'
  ];
  return {
    db: Object.fromEntries(models.map(name => [name, {
      findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn()
    }])),
  };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
vi.mock('../src/lib/balances.js', async original => ({ ...await original(), accountBalances: vi.fn(async () => new Map()) }));
vi.mock('../src/modules/cash/cash.service.js', async original => ({ ...await original(), drawerDTOs: vi.fn(async () => []) }));

import { computePeriodMetrics, inventoryReport, attendanceOvertimeReport } from '../src/modules/reports/reports.service.js';
import { computeBranchMetrics } from '../src/modules/dashboard/dashboard.service.js';
import { evaluateEmployeePayroll } from '../src/lib/calculations/payrollCalculations.js';
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
import { dateOnly, ymd } from '../src/lib/dates.js';

const D = (v) => new Prisma.Decimal(v);
const day = (date) => new Date(`${date}T00:00:00Z`);
const actor = { id: 'admin-1', name: 'Admin', role: 'ADMIN', branchId: 'b1' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) {
    model.findMany.mockResolvedValue([]);
    model.findUnique.mockResolvedValue(null);
    model.aggregate.mockResolvedValue({ _sum: {}, _count: 0 });
    model.groupBy.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
  }
  db.branch.findMany.mockResolvedValue([{ id: 'b1', name: 'Branch 1' }]);
  db.systemSetting.findUnique.mockResolvedValue({ key: 'BUSINESS_DATE', value: '2026-11-04' });
});

describe('Batch 4A: Financial Reporting Periods, Refunds & Reversals', () => {
  it('F13: Preserves original sales recognition on voided invoice and offsets once via dated refund', async () => {
    // Invoice 1,000 Net, issued in period, lifecycle is VOIDED
    db.invoice.findMany.mockResolvedValue([{
      id: 'inv-void-1',
      invoiceNumber: 'INV-VOID-1',
      date: day('2026-10-01'),
      branchId: 'b1',
      subtotal: D(1000),
      discount: D(0),
      netSales: D(1000),
      tax: D(100),
      total: D(1100),
      amountPaid: D(0),
      amountDue: D(0),
      lifecycle: 'VOIDED',
      lines: [{ id: 'l1', type: 'SERVICE', netSales: D(1000), tax: D(100) }],
      payments: [],
    }]);

    // Void refund record offsets the 1,000 Net
    db.invoiceRefund.findMany.mockResolvedValue([{
      id: 'ref-void-1',
      netReversed: D(1000),
      taxReversed: D(100),
      cashOut: D(0),
    }]);

    const metrics = await computePeriodMetrics(
      'b1',
      '2026-10-01',
      '2026-10-31',
      new Date('2026-09-30T19:00:00Z'),
      new Date('2026-10-31T18:59:59.999Z')
    );

    // Gross sales was 1000, refund was 1000 -> Net sales is 0 (NOT -1,000!)
    expect(metrics.serviceSales).toBe(1000);
    expect(metrics.totalRefunds).toBe(1000);
    expect(metrics.totalNetSales).toBe(0);
  });

  it('F13: Retains signed negative net sales in a return-only period without zero-clamping', async () => {
    db.invoice.findMany.mockResolvedValue([]);
    db.invoiceRefund.findMany.mockResolvedValue([{
      id: 'ref-return-only',
      netReversed: D(500),
      taxReversed: D(50),
      cashOut: D(550),
    }]);

    const metrics = await computePeriodMetrics(
      'b1',
      '2026-10-01',
      '2026-10-31',
      new Date('2026-09-30T19:00:00Z'),
      new Date('2026-10-31T18:59:59.999Z')
    );

    // Sales 0, refunds 500 -> Net sales should be signed -500
    expect(metrics.serviceSales).toBe(0);
    expect(metrics.totalRefunds).toBe(500);
    expect(metrics.totalNetSales).toBe(-500);
  });

  it('F13: Dashboard does not double-deduct voided invoice revenue', async () => {
    // 2 active invoices (2000 total) + 1 voided invoice (1000) = 3000 gross
    db.invoice.aggregate.mockResolvedValue({
      _sum: { subtotal: D(3000), discount: D(0), netSales: D(3000), tax: D(300) },
      _count: 3,
    });
    // Void reversal refund of 1000
    db.invoiceRefund.findMany.mockResolvedValue([{
      netReversed: D(1000),
      taxReversed: D(100),
      cashOut: D(0),
      method: 'CASH',
    }]);

    const metrics = await computeBranchMetrics(['b1'], '2026-10-01', { id: 'b1', name: 'Branch 1', code: 'B1' });

    // Net sales should be 3000 - 1000 = 2000
    expect(metrics.netSales).toBe(2000);
    expect(metrics.taxBilled).toBe(200);
  });
});

describe('Batch 4B: Supplier & Inventory Reporting', () => {
  it('F16: Inventory expiry handles Prisma Date objects properly without Invalid Date/NaN', async () => {
    const expiryDateObj = new Date('2026-10-25T00:00:00Z'); // Past expiry date
    db.inventoryBatch.findMany.mockResolvedValue([{
      id: 'batch-exp-1',
      batchNumber: 'B-001',
      itemId: 'item-1',
      branchId: 'b1',
      remainingQuantity: D(10),
      unitCost: D(150),
      receivedDate: day('2026-09-01'),
      expiryDate: expiryDateObj,
      item: { name: 'Shampoo', sku: 'SH-01', category: 'Hair Care', nearExpiryAlertDays: 30 },
    }]);

    const report = await inventoryReport(actor, { type: 'expiry', date: '2026-11-04' });

    expect(report.rows.length).toBe(1);
    expect(report.rows[0].status).toBe('EXPIRED');
    expect(report.rows[0].daysRemaining).toBeLessThan(0);
    expect(Number.isNaN(report.rows[0].daysRemaining)).toBe(false);
    expect(typeof report.rows[0].expiryDate).toBe('string');
  });

  it('F07: Supplier opening payable is not double counted when OPENING_BALANCE ledger entry exists', async () => {
    db.supplier.findMany.mockResolvedValue([{
      id: 'supp-1',
      name: 'L’Oreal Distributor',
      branchId: 'b1',
      openingPayable: D(5000),
    }]);

    // SupplierLedger already has an OPENING_BALANCE entry prior to period
    db.supplierLedger.groupBy.mockResolvedValue([{
      supplierId: 'supp-1',
      _sum: { credit: D(5000), debit: D(0) },
    }]);

    // Indicates OPENING_BALANCE entry exists in ledger
    db.supplierLedger.findMany
      .mockResolvedValueOnce([]) // periodEntries
      .mockResolvedValueOnce([{ supplierId: 'supp-1' }]); // openingLedgerEntries

    const report = await inventoryReport(actor, {
      type: 'supplier-ledger',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    // Opening payable should be exactly 5,000 (NOT doubled to 10,000!)
    expect(report.kpis.openingPayable).toBe(5000);
    expect(report.kpis.closingPayable).toBe(5000);
  });

  it('F17: Inventory valuation search filter accurately updates summary totals', async () => {
    db.inventoryItem.findMany.mockResolvedValue([
      { id: 'i1', name: 'Keratin Shampoo', category: 'Hair', sku: 'KS-1', minStockLevel: 5 },
      { id: 'i2', name: 'Face Mask', category: 'Skin', sku: 'FM-1', minStockLevel: 5 },
    ]);
    db.inventoryBatch.findMany.mockResolvedValue([
      {
        id: 'b1', itemId: 'i1', branchId: 'b1', batchNumber: 'BAT-1',
        remainingQuantity: D(10), unitCost: D(100),
        item: { id: 'i1', name: 'Keratin Shampoo', sku: 'KS-1', category: 'Hair', sellingPrice: D(200) },
      },
      {
        id: 'b2', itemId: 'i2', branchId: 'b1', batchNumber: 'BAT-2',
        remainingQuantity: D(5), unitCost: D(50),
        item: { id: 'i2', name: 'Face Mask', sku: 'FM-1', category: 'Skin', sellingPrice: D(100) },
      },
    ]);

    const report = await inventoryReport(actor, { type: 'valuation', search: 'Keratin' });

    expect(report.rows.length).toBe(1);
    expect(report.rows[0].itemName).toBe('Keratin Shampoo');
    // Totals should match filtered row: 10 * 100 = 1,000 Cost, 10 * 200 = 2,000 Retail
    expect(report.totals.costValue).toBe(1000);
    expect(report.totals.retailValue).toBe(2000);
    expect(report.totals.potentialProfit).toBe(1000);
  });
});

describe('Batch 4D: Staff Performance, Overtime & Commission History', () => {
  it('F23: Aggregates multiple standalone overtime records and excludes unapproved OT from authorized hours', async () => {
    db.staff.findMany.mockResolvedValue([{
      id: 'st-1', name: 'Ali Barber', employeeCode: 'EMP-01', designation: 'Barber', branchId: 'b1',
    }]);
    db.attendanceRecord.findMany.mockResolvedValue([]); // No attendance row -> standalone OT

    // Two standalone overtime records on the same day: 1 approved (60 mins), 1 pending (30 mins)
    db.overtimeRecord.findMany.mockResolvedValue([
      {
        id: 'ot-rec-1', staffId: 'st-1', branchId: 'b1', workDate: day('2026-10-15'),
        minutes: 60, approvedMinutes: 60, amount: D(500), status: 'APPROVED', reason: 'Late client', approvedByName: 'Manager',
      },
      {
        id: 'ot-rec-2', staffId: 'st-1', branchId: 'b1', workDate: day('2026-10-15'),
        minutes: 30, approvedMinutes: 0, amount: D(0), status: 'PENDING', reason: 'Clean up',
      },
    ]);

    const report = await attendanceOvertimeReport(actor, { startDate: '2026-10-01', endDate: '2026-10-31' });

    expect(report.rows.length).toBe(1);
    // Only approved OT is included in otHours & otAmount
    expect(report.rows[0].otMinutes).toBe(60);
    expect(report.rows[0].otHours).toBe(1);
    expect(report.rows[0].otAmount).toBe(500);
    expect(report.rows[0].otStatus).toBe('APPROVED');
    // Authorized hours KPI strictly excludes unapproved OT
    expect(report.kpis.authorizedOtHours).toBe(1);
    expect(report.kpis.authorizedOtAmount).toBe(500);
  });
});

describe('Step 4 Cross-Report Reconciliation: Salary & Commission Invariants', () => {
  it('Salary invariant: Monthly 30,000 with 10,000 custom previously paid yields remaining 20,000 and 0 duplicate', () => {
    const staff = {
      id: 'staff-s4',
      name: 'Zahra Ahmed',
      employeeCode: 'EMP-004',
      designation: 'Senior Stylist',
      branchId: 'b1',
      compensationType: 'MONTHLY_SALARY',
      baseSalary: 30000,
      joiningDate: '2026-12-01',
    };
    const policy = {
      branchId: 'b1',
      prorationMethod: 'CUSTOM_DIVISOR',
      customDivisorDays: 30,
      monthlyAbsenceDivisor: 30,
      nonWorkedWeeklyOffPaid: true,
      nonWorkedHolidayPaid: true,
    };
    // Full attendance for December
    const attendance = [];
    for (let d = 1; d <= 31; d++) {
      attendance.push({ staffId: 'staff-s4', date: `2026-12-${String(d).padStart(2, '0')}`, status: 'PRESENT' });
    }

    const result = evaluateEmployeePayroll(
      staff,
      '2026-12',
      policy,
      attendance,
      [],
      [],
      {},
      {
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        runType: 'MONTHLY',
        alreadyPaidSalary: 10000, // PKR 10,000 already paid for Dec 1-10
      }
    );

    expect(result.canFinalize).toBe(true);
    expect(result.payslip.grossPayable).toBe(20000);
    expect(result.payslip.monthlyEarnedSalary).toBe(30000);
    expect(result.payslip.previouslyPaidCustomSalary).toBe(10000);
    expect(result.payslip.remainingMonthlySalary).toBe(20000);
    expect(result.payslip.netPayable).toBe(20000);

    const totalDecemberPayments = 10000 + result.payslip.netPayable;
    expect(totalDecemberPayments).toBe(30000);
    const duplicatePayment = totalDecemberPayments - 30000;
    expect(duplicatePayment).toBe(0);
  });

  it('Commission invariant: 500 collected service at 10% yields 50 earned, after paying 50 liability is 0 and duplicate is 0', () => {
    const invoice = {
      id: 'inv-s4',
      subtotal: 1000,
      discount: 0,
      netSales: 1000,
      tax: 100,
      total: 1100,
      lines: [{
        id: 'l1',
        type: 'SERVICE',
        name: 'Hair Treatment',
        unitPrice: 1000,
        quantity: 1,
        discountAllocated: 0,
        netSales: 1000,
        tax: 100,
        taxRate: 0.1,
        staffId: 'staff-s4',
        staffName: 'Zahra Ahmed',
        staffCommissionRate: 10, // 10%
      }],
    };

    // Customer pays PKR 550 (500 service + 50 tax)
    const alloc = allocatePaymentToInvoice({ invoice, paymentAmount: 550, previousBillPaid: 0 });

    expect(alloc.totalCollectedNet.toNumber()).toBe(500);
    expect(alloc.totalCollectedTax.toNumber()).toBe(50);
    expect(alloc.totalEarnedCommission.toNumber()).toBe(50);

    const commissionEarned = alloc.totalEarnedCommission.toNumber();
    let commissionPaid = 0;
    let outstandingLiability = commissionEarned - commissionPaid;
    expect(outstandingLiability).toBe(50);

    // Pay PKR 50 commission
    commissionPaid = 50;
    outstandingLiability = commissionEarned - commissionPaid;
    expect(outstandingLiability).toBe(0);

    // Reconcile duplicate check
    const duplicateCommissionExpense = commissionEarned > 50 ? commissionEarned - 50 : 0;
    expect(duplicateCommissionExpense).toBe(0);
  });
});
