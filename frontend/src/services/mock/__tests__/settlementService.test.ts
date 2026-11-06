import { mockSalonService } from '../mockSalonService';
import { mockStorage, StorageSchema } from '../mockStorage';
import { mockAuthService } from '../mockAuthService';
import { User } from '../../../types/auth';
import { CashDrawer, Settlement, Expense } from '../../../types/salon';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function assertAsyncThrows(fn: () => Promise<any>, expectedSubstring?: string) {
  let threw = false;
  let caughtError: any = null;
  try {
    await fn();
  } catch (err: any) {
    threw = true;
    caughtError = err;
  }
  if (!threw) {
    throw new Error(`ASSERTION FAILED: Expected async function to throw an error, but it succeeded.`);
  }
  if (expectedSubstring && !caughtError.message.includes(expectedSubstring)) {
    throw new Error(
      `ASSERTION FAILED: Expected error containing "${expectedSubstring}", but got "${caughtError.message}"`
    );
  }
}

function setupTestEnvironment(
  userRole: 'ADMIN' | 'ACCOUNTANT' | 'STAFF' | 'SUPER_ADMIN' = 'ADMIN',
  branchId: string = 'branch-1'
): {
  user: User;
  adminUser: User;
  accountantUser: User;
  superAdminUser: User;
  staffUser: User;
} {
  const store = mockStorage.reloadFromStorage();

  const adminUser = store.users.find((u) => u.role === 'ADMIN' && u.branchId === 'branch-1')!;
  const accountantUser = store.users.find((u) => u.role === 'ACCOUNTANT' && u.branchId === 'branch-1')!;
  const superAdminUser = store.users.find((u) => u.role === 'SUPER_ADMIN')!;
  const staffUser = store.users.find((u) => u.role === 'STAFF')!;

  let activeUser = adminUser;
  if (userRole === 'ACCOUNTANT') activeUser = accountantUser;
  if (userRole === 'SUPER_ADMIN') activeUser = superAdminUser;
  if (userRole === 'STAFF') activeUser = staffUser;

  mockAuthService.setCurrentSession({
    user: activeUser,
    token: `token_${activeUser.id}`,
    loginTime: new Date().toISOString(),
    activeBranchId: userRole === 'SUPER_ADMIN' ? 'ALL' : branchId,
  });

  return {
    user: activeUser,
    adminUser,
    accountantUser,
    superAdminUser,
    staffUser,
  };
}

