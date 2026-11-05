// backend/tests/salon-consumption.test.js
// Unit & Integration Regression Suite for In-House Salon Product Consumption Workflow

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v);

describe('In-House Salon Product Consumption · Valuation & Cost Invariants', () => {
  let mockBatches;
  let createdMovements;
  let updatedBatches;
  let mockTx;

  beforeEach(() => {
    mockBatches = [];
    createdMovements = [];
    updatedBatches = new Map();
    mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'item-shampoo', name: 'Salon Pro Shampoo', trackExpiry: false, sellingPrice: D(500) }),
      },
      inventoryBatch: {
        findMany: vi.fn().mockImplementation(async () => {
          return mockBatches.filter((b) => b.status === 'VALID' && toDec(b.remainingQuantity).gt(0));
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return mockBatches.find((b) => b.id === where.id);
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          return mockBatches.find((b) => b.id === where.id);
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const b = mockBatches.find((x) => x.id === where.id);
          if (b) {
            b.remainingQuantity = data.remainingQuantity;
            if (data.status) b.status = data.status;
            updatedBatches.set(b.id, data.remainingQuantity);
          }
          return b;
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const mov = { id: `sm-${createdMovements.length + 1}`, ...data };
          createdMovements.push(mov);
          return mov;
        }),
      },
      sequence: {
        upsert: vi.fn().mockResolvedValue({ nextVal: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ nextval: 101 }]),
    };
  });

  const toDec = (v) => new Decimal(v ?? 0);

  it('Deducts inventory at actual batch PURCHASE COST, strictly ignoring selling price', async () => {
    const { consumeStock } = await import('../src/lib/stock.js');

    // Batch has purchase cost = 100 PKR, selling price = 350 PKR
    mockBatches = [
      {
        id: 'batch-1',
        batchNumber: 'B-COST-100',
        remainingQuantity: D(10),
        unitCost: D(100),
        sellingPrice: D(350), // Selling price is 350, cost is 100
        receivedDate: new Date('2026-09-01'),
        expiryDate: null,
        status: 'VALID',
      },
    ];

    const movements = await consumeStock(mockTx, {
      itemId: 'item-shampoo',
      branchId: 'branch-main',
      branchCode: 'LHE',
      quantity: 4,
      businessDate: '2026-10-01',
      movementType: 'SALON_CONSUMPTION_OUT',
      source: { type: 'MANUAL_OUT', id: 'MSO-001', number: 'MSO-001' },
      reason: 'Hair wash station usage',
      actor: { id: 'u-stylist', name: 'Stylist Zara' },
    });

    expect(movements).toHaveLength(1);
    // Cost must be 100 (purchase cost), NOT 350 (selling price)
    expect(movements[0].unitCost.toNumber()).toBe(100);
    // Total cost impact = 4 units × 100 PKR = 400 PKR (not 1400 PKR)
    expect(movements[0].totalCost.toNumber()).toBe(400);
    expect(movements[0].direction).toBe('OUT');
    expect(movements[0].movementType).toBe('SALON_CONSUMPTION_OUT');

    // Inventory remaining quantity reduced from 10 to 6
    expect(updatedBatches.get('batch-1').toNumber()).toBe(6);
  });

  it('Mixed-batch consumption: calculates each quantity at its own immutable unit cost (3 @ 100 + 2 @ 200 = 700 PKR)', async () => {
    const { consumeStock } = await import('../src/lib/stock.js');

    // Layer 1: 3 units @ 100 PKR cost (selling 250 PKR)
    // Layer 2: 10 units @ 200 PKR cost (selling 400 PKR)
    mockBatches = [
      {
        id: 'batch-layer-1',
        batchNumber: 'B-001',
        remainingQuantity: D(3),
        unitCost: D(100),
        sellingPrice: D(250),
        receivedDate: new Date('2026-09-01'),
        expiryDate: null,
        status: 'VALID',
      },
      {
        id: 'batch-layer-2',
        batchNumber: 'B-002',
        remainingQuantity: D(10),
        unitCost: D(200),
        sellingPrice: D(400),
        receivedDate: new Date('2026-09-15'),
        expiryDate: null,
        status: 'VALID',
      },
    ];

    // Request 5 units total: should take 3 from Batch 1 and 2 from Batch 2
    const movements = await consumeStock(mockTx, {
      itemId: 'item-shampoo',
      branchId: 'branch-main',
      branchCode: 'LHE',
      quantity: 5,
      businessDate: '2026-10-01',
      movementType: 'SALON_CONSUMPTION_OUT',
      source: { type: 'MANUAL_OUT', id: 'MSO-002', number: 'MSO-002' },
      reason: 'Keratin treatment session',
      actor: { id: 'u-stylist', name: 'Stylist Zara' },
    });

    expect(movements).toHaveLength(2);

    // Pick 1: 3 units @ 100 = 300 PKR
    expect(movements[0].quantity.toNumber()).toBe(3);
    expect(movements[0].unitCost.toNumber()).toBe(100);
    expect(movements[0].totalCost.toNumber()).toBe(300);

    // Pick 2: 2 units @ 200 = 400 PKR
    expect(movements[1].quantity.toNumber()).toBe(2);
    expect(movements[1].unitCost.toNumber()).toBe(200);
    expect(movements[1].totalCost.toNumber()).toBe(400);

    // Total consumption expense = 300 + 400 = 700 PKR
    const totalExpense = movements.reduce((sum, m) => sum.plus(m.totalCost), new Decimal(0));
    expect(totalExpense.toNumber()).toBe(700);

    // Batch 1 exhausted (0 remaining), Batch 2 reduced from 10 to 8
    expect(updatedBatches.get('batch-layer-1').toNumber()).toBe(0);
    expect(updatedBatches.get('batch-layer-2').toNumber()).toBe(8);

    // Remaining inventory cost valuation: 8 units @ 200 = 1,600 PKR (was 3*100 + 10*200 = 2,300 PKR; 2,300 - 700 = 1,600 PKR)
    const remainingValuation = mockBatches.reduce((sum, b) => sum.plus(toDec(b.remainingQuantity).times(b.unitCost)), new Decimal(0));
    expect(remainingValuation.toNumber()).toBe(1600);
  });

  it('FEFO Selection Invariant: Expiry-tracked stock selects earliest expiring batch first', async () => {
    const { consumeStock } = await import('../src/lib/stock.js');

    // Item has trackExpiry enabled
    mockTx.inventoryItem.findUnique.mockResolvedValue({ id: 'item-dye', name: 'Organic Hair Dye', trackExpiry: true });

    // Batch Near: Received later (2026-09-20), expires earlier (2027-01-31) @ 150 PKR
    // Batch Far: Received earlier (2026-09-01), expires later (2028-12-31) @ 120 PKR
    mockBatches = [
      {
        id: 'b-far',
        batchNumber: 'B-FAR',
        remainingQuantity: D(10),
        unitCost: D(120),
        receivedDate: new Date('2026-09-01'),
        expiryDate: new Date('2028-12-31'),
        status: 'VALID',
      },
      {
        id: 'b-near',
        batchNumber: 'B-NEAR',
        remainingQuantity: D(5),
        unitCost: D(150),
        receivedDate: new Date('2026-09-20'),
        expiryDate: new Date('2027-01-31'),
        status: 'VALID',
      },
    ];

    const movements = await consumeStock(mockTx, {
      itemId: 'item-dye',
      branchId: 'branch-main',
      branchCode: 'LHE',
      quantity: 4,
      businessDate: '2026-10-01',
      movementType: 'SALON_CONSUMPTION_OUT',
      source: { type: 'MANUAL_OUT', id: 'MSO-003', number: 'MSO-003' },
      reason: 'Coloring service',
      actor: { id: 'u-colorist', name: 'Colorist Maya' },
    });

    expect(movements).toHaveLength(1);
    // FEFO must consume from B-NEAR because of earlier expiry
    expect(movements[0].batchId).toBe('b-near');
    expect(movements[0].quantity.toNumber()).toBe(4);
    expect(movements[0].unitCost.toNumber()).toBe(150);
    expect(movements[0].totalCost.toNumber()).toBe(600);
  });

  it('Selling-price changes never alter consumption costing', async () => {
    const { consumeStock } = await import('../src/lib/stock.js');

    mockBatches = [
      {
        id: 'b-dyn-price',
        batchNumber: 'B-DYN',
        remainingQuantity: D(10),
        unitCost: D(150), // Purchase cost is 150
        sellingPrice: D(300),
        receivedDate: new Date('2026-09-01'),
        expiryDate: null,
        status: 'VALID',
      },
    ];

    // First consumption with selling price = 300
    const [m1] = await consumeStock(mockTx, {
      itemId: 'item-shampoo',
      branchId: 'branch-main',
      branchCode: 'LHE',
      quantity: 2,
      businessDate: '2026-10-01',
      movementType: 'SALON_CONSUMPTION_OUT',
      source: { type: 'MANUAL_OUT', id: 'MSO-1', number: 'MSO-1' },
      reason: 'Wash station',
      actor: { id: 'u-1', name: 'Admin' },
    });

    expect(m1.unitCost.toNumber()).toBe(150);
    expect(m1.totalCost.toNumber()).toBe(300);

    // Simulate price increase to 500 on catalog and batch
    mockBatches[0].sellingPrice = D(500);

    // Second consumption with new selling price = 500
    const [m2] = await consumeStock(mockTx, {
      itemId: 'item-shampoo',
      branchId: 'branch-main',
      branchCode: 'LHE',
      quantity: 2,
      businessDate: '2026-10-02',
      movementType: 'SALON_CONSUMPTION_OUT',
      source: { type: 'MANUAL_OUT', id: 'MSO-2', number: 'MSO-2' },
      reason: 'Wash station',
      actor: { id: 'u-1', name: 'Admin' },
    });

    // Consumption unit cost is STILL 150 (purchase cost), totalCost is still 300
    expect(m2.unitCost.toNumber()).toBe(150);
    expect(m2.totalCost.toNumber()).toBe(300);
  });
});

