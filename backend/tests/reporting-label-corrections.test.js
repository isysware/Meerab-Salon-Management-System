import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { db, state } = vi.hoisted(() => {
  const models = ['invoice', 'branch', 'expense', 'expenseCategory', 'payrollPayment', 'commissionPayment', 'payslip',
    'staff', 'invoiceLine', 'commissionStatement', 'tipAllocation', 'tipPayout', 'attendanceRecord', 'overtimeRecord',
    'invoiceRefund', 'invoicePayment', 'appointment', 'cashDrawer', 'paymentAccount', 'commissionEvent'];
  return { db: Object.fromEntries(models.map(name => [name, { findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn() }])),
    state: { invoices: [], expenses: [], salary: [], commission: [], slips: [] } };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
vi.mock('../src/lib/balances.js', async original => ({ ...await original(), accountBalances: vi.fn(async () => new Map()) }));
vi.mock('../src/modules/cash/cash.service.js', async original => ({ ...await original(), drawerDTOs: vi.fn(async () => []) }));
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
import { invoiceCollectionEvents, collectionTotals, payoutEvents } from '../src/modules/reports/collectionEvents.js';
import { detailedIncomeReport, detailedExpensesReport, staffPerformance, taxReport } from '../src/modules/reports/reports.service.js';
import { staffCommissionReport } from '../src/modules/reports/staffPay.report.js';
import { computeBranchMetrics } from '../src/modules/dashboard/dashboard.service.js';

const day = date => new Date(`${date}T00:00:00Z`);
const D = value => new Prisma.Decimal(value);
const actor = { id: 'a1', name: 'Admin', role: 'ADMIN', branchId: 'b1' };
const query = { from: '2026-02-01', to: '2026-02-28' };
const line = (overrides = {}) => ({ id: 'l1', type: 'SERVICE', name: 'Service', itemId: 'svc', code: 'SVC', quantity: D(1),
  unitPrice: D(1000), netSales: D(1000), tax: D(100), taxRate: D('0.1'), discountAllocated: D(0), staffId: 's1', staffName: 'Stylist',
  staffCommissionRate: D(10), components: [], ...overrides });
const payment = (id, amount, date, more = {}) => ({ id, date: day(date), time: '12:00', createdAt: new Date(`${date}T07:00:00Z`),
  amount: D(amount), billAmountAllocated: D(amount), tipAmountAllocated: D(0), method: 'CASH', kind: 'POS', ...more });
const invoice = (more = {}) => ({ id: 'i1', invoiceNumber: 'INV-1', branchId: 'b1', processedByUserId: 'a1',
  processedByName: 'Admin', date: day('2026-01-10'), createdAt: day('2026-01-10'), clientName: 'Client', status: 'PARTIAL', lifecycle: 'ACTIVE',
  netSales: D(1000), tax: D(100), tip: D(0), total: D(1100), advanceAdjusted: D(0), lines: [line()], payments: [], refunds: [], ...more });
const refund = (net, tax, cash, date, more = {}) => ({ id: 'r1', refundNumber: 'REF-1', refundDate: day(date), createdAt: new Date(`${date}T08:00:00Z`),
  type: 'REFUND', method: 'CASH', netReversed: D(net), taxReversed: D(tax), cashOut: D(cash), tipReversed: D(0), receivableCancelled: D(net + tax - cash),
  lines: [{ lineId: 'l1', quantity: D(net / 1000), net: D(net), tax: D(tax) }], ...more });
const inPeriod = (events, from, to) => events.filter(e => e.date >= from && e.date <= to);
const payout = (id, amount, date, extra = {}) => ({ id, paymentNumber: id, staffId: 's1', staffName: 'Stylist', branchId: 'b1',
  amount: D(amount), paidAt: new Date(`${date}T07:00:00Z`), status: 'COMPLETED', method: 'CASH', paidByUserId: 'a1', paidByName: 'Admin', ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { invoices: [], expenses: [], salary: [], commission: [], slips: [] });
  for (const model of Object.values(db)) {
    model.findMany.mockResolvedValue([]);
    model.aggregate.mockResolvedValue({ _sum: {}, _count: 0 });
    model.groupBy.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
  }
  db.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
  db.branch.findMany.mockResolvedValue([{ id: 'b1', name: 'Branch 1' }]);
  db.invoice.findMany.mockImplementation(async ({ where }) => state.invoices.filter(i =>
    (!where.branchId || (typeof where.branchId === 'string' ? i.branchId === where.branchId : where.branchId.in.includes(i.branchId)))
    && (!where.processedByUserId || i.processedByUserId === where.processedByUserId)));
  db.expense.findMany.mockImplementation(async ({ where }) => state.expenses.filter(e => e.branchId === where.branchId
    && e.expenseDate >= where.expenseDate.gte && e.expenseDate <= where.expenseDate.lte
    && (!where.OR || where.OR.some(part => Object.entries(part).every(([k, v]) => e[k] === v)))));
  db.payrollPayment.findMany.mockImplementation(async () => state.salary);
  db.commissionPayment.findMany.mockImplementation(async () => state.commission);
  db.payslip.findMany.mockImplementation(async () => state.slips);
  db.staff.findMany.mockResolvedValue([{ id: 's1', name: 'Stylist', employeeCode: 'S1', branchId: 'b1' }]);
});


import { incomeExpenseCollectionSummary } from '../../frontend/src/features/reports/incomeExpenseDisplay.ts';

describe('targeted collection summaries and tax labels', () => {
  it('keeps 500 collected revenue separate from 1000 accrual revenue and unpaid costs', () => {
    const rows = [{ type: 'INCOME', income: 500, recognizedIncome: 1000, paid: 550 },
      { type: 'SALARY_EXPENSE', expense: 200, paid: 0, status: 'FINALIZED' },
      { type: 'COMMISSION_EXPENSE', expense: 50, paid: 0, status: 'ACCRUED' },
      { type: 'INVENTORY_WRITEOFF', expense: 30, paid: 30 }];
    expect(incomeExpenseCollectionSummary(500, rows)).toEqual({ paidOperatingExpenses: 0, surplus: 500 });
  });
  it('counts paid salary/commission and signed operating reversals, excluding settlements', () => {
    const rows = [{ type: 'SALARY_EXPENSE', paid: 100 }, { type: 'COMMISSION_EXPENSE', paid: 50 },
      { type: 'OPERATING_EXPENSE', paid: 20 }, { type: 'OPERATING_EXPENSE', paid: -20, cashFlow: 20 },
      { type: 'SETTLEMENT', paid: 500, cashFlow: -500 }];
    expect(incomeExpenseCollectionSummary(500, rows)).toEqual({ paidOperatingExpenses: 150, surplus: 350 });
  });
  it('keeps detailed net500, tax50 and gross receipt550 unchanged', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-01')] })];
    const r = await detailedIncomeReport(actor, query);
    expect(r.kpis).toMatchObject({ recognizedNetRevenue: 500, totalTaxCharged: 50, totalPaid: 550 });
    expect(r.rows.reduce((s, r) => s + r.payments.reduce((s, p) => s + p.amount, 0), 0)).toBe(550);
  });
  it('discloses invoice100, collected50 and uncollected50 without reducing statutory100', async () => {
    state.invoices = [invoice({ date: day('2026-02-01'), payments: [payment('p', 550, '2026-02-01')] })];
    const r = await taxReport(actor, query);
    expect(r.kpis).toMatchObject({ totalTaxCharged: 100, totalTaxCollected: 50, uncollectedCustomerTax: 50, netTaxLiability: 100 });
  });
  it('uncollected tax includes unpaid invoices even without a receipt', async () => {
    state.invoices = [invoice()];
    expect((await taxReport(actor, query)).kpis.uncollectedCustomerTax).toBe(100);
  });
  it('later dues clear outstanding tax; future reversals do not change the historical balance', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-01-10'), payment('p2', 550, '2026-02-05', { reversedAt: day('2026-03-01'), reversalDate: day('2026-03-01') })] })];
    expect((await taxReport(actor, query)).kpis).toMatchObject({ totalTaxCollected: 50, uncollectedCustomerTax: 0 });
    expect((await taxReport(actor, { from: '2026-03-01', to: '2026-03-31' })).kpis).toMatchObject({ totalTaxCollected: -50, uncollectedCustomerTax: 50 });
  });
  it('unpaid credits reduce tax receivable, not customer cash collections', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-01')], refunds: [refund(200, 20, 0, '2026-02-05')] })];
    expect((await taxReport(actor, query)).kpis).toMatchObject({ totalTaxCollected: 50, uncollectedCustomerTax: 30 });
  });
  it('commission remains earned50, paid0, outstanding50 for a half payment', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-01')] })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ attributedNetSales: 500, earned: 50, paid: 0, outstanding: 50 });
  });
  it('later dues, linked payout and payout reversal do not duplicate commission', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-01-10'), payment('p2', 550, '2026-02-01')] })];
    state.commission = [payout('com', 30, '2026-01-11', { payrollPaymentId: 'salary', status: 'REVERSED', reversedAt: day('2026-02-03') })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ openingLiability: 20, earned: 50, paid: -30, outstanding: 100 });
  });
  it('a reversed customer receipt reverses its commission once', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-01', { reversedAt: day('2026-02-03'), reversalDate: day('2026-02-03') })] })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ earned: 50, reversed: 50, paid: 0, outstanding: 0 });
  });
});
