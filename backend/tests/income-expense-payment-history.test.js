// backend/tests/income-expense-payment-history.test.js
// Automated verification suite for Income & Expense Report payment history rows

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { groupLedgerInvoices, invoicePresentation } from '../src/modules/reports/invoicePresentation.js';

const D = (v) => new Prisma.Decimal(v);

describe('Income & Expense Report · Payment History Rows Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. groupLedgerInvoices Presentation Unit Tests', () => {
    it('Scenario: Initial Partial Payment + 2 Subsequent Payments + Settlement', () => {
      // Invoice INV-0002, Total Bill 1,000 (Service: 1,000, Tax: 0)
      // 1. Initial collection at checkout: PKR 500 (Balance after: 500, Current Outstanding: 0)
      // 2. Subsequent collection next day: PKR 300 (Balance after: 200, Current Outstanding: 0)
      // 3. Third collection: PKR 200 (Balance after: 0, Current Outstanding: 0)
      const mockInvoice = {
        id: 'inv-0002',
        invoiceNumber: 'INV-0002',
        date: new Date('2026-11-01T00:00:00Z'),
        clientName: 'Nadia',
        branchId: 'b-main',
        netSales: D(1000),
        tax: D(0),
        amountDue: D(0),
        refunds: [],
        lines: [{ id: 'line-1', netSales: D(1000), tax: D(0) }],
        payments: [
          { id: 'p1', date: new Date('2026-11-01T00:00:00Z'), createdAt: new Date('2026-11-01T10:00:00Z'), billAmountAllocated: D(500), tipAmountAllocated: D(0) },
          { id: 'p2', date: new Date('2026-11-02T00:00:00Z'), createdAt: new Date('2026-11-02T10:00:00Z'), billAmountAllocated: D(300), tipAmountAllocated: D(0) },
          { id: 'p3', date: new Date('2026-11-03T00:00:00Z'), createdAt: new Date('2026-11-03T10:00:00Z'), billAmountAllocated: D(200), tipAmountAllocated: D(0) },
        ],
      };

      const context = new Map([
        [
          'inv-0002',
          {
            invoice: mockInvoice,
            ...invoicePresentation(mockInvoice, '2026-11-30'),
          },
        ],
      ]);

      const inputRows = [
        // 1. Original Invoice row
        {
          id: 'inv-inv-0002',
          invoiceId: 'inv-0002',
          invoiceNumber: 'INV-0002',
          reference: 'INV-0002',
          customerName: 'Nadia',
          branchId: 'b-main',
          branchName: 'Karachi Branch',
          date: '2026-11-01',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Invoice',
          recordType: 'ORIGINAL_INVOICE',
          recordTypeLabel: 'Original Invoice',
          paymentSequence: 1,
          receiptNumber: 'RCP-0001',
          serviceAmount: 1000,
          tax: 0,
          totalBill: 1000,
          invoiceBillTotal: 1000,
          tipAmount: 0,
          totalReceived: 500,
          collectionAmount: 500,
          paid: 500,
          cashFlow: 500,
          balanceAfterPayment: 500,
          currentOutstanding: 0,
          remainingDues: 0,
          paymentMethod: 'CASH',
          status: 'PARTIAL',
        },
        // 2. Second payment next day
        {
          id: 'due-pay-2',
          invoiceId: 'inv-0002',
          invoiceNumber: 'INV-0002',
          reference: 'INV-0002',
          customerName: 'Nadia',
          branchId: 'b-main',
          branchName: 'Karachi Branch',
          date: '2026-11-02',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Dues Collection',
          recordType: 'SUBSEQUENT_PAYMENT',
          recordTypeLabel: 'Payment Receipt #2',
          paymentSequence: 2,
          receiptNumber: 'RCP-0002',
          paymentAccountName: 'Meezan Bank - Main Account',
          serviceAmount: 0,
          tax: 0,
          totalBill: 0,
          invoiceBillTotal: 1000,
          tipAmount: 0,
          totalReceived: 300,
          collectionAmount: 300,
          paid: 300,
          cashFlow: 300,
          balanceAfterPayment: 200,
          currentOutstanding: 0,
          remainingDues: 0,
          paymentMethod: 'ONLINE_ACCOUNT',
          status: 'PARTIAL',
        },
        // 3. Third payment settling invoice
        {
          id: 'due-pay-3',
          invoiceId: 'inv-0002',
          invoiceNumber: 'INV-0002',
          reference: 'INV-0002',
          customerName: 'Nadia',
          branchId: 'b-main',
          branchName: 'Karachi Branch',
          date: '2026-11-03',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Dues Collection',
          recordType: 'SUBSEQUENT_PAYMENT',
          recordTypeLabel: 'Payment Receipt #3',
          paymentSequence: 3,
          receiptNumber: 'RCP-0003',
          serviceAmount: 0,
          tax: 0,
          totalBill: 0,
          invoiceBillTotal: 1000,
          tipAmount: 0,
          totalReceived: 200,
          collectionAmount: 200,
          paid: 200,
          cashFlow: 200,
          balanceAfterPayment: 0,
          currentOutstanding: 0,
          remainingDues: 0,
          paymentMethod: 'CASH',
          status: 'PAID',
        },
      ];

      const displayRows = groupLedgerInvoices(inputRows, context);

      // Verify that all 3 rows are preserved and NOT collapsed into 1 row
      expect(displayRows.length).toBe(3);

      // Verify Row 1 (Original Invoice)
      const invRow = displayRows.find((r) => r.recordType === 'ORIGINAL_INVOICE');
      expect(invRow).toBeDefined();
      expect(invRow.invoiceNumber).toBe('INV-0002');
      expect(invRow.serviceCollection).toBe(500); // Service portion collected on this receipt
      expect(invRow.totalBill).toBe(1000);
      expect(invRow.totalReceived).toBe(500);
      expect(invRow.balanceAfterPayment).toBe(500);
      expect(invRow.remainingDues).toBeNull(); // Superseded by later payments in this group

      // Verify Row 2 (Payment Receipt #2)
      const pay2 = displayRows.find((r) => r.recordTypeLabel === 'Payment Receipt #2');
      expect(pay2).toBeDefined();
      expect(pay2.invoiceNumber).toBe('INV-0002');
      expect(pay2.serviceCollection).toBe(300); // Service portion collected on receipt #2
      expect(pay2.totalBill).toBe(0); // Bill amount NOT duplicated
      expect(pay2.totalReceived).toBe(300);
      expect(pay2.balanceAfterPayment).toBe(200);
      expect(pay2.remainingDues).toBeNull(); // Superseded by receipt #3
      expect(pay2.receiptNumber).toBe('RCP-0002');
      expect(pay2.paymentAccountName).toBe('Meezan Bank - Main Account');
      expect(pay2.paymentMethod).toBe('ONLINE_ACCOUNT');

      // Verify Row 3 (Payment Receipt #3)
      const pay3 = displayRows.find((r) => r.recordTypeLabel === 'Payment Receipt #3');
      expect(pay3).toBeDefined();
      expect(pay3.invoiceNumber).toBe('INV-0002');
      expect(pay3.serviceCollection).toBe(200); // Service portion collected on receipt #3
      expect(pay3.totalBill).toBe(0); // Bill amount NOT duplicated
      expect(pay3.totalReceived).toBe(200);
      expect(pay3.balanceAfterPayment).toBe(0);
      expect(pay3.remainingDues).toBe(0); // Latest visible receipt row shows updated remaining balance: 0!
      expect(pay3.receiptNumber).toBe('RCP-0003');

      // Verify service collection sum across all rows = exactly original bill:
      const totalServiceCollections = displayRows.reduce((sum, r) => sum + (r.serviceCollection || 0), 0);
      expect(totalServiceCollections).toBe(1000); // 500 + 300 + 200 = exactly 1,000!

      const totalPaymentsReceived = displayRows.reduce((sum, r) => sum + (r.totalReceived || 0), 0);
      expect(totalPaymentsReceived).toBe(1000); // 500 + 300 + 200 = 1,000
    });

    it('Scenario: Refund/Reversal row remains separate dated event', () => {
      const mockInvoice = {
        id: 'inv-0003',
        invoiceNumber: 'INV-0003',
        date: new Date('2026-11-01T00:00:00Z'),
        clientName: 'Sara Khan',
        branchId: 'b-main',
        netSales: D(2000),
        tax: D(200),
        amountDue: D(0),
        refunds: [
          {
            id: 'ref-1',
            refundNumber: 'REF-0001',
            refundDate: new Date('2026-11-04T00:00:00Z'),
            netReversed: D(1000),
            taxReversed: D(100),
            cashOut: D(1100),
            tipReversed: D(0),
            method: 'CASH',
            reason: 'Partial cancellation',
          },
        ],
        lines: [{ netSales: D(2000), tax: D(200) }],
      };

      const context = new Map([
        [
          'inv-0003',
          {
            invoice: mockInvoice,
            ...invoicePresentation(mockInvoice, '2026-11-30'),
          },
        ],
      ]);

      const inputRows = [
        {
          id: 'inv-inv-0003',
          invoiceId: 'inv-0003',
          invoiceNumber: 'INV-0003',
          reference: 'INV-0003',
          customerName: 'Sara Khan',
          branchId: 'b-main',
          date: '2026-11-01',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Invoice',
          recordType: 'ORIGINAL_INVOICE',
          recordTypeLabel: 'Original Invoice',
          serviceAmount: 2000,
          tax: 200,
          totalBill: 2200,
          totalReceived: 2200,
          collectionAmount: 2200,
          balanceAfterPayment: 0,
          currentOutstanding: 0,
          paymentMethod: 'CASH',
          status: 'PAID',
        },
        {
          id: 'ref-ref-1',
          invoiceId: 'inv-0003',
          invoiceNumber: 'INV-0003',
          reference: 'REF-0001',
          customerName: 'Client Refund',
          branchId: 'b-main',
          date: '2026-11-04',
          type: 'INCOME',
          category: 'Sales Refund / Reversal',
          source: 'Sales Refund',
          recordType: 'REFUND_REVERSAL',
          recordTypeLabel: 'Refund / Reversal',
          serviceAmount: -1000,
          tax: -100,
          totalBill: -1100,
          totalReceived: -1100,
          collectionAmount: -1100,
          currentOutstanding: 0,
          paymentMethod: 'CASH',
          status: 'REFUNDED',
        },
      ];

      const displayRows = groupLedgerInvoices(inputRows, context);
      expect(displayRows.length).toBe(2);

      const refRow = displayRows.find((r) => r.recordType === 'REFUND_REVERSAL');
      expect(refRow).toBeDefined();
      expect(refRow.reference).toBe('REF-0001');
      expect(refRow.serviceAmount).toBe(-1000);
      expect(refRow.tax).toBe(-100);
      expect(refRow.totalBill).toBe(-1100);
      expect(refRow.totalReceived).toBe(-1100);
    });

    it('Scenario: Non-invoice expenses and settlements are preserved with labels', () => {
      const inputRows = [
        {
          id: 'exp-1',
          date: '2026-11-02',
          type: 'OPERATING_EXPENSE',
          category: 'Salaries & Wages',
          source: 'Expense Voucher',
          reference: 'EXP-001',
          branchId: 'b-main',
          expense: 500,
          paid: 500,
          cashFlow: -500,
          paymentMethod: 'CASH',
          status: 'PAID',
        },
        {
          id: 'settle-loan-1',
          date: '2026-11-03',
          type: 'SETTLEMENT',
          category: 'Staff Loan Cash Outflow',
          source: 'Staff Loan',
          reference: 'LN-001',
          branchId: 'b-main',
          income: 0,
          expense: 0,
          paid: 0,
          cashFlow: -1000,
          paymentMethod: 'CASH',
          status: 'POSTED',
        },
      ];

      const displayRows = groupLedgerInvoices(inputRows, new Map());
      expect(displayRows.length).toBe(2);
      expect(displayRows[0].recordType).toBe('SETTLEMENT'); // sorted by date desc
      expect(displayRows[0].recordTypeLabel).toBe('Staff Loan');
      expect(displayRows[1].recordType).toBe('OPERATING_EXPENSE');
      expect(displayRows[1].recordTypeLabel).toBe('Operating Expense');
    });

    it('Scenario: Unpaid Invoice displays outstanding balance on Original Invoice row', () => {
      const mockUnpaid = {
        id: 'inv-unpaid-1',
        invoiceNumber: 'INV-9999',
        date: new Date('2026-11-01T00:00:00Z'),
        clientName: 'Fatima',
        branchId: 'b-main',
        netSales: D(1500),
        tax: D(150),
        amountDue: D(1650),
        refunds: [],
        lines: [{ id: 'l1', netSales: D(1500), tax: D(150) }],
        payments: [],
      };

      const context = new Map([
        ['inv-unpaid-1', { invoice: mockUnpaid, ...invoicePresentation(mockUnpaid, '2026-11-30') }],
      ]);

      const inputRows = [
        {
          id: 'inv-inv-unpaid-1',
          invoiceId: 'inv-unpaid-1',
          invoiceNumber: 'INV-9999',
          reference: 'INV-9999',
          customerName: 'Fatima',
          branchId: 'b-main',
          date: '2026-11-01',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Invoice',
          recordType: 'ORIGINAL_INVOICE',
          recordTypeLabel: 'Original Invoice',
          paymentSequence: 0,
          serviceCollection: 0,
          serviceAmount: 0,
          tax: 150,
          totalBill: 1650,
          invoiceBillTotal: 1650,
          totalReceived: 0,
          balanceAfterPayment: 1650,
          currentOutstanding: 1650,
          remainingDues: 1650,
          status: 'UNPAID',
        },
      ];

      const displayRows = groupLedgerInvoices(inputRows, context);
      expect(displayRows.length).toBe(1);
      expect(displayRows[0].recordType).toBe('ORIGINAL_INVOICE');
      expect(displayRows[0].serviceCollection).toBe(0); // 0 collection
      expect(displayRows[0].totalBill).toBe(1650);
      expect(displayRows[0].totalReceived).toBe(0);
      expect(displayRows[0].remainingDues).toBe(1650); // Unpaid invoice shows full outstanding balance
      expect(displayRows[0].status).toBe('UNPAID');
    });

    it('Scenario: Tax-inclusive partial payments split service and tax correctly', () => {
      // Bill: 1,000 + 10% tax = 1,100
      // Payment 1: 550 (Net: 500, Tax: 50, Remaining: 550)
      // Payment 2: 550 (Net: 500, Tax: 50, Remaining: 0)
      const mockTaxInv = {
        id: 'inv-tax-1',
        invoiceNumber: 'INV-TAX-01',
        date: new Date('2026-11-01T00:00:00Z'),
        clientName: 'Zainab',
        branchId: 'b-main',
        netSales: D(1000),
        tax: D(100),
        amountDue: D(0),
        refunds: [],
        lines: [{ id: 'l1', netSales: D(1000), tax: D(100) }],
        payments: [
          { id: 'p1', date: new Date('2026-11-01T00:00:00Z'), createdAt: new Date('2026-11-01T10:00:00Z'), billAmountAllocated: D(550) },
          { id: 'p2', date: new Date('2026-11-02T00:00:00Z'), createdAt: new Date('2026-11-02T10:00:00Z'), billAmountAllocated: D(550) },
        ],
      };

      const context = new Map([
        ['inv-tax-1', { invoice: mockTaxInv, ...invoicePresentation(mockTaxInv, '2026-11-30') }],
      ]);

      const inputRows = [
        {
          id: 'inv-tax-1-orig',
          invoiceId: 'inv-tax-1',
          invoiceNumber: 'INV-TAX-01',
          reference: 'INV-TAX-01',
          customerName: 'Zainab',
          branchId: 'b-main',
          date: '2026-11-01',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Invoice',
          recordType: 'ORIGINAL_INVOICE',
          recordTypeLabel: 'Original Invoice',
          paymentSequence: 1,
          collectedService: 500,
          serviceCollection: 500,
          collectedTax: 50,
          tax: 50,
          totalBill: 1100,
          invoiceBillTotal: 1100,
          totalReceived: 550,
          balanceAfterPayment: 550,
          status: 'PARTIAL',
        },
        {
          id: 'inv-tax-1-due',
          invoiceId: 'inv-tax-1',
          invoiceNumber: 'INV-TAX-01',
          reference: 'INV-TAX-01',
          customerName: 'Zainab',
          branchId: 'b-main',
          date: '2026-11-02',
          type: 'INCOME',
          category: 'Sales & Services',
          source: 'POS Dues Collection',
          recordType: 'SUBSEQUENT_PAYMENT',
          recordTypeLabel: 'Payment Receipt #2',
          paymentSequence: 2,
          collectedService: 500,
          serviceCollection: 500,
          collectedTax: 50,
          tax: 50,
          totalBill: 0,
          invoiceBillTotal: 1100,
          totalReceived: 550,
          balanceAfterPayment: 0,
          status: 'PAID',
        },
      ];

      const displayRows = groupLedgerInvoices(inputRows, context);
      expect(displayRows.length).toBe(2);

      const rOrig = displayRows.find(r => r.recordType === 'ORIGINAL_INVOICE');
      expect(rOrig.serviceCollection).toBe(500);
      expect(rOrig.tax).toBe(50);
      expect(rOrig.totalBill).toBe(1100);
      expect(rOrig.totalReceived).toBe(550);
      expect(rOrig.remainingDues).toBeNull(); // superseded

      const rDue = displayRows.find(r => r.recordType === 'SUBSEQUENT_PAYMENT');
      expect(rDue.serviceCollection).toBe(500);
      expect(rDue.tax).toBe(50);
      expect(rDue.totalBill).toBe(0);
      expect(rDue.totalReceived).toBe(550);
      expect(rDue.remainingDues).toBe(0); // settled

      // Sum of service collections = 1,000 (never includes tax!)
      const totalService = displayRows.reduce((s, r) => s + r.serviceCollection, 0);
      expect(totalService).toBe(1000);

      // Sum of tax = 100
      const totalTax = displayRows.reduce((s, r) => s + r.tax, 0);
      expect(totalTax).toBe(100);

      // Total payments = 1,100
      const totalPaid = displayRows.reduce((s, r) => s + r.totalReceived, 0);
      expect(totalPaid).toBe(1100);
    });

    it('Scenario: Same-Date Initial Payment 500 + Dues Collection 500 (RCP-0004) reconciles to 0 Remaining Dues and Original Invoice comes first', () => {
      const mockInvoice = {
        id: 'inv-0003',
        invoiceNumber: 'INV-0003',
        date: new Date('2026-11-05T00:00:00Z'),
        clientName: 'Ayesha',
        branchId: 'b-main',
        netSales: D(1000),
        tax: D(0),
        amountDue: D(0),
        refunds: [],
        lines: [{ id: 'line-1', netSales: D(1000), tax: D(0) }],
        payments: [
          { id: 'p-pos', date: new Date('2026-11-05T00:00:00Z'), createdAt: new Date('2026-11-05T14:33:00Z'), kind: 'POS', billAmountAllocated: D(500), tipAmountAllocated: D(0) },
          { id: 'p-due', date: new Date('2026-11-05T00:00:00Z'), createdAt: new Date('2026-11-05T14:48:00Z'), kind: 'DUES_COLLECTION', billAmountAllocated: D(500), tipAmountAllocated: D(0) },
        ],
      };

      const context = new Map([
        ['inv-0003', { invoice: mockInvoice, ...invoicePresentation(mockInvoice, '2026-11-05') }],
      ]);

      const inputRows = [
        {
          id: 'inv-inv-0003',
          invoiceId: 'inv-0003',
          invoiceNumber: 'INV-0003',
          reference: 'INV-0003',
          customerName: 'Ayesha',
          branchId: 'b-main',
          date: '2026-11-05',
          createdAt: new Date('2026-11-05T14:33:00Z'),
          type: 'INCOME',
          source: 'POS Invoice',
          recordType: 'ORIGINAL_INVOICE',
          recordTypeLabel: 'Original Invoice',
          paymentSequence: 1,
          receiptNumber: 'RCP-0003',
          serviceCollection: 500,
          serviceAmount: 500,
          tax: 0,
          totalBill: 1000,
          totalReceived: 500,
          balanceAfterPayment: 500,
          status: 'PARTIAL',
        },
        {
          id: 'due-pay-due',
          invoiceId: 'inv-0003',
          invoiceNumber: 'INV-0003',
          reference: 'INV-0003',
          customerName: 'Ayesha',
          branchId: 'b-main',
          date: '2026-11-05',
          createdAt: new Date('2026-11-05T14:48:00Z'),
          type: 'INCOME',
          source: 'POS Dues Collection',
          recordType: 'SUBSEQUENT_PAYMENT',
          recordTypeLabel: 'Payment Receipt #2',
          paymentSequence: 2,
          receiptNumber: 'RCP-0004',
          serviceCollection: 500,
          serviceAmount: 500,
          tax: 0,
          totalBill: 0,
          totalReceived: 500,
          balanceAfterPayment: 0,
          status: 'PAID',
        },
      ];

      const displayRows = groupLedgerInvoices(inputRows, context);
      expect(displayRows.length).toBe(2);

      // Requirement 5: Original invoice appears BEFORE subsequent receipt in invoice-group ordering
      expect(displayRows[0].recordType).toBe('ORIGINAL_INVOICE');
      expect(displayRows[0].invoiceNumber).toBe('INV-0003');
      expect(displayRows[0].remainingDues).toBeNull(); // Requirement 2: earlier rows show null ('—')

      expect(displayRows[1].recordType).toBe('SUBSEQUENT_PAYMENT');
      expect(displayRows[1].recordTypeLabel).toBe('Payment Receipt #2');
      expect(displayRows[1].receiptNumber).toBe('RCP-0004');
      // Requirement 3: fully paid invoice: latest receipt shows 0.00
      expect(displayRows[1].remainingDues).toBe(0);

      // Total Outstanding dues across non-null remaining rows must be exactly 0
      const totalOutstanding = displayRows
        .filter(r => r.remainingDues !== null && r.remainingDues !== undefined)
        .reduce((sum, r) => sum + r.remainingDues, 0);
      expect(totalOutstanding).toBe(0);
    });
  });

  describe('2. incomeExpenseReport End-to-End Service Integration Tests', () => {
    it('End-to-End: Initial partial payment + subsequent dues payments on distinct dates with historical date filtering', async () => {
      vi.resetModules();

      // Invoice INV-0002 created on 2026-11-01:
      // Bill: 1,000 (Net: 1,000, Tax: 0)
      // Payment 1: 2026-11-01 (POS) = 500 Cash
      // Payment 2: 2026-11-02 (DUES) = 300 Meezan Bank
      // Payment 3: 2026-11-03 (DUES) = 200 Cash -> Full settlement
      const p1 = {
        id: 'p-1',
        receiptNumber: 'RCP-0001',
        date: new Date('2026-11-01T00:00:00.000Z'),
        time: '10:00',
        amount: D(500),
        billAmountAllocated: D(500),
        tipAmountAllocated: D(0),
        method: 'CASH',
        paymentAccountId: null,
        paymentAccountName: null,
        previousBalance: D(1000),
        remainingBalance: D(500),
        kind: 'POS',
        processedByUserId: 'user-admin',
        processedByName: 'Admin User',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        reversedAt: null,
      };

      const p2 = {
        id: 'p-2',
        receiptNumber: 'RCP-0002',
        date: new Date('2026-11-02T00:00:00.000Z'),
        time: '11:00',
        amount: D(300),
        billAmountAllocated: D(300),
        tipAmountAllocated: D(0),
        method: 'ONLINE_ACCOUNT',
        paymentAccountId: 'acc-meezan',
        paymentAccountName: 'Meezan Bank - Main Account',
        previousBalance: D(500),
        remainingBalance: D(200),
        kind: 'DUES_COLLECTION',
        processedByUserId: 'user-admin',
        processedByName: 'Admin User',
        createdAt: new Date('2026-11-02T11:00:00.000Z'),
        reversedAt: null,
      };

      const p3 = {
        id: 'p-3',
        receiptNumber: 'RCP-0003',
        date: new Date('2026-11-03T00:00:00.000Z'),
        time: '14:00',
        amount: D(200),
        billAmountAllocated: D(200),
        tipAmountAllocated: D(0),
        method: 'CASH',
        paymentAccountId: null,
        paymentAccountName: null,
        previousBalance: D(200),
        remainingBalance: D(0),
        kind: 'DUES_COLLECTION',
        processedByUserId: 'user-admin',
        processedByName: 'Admin User',
        createdAt: new Date('2026-11-03T14:00:00.000Z'),
        reversedAt: null,
      };

      const fullInvoice = {
        id: 'inv-0002',
        invoiceNumber: 'INV-0002',
        date: new Date('2026-11-01T00:00:00.000Z'),
        time: '10:00',
        branchId: 'branch-1',
        clientId: 'client-nadia',
        clientName: 'Nadia',
        subtotal: D(1000),
        discount: D(0),
        netSales: D(1000),
        tax: D(0),
        total: D(1000),
        amountPaid: D(1000),
        amountDue: D(0),
        advanceAdjusted: D(0),
        paymentMethod: 'CASH',
        status: 'PAID',
        lifecycle: 'ACTIVE',
        processedByName: 'Admin User',
        notes: '',
        lines: [
          {
            id: 'line-1',
            type: 'SERVICE',
            netSales: D(1000),
            tax: D(0),
            staffId: 'staff-1',
            staffName: 'Stylist Aaliyan',
            staffCommissionRate: D(10),
            components: [],
          },
        ],
        payments: [p1, p2, p3],
        refunds: [],
      };

      const mockPrisma = {
        branch: {
          findMany: vi.fn().mockResolvedValue([{ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }]),
          findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Karachi Branch', city: 'Karachi' }),
        },
        staff: {
          findMany: vi.fn().mockResolvedValue([{ id: 'staff-1', name: 'Stylist Aaliyan', employeeCode: 'ST-001', branchId: 'branch-1' }]),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([{ id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' }]),
        },
        invoice: {
          findMany: vi.fn().mockImplementation((args) => {
            // Check date range filter
            const gte = args?.where?.date?.gte;
            const lte = args?.where?.date?.lte;
            const invDate = fullInvoice.date;
            if (gte && invDate < gte) return Promise.resolve([]);
            if (lte && invDate > lte) return Promise.resolve([]);
            return Promise.resolve([fullInvoice]);
          }),
        },
        invoicePayment: {
          findMany: vi.fn().mockImplementation((args) => {
            const gte = args?.where?.date?.gte;
            const lte = args?.where?.date?.lte;
            const allDues = [
              { ...p2, invoice: fullInvoice },
              { ...p3, invoice: fullInvoice },
            ];
            const filtered = allDues.filter((dp) => {
              if (gte && dp.date < gte) return false;
              if (lte && dp.date > lte) return false;
              return true;
            });
            return Promise.resolve(filtered);
          }),
        },
        invoiceRefund: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        expense: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        payrollRun: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        commissionEvent: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        stockMovement: {
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _sum: { totalCost: 0 } }),
        },
        invoiceLine: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { cogsAmount: 0 } }),
        },
        supplierPayment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        drawerMovement: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        accountMovement: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        bookingHistory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        tipReceipt: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        commissionRun: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        commissionPayment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      vi.doMock('../src/config/prisma.js', () => ({
        default: mockPrisma,
      }));

      vi.doMock('../src/modules/reports/staffLoanMovements.js', () => ({
        loadStaffLoanMovements: vi.fn().mockResolvedValue([]),
        STAFF_LOAN_CATEGORY: 'Staff Loan Disbursement (Non-Operating)',
        currentStaffLoanReceivable: vi.fn().mockResolvedValue(0),
      }));

      vi.doMock('../src/modules/reports/fullCommissionAccrual.js', () => ({
        accruedCommissionForPeriod: vi.fn().mockResolvedValue(D(0)),
      }));

      const { incomeExpenseReport } = await import('../src/modules/reports/reports.service.js');

      const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

      // ── TEST A: FULL PERIOD (2026-11-01 to 2026-11-03) ──
      // In this period: 1 original invoice + 2 dues payments = 3 distinct display rows
      const fullReport = await incomeExpenseReport(actor, {
        from: '2026-11-01',
        to: '2026-11-03',
        branchId: 'branch-1',
      });

      expect(fullReport.displayRows).toBeDefined();
      expect(fullReport.displayRows.length).toBe(3);

      const rOriginal = fullReport.displayRows.find((r) => r.recordType === 'ORIGINAL_INVOICE');
      expect(rOriginal).toBeDefined();
      expect(rOriginal.invoiceNumber).toBe('INV-0002');
      expect(rOriginal.serviceCollection).toBe(500); // Service portion collected on initial payment
      expect(rOriginal.totalBill).toBe(1000);
      expect(rOriginal.totalReceived).toBe(500);
      expect(rOriginal.balanceAfterPayment).toBe(500);
      expect(rOriginal.remainingDues).toBeNull(); // Superseded by subsequent payments #2 & #3
      expect(rOriginal.receiptNumber).toBe('RCP-0001');

      const rPay2 = fullReport.displayRows.find((r) => r.recordTypeLabel === 'Payment Receipt #2');
      expect(rPay2).toBeDefined();
      expect(rPay2.invoiceNumber).toBe('INV-0002');
      expect(rPay2.serviceCollection).toBe(300); // Service portion collected on receipt #2
      expect(rPay2.totalBill).toBe(0); // Bill NOT duplicated
      expect(rPay2.totalReceived).toBe(300);
      expect(rPay2.balanceAfterPayment).toBe(200);
      expect(rPay2.remainingDues).toBeNull(); // Superseded by receipt #3
      expect(rPay2.receiptNumber).toBe('RCP-0002');
      expect(rPay2.paymentMethod).toBe('ONLINE_ACCOUNT');
      expect(rPay2.paymentAccountName).toBe('Meezan Bank - Main Account');

      const rPay3 = fullReport.displayRows.find((r) => r.recordTypeLabel === 'Payment Receipt #3');
      expect(rPay3).toBeDefined();
      expect(rPay3.invoiceNumber).toBe('INV-0002');
      expect(rPay3.serviceCollection).toBe(200); // Service portion collected on receipt #3
      expect(rPay3.totalBill).toBe(0); // Bill NOT duplicated
      expect(rPay3.totalReceived).toBe(200);
      expect(rPay3.balanceAfterPayment).toBe(0);
      expect(rPay3.remainingDues).toBe(0); // Final payment settling invoice shows remaining dues: 0!
      expect(rPay3.receiptNumber).toBe('RCP-0003');
      expect(rPay3.paymentMethod).toBe('CASH');

      // Totals reconciliation:
      // Bill must be exactly 1000 (not 3000!)
      expect(fullReport.totals.customerInvoiceTotal).toBe(1000);
      // Collections must be exactly 1000 (500 + 300 + 200)
      expect(fullReport.totals.customerCollections).toBe(1000);
      // Service collection total = 1000
      expect(fullReport.totals.income).toBe(1000);
      // Outstanding balance is 0
      expect(fullReport.totals.totalOutstandingDues).toBe(0);

      // ── TEST B: HISTORICAL SINGLE DAY FILTER (2026-11-02 to 2026-11-02) ──
      // Original invoice is on 2026-11-01 (outside this filter).
      // Only payment 2 happened on 2026-11-02.
      // Report should show ONLY Payment Receipt #2 without duplicating bill revenue!
      const day2Report = await incomeExpenseReport(actor, {
        from: '2026-11-02',
        to: '2026-11-02',
        branchId: 'branch-1',
      });

      expect(day2Report.displayRows.length).toBe(1);
      const day2Row = day2Report.displayRows[0];
      expect(day2Row.recordType).toBe('SUBSEQUENT_PAYMENT');
      expect(day2Row.recordTypeLabel).toBe('Payment Receipt #2');
      expect(day2Row.invoiceNumber).toBe('INV-0002');
      expect(day2Row.serviceCollection).toBe(300); // Actual service portion collected on this day
      expect(day2Row.totalBill).toBe(0);
      expect(day2Row.totalReceived).toBe(300);
      expect(day2Row.balanceAfterPayment).toBe(200);
      expect(day2Row.remainingDues).toBe(200); // Only visible row in period for this invoice shows balance as of this receipt!
      expect(day2Row.paymentMethod).toBe('ONLINE_ACCOUNT');
      expect(day2Row.paymentAccountName).toBe('Meezan Bank - Main Account');
      expect(day2Report.totals.customerCollections).toBe(300);
    });
  });
});
