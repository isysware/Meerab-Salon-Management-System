// backend/tests/inventory-fifo-fefo.test.js
// Unit & Integration Regression Suite for Batch 1: Inventory, FIFO/FEFO & Stock Consumption

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v);

describe('Batch 1 · FIFO / FEFO Cost Layer Engine (pickBatches)', () => {
  let mockBatches;
  let mockTx;

  beforeEach(() => {
    mockBatches = [];
    mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Argan Oil Mask', trackBatch: true }),
      },
      inventoryBatch: {
        findMany: vi.fn().mockImplementation(async (query) => {
          const { allowExpired, businessDate } = query;
          // Filter candidate batches
          return mockBatches.filter((b) => {
            if (b.status !== 'VALID' || b.remainingQuantity <= 0) return false;
            return true;
          });
        }),
      },
    };
  });

  it('FIFO Invariant: Non-expirable items consume oldest received batch first', async () => {
    const { pickBatches } = await import('../src/lib/stock.js');

    // Batch A: 10 units @ 100 PKR, received 2026-09-01
    // Batch B: 10 units @ 200 PKR, received 2026-09-15
    mockBatches = [
      { id: 'b-b', batchNumber: 'BATCH-B', remainingQuantity: D(10), unitCost: D(200), receivedDate: new Date('2026-09-15'), expiryDate: null, status: 'VALID' },
      { id: 'b-a', batchNumber: 'BATCH-A', remainingQuantity: D(10), unitCost: D(100), receivedDate: new Date('2026-09-01'), expiryDate: null, status: 'VALID' },
    ];

    // Request 12 units
    const picks = await pickBatches(mockTx, {
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 12,
      businessDate: '2026-10-01',
      itemName: 'Argan Oil Mask',
    });

    expect(picks).toHaveLength(2);
    // First pick: 10 units from Batch A @ 100
    expect(picks[0].batch.batchNumber).toBe('BATCH-A');
    expect(picks[0].quantity.toNumber()).toBe(10);
    // Second pick: 2 units from Batch B @ 200
    expect(picks[1].batch.batchNumber).toBe('BATCH-B');
    expect(picks[1].quantity.toNumber()).toBe(2);

    // Total cost impact = (10 × 100) + (2 × 200) = 1,400 PKR
    const totalCost = picks.reduce((sum, p) => sum.plus(p.quantity.times(p.batch.unitCost)), new Decimal(0));
    expect(totalCost.toNumber()).toBe(1400);
  });

  it('FEFO Invariant: Expirable items consume earliest expiring batch first, even if received later', async () => {
    const { pickBatches } = await import('../src/lib/stock.js');

    // Batch 1: Received 2026-09-01 (older), expires 2028-12-31 (later)
    // Batch 2: Received 2026-09-20 (newer), expires 2027-06-30 (earlier!)
    mockBatches = [
      { id: 'b-1', batchNumber: 'BATCH-1', remainingQuantity: D(10), unitCost: D(150), receivedDate: new Date('2026-09-01'), expiryDate: new Date('2028-12-31'), status: 'VALID' },
      { id: 'b-2', batchNumber: 'BATCH-2', remainingQuantity: D(10), unitCost: D(180), receivedDate: new Date('2026-09-20'), expiryDate: new Date('2027-06-30'), status: 'VALID' },
    ];

    // Request 6 units
    const picks = await pickBatches(mockTx, {
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 6,
      businessDate: '2026-10-01',
      itemName: 'Argan Oil Mask',
    });

    expect(picks).toHaveLength(1);
    // FEFO must pick Batch 2 because it expires earlier (2027-06-30 < 2028-12-31)
    expect(picks[0].batch.batchNumber).toBe('BATCH-2');
    expect(picks[0].quantity.toNumber()).toBe(6);
    expect(picks[0].batch.unitCost.toNumber()).toBe(180);
  });

  it('FEFO Tie-Breaker: When expiry dates are identical, fallback to FIFO (received date)', async () => {
    const { pickBatches } = await import('../src/lib/stock.js');

    // Both expire on 2027-12-31.
    // Batch X: received 2026-08-01 (older)
    // Batch Y: received 2026-09-01 (newer)
    mockBatches = [
      { id: 'b-y', batchNumber: 'BATCH-Y', remainingQuantity: D(5), unitCost: D(120), receivedDate: new Date('2026-09-01'), expiryDate: new Date('2027-12-31'), status: 'VALID' },
      { id: 'b-x', batchNumber: 'BATCH-X', remainingQuantity: D(5), unitCost: D(110), receivedDate: new Date('2026-08-01'), expiryDate: new Date('2027-12-31'), status: 'VALID' },
    ];

    const picks = await pickBatches(mockTx, {
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 7,
      businessDate: '2026-10-01',
      itemName: 'Argan Oil Mask',
    });

    expect(picks).toHaveLength(2);
    // FIFO tie breaker: Batch X first (5 units), then Batch Y (2 units)
    expect(picks[0].batch.batchNumber).toBe('BATCH-X');
    expect(picks[0].quantity.toNumber()).toBe(5);
    expect(picks[1].batch.batchNumber).toBe('BATCH-Y');
    expect(picks[1].quantity.toNumber()).toBe(2);
  });

  it('Insufficient Stock Invariant: Throws 409 conflict when requested quantity exceeds available valid batches', async () => {
    const { pickBatches } = await import('../src/lib/stock.js');

    mockBatches = [
      { id: 'b-1', batchNumber: 'BATCH-1', remainingQuantity: D(4), unitCost: D(100), receivedDate: new Date('2026-09-01'), expiryDate: null, status: 'VALID' },
    ];

    await expect(
      pickBatches(mockTx, {
        itemId: 'item-1',
        branchId: 'branch-1',
        quantity: 10, // Requesting 10 when only 4 available
        businessDate: '2026-10-01',
        itemName: 'Argan Oil Mask',
      })
    ).rejects.toThrow(/Insufficient sellable stock/);
  });
});

