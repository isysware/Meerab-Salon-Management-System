// backend/tests/purchase-return-workflow.test.js
// Automated test suite for Complete Purchase Return & Supplier Settlement Workflow

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

const D = (v) => new Prisma.Decimal(v);

describe('Complete Inventory Purchase Return & Supplier Settlement Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('Scenario A: Unpaid purchase return decreases payable from 1,000 to 700 with zero cash movement', async () => {
    const mockPurchase = {
      id: 'pur-001',
      purchaseNumber: 'PO-001',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      supplierName: 'ABC Cosmetics',
      purchaseDate: new Date('2026-11-01'),
      netAmount: D(1000),
      paidAmount: D(0),
      balanceDue: D(1000),
      paymentStatus: 'UNPAID',
      lines: [
        {
          id: 'pline-1',
          itemId: 'item-1',
          itemName: 'Keratin Shampoo 500ml',
          itemSku: 'SHAMP-001',
          batchId: 'bat-1',
          batchNumber: 'BAT-001',
          quantity: D(10),
          unitPurchaseCost: D(100),
          landedUnitCost: D(100),
        },
      ],
    };

    const mockBatch = {
      id: 'bat-1',
      itemId: 'item-1',
      branchId: 'branch-1',
      batchNumber: 'BAT-001',
      remainingQuantity: D(10),
      unitCost: D(100),
    };

    let updatedPurchase = null;
    let createdLedger = null;
    let createdReturn = null;

    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        $transaction: vi.fn(async (cb) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi.fn().mockResolvedValue([{ lastValue: 1 }]),
            auditEvent: { create: vi.fn().mockResolvedValue({}) },
            systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
            branch: { findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', code: 'LHE', isActive: true }) },
            supplier: { findUnique: vi.fn().mockResolvedValue({ id: 'sup-1', name: 'ABC Cosmetics', isActive: true, branchId: 'branch-1' }) },
            purchase: {
              findFirst: vi.fn().mockResolvedValue(mockPurchase),
              update: vi.fn().mockImplementation((args) => {
                updatedPurchase = args.data;
                return { ...mockPurchase, ...args.data };
              }),
            },
            supplierReturn: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'ret-1', returnNumber: 'PR-LHE-0001' }),
              update: vi.fn().mockImplementation((args) => {
                createdReturn = args.data;
                return { id: 'ret-1', returnNumber: 'PR-LHE-0001', ...args.data, lines: [] };
              }),
            },
            supplierReturnLine: { create: vi.fn().mockResolvedValue({}) },
            inventoryItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Keratin Shampoo 500ml', sku: 'SHAMP-001' }) },
            inventoryBatch: {
              findFirst: vi.fn().mockResolvedValue(mockBatch),
              findUnique: vi.fn().mockResolvedValue(mockBatch),
              update: vi.fn().mockResolvedValue(mockBatch),
            },
            stockMovement: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
            },
            supplierLedger: {
              create: vi.fn().mockImplementation((args) => {
                createdLedger = args.data;
                return { id: 'led-1', ...args.data };
              }),
            },
          };
          return cb(tx);
        }),
      },
    }));

    const { createReturn } = await import('../src/modules/inventory/inventory.service.js');
    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

    const result = await createReturn(
      {
        branchId: 'branch-1',
        supplierId: 'sup-1',
        purchaseId: 'pur-001',
        reason: 'DEFECTIVE',
        refundTreatment: 'REDUCE_PAYABLE',
        lines: [{ itemId: 'item-1', batchId: 'bat-1', quantity: 3 }],
      },
      actor
    );

    expect(result).toBeDefined();
    // 3 items * PKR 100 = PKR 300
    expect(createdReturn.totalAmount.toNumber()).toBe(300);
    // Purchase balanceDue reduced from 1,000 to 700
    expect(updatedPurchase.balanceDue.toNumber()).toBe(700);
    expect(updatedPurchase.paymentStatus).toBe('UNPAID');
    // Supplier ledger debited by 300
    expect(createdLedger.entryType).toBe('PURCHASE_RETURN');
    expect(createdLedger.debit.toNumber()).toBe(300);
  });

  it('Scenario B: Partially paid purchase return decreases balance due from 500 to 200', async () => {
    const mockPurchase = {
      id: 'pur-002',
      purchaseNumber: 'PO-002',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      supplierName: 'ABC Cosmetics',
      purchaseDate: new Date('2026-11-01'),
      netAmount: D(1000),
      paidAmount: D(500),
      balanceDue: D(500),
      paymentStatus: 'PARTIAL',
      lines: [
        {
          id: 'pline-2',
          itemId: 'item-1',
          itemName: 'Keratin Shampoo 500ml',
          itemSku: 'SHAMP-001',
          batchId: 'bat-1',
          batchNumber: 'BAT-001',
          quantity: D(10),
          unitPurchaseCost: D(100),
          landedUnitCost: D(100),
        },
      ],
    };

    const mockBatch = {
      id: 'bat-1',
      itemId: 'item-1',
      branchId: 'branch-1',
      batchNumber: 'BAT-001',
      remainingQuantity: D(10),
      unitCost: D(100),
    };

    let updatedPurchase = null;

    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        $transaction: vi.fn(async (cb) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi.fn().mockResolvedValue([{ lastValue: 1 }]),
            auditEvent: { create: vi.fn().mockResolvedValue({}) },
            systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
            branch: { findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', code: 'LHE', isActive: true }) },
            supplier: { findUnique: vi.fn().mockResolvedValue({ id: 'sup-1', name: 'ABC Cosmetics', isActive: true, branchId: 'branch-1' }) },
            purchase: {
              findFirst: vi.fn().mockResolvedValue(mockPurchase),
              update: vi.fn().mockImplementation((args) => {
                updatedPurchase = args.data;
                return { ...mockPurchase, ...args.data };
              }),
            },
            supplierReturn: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'ret-2', returnNumber: 'PR-LHE-0002' }),
              update: vi.fn().mockResolvedValue({ id: 'ret-2', returnNumber: 'PR-LHE-0002', lines: [] }),
            },
            supplierReturnLine: { create: vi.fn().mockResolvedValue({}) },
            inventoryItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Keratin Shampoo 500ml', sku: 'SHAMP-001' }) },
            inventoryBatch: {
              findFirst: vi.fn().mockResolvedValue(mockBatch),
              findUnique: vi.fn().mockResolvedValue(mockBatch),
              update: vi.fn().mockResolvedValue(mockBatch),
            },
            stockMovement: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'sm-2' }),
            },
            supplierLedger: { create: vi.fn().mockResolvedValue({ id: 'led-2' }) },
          };
          return cb(tx);
        }),
      },
    }));

    const { createReturn } = await import('../src/modules/inventory/inventory.service.js');
    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

    await createReturn(
      {
        branchId: 'branch-1',
        supplierId: 'sup-1',
        purchaseId: 'pur-002',
        reason: 'DAMAGED',
        refundTreatment: 'REDUCE_PAYABLE',
        lines: [{ itemId: 'item-1', batchId: 'bat-1', quantity: 3 }],
      },
      actor
    );

    // Balance due decreases from 500 by 300 to 200
    expect(updatedPurchase.balanceDue.toNumber()).toBe(200);
    expect(updatedPurchase.paymentStatus).toBe('PARTIAL');
  });

  it('Scenario C & D: Return credit exceeds payable, offsets payable to 0, and records subsequent refund cash-in', async () => {
    // Purchase 1,000, paid 800, outstanding 200. Return 300.
    const mockPurchase = {
      id: 'pur-003',
      purchaseNumber: 'PO-003',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      supplierName: 'ABC Cosmetics',
      purchaseDate: new Date('2026-11-01'),
      netAmount: D(1000),
      paidAmount: D(800),
      balanceDue: D(200),
      paymentStatus: 'PARTIAL',
      lines: [
        {
          id: 'pline-3',
          itemId: 'item-1',
          itemName: 'Keratin Shampoo 500ml',
          itemSku: 'SHAMP-001',
          batchId: 'bat-1',
          batchNumber: 'BAT-001',
          quantity: D(10),
          unitPurchaseCost: D(100),
          landedUnitCost: D(100),
        },
      ],
    };

    const mockBatch = {
      id: 'bat-1',
      itemId: 'item-1',
      branchId: 'branch-1',
      batchNumber: 'BAT-001',
      remainingQuantity: D(10),
      unitCost: D(100),
    };

    let updatedPurchase = null;
    let ledgerEntries = [];
    let cashMovements = [];

    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        $transaction: vi.fn(async (cb) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi.fn().mockResolvedValue([{ lastValue: 1 }]),
            auditEvent: { create: vi.fn().mockResolvedValue({}) },
            systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
            branch: { findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', code: 'LHE', isActive: true }) },
            supplier: { findUnique: vi.fn().mockResolvedValue({ id: 'sup-1', name: 'ABC Cosmetics', isActive: true, branchId: 'branch-1' }) },
            purchase: {
              findFirst: vi.fn().mockResolvedValue(mockPurchase),
              update: vi.fn().mockImplementation((args) => {
                updatedPurchase = args.data;
                return { ...mockPurchase, ...args.data };
              }),
            },
            supplierReturn: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'ret-3', returnNumber: 'PR-LHE-0003' }),
              update: vi.fn().mockResolvedValue({ id: 'ret-3', returnNumber: 'PR-LHE-0003', lines: [] }),
            },
            supplierReturnLine: { create: vi.fn().mockResolvedValue({}) },
            inventoryItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Keratin Shampoo 500ml', sku: 'SHAMP-001' }) },
            inventoryBatch: {
              findFirst: vi.fn().mockResolvedValue(mockBatch),
              findUnique: vi.fn().mockResolvedValue(mockBatch),
              update: vi.fn().mockResolvedValue(mockBatch),
            },
            stockMovement: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'sm-3' }),
            },
            supplierLedger: {
              create: vi.fn().mockImplementation((args) => {
                ledgerEntries.push(args.data);
                return { id: `led-${ledgerEntries.length}`, ...args.data };
              }),
            },
            cashDrawer: {
              findMany: vi.fn().mockResolvedValue([{ id: 'drawer-1', status: 'OPEN', custodianUserId: 'user-admin', branchId: 'branch-1' }]),
              findFirst: vi.fn().mockResolvedValue({ id: 'drawer-1', status: 'OPEN', custodianUserId: 'user-admin', branchId: 'branch-1' }),
              findUnique: vi.fn().mockResolvedValue({ id: 'drawer-1', status: 'OPEN', custodianUserId: 'user-admin', branchId: 'branch-1' }),
              update: vi.fn().mockResolvedValue({ id: 'drawer-1', status: 'OPEN' }),
            },
            drawerMovement: {
              create: vi.fn().mockImplementation((args) => {
                cashMovements.push(args.data);
                return { id: `dm-${cashMovements.length}`, ...args.data };
              }),
            },
          };
          return cb(tx);
        }),
      },
    }));

    const { createReturn, recordSupplierRefund } = await import('../src/modules/inventory/inventory.service.js');
    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

    // 1. Post return of PKR 300
    await createReturn(
      {
        branchId: 'branch-1',
        supplierId: 'sup-1',
        purchaseId: 'pur-003',
        reason: 'EXPIRED',
        refundTreatment: 'REDUCE_PAYABLE',
        lines: [{ itemId: 'item-1', batchId: 'bat-1', quantity: 3 }],
      },
      actor
    );

    // Balance due clears from 200 to 0 (PAID)
    expect(updatedPurchase.balanceDue.toNumber()).toBe(0);
    expect(updatedPurchase.paymentStatus).toBe('PAID');
    // Supplier ledger has debit of 300
    expect(ledgerEntries[0].entryType).toBe('PURCHASE_RETURN');
    expect(ledgerEntries[0].debit.toNumber()).toBe(300);

    // 2. Later, supplier actually refunds PKR 100 via Cash Drawer
    await recordSupplierRefund(
      {
        branchId: 'branch-1',
        supplierId: 'sup-1',
        amount: 100,
        method: 'CASH',
        reference: 'SR-001',
      },
      actor
    );

    // Second ledger entry is SUPPLIER_REFUND with credit 100
    expect(ledgerEntries[1].entryType).toBe('SUPPLIER_REFUND');
    expect(ledgerEntries[1].credit.toNumber()).toBe(100);
    // Cash drawer receives money IN of PKR 100
    expect(cashMovements[0].direction).toBe('IN');
    expect(cashMovements[0].amount.toNumber()).toBe(100);
    expect(cashMovements[0].type).toBe('SUPPLIER_REFUND');
  });

  it('Validation: Rejects returning more quantity than remaining eligible from purchase', async () => {
    const mockPurchase = {
      id: 'pur-004',
      purchaseNumber: 'PO-004',
      branchId: 'branch-1',
      supplierId: 'sup-1',
      supplierName: 'ABC Cosmetics',
      netAmount: D(1000),
      paidAmount: D(0),
      balanceDue: D(1000),
      lines: [
        {
          id: 'pline-4',
          itemId: 'item-1',
          itemName: 'Keratin Shampoo 500ml',
          itemSku: 'SHAMP-001',
          batchId: 'bat-1',
          batchNumber: 'BAT-001',
          quantity: D(5),
          unitPurchaseCost: D(100),
          landedUnitCost: D(100),
        },
      ],
    };

    vi.doMock('../src/config/prisma.js', () => ({
      default: {
        $transaction: vi.fn(async (cb) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi.fn().mockResolvedValue([{ lastValue: 1 }]),
            auditEvent: { create: vi.fn().mockResolvedValue({}) },
            systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
            branch: { findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', code: 'LHE', isActive: true }) },
            supplier: { findUnique: vi.fn().mockResolvedValue({ id: 'sup-1', name: 'ABC Cosmetics', isActive: true, branchId: 'branch-1' }) },
            purchase: { findFirst: vi.fn().mockResolvedValue(mockPurchase) },
            supplierReturn: {
              findMany: vi.fn().mockResolvedValue([]),
              create: vi.fn().mockResolvedValue({ id: 'ret-4', returnNumber: 'PR-LHE-0004' }),
            },
            inventoryItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Keratin Shampoo 500ml', sku: 'SHAMP-001' }) },
          };
          return cb(tx);
        }),
      },
    }));

    const { createReturn } = await import('../src/modules/inventory/inventory.service.js');
    const actor = { id: 'user-admin', name: 'Admin User', role: 'ADMIN', branchId: 'branch-1' };

    // Attempting to return 8 units when only 5 were purchased
    await expect(
      createReturn(
        {
          branchId: 'branch-1',
          supplierId: 'sup-1',
          purchaseId: 'pur-004',
          reason: 'DEFECTIVE',
          lines: [{ itemId: 'item-1', batchId: 'bat-1', quantity: 8 }],
        },
        actor
      )
    ).rejects.toThrow(/Cannot return 8 units/);
  });
});
