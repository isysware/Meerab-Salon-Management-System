import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { db, state } = vi.hoisted(() => {
  const models = ['invoice', 'branch', 'expense', 'expenseCategory', 'payrollPayment', 'commissionPayment', 'payslip',
    'staff', 'invoiceLine', 'commissionStatement', 'tipAllocation', 'tipPayout', 'attendanceRecord', 'overtimeRecord',
    'invoiceRefund', 'invoicePayment', 'appointment', 'cashDrawer', 'paymentAccount', 'commissionEvent', 'accountMovement', 'drawerMovement', 'booking'];
  return { db: Object.fromEntries(models.map(name => [name, { findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn() }])),
    state: { invoices: [], expenses: [], salary: [], commission: [], slips: [] } };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
vi.mock('../src/lib/balances.js', async original => ({ ...await original(), accountBalances: vi.fn(async () => new Map()) }));
vi.mock('../src/modules/cash/cash.service.js', async original => ({ ...await original(), drawerDTOs: vi.fn(async () => []) }));
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
import { invoiceCollectionEvents, collectionTotals, payoutEvents, invoiceBalanceAsOf } from '../src/modules/reports/collectionEvents.js';
import { detailedIncomeReport, detailedExpensesReport, staffPerformance, salesInvoicesReport, taxReport, paymentAccountsReport, cashDrawerReport } from '../src/modules/reports/reports.service.js';
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


import { getGeneralLedger } from '../src/modules/ledger/ledger.service.js';
import { clientOutstanding } from '../src/modules/pos/pos.service.js';
import { clientStats } from '../src/modules/clients/clients.service.js';

describe('Step 2 sales, tax and customer reconciliation', () => {
  it('reconciles approved partial payment across sales, income, tax and dues', async () => {
    const inv = invoice({ date: day('2026-02-01'), clientId: 'c1', subtotal: D(1000),
      payments: [payment('p1', 550, '2026-02-01')] });
    state.invoices = [inv];
    const sales = await salesInvoicesReport(actor, query);
    const income = await detailedIncomeReport(actor, query);
    const tax = await taxReport(actor, query);
    const dues = await clientOutstanding(actor, { clientIdOrPhone: 'c1' });
    expect(sales.kpis).toMatchObject({ collectedRevenue: 500, taxCollected: 50, totalPaid: 550, totalOutstanding: 550, netTaxLiability: 100 });
    expect(income.totals.recognizedNet).toBe(500);
    expect(tax.kpis).toMatchObject({ totalTaxCollected: 50, totalTaxCharged: 100, netTaxLiability: 100 });
    expect(dues[0].amountDue).toBe(550);
    expect(sales.rows[0].total).toBe(1100);
  });
  it('F04/F05 deducts refund tax once and cash refunds only from cash', async () => {
    const inv = invoice({ date: day('2026-02-01'), payments: [payment('p1', 1100, '2026-02-01')], refunds: [refund(200, 20, 220, '2026-02-05')] });
    state.invoices = [inv];
    const r = await salesInvoicesReport(actor, query);
    expect(r.kpis).toMatchObject({ taxCharged: 100, taxReversed: 20, netTaxLiability: 80, collectedRevenue: 800, taxCollected: 80, totalCashCollected: 880, totalOnlineCollected: 0 });
    expect(r.rows[0]).toMatchObject({ cashPaid: 880, onlinePaid: 0, outstanding: 0 });
  });
  it('F06 includes the signed void refund and retains original invoice total', async () => {
    state.invoices = [invoice({ date: day('2026-02-01'), lifecycle: 'VOIDED', payments: [payment('p', 1100, '2026-02-01')], refunds: [refund(1000, 100, 1100, '2026-02-02', { type: 'VOID' })] })];
    const r = await salesInvoicesReport(actor, query);
    expect(r.kpis).toMatchObject({ totalPaid: 0, totalCashCollected: 0, netTaxLiability: 0, totalOutstanding: 0 });
    expect(r.rows[0].total).toBe(1100);
  });
  it('F18 retains January receipt and reports February reversal on its own date', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-01-10', { reversedAt: day('2026-02-02'), reversalDate: day('2026-02-02') })] })];
    const jan = await salesInvoicesReport(actor, { from: '2026-01-01', to: '2026-01-31' });
    const feb = await salesInvoicesReport(actor, query);
    expect(jan.kpis).toMatchObject({ totalPaid: 550, totalOutstanding: 550 });
    expect(feb.kpis).toMatchObject({ totalPaid: -550, collectedRevenue: -500, taxCollected: -50, totalOutstanding: 1100 });
  });
  it('later dues are included even when invoice date is outside range; tips excluded from revenue', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-01-10'), payment('p2', 600, '2026-02-02', { billAmountAllocated: D(550), tipAmountAllocated: D(50), kind: 'DUES_COLLECTION' })] })];
    const r = await salesInvoicesReport(actor, query);
    expect(r.kpis).toMatchObject({ collectedRevenue: 500, taxCollected: 50, tipsCollected: 50, totalPaid: 600, totalOutstanding: 0, invoiceTotal: 0 });
  });
  it('unpaid credits reduce outstanding without inventing negative collections', () => {
    const inv = invoice({ payments: [payment('p', 550, '2026-01-10')], refunds: [refund(200, 20, 0, '2026-02-05')] });
    expect(invoiceBalanceAsOf(inv, '2026-01-31').outstanding.toNumber()).toBe(550);
    expect(invoiceBalanceAsOf(inv, '2026-02-28').outstanding.toNumber()).toBe(330);
    expect(collectionTotals(inPeriod(invoiceBalanceAsOf(inv).events, '2026-02-01', '2026-02-28')).actualCollections).toBe(0);
    expect(invoiceBalanceAsOf(invoice({ refunds: [refund(200, 20, 0, '2026-02-05')] })).outstanding.toNumber()).toBe(880);
  });
  it('preserves negative online-only refunds and account IDs with duplicate names', async () => {
    state.invoices = [invoice({ payments: [payment('p', 1100, '2026-01-10', { method: 'ONLINE_ACCOUNT', paymentAccountId: 'a1', paymentAccountName: 'Bank' })], refunds: [refund(200, 20, 220, '2026-02-05', { method: 'ONLINE_ACCOUNT', accountId: 'a1' })] })];
    const r = await salesInvoicesReport(actor, query);
    expect(r.tenderBreakdown).toMatchObject({ totalCash: 0, totalOnline: -220, grandTotal: -220 });
    expect(r.tenderBreakdown.onlineAccounts[0]).toMatchObject({ accountId: 'a1', amount: -220 });
  });
  it('customer stats derive dues despite stale cached status/amountDue', async () => {
    const inv = invoice({ clientId: 'c1', amountDue: D(0), status: 'PAID', payments: [payment('p', 550, '2026-02-01')] });
    state.invoices = [inv];
    const stats = await clientStats(['c1'], db, actor);
    expect(stats.get('c1').outstandingBalance).toBe(550);
    const dues = await clientOutstanding(actor, { clientIdOrPhone: 'c1' });
    expect(dues[0].status).toBe('PARTIAL');
  });
  it('scopes reports to authorized branch and rejects staff access', async () => {
    await expect(salesInvoicesReport({ ...actor, role: 'STAFF' }, query)).rejects.toMatchObject({ status: 403 });
    await expect(cashDrawerReport({ ...actor, role: 'STAFF' }, query)).rejects.toMatchObject({ status: 403 });
    await salesInvoicesReport(actor, { ...query, branchId: 'other' });
    expect(db.invoice.findMany.mock.calls.at(-1)[0].where.branchId).toBe('b1');
  });
});

