// backend/tests/supplier-payment-reporting.test.js
// Automated test suite for Batch 2: Supplier Payments & Expense Reporting

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v);

describe('Batch 2 · Supplier Payments & Expense Reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('Reconciliation Scenario: Supplier payments appear in Detailed Expenses as Inventory Cash Outflow and not Operating Expense', async () => {
    // 1. Setup mock data matching the exact user specification:
    // Opening Cash: 20,000
    // Customer Collection: +5,000
    // Supplier Payment: -6,000
    // Salary Paid: -2,000
    // Expected Closing Cash: 17,000
    //
    // Detailed Expenses:
    //   Salary Payment = 2,000
    //   Supplier Payment = 6,000
    //   Total Cash Outflows = 8,000
    //   Paid Operating Expenses = 2,000
    //   Supplier/Inventory Cash Outflow = 6,000

    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Gulberg Main Branch', city: 'Lahore' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Gulberg Main Branch', city: 'Lahore' }),
        },
        expenseCategory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        payrollPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'pay-salary-1',
              paymentNumber: 'SAL-2026-001',
              staffName: 'Fatima Noor',
              branchId: 'branch-1',
              amount: D(2000),
              method: 'CASH',
              paidAt: new Date('2026-11-02T10:00:00+05:00'),
              paidByUserId: 'user-admin',
              paidByName: 'Admin User',
              status: 'COMPLETED',
            },
          ]),
        },
        commissionPayment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        payslip: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'SP-2026-001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-02T00:00:00.000Z'),
              amount: D(6000),
              method: 'CASH',
              reference: 'PO-9912',
              notes: 'Bulk L’Oreal hair colors',
              paidById: 'user-admin',
              paidByName: 'Admin User',
              createdAt: new Date('2026-11-02T11:30:00+05:00'),
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PUR-2026-001', amount: 6000 }],
              reversedAt: null,
              supplier: { id: 'sup-1', name: 'L’Oreal Professional Pakistan' },
            },
          ]),
        },
        paymentAccount: {
          findMany: vi.fn().mockResolvedValue([{ id: 'acc-1', name: 'Meezan Bank Operations' }]),
        },
      },
    }));

    vi.doMock('../src/modules/reports/collectionEvents.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        loadCollectionEvents: vi.fn().mockResolvedValue([]),
        payoutEvents: vi.fn().mockImplementation((payments) =>
          payments.map((p) => ({
            ...p,
            eventId: p.id,
            date: '2026-11-02',
            signedAmount: new Decimal(p.amount.toString()),
            reversal: false,
          }))
        ),
      };
    });

    vi.doMock('../src/modules/reports/collectionEvents.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        loadCollectionEvents: vi.fn().mockResolvedValue([]),
        payoutEvents: vi.fn().mockImplementation((payments) =>
          payments.map((p) => ({
            ...p,
            eventId: p.id,
            date: '2026-11-02',
            signedAmount: new Decimal(p.amount.toString()),
            reversal: false,
          }))
        ),
      };
    });

    vi.doMock('../src/modules/reports/staffLoanMovements.js', () => ({
      loadStaffLoanMovements: vi.fn().mockResolvedValue([]),
      STAFF_LOAN_CATEGORY: 'Staff Loan Disbursement (Non-Operating)',
    }));

    const { detailedExpensesReport, SUPPLIER_PAYMENT_CATEGORY } = await import('../src/modules/reports/paidExpenses.report.js');

    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };
    const report = await detailedExpensesReport(actor, {
      from: '2026-11-01',
      to: '2026-11-05',
      branchId: 'branch-1',
    });

    // Verify Category definition
    expect(SUPPLIER_PAYMENT_CATEGORY).toBe('Supplier/Vendor Payment — Inventory Cash Outflow');

    // Verify Rows returned
    expect(report.rows).toHaveLength(2);

    const salaryRow = report.rows.find((r) => r.sourceType === 'SALARY');
    const supplierRow = report.rows.find((r) => r.sourceType === 'SUPPLIER_PAYMENT');

    expect(salaryRow).toBeDefined();
    expect(salaryRow.paidAmount).toBe(2000);
    expect(salaryRow.category).toBe('Payroll & Salaries');

    expect(supplierRow).toBeDefined();
    expect(supplierRow.voucherNumber).toBe('SP-2026-001');
    expect(supplierRow.payee).toBe('L’Oreal Professional Pakistan');
    expect(supplierRow.category).toBe('Supplier/Vendor Payment — Inventory Cash Outflow');
    expect(supplierRow.paidAmount).toBe(6000);
    expect(supplierRow.paymentSource).toBe('CASH_DRAWER');
    expect(supplierRow.status).toBe('POSTED');
    expect(supplierRow.paidByName).toBe('Admin User');
    expect(supplierRow.externalReference).toBe('PO-9912');

    // Critical Invariant Checks:
    // 1. Paid Operating Expenses must strictly be 2,000 (Salary only)
    expect(report.kpis.totalExpenses).toBe(2000);

    // 2. Supplier / Inventory Cash Outflow must be 6,000
    expect(report.kpis.supplierPayments).toBe(6000);

    // 3. Total Cash Outflows must be 8,000 (2,000 + 6,000)
    expect(report.kpis.totalCashOutflow).toBe(8000);
    expect(report.totals.totalCashOutflow).toBe(8000);
    expect(report.totals.operatingExpenses).toBe(2000);
    expect(report.totals.supplierPayments).toBe(6000);

    // 4. Tender breakdown matches cash movements
    expect(report.tenderBreakdown.totalCash).toBe(8000);
    expect(report.tenderBreakdown.totalOnline).toBe(0);
    expect(report.tenderBreakdown.grandTotal).toBe(8000);
  });

  it('Supplier Payment Reversal: Reversals produce signed dated rows and net out cash outflow', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Gulberg Main Branch', city: 'Lahore' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Gulberg Main Branch', city: 'Lahore' }),
        },
        expenseCategory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        payrollPayment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        commissionPayment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        payslip: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-2',
              paymentNumber: 'SP-2026-002',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-02T00:00:00.000Z'),
              amount: D(4000),
              method: 'ONLINE',
              paymentAccountId: 'acc-1',
              reference: 'INV-4410',
              notes: 'Original order payment',
              paidById: 'user-admin',
              paidByName: 'Admin User',
              createdAt: new Date('2026-11-02T10:00:00+05:00'),
              allocations: [{ purchaseId: 'pur-2', invoiceNumber: 'PUR-2026-002', amount: 4000 }],
              reversedAt: new Date('2026-11-03T14:00:00+05:00'),
              reversalDate: new Date('2026-11-03T00:00:00.000Z'),
              reversedById: 'user-admin',
              reversedByName: 'Admin User',
              reversalReason: 'Duplicate bank transfer error',
              supplier: { id: 'sup-1', name: 'Schwarzkopf Professional' },
            },
          ]),
        },
        paymentAccount: {
          findMany: vi.fn().mockResolvedValue([{ id: 'acc-1', name: 'Meezan Bank Operations' }]),
        },
      },
    }));

    vi.doMock('../src/modules/reports/collectionEvents.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        loadCollectionEvents: vi.fn().mockResolvedValue([]),
        payoutEvents: vi.fn().mockReturnValue([]),
      };
    });

    vi.doMock('../src/modules/reports/collectionEvents.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        loadCollectionEvents: vi.fn().mockResolvedValue([]),
        payoutEvents: vi.fn().mockImplementation((payments) =>
          payments.map((p) => ({
            ...p,
            eventId: p.id,
            date: '2026-11-02',
            signedAmount: new Decimal(p.amount.toString()),
            reversal: false,
          }))
        ),
      };
    });

    vi.doMock('../src/modules/reports/staffLoanMovements.js', () => ({
      loadStaffLoanMovements: vi.fn().mockResolvedValue([]),
      STAFF_LOAN_CATEGORY: 'Staff Loan Disbursement (Non-Operating)',
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');

    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };
    const report = await detailedExpensesReport(actor, {
      from: '2026-11-01',
      to: '2026-11-05',
      branchId: 'branch-1',
    });

    // Both original payment and reversal row must be present
    expect(report.rows).toHaveLength(2);

    const originalRow = report.rows.find((r) => r.status === 'POSTED');
    const reversalRow = report.rows.find((r) => r.status === 'REVERSED');

    expect(originalRow).toBeDefined();
    expect(originalRow.paidAmount).toBe(4000);
    expect(originalRow.date).toBe('2026-11-02');
    expect(originalRow.paymentAccountName).toBe('Meezan Bank Operations');

    expect(reversalRow).toBeDefined();
    expect(reversalRow.paidAmount).toBe(-4000);
    expect(reversalRow.date).toBe('2026-11-03');
    expect(reversalRow.isReversalRecord).toBe(true);
    expect(reversalRow.reversalReason).toBe('Duplicate bank transfer error');

    // Net supplier cash outflow = 4,000 - 4,000 = 0
    expect(report.kpis.supplierPayments).toBe(0);
    expect(report.kpis.totalCashOutflow).toBe(0);
    expect(report.tenderBreakdown.totalOnline).toBe(0);
  });

  it('Income & Expense Report: Supplier payments are reported as Inventory Outflows and do not inflate Operating Expenses or COGS', async () => {
    // Test the incomeExpenseReport logic:
    // Collections: 5,000
    // Operating Expenses: 2,000 (Salary)
    // Supplier Payment: 6,000
    // Net Cash Movement: 5,000 - 2,000 - 6,000 = -3,000
    // Opening Cash: 20,000 => Closing Cash = 20,000 - 3,000 = 17,000

    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Gulberg Main Branch', city: 'Lahore' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Gulberg Main Branch', city: 'Lahore' }),
        },
        staff: {
          findMany: vi.fn().mockResolvedValue([{ id: 'staff-1', name: 'Fatima Noor', employeeCode: 'ST-001', branchId: 'branch-1' }]),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([{ id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' }]),
        },
        invoice: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'inv-1',
              invoiceNumber: 'INV-2026-001',
              date: new Date('2026-11-02T00:00:00.000Z'),
              time: '11:00',
              branchId: 'branch-1',
              clientId: 'client-1',
              clientName: 'Ayesha Khan',
              subtotal: D(5000),
              discount: D(0),
              netSales: D(5000),
              tax: D(0),
              total: D(5000),
              amountPaid: D(5000),
              amountDue: D(0),
              advanceAdjusted: D(0),
              paymentMethod: 'CASH',
              status: 'PAID',
              lifecycle: 'ACTIVE',
              processedByName: 'Staff',
              notes: '',
              lines: [],
              payments: [{ id: 'pos-pay-1', kind: 'POS', billAmountAllocated: D(5000) }],
            },
          ]),
        },
        invoicePayment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        invoiceRefund: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        expense: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        payrollRun: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'pr-1',
              month: '2026-11',
              branchId: 'branch-1',
              status: 'FINALIZED',
              finalizedAt: new Date('2026-11-01T00:00:00+05:00'),
              payslips: [
                {
                  id: 'ps-1',
                  staffId: 'staff-1',
                  payslipNumber: 'PS-001',
                  netPayable: D(2000),
                  grossPayable: D(2000),
                  snapshot: { staffName: 'Fatima Noor' },
                  payments: [
                    {
                      id: 'pay-sal-1',
                      paymentNumber: 'SAL-001',
                      amount: D(2000),
                      method: 'CASH',
                      status: 'COMPLETED',
                      paidAt: new Date('2026-11-02T10:00:00+05:00'),
                      staffName: 'Fatima Noor',
                    },
                  ],
                },
              ],
            },
          ]),
        },
        commissionEvent: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        stockMovement: {
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _sum: { totalCost: 0 } }),
        },
        invoiceLine: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { cogsAmount: 1500 } }),
        },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'SP-2026-001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-02T00:00:00.000Z'),
              amount: D(6000),
              method: 'CASH',
              reference: 'PO-9912',
              notes: 'Vendor inventory settlement',
              paidById: 'user-admin',
              paidByName: 'Admin User',
              createdAt: new Date('2026-11-02T12:00:00+05:00'),
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PUR-2026-001', amount: 6000 }],
              reversedAt: null,
              supplier: { id: 'sup-1', name: 'L’Oreal Professional Pakistan' },
            },
          ]),
        },
        drawerMovement: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        accountMovement: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        bookingHistory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        tipReceipt: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    }));

    vi.doMock('../src/modules/reports/collectionEvents.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        loadCollectionEvents: vi.fn().mockResolvedValue([]),
        payoutEvents: vi.fn().mockImplementation((payments) =>
          payments.map((p) => ({
            ...p,
            eventId: p.id,
            date: '2026-11-02',
            signedAmount: new Decimal(p.amount.toString()),
            reversal: false,
          }))
        ),
      };
    });

    vi.doMock('../src/modules/reports/staffLoanMovements.js', () => ({
      loadStaffLoanMovements: vi.fn().mockResolvedValue([]),
      STAFF_LOAN_CATEGORY: 'Staff Loan Disbursement (Non-Operating)',
      currentStaffLoanReceivable: vi.fn().mockResolvedValue(0),
    }));

    vi.doMock('../src/modules/reports/fullCommissionAccrual.js', () => ({
      accruedCommissionForPeriod: vi.fn().mockResolvedValue(new Decimal(0)),
    }));

    const { incomeExpenseReport } = await import('../src/modules/reports/reports.service.js');

    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };
    const report = await incomeExpenseReport(actor, {
      from: '2026-11-01',
      to: '2026-11-05',
      branchId: 'branch-1',
    });

    // Verify supplier row exists in report rows
    const spRow = report.rows.find((r) => r.type === 'SUPPLIER_PAYMENT');
    expect(spRow).toBeDefined();
    expect(spRow.category).toBe('Supplier/Vendor Payment — Inventory Cash Outflow');
    expect(spRow.customerName).toBe('L’Oreal Professional Pakistan');
    expect(spRow.totalReceived).toBe(-6000);
    expect(spRow.cashFlow).toBe(-6000);
    expect(spRow.expense).toBe(0); // Expense must be 0 to not pollute operating expenses

    // Verify Collections = +5,000
    expect(report.kpis.totalCollectedIncome).toBe(5000);

    // Verify Operating Expenses = 2,000 (Salary only; Supplier payment must NOT be in operating expenses)
    expect(report.kpis.totalOperatingExpenses).toBe(2000);
    expect(report.kpis.salaryExpenses).toBe(2000);

    // Verify COGS is recognized separately (1,500) and not replaced or doubled by supplier payment
    expect(report.kpis.cogs).toBe(1500);

    // Verify Supplier Cash Outflow is tracked separately
    expect(report.kpis.supplierPayments).toBe(6000);
    expect(report.kpis.supplierCashOutflow).toBe(6000);
    expect(report.totals.supplierPayments).toBe(6000);
    expect(report.totals.supplierCashOutflow).toBe(6000);

    // Verify Net Cash Movement:
    // Collections (5,000) - Operating Expenses (2,000) - Supplier Payment (6,000) = -3,000
    // Opening Cash (20,000) + Net Cash Movement (-3,000) = Closing Cash 17,000!
    expect(report.totals.netCashMovement).toBe(-3000);
  });
});
