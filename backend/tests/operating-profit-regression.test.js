import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
  const db = {};
  for (const name of ['branch', 'staff', 'user', 'invoice', 'invoiceRefund', 'invoicePayment', 'stockMovement', 'expense', 'payrollRun', 'commissionEvent', 'drawerMovement', 'accountMovement', 'salaryAdvance', 'bookingHistory', 'tipReceipt']) {
    db[name] = { findMany: vi.fn(), findUnique: vi.fn() };
  }
  db.payrollPayment = { findMany: vi.fn(() => { throw new Error('Payouts must not be recognized again'); }) };
  db.commissionPayment = { findMany: vi.fn(() => { throw new Error('Payouts must not be recognized again'); }) };
  return { db };
});
vi.mock('../src/config/prisma.js', () => ({ default: db }));
import { operatingProfitReport, incomeExpenseReport } from '../src/modules/reports/reports.service.js';
import { downloadReportCsv, formatSignedPKR, printReportWindow } from '../../frontend/src/features/reports/reportUtils.ts';

const query = { preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-31' };
const actor = { role: 'ADMIN', branchId: 'branch-1', name: 'Admin' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) model.findMany.mockResolvedValue([]);
  db.branch.findUnique.mockResolvedValue({ name: 'Test Branch' });
  const current = (args) => {
    const range = args.where?.date || args.where?.finalizedAt || args.where?.eventDate || args.where?.expenseDate || args.where?.OR?.[0]?.date || args.where?.OR?.[0]?.finalizedAt || args.where?.month;
    return range?.gte >= new Date('2026-09-30T19:00:00Z');
  };
  // Accounting commission uses the original service attribution/rate, independent of receipts.
  db.invoice.findMany.mockImplementation(async args => current(args) ? [{
    id: 'invoice-accrual', date: new Date('2026-10-15'), netSales: 1000, tax: 0,
    lines: [{ id: 'service-accrual', type: 'SERVICE', netSales: 1000, tax: 0,
      staffId: 'staff', commissionRate: 10, components: [] }], refunds: [],
  }] : []);
  db.expense.findMany.mockImplementation(async args => current(args) ? [{ category: 'General', amount: 100 }] : []);
  db.payrollRun.findMany.mockImplementation(async args => current(args) ? [{ payslips: [{ netPayable: 2000, grossPayable: 2200, snapshot: { commissionPayable: 100 }, paidAmount: 2100 }] }] : []);
  db.commissionEvent.findMany.mockImplementation(async args => current(args) ? [{ type: 'EARN', amount: 100 }] : []);
});

describe('Signed report exports', () => {
  it('formats positive and negative amounts without discarding signs', () => {
    expect(formatSignedPKR(-1200)).toBe('-1,200.00');
    expect(formatSignedPKR(1200)).toBe('1,200.00');
  });

  it('preserves negative profit and margin in CSV', async () => {
    let blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value; return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchor = { click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    downloadReportCsv('profit', [], [{ headers: ['Profit', 'Margin'], rows: [[(-1200).toFixed(2), '-120%']] }]);
    expect(await blob.text()).toContain('-1200.00,-120%');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves signed detail values and totals in Print / Save as PDF', () => {
    const write = vi.fn();
    vi.stubGlobal('window', { open: () => ({ document: { write, close: vi.fn() } }) });
    printReportWindow({ title: 'Operating Profit', headers: ['Profit', 'Margin'], rows: [['-1200.00', '-120%']], totals: [formatSignedPKR(-1200), '-120%'] });
    const html = write.mock.calls[0][0];
    expect(html).toContain('-1200.00');
    expect(html).toContain('-1,200.00');
    expect(html).toContain('-120%');
    vi.unstubAllGlobals();
  });
});

describe('Operating Profit recognition', () => {
  it.each([['CASH', 'drawerMovement'], ['ONLINE_ACCOUNT', 'accountMovement']])('reconciles partial invoice and dues collection via %s once', async (method, model) => {
    for (const table of Object.values(db)) table.findMany.mockResolvedValue([]);
    db.invoice.findMany.mockResolvedValue([{
      id: 'partial', invoiceNumber: 'INV-0002', date: new Date('2026-10-01'),
      branchId: actor.branchId, netSales: 1000, tax: 0, subtotal: 1000, discount: 0,
      amountDue: 0, status: 'PARTIAL', paymentMethod: method,
      payments: [{ id:'p1', date:new Date('2026-10-01'), kind: 'POS', billAmountAllocated: 400 }, { id:'p2', date:new Date('2026-10-15'), kind: 'DUES_COLLECTION', billAmountAllocated: 600 }],
    }]);
    db[model].findMany.mockResolvedValue([{
      id: 'collection', createdAt: new Date('2026-10-15'), branchId: actor.branchId,
      sourceModule: 'POS', type: 'DUES_COLLECTION', direction: 'IN', amount: 600,
    }]);
    const report = await incomeExpenseReport(actor, query);
    expect(report.rows.find(r => r.reference === 'INV-0002')).toMatchObject({ income: 400, paid: 400, remaining: 0, status: 'PARTIAL', collectionAmount: 400 });
    expect(report.rows.find(r => r.id === 'collection')).toMatchObject({ income: 0, expense: 0, cashFlow: 600, paymentEventType: 'DUES_COLLECTION', status: 'POSTED' });
    expect(report.totals).toMatchObject({ income: 400, paid: 1000, collections: 1000, remaining: 0, net: 400 });
    expect(db.invoice.findMany.mock.calls[0][0].select.payments.where).toEqual({ reversedAt: null });
  });

  it('keeps stored salary intact in Income & Expense when commission is reported separately', async () => {
    db.invoice.findMany.mockResolvedValue([]);
    db.expense.findMany.mockResolvedValue([]);
    db.payrollRun.findMany.mockResolvedValue([{ branchId: actor.branchId, month: '2026-10', finalizedAt: new Date('2026-10-15'), payslips: [{ id: 'slip', staffId: 'staff', netPayable: 2000, snapshot: { commissionPayable: 100 } }] }]);
    db.commissionEvent.findMany.mockResolvedValue([{ id: 'commission', branchId: actor.branchId, eventDate: new Date('2026-10-15'), type: 'EARN', amount: 100 }]);
    const report = await incomeExpenseReport(actor, { ...query, includeCommission: 'true' });
    expect(report.kpis.salaryExpenses).toBe(2000);
    expect(report.kpis.commissionExpenses).toBe(100);
    expect(report.kpis.totalOperatingExpenses).toBe(2100);
  });

  it('reports a signed 1,200 loss and -120% margin without adding combined commission twice', async () => {
    const report = await operatingProfitReport(actor, query);
    expect(report.kpis.salaryExpenses).toBe(2000);
    expect(report.kpis.commissionExpenses).toBe(100);
    expect(report.totals.netProfit).toBe(-1200);
    expect(report.kpis.operatingMarginPercent).toBe(-120);
    expect(report.statementRows.find(r => r.isFinalNet).currentAmount).toBe(-1200);


    expect(db.payrollRun.findMany.mock.calls[0][0].where.status).toEqual({ in: ['FINALIZED', 'PARTIALLY_PAID', 'PAID'] });
  });

  it('preserves zero salary and does not fall back to gross salary', async () => {
    db.payrollRun.findMany.mockResolvedValue([{ payslips: [{ netPayable: 0, grossPayable: 2000 }] }]);
    const report = await operatingProfitReport(actor, query);
    expect(report.kpis.salaryExpenses).toBe(0);
    expect(report.totals.netProfit).toBe(800);
    expect(report.kpis.operatingMarginPercent).toBe(80);
  });
});