describe('Batch 1 · Live Consumption Preview (previewBatchPicks)', () => {
  it('Returns accurate cost breakdown and fulfillability without mutating state', async () => {
    const { previewBatchPicks } = await import('../src/lib/stock.js');

    const mockPrisma = {
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Argan Mask', trackExpiry: false }),
      },
      inventoryBatch: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b-1', batchNumber: 'B-001', remainingQuantity: D(10), unitCost: D(100), receivedDate: new Date('2026-09-01'), expiryDate: null, status: 'VALID' },
          { id: 'b-2', batchNumber: 'B-002', remainingQuantity: D(10), unitCost: D(200), receivedDate: new Date('2026-09-15'), expiryDate: null, status: 'VALID' },
        ]),
      },
    };

    const result = await previewBatchPicks(mockPrisma, {
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 15,
      businessDate: '2026-10-01',
    });

    expect(result.availableStock).toBe(20);
    expect(result.requestedQuantity).toBe(15);
    expect(result.isFulfillable).toBe(true);
    // 10 @ 100 (1,000) + 5 @ 200 (1,000) = 2,000 PKR
    expect(result.totalCost).toBe(2000);
    expect(result.costBreakdown).toHaveLength(2);
    expect(result.costBreakdown[0]).toMatchObject({ batchNumber: 'B-001', quantity: 10, unitCostSnapshot: 100, costImpact: 1000 });
    expect(result.costBreakdown[1]).toMatchObject({ batchNumber: 'B-002', quantity: 5, unitCostSnapshot: 200, costImpact: 1000 });
  });

  it('Flags isFulfillable as false when stock is insufficient', async () => {
    const { previewBatchPicks } = await import('../src/lib/stock.js');

    const mockPrisma = {
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Argan Mask', trackExpiry: false }),
      },
      inventoryBatch: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b-1', batchNumber: 'B-001', remainingQuantity: D(3), unitCost: D(100), receivedDate: new Date('2026-09-01'), expiryDate: null, status: 'VALID' },
        ]),
      },
    };

    const result = await previewBatchPicks(mockPrisma, {
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 5,
      businessDate: '2026-10-01',
    });

    expect(result.availableStock).toBe(3);
    expect(result.requestedQuantity).toBe(5);
    expect(result.isFulfillable).toBe(false);
  });
});

