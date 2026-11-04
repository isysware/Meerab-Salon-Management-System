import { beforeEach, describe, expect, it, vi } from 'vitest';
const { db, state } = vi.hoisted(() => {
  const models = ['staff','branch','user','payrollRun','salaryAdvance','advanceRecovery','payrollAdjustment',
    'idempotencyKey','cashDrawer','drawerMovement','accountMovement','paymentAccount','expense','expenseCategory',
    'payrollPayment','commissionPayment','payslip','invoice','invoicePayment','invoiceRefund','commissionEvent',
    'stockMovement','invoiceLine','bookingHistory'];
  const db = Object.fromEntries(models.map(m => [m, Object.fromEntries(['findMany','findFirst','findUnique','create','update','updateMany','groupBy','aggregate'].map(k => [k, vi.fn()]))]));
  db.$transaction = vi.fn(fn => fn(db)); db.$executeRaw = vi.fn();
  return { db, state: { cash: [], online: [], recoveries: [], saved: null } };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
vi.mock('../src/lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../src/lib/sequence.js', () => ({ nextSequence: vi.fn(async () => 'ADV-B1-2026-1') }));
vi.mock('../src/lib/dates.js', async original => ({ ...await original(), getBusinessDate: vi.fn(async () => '2026-11-01') }));
import { issueAdvance, advanceBalance, lockPayrollExtras, releasePayrollExtras } from '../src/modules/payroll/payroll.extras.service.js';
import { accountBalance } from '../src/lib/balances.js';
import { holderBalance } from '../src/modules/cash/cash.service.js';
import { evaluateEmployeePayroll, getDatesInRange } from '../src/lib/calculations/payrollCalculations.js';
import { detailedExpensesReport, incomeExpenseReport, computePeriodMetrics, paymentAccountsReport, cashDrawerReport } from '../src/modules/reports/reports.service.js';
import { startOfDay, endOfDay } from '../src/lib/dates.js';
import { custodyStatement } from '../src/modules/settlements/settlements.service.js';
import { loadStaffLoanMovements } from '../src/modules/reports/staffLoanMovements.js';

const actor = { id: 'admin', name: 'Admin', role: 'ADMIN', branchId: 'b1' };
const input = { staffId: 's1', amount: 10000, recoveryPerMonth: 2000, startMonth: '2026-11', method: 'CASH', reason: 'Loan', idempotencyKey: 'issue-1' };
const query = { from: '2026-11-01', to: '2026-11-30' };
const loan = { id: 'loan1', branchId: 'b1', staffId: 's1', amount: 10000, recoveryPerMonth: 2000, status: 'ACTIVE' };
const group = rows => ['IN','OUT'].map(direction => ({ direction, _sum: { amount: rows.filter(r => r.direction === direction).reduce((s,r) => s + Number(r.amount), 0) } }));
const filtered = (rows, where = {}) => rows.filter(r => (!where.branchId || r.branchId === where.branchId)
  && (!where.sourceModule || (typeof where.sourceModule === 'string' ? r.sourceModule === where.sourceModule : where.sourceModule.in.includes(r.sourceModule)))
  && (!where.createdAt || (r.createdAt >= where.createdAt.gte && r.createdAt <= where.createdAt.lte)));

beforeEach(() => {
  vi.clearAllMocks(); Object.assign(state, { cash: [], online: [], recoveries: [], saved: null });
  for (const model of Object.values(db).filter(m => m.findMany)) {
    model.findMany.mockResolvedValue([]); model.findFirst.mockResolvedValue(null); model.findUnique.mockResolvedValue(null);
    model.aggregate.mockResolvedValue({ _sum: {} }); model.groupBy.mockResolvedValue([]);
  }
  db.staff.findUnique.mockResolvedValue({ id: 's1', branchId: 'b1', name: 'Stylist', isActive: true });
  db.branch.findUnique.mockResolvedValue({ id: 'b1', name: 'Branch', code: 'B1' });
  db.branch.findMany.mockResolvedValue([{ id: 'b1', name: 'Branch' }]);
  db.cashDrawer.findMany.mockResolvedValue([{ id: 'd1', branchId: 'b1', kind: 'DRAWER', status: 'OPEN', custodianUserId: 'admin' }]);
  db.cashDrawer.findUnique.mockResolvedValue({ id: 'd1', branchId: 'b1', kind: 'DRAWER', status: 'OPEN' });
  db.paymentAccount.findUnique.mockResolvedValue({ id: 'a1', branchId: 'b1', name: 'Bank', isActive: true, branches: [] });
  db.paymentAccount.findMany.mockResolvedValue([{ id: 'a1', branchId: 'b1', openingBalance: 50000 }]);
  db.drawerMovement.groupBy.mockImplementation(async () => group([{ direction: 'IN', amount: 50000 }, ...state.cash]));
  db.accountMovement.groupBy.mockImplementation(async () => group(state.online).map(r => ({ ...r, accountId: 'a1' })));
  for (const [model, key] of [['drawerMovement','cash'], ['accountMovement','online']]) {
    db[model].create.mockImplementation(async ({data}) => { const row = { id: `${key}-${state[key].length}`, createdAt: new Date('2026-11-01T09:00:00Z'), ...data }; state[key].push(row); return row; });
    db[model].findMany.mockImplementation(async ({where} = {}) => filtered(state[key], where));
  }
  db.salaryAdvance.create.mockImplementation(async ({data}) => ({ id: 'loan1', issuedAt: new Date(), ...data, recoveries: [] }));
  db.salaryAdvance.findUnique.mockImplementation(async () => ({ ...loan, recoveries: state.recoveries }));
  db.advanceRecovery.create.mockImplementation(async ({data}) => { const row = { id: 'rec1', status: 'ACTIVE', ...data }; state.recoveries.push(row); return row; });
  db.advanceRecovery.findMany.mockImplementation(async () => state.recoveries.filter(r => r.status === 'ACTIVE'));
  db.advanceRecovery.updateMany.mockImplementation(async () => { state.recoveries.forEach(r => r.status = 'RELEASED'); });
  db.idempotencyKey.findUnique.mockImplementation(async () => state.saved);
  db.idempotencyKey.create.mockImplementation(async ({data}) => { state.saved = data; return data; });
});

describe('Staff loan cash and reporting reconciliation', () => {
  it.each(['CASH','ONLINE'])('issues %s once, replays retry and derives a 10,000 balance reduction', async method => {
    const args = { ...input, method, onlineAccountId: 'a1' };
    const first = await issueAdvance(actor, args); const retry = await issueAdvance(actor, args);
    expect(first.balance).toBe(10000); expect(retry).toEqual(first);
    expect(db.salaryAdvance.create).toHaveBeenCalledTimes(1);
    expect(state.cash.length + state.online.length).toBe(1);
    const balance = method === 'CASH' ? await holderBalance(db, 'd1') : await accountBalance('a1', { tx: db, branchIds: ['b1'] });
    expect(balance.toNumber()).toBe(40000);
  });
  it('rejects insufficient funds before creating the receivable', async () => {
    db.drawerMovement.groupBy.mockResolvedValue([]);
    await expect(issueAdvance(actor, input)).rejects.toMatchObject({ code: 'INSUFFICIENT_DRAWER_CASH' });
    expect(db.salaryAdvance.create).not.toHaveBeenCalled(); expect(state.cash).toHaveLength(0);
  });
  it('rejects foreign-branch staff before moving money', async () => {
    db.staff.findUnique.mockResolvedValue({ id: 's2', branchId: 'b2', isActive: true });
    await expect(issueAdvance(actor, input)).rejects.toMatchObject({ status: 403 });
    expect(state.cash).toHaveLength(0);
  });
  it('rejects a payment account outside the staff branch', async () => {
    db.paymentAccount.findUnique.mockResolvedValue({ id: 'a1', branchId: 'b2', isActive: true, branches: [] });
    await expect(issueAdvance(actor, { ...input, method: 'ONLINE', onlineAccountId: 'a1' })).rejects.toMatchObject({ code: 'ACCOUNT_INVALID' });
    expect(state.online).toHaveLength(0); expect(db.salaryAdvance.create).not.toHaveBeenCalled();
  });
  it('cash custody preserves the debit/credit trail and separates loan outflow', async () => {
    await issueAdvance(actor, input);
    db.user.findUnique.mockResolvedValue(actor);
    db.cashDrawer.findMany.mockResolvedValue([]);
    const result = await custodyStatement(actor, { startDate: query.from, endDate: query.to });
    expect(result.transactions[0]).toMatchObject({ type: 'STAFF_LOAN_DISBURSEMENT', debit: 0, credit: 10000, runningBalance: -10000 });
    expect(result.summary).toMatchObject({ cashExpensesPaidTotal: 0, staffLoanDisbursementsTotal: 10000, expectedCashInCustody: -10000 });
  });
  it('salary accounting remains 30,000 while cash salary expense is only the 28,000 paid', async () => {
    await issueAdvance(actor, input);
    db.payrollRun.findMany.mockResolvedValue([{ payslips: [{ netPayable: 28000, grossPayable: 30000, snapshot: { advanceRecoveryAmount: 2000 }, payments: [] }] }]);
    db.payrollPayment.findMany.mockResolvedValue([{ amount: 28000 }]);
    const result = await computePeriodMetrics('b1', query.from, query.to, startOfDay(query.from), endOfDay(query.to));
    expect(result).toMatchObject({ salaryExpenses: 30000, paidSalaryExpenses: 28000, netOperatingProfit: -30000, collectionCashSurplus: -28000 });
  });
  it('payment account report includes the single loan credit and 40,000 closing balance', async () => {
    await issueAdvance(actor, { ...input, method: 'ONLINE', onlineAccountId: 'a1' });
    db.accountMovement.groupBy.mockResolvedValue([]); // no movements before the selected period
    db.accountMovement.findMany.mockResolvedValue(state.online.map(m => ({ ...m, account: { id: 'a1', name: 'Bank' } })));
    const report = await paymentAccountsReport(actor, query);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ type: 'SALARY_ADVANCE', credit: 10000, debit: 0 });
    expect(report.kpis.totalClosingBalance).toBe(40000);
  });
  it('cash drawer logs include the single loan credit without another movement', async () => {
    await issueAdvance(actor, input);
    db.cashDrawer.findMany.mockResolvedValue([{ id: 'd1', branchId: 'b1', date: new Date('2026-11-01'), status: 'OPEN',
      createdAt: new Date('2026-11-01'), movements: state.cash, settlements: [] }]);
    const report = await cashDrawerReport(actor, query);
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]).toMatchObject({ type: 'SALARY_ADVANCE', credit: 10000, debit: 0 });
    expect(state.cash).toHaveLength(1);
  });
  it('separates loan from operating expenses and profits in both reports', async () => {
    await issueAdvance(actor, input);
    const expenses = await detailedExpensesReport(actor, query);
    expect(expenses.kpis).toMatchObject({ totalExpenses: 0, nonOperatingCashOutflow: 10000, totalCashOutflow: 10000 });
    expect(expenses.rows[0]).toMatchObject({ sourceType: 'STAFF_LOAN', paidAmount: 10000 });
    const ledger = await incomeExpenseReport(actor, query);
    expect(ledger.kpis).toMatchObject({ staffLoanCashOutflow: 10000, totalOperatingExpenses: 0, netOperatingPosition: 0 });
    expect(ledger.totals.paid).toBe(-10000); expect(ledger.rows).toHaveLength(1);
  });
  it('uses reversal date and excludes unrelated payroll reversals', async () => {
    await issueAdvance(actor, input);
    state.cash.push({ ...state.cash[0], id: 'reversed', direction: 'IN', type: 'REVERSAL', createdAt: new Date('2026-12-02T09:00:00Z') });
    state.cash.push({ ...state.cash[0], id: 'salary', direction: 'IN', type: 'REVERSAL', reference: 'PAY-1', sourceId: 'PAY-1' });
    expect((await detailedExpensesReport(actor, query)).kpis.nonOperatingCashOutflow).toBe(10000);
    const dec = await detailedExpensesReport(actor, { from: '2026-12-01', to: '2026-12-31' });
    expect(dec.kpis).toMatchObject({ totalExpenses: 0, nonOperatingCashOutflow: -10000 });
  });
  it('keeps account and category filters consistent', async () => {
    await issueAdvance(actor, { ...input, method: 'ONLINE', onlineAccountId: 'a1' });
    expect((await detailedExpensesReport(actor, { ...query, paymentSource: 'CASH_DRAWER' })).rows).toHaveLength(0);
    expect((await detailedExpensesReport(actor, { ...query, paymentAccountId: 'a1' })).kpis.nonOperatingCashOutflow).toBe(10000);
  });
  it('scopes loan movements to branch and keeps payroll confidential for accountant', async () => {
    await issueAdvance(actor, input);
    expect(await loadStaffLoanMovements({ branchId: 'b2' }, new Date('2026-11-01'), new Date('2026-12-01'))).toHaveLength(0);
    expect((await detailedExpensesReport({ ...actor, role: 'ACCOUNTANT' }, query)).rows).toHaveLength(0);
  });
});

