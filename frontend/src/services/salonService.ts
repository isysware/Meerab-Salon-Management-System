import {
  Branch,
  Device,
  DeviceLog,
  CreateDeviceInput,
  UpdateDeviceInput,
  TestConnectionResult,
  SyncDeviceResult,
  OnlineAccount,
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
  ServiceCategory,
  TaxRule,
  CatalogueImportResult,
  PaymentAccount,
  InvoiceStatus,
  CreatePOSInvoiceInput,
  CollectOutstandingPaymentInput,
  RefundInvoiceInput,
  RefundInvoiceResult,
  InvoiceRefundDTO,
  Client,
  ExpenseCategoryItem,
  CashTransferRecord,
  ExpenseStatus,
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
  CreateOvertimeInput,
  UpdateOvertimeInput,
  PayrollRun,
  PayrollPreviewOptions,
  PayrollPayment,
  PayrollPolicyConfig,
  AttendancePolicyConfig,
  PayslipRecord,
  RecordPayrollPaymentInput,
  StaffAllowance,
  PayrollAdjustment,
  PayrollAdjustmentType,
  SalaryAdvance,
  IssueSalaryAdvanceInput,
  MonthlyPaySummary,
  StaffSalaryReport,
  StaffSalaryReportQuery,
  StaffCommissionReport,
  StaffCommissionReportQuery,
  SalesInvoicesReport,
  SalesInvoicesReportQuery,
  DetailedIncomeReport,
  DetailedIncomeReportQuery,
  IncomeExpenseReport,
  IncomeExpenseReportQuery,
  TaxReport,
  TaxReportQuery,
  OperatingProfitReport,
  OperatingProfitReportQuery,
  PaymentAccountsReport,
  PaymentAccountsReportQuery,
  CashDrawerReport,
  CashDrawerReportQuery,
  DetailedExpensesReport,
  DetailedExpensesReportQuery,
  InventoryReportData,
  InventoryReportQuery,
  AttendanceOvertimeReport,
  AttendanceOvertimeReportQuery,
  CommissionRun,
  CommissionPayment,
  CommissionStatementRecord,
  RecordCommissionPaymentInput,
  TipReceiptRecord,
  TipAllocationRecord,
  TipPayoutRecord,
  AllocateTipsInput,
  RecordTipPayoutInput,
  ReverseTipPayoutInput,
  StaffPerformanceRecord,
  TipsStatementSummary,
  AppointmentStatus,
  AppointmentBillingStatus,
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
  PurchasePaymentMethod,
  SupplierPaymentRecord,
  SupplierReturn,
  StockMovement,
  StockMovementType,
  StockSettlement,
  StockLevelSnapshot,
  COGSReportRecord,
  COGSReportSummary,
  ItemType,
  CreatePurchaseInput,
  CreateInventoryItemInput,
  PaySupplierInput,
  CreateSupplierReturnInput,
  CreateManualStockOutInput,
  CreateStockSettlementInput,
} from '../types/salon';
import { User, Role } from '../types/auth';

export interface BranchFinancialMetrics {
  branchId: string;
  branchName: string;
  branchCode: string;
  grossSales: number; // Gross sales before discounts (all confirmed invoices)
  totalDiscounts: number; // Promotional discounts given
  netSales: number; // Net sales after discounts, excluding tax and tips
  taxBilled: number; // Provincial sales tax billed (PST/SST)
  tipsCollected: number; // Segregated customer gratuity (held outside revenue)
  actualCollections: number; // Total cash and online bill collections received
  cashCollected: number; // Actual physical cash received from POS
  onlineCollected: number; // Actual electronic/bank collections
  outstandingReceivables: number; // Uncollected balances from pending invoices
  cashInCustody: number; // Physical cash in active cash drawer
  onlineBalancesTotal: number; // Sum of active named online bank/wallet accounts
  totalExpensesPaid: number; // Expenses disbursed in period
  netOperatingCashFlow: number; // Actual collections minus total expenses paid
  activeStaffOnDuty: number; // Staff with verified on-duty punch for today
  appointmentsTodayCount: number; // Appointments scheduled for today
  invoicesCount: number; // Count of invoices issued
}

export interface SuperAdminDashboardData {
  isConsolidated: boolean;
  activeBranchId: string | 'ALL';
  activeBranchName: string;
  metrics: BranchFinancialMetrics;
  branchStats: BranchFinancialMetrics[];
  onlineAccounts: OnlineAccount[];
  todayAppointments: Appointment[];
  recentInvoices: Invoice[];
  cashDrawers: CashDrawer[];
  pendingSettlementsCount: number;
  pendingSettlementsTotal: number;
  totalClientsCount?: number;
  totalServicesCount?: number;
  totalAppointmentsCount?: number;
  staffList?: Array<{ id: string; name: string; roleTitle: string }>;
  revenueTrend?: Array<{ label: string; revenue: number; expenses: number; collections: number }>;
  categoryBreakdown?: Array<{ type: string; count: number; revenue: number }>;
}

