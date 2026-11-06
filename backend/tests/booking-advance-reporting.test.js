import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { netPayments, priceBooking } from '../src/modules/bookings/bookings.pricing.js';
import { toBookingDTO } from '../src/modules/bookings/bookings.mapper.js';

const D = (v) => new Prisma.Decimal(v);

// Shared mocks for Income & Expense Report testing hoisted for Vitest
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    branch: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    staff: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    invoicePayment: { findMany: vi.fn() },
    invoiceRefund: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    payrollRun: { findMany: vi.fn() },
    commissionEvent: { findMany: vi.fn() },
    stockMovement: { findMany: vi.fn(), aggregate: vi.fn() },
    invoiceLine: { aggregate: vi.fn() },
    supplierPayment: { findMany: vi.fn() },
    drawerMovement: { findMany: vi.fn() },
    accountMovement: { findMany: vi.fn() },
    bookingHistory: { findMany: vi.fn() },
    tipReceipt: { findMany: vi.fn() },
    commissionRun: { findMany: vi.fn() },
    commissionPayment: { findMany: vi.fn() },
  };
  return { mockPrisma };
});

vi.mock('../src/config/prisma.js', () => ({
  default: mockPrisma,
}));

vi.mock('../src/modules/reports/staffLoanMovements.js', () => ({
  loadStaffLoanMovements: vi.fn().mockResolvedValue([]),
  STAFF_LOAN_CATEGORY: 'Staff Loan Disbursement (Non-Operating)',
  currentStaffLoanReceivable: vi.fn().mockResolvedValue(0),
}));

vi.mock('../src/modules/reports/fullCommissionAccrual.js', () => ({
  accruedCommissionForPeriod: vi.fn().mockResolvedValue(new Prisma.Decimal(0)),
}));

import { incomeExpenseReport } from '../src/modules/reports/reports.service.js';

