import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(new URL('../../frontend/package.json', import.meta.url))('esbuild');
const { db, state } = vi.hoisted(() => ({
  db: Object.fromEntries(['branch','staff','user','invoice','invoiceRefund','invoicePayment','expense','expenseCategory',
    'payrollRun','payrollPayment','commissionPayment','commissionEvent','stockMovement','invoiceLine','drawerMovement',
    'accountMovement','bookingHistory','salaryAdvance','tipReceipt','payslip','cashDrawer','paymentAccount'].map(name =>
    [name, Object.fromEntries(['findMany','findUnique','aggregate','groupBy'].map(method => [method, vi.fn()]))])),
  state: { invoices: [], runs: [] },
}));
vi.mock('../src/config/prisma.js', () => ({ default: db }));
import { incomeExpenseReport, detailedExpensesReport, computePeriodMetrics, cashDrawerReport } from '../src/modules/reports/reports.service.js';
import { staffSalaryReport } from '../src/modules/reports/staffPay.report.js';
import { recognizedSalaryExpense } from '../src/modules/reports/salaryRecognition.js';
import { startOfDay, endOfDay } from '../src/lib/dates.js';
import { evaluateEmployeePayroll, getDatesInRange } from '../src/lib/calculations/payrollCalculations.js';
import { incomeExpenseCollectionSummary, incomeExpenseCashFlow, incomeExpenseCashText, incomeExpenseInvoiceTotal, isCustomerInvoiceEntry,
  incomeExpenseEntryType, invoiceEventDetails } from '../../frontend/src/features/reports/incomeExpenseDisplay.ts';

const actor = { id: 'admin', name: 'Admin', role: 'ADMIN', branchId: 'b1' };
const query = { from: '2026-11-01', to: '2026-11-30' };
const day = d => new Date(`${d}T12:00:00+05:00`);
const pay = (id, amount, date, more = {}) => ({ id, paymentNumber: id, amount, paidAt: day(date), status: 'COMPLETED',
  staffId: 's1', staffName: 'Stylist', branchId: 'b1', method: 'CASH', paidByName: 'Admin', ...more });
const slip = (id, netPayable, payments = [], extra = {}) => ({ id, payslipNumber: id, staffId: 's1', netPayable, grossPayable: netPayable,
  payments, snapshot: { staffName: 'Stylist', employeeCode: 'S1', designation: 'Stylist' }, ...extra });
const run = (payslips, date = '2026-11-01', extra = {}) => ({ id: 'r1', payrollNumber: 'RUN-1', branchId: 'b1', month: date.slice(0,7),
  status: 'PARTIALLY_PAID', finalizedAt: day(date), generatedAt: day(date), payslips, ...extra });
const sale = { id: 'i1', invoiceNumber: 'INV-1', date: day('2026-11-02'), branchId: 'b1', netSales: 1000, tax: 100, total: 1100, amountDue: 0,
  lines: [{ id: 'l1', type: 'SERVICE', netSales: 1000, tax: 100, components: [] }], refunds: [],
  payments: [{ id: 'pos1', kind: 'POS', billAmountAllocated: 1100, amount: 1100, date: day('2026-11-02'), createdAt: day('2026-11-02') }] };
const inRange = (date, range) => !range || ((!range.gte || date >= range.gte) && (!range.lte || date <= range.lte));
beforeEach(() => {
  vi.clearAllMocks(); state.invoices = [sale]; state.runs = [run([slip('s1',30000,[pay('SAL-1',1000,'2026-11-03')])])];
  for (const model of Object.values(db)) { model.findMany.mockResolvedValue([]); model.aggregate.mockResolvedValue({ _sum: {} }); model.groupBy.mockResolvedValue([]); }
  db.branch.findUnique.mockResolvedValue({ name: 'Branch' }); db.branch.findMany.mockResolvedValue([{ id:'b1',name:'Branch' }]);
  db.invoice.findMany.mockImplementation(async ({where}) => state.invoices.filter(i => inRange(i.date, where.date)));
  db.payrollRun.findMany.mockImplementation(async ({where}) => state.runs.filter(r => !['DRAFT','CANCELLED'].includes(r.status) &&
    (inRange(r.finalizedAt,where.OR?.[0]?.finalizedAt) || (where.OR?.length > 2 && r.payslips.some(s => s.payments.some(p => inRange(p.paidAt,where.OR[0].finalizedAt)))))));
  db.payslip.findMany.mockImplementation(async () => state.runs.filter(r => !['DRAFT','CANCELLED'].includes(r.status)).flatMap(r => r.payslips.map(s => ({ ...s, run:r }))));
  db.payrollPayment.findMany.mockImplementation(async ({where}) => state.runs.flatMap(r => r.payslips.flatMap(s => s.payments)).filter(p =>
    inRange(p.paidAt,where.paidAt) && (typeof where.status !== 'string' || p.status === where.status)));
});
const metrics = async (q = query) => computePeriodMetrics('b1',q.from,q.to,startOfDay(q.from),endOfDay(q.to));