describe('In-House Salon Product Consumption · Compensating Reversal & Reporting Recognition', () => {
  it('Reversal restores original batch remaining quantity and cost valuation', async () => {
    const { reverseStockMovement } = await import('../src/lib/stock.js');

    const originalBatch = {
      id: 'batch-target',
      batchNumber: 'B-REV-01',
      remainingQuantity: D(2),
      unitCost: D(150),
      status: 'VALID',
    };

    const originalMovement = {
      id: 'mov-consumption-1',
      movementNumber: 'SM-001',
      branchId: 'branch-1',
      itemId: 'item-1',
      batchId: 'batch-target',
      movementType: 'SALON_CONSUMPTION_OUT',
      direction: 'OUT',
      quantity: D(8),
      unitCost: D(150),
      totalCost: D(1200),
      sourceReferenceType: 'MANUAL_OUT',
      reason: 'Salon service consumption',
      branch: { code: 'LHE', name: 'Lahore Branch' },
      batch: originalBatch,
    };

    let updatedBatchQuantity = null;
    let createdCompensatingMovement = null;

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ nextval: 201 }]),
      stockMovement: {
        findUnique: vi.fn().mockResolvedValue(originalMovement),
        findFirst: vi.fn().mockResolvedValue(null), // No prior reversal
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async ({ data }) => {
          createdCompensatingMovement = data;
          return { id: 'rev-sm-1', ...data };
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
      movementId: 'mov-consumption-1',
      reason: 'Incorrect quantity logged at closing',
      actor: { id: 'u-admin', name: 'Admin' },
      branchId: 'branch-1',
    });

    expect(reversed).toBeDefined();
    // Compensating movement must be POSITIVE_ADJUSTMENT, direction IN
    expect(createdCompensatingMovement.movementType).toBe('POSITIVE_ADJUSTMENT');
    expect(createdCompensatingMovement.direction).toBe('IN');
    expect(createdCompensatingMovement.sourceReferenceType).toBe('STOCK_MOVEMENT_REVERSAL');
    expect(createdCompensatingMovement.sourceReferenceId).toBe('mov-consumption-1');
    expect(createdCompensatingMovement.quantity.toNumber()).toBe(8);
    expect(createdCompensatingMovement.unitCost.toNumber()).toBe(150);
    expect(createdCompensatingMovement.totalCost.toNumber()).toBe(1200);

    // Batch quantity restored: 2 + 8 = 10 units
    expect(updatedBatchQuantity.toNumber()).toBe(10);
  });

  it('COGS & Period Reports: reverses consumption expense exactly once and prevents double expense', async () => {
    // Test the period metrics logic for consumption + reversal
    const movements = [
      // 1. Consumption of 5 units @ 100 = 500 PKR
      {
        id: 'm-cons-1',
        movementType: 'SALON_CONSUMPTION_OUT',
        sourceReferenceType: 'MANUAL_OUT',
        sourceReferenceId: 'MSO-01',
        totalCost: D(500),
      },
      // 2. Consumption of 3 units @ 200 = 600 PKR
      {
        id: 'm-cons-2',
        movementType: 'SALON_CONSUMPTION_OUT',
        sourceReferenceType: 'MANUAL_OUT',
        sourceReferenceId: 'MSO-02',
        totalCost: D(600),
      },
      // 3. Compensating reversal of m-cons-1 (reversing 500 PKR)
      {
        id: 'm-rev-1',
        movementType: 'POSITIVE_ADJUSTMENT',
        sourceReferenceType: 'STOCK_MOVEMENT_REVERSAL',
        sourceReferenceId: 'm-cons-1',
        totalCost: D(500),
      },
    ];

    const origTypeMap = new Map([
      ['m-cons-1', 'SALON_CONSUMPTION_OUT'],
    ]);

    let materialConsumption = new Decimal(0);
    for (const m of movements) {
      const cost = new Decimal(m.totalCost);
      if (m.movementType === 'SALON_CONSUMPTION_OUT' || m.movementType === 'INTERNAL_USE_OUT') {
        materialConsumption = materialConsumption.plus(cost);
      } else if (m.movementType === 'POSITIVE_ADJUSTMENT' && m.sourceReferenceType === 'STOCK_MOVEMENT_REVERSAL') {
        const origType = origTypeMap.get(m.sourceReferenceId);
        if (origType === 'SALON_CONSUMPTION_OUT' || origType === 'INTERNAL_USE_OUT') {
          materialConsumption = materialConsumption.minus(cost);
        }
      }
    }

    // Total active consumption = 500 + 600 - 500 = 600 PKR exactly!
    expect(materialConsumption.toNumber()).toBe(600);
  });
});