describe('Booking Advance & POS Payment Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.branch.findMany.mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]);
    mockPrisma.branch.findUnique.mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' });
    mockPrisma.staff.findMany.mockResolvedValue([{ id: 'staff-1', name: 'Stylist Zara', employeeCode: 'ST-001', branchId: 'branch-1' }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-admin', name: 'Staff Reception', role: 'ADMIN', branchId: 'branch-1' }]);
    mockPrisma.invoicePayment.findMany.mockResolvedValue([]);
    mockPrisma.invoiceRefund.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([]);
    mockPrisma.payrollRun.findMany.mockResolvedValue([]);
    mockPrisma.commissionEvent.findMany.mockResolvedValue([]);
    mockPrisma.stockMovement.findMany.mockResolvedValue([]);
    mockPrisma.stockMovement.aggregate.mockResolvedValue({ _sum: { totalCost: 0 } });
    mockPrisma.invoiceLine.aggregate.mockResolvedValue({ _sum: { cogsAmount: 0 } });
    mockPrisma.supplierPayment.findMany.mockResolvedValue([]);
    mockPrisma.drawerMovement.findMany.mockResolvedValue([]);
    mockPrisma.accountMovement.findMany.mockResolvedValue([]);
    mockPrisma.bookingHistory.findMany.mockResolvedValue([]);
    mockPrisma.tipReceipt.findMany.mockResolvedValue([]);
    mockPrisma.commissionRun.findMany.mockResolvedValue([]);
    mockPrisma.commissionPayment.findMany.mockResolvedValue([]);
  });

  describe('Scenario A: Two Advances on PKR 10,000 Booking', () => {
    it('1. Correctly calculates net payments and remaining balance without cumulative inflation', () => {
      const items = [{ unitPrice: 10000, quantity: 1, taxRate: 0 }];
      const pricing = priceBooking(items, 'FIXED', 0);
      expect(pricing.totalAmount.toNumber()).toBe(10000);

      // 1st advance: PKR 5,000 (Cash, BPR-0001)
      const payment1 = { id: 'pay-1', amount: D(5000), isRefund: false, method: 'CASH', receiptNumber: 'BPR-0001', date: new Date('2026-11-01') };
      const netAfter1 = netPayments([payment1]);
      expect(netAfter1.toNumber()).toBe(5000);

      // 2nd advance: PKR 5,000 (Online, BPR-0011)
      const payment2 = { id: 'pay-2', amount: D(5000), isRefund: false, method: 'ONLINE_ACCOUNT', paymentAccountId: 'acc-1', paymentAccountName: 'HBL Main', receiptNumber: 'BPR-0011', date: new Date('2026-11-02') };
      const netAfter2 = netPayments([payment1, payment2]);
      expect(netAfter2.toNumber()).toBe(10000);

      const bookingMock = {
        id: 'bkg-001',
        bookingNumber: 'BKG-0001',
        branchId: 'b-01',
        clientName: 'Ayesha Khan',
        clientPhone: '03001234567',
        eventDate: new Date('2026-11-10'),
        serviceTime: '14:00',
        totalAmount: D(10000),
        subtotal: D(10000),
        discount: D(0),
        discountValue: D(0),
        taxAmount: D(0),
        cancellationCharge: D(0),
        status: 'CONFIRMED',
        payments: [payment1, payment2],
        items: [{ id: 'bi-1', unitPrice: D(10000), quantity: 1, taxRate: D(0) }],
      };

      const dto = toBookingDTO(bookingMock);
      expect(dto.totalAmount).toBe(10000);
      expect(dto.advancePaid).toBe(10000);
      expect(dto.remainingBalance).toBe(0);
      expect(dto.paymentStatus).toBe('FULLY_PAID');
      expect(dto.payments).toHaveLength(2);

      // Each individual installment retains its exact amount and method
      expect(dto.payments[0].amount).toBe(5000);
      expect(dto.payments[0].receiptNumber).toBe('BPR-0001');
      expect(dto.payments[0].method).toBe('CASH');

      expect(dto.payments[1].amount).toBe(5000);
      expect(dto.payments[1].receiptNumber).toBe('BPR-0011');
      expect(dto.payments[1].method).toBe('ONLINE_ACCOUNT');
    });
  });

  describe('Scenario B: Partial Advance (PKR 3,000 on PKR 10,000 Booking)', () => {
    it('2. Correctly tracks remaining dues of PKR 7,000 for POS collection', () => {
      const payment1 = { id: 'pay-1', amount: D(3000), isRefund: false, method: 'CASH', receiptNumber: 'BPR-0001', date: new Date('2026-11-01') };
      const bookingMock = {
        id: 'bkg-002',
        bookingNumber: 'BKG-0002',
        branchId: 'b-01',
        clientName: 'Fatima',
        clientPhone: '03009876543',
        eventDate: new Date('2026-11-10'),
        serviceTime: '11:00',
        totalAmount: D(10000),
        subtotal: D(10000),
        discount: D(0),
        discountValue: D(0),
        taxAmount: D(0),
        cancellationCharge: D(0),
        status: 'CONFIRMED',
        payments: [payment1],
        items: [{ id: 'bi-2', unitPrice: D(10000), quantity: 1, taxRate: D(0) }],
      };

      const dto = toBookingDTO(bookingMock);
      expect(dto.totalAmount).toBe(10000);
      expect(dto.advancePaid).toBe(3000);
      expect(dto.remainingBalance).toBe(7000);
      expect(dto.paymentStatus).toBe('PARTIALLY_PAID');
    });
  });

  describe('Scenario C & D: Reporting & Labels', () => {
    it('3. Ensures Income & Expense report uses Booking Advance Collection label', () => {
      const rawRow = {
        id: 'm-1',
        createdAt: new Date('2026-11-01'),
        sourceModule: 'BOOKING',
        type: 'SETTLEMENT',
        category: 'Booking Advance Collections',
        recordTypeLabel: 'Booking Advance Collection',
        reference: 'BPR-0011',
        userName: 'Sara Cashier',
        description: 'Advance for BKG-0001',
        amount: D(5000),
        direction: 'IN',
      };

      expect(rawRow.category).toBe('Booking Advance Collections');
      expect(rawRow.recordTypeLabel).toBe('Booking Advance Collection');
      expect(rawRow.reference).toBe('BPR-0011');
    });
  });

  describe('Scenario E: Income & Expense Report Booking Advance Double-Counting Prevention', () => {
    it('4. Real transaction references INV-0001 and BPR-0012: PKR 10,000 booking with PKR 5,000 advance and PKR 5,000 POS checkout', async () => {
      // Booking total: PKR 10,000
      // Advance received: PKR 5,000 (BPR-0012, Cash)
      // POS checkout invoice: INV-0001 (Advance adjusted: 5,000, New POS payment: 5,000, RCP-0001)
      const invoiceINV0001 = {
        id: 'inv-0001',
        invoiceNumber: 'INV-0001',
        date: new Date('2026-11-05T00:00:00.000Z'),
        time: '12:00',
        branchId: 'branch-1',
        clientId: 'client-1',
        clientName: 'Ayesha',
        subtotal: D(10000),
        discount: D(0),
        netSales: D(10000),
        tax: D(0),
        total: D(10000),
        amountPaid: D(10000), // In Prisma, amountPaid includes advanceAdjusted
        amountDue: D(0),
        advanceAdjusted: D(5000),
        paymentMethod: 'CASH',
        status: 'PAID',
        lifecycle: 'ACTIVE',
        processedByName: 'Staff Reception',
        notes: '',
        lines: [
          {
            id: 'line-1',
            type: 'SERVICE',
            netSales: D(10000),
            tax: D(0),
            staffId: 'staff-1',
            staffName: 'Stylist Zara',
            staffCommissionRate: D(10),
            components: [],
          },
        ],
        payments: [
          {
            id: 'pay-pos-1',
            receiptNumber: 'RCP-0001',
            date: new Date('2026-11-05T00:00:00.000Z'),
            time: '12:00',
            amount: D(5000),
            billAmountAllocated: D(5000),
            tipAmountAllocated: D(0),
            method: 'CASH',
            paymentAccountId: null,
            paymentAccountName: null,
            previousBalance: D(5000),
            remainingBalance: D(0),
            kind: 'POS',
            processedByUserId: 'user-admin',
            processedByName: 'Staff Reception',
            createdAt: new Date('2026-11-05T12:00:00.000Z'),
            reversedAt: null,
          },
        ],
        refunds: [],
      };

      const advanceMovementBPR0012 = {
        id: 'dm-bpr-0012',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        branchId: 'branch-1',
        userId: 'user-admin',
        userName: 'Staff Reception',
        sourceModule: 'BOOKING',
        type: 'BOOKING_ADVANCE',
        direction: 'IN',
        amount: D(5000),
        reference: 'BPR-0012',
        description: 'Advance collection for BKG-0001',
      };

      mockPrisma.invoice.findMany.mockResolvedValue([invoiceINV0001]);
      mockPrisma.drawerMovement.findMany.mockResolvedValue([advanceMovementBPR0012]);

      const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

      const report = await incomeExpenseReport(actor, {
        from: '2026-11-01',
        to: '2026-11-05',
        branchId: 'branch-1',
      });

      // 1. Verify invoice row preserves original invoice value and records new POS payment
      const invRow = report.displayRows.find((r) => r.reference === 'INV-0001');
      expect(invRow).toBeDefined();
      expect(invRow.totalBill).toBe(10000); // Original invoice bill preserved
      expect(invRow.recognizedIncome).toBe(10000); // Recognized sales / income preserved
      expect(invRow.advanceAdjusted).toBe(5000); // Explicit advance credit applied
      expect(invRow.paid).toBe(5000); // ONLY new POS checkout cash payment
      expect(invRow.collectionAmount).toBe(5000); // Canonical new POS cash collection
      expect(invRow.totalReceived).toBe(5000);
      expect(invRow.remainingDues).toBe(0); // Fully settled
      expect(invRow.receiptNumber).toBe('RCP-0001');
      expect(invRow.status).toBe('PAID');

      // 2. Verify booking advance collection row is recorded separately
      const advRow = report.displayRows.find((r) => r.reference === 'BPR-0012');
      expect(advRow).toBeDefined();
      expect(advRow.recordTypeLabel).toBe('Booking Advance Collection');
      expect(advRow.cashFlow).toBe(5000);
      expect(advRow.paid).toBe(0);

      // 3. CRITICAL: Total Customer Collections must be PKR 10,000, NOT PKR 15,000 (NO DOUBLE COUNTING!)
      expect(report.totals.customerCollections).toBe(10000);
      expect(report.totals.collections).toBe(10000);
      expect(report.kpis.totalCollections).toBe(10000);
      expect(report.totals.netCashMovement).toBe(10000);

      // 4. Invoiced turnover and revenue recognition
      expect(report.totals.customerInvoiceTotal).toBe(10000);
      expect(report.totals.income).toBe(10000);
      expect(report.totals.recognizedIncome).toBe(10000);
      expect(report.totals.totalOutstandingDues).toBe(0);
    });

    it('5. Full advance scenario: PKR 10,000 booking fully paid in advance, PKR 0 new checkout payment', async () => {
      const fullAdvanceInvoice = {
        id: 'inv-0002',
        invoiceNumber: 'INV-0002',
        date: new Date('2026-11-05T00:00:00.000Z'),
        time: '14:00',
        branchId: 'branch-1',
        clientId: 'client-2',
        clientName: 'Mariam',
        subtotal: D(10000),
        discount: D(0),
        netSales: D(10000),
        tax: D(0),
        total: D(10000),
        amountPaid: D(10000),
        amountDue: D(0),
        advanceAdjusted: D(10000),
        paymentMethod: 'CASH',
        status: 'PAID',
        lifecycle: 'ACTIVE',
        processedByName: 'Staff Reception',
        notes: '',
        lines: [{ id: 'l-2', type: 'SERVICE', netSales: D(10000), tax: D(0), staffId: 'staff-1', staffName: 'Zara', staffCommissionRate: D(0), components: [] }],
        payments: [], // No new POS payment at checkout!
        refunds: [],
      };

      const advanceMovements = [
        {
          id: 'dm-bpr-0021',
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
          branchId: 'branch-1',
          userId: 'user-admin',
          userName: 'Staff Reception',
          sourceModule: 'BOOKING',
          type: 'BOOKING_ADVANCE',
          direction: 'IN',
          amount: D(5000),
          reference: 'BPR-0021',
          description: 'Advance 1 for BKG-0002',
        },
        {
          id: 'dm-bpr-0022',
          createdAt: new Date('2026-11-02T10:00:00.000Z'),
          branchId: 'branch-1',
          userId: 'user-admin',
          userName: 'Staff Reception',
          sourceModule: 'BOOKING',
          type: 'BOOKING_ADVANCE',
          direction: 'IN',
          amount: D(5000),
          reference: 'BPR-0022',
          description: 'Advance 2 for BKG-0002',
        },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue([fullAdvanceInvoice]);
      mockPrisma.drawerMovement.findMany.mockResolvedValue(advanceMovements);

      const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

      const report = await incomeExpenseReport(actor, {
        from: '2026-11-01',
        to: '2026-11-05',
        branchId: 'branch-1',
      });

      const invRow = report.displayRows.find((r) => r.reference === 'INV-0002');
      expect(invRow).toBeDefined();
      expect(invRow.totalBill).toBe(10000);
      expect(invRow.paid).toBe(0); // Zero checkout cash payment
      expect(invRow.collectionAmount).toBe(0);
      expect(invRow.advanceAdjusted).toBe(10000);
      expect(invRow.remainingDues).toBe(0);

      // Total collections = 10,000 (from the two advance rows: 5,000 + 5,000)
      expect(report.totals.customerCollections).toBe(10000);
      expect(report.totals.income).toBe(10000);
      expect(report.totals.totalOutstandingDues).toBe(0);
    });

    it('6. Partial advance scenario with dues: PKR 3,000 advance + PKR 2,000 checkout + PKR 5,000 remaining dues', async () => {
      const partialInvoice = {
        id: 'inv-0003',
        invoiceNumber: 'INV-0003',
        date: new Date('2026-11-05T00:00:00.000Z'),
        time: '16:00',
        branchId: 'branch-1',
        clientId: 'client-3',
        clientName: 'Sana',
        subtotal: D(10000),
        discount: D(0),
        netSales: D(10000),
        tax: D(0),
        total: D(10000),
        amountPaid: D(5000), // 3,000 advance + 2,000 POS checkout
        amountDue: D(5000),
        advanceAdjusted: D(3000),
        paymentMethod: 'CASH',
        status: 'PARTIAL',
        lifecycle: 'ACTIVE',
        processedByName: 'Staff Reception',
        notes: '',
        lines: [{ id: 'l-3', type: 'SERVICE', netSales: D(10000), tax: D(0), staffId: 'staff-1', staffName: 'Zara', staffCommissionRate: D(0), components: [] }],
        payments: [
          {
            id: 'pay-pos-3',
            receiptNumber: 'RCP-0003',
            date: new Date('2026-11-05T00:00:00.000Z'),
            time: '16:00',
            amount: D(2000),
            billAmountAllocated: D(2000),
            tipAmountAllocated: D(0),
            method: 'CASH',
            kind: 'POS',
            createdAt: new Date('2026-11-05T16:00:00.000Z'),
            reversedAt: null,
          },
        ],
        refunds: [],
      };

      const advanceMovements = [
        {
          id: 'dm-bpr-0031',
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
          branchId: 'branch-1',
          userId: 'user-admin',
          userName: 'Staff Reception',
          sourceModule: 'BOOKING',
          type: 'BOOKING_ADVANCE',
          direction: 'IN',
          amount: D(3000),
          reference: 'BPR-0031',
          description: 'Advance for BKG-0003',
        },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue([partialInvoice]);
      mockPrisma.drawerMovement.findMany.mockResolvedValue(advanceMovements);

      const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

      const report = await incomeExpenseReport(actor, {
        from: '2026-11-01',
        to: '2026-11-05',
        branchId: 'branch-1',
      });

      const invRow = report.displayRows.find((r) => r.reference === 'INV-0003');
      expect(invRow).toBeDefined();
      expect(invRow.totalBill).toBe(10000);
      expect(invRow.paid).toBe(2000); // Only new POS payment
      expect(invRow.collectionAmount).toBe(2000);
      expect(invRow.advanceAdjusted).toBe(3000);
      expect(invRow.balanceAfterPayment).toBe(5000);
      expect(invRow.remainingDues).toBe(5000);

      // Total customer collections = 2,000 (POS) + 3,000 (advance) = 5,000
      expect(report.totals.customerCollections).toBe(5000);
      expect(report.totals.customerInvoiceTotal).toBe(10000);
      expect(report.totals.totalOutstandingDues).toBe(5000);
    });

    it('7. Advance refund scenario: Booking advance of PKR 5,000 refunded before conversion', async () => {
      const advanceMovements = [
        {
          id: 'dm-bpr-0041',
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
          branchId: 'branch-1',
          userId: 'user-admin',
          userName: 'Staff Reception',
          sourceModule: 'BOOKING',
          type: 'BOOKING_ADVANCE',
          direction: 'IN',
          amount: D(5000),
          reference: 'BPR-0041',
          description: 'Advance collection for BKG-0004',
        },
        {
          id: 'dm-bpr-0041-ref',
          createdAt: new Date('2026-11-02T10:00:00.000Z'),
          branchId: 'branch-1',
          userId: 'user-admin',
          userName: 'Staff Reception',
          sourceModule: 'BOOKING',
          type: 'BOOKING_REFUND',
          direction: 'OUT',
          amount: D(5000),
          reference: 'BPR-0041',
          description: 'Advance refund for BKG-0004',
        },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.drawerMovement.findMany.mockResolvedValue(advanceMovements);

      const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

      const report = await incomeExpenseReport(actor, {
        from: '2026-11-01',
        to: '2026-11-05',
        branchId: 'branch-1',
      });

      // Collections from advance (+5000) and refund (-5000) cancel out to 0
      expect(report.totals.customerCollections).toBe(0);
      expect(report.totals.netCashMovement).toBe(0);
    });
  });
});