describe('Targeted salary ledger reconciliation', () => {
  const refundedSales = (refundDate = '2026-11-04', amount = 1000) => {
    state.runs = [];
    state.invoices = [1,2,3].map(id => ({...sale,id:`i${id}`,invoiceNumber:`INV-${id}`,tax:0,total:1000,
      lines:[{...sale.lines[0],id:`l${id}`,tax:0,staffId:'s1',staffCommissionRate:10}],
      payments:[{...sale.payments[0],id:`p${id}`,billAmountAllocated:1000,amount:1000}]}));
    const refund = {id:'refund1',refundNumber:'REF-1',refundDate:day(refundDate),netReversed:amount,taxReversed:0,
      tipReversed:0,cashOut:amount,type:'REFUND',method:'CASH',lines:[{lineId:'l1',net:amount,tax:0,quantity:amount/1000}]};
    state.invoices[0].refunds=[refund];
    db.invoiceRefund.findMany.mockImplementation(async ({where}) => inRange(refund.refundDate,where.refundDate)
      ? [{...refund,invoice:state.invoices[0]}] : []);
    db.commissionPayment.findMany.mockResolvedValue([pay('COM-1',300,'2026-11-03')]);
  };
  it('groups three sales and one refund into three invoices without changing paid commission cash', async () => {
    refundedSales();
    const report=await incomeExpenseReport(actor,query);
    expect(report.rows.filter(r=>r.type==='INCOME')).toHaveLength(4);
    expect(report.displayRows.filter(r=>r.type==='INCOME')).toHaveLength(3);
    expect(report.totals).toMatchObject({customerInvoiceTotal:3000,customerCollections:2000,income:2000,expense:300,netCashMovement:1700});
    expect(report.displayRows.find(r=>r.invoiceId==='i1')).toMatchObject({totalBill:1000,refundAmount:1000,collectionAmount:0,status:'REFUNDED'});
    expect(incomeExpenseCollectionSummary(report.totals.income,report.rows).surplus).toBe(1700);
  });
  it('keeps later refunds in their actual month and keeps original dates as reference only', async () => {
    refundedSales('2026-12-04');
    const november=await incomeExpenseReport(actor,query);
    expect(november.totals.customerCollections).toBe(3000);
    expect(november.displayRows.find(r=>r.invoiceId==='i1')).toMatchObject({status:'PAID',refundHistory:[]});
    db.commissionPayment.findMany.mockResolvedValue([]);
    const december=await incomeExpenseReport(actor,{from:'2026-12-01',to:'2026-12-31'});
    expect(december.totals.customerCollections).toBe(-1000);
    expect(december.displayRows).toHaveLength(1);
    expect(december.displayRows[0]).toMatchObject({date:'2026-11-02',totalBill:1000,collectionAmount:-1000,status:'REFUNDED'});
    expect(invoiceEventDetails(december.displayRows[0])).toContain('2026-12-04');
  });
  it('keeps partial refunds inside the original invoice row', async () => {
    refundedSales('2026-11-04',400);
    const report=await incomeExpenseReport(actor,query);
    expect(report.displayRows.find(r=>r.invoiceId==='i1')).toMatchObject({totalBill:1000,refundAmount:400,collectionAmount:600,status:'PARTIALLY_REFUNDED'});
    expect(report.totals.customerCollections).toBe(2600);
  });
  it.each(['handleExportExcel','handleExportCsv','handleExportPdf'])('%s exports one invoice row with dated refunds and unchanged totals', async handler => {
    refundedSales();
    const reportData=await incomeExpenseReport(actor,query);
    const source=readFileSync(new URL('../../frontend/src/features/reports/IncomeExpenseReportPage.tsx',import.meta.url),'utf8');
    const start=source.indexOf('  const '+handler+' ='), end=source.indexOf('\n  const handle',start+1);
    const captures=[];
    const context={reportData,customerCollections:2000,totalBillSum:3000,signedPaid:1700,nonOperatingCashOutflows:0,
      selectedBranch:'b1',fromDate:query.from,toDate:query.to,formatPKR:n=>Number(n).toFixed(2),formatDateDisplay:d=>d,formatMethod:m=>m,
      incomeExpenseCollectionSummary,isCustomerInvoiceEntry,incomeExpenseEntryType,incomeExpenseCashText,invoiceEventDetails,
      downloadReportExcel:(_name,meta,sections)=>captures.push({meta,...sections[0]}),
      downloadReportCsv:(_name,meta,sections)=>captures.push({meta,...sections[0]}),printReportWindow:value=>captures.push(value)};
    const code=transformSync(source.slice(start,end)+'\n'+handler+'();',{loader:'ts',target:'es2022'}).code;
    new Function(...Object.keys(context),code)(...Object.values(context));
    const exported=captures[0], invoices=exported.rows.filter(r=>String(r[1]).startsWith('INV-'));
    expect(invoices).toHaveLength(3);
    const refunded=invoices.find(r=>r[1]==='INV-1');
    expect(refunded[2]).toContain('REF-1 2026-11-04');
    expect(refunded[2]).toContain('Period net collection: 0.00');
    expect(refunded[11]).toBe('REFUNDED');
    const total=exported.totals||exported.rows.at(-1);
    expect(Number(total[7])).toBe(3000);expect(Number(total[9])).toBe(2000);
  });
  it('preserves the approved partial salary example across ledger, expenses, salary, P&L and cash drawer', async () => {
    const ledger = await incomeExpenseReport(actor,query);
    expect(ledger.totals).toMatchObject({ customerCollections:1100, customerInvoiceTotal:1100, income:1000, expense:1000,
      netCashMovement:100, reportedExpenseRecognition:30000, accruedSalaryExpenses:30000 });
    const salary = ledger.rows.find(r => r.type === 'SALARY_EXPENSE');
    expect(salary).toMatchObject({ reference:'SAL-1', userOrPayee:'Stylist', paymentMethod:'CASH', status:'PARTIALLY_PAID' });
    expect(isCustomerInvoiceEntry(salary)).toBe(false); expect(incomeExpenseEntryType(salary)).toBe('Salary');
    expect(incomeExpenseCashFlow(salary)).toBe(-1000);
    expect(incomeExpenseCollectionSummary(ledger.totals.income,ledger.rows)).toEqual({ paidOperatingExpenses:1000, surplus:0 });
    expect((await detailedExpensesReport(actor,query)).kpis).toMatchObject({ paidSalaries:1000, totalExpenses:1000, unpaidSalaries:29000 });
    expect((await staffSalaryReport(actor,{month:'2026-11'})).rows[0]).toMatchObject({ net:30000, paid:1000, outstanding:29000, status:'PARTIALLY_PAID' });
    expect(await metrics()).toMatchObject({ salaryExpenses:30000, paidSalaryExpenses:1000, netOperatingProfit:-29000, collectionCashSurplus:0 });
    db.cashDrawer.findMany.mockResolvedValue([{ id:'d1',branchId:'b1',date:day('2026-11-01'),createdAt:day('2026-11-01'),status:'OPEN',settlements:[],movements:[
      {id:'in',createdAt:day('2026-11-02'),direction:'IN',type:'CASH_SALE',amount:1100},
      {id:'out',createdAt:day('2026-11-03'),direction:'OUT',type:'PAYROLL_PAYOUT',amount:1000},
    ] }]);
    const drawer = await cashDrawerReport(actor,query);
    expect(drawer.transactions.reduce((sum,r) => sum+r.cashIn-r.cashOut,0)).toBe(100);
  });
  it('full settlement adds only the remaining cash payout and recognizes salary once', async () => {
    state.runs[0].status='PAID'; state.runs[0].payslips[0].payments.push(pay('SAL-2',29000,'2026-11-05',{method:'ONLINE'}));
    const report = await incomeExpenseReport(actor,query);
    expect(report.rows.filter(r => r.type==='SALARY_EXPENSE')).toHaveLength(2);
    expect(report.rows.find(r => r.reference==='SAL-2')).toMatchObject({ paymentMethod:'ONLINE',status:'PAID' });
    expect(report.totals).toMatchObject({ customerInvoiceTotal:1100,customerCollections:1100,expense:30000,reportedExpenseRecognition:30000,netCashMovement:-28900 });
    expect((await detailedExpensesReport(actor,query)).kpis.paidSalaries).toBe(30000);
    expect(await metrics()).toMatchObject({salaryExpenses:30000,paidSalaryExpenses:30000});
  });
  it('later-period settlement is cash expense without recognizing the previous salary again', async () => {
    state.runs[0].payslips[0].payments.push(pay('SAL-2',29000,'2026-12-05'));
    const dec = {from:'2026-12-01',to:'2026-12-31'};
    const november = await incomeExpenseReport(actor,query);
    expect(november.rows.find(r => r.type==='SALARY_EXPENSE').status).toBe('PARTIALLY_PAID');
    const december = await incomeExpenseReport(actor,dec);
    expect(december.totals).toMatchObject({expense:29000,accruedSalaryExpenses:0,reportedExpenseRecognition:0,netCashMovement:-29000});
    expect(await metrics(dec)).toMatchObject({salaryExpenses:0,paidSalaryExpenses:29000});
  });
  it('does not infer a cash payout from a paid run status or legacy paidAmount', async () => {
    state.runs=[run([slip('s1',30000,[],{paidAmount:30000})],undefined,{status:'PAID'})];
    const report=await incomeExpenseReport(actor,query);
    expect(report.rows.filter(r=>r.type==='SALARY_EXPENSE')).toHaveLength(0);
    expect(report.totals).toMatchObject({netCashMovement:1100,accruedSalaryExpenses:30000,expense:0});
  });
  it('uses finalization date once, never recognizing the earlier draft-generation month again', async () => {
    state.runs[0].generatedAt=day('2026-10-31');
    const report=await incomeExpenseReport(actor,query);
    expect(report.totals.accruedSalaryExpenses).toBe(30000);
    expect(db.payrollRun.findMany.mock.calls.at(-1)[0].where.OR[1]).toMatchObject({finalizedAt:null});
    await metrics();
    expect(db.payrollRun.findMany.mock.calls.at(-1)[0].where.OR[1]).toMatchObject({finalizedAt:null});
    const oct={from:'2026-10-01',to:'2026-10-31'};
    expect((await incomeExpenseReport(actor,oct)).totals.accruedSalaryExpenses).toBe(0);
    expect((await metrics(oct)).salaryExpenses).toBe(0);
  });
  it('keeps loan recovery out of cash salary and in earned salary recognition', async () => {
    state.runs=[run([slip('s1',28000,[pay('SAL-1',1000,'2026-11-03')],{snapshot:{staffName:'Stylist',advanceRecoveryAmount:2000}})])];
    expect((await incomeExpenseReport(actor,query)).totals).toMatchObject({expense:1000,accruedSalaryExpenses:30000});
    expect(await metrics()).toMatchObject({salaryExpenses:30000,paidSalaryExpenses:1000});
  });
  it('repeated monthly generation preserves previous custom-payroll reconciliation', async () => {
    const staff={id:'s1',name:'Stylist',branchId:'b1',compensationType:'MONTHLY_SALARY',baseSalary:30000,joiningDate:'2026-01-01'};
    const attendance=getDatesInRange('2026-11-01','2026-11-30').map(date=>({staffId:'s1',date,status:'PRESENT'}));
    const extras={alreadyPaidSalary:1000,alreadyFinalizedNet:1000};
    const policy={monthlyAbsenceDivisor:30,prorationMethod:'CALENDAR_DAYS'};
    const generate=()=>evaluateEmployeePayroll(staff,'2026-11',policy,attendance,[],[],{},extras).payslip;
    const first=generate(), again=generate();
    expect(again.netPayable).toBe(first.netPayable);
    state.runs=[run([slip('custom',1000,[pay('SAL-1',1000,'2026-11-03')]),slip('monthly',first.netPayable,[],{snapshot:first})])];
    const report=await incomeExpenseReport(actor,query);
    expect(report.totals.accruedSalaryExpenses).toBe(30000);
    expect(recognizedSalaryExpense(state.runs[0].payslips[1]).toNumber()).toBe(29000);
    expect((await incomeExpenseReport(actor,query)).totals).toEqual(report.totals);
    state.runs.push(run([slip('draft',30000)],undefined,{status:'DRAFT'}));
    expect((await incomeExpenseReport(actor,query)).totals.accruedSalaryExpenses).toBe(30000);
  });
  it('counts the same customer invoice once when original sale and later dues both appear', async () => {
    state.invoices=[{...sale,payments:[{...sale.payments[0],billAmountAllocated:550}],amountDue:550}];
    db.invoicePayment.findMany.mockResolvedValue([{id:'dues',invoice:state.invoices[0],date:day('2026-11-05'),branchId:'b1',billAmountAllocated:550}]);
    const report=await incomeExpenseReport(actor,query);
    expect(report.totals).toMatchObject({customerInvoiceTotal:1100,customerCollections:1100});
    expect(incomeExpenseInvoiceTotal(report.rows)).toBe(1100);
  });
  it.each(['SALARY_EXPENSE','COMMISSION_EXPENSE','OPERATING_EXPENSE','SETTLEMENT'])('invoice fields are not applicable to %s rows', type => {
    const row={type,source:type==='SETTLEMENT'?'Staff Loan':'Expense',reference:'PAY-1',expense:1000,paid:1000};
    expect(isCustomerInvoiceEntry(row)).toBe(false); expect(incomeExpenseInvoiceTotal([row])).toBe(0);
    expect(incomeExpenseCashFlow(row)).toBe(-1000);
  });
  it.each(['handleExportExcel','handleExportCsv','handleExportPdf'])('%s preserves non-invoice placeholders, Partial status and reconciled totals', async handler => {
    const reportData=await incomeExpenseReport(actor,query);
    const source=readFileSync(new URL('../../frontend/src/features/reports/IncomeExpenseReportPage.tsx',import.meta.url),'utf8');
    const start=source.indexOf('  const '+handler+' =');
    const end=source.indexOf('\n  const handle',start+1);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const captures=[];
    const context={ reportData, customerCollections:reportData.totals.customerCollections, totalBillSum:reportData.totals.customerInvoiceTotal,
      signedPaid:reportData.totals.netCashMovement, nonOperatingCashOutflows:0, selectedBranch:'b1', fromDate:query.from, toDate:query.to,
      formatPKR:n=>Number(n).toFixed(2), formatDateDisplay:d=>d,formatMethod:m=>m,
      incomeExpenseCollectionSummary,isCustomerInvoiceEntry,incomeExpenseEntryType,incomeExpenseCashText,invoiceEventDetails,
      downloadReportExcel:(_name,meta,sections)=>captures.push({meta,...sections[0]}),
      downloadReportCsv:(_name,meta,sections)=>captures.push({meta,...sections[0]}),
      printReportWindow:value=>captures.push(value),
    };
    const code=transformSync(source.slice(start,end)+'\n'+handler+'();',{loader:'ts',target:'es2022'}).code;
    new Function(...Object.keys(context),code)(...Object.values(context));
    const exported=captures[0], salary=exported.rows.find(r=>r[3]==='Salary');
    expect(salary).toHaveLength(exported.headers.length);
    for(const index of [5,6,7,8,10]) expect(salary[index]).toBe('\u2014');
    expect(salary[9]).toBe('-1000.00'); expect(salary[11]).toBe('PARTIALLY_PAID');
    const total=exported.totals || exported.rows.at(-1);
    expect(total).toHaveLength(exported.headers.length);
    expect(Number(total[7])).toBe(1100); expect(Number(total[9])).toBe(1100);
    expect(exported.meta.find(([name])=>name==='Net Cash Movement')[1]).toBe('100.00');
    expect(exported.meta.find(([name])=>name.startsWith('Reported Expense Recognition'))[1]).toBe('30000.00');
  });
});
