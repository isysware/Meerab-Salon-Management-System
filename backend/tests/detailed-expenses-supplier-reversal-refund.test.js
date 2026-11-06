import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v);

describe('Detailed Expenses Drilldown — Supplier Payments, Reversals & Refunds Reconciliations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  const actor = {
    id: 'user-admin',
    name: 'Admin User',
    role: 'SUPER_ADMIN',
  };

  it('Scenario 1: Supplier payment PKR 1,000 with no reversal appears as posted supplier outflow', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        expenseCategory: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        payrollPayment: { findMany: vi.fn().mockResolvedValue([]) },
        commissionPayment: { findMany: vi.fn().mockResolvedValue([]) },
        payslip: { findMany: vi.fn().mockResolvedValue([]) },
        paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'PO-0001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-06T00:00:00.000Z'),
              amount: D(1000),
              method: 'CASH',
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PO-0001', amount: 1000 }],
              reversedAt: null,
              supplier: { id: 'sup-1', name: 'Huzaiafa' },
            },
          ]),
        },
        drawerMovement: { findMany: vi.fn().mockResolvedValue([]) },
        accountMovement: { findMany: vi.fn().mockResolvedValue([]) },
        supplierReturn: { findMany: vi.fn().mockResolvedValue([]) },
      },
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');
    const report = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-01', to: '2026-11-06' });

    expect(report.kpis.totalExpenses).toBe(0); // Operating expenses remain 0
    expect(report.kpis.supplierPayments).toBe(1000);
    expect(report.kpis.supplierGrossPayments).toBe(1000);
    expect(report.kpis.supplierReversals).toBe(0);
    expect(report.kpis.supplierRefunds).toBe(0);
    expect(report.kpis.totalCashOutflow).toBe(1000);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].voucherNumber).toBe('PO-0001');
    expect(report.rows[0].status).toBe('POSTED');
    expect(report.rows[0].amount).toBe(1000);
  });

  it('Scenario 2: Full supplier payment reversal PKR 1,000 nets supplier cash outflow to 0', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        expenseCategory: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        payrollPayment: { findMany: vi.fn().mockResolvedValue([]) },
        commissionPayment: { findMany: vi.fn().mockResolvedValue([]) },
        payslip: { findMany: vi.fn().mockResolvedValue([]) },
        paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'PO-0001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-06T00:00:00.000Z'),
              amount: D(1000),
              method: 'CASH',
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PO-0001', amount: 1000 }],
              reversedAt: new Date('2026-11-06T12:00:00.000Z'),
              reversalDate: new Date('2026-11-06T00:00:00.000Z'),
              reversalReason: 'Wrong payee entry',
              reversedByName: 'Super Administrator',
              supplier: { id: 'sup-1', name: 'Huzaiafa' },
            },
          ]),
        },
        drawerMovement: { findMany: vi.fn().mockResolvedValue([]) },
        accountMovement: { findMany: vi.fn().mockResolvedValue([]) },
        supplierReturn: { findMany: vi.fn().mockResolvedValue([]) },
      },
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');
    const report = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-01', to: '2026-11-06' });

    expect(report.kpis.supplierPayments).toBe(0); // Net 1000 - 1000 = 0
    expect(report.kpis.supplierGrossPayments).toBe(1000);
    expect(report.kpis.supplierReversals).toBe(1000);
    expect(report.kpis.totalCashOutflow).toBe(0);
    expect(report.rows).toHaveLength(2);
    const paymentRow = report.rows.find((r) => r.voucherNumber === 'PO-0001');
    const revRow = report.rows.find((r) => r.voucherNumber === 'PO-0001-REV');
    expect(paymentRow).toBeDefined();
    expect(paymentRow.status).toBe('POSTED');
    expect(paymentRow.amount).toBe(1000);
    expect(revRow).toBeDefined();
    expect(revRow.status).toBe('REVERSED');
    expect(revRow.amount).toBe(-1000);
  });

  it('Scenario 4 & 5: Purchase return with full cash refund offsets supplier outflow without labelling refund as reversal', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        expenseCategory: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        payrollPayment: { findMany: vi.fn().mockResolvedValue([]) },
        commissionPayment: { findMany: vi.fn().mockResolvedValue([]) },
        payslip: { findMany: vi.fn().mockResolvedValue([]) },
        paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'PO-0001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-06T00:00:00.000Z'),
              amount: D(1000),
              method: 'CASH',
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PO-0001', amount: 1000 }],
              reversedAt: null,
              supplier: { id: 'sup-1', name: 'Huzaiafa' },
            },
          ]),
        },
        drawerMovement: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'mov-1',
              drawerId: 'drw-1',
              branchId: 'branch-1',
              type: 'SUPPLIER_REFUND',
              direction: 'IN',
              amount: D(1000),
              sourceModule: 'INVENTORY',
              sourceId: 'ret-1',
              reference: 'PR-0001',
              description: 'Supplier refund from Huzaiafa for PR-0001',
              userId: 'usr-1',
              userName: 'Super Administrator',
              createdAt: new Date('2026-11-06T05:20:36.662Z'),
            },
          ]),
        },
        accountMovement: { findMany: vi.fn().mockResolvedValue([]) },
        supplierReturn: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'ret-1',
              returnNumber: 'PR-0001',
              purchaseNumber: 'PO-0001',
              reason: 'DEFECTIVE',
              supplier: { id: 'sup-1', name: 'Huzaiafa' },
            },
          ]),
        },
      },
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');
    const report = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-01', to: '2026-11-06' });

    expect(report.kpis.supplierPayments).toBe(0); // 1000 payment - 1000 refund = 0
    expect(report.kpis.supplierGrossPayments).toBe(1000);
    expect(report.kpis.supplierReversals).toBe(0); // Not a reversal!
    expect(report.kpis.supplierRefunds).toBe(1000); // Correctly identified as refund received
    expect(report.kpis.totalCashOutflow).toBe(0);
    expect(report.rows).toHaveLength(2);

    const refundRow = report.rows.find((r) => r.sourceType === 'SUPPLIER_REFUND');
    expect(refundRow).toBeDefined();
    expect(refundRow.voucherNumber).toBe('PR-0001');
    expect(refundRow.status).toBe('POSTED'); // Not REVERSED
    expect(refundRow.isReversalRecord).toBe(false);
    expect(refundRow.amount).toBe(-1000);
    expect(refundRow.title).toContain('Supplier Refund Received');
  });

  it('Scenario 7: Supplier refund received into named bank account credits online account', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        expenseCategory: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        payrollPayment: { findMany: vi.fn().mockResolvedValue([]) },
        commissionPayment: { findMany: vi.fn().mockResolvedValue([]) },
        payslip: { findMany: vi.fn().mockResolvedValue([]) },
        paymentAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'acc-meezan', name: 'Meezan Bank' }]) },
        supplierPayment: { findMany: vi.fn().mockResolvedValue([]) },
        drawerMovement: { findMany: vi.fn().mockResolvedValue([]) },
        accountMovement: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'mov-online-1',
              accountId: 'acc-meezan',
              branchId: 'branch-1',
              type: 'SUPPLIER_REFUND',
              direction: 'IN',
              amount: D(1000),
              sourceModule: 'INVENTORY',
              sourceId: 'ret-1',
              reference: 'SR-0002',
              description: 'Supplier refund from Huzaiafa for SR-0002',
              userId: 'usr-1',
              userName: 'Super Administrator',
              createdAt: new Date('2026-11-06T05:20:36.662Z'),
            },
          ]),
        },
        supplierReturn: { findMany: vi.fn().mockResolvedValue([]) },
      },
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');
    const report = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-01', to: '2026-11-06' });

    expect(report.tenderBreakdown.totalOnline).toBe(-1000);
    expect(report.tenderBreakdown.totalCash).toBe(0);
    expect(report.tenderBreakdown.onlineAccounts[0].accountName).toBe('Meezan Bank');
    expect(report.tenderBreakdown.onlineAccounts[0].amount).toBe(-1000);
  });

  it('Scenario 8 & 9: Date range filters apply strictly based on dated event', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        expenseCategory: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        payrollPayment: { findMany: vi.fn().mockResolvedValue([]) },
        commissionPayment: { findMany: vi.fn().mockResolvedValue([]) },
        payslip: { findMany: vi.fn().mockResolvedValue([]) },
        paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'PO-0001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-02T00:00:00.000Z'), // Payment on Nov 02
              amount: D(1000),
              method: 'CASH',
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PO-0001', amount: 1000 }],
              reversedAt: null,
              supplier: { id: 'sup-1', name: 'Huzaiafa' },
            },
          ]),
        },
        drawerMovement: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'mov-1',
              drawerId: 'drw-1',
              branchId: 'branch-1',
              type: 'SUPPLIER_REFUND',
              direction: 'IN',
              amount: D(1000),
              sourceModule: 'INVENTORY',
              sourceId: 'ret-1',
              reference: 'PR-0001',
              description: 'Supplier refund from Huzaiafa for PR-0001',
              userId: 'usr-1',
              userName: 'Super Administrator',
              createdAt: new Date('2026-11-06T05:20:36.662Z'), // Refund on Nov 06
            },
          ]),
        },
        accountMovement: { findMany: vi.fn().mockResolvedValue([]) },
        supplierReturn: { findMany: vi.fn().mockResolvedValue([]) },
      },
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');

    // Filter Nov 01 to Nov 03: includes payment only
    const period1 = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-01', to: '2026-11-03' });
    expect(period1.kpis.supplierPayments).toBe(1000);
    expect(period1.rows).toHaveLength(1);
    expect(period1.rows[0].voucherNumber).toBe('PO-0001');

    // Filter Nov 05 to Nov 06: includes refund only
    const period2 = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-05', to: '2026-11-06' });
    expect(period2.kpis.supplierPayments).toBe(-1000);
    expect(period2.rows).toHaveLength(1);
    expect(period2.rows[0].voucherNumber).toBe('PR-0001');
  });

  it('Scenario 10: Operating expenses and staff loans remain completely separate and unreconciled against supplier outflow', async () => {
    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        expense: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'exp-1',
              voucherNumber: 'EXP-001',
              expenseDate: new Date('2026-11-06T00:00:00.000Z'),
              branchId: 'branch-1',
              category: 'Utilities',
              title: 'Electricity bill',
              payee: 'K-Electric',
              amount: D(500),
              status: 'POSTED',
              isReversalRecord: false,
              paymentSource: 'CASH_DRAWER',
            },
          ]),
        },
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        expenseCategory: { findMany: vi.fn().mockResolvedValue([]) },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        payrollPayment: { findMany: vi.fn().mockResolvedValue([]) },
        commissionPayment: { findMany: vi.fn().mockResolvedValue([]) },
        payslip: { findMany: vi.fn().mockResolvedValue([]) },
        paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'sp-1',
              paymentNumber: 'PO-0001',
              supplierId: 'sup-1',
              branchId: 'branch-1',
              paymentDate: new Date('2026-11-06T00:00:00.000Z'),
              amount: D(1000),
              method: 'CASH',
              allocations: [{ purchaseId: 'pur-1', invoiceNumber: 'PO-0001', amount: 1000 }],
              reversedAt: null,
              supplier: { id: 'sup-1', name: 'Huzaiafa' },
            },
          ]),
        },
        drawerMovement: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'mov-1',
              drawerId: 'drw-1',
              branchId: 'branch-1',
              type: 'SUPPLIER_REFUND',
              direction: 'IN',
              amount: D(1000),
              sourceModule: 'INVENTORY',
              sourceId: 'ret-1',
              reference: 'PR-0001',
              description: 'Supplier refund from Huzaiafa for PR-0001',
              userId: 'usr-1',
              userName: 'Super Administrator',
              createdAt: new Date('2026-11-06T05:20:36.662Z'),
            },
          ]),
        },
        accountMovement: { findMany: vi.fn().mockResolvedValue([]) },
        supplierReturn: { findMany: vi.fn().mockResolvedValue([]) },
      },
    }));

    const { detailedExpensesReport } = await import('../src/modules/reports/paidExpenses.report.js');
    const report = await detailedExpensesReport(actor, { branchId: 'branch-1', from: '2026-11-01', to: '2026-11-06' });

    expect(report.kpis.totalExpenses).toBe(500); // Electricity bill remains strictly operating expense
    expect(report.kpis.supplierPayments).toBe(0); // Net supplier outflow = 0
    expect(report.kpis.totalCashOutflow).toBe(500); // Total net cash outflow = 500 (operating) + 0 (supplier)
  });
});
