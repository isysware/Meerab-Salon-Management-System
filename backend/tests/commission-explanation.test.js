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
import { detailedIncomeReport, detailedExpensesReport, staffPerformance } from '../src/modules/reports/reports.service.js';
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


describe('commission explanation without accounting recognition changes', () => {
  it('shows original1000, collected500, earned50, paid0, outstanding50 and PARTIAL', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-01')] })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ invoiceEligibleNetSales: 1000, invoiceCommissionReference: 100, attributedNetSales: 500, earned: 50, paid: 0, outstanding: 50 });
    expect(r.rows[0]).toMatchObject({ invoiceEligibleNetSales: 1000, invoiceCommissionReference: 100, paymentStatus: 'PARTIAL', earned: 50 });
  });
  it('does not add invoice references or earned commission twice on later dues', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-02-01'), payment('p2', 550, '2026-02-02')] })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ invoiceEligibleNetSales: 1000, invoiceCommissionReference: 100, earned: 100, outstanding: 100 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every(r => r.paymentStatus === 'PAID')).toBe(true);
  });
  it('keeps historical PARTIAL status before a later receipt', async () => {
    state.invoices = [invoice({ status: 'PAID', payments: [payment('p1', 550, '2026-02-01'), payment('p2', 550, '2026-03-02')] })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.rows[0].paymentStatus).toBe('PARTIAL');
    expect(r.totals.earned).toBe(50);
  });
  it('retains receipts-only earned liability after payout and receipt reversal', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-01', { reversedAt: day('2026-02-03'), reversalDate: day('2026-02-03') })] })];
    state.commission = [payout('paid', 20, '2026-02-02')];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ invoiceEligibleNetSales: 1000, earned: 50, reversed: 50, paid: 20, outstanding: -20 });
    expect(r.rows.every(r => r.paymentStatus === 'UNPAID')).toBe(true);
  });
});