export interface AdminDashboardData {
  branch: Branch;
  metrics: BranchFinancialMetrics;
  staffAttendanceSummary: {
    presentCount: number;
    totalCount: number;
    onDutyStaffNames: string[];
  };
  todayAppointments: Appointment[];
  pendingActions: Array<{
    id: string;
    title: string;
    description: string;
    count: number;
    urgency: 'high' | 'medium' | 'low';
    href: string;
  }>;
  recentInvoices: Invoice[];
  recentExpenses: Expense[];
  onlineAccounts: OnlineAccount[];
  cashDrawers: CashDrawer[];
  totalClientsCount?: number;
  totalServicesCount?: number;
  totalAppointmentsCount?: number;
  staffList?: Array<{ id: string; name: string; roleTitle: string }>;
  revenueTrend?: Array<{ label: string; revenue: number; expenses: number; collections: number }>;
  categoryBreakdown?: Array<{ type: string; count: number; revenue: number }>;
}

export interface AccountantDashboardData {
  branch: Branch;
  cashCustodyBalance: number; // Cash currently expected in drawer
  expectedCashInCustody: number; // Expected cash from receipts and float minus expenses
  lastCountedCash: number; // Last physically counted cash from verified settlement
  todayCashCollected: number;
  todayOnlineCollected: number;
  expensesPaidByAccountant: number;
  pendingSettlementAmount: number;
  settlementStatus: 'PENDING_VERIFICATION' | 'APPROVED_TRANSFERRED' | 'NO_PENDING';
  unpaidInvoicesCount: number;
  unpaidInvoicesTotal: number;
  recentCashReceipts: Invoice[];
  recentDisbursements: Expense[];
  activeSettlements: Settlement[];
}

export interface StaffDashboardData {
  staffMember: StaffMember;
  branch: Branch;
  monthlyServicesCompletedCount: number;
  monthlyServiceSalesTotal: number;
  earnedCommissionTotal: number;
  personalTipsTotal: number; // 100% separate from salon revenue
  attendanceSummary: {
    todayCheckIn: string;
    scheduledHoursWeek: number;
    workedHoursWeek: number;
    approvedOvertimeMinutesMonth: number;
    status: string;
  };
  monthlyEarningsSummary: {
    baseSalary: number;
    earnedCommission: number;
    directTips: number;
    approvedOvertimePay: number;
    estimatedGrossPayout: number;
  };
  recentCompletedServices: Array<{
    id: string;
    date: string;
    serviceName: string;
    clientName: string;
    servicePrice: number;
    commissionEarned: number;
    tipReceived: number;
  }>;
}

export interface SalonServiceContract {
  getBookings(query?: import('../types/booking').BookingQuery): Promise<import('../types/booking').Booking[]>;
  getBookingCollections(query?: import('../types/booking').BookingQuery): Promise<import('../types/booking').BookingCollection[]>;
  getBooking(id: string): Promise<import('../types/booking').Booking>;
  createBooking(input: import('../types/booking').BookingInput, key: string): Promise<import('../types/booking').Booking>;
  updateBooking(id: string, input: import('../types/booking').BookingInput): Promise<import('../types/booking').Booking>;
  recordBookingPayment(id: string, input: import('../types/booking').BookingPaymentInput, key: string): Promise<import('../types/booking').Booking>;
  refundBookingPayment(id: string, input: { payment: import('../types/booking').BookingPaymentInput; reason: string }, key: string): Promise<import('../types/booking').Booking>;
  cancelBooking(id: string, input: { status: 'CANCELLED' | 'NO_SHOW'; revision: number; reason: string; cancellationCharge: number; refundPayment?: import('../types/booking').BookingPaymentInput }, key: string): Promise<import('../types/booking').Booking>;
  startBooking(id: string, revision: number): Promise<import('../types/booking').Booking>;
  getBookingLedger(id: string): Promise<import('../types/booking').BookingLedger>;
  getBookingHandoff(id: string): Promise<import('../types/booking').Booking>;
  checkoutBooking(input: { bookingId: string; bookingRevision: number; bookingUpdate?: import('../types/booking').BookingInput; branchId: string; payments: { method: string; paymentAccountId?: string; amount: number; billAllocation: number; tipAllocation: number }[] }, key: string): Promise<Invoice>;
  getBranches(): Promise<Branch[]>;
  getBranch(id: string): Promise<Branch | null>;
  createBranch(branch: Omit<Branch, 'id'>, actor: User): Promise<Branch>;
  updateBranch(id: string, branch: Partial<Branch>, actor: User): Promise<Branch>;
  assignBranchAdmin(branchId: string, adminUserId: string, actor: User, credentials?: { email: string; password: string }): Promise<Branch>;
  unassignBranchAdmin(branchId: string, adminUserId: string, actor: User): Promise<Branch>;
  deactivateBranch(id: string, actor: User): Promise<{ success: boolean; message: string }>;
  deleteBranch(id: string, actor: User): Promise<{ success: boolean; message: string }>;
  checkBranchDeactivationBlockers(id: string): Promise<{ canDeactivate: boolean; blockers: string[] }>;

