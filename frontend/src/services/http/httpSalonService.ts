// SalonService adapter for the Express API.
//
// Every SalonServiceContract method calls the API (real PostgreSQL data). The in-browser mock is
// only used when VITE_USE_MOCK=true (offline demo). Pages call `salonService.x(...)` and never
// need to know which side answers.
//
// The `actor` argument of contract methods is ignored here — the API identifies the user from the
// access token, which cannot be forged from the browser.

import { SalonServiceContract, GeneralLedgerResponse, AuditEventsResponse } from '../salonService';
import { api, getOrNull, newIdempotencyKey } from './apiClient';
import {
  AttendanceRecord,
  BranchHoliday,
  CashDrawer,
  CashTransferRecord,
  CommissionPayment,
  CommissionRun,
  CommissionStatementRecord,
  CSVAttendanceImportResult,
  CatalogueImportResult,
  Expense,
  ExpenseCategoryItem,
  LeaveRecord,
  OvertimeRecord,
  PayrollPayment,
  PayrollPolicyConfig,
  AttendancePolicyConfig,
  PayrollRun,
  StaffAllowance,
  PayrollAdjustment,
  SalaryAdvance,
  MonthlyPaySummary,
  StaffSalaryReport,
  StaffCommissionReport,
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
  Settlement,
  StaffPerformanceRecord,
  TipAllocationRecord,
  TipPayoutRecord,
  TipReceiptRecord,
  Appointment,
  AppointmentStatus,
  Branch,
  Client,
  Invoice,
  InvoiceRefundDTO,
  RefundInvoiceInput,
  RefundInvoiceResult,
  InventoryBatch,
  InventoryItem,
  Purchase,
  StockLevelSnapshot,
  StockMovement,
  StockSettlement,
  Supplier,
  SupplierReturn,
  OnlineAccount,
  PackageItem,
  PaymentAccount,
  ServiceCategory,
  ServiceItem,
  StaffMember,
  TaxRule,
  Device,
  DeviceLog,
  TestConnectionResult,
  SyncDeviceResult,
} from '@/types/salon';
import { User } from '@/types/auth';

const branchQuery = (branchId?: string | 'ALL') => (branchId && branchId !== 'ALL' ? { branchId } : {});

const normalizeDigits = (phone?: string) => {
  let d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('92') && d.length === 12) d = `0${d.slice(2)}`;
  return d;
};

