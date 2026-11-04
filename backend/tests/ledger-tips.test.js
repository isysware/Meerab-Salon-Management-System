import { beforeEach, describe, expect, it, vi } from 'vitest';
const { db } = vi.hoisted(() => ({ db: Object.fromEntries([
  'branch', 'staff', 'user', 'invoice', 'invoiceRefund', 'invoicePayment', 'expense', 'payrollRun',
  'commissionEvent', 'stockMovement', 'drawerMovement', 'accountMovement', 'salaryAdvance', 'bookingHistory', 'tipReceipt',
].map(name => [name, { findMany: vi.fn(), findUnique: vi.fn() }])) }));
vi.mock('../src/config/prisma.js', () => ({ default: db }));
import { incomeExpenseReport } from '../src/modules/reports/reports.service.js';
import { incomeExpenseCashFlow, incomeExpenseCollectionSummary } from '../../frontend/src/features/reports/incomeExpenseDisplay.ts';
import { allocatePaymentToInvoice } from '../src/lib/calculations/collectionAllocation.js';
const actor = { id: 'admin', role: 'ADMIN', branchId: 'b1' };
const query = { from: '2026-11-01', to: '2026-11-30' };
const payment = { id: 'p1', kind: 'POS', billAmountAllocated: 550, date: new Date('2026-11-02') };
const invoice = { id: 'i1', invoiceNumber: 'INV-1', date: new Date('2026-11-02'), branchId: 'b1',
  subtotal: 1000, discount: 0, netSales: 1000, tax: 100, tip: 100, total: 1200, amountDue: 550,
  status: 'PARTIAL', payments: [payment],
  lines: [{ type: 'SERVICE', netSales: 1000, tax: 100, staffId: 's1', staffCommissionRate: 10 }] };
beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) model.findMany.mockResolvedValue([]);
  db.branch.findUnique.mockResolvedValue({ name: 'Branch' });
  db.invoice.findMany.mockResolvedValue([invoice]);
  db.tipReceipt.findMany.mockResolvedValue([{ paymentId: 'p1', collectedAmount: 100 }]);
});
describe('Income & Expense collected tips', () => {
  it('keeps bill 1,100 and revenue 500 separate from tip 100 and gross receipt 650', async () => {
    const report = await incomeExpenseReport(actor, query);
    expect(report.rows[0]).toMatchObject({ totalBill: 1100, tipAmount: 100, totalReceived: 650,
      income: 500, collectedTax: 50, paid: 650, collectionAmount: 650, remaining: 550 });
    expect(report.totals).toMatchObject({ income: 500, collectedTax: 50, tipAmount: 100, collections: 650, paid: 650, net: 500 });
    expect(incomeExpenseCashFlow(report.rows[0])).toBe(650);
    expect(incomeExpenseCollectionSummary(report.totals.income, report.rows).surplus).toBe(500);
    expect(allocatePaymentToInvoice({ invoice, paymentAmount: 550 }).totalEarnedCommission.toNumber()).toBe(50);
    expect(db.tipReceipt.findMany.mock.calls[0][0].where).toMatchObject({ branchId: 'b1', paymentId: { in: ['p1'] } });
  });
  it('shows zero if Tip Management has no receipt, even if invoice has a tip target', async () => {
    db.tipReceipt.findMany.mockResolvedValue([]);
    const report = await incomeExpenseReport(actor, query);
    expect(report.rows[0]).toMatchObject({ tipAmount: 0, totalReceived: 550, totalBill: 1100 });
    expect(report.totals.tipAmount).toBe(0);
  });
  it('combines split-tender tip receipts once without multiplying by service or staff rows', async () => {
    db.invoice.findMany.mockResolvedValue([{ ...invoice, payments: [{ ...payment, billAmountAllocated: 300 }, { ...payment, id: 'p2', billAmountAllocated: 250 }] }]);
    db.tipReceipt.findMany.mockResolvedValue([{ paymentId: 'p1', collectedAmount: 40 }, { paymentId: 'p2', collectedAmount: 60 }]);
    expect((await incomeExpenseReport(actor, query)).rows[0]).toMatchObject({ tipAmount: 100, totalReceived: 650 });
  });
  it('does not repeat the original tip on later dues collection', async () => {
    db.invoicePayment.findMany.mockResolvedValue([{ id: 'dues1', invoice, branchId: 'b1', date: new Date('2026-11-03'), billAmountAllocated: 550 }]);
    const report = await incomeExpenseReport(actor, query);
    expect(report.rows.find(r => r.id === 'due-dues1')).toMatchObject({ tipAmount: 0, totalReceived: 550 });
    expect(report.totals).toMatchObject({ tipAmount: 100, collections: 1200, income: 1000 });
  });
  it('shows canonical refunded tips with a negative sign without subtracting them from gross cash twice', async () => {
    db.invoice.findMany.mockResolvedValue([]);
    db.invoiceRefund.findMany.mockResolvedValue([{ id: 'rf', refundDate: new Date('2026-11-03'),
      netReversed: 0, taxReversed: 0, tipReversed: 100, cashOut: 100, invoice: { id: 'i1', branchId: 'b1' } }]);
    const report = await incomeExpenseReport(actor, query);
    expect(report.rows[0]).toMatchObject({ tipAmount: -100, totalReceived: -100, income: -0, totalBill: -0 });
    expect(report.totals).toMatchObject({ tipAmount: -100, collections: -100, income: 0, net: 0 });
  });
  it('filters tip totals with the displayed ledger rows', async () => {
    expect((await incomeExpenseReport(actor, { ...query, search: 'missing' })).totals.tipAmount).toBe(0);
  });
  it('retains accountant invoice scoping and only requests receipts for authorized payment ids', async () => {
    await incomeExpenseReport({ ...actor, role: 'ACCOUNTANT' }, query);
    expect(db.invoice.findMany.mock.calls[0][0].where.processedByUserId).toBe(actor.id);
    expect(db.tipReceipt.findMany.mock.calls[0][0].where.paymentId).toEqual({ in: ['p1'] });
  });
});
