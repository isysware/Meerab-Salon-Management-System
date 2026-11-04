import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(new URL('../../frontend/package.json', import.meta.url))('esbuild');

const { db, state } = vi.hoisted(() => {
  const models = ['invoice', 'branch', 'expense', 'expenseCategory', 'payrollPayment', 'commissionPayment', 'payslip',
    'staff', 'invoiceLine', 'commissionStatement', 'tipAllocation', 'tipPayout', 'attendanceRecord', 'overtimeRecord',
    'invoiceRefund', 'invoicePayment', 'appointment', 'cashDrawer', 'paymentAccount', 'commissionEvent', 'drawerMovement', 'accountMovement'];
  return { db: Object.fromEntries(models.map(name => [name, { findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn() }])),
    state: { invoices: [], expenses: [], salary: [], commission: [], slips: [] } };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
vi.mock('../src/lib/balances.js', async original => ({ ...await original(), accountBalances: vi.fn(async () => new Map()) }));
vi.mock('../src/modules/cash/cash.service.js', async original => ({ ...await original(), drawerDTOs: vi.fn(async () => []) }));
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
import { invoiceCollectionEvents, collectionTotals, payoutEvents } from '../src/modules/reports/collectionEvents.js';
import { detailedIncomeReport, detailedExpensesReport, staffPerformance, salesInvoicesReport } from '../src/modules/reports/reports.service.js';
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

describe('canonical collection formula', () => {
  it('Sales & Invoices retains one row and filters historical lifecycle at period end', async () => {
    state.invoices=[invoice({payments:[payment('p1',1100,'2026-01-10')],refunds:[refund(1000,100,1100,'2026-02-10')],lifecycle:'REFUNDED'})];
    const jan=await salesInvoicesReport(actor,{from:'2026-01-01',to:'2026-01-31',lifecycle:'ACTIVE'});
    expect(jan.rows).toHaveLength(1);expect(jan.rows[0].lifecycle).toBe('ACTIVE');
    const feb=await salesInvoicesReport(actor,{...query,lifecycle:'REFUNDED'});
    expect(feb.rows).toHaveLength(1);expect(feb.rows[0].paid).toBe(-1100);
  });
  it.each(['handleExportCsv','handlePrint'])('Detailed Income %s keeps the refund inside one original service row', async handler => {
    state.invoices=[invoice({payments:[payment('p1',1100,'2026-02-01')],refunds:[refund(400,40,440,'2026-02-10')]})];
    const reportData=await detailedIncomeReport(actor,query);
    const source=readFileSync(new URL('../../frontend/src/features/reports/DetailedIncomeReportPage.tsx',import.meta.url),'utf8');
    const start=source.indexOf('  const '+handler+' =');
    const end=source.indexOf(handler==='handlePrint'?'\n  const totals':'\n  const handlePrint',start+1);
    const captures=[];
    const context={reportData,sourceType:'ALL',selectedBranch:'b1',fromDate:query.from,toDate:query.to,formatPKR:n=>Number(n).toFixed(2),formatDateDisplay:d=>d,
      downloadReportCsv:(_name,meta,sections)=>captures.push({meta,...sections[0]}),printReportWindow:value=>captures.push(value)};
    const code=transformSync(source.slice(start,end)+'\n'+handler+'();',{loader:'ts',target:'es2022'}).code;
    new Function(...Object.keys(context),code)(...Object.values(context));
    expect(captures[0].rows).toHaveLength(1);
    expect(captures[0].rows[0][4]).toContain('2026-02-10 REF-1 -440.00');
    expect(captures[0].rows[0]).toContain('PARTIALLY_REFUNDED');
  });
  it('groups repeated service codes by actual line ID and never repeats quantities for refunds', async () => {
    state.invoices=[invoice({netSales:D(2000),tax:D(200),lines:[line(),line({id:'l2',quantity:D(2)})],
      payments:[payment('p1',2200,'2026-02-01')],refunds:[refund(400,40,440,'2026-02-10')],lifecycle:'PARTIALLY_REFUNDED'})];
    const report=await detailedIncomeReport(actor,query);
    expect(report.displayRows).toHaveLength(2);
    expect(report.kpis).toMatchObject({serviceCount:3,collectedRevenue:1600,totalPaid:1760});
    expect(report.displayRows.find(r=>r.lineId==='l1')).toMatchObject({quantity:1,originalNetAmount:1000,collectedNet:600,refundAmount:440});
    expect(report.displayRows.find(r=>r.lineId==='l1').payments.map(p=>p.amount)).toEqual([-440,1100]);
  });
  it('does not let a later refund alter earlier income status or revenue', async () => {
    state.invoices=[invoice({payments:[payment('p1',1100,'2026-01-10')],refunds:[refund(1000,100,1100,'2026-02-10')],lifecycle:'REFUNDED'})];
    const jan=await detailedIncomeReport(actor,{from:'2026-01-01',to:'2026-01-31',lifecycle:'ACTIVE'});
    expect(jan.kpis.collectedRevenue).toBe(1000);
    expect(jan.displayRows[0]).toMatchObject({lifecycle:'ACTIVE',refundHistory:[]});
    const feb=await detailedIncomeReport(actor,query);
    expect(feb.displayRows).toHaveLength(1);
    expect(feb.displayRows[0]).toMatchObject({date:'2026-01-10',collectedNet:-1000,originalNetAmount:1000,lifecycle:'REFUNDED'});
  });
  it('tracks previously paid excess commission as a negative balance without changing cash payouts', async () => {
    state.invoices=[1,2,3].map(id=>invoice({id:`i${id}`,payments:[payment(`p${id}`,1100,'2026-02-01')],
      refunds:id===1?[refund(1000,100,1100,'2026-02-10')]:[]}));
    state.commission=[payout('com',300,'2026-02-02')];
    const report=await staffCommissionReport(actor,{startDate:query.from,endDate:query.to});
    expect(report.totals).toMatchObject({earned:300,reversed:100,paid:300,outstanding:-100});
  });
  it('uses 550 = 500 revenue + 50 tax; earns 50 commission; leaves 550 outstanding', () => {
    const rows = invoiceCollectionEvents(invoice({ payments: [payment('p1', 550, '2026-02-01')] }));
    expect(collectionTotals(rows)).toMatchObject({ collectedRevenue: 500, taxCollected: 50, actualCollections: 550 });
    expect(rows[0].commissions[0].amount.toNumber()).toBe(50);
    expect(rows[0].outstanding.toNumber()).toBe(550);
  });
  it.each([0, 0.5, 1, 10])('reads percent snapshot %s without fraction guessing or fallback over zero', rate => {
    const i = invoice({ lines: [line({ staffCommissionRate: D(rate) })] });
    const result = allocatePaymentToInvoice({ invoice: i, paymentAmount: 1100 });
    expect(result.totalEarnedCommission.toNumber()).toBe(rate * 10);
  });
  it('conserves every installment across three lines and the complete invoice', () => {
    const i = invoice({ netSales: D(3), tax: D(0), lines: [1, 2, 3].map(id => line({ id: String(id), netSales: D(1), tax: D(0) })) });
    for (let paid = 0; paid < 300; paid++) {
      const r = allocatePaymentToInvoice({ invoice: i, previousBillPaid: (paid / 100).toFixed(2), paymentAmount: '0.01' });
      expect(r.totalCollectedNet.plus(r.totalCollectedTax).toFixed(2)).toBe('0.01');
      expect(r.lineAllocations.every(a => a.paymentAmount.gte(0))).toBe(true);
    }
  });
  it('recognizes later dues in their payment period, without repeating the invoice or tips', () => {
    const events = invoiceCollectionEvents(invoice({ payments: [payment('p1', 550, '2026-01-10'),
      payment('p2', 550, '2026-02-10', { kind: 'DUES_COLLECTION', amount: D(650), tipAmountAllocated: D(100) })] }));
    expect(collectionTotals(inPeriod(events, query.from, query.to))).toMatchObject({ collectedRevenue: 500, taxCollected: 50, tipsCollected: 100 });
  });
  it('preserves original receipt when a collection is reversed in a later month', () => {
    const events = invoiceCollectionEvents(invoice({ payments: [payment('p1', 550, '2026-01-10',
      { reversedAt: new Date('2026-02-10T08:00:00Z'), reversalDate: day('2026-02-10') })] }));
    expect(collectionTotals(inPeriod(events, '2026-01-01', '2026-01-31')).collectedRevenue).toBe(500);
    expect(collectionTotals(inPeriod(events, query.from, query.to))).toMatchObject({ collectedRevenue: -500, taxCollected: -50 });
  });
  it('does not deduct a cancellation of unpaid dues from collections', () => {
    const events = invoiceCollectionEvents(invoice({ payments: [payment('p1', 550, '2026-01-10')],
      refunds: [refund(500, 50, 0, '2026-02-01')] }));
    expect(collectionTotals(inPeriod(events, query.from, query.to)).collectedRevenue).toBe(0);
    expect(collectionTotals(events).collectedRevenue).toBe(500);
  });
  it.each(['REFUND', 'VOID'])('reports a later full %s as negative collections once', type => {
    const events = invoiceCollectionEvents(invoice({ lifecycle: type === 'VOID' ? 'VOIDED' : 'REFUNDED',
      payments: [payment('p1', 1100, '2026-01-10')], refunds: [refund(1000, 100, 1100, '2026-02-01', { type })] }));
    expect(collectionTotals(inPeriod(events, query.from, query.to))).toMatchObject({ collectedRevenue: -1000, taxCollected: -100 });
    expect(collectionTotals(events).actualCollections).toBe(0);
    expect(events.reduce((total, e) => total + e.commissions.reduce((s, c) => s + c.amount.toNumber(), 0), 0)).toBe(0);
  });
  it('uses already discounted package component net amounts', () => {
    const i = invoice({ netSales: D(900), tax: D(90), lines: [line({ type: 'PACKAGE', netSales: D(900), tax: D(90), discountAllocated: D(100),
      components: [{ id: 'c1', staffId: 's1', allocatedAmount: D(450), staffCommissionRate: D(10) },
        { id: 'c2', staffId: 's2', allocatedAmount: D(450), staffCommissionRate: D(10) }] })], payments: [payment('p1', 495, '2026-02-01')] });
    expect(invoiceCollectionEvents(i)[0].commissions.map(c => c.amount.toNumber())).toEqual([22.5, 22.5]);
  });
  it('reports converted booking receipts on receipt date and does not duplicate checkout advance', () => {
    const i = invoice({ advanceAdjusted: D(550), booking: { payments: [{ ...payment('b1', 550, '2026-01-01'), isRefund: false }] },
      payments: [payment('p1', 550, '2026-02-01')] });
    const events = invoiceCollectionEvents(i);
    expect(collectionTotals(events).actualCollections).toBe(1100);
    expect(collectionTotals(inPeriod(events, query.from, query.to)).collectedRevenue).toBe(500);
  });
  it('conserves mixed-tax split tenders and excludes products/house from commission', () => {
    const i = invoice({ netSales: D(1500), tax: D(100), lines: [line(), line({ id: 'product', type: 'PRODUCT', netSales: D(500), tax: D(0), taxRate: D(0) })],
      payments: [payment('cash', 400, '2026-02-01'), payment('online', 400, '2026-02-01', { method: 'ONLINE_ACCOUNT' })] });
    const events = invoiceCollectionEvents(i);
    expect(collectionTotals(events)).toMatchObject({ actualCollections: 800, collectedRevenue: 750, taxCollected: 50 });
    expect(events.reduce((total, e) => total + e.commissions.reduce((s, c) => s + c.amount.toNumber(), 0), 0)).toBe(50);
  });
  it('reverses only the cash component of a partial refund on a partly paid invoice', () => {
    const events = invoiceCollectionEvents(invoice({ payments: [payment('p1', 550, '2026-01-10')], refunds: [refund(600, 60, 110, '2026-02-01')] }));
    expect(collectionTotals(inPeriod(events, query.from, query.to))).toMatchObject({ actualCollections: -110, collectedRevenue: -100, taxCollected: -10 });
  });
  it('keeps fractional-cent staff allocations cumulative and retains zero-rate exclusions', () => {
    const i = invoice({ netSales: D(3), tax: D(0), lines: [line({ netSales: D(3), tax: D(0), components: [1, 2, 3].map(id => ({
      id: String(id), staffId: `s${id}`, allocatedAmount: D(1), staffCommissionRate: D(id === 3 ? 0 : 10) })) })],
      payments: [payment('p1', 1, '2026-02-01'), payment('p2', 1, '2026-02-02'), payment('p3', 1, '2026-02-03')] });
    const events = invoiceCollectionEvents(i);
    for (const event of events) expect(event.staffAllocations.reduce((s, a) => s.plus(a.net), D(0)).toFixed(2)).toBe(event.collectedNet.toFixed(2));
    for (const staffId of ['s1', 's2', 's3']) expect(events.flatMap(e => e.staffAllocations).filter(a => a.staffId === staffId)
      .reduce((s, a) => s.plus(a.net), D(0)).toFixed(2)).toBe('1.00');
    expect(events.flatMap(e => e.commissions).some(c => c.staffId === 's3')).toBe(false);
  });
});

describe('selected reports and authorization', () => {
  it('Detailed Income includes later dues, excludes other branches, and reconciles row totals', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-02-01')] }), invoice({ id: 'other', branchId: 'b2', payments: [payment('p2', 1100, '2026-02-01')] })];
    const report = await detailedIncomeReport(actor, { ...query, branchId: 'b2' });
    expect(report.meta).toMatchObject({ branchId: 'b1', dateBasis: 'PAYMENT_DATE' });
    expect(report.kpis.recognizedNetRevenue).toBe(500);
    expect(report.rows[0]).toMatchObject({ date: '2026-02-01', recognizedNet: 500, tax: 50, total: 550 });
  });
  it('Accountant sees only own invoice collections and cannot obtain salary or commission payouts', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-02-01')] }), invoice({ id: 'other', processedByUserId: 'a2', payments: [payment('p2', 1100, '2026-02-01')] })];
    const accountant = { ...actor, role: 'ACCOUNTANT' };
    expect((await detailedIncomeReport(accountant, query)).kpis.totalPaid).toBe(550);
    const expense = await detailedExpensesReport(accountant, query);
    expect(expense.rows).toEqual([]);
    expect(expense.liabilities).toBeUndefined();
    expect(db.payrollPayment.findMany).not.toHaveBeenCalled();
    expect(db.commissionPayment.findMany).not.toHaveBeenCalled();
    await expect(staffCommissionReport(accountant, { startDate: query.from, endDate: query.to })).rejects.toMatchObject({ status: 403 });
  });
  it('fails closed for staff and branchless administrators', async () => {
    await expect(detailedIncomeReport({ ...actor, role: 'STAFF' }, query)).rejects.toThrow();
    await expect(detailedExpensesReport({ ...actor, role: 'STAFF' }, query)).rejects.toThrow();
    await expect(detailedIncomeReport({ ...actor, branchId: null }, query)).rejects.toThrow();
  });
  it('records actual payroll and commission payouts once and exposes unpaid amounts separately', async () => {
    state.salary = [payout('sal', 200, '2026-02-05', { commissionAmount: D(50) })];
    state.commission = [payout('com', 50, '2026-02-05', { payrollPaymentId: 'sal' })];
    state.slips = [{ netPayable: D(500) }];
    state.invoices = [invoice({ payments: [payment('p1', 1100, '2026-02-01')] })];
    const report = await detailedExpensesReport(actor, query);
    expect(report.totals.amount).toBe(250);
    expect(report.liabilities).toEqual({ unpaidSalaries: 300, unpaidCommissions: 50 });
    expect(report.rows).toHaveLength(2);
  });
  it('preserves historical salary disbursement and dates its later reversal', async () => {
    state.salary = [payout('sal', 200, '2026-01-05', { status: 'REVERSED', reversedAt: new Date('2026-02-05T08:00:00Z') })];
    expect((await detailedExpensesReport(actor, query)).totals.amount).toBe(-200);
    expect(payoutEvents(state.salary).map(p => p.signedAmount.toNumber())).toEqual([200, -200]);
  });
  it('keeps an original expense in its period after reversal and applies filters to totals', async () => {
    state.expenses = [{ id: 'e1', voucherNumber: 'EXP-1', branchId: 'b1', expenseDate: day('2026-01-01'), amount: D(100),
      status: 'REVERSED', isReversalRecord: false, category: 'Rent', paymentSource: 'CASH_DRAWER' },
    { id: 'e2', voucherNumber: 'REV-1', branchId: 'b1', expenseDate: day('2026-02-01'), amount: D(100),
      status: 'REVERSED', isReversalRecord: true, category: 'Rent', paymentSource: 'CASH_DRAWER' }];
    expect((await detailedExpensesReport(actor, { from: '2026-01-01', to: '2026-01-31' })).totals.amount).toBe(100);
    expect((await detailedExpensesReport(actor, query)).totals.amount).toBe(-100);
    expect((await detailedExpensesReport(actor, { ...query, search: 'missing' })).totals.amount).toBe(0);
  });
  it('commission report derives earned commission from real collections and preserves payout reversal dates', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-01-01'), payment('p2', 550, '2026-02-01')] })];
    state.commission = [payout('com', 30, '2026-01-05', { status: 'REVERSED', reversedAt: new Date('2026-02-02T08:00:00Z') })];
    const r = await staffCommissionReport(actor, { startDate: query.from, endDate: query.to });
    expect(r.totals).toMatchObject({ openingLiability: 20, earned: 50, reversed: 0, paid: -30, outstanding: 100 });
  });
  it('performance distinguishes invoice-period sales from later collections', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-02-01')] })];
    const [r] = await staffPerformance(actor, { startDate: query.from, endDate: query.to });
    expect(r).toMatchObject({ invoicedSales: 0, collectedSales: 500, estimatedCommission: 50 });
  });
  it('applies staff/source/tender filters to income rows and KPIs together', async () => {
    state.invoices = [invoice({ lines: [line({ components: [{ id: 'c1', staffId: 's1', allocatedAmount: D(500), staffCommissionRate: D(10) },
      { id: 'c2', staffId: 's2', allocatedAmount: D(500), staffCommissionRate: D(10) }] })], payments: [payment('p1', 550, '2026-02-01')] })];
    const r = await detailedIncomeReport(actor, { ...query, staffId: 's2', sourceType: 'SERVICE', paymentMethod: 'CASH' });
    expect(r.kpis).toMatchObject({ recognizedNetRevenue: 250, totalTaxCharged: 25, totalPaid: 275 });
    expect((await detailedIncomeReport(actor, { ...query, sourceType: 'PRODUCT' })).kpis.totalPaid).toBe(0);
  });
  it('allows Super Admin explicit/all branches while branch admins remain scoped', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-02-01')] }), invoice({ id: 'i2', branchId: 'b2', payments: [payment('p2', 1100, '2026-02-01')] })];
    const superAdmin = { ...actor, role: 'SUPER_ADMIN' };
    expect((await detailedIncomeReport(superAdmin, { ...query, branchId: 'b2' })).kpis.recognizedNetRevenue).toBe(1000);
    expect((await detailedIncomeReport(superAdmin, { ...query, branchId: 'ALL' })).kpis.recognizedNetRevenue).toBe(1500);
  });
  it('dashboard collection revenue and surplus exclude tax, tips and unpaid liabilities', async () => {
    state.invoices = [invoice({ payments: [payment('p1', 550, '2026-02-01', { amount: D(570), tipAmountAllocated: D(20) })] })];
    state.salary = [payout('sal', 100, '2026-02-01')];
    state.commission = [payout('com', 20, '2026-02-01')];
    const r = await computeBranchMetrics(['b1'], '2026-02-01', { id: 'b1', name: 'Branch', code: 'B1' });
    expect(r).toMatchObject({ collectedRevenue: 500, taxCollected: 50, tipsCollected: 20, actualCollections: 570,
      totalExpensesPaid: 120, netOperatingCashFlow: 380 });
    expect(db.payslip.findMany).not.toHaveBeenCalled();
  });
});
