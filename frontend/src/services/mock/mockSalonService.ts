import { nextReference } from './referenceSequence';
import {
  SalonServiceContract,
  SuperAdminDashboardData,
  AdminDashboardData,
  AccountantDashboardData,
  StaffDashboardData,
  BranchFinancialMetrics,
  GeneralLedgerResponse,
  AuditEventsResponse,
} from '../salonService';
import {
  StaffAllowance,
  Device,
  DeviceLog,
  CreateDeviceInput,
  UpdateDeviceInput,
  TestConnectionResult,
  SyncDeviceResult,
  PayrollAdjustment,
  SalaryAdvance,
  MonthlyPaySummary,
  StaffSalaryReport,
  StaffCommissionReport,
  Branch,
  OnlineAccount,
  PaymentAccount,
  StaffMember,
  Appointment,
  Invoice,
  Expense,
  CashDrawer,
  Settlement,
  AttendanceRecord,
  OvertimeRecord,
  ServiceItem,
  PackageItem,
  PackageComponent,
  ServiceCategory,
  TaxRule,
  InvoiceLineItem,
  InvoiceLineItemComponent,
  InvoiceStatus,
  PaymentRecord,
  CreatePOSInvoiceInput,
  CollectOutstandingPaymentInput,
  RefundInvoiceInput,
  RefundInvoiceResult,
  InvoiceRefundDTO,
  IdempotencyRecord,
  Client,
  ExpenseStatus,
  ExpenseCategoryItem,
  CashTransferRecord,
  CustodyTransaction,
  BalanceSheetSummary,
  CashVarianceAdjustment,
  CreateSettlementInput,
  ApproveSettlementInput,
  LeaveRecord,
  BranchHoliday,
  CreateAttendanceInput,
  CorrectAttendanceInput,
  CreateLeaveInput,
  CSVAttendanceImportRow,
  CSVAttendanceImportResult,
  CatalogueImportResult,
  CreateOvertimeInput,
  UpdateOvertimeInput,
  AttendanceStatus,
  AttendanceSource,
  AttendanceDeductionSnapshot,
  OvertimeStatus,
  AttendancePunch,
  PayrollRun,
  PayrollPreviewOptions,
  PayrollPayment,
  PayrollPolicyConfig,
  AttendancePolicyConfig,
  PayslipRecord,
  RecordPayrollPaymentInput,
  CommissionRun,
  CommissionPayment,
  CommissionStatementRecord,
  CommissionAttributionLine,
  RecordCommissionPaymentInput,
  TipReceiptRecord,
  TipAllocationRecord,
  TipPayoutRecord,
  AllocateTipsInput,
  RecordTipPayoutInput,
  ReverseTipPayoutInput,
  StaffPerformanceRecord,
  TipsStatementSummary,
  StaffPerformanceServiceItem,
  AppointmentStatus,
  AppointmentBillingStatus,
  AppointmentPackageComponent,
  AppointmentItem,
  AppointmentRescheduleRecord,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  AppointmentConfirmationMessage,
  AppointmentReportRecord,
  AppointmentReportSummary,
  CustomerSource,
  InventoryItem,
  InventoryBatch,
  BatchStatus,
  Supplier,
  SupplierLedgerEntry,
  Purchase,
  PurchaseLineItem,
  PurchasePaymentMethod,
  SupplierPaymentRecord,
  SupplierReturn,
  SupplierReturnLine,
  StockMovement,
  StockMovementType,
  StockSettlement,
  StockSettlementLine,
  StockLevelSnapshot,
  COGSReportRecord,
  COGSReportSummary,
  ItemType,
  UnitOfMeasure,
  CreatePurchaseInput,
  PaySupplierInput,
  CreateSupplierReturnInput,
  CreateManualStockOutInput,
  CreateStockSettlementInput,
  ConsumptionPreview,
  SalesInvoicesReport,
  DetailedIncomeReport,
  DetailedIncomeReportQuery,
  IncomeExpenseReport,
  TaxReport,
  OperatingProfitReport,
  PaymentAccountsReport,
  CashDrawerReport,
  DetailedExpensesReport,
  InventoryReportData,
  AttendanceOvertimeReport,
} from '@/types/salon';
import { User, Role } from '@/types/auth';
import { mockStorage, StorageSchema, DEFAULT_DEMO_DATE } from './mockStorage';
import { mockAuthService } from './mockAuthService';
import { roundCurrency, allocatePackageRevenue } from '@/lib/taxCalculations';
import { normalizePhoneDigits, isValidPhoneNumber, formatPhoneNumber } from '@/lib/formatters';
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  evaluateLateness,
  evaluateEarlyExit,
  calculateWorkedHours,
  calculateScheduledHours,
  calculateDeductionSnapshot,
  evaluateLeaveAllowance,
  isWorkingDay,
} from '@/lib/attendanceCalculations';
import { evaluateEmployeePayroll } from '@/lib/payrollCalculations';
import { evaluateStaffCommission, isCompensationEligibleForCommission } from '@/lib/commissionCalculations';

function sanitizeUser(user: User): User {
  const { password: _, ...safeUser } = user;
  return safeUser as User;
}

class MockSalonService implements SalonServiceContract {
  private async bookingRequiresApi(): Promise<never> { throw new Error('Bridal / Groom bookings require the live API (VITE_USE_MOCK=false).'); }
  getBookings: SalonServiceContract['getBookings'] = () => this.bookingRequiresApi();
  getBookingCollections: SalonServiceContract['getBookingCollections'] = () => this.bookingRequiresApi();
  getBooking: SalonServiceContract['getBooking'] = () => this.bookingRequiresApi();
  createBooking: SalonServiceContract['createBooking'] = () => this.bookingRequiresApi();
  updateBooking: SalonServiceContract['updateBooking'] = () => this.bookingRequiresApi();
  recordBookingPayment: SalonServiceContract['recordBookingPayment'] = () => this.bookingRequiresApi();
  refundBookingPayment: SalonServiceContract['refundBookingPayment'] = () => this.bookingRequiresApi();
  cancelBooking: SalonServiceContract['cancelBooking'] = () => this.bookingRequiresApi();
  startBooking: SalonServiceContract['startBooking'] = () => this.bookingRequiresApi();
  getBookingLedger: SalonServiceContract['getBookingLedger'] = () => this.bookingRequiresApi();
  getBookingHandoff: SalonServiceContract['getBookingHandoff'] = () => this.bookingRequiresApi();
  checkoutBooking: SalonServiceContract['checkoutBooking'] = () => this.bookingRequiresApi();
  /**
   * Resolves the verified authenticated actor from the active session.
   * Rejects if session is missing, deactivated, or if the explicit actor doesn't match the session.
   */
  private getAuthenticatedActor(explicitActor?: User): User {
    const session = mockAuthService.getCurrentSession();
    if (!session || !session.user) {
      throw new Error('Unauthorized: An active authenticated session is required to perform this administrative operation.');
    }

    const store = mockStorage.getStore();
    const liveUser = store.users.find((u) => u.id === session.user.id);
    if (!liveUser || !liveUser.isActive) {
      throw new Error('Unauthorized: Your user account is currently deactivated or invalid.');
    }

    if (explicitActor && explicitActor.id !== liveUser.id) {
      // Prevent caller from forging an arbitrary user object with elevated roles
      if (liveUser.role !== 'SUPER_ADMIN') {
        throw new Error('Security Violation: Actor mismatch detected.');
      }
    }

    return liveUser;
  }

  // Authoritative financial calculation engine
  private computeBranchMetrics(branchId: string | 'ALL', targetDate: string): BranchFinancialMetrics {
    const store = mockStorage.getStore();
    const isAll = branchId === 'ALL';
    const targetBranches = isAll
      ? store.branches.filter((b) => b.isActive)
      : store.branches.filter((b) => b.id === branchId);

    const branchName = isAll ? 'All Branches (Consolidated)' : targetBranches[0]?.name || 'Unknown Branch';
    const branchCode = isAll ? 'ALL' : targetBranches[0]?.code || 'N/A';

    // 1. Invoices within branch scope
    const branchInvoices = isAll
      ? store.invoices
      : store.invoices.filter((inv) => inv.branchId === branchId);

    // Filter period sales by invoice date = targetDate
    const invoicesForDate = branchInvoices.filter((inv) => inv.date === targetDate);

    const grossSales = invoicesForDate.reduce((sum, inv) => sum + inv.subtotal, 0);
    const totalDiscounts = invoicesForDate.reduce((sum, inv) => sum + inv.discount, 0);

    const branchRefunds = branchInvoices.flatMap((inv) => inv.refunds || []);
    const refundsForDate = branchRefunds.filter(
      (r: any) => r.refundDate === targetDate || (r.createdAt && r.createdAt.slice(0, 10) === targetDate)
    );
    const refundedNetForDate = refundsForDate.reduce((sum: number, r: any) => sum + (r.netReversed || 0), 0);
    const refundedTaxForDate = refundsForDate.reduce((sum: number, r: any) => sum + (r.taxReversed || 0), 0);
    const cashRefundsPaid = refundsForDate
      .filter((r: any) => r.method === 'CASH')
      .reduce((sum: number, r: any) => sum + (r.cashOut || 0), 0);
    const onlineRefundsPaid = refundsForDate
      .filter((r: any) => r.method === 'ONLINE_ACCOUNT')
      .reduce((sum: number, r: any) => sum + (r.cashOut || 0), 0);

    const netSales = Math.max(0, invoicesForDate.reduce((sum, inv) => sum + inv.netSales, 0) - refundedNetForDate);
    const taxBilled = Math.max(0, invoicesForDate.reduce((sum, inv) => sum + inv.tax, 0) - refundedTaxForDate);

    // Current outstanding receivables (cumulative across all unpaid/partial invoices)
    const outstandingReceivables = branchInvoices.reduce((sum, inv) => sum + inv.amountDue, 0);

    // 2. Payments: Filter collections strictly by payment date = targetDate
    const allPayments = branchInvoices.flatMap((inv) => inv.payments);
    const paymentsForDate = allPayments.filter((p) => p.date === targetDate);

    // Tips collected calculated from actual payment tip allocations on targetDate, not invoice tip fields
    const tipsCollected = paymentsForDate.reduce((sum, p) => sum + (p.tipAmountAllocated || 0), 0);

    const grossCashCollected = paymentsForDate
      .filter((p) => p.method === 'CASH')
      .reduce((sum, p) => sum + p.amount, 0);
    const grossOnlineCollected = paymentsForDate
      .filter((p) => p.method === 'ONLINE_ACCOUNT')
      .reduce((sum, p) => sum + p.amount, 0);

    const cashCollected = Math.max(0, grossCashCollected - cashRefundsPaid);
    const onlineCollected = Math.max(0, grossOnlineCollected - onlineRefundsPaid);
    const actualCollections = cashCollected + onlineCollected;

    // 3. Cash Drawers & Physical Cash in Custody (current balance)
    const cashDrawers = isAll
      ? store.cashDrawers
      : store.cashDrawers.filter((d) => d.branchId === branchId);
    const cashInCustody = cashDrawers.reduce((sum, d) => sum + d.actualInDrawer, 0);

    // 4. Online Account Balances (current balance) - preserve balances of inactive payment accounts in financial totals
    const paymentAccounts = isAll
      ? store.paymentAccounts
      : store.paymentAccounts.filter((acc) => acc.branchId === branchId);
    const onlineBalancesTotal = paymentAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);

    // 5. Expenses Paid on targetDate
    const expenses = isAll
      ? store.expenses.filter((e) => (e.status === 'PAID' || e.status === 'POSTED') && e.date === targetDate && !e.reversalOfVoucherNumber)
      : store.expenses.filter((e) => e.branchId === branchId && (e.status === 'PAID' || e.status === 'POSTED') && e.date === targetDate && !e.reversalOfVoucherNumber);
    const totalExpensesPaid = expenses.reduce((sum, e) => sum + e.amount, 0);

    // 6. Net Operating Cash Flow for Period
    const netOperatingCashFlow = actualCollections - totalExpensesPaid;

    // 7. Staff On Duty on targetDate
    const validOnDutyStatuses = ['ON_TIME', 'LATE', 'ON_DUTY'];
    const branchAttendance = isAll
      ? store.attendance.filter((att) => att.date === targetDate)
      : store.attendance.filter((att) => att.branchId === branchId && att.date === targetDate);
    const activeStaffOnDuty = branchAttendance.filter((att) => validOnDutyStatuses.includes(att.status)).length;

    // 8. Appointments on targetDate
    const branchAppointments = isAll
      ? store.appointments.filter((apt) => apt.date === targetDate)
      : store.appointments.filter((apt) => apt.branchId === branchId && apt.date === targetDate);
    const appointmentsTodayCount = branchAppointments.length;

    return {
      branchId,
      branchName,
      branchCode,
      grossSales,
      totalDiscounts,
      netSales,
      taxBilled,
      tipsCollected,
      actualCollections,
      cashCollected,
      onlineCollected,
      outstandingReceivables,
      cashInCustody,
      onlineBalancesTotal,
      totalExpensesPaid,
      netOperatingCashFlow,
      activeStaffOnDuty,
      appointmentsTodayCount,
      invoicesCount: invoicesForDate.length,
    };
  }

  // --- BRANCH MANAGEMENT ---

  async getBranches(actor?: User): Promise<Branch[]> {
    const authenticatedActor = actor || mockAuthService.getCurrentSession()?.user;
    const store = mockStorage.getStore();
    const mapped = store.branches.map((b) => {
      const branchAdmins = store.users.filter(
        (u) => u.isActive && (u.branchId === b.id || u.id === b.assignedAdminId) && u.role === 'ADMIN'
      );
      const assignedAdmins = branchAdmins.map((u) => ({ id: u.id, name: u.name, email: u.email }));
      const assignedAdminName = assignedAdmins.map((a) => a.name).join(', ') || b.assignedAdminName || undefined;
      return {
        ...b,
        assignedAdmins,
        assignedAdminName,
        assignedAdminId: branchAdmins[0]?.id || b.assignedAdminId,
      };
    });
    if (authenticatedActor && authenticatedActor.role !== 'SUPER_ADMIN') {
      return mapped.filter((b) => b.id === authenticatedActor.branchId);
    }
    return [...mapped];
  }

  async getBranch(id: string, actor?: User): Promise<Branch | null> {
    const authenticatedActor = actor || mockAuthService.getCurrentSession()?.user;
    if (authenticatedActor && authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.branchId !== id) {
      return null;
    }
    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === id);
    return branch ? { ...branch } : null;
  }

  async createBranch(branchData: Omit<Branch, 'id'>, actor?: User): Promise<Branch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN') {
      throw new Error('Access Denied: Only Super Administrators can create salon branches.');
    }

    const store = mockStorage.getStore();

    const name = branchData.name?.trim();
    let code = branchData.code?.trim().toUpperCase();
    if (!name) {
      throw new Error('Branch name is required.');
    }
    if (!code || /^(?:BR)-\d+$/i.test(code)) {
      code = nextReference(store, 'BR');
    }

    if (store.branches.some((b) => b.code.toUpperCase() === code)) {
      throw new Error(`Branch code '${code}' is already registered to another branch.`);
    }

    // New branches start with ZERO opening balances and tax disabled until explicitly configured
    const newBranch: Branch = {
      id: `branch-${Date.now().toString(36)}`,
      name,
      code,
      phone: branchData.phone?.trim() || '+92 (42) 0000-000',
      email: branchData.email?.trim() || undefined,
      address: branchData.address?.trim() || 'Address Pending',
      city: branchData.city?.trim() || 'Lahore',
      timezone: branchData.timezone || 'Asia/Karachi',
      currency: branchData.currency || 'PKR',
      taxRate: 0.0,
      taxEnabled: false,
      openingCashFloat: 0.0,
      isActive: true,
      assignedAdminId: undefined,
      assignedAdminName: undefined,
    };

    store.branches.push(newBranch);
    mockStorage.saveStore(store);
    return { ...newBranch };
  }

  async updateBranch(id: string, branchData: Partial<Branch>, actor?: User): Promise<Branch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.branchId !== id) {
      throw new Error('Access Denied: You do not have permission to edit other branches.');
    }

    const store = mockStorage.getStore();
    const index = store.branches.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new Error(`Branch '${id}' not found.`);
    }

    // Unique code check if changed
    if (branchData.code) {
      const code = branchData.code.trim().toUpperCase();
      if (store.branches.some((b) => b.id !== id && b.code.toUpperCase() === code)) {
        throw new Error(`Branch code '${code}' is already registered to another branch.`);
      }
      branchData.code = code;
    }

    // Allowed update fields only
    const existing = store.branches[index];
    const updated: Branch = {
      ...existing,
      name: branchData.name?.trim() || existing.name,
      code: branchData.code || existing.code,
      phone: branchData.phone?.trim() || existing.phone,
      email: branchData.email?.trim() || existing.email,
      address: branchData.address?.trim() || existing.address,
      city: branchData.city?.trim() || existing.city,
      timezone: branchData.timezone || existing.timezone,
      logoUrl: branchData.logoUrl !== undefined ? branchData.logoUrl : existing.logoUrl,
      taxEnabled: branchData.taxEnabled ?? existing.taxEnabled,
      taxRate: branchData.taxRate ?? existing.taxRate,
      defaultTaxRuleId: branchData.defaultTaxRuleId !== undefined ? branchData.defaultTaxRuleId : existing.defaultTaxRuleId,
    };

    store.branches[index] = updated;
    mockStorage.saveStore(store);
    return { ...updated };
  }

  async assignBranchAdmin(branchId: string, adminUserId: string, actor?: User, credentials?: { email: string; password: string }): Promise<Branch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN') {
      throw new Error('Access Denied: Only Super Administrators can assign Branch Administrators.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    const user = store.users.find((u) => u.id === adminUserId);
    if (!user) {
      throw new Error(`Admin user '${adminUserId}' not found.`);
    }

    if (user.role !== 'ADMIN') {
      throw new Error(`User '${user.name}' does not have the ADMIN role.`);
    }

    if (!user.isActive) {
      throw new Error(`Cannot assign inactive administrator '${user.name}' to a branch.`);
    }

    let assignedUser = user;
    const otherAssignment = (user.branchId && user.branchId !== branchId) || store.branches.some((b) => b.id !== branchId && b.assignedAdminId === user.id);
    if (otherAssignment) {
      const email = credentials?.email.trim().toLowerCase();
      const password = credentials?.password;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 6 || password.length > 72) {
        throw new Error('A valid new login email and password (6?72 characters) are required for this branch.');
      }
      if (store.users.some((u) => u.email.toLowerCase() === email)) throw new Error('This login email is already registered.');
      assignedUser = { ...user, id: crypto.randomUUID(), email, password, staffId: undefined, branchId, branchName: branch.name };
      store.users.push(assignedUser);
    } else {
      user.branchId = branchId;
      user.branchName = branch.name;
    }
    branch.assignedAdminId = assignedUser.id;
    branch.assignedAdminName = assignedUser.name;

    mockStorage.saveStore(store);
    return { ...branch };
  }

  async unassignBranchAdmin(branchId: string, adminUserId: string, actor?: User): Promise<Branch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN') {
      throw new Error('Access Denied: Only Super Administrators can unassign Branch Administrators.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    const user = store.users.find((u) => u.id === adminUserId);
    if (user && user.branchId === branchId) {
      user.branchId = 'ALL';
      user.branchName = undefined;
    }

    if (branch.assignedAdminId === adminUserId) {
      const remaining = store.users.find((u) => u.branchId === branchId && u.role === 'ADMIN' && u.isActive && u.id !== adminUserId);
      branch.assignedAdminId = remaining ? remaining.id : undefined;
      branch.assignedAdminName = remaining ? remaining.name : undefined;
    }

    mockStorage.saveStore(store);
    return { ...branch };
  }

  async checkBranchDeactivationBlockers(id: string): Promise<{ canDeactivate: boolean; blockers: string[] }> {
    const store = mockStorage.getStore();
    const blockers: string[] = [];

    // 1. Active users
    const activeUsers = store.users.filter((u) => u.branchId === id && u.isActive);
    if (activeUsers.length > 0) {
      blockers.push(`Branch has ${activeUsers.length} active login account(s) (${activeUsers.map((u) => u.name).join(', ')}). Deactivate or reassign them first.`);
    }

    // 2. Active staff
    const activeStaff = store.staff.filter((s) => s.branchId === id && s.isActive);
    if (activeStaff.length > 0) {
      blockers.push(`Branch has ${activeStaff.length} active staff member(s). Deactivate or transfer them first.`);
    }

    // 3. Open cash drawers with balance
    const openDrawers = store.cashDrawers.filter((d) => d.branchId === id && d.status === 'OPEN' && d.actualInDrawer > 0);
    if (openDrawers.length > 0) {
      const totalDrawerCash = openDrawers.reduce((sum, d) => sum + d.actualInDrawer, 0);
      blockers.push(`Branch holds PKR ${totalDrawerCash.toLocaleString('en-PK')} in active cash drawers. Perform shift close & custody transfer first.`);
    }

    // 4. Pending settlements
    const pendingSettlements = store.settlements.filter((s) => s.branchId === id && s.status === 'PENDING_VERIFICATION');
    if (pendingSettlements.length > 0) {
      blockers.push(`Branch has ${pendingSettlements.length} cash settlement(s) awaiting verification.`);
    }

    return {
      canDeactivate: blockers.length === 0,
      blockers,
    };
  }

  async deactivateBranch(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN') {
      throw new Error('Access Denied: Only Super Administrators can deactivate salon branches.');
    }

    const { canDeactivate, blockers } = await this.checkBranchDeactivationBlockers(id);
    if (!canDeactivate) {
      throw new Error(`Cannot deactivate branch due to active dependencies:\n• ${blockers.join('\n• ')}`);
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === id);
    if (!branch) {
      throw new Error(`Branch '${id}' not found.`);
    }

    branch.isActive = false;
    mockStorage.saveStore(store);
    return { success: true, message: `Branch '${branch.name}' has been deactivated.` };
  }

  async deleteBranch(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN') {
      throw new Error('Access Denied: Only Super Administrators can delete salon branches.');
    }

    const store = mockStorage.getStore();
    if (store.branches.length <= 1) {
      throw new Error('Cannot delete the only remaining branch in the system.');
    }

    const branchIdx = store.branches.findIndex((b) => b.id === id);
    if (branchIdx === -1) {
      throw new Error(`Branch '${id}' not found.`);
    }

    const branchName = store.branches[branchIdx].name;
    store.branches.splice(branchIdx, 1);
    mockStorage.saveStore(store);
    return { success: true, message: `Branch '${branchName}' has been permanently deleted.` };
  }

  // --- USERS & ACCESS ---

  async getUsers(actor?: User, branchId?: string): Promise<User[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: You do not have permission to view system users.');
    }

    const store = mockStorage.getStore();
    let users = [...store.users];

    if (authenticatedActor.role === 'ADMIN') {
      users = users.filter((u) => u.branchId === authenticatedActor.branchId);
    } else if (branchId && branchId !== 'ALL') {
      users = users.filter((u) => u.branchId === branchId);
    }

    // Exclude password from user list responses
    return users.map(sanitizeUser);
  }

  async getUser(id: string): Promise<User | null> {
    const store = mockStorage.getStore();
    const user = store.users.find((u) => u.id === id);
    return user ? sanitizeUser(user) : null;
  }

  async createUser(
    params: {
      name: string;
      email: string;
      role: Role;
      branchId: string;
      staffId?: string;
      title: string;
      password?: string;
      phone?: string;
    },
    actor?: User
  ): Promise<User> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can create new user accounts.');
    }

    const store = mockStorage.getStore();

    // Permissions check
    if (authenticatedActor.role === 'ADMIN') {
      if (params.role === 'SUPER_ADMIN' || params.role === 'ADMIN') {
        throw new Error('Access Denied: Branch Administrators can only create Accountant and Staff accounts.');
      }
      params.branchId = authenticatedActor.branchId as string;
    } else if (!params.branchId || params.branchId === 'ALL') {
      if (params.role !== 'SUPER_ADMIN') {
        throw new Error('Please select a specific branch for this user.');
      }
    }

    const email = params.email.trim().toLowerCase();
    if (store.users.some((u) => u.email.trim().toLowerCase() === email)) {
      throw new Error(`Login identifier '${email}' is already registered to another account.`);
    }

    // Staff account validation: enforce one STAFF login per employee
    if (params.role === 'STAFF') {
      if (!params.staffId) {
        throw new Error('Staff accounts must be linked to a valid employee profile.');
      }
      const staff = store.staff.find((s) => s.id === params.staffId);
      if (!staff) {
        throw new Error(`Employee profile '${params.staffId}' not found.`);
      }
      if (!staff.isActive) {
        throw new Error(`Cannot create login for inactive employee '${staff.name}'.`);
      }
      if (staff.branchId !== params.branchId) {
        throw new Error('Employee branch assignment does not match requested user branch.');
      }

      // Check if user already exists for this staff member (active or inactive)
      const existingLinkedUser = store.users.find((u) => u.staffId === staff.id);
      if (existingLinkedUser) {
        // Re-enable existing user instead of creating duplicate
        existingLinkedUser.isActive = true;
        existingLinkedUser.email = email;
        existingLinkedUser.name = params.name.trim();
        if (params.password) existingLinkedUser.password = params.password;
        staff.hasPortalAccess = true;
        staff.linkedUserId = existingLinkedUser.id;
        staff.linkedUserEmail = email;
        mockStorage.saveStore(store);
        return sanitizeUser(existingLinkedUser);
      }
    }

    const branch = store.branches.find((b) => b.id === params.branchId);

    const newUser: User = {
      id: `usr-${Date.now().toString(36)}`,
      name: params.name.trim(),
      email,
      role: params.role,
      branchId: params.branchId,
      branchName: branch?.name || 'All Branches',
      staffId: params.staffId,
      title: params.title.trim(),
      phone: params.phone?.trim(),
      isActive: true,
      createdAt: mockStorage.getSystemDate(),
      password: params.password?.trim() || 'Salon@2026',
    };

    store.users.push(newUser);

    if (params.role === 'STAFF' && params.staffId) {
      const staff = store.staff.find((s) => s.id === params.staffId);
      if (staff) {
        staff.hasPortalAccess = true;
        staff.linkedUserId = newUser.id;
        staff.linkedUserEmail = newUser.email;
      }
    }

    mockStorage.saveStore(store);
    return sanitizeUser(newUser);
  }

  async updateUser(id: string, params: Partial<User>, actor?: User): Promise<User> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: You do not have permission to edit user accounts.');
    }

    const store = mockStorage.getStore();
    const userIndex = store.users.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      throw new Error(`User '${id}' not found.`);
    }

    const targetUser = store.users[userIndex];

    if (authenticatedActor.role === 'ADMIN') {
      if (targetUser.role === 'SUPER_ADMIN' || targetUser.role === 'ADMIN') {
        throw new Error('Access Denied: Branch Administrators cannot edit Administrator accounts.');
      }
      if (targetUser.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot edit user from another branch.');
      }
    }

    // Check unique email if modified
    if (params.email) {
      const email = params.email.trim().toLowerCase();
      if (store.users.some((u) => u.id !== id && u.email.trim().toLowerCase() === email)) {
        throw new Error(`Login identifier '${email}' is already in use.`);
      }
      targetUser.email = email;
    }

    if (params.name) targetUser.name = params.name.trim();
    if (params.phone !== undefined) targetUser.phone = params.phone?.trim();
    if (params.title) targetUser.title = params.title.trim();
    if (params.isActive !== undefined) {
      targetUser.isActive = Boolean(params.isActive);
      if (targetUser.staffId) {
        const staff = store.staff.find((s) => s.id === targetUser.staffId);
        if (staff) {
          staff.hasPortalAccess = targetUser.isActive;
        }
      }
    }

    if (authenticatedActor.role === 'SUPER_ADMIN') {
      if (params.role) {
        if (targetUser.role === 'SUPER_ADMIN' && params.role !== 'SUPER_ADMIN') {
          throw new Error('Operation Blocked: Cannot demote the primary Super Administrator account.');
        }
        targetUser.role = params.role;
      }
      if (params.branchId !== undefined) {
        const nextRole = targetUser.role;
        if (nextRole === 'SUPER_ADMIN' || params.branchId === 'ALL' || !params.branchId) {
          targetUser.branchId = 'ALL';
          targetUser.branchName = 'All Branches (Consolidated)';
        } else {
          const branch = store.branches.find((b) => b.id === params.branchId);
          if (branch) {
            targetUser.branchId = branch.id;
            targetUser.branchName = branch.name;
          }
        }
      }
    }

    store.users[userIndex] = targetUser;
    mockStorage.saveStore(store);
    return sanitizeUser(targetUser);
  }

  async deactivateUser(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can deactivate user accounts.');
    }

    const store = mockStorage.getStore();
    const targetUser = store.users.find((u) => u.id === id);
    if (!targetUser) {
      throw new Error(`User '${id}' not found.`);
    }

    if (id === authenticatedActor.id || id === 'usr-super-01' || targetUser.role === 'SUPER_ADMIN') {
      throw new Error('Operation Blocked: Cannot deactivate the primary Super Administrator account.');
    }

    if (authenticatedActor.role === 'ADMIN') {
      if (targetUser.role === 'ADMIN') {
        throw new Error('Access Denied: Branch Administrators cannot deactivate Administrator accounts.');
      }
      if (targetUser.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot deactivate user from another branch.');
      }
    }

    targetUser.isActive = false;

    // If linked to staff member, revoke portal access flag without deleting employee records
    if (targetUser.staffId) {
      const staff = store.staff.find((s) => s.id === targetUser.staffId);
      if (staff) {
        staff.hasPortalAccess = false;
      }
    }

    mockStorage.saveStore(store);
    return { success: true, message: `User account '${targetUser.name}' (${targetUser.email}) deactivated.` };
  }

  async reactivateUser(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can reactivate user accounts.');
    }

    const store = mockStorage.getStore();
    const targetUser = store.users.find((u) => u.id === id);
    if (!targetUser) {
      throw new Error(`User '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN') {
      if (targetUser.role === 'ADMIN' || targetUser.role === 'SUPER_ADMIN') {
        throw new Error('Access Denied: Branch Administrators cannot reactivate Administrator accounts.');
      }
      if (targetUser.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot reactivate user from another branch.');
      }
    }

    targetUser.isActive = true;

    if (targetUser.staffId) {
      const staff = store.staff.find((s) => s.id === targetUser.staffId);
      if (staff) {
        if (!staff.isActive) {
          throw new Error(`Cannot reactivate login: linked employee profile '${staff.name}' is inactive.`);
        }
        staff.hasPortalAccess = true;
      }
    }

    mockStorage.saveStore(store);
    return { success: true, message: `User account '${targetUser.name}' (${targetUser.email}) reactivated.` };
  }

  async deleteUser(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can delete user accounts.');
    }

    const store = mockStorage.getStore();
    const userIndex = store.users.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      throw new Error(`User '${id}' not found.`);
    }

    const targetUser = store.users[userIndex];

    if (id === authenticatedActor.id) {
      throw new Error('Operation Blocked: You cannot delete your own account.');
    }
    if (id === 'usr-super-01' || targetUser.role === 'SUPER_ADMIN') {
      throw new Error('Operation Blocked: Cannot delete Super Administrator accounts.');
    }

    if (authenticatedActor.role === 'ADMIN') {
      if (targetUser.role === 'ADMIN') {
        throw new Error('Access Denied: Branch Administrators cannot delete Administrator accounts.');
      }
      if (targetUser.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot delete user from another branch.');
      }
    }

    if (targetUser.staffId) {
      const staff = store.staff.find((s) => s.id === targetUser.staffId);
      if (staff) {
        staff.hasPortalAccess = false;
      }
    }

    // Clear branch assigned admin if linked
    const branch = store.branches.find((b) => b.assignedAdminId === id);
    if (branch) {
      branch.assignedAdminId = undefined as any;
    }

    store.users.splice(userIndex, 1);
    mockStorage.saveStore(store);
    return { success: true, message: `User account '${targetUser.name}' (${targetUser.email}) permanently deleted.` };
  }

  async resetUserPassword(id: string, actor?: User, newPassword?: string): Promise<{ success: boolean; temporaryPassword?: string; password?: string; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can reset account passwords.');
    }

    const store = mockStorage.getStore();
    const targetUser = store.users.find((u) => u.id === id);
    if (!targetUser) {
      throw new Error(`User '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN') {
      if (targetUser.role === 'SUPER_ADMIN' || targetUser.role === 'ADMIN') {
        throw new Error('Access Denied: Branch Administrators cannot reset credentials for Administrator accounts.');
      }
      if (targetUser.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Branch Administrators cannot reset credentials for users in another branch.');
      }
    }

    // Use custom password if provided, else generate secure temp password
    const finalPassword = newPassword && newPassword.trim() ? newPassword.trim() : `Temp@${Math.floor(1000 + Math.random() * 9000)}`;
    targetUser.password = finalPassword;
    mockStorage.saveStore(store);

    return {
      success: true,
      temporaryPassword: finalPassword,
      password: finalPassword,
      message: `Credentials for ${targetUser.name} have been updated successfully.`,
    };
  }

  // --- STAFF DIRECTORY ---

  async getStaffMembers(actor?: User, branchId?: string): Promise<StaffMember[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN' && authenticatedActor.role !== 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Administrators and authorized cashiers can view staff members.');
    }

    const store = mockStorage.getStore();
    let staff = [...store.staff];

    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      staff = staff.filter((s) => s.branchId === authenticatedActor.branchId);
    } else if (branchId && branchId !== 'ALL') {
      staff = staff.filter((s) => s.branchId === branchId);
    }

    return staff;
  }

  async getStaffMember(id: string): Promise<StaffMember | null> {
    const store = mockStorage.getStore();
    const staff = store.staff.find((s) => s.id === id);
    return staff ? { ...staff } : null;
  }

  async createStaffMember(
    params: {
      employeeCode: string;
      name: string;
      phone: string;
      email?: string;
      branchId: string;
      designation: string;
      joiningDate: string;
      compensationType: StaffMember['compensationType'];
      baseSalary?: number;
      dailySalaryRate?: number;
      commissionRate?: number;
      overtimeHourlyRate: number;
      effectiveDate?: string;
      startTime?: string;
      endTime?: string;
      lateGraceMinutes?: number;
      earlyGraceMinutes?: number;
      isOvernightShift?: boolean;
      allowedLeaveDays?: number;
      leaveAllowancePeriod?: StaffMember['leaveAllowancePeriod'];
      lateInDeduction?: StaffMember['lateInDeduction'];
      earlyExitDeduction?: StaffMember['earlyExitDeduction'];
      payrollDivisor?: number;
      combinationPolicy?: StaffMember['combinationPolicy'];
      specialties?: string[];
      enablePortalAccess?: boolean;
      portalPassword?: string;
      portalIdentifier?: string;
    },
    actor?: User
  ): Promise<{ staff: StaffMember; user?: User }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can add employees.');
    }

    const store = mockStorage.getStore();

    if (authenticatedActor.role === 'ADMIN') {
      params.branchId = authenticatedActor.branchId as string;
    } else if (!params.branchId || params.branchId === 'ALL') {
      throw new Error('Please select an explicit branch for this employee.');
    }

    const branch = store.branches.find((b) => b.id === params.branchId);
    if (!branch || !branch.isActive) {
      throw new Error('Cannot add staff to an inactive or non-existent branch.');
    }

    // Sanitize and validate 5 compensation types & hidden field leaks
    const compType = params.compensationType || 'MONTHLY_SALARY';
    let baseSalary = 0;
    let dailySalaryRate = 0;
    let commissionRate = 0;

    if (compType === 'MONTHLY_SALARY') {
      baseSalary = params.baseSalary ?? 0;
    } else if (compType === 'DAILY_SALARY') {
      dailySalaryRate = params.dailySalaryRate ?? 0;
    } else if (compType === 'MONTHLY_PLUS_COMMISSION') {
      baseSalary = params.baseSalary ?? 0;
      commissionRate = params.commissionRate ?? 0;
    } else if (compType === 'DAILY_PLUS_COMMISSION') {
      dailySalaryRate = params.dailySalaryRate ?? 0;
      commissionRate = params.commissionRate ?? 0;
    } else if (compType === 'COMMISSION_ONLY') {
      commissionRate = params.commissionRate ?? 0;
    }

    if (baseSalary < 0 || isNaN(baseSalary)) throw new Error('Base salary must be a non-negative number.');
    if (dailySalaryRate < 0 || isNaN(dailySalaryRate)) throw new Error('Daily salary rate must be a non-negative number.');
    if (commissionRate < 0 || commissionRate > 100 || isNaN(commissionRate)) {
      throw new Error('Commission rate must be between 0% and 100%.');
    }

    const overtimeRate = params.overtimeHourlyRate ?? 0;
    if (overtimeRate < 0 || isNaN(overtimeRate)) throw new Error('Overtime hourly rate must be a non-negative number.');

    // Schedule & Grace Periods
    const startTime = params.startTime || '09:00';
    const endTime = params.endTime || '18:00';
    const lateGrace = params.lateGraceMinutes ?? 15;
    const earlyGrace = params.earlyGraceMinutes ?? 15;
    if (lateGrace < 0 || earlyGrace < 0) throw new Error('Grace periods must be non-negative minute values.');

    // Leaves
    const leaveDays = params.allowedLeaveDays ?? 12;
    if (leaveDays < 0) throw new Error('Allowed leave days must be non-negative.');
    const leavePeriod = params.leaveAllowancePeriod || 'YEARLY';

    // Deductions
    let lateInDeduction = params.lateInDeduction || { enabled: false, type: 'FIXED', amount: 0 };
    let earlyExitDeduction = params.earlyExitDeduction || { enabled: false, type: 'FIXED', amount: 0 };
    const payrollDivisor = params.payrollDivisor ?? 30;

    // Commission Only cannot have salary deductions
    if (compType === 'COMMISSION_ONLY') {
      lateInDeduction = { enabled: false, type: 'FIXED', amount: 0 };
      earlyExitDeduction = { enabled: false, type: 'FIXED', amount: 0 };
    }

    // Require payroll divisor for monthly staff percentage deductions
    const isMonthly = compType === 'MONTHLY_SALARY' || compType === 'MONTHLY_PLUS_COMMISSION';
    if (isMonthly) {
      const hasPercentage = (lateInDeduction.enabled && lateInDeduction.type === 'PERCENTAGE') ||
                            (earlyExitDeduction.enabled && earlyExitDeduction.type === 'PERCENTAGE');
      if (hasPercentage && (!payrollDivisor || payrollDivisor <= 0)) {
        throw new Error('Payroll divisor (e.g. 26 or 30 days) is required for percentage deductions on monthly staff.');
      }
    }

    const branchList = store.branches || [];
    const bIdx = branchList.findIndex((b) => b.id === params.branchId);
    const branchNum = bIdx !== -1 ? bIdx + 1 : (params.branchId?.match(/(\d+)$/)?.[1] || 1);
    const prefix = `EMP${branchNum}`;
    const code = !params.employeeCode || /^EMP\d*-\d+$/i.test(params.employeeCode) ? nextReference(store, prefix) : params.employeeCode.trim().toUpperCase();
    if (!code) throw new Error('Unique employee code is required.');
    if (store.staff.some((s) => s.employeeCode.toUpperCase() === code)) {
      throw new Error(`Employee code '${code}' is already assigned to another staff member.`);
    }

    const newStaff: StaffMember = {
      id: `staff-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
      employeeCode: code,
      branchId: params.branchId,
      branchName: branch.name,
      name: params.name.trim(),
      phone: params.phone.trim(),
      email: params.email?.trim() || undefined,
      designation: params.designation.trim(),
      roleTitle: params.designation.trim(),
      joiningDate: params.joiningDate || mockStorage.getSystemDate(),
      compensationType: compType,
      baseSalary,
      dailySalaryRate,
      commissionRate,
      overtimeHourlyRate: overtimeRate,
      effectiveDate: params.effectiveDate || mockStorage.getSystemDate(),
      startTime,
      endTime,
      lateGraceMinutes: lateGrace,
      earlyGraceMinutes: earlyGrace,
      isOvernightShift: params.isOvernightShift ?? false,
      allowedLeaveDays: leaveDays,
      leaveAllowancePeriod: leavePeriod,
      lateInDeduction,
      earlyExitDeduction,
      payrollDivisor,
      combinationPolicy: params.combinationPolicy || 'BOTH',
      specialties: params.specialties || [],
      isActive: true,
      hasPortalAccess: false,
    };

    let createdUser: User | undefined;

    if (params.enablePortalAccess) {
      const identifier = params.portalIdentifier?.trim().toLowerCase() || params.email?.trim().toLowerCase();
      if (!identifier) {
        throw new Error('A valid login identifier is required to enable staff portal access.');
      }

      if (store.users.some((u) => u.email.trim().toLowerCase() === identifier)) {
        throw new Error(`Login identifier '${identifier}' is already registered to another account.`);
      }

      const newUser: User = {
        id: `usr-${Date.now().toString(36)}`,
        name: newStaff.name,
        email: identifier,
        role: 'STAFF',
        branchId: newStaff.branchId,
        branchName: newStaff.branchName,
        staffId: newStaff.id,
        title: newStaff.designation,
        phone: newStaff.phone,
        isActive: true,
        createdAt: mockStorage.getSystemDate(),
        password: params.portalPassword?.trim() || 'Staff@2026',
      };

      store.users.push(newUser);
      createdUser = sanitizeUser(newUser);
      newStaff.hasPortalAccess = true;
      newStaff.linkedUserId = newUser.id;
      newStaff.linkedUserEmail = identifier;
    }

    store.staff.push(newStaff);
    mockStorage.saveStore(store);
    return { staff: { ...newStaff }, user: createdUser };
  }

  async updateStaffMember(id: string, params: Partial<StaffMember> & { enablePortalAccess?: boolean; portalIdentifier?: string; portalPassword?: string }, actor?: User): Promise<StaffMember> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can update employee profiles.');
    }

    const store = mockStorage.getStore();
    const originalStore = structuredClone(store);
    const index = store.staff.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Employee '${id}' not found.`);
    }

    const staff = store.staff[index];
    if (authenticatedActor.role === 'ADMIN' && staff.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit employee from another branch.');
    }

    if (params.branchId && params.branchId !== staff.branchId) {
      throw new Error('Employee branch transfers require an explicit operational transfer workflow.');
    }

    const compType = params.compensationType || staff.compensationType || 'MONTHLY_SALARY';

    let baseSalary = params.baseSalary !== undefined ? params.baseSalary : staff.baseSalary;
    let dailySalaryRate = params.dailySalaryRate !== undefined ? params.dailySalaryRate : staff.dailySalaryRate;
    let commissionRate = params.commissionRate !== undefined ? params.commissionRate : staff.commissionRate;

    // Enforce 5 compensation type field isolation (clears hidden inputs)
    if (compType === 'MONTHLY_SALARY') {
      dailySalaryRate = 0;
      commissionRate = 0;
    } else if (compType === 'DAILY_SALARY') {
      baseSalary = 0;
      commissionRate = 0;
    } else if (compType === 'MONTHLY_PLUS_COMMISSION') {
      dailySalaryRate = 0;
    } else if (compType === 'DAILY_PLUS_COMMISSION') {
      baseSalary = 0;
    } else if (compType === 'COMMISSION_ONLY') {
      baseSalary = 0;
      dailySalaryRate = 0;
    }

    if (baseSalary < 0 || isNaN(baseSalary)) throw new Error('Base salary must be a non-negative number.');
    if (dailySalaryRate < 0 || isNaN(dailySalaryRate)) throw new Error('Daily salary rate must be a non-negative number.');
    if (commissionRate < 0 || commissionRate > 100 || isNaN(commissionRate)) {
      throw new Error('Commission rate must be between 0% and 100%.');
    }

    const overtimeRate = params.overtimeHourlyRate !== undefined ? params.overtimeHourlyRate : staff.overtimeHourlyRate;
    if (overtimeRate < 0 || isNaN(overtimeRate)) throw new Error('Overtime hourly rate must be a non-negative number.');

    let lateInDeduction = params.lateInDeduction || staff.lateInDeduction || { enabled: false, type: 'FIXED', amount: 0 };
    let earlyExitDeduction = params.earlyExitDeduction || staff.earlyExitDeduction || { enabled: false, type: 'FIXED', amount: 0 };
    const payrollDivisor = params.payrollDivisor !== undefined ? params.payrollDivisor : (staff.payrollDivisor ?? 30);

    if (compType === 'COMMISSION_ONLY') {
      lateInDeduction = { enabled: false, type: 'FIXED', amount: 0 };
      earlyExitDeduction = { enabled: false, type: 'FIXED', amount: 0 };
    }

    const isMonthly = compType === 'MONTHLY_SALARY' || compType === 'MONTHLY_PLUS_COMMISSION';
    if (isMonthly) {
      const hasPercentage = (lateInDeduction.enabled && lateInDeduction.type === 'PERCENTAGE') ||
                            (earlyExitDeduction.enabled && earlyExitDeduction.type === 'PERCENTAGE');
      if (hasPercentage && (!payrollDivisor || payrollDivisor <= 0)) {
        throw new Error('Payroll divisor (e.g. 26 or 30 days) is required for percentage deductions on monthly staff.');
      }
    }

    const updated: StaffMember = {
      ...staff,
      name: params.name?.trim() || staff.name,
      phone: params.phone?.trim() || staff.phone,
      email: params.email?.trim() || staff.email,
      designation: params.designation?.trim() || staff.designation,
      roleTitle: params.designation?.trim() || staff.roleTitle,
      compensationType: compType,
      baseSalary,
      dailySalaryRate,
      commissionRate,
      overtimeHourlyRate: overtimeRate,
      effectiveDate: params.effectiveDate || staff.effectiveDate || mockStorage.getSystemDate(),
      startTime: params.startTime || staff.startTime || '09:00',
      endTime: params.endTime || staff.endTime || '18:00',
      lateGraceMinutes: params.lateGraceMinutes !== undefined ? params.lateGraceMinutes : staff.lateGraceMinutes,
      earlyGraceMinutes: params.earlyGraceMinutes !== undefined ? params.earlyGraceMinutes : staff.earlyGraceMinutes,
      isOvernightShift: params.isOvernightShift !== undefined ? params.isOvernightShift : staff.isOvernightShift,
      allowedLeaveDays: params.allowedLeaveDays !== undefined ? params.allowedLeaveDays : staff.allowedLeaveDays,
      leaveAllowancePeriod: params.leaveAllowancePeriod || staff.leaveAllowancePeriod || 'YEARLY',
      lateInDeduction,
      earlyExitDeduction,
      payrollDivisor,
      combinationPolicy: params.combinationPolicy || staff.combinationPolicy || 'BOTH',
      specialties: params.specialties || staff.specialties,
      requiresCompensationReview: false,
    };

    if (params.isActive === false) {
      updated.isActive = false;
      updated.hasPortalAccess = false;
      const linkedUser = store.users.find((u) => u.staffId === staff.id);
      if (linkedUser) {
        linkedUser.isActive = false;
      }
    } else if (params.isActive === true) {
      updated.isActive = true;
    }

    store.staff[index] = updated;

    const linkedUser = store.users.find((u) => u.staffId === staff.id);
    if (linkedUser) {
      linkedUser.name = updated.name;
      linkedUser.title = updated.designation;
      linkedUser.phone = updated.phone;
    }

    mockStorage.saveStore(store);
    if (params.enablePortalAccess !== undefined && params.isActive !== false) {
      try {
        return (await this.setStaffPortalAccess(id, params.enablePortalAccess, {
          identifier: params.portalIdentifier || '', password: params.portalPassword,
        }, authenticatedActor)).staff;
      } catch (error) {
        mockStorage.saveStore(originalStore);
        throw error;
      }
    }
    return { ...updated };
  }

  async deactivateStaffMember(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can deactivate staff.');
    }

    const store = mockStorage.getStore();
    const staff = store.staff.find((s) => s.id === id);
    if (!staff) {
      throw new Error(`Employee '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && staff.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot deactivate employee from another branch.');
    }

    staff.isActive = false;
    staff.hasPortalAccess = false;

    const linkedUser = store.users.find((u) => u.staffId === staff.id);
    if (linkedUser) {
      linkedUser.isActive = false;
    }

    mockStorage.saveStore(store);
    return { success: true, message: `Employee '${staff.name}' (${staff.employeeCode}) has been deactivated and portal access revoked.` };
  }

  async setStaffPortalAccess(
    staffId: string,
    enable: boolean,
    credentials?: { identifier: string; password?: string },
    actor?: User
  ): Promise<{ staff: StaffMember; user?: User }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can configure employee portal access.');
    }

    const store = mockStorage.getStore();
    const staff = store.staff.find((s) => s.id === staffId);
    if (!staff) {
      throw new Error(`Staff record '${staffId}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && staff.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot configure portal access for an employee in another branch.');
    }

    let resultUser: User | undefined;

    if (!enable) {
      staff.hasPortalAccess = false;
      const user = store.users.find((u) => u.staffId === staff.id);
      if (user) {
        user.isActive = false;
      }
    } else {
      // Reject portal activation for inactive employees
      if (!staff.isActive) {
        throw new Error('Cannot enable portal access for an inactive employee. Re-activate employment first.');
      }

      // Reject portal activation for inactive branches
      const branch = store.branches.find((b) => b.id === staff.branchId);
      if (!branch || !branch.isActive) {
        throw new Error('Cannot enable portal access for an employee in an inactive branch.');
      }

      const identifier = credentials?.identifier?.trim().toLowerCase() || store.users.find((u) => u.staffId === staff.id)?.email || staff.email?.trim().toLowerCase();
      if (!identifier) {
        throw new Error('A valid login identifier is required to enable portal access.');
      }

      // Check if user already exists for this staff member (across active & inactive)
      let existingUser = store.users.find((u) => u.staffId === staff.id);

      // Verify identifier uniqueness across all OTHER accounts
      if (store.users.some((u) => u.id !== existingUser?.id && u.email.trim().toLowerCase() === identifier)) {
        throw new Error(`Login identifier '${identifier}' is already registered to another account.`);
      }

      if (existingUser) {
        // Re-enable the existing account instead of creating another
        existingUser.isActive = true;
        existingUser.email = identifier;
        existingUser.branchId = staff.branchId;
        existingUser.branchName = staff.branchName;
        if (credentials?.password) {
          existingUser.password = credentials.password;
        }
        resultUser = sanitizeUser(existingUser);
      } else {
        const newUser: User = {
          id: `usr-${Date.now().toString(36)}`,
          name: staff.name,
          email: identifier,
          role: 'STAFF',
          branchId: staff.branchId,
          branchName: staff.branchName,
          staffId: staff.id,
          title: staff.designation,
          phone: staff.phone,
          isActive: true,
          createdAt: mockStorage.getSystemDate(),
          password: credentials?.password?.trim() || 'Staff@2026',
        };
        store.users.push(newUser);
        resultUser = sanitizeUser(newUser);
        staff.linkedUserId = newUser.id;
      }

      staff.hasPortalAccess = true;
      staff.linkedUserEmail = identifier;
    }

    mockStorage.saveStore(store);
    return { staff: { ...staff }, user: resultUser };
  }

  // --- QUERY APIS ---

  async getOnlineAccounts(branchId: string | 'ALL'): Promise<OnlineAccount[]> {
    const store = mockStorage.getStore();
    if (branchId === 'ALL') {
      return [...store.onlineAccounts];
    }
    return store.onlineAccounts.filter((acc) => acc.branchId === branchId);
  }

  async getStaff(branchId: string | 'ALL'): Promise<StaffMember[]> {
    const store = mockStorage.getStore();
    if (branchId === 'ALL') {
      return [...store.staff];
    }
    return store.staff.filter((s) => s.branchId === branchId);
  }

  async getCashDrawers(branchId: string | 'ALL', userId?: string): Promise<CashDrawer[]> {
    const store = mockStorage.getStore();
    let list = branchId === 'ALL' ? [...store.cashDrawers] : store.cashDrawers.filter((d) => d.branchId === branchId);
    if (userId) {
      list = list.filter((d) => d.custodianUserId === userId);
    }
    return list;
  }

  async getAttendance(branchId: string | 'ALL', date?: string, staffId?: string, actor?: User): Promise<AttendanceRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants do not have permission to view staff attendance.');
    }
    if (authenticatedActor.role === 'STAFF') {
      const store = mockStorage.getStore();
      const staffMember = store.staff.find(
        (s) => s.linkedUserId === authenticatedActor.id || s.linkedUserEmail === authenticatedActor.email || s.id === authenticatedActor.id
      );
      if (!staffMember || (staffId && staffId !== staffMember.id)) {
        throw new Error('Access Denied: Staff members can only view their own attendance records.');
      }
      staffId = staffMember.id;
    }
    if (authenticatedActor.role === 'ADMIN' && branchId !== 'ALL' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot view attendance from another branch.');
    }

    const store = mockStorage.getStore();
    const targetBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;

    let atts = targetBranchId === 'ALL'
      ? [...store.attendance]
      : store.attendance.filter((a) => a.branchId === targetBranchId);

    if (date) {
      atts = atts.filter((a) => a.date === date);
    }
    if (staffId) {
      atts = atts.filter((a) => a.staffId === staffId);
    }

    // Enrich with staff details and live calculation snapshot if needed
    return atts.map((a) => {
      const staff = store.staff.find((s) => s.id === a.staffId);
      const isLate = a.isLate ?? false;
      const lateMinutes = a.lateMinutes ?? 0;
      const isEarlyExit = a.isEarlyExit ?? false;
      const earlyExitMinutes = a.earlyExitMinutes ?? 0;
      const snapshot = a.calculationSnapshot || (staff ? calculateDeductionSnapshot(staff, isLate, lateMinutes, isEarlyExit, earlyExitMinutes) : undefined);

      return {
        ...a,
        employeeCode: a.employeeCode || staff?.employeeCode,
        designation: a.designation || staff?.designation || staff?.roleTitle,
        scheduledShift: a.scheduledShift || (staff ? `${formatMinutesToTime(parseTimeToMinutes(staff.startTime))} - ${formatMinutesToTime(parseTimeToMinutes(staff.endTime))}` : undefined),
        calculationSnapshot: snapshot,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }

  async getOvertime(branchId: string | 'ALL', staffId?: string, actor?: User): Promise<OvertimeRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants do not have permission to view overtime.');
    }
    if (authenticatedActor.role === 'STAFF') {
      const store = mockStorage.getStore();
      const staffMember = store.staff.find(
        (s) => s.linkedUserId === authenticatedActor.id || s.linkedUserEmail === authenticatedActor.email || s.id === authenticatedActor.id
      );
      if (!staffMember || (staffId && staffId !== staffMember.id)) {
        throw new Error('Access Denied: Staff members can only view their own overtime records.');
      }
      staffId = staffMember.id;
    }
    if (authenticatedActor.role === 'ADMIN' && branchId !== 'ALL' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot view overtime from another branch.');
    }

    const store = mockStorage.getStore();
    const targetBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;

    let ots = targetBranchId === 'ALL'
      ? [...store.overtime]
      : store.overtime.filter((ot) => ot.branchId === targetBranchId);

    if (staffId) {
      ots = ots.filter((ot) => ot.staffId === staffId);
    }

    // Staff can only view APPROVED overtime
    if (authenticatedActor.role === 'STAFF') {
      ots = ots.filter((ot) => ot.status === 'APPROVED');
    }

    return ots.map((ot) => {
      const staff = store.staff.find((s) => s.id === ot.staffId);
      return {
        ...ot,
        employeeCode: ot.employeeCode || staff?.employeeCode,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }

  // --- DASHBOARDS ---

  async getSuperAdminDashboardData(activeBranchId: string | 'ALL'): Promise<SuperAdminDashboardData> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const store = mockStorage.getStore();
    const targetDate = mockStorage.getSystemDate();
    const isConsolidated = activeBranchId === 'ALL';

    if (!isConsolidated && !store.branches.some((b) => b.id === activeBranchId)) {
      throw new Error(`Invalid branch identifier '${activeBranchId}' in Super Admin scope.`);
    }

    const activeBranchName = isConsolidated
      ? 'All Branches (Consolidated)'
      : store.branches.find((b) => b.id === activeBranchId)?.name || 'Selected Branch';

    const metrics = this.computeBranchMetrics(activeBranchId, targetDate);

    const branchStats: BranchFinancialMetrics[] = store.branches
      .filter((b) => b.isActive)
      .map((b) => this.computeBranchMetrics(b.id, targetDate));

    const onlineAccounts = isConsolidated
      ? store.onlineAccounts
      : store.onlineAccounts.filter((acc) => acc.branchId === activeBranchId);

    const todayAppointments = (
      isConsolidated
        ? store.appointments
        : store.appointments.filter((a) => a.branchId === activeBranchId)
    ).filter((a) => a.date === targetDate);

    const invoices = isConsolidated
      ? store.invoices
      : store.invoices.filter((i) => i.branchId === activeBranchId);

    const cashDrawers = isConsolidated
      ? store.cashDrawers
      : store.cashDrawers.filter((cd) => cd.branchId === activeBranchId);

    const settlements = isConsolidated
      ? store.settlements
      : store.settlements.filter((s) => s.branchId === activeBranchId);

    const pendingSettlements = settlements.filter((s) => s.status === 'PENDING_VERIFICATION');

    return {
      isConsolidated,
      activeBranchId,
      activeBranchName,
      metrics,
      branchStats,
      onlineAccounts,
      todayAppointments,
      recentInvoices: invoices.slice(0, 5),
      cashDrawers,
      pendingSettlementsCount: pendingSettlements.length,
      pendingSettlementsTotal: pendingSettlements.reduce((sum, s) => sum + s.amount, 0),
    };
  }

  async getAdminDashboardData(branchId: string): Promise<AdminDashboardData> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const store = mockStorage.getStore();
    const targetDate = mockStorage.getSystemDate();

    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Unauthorized or invalid branch context: '${branchId}'. Access denied.`);
    }

    const metrics = this.computeBranchMetrics(branch.id, targetDate);

    const validOnDutyStatuses = ['ON_TIME', 'LATE', 'ON_DUTY'];
    const branchAttendance = store.attendance.filter(
      (a) => a.branchId === branch.id && a.date === targetDate
    );
    const presentAttendance = branchAttendance.filter((a) => validOnDutyStatuses.includes(a.status));
    const totalBranchStaff = store.staff.filter((s) => s.branchId === branch.id && s.isActive);

    const staffAttendanceSummary = {
      presentCount: presentAttendance.length,
      totalCount: totalBranchStaff.length,
      onDutyStaffNames: presentAttendance.map((a) => a.staffName),
    };

    const todayAppointments = store.appointments.filter(
      (a) => a.branchId === branch.id && a.date === targetDate
    );

    const branchInvoices = store.invoices.filter((i) => i.branchId === branch.id);
    const branchExpenses = store.expenses.filter((e) => e.branchId === branch.id);

    const pendingSettlement = store.settlements.find(
      (s) => s.branchId === branch.id && s.status === 'PENDING_VERIFICATION'
    );
    const unpaidInvCount = branchInvoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL').length;

    // 7 Days Upcoming Bookings & Appointments Alerts
    const todayMs = new Date(targetDate).getTime();
    const sevenDaysMs = todayMs + 7 * 86400000;

    const upcomingBookings = (store.bookings || []).filter((b: any) => {
      if (b.branchId !== branch.id) return false;
      if (b.status === 'CANCELLED' || b.status === 'COMPLETED') return false;
      const bDateMs = new Date(b.eventDate).getTime();
      return bDateMs >= todayMs && bDateMs <= sevenDaysMs;
    });

    const upcomingAppointments = (store.appointments || []).filter((a: any) => {
      if (a.branchId !== branch.id) return false;
      if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') return false;
      const aDateMs = new Date(a.date).getTime();
      return aDateMs >= todayMs && aDateMs <= sevenDaysMs;
    });

    const bookingAlerts = upcomingBookings.map((b: any) => {
      const diffDays = Math.max(0, Math.ceil((new Date(b.eventDate).getTime() - todayMs) / 86400000));
      const dayLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`;
      return {
        id: `booking-${b.id}`,
        type: 'BOOKING_REMINDER',
        title: `Upcoming Booking (${dayLabel})`,
        description: `${b.clientName} (${b.bookingNumber}) scheduled for ${b.eventDate} at ${b.serviceTime || 'counter'}. Total: PKR ${(Number(b.totalAmount) || 0).toLocaleString('en-PK')}.`,
        urgency: diffDays <= 2 ? ('high' as const) : ('medium' as const),
        href: `/operations/bookings?search=${encodeURIComponent(b.bookingNumber)}`,
        isBookingAlert: true,
        bookingNumber: b.bookingNumber,
        daysRemaining: diffDays,
      };
    });

    const appointmentAlerts = upcomingAppointments.map((a: any) => {
      const diffDays = Math.max(0, Math.ceil((new Date(a.date).getTime() - todayMs) / 86400000));
      const dayLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`;
      return {
        id: `appointment-${a.id}`,
        type: 'BOOKING_REMINDER',
        title: `Upcoming Appointment (${dayLabel})`,
        description: `${a.clientName} (${a.appointmentNumber}) scheduled for ${a.date} at ${a.startTime}. Price: PKR ${(Number(a.price) || 0).toLocaleString('en-PK')}.`,
        urgency: diffDays <= 2 ? ('high' as const) : ('medium' as const),
        href: `/operations/appointments?date=${a.date}`,
        isBookingAlert: true,
        bookingNumber: a.appointmentNumber,
        daysRemaining: diffDays,
      };
    });

    const pendingActions = [
      ...bookingAlerts,
      ...appointmentAlerts,
      ...(pendingSettlement
        ? [
            {
              id: 'pa-settlement',
              title: 'Pending Cash Settlement',
              description: `${pendingSettlement.submittedByName} submitted PKR ${pendingSettlement.amount.toLocaleString('en-PK')} for safe transfer.`,
              count: 1,
              urgency: 'high' as const,
              href: '/accounts/account-settlement',
            },
          ]
        : []),
      ...(unpaidInvCount > 0
        ? [
            {
              id: 'pa-unpaid',
              title: 'Outstanding Client Invoices',
              description: `${unpaidInvCount} invoice(s) totaling PKR ${metrics.outstandingReceivables.toLocaleString('en-PK')} awaiting payment collection.`,
              count: unpaidInvCount,
              urgency: 'medium' as const,
              href: '/reports/unpaid-invoices',
            },
          ]
        : []),
    ];

    return {
      branch,
      metrics,
      staffAttendanceSummary,
      todayAppointments,
      pendingActions,
      recentInvoices: branchInvoices.slice(0, 5),
      recentExpenses: branchExpenses.slice(0, 5),
      onlineAccounts: (store.onlineAccounts || []).filter((acc) => acc.branchId === branch.id),
      cashDrawers: (store.cashDrawers || []).filter((d) => d.branchId === branch.id),
    };
  }

  async getAccountantDashboardData(branchId: string, accountantUserId: string): Promise<AccountantDashboardData> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const store = mockStorage.getStore();
    const targetDate = mockStorage.getSystemDate();

    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Unauthorized or invalid branch context: '${branchId}'. Access denied.`);
    }

    // 1. Personal cash drawer custody strictly linked to this accountant user
    const userDrawer = store.cashDrawers.find(
      (d) => d.branchId === branch.id && d.custodianUserId === accountantUserId
    );
    const cashCustodyBalance = userDrawer ? userDrawer.actualInDrawer : 0;

    // 2. Personal collections strictly filtered by payment date AND exact processor match
    const branchInvoices = store.invoices.filter((i) => i.branchId === branch.id);
    const allPayments = branchInvoices.flatMap((i) => i.payments);

    const todayCashCollected = allPayments
      .filter((p) => p.method === 'CASH' && p.date === targetDate && p.processedByUserId === accountantUserId)
      .reduce((sum, p) => sum + p.amount, 0);

    const todayOnlineCollected = allPayments
      .filter((p) => p.method === 'ONLINE_ACCOUNT' && p.date === targetDate && p.processedByUserId === accountantUserId)
      .reduce((sum, p) => sum + p.amount, 0);

    // 3. Paid expenses scoped strictly by branch AND accountant custodian
    const expensesPaidByAccountant = store.expenses
      .filter((e) => e.branchId === branch.id && e.paidByUserId === accountantUserId && (e.status === 'PAID' || e.status === 'POSTED') && !e.reversalOfVoucherNumber)
      .reduce((sum, e) => sum + e.amount, 0);

    // 4. Personal settlements submitted by this accountant
    const personalSettlements = store.settlements.filter(
      (s) => s.branchId === branch.id && s.submittedByUserId === accountantUserId
    );
    const pendingSettlement = personalSettlements.find((s) => s.status === 'PENDING_VERIFICATION');
    const pendingSettlementAmount = pendingSettlement ? pendingSettlement.amount : 0;
    const settlementStatus = pendingSettlement
      ? 'PENDING_VERIFICATION'
      : personalSettlements.length > 0
      ? 'APPROVED_TRANSFERRED'
      : 'NO_PENDING';

    const unpaidInvoices = branchInvoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL');
    const unpaidInvoicesCount = unpaidInvoices.length;
    const unpaidInvoicesTotal = unpaidInvoices.reduce((sum, i) => sum + i.amountDue, 0);

    // Recent receipts and disbursements with exact processor match
    const recentCashReceipts = branchInvoices
      .filter((i) => i.payments.some((p) => p.method === 'CASH' && p.processedByUserId === accountantUserId))
      .slice(0, 5);
    const recentDisbursements = store.expenses
      .filter((e) => e.branchId === branch.id && e.paidByUserId === accountantUserId)
      .slice(0, 5);

    const expectedCashInCustody = userDrawer
      ? userDrawer.expectedInDrawer
      : roundCurrency((branch.openingCashFloat || 0) + todayCashCollected - expensesPaidByAccountant);

    const verifiedSettlements = personalSettlements.filter(
      (s) => s.status === 'APPROVED_TRANSFERRED'
    );
    const lastVerifiedSettlement = verifiedSettlements.length > 0
      ? verifiedSettlements[verifiedSettlements.length - 1]
      : null;

    const lastCountedCash = userDrawer
      ? userDrawer.actualInDrawer
      : lastVerifiedSettlement
      ? lastVerifiedSettlement.amount
      : 0;

    return {
      branch,
      cashCustodyBalance,
      expectedCashInCustody,
      lastCountedCash,
      todayCashCollected,
      todayOnlineCollected,
      expensesPaidByAccountant,
      pendingSettlementAmount,
      settlementStatus,
      unpaidInvoicesCount,
      unpaidInvoicesTotal,
      recentCashReceipts,
      recentDisbursements,
      activeSettlements: personalSettlements,
    };
  }

  async getStaffDashboardData(staffId: string, branchId: string): Promise<StaffDashboardData> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const store = mockStorage.getStore();
    const targetDate = mockStorage.getSystemDate();

    const staffMember = store.staff.find((s) => s.id === staffId);
    if (!staffMember) {
      throw new Error(`Staff profile '${staffId}' not found.`);
    }

    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Unauthorized branch context '${branchId}' for staff '${staffId}'.`);
    }

    if (staffMember.branchId !== branch.id) {
      throw new Error(`Staff record belongs to branch '${staffMember.branchId}', not '${branch.id}'. Access denied.`);
    }

    // Target month prefix YYYY-MM
    const targetMonth = targetDate.slice(0, 7);

    // Derive staff performance strictly from employee's actual records for targetMonth
    const staffInvoices = store.invoices.filter((inv) =>
      inv.branchId === branch.id &&
      inv.lineItems.some((li) => li.staffId === staffMember.id)
    );

    const completedItems = staffInvoices.flatMap((inv) =>
      inv.lineItems
        .filter((li) => li.staffId === staffMember.id)
        .map((li) => {
          // Attributed net service sales after discount proportion
          const discountProportion = inv.subtotal > 0 ? ((li.unitPrice * li.quantity) / inv.subtotal) * inv.discount : 0;
          const netItemSales = Math.max(0, li.unitPrice * li.quantity - discountProportion);
          return {
            ...li,
            netItemSales,
            invDate: inv.date,
            invNumber: inv.invoiceNumber,
            clientName: inv.clientName,
          };
        })
    );

    // Apply actual month filter to monthly service sales and counts
    const monthlyCompletedItems = completedItems.filter((li) => li.invDate.startsWith(targetMonth));
    const monthlyServicesCompletedCount = monthlyCompletedItems.length;
    const monthlyServiceSalesTotal = roundCurrency(monthlyCompletedItems.reduce((sum, li) => sum + li.netItemSales, 0));
    // Commission is calculated strictly from attributed net service sales after discount, excluding tax and tips
    const earnedCommissionTotal = roundCurrency(monthlyServiceSalesTotal * staffMember.commissionRate);

    // Tips collected from payment allocations for this staff member in targetMonth
    const personalTipsTotal = roundCurrency(
      staffInvoices
        .filter((inv) => inv.staffId === staffMember.id)
        .flatMap((inv) => inv.payments)
        .filter((p) => p.date.startsWith(targetMonth))
        .reduce((sum, p) => sum + (p.tipAmountAllocated || 0), 0)
    );

    // Real attendance on targetDate; missing attendance displays "Not recorded"
    const staffAttendanceToday = store.attendance.find(
      (a) => a.staffId === staffMember.id && a.date === targetDate
    );

    // Apply actual month filter to overtime
    const overtimeRecords = store.overtime.filter(
      (ot) => ot.staffId === staffMember.id && ot.date.startsWith(targetMonth)
    );
    const totalOTMinutes = overtimeRecords.reduce((sum, ot) => sum + ot.approvedMinutes, 0);

    // Approved manual overtime = (approved minutes / 60) * overtimeHourlyRate
    const hourlyRate = staffMember.overtimeHourlyRate || 0;
    const approvedOvertimePay = roundCurrency((totalOTMinutes / 60) * hourlyRate);

    const estimatedGrossPayout = roundCurrency(
      staffMember.baseSalary + earnedCommissionTotal + personalTipsTotal + approvedOvertimePay
    );

    // Calculate worked hours for the 7-day week ending on or containing targetDate
    const targetDateObj = new Date(targetDate);
    const weekStartObj = new Date(targetDateObj);
    weekStartObj.setDate(targetDateObj.getDate() - 6);
    const weekStartStr = weekStartObj.toISOString().split('T')[0];

    const weekStaffPunches = store.attendance.filter(
      (a) => a.staffId === staffMember.id && a.date >= weekStartStr && a.date <= targetDate
    );
    const workedHoursWeek = roundCurrency(weekStaffPunches.reduce((sum, a) => sum + (a.workedHours || 0), 0));

    const attendanceSummary = {
      todayCheckIn: staffAttendanceToday?.checkIn || 'Not recorded',
      scheduledHoursWeek: 48.0,
      workedHoursWeek,
      approvedOvertimeMinutesMonth: totalOTMinutes,
      status: staffAttendanceToday?.status || 'Not recorded',
    };

    const monthlyEarningsSummary = {
      baseSalary: staffMember.baseSalary,
      earnedCommission: earnedCommissionTotal,
      directTips: personalTipsTotal,
      approvedOvertimePay,
      estimatedGrossPayout,
    };

    // Itemized recent services derived directly from actual invoices
    const recentCompletedServices = completedItems.slice(0, 10).map((li, idx) => ({
      id: `rcs-${idx}-${li.id}`,
      date: li.invDate,
      serviceName: li.name,
      clientName: li.clientName,
      servicePrice: li.netItemSales,
      commissionEarned: roundCurrency(li.netItemSales * staffMember.commissionRate),
      tipReceived: 0,
    }));

    return {
      staffMember,
      branch,
      monthlyServicesCompletedCount,
      monthlyServiceSalesTotal,
      earnedCommissionTotal,
      personalTipsTotal,
      attendanceSummary,
      monthlyEarningsSummary,
      recentCompletedServices,
    };
  }

  // --- PHASE 2B: SERVICES CATALOGUE ---

  async getServices(branchId: string | 'ALL'): Promise<ServiceItem[]> {
    const store = mockStorage.getStore();
    const isVisibleService = (s: ServiceItem) =>
      !s.description?.startsWith('PACKAGE_EXCLUSIVE') &&
      !s.description?.startsWith('Auto-created');
    if (branchId === 'ALL') {
      return store.services.filter(isVisibleService);
    }
    return store.services.filter((s) => s.branchId === branchId && isVisibleService(s));
  }

  async getService(id: string): Promise<ServiceItem | null> {
    const store = mockStorage.getStore();
    const service = store.services.find((s) => s.id === id);
    return service ? { ...service } : null;
  }

  // Helper validation for Service proposal
  private validateServiceProposal(store: ReturnType<typeof mockStorage.getStore>, service: Omit<ServiceItem, 'id'>, currentId?: string): void {
    const branch = store.branches.find((b) => b.id === service.branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${service.branchId}' is invalid or deactivated.`);
    }

    const code = service.code?.trim().toUpperCase();
    if (!code) {
      throw new Error('Unique service code is required.');
    }
    if (store.services.some((s) => s.id !== currentId && s.branchId === service.branchId && s.code.toUpperCase() === code)) {
      throw new Error(`Service code '${code}' is already registered in this branch.`);
    }

    if (!service.name?.trim()) {
      throw new Error('Service name is required.');
    }

    if (typeof service.price !== 'number' || isNaN(service.price) || !isFinite(service.price) || service.price < 0) {
      throw new Error('Selling price must be a finite non-negative number.');
    }

    if (typeof service.durationMinutes !== 'number' || isNaN(service.durationMinutes) || service.durationMinutes <= 0) {
      service.durationMinutes = 30;
    }

    if (service.taxTreatment === 'SPECIFIC_RULE') {
      if (!service.specificTaxRuleId) {
        throw new Error('A specific tax rule must be selected when Tax Treatment is set to Specific Rule.');
      }
      const rule = store.taxRules.find((r) => r.id === service.specificTaxRuleId && r.branchId === service.branchId);
      if (!rule) {
        throw new Error('Selected specific tax rule does not exist in this branch.');
      }
      if (!rule.isActive) {
        throw new Error(`Selected tax rule '${rule.name}' is currently deactivated.`);
      }
    }
  }

  // Helper validation for Package proposal
  private validatePackageProposal(store: ReturnType<typeof mockStorage.getStore>, pkg: Omit<PackageItem, 'id'>, currentId?: string): void {
    const branch = store.branches.find((b) => b.id === pkg.branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${pkg.branchId}' is invalid or deactivated.`);
    }

    const code = pkg.code?.trim().toUpperCase();
    if (!code) {
      throw new Error('Unique package code is required.');
    }
    if (store.packages.some((p) => p.id !== currentId && p.branchId === pkg.branchId && p.code.toUpperCase() === code)) {
      throw new Error(`Package code '${code}' is already registered in this branch.`);
    }

    if (!pkg.name?.trim()) {
      throw new Error('Package name is required.');
    }

    if (typeof pkg.price !== 'number' || isNaN(pkg.price) || !isFinite(pkg.price) || pkg.price < 0) {
      throw new Error('Package selling price must be a finite non-negative number.');
    }

    if (!pkg.components || pkg.components.length === 0) {
      throw new Error('Package must include at least one component service.');
    }

    for (const comp of pkg.components) {
      const srv = store.services.find((s) => s.id === comp.serviceId);
      if (!srv) {
        throw new Error(`Component service '${comp.serviceName || comp.serviceId}' not found.`);
      }
      if (srv.branchId !== pkg.branchId) {
        throw new Error(`Component service '${srv.name}' belongs to a different branch.`);
      }
      if (!srv.isActive) {
        throw new Error(`Cannot include deactivated service '${srv.name}' in package.`);
      }
      if (typeof comp.quantity !== 'number' || !Number.isInteger(comp.quantity) || comp.quantity <= 0) {
        throw new Error(`Component '${srv.name}' quantity must be a positive whole number.`);
      }
    }

    const n = pkg.components.length;
    const hasValidAllocations = pkg.components.every(
      (c) => typeof c.allocationPercentage === 'number' && c.allocationPercentage > 0
    );
    const sumAllocations = hasValidAllocations
      ? pkg.components.reduce((sum, c) => sum + (c.allocationPercentage || 0), 0)
      : 0;

    if (!hasValidAllocations || Math.abs(sumAllocations - 100) > 0.001) {
      const base = n > 0 ? Math.floor((100 / n) * 100) / 100 : 0;
      let acc = 0;
      pkg.components.forEach((c, idx) => {
        if (idx === n - 1) {
          c.allocationPercentage = Number((100 - acc).toFixed(2));
        } else {
          c.allocationPercentage = base;
          acc += base;
        }
      });
    }

    if (pkg.taxTreatment === 'SPECIFIC_RULE') {
      if (!pkg.specificTaxRuleId) {
        throw new Error('A specific tax rule must be selected when Tax Treatment is set to Specific Rule.');
      }
      const rule = store.taxRules.find((r) => r.id === pkg.specificTaxRuleId && r.branchId === pkg.branchId);
      if (!rule) {
        throw new Error('Selected specific tax rule does not exist in this branch.');
      }
      if (!rule.isActive) {
        throw new Error(`Selected tax rule '${rule.name}' is currently deactivated.`);
      }
    }
  }

  async createService(serviceData: Omit<ServiceItem, 'id'>, actor?: User): Promise<ServiceItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can create services.');
    }

    const store = mockStorage.getStore();
    const branchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : serviceData.branchId;

    if (!branchId || branchId === 'ALL') {
      throw new Error('Please select an explicit branch for this service.');
    }

    let code = serviceData.code?.trim().toUpperCase();
    if (!code || /^(?:SRV|SVR)-\d+$/i.test(code)) {
      code = nextReference(store, 'SVR');
    }

    const proposed: Omit<ServiceItem, 'id'> = {
      branchId,
      code,
      name: serviceData.name?.trim() || '',
      category: serviceData.category || 'General',
      durationMinutes: Math.round(serviceData.durationMinutes || 0),
      price: roundCurrency(serviceData.price || 0),
      description: serviceData.description?.trim(),
      taxTreatment: serviceData.taxTreatment || 'BRANCH_DEFAULT',
      specificTaxRuleId: serviceData.specificTaxRuleId,
      isActive: serviceData.isActive ?? true,
    };

    // Validate cloned proposal before mutating store
    this.validateServiceProposal(store, proposed);

    const newService: ServiceItem = {
      id: `srv-${Date.now().toString(36)}`,
      ...proposed,
    };

    store.services.push(newService);
    mockStorage.saveStore(store);
    return { ...newService };
  }

  async updateService(id: string, serviceData: Partial<ServiceItem>, actor?: User): Promise<ServiceItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can update services.');
    }

    const store = mockStorage.getStore();
    const index = store.services.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Service '${id}' not found.`);
    }

    const currentService = store.services[index];
    if (authenticatedActor.role === 'ADMIN' && currentService.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit service from another branch.');
    }

    // Clone proposed update
    const proposed: Omit<ServiceItem, 'id'> = {
      branchId: currentService.branchId,
      code: serviceData.code !== undefined ? serviceData.code.trim().toUpperCase() : currentService.code,
      name: serviceData.name !== undefined ? serviceData.name.trim() : currentService.name,
      category: serviceData.category !== undefined ? serviceData.category.trim() : currentService.category,
      durationMinutes: serviceData.durationMinutes !== undefined ? Math.round(serviceData.durationMinutes) : currentService.durationMinutes,
      price: serviceData.price !== undefined ? roundCurrency(serviceData.price) : currentService.price,
      description: serviceData.description !== undefined ? serviceData.description?.trim() : currentService.description,
      taxTreatment: serviceData.taxTreatment !== undefined ? serviceData.taxTreatment : currentService.taxTreatment,
      specificTaxRuleId: serviceData.specificTaxRuleId !== undefined ? serviceData.specificTaxRuleId : currentService.specificTaxRuleId,
      isActive: serviceData.isActive !== undefined ? serviceData.isActive : currentService.isActive,
    };

    // Validate cloned proposal before committing
    this.validateServiceProposal(store, proposed, id);

    const updatedService: ServiceItem = {
      id,
      ...proposed,
    };

    store.services[index] = updatedService;
    mockStorage.saveStore(store);
    return { ...updatedService };
  }

  async toggleServiceStatus(id: string, actor?: User): Promise<ServiceItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can toggle service status.');
    }

    const store = mockStorage.getStore();
    const service = store.services.find((s) => s.id === id);
    if (!service) {
      throw new Error(`Service '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && service.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify service from another branch.');
    }

    service.isActive = !service.isActive;
    mockStorage.saveStore(store);
    return { ...service };
  }

  // --- PHASE 2B: PACKAGES ---

  async getPackages(branchId: string | 'ALL'): Promise<PackageItem[]> {
    const store = mockStorage.getStore();
    if (branchId === 'ALL') {
      return [...store.packages];
    }
    return store.packages.filter((p) => p.branchId === branchId);
  }

  async getPackage(id: string): Promise<PackageItem | null> {
    const store = mockStorage.getStore();
    const pkg = store.packages.find((p) => p.id === id);
    return pkg ? { ...pkg } : null;
  }

  async createPackage(pkgData: Omit<PackageItem, 'id'>, actor?: User): Promise<PackageItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can create packages.');
    }

    const store = mockStorage.getStore();
    const branchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : pkgData.branchId;

    if (!branchId || branchId === 'ALL') {
      throw new Error('Please select an explicit branch for this package.');
    }

    let code = pkgData.code?.trim().toUpperCase();
    if (!code || /^(?:PKG)-\d+$/i.test(code)) {
      code = nextReference(store, 'PKG');
    }

    const proposed: Omit<PackageItem, 'id'> = {
      branchId,
      code,
      name: pkgData.name?.trim() || '',
      description: pkgData.description?.trim(),
      price: roundCurrency(pkgData.price || 0),
      components: (pkgData.components || []).map((c) => ({
        ...c,
        allocationPercentage: roundCurrency(c.allocationPercentage || 0),
      })),
      taxTreatment: pkgData.taxTreatment || 'BRANCH_DEFAULT',
      specificTaxRuleId: pkgData.specificTaxRuleId,
      isActive: pkgData.isActive ?? true,
    };

    // Validate cloned proposal before mutating store
    this.validatePackageProposal(store, proposed);

    const newPackage: PackageItem = {
      id: `pkg-${Date.now().toString(36)}`,
      ...proposed,
    };

    store.packages.push(newPackage);
    mockStorage.saveStore(store);
    return { ...newPackage };
  }

  async updatePackage(id: string, pkgData: Partial<PackageItem>, actor?: User): Promise<PackageItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can update packages.');
    }

    const store = mockStorage.getStore();
    const index = store.packages.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Package '${id}' not found.`);
    }

    const currentPkg = store.packages[index];
    if (authenticatedActor.role === 'ADMIN' && currentPkg.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit package from another branch.');
    }

    const proposed: Omit<PackageItem, 'id'> = {
      branchId: currentPkg.branchId,
      code: pkgData.code !== undefined ? pkgData.code.trim().toUpperCase() : currentPkg.code,
      name: pkgData.name !== undefined ? pkgData.name.trim() : currentPkg.name,
      description: pkgData.description !== undefined ? pkgData.description?.trim() : currentPkg.description,
      price: pkgData.price !== undefined ? roundCurrency(pkgData.price) : currentPkg.price,
      components: pkgData.components !== undefined
        ? pkgData.components.map((c) => ({ ...c, allocationPercentage: roundCurrency(c.allocationPercentage || 0) }))
        : currentPkg.components,
      taxTreatment: pkgData.taxTreatment !== undefined ? pkgData.taxTreatment : currentPkg.taxTreatment,
      specificTaxRuleId: pkgData.specificTaxRuleId !== undefined ? pkgData.specificTaxRuleId : currentPkg.specificTaxRuleId,
      isActive: pkgData.isActive !== undefined ? pkgData.isActive : currentPkg.isActive,
    };

    // Validate cloned proposal before mutating store
    this.validatePackageProposal(store, proposed, id);

    const updatedPackage: PackageItem = {
      id,
      ...proposed,
    };

    store.packages[index] = updatedPackage;
    mockStorage.saveStore(store);
    return { ...updatedPackage };
  }

  async togglePackageStatus(id: string, actor?: User): Promise<PackageItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can toggle package status.');
    }

    const store = mockStorage.getStore();
    const pkg = store.packages.find((p) => p.id === id);
    if (!pkg) {
      throw new Error(`Package '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && pkg.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify package from another branch.');
    }

    if (!pkg.isActive) {
      // Validate proposal prior to activation (components active, 100% total, etc.)
      this.validatePackageProposal(store, pkg, id);
    }

    pkg.isActive = !pkg.isActive;
    mockStorage.saveStore(store);
    return { ...pkg };
  }

  async bulkImportServices(branchId: string, rows: any[], actor?: User): Promise<CatalogueImportResult> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can import services.');
    }
    const store = mockStorage.getStore();
    const effectiveBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;
    if (!effectiveBranchId || effectiveBranchId === 'ALL') {
      throw new Error('Please select an explicit branch for importing services.');
    }

    let acceptedRows = 0;
    let duplicateRows = 0;
    let rejectedRows = 0;
    const details: CatalogueImportResult['details'] = [];

    const existingCodes = new Set(store.services.filter((s) => s.branchId === effectiveBranchId).map((s) => s.code.toUpperCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const name = (row.name || '').trim();
        if (!name) {
          rejectedRows++;
          details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: 'Service name is missing.' });
          continue;
        }

        const numPrice = Number(row.price);
        if (isNaN(numPrice) || numPrice < 0) {
          rejectedRows++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: 'Price must be a non-negative number.' });
          continue;
        }

        let code = row.code && row.code.trim() ? row.code.trim().toUpperCase() : null;
        if (code) {
          if (existingCodes.has(code)) {
            duplicateRows++;
            details.push({ rowNumber: rowNum, name, code, status: 'DUPLICATE', reason: `Service code '${code}' already exists.` });
            continue;
          }
        } else {
          code = nextReference(store, 'SVR');
        }
        existingCodes.add(code);

        const categoryName = (row.category || 'General').trim();
        let cat = store.serviceCategories.find((c) => c.branchId === effectiveBranchId && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!cat) {
          cat = {
            id: `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            branchId: effectiveBranchId,
            name: categoryName,
            isActive: true,
          };
          store.serviceCategories.push(cat);
        } else if (!cat.isActive) {
          cat.isActive = true;
        }

        const duration = row.durationMinutes ? Math.round(Number(row.durationMinutes)) : 30;
        const newService: ServiceItem = {
          id: `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          branchId: effectiveBranchId,
          code,
          name,
          category: cat.name,
          durationMinutes: duration > 0 ? duration : 30,
          price: roundCurrency(numPrice),
          description: row.description?.trim(),
          taxTreatment: row.taxTreatment || 'BRANCH_DEFAULT',
          specificTaxRuleId: row.specificTaxRuleId,
          isActive: row.isActive !== false,
        };

        store.services.push(newService);
        acceptedRows++;
        details.push({ rowNumber: rowNum, id: newService.id, name: newService.name, code: newService.code, status: 'ACCEPTED' });
      } catch (err: any) {
        rejectedRows++;
        details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: err.message });
      }
    }

    mockStorage.saveStore(store);
    return { totalRows: rows.length, acceptedRows, duplicateRows, rejectedRows, details };
  }

  async bulkImportPackages(branchId: string, rows: any[], actor?: User): Promise<CatalogueImportResult> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can import packages.');
    }
    const store = mockStorage.getStore();
    const effectiveBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;
    if (!effectiveBranchId || effectiveBranchId === 'ALL') {
      throw new Error('Please select an explicit branch for importing packages.');
    }

    let acceptedRows = 0;
    let duplicateRows = 0;
    let rejectedRows = 0;
    const details: CatalogueImportResult['details'] = [];

    const existingCodes = new Set(store.packages.filter((p) => p.branchId === effectiveBranchId).map((p) => p.code.toUpperCase()));
    const branchServices = store.services.filter((s) => s.branchId === effectiveBranchId);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const name = (row.name || '').trim();
        if (!name) {
          rejectedRows++;
          details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: 'Package name is missing.' });
          continue;
        }

        const numPrice = Number(row.price);
        if (isNaN(numPrice) || numPrice < 0) {
          rejectedRows++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: 'Price must be a non-negative number.' });
          continue;
        }

        let code = row.code && row.code.trim() ? row.code.trim().toUpperCase() : null;
        if (code) {
          if (existingCodes.has(code)) {
            duplicateRows++;
            details.push({ rowNumber: rowNum, name, code, status: 'DUPLICATE', reason: `Package code '${code}' already exists.` });
            continue;
          }
        } else {
          code = nextReference(store, 'PKG');
        }
        existingCodes.add(code);

        let inputComponents = row.components;
        if ((!inputComponents || !Array.isArray(inputComponents) || inputComponents.length === 0) && row.services) {
          const rawTokens = Array.isArray(row.services)
            ? row.services
            : String(row.services)
                .split(/[,;\n\r]+/)
                .map((s: string) => s.trim())
                .filter(Boolean);

          inputComponents = rawTokens.map((rawToken: string) => {
            let sName = String(rawToken).trim();
            let qty = 1;
            const prefixMatch = sName.match(/^(\d+)\s*[xX*]\s*(.+)$/);
            if (prefixMatch) {
              qty = parseInt(prefixMatch[1], 10) || 1;
              sName = prefixMatch[2].trim();
            } else {
              const suffixMatch = sName.match(/^(.+?)\s*(?:[xX*:]|\()\s*(\d+)\s*\)?$/);
              if (suffixMatch) {
                sName = suffixMatch[1].trim();
                qty = parseInt(suffixMatch[2], 10) || 1;
              }
            }
            return { serviceName: sName, quantity: qty };
          });
        }

        if (!inputComponents || !Array.isArray(inputComponents) || inputComponents.length === 0) {
          rejectedRows++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: 'Package must have at least one component service.' });
          continue;
        }

        const resolvedComponents: PackageComponent[] = [];
        let compError = null;

        for (const c of inputComponents) {
          const targetName = (c.serviceName || '').trim().toLowerCase();
          const targetCode = (c.serviceCode || c.serviceIdentifier || '').trim().toUpperCase();

          let srv = branchServices.find((s) =>
            (c.serviceId && s.id === c.serviceId) ||
            (targetCode && s.code.toUpperCase() === targetCode) ||
            (targetName && s.name.trim().toLowerCase() === targetName) ||
            (targetName && s.code.toUpperCase() === targetName.toUpperCase())
          );

          if (!srv) {
            const rawServiceName = (c.serviceName || c.serviceCode || c.serviceIdentifier || '').trim();
            if (!rawServiceName) {
              compError = 'Component service name is missing.';
              break;
            }
            const newCode = `SVR-${(store.services.length + 1).toString().padStart(4, '0')}`;
            srv = {
              id: `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              branchId: effectiveBranchId,
              category: 'General',
              code: newCode,
              name: rawServiceName,
              description: 'PACKAGE_EXCLUSIVE',
              durationMinutes: 30,
              price: 0,
              taxTreatment: 'BRANCH_DEFAULT',
              isActive: true,
            };
            store.services.push(srv);
            branchServices.push(srv);
          }

          if (!srv.isActive) {
            srv.isActive = true;
          }

          resolvedComponents.push({
            serviceId: srv.id,
            serviceCode: srv.code,
            serviceName: srv.name,
            unitPrice: srv.price,
            quantity: c.quantity ? Number(c.quantity) : 1,
            allocationPercentage: c.allocationPercentage !== undefined && c.allocationPercentage !== '' ? roundCurrency(Number(c.allocationPercentage)) : 0,
          });
        }

        if (compError) {
          rejectedRows++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: compError });
          continue;
        }

        // Compute equal allocations if not supplied or not 100%
        const hasSupplied = resolvedComponents.every((c) => c.allocationPercentage > 0);
        const sumSupplied = resolvedComponents.reduce((acc, c) => acc + c.allocationPercentage, 0);
        if (!hasSupplied || Math.abs(sumSupplied - 100) > 0.01) {
          const count = resolvedComponents.length;
          const base = Math.floor((100 / count) * 100) / 100;
          let acc = 0;
          resolvedComponents.forEach((c, idx) => {
            if (idx === count - 1) {
              c.allocationPercentage = roundCurrency(100 - acc);
            } else {
              c.allocationPercentage = base;
              acc += base;
            }
          });
        }

        const newPkg: PackageItem = {
          id: `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          branchId: effectiveBranchId,
          code,
          name,
          description: row.description?.trim(),
          price: roundCurrency(numPrice),
          taxTreatment: row.taxTreatment || 'BRANCH_DEFAULT',
          specificTaxRuleId: row.specificTaxRuleId,
          isActive: row.isActive !== false,
          components: resolvedComponents,
        };

        store.packages.push(newPkg);
        acceptedRows++;
        details.push({ rowNumber: rowNum, id: newPkg.id, name: newPkg.name, code: newPkg.code, status: 'ACCEPTED' });
      } catch (err: any) {
        rejectedRows++;
        details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: err.message });
      }
    }

    mockStorage.saveStore(store);
    return { totalRows: rows.length, acceptedRows, duplicateRows, rejectedRows, details };
  }

  // --- PHASE 2B: CATEGORIES ---

  async getServiceCategories(branchId: string): Promise<ServiceCategory[]> {
    const store = mockStorage.getStore();
    return store.serviceCategories.filter((c) => c.branchId === branchId && c.isActive);
  }

  async createServiceCategory(branchId: string, name: string, actor?: User): Promise<ServiceCategory> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can manage categories.');
    }

    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error('Category name cannot be empty.');
    }

    const store = mockStorage.getStore();
    const existing = store.serviceCategories.find(
      (c) => c.branchId === branchId && c.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        mockStorage.saveStore(store);
        return { ...existing };
      }
      throw new Error(`Category '${cleanName}' already exists.`);
    }

    const newCat: ServiceCategory = {
      id: `cat-${Date.now().toString(36)}`,
      branchId,
      name: cleanName,
      isActive: true,
    };

    store.serviceCategories.push(newCat);
    mockStorage.saveStore(store);
    return { ...newCat };
  }

  // --- PHASE 2B: TAX SETTINGS ---

  async getTaxRules(branchId: string): Promise<TaxRule[]> {
    const store = mockStorage.getStore();
    return store.taxRules.filter((r) => r.branchId === branchId);
  }

  async createTaxRule(branchId: string, ruleData: Omit<TaxRule, 'id' | 'branchId'>, actor?: User): Promise<TaxRule> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can configure tax rules.');
    }

    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot configure tax rules for another branch.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    if (!ruleData.name?.trim()) {
      throw new Error('Tax rule name is required.');
    }

    if (typeof ruleData.rate !== 'number' || isNaN(ruleData.rate) || ruleData.rate < 0 || ruleData.rate > 1) {
      throw new Error('Tax rate must be between 0 and 1 (e.g. 0.16 for 16% or 0.125 for 12.5%).');
    }

    // Require explicit default selection; creating the first rule must not silently enable tax
    const shouldBeDefault = !!ruleData.isBranchDefault;

    const newRule: TaxRule = {
      id: `tax-${Date.now().toString(36)}`,
      branchId,
      name: ruleData.name.trim(),
      rate: ruleData.rate, // Preserve exact percentage precision (e.g. 0.125 remains 0.125)
      description: ruleData.description?.trim(),
      isActive: ruleData.isActive ?? true,
      isBranchDefault: shouldBeDefault,
    };

    if (shouldBeDefault) {
      // Clear existing default flags in this branch
      store.taxRules.forEach((r) => {
        if (r.branchId === branchId) r.isBranchDefault = false;
      });
      newRule.isBranchDefault = true;
      branch.defaultTaxRuleId = newRule.id;
      branch.taxRate = newRule.rate;
      branch.taxEnabled = true;
    }

    store.taxRules.push(newRule);
    mockStorage.saveStore(store);
    return { ...newRule };
  }

  async updateTaxRule(id: string, ruleData: Partial<TaxRule>, actor?: User): Promise<TaxRule> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can configure tax rules.');
    }

    const store = mockStorage.getStore();
    const rule = store.taxRules.find((r) => r.id === id);
    if (!rule) {
      throw new Error(`Tax rule '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && rule.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit tax rule from another branch.');
    }

    if (ruleData.rate !== undefined) {
      if (typeof ruleData.rate !== 'number' || isNaN(ruleData.rate) || ruleData.rate < 0 || ruleData.rate > 1) {
        throw new Error('Tax rate must be between 0 and 1 (e.g. 0.16 for 16% or 0.125 for 12.5%).');
      }
      rule.rate = ruleData.rate; // Preserve exact percentage precision
    }

    if (ruleData.name) rule.name = ruleData.name.trim();
    if (ruleData.description !== undefined) rule.description = ruleData.description?.trim();
    if (ruleData.isActive !== undefined) rule.isActive = ruleData.isActive;

    const branch = store.branches.find((b) => b.id === rule.branchId);

    // If deactivating a default rule, unset default and disable tax to prevent stale rates
    if (rule.isBranchDefault && rule.isActive === false) {
      rule.isBranchDefault = false;
      if (branch) {
        branch.defaultTaxRuleId = undefined;
        branch.taxRate = 0.0;
        branch.taxEnabled = false;
      }
    } else if (ruleData.isBranchDefault) {
      store.taxRules.forEach((r) => {
        if (r.branchId === rule.branchId) r.isBranchDefault = false;
      });
      rule.isBranchDefault = true;
      if (branch) {
        branch.defaultTaxRuleId = rule.id;
        branch.taxRate = rule.rate;
        branch.taxEnabled = true;
      }
    } else if (rule.isBranchDefault && branch) {
      // Keep branch rate synchronized if default rule's rate was updated
      branch.taxRate = rule.rate;
    }

    mockStorage.saveStore(store);
    return { ...rule };
  }

  async setBranchDefaultTaxRule(branchId: string, ruleId: string | null, actor?: User): Promise<Branch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can set default tax rules.');
    }

    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Branch Administrators cannot configure default tax rules for other branches.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    if (!ruleId) {
      branch.defaultTaxRuleId = undefined;
      branch.taxRate = 0.0;
      branch.taxEnabled = false;
      store.taxRules.forEach((r) => {
        if (r.branchId === branchId) r.isBranchDefault = false;
      });
    } else {
      const rule = store.taxRules.find((r) => r.id === ruleId && r.branchId === branchId);
      if (!rule) {
        throw new Error(`Tax rule '${ruleId}' not found in this branch.`);
      }
      if (!rule.isActive) {
        throw new Error(`Cannot set deactivated tax rule '${rule.name}' as branch default.`);
      }
      store.taxRules.forEach((r) => {
        if (r.branchId === branchId) r.isBranchDefault = r.id === ruleId;
      });
      branch.defaultTaxRuleId = rule.id;
      branch.taxRate = rule.rate;
      branch.taxEnabled = true;
    }

    mockStorage.saveStore(store);
    return { ...branch };
  }

  async toggleTaxRuleStatus(id: string, actor?: User): Promise<TaxRule> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can toggle tax rule status.');
    }

    const store = mockStorage.getStore();
    const rule = store.taxRules.find((r) => r.id === id);
    if (!rule) {
      throw new Error(`Tax rule '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && rule.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Branch Administrators cannot modify tax rules for other branches.');
    }

    rule.isActive = !rule.isActive;

    // If deactivating a default rule, unset default and disable tax to prevent stale rates
    if (!rule.isActive && rule.isBranchDefault) {
      rule.isBranchDefault = false;
      const branch = store.branches.find((b) => b.id === rule.branchId);
      if (branch) {
        branch.defaultTaxRuleId = undefined;
        branch.taxRate = 0.0;
        branch.taxEnabled = false;
      }
    }

    mockStorage.saveStore(store);
    return { ...rule };
  }

  // --- PHASE 2B: PAYMENT ACCOUNTS ---

  async getPaymentAccounts(branchId: string | 'ALL'): Promise<PaymentAccount[]> {
    const store = mockStorage.getStore();
    if (branchId === 'ALL') {
      return [...store.paymentAccounts];
    }
    return store.paymentAccounts.filter((acc) => acc.branchId === branchId);
  }

  async createPaymentAccount(
    branchId: string,
    accountData: Omit<PaymentAccount, 'id' | 'branchId' | 'currentBalance' | 'createdAt'>,
    actor?: User
  ): Promise<PaymentAccount> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can configure payment accounts.');
    }

    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot configure payment account for another branch.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    if (!accountData.name?.trim()) {
      throw new Error('Account display name is required.');
    }
    if (!accountData.providerName?.trim()) {
      throw new Error('Provider / bank name is required.');
    }
    if (!accountData.accountHolder?.trim()) {
      throw new Error('Account holder name is required.');
    }

    // New accounts start with zero balance (non-editable directly)
    const newAccount: PaymentAccount = {
      id: `acc-${Date.now().toString(36)}`,
      branchId,
      name: accountData.name.trim(),
      accountType: accountData.accountType || 'BANK',
      providerName: accountData.providerName.trim(),
      accountHolder: accountData.accountHolder.trim(),
      accountIdentifier: accountData.accountIdentifier?.trim(),
      currentBalance: 0.0,
      isActive: accountData.isActive ?? true,
      createdAt: mockStorage.getSystemDate(),
    };

    store.paymentAccounts.push(newAccount);
    mockStorage.saveStore(store);
    return { ...newAccount };
  }

  async updatePaymentAccount(id: string, accountData: Partial<PaymentAccount>, actor?: User): Promise<PaymentAccount> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can update payment accounts.');
    }

    const store = mockStorage.getStore();
    const account = store.paymentAccounts.find((a) => a.id === id);
    if (!account) {
      throw new Error(`Payment account '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && account.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit payment account from another branch.');
    }

    // Balance cannot be edited directly; only operational postings can alter balance
    if (accountData.name) account.name = accountData.name.trim();
    if (accountData.providerName) account.providerName = accountData.providerName.trim();
    if (accountData.accountHolder) account.accountHolder = accountData.accountHolder.trim();
    if (accountData.accountIdentifier !== undefined) account.accountIdentifier = accountData.accountIdentifier?.trim();
    if (accountData.accountType) account.accountType = accountData.accountType;
    if (accountData.isActive !== undefined) account.isActive = accountData.isActive;

    mockStorage.saveStore(store);
    return { ...account };
  }

  async togglePaymentAccountStatus(id: string, actor?: User): Promise<PaymentAccount> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can toggle payment account status.');
    }

    const store = mockStorage.getStore();
    const account = store.paymentAccounts.find((a) => a.id === id);
    if (!account) {
      throw new Error(`Payment account '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && account.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify payment account from another branch.');
    }

    account.isActive = !account.isActive;
    mockStorage.saveStore(store);
    return { ...account };
  }

  async deletePaymentAccount(id: string, actor?: User): Promise<{ id: string; deleted?: boolean; archived?: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can remove payment accounts.');
    }

    const store = mockStorage.getStore();
    const index = store.paymentAccounts.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Payment account '${id}' not found.`);
    }

    const account = store.paymentAccounts[index];
    if (authenticatedActor.role === 'ADMIN' && account.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot delete payment account from another branch.');
    }

    const hasMovements = (store.invoices || []).some((inv: any) => inv.paymentAccountId === id) ||
      (store.expenses || []).some((exp: any) => exp.paymentAccountId === id) ||
      (store.purchases || []).some((pur: any) => pur.paymentAccountId === id);

    if (hasMovements || (account.currentBalance && account.currentBalance !== 0)) {
      account.isActive = false;
      mockStorage.saveStore(store);
      return {
        id,
        deleted: false,
        archived: true,
        message: `Account '${account.name}' has transaction history and cannot be permanently deleted. It has been deactivated and archived.`,
      };
    }

    store.paymentAccounts.splice(index, 1);
    mockStorage.saveStore(store);
    return {
      id,
      deleted: true,
      archived: false,
      message: `Payment account '${account.name}' removed successfully.`,
    };
  }

  // --- DEMO DATE PROVIDER ---

  async getSystemDate(): Promise<string> {
    return mockStorage.getSystemDate();
  }

  async getSystemDateInfo(): Promise<{ date: string; realDate: string; isOverridden: boolean; time: string }> {
    const today = new Date().toLocaleDateString('en-CA');
    const d = mockStorage.getSystemDate();
    return {
      date: d,
      realDate: today,
      isOverridden: d !== today,
      time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true }),
    };
  }

  async setSystemDate(date: string, actor?: User): Promise<void> {
    mockStorage.setSystemDate(date);
  }

  async resetSystemDate(actor?: User): Promise<void> {
    const today = new Date().toLocaleDateString('en-CA');
    mockStorage.setSystemDate(today);
  }

  // --- PHASE 3A: POS BILLING & COLLECTIONS ---

  async getInvoices(
    branchId: string | 'ALL',
    filter?: { status?: InvoiceStatus; date?: string; startDate?: string; endDate?: string }
  ): Promise<Invoice[]> {
    const store = mockStorage.getStore();
    let list = branchId === 'ALL' ? [...store.invoices] : store.invoices.filter((i) => i.branchId === branchId);

    if (filter) {
      if (filter.status) {
        list = list.filter((i) => i.status === filter.status);
      }
      if (filter.date) {
        list = list.filter((i) => i.date === filter.date);
      }
      if (filter.startDate) {
        list = list.filter((i) => i.date >= filter.startDate!);
      }
      if (filter.endDate) {
        list = list.filter((i) => i.date <= filter.endDate!);
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const store = mockStorage.getStore();
    const inv = store.invoices.find((i) => i.id === id);
    return inv ? { ...inv } : null;
  }

  private getNextInvoiceNumber(clonedStore: StorageSchema, branch: Branch, targetDate: string): string { return nextReference(clonedStore, 'INV'); }

  private generateNextExpenseVoucherNumber(
    clonedStore: StorageSchema,
    branch: Branch,
    targetDate: string,
    type: 'EXP' | 'REV' | 'DFT' = 'EXP'
  ): string {
    return nextReference(clonedStore, type);
  }

  private checkIdempotency(
    store: StorageSchema,
    key: string | undefined,
    operation: 'POS_POSTING' | 'COLLECTION' | 'EXPENSE_POSTING',
    authenticatedActor: User,
    branchId: string,
    payload: any
  ): any | null {
    if (!key || !key.trim()) return null;

    const records = store.idempotencyRecords || [];
    const record = records.find((r) => r.key === key);
    if (!record) return null;

    // Validate authorization before returning an existing result
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot perform financial transactions.');
    }
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot perform operations for another branch.');
      }
    }

    const payloadFingerprint = JSON.stringify(payload);
    if (record.payloadFingerprint === payloadFingerprint) {
      return JSON.parse(JSON.stringify(record.result));
    } else {
      throw new Error(`Idempotency key '${key}' reused with a different payload. Request rejected.`);
    }
  }

  private recordIdempotency(
    clonedStore: StorageSchema,
    key: string | undefined,
    operation: 'POS_POSTING' | 'COLLECTION' | 'EXPENSE_POSTING' | 'SETTLEMENT_SUBMISSION' | 'SETTLEMENT_APPROVAL',
    authenticatedActor: User,
    branchId: string,
    payload: any,
    result: any
  ): void {
    if (!key || !key.trim()) return;
    clonedStore.idempotencyRecords = clonedStore.idempotencyRecords || [];
    clonedStore.idempotencyRecords = clonedStore.idempotencyRecords.filter((r) => r.key !== key);
    clonedStore.idempotencyRecords.push({
      key,
      operation,
      branchId,
      actorId: authenticatedActor.id,
      payloadFingerprint: JSON.stringify(payload),
      result: JSON.parse(JSON.stringify(result)),
      createdAt: new Date().toISOString(),
    });
  }

  async postPOSInvoice(input: CreatePOSInvoiceInput, actor?: User): Promise<Invoice> {
    const authenticatedActor = this.getAuthenticatedActor(actor);

    // 1. Role verification: Super Admin, Admin, and Accountant can post POS. Staff cannot.
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot perform POS billing or cash collections.');
    }

    const store = mockStorage.getStore();

    // 2. Branch scope verification
    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (input.branchId && input.branchId !== 'ALL' && input.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot perform operations for another branch.');
      }
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit active branch must be selected for POS billing. Consolidated multi-branch mode cannot post transactions.');
    }

    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    // 3. Idempotency protection check
    const existingResult = this.checkIdempotency(
      store,
      input.idempotencyKey,
      'POS_POSTING',
      authenticatedActor,
      branchId,
      input
    );
    if (existingResult) {
      return existingResult;
    }

    // 4. Cart items verification
    if (!input.cartItems || input.cartItems.length === 0) {
      throw new Error('Cannot post invoice with an empty cart.');
    }

    if (input.appointmentId) {
      const existingLinkedInv = store.invoices.find((inv) => inv.appointmentId === input.appointmentId);
      if (existingLinkedInv) {
        throw new Error(`Appointment '${input.appointmentId}' has already been billed under invoice ${existingLinkedInv.invoiceNumber}. Duplicate invoices are prohibited.`);
      }
      const apt = (store.appointments || []).find((a) => a.id === input.appointmentId);
      if (!apt) {
        throw new Error(`Linked appointment '${input.appointmentId}' not found.`);
      }
      if (apt.branchId !== branchId) {
        throw new Error(`Appointment belongs to branch '${apt.branchId}', cannot bill under branch '${branchId}'.`);
      }
    }

    // Clone store for atomic transaction
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const clonedBranch = clonedStore.branches.find((b: Branch) => b.id === branchId)!;

    // Date & Time
    const targetDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // 5. Canonical Catalogue & Staff Validations
    let subtotal = 0;
    for (const cItem of input.cartItems) {
      if (!Number.isFinite(cItem.quantity) || cItem.quantity <= 0 || !Number.isInteger(cItem.quantity)) {
        throw new Error(`Item '${cItem.item.name}' must have a positive whole quantity.`);
      }

      if (cItem.type === 'SERVICE') {
        const srv = clonedStore.services.find((s: ServiceItem) => s.id === cItem.item.id);
        if (!srv || !srv.isActive || srv.branchId !== branchId) {
          throw new Error(`Service '${cItem.item.name}' is inactive or invalid for this branch.`);
        }
        if (roundCurrency(cItem.item.price) !== roundCurrency(srv.price)) {
          throw new Error(`Cart price quote for service '${srv.name}' is outdated. Please refresh your cart.`);
        }
        const staff = clonedStore.staff.find((st: StaffMember) => st.id === cItem.staffId);
        if (!staff || !staff.isActive || staff.branchId !== branchId) {
          throw new Error(`Assigned staff for '${srv.name}' is inactive or from another branch.`);
        }
        if (cItem.item.taxTreatment === 'SPECIFIC_RULE') {
          if (!cItem.item.specificTaxRuleId) {
            throw new Error(`Specific tax rule is required for service '${srv.name}'.`);
          }
          const rule = clonedStore.taxRules.find((r: TaxRule) => r.id === cItem.item.specificTaxRuleId && r.branchId === branchId);
          if (!rule || !rule.isActive) {
            throw new Error(`Specific tax rule '${cItem.item.specificTaxRuleId}' for service '${srv.name}' is missing or inactive.`);
          }
        }
        subtotal += roundCurrency(srv.price * cItem.quantity);
      } else if (cItem.type === 'PACKAGE') {
        const pkg = clonedStore.packages.find((p: PackageItem) => p.id === cItem.item.id);
        if (!pkg || !pkg.isActive || pkg.branchId !== branchId) {
          throw new Error(`Package '${cItem.item.name}' is inactive or invalid for this branch.`);
        }
        if (roundCurrency(cItem.item.price) !== roundCurrency(pkg.price)) {
          throw new Error(`Cart price quote for package '${pkg.name}' is outdated. Please refresh your cart.`);
        }
        for (const comp of pkg.components) {
          const compSrv = clonedStore.services.find((s: ServiceItem) => s.id === comp.serviceId);
          if (!compSrv || !compSrv.isActive) {
            throw new Error(`Cannot sell package '${pkg.name}': component service '${comp.serviceName}' is deactivated.`);
          }
        }
        if (cItem.packageComponents && cItem.packageComponents.length > 0) {
          for (const pComp of cItem.packageComponents) {
            const cStaff = clonedStore.staff.find((st: StaffMember) => st.id === pComp.staffId);
            if (!cStaff || !cStaff.isActive || cStaff.branchId !== branchId) {
              throw new Error(`Assigned staff for package component '${pComp.serviceName}' is inactive or from another branch.`);
            }
          }
        }
        subtotal += roundCurrency(pkg.price * cItem.quantity);
      } else if (cItem.type === 'PRODUCT') {
        const prod = (clonedStore.inventoryItems || []).find((p: InventoryItem) => p.id === cItem.item.id);
        if (!prod || !prod.isActive) {
          throw new Error(`Product '${cItem.item.name}' is inactive or invalid.`);
        }
        const isAvail = prod.branchAvailability.includes('ALL') || prod.branchAvailability.includes(branchId);
        if (!isAvail) {
          throw new Error(`Product '${prod.name}' is not available for sale in this branch.`);
        }
        if (roundCurrency(cItem.item.price) !== roundCurrency(prod.sellingPrice)) {
          throw new Error(`Cart price quote for product '${prod.name}' is outdated. Please refresh your cart.`);
        }
        const staff = clonedStore.staff.find((st: StaffMember) => st.id === cItem.staffId);
        if (!staff || !staff.isActive || staff.branchId !== branchId) {
          throw new Error(`Assigned staff for '${prod.name}' is inactive or from another branch.`);
        }
        if (cItem.item.taxTreatment === 'SPECIFIC_RULE') {
          if (!cItem.item.specificTaxRuleId) {
            throw new Error(`Specific tax rule is required for product '${prod.name}'.`);
          }
          const rule = clonedStore.taxRules.find((r: TaxRule) => r.id === cItem.item.specificTaxRuleId && r.branchId === branchId);
          if (!rule || !rule.isActive) {
            throw new Error(`Specific tax rule '${cItem.item.specificTaxRuleId}' for product '${prod.name}' is missing or inactive.`);
          }
        }
        subtotal += roundCurrency(prod.sellingPrice * cItem.quantity);
      }
    }

    subtotal = roundCurrency(subtotal);

    // 6. Calculate total discount
    let totalDiscount = 0;
    if (input.discountType === 'PERCENTAGE') {
      const pct = Math.max(0, Math.min(100, input.discountValue || 0));
      totalDiscount = roundCurrency(subtotal * (pct / 100));
    } else {
      totalDiscount = roundCurrency(Math.max(0, Math.min(subtotal, input.discountValue || 0)));
    }

    // 7. Allocate discount proportionally across lines & calculate taxes
    let distributedDiscount = 0;
    const computedLineItems: InvoiceLineItem[] = [];
    const productMovementsToPost: Array<{
      itemId: string;
      itemName: string;
      itemSku: string;
      batchId?: string;
      batchNumber?: string;
      quantity: number;
      unitCostSnapshot: number;
      totalCostImpact: number;
    }> = [];

    const lineGrossList = input.cartItems.map((cItem) => {
      const unitPrice = roundCurrency(cItem.item.price);
      const gross = roundCurrency(unitPrice * cItem.quantity);
      return { cItem, unitPrice, gross };
    });

    let maxGrossIdx = 0;
    for (let i = 1; i < lineGrossList.length; i++) {
      if (lineGrossList[i].gross > lineGrossList[maxGrossIdx].gross) {
        maxGrossIdx = i;
      }
    }

    for (let i = 0; i < lineGrossList.length; i++) {
      const { cItem, unitPrice, gross } = lineGrossList[i];
      let lineDisc = subtotal > 0 ? roundCurrency((gross / subtotal) * totalDiscount) : 0;
      distributedDiscount = roundCurrency(distributedDiscount + lineDisc);

      const netSales = roundCurrency(gross - lineDisc);

      let taxRate = 0;
      if (input.applyTax === false) {
        taxRate = 0;
      } else if (cItem.item.taxTreatment === 'SPECIFIC_RULE') {
        if (cItem.item.specificTaxRuleId) {
          const rule = clonedStore.taxRules.find((r: TaxRule) => r.id === cItem.item.specificTaxRuleId && r.branchId === branchId);
          if (rule && rule.isActive) {
            taxRate = rule.rate;
          }
        }
      } else {
        if (clonedBranch.taxEnabled) {
          taxRate = clonedBranch.taxRate || 0;
        }
      }

      const lineTax = roundCurrency(netSales * taxRate);
      const lineTotal = roundCurrency(netSales + lineTax);

      let pkgComponentsSnapshot: InvoiceLineItemComponent[] | undefined;
      if (cItem.type === 'PACKAGE') {
        const pkg = cItem.item as PackageItem;
        const revenueAlloc = allocatePackageRevenue(netSales, pkg.components);

        pkgComponentsSnapshot = revenueAlloc.allocatedComponents.map((alloc) => {
          const assignedComp = cItem.packageComponents?.find((pc) => pc.serviceId === alloc.serviceId);
          const assignedStaff = assignedComp
            ? clonedStore.staff.find((s: StaffMember) => s.id === assignedComp.staffId)
            : clonedStore.staff.find((s: StaffMember) => s.id === cItem.staffId);

          return {
            serviceId: alloc.serviceId,
            serviceCode: alloc.serviceCode,
            serviceName: alloc.serviceName,
            quantity: alloc.quantity,
            allocationPercentage: alloc.allocationPercentage,
            allocatedAmount: alloc.allocatedAmount,
            staffId: assignedStaff?.id || cItem.staffId,
            staffName: assignedStaff?.name || cItem.staffName,
            staffCommissionRate: assignedStaff?.commissionRate || 0,
          };
        });
      }

      const primaryStaff = clonedStore.staff.find((s: StaffMember) => s.id === cItem.staffId);

      let itemBatchId: string | undefined;
      let itemBatchNumber: string | undefined;
      let lineCogs = 0;
      let lineUnitCostSnapshot = 0;

      if (cItem.type === 'PRODUCT') {
        const sysDate = clonedStore.systemDate || DEFAULT_DEMO_DATE;
        const availableBatches = (clonedStore.inventoryBatches || [])
          .filter((b: InventoryBatch) => {
            if (b.itemId !== cItem.item.id || b.branchId !== branchId) return false;
            if (b.remainingQuantity <= 0) return false;
            if (b.status === 'EXPIRED' || b.status === 'QUARANTINED' || b.status === 'EXHAUSTED') return false;
            if (b.expiryDate && b.expiryDate < sysDate) return false;
            return true;
          })
          .sort((a: InventoryBatch, b: InventoryBatch) => {
            if (a.expiryDate && b.expiryDate) {
              return a.expiryDate.localeCompare(b.expiryDate);
            }
            if (a.expiryDate && !b.expiryDate) return -1;
            if (!a.expiryDate && b.expiryDate) return 1;
            return a.receivedDate.localeCompare(b.receivedDate);
          });

        const totalValid = availableBatches.reduce((sum: number, b: InventoryBatch) => sum + b.remainingQuantity, 0);
        if (totalValid < cItem.quantity) {
          throw new Error(`Insufficient valid sellable stock for '${cItem.item.name}'. Available: ${totalValid}, Requested: ${cItem.quantity}. Expired or quarantined stock cannot be sold.`);
        }

        let qtyToDeduct = cItem.quantity;
        const usedBatches: Array<{ batch: InventoryBatch; qty: number }> = [];

        for (const batch of availableBatches) {
          if (qtyToDeduct <= 0) break;
          const take = Math.min(batch.remainingQuantity, qtyToDeduct);
          batch.remainingQuantity = roundCurrency(batch.remainingQuantity - take);
          if (batch.remainingQuantity === 0) {
            batch.status = 'EXHAUSTED';
          }
          batch.updatedAt = new Date().toISOString();
          usedBatches.push({ batch, qty: take });
          const bCost = batch.unitCostSnapshot ?? (batch as any).unitPurchaseCost ?? 0;
          lineCogs = roundCurrency(lineCogs + take * bCost);
          qtyToDeduct -= take;
        }

        lineUnitCostSnapshot = roundCurrency(lineCogs / cItem.quantity);
        itemBatchId = usedBatches[0]?.batch.id;
        itemBatchNumber = usedBatches.map((ub) => ub.batch.batchNumber).join(', ');

        productMovementsToPost.push({
          itemId: cItem.item.id,
          itemName: cItem.item.name,
          itemSku: cItem.item.code || '',
          batchId: itemBatchId,
          batchNumber: itemBatchNumber,
          quantity: cItem.quantity,
          unitCostSnapshot: lineUnitCostSnapshot,
          totalCostImpact: lineCogs,
        });
      }

      computedLineItems.push({
        id: `li-${i + 1}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
        name: cItem.item.name,
        type: cItem.type,
        itemId: cItem.item.id,
        code: cItem.item.code,
        staffId: cItem.staffId,
        staffName: cItem.staffName,
        staffCommissionRate: primaryStaff?.commissionRate || 0,
        quantity: cItem.quantity,
        unitPrice,
        discountAllocated: lineDisc,
        netSales,
        taxTreatment: cItem.item.taxTreatment,
        taxRate,
        tax: lineTax,
        total: lineTotal,
        assignedStaff: cItem.assignedStaff && cItem.assignedStaff.length > 0
          ? cItem.assignedStaff
          : (cItem.type === 'PACKAGE' ? [{ staffId: cItem.staffId, staffName: cItem.staffName, staffCommissionRate: primaryStaff?.commissionRate || 0 }] : undefined),
        packageComponents: pkgComponentsSnapshot,
        packageComponentsSnapshot: pkgComponentsSnapshot,
        batchId: itemBatchId,
        batchNumber: itemBatchNumber,
        unitCostSnapshot: lineUnitCostSnapshot,
        cogsAmount: lineCogs,
      });
    }

    if (computedLineItems.length > 0 && Math.abs(distributedDiscount - totalDiscount) > 0.001) {
      const remainder = roundCurrency(totalDiscount - distributedDiscount);
      const maxLine = computedLineItems[maxGrossIdx];
      maxLine.discountAllocated = roundCurrency((maxLine.discountAllocated || 0) + remainder);
      maxLine.netSales = roundCurrency(maxLine.unitPrice * maxLine.quantity - maxLine.discountAllocated);
      maxLine.tax = roundCurrency((maxLine.netSales || 0) * (maxLine.taxRate || 0));
      maxLine.total = roundCurrency((maxLine.netSales || 0) + maxLine.tax);
    }

    const netSalesTotal = roundCurrency(computedLineItems.reduce((sum, li) => sum + (li.netSales || 0), 0));
    const taxTotal = roundCurrency(computedLineItems.reduce((sum, li) => sum + li.tax, 0));
    const billTotal = roundCurrency(netSalesTotal + taxTotal);
    const tipAmount = Math.max(0, roundCurrency(input.tip || 0));
    const invoiceTotal = roundCurrency(billTotal + tipAmount);

    // 8. Shared Payments Validation & Allocation
    const paymentsList = input.payments || [];
    for (const p of paymentsList) {
      if (!Number.isFinite(p.amount) || p.amount < 0 ||
          !Number.isFinite(p.billAllocation) || p.billAllocation < 0 ||
          !Number.isFinite(p.tipAllocation) || p.tipAllocation < 0) {
        throw new Error('All payment amounts must be finite, non-negative numbers.');
      }
      if (roundCurrency(p.billAllocation + p.tipAllocation) !== roundCurrency(p.amount)) {
        throw new Error(`Payment receipt error: bill allocation (${p.billAllocation}) + tip allocation (${p.tipAllocation}) must equal payment amount (${p.amount}).`);
      }
    }

    const onlinePaymentsTotal = roundCurrency(
      paymentsList
        .filter((p) => p.method === 'ONLINE_ACCOUNT')
        .reduce((sum, p) => sum + roundCurrency(p.amount || 0), 0)
    );

    if (onlinePaymentsTotal > invoiceTotal) {
      throw new Error(`Digital payment (${onlinePaymentsTotal} PKR) cannot exceed total invoice due (${invoiceTotal} PKR). Overpayment on card/bank without cash is invalid.`);
    }

    const totalPaymentsReceived = roundCurrency(
      paymentsList.reduce((sum, p) => sum + roundCurrency(p.amount || 0), 0)
    );

    if (totalPaymentsReceived > invoiceTotal) {
      throw new Error(`Total retained payment (${totalPaymentsReceived} PKR) cannot exceed total invoice due (${invoiceTotal} PKR). Any excess physical cash must be returned as change.`);
    }

    for (const p of paymentsList) {
      if (p.method === 'ONLINE_ACCOUNT' && (p.changeReturned || 0) > 0) {
        throw new Error('Change cannot be returned on digital/online payment accounts. Change can only be returned in cash.');
      }
      if (p.method === 'CASH') {
        const tendered = roundCurrency(p.cashTendered || p.amount);
        const change = roundCurrency(p.changeReturned || 0);
        if (tendered < p.amount) {
          throw new Error(`Insufficient cash tendered (${tendered} PKR) for cash payment (${p.amount} PKR).`);
        }
        if (roundCurrency(tendered - change) !== roundCurrency(p.amount)) {
          throw new Error(`Cash tendered minus change returned (${roundCurrency(tendered - change)} PKR) must equal retained cash payment (${p.amount} PKR).`);
        }
      }
    }

    const totalBillPaid = roundCurrency(
      paymentsList.reduce((sum, p) => sum + roundCurrency(p.billAllocation || 0), 0)
    );

    const amountDue = roundCurrency(Math.max(0, billTotal - totalBillPaid));

    let clientName = input.clientName?.trim();
    let clientPhone = input.clientPhone?.trim();

    if (amountDue > 0) {
      if (!clientName || clientName.toLowerCase() === 'walk-in' || clientName.toLowerCase() === 'walk-in customer') {
        throw new Error('A specific customer name is required for unpaid or partial balance invoices so outstanding amounts can be followed up.');
      }
      if (!clientPhone) {
        throw new Error('A contact phone number is required for unpaid or partial balance invoices.');
      }
    } else {
      clientName = clientName || 'Walk-in Customer';
      clientPhone = clientPhone || 'N/A';
    }

    let status: InvoiceStatus = 'UNPAID';
    if (amountDue === 0) {
      status = 'PAID';
    } else if (totalBillPaid > 0) {
      status = 'PARTIAL';
    }

    let cashTendered = 0;
    let changeReturned = 0;
    const paymentRecords: PaymentRecord[] = [];

    for (let idx = 0; idx < paymentsList.length; idx++) {
      const p = paymentsList[idx];
      const pAmount = roundCurrency(p.amount);
      const bAlloc = roundCurrency(p.billAllocation);
      const tAlloc = roundCurrency(p.tipAllocation);

      if (pAmount <= 0) continue;

      if (p.method === 'ONLINE_ACCOUNT') {
        if (!p.paymentAccountId) {
          throw new Error('Online payment must reference a valid payment account.');
        }
        const acc = clonedStore.paymentAccounts.find((a: PaymentAccount) => a.id === p.paymentAccountId && a.branchId === branchId);
        if (!acc || !acc.isActive) {
          throw new Error(`Payment account '${p.paymentAccountName || p.paymentAccountId}' is invalid or deactivated.`);
        }
        acc.currentBalance = roundCurrency(acc.currentBalance + pAmount);
      } else if (p.method === 'CASH') {
        cashTendered += roundCurrency(p.cashTendered || pAmount);
        changeReturned += roundCurrency(p.changeReturned || 0);

        const pendingDrawer = clonedStore.cashDrawers.find(
          (d: CashDrawer) => d.branchId === branchId && d.custodianUserId === authenticatedActor.id && d.status === 'SETTLEMENT_PENDING'
        );
        if (pendingDrawer) {
          throw new Error('Your cash drawer is locked pending settlement review. Cannot post cash transactions until approved or unlocked.');
        }

        let drawer = clonedStore.cashDrawers.find(
          (d: CashDrawer) => d.branchId === branchId && d.date === targetDate && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
        );

        if (!drawer) {
          drawer = {
            id: `drawer-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
            branchId,
            date: targetDate,
            openingCash: 0.0,
            cashSales: 0.0,
            cashTipsCollected: 0.0,
            cashExpensesPaid: 0.0,
            expectedInDrawer: 0.0,
            actualInDrawer: 0.0,
            variance: 0.0,
            custodianUserId: authenticatedActor.id,
            custodianName: authenticatedActor.name,
            status: 'OPEN',
          };
          clonedStore.cashDrawers.push(drawer);
        }

        drawer.cashSales = roundCurrency(drawer.cashSales + bAlloc);
        drawer.cashTipsCollected = roundCurrency(drawer.cashTipsCollected + tAlloc);
        drawer.expectedInDrawer = roundCurrency(
          drawer.openingCash + drawer.cashSales + drawer.cashTipsCollected - drawer.cashExpensesPaid
        );
      }

      paymentRecords.push({
        id: `pay-${idx + 1}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
        receiptNumber: nextReference(clonedStore, 'RCP'),
        invoiceId: '',
        branchId,
        date: targetDate,
        time: timeStr,
        amount: pAmount,
        billAmountAllocated: bAlloc,
        tipAmountAllocated: tAlloc,
        method: p.method,
        paymentAccountId: p.paymentAccountId,
        paymentAccountName: p.paymentAccountName,
        processedByUserId: authenticatedActor.id,
        processedByName: authenticatedActor.name,
        cashTendered: p.method === 'CASH' ? roundCurrency(p.cashTendered || pAmount) : undefined,
        changeReturned: p.method === 'CASH' ? roundCurrency(p.changeReturned || 0) : undefined,
        notes: `POS receipt processed by ${authenticatedActor.name}`,
      });
    }

    const invoiceNumber = this.getNextInvoiceNumber(clonedStore, clonedBranch, targetDate);
    const invoiceId = `inv-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;

    paymentRecords.forEach((pr) => {
      pr.invoiceId = invoiceId;
    });

    const primaryLineStaff = computedLineItems[0];
    const staffId = primaryLineStaff?.staffId || '';
    const staffName = primaryLineStaff?.staffName || '';

    // Generate canonical tip receipts for actual collected payment tip allocations
    clonedStore.tipReceipts = clonedStore.tipReceipts || [];
    const activeDrawer = clonedStore.cashDrawers.find(
      (d: CashDrawer) => d.branchId === branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
    );
    for (const pr of paymentRecords) {
      if (pr.tipAmountAllocated && pr.tipAmountAllocated > 0) {
        const yearStr = targetDate.slice(0, 4);
        const receiptNumber = this.getNextTipReceiptNumber(clonedStore, clonedBranch, yearStr);
        clonedStore.tipReceipts.push({
          id: `tip-rec-${pr.id}`,
          receiptNumber,
          branchId,
          branchName: clonedBranch.name,
          invoiceId,
          invoiceNumber,
          paymentId: pr.id,
          collectionDate: targetDate,
          collectionTime: timeStr,
          clientName: input.clientName || 'Walk-in Customer',
          method: pr.method,
          paymentAccountId: pr.paymentAccountId,
          paymentAccountName: pr.paymentAccountName,
          cashDrawerId: pr.method === 'CASH' ? activeDrawer?.id : undefined,
          collectedByUserId: authenticatedActor.id,
          collectedByName: authenticatedActor.name,
          collectedAmount: pr.tipAmountAllocated,
          directStaffId: staffId || undefined,
          directStaffName: staffName || undefined,
          allocatedAmount: 0,
          unallocatedAmount: pr.tipAmountAllocated,
          status: 'UNALLOCATED',
          createdAt: `${targetDate}T${now.toTimeString().slice(0, 8)}`,
        });
      }
    }

    let overallPaymentMethod: 'CASH' | 'ONLINE_ACCOUNT' | 'SPLIT' = 'CASH';
    if (paymentRecords.length > 1) {
      overallPaymentMethod = 'SPLIT';
    } else if (paymentRecords.length === 1) {
      overallPaymentMethod = paymentRecords[0].method;
    }

    if (!clonedStore.clients) clonedStore.clients = [];
    let matchedClient: Client | undefined;
    if (input.clientId) {
      matchedClient = clonedStore.clients.find((c) => c.id === input.clientId && c.branchId === branchId);
    }
    if (!matchedClient && clientPhone && clientPhone !== 'N/A') {
      const normInputPhone = clientPhone.replace(/\D/g, '');
      if (normInputPhone) {
        matchedClient = clonedStore.clients.find(
          (c) => c.branchId === branchId && c.phone.replace(/\D/g, '') === normInputPhone
        );
      }
    }

    if (!matchedClient && clientName && clientName.toLowerCase() !== 'walk-in customer' && clientName.toLowerCase() !== 'walk-in') {
      matchedClient = {
        id: `client-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        branchId,
        name: clientName,
        phone: clientPhone || 'N/A',
        source: input.customerSource || 'WALK_IN',
        sourceDetails: input.customerSourceDetails?.trim(),
        outstandingBalance: amountDue,
        totalVisits: 1,
        lastVisitDate: targetDate,
      };
      clonedStore.clients.push(matchedClient);
    } else if (matchedClient) {
      matchedClient.outstandingBalance = roundCurrency((matchedClient.outstandingBalance || 0) + amountDue);
      matchedClient.totalVisits = (matchedClient.totalVisits || 0) + 1;
      matchedClient.lastVisitDate = targetDate;
      if (input.customerSource) matchedClient.source = input.customerSource;
      if (input.customerSourceDetails) matchedClient.sourceDetails = input.customerSourceDetails.trim();
    }

    const clientId = matchedClient?.id || input.clientId;

    const newInvoice: Invoice = {
      id: invoiceId,
      invoiceNumber,
      branchId,
      date: targetDate,
      time: timeStr,
      clientId,
      clientName,
      clientPhone,
      customerSource: input.customerSource || 'WALK_IN',
      customerSourceDetails: input.customerSourceDetails?.trim(),
      staffId,
      staffName,
      lineItems: computedLineItems,
      lines: computedLineItems,
      subtotal,
      discount: totalDiscount,
      discountType: input.discountType,
      discountValue: input.discountValue,
      netSales: netSalesTotal,
      tax: taxTotal,
      tip: tipAmount,
      total: invoiceTotal,
      paymentMethod: overallPaymentMethod,
      paymentAccountId: paymentRecords[0]?.paymentAccountId,
      paymentAccountName: paymentRecords[0]?.paymentAccountName,
      cashTendered: cashTendered > 0 ? cashTendered : undefined,
      changeReturned: changeReturned > 0 ? changeReturned : undefined,
      status,
      amountPaid: totalPaymentsReceived,
      amountDue,
      payments: paymentRecords,
      processedByUserId: authenticatedActor.id,
      processedByName: authenticatedActor.name,
      idempotencyKey: input.idempotencyKey,
      notes: input.notes?.trim(),
      appointmentId: input.appointmentId || undefined,
    };

    if (input.appointmentId) {
      clonedStore.appointments = clonedStore.appointments || [];
      const apt = clonedStore.appointments.find((a) => a.id === input.appointmentId);
      if (apt) {
        apt.billingStatus = 'BILLED';
        apt.linkedInvoiceId = newInvoice.id;
        apt.linkedInvoiceNumber = newInvoice.invoiceNumber;
        if (apt.status !== 'CANCELLED' && apt.status !== 'NO_SHOW') {
          apt.status = 'COMPLETED';
        }
        apt.updatedAt = `${targetDate}T${timeStr}`;
        apt.updatedByUserId = authenticatedActor.id;
        apt.updatedByName = authenticatedActor.name;
      }
    }

    // Create POS_SALE_OUT stock movements for product lines
    if (productMovementsToPost.length > 0) {
      if (!clonedStore.stockMovements) clonedStore.stockMovements = [];
      for (const pm of productMovementsToPost) {
        const smCount = ((clonedStore.movementSequenceCounters || {})[`${branch.code}-2026`] || 0) + 1;
        if (!clonedStore.movementSequenceCounters) clonedStore.movementSequenceCounters = {};
        clonedStore.movementSequenceCounters[`${branch.code}-2026`] = smCount;
        const moveNum = nextReference(clonedStore, 'SM');

        clonedStore.stockMovements.push({
          id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          movementNumber: moveNum,
          branchId,
          itemId: pm.itemId,
          itemName: pm.itemName,
          itemSku: pm.itemSku,
          batchId: pm.batchId,
          batchNumber: pm.batchNumber,
          movementType: 'POS_SALE_OUT',
          direction: 'OUT',
          quantity: pm.quantity,
          unitCostSnapshot: pm.unitCostSnapshot,
          totalCostImpact: pm.totalCostImpact,
          sourceReferenceType: 'INVOICE',
          sourceReferenceId: newInvoice.id,
          referenceId: newInvoice.id,
          sourceReferenceNumber: newInvoice.invoiceNumber,
          reason: 'POS Retail Product Sale',
          createdById: authenticatedActor.id,
          createdByName: authenticatedActor.name,
          createdAt: new Date().toISOString(),
        });
      }
    }

    clonedStore.invoices.unshift(newInvoice);
    this.recordIdempotency(clonedStore, input.idempotencyKey, 'POS_POSTING', authenticatedActor, branchId, input, newInvoice);

    // Commit transaction atomically
    mockStorage.saveStore(clonedStore);

    return { ...newInvoice };
  }

  async collectInvoicePayment(input: CollectOutstandingPaymentInput, actor?: User): Promise<Invoice> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot collect bill payments.');
    }

    const store = mockStorage.getStore();
    const liveInvoice = store.invoices.find((i) => i.id === input.invoiceId);
    if (!liveInvoice) {
      throw new Error(`Invoice '${input.invoiceId}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (liveInvoice.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot collect payment for another branch.');
      }
    }

    // Idempotency check
    const existingResult = this.checkIdempotency(
      store,
      input.idempotencyKey,
      'COLLECTION',
      authenticatedActor,
      liveInvoice.branchId,
      input
    );
    if (existingResult) {
      return existingResult;
    }

    if (liveInvoice.status === 'PAID' || liveInvoice.amountDue <= 0) {
      throw new Error(`Invoice '${liveInvoice.invoiceNumber}' is already fully paid.`);
    }

    if (!input.payments || input.payments.length === 0) {
      throw new Error('No payment amount provided.');
    }

    // Clone store for atomic transaction
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const invoice = clonedStore.invoices.find((i: Invoice) => i.id === input.invoiceId)!;

    const targetDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    let totalCollected = 0;
    let totalBillPaid = 0;

    const newPaymentRecords: PaymentRecord[] = [];
    const previousBalance = invoice.amountDue;

    for (let idx = 0; idx < input.payments.length; idx++) {
      const p = input.payments[idx];
      if (!Number.isFinite(p.amount) || p.amount < 0 ||
          !Number.isFinite(p.billAllocation) || p.billAllocation < 0 ||
          !Number.isFinite(p.tipAllocation) || p.tipAllocation < 0) {
        throw new Error('All collection amounts must be finite, non-negative numbers.');
      }

      const pAmount = roundCurrency(p.amount);
      const bAlloc = roundCurrency(p.billAllocation);
      const tAlloc = roundCurrency(p.tipAllocation);

      if (tAlloc > 0) {
        throw new Error('Outstanding bill collections are bill-only. Tip allocation must be zero.');
      }

      if (bAlloc !== pAmount) {
        throw new Error('For bill collection, bill allocation must equal payment amount.');
      }

      if (pAmount <= 0) continue;

      if (p.method === 'ONLINE_ACCOUNT') {
        if (!p.paymentAccountId) {
          throw new Error('Online collection payment must reference a valid payment account.');
        }
        const acc = clonedStore.paymentAccounts.find((a: PaymentAccount) => a.id === p.paymentAccountId && a.branchId === invoice.branchId);
        if (!acc || !acc.isActive) {
          throw new Error(`Payment account '${p.paymentAccountName || p.paymentAccountId}' is invalid or deactivated.`);
        }
        acc.currentBalance = roundCurrency(acc.currentBalance + pAmount);
      } else if (p.method === 'CASH') {
        const tendered = roundCurrency(p.cashTendered || pAmount);
        const change = roundCurrency(p.changeReturned || 0);

        if (tendered < pAmount) {
          throw new Error(`Insufficient cash tendered (${tendered} PKR) for collection amount (${pAmount} PKR).`);
        }
        if (roundCurrency(tendered - change) !== pAmount) {
          throw new Error(`Cash tendered minus change returned (${roundCurrency(tendered - change)} PKR) must equal collection amount (${pAmount} PKR).`);
        }

        const pendingDrawer = clonedStore.cashDrawers.find(
          (d: CashDrawer) => d.branchId === invoice.branchId && d.custodianUserId === authenticatedActor.id && d.status === 'SETTLEMENT_PENDING'
        );
        if (pendingDrawer) {
          throw new Error('Your cash drawer is locked pending settlement review. Cannot collect cash payments until approved or unlocked.');
        }

        let drawer = clonedStore.cashDrawers.find(
          (d: CashDrawer) => d.branchId === invoice.branchId && d.date === targetDate && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
        );

        if (!drawer) {
          drawer = {
            id: `drawer-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
            branchId: invoice.branchId,
            date: targetDate,
            openingCash: 0.0,
            cashSales: 0.0,
            cashTipsCollected: 0.0,
            cashExpensesPaid: 0.0,
            expectedInDrawer: 0.0,
            actualInDrawer: 0.0,
            variance: 0.0,
            custodianUserId: authenticatedActor.id,
            custodianName: authenticatedActor.name,
            status: 'OPEN',
          };
          clonedStore.cashDrawers.push(drawer);
        }

        drawer.cashSales = roundCurrency(drawer.cashSales + bAlloc);
        drawer.expectedInDrawer = roundCurrency(
          drawer.openingCash + drawer.cashSales + drawer.cashTipsCollected - drawer.cashExpensesPaid
        );
      }

      totalCollected = roundCurrency(totalCollected + pAmount);
      totalBillPaid = roundCurrency(totalBillPaid + bAlloc);

      newPaymentRecords.push({
        id: `pay-coll-${idx + 1}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
        receiptNumber: nextReference(clonedStore, 'RCP'),
        invoiceId: invoice.id,
        branchId: invoice.branchId,
        date: targetDate,
        time: timeStr,
        amount: pAmount,
        billAmountAllocated: bAlloc,
        tipAmountAllocated: 0,
        method: p.method,
        paymentAccountId: p.paymentAccountId,
        paymentAccountName: p.paymentAccountName,
        processedByUserId: authenticatedActor.id,
        processedByName: authenticatedActor.name,
        cashTendered: p.method === 'CASH' ? roundCurrency(p.cashTendered || pAmount) : undefined,
        changeReturned: p.method === 'CASH' ? roundCurrency(p.changeReturned || 0) : undefined,
        previousBalance,
        remainingBalance: roundCurrency(previousBalance - totalBillPaid),
        notes: input.notes?.trim() || `Outstanding collection received by ${authenticatedActor.name}`,
      });
    }

    if (totalBillPaid <= 0) {
      throw new Error('Payment collection amount must be greater than zero.');
    }

    if (totalBillPaid > invoice.amountDue) {
      throw new Error(`Collected payment (${totalBillPaid}) exceeds outstanding balance (${invoice.amountDue}).`);
    }

    invoice.amountPaid = roundCurrency(invoice.amountPaid + totalCollected);
    invoice.amountDue = roundCurrency(invoice.amountDue - totalBillPaid);

    if (invoice.amountDue <= 0) {
      invoice.status = 'PAID';
    } else {
      invoice.status = 'PARTIAL';
    }

    // Append collection payment records
    newPaymentRecords.forEach((pr) => {
      pr.remainingBalance = invoice.amountDue;
      invoice.payments.push(pr);
    });

    // Sync client outstanding balance
    if (clonedStore.clients) {
      const client = clonedStore.clients.find(
        (c) =>
          (invoice.clientId && c.id === invoice.clientId) ||
          (c.branchId === invoice.branchId &&
            invoice.clientPhone &&
            c.phone.replace(/\D/g, '') === invoice.clientPhone.replace(/\D/g, ''))
      );
      if (client) {
        client.outstandingBalance = Math.max(0, roundCurrency((client.outstandingBalance || 0) - totalBillPaid));
      }
    }

    this.recordIdempotency(clonedStore, input.idempotencyKey, 'COLLECTION', authenticatedActor, invoice.branchId, input, invoice);

    // Commit transaction atomically
    mockStorage.saveStore(clonedStore);

    return { ...invoice };
  }

  // --- CLIENT MANAGEMENT & LOOKUP ---

  async getClients(branchId: string | 'ALL', actor?: User): Promise<Client[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access customer financial records.');
    }
    const store = mockStorage.getStore();
    const clients = store.clients || [];
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      return clients.filter((c) => c.branchId === authenticatedActor.branchId);
    }
    if (branchId === 'ALL') {
      return [...clients];
    }
    return clients.filter((c) => c.branchId === branchId);
  }

  async getClient(id: string, actor?: User): Promise<Client | null> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access customer financial records.');
    }
    const store = mockStorage.getStore();
    const client = (store.clients || []).find((c) => c.id === id);
    if (!client) return null;
    if (
      (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') &&
      client.branchId !== authenticatedActor.branchId
    ) {
      throw new Error('Access Denied: Cannot access customer records from another branch.');
    }
    return { ...client };
  }

  async searchClients(branchId: string, query: string, actor?: User): Promise<Client[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access customer financial records.');
    }
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }
    const store = mockStorage.getStore();
    const clients = (store.clients || []).filter((c) => c.branchId === targetBranchId);
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 10);

    const normDigits = q.replace(/\D/g, '');

    return clients.filter((c) => {
      const matchName = c.name.toLowerCase().includes(q);
      const normPhone = c.phone.replace(/\D/g, '');
      const matchPhone = normDigits ? normPhone.includes(normDigits) : false;
      return matchName || matchPhone;
    });
  }

  async getClientOutstandingInvoices(branchId: string, clientIdOrPhone: string, actor?: User): Promise<Invoice[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access customer financial records.');
    }
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }
    const store = mockStorage.getStore();
    const invoices = store.invoices.filter(
      (i) => i.branchId === targetBranchId && (i.status === 'UNPAID' || i.status === 'PARTIAL') && i.amountDue > 0
    );

    const normQueryPhone = clientIdOrPhone.replace(/\D/g, '');

    return invoices.filter((i) => {
      if (i.clientId && i.clientId === clientIdOrPhone) return true;
      if (normQueryPhone && i.clientPhone.replace(/\D/g, '') === normQueryPhone) return true;
      return false;
    });
  }

  async refundInvoice(invoiceId: string, input: RefundInvoiceInput, actor?: User): Promise<RefundInvoiceResult> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (!['SUPER_ADMIN', 'ADMIN'].includes(authenticatedActor.role)) {
      throw new Error('Access Denied: Only administrators can approve refunds and voids.');
    }
    const store = mockStorage.getStore();
    const invoiceIndex = store.invoices.findIndex((inv) => inv.id === invoiceId);
    if (invoiceIndex === -1) {
      throw new Error(`Invoice '${invoiceId}' not found.`);
    }
    const inv = store.invoices[invoiceIndex];
    if (inv.lifecycle === 'VOIDED' || inv.lifecycle === 'REFUNDED') {
      throw new Error(`Invoice '${inv.invoiceNumber}' is already ${inv.lifecycle?.toLowerCase()}.`);
    }

    const isVoid = input.type === 'VOID';
    const refundNumber = isVoid ? `VOID-${Date.now().toString().slice(-6)}` : `RFD-${Date.now().toString().slice(-6)}`;
    const today = new Date().toISOString().slice(0, 10);

    let netReversed = 0;
    let taxReversed = 0;

    const linesToProcess = isVoid
      ? (inv.lines || inv.lineItems || []).map((l) => ({ lineId: l.id, quantity: l.quantity, restock: 'RESALABLE' as const }))
      : (input.lines || []);

    const refundLines = linesToProcess.map((r) => {
      const line = (inv.lines || inv.lineItems || []).find((l) => l.id === r.lineId);
      const qty = r.quantity;
      const lineNet = line ? ((line.netSales ?? 0) / (line.quantity || 1)) * qty : 0;
      const lineTax = line ? ((line.tax ?? 0) / (line.quantity || 1)) * qty : 0;
      netReversed += lineNet;
      taxReversed += lineTax;
      return {
        lineId: r.lineId,
        quantity: qty,
        net: lineNet,
        tax: lineTax,
        restock: (r.restock || 'RESALABLE') as 'RESALABLE' | 'DAMAGED' | 'NONE',
      };
    });

    const totalReversed = netReversed + taxReversed;
    const cashOut = Math.min(inv.amountPaid, totalReversed);
    const newAmountPaid = Math.max(0, inv.amountPaid - cashOut);
    const newAmountDue = Math.max(0, inv.total - totalReversed - newAmountPaid);

    const refundDTO: InvoiceRefundDTO = {
      id: `rfd_${Date.now()}`,
      refundNumber,
      type: input.type,
      refundDate: today,
      netReversed,
      taxReversed,
      tipReversed: 0,
      cashOut,
      receivableCancelled: Math.max(0, inv.amountDue - newAmountDue),
      method: input.refundMethod || 'CASH',
      reason: input.reason,
      byName: authenticatedActor.name,
      createdAt: new Date().toISOString(),
      lines: refundLines,
    };

    const newLifecycle = isVoid ? 'VOIDED' : (refundLines.length >= (inv.lines || inv.lineItems || []).length ? 'REFUNDED' : 'PARTIALLY_REFUNDED');
    const updatedInvoice: Invoice = {
      ...inv,
      lifecycle: newLifecycle,
      status: newAmountDue <= 0 ? 'PAID' : (newAmountPaid > 0 ? 'PARTIAL' : 'UNPAID'),
      amountPaid: newAmountPaid,
      amountDue: newAmountDue,
      refunds: [...(inv.refunds || []), refundDTO],
    };

    store.invoices[invoiceIndex] = updatedInvoice;
    mockStorage.saveStore(store);

    return {
      invoice: updatedInvoice,
      refund: {
        refundNumber,
        type: input.type,
        netReversed,
        taxReversed,
        tipReversed: 0,
        cashOut,
      },
    };
  }

  async getInvoiceRefunds(invoiceId: string): Promise<InvoiceRefundDTO[]> {
    const store = mockStorage.getStore();
    const inv = store.invoices.find((i) => i.id === invoiceId);
    return inv?.refunds || [];
  }

  // ==========================================
  // Phase 3B: Expense Management Implementation
  // ==========================================

  async getExpenses(
    branchId: string | 'ALL',
    filter?: {
      status?: ExpenseStatus;
      category?: string;
      startDate?: string;
      endDate?: string;
      paymentSource?: string;
      search?: string;
      userId?: string;
    },
    actor?: User
  ): Promise<Expense[]> {
    let authenticatedActor: User | undefined;
    try {
      authenticatedActor = this.getAuthenticatedActor(actor);
    } catch {
      if (actor) throw new Error('Unauthorized: Session or actor is invalid.');
    }

    if (authenticatedActor && authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access expense management.');
    }

    let targetBranchId = branchId;
    if (authenticatedActor && (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT')) {
      if (branchId !== 'ALL' && branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot access expenses from another branch.');
      }
      targetBranchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    let exps = targetBranchId === 'ALL'
      ? [...store.expenses]
      : store.expenses.filter((e) => e.branchId === targetBranchId);

    // Accountants can only view their own vouchers and drafts
    if (authenticatedActor && authenticatedActor.role === 'ACCOUNTANT') {
      exps = exps.filter((e) => e.createdByUserId === authenticatedActor!.id || e.paidByUserId === authenticatedActor!.id);
    }

    if (filter) {
      if (filter.status) {
        if (filter.status === 'POSTED') {
          exps = exps.filter((e) => e.status === 'POSTED' || e.status === 'PAID');
        } else {
          exps = exps.filter((e) => e.status === filter.status);
        }
      }

      if (filter.category) {
        const catQuery = filter.category.trim().toLowerCase();
        exps = exps.filter((e) => e.category.toLowerCase() === catQuery);
      }

      if (filter.startDate) {
        exps = exps.filter((e) => (e.expenseDate || e.date) >= filter.startDate!);
      }

      if (filter.endDate) {
        exps = exps.filter((e) => (e.expenseDate || e.date) <= filter.endDate!);
      }

      if (filter.paymentSource) {
        exps = exps.filter((e) => e.paymentSource === filter.paymentSource);
      }

      if (filter.userId) {
        exps = exps.filter((e) => e.createdByUserId === filter.userId || e.paidByUserId === filter.userId);
      }

      if (filter.search) {
        const q = filter.search.trim().toLowerCase();
        exps = exps.filter((e) =>
          (e.voucherNumber && e.voucherNumber.toLowerCase().includes(q)) ||
          (e.payee && e.payee.toLowerCase().includes(q)) ||
          (e.title && e.title.toLowerCase().includes(q)) ||
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q)) ||
          (e.paymentAccountName && e.paymentAccountName.toLowerCase().includes(q))
        );
      }
    }

    return exps.sort((a, b) => {
      const dateA = a.expenseDate || a.date;
      const dateB = b.expenseDate || b.date;
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return (b.voucherNumber || b.id).localeCompare(a.voucherNumber || a.id);
    });
  }

  async getExpense(id: string, actor?: User): Promise<Expense | null> {
    const store = mockStorage.getStore();
    const exp = store.expenses.find((e) => e.id === id);
    if (!exp) return null;

    if (actor) {
      const authenticatedActor = this.getAuthenticatedActor(actor);
      if (authenticatedActor.role === 'STAFF') {
        throw new Error('Access Denied: Staff members cannot access expense management.');
      }
      if ((authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') && exp.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot access expenses from another branch.');
      }
      if (authenticatedActor.role === 'ACCOUNTANT' && exp.createdByUserId !== authenticatedActor.id && exp.paidByUserId !== authenticatedActor.id) {
        throw new Error('Access Denied: Accountants can only view their own expense vouchers.');
      }
    }

    return { ...exp };
  }

  async createExpenseDraft(
    params: Omit<Expense, 'id' | 'voucherNumber' | 'status' | 'createdAt'>,
    actor?: User
  ): Promise<Expense> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot create expense drafts.');
    }

    let branchId = params.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (params.branchId && params.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot create expense drafts for another branch.');
      }
      branchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error('Expense amount must be a positive finite number.');
    }
    if (!params.category || !params.category.trim()) {
      throw new Error('Expense category is required.');
    }
    if (!params.payee || !params.payee.trim()) {
      throw new Error('Payee name is required.');
    }
    if (!params.title || !params.title.trim()) {
      throw new Error('Expense title/description is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetDate = params.expenseDate || params.date || mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const draftVoucherNumber = this.generateNextExpenseVoucherNumber(clonedStore, branch, targetDate, 'DFT');

    const draftRecord: Expense = {
      id: `exp-dft-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
      voucherNumber: draftVoucherNumber,
      branchId,
      date: targetDate,
      expenseDate: targetDate,
      time: timeStr,
      title: params.title.trim(),
      description: params.description?.trim() || params.title.trim(),
      payee: params.payee.trim(),
      category: params.category.trim(),
      amount: roundCurrency(params.amount),
      paymentSource: params.paymentSource || 'CASH_DRAWER',
      paymentAccountId: params.paymentAccountId,
      paymentAccountName: params.paymentAccountName,
      externalReference: params.externalReference?.trim(),
      notes: params.notes?.trim(),
      createdByUserId: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      status: 'DRAFT',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    clonedStore.expenses.push(draftRecord);
    mockStorage.saveStore(clonedStore);
    return draftRecord;
  }

  async updateExpenseDraft(id: string, params: Partial<Expense>, actor?: User): Promise<Expense> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot edit expense drafts.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const draft = clonedStore.expenses.find((e) => e.id === id);
    if (!draft) {
      throw new Error('Expense draft not found.');
    }
    if (draft.status !== 'DRAFT') {
      throw new Error(`Cannot edit expense with status '${draft.status}'. Only DRAFT expenses can be edited.`);
    }

    if (authenticatedActor.role === 'ADMIN' && draft.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit drafts for another branch.');
    }
    if (authenticatedActor.role === 'ACCOUNTANT') {
      if (draft.branchId !== authenticatedActor.branchId || draft.createdByUserId !== authenticatedActor.id) {
        throw new Error('Access Denied: Accountants can only edit their own draft expenses.');
      }
    }

    if (params.amount !== undefined) {
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        throw new Error('Expense amount must be a positive finite number.');
      }
      draft.amount = roundCurrency(params.amount);
    }
    if (params.title !== undefined) {
      if (!params.title.trim()) throw new Error('Expense title cannot be empty.');
      draft.title = params.title.trim();
    }
    if (params.payee !== undefined) {
      if (!params.payee.trim()) throw new Error('Payee name cannot be empty.');
      draft.payee = params.payee.trim();
    }
    if (params.category !== undefined) {
      if (!params.category.trim()) throw new Error('Category cannot be empty.');
      draft.category = params.category.trim();
    }
    if (params.description !== undefined) draft.description = params.description.trim();
    if (params.expenseDate !== undefined) draft.expenseDate = params.expenseDate;
    if (params.date !== undefined) draft.date = params.date;
    if (params.paymentSource !== undefined) draft.paymentSource = params.paymentSource;
    if (params.paymentAccountId !== undefined) draft.paymentAccountId = params.paymentAccountId;
    if (params.paymentAccountName !== undefined) draft.paymentAccountName = params.paymentAccountName;
    if (params.externalReference !== undefined) draft.externalReference = params.externalReference.trim();
    if (params.notes !== undefined) draft.notes = params.notes.trim();

    draft.updatedAt = new Date().toISOString();
    mockStorage.saveStore(clonedStore);
    return draft;
  }

  async deleteExpenseDraft(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot delete expense drafts.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const idx = clonedStore.expenses.findIndex((e) => e.id === id);
    if (idx === -1) {
      throw new Error('Expense draft not found.');
    }
    const draft = clonedStore.expenses[idx];
    if (draft.status !== 'DRAFT') {
      throw new Error(`Cannot delete expense with status '${draft.status}'. Only DRAFT expenses can be deleted.`);
    }

    if (authenticatedActor.role === 'ADMIN' && draft.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot delete drafts for another branch.');
    }
    if (authenticatedActor.role === 'ACCOUNTANT') {
      if (draft.branchId !== authenticatedActor.branchId || draft.createdByUserId !== authenticatedActor.id) {
        throw new Error('Access Denied: Accountants can only delete their own draft expenses.');
      }
    }

    clonedStore.expenses.splice(idx, 1);
    mockStorage.saveStore(clonedStore);
    return { success: true, message: `Draft expense ${draft.voucherNumber} has been deleted.` };
  }

  async postExpense(
    params: {
      expenseId?: string;
      branchId: string;
      expenseDate?: string;
      category: string;
      payee: string;
      title: string;
      description?: string;
      amount: number;
      paymentSource: 'CASH_DRAWER' | 'ONLINE_ACCOUNT';
      paymentAccountId?: string;
      externalReference?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    actor?: User
  ): Promise<Expense> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot post expenses.');
    }

    let branchId = params.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (params.branchId && params.branchId !== 'ALL' && params.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot perform operations for another branch.');
      }
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit active branch must be selected to post expenses.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    // Check Idempotency
    const existing = this.checkIdempotency(store, params.idempotencyKey, 'EXPENSE_POSTING', authenticatedActor, branchId, params);
    if (existing) {
      return existing;
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error('Expense amount must be a positive finite number.');
    }
    if (!params.category || !params.category.trim()) {
      throw new Error('Expense category is required.');
    }
    if (!params.payee || !params.payee.trim()) {
      throw new Error('Payee name is required.');
    }
    if (!params.title || !params.title.trim()) {
      throw new Error('Expense title is required.');
    }

    const amount = roundCurrency(params.amount);
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const clonedBranch = clonedStore.branches.find((b) => b.id === branchId)!;
    const targetDate = params.expenseDate || mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    let paymentAccountName: string | undefined;

    if (params.paymentSource === 'CASH_DRAWER') {
      const pendingDrawer = clonedStore.cashDrawers.find(
        (d) => d.branchId === branchId && d.custodianUserId === authenticatedActor.id && d.status === 'SETTLEMENT_PENDING'
      );
      if (pendingDrawer) {
        throw new Error('Your cash drawer is currently locked pending settlement review. Cash expenses cannot be disbursed.');
      }

      const drawer = clonedStore.cashDrawers.find(
        (d) => d.branchId === branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
      );
      if (!drawer) {
        throw new Error(
          `Cash expense posting requires an active open cash drawer for ${authenticatedActor.name} in branch '${clonedBranch.name}'. Cash cannot be disbursed without an open drawer in custody.`
        );
      }

      const availableCash = roundCurrency(drawer.openingCash + drawer.cashSales + drawer.cashTipsCollected - drawer.cashExpensesPaid);
      if (availableCash < amount) {
        throw new Error(
          `Insufficient funds in cash drawer for ${authenticatedActor.name}. Available cash: PKR ${availableCash.toLocaleString()}, Required: PKR ${amount.toLocaleString()}. Please request a Cash Float Transfer from an Administrator.`
        );
      }

      drawer.cashExpensesPaid = roundCurrency(drawer.cashExpensesPaid + amount);
      drawer.expectedInDrawer = roundCurrency(drawer.openingCash + drawer.cashSales + drawer.cashTipsCollected - drawer.cashExpensesPaid);
      drawer.actualInDrawer = roundCurrency(drawer.expectedInDrawer + drawer.variance);
    } else if (params.paymentSource === 'ONLINE_ACCOUNT') {
      if (!params.paymentAccountId) {
        throw new Error('A payment account must be selected when payment method is Online Account.');
      }
      const acc = clonedStore.paymentAccounts.find((a) => a.id === params.paymentAccountId && a.branchId === branchId);
      if (!acc || acc.isActive === false) {
        throw new Error('Selected payment account is inactive or not found for this branch.');
      }
      if (acc.currentBalance < amount) {
        throw new Error(
          `Insufficient funds in payment account '${acc.name}'. Available: PKR ${acc.currentBalance.toLocaleString()}, Required: PKR ${amount.toLocaleString()}.`
        );
      }

      acc.currentBalance = roundCurrency(acc.currentBalance - amount);
      paymentAccountName = acc.name;
    } else {
      throw new Error(`Unsupported payment source '${params.paymentSource}'.`);
    }

    const voucherNumber = this.generateNextExpenseVoucherNumber(clonedStore, clonedBranch, targetDate, 'EXP');

    let postedExpense: Expense;

    if (params.expenseId) {
      const draftIdx = clonedStore.expenses.findIndex((e) => e.id === params.expenseId);
      if (draftIdx === -1) {
        throw new Error(`Existing expense draft '${params.expenseId}' not found.`);
      }
      const existingDraft = clonedStore.expenses[draftIdx];
      if (existingDraft.status !== 'DRAFT') {
        throw new Error(`Cannot post expense with status '${existingDraft.status}'. Only DRAFT expenses can be posted.`);
      }
      if (authenticatedActor.role === 'ACCOUNTANT' && existingDraft.createdByUserId !== authenticatedActor.id) {
        throw new Error('Access Denied: Accountants can only post their own draft expenses.');
      }

      postedExpense = {
        ...existingDraft,
        voucherNumber,
        category: params.category.trim(),
        payee: params.payee.trim(),
        title: params.title.trim(),
        description: params.description?.trim() || params.title.trim(),
        amount,
        paymentSource: params.paymentSource,
        paymentAccountId: params.paymentAccountId,
        paymentAccountName,
        externalReference: params.externalReference?.trim(),
        notes: params.notes?.trim(),
        paidByUserId: authenticatedActor.id,
        paidByName: authenticatedActor.name,
        status: 'POSTED',
        expenseDate: targetDate,
        date: targetDate,
        time: timeStr,
        updatedAt: now.toISOString(),
      };
      clonedStore.expenses[draftIdx] = postedExpense;
    } else {
      postedExpense = {
        id: `exp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
        voucherNumber,
        branchId,
        date: targetDate,
        expenseDate: targetDate,
        time: timeStr,
        title: params.title.trim(),
        description: params.description?.trim() || params.title.trim(),
        payee: params.payee.trim(),
        category: params.category.trim(),
        amount,
        paymentSource: params.paymentSource,
        paymentAccountId: params.paymentAccountId,
        paymentAccountName,
        externalReference: params.externalReference?.trim(),
        notes: params.notes?.trim(),
        createdByUserId: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        paidByUserId: authenticatedActor.id,
        paidByName: authenticatedActor.name,
        status: 'POSTED',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (params.paymentSource === 'CASH_DRAWER') {
        const activeDrawer = clonedStore.cashDrawers.find(
          (d) => d.branchId === branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
        );
        if (activeDrawer) {
          (postedExpense as any).paidFromDrawerId = activeDrawer.id;
        }
      }
      clonedStore.expenses.push(postedExpense);
    }

    this.recordIdempotency(clonedStore, params.idempotencyKey, 'EXPENSE_POSTING', authenticatedActor, branchId, params, postedExpense);
    mockStorage.saveStore(clonedStore);
    return postedExpense;
  }

  async reverseExpense(id: string, reason: string, actor?: User): Promise<{ originalExpense: Expense; reversalExpense: Expense }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Super Admin and Branch Admin can reverse posted expenses.');
    }
    if (!reason || !reason.trim()) {
      throw new Error('A reversal reason is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const exp = clonedStore.expenses.find((e) => e.id === id);
    if (!exp) {
      throw new Error('Expense not found.');
    }
    if (exp.status === 'REVERSED') {
      throw new Error(`Expense voucher '${exp.voucherNumber}' has already been reversed.`);
    }
    if (exp.status === 'DRAFT') {
      throw new Error('Draft expenses cannot be reversed; they can be deleted.');
    }
    if (authenticatedActor.role === 'ADMIN' && exp.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot reverse expenses from another branch.');
    }

    const branch = clonedStore.branches.find((b) => b.id === exp.branchId);
    if (!branch) {
      throw new Error('Branch associated with this expense was not found.');
    }

    const targetDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    let receivingDrawerId: string | undefined;
    let receivingCustodianUserId: string | undefined;
    let receivingCustodianName: string | undefined;

    if (exp.paymentSource === 'CASH_DRAWER') {
      const openDrawer =
        clonedStore.cashDrawers.find((d) => d.branchId === exp.branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN') ||
        clonedStore.cashDrawers.find((d) => d.branchId === exp.branchId && d.custodianUserId === exp.paidByUserId && d.status === 'OPEN') ||
        clonedStore.cashDrawers.find((d) => d.branchId === exp.branchId && d.status === 'OPEN');

      if (!openDrawer) {
        throw new Error(
          `Cannot reverse cash expense: no active open cash drawer is currently available in branch '${branch.name}' to receive the cash refund. Please open a cash drawer first.`
        );
      }

      receivingDrawerId = openDrawer.id;
      receivingCustodianUserId = openDrawer.custodianUserId;
      receivingCustodianName = openDrawer.custodianName;

      // Never rewrite closed drawer or approved settlement history
      const originalDrawer = clonedStore.cashDrawers.find((d) => d.id === (exp as any).paidFromDrawerId);
      if (originalDrawer && originalDrawer.status === 'OPEN' && originalDrawer.id === openDrawer.id) {
        openDrawer.cashExpensesPaid = roundCurrency(Math.max(0, openDrawer.cashExpensesPaid - exp.amount));
        openDrawer.expectedInDrawer = roundCurrency(openDrawer.openingCash + openDrawer.cashSales + openDrawer.cashTipsCollected - openDrawer.cashExpensesPaid);
        openDrawer.actualInDrawer = roundCurrency(openDrawer.expectedInDrawer + openDrawer.variance);
      } else {
        // Original drawer is closed or different: do NOT rewrite historical drawer!
        // Credit the receiving open drawer as refund received in custody
        openDrawer.expectedInDrawer = roundCurrency(openDrawer.expectedInDrawer + exp.amount);
        openDrawer.actualInDrawer = roundCurrency(openDrawer.actualInDrawer + exp.amount);
      }
    } else if (exp.paymentSource === 'ONLINE_ACCOUNT') {
      const acc = clonedStore.paymentAccounts.find((a) => a.id === exp.paymentAccountId);
      if (!acc) {
        throw new Error(`Original payment account '${exp.paymentAccountId}' not found for reversal.`);
      }
      acc.currentBalance = roundCurrency(acc.currentBalance + exp.amount);
    }

    const revVoucherNumber = this.generateNextExpenseVoucherNumber(clonedStore, branch, targetDate, 'REV');

    exp.status = 'REVERSED';
    exp.reversalVoucherNumber = revVoucherNumber;
    exp.reversalReason = reason.trim();
    exp.reversedByUserId = authenticatedActor.id;
    exp.reversedByName = authenticatedActor.name;
    exp.reversedAt = now.toISOString();
    exp.updatedAt = now.toISOString();

    const reversalRecord: Expense = {
      id: `rev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
      voucherNumber: revVoucherNumber,
      branchId: exp.branchId,
      date: targetDate,
      expenseDate: targetDate,
      time: timeStr,
      title: `Reversal: ${exp.title}`,
      description: `Reversal of ${exp.voucherNumber}. Reason: ${reason.trim()}`,
      payee: exp.payee,
      category: exp.category,
      amount: exp.amount,
      paymentSource: exp.paymentSource,
      paymentAccountId: exp.paymentAccountId,
      paymentAccountName: exp.paymentAccountName,
      status: 'REVERSED',
      reversalOfVoucherNumber: exp.voucherNumber,
      reversalReason: reason.trim(),
      createdByUserId: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      paidByUserId: authenticatedActor.id,
      paidByName: authenticatedActor.name,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (receivingDrawerId) {
      (reversalRecord as any).receivingDrawerId = receivingDrawerId;
      (reversalRecord as any).receivingCustodianUserId = receivingCustodianUserId;
      (reversalRecord as any).receivingCustodianName = receivingCustodianName;
      (reversalRecord as any).paidFromDrawerId = (exp as any).paidFromDrawerId;
    }

    clonedStore.expenses.push(reversalRecord);
    mockStorage.saveStore(clonedStore);
    return { originalExpense: exp, reversalExpense: reversalRecord };
  }

  async getExpenseCategories(branchId: string | 'ALL', actor?: User): Promise<ExpenseCategoryItem[]> {
    const store = mockStorage.getStore();
    const categories = store.expenseCategories || [];
    if (branchId === 'ALL') {
      return [...categories];
    }
    return categories.filter((c) => c.branchId === branchId);
  }

  async createExpenseCategory(branchId: string, name: string, description?: string, actor?: User): Promise<ExpenseCategoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Super Admin and Branch Admin can manage expense categories.');
    }
    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot create categories for another branch.');
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Expense category name is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.expenseCategories = clonedStore.expenseCategories || [];

    const duplicate = clonedStore.expenseCategories.find(
      (c) => c.branchId === branchId && c.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      throw new Error(`An expense category named '${trimmedName}' already exists in this branch.`);
    }

    const newCat: ExpenseCategoryItem = {
      id: `exp-cat-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      branchId,
      name: trimmedName,
      description: description?.trim(),
      isActive: true,
      createdAt: mockStorage.getSystemDate(),
    };

    clonedStore.expenseCategories.push(newCat);
    mockStorage.saveStore(clonedStore);
    return newCat;
  }

  async updateExpenseCategory(id: string, params: Partial<ExpenseCategoryItem>, actor?: User): Promise<ExpenseCategoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Super Admin and Branch Admin can manage expense categories.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.expenseCategories = clonedStore.expenseCategories || [];
    const cat = clonedStore.expenseCategories.find((c) => c.id === id);
    if (!cat) {
      throw new Error('Expense category not found.');
    }

    if (authenticatedActor.role === 'ADMIN' && cat.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot update categories for another branch.');
    }

    if (params.name !== undefined) {
      const trimmed = params.name.trim();
      if (!trimmed) throw new Error('Category name cannot be empty.');
      const dup = clonedStore.expenseCategories.find(
        (c) => c.id !== id && c.branchId === cat.branchId && c.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (dup) {
        throw new Error(`An expense category named '${trimmed}' already exists in this branch.`);
      }
      cat.name = trimmed;
    }
    if (params.description !== undefined) cat.description = params.description.trim();
    if (params.isActive !== undefined) cat.isActive = params.isActive;

    mockStorage.saveStore(clonedStore);
    return cat;
  }

  async toggleExpenseCategoryStatus(id: string, actor?: User): Promise<ExpenseCategoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Super Admin and Branch Admin can manage expense categories.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.expenseCategories = clonedStore.expenseCategories || [];
    const cat = clonedStore.expenseCategories.find((c) => c.id === id);
    if (!cat) {
      throw new Error('Expense category not found.');
    }

    if (authenticatedActor.role === 'ADMIN' && cat.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify categories for another branch.');
    }

    cat.isActive = !cat.isActive;
    mockStorage.saveStore(clonedStore);
    return cat;
  }

  async transferCashFloat(
    params: { branchId: string; targetUserId: string; amount: number; notes?: string },
    actor?: User
  ): Promise<CashTransferRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Administrators can perform Cash Float Transfers.');
    }

    let branchId = params.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      if (params.branchId && params.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot transfer cash float to another branch.');
      }
      branchId = authenticatedActor.branchId;
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error('Transfer amount must be a positive finite number.');
    }

    const amount = roundCurrency(params.amount);
    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const targetUser = store.users.find((u) => u.id === params.targetUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new Error(`Target custodian user is invalid or inactive.`);
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const pendingDrawer = clonedStore.cashDrawers.find(
      (d) => d.branchId === branchId && d.custodianUserId === params.targetUserId && d.status === 'SETTLEMENT_PENDING'
    );
    if (pendingDrawer) {
      throw new Error(`Target custodian drawer is currently locked pending settlement review.`);
    }

    const targetDrawer = clonedStore.cashDrawers.find(
      (d) => d.branchId === branchId && d.custodianUserId === params.targetUserId && d.status === 'OPEN'
    );
    if (!targetDrawer) {
      throw new Error(
        `Target user ${targetUser.name} does not have an active open cash drawer in branch '${branch.name}'. A cash drawer must be opened before float funds can be transferred.`
      );
    }

    targetDrawer.openingCash = roundCurrency(targetDrawer.openingCash + amount);
    targetDrawer.expectedInDrawer = roundCurrency(targetDrawer.expectedInDrawer + amount);
    targetDrawer.actualInDrawer = roundCurrency(targetDrawer.actualInDrawer + amount);

    const targetDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const yearStr = targetDate.slice(0, 4);
    const count = (clonedStore.cashTransfers || []).length + 1;
    const transferNumber = nextReference(clonedStore, 'CXF');

    const transferRecord: CashTransferRecord = {
      id: `cxf-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      transferNumber,
      branchId,
      date: targetDate,
      time: timeStr,
      amount,
      fromSource: 'BRANCH_VAULT',
      toDrawerId: targetDrawer.id,
      toCustodianUserId: targetUser.id,
      toCustodianName: targetUser.name,
      transferredByUserId: authenticatedActor.id,
      transferredByName: authenticatedActor.name,
      notes: params.notes?.trim() || 'Internal cash float replenishment',
    };

    clonedStore.cashTransfers = clonedStore.cashTransfers || [];
    clonedStore.cashTransfers.push(transferRecord);
    mockStorage.saveStore(clonedStore);
    return transferRecord;
  }

  // ==========================================
  // Phase 3C: Balance Sheet & Account Settlement
  // ==========================================

  private generateNextSettlementNumber(clonedStore: StorageSchema, branch: Branch, targetDate: string): string { return nextReference(clonedStore, 'SET'); }

  private generateNextVarianceAdjustmentNumber(clonedStore: StorageSchema, branch: Branch, targetDate: string): string { return nextReference(clonedStore, 'CVA'); }

  async getCashCustodyStatement(
    params: {
      userId?: string;
      branchId?: string;
      drawerId?: string;
      startDate?: string;
      endDate?: string;
    },
    actor?: User
  ): Promise<{
    summary: BalanceSheetSummary;
    transactions: CustodyTransaction[];
    openingBalanceCarriedForward: number;
  }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access cash custody statements.');
    }

    const store = mockStorage.getStore();

    // Determine target branch
    let targetBranchId = params.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (params.branchId && params.branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot access balance sheet for another branch.');
      }
      targetBranchId = authenticatedActor.branchId;
    }
    if (!targetBranchId || targetBranchId === 'ALL') {
      targetBranchId = authenticatedActor.branchId || store.branches[0]?.id;
    }

    const branch = store.branches.find((b) => b.id === targetBranchId) || store.branches[0];

    // Determine target user ("My" must strictly mean logged-in user for non-Super Admin or default)
    let targetUserId = authenticatedActor.id;
    if (authenticatedActor.role === 'SUPER_ADMIN') {
      if (params.userId) {
        targetUserId = params.userId;
      }
    } else if (authenticatedActor.role === 'ADMIN') {
      if (params.userId && params.userId !== authenticatedActor.id) {
        // Branch Admin can inspect users in their own branch
        const targetUserInBranch = store.users.find((u) => u.id === params.userId && u.branchId === authenticatedActor.branchId);
        if (targetUserInBranch) {
          targetUserId = params.userId;
        }
      }
    } else if (authenticatedActor.role === 'ACCOUNTANT') {
      // Accountant can ONLY view their own statement
      targetUserId = authenticatedActor.id;
    }

    const targetUser = store.users.find((u) => u.id === targetUserId) || authenticatedActor;

    // Find the relevant cash drawer
    let drawer: CashDrawer | undefined;
    if (params.drawerId) {
      drawer = store.cashDrawers.find((d) => d.id === params.drawerId);
    } else {
      // Find current open or pending drawer, else latest by date
      drawer = store.cashDrawers.find(
        (d) => d.branchId === targetBranchId && d.custodianUserId === targetUserId && (d.status === 'OPEN' || d.status === 'SETTLEMENT_PENDING')
      ) || store.cashDrawers
        .filter((d) => d.branchId === targetBranchId && d.custodianUserId === targetUserId)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
    }

    // Build raw custody transactions from canonical events
    const rawTxList: CustodyTransaction[] = [];

    // 1. Initial Opening Float of the drawer
    if (drawer && drawer.openingCash > 0) {
      rawTxList.push({
        id: `tx-open-${drawer.id}`,
        date: drawer.date,
        time: '09:00 AM',
        type: 'OPENING_FLOAT',
        referenceNumber: `DRAWER-${drawer.id.slice(-6).toUpperCase()}`,
        description: `Opening Cash Float for ${drawer.custodianName}`,
        cashIn: drawer.openingCash,
        cashOut: 0,
        runningBalance: 0,
        actorUserId: drawer.custodianUserId,
        actorName: drawer.custodianName,
        documentType: 'DRAWER',
        documentId: drawer.id,
      });
    }

    // 2. Cash Float Transfers Received from Vault
    const transfers = (store.cashTransfers || []).filter(
      (t) => t.branchId === targetBranchId && t.toCustodianUserId === targetUserId && (!params.drawerId || !drawer || t.date === drawer.date)
    );
    for (const t of transfers) {
      // Avoid double counting if fromSource was retained float from drawer opening
      if (t.fromSource === 'BRANCH_VAULT') {
        rawTxList.push({
          id: `tx-cxf-${t.id}`,
          date: t.date,
          time: t.time || '10:00 AM',
          type: 'FLOAT_RECEIVED',
          referenceNumber: t.transferNumber,
          description: `Cash Float Replenishment (${t.notes || 'From Branch Vault'})`,
          cashIn: t.amount,
          cashOut: 0,
          runningBalance: 0,
          actorUserId: t.toCustodianUserId,
          actorName: t.toCustodianName,
          documentType: 'TRANSFER',
          documentId: t.id,
        });
      }
    }

    // 3. POS Invoices & Dues Collections (Cash only)
    for (const inv of store.invoices) {
      if (inv.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && inv.date !== drawer.date) continue;
      for (const p of inv.payments || []) {
        if (p.method === 'CASH' && p.processedByUserId === targetUserId) {
          const isDuesCollection = p.id.startsWith('pay-coll-') || (inv.notes && inv.notes.includes('Collection'));
          const billAlloc = roundCurrency(p.billAmountAllocated || 0);
          const tipAlloc = roundCurrency(p.tipAmountAllocated || 0);

          if (billAlloc > 0) {
            if (isDuesCollection) {
              rawTxList.push({
                id: `tx-bill-${p.id}`,
                date: p.date,
                time: p.time || '12:00 PM',
                type: 'DUES_COLLECTION',
                referenceNumber: inv.invoiceNumber,
                description: `Previous Due Collection - ${inv.clientName} (${inv.invoiceNumber})`,
                cashIn: billAlloc,
                cashOut: 0,
                runningBalance: 0,
                actorUserId: p.processedByUserId,
                actorName: p.processedByName,
                documentType: 'COLLECTION',
                documentId: inv.id,
                rawEntity: inv,
              });
            } else {
              rawTxList.push({
                id: `tx-bill-${p.id}`,
                date: p.date,
                time: p.time || '12:00 PM',
                type: 'POS_SALE',
                referenceNumber: inv.invoiceNumber,
                description: `POS Cash Sale - ${inv.clientName} (${inv.invoiceNumber})`,
                cashIn: billAlloc,
                cashOut: 0,
                runningBalance: 0,
                actorUserId: p.processedByUserId,
                actorName: p.processedByName,
                documentType: 'INVOICE',
                documentId: inv.id,
                rawEntity: inv,
              });
            }
          }

          if (tipAlloc > 0) {
            rawTxList.push({
              id: `tx-tip-${p.id}`,
              date: p.date,
              time: p.time || '12:00 PM',
              type: 'TIP_RECEIVED',
              referenceNumber: inv.invoiceNumber,
              description: `Cash Tip Collected (${inv.invoiceNumber})`,
              cashIn: tipAlloc,
              cashOut: 0,
              runningBalance: 0,
              actorUserId: p.processedByUserId,
              actorName: p.processedByName,
              documentType: 'INVOICE',
              documentId: inv.id,
              rawEntity: inv,
            });
          }
        }
      }
    }

    // 4. Cash Expenses Paid
    for (const exp of store.expenses) {
      if (exp.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && (exp.expenseDate || exp.date) !== drawer.date) continue;
      if (exp.paymentSource === 'CASH_DRAWER' && exp.paidByUserId === targetUserId) {
        if ((exp.status === 'POSTED' || exp.status === 'REVERSED') && !exp.reversalOfVoucherNumber) {
          rawTxList.push({
            id: `tx-exp-${exp.id}`,
            date: exp.expenseDate || exp.date,
            time: exp.time || '02:00 PM',
            type: 'EXPENSE_PAID',
            referenceNumber: exp.voucherNumber,
            description: `Cash Expense - ${exp.payee}: ${exp.title} (${exp.category})`,
            cashIn: 0,
            cashOut: exp.amount,
            runningBalance: 0,
            actorUserId: exp.paidByUserId || exp.createdByUserId || 'unknown',
            actorName: exp.paidByName || exp.createdByName || 'Staff Custodian',
            documentType: 'EXPENSE',
            documentId: exp.id,
            rawEntity: exp,
          });
        }
      }
    }

    // 5. Cash Refunds from Reversals
    for (const exp of store.expenses) {
      if (exp.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && (exp.expenseDate || exp.date) !== drawer.date) continue;
      if (exp.paymentSource === 'CASH_DRAWER' && exp.status === 'REVERSED' && exp.reversalOfVoucherNumber) {
        const isReceiver = (exp as any).receivingCustodianUserId === targetUserId || exp.paidByUserId === targetUserId;
        if (isReceiver) {
          rawTxList.push({
            id: `tx-rev-${exp.id}`,
            date: exp.expenseDate || exp.date,
            time: exp.time || '03:00 PM',
            type: 'EXPENSE_REVERSAL_REFUND',
            referenceNumber: exp.voucherNumber,
            description: `Cash Refund from Reversal (${exp.reversalOfVoucherNumber}) - ${exp.title}`,
            cashIn: exp.amount,
            cashOut: 0,
            runningBalance: 0,
            actorUserId: exp.paidByUserId || exp.createdByUserId || 'unknown',
            actorName: exp.paidByName || exp.createdByName || 'Staff Custodian',
            documentType: 'REVERSAL',
            documentId: exp.id,
            rawEntity: exp,
          });
        }
      }
    }

    // 5b. Cash Payroll Disbursements & Reversals
    for (const p of store.payrollPayments || []) {
      if (p.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && p.cashDrawerId && p.cashDrawerId !== drawer.id) continue;
      if (p.method === 'CASH' && p.paidByUserId === targetUserId) {
        if (p.status === 'COMPLETED') {
          rawTxList.push({
            id: `tx-pay-payroll-${p.id}`,
            date: p.paidAt.slice(0, 10),
            time: p.paidAt.length > 11 ? p.paidAt.slice(11, 16) : '02:00 PM',
            type: 'EXPENSE_PAID',
            referenceNumber: p.paymentNumber,
            description: `Salary Payout - ${p.staffName} (${p.paymentNumber})`,
            cashIn: 0,
            cashOut: p.amount,
            runningBalance: 0,
            actorUserId: p.paidByUserId,
            actorName: p.paidByName,
            documentType: 'EXPENSE',
            documentId: p.id,
            rawEntity: p,
          });
        } else if (p.status === 'REVERSED') {
          rawTxList.push({
            id: `tx-rev-payroll-${p.id}`,
            date: (p.reversedAt || p.paidAt).slice(0, 10),
            time: (p.reversedAt || p.paidAt).length > 11 ? (p.reversedAt || p.paidAt).slice(11, 16) : '03:00 PM',
            type: 'EXPENSE_REVERSAL_REFUND',
            referenceNumber: p.paymentNumber,
            description: `Salary Payout Reversal Refund (${p.paymentNumber}) - ${p.staffName}`,
            cashIn: p.amount,
            cashOut: 0,
            runningBalance: 0,
            actorUserId: p.reversedByUserId || p.paidByUserId,
            actorName: p.reversedByName || p.paidByName,
            documentType: 'REVERSAL',
            documentId: p.id,
            rawEntity: p,
          });
        }
      }
    }

    // 5c. Cash Commission Disbursements & Reversals
    for (const p of store.commissionPayments || []) {
      if (p.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && p.cashDrawerId && p.cashDrawerId !== drawer.id) continue;
      if (p.method === 'CASH' && p.paidByUserId === targetUserId) {
        if (p.status === 'COMPLETED') {
          rawTxList.push({
            id: `tx-pay-comm-${p.id}`,
            date: p.paidAt.slice(0, 10),
            time: p.paidAt.length > 11 ? p.paidAt.slice(11, 16) : '02:00 PM',
            type: 'EXPENSE_PAID',
            referenceNumber: p.paymentNumber,
            description: `Commission Payout - ${p.staffName} (${p.paymentNumber})`,
            cashIn: 0,
            cashOut: p.amount,
            runningBalance: 0,
            actorUserId: p.paidByUserId,
            actorName: p.paidByName,
            documentType: 'EXPENSE',
            documentId: p.id,
            rawEntity: p,
          });
        } else if (p.status === 'REVERSED') {
          rawTxList.push({
            id: `tx-rev-comm-${p.id}`,
            date: (p.reversedAt || p.paidAt).slice(0, 10),
            time: (p.reversedAt || p.paidAt).length > 11 ? (p.reversedAt || p.paidAt).slice(11, 16) : '03:00 PM',
            type: 'EXPENSE_REVERSAL_REFUND',
            referenceNumber: p.paymentNumber,
            description: `Commission Payout Reversal Refund (${p.paymentNumber}) - ${p.staffName}`,
            cashIn: p.amount,
            cashOut: 0,
            runningBalance: 0,
            actorUserId: p.reversedByUserId || p.paidByUserId,
            actorName: p.reversedByName || p.paidByName,
            documentType: 'REVERSAL',
            documentId: p.id,
            rawEntity: p,
          });
        }
      }
    }

    // 5d. Cash Tip Disbursements & Reversals
    for (const p of store.tipPayouts || []) {
      if (p.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && p.cashDrawerId && p.cashDrawerId !== drawer.id) continue;
      if (p.method === 'CASH' && p.paidByUserId === targetUserId) {
        if (p.status === 'COMPLETED') {
          rawTxList.push({
            id: `tx-pay-tip-${p.id}`,
            date: p.payoutDate,
            time: p.payoutTime || '01:00 PM',
            type: 'EXPENSE_PAID',
            referenceNumber: p.payoutNumber,
            description: `Staff Tip Payout - ${p.staffName} (${p.payoutNumber})`,
            cashIn: 0,
            cashOut: p.amount,
            runningBalance: 0,
            actorUserId: p.paidByUserId,
            actorName: p.paidByName,
            documentType: 'EXPENSE',
            documentId: p.id,
            rawEntity: p,
          });
        } else if (p.status === 'REVERSED') {
          rawTxList.push({
            id: `tx-rev-tip-${p.id}`,
            date: (p.reversedAt ? p.reversedAt.slice(0, 10) : p.payoutDate),
            time: (p.reversedAt && p.reversedAt.length > 11 ? p.reversedAt.slice(11, 16) : '02:00 PM'),
            type: 'EXPENSE_REVERSAL_REFUND',
            referenceNumber: p.payoutNumber,
            description: `Cash Refund from Tip Payout Reversal (${p.payoutNumber}) - ${p.staffName}`,
            cashIn: p.amount,
            cashOut: 0,
            runningBalance: 0,
            actorUserId: p.reversedByUserId || p.paidByUserId,
            actorName: p.reversedByName || p.paidByName,
            documentType: 'REVERSAL',
            documentId: p.id,
            rawEntity: p,
          });
        }
      }
    }

    // 6. Approved Settlement Handovers
    for (const s of store.settlements || []) {
      if (s.branchId !== targetBranchId) continue;
      if (params.drawerId && drawer && s.drawerId !== drawer.id && s.date !== drawer.date) continue;
      if (s.submittedByUserId === targetUserId && (s.status === 'APPROVED' || s.status === 'APPROVED_TRANSFERRED')) {
        const handover = roundCurrency(s.handoverAmount ?? s.amount ?? 0);
        if (handover > 0) {
          rawTxList.push({
            id: `tx-set-${s.id}`,
            date: s.date,
            time: s.time || '09:00 PM',
            type: 'HANDOVER_SETTLEMENT',
            referenceNumber: s.settlementNumber,
            description: `Settlement Handover to ${s.destinationVaultName || 'Vault'} (${s.settlementNumber})`,
            cashIn: 0,
            cashOut: handover,
            runningBalance: 0,
            actorUserId: s.submittedByUserId,
            actorName: s.submittedByName,
            documentType: 'SETTLEMENT',
            documentId: s.id,
            rawEntity: s,
          });
        }
      }
    }

    // 7. Audited Cash Variance Adjustments
    for (const cva of store.cashVarianceAdjustments || []) {
      if (cva.branchId !== targetBranchId) continue;
      const linkedSettlement = (store.settlements || []).find((s) => s.id === cva.settlementId);
      if (linkedSettlement && linkedSettlement.submittedByUserId === targetUserId) {
        if (cva.varianceAmount > 0) {
          rawTxList.push({
            id: `tx-cva-${cva.id}`,
            date: cva.date,
            time: cva.time || '09:15 PM',
            type: 'VARIANCE_ADJUSTMENT',
            referenceNumber: cva.adjustmentNumber,
            description: `Audited Cash Overage Accepted (${cva.settlementNumber})`,
            cashIn: cva.varianceAmount,
            cashOut: 0,
            runningBalance: 0,
            actorUserId: cva.approvedByUserId,
            actorName: cva.approvedByName,
            documentType: 'ADJUSTMENT',
            documentId: cva.id,
            rawEntity: cva,
          });
        } else if (cva.varianceAmount < 0) {
          rawTxList.push({
            id: `tx-cva-${cva.id}`,
            date: cva.date,
            time: cva.time || '09:15 PM',
            type: 'VARIANCE_ADJUSTMENT',
            referenceNumber: cva.adjustmentNumber,
            description: `Audited Cash Shortage Accepted (${cva.settlementNumber})`,
            cashIn: 0,
            cashOut: Math.abs(cva.varianceAmount),
            runningBalance: 0,
            actorUserId: cva.approvedByUserId,
            actorName: cva.approvedByName,
            documentType: 'ADJUSTMENT',
            documentId: cva.id,
            rawEntity: cva,
          });
        }
      }
    }

    // Sort chronologically
    rawTxList.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time !== b.time) return a.time.localeCompare(b.time);
      return a.id.localeCompare(b.id);
    });

    // Date filtering and carried forward balance calculation
    let openingBalanceCarriedForward = 0;
    const finalTransactions: CustodyTransaction[] = [];
    let running = 0;

    for (const tx of rawTxList) {
      if (params.startDate && tx.date < params.startDate) {
        openingBalanceCarriedForward = roundCurrency(openingBalanceCarriedForward + tx.cashIn - tx.cashOut);
      } else if (params.endDate && tx.date > params.endDate) {
        // Excluded from window
      } else {
        finalTransactions.push(tx);
      }
    }

    running = openingBalanceCarriedForward;
    for (const tx of finalTransactions) {
      running = roundCurrency(running + tx.cashIn - tx.cashOut);
      tx.runningBalance = running;
    }

    // Segregated Online Collections calculation (does not affect physical cash)
    let onlineCollectionsTotal = 0;
    const onlineMap = new Map<string, { paymentAccountId: string; paymentAccountName: string; amount: number; count: number }>();

    for (const inv of store.invoices) {
      if (inv.branchId !== targetBranchId) continue;
      if (params.startDate && inv.date < params.startDate) continue;
      if (params.endDate && inv.date > params.endDate) continue;

      for (const p of inv.payments || []) {
        if (p.method === 'ONLINE_ACCOUNT' && p.processedByUserId === targetUserId) {
          const pAmount = roundCurrency(p.amount || 0);
          onlineCollectionsTotal = roundCurrency(onlineCollectionsTotal + pAmount);
          const accId = p.paymentAccountId || 'unknown';
          const accName = p.paymentAccountName || 'Electronic / Bank Account';
          const existing = onlineMap.get(accId) || { paymentAccountId: accId, paymentAccountName: accName, amount: 0, count: 0 };
          existing.amount = roundCurrency(existing.amount + pAmount);
          existing.count += 1;
          onlineMap.set(accId, existing);
        }
      }
    }

    // Aggregations for summary cards
    let cashSalesTotal = 0;
    let previousDuesCollectedTotal = 0;
    let cashTipsTotal = 0;
    let floatReceivedTotal = 0;
    let cashExpensesPaidTotal = 0;
    let cashRefundsPaidTotal = 0;
    let cashReversalsRefundTotal = 0;
    let approvedHandoversTotal = 0;

    for (const tx of finalTransactions) {
      if (tx.type === 'POS_SALE') cashSalesTotal = roundCurrency(cashSalesTotal + tx.cashIn);
      if (tx.type === 'DUES_COLLECTION') previousDuesCollectedTotal = roundCurrency(previousDuesCollectedTotal + tx.cashIn);
      if (tx.type === 'TIP_RECEIVED') cashTipsTotal = roundCurrency(cashTipsTotal + tx.cashIn);
      if (tx.type === 'FLOAT_RECEIVED') floatReceivedTotal = roundCurrency(floatReceivedTotal + tx.cashIn);
      if (tx.type === 'EXPENSE_PAID') cashExpensesPaidTotal = roundCurrency(cashExpensesPaidTotal + tx.cashOut);
      if (tx.type === 'INVOICE_REFUND') cashRefundsPaidTotal = roundCurrency(cashRefundsPaidTotal + tx.cashOut);
      if (tx.type === 'EXPENSE_REVERSAL_REFUND') cashReversalsRefundTotal = roundCurrency(cashReversalsRefundTotal + tx.cashIn);
      if (tx.type === 'HANDOVER_SETTLEMENT') approvedHandoversTotal = roundCurrency(approvedHandoversTotal + tx.cashOut);
    }

    // Expected cash in custody
    const expectedCashInCustody = running;

    const summary: BalanceSheetSummary = {
      drawer,
      user: sanitizeUser(targetUser),
      branch,
      openingCash: params.startDate ? openingBalanceCarriedForward : (drawer?.openingCash || 0),
      cashSalesTotal,
      previousDuesCollectedTotal,
      cashTipsTotal,
      floatReceivedTotal,
      cashExpensesPaidTotal,
      cashRefundsPaidTotal,
      cashReversalsRefundTotal,
      approvedHandoversTotal,
      expectedCashInCustody,
      lastCountedCash: drawer?.actualInDrawer,
      lastCountedTimestamp: drawer?.settledAt || drawer?.closedAt,
      lastVariance: drawer?.variance,
      onlineCollectionsTotal,
      onlineCollectionsBreakdown: Array.from(onlineMap.values()),
    };

    return {
      summary,
      transactions: finalTransactions,
      openingBalanceCarriedForward,
    };
  }

  async getSettlements(
    branchId: string | 'ALL',
    filter?: {
      status?: string;
      submitterId?: string;
      drawerId?: string;
      startDate?: string;
      endDate?: string;
    },
    actor?: User
  ): Promise<Settlement[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot view account settlements.');
    }

    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      if (branchId !== 'ALL' && branchId !== authenticatedActor.branchId) {
        throw new Error('Access Denied: Cannot access settlements for another branch.');
      }
      targetBranchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    let list = (store.settlements || []).filter((s) => {
      if (targetBranchId !== 'ALL' && s.branchId !== targetBranchId) return false;
      // Accountant can ONLY view their own settlements
      if (authenticatedActor.role === 'ACCOUNTANT') {
        if (s.submittedByUserId !== authenticatedActor.id) return false;
      }
      return true;
    });

    if (filter) {
      if (filter.status) {
        list = list.filter((s) => s.status === filter.status);
      }
      if (filter.submitterId) {
        list = list.filter((s) => s.submittedByUserId === filter.submitterId);
      }
      if (filter.drawerId) {
        list = list.filter((s) => s.drawerId === filter.drawerId);
      }
      if (filter.startDate) {
        list = list.filter((s) => s.date >= filter.startDate!);
      }
      if (filter.endDate) {
        list = list.filter((s) => s.date <= filter.endDate!);
      }
    }

    return list.sort((a, b) => {
      const dateA = a.submittedAt || a.date;
      const dateB = b.submittedAt || b.date;
      return dateB.localeCompare(dateA);
    });
  }

  async getSettlement(id: string, actor?: User): Promise<Settlement | null> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot view account settlements.');
    }

    const store = mockStorage.getStore();
    const settlement = (store.settlements || []).find((s) => s.id === id);
    if (!settlement) return null;

    if (authenticatedActor.role === 'ADMIN' && settlement.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot access settlements for another branch.');
    }
    if (authenticatedActor.role === 'ACCOUNTANT' && settlement.submittedByUserId !== authenticatedActor.id) {
      throw new Error('Access Denied: Accountants can only view their own settlements.');
    }

    return { ...settlement };
  }

  async createSettlementDraft(input: CreateSettlementInput, actor?: User): Promise<Settlement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot create settlements.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      branchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const countedCash = roundCurrency(input.countedCash || 0);
    const handoverAmount = roundCurrency(input.handoverAmount || 0);
    const retainedFloat = roundCurrency(input.retainedFloat || 0);

    if (countedCash < 0 || handoverAmount < 0 || retainedFloat < 0) {
      throw new Error('All settlement amounts must be non-negative finite numbers.');
    }

    if (roundCurrency(handoverAmount + retainedFloat) !== countedCash) {
      throw new Error(
        `Handover amount (PKR ${handoverAmount.toLocaleString()}) + Retained float (PKR ${retainedFloat.toLocaleString()}) must equal counted cash (PKR ${countedCash.toLocaleString()}).`
      );
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const settlementNumber = this.generateNextSettlementNumber(clonedStore, branch, targetDate);

    const draftSettlement: Settlement = {
      id: `set-dft-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      settlementNumber,
      branchId,
      drawerId: input.drawerId,
      date: targetDate,
      time: timeStr,
      cutoffTime: now.toISOString(),
      countedCash,
      handoverAmount,
      retainedFloat,
      amount: handoverAmount,
      destinationVaultId: input.destinationVaultId || `vault-${branch.id}`,
      destinationVaultName: input.destinationVaultName || `${branch.name} Main Safe`,
      denominationBreakdown: input.denominationBreakdown,
      notes: input.notes?.trim() || 'Draft settlement record',
      submittedByUserId: authenticatedActor.id,
      submittedByName: authenticatedActor.name,
      submittedByRole: authenticatedActor.role,
      status: 'DRAFT',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    clonedStore.settlements = clonedStore.settlements || [];
    clonedStore.settlements.push(draftSettlement);
    mockStorage.saveStore(clonedStore);
    return draftSettlement;
  }

  async submitSettlement(input: CreateSettlementInput, actor?: User): Promise<Settlement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot submit account settlements.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      branchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const drawer = store.cashDrawers.find((d) => d.id === input.drawerId);
    if (!drawer) {
      throw new Error(`Cash drawer '${input.drawerId}' not found.`);
    }
    if (drawer.custodianUserId !== authenticatedActor.id && authenticatedActor.role !== 'SUPER_ADMIN') {
      throw new Error('Access Denied: You can only submit settlements for your own cash drawer.');
    }
    if (drawer.status === 'SETTLEMENT_PENDING') {
      throw new Error('This cash drawer is already locked pending settlement review. Overlapping submissions are prevented.');
    }
    if (drawer.status === 'SETTLED') {
      throw new Error('This cash drawer has already been settled and closed.');
    }

    // Check for overlapping submitted settlements for the same drawer
    const existingSubmitted = (store.settlements || []).find(
      (s) => s.drawerId === drawer.id && (s.status === 'SUBMITTED' || s.status === 'PENDING_VERIFICATION')
    );
    if (existingSubmitted) {
      throw new Error(`A pending settlement (${existingSubmitted.settlementNumber}) is already submitted for this drawer.`);
    }

    const countedCash = roundCurrency(input.countedCash);
    const handoverAmount = roundCurrency(input.handoverAmount);
    const retainedFloat = roundCurrency(input.retainedFloat);

    if (!Number.isFinite(countedCash) || countedCash < 0) {
      throw new Error('Counted cash must be a non-negative finite number.');
    }
    if (!Number.isFinite(handoverAmount) || handoverAmount < 0) {
      throw new Error('Handover amount must be a non-negative finite number.');
    }
    if (!Number.isFinite(retainedFloat) || retainedFloat < 0) {
      throw new Error('Retained float must be a non-negative finite number.');
    }

    if (roundCurrency(handoverAmount + retainedFloat) !== countedCash) {
      throw new Error(
        `Handover amount (PKR ${handoverAmount.toLocaleString()}) + Retained float (PKR ${retainedFloat.toLocaleString()}) must equal counted cash (PKR ${countedCash.toLocaleString()}).`
      );
    }

    // Derive canonical expected cash in custody for this drawer
    const statement = await this.getCashCustodyStatement(
      { branchId, userId: drawer.custodianUserId, drawerId: drawer.id },
      authenticatedActor
    );
    const expectedCash = statement.summary.expectedCashInCustody;
    const variance = roundCurrency(countedCash - expectedCash);

    if (Math.abs(variance) > 0.001) {
      if (!input.varianceExplanation || !input.varianceExplanation.trim()) {
        throw new Error(
          `A non-zero variance of PKR ${variance.toLocaleString()} requires an explanation before the settlement can be submitted.`
        );
      }
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Freeze snapshot and lock the drawer
    const targetDrawer = clonedStore.cashDrawers.find((d) => d.id === drawer.id)!;
    targetDrawer.status = 'SETTLEMENT_PENDING';
    targetDrawer.actualInDrawer = countedCash;
    targetDrawer.variance = variance;

    const settlementNumber = this.generateNextSettlementNumber(clonedStore, branch, targetDate);

    const submittedSettlement: Settlement = {
      id: `set-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      settlementNumber,
      branchId,
      drawerId: drawer.id,
      date: targetDate,
      time: timeStr,
      cutoffTime: now.toISOString(),
      expectedCash,
      countedCash,
      variance,
      varianceExplanation: input.varianceExplanation?.trim(),
      handoverAmount,
      retainedFloat,
      amount: handoverAmount,
      destinationVaultId: input.destinationVaultId || `vault-${branch.id}`,
      destinationVaultName: input.destinationVaultName || `${branch.name} Main Safe`,
      denominationBreakdown: input.denominationBreakdown,
      notes: input.notes?.trim() || `Settlement submitted by ${authenticatedActor.name}`,
      submittedByUserId: authenticatedActor.id,
      submittedByName: authenticatedActor.name,
      submittedByRole: authenticatedActor.role,
      submittedAt: now.toISOString(),
      status: 'SUBMITTED',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    clonedStore.settlements = clonedStore.settlements || [];
    clonedStore.settlements.push(submittedSettlement);
    mockStorage.saveStore(clonedStore);

    return submittedSettlement;
  }

  async rejectSettlement(id: string, reason: string, actor?: User): Promise<Settlement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Super Admin and Branch Admin can review and reject settlements.');
    }
    if (!reason || !reason.trim()) {
      throw new Error('A rejection reason is required to reject a settlement.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const settlement = (clonedStore.settlements || []).find((s) => s.id === id);
    if (!settlement) {
      throw new Error(`Settlement '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && settlement.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot reject settlements from another branch.');
    }

    if (settlement.submittedByUserId === authenticatedActor.id) {
      throw new Error('Access Denied: You cannot review or reject your own settlement. An independent administrator must review.');
    }

    if (settlement.status !== 'SUBMITTED' && settlement.status !== 'PENDING_VERIFICATION') {
      throw new Error(`Cannot reject settlement with status '${settlement.status}'. Only SUBMITTED settlements can be reviewed.`);
    }

    const now = new Date();
    settlement.status = 'REJECTED';
    settlement.rejectionReason = reason.trim();
    settlement.receivedByUserId = authenticatedActor.id;
    settlement.receivedByName = authenticatedActor.name;
    settlement.reviewedAt = now.toISOString();
    settlement.updatedAt = now.toISOString();

    // Unlock the drawer back to OPEN so the custodian can recount and correct
    if (settlement.drawerId) {
      const drawer = clonedStore.cashDrawers.find((d) => d.id === settlement.drawerId);
      if (drawer && drawer.status === 'SETTLEMENT_PENDING') {
        drawer.status = 'OPEN';
      }
    }

    // Move no funds
    mockStorage.saveStore(clonedStore);
    return settlement;
  }

  async approveSettlement(
    id: string,
    input: ApproveSettlementInput,
    actor?: User
  ): Promise<{
    settlement: Settlement;
    successorDrawer?: CashDrawer;
    varianceAdjustment?: CashVarianceAdjustment;
  }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only Super Admin and Branch Admin can approve settlements and receive cash handovers.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const settlement = (clonedStore.settlements || []).find((s) => s.id === id);
    if (!settlement) {
      throw new Error(`Settlement '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && settlement.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot approve settlements from another branch.');
    }

    // Strict Anti-Self-Approval: Reviewer must be different from drawer owner and submitter
    const sourceDrawer = clonedStore.cashDrawers.find((d) => d.id === settlement.drawerId);
    if (settlement.submittedByUserId === authenticatedActor.id || (sourceDrawer && sourceDrawer.custodianUserId === authenticatedActor.id)) {
      throw new Error('Access Denied: You cannot approve your own settlement or a settlement for your owned cash drawer. An independent administrator must review and approve.');
    }

    if (settlement.status !== 'SUBMITTED' && settlement.status !== 'PENDING_VERIFICATION') {
      throw new Error(`Cannot approve settlement with status '${settlement.status}'. Only SUBMITTED settlements can be approved.`);
    }

    const branch = clonedStore.branches.find((b) => b.id === settlement.branchId);
    if (!branch) {
      throw new Error(`Branch '${settlement.branchId}' not found.`);
    }

    const handoverAmount = roundCurrency(settlement.handoverAmount ?? settlement.amount ?? 0);
    const retainedFloat = roundCurrency(settlement.retainedFloat ?? 0);

    // If manager entered actual received cash and it differs from handover amount, reject for correction
    if (input.actualCashReceived !== undefined && Number.isFinite(input.actualCashReceived)) {
      const receivedAmount = roundCurrency(input.actualCashReceived);
      if (receivedAmount !== handoverAmount) {
        throw new Error(
          `Count disputed: Actual cash received (PKR ${receivedAmount.toLocaleString()}) does not match submitted handover amount (PKR ${handoverAmount.toLocaleString()}). Disputed settlements must be rejected with a reason so the custodian can recount and resubmit instead of silently altering figures.`
        );
      }
    }

    // Non-zero variance requires explicit manager acceptance
    const variance = roundCurrency(settlement.variance || 0);
    let varianceAdjustment: CashVarianceAdjustment | undefined;

    if (Math.abs(variance) > 0.001) {
      if (!input.acceptVariance) {
        throw new Error(
          `Explicit manager acceptance is required to approve a settlement with a cash variance of PKR ${variance.toLocaleString()}. Please verify and confirm variance acceptance.`
        );
      }

      const targetDate = mockStorage.getSystemDate();
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const cvaNumber = this.generateNextVarianceAdjustmentNumber(clonedStore, branch, targetDate);

      varianceAdjustment = {
        id: `cva-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        adjustmentNumber: cvaNumber,
        settlementId: settlement.id,
        settlementNumber: settlement.settlementNumber,
        branchId: settlement.branchId,
        date: targetDate,
        time: timeStr,
        varianceAmount: variance,
        explanation: settlement.varianceExplanation || 'Audited cash variance accepted upon settlement review',
        approvedByUserId: authenticatedActor.id,
        approvedByName: authenticatedActor.name,
        createdAt: now.toISOString(),
      };

      clonedStore.cashVarianceAdjustments = clonedStore.cashVarianceAdjustments || [];
      clonedStore.cashVarianceAdjustments.push(varianceAdjustment);
      settlement.varianceAdjustmentRecordId = varianceAdjustment.id;
    }

    const now = new Date();
    const targetDate = mockStorage.getSystemDate();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Debit source drawer and credit destination vault atomically
    clonedStore.vaultBalances = clonedStore.vaultBalances || {};
    clonedStore.vaultBalances[branch.id] = roundCurrency((clonedStore.vaultBalances[branch.id] || 0) + handoverAmount);

    const yearStr = targetDate.slice(0, 4);
    const countTransfers = (clonedStore.cashTransfers || []).length + 1;
    const transferNumber = nextReference(clonedStore, 'CXF');

    const handoverTransferRecord: CashTransferRecord = {
      id: `cxf-hnd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      transferNumber,
      branchId: branch.id,
      date: targetDate,
      time: timeStr,
      amount: handoverAmount,
      fromSource: 'SETTLEMENT_HANDOVER',
      toSource: 'BRANCH_VAULT',
      toCustodianUserId: authenticatedActor.id,
      toCustodianName: authenticatedActor.name,
      transferredByUserId: settlement.submittedByUserId,
      transferredByName: settlement.submittedByName,
      notes: `Settlement handover received into ${input.destinationVaultName || settlement.destinationVaultName || branch.name + ' Vault'}`,
    };
    clonedStore.cashTransfers = clonedStore.cashTransfers || [];
    clonedStore.cashTransfers.push(handoverTransferRecord);

    // Close settled drawer
    const drawer = clonedStore.cashDrawers.find((d) => d.id === settlement.drawerId);
    if (drawer) {
      drawer.status = 'SETTLED';
      drawer.closedAt = now.toISOString();
      drawer.settledAt = now.toISOString();
    }

    // Successor Drawer: if retained float > 0, carry into explicit successor drawer
    let successorDrawer: CashDrawer | undefined;
    if (retainedFloat > 0) {
      const successorId = `drawer-succ-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      successorDrawer = {
        id: successorId,
        branchId: settlement.branchId,
        date: targetDate,
        openingCash: retainedFloat,
        cashSales: 0.0,
        cashTipsCollected: 0.0,
        cashExpensesPaid: 0.0,
        expectedInDrawer: retainedFloat,
        actualInDrawer: retainedFloat,
        variance: 0.0,
        custodianUserId: settlement.submittedByUserId,
        custodianName: settlement.submittedByName,
        status: 'OPEN',
      };
      clonedStore.cashDrawers.push(successorDrawer);

      if (drawer) {
        drawer.successorDrawerId = successorId;
      }
      settlement.successorDrawerId = successorId;

      const succTransferNumber = nextReference(clonedStore, 'CXF');
      const succTransfer: CashTransferRecord = {
        id: `cxf-succ-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        transferNumber: succTransferNumber,
        branchId: branch.id,
        date: targetDate,
        time: timeStr,
        amount: retainedFloat,
        fromSource: 'DRAWER_RETAINED_FLOAT',
        toDrawerId: successorId,
        toCustodianUserId: settlement.submittedByUserId,
        toCustodianName: settlement.submittedByName,
        transferredByUserId: authenticatedActor.id,
        transferredByName: authenticatedActor.name,
        notes: `Retained float carry-forward from settled drawer ${settlement.drawerId}`,
      };
      clonedStore.cashTransfers.push(succTransfer);
    }

    settlement.status = 'APPROVED';
    settlement.receivedByUserId = authenticatedActor.id;
    settlement.receivedByName = authenticatedActor.name;
    settlement.reviewedAt = now.toISOString();
    settlement.updatedAt = now.toISOString();
    if (input.notes) {
      settlement.notes = `${settlement.notes ? settlement.notes + ' | ' : ''}Review notes: ${input.notes.trim()}`;
    }

    mockStorage.saveStore(clonedStore);

    return {
      settlement,
      successorDrawer,
      varianceAdjustment,
    };
  }

  // --- PHASE 3D: ATTENDANCE, LEAVES, HOLIDAYS & MANUAL OVERTIME ---

  private generateNextLeaveNumber(clonedStore: StorageSchema, branch: Branch, targetDate: string): string { return nextReference(clonedStore, 'LV'); }

  private generateNextOvertimeNumber(clonedStore: StorageSchema, branch: Branch, targetDate: string): string { return nextReference(clonedStore, 'OT'); }

  async createAttendance(input: CreateAttendanceInput, actor?: User): Promise<AttendanceRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can record attendance.');
    }
    if (authenticatedActor.role === 'ADMIN' && input.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot record attendance for another branch.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const staff = clonedStore.staff.find((s) => s.id === input.staffId);
    if (!staff || !staff.isActive) {
      throw new Error(`Staff member '${input.staffId}' is inactive or not found.`);
    }
    if (staff.branchId !== input.branchId) {
      throw new Error(`Staff member '${staff.name}' does not belong to branch '${input.branchId}'.`);
    }

    // Check duplicate daily record
    const existing = (clonedStore.attendance || []).find(
      (a) => a.staffId === input.staffId && a.date === input.date
    );
    if (existing) {
      throw new Error(`An attendance record for ${staff.name} on ${input.date} already exists. Use edit/correction to update existing punches.`);
    }

    // Check conflicting leave
    const conflictingLeave = (clonedStore.leaves || []).find(
      (l) => l.staffId === input.staffId && l.status === 'APPROVED' && input.date >= l.startDate && input.date <= l.endDate
    );
    if (conflictingLeave) {
      throw new Error(`Cannot record attendance: ${staff.name} is on approved leave (${conflictingLeave.leaveNumber}) on ${input.date}.`);
    }

    const isOvernight = input.isOvernightShift ?? staff.isOvernightShift ?? false;
    const inMin = parseTimeToMinutes(input.checkIn);
    if (input.checkOut) {
      const outMin = parseTimeToMinutes(input.checkOut);
      const isMidnightCrossing = inMin >= 11 * 60 && outMin <= 7 * 60;
      if (!isOvernight && !isMidnightCrossing && outMin < inMin) {
        throw new Error('Check-out time cannot be earlier than check-in time unless marked as an overnight shift.');
      }
    }

    const { isLate, lateMinutes } = evaluateLateness(input.checkIn, staff.startTime, staff.lateGraceMinutes);
    let isEarlyExit = false;
    let earlyExitMinutes = 0;
    if (input.checkOut) {
      const earlyRes = evaluateEarlyExit(input.checkOut, staff.endTime, staff.earlyGraceMinutes, isOvernight);
      isEarlyExit = earlyRes.isEarlyExit;
      earlyExitMinutes = earlyRes.earlyExitMinutes;
    }

    const workedHours = input.checkOut ? calculateWorkedHours(input.checkIn, input.checkOut, isOvernight) : 0;
    const scheduledHours = calculateScheduledHours(staff.startTime, staff.endTime, isOvernight);

    let status: AttendanceStatus = 'PRESENT';
    if (!input.checkOut) {
      status = 'MISSING_PUNCH';
    }

    const deductionSnapshot = calculateDeductionSnapshot(staff, isLate, lateMinutes, isEarlyExit, earlyExitMinutes);

    const punches: AttendancePunch[] = [
      {
        id: `pnch-in-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type: 'CHECK_IN' as const,
        timestamp: input.checkIn,
        source: input.source || ('MANUAL' as const),
      },
    ];
    if (input.checkOut) {
      punches.push({
        id: `pnch-out-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type: 'CHECK_OUT' as const,
        timestamp: input.checkOut,
        source: input.source || ('MANUAL' as const),
      });
    }

    const newRecord: AttendanceRecord = {
      id: `att-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      staffId: staff.id,
      staffName: staff.name,
      employeeCode: staff.employeeCode,
      designation: staff.designation || staff.roleTitle,
      branchId: input.branchId,
      date: input.date,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      scheduledHours,
      workedHours,
      status,
      isLate,
      lateMinutes,
      isEarlyExit,
      earlyExitMinutes,
      isMissingPunch: !input.checkOut,
      source: input.source || 'MANUAL',
      punches,
      calculationSnapshot: deductionSnapshot,
      notes: input.notes,
      isOvernightShift: isOvernight,
      scheduledShift: `${formatMinutesToTime(parseTimeToMinutes(staff.startTime))} - ${formatMinutesToTime(parseTimeToMinutes(staff.endTime))}`,
    };

    clonedStore.attendance = clonedStore.attendance || [];
    clonedStore.attendance.push(newRecord);
    mockStorage.saveStore(clonedStore);

    return newRecord;
  }

  async correctAttendance(id: string, input: CorrectAttendanceInput, actor?: User): Promise<AttendanceRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can correct attendance.');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new Error('A correction reason is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const record = (clonedStore.attendance || []).find((a) => a.id === id);
    if (!record) {
      throw new Error(`Attendance record '${id}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && record.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot correct attendance for another branch.');
    }

    const staff = clonedStore.staff.find((s) => s.id === record.staffId);
    if (!staff) {
      throw new Error(`Staff member '${record.staffId}' not found.`);
    }

    const isOvernight = record.isOvernightShift ?? staff.isOvernightShift ?? false;
    const inMin = parseTimeToMinutes(input.checkIn);
    if (input.checkOut) {
      const outMin = parseTimeToMinutes(input.checkOut);
      const isMidnightCrossing = inMin >= 11 * 60 && outMin <= 7 * 60;
      if (!isOvernight && !isMidnightCrossing && outMin < inMin) {
        throw new Error('Check-out time cannot be earlier than check-in time unless marked as an overnight shift.');
      }
    }

    const beforeSnapshot = {
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      status: record.status,
      workedHours: record.workedHours,
      isLate: record.isLate,
      lateMinutes: record.lateMinutes,
      isEarlyExit: record.isEarlyExit,
      earlyExitMinutes: record.earlyExitMinutes,
    };

    const { isLate, lateMinutes } = evaluateLateness(input.checkIn, staff.startTime, staff.lateGraceMinutes);
    let isEarlyExit = false;
    let earlyExitMinutes = 0;
    if (input.checkOut) {
      const earlyRes = evaluateEarlyExit(input.checkOut, staff.endTime, staff.earlyGraceMinutes, isOvernight);
      isEarlyExit = earlyRes.isEarlyExit;
      earlyExitMinutes = earlyRes.earlyExitMinutes;
    }

    const workedHours = input.checkOut ? calculateWorkedHours(input.checkIn, input.checkOut, isOvernight) : 0;
    const deductionSnapshot = calculateDeductionSnapshot(staff, isLate, lateMinutes, isEarlyExit, earlyExitMinutes);

    record.checkIn = input.checkIn;
    record.checkOut = input.checkOut;
    record.workedHours = workedHours;
    record.isLate = isLate;
    record.lateMinutes = lateMinutes;
    record.isEarlyExit = isEarlyExit;
    record.earlyExitMinutes = earlyExitMinutes;
    record.isMissingPunch = !input.checkOut;
    record.status = input.status || (input.checkOut ? 'PRESENT' : 'MISSING_PUNCH');
    record.calculationSnapshot = deductionSnapshot;
    if (input.notes) record.notes = input.notes;

    const afterSnapshot = {
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      status: record.status,
      workedHours: record.workedHours,
      isLate: record.isLate,
      lateMinutes: record.lateMinutes,
      isEarlyExit: record.isEarlyExit,
      earlyExitMinutes: record.earlyExitMinutes,
    };

    record.correctionHistory = record.correctionHistory || [];
    record.correctionHistory.push({
      id: `corr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      editedAt: new Date().toISOString(),
      editedByUserId: authenticatedActor.id,
      editedByName: authenticatedActor.name,
      reason: input.reason.trim(),
      beforeSnapshot,
      afterSnapshot,
    });

    mockStorage.saveStore(clonedStore);
    return record;
  }

  async markLeave(input: CreateLeaveInput, actor?: User): Promise<LeaveRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can mark staff leaves.');
    }
    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const staff = clonedStore.staff.find((s) => s.id === input.staffId);
    if (!staff || !staff.isActive) {
      throw new Error(`Staff member '${input.staffId}' is inactive or not found.`);
    }

    const branchId = input.branchId || staff.branchId || authenticatedActor.branchId;
    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot mark leave for another branch.');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new Error('A leave reason is required.');
    }
    if (input.startDate > input.endDate) {
      throw new Error('Leave start date must be on or before end date.');
    }

    const branch = clonedStore.branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch '${branchId}' not found.`);

    // Check overlapping leave
    const existingLeave = (clonedStore.leaves || []).find((l) => {
      if (l.staffId !== input.staffId || l.status === 'CANCELLED') return false;
      return input.startDate <= l.endDate && input.endDate >= l.startDate;
    });
    if (existingLeave) {
      throw new Error(`Conflicting leave (${existingLeave.leaveNumber}) already exists for ${staff.name} between ${existingLeave.startDate} and ${existingLeave.endDate}.`);
    }

    // Calculate working days in range
    const startObj = new Date(input.startDate + 'T00:00:00Z');
    const endObj = new Date(input.endDate + 'T00:00:00Z');
    let workingDaysCount = 0;
    const leaveDates: string[] = [];

    for (let d = new Date(startObj); d <= endObj; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const check = isWorkingDay(dateStr, staff, clonedStore.branchHolidays);
      if (check.isWorking) {
        workingDaysCount++;
        leaveDates.push(dateStr);
      }
    }

    if (workingDaysCount === 0) {
      throw new Error('Selected date range does not contain any scheduled working days.');
    }

    // Check paid leave allowance
    if (input.type === 'PAID') {
      const periods = new Map<string, string[]>();
      for (const date of leaveDates) {
        const key = staff.leaveAllowancePeriod === 'YEARLY' ? date.slice(0, 4) : date.slice(0, 7);
        const bucket = periods.get(key) || [];
        bucket.push(date);
        periods.set(key, bucket);
      }
      for (const [period, dates] of periods) {
        const allowance = evaluateLeaveAllowance(staff, clonedStore.leaves || [], dates[0], clonedStore.branchHolidays);
        if (!allowance.isConfigured) throw new Error(`Cannot mark paid leave: Paid leave allowance is not configured for ${staff.name}. Use unpaid leave or configure allowance first.`);
        if (dates.length > allowance.remainingDays) throw new Error(`Cannot mark paid leave: ${staff.name} only has ${allowance.remainingDays} paid leave day(s) remaining for ${period} (requested: ${dates.length} days).`);
      }
    }

    const leaveNumber = this.generateNextLeaveNumber(clonedStore, branch, input.startDate);
    const newLeave: LeaveRecord = {
      id: `lv-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      leaveNumber,
      branchId,
      staffId: staff.id,
      staffName: staff.name,
      employeeCode: staff.employeeCode,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays: workingDaysCount,
      type: input.type,
      reason: input.reason.trim(),
      status: 'APPROVED',
      createdByUserId: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: new Date().toISOString(),
    };

    clonedStore.leaves = clonedStore.leaves || [];
    clonedStore.leaves.push(newLeave);

    // Auto-create/update attendance records for each working leave date
    clonedStore.attendance = clonedStore.attendance || [];
    for (const lDate of leaveDates) {
      const existingAttIndex = clonedStore.attendance.findIndex((a) => a.staffId === staff.id && a.date === lDate);
      const leaveStatus: AttendanceStatus = input.type === 'PAID' ? 'PAID_LEAVE' : 'UNPAID_LEAVE';
      if (existingAttIndex >= 0) {
        clonedStore.attendance[existingAttIndex].status = leaveStatus;
        clonedStore.attendance[existingAttIndex].notes = `Leave voucher: ${leaveNumber} - ${input.reason.trim()}`;
        clonedStore.attendance[existingAttIndex].workedHours = 0;
      } else {
        clonedStore.attendance.push({
          id: `att-lv-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          staffId: staff.id,
          staffName: staff.name,
          employeeCode: staff.employeeCode,
          designation: staff.designation || staff.roleTitle,
          branchId: input.branchId,
          date: lDate,
          checkIn: 'LEAVE',
          checkOut: 'LEAVE',
          scheduledHours: calculateScheduledHours(staff.startTime, staff.endTime),
          workedHours: 0,
          status: leaveStatus,
          source: 'MANUAL',
          notes: `Leave voucher: ${leaveNumber} - ${input.reason.trim()}`,
        });
      }
    }

    mockStorage.saveStore(clonedStore);
    return newLeave;
  }

  async cancelLeave(id: string, reason: string, actor?: User): Promise<LeaveRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can cancel leaves.');
    }
    if (!reason || !reason.trim()) {
      throw new Error('A cancellation reason is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const leave = (clonedStore.leaves || []).find((l) => l.id === id);
    if (!leave) throw new Error(`Leave record '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && leave.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot cancel leave from another branch.');
    }
    if (leave.status === 'CANCELLED') {
      throw new Error(`Leave '${leave.leaveNumber}' is already cancelled.`);
    }

    leave.status = 'CANCELLED';
    leave.cancelledAt = new Date().toISOString();
    leave.cancelledByUserId = authenticatedActor.id;
    leave.cancelledByName = authenticatedActor.name;
    leave.cancellationReason = reason.trim();

    // Clean up corresponding leave attendance records
    clonedStore.attendance = (clonedStore.attendance || []).filter(
      (a) => !(a.staffId === leave.staffId && a.date >= leave.startDate && a.date <= leave.endDate && (a.status === 'PAID_LEAVE' || a.status === 'UNPAID_LEAVE'))
    );

    mockStorage.saveStore(clonedStore);
    return leave;
  }

  async getLeaveAllowances(branchId: string | 'ALL', date: string, actor?: User): Promise<Record<string, any>> {
    const clonedStore: any = JSON.parse(JSON.stringify(mockStorage.getStore()));
    const staffList = (clonedStore.staff || []).filter((s: any) => branchId === 'ALL' || s.branchId === branchId);
    const leaves = clonedStore.leaves || [];
    const holidays = clonedStore.holidays || [];
    const res: Record<string, any> = {};
    for (const staff of staffList) {
      const staffLeaves = leaves.filter((l: any) => l.staffId === staff.id);
      res[staff.id] = evaluateLeaveAllowance(staff, staffLeaves, date, holidays);
    }
    return res;
  }

  async getLeaves(branchId: string | 'ALL', staffId?: string, actor?: User): Promise<LeaveRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants do not have permission to view staff leaves.');
    }
    if (authenticatedActor.role === 'STAFF') {
      const store = mockStorage.getStore();
      const staffMember = store.staff.find(
        (s) => s.linkedUserId === authenticatedActor.id || s.linkedUserEmail === authenticatedActor.email || s.id === authenticatedActor.id
      );
      if (!staffMember || (staffId && staffId !== staffMember.id)) {
        throw new Error('Access Denied: Staff members can only view their own leave records.');
      }
      staffId = staffMember.id;
    }
    if (authenticatedActor.role === 'ADMIN' && branchId !== 'ALL' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot view leaves from another branch.');
    }

    const store = mockStorage.getStore();
    const targetBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;

    let list = targetBranchId === 'ALL'
      ? [...(store.leaves || [])]
      : (store.leaves || []).filter((l) => l.branchId === targetBranchId);

    if (staffId) {
      list = list.filter((l) => l.staffId === staffId);
    }

    return list.sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async saveDailyAttendance(input: {
    branchId: string;
    date: string;
    records: Array<{
      staffId: string;
      status: string;
      checkIn?: string;
      checkOut?: string;
      notes?: string;
    }>;
  }, _actor?: User): Promise<{ savedCount: number }> {
    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.attendance = clonedStore.attendance || [];

    for (const item of input.records) {
      const staff = clonedStore.staff.find((s) => s.id === item.staffId);
      if (!staff) continue;

      const isOvernight = staff.isOvernightShift ?? false;
      const status = item.status as AttendanceStatus;
      let checkIn = item.checkIn?.trim() || '';
      let checkOut = item.checkOut?.trim() || '';
      let isLate = false;
      let lateMinutes = 0;
      let isEarlyExit = false;
      let earlyExitMinutes = 0;
      let workedHours = 0;

      if (status === 'PRESENT' || status === 'HALF_DAY') {
        if (checkIn) {
          const lateRes = evaluateLateness(checkIn, staff.startTime, staff.lateGraceMinutes);
          isLate = lateRes.isLate;
          lateMinutes = lateRes.lateMinutes;
        }
        if (checkOut) {
          const earlyRes = evaluateEarlyExit(checkOut, staff.endTime, staff.earlyGraceMinutes, isOvernight);
          isEarlyExit = earlyRes.isEarlyExit;
          earlyExitMinutes = earlyRes.earlyExitMinutes;
        }
        if (checkIn && checkOut) {
          workedHours = calculateWorkedHours(checkIn, checkOut, isOvernight);
        }
      } else {
        checkIn = status;
        checkOut = status;
      }

      const existingIdx = clonedStore.attendance.findIndex(
        (a) => a.staffId === staff.id && a.date === input.date
      );

      const record: AttendanceRecord = {
        id: existingIdx >= 0 ? clonedStore.attendance[existingIdx].id : `att-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        staffId: staff.id,
        staffName: staff.name,
        employeeCode: staff.employeeCode,
        designation: staff.designation || staff.roleTitle,
        branchId: input.branchId,
        date: input.date,
        checkIn,
        checkOut: checkOut || undefined,
        scheduledHours: calculateScheduledHours(staff.startTime, staff.endTime, isOvernight),
        workedHours,
        status,
        isLate,
        lateMinutes,
        isEarlyExit,
        earlyExitMinutes,
        isMissingPunch: !checkIn || !checkOut,
        source: 'MANUAL',
        notes: item.notes,
      };

      if (existingIdx >= 0) {
        clonedStore.attendance[existingIdx] = record;
      } else {
        clonedStore.attendance.push(record);
      }
    }

    mockStorage.saveStore(clonedStore);
    return { savedCount: input.records.length };
  }

  async finalizeDayAttendance(branchId: string, date: string, actor?: User): Promise<{ finalizedCount: number; markedAbsentStaffNames: string[] }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can finalize attendance.');
    }
    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot finalize attendance for another branch.');
    }

    const systemDate = mockStorage.getSystemDate();
    if (date > systemDate) {
      throw new Error('Cannot finalize attendance for a future date. Wait until the workday is completed.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const activeStaff = clonedStore.staff.filter((s) => s.branchId === branchId && s.isActive);
    clonedStore.attendance = clonedStore.attendance || [];

    const markedAbsentStaffNames: string[] = [];
    let finalizedCount = 0;

    for (const staff of activeStaff) {
      // Check if working day
      const check = isWorkingDay(date, staff, clonedStore.branchHolidays);
      if (!check.isWorking) continue;

      const record = clonedStore.attendance.find((a) => a.staffId === staff.id && a.date === date);
      if (!record) {
        // Missing record on completed workday -> Mark ABSENT
        clonedStore.attendance.push({
          id: `att-abs-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          staffId: staff.id,
          staffName: staff.name,
          employeeCode: staff.employeeCode,
          designation: staff.designation || staff.roleTitle,
          branchId,
          date,
          checkIn: 'ABSENT',
          checkOut: 'ABSENT',
          scheduledHours: calculateScheduledHours(staff.startTime, staff.endTime),
          workedHours: 0,
          status: 'ABSENT',
          source: 'MANUAL',
          notes: 'Marked absent upon end-of-day finalization.',
          isFinalized: true,
        });
        markedAbsentStaffNames.push(staff.name);
        finalizedCount++;
      } else {
        // Existing record: if missing checkOut, mark missing punch
        if (!record.checkOut && record.status === 'PRESENT') {
          record.status = 'MISSING_PUNCH';
          record.isMissingPunch = true;
        }
        record.isFinalized = true;
        finalizedCount++;
      }
    }

    mockStorage.saveStore(clonedStore);
    return { finalizedCount, markedAbsentStaffNames };
  }

  async importAttendanceCSV(branchId: string, rows: CSVAttendanceImportRow[], actor?: User): Promise<CSVAttendanceImportResult> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can import attendance.');
    }
    if (authenticatedActor.role === 'ADMIN' && branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot import attendance for another branch.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.attendance = clonedStore.attendance || [];

    let acceptedRows = 0;
    let duplicateRows = 0;
    let rejectedRows = 0;
    const details: CSVAttendanceImportRow[] = [];

    for (const row of rows) {
      const staff = clonedStore.staff.find(
        (s) => s.branchId === branchId && s.employeeCode.toUpperCase() === (row.employeeCode || '').trim().toUpperCase()
      );

      if (!staff) {
        rejectedRows++;
        details.push({
          ...row,
          status: 'INVALID',
          rejectionReason: `Employee code '${row.employeeCode}' not found in active branch.`,
        });
        continue;
      }

      // Check duplicate
      const duplicate = clonedStore.attendance.find((a) => a.staffId === staff.id && a.date === row.date);
      if (duplicate) {
        duplicateRows++;
        details.push({
          ...row,
          status: 'DUPLICATE',
          matchedStaffId: staff.id,
          matchedStaffName: staff.name,
          rejectionReason: `Attendance record for ${staff.name} on ${row.date} already exists.`,
        });
        continue;
      }

      const isOvernight = staff.isOvernightShift || false;
      const inMin = parseTimeToMinutes(row.checkIn);
      if (row.checkOut) {
        const outMin = parseTimeToMinutes(row.checkOut);
        if (!isOvernight && outMin < inMin) {
          rejectedRows++;
          details.push({
            ...row,
            status: 'INVALID',
            matchedStaffId: staff.id,
            matchedStaffName: staff.name,
            rejectionReason: `Check-out (${row.checkOut}) earlier than check-in (${row.checkIn}) on normal shift.`,
          });
          continue;
        }
      }

      const { isLate, lateMinutes } = evaluateLateness(row.checkIn, staff.startTime, staff.lateGraceMinutes);
      let isEarlyExit = false;
      let earlyExitMinutes = 0;
      if (row.checkOut) {
        const earlyRes = evaluateEarlyExit(row.checkOut, staff.endTime, staff.earlyGraceMinutes, isOvernight);
        isEarlyExit = earlyRes.isEarlyExit;
        earlyExitMinutes = earlyRes.earlyExitMinutes;
      }

      const workedHours = row.checkOut ? calculateWorkedHours(row.checkIn, row.checkOut, isOvernight) : 0;
      const scheduledHours = calculateScheduledHours(staff.startTime, staff.endTime, isOvernight);
      const deductionSnapshot = calculateDeductionSnapshot(staff, isLate, lateMinutes, isEarlyExit, earlyExitMinutes);

      const punches: AttendancePunch[] = [
        {
          id: `pnch-imp-in-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'CHECK_IN' as const,
          timestamp: row.checkIn,
          source: 'IMPORT' as const,
          deviceId: row.deviceId,
        },
      ];
      if (row.checkOut) {
        punches.push({
          id: `pnch-imp-out-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'CHECK_OUT' as const,
          timestamp: row.checkOut,
          source: 'IMPORT' as const,
          deviceId: row.deviceId,
        });
      }

      clonedStore.attendance.push({
        id: `att-imp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        staffId: staff.id,
        staffName: staff.name,
        employeeCode: staff.employeeCode,
        designation: staff.designation || staff.roleTitle,
        branchId,
        date: row.date,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        scheduledHours,
        workedHours,
        status: row.checkOut ? 'PRESENT' : 'MISSING_PUNCH',
        isLate,
        lateMinutes,
        isEarlyExit,
        earlyExitMinutes,
        isMissingPunch: !row.checkOut,
        source: 'IMPORT',
        rawEventRef: row.deviceId ? `DEV:${row.deviceId}|ROW:${row.rowNumber}` : undefined,
        punches,
        calculationSnapshot: deductionSnapshot,
        scheduledShift: `${formatMinutesToTime(parseTimeToMinutes(staff.startTime))} - ${formatMinutesToTime(parseTimeToMinutes(staff.endTime))}`,
      });

      acceptedRows++;
      details.push({
        ...row,
        status: 'VALID',
        matchedStaffId: staff.id,
        matchedStaffName: staff.name,
      });
    }

    mockStorage.saveStore(clonedStore);
    return {
      totalRows: rows.length,
      acceptedRows,
      duplicateRows,
      rejectedRows,
      details,
    };
  }

  async getBranchHolidays(branchId: string | 'ALL'): Promise<BranchHoliday[]> {
    const store = mockStorage.getStore();
    const holidays = store.branchHolidays || [];
    if (branchId === 'ALL') return [...holidays];
    return holidays.filter((h) => h.branchId === 'ALL' || h.branchId === branchId);
  }

  async addBranchHoliday(holiday: Omit<BranchHoliday, 'id'>, actor?: User): Promise<BranchHoliday> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can configure holidays.');
    }
    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const newHoliday: BranchHoliday = {
      ...holiday,
      id: `hol-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    };
    clonedStore.branchHolidays = clonedStore.branchHolidays || [];
    clonedStore.branchHolidays.push(newHoliday);
    mockStorage.saveStore(clonedStore);
    return newHoliday;
  }

  async createOvertime(input: CreateOvertimeInput, actor?: User): Promise<OvertimeRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can create manual overtime.');
    }
    if (authenticatedActor.role === 'ADMIN' && input.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot enter overtime for another branch.');
    }
    if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
      throw new Error('Overtime minutes must be a positive whole number.');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new Error('A reason for manual overtime is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const branch = clonedStore.branches.find((b) => b.id === input.branchId);
    if (!branch) throw new Error(`Branch '${input.branchId}' not found.`);

    const staff = clonedStore.staff.find((s) => s.id === input.staffId);
    if (!staff || !staff.isActive) {
      throw new Error(`Staff member '${input.staffId}' is inactive or not found.`);
    }

    // Check duplicate
    const existing = (clonedStore.overtime || []).find(
      (ot) => ot.staffId === input.staffId && ot.date === input.date && ot.status !== 'CANCELLED' && ot.status !== 'REJECTED'
    );
    if (existing && !input.notes?.includes('INTENTIONAL_ADDITIONAL')) {
      throw new Error(`An active overtime record already exists for ${staff.name} on ${input.date}. Please edit the existing record or specify notes for intentional additional overtime.`);
    }

    const hourlyRate = staff.overtimeHourlyRate ?? 0;
    const initialStatus: OvertimeStatus = input.status || 'DRAFT';
    const approvedMinutes = 0;
    const amount = roundCurrency((input.minutes / 60) * hourlyRate);
    const overtimeNumber = this.generateNextOvertimeNumber(clonedStore, branch, input.date);

    const record: OvertimeRecord = {
      id: `ot-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      overtimeNumber,
      staffId: staff.id,
      staffName: staff.name,
      employeeCode: staff.employeeCode,
      branchId: input.branchId,
      date: input.date,
      minutes: input.minutes,
      approvedMinutes,
      hourlyRate,
      amount,
      reason: input.reason.trim(),
      notes: input.notes,
      status: initialStatus,
      enteredByUserId: authenticatedActor.id,
      enteredByName: authenticatedActor.name,
      enteredAt: new Date().toISOString(),
      rateMultiplier: 1.0,
    };

    clonedStore.overtime = clonedStore.overtime || [];
    clonedStore.overtime.push(record);
    mockStorage.saveStore(clonedStore);
    return record;
  }

  async updateOvertime(id: string, input: UpdateOvertimeInput, actor?: User): Promise<OvertimeRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can update overtime.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const record = (clonedStore.overtime || []).find((ot) => ot.id === id);
    if (!record) throw new Error(`Overtime record '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && record.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot edit overtime from another branch.');
    }
    if (record.payrollId) {
      throw new Error('Cannot edit overtime record already linked to finalized payroll.');
    }
    if (record.status === 'APPROVED') {
      throw new Error('Approved overtime cannot be edited directly. Please cancel and create a new record if needed.');
    }

    if (input.minutes !== undefined) {
      if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
        throw new Error('Overtime minutes must be a positive whole number.');
      }
      record.minutes = input.minutes;
      record.amount = roundCurrency((input.minutes / 60) * (record.hourlyRate ?? 0));
    }
    if (input.reason !== undefined) {
      if (!input.reason.trim()) throw new Error('A reason is required.');
      record.reason = input.reason.trim();
    }
    if (input.notes !== undefined) record.notes = input.notes;
    if (input.status !== undefined) record.status = input.status;

    mockStorage.saveStore(clonedStore);
    return record;
  }

  async approveOvertime(id: string, actor?: User): Promise<OvertimeRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can approve overtime.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const record = (clonedStore.overtime || []).find((ot) => ot.id === id);
    if (!record) throw new Error(`Overtime record '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && record.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot approve overtime from another branch.');
    }
    if (record.status === 'APPROVED') {
      throw new Error(`Overtime record '${record.overtimeNumber || id}' is already approved.`);
    }

    const staff = clonedStore.staff.find((s) => s.id === record.staffId);
    const hourlyRate = staff?.overtimeHourlyRate ?? record.hourlyRate ?? 0;
    record.hourlyRate = hourlyRate; // Snapshot effective rate on approval
    record.approvedMinutes = record.minutes || 0;
    record.amount = roundCurrency(((record.minutes || 0) / 60) * hourlyRate);
    record.status = 'APPROVED';
    record.approvedByUserId = authenticatedActor.id;
    record.approvedByName = authenticatedActor.name;
    record.approvedAt = new Date().toISOString();

    mockStorage.saveStore(clonedStore);
    return record;
  }

  async rejectOvertime(id: string, reason: string, actor?: User): Promise<OvertimeRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can reject overtime.');
    }
    if (!reason || !reason.trim()) {
      throw new Error('A rejection reason is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const record = (clonedStore.overtime || []).find((ot) => ot.id === id);
    if (!record) throw new Error(`Overtime record '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && record.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot reject overtime from another branch.');
    }
    if (record.payrollId) {
      throw new Error('Cannot reject overtime already linked to finalized payroll.');
    }

    record.status = 'REJECTED';
    record.rejectedByUserId = authenticatedActor.id;
    record.rejectedByName = authenticatedActor.name;
    record.rejectedAt = new Date().toISOString();
    record.rejectionReason = reason.trim();
    record.approvedMinutes = 0;

    mockStorage.saveStore(clonedStore);
    return record;
  }

  async cancelOvertime(id: string, reason: string, actor?: User): Promise<OvertimeRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role !== 'SUPER_ADMIN' && authenticatedActor.role !== 'ADMIN') {
      throw new Error('Access Denied: Only Administrators can cancel overtime.');
    }
    if (!reason || !reason.trim()) {
      throw new Error('A cancellation reason is required.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const record = (clonedStore.overtime || []).find((ot) => ot.id === id);
    if (!record) throw new Error(`Overtime record '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && record.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot cancel overtime from another branch.');
    }
    if (record.payrollId) {
      throw new Error('Cannot cancel overtime already linked to finalized payroll.');
    }

    record.status = 'CANCELLED';
    record.cancelledByUserId = authenticatedActor.id;
    record.cancelledByName = authenticatedActor.name;
    record.cancelledAt = new Date().toISOString();
    record.cancellationReason = reason.trim();
    record.approvedMinutes = 0;

    mockStorage.saveStore(clonedStore);
    return record;
  }

  async getStaffPersonalAttendance(actor?: User): Promise<{ records: AttendanceRecord[]; leaves: LeaveRecord[]; summary: any }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const staff = store.staff.find(
      (s) => s.linkedUserId === authenticatedActor.id || s.linkedUserEmail === authenticatedActor.email || s.id === authenticatedActor.id
    );
    if (!staff) {
      throw new Error('Staff record associated with the authenticated user could not be found.');
    }

    const records = (store.attendance || []).filter((a) => a.staffId === staff.id).sort((a, b) => b.date.localeCompare(a.date));
    const leaves = (store.leaves || []).filter((l) => l.staffId === staff.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
    const allowance = evaluateLeaveAllowance(staff, leaves, mockStorage.getSystemDate());

    return {
      records,
      leaves,
      summary: {
        staffName: staff.name,
        roleTitle: staff.roleTitle,
        startTime: staff.startTime,
        endTime: staff.endTime,
        isOvernightShift: staff.isOvernightShift,
        allowance,
      },
    };
  }

  async getStaffPersonalOvertime(actor?: User): Promise<{ records: OvertimeRecord[]; approvedMinutes: number; approvedPay: number }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const staff = store.staff.find(
      (s) => s.linkedUserId === authenticatedActor.id || s.linkedUserEmail === authenticatedActor.email || s.id === authenticatedActor.id
    );
    if (!staff) {
      throw new Error('Staff record associated with the authenticated user could not be found.');
    }

    const records = (store.overtime || []).filter((ot) => ot.staffId === staff.id).sort((a, b) => b.date.localeCompare(a.date));
    // Strictly ONLY approved overtime minutes count towards approved earnings
    const approvedOnly = records.filter((ot) => ot.status === 'APPROVED');
    const approvedMinutes = approvedOnly.reduce((sum, ot) => sum + ot.approvedMinutes, 0);
    const approvedPay = roundCurrency(approvedOnly.reduce((sum, ot) => sum + (ot.amount || 0), 0));

    return {
      records,
      approvedMinutes,
      approvedPay,
    };
  }

  // =========================================================================
  // --- PHASE 3E: SEQUENCE NUMBER GENERATORS ---
  // =========================================================================

  private getNextPayrollRunNumber(clonedStore: StorageSchema, branch: Branch, monthStr: string): string { return nextReference(clonedStore, 'PAY'); }

  private getNextPayslipNumber(clonedStore: StorageSchema, branch: Branch, monthStr: string): string { return nextReference(clonedStore, 'PS'); }

  private getNextPayrollPaymentNumber(clonedStore: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(clonedStore, 'PAYMT'); }

  private getNextCommissionRunNumber(clonedStore: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(clonedStore, 'COM'); }

  private getNextCommissionStatementNumber(clonedStore: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(clonedStore, 'CS'); }

  private getNextCommissionPaymentNumber(clonedStore: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(clonedStore, 'COMPAY'); }

  // =========================================================================
  // --- PHASE 3E: PAYROLL METHODS ---
  // =========================================================================

  async getPayrollPolicy(branchId: string): Promise<PayrollPolicyConfig> {
    const store = mockStorage.getStore();
    const existing = (store.payrollPolicyConfigs || []).find((p: PayrollPolicyConfig) => p.branchId === branchId);
    if (existing) {
      return { ...existing };
    }
    // Return default policy if not explicitly configured
    return {
      id: `policy-${branchId}`,
      branchId,
      monthlyAbsenceDivisor: 30,
      customDivisorDays: 30,
      dailyStaffPaidLeaveEligibility: true,
      nonWorkedWeeklyOffPaid: false,
      nonWorkedHolidayPaid: true,
      prorationMethod: 'CALENDAR_DAYS',
      updatedAt: mockStorage.getSystemDate(),
      updatedByUserId: 'SYSTEM',
    };
  }

  async updatePayrollPolicy(
    branchId: string,
    policyData: Partial<PayrollPolicyConfig>,
    actor?: User
  ): Promise<PayrollPolicyConfig> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to configure payroll policies.');
    }
    if (
      authenticatedActor.role !== 'SUPER_ADMIN' &&
      (authenticatedActor.role !== 'ADMIN' || authenticatedActor.branchId !== branchId)
    ) {
      throw new Error('Access Denied: You do not have permission to configure payroll policy for this branch.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b: Branch) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    store.payrollPolicyConfigs = store.payrollPolicyConfigs || [];
    let config = store.payrollPolicyConfigs.find((p: PayrollPolicyConfig) => p.branchId === branchId);

    if (policyData.customDivisorDays !== undefined && (typeof policyData.customDivisorDays !== 'number' || isNaN(policyData.customDivisorDays) || policyData.customDivisorDays <= 0)) {
      throw new Error('Custom divisor days must be a positive number.');
    }

    if (!config) {
      config = {
        id: `policy-${branchId}`,
        branchId,
        monthlyAbsenceDivisor: policyData.monthlyAbsenceDivisor || 30,
        customDivisorDays: policyData.customDivisorDays,
        dailyStaffPaidLeaveEligibility: policyData.dailyStaffPaidLeaveEligibility ?? true,
        nonWorkedWeeklyOffPaid: policyData.nonWorkedWeeklyOffPaid ?? false,
        nonWorkedHolidayPaid: policyData.nonWorkedHolidayPaid ?? true,
        prorationMethod: policyData.prorationMethod || 'CALENDAR_DAYS',
        updatedAt: mockStorage.getSystemDate(),
        updatedByUserId: authenticatedActor.id,
      };
      store.payrollPolicyConfigs.push(config);
    } else {
      if (policyData.monthlyAbsenceDivisor !== undefined) config.monthlyAbsenceDivisor = policyData.monthlyAbsenceDivisor;
      if (policyData.customDivisorDays !== undefined) config.customDivisorDays = policyData.customDivisorDays;
      if (policyData.dailyStaffPaidLeaveEligibility !== undefined) {
        config.dailyStaffPaidLeaveEligibility = policyData.dailyStaffPaidLeaveEligibility;
      }
      if (policyData.nonWorkedWeeklyOffPaid !== undefined) {
        config.nonWorkedWeeklyOffPaid = policyData.nonWorkedWeeklyOffPaid;
      }
      if (policyData.nonWorkedHolidayPaid !== undefined) {
        config.nonWorkedHolidayPaid = policyData.nonWorkedHolidayPaid;
      }
      if (policyData.prorationMethod) config.prorationMethod = policyData.prorationMethod;
      config.updatedAt = mockStorage.getSystemDate();
      config.updatedByUserId = authenticatedActor.id;
    }

    mockStorage.saveStore(store);
    return { ...config };
  }

  async getAttendancePolicy(branchId: string): Promise<AttendancePolicyConfig> {
    const store = mockStorage.getStore();
    const existing = ((store as any).attendancePolicyConfigs || []).find((p: AttendancePolicyConfig) => p.branchId === branchId);
    if (existing) {
      return { ...existing };
    }
    return {
      id: `att-policy-${branchId}`,
      branchId,
      autoMarkAbsentEnabled: true,
      autoAbsentThresholdMinutes: 60,
      autoHalfDayEnabled: false,
      halfDayThresholdMinutes: 120,
      defaultStartTime: '09:00',
      defaultEndTime: '18:00',
      lateGraceMinutes: 15,
      earlyGraceMinutes: 15,
      updatedAt: mockStorage.getSystemDate(),
      updatedByUserId: 'SYSTEM',
    };
  }

  async updateAttendancePolicy(
    branchId: string,
    policyData: Partial<AttendancePolicyConfig>,
    actor?: User
  ): Promise<AttendancePolicyConfig> {
    const store = mockStorage.getStore();
    const authenticatedActor = actor || mockAuthService.getCurrentSession()?.user;
    if (!authenticatedActor) {
      throw new Error('Authentication required to modify attendance policy.');
    }

    (store as any).attendancePolicyConfigs = (store as any).attendancePolicyConfigs || [];
    let config = (store as any).attendancePolicyConfigs.find((p: AttendancePolicyConfig) => p.branchId === branchId);

    if (!config) {
      config = {
        id: `att-policy-${branchId}`,
        branchId,
        autoMarkAbsentEnabled: policyData.autoMarkAbsentEnabled ?? true,
        autoAbsentThresholdMinutes: policyData.autoAbsentThresholdMinutes ?? 60,
        autoHalfDayEnabled: policyData.autoHalfDayEnabled ?? false,
        halfDayThresholdMinutes: policyData.halfDayThresholdMinutes ?? 120,
        defaultStartTime: policyData.defaultStartTime || '09:00',
        defaultEndTime: policyData.defaultEndTime || '18:00',
        lateGraceMinutes: policyData.lateGraceMinutes ?? 15,
        earlyGraceMinutes: policyData.earlyGraceMinutes ?? 15,
        updatedAt: mockStorage.getSystemDate(),
        updatedByUserId: authenticatedActor.id,
      };
      (store as any).attendancePolicyConfigs.push(config);
    } else {
      if (policyData.autoMarkAbsentEnabled !== undefined) config.autoMarkAbsentEnabled = policyData.autoMarkAbsentEnabled;
      if (policyData.autoAbsentThresholdMinutes !== undefined) config.autoAbsentThresholdMinutes = policyData.autoAbsentThresholdMinutes;
      if (policyData.autoHalfDayEnabled !== undefined) config.autoHalfDayEnabled = policyData.autoHalfDayEnabled;
      if (policyData.halfDayThresholdMinutes !== undefined) config.halfDayThresholdMinutes = policyData.halfDayThresholdMinutes;
      if (policyData.defaultStartTime) config.defaultStartTime = policyData.defaultStartTime;
      if (policyData.defaultEndTime) config.defaultEndTime = policyData.defaultEndTime;
      if (policyData.lateGraceMinutes !== undefined) config.lateGraceMinutes = policyData.lateGraceMinutes;
      if (policyData.earlyGraceMinutes !== undefined) config.earlyGraceMinutes = policyData.earlyGraceMinutes;
      config.updatedAt = mockStorage.getSystemDate();
      config.updatedByUserId = authenticatedActor.id;
    }

    mockStorage.saveStore(store);
    return { ...config };
  }

  async generatePayrollPreview(
    branchId: string,
    month: string,
    staffId?: string,
    actor?: User,
    options?: PayrollPreviewOptions
  ): Promise<PayrollRun> {
    if ((options?.runType && options.runType !== 'MONTHLY') || options?.startDate || options?.endDate || (options?.compensationType && options.compensationType !== 'ALL')) {
      throw new Error('Payroll periods and canonical commission require the live API (VITE_USE_MOCK=false).');
    }
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to view or generate payroll.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot generate payroll previews.');
    }
    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== branchId) {
      throw new Error('Access Denied: Cannot generate payroll for another branch.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b: Branch) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    const policy = await this.getPayrollPolicy(branchId);
    const staffList = store.staff.filter(
      (s: StaffMember) =>
        s.branchId === branchId &&
        s.isActive &&
        (!staffId || s.id === staffId) &&
        (!options?.staffIds || options.staffIds.includes(s.id))
    );

    const holidays = (store.branchHolidays || []).filter((h: BranchHoliday) => h.branchId === branchId);
    const attendance = (store.attendance || []).filter(
      (a: AttendanceRecord) => a.branchId === branchId && a.date.startsWith(month)
    );
    const overtime = (store.overtime || []).filter(
      (ot: OvertimeRecord) =>
        ot.branchId === branchId &&
        ot.date.startsWith(month) &&
        ot.status === 'APPROVED' &&
        (!ot.payrollId || ot.payrollId === '')
    );

    const payslips: PayslipRecord[] = [];
    let hasExceptions = false;
    let hasNegativeSalary = false;
    let totalPayable = 0;

    for (const st of staffList) {
      const evalResult = evaluateEmployeePayroll(st, month, policy, attendance, overtime, holidays);
      const ps: PayslipRecord = {
        ...evalResult.payslip,
        id: `draft-ps-${st.id}`,
        payrollRunId: `draft-run-${branchId}-${month}`,
        payslipNumber: 'DRAFT',
        status: 'DRAFT',
        payments: [],
      };
      if (ps.hasExceptions) hasExceptions = true;
      if (ps.netPayable < 0) hasNegativeSalary = true;

      totalPayable += ps.netPayable;
      payslips.push(ps);
    }

    const draftRunId = `draft-run-${branchId}-${month}`;
    const draftRun: PayrollRun = {
      id: draftRunId,
      payrollNumber: 'DRAFT',
      branchId,
      branchName: branch.name,
      month,
      status: 'DRAFT',
      totalPayable: roundCurrency(totalPayable),
      totalPaid: 0,
      totalOutstanding: roundCurrency(totalPayable),
      employeeCount: payslips.length,
      payslips,
      policySnapshot: { ...policy },
      generatedAt: mockStorage.getSystemDate(),
      generatedByUserId: authenticatedActor.id,
      generatedByName: authenticatedActor.name,
    };

    store.payrollRuns = (store.payrollRuns || []).filter((r: PayrollRun) => r.id !== draftRunId);
    store.payrollRuns.push(draftRun);
    mockStorage.saveStore(store);

    return draftRun;
  }

  async finalizePayroll(payrollRunId: string, actor?: User, options?: { staffId?: string; payslipId?: string }): Promise<PayrollRun> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to finalize payroll.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot finalize payroll.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.payrollRuns = clonedStore.payrollRuns || [];

    const runIndex = clonedStore.payrollRuns.findIndex((r: PayrollRun) => r.id === payrollRunId);
    if (runIndex === -1) {
      throw new Error(`Payroll run '${payrollRunId}' not found. Please generate a preview first.`);
    }

    const draftRun = clonedStore.payrollRuns[runIndex];
    if (draftRun.status !== 'DRAFT') {
      throw new Error(`Payroll run is already in status '${draftRun.status}' and cannot be finalized.`);
    }

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== draftRun.branchId) {
      throw new Error('Access Denied: Cannot finalize payroll for another branch.');
    }

    const existingFinalized = clonedStore.payrollRuns.find(
      (r: PayrollRun) =>
        r.id !== payrollRunId &&
        r.branchId === draftRun.branchId &&
        r.month === draftRun.month &&
        r.status !== 'CANCELLED' &&
        r.status !== 'DRAFT'
    );
    if (existingFinalized) {
      throw new Error(
        `A finalized payroll run already exists for ${draftRun.month} in this branch (${existingFinalized.payrollNumber}).`
      );
    }

    const branch = clonedStore.branches.find((b: Branch) => b.id === draftRun.branchId);
    if (!branch) {
      throw new Error(`Branch '${draftRun.branchId}' not found.`);
    }

    const policy = (clonedStore.payrollPolicyConfigs || []).find((p: PayrollPolicyConfig) => p.branchId === draftRun.branchId) || {
      id: `policy-${draftRun.branchId}`,
      branchId: draftRun.branchId,
      monthlyAbsenceDivisor: 30,
      customDivisorDays: 30,
      dailyStaffPaidLeaveEligibility: true,
      nonWorkedWeeklyOffPaid: false,
      nonWorkedHolidayPaid: true,
      prorationMethod: 'CALENDAR_DAYS',
      updatedAt: mockStorage.getSystemDate(),
      updatedByUserId: 'SYSTEM',
    };

    const staffList = clonedStore.staff.filter((s: StaffMember) => s.branchId === draftRun.branchId && s.isActive);
    const holidays = (clonedStore.branchHolidays || []).filter((h: BranchHoliday) => h.branchId === draftRun.branchId);
    const attendance = (clonedStore.attendance || []).filter(
      (a: AttendanceRecord) => a.branchId === draftRun.branchId && a.date.startsWith(draftRun.month)
    );
    const overtime = (clonedStore.overtime || []).filter(
      (ot: OvertimeRecord) =>
        ot.branchId === draftRun.branchId &&
        ot.date.startsWith(draftRun.month) &&
        ot.status === 'APPROVED' &&
        (!ot.payrollId || ot.payrollId === '')
    );

    const evaluatedList = staffList.map((st: StaffMember) =>
      evaluateEmployeePayroll(st, draftRun.month, policy, attendance, overtime, holidays)
    );

    for (const ev of evaluatedList) {
      if (!ev.canFinalize) {
        throw new Error(`Cannot finalize payroll: ${ev.blockReason}`);
      }
    }

    const finalRunId = `payrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const payrollNumber = this.getNextPayrollRunNumber(clonedStore, branch, draftRun.month);

    let totalPayable = 0;
    const finalPayslips: PayslipRecord[] = [];

    for (const ev of evaluatedList) {
      const psNum = this.getNextPayslipNumber(clonedStore, branch, draftRun.month);
      const psId = `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const ps: PayslipRecord = {
        ...ev.payslip,
        id: psId,
        payrollRunId: finalRunId,
        payslipNumber: psNum,
        status: 'FINALIZED',
        payments: [],
      };

      for (const otId of ps.consumedOvertimeIds) {
        const otRec = clonedStore.overtime.find((o: OvertimeRecord) => o.id === otId);
        if (otRec) {
          otRec.payrollId = finalRunId;
        }
      }

      totalPayable += ps.netPayable;
      finalPayslips.push(ps);
    }

    const finalizedRun: PayrollRun = {
      id: finalRunId,
      payrollNumber,
      branchId: draftRun.branchId,
      branchName: branch.name,
      month: draftRun.month,
      status: 'FINALIZED',
      totalPayable: roundCurrency(totalPayable),
      totalPaid: 0,
      totalOutstanding: roundCurrency(totalPayable),
      employeeCount: finalPayslips.length,
      payslips: finalPayslips,
      policySnapshot: { ...policy },
      generatedAt: draftRun.generatedAt || mockStorage.getSystemDate(),
      generatedByUserId: draftRun.generatedByUserId || authenticatedActor.id,
      generatedByName: draftRun.generatedByName || authenticatedActor.name,
      finalizedAt: mockStorage.getSystemDate() + 'T12:00:00',
      finalizedByUserId: authenticatedActor.id,
      finalizedByName: authenticatedActor.name,
    };

    clonedStore.payrollRuns.splice(runIndex, 1, finalizedRun);
    mockStorage.saveStore(clonedStore);

    return finalizedRun;
  }

  async recordPayrollPayment(
    input: RecordPayrollPaymentInput,
    actor?: User
  ): Promise<{ payrollRun: PayrollRun; payment: PayrollPayment }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to disburse payroll payments.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot disburse payroll payments.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.payrollPayments = clonedStore.payrollPayments || [];

    const run = (clonedStore.payrollRuns || []).find((r: PayrollRun) => r.id === input.payrollRunId);
    if (!run) {
      throw new Error(`Payroll run '${input.payrollRunId}' not found.`);
    }
    if (run.status === 'DRAFT' || run.status === 'CANCELLED') {
      throw new Error(`Cannot record payment on a payroll run in '${run.status}' status.`);
    }

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== run.branchId) {
      throw new Error('Access Denied: Cannot record payment for another branch.');
    }

    const payslip = run.payslips.find((p: PayslipRecord) => p.id === input.payslipId);
    if (!payslip) {
      throw new Error(`Payslip '${input.payslipId}' not found in this payroll run.`);
    }

    if (typeof input.amount !== 'number' || isNaN(input.amount) || input.amount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    if (input.amount > payslip.outstandingAmount + 0.001) {
      throw new Error(
        `Payment amount (${input.amount}) exceeds outstanding payslip balance (${payslip.outstandingAmount}).`
      );
    }

    let cashDrawerId: string | undefined;
    let onlineAccountName: string | undefined;

    if (input.method === 'CASH') {
      const drawer = clonedStore.cashDrawers.find(
        (d: CashDrawer) => d.branchId === run.branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
      );
      if (!drawer) {
        throw new Error('Cash payout requires an OPEN cash drawer assigned to you in this branch.');
      }
      if (drawer.expectedInDrawer < input.amount) {
        throw new Error(
          `Insufficient cash float in drawer. Available: ${drawer.expectedInDrawer}, Required: ${input.amount}`
        );
      }
      drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer - input.amount);
      drawer.cashExpensesPaid = roundCurrency((drawer.cashExpensesPaid || 0) + input.amount);
      cashDrawerId = drawer.id;
    } else if (input.method === 'ONLINE') {
      if (!input.onlineAccountId) {
        throw new Error('Payment account must be selected for online payment.');
      }
      const account = clonedStore.paymentAccounts.find(
        (a: PaymentAccount) => a.id === input.onlineAccountId && a.branchId === run.branchId && a.isActive
      );
      if (!account) {
        throw new Error('Selected payment account is invalid, inactive, or belongs to a different branch.');
      }
      if (account.currentBalance < input.amount) {
        throw new Error(
          `Insufficient funds in account '${account.name}'. Available: ${account.currentBalance}, Required: ${input.amount}`
        );
      }
      account.currentBalance = roundCurrency(account.currentBalance - input.amount);
      onlineAccountName = account.name;
    }

    const branch = clonedStore.branches.find((b: Branch) => b.id === run.branchId)!;
    const yearStr = (run.month || mockStorage.getSystemDate()).slice(0, 4);
    const paymentNumber = this.getNextPayrollPaymentNumber(clonedStore, branch, yearStr);
    const paymentId = `paymt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const paymentRecord: PayrollPayment = {
      id: paymentId,
      paymentNumber,
      payrollRunId: run.id,
      payslipId: payslip.id,
      staffId: payslip.staffId,
      staffName: payslip.staffName,
      branchId: run.branchId,
      amount: roundCurrency(input.amount),
      method: input.method,
      cashDrawerId,
      onlineAccountId: input.onlineAccountId,
      onlineAccountName,
      paidAt: mockStorage.getSystemDate() + 'T12:00:00',
      paidByUserId: authenticatedActor.id,
      paidByName: authenticatedActor.name,
      reference: input.reference || '',
      notes: input.notes,
      status: 'COMPLETED',
    };

    payslip.paidAmount = roundCurrency(payslip.paidAmount + input.amount);
    payslip.outstandingAmount = roundCurrency(Math.max(0, payslip.netPayable - payslip.paidAmount));
    payslip.status = payslip.outstandingAmount <= 0.001 ? 'PAID' : 'PARTIALLY_PAID';
    payslip.payments = payslip.payments || [];
    payslip.payments.push(paymentRecord);

    run.totalPaid = roundCurrency(run.totalPaid + input.amount);
    run.totalOutstanding = roundCurrency(Math.max(0, run.totalPayable - run.totalPaid));
    run.status = run.totalOutstanding <= 0.001 ? 'PAID' : 'PARTIALLY_PAID';

    clonedStore.payrollPayments.push(paymentRecord);
    mockStorage.saveStore(clonedStore);

    return { payrollRun: run, payment: paymentRecord };
  }

  async cancelPayslip(payslipId: string, reason: string, actor?: User): Promise<{ deletedPayslipId: string; runCancelled: boolean; run?: PayrollRun }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to cancel payslips.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot cancel payslips.');
    }
    if (!reason?.trim()) {
      throw new Error('A cancellation reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    let targetRun: PayrollRun | undefined;
    let targetPayslipIndex = -1;

    for (const r of (clonedStore.payrollRuns || [])) {
      const idx = (r.payslips || []).findIndex((p: any) => p.id === payslipId);
      if (idx !== -1) {
        targetRun = r;
        targetPayslipIndex = idx;
        break;
      }
    }

    if (!targetRun || targetPayslipIndex === -1) {
      throw new Error(`Payslip '${payslipId}' not found.`);
    }

    const targetPs = targetRun.payslips[targetPayslipIndex];
    if (targetPs.paidAmount && targetPs.paidAmount > 0) {
      throw new Error(`Cannot delete salary for ${targetPs.staffName || 'this staff'} because it has completed payments. Please reverse payments first.`);
    }

    // Release overtime for this staff
    for (const ot of clonedStore.overtime) {
      if (ot.payrollId === targetRun.id && ot.staffId === targetPs.staffId) {
        ot.payrollId = undefined;
      }
    }

    // Remove payslip
    targetRun.payslips.splice(targetPayslipIndex, 1);
    targetRun.employeeCount = targetRun.payslips.length;
    targetRun.totalPayable = targetRun.payslips.reduce((s: number, p: any) => s + (p.netPayable || 0), 0);
    targetRun.totalOutstanding = targetRun.payslips.reduce((s: number, p: any) => s + (p.outstandingAmount || 0), 0);

    let runCancelled = false;
    if (targetRun.payslips.length === 0) {
      targetRun.status = 'CANCELLED';
      targetRun.cancellationReason = reason.trim();
      targetRun.cancelledAt = mockStorage.getSystemDate();
      targetRun.cancelledByUserId = authenticatedActor.id;
      targetRun.cancelledByName = authenticatedActor.name;
      runCancelled = true;
    }

    mockStorage.saveStore(clonedStore);
    return { deletedPayslipId: payslipId, runCancelled, run: targetRun };
  }

  async cancelPayrollRun(payrollRunId: string, reason: string, actor?: User): Promise<PayrollRun> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to cancel payroll runs.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot cancel payroll runs.');
    }

    if (!reason?.trim()) {
      throw new Error('A cancellation reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    const run = (clonedStore.payrollRuns || []).find((r: PayrollRun) => r.id === payrollRunId);
    if (!run) {
      throw new Error(`Payroll run '${payrollRunId}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== run.branchId) {
      throw new Error('Access Denied: Cannot cancel payroll run for another branch.');
    }

    const activePayments = (clonedStore.payrollPayments || []).filter(
      (p: PayrollPayment) => p.payrollRunId === payrollRunId && p.status !== 'REVERSED'
    );
    if (activePayments.length > 0 || (run.totalPaid && run.totalPaid > 0)) {
      throw new Error('Runs with payments cannot be cancelled until all payments are properly reversed.');
    }

    for (const ot of clonedStore.overtime) {
      if (ot.payrollId === payrollRunId) {
        ot.payrollId = undefined;
      }
    }

    run.status = 'CANCELLED';
    run.cancellationReason = reason.trim();
    run.cancelledAt = mockStorage.getSystemDate();
    run.cancelledByUserId = authenticatedActor.id;
    run.cancelledByName = authenticatedActor.name;

    for (const ps of run.payslips) {
      ps.status = 'CANCELLED';
    }

    mockStorage.saveStore(clonedStore);
    return run;
  }

  async reversePayrollPayment(paymentId: string, reason: string, actor?: User): Promise<PayrollPayment> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to reverse payroll payments.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot reverse payroll payments.');
    }

    if (!reason?.trim()) {
      throw new Error('A reversal reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    const payment = (clonedStore.payrollPayments || []).find((p: PayrollPayment) => p.id === paymentId);
    if (!payment) {
      throw new Error(`Payroll payment '${paymentId}' not found.`);
    }
    if (payment.status === 'REVERSED') {
      throw new Error('This payroll payment is already reversed.');
    }

    const run = (clonedStore.payrollRuns || []).find((r: PayrollRun) => r.id === payment.payrollRunId);
    if (!run) {
      throw new Error(`Associated payroll run '${payment.payrollRunId}' not found.`);
    }
    const payslip = run.payslips.find((p: PayslipRecord) => p.id === payment.payslipId);
    if (!payslip) {
      throw new Error(`Associated payslip '${payment.payslipId}' not found.`);
    }

    if (payment.method === 'CASH') {
      if (payment.cashDrawerId) {
        const drawer = clonedStore.cashDrawers.find((d: CashDrawer) => d.id === payment.cashDrawerId);
        if (drawer && drawer.status === 'OPEN') {
          drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer + payment.amount);
          drawer.cashExpensesPaid = roundCurrency(Math.max(0, (drawer.cashExpensesPaid || 0) - payment.amount));
        } else {
          clonedStore.vaultBalances = clonedStore.vaultBalances || {};
          clonedStore.vaultBalances[payment.branchId] = roundCurrency(
            (clonedStore.vaultBalances[payment.branchId] || 0) + payment.amount
          );
        }
      } else {
        clonedStore.vaultBalances = clonedStore.vaultBalances || {};
        clonedStore.vaultBalances[payment.branchId] = roundCurrency(
          (clonedStore.vaultBalances[payment.branchId] || 0) + payment.amount
        );
      }
    } else if (payment.method === 'ONLINE' && payment.onlineAccountId) {
      const account = clonedStore.paymentAccounts.find((a: PaymentAccount) => a.id === payment.onlineAccountId);
      if (account) {
        account.currentBalance = roundCurrency(account.currentBalance + payment.amount);
      }
    }

    payment.status = 'REVERSED';
    payment.reversalReason = reason.trim();
    payment.reversedAt = mockStorage.getSystemDate();
    payment.reversedByUserId = authenticatedActor.id;
    payment.reversedByName = authenticatedActor.name;

    payslip.paidAmount = roundCurrency(Math.max(0, payslip.paidAmount - payment.amount));
    payslip.outstandingAmount = roundCurrency(payslip.netPayable - payslip.paidAmount);
    payslip.status = payslip.paidAmount <= 0.001 ? 'FINALIZED' : 'PARTIALLY_PAID';

    run.totalPaid = roundCurrency(Math.max(0, run.totalPaid - payment.amount));
    run.totalOutstanding = roundCurrency(run.totalPayable - run.totalPaid);
    run.status = run.totalPaid <= 0.001 ? 'FINALIZED' : 'PARTIALLY_PAID';

    mockStorage.saveStore(clonedStore);
    return payment;
  }

  async getPayrollRuns(branchId: string | 'ALL', month?: string, actor?: User): Promise<PayrollRun[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to access confidential payroll.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access payroll run management.');
    }

    const store = mockStorage.getStore();
    let runs = store.payrollRuns || [];

    if (authenticatedActor.role === 'ADMIN') {
      runs = runs.filter((r: PayrollRun) => r.branchId === authenticatedActor.branchId);
    } else if (branchId !== 'ALL') {
      runs = runs.filter((r: PayrollRun) => r.branchId === branchId);
    }

    if (month) {
      runs = runs.filter((r: PayrollRun) => r.month === month);
    }

    return runs.slice().sort((a: PayrollRun, b: PayrollRun) => b.month.localeCompare(a.month));
  }

  async getStaffPersonalPayslips(actor?: User): Promise<PayslipRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const staff = store.staff.find(
      (s: StaffMember) =>
        s.linkedUserId === authenticatedActor.id ||
        s.linkedUserEmail === authenticatedActor.email ||
        s.id === authenticatedActor.id
    );
    if (!staff) {
      throw new Error('Staff record associated with the authenticated user could not be found.');
    }

    const results: PayslipRecord[] = [];
    for (const run of store.payrollRuns || []) {
      if (run.status !== 'DRAFT' && run.status !== 'CANCELLED') {
        for (const ps of run.payslips || []) {
          if (ps.staffId === staff.id) {
            results.push({ ...ps });
          }
        }
      }
    }

    return results.sort((a: PayslipRecord, b: PayslipRecord) => b.month.localeCompare(a.month));
  }

  // Payroll inputs, monthly summary and the staff pay reports exist only in the API.
  private apiOnly(): never {
    throw new Error('This payroll feature (allowances, adjustments, advances, monthly summary, salary/commission reports) requires the live API (VITE_USE_MOCK=false).');
  }
  async getPayrollMonthlySummary(): Promise<MonthlyPaySummary> { return this.apiOnly(); }
  async getStaffAllowances(): Promise<StaffAllowance[]> { return []; }
  async createStaffAllowance(): Promise<StaffAllowance> { return this.apiOnly(); }
  async updateStaffAllowance(): Promise<StaffAllowance> { return this.apiOnly(); }
  async getPayrollAdjustments(): Promise<PayrollAdjustment[]> { return []; }
  async createPayrollAdjustment(): Promise<PayrollAdjustment> { return this.apiOnly(); }
  async cancelPayrollAdjustment(): Promise<PayrollAdjustment> { return this.apiOnly(); }
  async addManualDeduction(): Promise<any> { return this.apiOnly(); }
  async getSalaryAdvances(): Promise<SalaryAdvance[]> { return []; }
  async issueSalaryAdvance(): Promise<SalaryAdvance> { return this.apiOnly(); }
  async reverseSalaryAdvance(): Promise<SalaryAdvance> { return this.apiOnly(); }
  async getStaffSalaryReport(): Promise<StaffSalaryReport> { return this.apiOnly(); }
  async getStaffCommissionReport(): Promise<StaffCommissionReport> { return this.apiOnly(); }
  async getSalesInvoicesReport(): Promise<SalesInvoicesReport> { return this.apiOnly(); }
  async getDetailedIncomeReport(): Promise<DetailedIncomeReport> { return this.apiOnly(); }
  async getIncomeExpenseReport(): Promise<IncomeExpenseReport> { return this.apiOnly(); }
  async getTaxReport(): Promise<TaxReport> { return this.apiOnly(); }
  async getOperatingProfitReport(): Promise<OperatingProfitReport> { return this.apiOnly(); }
  async getPaymentAccountsReport(): Promise<PaymentAccountsReport> { return this.apiOnly(); }
  async getCashDrawerReport(): Promise<CashDrawerReport> { return this.apiOnly(); }
  async getDetailedExpensesReport(): Promise<DetailedExpensesReport> { return this.apiOnly(); }
  async getInventoryReport(): Promise<InventoryReportData> { return this.apiOnly(); }
  async getAttendanceOvertimeReport(): Promise<AttendanceOvertimeReport> { return this.apiOnly(); }
  // =========================================================================
  // --- PHASE 3E: STAFF COMMISSION METHODS ---
  // =========================================================================

  async generateCommissionPreview(
    branchId: string,
    startDate: string,
    endDate: string,
    staffId?: string,
    actor?: User,
    staffIds?: string[],
    compensationType?: string
  ): Promise<CommissionRun> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to view or generate commission.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot generate commission previews.');
    }
    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== branchId) {
      throw new Error('Access Denied: Cannot generate commission for another branch.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b: Branch) => b.id === branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    const consumedLineIds = new Set<string>();
    for (const r of store.commissionRuns || []) {
      if (r.status !== 'CANCELLED') {
        for (const id of r.consumedAttributionLineIds || []) {
          consumedLineIds.add(id);
        }
      }
    }

    const targetStaffIds = staffIds && staffIds.length > 0 ? staffIds : (staffId && staffId !== 'ALL' ? [staffId] : null);
    const eligibleStaff = store.staff.filter(
      (s: StaffMember) =>
        s.branchId === branchId &&
        (targetStaffIds ? targetStaffIds.includes(s.id) : (s.isActive && isCompensationEligibleForCommission(s.compensationType))) &&
        (!compensationType || compensationType === 'ALL' || s.compensationType === compensationType)
    );

    const statements: CommissionStatementRecord[] = [];
    let totalEligibleNetSales = 0;
    let totalCommissionPayable = 0;

    for (const st of eligibleStaff) {
      const evalResult = evaluateStaffCommission(
        st,
        startDate,
        endDate,
        store.invoices,
        consumedLineIds
      );

      const stmt: CommissionStatementRecord = {
        ...evalResult.statement,
        id: `draft-stmt-${st.id}`,
        commissionRunId: `draft-com-${branchId}-${startDate}-${endDate}`,
        statementNumber: 'DRAFT',
        status: 'DRAFT',
        payments: [],
      };

      totalEligibleNetSales += stmt.attributedNetSales;
      totalCommissionPayable += stmt.netCommissionPayable;
      statements.push(stmt);
    }

    const draftRunId = `draft-com-${branchId}-${startDate}-${endDate}`;
    const draftRun: CommissionRun = {
      id: draftRunId,
      commissionNumber: 'DRAFT',
      branchId,
      branchName: branch.name,
      startDate,
      endDate,
      status: 'DRAFT',
      totalEligibleNetSales: roundCurrency(totalEligibleNetSales),
      totalCommissionPayable: roundCurrency(totalCommissionPayable),
      totalPaid: 0,
      totalOutstanding: roundCurrency(totalCommissionPayable),
      staffCount: statements.length,
      consumedAttributionLineIds: [],
      statements,
      generatedAt: mockStorage.getSystemDate(),
      generatedByUserId: authenticatedActor.id,
      generatedByName: authenticatedActor.name,
    };

    store.commissionRuns = (store.commissionRuns || []).filter((r: CommissionRun) => r.id !== draftRunId);
    store.commissionRuns.push(draftRun);
    mockStorage.saveStore(store);

    return draftRun;
  }

  async finalizeCommission(commissionRunId: string, actor?: User): Promise<CommissionRun> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to finalize commission.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot finalize commission.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.commissionRuns = clonedStore.commissionRuns || [];

    const runIndex = clonedStore.commissionRuns.findIndex((r: CommissionRun) => r.id === commissionRunId);
    if (runIndex === -1) {
      throw new Error(`Commission run '${commissionRunId}' not found. Please generate a preview first.`);
    }

    const draftRun = clonedStore.commissionRuns[runIndex];
    if (draftRun.status !== 'DRAFT') {
      throw new Error(`Commission run is already in status '${draftRun.status}' and cannot be finalized.`);
    }

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== draftRun.branchId) {
      throw new Error('Access Denied: Cannot finalize commission for another branch.');
    }

    const branch = clonedStore.branches.find((b: Branch) => b.id === draftRun.branchId);
    if (!branch) {
      throw new Error(`Branch '${draftRun.branchId}' not found.`);
    }

    const consumedLineIds = new Set<string>();
    for (const r of clonedStore.commissionRuns) {
      if (r.id !== commissionRunId && r.status !== 'CANCELLED') {
        for (const id of r.consumedAttributionLineIds || []) {
          consumedLineIds.add(id);
        }
      }
    }

    const eligibleStaff = clonedStore.staff.filter(
      (s: StaffMember) =>
        s.branchId === draftRun.branchId &&
        s.isActive &&
        isCompensationEligibleForCommission(s.compensationType)
    );

    const yearStr = draftRun.startDate.slice(0, 4);
    const finalRunId = `comrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const commissionNumber = this.getNextCommissionRunNumber(clonedStore, branch, yearStr);

    let totalEligibleNetSales = 0;
    let totalCommissionPayable = 0;
    const finalStatements: CommissionStatementRecord[] = [];
    const allConsumedIds: string[] = [];

    for (const st of eligibleStaff) {
      const evalResult = evaluateStaffCommission(
        st,
        draftRun.startDate,
        draftRun.endDate,
        clonedStore.invoices,
        consumedLineIds
      );

      const stmtNum = this.getNextCommissionStatementNumber(clonedStore, branch, yearStr);
      const stmtId = `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const stmt: CommissionStatementRecord = {
        ...evalResult.statement,
        id: stmtId,
        commissionRunId: finalRunId,
        statementNumber: stmtNum,
        status: 'FINALIZED',
        payments: [],
      };

      for (const lineId of evalResult.consumedAttributionIds) {
        allConsumedIds.push(lineId);
        consumedLineIds.add(lineId);
      }

      totalEligibleNetSales += stmt.attributedNetSales;
      totalCommissionPayable += stmt.netCommissionPayable;
      finalStatements.push(stmt);
    }

    const finalizedRun: CommissionRun = {
      id: finalRunId,
      commissionNumber,
      branchId: draftRun.branchId,
      branchName: branch.name,
      startDate: draftRun.startDate,
      endDate: draftRun.endDate,
      status: 'FINALIZED',
      totalEligibleNetSales: roundCurrency(totalEligibleNetSales),
      totalCommissionPayable: roundCurrency(totalCommissionPayable),
      totalPaid: 0,
      totalOutstanding: roundCurrency(totalCommissionPayable),
      staffCount: finalStatements.length,
      consumedAttributionLineIds: allConsumedIds,
      statements: finalStatements,
      generatedAt: draftRun.generatedAt || mockStorage.getSystemDate(),
      generatedByUserId: draftRun.generatedByUserId || authenticatedActor.id,
      generatedByName: draftRun.generatedByName || authenticatedActor.name,
      finalizedAt: mockStorage.getSystemDate() + 'T12:00:00',
      finalizedByUserId: authenticatedActor.id,
      finalizedByName: authenticatedActor.name,
    };

    clonedStore.commissionRuns.splice(runIndex, 1, finalizedRun);
    mockStorage.saveStore(clonedStore);

    return finalizedRun;
  }

  async recordCommissionPayment(
    input: RecordCommissionPaymentInput,
    actor?: User
  ): Promise<{ commissionRun: CommissionRun; payment: CommissionPayment }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to disburse commission payments.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot disburse commission payments.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.commissionPayments = clonedStore.commissionPayments || [];

    const run = (clonedStore.commissionRuns || []).find((r: CommissionRun) => r.id === input.commissionRunId);
    if (!run) {
      throw new Error(`Commission run '${input.commissionRunId}' not found.`);
    }
    if (run.status === 'DRAFT' || run.status === 'CANCELLED') {
      throw new Error(`Cannot record payment on a commission run in '${run.status}' status.`);
    }

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== run.branchId) {
      throw new Error('Access Denied: Cannot record payment for another branch.');
    }

    const statement = run.statements.find((s: CommissionStatementRecord) => s.id === input.statementId);
    if (!statement) {
      throw new Error(`Commission statement '${input.statementId}' not found in this run.`);
    }

    if (typeof input.amount !== 'number' || isNaN(input.amount) || input.amount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    if (input.amount > statement.outstandingAmount + 0.001) {
      throw new Error(
        `Payment amount (${input.amount}) exceeds outstanding statement balance (${statement.outstandingAmount}).`
      );
    }

    let cashDrawerId: string | undefined;
    let onlineAccountName: string | undefined;

    if (input.method === 'CASH') {
      const drawer = clonedStore.cashDrawers.find(
        (d: CashDrawer) => d.branchId === run.branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
      );
      if (!drawer) {
        throw new Error('Cash payout requires an OPEN cash drawer assigned to you in this branch.');
      }
      if (drawer.expectedInDrawer < input.amount) {
        throw new Error(
          `Insufficient cash float in drawer. Available: ${drawer.expectedInDrawer}, Required: ${input.amount}`
        );
      }
      drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer - input.amount);
      drawer.cashExpensesPaid = roundCurrency((drawer.cashExpensesPaid || 0) + input.amount);
      cashDrawerId = drawer.id;
    } else if (input.method === 'ONLINE') {
      if (!input.onlineAccountId) {
        throw new Error('Payment account must be selected for online payment.');
      }
      const account = clonedStore.paymentAccounts.find(
        (a: PaymentAccount) => a.id === input.onlineAccountId && a.branchId === run.branchId && a.isActive
      );
      if (!account) {
        throw new Error('Selected payment account is invalid, inactive, or belongs to a different branch.');
      }
      if (account.currentBalance < input.amount) {
        throw new Error(
          `Insufficient funds in account '${account.name}'. Available: ${account.currentBalance}, Required: ${input.amount}`
        );
      }
      account.currentBalance = roundCurrency(account.currentBalance - input.amount);
      onlineAccountName = account.name;
    }

    const branch = clonedStore.branches.find((b: Branch) => b.id === run.branchId)!;
    const yearStr = (run.startDate || mockStorage.getSystemDate()).slice(0, 4);
    const paymentNumber = this.getNextCommissionPaymentNumber(clonedStore, branch, yearStr);
    const paymentId = `compay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const paymentRecord: CommissionPayment = {
      id: paymentId,
      paymentNumber,
      commissionRunId: run.id,
      statementId: statement.id,
      staffId: statement.staffId,
      staffName: statement.staffName,
      branchId: run.branchId,
      amount: roundCurrency(input.amount),
      method: input.method,
      cashDrawerId,
      onlineAccountId: input.onlineAccountId,
      onlineAccountName,
      paidAt: mockStorage.getSystemDate() + 'T12:00:00',
      paidByUserId: authenticatedActor.id,
      paidByName: authenticatedActor.name,
      reference: input.reference || '',
      notes: input.notes,
      status: 'COMPLETED',
    };

    statement.paidAmount = roundCurrency(statement.paidAmount + input.amount);
    statement.outstandingAmount = roundCurrency(Math.max(0, statement.netCommissionPayable - statement.paidAmount));
    statement.status = statement.outstandingAmount <= 0.001 ? 'PAID' : 'PARTIALLY_PAID';
    statement.payments = statement.payments || [];
    statement.payments.push(paymentRecord);

    run.totalPaid = roundCurrency(run.totalPaid + input.amount);
    run.totalOutstanding = roundCurrency(Math.max(0, run.totalCommissionPayable - run.totalPaid));
    run.status = run.totalOutstanding <= 0.001 ? 'PAID' : 'PARTIALLY_PAID';

    clonedStore.commissionPayments.push(paymentRecord);
    mockStorage.saveStore(clonedStore);

    return { commissionRun: run, payment: paymentRecord };
  }

  async cancelCommissionRun(commissionRunId: string, reason: string, actor?: User): Promise<CommissionRun> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to cancel commission runs.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot cancel commission runs.');
    }

    if (!reason?.trim()) {
      throw new Error('A cancellation reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    const run = (clonedStore.commissionRuns || []).find((r: CommissionRun) => r.id === commissionRunId);
    if (!run) {
      throw new Error(`Commission run '${commissionRunId}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== run.branchId) {
      throw new Error('Access Denied: Cannot cancel commission run for another branch.');
    }

    if (run.status === 'DRAFT' || run.commissionNumber === 'DRAFT') {
      clonedStore.commissionRuns = (clonedStore.commissionRuns || []).filter((r: CommissionRun) => r.id !== commissionRunId);
      mockStorage.saveStore(clonedStore);
      return run;
    }

    const activePayments = (clonedStore.commissionPayments || []).filter(
      (p: CommissionPayment) => p.commissionRunId === commissionRunId && p.status !== 'REVERSED'
    );
    if (activePayments.length > 0 || (run.totalPaid && run.totalPaid > 0)) {
      throw new Error('Runs with payments cannot be cancelled until all payments are properly reversed.');
    }

    run.status = 'CANCELLED';
    run.cancellationReason = reason.trim();
    run.cancelledAt = mockStorage.getSystemDate();
    run.cancelledByUserId = authenticatedActor.id;
    run.cancelledByName = authenticatedActor.name;

    for (const stmt of run.statements) {
      stmt.status = 'CANCELLED';
    }

    mockStorage.saveStore(clonedStore);
    return run;
  }

  async reverseCommissionPayment(paymentId: string, reason: string, actor?: User): Promise<CommissionPayment> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to reverse commission payments.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot reverse commission payments.');
    }

    if (!reason?.trim()) {
      throw new Error('A reversal reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    const payment = (clonedStore.commissionPayments || []).find((p: CommissionPayment) => p.id === paymentId);
    if (!payment) {
      throw new Error(`Commission payment '${paymentId}' not found.`);
    }
    if (payment.status === 'REVERSED') {
      throw new Error('This commission payment is already reversed.');
    }

    const run = (clonedStore.commissionRuns || []).find((r: CommissionRun) => r.id === payment.commissionRunId);
    if (!run) {
      throw new Error(`Associated commission run '${payment.commissionRunId}' not found.`);
    }
    const statement = run.statements.find((s: CommissionStatementRecord) => s.id === payment.statementId);
    if (!statement) {
      throw new Error(`Associated commission statement '${payment.statementId}' not found.`);
    }

    if (payment.method === 'CASH') {
      if (payment.cashDrawerId) {
        const drawer = clonedStore.cashDrawers.find((d: CashDrawer) => d.id === payment.cashDrawerId);
        if (drawer && drawer.status === 'OPEN') {
          drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer + payment.amount);
          drawer.cashExpensesPaid = roundCurrency(Math.max(0, (drawer.cashExpensesPaid || 0) - payment.amount));
        } else {
          clonedStore.vaultBalances = clonedStore.vaultBalances || {};
          clonedStore.vaultBalances[payment.branchId] = roundCurrency(
            (clonedStore.vaultBalances[payment.branchId] || 0) + payment.amount
          );
        }
      } else {
        clonedStore.vaultBalances = clonedStore.vaultBalances || {};
        clonedStore.vaultBalances[payment.branchId] = roundCurrency(
          (clonedStore.vaultBalances[payment.branchId] || 0) + payment.amount
        );
      }
    } else if (payment.method === 'ONLINE' && payment.onlineAccountId) {
      const account = clonedStore.paymentAccounts.find((a: PaymentAccount) => a.id === payment.onlineAccountId);
      if (account) {
        account.currentBalance = roundCurrency(account.currentBalance + payment.amount);
      }
    }

    payment.status = 'REVERSED';
    payment.reversalReason = reason.trim();
    payment.reversedAt = mockStorage.getSystemDate();
    payment.reversedByUserId = authenticatedActor.id;
    payment.reversedByName = authenticatedActor.name;

    statement.paidAmount = roundCurrency(Math.max(0, statement.paidAmount - payment.amount));
    statement.outstandingAmount = roundCurrency(statement.netCommissionPayable - statement.paidAmount);
    statement.status = statement.paidAmount <= 0.001 ? 'FINALIZED' : 'PARTIALLY_PAID';

    run.totalPaid = roundCurrency(Math.max(0, run.totalPaid - payment.amount));
    run.totalOutstanding = roundCurrency(run.totalCommissionPayable - run.totalPaid);
    run.status = run.totalPaid <= 0.001 ? 'FINALIZED' : 'PARTIALLY_PAID';

    mockStorage.saveStore(clonedStore);
    return payment;
  }

  async getCommissionRuns(branchId: string | 'ALL', actor?: User): Promise<CommissionRun[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to access confidential commission.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access commission run management.');
    }

    const store = mockStorage.getStore();
    let runs = (store.commissionRuns || []).filter((r: CommissionRun) => r.status !== 'DRAFT' && r.commissionNumber !== 'DRAFT');

    if (authenticatedActor.role === 'ADMIN') {
      runs = runs.filter((r: CommissionRun) => r.branchId === authenticatedActor.branchId);
    } else if (branchId !== 'ALL') {
      runs = runs.filter((r: CommissionRun) => r.branchId === branchId);
    }

    return runs.slice().sort((a: CommissionRun, b: CommissionRun) => b.startDate.localeCompare(a.startDate));
  }

  async getStaffPersonalCommissions(actor?: User): Promise<CommissionStatementRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const staff = store.staff.find(
      (s: StaffMember) =>
        s.linkedUserId === authenticatedActor.id ||
        s.linkedUserEmail === authenticatedActor.email ||
        s.id === authenticatedActor.id
    );
    if (!staff) {
      throw new Error('Staff record associated with the authenticated user could not be found.');
    }

    const results: CommissionStatementRecord[] = [];
    for (const run of store.commissionRuns || []) {
      if (run.status !== 'DRAFT' && run.status !== 'CANCELLED') {
        for (const stmt of run.statements || []) {
          if (stmt.staffId === staff.id) {
            results.push({ ...stmt });
          }
        }
      }
    }

    return results.sort((a: CommissionStatementRecord, b: CommissionStatementRecord) => b.startDate.localeCompare(a.startDate));
  }

  // ==========================================
  // PHASE 3F: TIP SEQUENCE NUMBER GENERATORS
  // ==========================================

  private getNextTipReceiptNumber(store: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(store, 'TR'); }

  private getNextTipAllocationNumber(store: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(store, 'TA'); }

  private getNextTipPayoutNumber(store: StorageSchema, branch: Branch, yearStr: string): string { return nextReference(store, 'TP'); }

  // ==========================================
  // PHASE 3F: TIP COLLECTION, ALLOCATION & PAYOUTS
  // ==========================================

  async getTipReceipts(
    branchId: string | 'ALL',
    filters?: { startDate?: string; endDate?: string; method?: string; status?: string; staffId?: string; search?: string },
    actor?: User
  ): Promise<TipReceiptRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to view or manage staff tip allocations.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access branch tip receipts.');
    }

    const store = mockStorage.getStore();
    let receipts = store.tipReceipts || [];

    if (authenticatedActor.role === 'ADMIN') {
      receipts = receipts.filter((r) => r.branchId === authenticatedActor.branchId);
    } else if (branchId !== 'ALL') {
      receipts = receipts.filter((r) => r.branchId === branchId);
    }

    if (filters?.startDate) {
      receipts = receipts.filter((r) => r.collectionDate >= filters.startDate!);
    }
    if (filters?.endDate) {
      receipts = receipts.filter((r) => r.collectionDate <= filters.endDate!);
    }
    if (filters?.method && filters.method !== 'ALL') {
      receipts = receipts.filter((r) => r.method === filters.method);
    }
    if (filters?.status && filters.status !== 'ALL') {
      receipts = receipts.filter((r) => r.status === filters.status);
    }
    if (filters?.staffId && filters.staffId !== 'ALL') {
      receipts = receipts.filter((r) => r.directStaffId === filters.staffId);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      receipts = receipts.filter(
        (r) =>
          r.receiptNumber.toLowerCase().includes(q) ||
          r.invoiceNumber.toLowerCase().includes(q) ||
          r.clientName.toLowerCase().includes(q) ||
          (r.directStaffName && r.directStaffName.toLowerCase().includes(q))
      );
    }

    return receipts.slice().sort((a, b) => {
      if (a.collectionDate !== b.collectionDate) return b.collectionDate.localeCompare(a.collectionDate);
      return b.receiptNumber.localeCompare(a.receiptNumber);
    });
  }

  async allocateTips(
    input: AllocateTipsInput,
    actor?: User
  ): Promise<{ tipReceipt: TipReceiptRecord; allocations: TipAllocationRecord[] }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants cannot allocate staff tips.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot allocate tips.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.tipReceipts = clonedStore.tipReceipts || [];
    clonedStore.tipAllocations = clonedStore.tipAllocations || [];

    const receiptIndex = clonedStore.tipReceipts.findIndex((r) => r.id === input.tipReceiptId);
    if (receiptIndex === -1) {
      throw new Error(`Tip receipt '${input.tipReceiptId}' not found.`);
    }
    const receipt = clonedStore.tipReceipts[receiptIndex];

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== receipt.branchId) {
      throw new Error('Access Denied: Cannot allocate tips for another branch.');
    }

    if (receipt.status === 'FULLY_ALLOCATED' || receipt.unallocatedAmount <= 0.001) {
      throw new Error(`Tip receipt '${receipt.receiptNumber}' is already fully allocated.`);
    }

    if (!input.recipients || input.recipients.length === 0) {
      throw new Error('At least one recipient staff member must be selected for tip allocation.');
    }

    // Validate recipients and amounts
    let totalAllocated = 0;
    for (const r of input.recipients) {
      if (typeof r.amount !== 'number' || isNaN(r.amount) || r.amount <= 0) {
        throw new Error('Every recipient allocation amount must be a positive finite number.');
      }
      totalAllocated = roundCurrency(totalAllocated + r.amount);

      const staff = clonedStore.staff.find((s) => s.id === r.staffId);
      if (!staff || !staff.isActive || staff.branchId !== receipt.branchId) {
        throw new Error(`Staff recipient '${r.staffId}' is invalid, inactive, or belongs to another branch.`);
      }
    }

    if (totalAllocated > receipt.unallocatedAmount + 0.001) {
      throw new Error(
        `Total allocation amount (${totalAllocated}) exceeds available unallocated tip balance (${receipt.unallocatedAmount}).`
      );
    }

    const branch = clonedStore.branches.find((b) => b.id === receipt.branchId)!;
    const yearStr = (receipt.collectionDate || mockStorage.getSystemDate()).slice(0, 4);
    const systemDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const newAllocations: TipAllocationRecord[] = [];

    for (const r of input.recipients) {
      const staff = clonedStore.staff.find((s) => s.id === r.staffId)!;
      const allocNumber = this.getNextTipAllocationNumber(clonedStore, branch, yearStr);
      const allocId = `tip-alloc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const allocationRecord: TipAllocationRecord = {
        id: allocId,
        allocationNumber: allocNumber,
        branchId: receipt.branchId,
        tipReceiptId: receipt.id,
        tipReceiptNumber: receipt.receiptNumber,
        invoiceId: receipt.invoiceId,
        invoiceNumber: receipt.invoiceNumber,
        paymentId: receipt.paymentId,
        staffId: staff.id,
        staffName: staff.name,
        staffRole: staff.roleTitle || staff.designation,
        amount: roundCurrency(r.amount),
        paidAmount: 0,
        outstandingAmount: roundCurrency(r.amount),
        allocationType: input.allocationType,
        allocationDate: systemDate,
        allocationTime: timeStr,
        allocatedByUserId: authenticatedActor.id,
        allocatedByName: authenticatedActor.name,
        status: 'UNPAID',
        notes: input.notes,
      };

      newAllocations.push(allocationRecord);
      clonedStore.tipAllocations.push(allocationRecord);
    }

    receipt.allocatedAmount = roundCurrency(receipt.allocatedAmount + totalAllocated);
    receipt.unallocatedAmount = roundCurrency(Math.max(0, receipt.collectedAmount - receipt.allocatedAmount));
    receipt.status = receipt.unallocatedAmount <= 0.001 ? 'FULLY_ALLOCATED' : 'PARTIALLY_ALLOCATED';

    clonedStore.tipReceipts[receiptIndex] = receipt;
    mockStorage.saveStore(clonedStore);

    return { tipReceipt: receipt, allocations: newAllocations };
  }

  async cancelTipAllocation(
    allocationId: string,
    reason: string,
    actor?: User
  ): Promise<{ cancelledAllocation: TipAllocationRecord; tipReceipt: TipReceiptRecord }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants cannot cancel tip allocations.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot cancel tip allocations.');
    }
    if (!reason || !reason.trim()) {
      throw new Error('A cancellation reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.tipAllocations = clonedStore.tipAllocations || [];
    clonedStore.tipReceipts = clonedStore.tipReceipts || [];

    const allocIndex = clonedStore.tipAllocations.findIndex((a) => a.id === allocationId);
    if (allocIndex === -1) {
      throw new Error(`Tip allocation '${allocationId}' not found.`);
    }
    const allocation = clonedStore.tipAllocations[allocIndex];

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== allocation.branchId) {
      throw new Error('Access Denied: Cannot cancel allocation for another branch.');
    }

    if (allocation.status === 'CANCELLED') {
      throw new Error('This tip allocation is already cancelled.');
    }

    if (allocation.paidAmount > 0.001) {
      throw new Error(
        `Cannot cancel tip allocation with active payouts (${allocation.paidAmount} PKR paid). Linked payouts must be reversed first.`
      );
    }

    const receiptIndex = clonedStore.tipReceipts.findIndex((r) => r.id === allocation.tipReceiptId);
    if (receiptIndex === -1) {
      throw new Error(`Funding tip receipt '${allocation.tipReceiptId}' not found.`);
    }
    const receipt = clonedStore.tipReceipts[receiptIndex];

    const systemDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    allocation.status = 'CANCELLED';
    allocation.cancelledAt = `${systemDate}T${timeStr}`;
    allocation.cancelledByUserId = authenticatedActor.id;
    allocation.cancelledByName = authenticatedActor.name;
    allocation.cancelReason = reason.trim();

    // Restore unallocated amount back to funding receipt
    receipt.allocatedAmount = roundCurrency(Math.max(0, receipt.allocatedAmount - allocation.amount));
    receipt.unallocatedAmount = roundCurrency(receipt.collectedAmount - receipt.allocatedAmount);
    receipt.status = receipt.allocatedAmount <= 0.001 ? 'UNALLOCATED' : 'PARTIALLY_ALLOCATED';

    clonedStore.tipAllocations[allocIndex] = allocation;
    clonedStore.tipReceipts[receiptIndex] = receipt;
    mockStorage.saveStore(clonedStore);

    return { cancelledAllocation: allocation, tipReceipt: receipt };
  }

  async recordTipPayout(
    input: RecordTipPayoutInput,
    actor?: User
  ): Promise<{ payout: TipPayoutRecord; allocation: TipAllocationRecord }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to disburse tip payouts.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot disburse tip payouts.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.tipAllocations = clonedStore.tipAllocations || [];
    clonedStore.tipPayouts = clonedStore.tipPayouts || [];

    const allocIndex = clonedStore.tipAllocations.findIndex((a) => a.id === input.allocationId);
    if (allocIndex === -1) {
      throw new Error(`Tip allocation '${input.allocationId}' not found.`);
    }
    const allocation = clonedStore.tipAllocations[allocIndex];

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== allocation.branchId) {
      throw new Error('Access Denied: Cannot record tip payout for another branch.');
    }

    if (allocation.status === 'PAID') {
      throw new Error(`Tip allocation '${allocation.allocationNumber}' is already fully paid.`);
    }
    if (allocation.status === 'CANCELLED') {
      throw new Error(`Cannot disburse payout against a cancelled tip allocation.`);
    }

    if (typeof input.amount !== 'number' || isNaN(input.amount) || input.amount <= 0) {
      throw new Error('Payout amount must be greater than zero.');
    }
    if (input.amount > allocation.outstandingAmount + 0.001) {
      throw new Error(
        `Payout amount (${input.amount}) exceeds outstanding allocation balance (${allocation.outstandingAmount}).`
      );
    }

    // Check idempotency if key provided
    if (input.idempotencyKey) {
      const existing = (clonedStore.idempotencyRecords || []).find((r) => r.key === input.idempotencyKey);
      if (existing) {
        return existing.result;
      }
    }

    let cashDrawerId: string | undefined;
    let onlineAccountName: string | undefined;

    if (input.method === 'CASH') {
      const drawer = clonedStore.cashDrawers.find(
        (d: CashDrawer) => d.branchId === allocation.branchId && d.custodianUserId === authenticatedActor.id && d.status === 'OPEN'
      );
      if (!drawer) {
        throw new Error('Cash tip payout requires an OPEN cash drawer assigned to you in this branch.');
      }
      if (drawer.expectedInDrawer < input.amount) {
        throw new Error(
          `Insufficient cash float in drawer. Available: ${drawer.expectedInDrawer}, Required: ${input.amount}`
        );
      }
      drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer - input.amount);
      drawer.cashExpensesPaid = roundCurrency((drawer.cashExpensesPaid || 0) + input.amount);
      cashDrawerId = drawer.id;
    } else if (input.method === 'ONLINE') {
      if (!input.onlineAccountId) {
        throw new Error('Payment account must be selected for online tip payout.');
      }
      const account = clonedStore.paymentAccounts.find(
        (a: PaymentAccount) => a.id === input.onlineAccountId && a.branchId === allocation.branchId && a.isActive
      );
      if (!account) {
        throw new Error('Selected payment account is invalid, inactive, or belongs to a different branch.');
      }
      if (account.currentBalance < input.amount) {
        throw new Error(
          `Insufficient funds in account '${account.name}'. Available: ${account.currentBalance}, Required: ${input.amount}`
        );
      }
      account.currentBalance = roundCurrency(account.currentBalance - input.amount);
      onlineAccountName = account.name;
    }

    const receipt = (clonedStore.tipReceipts || []).find((r) => r.id === allocation.tipReceiptId);
    const branch = clonedStore.branches.find((b) => b.id === allocation.branchId)!;
    const yearStr = mockStorage.getSystemDate().slice(0, 4);
    const payoutNumber = this.getNextTipPayoutNumber(clonedStore, branch, yearStr);
    const payoutId = `tip-pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const systemDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const payoutRecord: TipPayoutRecord = {
      id: payoutId,
      payoutNumber,
      branchId: allocation.branchId,
      staffId: allocation.staffId,
      staffName: allocation.staffName,
      allocationId: allocation.id,
      allocationNumber: allocation.allocationNumber,
      tipReceiptId: allocation.tipReceiptId,
      amount: roundCurrency(input.amount),
      method: input.method,
      cashDrawerId,
      onlineAccountId: input.onlineAccountId,
      onlineAccountName,
      collectionMethod: receipt?.method || 'CASH',
      collectionPaymentAccountName: receipt?.paymentAccountName,
      payoutDate: systemDate,
      payoutTime: timeStr,
      paidByUserId: authenticatedActor.id,
      paidByName: authenticatedActor.name,
      status: 'COMPLETED',
      reference: input.reference || '',
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
    };

    allocation.paidAmount = roundCurrency(allocation.paidAmount + input.amount);
    allocation.outstandingAmount = roundCurrency(Math.max(0, allocation.amount - allocation.paidAmount));
    allocation.status = allocation.outstandingAmount <= 0.001 ? 'PAID' : 'PARTIALLY_PAID';

    clonedStore.tipPayouts.push(payoutRecord);
    clonedStore.tipAllocations[allocIndex] = allocation;

    if (input.idempotencyKey) {
      clonedStore.idempotencyRecords = clonedStore.idempotencyRecords || [];
      clonedStore.idempotencyRecords.push({
        key: input.idempotencyKey,
        operation: 'EXPENSE_POSTING' as any,
        branchId: allocation.branchId,
        actorId: authenticatedActor.id,
        payloadFingerprint: JSON.stringify(input),
        result: { payout: payoutRecord, allocation },
        createdAt: new Date().toISOString(),
      });
    }

    mockStorage.saveStore(clonedStore);
    return { payout: payoutRecord, allocation };
  }

  async reverseTipPayout(
    input: ReverseTipPayoutInput,
    actor?: User
  ): Promise<{ reversedPayout: TipPayoutRecord; allocation: TipAllocationRecord }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants cannot reverse tip payouts.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot reverse tip payouts.');
    }
    if (!input.reversalReason || !input.reversalReason.trim()) {
      throw new Error('A reversal reason is required.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(mockStorage.getStore()));
    clonedStore.tipPayouts = clonedStore.tipPayouts || [];
    clonedStore.tipAllocations = clonedStore.tipAllocations || [];

    const payoutIndex = clonedStore.tipPayouts.findIndex((p) => p.id === input.payoutId);
    if (payoutIndex === -1) {
      throw new Error(`Tip payout '${input.payoutId}' not found.`);
    }
    const payout = clonedStore.tipPayouts[payoutIndex];

    if (authenticatedActor.role === 'ADMIN' && authenticatedActor.branchId !== payout.branchId) {
      throw new Error('Access Denied: Cannot reverse tip payout for another branch.');
    }

    if (payout.status === 'REVERSED') {
      throw new Error('This tip payout is already reversed.');
    }

    const allocIndex = clonedStore.tipAllocations.findIndex((a) => a.id === payout.allocationId);
    if (allocIndex === -1) {
      throw new Error(`Tip allocation '${payout.allocationId}' not found.`);
    }
    const allocation = clonedStore.tipAllocations[allocIndex];

    let receivingDrawerId: string | undefined;

    if (payout.method === 'CASH') {
      const origDrawer = clonedStore.cashDrawers.find((d: CashDrawer) => d.id === payout.cashDrawerId);
      if (origDrawer && origDrawer.status === 'OPEN') {
        // Reimburse original drawer directly
        origDrawer.expectedInDrawer = roundCurrency(origDrawer.expectedInDrawer + payout.amount);
        origDrawer.cashExpensesPaid = roundCurrency(Math.max(0, (origDrawer.cashExpensesPaid || 0) - payout.amount));
        receivingDrawerId = origDrawer.id;
      } else {
        // Original drawer is closed or settled: require explicit receiving drawer
        if (!input.receivingDrawerId) {
          throw new Error(
            'The original drawer for this cash payout is closed. An active OPEN receiving drawer in this branch must be selected for cash reimbursement.'
          );
        }
        const recDrawer = clonedStore.cashDrawers.find(
          (d: CashDrawer) => d.id === input.receivingDrawerId && d.branchId === payout.branchId && d.status === 'OPEN'
        );
        if (!recDrawer) {
          throw new Error('Selected receiving drawer is invalid, closed, or belongs to another branch.');
        }
        recDrawer.expectedInDrawer = roundCurrency(recDrawer.expectedInDrawer + payout.amount);
        recDrawer.cashExpensesPaid = roundCurrency(Math.max(0, (recDrawer.cashExpensesPaid || 0) - payout.amount));
        receivingDrawerId = recDrawer.id;
      }
    } else if (payout.method === 'ONLINE') {
      const account = clonedStore.paymentAccounts.find((a: PaymentAccount) => a.id === payout.onlineAccountId);
      if (account) {
        account.currentBalance = roundCurrency(account.currentBalance + payout.amount);
      }
    }

    const systemDate = mockStorage.getSystemDate();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    payout.status = 'REVERSED';
    payout.reversalReason = input.reversalReason.trim();
    payout.reversedAt = `${systemDate}T${timeStr}`;
    payout.reversalDate = systemDate;
    payout.reversedByUserId = authenticatedActor.id;
    payout.reversedByName = authenticatedActor.name;
    payout.reversalReceivingDrawerId = receivingDrawerId;

    allocation.paidAmount = roundCurrency(Math.max(0, allocation.paidAmount - payout.amount));
    allocation.outstandingAmount = roundCurrency(allocation.amount - allocation.paidAmount);
    allocation.status = allocation.paidAmount <= 0.001 ? 'UNPAID' : 'PARTIALLY_PAID';

    clonedStore.tipPayouts[payoutIndex] = payout;
    clonedStore.tipAllocations[allocIndex] = allocation;
    mockStorage.saveStore(clonedStore);

    return { reversedPayout: payout, allocation };
  }

  async getTipAllocations(
    branchId: string | 'ALL',
    filters?: { startDate?: string; endDate?: string; staffId?: string; status?: string; search?: string },
    actor?: User
  ): Promise<TipAllocationRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to view tip allocations.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access branch tip allocations.');
    }

    const store = mockStorage.getStore();
    let allocations = store.tipAllocations || [];

    if (authenticatedActor.role === 'ADMIN') {
      allocations = allocations.filter((a) => a.branchId === authenticatedActor.branchId);
    } else if (branchId !== 'ALL') {
      allocations = allocations.filter((a) => a.branchId === branchId);
    }

    if (filters?.startDate) {
      allocations = allocations.filter((a) => a.allocationDate >= filters.startDate!);
    }
    if (filters?.endDate) {
      allocations = allocations.filter((a) => a.allocationDate <= filters.endDate!);
    }
    if (filters?.staffId && filters.staffId !== 'ALL') {
      allocations = allocations.filter((a) => a.staffId === filters.staffId);
    }
    if (filters?.status && filters.status !== 'ALL') {
      allocations = allocations.filter((a) => a.status === filters.status);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      allocations = allocations.filter(
        (a) =>
          a.allocationNumber.toLowerCase().includes(q) ||
          a.tipReceiptNumber.toLowerCase().includes(q) ||
          a.invoiceNumber.toLowerCase().includes(q) ||
          a.staffName.toLowerCase().includes(q)
      );
    }

    return allocations.slice().sort((a, b) => {
      if (a.allocationDate !== b.allocationDate) return b.allocationDate.localeCompare(a.allocationDate);
      return b.allocationNumber.localeCompare(a.allocationNumber);
    });
  }

  async getTipPayouts(
    branchId: string | 'ALL',
    filters?: { startDate?: string; endDate?: string; staffId?: string; method?: string; status?: string },
    actor?: User
  ): Promise<TipPayoutRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to view tip payouts.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access branch tip payouts.');
    }

    const store = mockStorage.getStore();
    let payouts = store.tipPayouts || [];

    if (authenticatedActor.role === 'ADMIN') {
      payouts = payouts.filter((p) => p.branchId === authenticatedActor.branchId);
    } else if (branchId !== 'ALL') {
      payouts = payouts.filter((p) => p.branchId === branchId);
    }

    if (filters?.startDate) {
      payouts = payouts.filter((p) => p.payoutDate >= filters.startDate!);
    }
    if (filters?.endDate) {
      payouts = payouts.filter((p) => p.payoutDate <= filters.endDate!);
    }
    if (filters?.staffId && filters.staffId !== 'ALL') {
      payouts = payouts.filter((p) => p.staffId === filters.staffId);
    }
    if (filters?.method && filters.method !== 'ALL') {
      payouts = payouts.filter((p) => p.method === filters.method);
    }
    if (filters?.status && filters.status !== 'ALL') {
      payouts = payouts.filter((p) => p.status === filters.status);
    }

    return payouts.slice().sort((a, b) => {
      if (a.payoutDate !== b.payoutDate) return b.payoutDate.localeCompare(a.payoutDate);
      return b.payoutNumber.localeCompare(a.payoutNumber);
    });
  }

  async getTipsStatement(
    branchId: string | 'ALL',
    startDate?: string,
    endDate?: string,
    filters?: { staffId?: string; paymentSource?: string },
    actor?: User
  ): Promise<{ summary: TipsStatementSummary; receipts: TipReceiptRecord[]; allocations: TipAllocationRecord[]; payouts: TipPayoutRecord[] }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to access confidential tip statements.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access management tip statements.');
    }

    const store = mockStorage.getStore();
    const effectiveBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;

    let allBranchReceipts = (store.tipReceipts || []).filter((r) => effectiveBranchId === 'ALL' || r.branchId === effectiveBranchId);
    let allBranchAllocations = (store.tipAllocations || []).filter((a) => effectiveBranchId === 'ALL' || a.branchId === effectiveBranchId);
    let allBranchPayouts = (store.tipPayouts || []).filter((p) => effectiveBranchId === 'ALL' || p.branchId === effectiveBranchId);

    const sDate = startDate || '2000-01-01';
    const eDate = endDate || '2099-12-31';

    // 1. Opening liability: net tips collected prior to startDate minus net payouts prior to startDate
    const priorReceipts = allBranchReceipts.filter((r) => r.collectionDate < sDate);
    const priorDisbursements = allBranchPayouts
      .filter((p) => p.payoutDate < sDate)
      .reduce((sum, p) => sum + p.amount, 0);
    const priorReversals = allBranchPayouts
      .filter((p) => {
        const revDate = p.reversalDate || (p.reversedAt ? p.reversedAt.slice(0, 10) : undefined);
        return p.status === 'REVERSED' && !!revDate && revDate < sDate;
      })
      .reduce((sum, p) => sum + p.amount, 0);
    const priorNetPayouts = roundCurrency(priorDisbursements - priorReversals);

    const openingCollected = priorReceipts.reduce((sum, r) => sum + r.collectedAmount, 0);
    const openingLiability = roundCurrency(Math.max(0, openingCollected - priorNetPayouts));

    // 2. Filter records within date window
    let periodReceipts = allBranchReceipts.filter((r) => r.collectionDate >= sDate && r.collectionDate <= eDate);
    let periodAllocations = allBranchAllocations.filter((a) => a.allocationDate >= sDate && a.allocationDate <= eDate);

    // Period disbursements: payouts whose disbursement happened in [sDate, eDate]
    // Period reversals: payouts whose reversal happened in [sDate, eDate]
    let periodDisbursementsList = allBranchPayouts.filter((p) => p.payoutDate >= sDate && p.payoutDate <= eDate);
    let periodReversalsList = allBranchPayouts.filter((p) => {
      const revDate = p.reversalDate || (p.reversedAt ? p.reversedAt.slice(0, 10) : undefined);
      return p.status === 'REVERSED' && !!revDate && revDate >= sDate && revDate <= eDate;
    });

    // Payout records to display in period table: all payouts with disbursement OR reversal in [sDate, eDate]
    const periodPayoutsMap = new Map<string, TipPayoutRecord>();
    periodDisbursementsList.forEach((p) => periodPayoutsMap.set(p.id, p));
    periodReversalsList.forEach((p) => periodPayoutsMap.set(p.id, p));
    let periodPayouts = Array.from(periodPayoutsMap.values());

    // Apply optional staff and payment source filters
    if (filters?.staffId && filters.staffId !== 'ALL') {
      periodAllocations = periodAllocations.filter((a) => a.staffId === filters.staffId);
      periodPayouts = periodPayouts.filter((p) => p.staffId === filters.staffId);
      periodDisbursementsList = periodDisbursementsList.filter((p) => p.staffId === filters.staffId);
      periodReversalsList = periodReversalsList.filter((p) => p.staffId === filters.staffId);
      periodReceipts = periodReceipts.filter((r) => r.directStaffId === filters.staffId);
    }
    if (filters?.paymentSource && filters.paymentSource !== 'ALL') {
      const targetMethod = filters.paymentSource === 'ONLINE_ACCOUNT' ? 'ONLINE' : filters.paymentSource;
      periodReceipts = periodReceipts.filter((r) => r.method === filters.paymentSource);
      periodPayouts = periodPayouts.filter((p) => p.method === targetMethod);
      periodDisbursementsList = periodDisbursementsList.filter((p) => p.method === targetMethod);
      periodReversalsList = periodReversalsList.filter((p) => p.method === targetMethod);
    }

    const netTipsCollected = roundCurrency(periodReceipts.reduce((sum, r) => sum + r.collectedAmount, 0));
    const grossDisbursed = periodDisbursementsList.reduce((sum, p) => sum + p.amount, 0);
    const grossReversed = periodReversalsList.reduce((sum, p) => sum + p.amount, 0);
    const netPayouts = roundCurrency(grossDisbursed - grossReversed);

    // Closing Liability = Opening + Net Collections - Net Payouts
    const closingLiability = roundCurrency(openingLiability + netTipsCollected - netPayouts);

    // 3. Unallocated & Allocated Unpaid as of cutoff eDate
    const activeAllocationsAsOfEdate = allBranchAllocations.filter(
      (a) => a.allocationDate <= eDate && a.status !== 'CANCELLED'
    );
    const allocatedUnpaidTips = roundCurrency(
      activeAllocationsAsOfEdate.reduce((sum, a) => {
        const allocDisbursements = allBranchPayouts
          .filter((p) => p.allocationId === a.id && p.payoutDate <= eDate)
          .reduce((s, p) => s + p.amount, 0);
        const allocReversals = allBranchPayouts
          .filter((p) => {
            const revDate = p.reversalDate || (p.reversedAt ? p.reversedAt.slice(0, 10) : undefined);
            return p.allocationId === a.id && p.status === 'REVERSED' && !!revDate && revDate <= eDate;
          })
          .reduce((s, p) => s + p.amount, 0);
        const netPaidAsOfEdate = Math.max(0, allocDisbursements - allocReversals);
        const outstandingAsOfEdate = Math.max(0, a.amount - netPaidAsOfEdate);
        return sum + outstandingAsOfEdate;
      }, 0)
    );

    const activeReceiptsAsOfEdate = allBranchReceipts.filter((r) => r.collectionDate <= eDate);
    const unallocatedTips = roundCurrency(
      activeReceiptsAsOfEdate.reduce((sum, r) => {
        const allocatedForReceipt = allBranchAllocations
          .filter((a) => a.tipReceiptId === r.id && a.allocationDate <= eDate && a.status !== 'CANCELLED')
          .reduce((s, a) => s + a.amount, 0);
        const unallocatedAsOfEdate = Math.max(0, r.collectedAmount - allocatedForReceipt);
        return sum + unallocatedAsOfEdate;
      }, 0)
    );

    const summary: TipsStatementSummary = {
      openingLiability,
      netTipsCollected,
      netPayouts,
      closingLiability,
      unallocatedTips,
      allocatedUnpaidTips,
      receiptsCount: periodReceipts.length,
      allocationsCount: periodAllocations.length,
      payoutsCount: periodPayouts.length,
    };

    return {
      summary,
      receipts: periodReceipts.sort((a, b) => b.collectionDate.localeCompare(a.collectionDate)),
      allocations: periodAllocations.sort((a, b) => b.allocationDate.localeCompare(a.allocationDate)),
      payouts: periodPayouts.sort((a, b) => b.payoutDate.localeCompare(a.payoutDate)),
    };
  }

  async getStaffPersonalTips(actor?: User): Promise<{
    summary: { totalAllocated: number; totalPaid: number; totalOutstanding: number };
    allocations: TipAllocationRecord[];
    payouts: TipPayoutRecord[];
  }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const staff = store.staff.find(
      (s: StaffMember) =>
        s.linkedUserId === authenticatedActor.id ||
        s.linkedUserEmail === authenticatedActor.email ||
        s.id === authenticatedActor.id
    );
    if (!staff) {
      throw new Error('Staff record associated with the authenticated user could not be found.');
    }

    const myAllocations = (store.tipAllocations || [])
      .filter((a) => a.staffId === staff.id && a.status !== 'CANCELLED')
      .sort((a, b) => b.allocationDate.localeCompare(a.allocationDate));

    const myPayouts = (store.tipPayouts || [])
      .filter((p) => p.staffId === staff.id)
      .sort((a, b) => b.payoutDate.localeCompare(a.payoutDate));

    const totalAllocated = roundCurrency(myAllocations.reduce((sum, a) => sum + a.amount, 0));
    const totalPaid = roundCurrency(
      myPayouts.filter((p) => p.status === 'COMPLETED').reduce((sum, p) => sum + p.amount, 0)
    );
    const totalOutstanding = roundCurrency(Math.max(0, totalAllocated - totalPaid));

    return {
      summary: { totalAllocated, totalPaid, totalOutstanding },
      allocations: myAllocations,
      payouts: myPayouts,
    };
  }

  // ==========================================
  // PHASE 3F: STAFF PERFORMANCE & DRILL-DOWN
  // ==========================================

  async getStaffPerformanceReport(
    branchId: string | 'ALL',
    startDate: string,
    endDate: string,
    filters?: { staffId?: string; categoryId?: string; serviceId?: string; packageId?: string },
    actor?: User
  ): Promise<StaffPerformanceRecord[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants are not authorized to view staff performance.');
    }
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access management staff performance.');
    }

    const store = mockStorage.getStore();
    const effectiveBranchId = authenticatedActor.role === 'ADMIN' ? authenticatedActor.branchId : branchId;

    let targetStaffList = store.staff.filter((s) => effectiveBranchId === 'ALL' || s.branchId === effectiveBranchId);
    if (filters?.staffId && filters.staffId !== 'ALL') {
      targetStaffList = targetStaffList.filter((s) => s.id === filters.staffId);
    }

    return this.computeStaffPerformance(targetStaffList, effectiveBranchId, startDate, endDate, filters);
  }

  private computeStaffPerformance(
    targetStaffList: StaffMember[],
    effectiveBranchId: string | 'ALL',
    startDate: string,
    endDate: string,
    filters?: { categoryId?: string; serviceId?: string; packageId?: string }
  ): StaffPerformanceRecord[] {
    const store = mockStorage.getStore();

    // Candidate completed invoices in date range (exclude voided)
    const validInvoices = store.invoices.filter((inv) => {
      if (effectiveBranchId !== 'ALL' && inv.branchId !== effectiveBranchId) return false;
      if (inv.date < startDate || inv.date > endDate) return false;
      const isVoided = !!(inv.notes && inv.notes.toLowerCase().includes('void'));
      if (isVoided) return false;
      // Exclude dues-only collections (they don't create new service performance)
      if ((inv.lineItems || []).length === 0) return false;
      return true;
    });

    const results: StaffPerformanceRecord[] = [];

    for (const st of targetStaffList) {
      const branch = store.branches.find((b) => b.id === st.branchId);
      const detailedServices: StaffPerformanceServiceItem[] = [];
      const clientSet = new Set<string>();

      let directServicesCount = 0;
      let packageComponentsCount = 0;
      let attributedGrossSales = 0;
      let totalDiscountAllocation = 0;
      let attributedNetSales = 0;
      let estimatedCommission = 0;

      // Extract service performance
      for (const inv of validInvoices) {
        for (let itemIdx = 0; itemIdx < (inv.lineItems || []).length; itemIdx++) {
          const item = inv.lineItems[itemIdx];

          // 1. Direct Service
          if (item.type === 'SERVICE' && item.staffId === st.id) {
            if (filters?.serviceId && filters.serviceId !== 'ALL' && (item.itemId || item.id) !== filters.serviceId) {
              continue;
            }

            const qty = item.quantity || 1;
            const lineGross = roundCurrency(item.unitPrice * qty);
            let discAlloc = typeof item.discountAllocated === 'number' ? item.discountAllocated : 0;
            if (!discAlloc && inv.discount && inv.subtotal > 0) {
              discAlloc = roundCurrency((lineGross / inv.subtotal) * inv.discount);
            }
            const netSales = typeof item.netSales === 'number' ? item.netSales : roundCurrency(lineGross - discAlloc);

            const rawRate = typeof item.staffCommissionRate === 'number'
              ? item.staffCommissionRate
              : (typeof (item as any).commissionRate === 'number' ? (item as any).commissionRate : (st.commissionRate || 0));
            const effectiveRate = rawRate > 0 && rawRate <= 1 ? roundCurrency(rawRate * 100) : rawRate;
            const earned = roundCurrency(netSales * (effectiveRate / 100));

            directServicesCount += qty;
            attributedGrossSales = roundCurrency(attributedGrossSales + lineGross);
            totalDiscountAllocation = roundCurrency(totalDiscountAllocation + discAlloc);
            attributedNetSales = roundCurrency(attributedNetSales + netSales);
            estimatedCommission = roundCurrency(estimatedCommission + earned);

            if (inv.clientName && inv.clientName.trim()) {
              clientSet.add(inv.clientId ? inv.clientId : inv.clientName.trim().toLowerCase());
            }

            detailedServices.push({
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              date: inv.date,
              time: inv.time,
              clientName: inv.clientName,
              itemId: item.itemId || item.id,
              serviceName: item.name,
              itemType: 'SERVICE',
              cataloguePrice: lineGross,
              discountAllocated: discAlloc,
              netSales,
              commissionRatePercent: effectiveRate,
              commissionEarned: earned,
            });
          }

          // 2. Bundled Package (Multi-staff divided or legacy component-assigned)
          if (item.type === 'PACKAGE') {
            const comps = item.packageComponents || (item as any).components;
            if (filters?.packageId && filters.packageId !== 'ALL' && (item.itemId || item.id) !== filters.packageId) {
              continue;
            }

            if (item.assignedStaff && item.assignedStaff.length > 0) {
              const staffEntry = item.assignedStaff.find((as: any) => as.staffId === st.id);
              if (staffEntry) {
                const numStaff = item.assignedStaff.length;
                const lineGross = (item.unitPrice || 0) * (item.quantity || 1);
                const lineNet = typeof item.netSales === 'number' ? item.netSales : (lineGross - (item.discountAllocated || 0));
                const lineDisc = item.discountAllocated || 0;

                const customAmount = typeof staffEntry.allocatedAmount === 'number' && staffEntry.allocatedAmount > 0 ? staffEntry.allocatedAmount : null;
                const hasCustom = customAmount !== null;
                const discountRatio = lineGross > 0 ? lineNet / lineGross : 1;
                const staffShareGross: number = hasCustom ? customAmount : roundCurrency(lineGross / numStaff);
                const staffShareNet: number = hasCustom ? roundCurrency(customAmount * discountRatio) : roundCurrency(lineNet / numStaff);
                const staffShareDisc: number = roundCurrency(Math.max(0, staffShareGross - staffShareNet));

                const rawCompRate = typeof staffEntry.staffCommissionRate === 'number'
                  ? staffEntry.staffCommissionRate
                  : (st.commissionRate || 0);
                const effectiveCompRate = rawCompRate > 0 && rawCompRate <= 1 ? roundCurrency(rawCompRate * 100) : rawCompRate;
                const earned = roundCurrency(staffShareNet * (effectiveCompRate / 100));

                packageComponentsCount += 1;
                attributedGrossSales = roundCurrency(attributedGrossSales + staffShareGross);
                totalDiscountAllocation = roundCurrency(totalDiscountAllocation + staffShareDisc);
                attributedNetSales = roundCurrency(attributedNetSales + staffShareNet);
                estimatedCommission = roundCurrency(estimatedCommission + earned);

                if (inv.clientName && inv.clientName.trim()) {
                  clientSet.add(inv.clientId ? inv.clientId : inv.clientName.trim().toLowerCase());
                }

                detailedServices.push({
                  invoiceId: inv.id,
                  invoiceNumber: inv.invoiceNumber,
                  date: inv.date,
                  time: inv.time,
                  clientName: inv.clientName,
                  itemId: item.itemId || item.id || 'pkg',
                  serviceName: `${item.name} (Shared Package - ${(100 / numStaff).toFixed(0)}%)`,
                  itemType: 'PACKAGE_COMPONENT',
                  cataloguePrice: staffShareGross,
                  discountAllocated: staffShareDisc,
                  netSales: staffShareNet,
                  commissionRatePercent: effectiveCompRate,
                  commissionEarned: earned,
                });
              }
            } else if (Array.isArray(comps)) {
              comps.forEach((comp: any, compIdx: number) => {
                if (comp.staffId === st.id) {
                  if (filters?.serviceId && filters.serviceId !== 'ALL' && comp.serviceId !== filters.serviceId) {
                    return;
                  }

                  const compQty = comp.quantity || 1;
                  let allocatedNet = 0;
                  let rawAllocated = comp.allocatedAmount || 0;
                  let compDiscount = 0;

                  if (typeof comp.netAllocatedAmount === 'number') {
                    allocatedNet = comp.netAllocatedAmount;
                    rawAllocated = comp.allocatedAmount || allocatedNet;
                    compDiscount = roundCurrency(Math.max(0, rawAllocated - allocatedNet));
                  } else if (typeof comp.netSales === 'number') {
                    allocatedNet = comp.netSales;
                    rawAllocated = comp.allocatedAmount || allocatedNet;
                    compDiscount = roundCurrency(Math.max(0, rawAllocated - allocatedNet));
                  } else {
                    rawAllocated = comp.allocatedAmount || 0;
                    if (inv.discount && inv.subtotal > 0) {
                      compDiscount = roundCurrency((rawAllocated / inv.subtotal) * inv.discount);
                    }
                    allocatedNet = roundCurrency(rawAllocated - compDiscount);
                  }

                  const rawCompRate = typeof comp.staffCommissionRate === 'number'
                    ? comp.staffCommissionRate
                    : (typeof comp.commissionRate === 'number' ? comp.commissionRate : (st.commissionRate || 0));
                  const effectiveCompRate = rawCompRate > 0 && rawCompRate <= 1 ? roundCurrency(rawCompRate * 100) : rawCompRate;
                  const earned = roundCurrency(allocatedNet * (effectiveCompRate / 100));

                  packageComponentsCount += compQty;
                  attributedGrossSales = roundCurrency(attributedGrossSales + rawAllocated);
                  totalDiscountAllocation = roundCurrency(totalDiscountAllocation + compDiscount);
                  attributedNetSales = roundCurrency(attributedNetSales + allocatedNet);
                  estimatedCommission = roundCurrency(estimatedCommission + earned);

                  if (inv.clientName && inv.clientName.trim()) {
                    clientSet.add(inv.clientId ? inv.clientId : inv.clientName.trim().toLowerCase());
                  }

                  detailedServices.push({
                    invoiceId: inv.id,
                    invoiceNumber: inv.invoiceNumber,
                    date: inv.date,
                    time: inv.time,
                    clientName: inv.clientName,
                    itemId: comp.serviceId || `comp-${compIdx}`,
                    serviceName: `${comp.serviceName} (${item.name})`,
                    itemType: 'PACKAGE_COMPONENT',
                    cataloguePrice: rawAllocated,
                    discountAllocated: compDiscount,
                    netSales: allocatedNet,
                    commissionRatePercent: effectiveCompRate,
                    commissionEarned: earned,
                  });
                }
              });
            }
          }
        }
      }

      // Finalized & Paid Commission
      let finalizedCommission = 0;
      let paidCommission = 0;
      for (const run of store.commissionRuns || []) {
        if (run.status !== 'DRAFT' && run.status !== 'CANCELLED') {
          if (run.startDate <= endDate && run.endDate >= startDate) {
            const stmt = (run.statements || []).find((s) => s.staffId === st.id);
            if (stmt) {
              finalizedCommission = roundCurrency(finalizedCommission + stmt.netCommissionPayable);
              paidCommission = roundCurrency(paidCommission + stmt.paidAmount);
            }
          }
        }
      }

      // Tips metrics
      const staffAllocations = (store.tipAllocations || []).filter(
        (a) => a.staffId === st.id && a.allocationDate >= startDate && a.allocationDate <= endDate && a.status !== 'CANCELLED'
      );
      const allocatedTips = roundCurrency(staffAllocations.reduce((sum, a) => sum + a.amount, 0));

      const staffPayouts = (store.tipPayouts || []).filter(
        (p) => p.staffId === st.id && p.payoutDate >= startDate && p.payoutDate <= endDate
      );
      const paidTips = roundCurrency(
        staffPayouts.filter((p) => p.status === 'COMPLETED').reduce((sum, p) => sum + p.amount, 0)
      );
      const outstandingTips = roundCurrency(Math.max(0, allocatedTips - paidTips));

      // Attendance metrics
      const staffAttendance = (store.attendance || []).filter(
        (a) => a.staffId === st.id && a.date >= startDate && a.date <= endDate
      );
      const workedHours = roundCurrency(staffAttendance.reduce((sum, a) => sum + (a.workedHours || 0), 0));
      const presentDays = staffAttendance.filter((a) => a.status === 'PRESENT').length;
      const latePunchesCount = staffAttendance.filter((a) => a.isLate).length;

      // Overtime metrics
      const staffOvertime = (store.overtime || []).filter(
        (ot) => ot.staffId === st.id && ot.date >= startDate && ot.date <= endDate && ot.status === 'APPROVED'
      );
      const approvedOvertimeMinutes = staffOvertime.reduce((sum, ot) => sum + ot.approvedMinutes, 0);
      const approvedOvertimePay = roundCurrency(staffOvertime.reduce((sum, ot) => sum + (ot.amount || 0), 0));

      results.push({
        staffId: st.id,
        staffName: st.name,
        staffCode: st.employeeCode || `EMP-${st.id.slice(-4).toUpperCase()}`,
        roleTitle: st.roleTitle || st.designation,
        branchId: st.branchId,
        branchName: branch?.name || 'Main Branch',
        directServicesCount,
        packageComponentsCount,
        totalServiceUnits: directServicesCount + packageComponentsCount,
        uniqueClientsCount: clientSet.size,
        attributedGrossSales,
        discountAllocation: totalDiscountAllocation,
        attributedNetSales,
        estimatedCommission,
        finalizedCommission,
        paidCommission,
        allocatedTips,
        paidTips,
        outstandingTips,
        workedHours,
        presentDays,
        latePunchesCount,
        approvedOvertimeMinutes,
        approvedOvertimePay,
        detailedServices: detailedServices.sort((a, b) => b.date.localeCompare(a.date)),
      });
    }

    return results.sort((a, b) => b.attributedNetSales - a.attributedNetSales);
  }

  async getStaffPersonalPerformance(actor?: User, startDate?: string, endDate?: string): Promise<StaffPerformanceRecord> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const staff = store.staff.find(
      (s: StaffMember) =>
        s.linkedUserId === authenticatedActor.id ||
        s.linkedUserEmail === authenticatedActor.email ||
        s.id === authenticatedActor.id
    );
    if (!staff) {
      throw new Error('Staff record associated with the authenticated user could not be found.');
    }

    const sDate = startDate || mockStorage.getSystemDate().slice(0, 7) + '-01';
    const eDate = endDate || mockStorage.getSystemDate();

    const report = this.computeStaffPerformance([staff], staff.branchId, sDate, eDate, {});

    if (report.length === 0) {
      const branch = store.branches.find((b) => b.id === staff.branchId);
      return {
        staffId: staff.id,
        staffName: staff.name,
        staffCode: staff.employeeCode || `EMP-${staff.id.slice(-4).toUpperCase()}`,
        roleTitle: staff.roleTitle || staff.designation,
        branchId: staff.branchId,
        branchName: branch?.name || 'Main Branch',
        directServicesCount: 0,
        packageComponentsCount: 0,
        totalServiceUnits: 0,
        uniqueClientsCount: 0,
        attributedGrossSales: 0,
        discountAllocation: 0,
        attributedNetSales: 0,
        estimatedCommission: 0,
        finalizedCommission: 0,
        paidCommission: 0,
        allocatedTips: 0,
        paidTips: 0,
        outstandingTips: 0,
        workedHours: 0,
        presentDays: 0,
        latePunchesCount: 0,
        approvedOvertimeMinutes: 0,
        approvedOvertimePay: 0,
        detailedServices: [],
      };
    }

    return report[0];
  }

  // ==========================================
  // PHASE 3G: APPOINTMENT SCHEDULING & BOOKING
  // ==========================================

  private getNextAppointmentNumber(clonedStore: StorageSchema, branch: Branch, targetDate: string): string { return nextReference(clonedStore, 'APT'); }

  private validateAndScheduleAppointmentItems(
    store: StorageSchema,
    branchId: string,
    date: string,
    startTimeStr: string,
    rawItems: CreateAppointmentInput['items'],
    excludeAppointmentId?: string
  ): {
    scheduledItems: AppointmentItem[];
    totalDuration: number;
    endTimeStr: string;
    totalPrice: number;
    primaryStaffId: string;
    primaryStaffName: string;
    primaryServiceName: string;
  } {
    if (!rawItems || rawItems.length === 0) {
      throw new Error('At least one service or package must be selected.');
    }

    const startMinutes = parseTimeToMinutes(startTimeStr);
    let currentPointerMinutes = startMinutes;
    let totalPrice = 0;
    const scheduledItems: AppointmentItem[] = [];

    const newStaffIntervals: Array<{
      staffId: string;
      staffName: string;
      startMin: number;
      endMin: number;
    }> = [];

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const lineInstanceId = it.lineInstanceId || `line-${Date.now().toString(36)}-${i}-${Math.random().toString(36).substring(2, 6)}`;

      if (it.type === 'SERVICE') {
        const srv = store.services.find((s) => s.id === it.itemId && s.branchId === branchId);
        if (!srv || !srv.isActive) {
          throw new Error(`Service '${it.itemId}' is inactive or not found in branch catalogue.`);
        }
        if (!it.staffId) {
          throw new Error(`Staff member must be assigned for service '${srv.name}'.`);
        }
        const staff = store.staff.find((st) => st.id === it.staffId && st.branchId === branchId);
        if (!staff || !staff.isActive) {
          throw new Error(`Assigned staff member for service '${srv.name}' is inactive or invalid.`);
        }

        const duration = srv.durationMinutes || 30;
        const itemStart = currentPointerMinutes;
        const itemEnd = itemStart + duration;
        currentPointerMinutes = itemEnd;
        totalPrice = roundCurrency(totalPrice + srv.price);

        scheduledItems.push({
          lineInstanceId,
          type: 'SERVICE',
          itemId: srv.id,
          code: srv.code,
          name: srv.name,
          durationMinutes: duration,
          unitPrice: srv.price,
          staffId: staff.id,
          staffName: staff.name,
          startTime: formatMinutesToTime(itemStart),
          endTime: formatMinutesToTime(itemEnd),
        });

        newStaffIntervals.push({
          staffId: staff.id,
          staffName: staff.name,
          startMin: itemStart,
          endMin: itemEnd,
        });
      } else if (it.type === 'PACKAGE') {
        const pkg = store.packages.find((p) => p.id === it.itemId && p.branchId === branchId);
        if (!pkg || !pkg.isActive) {
          throw new Error(`Package '${it.itemId}' is inactive or not found in branch catalogue.`);
        }
        if (!pkg.components || pkg.components.length === 0) {
          throw new Error(`Package '${pkg.name}' has no configured components.`);
        }

        const pkgStart = currentPointerMinutes;
        let pkgDuration = 0;
        const scheduledComponents: AppointmentPackageComponent[] = [];

        for (let cIdx = 0; cIdx < pkg.components.length; cIdx++) {
          const compDef = pkg.components[cIdx];
          const rawComp = it.packageComponents?.find((c) => c.serviceId === compDef.serviceId);
          let staffId = rawComp?.staffId;
          if (!staffId) {
            if (it.assignedStaff && it.assignedStaff.length > 0) {
              staffId = it.assignedStaff[cIdx % it.assignedStaff.length].staffId;
            } else if (it.staffId) {
              staffId = it.staffId;
            } else {
              throw new Error(`Staff assignment is required for component '${compDef.serviceName}' in package '${pkg.name}'.`);
            }
          }
          const staff = store.staff.find((st) => st.id === staffId && st.branchId === branchId);
          if (!staff || !staff.isActive) {
            throw new Error(`Assigned staff member for component '${compDef.serviceName}' is inactive or invalid.`);
          }

          const compSrv = store.services.find((s) => s.id === compDef.serviceId);
          const compDuration = compSrv?.durationMinutes || 30;
          const compStart = currentPointerMinutes;
          const compEnd = compStart + compDuration;
          currentPointerMinutes = compEnd;
          pkgDuration += compDuration;

          const compInstanceId = rawComp?.componentInstanceId || `comp-${Date.now().toString(36)}-${cIdx}-${Math.random().toString(36).substring(2, 6)}`;

          scheduledComponents.push({
            componentInstanceId: compInstanceId,
            serviceId: compDef.serviceId,
            serviceCode: compDef.serviceCode,
            serviceName: compDef.serviceName,
            durationMinutes: compDuration,
            allocationPercentage: compDef.allocationPercentage,
            staffId: staff.id,
            staffName: staff.name,
            startTime: formatMinutesToTime(compStart),
            endTime: formatMinutesToTime(compEnd),
          });

          newStaffIntervals.push({
            staffId: staff.id,
            staffName: staff.name,
            startMin: compStart,
            endMin: compEnd,
          });
        }

        const pkgEnd = currentPointerMinutes;
        // Package selling price is independent of component count and is NOT multiplied by staff
        totalPrice = roundCurrency(totalPrice + pkg.price);

        const primaryCompStaff = scheduledComponents[0];
        const packageAssignedStaff = it.assignedStaff && it.assignedStaff.length > 0
          ? it.assignedStaff
          : [
              {
                staffId: primaryCompStaff.staffId,
                staffName: primaryCompStaff.staffName,
                staffCommissionRate: store.staff.find((s) => s.id === primaryCompStaff.staffId)?.commissionRate || 0,
              },
            ];

        scheduledItems.push({
          lineInstanceId,
          type: 'PACKAGE',
          itemId: pkg.id,
          code: pkg.code,
          name: pkg.name,
          durationMinutes: pkgDuration,
          unitPrice: pkg.price,
          staffId: packageAssignedStaff[0].staffId,
          staffName: packageAssignedStaff.map((s) => s.staffName).join(', '),
          assignedStaff: packageAssignedStaff,
          startTime: formatMinutesToTime(pkgStart),
          endTime: formatMinutesToTime(pkgEnd),
          packageComponents: scheduledComponents,
        });
      }
    }

    const totalDuration = currentPointerMinutes - startMinutes;
    const endTimeStr = formatMinutesToTime(currentPointerMinutes);

    // Validate leave and shift for each staff member
    for (const interval of newStaffIntervals) {
      const staff = store.staff.find((s) => s.id === interval.staffId)!;

      // Approved leave check
      const onLeave = (store.leaves || []).some(
        (l) => l.staffId === staff.id && date >= l.startDate && date <= l.endDate && l.status === 'APPROVED'
      );
      if (onLeave) {
        throw new Error(`Staff member '${staff.name}' is on approved leave on ${date}. Cannot schedule booking.`);
      }

      // Working schedule check
      if (staff.startTime && staff.endTime) {
        const shiftStart = parseTimeToMinutes(staff.startTime);
        const shiftEnd = parseTimeToMinutes(staff.endTime);
        const isOvernight = staff.isOvernightShift || shiftEnd < shiftStart;

        const startMod = interval.startMin % (24 * 60);
        const endMod = interval.endMin % (24 * 60);

        if (!isOvernight) {
          if (startMod < shiftStart || (interval.endMin > shiftEnd && interval.endMin <= 24 * 60)) {
            throw new Error(`Scheduled time (${formatMinutesToTime(interval.startMin)} - ${formatMinutesToTime(interval.endMin)}) is outside ${staff.name}'s working shift (${staff.startTime} - ${staff.endTime}).`);
          }
        } else {
          const startsValid = startMod >= shiftStart || startMod <= shiftEnd;
          const endsValid = endMod >= shiftStart || endMod <= shiftEnd || interval.endMin >= 24 * 60;
          if (!startsValid && !endsValid) {
            throw new Error(`Scheduled time (${formatMinutesToTime(interval.startMin)} - ${formatMinutesToTime(interval.endMin)}) is outside ${staff.name}'s overnight working shift (${staff.startTime} - ${staff.endTime}).`);
          }
        }
      }
    }

    // Check external conflicts with existing active reservations on this date
    const activeAppointments = (store.appointments || []).filter(
      (a) =>
        a.branchId === branchId &&
        a.date === date &&
        a.status !== 'CANCELLED' &&
        a.status !== 'NO_SHOW' &&
        a.id !== excludeAppointmentId
    );

    for (const apt of activeAppointments) {
      const existingIntervals: Array<{ staffId: string; startMin: number; endMin: number }> = [];

      if (apt.items && apt.items.length > 0) {
        for (const it of apt.items) {
          if (it.type === 'SERVICE') {
            const sMin = it.startTime ? parseTimeToMinutes(it.startTime) : parseTimeToMinutes(apt.startTime || apt.time || '00:00');
            const eMin = it.endTime ? parseTimeToMinutes(it.endTime) : sMin + (it.durationMinutes || 30);
            existingIntervals.push({ staffId: it.staffId, startMin: sMin, endMin: eMin });
          } else if (it.type === 'PACKAGE' && it.packageComponents) {
            for (const c of it.packageComponents) {
              const sMin = c.startTime ? parseTimeToMinutes(c.startTime) : parseTimeToMinutes(apt.startTime || apt.time || '00:00');
              const eMin = c.endTime ? parseTimeToMinutes(c.endTime) : sMin + (c.durationMinutes || 30);
              existingIntervals.push({ staffId: c.staffId, startMin: sMin, endMin: eMin });
            }
          }
        }
      } else if (apt.staffId) {
        const sMin = parseTimeToMinutes(apt.startTime || apt.time || '00:00');
        const eMin = apt.endTime ? parseTimeToMinutes(apt.endTime) : sMin + (apt.durationMinutes || 30);
        existingIntervals.push({ staffId: apt.staffId, startMin: sMin, endMin: eMin });
      }

      for (const newInt of newStaffIntervals) {
        for (const existInt of existingIntervals) {
          if (newInt.staffId === existInt.staffId) {
            if (newInt.startMin < existInt.endMin && newInt.endMin > existInt.startMin) {
              throw new Error(
                `Scheduling Conflict: ${newInt.staffName} is already booked from ${formatMinutesToTime(existInt.startMin)} to ${formatMinutesToTime(existInt.endMin)} on ${date} (Appointment: ${apt.appointmentNumber || apt.id}). Adjacent bookings are allowed, but time slots cannot overlap.`
              );
            }
          }
        }
      }
    }

    const firstItem = scheduledItems[0];
    return {
      scheduledItems,
      totalDuration,
      endTimeStr,
      totalPrice,
      primaryStaffId: firstItem.staffId,
      primaryStaffName: firstItem.staffName,
      primaryServiceName: scheduledItems.map((s) => s.name).join(' + '),
    };
  }

  async getAppointments(
    branchId: string | 'ALL',
    dateOrFilter?: string | {
      startDate?: string;
      endDate?: string;
      date?: string;
      status?: AppointmentStatus;
      staffId?: string;
      clientId?: string;
      search?: string;
    },
    actor?: User
  ): Promise<Appointment[]> {
    let authenticatedActor: User | undefined;
    try {
      authenticatedActor = this.getAuthenticatedActor(actor);
    } catch {
      if (actor) throw new Error('Unauthorized');
    }

    const store = mockStorage.getStore();
    let list = store.appointments || [];

    let targetBranchId = branchId;
    if (authenticatedActor && (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT')) {
      targetBranchId = authenticatedActor.branchId;
    }

    if (targetBranchId !== 'ALL') {
      list = list.filter((a) => a.branchId === targetBranchId);
    }

    if (typeof dateOrFilter === 'string') {
      list = list.filter((a) => a.date === dateOrFilter);
    } else if (dateOrFilter) {
      if (dateOrFilter.date) {
        list = list.filter((a) => a.date === dateOrFilter.date);
      }
      if (dateOrFilter.startDate) {
        list = list.filter((a) => a.date >= dateOrFilter.startDate!);
      }
      if (dateOrFilter.endDate) {
        list = list.filter((a) => a.date <= dateOrFilter.endDate!);
      }
      if (dateOrFilter.status) {
        list = list.filter((a) => a.status === dateOrFilter.status);
      }
      if (dateOrFilter.staffId) {
        list = list.filter((a) => {
          if (a.staffId === dateOrFilter.staffId) return true;
          if (a.items) {
            return a.items.some(
              (it) => it.staffId === dateOrFilter.staffId || it.packageComponents?.some((pc) => pc.staffId === dateOrFilter.staffId)
            );
          }
          return false;
        });
      }
      if (dateOrFilter.clientId) {
        list = list.filter((a) => a.clientId === dateOrFilter.clientId);
      }
      if (dateOrFilter.search) {
        const q = dateOrFilter.search.trim().toLowerCase();
        const normDigits = q.replace(/\D/g, '');
        list = list.filter((a) => {
          const matchName = a.clientName.toLowerCase().includes(q);
          const matchRef = (a.appointmentNumber || a.id).toLowerCase().includes(q);
          const matchPhone = normDigits ? a.clientPhone.replace(/\D/g, '').includes(normDigits) : false;
          return matchName || matchRef || matchPhone;
        });
      }
    }

    return list.sort((a, b) => {
      const dComp = a.date.localeCompare(b.date);
      if (dComp !== 0) return dComp;
      return parseTimeToMinutes(a.startTime || a.time || '00:00') - parseTimeToMinutes(b.startTime || b.time || '00:00');
    });
  }

  async getAppointment(id: string, actor?: User): Promise<Appointment | null> {
    const store = mockStorage.getStore();
    const apt = (store.appointments || []).find((a) => a.id === id);
    if (!apt) return null;
    return { ...apt };
  }

  async createAppointment(input: CreateAppointmentInput, actor?: User): Promise<Appointment> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot book appointments.');
    }
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants cannot book appointments.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit active branch must be selected for appointment booking.');
    }

    const store = mockStorage.getStore();
    const branch = store.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const clientName = input.clientName?.trim();
    if (!clientName) {
      throw new Error('Customer name is required for appointment booking.');
    }

    const clientPhone = input.clientPhone?.trim();
    if (!clientPhone) {
      throw new Error('Customer phone number is required for appointment booking.');
    }
    const normPhone = normalizePhoneDigits(clientPhone);
    if (!normPhone || normPhone.length < 10) {
      throw new Error(`Valid customer phone number (at least 10 digits) is required for appointment booking.`);
    }

    const { scheduledItems, totalDuration, endTimeStr, totalPrice, primaryStaffId, primaryStaffName, primaryServiceName } =
      this.validateAndScheduleAppointmentItems(store, branchId, input.date, input.startTime, input.items);

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.appointments = clonedStore.appointments || [];
    clonedStore.clients = clonedStore.clients || [];

    let client = input.clientId
      ? clonedStore.clients.find((c) => c.id === input.clientId && c.branchId === branchId)
      : undefined;

    if (!client) {
      client = clonedStore.clients.find(
        (c) => c.branchId === branchId && normalizePhoneDigits(c.phone) === normPhone
      );
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const targetDate = mockStorage.getSystemDate();

    if (!client) {
      client = {
        id: `client-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        branchId,
        name: clientName,
        phone: formatPhoneNumber(clientPhone),
        email: input.clientEmail?.trim() || undefined,
        source: input.customerSource || 'WALK_IN',
        sourceDetails: input.customerSourceDetails?.trim() || undefined,
        outstandingBalance: 0,
        totalVisits: 0,
        loyaltyPoints: 0,
        createdAt: targetDate,
        isArchived: false,
      };
      clonedStore.clients.push(client);
    } else {
      if (input.customerSource && !client.source) client.source = input.customerSource;
      if (input.customerSourceDetails && !client.sourceDetails) client.sourceDetails = input.customerSourceDetails.trim();
    }

    const appointmentNumber = this.getNextAppointmentNumber(clonedStore, branch, input.date);
    const appointmentId = `apt-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
    const status: AppointmentStatus = input.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING';

    const newAppointment: Appointment = {
      id: appointmentId,
      appointmentNumber,
      branchId,
      branchName: branch.name,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      clientEmail: client.email || input.clientEmail?.trim(),
      customerSource: client.source || input.customerSource,
      customerSourceDetails: client.sourceDetails || input.customerSourceDetails?.trim(),
      date: input.date,
      startTime: input.startTime,
      endTime: endTimeStr,
      durationMinutes: totalDuration,
      items: scheduledItems,
      price: totalPrice,
      status,
      billingStatus: 'UNBILLED',
      notes: input.notes?.trim() || undefined,

      // Legacy compatibility
      serviceId: scheduledItems[0]?.itemId,
      serviceName: primaryServiceName,
      staffId: primaryStaffId,
      staffName: primaryStaffName,
      time: input.startTime,

      // Audit trail
      createdByUserId: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: `${targetDate}T${timeStr}`,
      confirmedByUserId: status === 'CONFIRMED' ? authenticatedActor.id : undefined,
      confirmedByName: status === 'CONFIRMED' ? authenticatedActor.name : undefined,
      confirmedAt: status === 'CONFIRMED' ? `${targetDate}T${timeStr}` : undefined,
    };

    clonedStore.appointments.unshift(newAppointment);
    mockStorage.saveStore(clonedStore);
    return { ...newAppointment };
  }

  async updateAppointment(id: string, input: UpdateAppointmentInput, actor?: User): Promise<Appointment> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to modify appointments.');
    }

    const store = mockStorage.getStore();
    const apt = (store.appointments || []).find((a) => a.id === id);
    if (!apt) throw new Error(`Appointment '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && apt.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify appointments from another branch.');
    }

    if (apt.billingStatus === 'BILLED') {
      throw new Error(`Cannot modify an appointment that has already been billed under invoice ${apt.linkedInvoiceNumber || 'N/A'}.`);
    }

    const targetDate = input.date || apt.date;
    const targetStartTime = input.startTime || apt.startTime || apt.time || '09:00 AM';

    const rawItems: CreateAppointmentInput['items'] = input.items && input.items.length > 0
      ? input.items
      : (apt.items || []).map((it) => ({
          lineInstanceId: it.lineInstanceId,
          type: it.type,
          itemId: it.itemId,
          staffId: it.staffId,
          packageComponents: it.packageComponents?.map((c) => ({
            componentInstanceId: c.componentInstanceId,
            serviceId: c.serviceId,
            staffId: c.staffId,
          })),
        }));

    const { scheduledItems, totalDuration, endTimeStr, totalPrice, primaryStaffId, primaryStaffName, primaryServiceName } =
      this.validateAndScheduleAppointmentItems(store, apt.branchId, targetDate, targetStartTime, rawItems, apt.id);

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetApt = clonedStore.appointments.find((a) => a.id === id)!;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const systemDate = mockStorage.getSystemDate();

    targetApt.date = targetDate;
    targetApt.startTime = targetStartTime;
    targetApt.time = targetStartTime;
    targetApt.endTime = endTimeStr;
    targetApt.durationMinutes = totalDuration;
    targetApt.items = scheduledItems;
    targetApt.price = totalPrice;
    targetApt.staffId = primaryStaffId;
    targetApt.staffName = primaryStaffName;
    targetApt.serviceName = primaryServiceName;
    if (input.notes !== undefined) targetApt.notes = input.notes.trim() || undefined;
    if (input.clientName) targetApt.clientName = input.clientName.trim();
    if (input.clientPhone) targetApt.clientPhone = formatPhoneNumber(input.clientPhone);
    if (input.clientEmail !== undefined) targetApt.clientEmail = input.clientEmail.trim() || undefined;
    if (input.customerSource) targetApt.customerSource = input.customerSource;
    if (input.customerSourceDetails !== undefined) targetApt.customerSourceDetails = input.customerSourceDetails.trim() || undefined;

    targetApt.updatedAt = `${systemDate}T${timeStr}`;
    targetApt.updatedByUserId = authenticatedActor.id;
    targetApt.updatedByName = authenticatedActor.name;

    mockStorage.saveStore(clonedStore);
    return { ...targetApt };
  }

  async updateAppointmentStatus(id: string, newStatus: AppointmentStatus, cancelReason?: string, actor?: User): Promise<Appointment> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot update appointment statuses.');
    }
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants cannot manage appointments.');
    }

    const store = mockStorage.getStore();
    const apt = (store.appointments || []).find((a) => a.id === id);
    if (!apt) throw new Error(`Appointment '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && apt.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify appointments from another branch.');
    }

    if (apt.billingStatus === 'BILLED' && (newStatus === 'CANCELLED' || newStatus === 'NO_SHOW')) {
      throw new Error(`Cannot cancel or mark no-show an appointment that has already been billed under invoice ${apt.linkedInvoiceNumber || 'N/A'}. Invoice must be reviewed first.`);
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetApt = clonedStore.appointments.find((a) => a.id === id)!;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const targetDate = mockStorage.getSystemDate();

    targetApt.status = newStatus;
    targetApt.updatedAt = `${targetDate}T${timeStr}`;
    targetApt.updatedByUserId = authenticatedActor.id;
    targetApt.updatedByName = authenticatedActor.name;

    if (newStatus === 'CONFIRMED' && !targetApt.confirmedAt) {
      targetApt.confirmedAt = `${targetDate}T${timeStr}`;
      targetApt.confirmedByUserId = authenticatedActor.id;
      targetApt.confirmedByName = authenticatedActor.name;
    } else if (newStatus === 'CANCELLED' || newStatus === 'NO_SHOW') {
      targetApt.cancelledAt = `${targetDate}T${timeStr}`;
      targetApt.cancelledByUserId = authenticatedActor.id;
      targetApt.cancelledByName = authenticatedActor.name;
      targetApt.cancelReason = cancelReason?.trim() || (newStatus === 'NO_SHOW' ? 'Client did not arrive for scheduled slot' : 'Appointment cancelled by salon');
    }

    mockStorage.saveStore(clonedStore);
    return { ...targetApt };
  }

  async rescheduleAppointment(id: string, newDate: string, newStartTime: string, reason?: string, actor?: User): Promise<Appointment> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to reschedule appointments.');
    }

    const store = mockStorage.getStore();
    const apt = (store.appointments || []).find((a) => a.id === id);
    if (!apt) throw new Error(`Appointment '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && apt.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot reschedule appointments for another branch.');
    }

    if (apt.billingStatus === 'BILLED') {
      throw new Error(`Cannot reschedule an appointment that has already been billed under invoice ${apt.linkedInvoiceNumber || 'N/A'}.`);
    }

    if (apt.status === 'CANCELLED' || apt.status === 'NO_SHOW') {
      throw new Error(`Cannot reschedule a ${apt.status.toLowerCase()} appointment. Please create a new appointment.`);
    }

    const rawItems: CreateAppointmentInput['items'] = (apt.items || []).map((it) => ({
      lineInstanceId: it.lineInstanceId,
      type: it.type,
      itemId: it.itemId,
      staffId: it.staffId,
      packageComponents: it.packageComponents?.map((c) => ({
        componentInstanceId: c.componentInstanceId,
        serviceId: c.serviceId,
        staffId: c.staffId,
      })),
    }));

    if (rawItems.length === 0 && apt.serviceId) {
      rawItems.push({
        type: 'SERVICE',
        itemId: apt.serviceId,
        staffId: apt.staffId,
      });
    }

    const { scheduledItems, totalDuration, endTimeStr, primaryStaffId, primaryStaffName, primaryServiceName } =
      this.validateAndScheduleAppointmentItems(store, apt.branchId, newDate, newStartTime, rawItems, apt.id);

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetApt = clonedStore.appointments.find((a) => a.id === id)!;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const targetDate = mockStorage.getSystemDate();

    targetApt.rescheduleHistory = targetApt.rescheduleHistory || [];
    targetApt.rescheduleHistory.push({
      previousDate: targetApt.date,
      previousStartTime: targetApt.startTime || targetApt.time || '',
      previousEndTime: targetApt.endTime || '',
      newDate,
      newStartTime,
      newEndTime: endTimeStr,
      rescheduledByUserId: authenticatedActor.id,
      rescheduledByName: authenticatedActor.name,
      rescheduledAt: `${targetDate}T${timeStr}`,
      reason: reason?.trim() || 'Schedule adjustment requested',
    });

    targetApt.date = newDate;
    targetApt.startTime = newStartTime;
    targetApt.time = newStartTime;
    targetApt.endTime = endTimeStr;
    targetApt.durationMinutes = totalDuration;
    targetApt.items = scheduledItems;
    targetApt.staffId = primaryStaffId;
    targetApt.staffName = primaryStaffName;
    targetApt.serviceName = primaryServiceName;
    targetApt.updatedAt = `${targetDate}T${timeStr}`;
    targetApt.updatedByUserId = authenticatedActor.id;
    targetApt.updatedByName = authenticatedActor.name;

    mockStorage.saveStore(clonedStore);
    return { ...targetApt };
  }

  async prepareConfirmationMessage(appointmentId: string, actor?: User): Promise<AppointmentConfirmationMessage> {
    const store = mockStorage.getStore();
    const apt = (store.appointments || []).find((a) => a.id === appointmentId);
    if (!apt) throw new Error(`Appointment '${appointmentId}' not found.`);

    const branch = store.branches.find((b) => b.id === apt.branchId);
    const branchName = branch?.name || apt.branchName || 'iSysware Salon';
    const branchPhone = branch?.phone || '+92 (42) 3578-9101';

    const servicesList: string[] = apt.items && apt.items.length > 0
      ? apt.items.map((it) => (it.type === 'PACKAGE' ? `${it.name} (Package)` : it.name))
      : [apt.serviceName || 'Salon Service'];

    const messageText = `Dear ${apt.clientName},\nYour appointment at ${branchName} is confirmed!\n\nReference: ${apt.appointmentNumber || apt.id}\nDate: ${apt.date}\nServices: ${servicesList.join(', ')}\nEstimated Total: PKR ${apt.price.toLocaleString('en-PK')}\nBranch Contact: ${branchPhone}\n\nWe look forward to serving you!`;

    const digitsOnly = normalizePhoneDigits(apt.clientPhone);
    const cleanPhone = digitsOnly.startsWith('92') ? digitsOnly : digitsOnly.startsWith('0') ? `92${digitsOnly.slice(1)}` : `92${digitsOnly}`;
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;

    return {
      appointmentId: apt.id,
      appointmentNumber: apt.appointmentNumber || apt.id,
      clientName: apt.clientName,
      clientPhone: apt.clientPhone,
      branchName,
      branchPhone,
      date: apt.date,
      time: apt.startTime || apt.time || '',
      servicesList,
      totalEstimatedPrice: apt.price,
      messageText,
      whatsappUrl,
    };
  }

  async getAppointmentQueue(branchId: string, date: string, actor?: User): Promise<Appointment[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }
    const store = mockStorage.getStore();
    const appointments = store.appointments || [];

    const allowedStatuses: AppointmentStatus[] = [
      'CONFIRMED',
      'CHECKED_IN',
      'IN_SERVICE',
      'COMPLETED',
      'SCHEDULED',
      'IN_PROGRESS',
    ];

    return appointments
      .filter((a) => {
        if (a.branchId !== targetBranchId) return false;
        if (a.date !== date) return false;
        if (a.billingStatus === 'BILLED') return false;
        if (a.linkedInvoiceId) return false;
        return allowedStatuses.includes(a.status);
      })
      .sort((a, b) => {
        const tA = parseTimeToMinutes(a.startTime || a.time || '00:00');
        const tB = parseTimeToMinutes(b.startTime || b.time || '00:00');
        return tA - tB;
      });
  }

  // ==========================================
  // PHASE 3G: CUSTOMER DIRECTORY & CRM
  // ==========================================

  async createClient(input: Omit<Client, 'id' | 'outstandingBalance' | 'totalVisits'>, actor?: User): Promise<Client> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Staff and Accountants cannot create customer records.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit branch must be selected for customer creation.');
    }

    const name = input.name?.trim();
    if (!name) throw new Error('Customer name is required.');

    const rawPhone = input.phone?.trim();
    if (!rawPhone) throw new Error('Customer phone number is required.');

    const normPhone = normalizePhoneDigits(rawPhone);
    if (!normPhone || normPhone.length < 10) {
      throw new Error('A valid phone number (at least 10 digits) is required.');
    }

    const store = mockStorage.getStore();
    const existing = (store.clients || []).find(
      (c) => c.branchId === branchId && normalizePhoneDigits(c.phone) === normPhone && !c.isArchived
    );
    if (existing) {
      throw new Error(`A client with phone number '${rawPhone}' already exists: ${existing.name}.`);
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    clonedStore.clients = clonedStore.clients || [];

    const newClient: Client = {
      id: `client-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      branchId,
      name,
      phone: formatPhoneNumber(rawPhone),
      email: input.email?.trim() || undefined,
      source: input.source || 'WALK_IN',
      sourceDetails: input.sourceDetails?.trim() || undefined,
      outstandingBalance: 0,
      totalVisits: 0,
      loyaltyPoints: input.loyaltyPoints || 0,
      createdAt: mockStorage.getSystemDate(),
      isArchived: false,
      notes: input.notes?.trim() || undefined,
    };

    clonedStore.clients.push(newClient);
    mockStorage.saveStore(clonedStore);
    return { ...newClient };
  }

  async updateClient(id: string, input: Partial<Client>, actor?: User): Promise<Client> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Staff and Accountants cannot modify customer records.');
    }

    const store = mockStorage.getStore();
    const client = (store.clients || []).find((c) => c.id === id);
    if (!client) throw new Error(`Client '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && client.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify client from another branch.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetClient = clonedStore.clients!.find((c) => c.id === id)!;

    if (input.name) targetClient.name = input.name.trim();
    if (input.phone) {
      const norm = normalizePhoneDigits(input.phone);
      if (!norm || norm.length < 10) throw new Error('A valid phone number is required.');
      targetClient.phone = formatPhoneNumber(input.phone);
    }
    if (input.email !== undefined) targetClient.email = input.email.trim() || undefined;
    if (input.source) targetClient.source = input.source;
    if (input.sourceDetails !== undefined) targetClient.sourceDetails = input.sourceDetails.trim() || undefined;
    if (input.notes !== undefined) targetClient.notes = input.notes.trim() || undefined;

    mockStorage.saveStore(clonedStore);
    return { ...targetClient };
  }

  async archiveClient(id: string, isArchived: boolean, actor?: User): Promise<Client> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Staff and Accountants cannot archive customer records.');
    }

    const store = mockStorage.getStore();
    const client = (store.clients || []).find((c) => c.id === id);
    if (!client) throw new Error(`Client '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && client.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot archive client from another branch.');
    }

    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));
    const targetClient = clonedStore.clients!.find((c) => c.id === id)!;
    targetClient.isArchived = isArchived;

    mockStorage.saveStore(clonedStore);
    return { ...targetClient };
  }

  async getClientDetails(id: string, actor?: User): Promise<{
    client: Client;
    appointments: Appointment[];
    invoices: Invoice[];
    receipts: any[];
    outstandingInvoices: Invoice[];
    visitCount: number;
    lastVisitDate?: string;
    totalSpend: number;
  }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access client directory details.');
    }

    const store = mockStorage.getStore();
    const client = (store.clients || []).find((c) => c.id === id);
    if (!client) throw new Error(`Client '${id}' not found.`);

    if (authenticatedActor.role === 'ADMIN' && client.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot access customer details from another branch.');
    }

    const normPhone = normalizePhoneDigits(client.phone);

    const appointments = (store.appointments || []).filter((a) => {
      if (a.clientId && a.clientId === client.id) return true;
      if (normPhone && a.clientPhone && normalizePhoneDigits(a.clientPhone) === normPhone) return true;
      return false;
    }).sort((a, b) => b.date.localeCompare(a.date));

    const invoices = (store.invoices || []).filter((i) => {
      if (i.clientId && i.clientId === client.id) return true;
      if (normPhone && i.clientPhone && normalizePhoneDigits(i.clientPhone) === normPhone) return true;
      return false;
    }).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

    const receipts: any[] = invoices.flatMap((inv) => inv.payments || []);

    const outstandingInvoices = invoices.filter(
      (i) => (i.status === 'UNPAID' || i.status === 'PARTIAL') && i.amountDue > 0
    );

    const visitDates = new Set<string>();
    for (const inv of invoices) {
      if (inv.lineItems && inv.lineItems.length > 0) {
        visitDates.add(inv.date);
      }
    }
    for (const apt of appointments) {
      if (apt.status === 'COMPLETED') {
        visitDates.add(apt.date);
      }
    }

    const sortedVisitDates = Array.from(visitDates).sort();
    const visitCount = sortedVisitDates.length || client.totalVisits || 0;
    const lastVisitDate = sortedVisitDates.length > 0
      ? sortedVisitDates[sortedVisitDates.length - 1]
      : client.lastVisitDate;

    const totalSpend = roundCurrency(
      invoices.reduce((sum, i) => sum + roundCurrency(i.netSales || 0), 0)
    );

    return {
      client: { ...client, totalVisits: visitCount, lastVisitDate },
      appointments,
      invoices,
      receipts,
      outstandingInvoices,
      visitCount,
      lastVisitDate,
      totalSpend,
    };
  }

  // ==========================================
  // PHASE 3G: DEDICATED APPOINTMENT REPORTING
  // ==========================================

  async getAppointmentReport(
    branchId: string | 'ALL',
    startDate: string,
    endDate: string,
    filters?: {
      status?: AppointmentStatus;
      staffId?: string;
      serviceId?: string;
      packageId?: string;
      customerSource?: CustomerSource;
      billingStatus?: AppointmentBillingStatus;
      search?: string;
    },
    actor?: User
  ): Promise<{
    records: AppointmentReportRecord[];
    summary: AppointmentReportSummary;
  }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access appointment reports.');
    }
    if (authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Accountants cannot access appointment reports.');
    }

    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN') {
      targetBranchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    let appointments = store.appointments || [];

    if (targetBranchId !== 'ALL') {
      appointments = appointments.filter((a) => a.branchId === targetBranchId);
    }

    appointments = appointments.filter((a) => a.date >= startDate && a.date <= endDate);

    if (filters) {
      if (filters.status) {
        appointments = appointments.filter((a) => a.status === filters.status);
      }
      if (filters.billingStatus) {
        appointments = appointments.filter((a) => a.billingStatus === filters.billingStatus);
      }
      if (filters.customerSource) {
        appointments = appointments.filter((a) => a.customerSource === filters.customerSource);
      }
      if (filters.staffId) {
        appointments = appointments.filter((a) => {
          if (a.staffId === filters.staffId) return true;
          if (a.items) {
            return a.items.some(
              (it) => it.staffId === filters.staffId || it.packageComponents?.some((pc) => pc.staffId === filters.staffId)
            );
          }
          return false;
        });
      }
      if (filters.serviceId) {
        appointments = appointments.filter((a) => {
          if (a.serviceId === filters.serviceId) return true;
          if (a.items) {
            return a.items.some(
              (it) =>
                (it.type === 'SERVICE' && it.itemId === filters.serviceId) ||
                it.packageComponents?.some((pc) => pc.serviceId === filters.serviceId)
            );
          }
          return false;
        });
      }
      if (filters.packageId) {
        appointments = appointments.filter((a) => {
          if (a.items) {
            return a.items.some((it) => it.type === 'PACKAGE' && it.itemId === filters.packageId);
          }
          return false;
        });
      }
      if (filters.search) {
        const q = filters.search.trim().toLowerCase();
        const normDigits = q.replace(/\D/g, '');
        appointments = appointments.filter((a) => {
          const matchName = a.clientName.toLowerCase().includes(q);
          const matchRef = (a.appointmentNumber || a.id).toLowerCase().includes(q);
          const matchPhone = normDigits ? a.clientPhone.replace(/\D/g, '').includes(normDigits) : false;
          return matchName || matchRef || matchPhone;
        });
      }
    }

    const records: AppointmentReportRecord[] = appointments.map((apt) => {
      const branch = store.branches.find((b) => b.id === apt.branchId);

      let serviceSummary = '';
      if (apt.items && apt.items.length > 0) {
        serviceSummary = apt.items.map((it) => (it.type === 'PACKAGE' ? `${it.name} (Pkg)` : it.name)).join(', ');
      } else {
        serviceSummary = apt.serviceName || 'Service';
      }

      const staffNames = new Set<string>();
      if (apt.staffName) staffNames.add(apt.staffName);
      if (apt.items) {
        for (const it of apt.items) {
          if (it.staffName) staffNames.add(it.staffName);
          if (it.packageComponents) {
            for (const pc of it.packageComponents) {
              if (pc.staffName) staffNames.add(pc.staffName);
            }
          }
        }
      }
      const staffSummary = Array.from(staffNames).join(', ') || apt.staffName || 'Unassigned';

      let actualNetSales: number | undefined;
      let actualInvoiceTotal: number | undefined;
      let invoicePaymentStatus: InvoiceStatus | undefined;

      if (apt.linkedInvoiceId) {
        const inv = store.invoices.find((i) => i.id === apt.linkedInvoiceId || i.appointmentId === apt.id);
        if (inv) {
          actualNetSales = inv.netSales;
          actualInvoiceTotal = inv.total;
          invoicePaymentStatus = inv.status;
        }
      }

      return {
        id: apt.id,
        appointmentNumber: apt.appointmentNumber || apt.id,
        branchId: apt.branchId,
        branchName: branch?.name || apt.branchName || 'Branch',
        date: apt.date,
        startTime: apt.startTime || apt.time || '',
        endTime: apt.endTime || '',
        clientName: apt.clientName,
        clientPhone: apt.clientPhone,
        customerSource: apt.customerSource,
        serviceSummary,
        staffSummary,
        primaryStaffId: apt.staffId || '',
        primaryStaffName: apt.staffName || '',
        quotedPrice: apt.price || 0,
        status: apt.status,
        billingStatus: apt.billingStatus || (apt.linkedInvoiceId ? 'BILLED' : 'UNBILLED'),
        linkedInvoiceId: apt.linkedInvoiceId,
        linkedInvoiceNumber: apt.linkedInvoiceNumber,
        actualNetSales,
        actualInvoiceTotal,
        invoicePaymentStatus,
        durationMinutes: apt.durationMinutes || 0,
      };
    });

    let pendingCount = 0;
    let confirmedCount = 0;
    let checkedInCount = 0;
    let inServiceCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let noShowCount = 0;
    let billedCount = 0;
    let unbilledCount = 0;
    let totalEstimatedValue = 0;

    for (const r of records) {
      if (r.status === 'PENDING') pendingCount++;
      else if (r.status === 'CONFIRMED' || r.status === 'SCHEDULED') confirmedCount++;
      else if (r.status === 'CHECKED_IN') checkedInCount++;
      else if (r.status === 'IN_SERVICE' || r.status === 'IN_PROGRESS') inServiceCount++;
      else if (r.status === 'COMPLETED') completedCount++;
      else if (r.status === 'CANCELLED') cancelledCount++;
      else if (r.status === 'NO_SHOW') noShowCount++;

      if (r.billingStatus === 'BILLED') billedCount++;
      else unbilledCount++;

      if (r.status !== 'CANCELLED' && r.status !== 'NO_SHOW') {
        totalEstimatedValue = roundCurrency(totalEstimatedValue + r.quotedPrice);
      }
    }

    const seenInvoiceIds = new Set<string>();
    let actualInvoiceNetSales = 0;
    let actualInvoiceTotal = 0;

    for (const r of records) {
      if (r.linkedInvoiceId && !seenInvoiceIds.has(r.linkedInvoiceId)) {
        seenInvoiceIds.add(r.linkedInvoiceId);
        const inv = store.invoices.find((i) => i.id === r.linkedInvoiceId);
        if (inv) {
          actualInvoiceNetSales = roundCurrency(actualInvoiceNetSales + inv.netSales);
          actualInvoiceTotal = roundCurrency(actualInvoiceTotal + inv.total);
        }
      }
    }

    const summary: AppointmentReportSummary = {
      totalAppointments: records.length,
      pendingCount,
      confirmedCount,
      checkedInCount,
      inServiceCount,
      completedCount,
      cancelledCount,
      noShowCount,
      billedCount,
      unbilledCount,
      totalQuotedValue: totalEstimatedValue,
      totalActualNetSales: actualInvoiceNetSales,
      totalEstimatedValue,
      actualInvoiceNetSales,
      actualInvoiceTotal,
    };

    return { records, summary };
  }

  // ======================================================================
  // PHASE 3H: INVENTORY ITEMS & STOCK MANAGEMENT
  // ======================================================================

  async getInventoryItems(
    branchId: string | 'ALL',
    actor?: User,
    filter?: { itemType?: ItemType; category?: string; search?: string; isActive?: boolean }
  ): Promise<InventoryItem[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access inventory management.');
    }

    const store = mockStorage.getStore();
    let list = store.inventoryItems || [];

    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    if (targetBranchId !== 'ALL') {
      list = list.filter((item) =>
        item.branchAvailability.includes('ALL') || item.branchAvailability.includes(targetBranchId)
      );
    }

    if (filter?.itemType) {
      list = list.filter((item) => item.itemType === filter.itemType);
    }

    if (filter?.category && filter.category !== 'ALL') {
      list = list.filter((item) => item.category === filter.category);
    }

    if (filter?.isActive !== undefined) {
      list = list.filter((item) => item.isActive === filter.isActive);
    }

    if (filter?.search) {
      const q = filter.search.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          (item.barcode && item.barcode.toLowerCase().includes(q)) ||
          (item.brand && item.brand.toLowerCase().includes(q))
      );
    }

    return list.map((item) => ({ ...item }));
  }

  async getInventoryItem(id: string, actor?: User): Promise<InventoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access inventory management.');
    }

    const store = mockStorage.getStore();
    const item = (store.inventoryItems || []).find((i) => i.id === id);
    if (!item) {
      throw new Error(`Inventory item '${id}' not found.`);
    }
    return { ...item };
  }

  async createInventoryItem(
    input: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
    actor?: User
  ): Promise<InventoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to manage item master records.');
    }

    if (!input.name?.trim()) {
      throw new Error('Item name is required.');
    }

    const store = mockStorage.getStore();
    let sku = input.sku?.trim().toUpperCase();
    if (!sku || /^(?:SKU)-\d+$/i.test(sku)) {
      sku = nextReference(store, 'SKU');
    }

    const existingSku = (store.inventoryItems || []).find(
      (i) => i.sku.toLowerCase() === sku.toLowerCase()
    );
    if (existingSku) {
      throw new Error(`An inventory item with SKU '${sku}' already exists.`);
    }

    const isConsumable = input.itemType === 'SALON_CONSUMABLE';
    const finalSellingPrice = isConsumable ? 0 : roundCurrency(input.sellingPrice || 0);

    const now = new Date().toISOString();
    const newItem: InventoryItem = {
      ...input,
      id: `item-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      name: input.name.trim(),
      sku,
      code: sku,
      price: finalSellingPrice,
      sellingPrice: finalSellingPrice,
      defaultPurchaseCost: roundCurrency(input.defaultPurchaseCost || 0),
      minStockLevel: Math.max(0, input.minStockLevel || 0),
      nearExpiryAlertDays: Math.max(0, input.nearExpiryAlertDays || 0),
      branchAvailability: input.branchAvailability?.length > 0 ? input.branchAvailability : ['ALL'],
      isActive: input.isActive !== undefined ? input.isActive : true,
      createdAt: now,
      updatedAt: now,
    };

    if (!store.inventoryItems) store.inventoryItems = [];
    store.inventoryItems.push(newItem);

    const openingQty = Number((input as any).openingStock || (input as any).openingQuantity || 0);
    if (openingQty > 0) {
      if (!store.inventoryBatches) store.inventoryBatches = [];
      const branchId = (input as any).branchId || (store.branches?.[0]?.id || 'branch-1');
      const unitCost = Number((input as any).openingCost || input.defaultPurchaseCost || 0);
      const batchId = `batch-opn-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const batch: InventoryBatch = {
        id: batchId,
        itemId: newItem.id,
        itemName: newItem.name,
        itemSku: newItem.sku,
        branchId,
        batchNumber: nextReference(store, 'BAT'),
        initialQuantity: openingQty,
        purchasedQuantity: openingQty,
        remainingQuantity: openingQty,
        unitCostSnapshot: unitCost,
        unitPurchaseCost: unitCost,
        receivedDate: now.slice(0, 10),
        status: 'VALID',
        createdAt: now,
        updatedAt: now,
      };
      store.inventoryBatches.push(batch);

      if (!store.stockMovements) store.stockMovements = [];
      const sm: StockMovement = {
        id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        movementNumber: nextReference(store, 'SM'),
        branchId,
        itemId: newItem.id,
        itemName: newItem.name,
        itemSku: newItem.sku,
        batchId,
        batchNumber: batch.batchNumber,
        movementType: 'OPENING_STOCK',
        quantity: openingQty,
        unitCostSnapshot: unitCost,
        totalCostImpact: roundCurrency(openingQty * unitCost),
        direction: 'IN',
        sourceReferenceType: 'OPENING',
        sourceReferenceId: batchId,
        sourceReferenceNumber: `OPN-${batch.batchNumber}`,
        reason: 'Opening stock balance',
        createdById: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        createdAt: now,
      };
      store.stockMovements.push(sm);
    }

    mockStorage.saveStore(store);

    return { ...newItem };
  }

  async updateInventoryItem(id: string, input: Partial<InventoryItem>, actor?: User): Promise<InventoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to modify item master records.');
    }

    const store = mockStorage.getStore();
    const itemIndex = (store.inventoryItems || []).findIndex((i) => i.id === id);
    if (itemIndex < 0) {
      throw new Error(`Inventory item '${id}' not found.`);
    }

    const currentItem = store.inventoryItems![itemIndex];

    if (input.sku && input.sku.toLowerCase().trim() !== currentItem.sku.toLowerCase()) {
      const duplicateSku = store.inventoryItems!.find(
        (i) => i.id !== id && i.sku.toLowerCase() === input.sku!.toLowerCase().trim()
      );
      if (duplicateSku) {
        throw new Error(`Another inventory item with SKU '${input.sku}' already exists.`);
      }
    }

    const targetItemType = input.itemType || currentItem.itemType;
    const isConsumable = targetItemType === 'SALON_CONSUMABLE';
    const sellingPrice = isConsumable
      ? 0
      : input.sellingPrice !== undefined
      ? roundCurrency(input.sellingPrice)
      : currentItem.sellingPrice;

    const updatedItem: InventoryItem = {
      ...currentItem,
      ...input,
      sku: input.sku ? input.sku.trim().toUpperCase() : currentItem.sku,
      code: input.sku ? input.sku.trim().toUpperCase() : currentItem.code,
      sellingPrice,
      price: sellingPrice,
      defaultPurchaseCost:
        input.defaultPurchaseCost !== undefined
          ? roundCurrency(input.defaultPurchaseCost)
          : currentItem.defaultPurchaseCost,
      updatedAt: new Date().toISOString(),
    };

    store.inventoryItems![itemIndex] = updatedItem;
    mockStorage.saveStore(store);

    return { ...updatedItem };
  }

  async archiveInventoryItem(id: string, isActive: boolean, actor?: User): Promise<InventoryItem> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to archive item master records.');
    }

    const store = mockStorage.getStore();
    const item = (store.inventoryItems || []).find((i) => i.id === id);
    if (!item) {
      throw new Error(`Inventory item '${id}' not found.`);
    }

    item.isActive = isActive;
    item.updatedAt = new Date().toISOString();
    mockStorage.saveStore(store);

    return { ...item };
  }

  async getStockLevelSnapshots(branchId: string | 'ALL', actor?: User): Promise<StockLevelSnapshot[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot view stock valuation or snapshots.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    const sysDate = mockStorage.getSystemDate();
    const items = store.inventoryItems || [];
    const batches = store.inventoryBatches || [];
    const branches = targetBranchId === 'ALL' ? store.branches : store.branches.filter((b) => b.id === targetBranchId);

    const snapshots: StockLevelSnapshot[] = [];

    for (const b of branches) {
      for (const item of items) {
        if (!item.branchAvailability.includes('ALL') && !item.branchAvailability.includes(b.id)) {
          continue;
        }

        const itemBatches = batches.filter((batch) => batch.itemId === item.id && batch.branchId === b.id);
        let currentStock = 0;
        let valuationCostBasis = 0;
        let validBatchesCount = 0;
        let nearExpiryBatchesCount = 0;
        let expiredBatchesCount = 0;

        for (const batch of itemBatches) {
          currentStock = roundCurrency(currentStock + batch.remainingQuantity);
          valuationCostBasis = roundCurrency(
            valuationCostBasis + batch.remainingQuantity * batch.unitCostSnapshot
          );

          if (batch.remainingQuantity > 0) {
            if (batch.status === 'EXPIRED' || (batch.expiryDate && batch.expiryDate < sysDate)) {
              expiredBatchesCount++;
            } else if (
              batch.status === 'NEAR_EXPIRY' ||
              (batch.expiryDate && this.isNearExpiryDate(batch.expiryDate, item.nearExpiryAlertDays, sysDate))
            ) {
              nearExpiryBatchesCount++;
            } else if (batch.status === 'VALID') {
              validBatchesCount++;
            }
          }
        }

        const isConsumable = item.itemType === 'SALON_CONSUMABLE';
        const potentialRetailValue = isConsumable ? 0 : roundCurrency(currentStock * (item.sellingPrice || 0));

        snapshots.push({
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          category: item.category,
          itemType: item.itemType,
          branchId: b.id,
          currentStock,
          minStockLevel: item.minStockLevel,
          isLowStock: currentStock <= item.minStockLevel && currentStock > 0,
          isOutOfStock: currentStock === 0,
          valuationCostBasis,
          potentialRetailValue,
          validBatchesCount,
          nearExpiryBatchesCount,
          expiredBatchesCount,
        });
      }
    }

    return snapshots;
  }

  async getItemStockInBranch(
    itemId: string,
    branchId: string
  ): Promise<{ currentStock: number; validStock: number; batches: InventoryBatch[] }> {
    const store = mockStorage.getStore();
    const sysDate = mockStorage.getSystemDate();
    const batches = (store.inventoryBatches || []).filter(
      (b) => b.itemId === itemId && b.branchId === branchId && b.remainingQuantity > 0
    );

    let currentStock = 0;
    let validStock = 0;

    for (const b of batches) {
      currentStock = roundCurrency(currentStock + b.remainingQuantity);
      const isExpired = b.expiryDate && b.expiryDate < sysDate;
      const isQuarantined = b.status === 'QUARANTINED';
      if (!isExpired && !isQuarantined) {
        validStock = roundCurrency(validStock + b.remainingQuantity);
      }
    }

    return { currentStock, validStock, batches: batches.map((b) => ({ ...b })) };
  }

  // ======================================================================
  // PHASE 3H: BATCH & EXPIRY MANAGEMENT
  // ======================================================================

  async getInventoryBatches(branchId: string | 'ALL', itemId?: string, actor?: User): Promise<InventoryBatch[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot view inventory batches.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    const sysDate = mockStorage.getSystemDate();
    let list = store.inventoryBatches || [];

    if (targetBranchId !== 'ALL') {
      list = list.filter((b) => b.branchId === targetBranchId);
    }
    if (itemId) {
      list = list.filter((b) => b.itemId === itemId);
    }

    const itemsMap = new Map((store.inventoryItems || []).map((i) => [i.id, i]));

    return list.map((batch) => {
      const item = itemsMap.get(batch.itemId);
      const alertDays = item?.nearExpiryAlertDays || 60;

      let derivedStatus: BatchStatus = batch.status;
      if (batch.remainingQuantity <= 0) {
        derivedStatus = 'EXHAUSTED';
      } else if (batch.status === 'QUARANTINED') {
        derivedStatus = 'QUARANTINED';
      } else if (batch.expiryDate && batch.expiryDate < sysDate) {
        derivedStatus = 'EXPIRED';
      } else if (batch.expiryDate && this.isNearExpiryDate(batch.expiryDate, alertDays, sysDate)) {
        derivedStatus = 'NEAR_EXPIRY';
      } else {
        derivedStatus = 'VALID';
      }

      return {
        ...batch,
        status: derivedStatus,
      };
    });
  }

  async quarantineBatch(batchId: string, reason: string, actor?: User): Promise<InventoryBatch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to quarantine batches.');
    }

    const store = mockStorage.getStore();
    const batch = (store.inventoryBatches || []).find((b) => b.id === batchId);
    if (!batch) {
      throw new Error(`Batch '${batchId}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && batch.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot quarantine batches from another branch.');
    }

    batch.status = 'QUARANTINED';
    batch.quarantinedReason = reason;
    batch.updatedAt = new Date().toISOString();
    mockStorage.saveStore(store);

    return { ...batch };
  }

  async unquarantineBatch(batchId: string, actor?: User): Promise<InventoryBatch> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to release quarantined batches.');
    }

    const store = mockStorage.getStore();
    const batch = (store.inventoryBatches || []).find((b) => b.id === batchId);
    if (!batch) {
      throw new Error(`Batch '${batchId}' not found.`);
    }

    if (authenticatedActor.role === 'ADMIN' && batch.branchId !== authenticatedActor.branchId) {
      throw new Error('Access Denied: Cannot modify batches from another branch.');
    }

    batch.status = 'VALID';
    batch.quarantinedReason = undefined;
    batch.updatedAt = new Date().toISOString();
    mockStorage.saveStore(store);

    return { ...batch };
  }

  private isNearExpiryDate(expiryDate: string, alertDays: number, systemDate: string): boolean {
    const exp = new Date(expiryDate).getTime();
    const sys = new Date(systemDate).getTime();
    const diffDays = (exp - sys) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= alertDays;
  }

  // ======================================================================
  // PHASE 3H: SUPPLIERS & DEDICATED SUPPLIER LEDGER
  // ======================================================================

  async getSuppliers(branchId: string | 'ALL', actor?: User, search?: string): Promise<Supplier[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access supplier records.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    let list = store.suppliers || [];
    if (targetBranchId !== 'ALL') {
      list = list.filter((s) => s.branchId === 'ALL' || s.branchId === targetBranchId);
    }

    if (search) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.supplierCode.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          (s.contactPerson && s.contactPerson.toLowerCase().includes(q))
      );
    }

    return list.map((s) => ({ ...s }));
  }

  async getSupplier(id: string, actor?: User): Promise<Supplier> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access supplier records.');
    }

    const store = mockStorage.getStore();
    const sup = (store.suppliers || []).find((s) => s.id === id);
    if (!sup) {
      throw new Error(`Supplier '${id}' not found.`);
    }
    return { ...sup };
  }

  async createSupplier(
    input: Omit<
      Supplier,
      'id' | 'supplierCode' | 'currentPayable' | 'totalPurchases' | 'totalPayments' | 'totalReturns' | 'createdById' | 'createdByName' | 'createdAt' | 'updatedAt'
    >,
    actor?: User
  ): Promise<Supplier> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot create suppliers.');
    }

    if (!input.name?.trim()) {
      throw new Error('Supplier name is required.');
    }
    if (!input.phone?.trim()) {
      throw new Error('Supplier phone number is required.');
    }

    const store = mockStorage.getStore();
    if (!store.supplierSequenceCounters) store.supplierSequenceCounters = {};
    const count = (store.supplierSequenceCounters['SUP'] || 3) + 1;
    store.supplierSequenceCounters['SUP'] = count;
    const supplierCode = nextReference(store, 'SUP');

    const now = new Date().toISOString();
    const openingPayable = roundCurrency(input.openingPayable || 0);

    const newSupplier: Supplier = {
      ...input,
      id: `sup-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      supplierCode,
      name: input.name.trim(),
      phone: input.phone.trim(),
      openingPayable,
      currentPayable: openingPayable,
      totalPurchases: 0,
      totalPayments: 0,
      totalReturns: 0,
      branchId: input.branchId || 'ALL',
      isActive: true,
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: now,
      updatedAt: now,
    };

    if (!store.suppliers) store.suppliers = [];
    store.suppliers.push(newSupplier);

    // If opening payable > 0, log an initial ledger entry
    if (openingPayable > 0) {
      if (!store.supplierLedger) store.supplierLedger = [];
      const sysDate = mockStorage.getSystemDate();
      store.supplierLedger.push({
        id: `led-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        supplierId: newSupplier.id,
        supplierName: newSupplier.name,
        branchId: newSupplier.branchId === 'ALL' ? authenticatedActor.branchId : newSupplier.branchId,
        date: sysDate,
        time: '12:00 PM',
        entryType: 'OPENING_BALANCE',
        referenceType: 'OPENING',
        referenceId: newSupplier.id,
        referenceNumber: `OPN-${supplierCode}`,
        description: 'Authorized Opening Payable Balance',
        debit: 0,
        credit: openingPayable,
        runningBalance: openingPayable,
        createdById: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        createdAt: now,
      });
    }

    mockStorage.saveStore(store);
    return { ...newSupplier };
  }

  async updateSupplier(id: string, input: Partial<Supplier>, actor?: User): Promise<Supplier> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot edit suppliers.');
    }

    const store = mockStorage.getStore();
    const supIndex = (store.suppliers || []).findIndex((s) => s.id === id);
    if (supIndex < 0) {
      throw new Error(`Supplier '${id}' not found.`);
    }

    const currentSup = store.suppliers![supIndex];
    const updatedSup: Supplier = {
      ...currentSup,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    store.suppliers![supIndex] = updatedSup;
    mockStorage.saveStore(store);

    return { ...updatedSup };
  }

  async archiveSupplier(id: string, isActive: boolean, actor?: User): Promise<Supplier> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot archive suppliers.');
    }

    const store = mockStorage.getStore();
    const sup = (store.suppliers || []).find((s) => s.id === id);
    if (!sup) {
      throw new Error(`Supplier '${id}' not found.`);
    }

    sup.isActive = isActive;
    sup.updatedAt = new Date().toISOString();
    mockStorage.saveStore(store);

    return { ...sup };
  }

  async getSupplierLedger(
    supplierId: string,
    branchId?: string | 'ALL',
    dateRangeOrActor?: { startDate?: string; endDate?: string } | User,
    actor?: User
  ): Promise<{
    entries: SupplierLedgerEntry[];
    openingPayable: number;
    closingPayable: number;
    totalPurchases: number;
    totalPayments: number;
    totalReturns: number;
  }> {
    let dateRange: { startDate?: string; endDate?: string } | undefined = undefined;
    let actualActor: User | undefined = actor;

    if (dateRangeOrActor && typeof dateRangeOrActor === 'object' && 'role' in dateRangeOrActor && 'id' in dateRangeOrActor) {
      actualActor = dateRangeOrActor as User;
    } else if (dateRangeOrActor && typeof dateRangeOrActor === 'object') {
      dateRange = dateRangeOrActor as { startDate?: string; endDate?: string };
    }

    const authenticatedActor = this.getAuthenticatedActor(actualActor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access the supplier ledger.');
    }

    const store = mockStorage.getStore();
    const supplier = (store.suppliers || []).find((s) => s.id === supplierId);
    if (!supplier) {
      throw new Error(`Supplier '${supplierId}' not found.`);
    }

    let allEntries = (store.supplierLedger || []).filter((e) => e.supplierId === supplierId);

    if (branchId && branchId !== 'ALL') {
      allEntries = allEntries.filter((e) => e.branchId === branchId);
    }

    // Sort chronologically
    allEntries.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.createdAt.localeCompare(b.createdAt);
    });

    let runningBalance = supplier.openingPayable || 0;
    let openingPayable = supplier.openingPayable || 0;
    let totalPurchases = 0;
    let totalPayments = 0;
    let totalReturns = 0;

    const computedEntries: SupplierLedgerEntry[] = [];

    for (const e of allEntries) {
      if (e.entryType === 'OPENING_BALANCE') {
        runningBalance = roundCurrency(e.credit);
      } else {
        runningBalance = roundCurrency(runningBalance + e.credit - e.debit);
      }

      if (dateRange?.startDate && e.date < dateRange.startDate) {
        openingPayable = runningBalance;
        continue;
      }
      if (dateRange?.endDate && e.date > dateRange.endDate) {
        continue;
      }

      if (e.entryType === 'PURCHASE_CREDIT') {
        totalPurchases = roundCurrency(totalPurchases + e.credit);
      } else if (e.entryType === 'SUPPLIER_PAYMENT') {
        totalPayments = roundCurrency(totalPayments + e.debit);
      } else if (e.entryType === 'PURCHASE_RETURN' || e.entryType === 'SUPPLIER_REFUND') {
        totalReturns = roundCurrency(totalReturns + e.debit);
      }

      computedEntries.push({
        ...e,
        runningBalance,
      });
    }

    return {
      entries: computedEntries,
      openingPayable,
      closingPayable: runningBalance,
      totalPurchases,
      totalPayments,
      totalReturns,
    };
  }

  async paySupplier(
    input: PaySupplierInput,
    actor?: User
  ): Promise<{
    payment: SupplierPaymentRecord;
    ledgerEntry: SupplierLedgerEntry;
    updatedPayable: number;
  }> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot disburse supplier payments.');
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Payment amount must be a positive number.');
    }

    const method: 'CASH' | 'ONLINE' = input.method ?? (input.paymentMethod === 'CASH' ? 'CASH' : 'ONLINE');
    const cashDrawerId = input.cashDrawerId ?? input.payerDrawerId;

    const amount = roundCurrency(input.amount);
    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      branchId = authenticatedActor.branchId;
    }

    const branch = clonedStore.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const supplier = (clonedStore.suppliers || []).find((s) => s.id === input.supplierId);
    if (!supplier || !supplier.isActive) {
      throw new Error(`Supplier '${input.supplierId}' is invalid or deactivated.`);
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Payment method verification & float debits
    if (method === 'CASH') {
      let drawer = clonedStore.cashDrawers.find(
        (d: CashDrawer) =>
          d.branchId === branchId &&
          d.status === 'OPEN' &&
          (d.custodianUserId === authenticatedActor.id || authenticatedActor.role === 'SUPER_ADMIN')
      );
      if (!drawer) {
        throw new Error('No open cash drawer found under your custody. Cash disbursements require an active open cash drawer.');
      }
      if (drawer.expectedInDrawer < amount) {
        throw new Error(
          `Insufficient cash float in drawer '${drawer.id}'. In drawer: PKR ${drawer.expectedInDrawer.toLocaleString()}, Required: PKR ${amount.toLocaleString()}.`
        );
      }
      drawer.cashExpensesPaid = roundCurrency(drawer.cashExpensesPaid + amount);
      drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer - amount);
    } else if (input.method === 'ONLINE') {
      if (!input.paymentAccountId) {
        throw new Error('A named online bank account is required for electronic supplier payment.');
      }
      const acc = clonedStore.paymentAccounts.find(
        (a: PaymentAccount) => a.id === input.paymentAccountId && a.branchId === branchId
      );
      if (!acc || !acc.isActive) {
        throw new Error(`Payment account '${input.paymentAccountId}' is invalid or inactive.`);
      }
      if (acc.currentBalance < amount) {
        throw new Error(
          `Insufficient balance in account '${acc.name}'. Available: PKR ${acc.currentBalance.toLocaleString()}, Required: PKR ${amount.toLocaleString()}.`
        );
      }
      acc.currentBalance = roundCurrency(acc.currentBalance - amount);
    }

    // Sequence counter for payment
    if (!clonedStore.supplierPaymentSequenceCounters) clonedStore.supplierPaymentSequenceCounters = {};
    const spCount = (clonedStore.supplierPaymentSequenceCounters[`${branch.code}-2026`] || 0) + 1;
    clonedStore.supplierPaymentSequenceCounters[`${branch.code}-2026`] = spCount;
    const paymentNumber = nextReference(clonedStore, 'SP');

    // Update supplier balances
    supplier.currentPayable = roundCurrency(supplier.currentPayable - amount);
    supplier.totalPayments = roundCurrency(supplier.totalPayments + amount);
    supplier.updatedAt = now.toISOString();

    const paymentRecord: SupplierPaymentRecord = {
      id: `sp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      paymentNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      branchId,
      paymentDate: input.paymentDate || mockStorage.getSystemDate(),
      paymentTime: timeStr,
      amount,
      method,
      paymentAccountId: input.paymentAccountId,
      cashDrawerId,
      reference: input.reference?.trim(),
      notes: input.notes?.trim(),
      paidById: authenticatedActor.id,
      paidByName: authenticatedActor.name,
      createdAt: now.toISOString(),
    };

    if (!clonedStore.supplierPayments) clonedStore.supplierPayments = [];
    clonedStore.supplierPayments.unshift(paymentRecord);

    const ledgerEntry: SupplierLedgerEntry = {
      id: `led-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      branchId,
      date: paymentRecord.paymentDate,
      time: timeStr,
      entryType: 'SUPPLIER_PAYMENT',
      referenceType: 'PAYMENT',
      referenceId: paymentRecord.id,
      referenceNumber: paymentRecord.paymentNumber,
      description: `Payment via ${method}: ${paymentRecord.paymentNumber}${input.reference ? ` (${input.reference})` : ''}`,
      debit: amount,
      credit: 0,
      runningBalance: supplier.currentPayable,
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: now.toISOString(),
    };

    if (!clonedStore.supplierLedger) clonedStore.supplierLedger = [];
    clonedStore.supplierLedger.push(ledgerEntry);

    mockStorage.saveStore(clonedStore);

    return {
      payment: paymentRecord,
      ledgerEntry,
      updatedPayable: supplier.currentPayable,
    };
  }

  async recordSupplierPayment(
    input: PaySupplierInput,
    actor?: User
  ): Promise<{
    payment: SupplierPaymentRecord;
    ledgerEntry: SupplierLedgerEntry;
    updatedPayable: number;
  }> {
    return this.paySupplier(input, actor);
  }

  async recordSupplierRefund(
    supplierId: string,
    input: {
      branchId?: string;
      amount: number;
      method?: 'CASH' | 'ONLINE';
      paymentAccountId?: string;
      refundDate?: string;
      reference?: string;
      notes?: string;
      returnId?: string;
    },
    _actor?: User
  ): Promise<any> {
    const store = mockStorage.getStore();
    const cloned = JSON.parse(JSON.stringify(store));
    const supp = (cloned.suppliers || []).find((s: any) => s.id === supplierId);
    if (!supp) throw new Error('Supplier not found');
    const amount = Number(input.amount) || 0;
    supp.currentPayable = Number(((supp.currentPayable || 0) + amount).toFixed(2));
    if (!cloned.supplierLedger) cloned.supplierLedger = [];
    cloned.supplierLedger.push({
      id: `led-${Date.now()}`,
      supplierId,
      supplierName: supp.name,
      branchId: input.branchId || supp.branchId,
      date: input.refundDate || mockStorage.getSystemDate(),
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      entryType: 'SUPPLIER_REFUND',
      referenceType: 'REFUND',
      referenceNumber: input.reference || `SR-${Date.now().toString(36).toUpperCase()}`,
      description: `Supplier refund received (${input.method || 'CASH'})${input.notes ? ` · ${input.notes}` : ''}`,
      debit: 0,
      credit: amount,
      runningBalance: supp.currentPayable,
    });
    mockStorage.saveStore(cloned);
    return { success: true };
  }

  // ======================================================================
  // PHASE 3H: PURCHASES / STOCK IN
  // ======================================================================

  async getPurchases(
    branchId: string | 'ALL',
    actor?: User,
    dateRange?: { startDate?: string; endDate?: string }
  ): Promise<Purchase[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access purchase records.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    let list = store.purchases || [];
    if (targetBranchId !== 'ALL') {
      list = list.filter((p) => p.branchId === targetBranchId);
    }

    if (dateRange?.startDate) {
      list = list.filter((p) => p.purchaseDate >= dateRange.startDate!);
    }
    if (dateRange?.endDate) {
      list = list.filter((p) => p.purchaseDate <= dateRange.endDate!);
    }

    return list.map((p) => ({ ...p }));
  }

  async getPurchase(id: string, actor?: User): Promise<Purchase> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access purchase records.');
    }

    const store = mockStorage.getStore();
    const p = (store.purchases || []).find((item) => item.id === id);
    if (!p) {
      throw new Error(`Purchase '${id}' not found.`);
    }
    return { ...p };
  }

  async createPurchase(
    input: CreatePurchaseInput,
    actor?: User
  ): Promise<Purchase> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to post stock purchases.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit branch must be selected for stock purchase.');
    }

    if (!input.lines || input.lines.length === 0) {
      throw new Error('A purchase must contain at least one line item.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const branch = clonedStore.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const supplier = (clonedStore.suppliers || []).find((s) => s.id === input.supplierId);
    if (!supplier || !supplier.isActive) {
      throw new Error(`Supplier '${input.supplierId}' is invalid or deactivated.`);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Sequence for purchase
    if (!clonedStore.purchaseSequenceCounters) clonedStore.purchaseSequenceCounters = {};
    const poCount = (clonedStore.purchaseSequenceCounters[`${branch.code}-2026`] || 0) + 1;
    clonedStore.purchaseSequenceCounters[`${branch.code}-2026`] = poCount;
    const purchaseNumber = nextReference(clonedStore, 'PO');
    const purchaseId = `po-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const supplierInvoiceNumber = input.supplierInvoiceNumber ?? input.supplierInvoiceNo ?? input.invoiceNumber;
    const cashDrawerId = input.cashDrawerId ?? input.payerDrawerId;

    let subtotal = 0;
    const computedLines: PurchaseLineItem[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i];
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) {
        throw new Error(`Line ${i + 1}: quantity must be a positive number.`);
      }

      const unitPurchaseCost = l.unitPurchaseCost ?? l.unitCost;
      if (unitPurchaseCost === undefined || !Number.isFinite(unitPurchaseCost) || unitPurchaseCost < 0) {
        throw new Error(`Line ${i + 1}: unit purchase cost must be non-negative.`);
      }

      const item = (clonedStore.inventoryItems || []).find((it) => it.id === l.itemId);
      if (!item || !item.isActive) {
        throw new Error(`Line ${i + 1}: Item '${l.itemId}' is invalid or deactivated.`);
      }

      const lineDiscount = roundCurrency(l.lineDiscount || 0);
      const lineTotal = roundCurrency(l.quantity * unitPurchaseCost - lineDiscount);
      subtotal = roundCurrency(subtotal + lineTotal);

      computedLines.push({
        id: `pol-${i + 1}-${Date.now().toString(36)}`,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        quantity: l.quantity,
        unitPurchaseCost: roundCurrency(unitPurchaseCost),
        historicalCostSnapshot: roundCurrency(unitPurchaseCost),
        lineDiscount,
        lineTotal,
        batchNumber: l.batchNumber?.trim(),
        expiryDate: l.expiryDate,
        mfgDate: l.mfgDate,
      });
    }

    const orderDiscount = roundCurrency(input.discount || 0);
    const netAmount = roundCurrency(Math.max(0, subtotal - orderDiscount));

    const inputPaidAmount = input.paidAmount ?? input.partialPaidAmount;
    let paidAmount = 0;
    if (input.paymentMethod === 'CASH' || input.paymentMethod === 'ONLINE') {
      paidAmount = inputPaidAmount !== undefined ? roundCurrency(inputPaidAmount) : netAmount;
    } else if (input.paymentMethod === 'PARTIAL') {
      paidAmount = roundCurrency(inputPaidAmount || 0);
    } else if (input.paymentMethod === 'CREDIT') {
      paidAmount = 0;
    }

    const balanceDue = roundCurrency(Math.max(0, netAmount - paidAmount));
    const paymentStatus = balanceDue === 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

    // Handle payment float debits if money was disbursed at purchase time
    if (paidAmount > 0) {
      if (input.paymentMethod === 'CASH' || (!input.paymentAccountId && input.paymentMethod === 'PARTIAL')) {
        let drawer = clonedStore.cashDrawers.find(
          (d: CashDrawer) =>
            d.branchId === branchId &&
            d.status === 'OPEN' &&
            (d.custodianUserId === authenticatedActor.id || authenticatedActor.role === 'SUPER_ADMIN')
        );
        if (!drawer) {
          throw new Error('No open cash drawer found under your custody. Cash purchase requires an active cash drawer.');
        }
        if (drawer.expectedInDrawer < paidAmount) {
          throw new Error(
            `Insufficient cash float in drawer '${drawer.id}'. In drawer: PKR ${drawer.expectedInDrawer.toLocaleString()}, Required: PKR ${paidAmount.toLocaleString()}.`
          );
        }
        drawer.cashExpensesPaid = roundCurrency(drawer.cashExpensesPaid + paidAmount);
        drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer - paidAmount);
      } else if (input.paymentMethod === 'ONLINE' || input.paymentAccountId) {
        const acc = clonedStore.paymentAccounts.find(
          (a: PaymentAccount) => a.id === input.paymentAccountId && a.branchId === branchId
        );
        if (!acc || !acc.isActive) {
          throw new Error(`Payment account '${input.paymentAccountId}' is invalid or deactivated.`);
        }
        if (acc.currentBalance < paidAmount) {
          throw new Error(
            `Insufficient balance in account '${acc.name}'. In account: PKR ${acc.currentBalance.toLocaleString()}, Required: PKR ${paidAmount.toLocaleString()}.`
          );
        }
        acc.currentBalance = roundCurrency(acc.currentBalance - paidAmount);
      }
    }

    // 1. Create Purchase Record
    const newPurchase: Purchase = {
      id: purchaseId,
      purchaseNumber,
      branchId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      purchaseDate: input.purchaseDate || mockStorage.getSystemDate(),
      supplierInvoiceNumber: supplierInvoiceNumber?.trim() || undefined,
      invoiceNumber: supplierInvoiceNumber?.trim() || undefined,
      notes: input.notes?.trim(),
      subtotal,
      discount: orderDiscount,
      netAmount,
      totalCost: netAmount,
      paidAmount,
      balanceDue,
      paymentMethod: input.paymentMethod,
      paymentStatus,
      paymentAccountId: input.paymentAccountId,
      cashDrawerId,
      lines: computedLines,
      status: 'POSTED',
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: nowIso,
    };

    if (!clonedStore.purchases) clonedStore.purchases = [];
    clonedStore.purchases.unshift(newPurchase);

    // 2. Create Stock IN Movements and Batches
    if (!clonedStore.stockMovements) clonedStore.stockMovements = [];
    if (!clonedStore.inventoryBatches) clonedStore.inventoryBatches = [];

    for (const line of computedLines) {
      const smCount = ((clonedStore.movementSequenceCounters || {})[`${branch.code}-2026`] || 0) + 1;
      if (!clonedStore.movementSequenceCounters) clonedStore.movementSequenceCounters = {};
      clonedStore.movementSequenceCounters[`${branch.code}-2026`] = smCount;
      const moveNum = nextReference(clonedStore, 'SM');

      let batchId = line.batchId;
      const batchNumber = line.batchNumber || nextReference(clonedStore, 'BAT');

      // Every purchase receipt creates a separate immutable cost layer/batch (never merge or overwrite unitCostSnapshot)
      const newBatch: InventoryBatch = {
        id: `batch-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        branchId,
        batchNumber,
        purchaseId: newPurchase.id,
        purchaseNumber: newPurchase.purchaseNumber,
        supplierId: supplier.id,
        supplierName: supplier.name,
        receivedDate: newPurchase.purchaseDate,
        expiryDate: line.expiryDate,
        mfgDate: line.mfgDate,
        initialQuantity: line.quantity,
        remainingQuantity: line.quantity,
        unitCostSnapshot: line.unitPurchaseCost,
        status: 'VALID',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      clonedStore.inventoryBatches.push(newBatch);
      batchId = newBatch.id;

      // Synchronize authorized selling-price update if explicitly specified on stock-in
      if (line.sellingPrice !== undefined && Number(line.sellingPrice) > 0) {
        const targetItem = (clonedStore.inventoryItems || []).find((it) => it.id === line.itemId);
        if (targetItem && targetItem.itemType !== 'SALON_CONSUMABLE') {
          targetItem.sellingPrice = roundCurrency(line.sellingPrice);
          targetItem.updatedAt = nowIso;
        }
      }

      line.batchId = batchId;
      line.batchNumber = batchNumber;

      clonedStore.stockMovements.push({
        id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        movementNumber: moveNum,
        branchId,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        batchId,
        batchNumber,
        movementType: 'PURCHASE_IN',
        direction: 'IN',
        quantity: line.quantity,
        unitCostSnapshot: line.unitPurchaseCost,
        totalCostImpact: roundCurrency(line.quantity * line.unitPurchaseCost),
        sourceReferenceType: 'PURCHASE',
        sourceReferenceId: newPurchase.id,
        referenceId: newPurchase.id,
        sourceReferenceNumber: newPurchase.purchaseNumber,
        reason: `Stock receipt from ${newPurchase.purchaseNumber}`,
        createdById: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        createdAt: nowIso,
      });
    }

    // 3. Update Supplier Statistics & Ledger
    supplier.totalPurchases = roundCurrency(supplier.totalPurchases + netAmount);
    supplier.currentPayable = roundCurrency(supplier.currentPayable + balanceDue);
    supplier.updatedAt = nowIso;

    if (!clonedStore.supplierLedger) clonedStore.supplierLedger = [];

    // Credit entry for entire net purchase amount
    const purchaseCreditEntry: SupplierLedgerEntry = {
      id: `led-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      branchId,
      date: newPurchase.purchaseDate,
      time: timeStr,
      entryType: 'PURCHASE_BILL',
      referenceType: 'PURCHASE',
      referenceId: newPurchase.id,
      referenceNumber: newPurchase.purchaseNumber,
      description: `Purchase: ${newPurchase.purchaseNumber}${newPurchase.supplierInvoiceNumber ? ` (Inv #${newPurchase.supplierInvoiceNumber})` : ''}`,
      debit: 0,
      credit: netAmount,
      payableCredit: netAmount,
      payableDebit: 0,
      runningBalance: supplier.currentPayable + paidAmount,
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: nowIso,
    };
    clonedStore.supplierLedger.push(purchaseCreditEntry);

    // If payment was made at purchase time, record supplier payment entry
    if (paidAmount > 0) {
      supplier.totalPayments = roundCurrency(supplier.totalPayments + paidAmount);
      const purchasePaymentEntry: SupplierLedgerEntry = {
        id: `led-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        supplierId: supplier.id,
        supplierName: supplier.name,
        branchId,
        date: newPurchase.purchaseDate,
        time: timeStr,
        entryType: 'SUPPLIER_PAYMENT',
        referenceType: 'PURCHASE',
        referenceId: newPurchase.id,
        referenceNumber: newPurchase.purchaseNumber,
        description: `Upfront Payment at Purchase (${newPurchase.paymentMethod}): ${newPurchase.purchaseNumber}`,
        debit: paidAmount,
        credit: 0,
        runningBalance: supplier.currentPayable,
        createdById: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        createdAt: nowIso,
      };
      clonedStore.supplierLedger.push(purchasePaymentEntry);
    }

    // Atomic commit
    mockStorage.saveStore(clonedStore);

    return { ...newPurchase };
  }

  // ======================================================================
  // PHASE 3H: SUPPLIER RETURNS
  // ======================================================================

  async getSupplierReturns(branchId: string | 'ALL', actor?: User): Promise<SupplierReturn[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access supplier return records.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    let list = store.supplierReturns || [];
    if (targetBranchId !== 'ALL') {
      list = list.filter((r) => r.branchId === targetBranchId);
    }
    return list.map((r) => ({ ...r }));
  }

  async createSupplierReturn(
    input: CreateSupplierReturnInput,
    actor?: User
  ): Promise<SupplierReturn> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to execute supplier returns.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit branch must be selected for supplier return.');
    }

    if (!input.lines || input.lines.length === 0) {
      throw new Error('A supplier return must include at least one item line.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const branch = clonedStore.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid or deactivated.`);
    }

    const supplier = (clonedStore.suppliers || []).find((s) => s.id === input.supplierId);
    if (!supplier) {
      throw new Error(`Supplier '${input.supplierId}' not found.`);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const refundTreatment = input.refundTreatment ?? 'REDUCE_PAYABLE';
    const purchaseId = input.purchaseId ?? input.originalPurchaseId;

    if (!clonedStore.supplierReturnSequenceCounters) clonedStore.supplierReturnSequenceCounters = {};
    const prCount = (clonedStore.supplierReturnSequenceCounters[`${branch.code}-2026`] || 0) + 1;
    clonedStore.supplierReturnSequenceCounters[`${branch.code}-2026`] = prCount;
    const returnNumber = nextReference(clonedStore, 'PR');
    const returnId = `ret-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    let totalAmount = 0;
    const computedLines: SupplierReturnLine[] = [];

    if (!clonedStore.stockMovements) clonedStore.stockMovements = [];

    for (const l of input.lines) {
      const item = (clonedStore.inventoryItems || []).find((it) => it.id === l.itemId);
      if (!item) {
        throw new Error(`Item '${l.itemId}' not found.`);
      }

      const lineTotal = roundCurrency(l.quantity * l.unitCost);
      totalAmount = roundCurrency(totalAmount + lineTotal);

      // Deduct from batch
      const inputBatchNumber = (l as any).batchNumber;
      let batch = (clonedStore.inventoryBatches || []).find(
        (b) =>
          (l.batchId && b.id === l.batchId) ||
          (inputBatchNumber && b.batchNumber === inputBatchNumber && b.itemId === item.id && b.branchId === branchId)
      );

      if (!batch) {
        // Fall back to available batch with stock in this branch
        batch = (clonedStore.inventoryBatches || []).find(
          (b) => b.itemId === item.id && b.branchId === branchId && b.remainingQuantity >= l.quantity
        );
      }

      let batchNumber = '';
      let batchId = l.batchId;

      if (batch) {
        if (batch.remainingQuantity < l.quantity) {
          throw new Error(`Insufficient batch stock for item '${item.name}' (Batch: ${batch.batchNumber}).`);
        }
        batch.remainingQuantity = roundCurrency(batch.remainingQuantity - l.quantity);
        if (batch.remainingQuantity === 0) {
          batch.status = 'EXHAUSTED';
        }
        batch.updatedAt = nowIso;
        batchNumber = batch.batchNumber;
        batchId = batch.id;
      }

      computedLines.push({
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        batchId,
        batchNumber,
        quantity: l.quantity,
        unitCost: l.unitCost,
        totalCost: lineTotal,
      });

      // Stock OUT movement
      const smCount = ((clonedStore.movementSequenceCounters || {})[`${branch.code}-2026`] || 0) + 1;
      if (!clonedStore.movementSequenceCounters) clonedStore.movementSequenceCounters = {};
      clonedStore.movementSequenceCounters[`${branch.code}-2026`] = smCount;
      const moveNum = nextReference(clonedStore, 'SM');

      clonedStore.stockMovements.push({
        id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        movementNumber: moveNum,
        branchId,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        batchId: l.batchId,
        batchNumber,
        movementType: 'SUPPLIER_RETURN_OUT',
        direction: 'OUT',
        quantity: l.quantity,
        unitCostSnapshot: l.unitCost,
        totalCostImpact: lineTotal,
        sourceReferenceType: 'RETURN',
        sourceReferenceId: returnId,
        referenceId: returnId,
        sourceReferenceNumber: returnNumber,
        reason: input.reason || 'Supplier Return',
        createdById: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        createdAt: nowIso,
      });
    }

    // Handle purchase balance effect
    if (purchaseId && clonedStore.purchases) {
      const p = clonedStore.purchases.find((pur: any) => pur.id === purchaseId);
      if (p) {
        const offset = Math.min(p.balanceDue || 0, totalAmount);
        p.balanceDue = roundCurrency(Math.max(0, (p.balanceDue || 0) - offset));
        p.paymentStatus = p.balanceDue === 0 ? 'PAID' : (p.paidAmount > 0 ? 'PARTIAL' : 'UNPAID');
      }
    }

    // Handle refund financial effect
    if (refundTreatment === 'CASH_REFUND') {
      let drawer = clonedStore.cashDrawers.find(
        (d: CashDrawer) =>
          d.branchId === branchId &&
          d.status === 'OPEN' &&
          (d.custodianUserId === authenticatedActor.id || authenticatedActor.role === 'SUPER_ADMIN')
      );
      if (!drawer) {
        throw new Error('No open cash drawer found to receive cash refund.');
      }
      drawer.cashSales = roundCurrency(drawer.cashSales + totalAmount);
      drawer.expectedInDrawer = roundCurrency(drawer.expectedInDrawer + totalAmount);
    } else if (refundTreatment === 'ONLINE_REFUND') {
      if (!input.paymentAccountId) {
        throw new Error('Payment account required for online supplier refund.');
      }
      const acc = clonedStore.paymentAccounts.find(
        (a: PaymentAccount) => a.id === input.paymentAccountId && a.branchId === branchId
      );
      if (!acc || !acc.isActive) {
        throw new Error(`Account '${input.paymentAccountId}' is invalid.`);
      }
      acc.currentBalance = roundCurrency(acc.currentBalance + totalAmount);
    } else {
      // REDUCE_PAYABLE or SUPPLIER_CREDIT
      supplier.currentPayable = roundCurrency(supplier.currentPayable - totalAmount);
    }

    supplier.totalReturns = roundCurrency(supplier.totalReturns + totalAmount);
    supplier.updatedAt = nowIso;

    // Supplier Ledger entry
    if (!clonedStore.supplierLedger) clonedStore.supplierLedger = [];
    clonedStore.supplierLedger.push({
      id: `led-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      branchId,
      date: input.returnDate || mockStorage.getSystemDate(),
      time: timeStr,
      entryType: refundTreatment.includes('REFUND') ? 'SUPPLIER_REFUND' : 'PURCHASE_RETURN',
      referenceType: 'RETURN',
      referenceId: returnId,
      referenceNumber: returnNumber,
      description: `Return: ${returnNumber} (${input.reason})`,
      debit: totalAmount,
      credit: 0,
      runningBalance: supplier.currentPayable,
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: nowIso,
    });

    const newReturn: SupplierReturn = {
      id: returnId,
      returnNumber,
      branchId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      purchaseId,
      returnDate: input.returnDate || mockStorage.getSystemDate(),
      lines: computedLines,
      totalAmount,
      refundTreatment,
      paymentAccountId: input.paymentAccountId,
      cashDrawerId: input.cashDrawerId,
      reason: input.reason,
      notes: input.notes?.trim(),
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: nowIso,
    };

    if (!clonedStore.supplierReturns) clonedStore.supplierReturns = [];
    clonedStore.supplierReturns.unshift(newReturn);

    mockStorage.saveStore(clonedStore);

    return { ...newReturn };
  }

  // ======================================================================
  // PHASE 3H: STOCK MOVEMENTS & SALON CONSUMPTION
  // ======================================================================

  async getStockMovements(
    branchId: string | 'ALL',
    filterOrActor?: any,
    actorOrFilter?: any
  ): Promise<StockMovement[]> {
    let filter: {
      itemId?: string;
      type?: StockMovementType;
      direction?: 'IN' | 'OUT';
      startDate?: string;
      endDate?: string;
      search?: string;
    } | undefined = undefined;
    let actor: User | undefined = undefined;

    if (filterOrActor && typeof filterOrActor === 'object' && ('role' in filterOrActor && 'id' in filterOrActor)) {
      actor = filterOrActor as User;
      filter = actorOrFilter;
    } else {
      filter = filterOrActor;
      actor = actorOrFilter;
    }

    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot view stock movements.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    let list = store.stockMovements || [];
    if (targetBranchId !== 'ALL') {
      list = list.filter((m) => m.branchId === targetBranchId);
    }
    if (filter?.itemId) {
      list = list.filter((m) => m.itemId === filter.itemId);
    }
    if (filter?.type) {
      list = list.filter((m) => m.movementType === filter.type);
    }
    if (filter?.direction) {
      list = list.filter((m) => m.direction === filter.direction);
    }
    if (filter?.startDate) {
      list = list.filter((m) => m.createdAt.slice(0, 10) >= filter.startDate!);
    }
    if (filter?.endDate) {
      list = list.filter((m) => m.createdAt.slice(0, 10) <= filter.endDate!);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.itemName.toLowerCase().includes(q) ||
          m.itemSku.toLowerCase().includes(q) ||
          m.movementNumber.toLowerCase().includes(q) ||
          m.sourceReferenceNumber.toLowerCase().includes(q) ||
          (m.batchNumber && m.batchNumber.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list.map((m) => ({ ...m }));
  }

  async createManualStockOut(
    input: CreateManualStockOutInput,
    actor?: User
  ): Promise<StockMovement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to execute manual stock-out.');
    }

    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('Stock out quantity must be a positive number.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      branchId = authenticatedActor.branchId;
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const branch = clonedStore.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid.`);
    }

    const item = (clonedStore.inventoryItems || []).find((i) => i.id === input.itemId);
    if (!item || !item.isActive) {
      throw new Error(`Item '${input.itemId}' is invalid.`);
    }

    let movementType: StockMovementType = 'SALON_CONSUMPTION_OUT';
    const rType: string = (input.reasonType || (input as any).reason || '') as string;
    switch (rType) {
      case 'SALON_CONSUMPTION':
      case 'SALON_CONSUMPTION_OUT':
        movementType = 'SALON_CONSUMPTION_OUT';
        break;
      case 'DAMAGE':
      case 'DAMAGED':
      case 'DAMAGED_OUT':
        movementType = 'DAMAGED_OUT';
        break;
      case 'EXPIRED':
      case 'EXPIRED_OUT':
        movementType = 'EXPIRED_OUT';
        break;
      case 'INTERNAL_USE':
      case 'INTERNAL_USE_OUT':
        movementType = 'INTERNAL_USE_OUT';
        break;
      case 'PROMOTIONAL':
      case 'PROMOTIONAL_OUT':
        movementType = 'PROMOTIONAL_OUT';
        break;
      default:
        movementType = 'NEGATIVE_ADJUSTMENT';
    }

    const deptTag = input.department ? `[Dept: ${input.department}] ` : '';
    const respTag = input.responsibleStaffName ? `[Responsible: ${input.responsibleStaffName}] ` : '';
    const fullNotes = [deptTag + respTag, input.notes].filter(Boolean).join(' ').trim() || undefined;

    let picks: Array<{ batch: InventoryBatch; quantity: number }> = [];
    if (input.batchId) {
      const chosenBatch = (clonedStore.inventoryBatches || []).find(
        (b) => b.id === input.batchId && b.branchId === branchId
      );
      if (!chosenBatch || chosenBatch.remainingQuantity < input.quantity) {
        throw new Error(
          `Insufficient quantity in batch '${chosenBatch?.batchNumber || input.batchId}'. Remaining: ${chosenBatch?.remainingQuantity || 0}, Requested: ${input.quantity}.`
        );
      }
      picks = [{ batch: chosenBatch, quantity: input.quantity }];
    } else {
      const isFefo = Boolean(item.trackExpiry);
      const batches = (clonedStore.inventoryBatches || [])
        .filter((b) => b.itemId === item.id && b.branchId === branchId && b.remainingQuantity > 0 && (movementType === 'EXPIRED_OUT' || b.status !== 'EXPIRED'))
        .sort((a, b) => {
          if (isFefo) {
            const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
            const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
            if (ea !== eb) return ea - eb;
          }
          const ra = a.receivedDate ? new Date(a.receivedDate).getTime() : 0;
          const rb = b.receivedDate ? new Date(b.receivedDate).getTime() : 0;
          if (ra !== rb) return ra - rb;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

      const totalStock = batches.reduce((sum, b) => sum + b.remainingQuantity, 0);
      if (totalStock < input.quantity) {
        throw new Error(`Insufficient stock in branch for '${item.name}'. Available: ${totalStock}, Requested: ${input.quantity}.`);
      }

      let remaining = input.quantity;
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(b.remainingQuantity, remaining);
        picks.push({ batch: b, quantity: take });
        remaining = roundCurrency(remaining - take);
      }
    }

    if (!clonedStore.stockMovements) clonedStore.stockMovements = [];
    if (!clonedStore.movementSequenceCounters) clonedStore.movementSequenceCounters = {};

    let firstMovement: StockMovement | null = null;
    const nowIso = new Date().toISOString();

    for (const pick of picks) {
      const smCount = (clonedStore.movementSequenceCounters[`${branch.code}-2026`] || 0) + 1;
      clonedStore.movementSequenceCounters[`${branch.code}-2026`] = smCount;
      const movementNumber = nextReference(clonedStore, 'SM');

      pick.batch.remainingQuantity = roundCurrency(pick.batch.remainingQuantity - pick.quantity);
      if (pick.batch.remainingQuantity === 0) {
        pick.batch.status = 'EXHAUSTED';
      }
      pick.batch.updatedAt = nowIso;

      const unitCost = pick.batch.unitCostSnapshot || item.defaultPurchaseCost || 0;
      const totalCostImpact = roundCurrency(pick.quantity * unitCost);

      const movement: StockMovement = {
        id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        movementNumber,
        branchId,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        batchId: pick.batch.id,
        batchNumber: pick.batch.batchNumber,
        movementType,
        direction: 'OUT',
        quantity: pick.quantity,
        unitCostSnapshot: unitCost,
        totalCostImpact,
        sourceReferenceType: 'MANUAL_OUT',
        sourceReferenceId: movementNumber,
        referenceId: movementNumber,
        sourceReferenceNumber: movementNumber,
        reason: input.reason || movementType,
        notes: fullNotes,
        createdById: authenticatedActor.id,
        createdByName: authenticatedActor.name,
        createdAt: nowIso,
      };

      clonedStore.stockMovements.unshift(movement);
      if (!firstMovement) firstMovement = movement;
    }

    mockStorage.saveStore(clonedStore);
    return { ...firstMovement! };
  }

  async getConsumptionPreview(
    params: { itemId: string; branchId: string; quantity: number; batchId?: string; reasonType?: string },
    actor?: User
  ): Promise<ConsumptionPreview> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    const store = mockStorage.getStore();
    const branchId = params.branchId === 'ALL' ? (authenticatedActor.branchId || 'b0000000-0000-0000-0000-000000000001') : params.branchId;
    const item = (store.inventoryItems || []).find((i) => i.id === params.itemId);
    if (!item) throw new Error(`Inventory item '${params.itemId}' not found.`);

    if (params.batchId) {
      const batch = (store.inventoryBatches || []).find((b) => b.id === params.batchId && b.branchId === branchId);
      if (!batch) throw new Error(`Batch '${params.batchId}' not found.`);
      const remaining = batch.remainingQuantity;
      const take = Math.min(remaining, params.quantity);
      const unitCost = batch.unitCostSnapshot || item.defaultPurchaseCost || 0;
      const totalCost = roundCurrency(take * unitCost);
      return {
        availableStock: remaining,
        requestedQuantity: params.quantity,
        isFulfillable: remaining >= params.quantity,
        costBreakdown: [
          {
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantity: take,
            unitCost,
            totalCost,
            expiryDate: batch.expiryDate,
          },
        ],
        totalCost,
      };
    }

    const isFefo = Boolean(item.trackExpiry);
    const batches = (store.inventoryBatches || [])
      .filter((b) => b.itemId === item.id && b.branchId === branchId && b.remainingQuantity > 0 && (params.reasonType === 'EXPIRED' || b.status !== 'EXPIRED'))
      .sort((a, b) => {
        if (isFefo) {
          const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
          const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
          if (ea !== eb) return ea - eb;
        }
        const ra = a.receivedDate ? new Date(a.receivedDate).getTime() : 0;
        const rb = b.receivedDate ? new Date(b.receivedDate).getTime() : 0;
        if (ra !== rb) return ra - rb;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    const availableStock = batches.reduce((sum, b) => sum + b.remainingQuantity, 0);
    let remaining = params.quantity;
    const breakdown: Array<{ batchId: string; batchNumber: string; quantity: number; unitCost: number; totalCost: number; expiryDate?: string }> = [];
    let totalCost = 0;

    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.remainingQuantity, remaining);
      const unitCost = b.unitCostSnapshot || item.defaultPurchaseCost || 0;
      const lineCost = roundCurrency(take * unitCost);
      breakdown.push({
        batchId: b.id,
        batchNumber: b.batchNumber,
        quantity: take,
        unitCost,
        totalCost: lineCost,
        expiryDate: b.expiryDate,
      });
      totalCost = roundCurrency(totalCost + lineCost);
      remaining = roundCurrency(remaining - take);
    }

    return {
      availableStock,
      requestedQuantity: params.quantity,
      isFulfillable: availableStock >= params.quantity,
      costBreakdown: breakdown,
      totalCost,
    };
  }

  async reverseStockMovement(movementId: string, reason: string, actor?: User): Promise<StockMovement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: Only administrators can reverse stock movements.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const original = (clonedStore.stockMovements || []).find((m) => m.id === movementId);
    if (!original) throw new Error(`Stock movement '${movementId}' not found.`);
    if (original.direction !== 'OUT') throw new Error('Only outbound movements can be reversed.');
    if (original.sourceReferenceType !== 'MANUAL_OUT' && !original.movementType.endsWith('_OUT')) {
      throw new Error(`Cannot reverse movement of type '${original.sourceReferenceType}'.`);
    }

    const prior = (clonedStore.stockMovements || []).find(
      (m) => m.sourceReferenceType === 'STOCK_MOVEMENT_REVERSAL' && m.sourceReferenceId === original.id
    );
    if (prior) throw new Error(`Movement '${original.movementNumber}' was already reversed under '${prior.movementNumber}'.`);

    if (original.batchId) {
      const batch = (clonedStore.inventoryBatches || []).find((b) => b.id === original.batchId);
      if (batch) {
        batch.remainingQuantity = roundCurrency(batch.remainingQuantity + original.quantity);
        if (batch.status === 'EXHAUSTED') batch.status = 'VALID';
        batch.updatedAt = new Date().toISOString();
      }
    }

    const branch = clonedStore.branches.find((b) => b.id === original.branchId) || clonedStore.branches[0];
    if (!clonedStore.movementSequenceCounters) clonedStore.movementSequenceCounters = {};
    const smCount = (clonedStore.movementSequenceCounters[`${branch.code}-2026`] || 0) + 1;
    clonedStore.movementSequenceCounters[`${branch.code}-2026`] = smCount;
    const movementNumber = nextReference(clonedStore, 'SM');
    const nowIso = new Date().toISOString();

    const compensating: StockMovement = {
      id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      movementNumber,
      branchId: original.branchId,
      itemId: original.itemId,
      itemName: original.itemName,
      itemSku: original.itemSku,
      batchId: original.batchId,
      batchNumber: original.batchNumber,
      movementType: 'POSITIVE_ADJUSTMENT',
      direction: 'IN',
      quantity: original.quantity,
      unitCostSnapshot: original.unitCostSnapshot,
      totalCostImpact: original.totalCostImpact,
      sourceReferenceType: 'STOCK_MOVEMENT_REVERSAL',
      sourceReferenceId: original.id,
      referenceId: original.id,
      sourceReferenceNumber: original.movementNumber,
      reason: `Compensating reversal of ${original.movementNumber}: ${reason}`,
      notes: `Original Reason: ${original.reason} | Reversal Reason: ${reason}`,
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      createdAt: nowIso,
    };

    if (!clonedStore.stockMovements) clonedStore.stockMovements = [];
    clonedStore.stockMovements.unshift(compensating);
    mockStorage.saveStore(clonedStore);
    return { ...compensating };
  }

  // ======================================================================
  // PHASE 3H: STOCK SETTLEMENT / PHYSICAL RECONCILIATION
  // ======================================================================

  async getStockSettlements(branchId: string | 'ALL', actor?: User): Promise<StockSettlement[]> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to view stock settlement records.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN') {
      targetBranchId = authenticatedActor.branchId;
    }

    let list = store.stockSettlements || [];
    if (targetBranchId !== 'ALL') {
      list = list.filter((s) => s.branchId === targetBranchId);
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list.map((s) => ({ ...s }));
  }

  async getStockSettlement(id: string, actor?: User): Promise<StockSettlement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to view stock settlement records.');
    }

    const store = mockStorage.getStore();
    const st = (store.stockSettlements || []).find((s) => s.id === id);
    if (!st) {
      throw new Error(`Stock settlement '${id}' not found.`);
    }
    return { ...st };
  }

  async createStockSettlement(
    input: CreateStockSettlementInput,
    actor?: User
  ): Promise<StockSettlement> {
    const authenticatedActor = this.getAuthenticatedActor(actor);
    if (authenticatedActor.role === 'STAFF' || authenticatedActor.role === 'ACCOUNTANT') {
      throw new Error('Access Denied: You do not have permission to perform stock settlements.');
    }

    let branchId = input.branchId;
    if (authenticatedActor.role === 'ADMIN') {
      branchId = authenticatedActor.branchId;
    }
    if (!branchId || branchId === 'ALL') {
      throw new Error('An explicit branch must be selected for stock settlement.');
    }

    if (!input.lines || input.lines.length === 0) {
      throw new Error('Stock settlement requires at least one item line to reconcile.');
    }

    const store = mockStorage.getStore();
    const clonedStore: StorageSchema = JSON.parse(JSON.stringify(store));

    const branch = clonedStore.branches.find((b) => b.id === branchId);
    if (!branch || !branch.isActive) {
      throw new Error(`Branch '${branchId}' is invalid.`);
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (!clonedStore.settlementRecordSequenceCounters) clonedStore.settlementRecordSequenceCounters = {};
    const stCount = (clonedStore.settlementRecordSequenceCounters[`${branch.code}-2026`] || 0) + 1;
    clonedStore.settlementRecordSequenceCounters[`${branch.code}-2026`] = stCount;
    const settlementNumber = nextReference(clonedStore, 'ST');
    const settlementId = `st-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    let totalSystemQuantity = 0;
    let totalCountedQuantity = 0;
    let totalDiscrepancyQuantity = 0;
    let totalNetCostImpact = 0;

    const computedLines: StockSettlementLine[] = [];
    if (!clonedStore.stockMovements) clonedStore.stockMovements = [];

    for (const l of input.lines) {
      const item = (clonedStore.inventoryItems || []).find((it) => it.id === l.itemId);
      if (!item) {
        throw new Error(`Item '${l.itemId}' not found.`);
      }

      let systemQuantity = 0;
      let unitCostSnapshot = item.defaultPurchaseCost;
      let batchNumber = '';
      let targetBatch: InventoryBatch | undefined;

      if (l.batchId) {
        targetBatch = (clonedStore.inventoryBatches || []).find(
          (b) => b.id === l.batchId && b.branchId === branchId
        );
        if (targetBatch) {
          systemQuantity = targetBatch.remainingQuantity;
          unitCostSnapshot = targetBatch.unitCostSnapshot;
          batchNumber = targetBatch.batchNumber;
        }
      } else {
        const itemBatches = (clonedStore.inventoryBatches || []).filter(
          (b) => b.itemId === item.id && b.branchId === branchId
        );
        systemQuantity = itemBatches.reduce((sum, b) => sum + b.remainingQuantity, 0);
        if (itemBatches.length > 0) {
          unitCostSnapshot = itemBatches[0].unitCostSnapshot;
          targetBatch = itemBatches[0];
          batchNumber = targetBatch.batchNumber;
        }
      }

      const diff = roundCurrency(l.countedQuantity - systemQuantity);
      const costImpact = roundCurrency(diff * unitCostSnapshot);

      if (diff !== 0 && !l.reason) {
        throw new Error(`A non-zero difference of ${diff} for '${item.name}' requires a documented discrepancy reason.`);
      }

      totalSystemQuantity += systemQuantity;
      totalCountedQuantity += l.countedQuantity;
      totalDiscrepancyQuantity += diff;
      totalNetCostImpact = roundCurrency(totalNetCostImpact + costImpact);

      computedLines.push({
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        batchId: l.batchId,
        batchNumber,
        systemQuantity,
        countedQuantity: l.countedQuantity,
        difference: diff,
        unitCostSnapshot,
        costImpact,
        reason: l.reason || 'COUNTING_CORRECTION',
        notes: l.notes?.trim(),
      });

      // If discrepancy exists, post stock adjustment movements
      if (diff !== 0) {
        const smCount = ((clonedStore.movementSequenceCounters || {})[`${branch.code}-2026`] || 0) + 1;
        if (!clonedStore.movementSequenceCounters) clonedStore.movementSequenceCounters = {};
        clonedStore.movementSequenceCounters[`${branch.code}-2026`] = smCount;
        const moveNum = nextReference(clonedStore, 'SM');

        if (diff > 0) {
          // Positive adjustment (Counted > System)
          if (targetBatch) {
            targetBatch.remainingQuantity = roundCurrency(targetBatch.remainingQuantity + diff);
            targetBatch.status = 'VALID';
            targetBatch.updatedAt = nowIso;
          }

          clonedStore.stockMovements.push({
            id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            movementNumber: moveNum,
            branchId,
            itemId: item.id,
            itemName: item.name,
            itemSku: item.sku,
            batchId: targetBatch?.id,
            batchNumber,
            movementType: 'POSITIVE_ADJUSTMENT',
            direction: 'IN',
            quantity: diff,
            unitCostSnapshot,
            totalCostImpact: costImpact,
            sourceReferenceType: 'SETTLEMENT',
            sourceReferenceId: settlementId,
            referenceId: settlementId,
            sourceReferenceNumber: settlementNumber,
            reason: `Reconciliation adjustment (${l.reason})`,
            notes: l.notes?.trim(),
            createdById: authenticatedActor.id,
            createdByName: authenticatedActor.name,
            createdAt: nowIso,
          });
        } else {
          // Negative adjustment (Counted < System)
          const absDiff = Math.abs(diff);
          if (targetBatch) {
            targetBatch.remainingQuantity = Math.max(0, roundCurrency(targetBatch.remainingQuantity - absDiff));
            if (targetBatch.remainingQuantity === 0) {
              targetBatch.status = 'EXHAUSTED';
            }
            targetBatch.updatedAt = nowIso;
          }

          clonedStore.stockMovements.push({
            id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            movementNumber: moveNum,
            branchId,
            itemId: item.id,
            itemName: item.name,
            itemSku: item.sku,
            batchId: targetBatch?.id,
            batchNumber,
            movementType: 'NEGATIVE_ADJUSTMENT',
            direction: 'OUT',
            quantity: absDiff,
            unitCostSnapshot,
            totalCostImpact: Math.abs(costImpact),
            sourceReferenceType: 'SETTLEMENT',
            sourceReferenceId: settlementId,
            referenceId: settlementId,
            sourceReferenceNumber: settlementNumber,
            reason: `Reconciliation shortage (${l.reason})`,
            notes: l.notes?.trim(),
            createdById: authenticatedActor.id,
            createdByName: authenticatedActor.name,
            createdAt: nowIso,
          });
        }
      }
    }

    const newSettlement: StockSettlement = {
      id: settlementId,
      settlementNumber,
      branchId,
      countDate: input.countDate || mockStorage.getSystemDate(),
      notes: input.notes?.trim(),
      status: 'POSTED',
      lines: computedLines,
      totalSystemQuantity,
      totalCountedQuantity,
      totalDiscrepancyQuantity,
      totalNetCostImpact,
      createdById: authenticatedActor.id,
      createdByName: authenticatedActor.name,
      approvedById: authenticatedActor.id,
      approvedByName: authenticatedActor.name,
      createdAt: nowIso,
      postedAt: nowIso,
    };

    if (!clonedStore.stockSettlements) clonedStore.stockSettlements = [];
    clonedStore.stockSettlements.unshift(newSettlement);

    mockStorage.saveStore(clonedStore);
    return { ...newSettlement };
  }

  // ======================================================================
  // PHASE 3H: INVENTORY REPORTING & COGS
  // ======================================================================

  async getInventorySummary(
    branchId: string | 'ALL',
    actor?: User
  ): Promise<{
    totalInventoryCostValue: number;
    totalRetailValue: number;
    totalItemsCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    nearExpiryCount: number;
    expiredCount: number;
    totalSupplierPayable: number;
    recentPurchasesAmount: number;
  }> {
    const snapshots = await this.getStockLevelSnapshots(branchId, actor);
    const store = mockStorage.getStore();

    let targetBranchId = branchId;
    if (actor && (actor.role === 'ADMIN' || actor.role === 'ACCOUNTANT')) {
      targetBranchId = actor.branchId;
    }

    let suppliers = store.suppliers || [];
    let purchases = store.purchases || [];

    if (targetBranchId !== 'ALL') {
      suppliers = suppliers.filter((s) => s.branchId === 'ALL' || s.branchId === targetBranchId);
      purchases = purchases.filter((p) => p.branchId === targetBranchId);
    }

    const totalInventoryCostValue = roundCurrency(snapshots.reduce((sum, s) => sum + s.valuationCostBasis, 0));
    const totalRetailValue = roundCurrency(snapshots.reduce((sum, s) => sum + s.potentialRetailValue, 0));
    const totalItemsCount = snapshots.length;
    const lowStockCount = snapshots.filter((s) => s.isLowStock).length;
    const outOfStockCount = snapshots.filter((s) => s.isOutOfStock).length;
    const nearExpiryCount = snapshots.reduce((sum, s) => sum + s.nearExpiryBatchesCount, 0);
    const expiredCount = snapshots.reduce((sum, s) => sum + s.expiredBatchesCount, 0);
    const totalSupplierPayable = roundCurrency(suppliers.reduce((sum, s) => sum + s.currentPayable, 0));
    const recentPurchasesAmount = roundCurrency(purchases.reduce((sum, p) => sum + p.netAmount, 0));

    return {
      totalInventoryCostValue,
      totalRetailValue,
      totalItemsCount,
      lowStockCount,
      outOfStockCount,
      nearExpiryCount,
      expiredCount,
      totalSupplierPayable,
      recentPurchasesAmount,
    };
  }

  async getCOGSReport(
    branchId: string | 'ALL',
    dateRange: { startDate?: string; endDate?: string } | string,
    endDateOrActor?: string | User,
    actor?: User
  ): Promise<{
    records: COGSReportRecord[];
    summary: COGSReportSummary;
  }> {
    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    let actualActor: User | undefined = actor;

    if (typeof dateRange === 'string') {
      startDate = dateRange;
      if (typeof endDateOrActor === 'string') {
        endDate = endDateOrActor;
      } else if (endDateOrActor && typeof endDateOrActor === 'object' && 'role' in endDateOrActor) {
        actualActor = endDateOrActor as User;
      }
    } else if (dateRange && typeof dateRange === 'object') {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
      if (endDateOrActor && typeof endDateOrActor === 'object' && 'role' in endDateOrActor) {
        actualActor = endDateOrActor as User;
      }
    }

    const authenticatedActor = this.getAuthenticatedActor(actualActor);
    if (authenticatedActor.role === 'STAFF') {
      throw new Error('Access Denied: Staff members cannot access COGS reporting.');
    }

    const store = mockStorage.getStore();
    let targetBranchId = branchId;
    if (authenticatedActor.role === 'ADMIN' || authenticatedActor.role === 'ACCOUNTANT') {
      targetBranchId = authenticatedActor.branchId;
    }

    let invoices = [...(store.invoices || [])];
    let movements = store.stockMovements || [];

    if (targetBranchId !== 'ALL') {
      invoices = invoices.filter((inv) => inv.branchId === targetBranchId);
      movements = movements.filter((m) => m.branchId === targetBranchId);
    }

    if (startDate) {
      invoices = invoices.filter((inv) => inv.date >= startDate!);
      movements = movements.filter((m) => m.createdAt.slice(0, 10) >= startDate!);
    }
    if (endDate) {
      invoices = invoices.filter((inv) => inv.date <= endDate!);
      movements = movements.filter((m) => m.createdAt.slice(0, 10) <= endDate!);
    }

    const branchesMap = new Map((store.branches || []).map((b) => [b.id, b.name]));
    const itemsMap = new Map((store.inventoryItems || []).map((i) => [i.id, i]));

    const productStats = new Map<
      string,
      {
        productId: string;
        productName: string;
        sku: string;
        category: string;
        branchId: string;
        branchName: string;
        quantitySold: number;
        quantityReturned: number;
        grossSales: number;
        discountAllocated: number;
        netSales: number;
        cogs: number;
      }
    >();

    let totalServiceRevenue = 0;

    for (const inv of invoices) {
      for (const li of inv.lineItems || []) {
        const isProduct =
          li.type === 'PRODUCT' ||
          (li.itemId && itemsMap.has(li.itemId) && (itemsMap.get(li.itemId)?.itemType === 'RETAIL_PRODUCT' || itemsMap.get(li.itemId)?.itemType === 'BOTH'));

        if (li.type === 'SERVICE' || li.type === 'PACKAGE') {
          totalServiceRevenue = roundCurrency(totalServiceRevenue + (li.netSales || 0));
        } else if (isProduct) {
          const itemKey = `${inv.branchId}_${li.itemId || li.code || li.name}`;
          const existing = productStats.get(itemKey) || {
            productId: li.itemId || '',
            productName: li.name,
            sku: li.code || '',
            category: itemsMap.get(li.itemId || '')?.category || 'Retail',
            branchId: inv.branchId,
            branchName: branchesMap.get(inv.branchId) || inv.branchId,
            quantitySold: 0,
            quantityReturned: 0,
            grossSales: 0,
            discountAllocated: 0,
            netSales: 0,
            cogs: 0,
          };

          const matchingMovements = movements.filter(
            (m) => m.sourceReferenceId === inv.id && m.itemId === (li.itemId || '') && m.movementType === 'POS_SALE_OUT'
          );
          const movementsCogs = matchingMovements.reduce((sum, m) => sum + m.totalCostImpact, 0);
          const lineCogs = li.cogsAmount !== undefined && li.cogsAmount > 0 ? li.cogsAmount : movementsCogs;

          existing.quantitySold += li.quantity;
          existing.grossSales = roundCurrency(existing.grossSales + li.unitPrice * li.quantity);
          existing.discountAllocated = roundCurrency(existing.discountAllocated + (li.discountAllocated || 0));
          existing.netSales = roundCurrency(existing.netSales + (li.netSales || 0));
          existing.cogs = roundCurrency(existing.cogs + lineCogs);

          productStats.set(itemKey, existing);
        }
      }
    }

    // Adjust for product returns / reversals if any
    const returnMovements = movements.filter(
      (m) => m.movementType === 'POS_RETURN_IN' || m.movementType === 'SALES_RETURN_IN'
    );
    for (const rm of returnMovements) {
      const itemKey = `${rm.branchId}_${rm.itemId}`;
      const existing = productStats.get(itemKey);
      if (existing) {
        existing.quantityReturned += rm.quantity;
        existing.cogs = Math.max(0, roundCurrency(existing.cogs - rm.totalCostImpact));
      }
    }

    const records: COGSReportRecord[] = [];
    let totalRetailNetSales = 0;
    let totalRetailCOGS = 0;
    let totalRetailGrossProfit = 0;

    productStats.forEach((stat) => {
      const netQty = stat.quantitySold - stat.quantityReturned;
      const grossProfit = roundCurrency(stat.netSales - stat.cogs);
      const marginPercentage = stat.netSales > 0 ? roundCurrency((grossProfit / stat.netSales) * 100) : 0;

      totalRetailNetSales = roundCurrency(totalRetailNetSales + stat.netSales);
      totalRetailCOGS = roundCurrency(totalRetailCOGS + stat.cogs);
      totalRetailGrossProfit = roundCurrency(totalRetailGrossProfit + grossProfit);

      records.push({
        ...stat,
        netQuantity: netQty,
        grossProfit,
        marginPercentage,
      });
    });

    // Material consumption cost from salon consumable stock out movements
    const totalConsumableMaterialCost = roundCurrency(
      movements
        .filter((m) => m.movementType === 'SALON_CONSUMPTION_OUT')
        .reduce((sum, m) => sum + m.totalCostImpact, 0)
    );

    const retailGrossMarginPercentage =
      totalRetailNetSales > 0 ? roundCurrency((totalRetailGrossProfit / totalRetailNetSales) * 100) : 0;

    const serviceContributionBeforeExpenses = roundCurrency(
      totalServiceRevenue - totalConsumableMaterialCost
    );

    return {
      records,
      summary: {
        totalRetailNetSales,
        netProductSales: totalRetailNetSales,
        totalRetailCOGS,
        totalCOGS: totalRetailCOGS,
        totalRetailGrossProfit,
        grossProfit: totalRetailGrossProfit,
        retailGrossMarginPercentage,
        totalConsumableMaterialCost,
        totalServiceRevenue,
        serviceContributionBeforeExpenses,
      },
    };
  }

  async getGeneralLedger(): Promise<GeneralLedgerResponse> {
    return {
      movements: [],
      summary: {
        openingBalance: 0,
        totalIn: 0,
        totalOut: 0,
        netMovement: 0,
        closingBalance: 0,
        count: 0,
      },
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 1,
      },
    };
  }

  async getAuditEvents(): Promise<AuditEventsResponse> {
    return {
      events: [],
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 1,
    };
  }

  async markAllAttendance(): Promise<{ markedCount: number; skippedCount: number; markedNames: string[]; skippedNames: string[] }> {
    return { markedCount: 0, skippedCount: 0, markedNames: [], skippedNames: [] };
  }

  // ── Step 23 · Hardware & Device Integration (Mock) ────────────────────────
  async getDevices(branchId?: string | 'ALL', _actor?: any, query?: { deviceType?: string; status?: string; search?: string }): Promise<Device[]> {
    const store = mockStorage.getStore();
    let devices: Device[] = store?.devices || [];
    if (devices.length === 0) {
      devices = [
        {
          id: 'dev-zkteco-01',
          branchId: 'b-lhe',
          branchName: 'Lahore Gulberg Branch',
          branchCode: 'LHE',
          name: 'Front Desk Biometric Terminal',
          deviceType: 'BIOMETRIC_ATTENDANCE',
          brand: 'ZKTeco',
          model: 'iClock 880',
          serialNumber: 'ZK-LHE-98210',
          connectionType: 'ETHERNET_LAN',
          ipAddress: '192.168.1.201',
          port: 4370,
          macAddress: '00:1A:79:B2:34:56',
          baudRate: null,
          communicationKey: '••••••••',
          status: 'ONLINE',
          isActive: true,
          lastPingAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
          lastSyncAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
          lastSyncStatus: 'Verified 18 active employee biometric punch logs.',
          config: { autoPush: true, bellTiming: '09:00' },
          logsCount: 24,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'dev-printer-01',
          branchId: 'b-lhe',
          branchName: 'Lahore Gulberg Branch',
          branchCode: 'LHE',
          name: 'POS Counter Receipt Printer',
          deviceType: 'POS_PRINTER',
          brand: 'Epson',
          model: 'TM-T88VI',
          serialNumber: 'EP-5829104',
          connectionType: 'ETHERNET_LAN',
          ipAddress: '192.168.1.202',
          port: 9100,
          macAddress: '00:26:AB:44:89:12',
          baudRate: null,
          communicationKey: null,
          status: 'ONLINE',
          isActive: true,
          lastPingAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
          lastSyncAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
          lastSyncStatus: 'Printer ready, roll status OK.',
          config: { paperWidth: 80, autoCut: true, drawerKick: true },
          logsCount: 12,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      if (store) {
        store.devices = devices;
        mockStorage.saveStore(store);
      }
    }
    if (branchId && branchId !== 'ALL') {
      devices = devices.filter((d: Device) => d.branchId === branchId);
    }
    if (query?.deviceType) {
      devices = devices.filter((d: Device) => d.deviceType === query.deviceType);
    }
    if (query?.status) {
      devices = devices.filter((d: Device) => d.status === query.status);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      devices = devices.filter((d: Device) =>
        d.name.toLowerCase().includes(q) ||
        d.brand.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        (d.ipAddress && d.ipAddress.includes(q))
      );
    }
    return devices;
  }

  async getDevice(id: string, _actor?: any): Promise<Device | null> {
    const store = mockStorage.getStore();
    const device = (store?.devices || []).find((d: Device) => d.id === id);
    return device || null;
  }

  async createDevice(input: CreateDeviceInput, actor?: any): Promise<Device> {
    const store = mockStorage.getStore();
    const newDevice: Device = {
      id: `dev-${Date.now()}`,
      branchId: input.branchId || actor?.branchId || 'b-lhe',
      branchName: 'Selected Branch',
      branchCode: 'CUR',
      name: input.name,
      deviceType: input.deviceType,
      brand: input.brand,
      model: input.model,
      serialNumber: input.serialNumber || null,
      connectionType: input.connectionType || 'ETHERNET_LAN',
      ipAddress: input.ipAddress || null,
      port: input.port || null,
      macAddress: input.macAddress || null,
      baudRate: input.baudRate || null,
      communicationKey: input.communicationKey ? '••••••••' : null,
      status: 'OFFLINE',
      isActive: input.isActive ?? true,
      lastPingAt: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      config: input.config || null,
      logsCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (store) {
      store.devices = [newDevice, ...(store.devices || [])];
      mockStorage.saveStore(store);
    }
    return newDevice;
  }

  async updateDevice(id: string, input: UpdateDeviceInput, _actor?: any): Promise<Device> {
    const store = mockStorage.getStore();
    const device = (store?.devices || []).find((d: Device) => d.id === id);
    if (!device) throw new Error(`Device '${id}' not found.`);
    Object.assign(device, input, { updatedAt: new Date().toISOString() });
    if (store) mockStorage.saveStore(store);
    return device;
  }

  async toggleDeviceStatus(id: string, _actor?: any): Promise<Device> {
    const store = mockStorage.getStore();
    const device = (store?.devices || []).find((d: Device) => d.id === id);
    if (!device) throw new Error(`Device '${id}' not found.`);
    device.isActive = !device.isActive;
    device.status = device.isActive ? 'ONLINE' : 'OFFLINE';
    device.updatedAt = new Date().toISOString();
    if (store) mockStorage.saveStore(store);
    return device;
  }

  async deleteDevice(id: string, _actor?: any): Promise<{ success: boolean; message: string }> {
    const store = mockStorage.getStore();
    if (store && store.devices) {
      store.devices = store.devices.filter((d: Device) => d.id !== id);
      mockStorage.saveStore(store);
    }
    return { success: true, message: 'Device removed successfully.' };
  }

  async testDeviceConnection(id: string, _options?: any, _actor?: any): Promise<TestConnectionResult> {
    const store = mockStorage.getStore();
    const device = (store?.devices || []).find((d: Device) => d.id === id);
    const now = new Date().toISOString();
    if (device) {
      device.status = 'ONLINE';
      device.lastPingAt = now;
      device.lastSyncStatus = 'Connection verified (Latency: 28ms)';
      if (store) mockStorage.saveStore(store);
    }
    return {
      connected: true,
      latencyMs: 28,
      status: 'ONLINE',
      message: 'Hardware connection established. Ping round-trip latency: 28ms.',
      diagnostics: { host: device?.ipAddress || '192.168.1.201', port: device?.port || 4370 },
    };
  }

  async syncDevice(id: string, _options?: any, _actor?: any): Promise<SyncDeviceResult> {
    const store = mockStorage.getStore();
    const device = (store?.devices || []).find((d: Device) => d.id === id);
    const now = new Date().toISOString();
    const summary = 'Device logs buffer synchronized with branch records.';
    if (device) {
      device.status = 'ONLINE';
      device.lastSyncAt = now;
      device.lastSyncStatus = summary;
      if (store) mockStorage.saveStore(store);
    }
    return {
      success: true,
      deviceId: id,
      syncedAt: now,
      status: 'ONLINE',
      message: summary,
      details: { recordsProcessed: 12 },
    };
  }

  async getDeviceLogs(id: string, _actor?: any, _limit?: number): Promise<DeviceLog[]> {
    return [
      {
        id: 'log-1',
        deviceId: id,
        branchId: 'b-lhe',
        eventType: 'TEST_PING',
        status: 'SUCCESS',
        message: 'Socket ping verified latency: 28ms',
        createdAt: new Date().toISOString(),
      },
    ];
  }

  async resetTestData(params?: { branchId?: string; wipeCatalogue?: boolean; wipeInventory?: boolean; wipeClients?: boolean; wipeStaff?: boolean; wipeSuppliers?: boolean }): Promise<{ success: boolean; message: string; branchId: string; resetAt: string }> {
    const store = mockStorage.getStore();
    if (store) {
      const bId = params?.branchId;
      if (!bId || bId === 'ALL') {
        store.payrollRuns = [];
        store.payrollPayments = [];
      } else {
        if (store.payrollRuns) {
          store.payrollRuns = store.payrollRuns.filter((r: PayrollRun) => r.branchId !== bId);
        }
        if (store.payrollPayments) {
          store.payrollPayments = store.payrollPayments.filter((p: PayrollPayment) => p.branchId !== bId);
        }
      }
      mockStorage.saveStore(store);
    }
    return {
      success: true,
      message: 'Mock test data reset executed successfully.',
      branchId: params?.branchId || 'ALL',
      resetAt: new Date().toISOString(),
    };
  }
}

export const mockSalonService = new MockSalonService();