const movement = (id, amount, direction, at, more = {}) => ({ id, amount: D(amount), direction, createdAt: new Date(at),
  branchId: 'b1', type: direction === 'IN' ? 'POS_SALE' : 'EXPENSE', sourceModule: 'POS', accountId: 'a1',
  account: { id: 'a1', name: 'Bank', branchId: 'b1' }, userName: 'Admin', ...more });

describe('Step 2 payment custody reconciliation', () => {
  it('F20 filters rows without changing account closing/running balances', async () => {
    db.paymentAccount.findMany.mockResolvedValue([{ id: 'a1', name: 'Bank', openingBalance: D(100), branchId: 'b1' }]);
    db.accountMovement.findMany.mockResolvedValue([
      movement('in', 550, 'IN', '2026-02-01T01:00:00Z'), movement('out', 200, 'OUT', '2026-02-01T02:00:00Z'),
      movement('in2', 50, 'IN', '2026-02-01T03:00:00Z'),
    ]);
    const r = await paymentAccountsReport(actor, { ...query, direction: 'IN', search: 'Admin' });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1].runningBalance).toBe(500);
    expect(r.kpis).toMatchObject({ totalOpeningBalance: 100, totalMoneyIn: 600, totalMoneyOut: 200, totalClosingBalance: 500 });
    expect(r.filteredTotals).toEqual({ moneyIn: 600, moneyOut: 0 });
    expect(db.accountMovement.findMany.mock.calls[0][0].where).not.toHaveProperty('direction');
  });
  it('F21 ledger uses Karachi boundaries and labels early local movements correctly', async () => {
    db.accountMovement.findMany.mockResolvedValue([movement('m', 550, 'IN', '2026-01-31T20:00:00Z')]);
    const r = await getGeneralLedger(actor, { ...query, channel: 'BANK' });
    const where = db.accountMovement.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-01-31T19:00:00.000Z');
    expect(where.createdAt.lte.toISOString()).toBe('2026-02-28T18:59:59.999Z');
    expect(db.accountMovement.aggregate.mock.calls[0][0].where.createdAt.lt.toISOString()).toBe('2026-01-31T19:00:00.000Z');
    expect(JSON.stringify(r)).toContain('2026-02-01');
  });
  it('F22 drawer opening plus period in minus out excludes future events and cash counts', async () => {
    db.cashDrawer.findMany.mockResolvedValue([{ id: 'drawer1', branchId: 'b1', date: day('2026-01-01'), createdAt: day('2026-01-01'),
      custodianName: 'Admin', custodianUserId: 'a1', status: 'OPEN', settlements: [],
      lastCountedAt: day('2026-03-01'), lastCountedCash: D(9999),
      movements: [movement('open', 100, 'IN', '2026-01-01T00:00:00Z', { type: 'OPENING_FLOAT' }),
        movement('sale', 550, 'IN', '2026-02-01T00:00:00Z', { type: 'CASH_SALE' }),
        movement('out', 200, 'OUT', '2026-02-02T00:00:00Z'), movement('future', 9999, 'IN', '2026-03-01T00:00:00Z')] }]);
    const r = await cashDrawerReport(actor, query);
    expect(r.rows[0]).toMatchObject({ openingBalance: 100, totalCashIn: 550, totalCashOut: 200, expectedCash: 450, countedCash: null, variance: null, movementCount: 2 });
    expect(r.transactions).toHaveLength(2);
    expect(r.kpis.totalExpectedCash).toBe(450);
    expect(db.cashDrawer.findMany.mock.calls[0][0].include.movements.where.createdAt.lte.toISOString()).toBe('2026-02-28T18:59:59.999Z');
  });
  it('cash drawer tender reconciliation reuses the same partial-payment revenue/tax split', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-02')] })];
    const r = await cashDrawerReport(actor, query);
    expect(r.collections).toMatchObject({ collectedRevenue: 500, taxCollected: 50, actualCollections: 550 });
    expect(r.tenderBreakdown.grandTotal).toBe(550);
  });
});