const liveMethods: SalonServiceContract = {
  getBookings: (query) => api.get('/bookings', query),
  getBookingCollections: query => api.get('/bookings/collections', query),
  getBooking: id => api.get(`/bookings/${id}`),
  createBooking: (input, key) => api.post('/bookings', input, key),
  updateBooking: (id, input) => api.put(`/bookings/${id}`, input),
  recordBookingPayment: (id, input, key) => api.post(`/bookings/${id}/payments`, input, key),
  refundBookingPayment: (id, input, key) => api.post(`/bookings/${id}/refunds`, input, key),
  cancelBooking: (id, input, key) => api.post(`/bookings/${id}/cancel`, input, key),
  startBooking: (id, revision) => api.patch(`/bookings/${id}/status`, { revision, status: 'IN_PROGRESS' }),
  getBookingLedger: id => api.get(`/bookings/${id}/ledger`),
  getBookingHandoff: id => api.get(`/bookings/${id}/pos-handoff`),
  checkoutBooking: (input, key) => api.post('/pos/invoices/checkout', input, key),
  // ── Step 2 · Branches ──────────────────────────────────────────────────────
  getBranches: () => api.get<Branch[]>('/branches'),
  getBranch: (id) => getOrNull<Branch>(`/branches/${id}`),
  createBranch: (branch) => api.post<Branch>('/branches', branch),
  updateBranch: (id, branch) => api.put<Branch>(`/branches/${id}`, branch),
  assignBranchAdmin: (branchId, adminUserId, _actor, credentials) => api.post<Branch>(`/branches/${branchId}/assign-admin`, { adminUserId, ...credentials }),
  unassignBranchAdmin: (branchId, adminUserId) => api.post<Branch>(`/branches/${branchId}/unassign-admin`, { adminUserId }),
  deactivateBranch: (id) => api.post(`/branches/${id}/deactivate`),
  deleteBranch: (id) => api.delete<{ success: boolean; message: string }>(`/branches/${id}`),
  checkBranchDeactivationBlockers: (id) => api.get(`/branches/${id}/deactivation-blockers`),

  // ── Step 3 · Users & access ────────────────────────────────────────────────
  getUsers: (_actor, branchId) => api.get<User[]>('/users', branchQuery(branchId)),
  getUser: (id) => getOrNull<User>(`/users/${id}`),
  createUser: (params) => api.post<User>('/users', params),
  updateUser: (id, params) => api.put<User>(`/users/${id}`, params),
  deactivateUser: (id) => api.post(`/users/${id}/deactivate`),
  reactivateUser: (id) => api.post(`/users/${id}/reactivate`),
  deleteUser: (id) => api.delete(`/users/${id}`),
  resetUserPassword: (id, _actor, password) => api.post(`/users/${id}/reset-password`, password ? { password } : {}),

  // ── Step 4 · Branch settings (tax rules, payment accounts) ─────────────────
  getTaxRules: (branchId) => api.get<TaxRule[]>('/tax-rules/options', branchQuery(branchId)),
  createTaxRule: (branchId, rule) => api.post<TaxRule>('/tax-rules', { ...rule, branchId }),
  updateTaxRule: (id, rule) => api.put<TaxRule>(`/tax-rules/${id}`, rule),
  setBranchDefaultTaxRule: (branchId, ruleId) => api.post<Branch>('/tax-rules/branch-default', { branchId, ruleId }),
  toggleTaxRuleStatus: (id) => api.post<TaxRule>(`/tax-rules/${id}/toggle`),

  getPaymentAccounts: (branchId) => api.get<PaymentAccount[]>('/payment-accounts/options', branchQuery(branchId)),
  createPaymentAccount: (branchId, account) => api.post<PaymentAccount>('/payment-accounts', { ...account, branchId }),
  updatePaymentAccount: (id, account) => api.put<PaymentAccount>(`/payment-accounts/${id}`, account),
  togglePaymentAccountStatus: (id) => api.post<PaymentAccount>(`/payment-accounts/${id}/toggle`),
  deletePaymentAccount: (id) => api.delete<{ id: string; deleted?: boolean; archived?: boolean; message: string }>(`/payment-accounts/${id}`),
  getOnlineAccounts: (branchId) => api.get<OnlineAccount[]>('/online-accounts', branchQuery(branchId)),

  // Business (operating) date lives in the database; only Super Admin may change it.
  getSystemDate: async () => (await api.get<{ date: string }>('/system/date'))?.date ?? new Date().toISOString().slice(0, 10),
  setSystemDate: async (date) => {
    await api.put('/system/date', { date });
  },

  getExpenseCategories: (branchId) => api.get<ExpenseCategoryItem[]>('/expense-categories', branchQuery(branchId)),
  createExpenseCategory: (branchId, name, description) => api.post<ExpenseCategoryItem>('/expense-categories', { branchId, name, description }),
  updateExpenseCategory: (id, params) => api.put<ExpenseCategoryItem>(`/expense-categories/${id}`, params),
  toggleExpenseCategoryStatus: (id) => api.post<ExpenseCategoryItem>(`/expense-categories/${id}/toggle`),

  getPayrollPolicy: (branchId) => api.get<PayrollPolicyConfig>('/payroll-policy', branchQuery(branchId)),
  updatePayrollPolicy: (branchId, policy) => api.put<PayrollPolicyConfig>('/payroll-policy', { ...policy, branchId }),

  getAttendancePolicy: (branchId) => api.get<AttendancePolicyConfig>('/attendance-policy', branchQuery(branchId)),
  updateAttendancePolicy: (branchId, policy) => api.put<AttendancePolicyConfig>('/attendance-policy', { ...policy, branchId }),

  // ── Step 5 · Staff ─────────────────────────────────────────────────────────
  getStaffMembers: (_actor, branchId) => api.get<StaffMember[]>('/staff', branchQuery(branchId)),
  getStaffMember: (id) => getOrNull<StaffMember>(`/staff/${id}`),
  getStaff: (branchId) => api.get<StaffMember[]>('/staff', branchQuery(branchId)),
  createStaffMember: (params) => api.post('/staff', params),
  updateStaffMember: (id, params) => api.put<StaffMember>(`/staff/${id}`, params),
  deactivateStaffMember: (id) => api.post(`/staff/${id}/deactivate`),
  setStaffPortalAccess: (staffId, enable, credentials) =>
    api.post(`/staff/${staffId}/portal-access`, { enable, identifier: credentials?.identifier, password: credentials?.password || undefined }),

  // ── Step 6 · Services & packages ───────────────────────────────────────────
  getServices: (branchId) => api.get<ServiceItem[]>('/services', branchQuery(branchId)),
  getService: (id) => getOrNull<ServiceItem>(`/services/${id}`),
  createService: (service) => api.post<ServiceItem>('/services', service),
  updateService: (id, service) => api.put<ServiceItem>(`/services/${id}`, service),
  toggleServiceStatus: (id) => api.post<ServiceItem>(`/services/${id}/toggle`),
  bulkImportServices: (branchId, rows) => api.post<CatalogueImportResult>('/services/bulk-import', { branchId, rows }),

  getPackages: (branchId) => api.get<PackageItem[]>('/packages', branchQuery(branchId)),
  getPackage: (id) => getOrNull<PackageItem>(`/packages/${id}`),
  createPackage: (pkg) => api.post<PackageItem>('/packages', pkg),
  updatePackage: (id, pkg) => api.put<PackageItem>(`/packages/${id}`, pkg),
  togglePackageStatus: (id) => api.post<PackageItem>(`/packages/${id}/toggle`),
  bulkImportPackages: (branchId, rows) => api.post<CatalogueImportResult>('/packages/bulk-import', { branchId, rows }),

  getServiceCategories: (branchId) => api.get<ServiceCategory[]>('/service-categories', branchQuery(branchId)),
  createServiceCategory: (branchId, name) => api.post<ServiceCategory>('/service-categories', { branchId, name }),

  // ── Step 7 · Clients ───────────────────────────────────────────────────────
  getClients: (branchId) => api.get<Client[]>('/clients', branchQuery(branchId)),
  getClient: (id) => getOrNull<Client>(`/clients/${id}`),
  searchClients: (branchId, query) => api.get<Client[]>('/clients/search', { ...branchQuery(branchId), q: query }),
  createClient: (input) => api.post<Client>('/clients', input),
  updateClient: (id, input) => api.put<Client>(`/clients/${id}`, input),
  archiveClient: (id, isArchived) => api.post<Client>(`/clients/${id}/archive`, { isArchived }),

  // Client history: profile, appointments and invoices all come from the API. Walk-in invoices
  // without a client id are matched by phone number.
  getClientDetails: async (id) => {
    const client = await api.get<Client>(`/clients/${id}`);
    const [appointments, branchInvoices, bookings] = await Promise.all([
      api.get<Appointment[]>('/appointments', { branchId: client.branchId, clientId: id }),
      api.get<Invoice[]>('/invoices', { branchId: client.branchId }),
      api.get<import('../../types/booking').Booking[]>('/bookings', { branchId: client.branchId, clientId: id }),
    ]);
    const phone = normalizeDigits(client.phone);
    const invoices = branchInvoices
      .filter((i: Invoice) => i.clientId === id || (phone && normalizeDigits(i.clientPhone) === phone))
      .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const outstandingInvoices = invoices.filter((i) => i.lifecycle !== 'VOIDED' && (i.status === 'UNPAID' || i.status === 'PARTIAL') && i.amountDue > 0);

    const visitDates = new Set<string>();
    invoices.forEach((i) => i.lineItems?.length && visitDates.add(i.date));
    appointments.forEach((a) => a.status === 'COMPLETED' && visitDates.add(a.date));
    const sorted = [...visitDates].sort();
    const totalSpend = Math.round(invoices.reduce((s, i) => i.lifecycle === 'VOIDED' ? s : s + Math.max(0, (i.netSales || 0) - (i.refunds || []).reduce((n, r) => n + r.netReversed, 0)), 0) * 100) / 100;

    return {
      client: {
        ...client,
        totalVisits: sorted.length,
        lastVisitDate: sorted[sorted.length - 1],
        outstandingBalance: Math.round(outstandingInvoices.reduce((s, i) => s + i.amountDue, 0) * 100) / 100,
      },
      appointments: [...appointments].sort((a, b) => b.date.localeCompare(a.date)),
      bookings,
      invoices,
      receipts: [
        ...invoices.flatMap((i) =>
          (i.payments || []).map((p) => ({
            ...p,
            invoiceNumber: i.invoiceNumber,
            invoiceId: i.id,
            clientName: i.clientName,
            invoiceTotal: i.total,
          }))
        ),
        ...bookings.flatMap((b) =>
          (b.payments || []).map((p) => ({
            ...p,
            invoiceNumber: `${b.bookingNumber} (${b.type === 'BRIDAL' ? 'Bridal' : 'Groom'} ${p.isRefund ? 'Refund' : 'Advance'})`,
            invoiceId: b.id,
            clientName: b.clientName,
            invoiceTotal: b.totalAmount,
            isBookingPayment: true,
          }))
        ),
      ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '')),
      outstandingInvoices,
      visitCount: sorted.length,
      lastVisitDate: sorted[sorted.length - 1],
      totalSpend,
    };
  },

  // ── Step 8 · Appointments ──────────────────────────────────────────────────
  getAppointments: (branchId, dateOrFilter) => {
    const filter = typeof dateOrFilter === 'string' ? { date: dateOrFilter } : dateOrFilter || {};
    return api.get<Appointment[]>('/appointments', { ...branchQuery(branchId), ...filter });
  },
  getAppointment: (id) => getOrNull<Appointment>(`/appointments/${id}`),
  createAppointment: (input) => api.post<Appointment>('/appointments', input),
  updateAppointment: (id, input) => api.put<Appointment>(`/appointments/${id}`, input),
  updateAppointmentStatus: (id, status: AppointmentStatus, cancelReason) =>
    api.patch<Appointment>(`/appointments/${id}/status`, { status, cancelReason }),
  rescheduleAppointment: (id, date, startTime, reason) =>
    api.post<Appointment>(`/appointments/${id}/reschedule`, { date, startTime, reason }),
  prepareConfirmationMessage: (appointmentId) => api.get(`/appointments/${appointmentId}/confirmation-message`),
  getAppointmentQueue: (branchId, date) => api.get<Appointment[]>('/appointments/queue', { ...branchQuery(branchId), date }),

  // ── Step 10 · Inventory & suppliers ────────────────────────────────────────
  getInventoryItems: (branchId, _actor, filter) =>
    api.get<InventoryItem[]>('/inventory/items', {
      ...branchQuery(branchId), itemType: filter?.itemType, category: filter?.category, search: filter?.search,
      isActive: filter?.isActive === undefined ? undefined : String(filter.isActive),
    }),
  getInventoryItem: (id) => api.get<InventoryItem>(`/inventory/items/${id}`),
  createInventoryItem: (input) => api.post<InventoryItem>('/inventory/items', input),
  updateInventoryItem: (id, input) => api.put<InventoryItem>(`/inventory/items/${id}`, input),
  archiveInventoryItem: (id, isActive) => api.post<InventoryItem>(`/inventory/items/${id}/archive`, { isActive }),
  getStockLevelSnapshots: (branchId) => api.get<StockLevelSnapshot[]>('/inventory/stock-levels', branchQuery(branchId)),
  getItemStockInBranch: (itemId, branchId) => api.get(`/inventory/items/${itemId}/stock`, branchQuery(branchId)),
  getInventorySummary: (branchId) => api.get('/inventory/summary', branchQuery(branchId)),
  getCOGSReport: (branchId, dateRange, endDateOrActor) => {
    const range = typeof dateRange === 'string'
      ? { startDate: dateRange, endDate: typeof endDateOrActor === 'string' ? endDateOrActor : undefined }
      : dateRange || {};
    return api.get('/inventory/cogs-report', { ...branchQuery(branchId), ...range });
  },

  getInventoryBatches: (branchId, itemId) => api.get<InventoryBatch[]>('/inventory/batches', { ...branchQuery(branchId), itemId }),
  quarantineBatch: (batchId, reason) => api.post<InventoryBatch>(`/inventory/batches/${batchId}/quarantine`, { reason }),
  unquarantineBatch: (batchId) => api.post<InventoryBatch>(`/inventory/batches/${batchId}/release`),

  getSuppliers: (branchId, _actor, search) => api.get<Supplier[]>('/suppliers', { ...branchQuery(branchId), search }),
  getSupplier: (id) => api.get<Supplier>(`/suppliers/${id}`),
  createSupplier: (input) => api.post<Supplier>('/suppliers', input),
  updateSupplier: (id, input) => api.put<Supplier>(`/suppliers/${id}`, input),
  archiveSupplier: (id, isActive) => api.post<Supplier>(`/suppliers/${id}/archive`, { isActive }),
  getSupplierLedger: (supplierId, branchId, dateRangeOrActor) => {
    const range = dateRangeOrActor && !('role' in dateRangeOrActor) ? dateRangeOrActor : {};
    return api.get(`/suppliers/${supplierId}/ledger`, { ...branchQuery(branchId), ...range });
  },
  reverseSupplierPayment: (supplierId, paymentId, input) => api.post(`/suppliers/${supplierId}/payments/${paymentId}/reverse`, input, input.idempotencyKey),
  reverseCollection: (invoiceId, paymentId, input) => api.post<Invoice>(`/invoices/${invoiceId}/payments/${paymentId}/reverse`, input, input.idempotencyKey),
  paySupplier: (input) => api.post(`/suppliers/${input.supplierId}/payments`, input, input.idempotencyKey || newIdempotencyKey()),
  recordSupplierPayment: (input) => api.post(`/suppliers/${input.supplierId}/payments`, input, input.idempotencyKey || newIdempotencyKey()),

  getPurchases: (branchId, _actor, dateRange) => api.get<Purchase[]>('/purchases', { ...branchQuery(branchId), ...(dateRange || {}) }),
  getPurchase: (id) => api.get<Purchase>(`/purchases/${id}`),
  createPurchase: (input) => api.post<Purchase>('/purchases', input, newIdempotencyKey()),

  getSupplierReturns: (branchId) => api.get<SupplierReturn[]>('/supplier-returns', branchQuery(branchId)),
  createSupplierReturn: (input) => api.post<SupplierReturn>('/supplier-returns', input, newIdempotencyKey()),

  getStockMovements: (branchId, filterOrActor, actorOrFilter) => {
    const isActor = (x: any) => x && typeof x === 'object' && 'role' in x && 'id' in x;
    const filter: any = isActor(filterOrActor) ? actorOrFilter : filterOrActor;
    return api.get<StockMovement[]>('/stock-movements', { ...branchQuery(branchId), ...(filter || {}) });
  },
  createManualStockOut: (input) => api.post<StockMovement>('/stock-movements/manual-out', input, newIdempotencyKey()),

  getStockSettlements: (branchId) => api.get<StockSettlement[]>('/stock-settlements', branchQuery(branchId)),
  getStockSettlement: (id) => api.get<StockSettlement>(`/stock-settlements/${id}`),
  createStockSettlement: (input) => api.post<StockSettlement>('/stock-settlements', input, newIdempotencyKey()),

  // ── Step 9 · Cash drawers & custody ────────────────────────────────────────
  getCashDrawers: (branchId, userId) => api.get<CashDrawer[]>('/cash-drawers', { ...branchQuery(branchId), userId }),
  transferCashFloat: (params) => api.post<CashTransferRecord>('/cash-transfers', params, newIdempotencyKey()),
  getCashCustodyStatement: (params) => api.get('/custody/statement', params),

  // ── Step 11 · POS & invoices ───────────────────────────────────────────────
  getInvoices: (branchId: string | 'ALL', filter?: Record<string, any>) => api.get<Invoice[]>('/invoices', { ...branchQuery(branchId), ...(filter || {}) }),
  getInvoice: (id) => getOrNull<Invoice>(`/invoices/${id}`),
  postPOSInvoice: (input) => api.post<Invoice>('/pos/invoices/checkout', input, input.idempotencyKey || newIdempotencyKey()),
  collectInvoicePayment: ({ invoiceId, ...input }) =>
    api.post<Invoice>(`/invoices/${invoiceId}/payments`, input, input.idempotencyKey || newIdempotencyKey()).then((res) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('refresh-notifications'));
      }
      return res;
    }),
  getClientOutstandingInvoices: (branchId, clientIdOrPhone) =>
    api.get<Invoice[]>('/invoices/outstanding', { ...branchQuery(branchId), clientIdOrPhone }),
  refundInvoice: (invoiceId, input) =>
    api.post<RefundInvoiceResult>(`/invoices/${invoiceId}/refunds`, input, newIdempotencyKey()).then((res) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('refresh-notifications'));
      }
      return res;
    }),
  getInvoiceRefunds: (invoiceId) => api.get<InvoiceRefundDTO[]>(`/invoices/${invoiceId}/refunds`),

  // ── Step 12 · Expenses ─────────────────────────────────────────────────────
  getExpenses: (branchId: string | 'ALL', filter?: Record<string, any>) => api.get<Expense[]>('/expenses', { ...branchQuery(branchId), ...(filter || {}) }),
  getExpense: (id) => getOrNull<Expense>(`/expenses/${id}`),
  createExpenseDraft: (params) => api.post<Expense>('/expenses/drafts', params),
  updateExpenseDraft: (id, params) => api.put<Expense>(`/expenses/drafts/${id}`, params),
  deleteExpenseDraft: (id) => api.delete(`/expenses/drafts/${id}`),
  postExpense: (params) => api.post<Expense>('/expenses/post', params, params.idempotencyKey || newIdempotencyKey()),
  reverseExpense: (id, reason) => api.post(`/expenses/${id}/reverse`, { reason }),

  // ── Step 13 · Settlements ──────────────────────────────────────────────────
  getSettlements: (branchId, filter) => api.get<Settlement[]>('/settlements', { ...branchQuery(branchId), ...(filter || {}) }),
  getSettlement: (id) => getOrNull<Settlement>(`/settlements/${id}`),
  createSettlementDraft: (input) => api.post<Settlement>('/settlements/drafts', input),
  submitSettlement: (input) => api.post<Settlement>('/settlements', { ...input, isDraft: false }, newIdempotencyKey()),
  approveSettlement: (id, input) => api.put(`/settlements/${id}/approve`, input),
  rejectSettlement: (id, reason) => api.put<Settlement>(`/settlements/${id}/reject`, { reason }),

  // ── Step 14 · Attendance, leaves, holidays ─────────────────────────────────
  getAttendance: (branchId, date, staffId) => api.get<AttendanceRecord[]>('/attendance', { ...branchQuery(branchId), date, staffId }),
  createAttendance: (input) => api.post<AttendanceRecord>('/attendance', input),
  markAllAttendance: (input) => api.post<{ markedCount: number; skippedCount: number; markedNames: string[]; skippedNames: string[] }>('/attendance/mark-all', input),
  correctAttendance: (id, input) => api.put<AttendanceRecord>(`/attendance/${id}/correct`, input),
  saveDailyAttendance: (input) => api.post<{ savedCount: number }>('/attendance/bulk-save', input),
  finalizeDayAttendance: (branchId, date) => api.post('/attendance/finalize-day', { branchId, date }),
  importAttendanceCSV: (branchId, rows) => api.post<CSVAttendanceImportResult>('/attendance/import-csv', { branchId, rows }),
  getLeaves: (branchId, staffId) => api.get<LeaveRecord[]>('/leaves', { ...branchQuery(branchId), staffId }),
  markLeave: (input) => api.post<LeaveRecord>('/leaves', input),
  cancelLeave: (id, reason) => api.post<LeaveRecord>(`/leaves/${id}/cancel`, { reason }),
  getBranchHolidays: (branchId) => api.get<BranchHoliday[]>('/holidays', branchQuery(branchId)),
  addBranchHoliday: (holiday) => api.post<BranchHoliday>('/holidays', holiday),
  getStaffPersonalAttendance: () => api.get('/attendance/me'),

  // ── Step 15 · Manual overtime ──────────────────────────────────────────────
  getOvertime: (branchId, staffId) => api.get<OvertimeRecord[]>('/overtime', { ...branchQuery(branchId), staffId }),
  createOvertime: (input) => api.post<OvertimeRecord>('/overtime', input),
  updateOvertime: (id, input) => api.put<OvertimeRecord>(`/overtime/${id}`, input),
  approveOvertime: (id) => api.post<OvertimeRecord>(`/overtime/${id}/approve`),
  rejectOvertime: (id, reason) => api.post<OvertimeRecord>(`/overtime/${id}/reject`, { reason }),
  cancelOvertime: (id, reason) => api.post<OvertimeRecord>(`/overtime/${id}/cancel`, { reason }),
  getStaffPersonalOvertime: () => api.get('/overtime/me'),

  // ── Step 16 · Payroll ──────────────────────────────────────────────────────
  getPayrollRuns: (branchId, month) => api.get<PayrollRun[]>('/payroll/runs', { ...branchQuery(branchId), month }),
  generatePayrollPreview: (branchId, month, staffId, _actor, options) => api.post<PayrollRun>('/payroll/preview', { branchId, month, staffId, ...options }),
  finalizePayroll: (runId) => api.post<PayrollRun>(`/payroll/runs/${runId}/finalize`),
  cancelPayrollRun: (runId, reason) => api.post<PayrollRun>(`/payroll/runs/${runId}/cancel`, { reason }),
  recordPayrollPayment: (input) => api.post('/payroll/payments', input, newIdempotencyKey()),
  reversePayrollPayment: (paymentId, reason) => api.post<PayrollPayment>(`/payroll/payments/${paymentId}/reverse`, { reason }),
  addManualDeduction: (payslipId, input) => api.post(`/payroll/payslips/${payslipId}/deductions`, input),
  getStaffPersonalPayslips: () => api.get('/payroll/payslips/me'),
  getPayrollMonthlySummary: (branchId, month) => api.get<MonthlyPaySummary>('/payroll/monthly-summary', { ...branchQuery(branchId), month }),
  getStaffAllowances: (branchId, staffId) => api.get<StaffAllowance[]>('/payroll/allowances', { ...branchQuery(branchId), staffId }),
  createStaffAllowance: (input) => api.post<StaffAllowance>('/payroll/allowances', input),
  updateStaffAllowance: (id, input) => api.put<StaffAllowance>(`/payroll/allowances/${id}`, input),
  getPayrollAdjustments: (branchId, month, staffId) => api.get<PayrollAdjustment[]>('/payroll/adjustments', { ...branchQuery(branchId), month, staffId }),
  createPayrollAdjustment: (input) => api.post<PayrollAdjustment>('/payroll/adjustments', input),
  cancelPayrollAdjustment: (id) => api.post<PayrollAdjustment>(`/payroll/adjustments/${id}/cancel`),
  getSalaryAdvances: (branchId, staffId) => api.get<SalaryAdvance[]>('/payroll/advances', { ...branchQuery(branchId), staffId }),
  issueSalaryAdvance: (input) => api.post<SalaryAdvance>('/payroll/advances', input, newIdempotencyKey()),
  reverseSalaryAdvance: (id, reason) => api.post<SalaryAdvance>(`/payroll/advances/${id}/reverse`, { reason }),
  getStaffSalaryReport: (q) => api.get<StaffSalaryReport>('/reports/staff-salary', q as Record<string, any>),
  getStaffCommissionReport: (q) => api.get<StaffCommissionReport>('/reports/staff-commission', q as Record<string, any>),
  getSalesInvoicesReport: (q) => api.get<SalesInvoicesReport>('/reports/sales-invoices', q as Record<string, any>),
  getDetailedIncomeReport: (q) => api.get<DetailedIncomeReport>('/reports/detailed-income', q as Record<string, any>),
  getIncomeExpenseReport: (q) => api.get<IncomeExpenseReport>('/reports/income-expense', q as Record<string, any>),
  getTaxReport: (q) => api.get<TaxReport>('/reports/tax', q as Record<string, any>),
  getOperatingProfitReport: (q) => api.get<OperatingProfitReport>('/reports/operating-profit', q as Record<string, any>),
  getPaymentAccountsReport: (q) => api.get<PaymentAccountsReport>('/reports/payment-accounts', q as Record<string, any>),
  getCashDrawerReport: (q) => api.get<CashDrawerReport>('/reports/cash-drawer', q as Record<string, any>),
  getDetailedExpensesReport: (q) => api.get<DetailedExpensesReport>('/reports/detailed-expenses', q as Record<string, any>),
  getInventoryReport: (q) => api.get<InventoryReportData>('/reports/inventory', q as Record<string, any>),
  getAttendanceOvertimeReport: (q) => api.get<AttendanceOvertimeReport>('/reports/attendance-overtime', q as Record<string, any>),

  // ── Step 17 · Commission ───────────────────────────────────────────────────
  getCommissionRuns: (branchId) => api.get<CommissionRun[]>('/commission/runs', branchQuery(branchId)),
  generateCommissionPreview: (branchId, startDate, endDate, staffId, user, staffIds, compensationType) =>
    api.post<CommissionRun>('/commission/preview', { branchId, startDate, endDate, staffId, staffIds, compensationType }),
  finalizeCommission: (runId) => api.post<CommissionRun>(`/commission/runs/${runId}/finalize`),
  cancelCommissionRun: (runId, reason) => api.post<CommissionRun>(`/commission/runs/${runId}/cancel`, { reason }),
  recordCommissionPayment: (input) => api.post('/commission/payments', input, newIdempotencyKey()),
  reverseCommissionPayment: (paymentId, reason) => api.post<CommissionPayment>(`/commission/payments/${paymentId}/reverse`, { reason }),
  getStaffPersonalCommissions: () => api.get<CommissionStatementRecord[]>('/commission/statements/me'),

  // ── Step 18 · Tips ─────────────────────────────────────────────────────────
  getTipReceipts: (branchId, filters) => api.get<TipReceiptRecord[]>('/tips/receipts', { ...branchQuery(branchId), ...(filters || {}) }),
  getTipAllocations: (branchId, filters) => api.get<TipAllocationRecord[]>('/tips/allocations', { ...branchQuery(branchId), ...(filters || {}) }),
  getTipPayouts: (branchId, filters) => api.get<TipPayoutRecord[]>('/tips/payouts', { ...branchQuery(branchId), ...(filters || {}) }),
  getTipsStatement: (branchId, startDate, endDate, filters) =>
    api.get('/tips/statement', { ...branchQuery(branchId), startDate, endDate, ...(filters || {}) }),
  allocateTips: (input) => api.post('/tips/allocate', input),
  cancelTipAllocation: (allocationId, reason) => api.post(`/tips/allocations/${allocationId}/cancel`, { reason }),
  recordTipPayout: (input) => api.post('/tips/payouts', input, input.idempotencyKey || newIdempotencyKey()),
  reverseTipPayout: ({ payoutId, ...input }) => api.post(`/tips/payouts/${payoutId}/reverse`, input),
  getStaffPersonalTips: () => api.get('/tips/me'),

  // ── Step 19 · Dashboards ───────────────────────────────────────────────────
  getSuperAdminDashboardData: (activeBranchId) => api.get('/dashboard/super-admin', { branchId: activeBranchId || 'ALL' }),
  getAdminDashboardData: (branchId) => api.get('/dashboard/admin', branchQuery(branchId)),
  getAccountantDashboardData: (branchId) => api.get('/dashboard/accountant', branchQuery(branchId)),
  getStaffDashboardData: () => api.get('/dashboard/staff'),

  // ── Step 20–21 · Reports ───────────────────────────────────────────────────
  getAppointmentReport: (branchId, startDate, endDate, filters) =>
    api.get('/reports/appointments', { ...branchQuery(branchId), startDate, endDate, ...(filters || {}) }),
  getStaffPerformanceReport: (branchId, startDate, endDate, filters) =>
    api.get<StaffPerformanceRecord[]>('/reports/staff-performance', { ...branchQuery(branchId), startDate, endDate, ...(filters || {}) }),
  getStaffPersonalPerformance: (_actor, startDate, endDate) =>
    api.get<StaffPerformanceRecord>('/reports/staff-performance/me', { startDate, endDate }),

  // ── Step 22 · General Ledger & Audit ───────────────────────────────────────
  getGeneralLedger: (params) =>
    api.get<GeneralLedgerResponse>('/ledger', params ? { ...params, branchId: params.branchId === 'ALL' ? undefined : params.branchId } : undefined),
  getAuditEvents: (params) =>
    api.get<AuditEventsResponse>('/audit-events', params ? { ...params, branchId: params.branchId === 'ALL' ? undefined : params.branchId } : undefined),

  // ── Testing & Maintenance Reset ───────────────────────────────────────────
  resetTestData: (params) =>
    api.post('/system/reset-test-data', params),

  // ── Step 23 · Hardware & Device Integration ────────────────────────────────
  getDevices: (branchId, _actor, query) =>
    api.get<Device[]>('/devices', { ...branchQuery(branchId), ...(query || {}) }),
  getDevice: (id) => getOrNull<Device>(`/devices/${id}`),
  createDevice: (input) => api.post<Device>('/devices', input),
  updateDevice: (id, input) => api.put<Device>(`/devices/${id}`, input),
  toggleDeviceStatus: (id) => api.post<Device>(`/devices/${id}/toggle`),
  deleteDevice: (id) => api.delete<{ success: boolean; message: string }>(`/devices/${id}`),
  testDeviceConnection: (id, options) => api.post<TestConnectionResult>(`/devices/${id}/test-connection`, options || {}),
  syncDevice: (id, options) => api.post<SyncDeviceResult>(`/devices/${id}/sync`, options || {}),
  getDeviceLogs: (id, _actor, limit) => api.get<DeviceLog[]>(`/devices/${id}/logs`, limit ? { limit } : {}),
};

/** Names of the contract methods answered by the API (handy for debugging / status screens). */
export const LIVE_API_METHODS = Object.keys(liveMethods);

// Every contract method is answered by the API — there is no mock fallback in live mode.
export const httpSalonService: SalonServiceContract = liveMethods;