  getUsers(actor: User, branchId?: string): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  createUser(
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
    actor: User
  ): Promise<User>;
  updateUser(id: string, params: Partial<User>, actor: User): Promise<User>;
  deactivateUser(id: string, actor: User): Promise<{ success: boolean; message: string }>;
  reactivateUser(id: string, actor: User): Promise<{ success: boolean; message: string }>;
  deleteUser(id: string, actor: User): Promise<{ success: boolean; message: string }>;
  resetUserPassword(id: string, actor: User, newPassword?: string): Promise<{ success: boolean; temporaryPassword?: string; password?: string; message: string }>;

  getStaffMembers(actor: User, branchId?: string): Promise<StaffMember[]>;
  getStaffMember(id: string): Promise<StaffMember | null>;
  createStaffMember(
    params: {
      employeeCode: string;
      name: string;
      phone: string;
      email?: string;
      branchId: string;
      designation: string;
      joiningDate: string;
      compensationType?: StaffMember['compensationType'];
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
    actor: User
  ): Promise<{ staff: StaffMember; user?: User }>;
  updateStaffMember(id: string, params: Partial<StaffMember> & { enablePortalAccess?: boolean; portalIdentifier?: string; portalPassword?: string }, actor: User): Promise<StaffMember>;
  deactivateStaffMember(id: string, actor: User): Promise<{ success: boolean; message: string }>;
  setStaffPortalAccess(
    staffId: string,
    enable: boolean,
    credentials?: { identifier: string; password?: string },
    actor?: User
  ): Promise<{ staff: StaffMember; user?: User }>;

  getOnlineAccounts(branchId: string | 'ALL'): Promise<OnlineAccount[]>;
  getStaff(branchId: string | 'ALL'): Promise<StaffMember[]>;
  getAppointments(
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
  ): Promise<Appointment[]>;
  getInvoices(branchId: string | 'ALL'): Promise<Invoice[]>;
  getExpenses(branchId: string | 'ALL'): Promise<Expense[]>;
  getCashDrawers(branchId: string | 'ALL', userId?: string): Promise<CashDrawer[]>;
  getAttendance(branchId: string | 'ALL', date?: string, staffId?: string, actor?: User): Promise<AttendanceRecord[]>;
  getOvertime(branchId: string | 'ALL', staffId?: string, actor?: User): Promise<OvertimeRecord[]>;

  getSuperAdminDashboardData(activeBranchId: string | 'ALL'): Promise<SuperAdminDashboardData>;
  getAdminDashboardData(branchId: string): Promise<AdminDashboardData>;
  getAccountantDashboardData(branchId: string, accountantUserId: string): Promise<AccountantDashboardData>;
  getStaffDashboardData(staffId: string, branchId: string): Promise<StaffDashboardData>;

  // --- PHASE 2B: SERVICES, PACKAGES, TAX & PAYMENT ACCOUNTS ---
  getServices(branchId: string | 'ALL'): Promise<ServiceItem[]>;
  getService(id: string): Promise<ServiceItem | null>;
  createService(service: Omit<ServiceItem, 'id'>, actor?: User): Promise<ServiceItem>;
  updateService(id: string, service: Partial<ServiceItem>, actor?: User): Promise<ServiceItem>;
  toggleServiceStatus(id: string, actor?: User): Promise<ServiceItem>;
  bulkImportServices(branchId: string, rows: any[], actor?: User): Promise<CatalogueImportResult>;

  getPackages(branchId: string | 'ALL'): Promise<PackageItem[]>;
  getPackage(id: string): Promise<PackageItem | null>;
  createPackage(pkg: Omit<PackageItem, 'id'>, actor?: User): Promise<PackageItem>;
  updatePackage(id: string, pkg: Partial<PackageItem>, actor?: User): Promise<PackageItem>;
  togglePackageStatus(id: string, actor?: User): Promise<PackageItem>;
  bulkImportPackages(branchId: string, rows: any[], actor?: User): Promise<CatalogueImportResult>;

  getServiceCategories(branchId: string): Promise<ServiceCategory[]>;
  createServiceCategory(branchId: string, name: string, actor?: User): Promise<ServiceCategory>;

  getTaxRules(branchId: string): Promise<TaxRule[]>;
  createTaxRule(branchId: string, rule: Omit<TaxRule, 'id' | 'branchId'>, actor?: User): Promise<TaxRule>;
  updateTaxRule(id: string, rule: Partial<TaxRule>, actor?: User): Promise<TaxRule>;
  setBranchDefaultTaxRule(branchId: string, ruleId: string | null, actor?: User): Promise<Branch>;
  toggleTaxRuleStatus(id: string, actor?: User): Promise<TaxRule>;

  getPaymentAccounts(branchId: string | 'ALL'): Promise<PaymentAccount[]>;
  createPaymentAccount(branchId: string, account: Omit<PaymentAccount, 'id' | 'branchId' | 'currentBalance' | 'createdAt'>, actor?: User): Promise<PaymentAccount>;
  updatePaymentAccount(id: string, account: Partial<PaymentAccount>, actor?: User): Promise<PaymentAccount>;
  togglePaymentAccountStatus(id: string, actor?: User): Promise<PaymentAccount>;
  deletePaymentAccount(id: string, actor?: User): Promise<{ id: string; deleted?: boolean; archived?: boolean; message: string }>;

  getSystemDate(): Promise<string>;
  setSystemDate(date: string, actor?: User): Promise<void>;

  // Phase 3A: POS Billing, Customer Lookup and Collections
  getInvoices(branchId: string | 'ALL', filter?: { status?: InvoiceStatus; date?: string; startDate?: string; endDate?: string }): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  postPOSInvoice(input: CreatePOSInvoiceInput, actor?: User): Promise<Invoice>;
  collectInvoicePayment(input: CollectOutstandingPaymentInput, actor?: User): Promise<Invoice>;
  refundInvoice(invoiceId: string, input: RefundInvoiceInput, actor?: User): Promise<RefundInvoiceResult>;
  getInvoiceRefunds(invoiceId: string): Promise<InvoiceRefundDTO[]>;

  getClients(branchId: string | 'ALL', actor?: User): Promise<Client[]>;
  getClient(id: string, actor?: User): Promise<Client | null>;
  searchClients(branchId: string, query: string, actor?: User): Promise<Client[]>;
  getClientOutstandingInvoices(branchId: string, clientIdOrPhone: string, actor?: User): Promise<Invoice[]>;

  // Phase 3B: Expense Management
  getExpenses(
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
  ): Promise<Expense[]>;
  getExpense(id: string, actor?: User): Promise<Expense | null>;
  createExpenseDraft(params: Omit<Expense, 'id' | 'voucherNumber' | 'status' | 'createdAt'>, actor?: User): Promise<Expense>;
  updateExpenseDraft(id: string, params: Partial<Expense>, actor?: User): Promise<Expense>;
  deleteExpenseDraft(id: string, actor?: User): Promise<{ success: boolean; message: string }>;
  postExpense(
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
  ): Promise<Expense>;
  reverseExpense(id: string, reason: string, actor?: User): Promise<{ originalExpense: Expense; reversalExpense: Expense }>;

  getExpenseCategories(branchId: string | 'ALL', actor?: User): Promise<ExpenseCategoryItem[]>;
  createExpenseCategory(branchId: string, name: string, description?: string, actor?: User): Promise<ExpenseCategoryItem>;
  updateExpenseCategory(id: string, params: Partial<ExpenseCategoryItem>, actor?: User): Promise<ExpenseCategoryItem>;
  toggleExpenseCategoryStatus(id: string, actor?: User): Promise<ExpenseCategoryItem>;

  transferCashFloat(params: { branchId: string; targetUserId: string; amount: number; notes?: string }, actor?: User): Promise<CashTransferRecord>;

  // Phase 3C: Balance Sheet & Account Settlement
  getCashCustodyStatement(
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
  }>;

  getSettlements(
    branchId: string | 'ALL',
    filter?: {
      status?: string;
      submitterId?: string;
      drawerId?: string;
      startDate?: string;
      endDate?: string;
    },
    actor?: User
  ): Promise<Settlement[]>;

  getSettlement(id: string, actor?: User): Promise<Settlement | null>;

  createSettlementDraft(input: CreateSettlementInput, actor?: User): Promise<Settlement>;

  submitSettlement(input: CreateSettlementInput, actor?: User): Promise<Settlement>;

  approveSettlement(
    id: string,
    input: ApproveSettlementInput,
    actor?: User
  ): Promise<{
    settlement: Settlement;
    successorDrawer?: CashDrawer;
    varianceAdjustment?: CashVarianceAdjustment;
  }>;

  rejectSettlement(id: string, reason: string, actor?: User): Promise<Settlement>;

  // --- PHASE 3D: ATTENDANCE, LEAVES, HOLIDAYS & MANUAL OVERTIME ---
  createAttendance(input: CreateAttendanceInput, actor?: User): Promise<AttendanceRecord>;
  markAllAttendance(input: {
    branchId?: string;
    date: string;
    status?: 'PRESENT' | 'ABSENT';
    checkIn?: string;
    checkOut?: string;
    staffIds?: string[];
    notes?: string;
  }, actor?: User): Promise<{ markedCount: number; skippedCount: number; markedNames: string[]; skippedNames: string[] }>;
  correctAttendance(id: string, input: CorrectAttendanceInput, actor?: User): Promise<AttendanceRecord>;
  saveDailyAttendance(input: {
    branchId: string;
    date: string;
    records: Array<{
      staffId: string;
      status: string;
      checkIn?: string;
      checkOut?: string;
      notes?: string;
    }>;
  }, actor?: User): Promise<{ savedCount: number }>;
  finalizeDayAttendance(branchId: string, date: string, actor?: User): Promise<{ finalizedCount: number; markedAbsentStaffNames: string[] }>;
  importAttendanceCSV(branchId: string, rows: CSVAttendanceImportRow[], actor?: User): Promise<CSVAttendanceImportResult>;

  getLeaves(branchId: string | 'ALL', staffId?: string, actor?: User): Promise<LeaveRecord[]>;
  markLeave(input: CreateLeaveInput, actor?: User): Promise<LeaveRecord>;
  cancelLeave(id: string, reason: string, actor?: User): Promise<LeaveRecord>;

  getBranchHolidays(branchId: string | 'ALL'): Promise<BranchHoliday[]>;
  addBranchHoliday(holiday: Omit<BranchHoliday, 'id'>, actor?: User): Promise<BranchHoliday>;

  createOvertime(input: CreateOvertimeInput, actor?: User): Promise<OvertimeRecord>;
  updateOvertime(id: string, input: UpdateOvertimeInput, actor?: User): Promise<OvertimeRecord>;
  approveOvertime(id: string, actor?: User): Promise<OvertimeRecord>;
  rejectOvertime(id: string, reason: string, actor?: User): Promise<OvertimeRecord>;
  cancelOvertime(id: string, reason: string, actor?: User): Promise<OvertimeRecord>;

  getStaffPersonalAttendance(actor?: User): Promise<{ records: AttendanceRecord[]; leaves: LeaveRecord[]; summary: any }>;
  getStaffPersonalOvertime(actor?: User): Promise<{ records: OvertimeRecord[]; approvedMinutes: number; approvedPay: number }>;

  // --- PHASE 3E: PAYROLL & STAFF COMMISSION ---
  getPayrollPolicy(branchId: string): Promise<PayrollPolicyConfig>;
  updatePayrollPolicy(branchId: string, policy: Partial<PayrollPolicyConfig>, actor?: User): Promise<PayrollPolicyConfig>;
  getAttendancePolicy(branchId: string): Promise<AttendancePolicyConfig>;
  updateAttendancePolicy(branchId: string, policy: Partial<AttendancePolicyConfig>, actor?: User): Promise<AttendancePolicyConfig>;
  generatePayrollPreview(branchId: string, month: string, staffId?: string, actor?: User, options?: PayrollPreviewOptions): Promise<PayrollRun>;
  finalizePayroll(payrollRunId: string, actor?: User): Promise<PayrollRun>;
  recordPayrollPayment(input: RecordPayrollPaymentInput, actor?: User): Promise<{ payrollRun: PayrollRun; payment: PayrollPayment }>;
  cancelPayrollRun(payrollRunId: string, reason: string, actor?: User): Promise<PayrollRun>;
  reversePayrollPayment(paymentId: string, reason: string, actor?: User): Promise<PayrollPayment>;
  addManualDeduction(
    payslipId: string,
    input: { amount: number; title: string; notes?: string },
    actor?: User
  ): Promise<{ payslip: PayslipRecord; payrollRun: PayrollRun; adjustment: PayrollAdjustment }>;
  getPayrollRuns(branchId: string | 'ALL', month?: string, actor?: User): Promise<PayrollRun[]>;
  getStaffPersonalPayslips(actor?: User): Promise<PayslipRecord[]>;
  // Payroll inputs & monthly summary (payroll.md)
  getPayrollMonthlySummary(branchId: string, month: string): Promise<MonthlyPaySummary>;
  getStaffAllowances(branchId: string, staffId?: string): Promise<StaffAllowance[]>;
  createStaffAllowance(input: { staffId: string; name: string; amount: number }): Promise<StaffAllowance>;
  updateStaffAllowance(id: string, input: { name?: string; amount?: number; isActive?: boolean }): Promise<StaffAllowance>;
  getPayrollAdjustments(branchId: string, month?: string, staffId?: string): Promise<PayrollAdjustment[]>;
  createPayrollAdjustment(input: { staffId: string; month: string; type: PayrollAdjustmentType; title: string; amount: number; notes?: string }): Promise<PayrollAdjustment>;
  cancelPayrollAdjustment(id: string): Promise<PayrollAdjustment>;
  getSalaryAdvances(branchId: string, staffId?: string): Promise<SalaryAdvance[]>;
  issueSalaryAdvance(input: IssueSalaryAdvanceInput): Promise<SalaryAdvance>;
  reverseSalaryAdvance(id: string, reason: string): Promise<SalaryAdvance>;
  // Spec §10.2 / §10.3 reports (read-only)
  getStaffSalaryReport(query: StaffSalaryReportQuery): Promise<StaffSalaryReport>;
  getStaffCommissionReport(query: StaffCommissionReportQuery): Promise<StaffCommissionReport>;
  getSalesInvoicesReport(query: SalesInvoicesReportQuery): Promise<SalesInvoicesReport>;
  getDetailedIncomeReport(query: DetailedIncomeReportQuery): Promise<DetailedIncomeReport>;
  getIncomeExpenseReport(query: IncomeExpenseReportQuery): Promise<IncomeExpenseReport>;
  getTaxReport(query: TaxReportQuery): Promise<TaxReport>;
  getOperatingProfitReport(query: OperatingProfitReportQuery): Promise<OperatingProfitReport>;
  getPaymentAccountsReport(query: PaymentAccountsReportQuery): Promise<PaymentAccountsReport>;
  getCashDrawerReport(query: CashDrawerReportQuery): Promise<CashDrawerReport>;
  getDetailedExpensesReport(query: DetailedExpensesReportQuery): Promise<DetailedExpensesReport>;
  getInventoryReport(query: InventoryReportQuery): Promise<InventoryReportData>;
  getAttendanceOvertimeReport(query: AttendanceOvertimeReportQuery): Promise<AttendanceOvertimeReport>;

  generateCommissionPreview(branchId: string, startDate: string, endDate: string, staffId?: string, actor?: User, staffIds?: string[], compensationType?: string): Promise<CommissionRun>;
  finalizeCommission(commissionRunId: string, actor?: User): Promise<CommissionRun>;
  recordCommissionPayment(input: RecordCommissionPaymentInput, actor?: User): Promise<{ commissionRun: CommissionRun; payment: CommissionPayment }>;
  cancelCommissionRun(commissionRunId: string, reason: string, actor?: User): Promise<CommissionRun>;
  reverseCommissionPayment(paymentId: string, reason: string, actor?: User): Promise<CommissionPayment>;
  getCommissionRuns(branchId: string | 'ALL', actor?: User): Promise<CommissionRun[]>;
  getStaffPersonalCommissions(actor?: User): Promise<CommissionStatementRecord[]>;

  // --- PHASE 3F: TIP COLLECTION, ALLOCATION & PAYOUTS ---
  getTipReceipts(branchId: string | 'ALL', filters?: { startDate?: string; endDate?: string; method?: string; status?: string; staffId?: string; search?: string }, actor?: User): Promise<TipReceiptRecord[]>;
  allocateTips(input: AllocateTipsInput, actor?: User): Promise<{ tipReceipt: TipReceiptRecord; allocations: TipAllocationRecord[] }>;
  cancelTipAllocation(allocationId: string, reason: string, actor?: User): Promise<{ cancelledAllocation: TipAllocationRecord; tipReceipt: TipReceiptRecord }>;
  recordTipPayout(input: RecordTipPayoutInput, actor?: User): Promise<{ payout: TipPayoutRecord; allocation: TipAllocationRecord }>;
  reverseTipPayout(input: ReverseTipPayoutInput, actor?: User): Promise<{ reversedPayout: TipPayoutRecord; allocation: TipAllocationRecord }>;
  getTipAllocations(branchId: string | 'ALL', filters?: { startDate?: string; endDate?: string; staffId?: string; status?: string; search?: string }, actor?: User): Promise<TipAllocationRecord[]>;
  getTipPayouts(branchId: string | 'ALL', filters?: { startDate?: string; endDate?: string; staffId?: string; method?: string; status?: string }, actor?: User): Promise<TipPayoutRecord[]>;
  getTipsStatement(branchId: string | 'ALL', startDate?: string, endDate?: string, filters?: { staffId?: string; paymentSource?: string }, actor?: User): Promise<{ summary: TipsStatementSummary; receipts: TipReceiptRecord[]; allocations: TipAllocationRecord[]; payouts: TipPayoutRecord[] }>;
  getStaffPersonalTips(actor?: User): Promise<{ summary: { totalAllocated: number; totalPaid: number; totalOutstanding: number }; allocations: TipAllocationRecord[]; payouts: TipPayoutRecord[] }>;

  // --- PHASE 3F: STAFF PERFORMANCE & PERSONAL DRILL-DOWN ---
  getStaffPerformanceReport(branchId: string | 'ALL', startDate: string, endDate: string, filters?: { staffId?: string; categoryId?: string; serviceId?: string; packageId?: string }, actor?: User): Promise<StaffPerformanceRecord[]>;
  getStaffPersonalPerformance(actor?: User, startDate?: string, endDate?: string): Promise<StaffPerformanceRecord>;

  // --- PHASE 3G: APPOINTMENT CALENDAR & BOOKING ---
  getAppointment(id: string, actor?: User): Promise<Appointment | null>;
  createAppointment(input: CreateAppointmentInput, actor?: User): Promise<Appointment>;
  updateAppointment(id: string, input: UpdateAppointmentInput, actor?: User): Promise<Appointment>;
  updateAppointmentStatus(id: string, newStatus: AppointmentStatus, cancelReason?: string, actor?: User): Promise<Appointment>;
  rescheduleAppointment(id: string, newDate: string, newStartTime: string, reason?: string, actor?: User): Promise<Appointment>;
  prepareConfirmationMessage(appointmentId: string, actor?: User): Promise<AppointmentConfirmationMessage>;
  getAppointmentQueue(branchId: string, date: string, actor?: User): Promise<Appointment[]>;

  // --- PHASE 3G: CUSTOMER DIRECTORY & HISTORY ---
  createClient(input: Omit<Client, 'id' | 'outstandingBalance' | 'totalVisits'>, actor?: User): Promise<Client>;
  updateClient(id: string, input: Partial<Client>, actor?: User): Promise<Client>;
  archiveClient(id: string, isArchived: boolean, actor?: User): Promise<Client>;
  getClientDetails(id: string, actor?: User): Promise<{
    bookings?: import('../types/booking').Booking[];
    client: Client;
    appointments: Appointment[];
    invoices: Invoice[];
    receipts: any[];
    outstandingInvoices: Invoice[];
    visitCount: number;
    lastVisitDate?: string;
    totalSpend: number;
  }>;

  // --- PHASE 3G: DEDICATED APPOINTMENT REPORTING ---
  getAppointmentReport(
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
  }>;

  // --- PHASE 3H: INVENTORY & STOCK MANAGEMENT ---
  getInventoryItems(
    branchId: string | 'ALL',
    actor?: User,
    filter?: { itemType?: ItemType; category?: string; search?: string; isActive?: boolean }
  ): Promise<InventoryItem[]>;
  getInventoryItem(id: string, actor?: User): Promise<InventoryItem>;
  createInventoryItem(
    input: CreateInventoryItemInput,
    actor?: User
  ): Promise<InventoryItem>;
  updateInventoryItem(id: string, input: Partial<InventoryItem>, actor?: User): Promise<InventoryItem>;
  archiveInventoryItem(id: string, isActive: boolean, actor?: User): Promise<InventoryItem>;
  getStockLevelSnapshots(branchId: string | 'ALL', actor?: User): Promise<StockLevelSnapshot[]>;
  getItemStockInBranch(
    itemId: string,
    branchId: string
  ): Promise<{ currentStock: number; validStock: number; batches: InventoryBatch[] }>;

  // --- PHASE 3H: BATCH & EXPIRY MANAGEMENT ---
  getInventoryBatches(branchId: string | 'ALL', itemId?: string, actor?: User): Promise<InventoryBatch[]>;
  quarantineBatch(batchId: string, reason: string, actor?: User): Promise<InventoryBatch>;
  unquarantineBatch(batchId: string, actor?: User): Promise<InventoryBatch>;

  // --- PHASE 3H: SUPPLIERS & DEDICATED SUPPLIER LEDGER ---
  getSuppliers(branchId: string | 'ALL', actor?: User, search?: string): Promise<Supplier[]>;
  getSupplier(id: string, actor?: User): Promise<Supplier>;
  createSupplier(
    input: Omit<
      Supplier,
      'id' | 'supplierCode' | 'currentPayable' | 'totalPurchases' | 'totalPayments' | 'totalReturns' | 'createdById' | 'createdByName' | 'createdAt' | 'updatedAt'
    >,
    actor?: User
  ): Promise<Supplier>;
  updateSupplier(id: string, input: Partial<Supplier>, actor?: User): Promise<Supplier>;
  archiveSupplier(id: string, isActive: boolean, actor?: User): Promise<Supplier>;
  getSupplierLedger(
    supplierId: string,
    branchId?: string | 'ALL',
    dateRange?: { startDate?: string; endDate?: string } | User,
    actor?: User
  ): Promise<{
    entries: SupplierLedgerEntry[];
    openingPayable: number;
    closingPayable: number;
    totalPurchases: number;
    totalPayments: number;
    totalReturns: number;
  }>;
  paySupplier(
    input: PaySupplierInput,
    actor?: User
  ): Promise<{
    payment: SupplierPaymentRecord;
    ledgerEntry: SupplierLedgerEntry;
    updatedPayable: number;
  }>;
  reverseSupplierPayment?(supplierId: string, paymentId: string, input: { reason: string; reversalDate: string; idempotencyKey: string }): Promise<unknown>;
  reverseCollection?(invoiceId: string, paymentId: string, input: { reason: string; reversalDate: string; idempotencyKey: string }): Promise<Invoice>;
  recordSupplierPayment?(
    input: PaySupplierInput,
    actor?: User
  ): Promise<{
    payment: SupplierPaymentRecord;
    ledgerEntry: SupplierLedgerEntry;
    updatedPayable: number;
  }>;

  // --- PHASE 3H: PURCHASES / STOCK IN ---
  getPurchases(
    branchId: string | 'ALL',
    actor?: User,
    dateRange?: { startDate?: string; endDate?: string }
  ): Promise<Purchase[]>;
  getPurchase(id: string, actor?: User): Promise<Purchase>;
  createPurchase(
    input: CreatePurchaseInput,
    actor?: User
  ): Promise<Purchase>;

  // --- PHASE 3H: SUPPLIER RETURNS ---
  getSupplierReturns(branchId: string | 'ALL', actor?: User): Promise<SupplierReturn[]>;
  createSupplierReturn(
    input: CreateSupplierReturnInput,
    actor?: User
  ): Promise<SupplierReturn>;

  // --- PHASE 3H: STOCK MOVEMENTS & SALON CONSUMPTION ---
  getStockMovements(
    branchId: string | 'ALL',
    filterOrActor?: {
      itemId?: string;
      type?: StockMovementType;
      direction?: 'IN' | 'OUT';
      startDate?: string;
      endDate?: string;
      search?: string;
    } | User,
    actorOrFilter?: User | {
      itemId?: string;
      type?: StockMovementType;
      direction?: 'IN' | 'OUT';
      startDate?: string;
      endDate?: string;
      search?: string;
    }
  ): Promise<StockMovement[]>;
  createManualStockOut(
    input: CreateManualStockOutInput,
    actor?: User
  ): Promise<StockMovement>;

  // --- PHASE 3H: STOCK SETTLEMENT / PHYSICAL RECONCILIATION ---
  getStockSettlements(branchId: string | 'ALL', actor?: User): Promise<StockSettlement[]>;
  getStockSettlement(id: string, actor?: User): Promise<StockSettlement>;
  createStockSettlement(
    input: CreateStockSettlementInput,
    actor?: User
  ): Promise<StockSettlement>;

  // --- PHASE 3H: REPORTING & COGS ---
  getInventorySummary(
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
  }>;
  getCOGSReport(
    branchId: string | 'ALL',
    dateRange: { startDate?: string; endDate?: string } | string,
    endDateOrActor?: string | User,
    actor?: User
  ): Promise<{
    records: COGSReportRecord[];
    summary: COGSReportSummary;
  }>;

  // --- GENERAL LEDGER & AUDIT TRAIL ---
  getGeneralLedger(params?: {
    branchId?: string;
    channel?: 'ALL' | 'CASH' | 'BANK';
    source?: string;
    direction?: 'IN' | 'OUT';
    drawerId?: string;
    accountId?: string;
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<GeneralLedgerResponse>;

  getAuditEvents(params?: {
    branchId?: string;
    userId?: string;
    entity?: string;
    action?: string;
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<AuditEventsResponse>;

  resetTestData(params?: {
    branchId?: string;
    wipeCatalogue?: boolean;
    wipeInventory?: boolean;
    wipeClients?: boolean;
    wipeStaff?: boolean;
    wipeSuppliers?: boolean;
  }): Promise<{ success: boolean; message: string; branchId: string; resetAt: string }>;

  // --- STEP 23: HARDWARE & DEVICE INTEGRATION ---
  getDevices(branchId?: string | 'ALL', actor?: User, query?: { deviceType?: string; status?: string; search?: string }): Promise<Device[]>;
  getDevice(id: string, actor?: User): Promise<Device | null>;
  createDevice(input: CreateDeviceInput, actor?: User): Promise<Device>;
  updateDevice(id: string, input: UpdateDeviceInput, actor?: User): Promise<Device>;
  toggleDeviceStatus(id: string, actor?: User): Promise<Device>;
  deleteDevice(id: string, actor?: User): Promise<{ success: boolean; message: string }>;
  testDeviceConnection(id: string, options?: { ipAddress?: string; port?: number; timeoutMs?: number }, actor?: User): Promise<TestConnectionResult>;
  syncDevice(id: string, options?: { startDate?: string; endDate?: string }, actor?: User): Promise<SyncDeviceResult>;
  getDeviceLogs(id: string, actor?: User, limit?: number): Promise<DeviceLog[]>;
}

export interface LedgerMovement {
  id: string;
  createdAt: string;
  date: string;
  channel: 'CASH' | 'BANK';
  branchId: string;
  branchName: string;
  holderId: string;
  holderName: string;
  type: string;
  direction: 'IN' | 'OUT';
  amount: number;
  signedAmount: number;
  sourceModule: string;
  sourceId?: string | null;
  reference?: string | null;
  description: string;
  userId?: string | null;
  userName?: string | null;
  balanceAfter: number;
}

export interface GeneralLedgerSummary {
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  netMovement: number;
  closingBalance: number;
  count: number;
}

export interface GeneralLedgerResponse {
  movements: LedgerMovement[];
  summary: GeneralLedgerSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AuditEventItem {
  id: string;
  branchId?: string | null;
  branchName: string;
  branchCode?: string | null;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  before?: any;
  after?: any;
  createdAt: string;
}

export interface AuditEventsResponse {
  events: AuditEventItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
