import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { db, state } = vi.hoisted(() => {
  const models = ['invoice', 'branch', 'expense', 'expenseCategory', 'payrollPayment', 'commissionPayment', 'payslip',
    'staff', 'invoiceLine', 'commissionStatement', 'tipAllocation', 'tipPayout', 'attendanceRecord', 'overtimeRecord',
    'invoiceRefund', 'invoicePayment', 'appointment', 'cashDrawer', 'paymentAccount', 'commissionEvent', 'stockMovement', 'payrollRun'];
  return { db: Object.fromEntries(models.map(name => [name, { findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn() }])),
    state: { invoices: [], expenses: [], salary: [], commission: [], slips: [] } };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
vi.mock('../src/lib/balances.js', async original => ({ ...await original(), accountBalances: vi.fn(async () => new Map()) }));
vi.mock('../src/modules/cash/cash.service.js', async original => ({ ...await original(), drawerDTOs: vi.fn(async () => []) }));
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
import { invoiceCollectionEvents, collectionTotals, payoutEvents } from '../src/modules/reports/collectionEvents.js';
import { detailedIncomeReport, detailedExpensesReport, staffPerformance, computePeriodMetrics, operatingProfitReport } from '../src/modules/reports/reports.service.js';
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
    && (!where.processedByUserId || i.processedByUserId === where.processedByUserId)
    && (!where.date?.gte || i.date >= where.date.gte) && (!where.date?.lte || i.date <= where.date.lte)));
  db.expense.findMany.mockImplementation(async ({ where }) => state.expenses.filter(e => e.branchId === where.branchId
    && e.expenseDate >= where.expenseDate.gte && e.expenseDate <= where.expenseDate.lte
    && (!where.OR || where.OR.some(part => Object.entries(part).every(([k, v]) => e[k] === v)))));
  db.payrollPayment.findMany.mockImplementation(async () => state.salary);
  db.commissionPayment.findMany.mockImplementation(async () => state.commission);
  db.payslip.findMany.mockImplementation(async () => state.slips);
  db.staff.findMany.mockResolvedValue([{ id: 's1', name: 'Stylist', employeeCode: 'S1', branchId: 'b1' }]);
});


import { fullCommissionSnapshot, accruedCommissionForPeriod } from '../src/modules/reports/fullCommissionAccrual.js';
import { startOfDay, endOfDay } from '../src/lib/dates.js';
const metrics = (from = query.from, to = query.to) => computePeriodMetrics('b1', from, to, startOfDay(from), endOfDay(to));

