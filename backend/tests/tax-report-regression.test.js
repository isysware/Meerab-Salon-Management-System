import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, data } = vi.hoisted(() => ({
  db: { branch: { findMany: vi.fn(), findUnique: vi.fn() }, invoice: { findMany: vi.fn() }, invoiceRefund: { findMany: vi.fn() } },
  data: { invoices: [], refunds: [] },
}));
vi.mock('../src/config/prisma.js', () => ({ default: db }));
import { taxReport } from '../src/modules/reports/reports.service.js';

const actor = { role: 'ADMIN', branchId: 'b1', name: 'Admin' };
const query = { from: '2026-10-01', to: '2026-10-31' };
const day = value => new Date(`${value}T00:00:00Z`);
const sale = (overrides = {}) => ({
  id: 'i1', invoiceNumber: 'INV-001', date: day('2026-10-10'), time: '10:00',
  branchId: 'b1', processedByUserId: 'cashier1', clientName: 'Client', paymentMethod: 'CASH',
  status: 'PAID', lifecycle: 'ACTIVE', tax: 1000,
  lines: [{ id: 'l1', type: 'SERVICE', name: 'Facial', staffName: 'Stylist', quantity: 2,
    unitPrice: 5000, discountAllocated: 0, netSales: 10000, taxRate: 0.1, tax: 1000 }],
  ...overrides,
});
const reverse = (invoice, overrides = {}) => ({
  id: 'r1', refundNumber: 'RFD-001', refundDate: day('2026-10-10'), type: 'REFUND', invoice,
  taxReversed: 1000, lines: [{ lineId: invoice.lines[0].id, quantity: 2, net: 10000, tax: 1000 }],
  ...overrides,
});
const inRange = (date, range) => date >= range.gte && date <= range.lte;
const matchesScope = (invoice, where) => (!where.branchId || invoice.branchId === where.branchId)
  && (!where.processedByUserId || invoice.processedByUserId === where.processedByUserId)
  && invoice.tax > (where.tax?.gt ?? -1);

beforeEach(() => {
  vi.clearAllMocks(); data.invoices = []; data.refunds = [];
  db.branch.findUnique.mockResolvedValue({ name: 'Branch' });
  db.branch.findMany.mockResolvedValue([{ id: 'b1', name: 'Branch' }, { id: 'b2', name: 'Other' }]);
  db.invoice.findMany.mockImplementation(async ({ where }) => data.invoices.filter(i => where.date && inRange(i.date, where.date)
    && matchesScope(i, where) && (!where.lifecycle?.not || i.lifecycle !== where.lifecycle.not)));
  db.invoiceRefund.findMany.mockImplementation(async ({ where }) => data.refunds.filter(r => inRange(r.refundDate, where.refundDate)
    && matchesScope(r.invoice, where.invoice)));
});

const expectNet = (report, base, tax) => {
  expect(report.kpis.netTaxLiability).toBe(tax);
  expect(report.totals).toMatchObject({ taxableBase: base, taxAmount: tax, netTax: tax, total: base + tax });
  for (const rows of [report.serviceRows, report.invoiceRows, report.serviceSummary]) {
    expect(rows.reduce((sum, row) => sum + row.taxAmount, 0)).toBeCloseTo(tax, 2);
    expect(rows.reduce((sum, row) => sum + row.taxableBase, 0)).toBeCloseTo(base, 2);
  }
};