describe('Configured installment recovery', () => {
  const staff = { id: 's1', branchId: 'b1', name: 'Stylist', compensationType: 'MONTHLY_SALARY', baseSalary: 30000, joiningDate: '2026-01-01' };
  const attendance = getDatesInRange('2026-11-01','2026-11-30').map(date => ({ staffId: 's1', date, status: 'PRESENT' }));
  const calculate = extras => evaluateEmployeePayroll(staff, '2026-11', { monthlyAbsenceDivisor: 30, prorationMethod: 'CALENDAR_DAYS' }, attendance, [], [], { advances: [{ id: 'loan1', advanceNumber: 'ADV-1', recoveryPerMonth: 2000, balance: 10000, ...extras }] }).payslip;
  it('30,000 earned minus 2,000 installment pays 28,000 and leaves 8,000; cancellation releases recovery', async () => {
    const slip = calculate({});
    expect(slip).toMatchObject({ grossPayable: 30000, advanceRecoveryAmount: 2000, netPayable: 28000 });
    expect(state.recoveries).toHaveLength(0);
    await lockPayrollExtras(db, 'run1', '2026-11', slip);
    expect(advanceBalance({ ...loan, recoveries: state.recoveries }).toNumber()).toBe(8000);
    expect(calculate({ balance: 8000, recoveredThisMonth: 2000 }).advanceRecoveryAmount).toBe(0);
    await releasePayrollExtras(db, 'run1');
    expect(advanceBalance({ ...loan, recoveries: state.recoveries }).toNumber()).toBe(10000);
    expect(state.cash).toHaveLength(0);
  });
  it('caps the final installment at the remaining loan', () => {
    expect(calculate({ balance: 750 })).toMatchObject({ advanceRecoveryAmount: 750, netPayable: 29250 });
  });
});