describe('full service accrual versus collection payable', () => {
  it('recognizes 1000 revenue,100 commission,900 profit while cash surplus stays500', async () => {
    state.invoices = [invoice({ date: day('2026-02-01'), amountDue: D(550), payments: [payment('p',550,'2026-02-01')] })];
    const r = await metrics();
    expect(r).toMatchObject({ totalNetSales: 1000, commissionExpenses: 100, netOperatingProfit: 900,
      totalCollectedRevenue: 500, totalCollectedTax: 50, collectionEarnedCommission: 50,
      paidCommissionExpenses: 0, collectionCashSurplus: 500, outstandingDues: 550 });
    const c = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(c.totals).toMatchObject({ fullInvoiceCommission: 100, collectionBasedPayable: 50, remainingNotYetPayable: 50, earned: 50, paid: 0, outstanding: 50 });
  });
  it('full payment recognizes the same100 accounting expense and no extra cash expense', async () => {
    state.invoices = [invoice({ date: day('2026-02-01'), amountDue: D(0), payments: [payment('p',1100,'2026-02-01')] })];
    expect(await metrics()).toMatchObject({ commissionExpenses: 100, netOperatingProfit: 900, collectionEarnedCommission: 100, collectionCashSurplus: 1000 });
    expect((await staffCommissionReport(actor, { startDate: query.from, endDate: query.to })).totals).toMatchObject({ fullInvoiceCommission: 100, collectionBasedPayable: 100, remainingNotYetPayable: 0 });
  });
  it('later dues do not recognize another accounting commission expense', async () => {
    const inv = invoice({ payments: [payment('p1',550,'2026-01-10'), payment('p2',550,'2026-02-02',{ kind: 'DUES_COLLECTION' })] });
    state.invoices = [inv];
    db.invoicePayment.findMany.mockResolvedValue([{ ...inv.payments[1], invoice: inv }]);
    expect(await metrics()).toMatchObject({ totalNetSales: 0, commissionExpenses: 0, netOperatingProfit: 0, totalCollectedRevenue: 500, collectionEarnedCommission: 50, collectionCashSurplus: 500 });
    expect((await accruedCommissionForPeriod({branchId:'b1'},'2026-01-01','2026-01-31')).toNumber()).toBe(100);
  });
  it('recognizes unpaid completed service commission without creating collection payable', async () => {
    state.invoices = [invoice({ date: day('2026-02-01'), payments: [] })];
    expect(await metrics()).toMatchObject({ commissionExpenses: 100, netOperatingProfit: 900, collectionEarnedCommission: 0, paidCommissionExpenses: 0, collectionCashSurplus: 0 });
    expect((await staffCommissionReport(actor, { startDate: query.from, endDate: query.to })).totals)
      .toMatchObject({ fullInvoiceCommission: 100, collectionBasedPayable: 0, remainingNotYetPayable: 100, paid: 0, outstanding: 0 });
  });
  it('dated credits reverse full commission once, irrespective of cash refunds', async () => {
    const r = refund(200,20,0,'2026-02-05');
    state.invoices = [invoice({ payments: [payment('p',550,'2026-01-10')], refunds: [r] })];
    expect((await accruedCommissionForPeriod({branchId:'b1'},'2026-01-01','2026-01-31')).toNumber()).toBe(100);
    expect((await accruedCommissionForPeriod({branchId:'b1'},query.from,query.to)).toNumber()).toBe(-20);
    const c = await staffCommissionReport(actor,{startDate:'2026-01-01',endDate:query.to});
    expect(c.totals).toMatchObject({ fullInvoiceCommission: 80, collectionBasedPayable: 50, remainingNotYetPayable: 30 });
  });
  it('reversed customer payments affect payable but never reverse completed-service expense', async () => {
    state.invoices = [invoice({ date: day('2026-02-01'), payments: [payment('p',550,'2026-02-01',{reversedAt:day('2026-02-03'),reversalDate:day('2026-02-03')})] })];
    expect((await accruedCommissionForPeriod({branchId:'b1'},query.from,query.to)).toNumber()).toBe(100);
    expect((await staffCommissionReport(actor,{startDate:query.from,endDate:query.to})).totals).toMatchObject({ fullInvoiceCommission:100, collectionBasedPayable:0, remainingNotYetPayable:100, outstanding:0 });
  });
  it('cash uses actual linked payouts once and reverses them on their own dates', async () => {
    state.invoices = [invoice({date:day('2026-02-01'),payments:[payment('p',550,'2026-02-01')]})];
    state.commission = [payout('cp',30,'2026-02-02',{payrollPaymentId:'payroll',status:'REVERSED',reversedAt:day('2026-03-02')})];
    expect(await metrics()).toMatchObject({ commissionExpenses:100, paidCommissionExpenses:30, collectionCashSurplus:470 });
    expect(await metrics('2026-03-01','2026-03-31')).toMatchObject({ commissionExpenses:0, paidCommissionExpenses:-30, collectionCashSurplus:30 });
  });
  it('COGS and noncash writeoffs remain accounting costs, not duplicate cash outflows', async () => {
    state.invoices = [invoice({date:day('2026-02-01'),payments:[payment('p',550,'2026-02-01')]})];
    db.stockMovement.findMany.mockResolvedValue([{movementType:'POS_SALE_OUT',totalCost:D(100)},{movementType:'DAMAGED_OUT',totalCost:D(25)}]);
    const r = await metrics();
    expect(r.collectionCashSurplus).toBe(500);
    expect(r.totalPaidOperatingExpenses).toBe(0);
    expect(r.netOperatingProfit).toBe(775);
  });
  it('uses component historical rates and ignores products/house', () => {
    const inv=invoice({lines:[line({type:'PACKAGE',components:[{id:'c1',staffId:'s1',allocatedAmount:D(600),staffCommissionRate:D(10)},{id:'c2',staffId:'s2',allocatedAmount:D(400),staffCommissionRate:D(20)}]})]});
    expect(fullCommissionSnapshot(inv,query.to).totalEarnedCommission.toNumber()).toBe(140);
    expect(fullCommissionSnapshot(invoice({lines:[line({type:'PRODUCT'})]}),query.to).totalEarnedCommission.toNumber()).toBe(0);
  });
  it('statement and export rows label accounting accrual separately', async () => {
    state.invoices = [invoice({date:day('2026-02-01'),payments:[payment('p',550,'2026-02-01')]})];
    const r=await operatingProfitReport(actor,query);
    expect(JSON.stringify(r)).toContain('Full Completed-Service Commission');
    expect(r.kpis.commissionExpenses).toBe(100);
  });
});