describe('Batch 1 · Stock Movement Compensating Reversal (reverseStockMovement)', () => {
  it('Creates compensating POSITIVE_ADJUSTMENT movement and restores batch quantity', async () => {
    const { reverseStockMovement } = await import('../src/lib/stock.js');

    const originalBatch = {
      id: 'batch-target',
      batchNumber: 'B-REV-01',
      remainingQuantity: D(2),
      status: 'VALID',
    };

    const originalMovement = {
      id: 'mov-1',
      movementNumber: 'SM-001',
      branchId: 'branch-1',
      itemId: 'item-1',
      batchId: 'batch-target',
      movementType: 'SALON_CONSUMPTION_OUT',
      direction: 'OUT',
      quantity: D(8),
      unitCost: D(150),
      reason: 'Bridal service consumption',
      branch: { code: 'LHE', name: 'Lahore Branch' },
      batch: originalBatch,
    };

    let updatedBatchQuantity = null;
    let createdMovement = null;

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ lastValue: 1 }]),
      stockMovement: {
        findUnique: vi.fn().mockResolvedValue(originalMovement),
        findFirst: vi.fn().mockResolvedValue(null), // No prior reversal
        findMany: vi.fn().mockResolvedValue([]), // For sequence generator
        create: vi.fn().mockImplementation(async ({ data }) => {
          createdMovement = data;
          return { id: 'rev-mov-1', ...data };
        }),
      },
      inventoryBatch: {
        findUnique: vi.fn().mockResolvedValue(originalBatch),
        update: vi.fn().mockImplementation(async ({ data }) => {
          updatedBatchQuantity = data.remainingQuantity;
          return { ...originalBatch, ...data };
        }),
      },
    };

    const reversed = await reverseStockMovement(mockTx, {
      movementId: 'mov-1',
      reason: 'Mistakenly deducted excess bottles',
      actor: { id: 'u-admin', name: 'Admin User' },
      branchId: 'branch-1',
    });

    expect(reversed).toBeDefined();
    expect(createdMovement.movementType).toBe('POSITIVE_ADJUSTMENT');
    expect(createdMovement.direction).toBe('IN');
    expect(createdMovement.quantity.toNumber()).toBe(8);
    expect(createdMovement.unitCost.toNumber()).toBe(150);
    expect(createdMovement.sourceReferenceType).toBe('STOCK_MOVEMENT_REVERSAL');
    expect(createdMovement.sourceReferenceId).toBe('mov-1');

    // Batch quantity should be restored: 2 + 8 = 10
    expect(updatedBatchQuantity.toNumber()).toBe(10);
  });

  it('Rejects reversal if the movement has already been reversed', async () => {
    const { reverseStockMovement } = await import('../src/lib/stock.js');

    const mockTx = {
      stockMovement: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'mov-1',
          branchId: 'branch-1',
          movementType: 'MANUAL_OUT',
          direction: 'OUT',
          quantity: D(5),
          unitCost: D(100),
          branch: { code: 'LHE' },
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-reversal' }), // Already reversed!
      },
    };

    await expect(
      reverseStockMovement(mockTx, {
        movementId: 'mov-1',
        reason: 'Duplicate reversal attempt',
        actor: { id: 'u-1', name: 'Admin' },
        branchId: 'branch-1',
      })
    ).rejects.toThrow(/already reversed/);
  });
});
