import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma and dependencies
vi.mock('../src/config/prisma.js', () => ({
  default: {
    branch: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    cashDrawer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    drawerMovement: {
      findMany: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    accountMovement: {
      findMany: vi.fn(),
    },
    settlement: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cashVarianceAdjustment: {
      create: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    sequenceCounter: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    systemSetting: {
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ lastValue: 1, nextNumber: 1 }]),
    $transaction: vi.fn((cb) => cb(prismaMock)),
  },
}));

import prisma from '../src/config/prisma.js';
const prismaMock = prisma;

import * as settlementService from '../src/modules/settlements/settlements.service.js';

describe('Account Settlement Hierarchy · Accountant → Admin → Super Admin', () => {
  const branchId = 'branch-khi-01';
  const branch = { id: branchId, name: 'Karachi Flagship', code: 'KHI', isActive: true };

  const accountantActor = {
    id: 'user-acc-01',
    name: 'Sara Accountant',
    role: 'ACCOUNTANT',
    branchId,
  };

  const adminActor = {
    id: 'user-admin-01',
    name: 'Hamza Admin',
    role: 'ADMIN',
    branchId,
  };

  const otherBranchAdmin = {
    id: 'user-admin-02',
    name: 'Tariq Lahore Admin',
    role: 'ADMIN',
    branchId: 'branch-lhe-02',
  };

  const superAdminActor = {
    id: 'user-super-01',
    name: 'CEO Super Admin',
    role: 'SUPER_ADMIN',
    branchId: null,
  };

  const accountantDrawer = {
    id: 'drawer-acc-01',
    kind: 'DRAWER',
    branchId,
    custodianUserId: accountantActor.id,
    custodianName: accountantActor.name,
    status: 'OPEN',
  };

  const adminDrawer = {
    id: 'drawer-admin-01',
    kind: 'DRAWER',
    branchId,
    custodianUserId: adminActor.id,
    custodianName: adminActor.name,
    status: 'OPEN',
  };

  const superAdminDrawer = {
    id: 'drawer-super-01',
    kind: 'DRAWER',
    branchId,
    custodianUserId: superAdminActor.id,
    custodianName: superAdminActor.name,
    status: 'OPEN',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.branch.findUnique.mockResolvedValue(branch);
    prisma.branch.findFirst.mockResolvedValue(branch);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.systemSetting.findUnique.mockResolvedValue({ key: 'BUSINESS_DATE', value: '2026-11-06' });
    prisma.sequenceCounter.upsert.mockResolvedValue({ nextNumber: 1 });
    prisma.$queryRaw.mockResolvedValue([{ lastValue: 1, nextNumber: 1 }]);
    prisma.cashDrawer.findUnique.mockImplementation(({ where }) => {
      if (where.id === adminDrawer.id) return Promise.resolve(adminDrawer);
      if (where.id === superAdminDrawer.id) return Promise.resolve(superAdminDrawer);
      return Promise.resolve(accountantDrawer);
    });
    prisma.drawerMovement.groupBy.mockResolvedValue([
      { direction: 'IN', _sum: { amount: 5000 } },
      { direction: 'OUT', _sum: { amount: 0 } },
    ]);
  });

  it('1. Accountant submits settlement: routes to Branch Admin, locks drawer, does not transfer custody yet', async () => {
    // Expected cash in drawer = PKR 5,000
    prisma.cashDrawer.findUnique.mockResolvedValue(accountantDrawer);
    prisma.drawerMovement.findMany.mockResolvedValue([
      { direction: 'IN', amount: 5000, type: 'CASH_SALE', createdAt: new Date() },
    ]);
    prisma.settlement.create.mockImplementation(({ data }) => Promise.resolve({ id: 'set-001', ...data }));
    prisma.cashDrawer.update.mockResolvedValue({ ...accountantDrawer, status: 'SETTLEMENT_PENDING' });

    const submission = await settlementService.submitSettlement(
      {
        drawerId: accountantDrawer.id,
        branchId,
        countedCash: 5000,
        handoverAmount: 3000,
        retainedFloat: 2000,
      },
      accountantActor
    );

    expect(submission.status).toBe('SUBMITTED');
    expect(submission.handoverAmount).toBe(3000);
    expect(submission.retainedFloat).toBe(2000);
    expect(submission.submittedByRole).toBe('ACCOUNTANT');
    expect(submission.destinationVaultName).toContain('Branch Admin');

    // Drawer is locked pending review
    expect(prisma.cashDrawer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: accountantDrawer.id },
        data: expect.objectContaining({ status: 'SETTLEMENT_PENDING' }),
      })
    );
  });

  it('2. Super Admin cannot directly approve an Accountant settlement (blocked by hierarchy)', async () => {
    const acctSettlement = {
      id: 'set-001',
      settlementNumber: 'SET-2026-0001',
      branchId,
      drawerId: accountantDrawer.id,
      expectedCash: 5000,
      countedCash: 5000,
      variance: 0,
      handoverAmount: 3000,
      retainedFloat: 2000,
      status: 'SUBMITTED',
      submittedByUserId: accountantActor.id,
      submittedByName: accountantActor.name,
      submittedByRole: 'ACCOUNTANT',
      drawer: accountantDrawer,
    };

    prisma.settlement.findUnique.mockResolvedValue(acctSettlement);

    await expect(
      settlementService.approveSettlement('set-001', { acceptVariance: true }, superAdminActor)
    ).rejects.toThrow(/Accountant settlements must be reviewed by the Branch Admin first/i);
  });

  it('3. Admin cannot approve their own settlement (no self-approval)', async () => {
    const adminSettlement = {
      id: 'set-002',
      settlementNumber: 'SET-2026-0002',
      branchId,
      drawerId: adminDrawer.id,
      expectedCash: 3000,
      countedCash: 3000,
      variance: 0,
      handoverAmount: 2000,
      retainedFloat: 1000,
      status: 'SUBMITTED',
      submittedByUserId: adminActor.id,
      submittedByName: adminActor.name,
      submittedByRole: 'ADMIN',
      drawer: adminDrawer,
    };

    prisma.settlement.findUnique.mockResolvedValue(adminSettlement);

    await expect(
      settlementService.approveSettlement('set-002', { acceptVariance: true }, adminActor)
    ).rejects.toThrow(/cannot review your own settlement/i);
  });

  it('4. Cross-branch admin cannot review settlement of another branch', async () => {
    const acctSettlement = {
      id: 'set-001',
      settlementNumber: 'SET-2026-0001',
      branchId,
      drawerId: accountantDrawer.id,
      status: 'SUBMITTED',
      submittedByUserId: accountantActor.id,
      submittedByName: accountantActor.name,
      submittedByRole: 'ACCOUNTANT',
      drawer: accountantDrawer,
    };

    prisma.settlement.findUnique.mockResolvedValue(acctSettlement);

    await expect(
      settlementService.approveSettlement('set-001', { acceptVariance: true }, otherBranchAdmin)
    ).rejects.toThrow(/Access Denied/i);
  });

  it('5. Branch Admin approves Accountant settlement: cash transfers from Accountant to Admin custody', async () => {
    const acctSettlement = {
      id: 'set-001',
      settlementNumber: 'SET-2026-0001',
      branchId,
      drawerId: accountantDrawer.id,
      expectedCash: 5000,
      countedCash: 5000,
      variance: 0,
      handoverAmount: 3000,
      retainedFloat: 2000,
      status: 'SUBMITTED',
      submittedByUserId: accountantActor.id,
      submittedByName: accountantActor.name,
      submittedByRole: 'ACCOUNTANT',
      drawer: accountantDrawer,
    };

    prisma.settlement.findUnique.mockResolvedValue(acctSettlement);
    // holderBalance checks
    prisma.drawerMovement.findMany.mockResolvedValue([
      { direction: 'IN', amount: 5000, type: 'CASH_SALE', createdAt: new Date() },
    ]);
    // Admin receiving drawer
    prisma.cashDrawer.findMany.mockResolvedValue([adminDrawer]);
    prisma.cashDrawer.create.mockResolvedValue({ id: 'drawer-acc-succ', kind: 'DRAWER', custodianUserId: accountantActor.id });
    prisma.settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...acctSettlement, ...data }));

    const result = await settlementService.approveSettlement('set-001', { acceptVariance: true }, adminActor);

    expect(result.settlement.status).toBe('APPROVED');
    expect(result.settlement.receivedByUserId).toBe(adminActor.id);
    expect(result.settlement.receivedByName).toBe(adminActor.name);

    // Verify movements posted:
    // 1. SETTLEMENT_OUT from accountant drawer (PKR 3,000)
    // 2. SETTLEMENT_IN to admin drawer (PKR 3,000)
    // 3. TRANSFER_OUT retained float from accountant drawer (PKR 2,000)
    // 4. OPENING_FLOAT into accountant successor drawer (PKR 2,000)
    const movementCalls = prisma.drawerMovement.create.mock.calls.map(([arg]) => arg.data);

    const settlementOut = movementCalls.find((m) => m.type === 'SETTLEMENT_OUT');
    expect(settlementOut).toBeDefined();
    expect(settlementOut.drawerId).toBe(accountantDrawer.id);
    expect(Number(settlementOut.amount)).toBe(3000);

    const settlementIn = movementCalls.find((m) => m.type === 'SETTLEMENT_IN');
    expect(settlementIn).toBeDefined();
    expect(settlementIn.drawerId).toBe(adminDrawer.id);
    expect(Number(settlementIn.amount)).toBe(3000);
  });

  it('6. Super Admin approves Admin settlement: cash transfers from Admin to Super Admin custody', async () => {
    const adminSettlement = {
      id: 'set-002',
      settlementNumber: 'SET-2026-0002',
      branchId,
      drawerId: adminDrawer.id,
      expectedCash: 3000,
      countedCash: 3000,
      variance: 0,
      handoverAmount: 2000,
      retainedFloat: 1000,
      status: 'SUBMITTED',
      submittedByUserId: adminActor.id,
      submittedByName: adminActor.name,
      submittedByRole: 'ADMIN',
      drawer: adminDrawer,
    };

    prisma.settlement.findUnique.mockResolvedValue(adminSettlement);
    prisma.drawerMovement.groupBy.mockResolvedValue([
      { direction: 'IN', _sum: { amount: 3000 } },
      { direction: 'OUT', _sum: { amount: 0 } },
    ]);
    prisma.drawerMovement.findMany.mockResolvedValue([
      { direction: 'IN', amount: 3000, type: 'SETTLEMENT_IN', createdAt: new Date() },
    ]);
    prisma.cashDrawer.findMany.mockResolvedValue([superAdminDrawer]);
    prisma.cashDrawer.create.mockResolvedValue({ id: 'drawer-admin-succ', kind: 'DRAWER', custodianUserId: adminActor.id });
    prisma.settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...adminSettlement, ...data }));

    const result = await settlementService.approveSettlement('set-002', { acceptVariance: true }, superAdminActor);

    expect(result.settlement.status).toBe('APPROVED');
    expect(result.settlement.receivedByUserId).toBe(superAdminActor.id);

    const movementCalls = prisma.drawerMovement.create.mock.calls.map(([arg]) => arg.data);

    // Handover moves OUT of Admin drawer into Super Admin drawer
    const adminOut = movementCalls.find((m) => m.type === 'SETTLEMENT_OUT');
    expect(adminOut).toBeDefined();
    expect(adminOut.drawerId).toBe(adminDrawer.id);
    expect(Number(adminOut.amount)).toBe(2000);

    const superIn = movementCalls.find((m) => m.type === 'SETTLEMENT_IN');
    expect(superIn).toBeDefined();
    expect(superIn.drawerId).toBe(superAdminDrawer.id);
    expect(Number(superIn.amount)).toBe(2000);
  });

  it('7. Rejection unlocks drawer without moving money', async () => {
    const acctSettlement = {
      id: 'set-001',
      settlementNumber: 'SET-2026-0001',
      branchId,
      drawerId: accountantDrawer.id,
      status: 'SUBMITTED',
      submittedByUserId: accountantActor.id,
      submittedByName: accountantActor.name,
      submittedByRole: 'ACCOUNTANT',
      drawer: accountantDrawer,
    };

    prisma.settlement.findUnique.mockResolvedValue(acctSettlement);
    prisma.settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...acctSettlement, ...data }));

    const rej = await settlementService.rejectSettlement('set-001', 'Count mismatch, recount please', adminActor);

    expect(rej.status).toBe('REJECTED');
    expect(rej.rejectionReason).toBe('Count mismatch, recount please');
    expect(prisma.cashDrawer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: accountantDrawer.id },
        data: expect.objectContaining({ status: 'OPEN' }),
      })
    );
    expect(prisma.drawerMovement.create).not.toHaveBeenCalled();
  });

  it('8. Super Admin cannot submit outgoing settlements (blocked at service and API layer)', async () => {
    await expect(
      settlementService.submitSettlement(
        {
          drawerId: superAdminDrawer.id,
          branchId,
          countedCash: 5000,
          handoverAmount: 5000,
          retainedFloat: 0,
        },
        superAdminActor
      )
    ).rejects.toThrow(/Super Admin is the final receiver in the settlement hierarchy and cannot submit outgoing settlements/i);
  });
});