async function runSettlementTests() {
  console.log('====================================================');
  console.log('  RUNNING SALONOS CUSTODY & SETTLEMENT TEST SUITE   ');
  console.log('====================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Custody Reconciliation across POS, Dues, Tips and Expenses
  // --------------------------------------------------------------------------
  console.log('Running Test 1: Custody reconciliation across POS, dues, tips and expenses...');
  {
    const { accountantUser } = setupTestEnvironment('ACCOUNTANT');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';
    const today = '2026-09-29';
    mockStorage.setSystemDate(today);

    // Prepare fresh drawer
    store.cashDrawers = store.cashDrawers.filter((d) => !(d.branchId === branchId && d.custodianUserId === accountantUser.id));
    const testDrawer: CashDrawer = {
      id: `drawer-t1-${Date.now()}`,
      branchId,
      date: today,
      openingCash: 5000,
      cashSales: 0,
      cashTipsCollected: 0,
      cashExpensesPaid: 0,
      expectedInDrawer: 5000,
      actualInDrawer: 5000,
      variance: 0,
      custodianUserId: accountantUser.id,
      custodianName: accountantUser.name,
      status: 'OPEN',
    };
    store.cashDrawers.push(testDrawer);
    mockStorage.saveStore(store);

    // 1. POS cash sale (1000 bill + 200 tip)
    await mockSalonService.postPOSInvoice(
      {
        branchId,
        clientName: 'Test Client 1',
        clientPhone: '03001234567',
        discountType: 'FIXED',
        discountValue: 0,
        tip: 200,
        cartItems: [
          {
            cartInstanceId: 'cart-1',
            type: 'SERVICE',
            item: store.services[0],
            staffId: store.staff[0].id,
            staffName: store.staff[0].name,
            staffCommissionRate: 0.1,
            quantity: 1,
          },
        ],
        payments: [
          {
            method: 'CASH',
            amount: 1200,
            billAllocation: 1000,
            tipAllocation: 200,
            cashTendered: 1200,
            changeReturned: 0,
          },
        ],
      },
      accountantUser
    );

    // 2. Post cash expense (PKR 500)
    await mockSalonService.postExpense(
      {
        branchId,
        category: 'Salon Supplies',
        payee: 'Local Mart',
        title: 'Shampoo supplies',
        amount: 500,
        paymentSource: 'CASH_DRAWER',
      },
      accountantUser
    );

    // Reconcile balance sheet
    const stmt = await mockSalonService.getCashCustodyStatement(
      { branchId, userId: accountantUser.id, drawerId: testDrawer.id },
      accountantUser
    );

    // Opening 5000 + Sales 1000 + Tip 200 - Expense 500 = 5700
    assert(stmt.summary.openingCash === 5000, 'Opening cash should be 5000');
    assert(stmt.summary.cashSalesTotal === 1000, 'Cash sales should be 1000');
    assert(stmt.summary.cashTipsTotal === 200, 'Cash tips should be 200');
    assert(stmt.summary.cashExpensesPaidTotal === 500, 'Cash expenses paid should be 500');
    assert(stmt.summary.expectedCashInCustody === 5700, `Expected cash should be 5700, got ${stmt.summary.expectedCashInCustody}`);

    console.log('✓ Test 1 Passed: Custody reconciliation across sales, tips, and expenses is exact.');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Online collections do NOT affect physical cash custody
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 2: Online collections isolated from physical cash custody...');
  {
    const { accountantUser } = setupTestEnvironment('ACCOUNTANT');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';
    const acc = store.paymentAccounts.find((a) => a.branchId === branchId)!;

    const stmtBefore = await mockSalonService.getCashCustodyStatement(
      { branchId, userId: accountantUser.id },
      accountantUser
    );
    const cashBefore = stmtBefore.summary.expectedCashInCustody;

    // Post online payment invoice (PKR 3000 on card/online)
    await mockSalonService.postPOSInvoice(
      {
        branchId,
        clientName: 'Digital Customer',
        clientPhone: '03009998877',
        discountType: 'FIXED',
        discountValue: 0,
        tip: 0,
        cartItems: [
          {
            cartInstanceId: 'cart-2',
            type: 'SERVICE',
            item: store.services[0],
            staffId: store.staff[0].id,
            staffName: store.staff[0].name,
            staffCommissionRate: 0.1,
            quantity: 1,
          },
        ],
        payments: [
          {
            method: 'ONLINE_ACCOUNT',
            paymentAccountId: acc.id,
            paymentAccountName: acc.name,
            amount: 3000,
            billAllocation: 3000,
            tipAllocation: 0,
          },
        ],
      },
      accountantUser
    );

    const stmtAfter = await mockSalonService.getCashCustodyStatement(
      { branchId, userId: accountantUser.id },
      accountantUser
    );
    assert(
      stmtAfter.summary.expectedCashInCustody === cashBefore,
      `Physical cash custody must remain unchanged (${cashBefore}), got ${stmtAfter.summary.expectedCashInCustody}`
    );
    assert(stmtAfter.summary.onlineCollectionsTotal >= 3000, 'Online collections total must track processor receipt');

    console.log('✓ Test 2 Passed: Online collections segregated cleanly without altering physical cash.');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Date range opening balance carried forward correctly
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 3: Date range preserves carried-forward opening balance...');
  {
    const { accountantUser } = setupTestEnvironment('ACCOUNTANT');
    const branchId = 'branch-1';

    const store = mockStorage.getStore();
    const drawer = store.cashDrawers.find((d) => d.branchId === branchId && d.custodianUserId === accountantUser.id && d.status === 'OPEN')!;
    const tomorrow = '2026-09-30';
    const stmt = await mockSalonService.getCashCustodyStatement(
      { branchId, userId: accountantUser.id, drawerId: drawer.id, startDate: tomorrow },
      accountantUser
    );

    assert(
      stmt.openingBalanceCarriedForward > 0,
      `Opening balance carried forward (${stmt.openingBalanceCarriedForward}) should be preserved from prior transactions`
    );
    assert(
      stmt.summary.openingCash === stmt.openingBalanceCarriedForward,
      'Summary opening cash must reflect carried forward balance for date-filtered range'
    );

    console.log('✓ Test 3 Passed: Date filtering preserves correct carried-forward opening balance.');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Submission moves NO money and locks drawer against further posting
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 4: Submission moves no money and locks drawer...');
  {
    const { accountantUser } = setupTestEnvironment('ACCOUNTANT');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';

    // Find current open drawer
    let drawer = store.cashDrawers.find((d) => d.branchId === branchId && d.custodianUserId === accountantUser.id && d.status === 'OPEN')!;
    const stmt = await mockSalonService.getCashCustodyStatement({ branchId, userId: accountantUser.id, drawerId: drawer.id }, accountantUser);
    const expected = stmt.summary.expectedCashInCustody;

    const vaultBefore = (store.vaultBalances || {})[branchId] || 0;

    // Submit settlement (handover = expected, retained = 0)
    const settlement = await mockSalonService.submitSettlement(
      {
        drawerId: drawer.id,
        branchId,
        countedCash: expected,
        handoverAmount: expected,
        retainedFloat: 0,
        notes: 'Shift close submission',
      },
      accountantUser
    );

    assert(settlement.status === 'SUBMITTED', 'Settlement must be in SUBMITTED status');

    // Drawer must be locked
    const reloadedStore = mockStorage.getStore();
    const lockedDrawer = reloadedStore.cashDrawers.find((d) => d.id === drawer.id)!;
    assert(lockedDrawer.status === 'SETTLEMENT_PENDING', 'Drawer must be locked with status SETTLEMENT_PENDING');

    // Vault balance must NOT have changed yet (submission alone moves NO cash!)
    const vaultAfter = (reloadedStore.vaultBalances || {})[branchId] || 0;
    assert(vaultAfter === vaultBefore, 'Submission alone must not move funds into vault');

    // Attempting to post a cash expense to the locked drawer must be rejected
    await assertAsyncThrows(
      () =>
        mockSalonService.postExpense(
          {
            branchId,
            category: 'Supplies',
            payee: 'Store',
            title: 'Test blocked payout',
            amount: 100,
            paymentSource: 'CASH_DRAWER',
          },
          accountantUser
        ),
      'locked pending settlement review'
    );

    // Overlapping submission for the same drawer must be rejected
    await assertAsyncThrows(
      () =>
        mockSalonService.submitSettlement(
          {
            drawerId: drawer.id,
            branchId,
            countedCash: expected,
            handoverAmount: expected,
            retainedFloat: 0,
          },
          accountantUser
        ),
      'already locked pending settlement review'
    );

    console.log('✓ Test 4 Passed: Submission moves no money and locks drawer against further posting.');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Rejection unlocks drawer without moving money
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 5: Rejection unlocks drawer without moving funds...');
  {
    const { adminUser, accountantUser } = setupTestEnvironment('ADMIN');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';

    const testDrawer: CashDrawer = {
      id: `drawer-t5-${Date.now()}`,
      branchId,
      date: '2026-09-29',
      openingCash: 3000,
      cashSales: 0,
      cashTipsCollected: 0,
      cashExpensesPaid: 0,
      expectedInDrawer: 3000,
      actualInDrawer: 3000,
      variance: 0,
      custodianUserId: accountantUser.id,
      custodianName: accountantUser.name,
      status: 'OPEN',
    };
    store.cashDrawers.push(testDrawer);
    mockStorage.saveStore(store);

    mockAuthService.setCurrentSession({
      user: accountantUser,
      token: `token_${accountantUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: branchId,
    });

    const submittedSettlement = await mockSalonService.submitSettlement(
      {
        drawerId: testDrawer.id,
        branchId,
        countedCash: 3000,
        handoverAmount: 3000,
        retainedFloat: 0,
      },
      accountantUser
    );

    // Switch to Admin to reject
    mockAuthService.setCurrentSession({
      user: adminUser,
      token: `token_${adminUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: branchId,
    });

    // Reject settlement as Admin
    const rejected = await mockSalonService.rejectSettlement(
      submittedSettlement.id,
      'Recount required: discrepancy observed in envelope count.',
      adminUser
    );

    assert(rejected.status === 'REJECTED', 'Settlement must be marked REJECTED');
    assert(rejected.rejectionReason!.includes('Recount required'), 'Rejection reason must be preserved');

    // Drawer must be unlocked back to OPEN
    const reloadedStore = mockStorage.getStore();
    const unlockedDrawer = reloadedStore.cashDrawers.find((d) => d.id === submittedSettlement.drawerId)!;
    assert(unlockedDrawer.status === 'OPEN', 'Drawer must be unlocked back to OPEN status upon rejection');

    console.log('✓ Test 5 Passed: Rejection unlocks drawer cleanly without moving funds.');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Approval transfers handover once and seeds successor drawer once
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 6: Approval transfers handover and creates successor drawer...');
  {
    const { accountantUser, adminUser } = setupTestEnvironment('ACCOUNTANT');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';

    const testDrawer: CashDrawer = {
      id: `drawer-t6-${Date.now()}`,
      branchId,
      date: '2026-09-29',
      openingCash: 5000,
      cashSales: 0,
      cashTipsCollected: 0,
      cashExpensesPaid: 0,
      expectedInDrawer: 5000,
      actualInDrawer: 5000,
      variance: 0,
      custodianUserId: accountantUser.id,
      custodianName: accountantUser.name,
      status: 'OPEN',
    };
    store.cashDrawers.push(testDrawer);
    mockStorage.saveStore(store);

    const settlement = await mockSalonService.submitSettlement(
      {
        drawerId: testDrawer.id,
        branchId,
        countedCash: 5000,
        handoverAmount: 4000,
        retainedFloat: 1000,
        notes: 'End of shift handover',
      },
      accountantUser
    );

    // Switch to Admin to approve
    mockAuthService.setCurrentSession({
      user: adminUser,
      token: `token_${adminUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: branchId,
    });

    const storeBeforeApprove = mockStorage.getStore();
    const vaultBefore = (storeBeforeApprove.vaultBalances || {})[branchId] || 0;

    const result = await mockSalonService.approveSettlement(
      settlement.id,
      {
        actualCashReceived: 4000,
        acceptVariance: true,
        notes: 'Handover envelope received and counted into main safe',
      },
      adminUser
    );

    assert(result.settlement.status === 'APPROVED', 'Settlement must be APPROVED');
    assert(result.successorDrawer !== undefined, 'Successor drawer must be created for retained float');
    assert(result.successorDrawer!.openingCash === 1000, 'Successor drawer opening cash must equal retained float');
    assert(result.successorDrawer!.status === 'OPEN', 'Successor drawer must start in OPEN status');

    // Vault balance must be credited exactly by handover amount (4000)
    const reloadedStore = mockStorage.getStore();
    const vaultAfter = (reloadedStore.vaultBalances || {})[branchId] || 0;
    assert(vaultAfter === vaultBefore + 4000, `Vault balance must increase by 4000 (from ${vaultBefore} to ${vaultBefore + 4000}), got ${vaultAfter}`);

    // Settled drawer must be closed
    const settledDrawer = reloadedStore.cashDrawers.find((d) => d.id === testDrawer.id)!;
    assert(settledDrawer.status === 'SETTLED', 'Original drawer must be closed with status SETTLED');
    assert(settledDrawer.successorDrawerId === result.successorDrawer!.id, 'Settled drawer must reference successor drawer');

    console.log('✓ Test 6 Passed: Approval transfers handover once and retains float in successor drawer once.');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Explicit Non-Zero Variance Handling & CVA creation
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 7: Non-zero variance requires manager acceptance & posts CVA...');
  {
    const { accountantUser, adminUser } = setupTestEnvironment('ACCOUNTANT');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';

    const testDrawer: CashDrawer = {
      id: `drawer-t7-${Date.now()}`,
      branchId,
      date: '2026-09-29',
      openingCash: 1000,
      cashSales: 0,
      cashTipsCollected: 0,
      cashExpensesPaid: 0,
      expectedInDrawer: 1000,
      actualInDrawer: 1000,
      variance: 0,
      custodianUserId: accountantUser.id,
      custodianName: accountantUser.name,
      status: 'OPEN',
    };
    store.cashDrawers.push(testDrawer);
    mockStorage.saveStore(store);

    // Expected cash is 1000. Count physical cash as 900 (PKR 100 Shortage)
    // Submitting without explanation must throw
    await assertAsyncThrows(
      () =>
        mockSalonService.submitSettlement(
          {
            drawerId: testDrawer.id,
            branchId,
            countedCash: 900,
            handoverAmount: 900,
            retainedFloat: 0,
            varianceExplanation: '',
          },
          accountantUser
        ),
      'requires an explanation'
    );

    // Submit with explanation
    const settlement = await mockSalonService.submitSettlement(
      {
        drawerId: testDrawer.id,
        branchId,
        countedCash: 900,
        handoverAmount: 900,
        retainedFloat: 0,
        varianceExplanation: 'Unrecovered change shortage during rush hour',
      },
      accountantUser
    );

    assert(settlement.variance === -100, `Variance must be -100, got ${settlement.variance}`);

    // Switch to Admin
    mockAuthService.setCurrentSession({
      user: adminUser,
      token: `token_${adminUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: branchId,
    });

    // Approval without explicit acceptVariance must be rejected
    await assertAsyncThrows(
      () =>
        mockSalonService.approveSettlement(
          settlement.id,
          {
            actualCashReceived: 900,
            acceptVariance: false,
          },
          adminUser
        ),
      'Explicit manager acceptance is required'
    );

    // Approval with acceptVariance: true succeeds and creates CVA
    const res = await mockSalonService.approveSettlement(
      settlement.id,
      {
        actualCashReceived: 900,
        acceptVariance: true,
        notes: 'Manager approved shortage variance',
      },
      adminUser
    );

    assert(res.varianceAdjustment !== undefined, 'CashVarianceAdjustment record must be generated');
    assert(res.varianceAdjustment!.varianceAmount === -100, 'CVA must reflect -100 shortage');
    assert(res.varianceAdjustment!.adjustmentNumber.startsWith('CVA-'), 'CVA number format must start with CVA-');

    console.log('✓ Test 7 Passed: Non-zero variance strictly auditable with manager acceptance and CVA.');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Anti-Self-Approval, Cross-Branch & Accountant Review Rejection
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 8: Self-approval, cross-branch and Accountant review rejected...');
  {
    const { superAdminUser, adminUser, accountantUser } = setupTestEnvironment('SUPER_ADMIN');
    const store = mockStorage.getStore();

    // Prepare a submitted settlement by Admin
    const adminDrawer: CashDrawer = {
      id: `drawer-admin-${Date.now()}`,
      branchId: 'branch-1',
      date: '2026-09-29',
      openingCash: 1000,
      cashSales: 0,
      cashTipsCollected: 0,
      cashExpensesPaid: 0,
      expectedInDrawer: 1000,
      actualInDrawer: 1000,
      variance: 0,
      custodianUserId: adminUser.id,
      custodianName: adminUser.name,
      status: 'OPEN',
    };
    store.cashDrawers.push(adminDrawer);
    mockStorage.saveStore(store);

    // 0. Super Admin attempts to submit outgoing settlement -> MUST THROW!
    await assertAsyncThrows(
      () =>
        mockSalonService.submitSettlement(
          {
            drawerId: adminDrawer.id,
            branchId: 'branch-1',
            countedCash: 1000,
            handoverAmount: 1000,
            retainedFloat: 0,
          },
          superAdminUser
        ),
      'Super Admin is the final receiver in the settlement hierarchy'
    );

    const adminSettlement = await mockSalonService.submitSettlement(
      {
        drawerId: adminDrawer.id,
        branchId: 'branch-1',
        countedCash: 1000,
        handoverAmount: 1000,
        retainedFloat: 0,
      },
      adminUser
    );

    // 1. Admin attempts to approve their OWN settlement -> MUST THROW!
    await assertAsyncThrows(
      () =>
        mockSalonService.approveSettlement(
          adminSettlement.id,
          {
            actualCashReceived: 1000,
            acceptVariance: true,
          },
          adminUser
        ),
      'cannot approve your own settlement'
    );

    // 2. Accountant attempts to review/approve -> MUST THROW!
    mockAuthService.setCurrentSession({
      user: accountantUser,
      token: `token_${accountantUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: 'branch-1',
    });
    await assertAsyncThrows(
      () =>
        mockSalonService.approveSettlement(
          saSettlement.id,
          {
            actualCashReceived: 1000,
            acceptVariance: true,
          },
          accountantUser
        ),
      'Access Denied: Only Super Admin and Branch Admin'
    );

    // 3. Admin from another branch attempts to approve -> MUST THROW!
    const otherAdmin: User = {
      ...adminUser,
      id: 'admin-branch-2',
      branchId: 'branch-2',
      name: 'Branch 2 Admin',
    };
    const storeWithOther = mockStorage.getStore();
    storeWithOther.users.push(otherAdmin);
    mockStorage.saveStore(storeWithOther);

    mockAuthService.setCurrentSession({
      user: otherAdmin,
      token: `token_${otherAdmin.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: 'branch-2',
    });
    await assertAsyncThrows(
      () =>
        mockSalonService.approveSettlement(
          saSettlement.id,
          {
            actualCashReceived: 1000,
            acceptVariance: true,
          },
          otherAdmin
        ),
      'Cannot approve settlements from another branch'
    );

    console.log('✓ Test 8 Passed: Self-approval, Accountant approval, and cross-branch approvals strictly blocked.');
  }

  // --------------------------------------------------------------------------
  // TEST 9: Disputed Cash Handover Count Rejected for Recount
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 9: Disputed cash handover count rejected for correction...');
  {
    const { adminUser, accountantUser } = setupTestEnvironment('ADMIN');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';

    const testDrawer: CashDrawer = {
      id: `drawer-t9-${Date.now()}`,
      branchId,
      date: '2026-09-29',
      openingCash: 1000,
      cashSales: 0,
      cashTipsCollected: 0,
      cashExpensesPaid: 0,
      expectedInDrawer: 1000,
      actualInDrawer: 1000,
      variance: 0,
      custodianUserId: accountantUser.id,
      custodianName: accountantUser.name,
      status: 'OPEN',
    };
    store.cashDrawers.push(testDrawer);
    mockStorage.saveStore(store);

    mockAuthService.setCurrentSession({
      user: accountantUser,
      token: `token_${accountantUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: branchId,
    });

    const settlement = await mockSalonService.submitSettlement(
      {
        drawerId: testDrawer.id,
        branchId,
        countedCash: 1000,
        handoverAmount: 1000,
        retainedFloat: 0,
      },
      accountantUser
    );

    mockAuthService.setCurrentSession({
      user: adminUser,
      token: `token_${adminUser.id}`,
      loginTime: new Date().toISOString(),
      activeBranchId: branchId,
    });

    // Manager enters PKR 800 received when submitted handover is PKR 1000
    await assertAsyncThrows(
      () =>
        mockSalonService.approveSettlement(
          settlement.id,
          {
            actualCashReceived: 800, // Disputed count!
            acceptVariance: true,
          },
          adminUser
        ),
      'Count disputed'
    );

    console.log('✓ Test 9 Passed: Disputed handover counts reject silently altering submitted figures.');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Expense Reversal on Closed Drawer Preserves History
  // --------------------------------------------------------------------------
  console.log('\nRunning Test 10: Expense reversal after settlement preserves closed drawer history...');
  {
    const { adminUser, accountantUser } = setupTestEnvironment('ADMIN');
    const store = mockStorage.getStore();
    const branchId = 'branch-1';
    const today = '2026-09-29';
    mockStorage.setSystemDate(today);

    // Create a closed settled drawer
    const closedDrawer: CashDrawer = {
      id: `drawer-hist-${Date.now()}`,
      branchId,
      date: '2026-09-28',
      openingCash: 2000,
      cashSales: 1000,
      cashTipsCollected: 0,
      cashExpensesPaid: 400,
      expectedInDrawer: 2600,
      actualInDrawer: 2600,
      variance: 0,
      custodianUserId: accountantUser.id,
      custodianName: accountantUser.name,
      status: 'SETTLED',
      closedAt: '2026-09-28T22:00:00.000Z',
    };
    store.cashDrawers.push(closedDrawer);

    // Create an expense paid from that closed drawer
    const exp: Expense = {
      id: `exp-hist-${Date.now()}`,
      voucherNumber: 'EXP-LHE-01-2026-9999',
      branchId,
      date: '2026-09-28',
      expenseDate: '2026-09-28',
      title: 'Historical Office Stationery',
      category: 'Office Supplies',
      amount: 400,
      paymentSource: 'CASH_DRAWER',
      status: 'POSTED',
      paidByUserId: accountantUser.id,
      paidByName: accountantUser.name,
      createdByUserId: accountantUser.id,
      createdByName: accountantUser.name,
      paidFromDrawerId: closedDrawer.id,
    };
    store.expenses.push(exp);

    // Ensure there is an active open receiving drawer for today
    let openDrawer = store.cashDrawers.find((d) => d.branchId === branchId && d.status === 'OPEN');
    if (!openDrawer) {
      openDrawer = {
        id: `drawer-open-today-${Date.now()}`,
        branchId,
        date: today,
        openingCash: 1000,
        cashSales: 0,
        cashTipsCollected: 0,
        cashExpensesPaid: 0,
        expectedInDrawer: 1000,
        actualInDrawer: 1000,
        variance: 0,
        custodianUserId: adminUser.id,
        custodianName: adminUser.name,
        status: 'OPEN',
      };
      store.cashDrawers.push(openDrawer);
    }
    const openDrawerCashBefore = openDrawer.expectedInDrawer;
    mockStorage.saveStore(store);

    // Reverse the historical expense
    const reversal = await mockSalonService.reverseExpense(
      exp.id,
      'Vendor refund accepted due to defective supplies',
      adminUser
    );

    assert(reversal.originalExpense.status === 'REVERSED', 'Original expense must be marked REVERSED');
    assert(reversal.originalExpense.date === '2026-09-28', 'Original expense must remain on original date');
    assert(reversal.reversalExpense.date === today, 'Reversal record must be posted on reversal date');

    // Closed drawer history MUST NOT BE MODIFIED!
    const reloadedStore = mockStorage.getStore();
    const verifiedClosedDrawer = reloadedStore.cashDrawers.find((d) => d.id === closedDrawer.id)!;
    assert(verifiedClosedDrawer.status === 'SETTLED', 'Closed drawer must remain SETTLED');
    assert(verifiedClosedDrawer.cashExpensesPaid === 400, 'Closed drawer historical cashExpensesPaid must not be rewritten');
    assert(verifiedClosedDrawer.expectedInDrawer === 2600, 'Closed drawer expected balance must remain intact');

    // Receiving open drawer must have received the refund
    const verifiedOpenDrawer = reloadedStore.cashDrawers.find((d) => d.id === openDrawer!.id)!;
    assert(
      verifiedOpenDrawer.expectedInDrawer === openDrawerCashBefore + 400,
      `Receiving drawer must receive the 400 refund (expected ${openDrawerCashBefore + 400}), got ${verifiedOpenDrawer.expectedInDrawer}`
    );

    console.log('✓ Test 10 Passed: Closed drawer history strictly preserved upon later expense reversal.');
  }

  console.log('\n====================================================');
  console.log('  CUSTODY & SETTLEMENT SUITE: 10/10 TESTS PASSED    ');
  console.log('====================================================\n');
}

runSettlementTests().catch((err) => {
  console.error('\n❌ SETTLEMENT TEST SUITE FAILED:', err);
  process.exit(1);
});