describe('tax report sale and reversal reconciliation', () => {
  it('reports 10,000 sale and 1,000 tax before any refund', async () => {
    data.invoices = [sale()];
    const report = await taxReport(actor, query);
    expectNet(report, 10000, 1000);
    expect(report.kpis).toMatchObject({ totalTaxCharged: 1000, totalTaxRefunded: 0 });
  });

  it.each(['VOID', 'REFUND'])('nets a fully reversed sale to zero for %s, including every table', async type => {
    const invoice = sale({ lifecycle: type === 'VOID' ? 'VOIDED' : 'REFUNDED' });
    data.invoices = [invoice]; data.refunds = [reverse(invoice, { type })];
    const report = await taxReport(actor, query);
    expectNet(report, 0, 0);
    expect(report.kpis).toMatchObject({ totalTaxCharged: 1000, totalTaxRefunded: 1000 });
    expect(report.invoiceRows).toHaveLength(1);
    expect(report.serviceRows[0].taxAmount).toBe(0);
    expect(report.serviceSummary[0].count).toBe(0);
  });

  it('keeps 500 tax on the unrefunded half', async () => {
    const invoice = sale({ lifecycle: 'PARTIALLY_REFUNDED' });
    data.invoices = [invoice];
    data.refunds = [reverse(invoice, { lines: [{ lineId: 'l1', quantity: 1, net: 5000, tax: 500 }] })];
    const report = await taxReport(actor, query);
    expectNet(report, 5000, 500);
    expect(report.invoiceRows[0].status).toBe('PARTIALLY_REFUNDED');
  });

  it('applies successive partial refunds only once', async () => {
    const invoice = sale({ lifecycle: 'REFUNDED' }); data.invoices = [invoice];
    data.refunds = [1, 2].map(id => reverse(invoice, { id: `r${id}`, lines: [{ lineId: 'l1', quantity: 1, net: 5000, tax: 500 }] }));
    expectNet(await taxReport(actor, query), 0, 0);
  });

  it('uses stored refund amounts so rounding on the final unit reconciles exactly', async () => {
    const invoice = sale({ tax: 1, lines: [{ ...sale().lines[0], quantity: 3, unitPrice: 3.3333, netSales: 10, tax: 1 }] });
    data.invoices = [invoice];
    data.refunds = [0.33, 0.33, 0.34].map((tax, index) => reverse(invoice, {
      id: `r${index}`, lines: [{ lineId: 'l1', quantity: 1, net: index === 2 ? 3.34 : 3.33, tax }],
    }));
    expectNet(await taxReport(actor, query), 0, 0);
  });

  it('does not rewrite a historical sale period when the refund happened later', async () => {
    const invoice = sale({ lifecycle: 'VOIDED' }); data.invoices = [invoice];
    data.refunds = [reverse(invoice, { type: 'VOID', refundDate: day('2026-11-02') })];
    expectNet(await taxReport(actor, query), 10000, 1000);
    expectNet(await taxReport(actor, { from: '2026-10-01', to: '2026-11-30' }), 0, 0);
    // A refund-only period remains a dated adjustment, not an artificial zero clamp.
    expectNet(await taxReport(actor, { from: '2026-11-01', to: '2026-11-30' }), -10000, -1000);
  });

  it('filters rows, invoice totals, summaries and refund KPIs consistently by service', async () => {
    const invoice = sale({ lines: [...sale().lines, { ...sale().lines[0], id: 'l2', name: 'Haircut' }], tax: 2000 });
    data.invoices = [invoice]; data.refunds = [reverse(invoice)];
    const report = await taxReport(actor, { ...query, search: 'facial' });
    expectNet(report, 0, 0);
    expect(report.kpis).toMatchObject({ totalTaxCharged: 1000, totalTaxRefunded: 1000 });
    expectNet(await taxReport(actor, { ...query, search: 'haircut' }), 10000, 1000);
    expectNet(await taxReport(actor, { ...query, search: 'missing' }), 0, 0);
  });

  it('keeps another sale when one invoice is fully refunded', async () => {
    const invoice = sale(); data.invoices = [invoice, sale({ id: 'i2', invoiceNumber: 'INV-002', lines: [{ ...sale().lines[0], id: 'l2' }] })];
    data.refunds = [reverse(invoice)];
    expectNet(await taxReport(actor, query), 10000, 1000);
  });

  it('retains branch and accountant isolation for both original sales and reversals', async () => {
    const own = sale(); const other = sale({ id: 'i2', branchId: 'b2' });
    const colleague = sale({ id: 'i3', processedByUserId: 'cashier2' });
    data.invoices = [own, other, colleague]; data.refunds = [reverse(other), reverse(colleague)];
    expectNet(await taxReport({ ...actor, id: 'cashier1', role: 'ACCOUNTANT' }, { ...query, branchId: 'b2' }), 10000, 1000);
    expect(db.invoiceRefund.findMany.mock.calls[0][0].where.invoice).toMatchObject({ branchId: 'b1', processedByUserId: 'cashier1' });
  });

  it('keeps different rate snapshots separate in the service summary', async () => {
    data.invoices = [sale({ lines: [...sale().lines, { ...sale().lines[0], id: 'l2', taxRate: 0.05, tax: 500 }], tax: 1500 })];
    const report = await taxReport(actor, query);
    expectNet(report, 20000, 1500);
    expect(report.serviceSummary.map(row => row.taxRate)).toEqual([10, 5]);
  });
});