import { drawerDebits, drawerMoney } from '../../frontend/src/features/reports/cashDrawerUtils.ts';

describe('Step 2 edge reconciliations', () => {
  it('tax keeps historical statutory recognition separate from later collections and credits', async () => {
    const inv = invoice({ payments: [payment('p1', 550, '2026-01-10'), payment('p2', 550, '2026-02-02')], refunds: [refund(200, 20, 220, '2026-02-05')] });
    state.invoices = [inv];
    db.invoiceRefund.findMany.mockImplementation(async ({ where }) => inv.refunds.filter(r => r.refundDate >= where.refundDate.gte && r.refundDate <= where.refundDate.lte).map(r => ({ ...r, invoice: inv })));
    const jan = await taxReport(actor, { from: '2026-01-01', to: '2026-01-31' });
    const feb = await taxReport(actor, query);
    expect(jan.kpis).toMatchObject({ totalTaxCharged: 100, totalTaxCollected: 50, netTaxLiability: 100 });
    expect(feb.kpis).toMatchObject({ totalTaxCharged: 0, totalTaxCollected: 30, netTaxLiability: -20 });
    expect(feb.collectionRows.reduce((s, r) => s + r.taxCollected, 0)).toBe(30);
  });
  it('multi-line payments appear once per receipt in Sales tender details', async () => {
    state.invoices = [invoice({ lines: [line({ netSales: D(500), tax: D(50) }), line({ id: 'l2', netSales: D(500), tax: D(50) })], payments: [payment('p', 550, '2026-02-02')] })];
    const r = await salesInvoicesReport(actor, query);
    expect(r.rows[0].payments).toHaveLength(1);
    expect(r.rows[0].payments[0].amount).toBe(550);
    expect(r.kpis.collectedRevenue).toBe(500);
  });
  it('applied advance settles dues once without fabricating another checkout receipt', () => {
    const inv = invoice({ advanceAdjusted: D(550), booking: { payments: [{ id: 'bp', date: day('2026-01-01'), createdAt: day('2026-01-01'), amount: D(550), method: 'CASH', isRefund: false }] }, payments: [payment('p', 550, '2026-02-01')] });
    expect(invoiceBalanceAsOf(inv).outstanding.toNumber()).toBe(0);
    expect(collectionTotals(inPeriod(invoiceBalanceAsOf(inv).events, '2026-02-01', '2026-02-28')).actualCollections).toBe(550);
  });
  it('transfers are included in account debit/credit reconciliation but remain separate from sales', async () => {
    db.paymentAccount.findMany.mockResolvedValue([{ id: 'a1', name: 'Bank', openingBalance: D(100), branchId: 'b1' }]);
    db.accountMovement.findMany.mockResolvedValue([movement('t1', 50, 'IN', '2026-02-01T01:00:00Z', { type: 'TRANSFER_IN' }), movement('t2', 30, 'OUT', '2026-02-01T02:00:00Z', { type: 'TRANSFER_OUT' })]);
    const r = await paymentAccountsReport(actor, query);
    expect(r.kpis).toMatchObject({ totalDebits: 50, totalCredits: 30, totalMoneyIn: 0, totalMoneyOut: 0, totalClosingBalance: 120 });
  });
  it('bank customer receipt components reconcile independently of expenses and transfers', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-02', { method: 'ONLINE_ACCOUNT', paymentAccountId: 'a1' })] })];
    db.paymentAccount.findMany.mockResolvedValue([{ id: 'a1', name: 'Bank', openingBalance: D(100), branchId: 'b1' }]);
    db.accountMovement.findMany.mockResolvedValue([movement('sale', 550, 'IN', '2026-02-02T01:00:00Z'), movement('expense', 200, 'OUT', '2026-02-02T02:00:00Z')]);
    const r = await paymentAccountsReport(actor, query);
    expect(r.collections).toMatchObject({ collectedRevenue: 500, taxCollected: 50, actualCollections: 550 });
    expect(r.accountsSummary[0]).toMatchObject({ collectedRevenue: 500, taxCollected: 50, closingBalance: 450 });
    expect(r.kpis.totalClosingBalance).toBe(100 + 550 - 200);
  });
  it('drawer display does not subtract an in-period opening float from period debits', () => {
    const row = { openingBalance: 100, openingFloat: 50, totalCashIn: 600 };
    expect(drawerDebits(row)).toBe(600);
    expect(row.openingBalance + drawerDebits(row) - 200).toBe(500);
    expect(drawerMoney(-50)).toBe('-50.00');
  });
  it('accountant collections remain restricted to owned sales; missing branch fails closed', async () => {
    state.invoices = [invoice({ payments: [payment('p', 550, '2026-02-02')] }), invoice({ id: 'other', processedByUserId: 'other', payments: [payment('p2', 1100, '2026-02-02')] })];
    const r = await salesInvoicesReport({ ...actor, role: 'ACCOUNTANT' }, query);
    expect(r.kpis.totalPaid).toBe(550);
    await expect(salesInvoicesReport({ ...actor, branchId: undefined }, query)).rejects.toMatchObject({ status: 403 });
    await expect(paymentAccountsReport({ ...actor, role: 'ACCOUNTANT' }, query)).rejects.toMatchObject({ status: 403 });
    await expect(clientOutstanding({ ...actor, branchId: undefined }, { clientIdOrPhone: 'c1' })).rejects.toMatchObject({ status: 403 });
  });
});
