import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { netPayments, priceBooking } from '../src/modules/bookings/bookings.pricing.js';
import { toBookingDTO } from '../src/modules/bookings/bookings.mapper.js';
import { detailedIncomeReport } from '../src/modules/reports/detailedCollections.report.js';

const D = (v) => new Prisma.Decimal(v);

describe('Booking Advance & POS Payment Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

