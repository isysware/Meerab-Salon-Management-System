import type { User } from './auth';

export type TaxTreatment = 'BRANCH_DEFAULT' | 'SPECIFIC_RULE' | 'EXEMPT';

export interface TaxRule {
  branchIds?: string[];
  id: string;
  branchId: string;
  name: string;
  rate: number; // e.g. 0.16 for 16%
  description?: string;
  isActive: boolean;
  isBranchDefault?: boolean;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  phone: string;
  email?: string;
  timezone: string; // default: 'Asia/Karachi'
  taxRate: number; // e.g. 0.16 for 16% (demo value)
  taxEnabled?: boolean; // New branches start with tax disabled
  defaultTaxRuleId?: string;
  currency: string;
  openingCashFloat: number;
  isActive: boolean;
  assignedAdminId?: string;
  assignedAdminName?: string;
  assignedAdmins?: Array<{ id: string; name: string; email?: string }>;
  taxRegistrationNumber?: string; // Optional official provincial tax registration (e.g. PRA-LHE-7392014-9)
  taxAuthority?: string;
  logoUrl?: string | null;
}

export type PaymentAccountType = 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'OTHER';

export interface PaymentAccount {
  branchIds?: string[];
  id: string;
  branchId: string;
  name: string;
  accountType: PaymentAccountType;
  providerName: string;
  bankName?: string; // alias for providerName
  accountHolder: string;
  accountIdentifier?: string;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
}

export interface OnlineAccount {
  id: string;
  branchId: string;
  accountName: string;
  bankName: string;
  type: 'BANK_CHECKING' | 'TERMINAL_POS' | 'DIGITAL_WALLET';
  accountNumberMasked: string;
  currentBalance: number;
  lastSyncTime: string;
  accountType?: PaymentAccountType;
  accountHolder?: string;
  isActive?: boolean;
}

export type CompensationType =
  | 'MONTHLY_SALARY'
  | 'DAILY_SALARY'
  | 'MONTHLY_PLUS_COMMISSION'
  | 'DAILY_PLUS_COMMISSION'
  | 'COMMISSION_ONLY';

export type LeaveAllowancePeriod = 'MONTHLY' | 'YEARLY';

export type DeductionType = 'FIXED' | 'PERCENTAGE';

export interface AttendanceDeductionRule {
  enabled: boolean;
  type: DeductionType;
  amount: number; // PKR if FIXED, percentage (0-100) if PERCENTAGE
}

export type PenaltyCombinationPolicy = 'BOTH' | 'HIGHEST_ONLY';

export interface StaffMember {
  id: string;
  employeeCode: string;
  branchId: string;
  branchName?: string;
  name: string;
  phone: string;
  email?: string;
  designation: string;
  roleTitle: string;
  joiningDate: string;

  // Compensation Configuration
  compensationType: CompensationType;
  baseSalary: number; // Monthly base salary in PKR (0 if not applicable)
  dailySalaryRate: number; // Daily salary rate in PKR (0 if not applicable)
  commissionRate: number; // Commission percentage 0-100 (0 if not applicable)
  overtimeHourlyRate: number; // Rate in PKR / hr
  effectiveDate: string; // ISO Date YYYY-MM-DD when compensation/policy became effective
  requiresCompensationReview?: boolean; // Flagged if legacy record was ambiguous

  // Working Schedule
  startTime: string; // HH:mm format e.g. "09:00"
  endTime: string; // HH:mm format e.g. "18:00"
  lateGraceMinutes: number; // Grace period for arrival in minutes
  earlyGraceMinutes: number; // Grace period for departure in minutes
  isOvernightShift?: boolean; // Flag indicating if shift spans midnight

  // Leave Allowance
  allowedLeaveDays: number; // Paid leave allowance
  leaveAllowancePeriod: LeaveAllowancePeriod; // 'MONTHLY' | 'YEARLY'

  // Late-In & Early-Exit Deductions
  lateInDeduction: AttendanceDeductionRule;
  earlyExitDeduction: AttendanceDeductionRule;
  payrollDivisor?: number; // Divisor for monthly staff percentage calculation (e.g. 26 or 30 days)
  combinationPolicy: PenaltyCombinationPolicy; // 'BOTH' | 'HIGHEST_ONLY'

  isActive: boolean;
  exitDate?: string; // last employed day (set on deactivation; payroll prorates the exit month)
  avatarUrl?: string;
  specialties: string[];
  hasPortalAccess?: boolean;
  linkedUserId?: string;
  linkedUserEmail?: string;
}

export type CustomerSource =
  | 'WALK_IN'
  | 'REFERRAL'
  | 'SOCIAL_MEDIA'
  | 'OTHER'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'TIKTOK'
  | 'GOOGLE'
  | 'WORD_OF_MOUTH'
  | 'INFLUENCER'
  | 'RETURNING';

export interface Client {
  id: string;
  branchId: string;
  name: string;
  phone: string;
  email?: string;
  loyaltyPoints?: number;
  totalVisits?: number;
  lastVisitDate?: string;
  source?: CustomerSource;
  sourceDetails?: string;
  outstandingBalance?: number;
  isArchived?: boolean;
  notes?: string;
  createdAt?: string;
}

export interface ServiceCategory {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
}

export interface ServiceItem {
  id: string;
  branchId: string;
  code: string;
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  description?: string;
  taxTreatment: TaxTreatment;
  specificTaxRuleId?: string;
  isActive: boolean;
  taxExempt?: boolean;
}

export interface PackageComponent {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  allocationPercentage: number; // 0 to 100, must total 100%
  unitPrice: number;
}

export interface PackageItem {
  id: string;
  branchId: string;
  code: string;
  name: string;
  description?: string;
  price: number; // Manually entered selling price, independent of component sum
  components: PackageComponent[];
  taxTreatment: TaxTreatment;
  specificTaxRuleId?: string;
  isActive: boolean;
}

export type ItemType = 'RETAIL_PRODUCT' | 'SALON_CONSUMABLE' | 'BOTH';

export type UnitOfMeasure =
  | 'BOTTLE'
  | 'BOX'
  | 'PIECE'
  | 'LITER'
  | 'ML'
  | 'TUBE'
  | 'PACK'
  | 'PAIR'
  | 'JAR'
  | 'SET'
  | 'KG'
  | 'GRAM';

export interface InventoryItem {
  id: string;
  sku: string;
  code: string; // Mirrors sku for POS item interoperability
  barcode?: string;
  name: string;
  category: string;
  description?: string;
  brand?: string;
  imageUrl?: string;
  itemType: ItemType;
  defaultPurchaseCost: number;
  sellingPrice: number; // POS selling price (for RETAIL_PRODUCT or BOTH)
  price: number; // POS price alias for cart calculations (matches sellingPrice)
  purchaseUnit: UnitOfMeasure;
  issueUnit: UnitOfMeasure;
  unitConversionRatio?: number; // e.g. 1 Box = 12 Pieces
  taxTreatment: TaxTreatment;
  specificTaxRuleId?: string;
  taxRate?: number;
  minStockLevel: number; // Low stock reorder threshold
  trackBatch: boolean;
  trackExpiry: boolean;
  nearExpiryAlertDays: number; // e.g. 60 days
  isActive: boolean; // non-destructive archive flag
  branchAvailability: string[]; // branch IDs or ['ALL']
  createdAt: string;
  updatedAt: string;
}

export type BatchStatus = 'VALID' | 'NEAR_EXPIRY' | 'EXPIRED' | 'QUARANTINED' | 'EXHAUSTED';

export interface InventoryBatch {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  branchId: string;
  batchNumber: string;
  purchaseId?: string;
  purchaseNumber?: string;
  supplierId?: string;
  supplierName?: string;
  receivedDate: string; // YYYY-MM-DD
  mfgDate?: string;
  expiryDate?: string; // YYYY-MM-DD
  initialQuantity: number;
  purchasedQuantity?: number; // alias for initialQuantity
  remainingQuantity: number;
  unitCostSnapshot: number;
  unitPurchaseCost?: number; // alias for unitCostSnapshot
  status: BatchStatus;
  quarantinedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  supplierCode: string; // e.g. SUP-001
  name: string;
  companyName?: string;
  phone: string;
  email?: string;
  contactPerson?: string;
  address?: string;
  taxNumber?: string;
  notes?: string;
  branchId: string | 'ALL';
  isActive: boolean;
  openingPayable: number;
  openingBalance?: number; // alias for openingPayable
  currentPayable: number; // positive = payable to supplier, negative = advance/credit with supplier
  currentBalance?: number; // alias for currentPayable
  totalPurchases: number;
  totalPayments: number;
  totalReturns: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type SupplierLedgerEntryType =
  | 'OPENING_BALANCE'
  | 'PURCHASE_CREDIT'
  | 'PURCHASE_BILL'
  | 'SUPPLIER_PAYMENT'
  | 'PURCHASE_RETURN'
  | 'SUPPLIER_REFUND'
  | 'APPROVED_ADJUSTMENT';

export interface SupplierLedgerEntry {
  id: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  date: string;
  time: string;
  entryType: SupplierLedgerEntryType;
  type?: string; // alias for entryType
  referenceType: 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT' | 'OPENING';
  referenceId: string;
  referenceNumber: string;
  reference?: string; // alias for referenceNumber
  description: string;
  debit: number; // payment / return / refund (reduces payable)
  credit: number; // credit purchase / opening balance (increases payable)
  payableCredit?: number; // alias for credit
  payableDebit?: number; // alias for debit
  runningBalance: number; // positive = payable, negative = advance
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export type PurchasePaymentMethod = 'CASH' | 'ONLINE' | 'CREDIT' | 'PARTIAL';
export type PurchasePaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';

export interface PurchaseLineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  quantity: number;
  unitPurchaseCost: number; // purchase cost snapshot
  historicalCostSnapshot?: number; // authoritative purchase cost snapshot
  lineDiscount: number;
  lineTotal: number;
  batchNumber?: string;
  expiryDate?: string;
  mfgDate?: string;
  batchId?: string;
}

export interface Purchase {
  id: string;
  purchaseNumber: string; // e.g. PO-LHE-2026-0001
  branchId: string;
  supplierId: string;
  supplierName: string;
  purchaseDate: string;
  supplierInvoiceNumber?: string;
  invoiceNumber?: string; // alias for supplierInvoiceNumber
  notes?: string;
  subtotal: number;
  discount: number;
  netAmount: number;
  totalCost?: number; // alias for netAmount
  paidAmount: number;
  balanceDue: number;
  balanceAmount?: number; // alias for balanceDue
  paymentMethod: PurchasePaymentMethod;
  paymentStatus: PurchasePaymentStatus;
  paymentAccountId?: string;
  paymentAccountName?: string;
  cashDrawerId?: string;
  lines: PurchaseLineItem[];
  status: 'POSTED' | 'CANCELLED';
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface SupplierPaymentRecord {
  id: string;
  paymentNumber: string; // e.g. SP-LHE-2026-0001
  supplierId: string;
  supplierName: string;
  branchId: string;
  paymentDate: string;
  paymentTime: string;
  amount: number;
  method: 'CASH' | 'ONLINE';
  paymentAccountId?: string;
  paymentAccountName?: string;
  cashDrawerId?: string;
  reference?: string;
  notes?: string;
  paidById: string;
  paidByName: string;
  createdAt: string;
}

export interface SupplierReturnLine {
  itemId: string;
  itemName: string;
  itemSku: string;
  batchId?: string;
  batchNumber?: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface SupplierReturn {
  id: string;
  returnNumber: string; // e.g. PR-LHE-2026-0001
  branchId: string;
  supplierId: string;
  supplierName: string;
  purchaseId?: string;
  purchaseNumber?: string;
  returnDate: string;
  lines: SupplierReturnLine[];
  totalAmount: number;
  refundTreatment: 'REDUCE_PAYABLE' | 'SUPPLIER_CREDIT' | 'CASH_REFUND' | 'ONLINE_REFUND';
  paymentAccountId?: string;
  paymentAccountName?: string;
  cashDrawerId?: string;
  reason: string;
  notes?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export type StockMovementType =
  | 'OPENING_STOCK'
  | 'PURCHASE_IN'
  | 'SALES_RETURN_IN'
  | 'SUPPLIER_REFUND_RESTOCK'
  | 'POS_RETURN_IN'
  | 'POSITIVE_ADJUSTMENT'
  | 'BRANCH_TRANSFER_IN'
  | 'POS_SALE_OUT'
  | 'SALON_CONSUMPTION_OUT'
  | 'SUPPLIER_RETURN_OUT'
  | 'EXPIRED_OUT'
  | 'DAMAGED_OUT'
  | 'INTERNAL_USE_OUT'
  | 'PROMOTIONAL_OUT'
  | 'NEGATIVE_ADJUSTMENT'
  | 'BRANCH_TRANSFER_OUT';

export interface StockMovement {
  id: string;
  movementNumber: string; // e.g. SM-LHE-2026-0001
  branchId: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  batchId?: string;
  batchNumber?: string;
  movementType: StockMovementType;
  direction: 'IN' | 'OUT';
  quantity: number;
  unitCostSnapshot: number;
  totalCostImpact: number;
  sourceReferenceType: 'PURCHASE' | 'INVOICE' | 'SETTLEMENT' | 'MANUAL_OUT' | 'RETURN' | 'OPENING';
  sourceReferenceId: string;
  referenceId?: string; // alias for sourceReferenceId
  sourceReferenceNumber: string;
  reason: string;
  notes?: string;
  createdById: string;
  createdByName: string;
  actorName?: string; // alias for createdByName
  createdAt: string;
  timestamp?: string; // alias for createdAt
}

export interface StockSettlementLine {
  itemId: string;
  itemName: string;
  itemSku: string;
  batchId?: string;
  batchNumber?: string;
  systemQuantity: number;
  countedQuantity: number;
  difference: number; // countedQuantity - systemQuantity
  unitCostSnapshot: number;
  costImpact: number; // difference * unitCostSnapshot
  reason: 'DAMAGE' | 'MISSING' | 'UNRECORDED_CONSUMPTION' | 'COUNTING_CORRECTION' | 'EXPIRED' | 'OTHER';
  notes?: string;
}

export interface StockSettlement {
  id: string;
  settlementNumber: string; // e.g. ST-LHE-2026-0001
  branchId: string;
  countDate: string;
  notes?: string;
  status: 'DRAFT' | 'POSTED';
  lines: StockSettlementLine[];
  totalSystemQuantity: number;
  totalCountedQuantity: number;
  totalDiscrepancyQuantity: number;
  totalNetCostImpact: number;
  totalCostVariance?: number; // alias for totalNetCostImpact
  createdById: string;
  createdByName: string;
  conductedByName?: string; // alias for createdByName
  approvedById?: string;
  approvedByName?: string;
  createdAt: string;
  postedAt?: string;
}

export interface StockLevelSnapshot {
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  itemType: ItemType;
  branchId: string;
  currentStock: number;
  minStockLevel: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  valuationCostBasis: number; // sum(qty * batch.unitCostSnapshot)
  potentialRetailValue: number; // currentStock * sellingPrice
  validBatchesCount: number;
  nearExpiryBatchesCount: number;
  expiredBatchesCount: number;
}

export interface COGSReportRecord {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  branchId: string;
  branchName: string;
  quantitySold: number;
  quantityReturned: number;
  netQuantity: number;
  grossSales: number;
  discountAllocated: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  marginPercentage: number;
}

export interface COGSReportSummary {
  totalRetailNetSales: number;
  netProductSales?: number; // alias for totalRetailNetSales
  totalRetailCOGS: number;
  totalCOGS?: number; // alias for totalRetailCOGS
  totalRetailGrossProfit: number;
  grossProfit?: number; // alias for totalRetailGrossProfit
  retailGrossMarginPercentage: number;
  totalConsumableMaterialCost: number;
  totalServiceRevenue: number;
  serviceContributionBeforeExpenses: number;
}

export type CreateInventoryItemInput = Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'> & {
  openingStock?: number;
  openingQuantity?: number;
  openingCost?: number;
  branchId?: string;
  supplierId?: string;
};

export interface CreatePurchaseInput {
  branchId: string;
  supplierId: string;
  purchaseDate: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceNo?: string;
  invoiceNumber?: string;
  notes?: string;
  discount?: number;
  paymentMethod: PurchasePaymentMethod;
  paidAmount?: number;
  partialPaidAmount?: number;
  paymentAccountId?: string;
  payerDrawerId?: string;
  cashDrawerId?: string;
  lines: Array<{
    itemId: string;
    quantity: number;
    unitPurchaseCost?: number;
    unitCost?: number;
    lineDiscount?: number;
    batchNumber?: string;
    expiryDate?: string;
    mfgDate?: string;
  }>;
}

export interface PaySupplierInput {
  idempotencyKey?: string;
  supplierId: string;
  branchId: string;
  amount: number;
  paymentDate: string;
  method?: 'CASH' | 'ONLINE';
  paymentMethod?: 'CASH' | 'ONLINE' | 'ONLINE_ACCOUNT';
  paymentAccountId?: string;
  payerDrawerId?: string;
  cashDrawerId?: string;
  reference?: string;
  notes?: string;
}

export interface CreateSupplierReturnInput {
  branchId: string;
  supplierId: string;
  purchaseId?: string;
  originalPurchaseId?: string;
  returnDate: string;
  reason: string;
  notes?: string;
  refundTreatment?: 'REDUCE_PAYABLE' | 'SUPPLIER_CREDIT' | 'CASH_REFUND' | 'ONLINE_REFUND';
  paymentAccountId?: string;
  cashDrawerId?: string;
  lines: Array<{
    itemId: string;
    batchId?: string;
    batchNumber?: string;
    quantity: number;
    unitCost: number;
  }>;
}

export interface CreateManualStockOutInput {
  branchId: string;
  itemId: string;
  batchId?: string;
  quantity: number;
  reasonType?: 'SALON_CONSUMPTION' | 'DAMAGE' | 'EXPIRED' | 'INTERNAL_USE' | 'PROMOTIONAL' | 'OTHER';
  reason: string;
  notes?: string;
}

export interface CreateStockSettlementInput {
  branchId: string;
  countDate: string;
  notes?: string;
  lines: Array<{
    itemId: string;
    batchId?: string;
    systemQuantity?: number;
    countedQuantity: number;
    reason?: 'DAMAGE' | 'MISSING' | 'UNRECORDED_CONSUMPTION' | 'COUNTING_CORRECTION' | 'EXPIRED' | 'OTHER';
    notes?: string;
  }>;
}

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  // Backward compatibility with initial seed data:
  | 'SCHEDULED'
  | 'IN_PROGRESS';

export type AppointmentBillingStatus = 'UNBILLED' | 'BILLED';

export interface AppointmentPackageComponent {
  componentInstanceId: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  durationMinutes: number;
  allocationPercentage: number;
  staffId: string;
  staffName: string;
  startTime?: string;
  endTime?: string;
}

export interface AppointmentItem {
  lineInstanceId: string;
  type: 'SERVICE' | 'PACKAGE';
  itemId: string;
  code: string;
  name: string;
  durationMinutes: number;
  unitPrice: number;
  staffId: string;
  staffName: string;
  startTime?: string;
  endTime?: string;
  packageComponents?: AppointmentPackageComponent[];
  assignedStaff?: Array<{
    staffId: string;
    staffName: string;
    staffCommissionRate?: number;
  }>;
}

export interface AppointmentRescheduleRecord {
  previousDate: string;
  previousStartTime: string;
  previousEndTime: string;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
  rescheduledByUserId: string;
  rescheduledByName: string;
  rescheduledAt: string;
  reason?: string;
}

export interface Appointment {
  id: string;
  appointmentNumber?: string;
  branchId: string;
  branchName?: string;
  clientId?: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  customerSource?: CustomerSource;
  customerSourceDetails?: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM or HH:MM AM/PM
  endTime?: string;
  durationMinutes: number;
  items?: AppointmentItem[];
  price: number;
  status: AppointmentStatus;
  billingStatus?: AppointmentBillingStatus;
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
  notes?: string;

  // Legacy field support for existing mock data & dashboard widgets:
  serviceId?: string;
  serviceName?: string;
  staffId?: string;
  staffName?: string;
  time?: string;

  // Audit trail
  createdByUserId?: string;
  createdByName?: string;
  createdAt?: string;
  updatedByUserId?: string;
  updatedByName?: string;
  updatedAt?: string;
  confirmedByUserId?: string;
  confirmedByName?: string;
  confirmedAt?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  cancelReason?: string;
  rescheduleHistory?: AppointmentRescheduleRecord[];
}

export interface CreateAppointmentInput {
  branchId: string;
  clientId?: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  customerSource?: CustomerSource;
  customerSourceDetails?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM or HH:MM AM/PM
  items: {
    lineInstanceId?: string;
    type: 'SERVICE' | 'PACKAGE';
    itemId: string;
    staffId?: string; // For SERVICE
    assignedStaff?: Array<{
      staffId: string;
      staffName: string;
      staffCommissionRate?: number;
    }>;
    packageComponents?: {
      componentInstanceId?: string;
      serviceId: string;
      staffId: string;
    }[];
  }[];
  notes?: string;
  status?: 'PENDING' | 'CONFIRMED';
}

export interface UpdateAppointmentInput {
  date?: string;
  startTime?: string;
  items?: {
    lineInstanceId?: string;
    type: 'SERVICE' | 'PACKAGE';
    itemId: string;
    staffId?: string;
    assignedStaff?: Array<{
      staffId: string;
      staffName: string;
      staffCommissionRate?: number;
    }>;
    packageComponents?: {
      componentInstanceId?: string;
      serviceId: string;
      staffId: string;
    }[];
  }[];
  notes?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  customerSource?: CustomerSource;
  customerSourceDetails?: string;
}

export interface AppointmentConfirmationMessage {
  appointmentId: string;
  appointmentNumber: string;
  clientName: string;
  clientPhone: string;
  branchName: string;
  branchPhone: string;
  date: string;
  time: string;
  servicesList: string[];
  totalEstimatedPrice: number;
  messageText: string;
  whatsappUrl: string;
}

export interface AppointmentReportRecord {
  id: string;
  appointmentNumber: string;
  branchId: string;
  branchName: string;
  date: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientPhone: string;
  customerSource?: CustomerSource;
  serviceSummary: string;
  staffSummary: string;
  primaryStaffId: string;
  primaryStaffName: string;
  quotedPrice: number;
  status: AppointmentStatus;
  billingStatus: AppointmentBillingStatus;
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
  actualNetSales?: number;
  actualInvoiceTotal?: number;
  invoicePaymentStatus?: InvoiceStatus;
  durationMinutes: number;
}

export interface AppointmentReportSummary {
  totalAppointments: number;
  pendingCount: number;
  confirmedCount: number;
  checkedInCount: number;
  inServiceCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  billedCount: number;
  unbilledCount: number;
  totalQuotedValue: number;
  totalActualNetSales: number;
  totalEstimatedValue?: number;
  actualInvoiceNetSales?: number;
  actualInvoiceTotal?: number;
}

export type PaymentMethod = 'CASH' | 'ONLINE_ACCOUNT' | 'SPLIT';
export type InvoiceStatus = 'PAID' | 'UNPAID' | 'PARTIAL';

export interface PaymentRecord {
  kind?: 'POS' | 'DUES_COLLECTION';
  reversedAt?: string;
  reversedByName?: string;
  reversalReason?: string;
  reversalDate?: string;
  receiptNumber?: string;
  id: string;
  invoiceId: string;
  branchId: string;
  date: string;
  time: string;
  amount: number;
  billAmountAllocated?: number; // Explicit allocation towards bill subtotal + tax
  tipAmountAllocated?: number; // Explicit allocation towards staff gratuity
  method: 'CASH' | 'ONLINE_ACCOUNT';
  paymentAccountId?: string;
  paymentAccountName?: string;
  processedByUserId: string;
  processedByName: string;
  cashTendered?: number;
  changeReturned?: number;
  previousBalance?: number;
  remainingBalance?: number;
  notes?: string;
}

export interface InvoiceLineItemComponent {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  quantity: number;
  allocationPercentage: number;
  allocatedAmount: number;
  staffCommissionRate: number;
}

export interface InvoiceLineItem {
  id: string;
  name: string;
  type: 'SERVICE' | 'PRODUCT' | 'PACKAGE' | 'CUSTOM_SERVICE';
  itemId?: string; // serviceId, packageId, or inventoryItemId
  code?: string;
  staffId: string;
  staffName: string;
  staffCommissionRate?: number;
  quantity: number;
  unitPrice: number;
  discountAllocated?: number;
  netSales?: number;
  taxTreatment?: TaxTreatment;
  taxRate?: number;
  tax: number;
  total: number;
  assignedStaff?: Array<{
    staffId: string;
    staffName: string;
    staffCommissionRate?: number;
    allocatedAmount?: number;
  }>;
  packageComponents?: InvoiceLineItemComponent[];
  packageComponentsSnapshot?: InvoiceLineItemComponent[];
  batchId?: string;
  batchNumber?: string;
  unitCostSnapshot?: number;
  cogsAmount?: number;
}

export interface Invoice {
  bookingId?: string;
  advanceAdjusted?: number;
  id: string;
  invoiceNumber: string;
  branchId: string;
  appointmentId?: string;
  date: string;
  time: string;
  clientId?: string;
  clientName: string;
  clientPhone: string;
  customerSource?: CustomerSource;
  customerSourceDetails?: string;
  staffId: string;
  staffName: string;
  lineItems: InvoiceLineItem[];
  lines?: InvoiceLineItem[]; // alias for lineItems
  subtotal: number; // Gross sales before discounts
  discount: number; // Promotional / loyalty discount
  discountType?: 'FIXED' | 'PERCENTAGE';
  discountValue?: number;
  netSales: number; // Net sales after discounts, excluding tax and tips
  tax: number;
  tip: number; // Tips tracked strictly separate from salon revenue
  total: number; // Net sales + tax + tip
  paymentMethod: PaymentMethod;
  paymentAccountId?: string;
  paymentAccountName?: string;
  cashTendered?: number;
  changeReturned?: number;
  status: InvoiceStatus;
  amountPaid: number; // Sum of confirmed payments
  amountDue: number; // Outstanding receivable
  payments: PaymentRecord[];
  processedByUserId: string;
  processedByName: string;
  idempotencyKey?: string;
  notes?: string;
  lifecycle?: 'ACTIVE' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED';
  refunds?: InvoiceRefundDTO[];
}

export interface RefundLineInput {
  lineId: string;
  quantity: number;
  restock?: 'RESALABLE' | 'DAMAGED' | 'NONE';
}

export interface RefundInvoiceInput {
  type: 'REFUND' | 'VOID';
  reason: string;
  refundMethod?: 'CASH' | 'ONLINE_ACCOUNT';
  paymentAccountId?: string;
  lines?: RefundLineInput[];
}

export interface InvoiceRefundDTO {
  id: string;
  refundNumber: string;
  type: 'REFUND' | 'VOID';
  refundDate: string;
  netReversed: number;
  taxReversed: number;
  tipReversed: number;
  cashOut: number;
  receivableCancelled: number;
  method?: string;
  reason: string;
  byName: string;
  createdAt: string;
  lines: {
    lineId: string;
    quantity: number;
    net: number;
    tax: number;
    restock: 'RESALABLE' | 'DAMAGED' | 'NONE';
  }[];
}

export interface RefundInvoiceResult {
  invoice: Invoice;
  refund: {
    refundNumber: string;
    type: 'REFUND' | 'VOID';
    netReversed: number;
    taxReversed: number;
    tipReversed: number;
    cashOut: number;
  };
}

export interface POSCartComponentAssignment {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  allocationPercentage: number;
  allocatedAmount: number;
  staffId: string;
  staffName: string;
  staffCommissionRate: number;
}

export interface POSCartItem {
  bookingItemType?: 'SERVICE' | 'PACKAGE' | 'CUSTOM_SERVICE';
  bookingTaxRate?: number;
  bookingDurationMinutes?: number;
  bookingDescription?: string;
  cartInstanceId: string;
  type: 'SERVICE' | 'PACKAGE' | 'PRODUCT';
  item: ServiceItem | PackageItem | InventoryItem;
  quantity: number;
  staffId: string;
  staffName: string;
  staffCommissionRate: number;
  assignedStaff?: Array<{
    staffId: string;
    staffName: string;
    staffCommissionRate: number;
    allocatedAmount?: number;
  }>;
  packageComponents?: POSCartComponentAssignment[];
  batchId?: string;
  batchNumber?: string;
  unitCostSnapshot?: number;
}

export interface POSPaymentEntry {
  method: 'CASH' | 'ONLINE_ACCOUNT';
  paymentAccountId?: string;
  paymentAccountName?: string;
  amount: number; // Retained amount towards bill and/or tip
  billAllocation: number;
  tipAllocation: number;
  cashTendered?: number;
  changeReturned?: number;
}

export interface CreatePOSInvoiceInput {
  bookingId?: string;
  bookingRevision?: number;
  bookingUpdate?: import('./booking').BookingInput;
  branchId: string;
  appointmentId?: string;
  clientId?: string;
  clientName: string;
  clientPhone: string;
  customerSource?: CustomerSource;
  customerSourceDetails?: string;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: number;
  tip: number;
  cartItems: POSCartItem[];
  payments: POSPaymentEntry[];
  idempotencyKey?: string;
  notes?: string;
  applyTax?: boolean;
}

export interface CollectOutstandingPaymentInput {
  invoiceId: string;
  payments: POSPaymentEntry[];
  idempotencyKey: string;
  notes?: string;
}

export interface IdempotencyRecord {
  key: string;
  operation: 'POS_POSTING' | 'COLLECTION' | 'EXPENSE_POSTING' | 'SETTLEMENT_SUBMISSION' | 'SETTLEMENT_APPROVAL';
  branchId: string;
  actorId: string;
  payloadFingerprint: string;
  result: any;
  createdAt: string;
}

export type ExpenseStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'PAID' | 'PENDING_APPROVAL';

export interface ExpenseCategoryItem {
  id: string;
  branchId: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CashTransferRecord {
  id: string;
  transferNumber: string;
  branchId: string;
  date: string;
  time: string;
  amount: number;
  fromSource: 'BRANCH_VAULT' | 'ONLINE_ACCOUNT' | 'SETTLEMENT_HANDOVER' | 'DRAWER_RETAINED_FLOAT';
  fromAccountId?: string;
  toSource?: 'BRANCH_VAULT' | 'DRAWER';
  toDrawerId?: string;
  toCustodianUserId: string;
  toCustodianName: string;
  transferredByUserId: string;
  transferredByName: string;
  notes?: string;
}

export interface Expense {
  id: string;
  voucherNumber: string;
  branchId: string;
  expenseDate?: string; // YYYY-MM-DD (defaults to date)
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm AM/PM
  title: string;
  payee?: string;
  description?: string;
  category: string;
  amount: number;
  paymentSource: 'CASH_DRAWER' | 'ONLINE_ACCOUNT';
  paymentAccountId?: string;
  paymentAccountName?: string;
  createdByUserId?: string;
  createdByName?: string;
  paidByUserId?: string;
  paidByName?: string;
  approvedByUserId?: string;
  status: ExpenseStatus;
  externalReference?: string;
  notes?: string;
  idempotencyKey?: string;
  paidFromDrawerId?: string;
  receivingDrawerId?: string;
  receivingCustodianUserId?: string;
  receivingCustodianName?: string;
  reversalOfVoucherNumber?: string;
  reversalVoucherNumber?: string;
  reversedByUserId?: string;
  reversedByName?: string;
  reversedAt?: string;
  reversalReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CashDrawer {
  bookingAdvances?: number;
  bookingRefunds?: number;
  id: string;
  branchId: string;
  date: string;
  openingCash: number;
  cashSales: number;
  cashTipsCollected: number;
  cashExpensesPaid: number;
  expectedInDrawer: number;
  currentCashBalance?: number; // alias for expectedInDrawer
  actualInDrawer: number;
  variance: number;
  custodianUserId: string;
  custodianName: string;
  drawerName?: string; // alias for custodianName
  status: 'OPEN' | 'SETTLEMENT_PENDING' | 'SETTLED';
  closedAt?: string;
  settledAt?: string;
  successorDrawerId?: string;
}

export type SettlementStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PENDING_VERIFICATION'
  | 'APPROVED_TRANSFERRED';

export interface CashVarianceAdjustment {
  id: string;
  adjustmentNumber: string; // CVA-LHE-01-2026-0001
  settlementId: string;
  settlementNumber: string;
  branchId: string;
  date: string;
  time: string;
  varianceAmount: number; // positive = overage, negative = shortage
  explanation: string;
  approvedByUserId: string;
  approvedByName: string;
  createdAt: string;
}

export interface Settlement {
  id: string;
  settlementNumber: string;
  branchId: string;
  drawerId?: string;
  date: string;
  time: string;
  cutoffTime?: string;
  expectedCash?: number;
  countedCash?: number;
  variance?: number;
  varianceExplanation?: string;
  handoverAmount?: number;
  retainedFloat?: number;
  amount: number;
  destinationVaultId?: string;
  destinationVaultName?: string;
  denominationBreakdown?: Record<string, number>;
  submittedByUserId: string;
  submittedByName: string;
  submittedByRole: string;
  submittedAt?: string;
  receivedByUserId?: string;
  receivedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  status: SettlementStatus;
  notes: string;
  varianceAdjustmentRecordId?: string;
  successorDrawerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type CustodyTransactionType =
  | 'BOOKING_ADVANCE'
  | 'BOOKING_REFUND'
  | 'OPENING_FLOAT'
  | 'POS_SALE'
  | 'DUES_COLLECTION'
  | 'TIP_RECEIVED'
  | 'FLOAT_RECEIVED'
  | 'EXPENSE_PAID'
  | 'STAFF_LOAN_DISBURSEMENT'
  | 'STAFF_LOAN_REVERSAL'
  | 'EXPENSE_REVERSAL_REFUND'
  | 'INVOICE_REFUND'
  | 'HANDOVER_SETTLEMENT'
  | 'VARIANCE_ADJUSTMENT';

export interface CustodyTransaction {
  id: string;
  date: string;
  time: string;
  type: CustodyTransactionType;
  referenceNumber: string;
  description: string;
  cashIn: number;
  cashOut: number;
  runningBalance: number;
  actorUserId: string;
  actorName: string;
  documentType: 'BOOKING' | 'INVOICE' | 'COLLECTION' | 'EXPENSE' | 'REVERSAL' | 'SETTLEMENT' | 'TRANSFER' | 'ADJUSTMENT' | 'DRAWER';
  documentId: string;
  rawEntity?: any;
}

export interface BalanceSheetSummary {
  bookingAdvancesTotal?: number;
  bookingRefundsTotal?: number;
  drawer?: CashDrawer;
  user: User;
  branch: Branch;
  openingCash: number;
  cashSalesTotal: number;
  previousDuesCollectedTotal: number;
  cashTipsTotal: number;
  floatReceivedTotal: number;
  cashExpensesPaidTotal: number;
  staffLoanDisbursementsTotal?: number;
  staffLoanReversalsTotal?: number;
  cashRefundsPaidTotal?: number;
  cashReversalsRefundTotal: number;
  approvedHandoversTotal: number;
  expectedCashInCustody: number;
  lastCountedCash?: number;
  lastCountedTimestamp?: string;
  lastVariance?: number;
  onlineCollectionsTotal: number;
  onlineCollectionsBreakdown: Array<{
    paymentAccountId: string;
    paymentAccountName: string;
    amount: number;
    count: number;
  }>;
}

export interface CreateSettlementInput {
  drawerId: string;
  branchId: string;
  countedCash: number;
  handoverAmount: number;
  retainedFloat: number;
  varianceExplanation?: string;
  destinationVaultId?: string;
  destinationVaultName?: string;
  denominationBreakdown?: Record<string, number>;
  notes?: string;
  isDraft?: boolean;
}

export interface ApproveSettlementInput {
  destinationVaultId?: string;
  destinationVaultName?: string;
  actualCashReceived?: number;
  acceptVariance?: boolean;
  notes?: string;
}

export type AttendanceStatus =
  | 'HALF_DAY'
  | 'PRESENT'
  | 'ABSENT'
  | 'PAID_LEAVE'
  | 'UNPAID_LEAVE'
  | 'HOLIDAY'
  | 'OFF_DAY'
  | 'WEEKLY_OFF'
  | 'MISSING_PUNCH'
  | 'NOT_RECORDED'
  | 'ON_TIME'
  | 'LATE'
  | 'ON_BREAK'
  | 'COMPLETED';

export type AttendanceSource = 'MANUAL' | 'IMPORT' | 'BIOMETRIC';

export interface AttendancePunch {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  timestamp: string; // formatted HH:mm AM/PM or ISO
  source: AttendanceSource;
  deviceId?: string;
}

export interface AttendanceCorrection {
  id: string;
  editedAt: string;
  editedByUserId: string;
  editedByName: string;
  reason: string;
  beforeSnapshot: {
    checkIn?: string;
    checkOut?: string;
    status?: string;
    workedHours?: number;
    isLate?: boolean;
    lateMinutes?: number;
    isEarlyExit?: boolean;
    earlyExitMinutes?: number;
  };
  afterSnapshot: {
    checkIn?: string;
    checkOut?: string;
    status?: string;
    workedHours?: number;
    isLate?: boolean;
    lateMinutes?: number;
    isEarlyExit?: boolean;
    earlyExitMinutes?: number;
  };
}

export interface AttendanceDeductionSnapshot {
  calculatedAt: string;
  compensationType: CompensationType;
  baseSalary: number;
  dailySalaryRate: number;
  payrollDivisor?: number;
  effectiveDailyBase: number;
  lateDeductionAmount: number;
  earlyExitDeductionAmount: number;
  totalDeductionAmount: number;
  combinationPolicy: PenaltyCombinationPolicy;
  notes?: string;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode?: string;
  designation?: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  checkIn: string; // e.g. "08:52 AM"
  checkOut?: string; // e.g. "05:45 PM"
  checkInTimestamp?: string;
  checkOutTimestamp?: string;
  scheduledHours: number;
  workedHours: number;
  status: AttendanceStatus;
  isLate?: boolean;
  lateMinutes?: number;
  isEarlyExit?: boolean;
  earlyExitMinutes?: number;
  isMissingPunch?: boolean;
  source?: AttendanceSource;
  rawEventRef?: string;
  punches?: AttendancePunch[];
  correctionHistory?: AttendanceCorrection[];
  calculationSnapshot?: AttendanceDeductionSnapshot;
  notes?: string;
  isOvernightShift?: boolean;
  scheduledShift?: string;
  isFinalized?: boolean;
}

export interface LeaveRecord {
  id: string;
  leaveNumber: string; // LV-LHE-2026-0001
  branchId: string;
  staffId: string;
  staffName: string;
  employeeCode?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalDays: number;
  workingDates?: string[];
  type: 'PAID' | 'UNPAID';
  reason: string;
  status: 'APPROVED' | 'CANCELLED';
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  cancellationReason?: string;
}

export interface BranchHoliday {
  id: string;
  branchId: string; // specific branch or 'ALL'
  date: string; // YYYY-MM-DD
  title: string;
}

export type OvertimeStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface OvertimeRecord {
  id: string;
  overtimeNumber?: string; // OT-LHE-2026-0001
  staffId: string;
  staffName: string;
  employeeCode?: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  minutes?: number;
  approvedMinutes: number;
  hourlyRate?: number; // snapshotted on approval
  amount?: number; // (approvedMinutes / 60) * hourlyRate
  reason: string;
  notes?: string;
  status?: OvertimeStatus;
  enteredByUserId?: string;
  enteredByName?: string;
  enteredAt?: string;
  approvedByUserId?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectedByUserId?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  payrollId?: string; // Linked when consumed in finalized payroll
  rateMultiplier?: number;
}

export interface CreateAttendanceInput {
  staffId: string;
  branchId: string;
  date: string;
  checkIn: string; // "09:00 AM" or "09:00"
  checkOut?: string;
  notes?: string;
  source?: AttendanceSource;
  isOvernightShift?: boolean;
}

export interface CorrectAttendanceInput {
  checkIn: string;
  checkOut?: string;
  status?: AttendanceStatus;
  reason: string;
  notes?: string;
}

export interface CreateLeaveInput {
  staffId: string;
  branchId: string;
  startDate: string;
  endDate: string;
  type: 'PAID' | 'UNPAID';
  reason: string;
  allowOverride?: boolean;
}

export interface LeaveAllowanceSummary {
  isConfigured: boolean;
  allowedDays: number;
  period: 'MONTHLY' | 'YEARLY';
  usedDays: number;
  remainingDays: number;
}

export interface CSVAttendanceImportRow {
  rowNumber: number;
  employeeCode: string;
  date: string;
  checkIn: string;
  checkOut?: string;
  deviceId?: string;
  status: 'VALID' | 'DUPLICATE' | 'INVALID';
  rejectionReason?: string;
  matchedStaffId?: string;
  matchedStaffName?: string;
}

export interface CSVAttendanceImportResult {
  totalRows: number;
  acceptedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  details: CSVAttendanceImportRow[];
}

export interface CatalogueImportRowDetail {
  rowNumber: number;
  id?: string;
  name?: string;
  code?: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'INVALID';
  reason?: string;
}

export interface CatalogueImportResult {
  totalRows: number;
  acceptedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  details: CatalogueImportRowDetail[];
}

export interface CreateOvertimeInput {
  staffId: string;
  branchId: string;
  date: string;
  minutes: number;
  reason: string;
  notes?: string;
  status?: 'DRAFT' | 'SUBMITTED';
}

export interface UpdateOvertimeInput {
  minutes?: number;
  reason?: string;
  notes?: string;
  status?: 'DRAFT' | 'SUBMITTED';
}

// ==========================================
// PAYROLL & STAFF COMMISSION DOMAIN TYPES
// ==========================================

export type MonthlyAbsenceDivisor = 26 | 30 | 'CALENDAR_DAYS' | 'WORKING_DAYS';
export type ProrationMethod = 'CALENDAR_DAYS' | 'WORKING_DAYS';

export interface PayrollPolicyConfig {
  id?: string;
  branchId: string; // branch-specific or 'ALL'
  monthlyAbsenceDivisor: MonthlyAbsenceDivisor;
  customDivisorDays?: number; // fallback e.g. 26 or 30
  dailyStaffPaidLeaveEligibility: boolean; // default true
  nonWorkedWeeklyOffPaid: boolean; // default false for daily, true for monthly
  nonWorkedHolidayPaid: boolean; // default true for monthly, false for daily
  prorationMethod: ProrationMethod; // 'CALENDAR_DAYS' | 'WORKING_DAYS'
  updatedAt?: string;
  updatedByUserId?: string;
}

export interface AttendancePolicyConfig {
  id?: string;
  branchId: string;
  autoMarkAbsentEnabled: boolean; // default true
  autoAbsentThresholdMinutes: number; // default 60 (1 hour after shift start)
  defaultStartTime: string; // default "09:00"
  defaultEndTime: string; // default "18:00"
  lateGraceMinutes: number; // default 15
  earlyGraceMinutes: number; // default 15
  updatedAt?: string;
  updatedByUserId?: string;
}

export type PayrollRunStatus = 'DRAFT' | 'FINALIZED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface PayrollPayment {
  id: string;
  paymentNumber: string; // PAYMT-LHE-2026-0001
  payrollRunId: string;
  payslipId: string;
  staffId: string;
  staffName: string;
  branchId: string;
  amount: number;
  salaryAmount?: number;
  commissionAmount?: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  onlineAccountName?: string;
  paidAt: string;
  paidByUserId: string;
  paidByName: string;
  reference: string;
  notes?: string;
  status: 'COMPLETED' | 'REVERSED';
  reversedAt?: string;
  reversedByUserId?: string;
  reversedByName?: string;
  reversalReason?: string;
}

export interface PayslipCalculationDetails {
  formula: string;
  divisorUsed?: number;
  divisorRule?: string;
  monthlyCalculationVersion?: number;
  prorationApplied?: boolean;
  prorationFormula?: string;
  prorationDays?: number;
  payableDays?: number;
  prorationDivisor?: number;
  dailyRateUsed?: number;
  periodType?: string;
  startDate?: string;
  endDate?: string;
  policyNotes: string;
}

export interface PayslipRecord {
  joiningDate?: string;
  employmentNotes?: string[];
  startDate?: string;
  endDate?: string;
  runType?: PayrollRunType;
  id: string;
  payrollRunId: string;
  payslipNumber: string; // PS-LHE-2026-09-0001
  staffId: string;
  staffName: string;
  employeeCode: string;
  designation: string;
  branchId: string;
  month: string; // YYYY-MM
  compensationType: CompensationType;
  effectiveBaseSalary: number;
  effectiveDailyRate: number;
  workingDaysInMonth: number;
  calendarDaysInMonth: number;
  presentDays: number;
  halfDayDays?: number;
  lateDays?: number;
  earlyExitDays?: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  missingPunchDays: number;
  unrecordedDays: number;
  hasExceptions: boolean;
  exceptionDetails?: string[];
  canFinalize?: boolean;
  blockReason?: string;
  baseEarnings: number;
  leaveEarnings: number;
  absenceDeductions: number;
  lateEarlyDeductions: number;
  attendancePenaltyDeductions: number;
  approvedOvertimeMinutes: number;
  approvedOvertimeHourlyRate: number;
  approvedOvertimeAmount: number;
  consumedOvertimeIds: string[];
  consumedAttendanceDates: string[];
  // payroll.md §3 — optional on payslips generated before 2026-10-06
  termsEffectiveDate?: string;
  exitDate?: string;
  paidHolidayDays?: number;
  paidWeeklyOffDays?: number;
  holidayDays?: number;
  weeklyOffDays?: number;
  workedWeeklyOffDays?: number;
  workedHolidayDays?: number;
  workedDayEquivalents?: number;
  approvedOvertimeHours?: number;
  holidayEarnings?: number;
  attendanceImpact?: number;
  allowanceLines?: { id: string; name: string; amount: number }[];
  adjustments?: { id: string; type: PayrollAdjustmentType; title: string; amount: number }[];
  recurringAllowances?: number;
  oneOffAllowances?: number;
  bonusAmount?: number;
  allowancesTotal?: number;
  otherDeductions?: number;
  advanceRecoveries?: { advanceId: string; advanceNumber: string; amount: number; balanceBefore: number; balanceAfter: number }[];
  advanceRecoveryAmount?: number;
  grossPayable: number;
  totalDeductions: number;
  netPayable: number;
  monthlyEarnedSalary?: number;
  previouslyPaidCustomSalary?: number;
  remainingMonthlySalary?: number;
  salaryNetPayable?: number;
  salaryPaidAmount?: number;
  commissionPayable?: number;
  combinedNetPayable?: number;
  paidAmount: number;
  outstandingAmount: number;
  status: PayrollRunStatus;
  calculationDetails: PayslipCalculationDetails;
  payments: PayrollPayment[];
}

export type PayrollRunType = 'DAILY' | 'MONTHLY' | 'CUSTOM_RANGE';
export interface PayrollPreviewOptions {
  runType?: PayrollRunType;
  startDate?: string;
  endDate?: string;
  compensationType?: CompensationType | 'ALL';
  staffIds?: string[];
  includeDaily?: boolean;
}

export interface PayrollRun {
  id: string;
  payrollNumber: string; // PAY-LHE-2026-09-0001
  branchId: string;
  branchName?: string;
  month: string; // YYYY-MM
  startDate?: string;
  endDate?: string;
  runType?: PayrollRunType;
  compensationTypeFilter?: CompensationType | 'ALL';
  status: PayrollRunStatus;
  totalPayable: number;
  totalPaid: number;
  totalOutstanding: number;
  employeeCount: number;
  payslips: PayslipRecord[];
  policySnapshot: PayrollPolicyConfig;
  generatedAt: string;
  generatedByUserId: string;
  generatedByName: string;
  finalizedAt?: string;
  finalizedByUserId?: string;
  finalizedByName?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  notes?: string;
}

// ── Payroll inputs (payroll.md §3.7–3.8) ──
export type PayrollAdjustmentType = 'ALLOWANCE' | 'BONUS' | 'DEDUCTION';

export interface StaffAllowance {
  id: string;
  branchId: string;
  staffId: string;
  name: string;
  amount: number;
  isActive: boolean;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollAdjustment {
  id: string;
  branchId: string;
  staffId: string;
  month: string;
  type: PayrollAdjustmentType;
  title: string;
  amount: number;
  notes?: string;
  status: 'ACTIVE' | 'CANCELLED';
  payrollRunId?: string;
  locked: boolean;
  createdByName: string;
  createdAt: string;
  cancelledAt?: string;
  cancelledByName?: string;
}

export interface SalaryAdvance {
  id: string;
  advanceNumber: string;
  branchId: string;
  staffId: string;
  staffName: string;
  amount: number;
  recoveryPerMonth: number;
  startMonth: string;
  recoveredAmount: number;
  balance: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  onlineAccountName?: string;
  reason: string;
  status: 'ACTIVE' | 'RECOVERED' | 'REVERSED';
  issueDate: string;
  issuedAt: string;
  issuedByName: string;
  reversedAt?: string;
  reversedByName?: string;
  reversalReason?: string;
  recoveries: { id: string; month: string; amount: number; payrollRunId: string }[];
}

export interface IssueSalaryAdvanceInput {
  staffId: string;
  amount: number;
  recoveryPerMonth?: number;
  startMonth?: string;
  method: 'CASH' | 'ONLINE';
  onlineAccountId?: string;
  reason: string;
}

export interface MonthlyPaySummaryRow {
  staffId: string;
  staffName: string;
  employeeCode: string;
  designation: string;
  compensationType: CompensationType;
  salaryStatus: PayrollRunStatus | 'NOT_GENERATED';
  salaryEstimate: number; // draft preview only — not a liability until finalized
  salaryNet: number;
  salaryPaid: number;
  salaryOutstanding: number;
  commissionNet: number;
  commissionPaid: number;
  commissionOutstanding: number;
  commissionPending: number;
  totalEarnings: number;
  totalPaid: number;
  totalOutstanding: number;
  advanceBalance: number;
}

export interface MonthlyPaySummary {
  branchId: string;
  month: string;
  payrollRunId: string | null;
  payrollStatus: PayrollRunStatus | 'NOT_GENERATED';
  commissionRunIds: string[];
  rows: MonthlyPaySummaryRow[];
  totals: Omit<MonthlyPaySummaryRow, 'staffId' | 'staffName' | 'employeeCode' | 'designation' | 'compensationType' | 'salaryStatus'>;
}

// ── Spec §10.2 / §10.3 staff pay reports ──
export interface StaffSalaryReportRow {
  payslipId: string;
  payslipNumber: string;
  payrollNumber: string;
  period: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  designation: string;
  branchId: string;
  branchName?: string;
  compensationType: CompensationType;
  presentDays?: number;
  absentDays?: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  holidayDays?: number;
  weeklyOffDays?: number;
  paidHolidayDays?: number;
  paidWeeklyOffDays?: number;
  workedWeeklyOffDays?: number;
  workedHolidayDays?: number;
  overtimeHours?: number;
  basic: number;
  attendance: number;
  overtime: number;
  allowances: number;
  deductions: number;
  advanceRecovery: number;
  gross: number;
  net: number;
  paid: number;
  outstanding: number;
  cashPaid?: number;
  onlinePaid?: number;
  status: 'FINALIZED' | 'PARTIALLY_PAID' | 'PAID';
  finalizedAt?: string;
  paidDate: string | null;
  processedBy?: string;
}

export interface StaffSalaryReportTotals {
  presentDays?: number; absentDays?: number; paidLeaveDays?: number; unpaidLeaveDays?: number; holidayDays?: number; weeklyOffDays?: number; overtimeHours?: number;
  basic: number; attendance: number; overtime: number; allowances: number; deductions: number;
  advanceRecovery: number; gross: number; net: number; paid: number; outstanding: number;
}

export interface StaffSalaryReport {
  filters: Record<string, string | undefined>;
  dateBasis: string;
  summary: StaffSalaryReportTotals & { payslips: number };
  rows: StaffSalaryReportRow[];
  totals: StaffSalaryReportTotals;
}

export interface StaffSalaryReportQuery {
  branchId?: string;
  fromMonth: string;
  toMonth: string;
  staffId?: string;
  designation?: string;
  paymentStatus?: 'FINALIZED' | 'PARTIALLY_PAID' | 'PAID';
  paymentMethod?: 'CASH' | 'ONLINE';
}

export interface StaffCommissionReportRow {
  fullInvoiceCommission?: number;
  collectionBasedPayable?: number;
  remainingNotYetPayable?: number;
  invoiceEligibleNetSales?: number;
  invoiceCommissionReference?: number;
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
  eventId: string;
  date: string;
  staffId: string;
  staffName: string;
  invoiceId: string;
  invoiceNumber: string;
  customer: string;
  itemName: string;
  source: 'SERVICE' | 'PACKAGE' | 'PRODUCT';
  eventType: 'EARN' | 'REVERSAL';
  attributedNetSales: number;
  commissionEligibleSales?: number;
  rateSnapshot: number;
  earned: number;
  reversed: number;
  net: number;
  runStatus: 'IN_RUN' | 'NOT_RUN' | 'CALCULATED';
}

export interface StaffCommissionReportStaff {
  fullInvoiceCommission?: number;
  collectionBasedPayable?: number;
  remainingNotYetPayable?: number;
  invoiceEligibleNetSales?: number;
  invoiceCommissionReference?: number;
  staffId: string;
  staffName: string;
  employeeCode: string;
  attributedNetSales: number;
  earned: number;
  reversed: number;
  net: number;
  paid: number;
  openingLiability: number;
  outstanding: number;
}

export type InvoiceLifecycle = 'ACTIVE' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED';

export interface SalesInvoiceReportRow {
  id: string;
  invoiceNumber: string;
  date: string;
  time: string;
  branchId: string;
  branchName: string;
  clientId?: string;
  clientName: string;
  clientPhone: string;
  customerSource?: CustomerSource;
  soldByUserId: string;
  soldByName: string;
  staffSummary: string;
  linesSummary: string;
  paymentMethod: string;
  paymentStatus: InvoiceStatus;
  lifecycle: InvoiceLifecycle;
  gross: number;
  discount: number;
  netSales: number;
  tax?: number;
  taxCharged: number;
  taxReversed: number;
  netTaxLiability: number;
  tip: number;
  total: number;
  paid: number;
  refunded: number;
  refundedAmount?: number;
  refundedCashOut?: number;
  cashPaid?: number;
  onlinePaid?: number;
  outstanding: number;
  notes?: string;
  refundCount: number;
}

export interface SalesInvoicesReportKPIs {
  collectedRevenue?: number;
  taxCollected?: number;
  totalInvoices: number;
  grossSales: number;
  totalDiscounts: number;
  netSales: number;
  taxCharged: number;
  taxReversed: number;
  netTaxLiability: number;
  tipsCollected: number;
  invoiceTotal: number;
  totalPaid: number;
  totalRefunded: number;
  totalOutstanding: number;
  activeCount: number;
  partiallyRefundedCount: number;
  refundedCount: number;
  voidedCount: number;
}

export interface SalesInvoicesReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  search?: string;
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID' | 'ALL';
  lifecycle?: 'ACTIVE' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED' | 'ALL';
  paymentMethod?: string;
  staffId?: string;
  clientId?: string;
  soldByUserId?: string;
}

export interface SalesInvoicesReport {
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: SalesInvoicesReportKPIs;
  tenderBreakdown?: TenderBreakdown;
  rows: SalesInvoiceReportRow[];
  totals: Record<string, number>;
}

export interface DetailedIncomeComponent {
  id: string;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  staffId: string;
  staffName: string;
  allocatedAmount: number;
  allocationPercentage: number;
}

export interface DetailedIncomePayment {
  receiptNumber?: string;
  id: string;
  amount: number;
  method: string;
  paymentAccountId?: string;
  paymentAccountName: string;
  date: string;
  time: string;
  kind?: string;
}

export interface ReportRefundHistory {
  id: string;
  reference?: string;
  date: string;
  amount: number;
  cashOut: number;
  net: number;
  tax: number;
  tip: number;
  method?: string;
  reason?: string;
}

export interface DetailedIncomeRow {
  lineId?: string;
  originalInvoiceDate?: string;
  originalNetAmount?: number;
  originalBillAmount?: number;
  outstanding?: number;
  refundAmount?: number;
  refundHistory?: ReportRefundHistory[];
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  time: string;
  branchId: string;
  branchName: string;
  incomeSource: 'SERVICE' | 'PRODUCT' | 'PACKAGE';
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  itemCode?: string;
  itemName: string;
  staffId: string;
  staffName: string;
  quantity: number;
  unitPrice: number;
  gross: number;
  discount: number;
  netSales: number;
  refundedNet: number;
  recognizedNet: number;
  taxRate: number;
  tax: number;
  netTax: number;
  total: number;
  paymentStatus: InvoiceStatus;
  lifecycle: InvoiceLifecycle;
  createdByName: string;
  payments: DetailedIncomePayment[];
  components?: DetailedIncomeComponent[];
  refunds?: Array<{
    id: string;
    refundNumber: string;
    type: string;
    refundDate: string;
    method?: string;
    reason?: string;
    byName?: string;
    netReversed: number;
    taxReversed: number;
    tipReversed: number;
    cashOut: number;
    receivableCancelled: number;
    lineRefund?: {
      quantity: number;
      net: number;
      tax: number;
    } | null;
  }>;
}

export interface DetailedIncomeKPIs {
  totalTransactions: number;
  grossSales: number;
  totalDiscounts: number;
  netSales: number;
  totalRefunded: number;
  recognizedNetRevenue: number;
  totalTaxCharged: number;
  netTaxLiability: number;
  tipsCollected: number;
  serviceRevenue: number;
  serviceCount: number;
  productRevenue: number;
  productCount: number;
  packageRevenue: number;
  packageCount: number;
  totalPaid: number;
}

export interface DetailedIncomeReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  sourceType?: 'ALL' | 'SERVICE' | 'PRODUCT' | 'PACKAGE';
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID' | 'ALL';
  lifecycle?: 'ACTIVE' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED' | 'ALL';
  paymentMethod?: string;
  staffId?: string;
  soldByUserId?: string;
  search?: string;
}

export interface DetailedIncomeReport {
  displayRows?: DetailedIncomeRow[];
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: DetailedIncomeKPIs;
  rows: DetailedIncomeRow[];
  totals: {
    gross: number;
    discount: number;
    netSales: number;
    refundedNet: number;
    recognizedNet: number;
    tax: number;
    netTax: number;
  };
}

export type IncomeExpenseItemType =
  | 'INCOME'
  | 'OPERATING_EXPENSE'
  | 'SALARY_EXPENSE'
  | 'COMMISSION_EXPENSE'
  | 'INVENTORY_WRITEOFF';

export interface IncomeExpenseReportRow {
  originalInvoiceDate?: string;
  refundAmount?: number;
  refundCashOut?: number;
  refundHistory?: ReportRefundHistory[];
  reportEvents?: Array<{ id: string; reference?: string; date: string; type: string; amount: number; net: number; tax: number; tip: number; method?: string }>;
  invoiceId?: string;
  invoiceBillTotal?: number;
  tipAmount?: number;
  collectionAmount?: number;
  paymentEventType?: string;
  cashFlow?: number;
  id: string;
  date: string;
  type: IncomeExpenseItemType | string;
  category: string;
  source: string;
  reference: string;
  branchId: string;
  branchName: string;
  userOrPayee: string;
  customerName?: string;
  invoiceNumber?: string;
  description: string;
  income: number;
  recognizedIncome?: number;
  serviceAmount?: number;
  tax?: number;
  collectedTax?: number;
  totalBill?: number;
  totalReceived?: number;
  remainingDues?: number;
  collectedService?: number;
  expense: number;
  paid?: number;
  discount?: number;
  remaining?: number;
  paymentMethod: string;
  status: string;
}

export interface IncomeExpenseReportKPIs {
  staffLoanReceivable?: number;
  staffLoanCashOutflow?: number;
  totalCollections?: number;
  totalCollectedIncome?: number;
  totalRecognizedIncome: number;
  totalCollectedTax?: number;
  totalOutstandingDues?: number;
  cogs?: number;
  grossContribution?: number;
  directExpenses: number;
  salaryExpenses: number;
  commissionExpenses: number;
  inventoryLoss: number;
  totalOperatingExpenses: number;
  netOperatingPosition: number;
  operatingMarginPercent: number;
  totalTransactions: number;
}

export interface IncomeExpenseReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  type?: string;
  category?: string;
  status?: string;
  paymentMethod?: string;
  search?: string;
  userType?: string;
  userId?: string;
  user?: string;
}

export interface IncomeExpenseReport {
  displayRows?: IncomeExpenseReportRow[];
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: IncomeExpenseReportKPIs;
  rows: IncomeExpenseReportRow[];
  totals: {
    customerInvoiceTotal?: number;
    reportedExpenseRecognition?: number;
    accruedSalaryExpenses?: number;
    customerCollections?: number;
    staffLoanCashOutflow?: number;
    nonOperatingCashOutflows?: number;
    netCashMovement?: number;
    tipAmount?: number;
    collections?: number;
    totalCollections?: number;
    income: number;
    collectedIncome?: number;
    recognizedIncome?: number;
    collectedTax?: number;
    tax?: number;
    totalBill?: number;
    totalOutstandingDues?: number;
    expense: number;
    paid?: number;
    discount?: number;
    remaining?: number;
    net: number;
  };
  categories: string[];
}

export interface TaxReportRow {
  id: string;
  date: string;
  time: string;
  reference: string;
  branchId: string;
  branchName: string;
  clientName: string;
  taxableBase: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: string;
  status: string;
}

export interface TaxReportServiceRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  time: string;
  branchId: string;
  branchName: string;
  clientName: string;
  serviceName: string;
  serviceType: string;
  staffName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxableBase: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: string;
  status: string;
}

export interface TaxReportServiceSummary {
  serviceName: string;
  serviceType: string;
  count: number;
  taxableBase: number;
  taxAmount: number;
  taxRate: number;
}

export interface TaxReportKPIs {
  uncollectedCustomerTax?: number;
  totalTaxCharged?: number;
  collectedRevenue?: number;
  totalInvoicesTaxed: number;
  totalServicesTaxed?: number;
  totalTaxableSales: number;
  totalTaxCollected: number;
  totalTaxRefunded: number;
  netTaxLiability: number;
}

export interface TaxReportTotals {
  totalServices?: number;
  taxableBase: number;
  taxAmount: number;
  netTax: number;
  total?: number;
}

export interface TaxReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface TaxReport {
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: TaxReportKPIs;
  rows: TaxReportServiceRow[] | any[];
  serviceRows?: TaxReportServiceRow[];
  serviceSummary?: TaxReportServiceSummary[];
  invoiceRows?: TaxReportRow[];
  totals: TaxReportTotals;
}

export interface OperatingProfitStatementRow {
  id: string;
  name: string;
  section: 'REVENUE' | 'COGS' | 'GROSS_PROFIT' | 'EXPENSE' | 'NET_PROFIT' | 'STATUTORY_TAX' | 'MEMORANDUM';
  isHeader?: boolean;
  isSubItem?: boolean;
  isTotal?: boolean;
  isMajorTotal?: boolean;
  isFinalNet?: boolean;
  isDeduction?: boolean;
  currentAmount: number;
  percentOfRevenue: number;
  priorAmount: number;
  growthPercent: number | null;
}

export interface OperatingProfitDetailRow {
  id: string;
  accountName: string;
  classification: string;
  department: string;
  currentAmount: number;
  percentOfRevenue: number;
  priorAmount: number;
  varianceAmount: number;
  growthPercent: number | null;
  notes: string;
}

export interface OperatingProfitKPIs {
  totalNetRevenue: number;
  serviceSales: number;
  packageSales: number;
  productSales: number;
  totalCostOfSales: number;
  productCogs: number;
  materialConsumption: number;
  grossContribution: number;
  grossMarginPercent: number;
  totalOperatingExpenses: number;
  directExpenses: number;
  salaryExpenses: number;
  commissionExpenses: number;
  inventoryLoss: number;
  netOperatingProfit: number;
  operatingMarginPercent: number;
  priorNetRevenue: number;
  priorGrossContribution: number;
  priorOperatingProfit: number;
  revenueGrowthPercent: number | null;
  profitGrowthPercent: number | null;
  priorCashSurplus?: number;
  totalGrossCollections?: number;
  outstandingDues?: number;

  // Collection-based specific fields
  totalCollectedRevenue?: number;
  collectedServiceSales?: number;
  collectedPackageSales?: number;
  collectedProductSales?: number;
  totalCollectedTax?: number;
  totalCollections?: number;
  collectionGrossContribution?: number;
  totalPaidOperatingExpenses?: number;
  paidDirectExpenses?: number;
  paidSalaryExpenses?: number;
  paidCommissionExpenses?: number;
  collectionCashSurplus?: number;
  collectionEarnedCommission?: number;
  unpaidCommissionLiability?: number;
}

export interface OperatingProfitReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  viewMode?: 'ACCRUAL' | 'COLLECTION' | 'ALL';
}

export interface OperatingProfitReportViewData {
  kpis: OperatingProfitKPIs;
  statementRows: OperatingProfitStatementRow[];
  rows: OperatingProfitDetailRow[];
  totals: {
    revenue: number;
    costOfSales: number;
    grossMargin: number;
    operatingExpenses: number;
    netProfit: number;
    collectedTax?: number;
    collections?: number;
    totalCollections?: number;
    cashSurplus?: number;
    outstandingDues?: number;
    earnedCommission?: number;
    paidCommission?: number;
  };
}

export interface OperatingProfitReport {
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
    priorFrom: string;
    priorTo: string;
  };
  kpis: OperatingProfitKPIs;
  statementRows: OperatingProfitStatementRow[];
  rows: OperatingProfitDetailRow[];
  totals: {
    revenue: number;
    costOfSales: number;
    grossMargin: number;
    operatingExpenses: number;
    netProfit: number;
    collectedTax?: number;
    collections?: number;
    totalCollections?: number;
    cashSurplus?: number;
    outstandingDues?: number;
    earnedCommission?: number;
    paidCommission?: number;
  };
  accrual?: OperatingProfitReportViewData;
  collection?: OperatingProfitReportViewData;
}

export interface PaymentAccountSummaryItem {
  accountId: string;
  accountName: string;
  accountType: 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'OTHER';
  providerName: string;
  accountHolder: string;
  accountIdentifier?: string | null;
  branchId: string;
  branchName: string;
  openingBalance: number;
  moneyIn: number;
  moneyOut: number;
  debit?: number;
  credit?: number;
  transfersIn: number;
  transfersOut: number;
  netMovement: number;
  closingBalance: number;
  transactionCount: number;
}

export interface PaymentAccountMovementRow {
  id: string;
  date: string;
  time: string;
  createdAt: string;
  accountId: string;
  accountName: string;
  accountType: string;
  providerName: string;
  branchId: string;
  branchName: string;
  type: string;
  direction: 'IN' | 'OUT';
  reference: string;
  sourceModule: string;
  description: string;
  userName: string;
  moneyIn: number;
  moneyOut: number;
  transfer: number;
  amount: number;
  runningBalance: number;
}

export interface PaymentAccountsReportKPIs {
  totalDebits?: number;
  totalCredits?: number;
  totalOpeningBalance: number;
  totalMoneyIn: number;
  totalMoneyOut: number;
  totalTransfersIn: number;
  totalTransfersOut: number;
  totalClosingBalance: number;
  netMovement: number;
  transactionCount: number;
  accountsCount: number;
}

export interface PaymentAccountsReportQuery {
  branchId?: string;
  accountId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  transactionType?: string;
  direction?: string;
  sourceModule?: string;
  search?: string;
}

export interface PaymentAccountsReport {
  collections?: { collectedRevenue: number; taxCollected: number; tipsCollected: number; actualCollections: number };
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: PaymentAccountsReportKPIs;
  rows: PaymentAccountMovementRow[];
  accountsSummary: PaymentAccountSummaryItem[];
  totals: {
    opening: number;
    moneyIn: number;
    moneyOut: number;
    transferIn: number;
    transferOut: number;
    closing: number;
    netMovement: number;
  };
}




export interface StaffCommissionReport {
  filters: Record<string, string | undefined>;
  dateBasis: string;
  summary: Omit<StaffCommissionReportStaff, 'staffId' | 'staffName' | 'employeeCode'>;
  byStaff: StaffCommissionReportStaff[];
  rows: StaffCommissionReportRow[];
  totals: Omit<StaffCommissionReportStaff, 'staffId' | 'staffName' | 'employeeCode'>;
}

export interface StaffCommissionReportQuery {
  branchId?: string;
  startDate: string;
  endDate: string;
  staffId?: string;
  source?: 'SERVICE' | 'PACKAGE' | 'PRODUCT';
  invoiceNumber?: string;
}
export interface RecordPayrollPaymentInput {
  payrollRunId: string;
  payslipId: string;
  amount: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  reference?: string;
  notes?: string;
}

// Commission Types
export type CommissionRunStatus = 'DRAFT' | 'FINALIZED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface CommissionAttributionLine {
  id: string; // unique attribution ref
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  clientName: string;
  serviceOrPackageId: string;
  serviceOrPackageName: string;
  itemType: 'SERVICE' | 'PACKAGE';
  isPackageComponent: boolean;
  componentPackageName?: string;
  cataloguePrice: number;
  discountAllocation: number;
  netAttributedAmount: number;
  commissionRatePercent: number;
  commissionEarned: number;
}

export interface CommissionPayment {
  id: string;
  paymentNumber: string; // COMPAY-LHE-2026-0001
  commissionRunId: string;
  statementId: string;
  staffId: string;
  staffName: string;
  branchId: string;
  amount: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  onlineAccountName?: string;
  paidAt: string;
  paidByUserId: string;
  paidByName: string;
  reference: string;
  notes?: string;
  status: 'COMPLETED' | 'REVERSED';
  reversedAt?: string;
  reversedByUserId?: string;
  reversedByName?: string;
  reversalReason?: string;
}

export interface CommissionStatementRecord {
  id: string;
  commissionRunId: string;
  statementNumber: string; // CS-LHE-2026-0001
  payrollPayslipId?: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  designation: string;
  branchId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  compensationType: CompensationType;
  commissionRatePercent: number;
  servicesCompletedCount: number;
  attributedNetSales: number;
  grossCommissionEarned: number;
  refundAdjustments: number;
  netCommissionPayable: number;
  paidAmount: number;
  outstandingAmount: number;
  status: CommissionRunStatus;
  lineItems: CommissionAttributionLine[];
  attributionLines?: CommissionAttributionLine[];
  payments: CommissionPayment[];
}

export interface CommissionRun {
  id: string;
  commissionNumber: string; // COM-LHE-2026-0001
  branchId: string;
  branchName?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: CommissionRunStatus;
  totalEligibleNetSales: number;
  totalCommissionPayable: number;
  totalPaid: number;
  totalOutstanding: number;
  staffCount: number;
  statements: CommissionStatementRecord[];
  consumedAttributionLineIds: string[];
  generatedAt: string;
  generatedByUserId: string;
  generatedByName: string;
  finalizedAt?: string;
  finalizedByUserId?: string;
  finalizedByName?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  cancellationReason?: string;
}

export interface RecordCommissionPaymentInput {
  commissionRunId: string;
  statementId: string;
  amount: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  reference?: string;
  notes?: string;
}

// ==========================================
// TIPS COLLECTION, ALLOCATION & PAYOUT TYPES
// ==========================================

export type TipReceiptStatus = 'UNALLOCATED' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED';

export interface TipReceiptRecord {
  id: string; // tip-rec-01 or TR-LHE-2026-0001
  receiptNumber: string; // TR-LHE-2026-0001
  branchId: string;
  branchName: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  collectionDate: string; // YYYY-MM-DD
  collectionTime: string;
  clientName: string;
  method: 'CASH' | 'ONLINE_ACCOUNT';
  paymentAccountId?: string;
  paymentAccountName?: string;
  cashDrawerId?: string;
  collectedByUserId: string;
  collectedByName: string;
  collectedAmount: number;
  directStaffId?: string; // If POS assigned direct staff
  directStaffName?: string;
  allocatedAmount: number;
  unallocatedAmount: number;
  status: TipReceiptStatus;
  createdAt: string;
}

export type TipAllocationType = 'DIRECT' | 'POOLED_EQUAL' | 'POOLED_CUSTOM';
export type TipAllocationStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface TipAllocationRecord {
  id: string; // tip-alloc-01 or TA-LHE-2026-0001
  allocationNumber: string; // TA-LHE-2026-0001
  branchId: string;
  tipReceiptId: string;
  tipReceiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  staffId: string;
  staffName: string;
  staffRole?: string;
  amount: number;
  paidAmount: number;
  outstandingAmount: number;
  allocationType: TipAllocationType;
  allocationDate: string; // YYYY-MM-DD
  allocationTime: string;
  allocatedByUserId: string;
  allocatedByName: string;
  status: TipAllocationStatus;
  cancelledAt?: string;
  cancellationDate?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  cancelReason?: string;
  notes?: string;
}

export type TipPayoutStatus = 'COMPLETED' | 'REVERSED';

export interface TipPayoutRecord {
  id: string; // tip-pay-01 or TP-LHE-2026-0001
  payoutNumber: string; // TP-LHE-2026-0001
  branchId: string;
  staffId: string;
  staffName: string;
  allocationId: string;
  allocationNumber: string;
  tipReceiptId: string;
  amount: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  onlineAccountName?: string;
  collectionMethod: 'CASH' | 'ONLINE_ACCOUNT'; // Source traceability
  collectionPaymentAccountName?: string;
  payoutDate: string; // YYYY-MM-DD
  payoutTime: string;
  paidByUserId: string;
  paidByName: string;
  status: TipPayoutStatus;
  reversalReason?: string;
  reversedAt?: string;
  reversalDate?: string; // YYYY-MM-DD
  reversedByUserId?: string;
  reversedByName?: string;
  reversalReceivingDrawerId?: string;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface AllocateTipsInput {
  tipReceiptId: string;
  allocationType: TipAllocationType;
  recipients: Array<{
    staffId: string;
    amount: number;
  }>;
  notes?: string;
}

export interface RecordTipPayoutInput {
  allocationId: string;
  amount: number;
  method: 'CASH' | 'ONLINE';
  cashDrawerId?: string;
  onlineAccountId?: string;
  idempotencyKey?: string;
  reference?: string;
  notes?: string;
}

export interface ReverseTipPayoutInput {
  payoutId: string;
  reversalReason: string;
  receivingDrawerId?: string; // Explicit eligible drawer if original drawer is closed
}

// ==========================================
// STAFF PERFORMANCE & DRILL-DOWN TYPES
// ==========================================

export interface StaffPerformanceServiceItem {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  time?: string;
  clientName: string;
  itemId: string;
  serviceName: string;
  itemType: 'SERVICE' | 'PACKAGE_COMPONENT';
  quantity?: number;
  cataloguePrice: number;
  discountAllocated: number;
  netSales: number;
  commissionRatePercent: number;
  commissionEarned: number;
}

export interface StaffPerformanceRecord {
  invoicedSales?: number;
  collectedSales?: number;
  staffId: string;
  staffName: string;
  staffCode: string;
  roleTitle: string;
  branchId: string;
  branchName: string;
  directServicesCount: number;
  packageComponentsCount: number;
  totalServiceUnits: number;
  uniqueClientsCount: number;
  attributedGrossSales: number;
  discountAllocation: number;
  attributedNetSales: number;
  estimatedCommission: number;
  finalizedCommission: number;
  paidCommission: number;
  allocatedTips: number;
  paidTips: number;
  outstandingTips: number;
  workedHours: number;
  presentDays: number;
  latePunchesCount: number;
  approvedOvertimeMinutes: number;
  approvedOvertimePay: number;
  detailedServices: StaffPerformanceServiceItem[];
}

export interface TipsStatementSummary {
  /** TIP_COLLECTIONS = branch liability; STAFF_ALLOCATIONS = one staff member's allocated-unpaid liability. */
  liabilityBasis?: 'TIP_COLLECTIONS' | 'STAFF_ALLOCATIONS';
  variance?: number;
  openingLiability: number;
  netTipsCollected: number;
  netPayouts: number;
  closingLiability: number;
  unallocatedTips: number;
  allocatedUnpaidTips: number;
  receiptsCount: number;
  allocationsCount: number;
  payoutsCount: number;
}

export interface OnlineAccountBreakdownItem {
  accountId?: string;
  accountName: string;
  accountType?: string;
  providerName?: string;
  amount: number;
  count?: number;
}

export interface TenderBreakdown {
  totalCash: number;
  totalOnline: number;
  grandTotal: number;
  onlineAccounts: OnlineAccountBreakdownItem[];
}

export interface CashDrawerReportKPIs {
  totalOpeningBalance?: number;
  totalSessions: number;
  openSessionsCount: number;
  settledSessionsCount: number;
  pendingSessionsCount: number;
  totalOpeningFloat: number;
  totalCashSales: number;
  totalDuesCollected: number;
  totalCashTips: number;
  totalCashIn: number;
  totalCashRefunds: number;
  totalCashExpenses: number;
  totalSettlementsOut: number;
  totalCashOut: number;
  totalExpectedCash: number;
  totalCountedCash: number;
  totalVariance: number;
  totalPhysicalCashCollected: number;
  totalOnlineCollected: number;
  grandTotalCollections: number;
}

export interface CashDrawerReportRow {
  openingBalance?: number;
  id: string;
  sessionCode: string;
  branchId: string;
  branchName: string;
  kind: string;
  custodianUserId: string | null;
  custodianName: string;
  date: string;
  openedAt: string;
  closedAt: string | null;
  status: 'OPEN' | 'SETTLEMENT_PENDING' | 'SETTLED';
  openingFloat: number;
  cashSales: number;
  duesCollected: number;
  cashTips: number;
  otherCashIn: number;
  totalCashIn: number;
  cashRefunds: number;
  cashExpenses: number;
  settlementsOut: number;
  otherCashOut: number;
  totalCashOut: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
  onlineTotal: number;
  onlineBreakdown: { accountName: string; amount: number }[];
  latestSettlement?: {
    id: string;
    status: string;
    handoverAmount: number;
    retainedFloat: number;
    reviewedByName?: string;
  } | null;
  movementCount: number;
}

export interface CashDrawerReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  custodianUserId?: string;
  status?: string;
  search?: string;
}

export interface CashDrawerReport {
  collections?: { collectedRevenue: number; taxCollected: number; tipsCollected: number; actualCollections: number };
  transactions?: Array<{ id: string; drawerId: string; date: string; time: string; reference?: string; type: string; direction: 'IN' | 'OUT'; amount: number; actor: string; description?: string }>;
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: CashDrawerReportKPIs;
  tenderBreakdown: TenderBreakdown;
  rows: CashDrawerReportRow[];
  totals: {
    openingFloat: number;
    cashSales: number;
    cashIn: number;
    cashRefunds: number;
    cashExpenses: number;
    settlementsOut: number;
    cashOut: number;
    expectedCash: number;
    countedCash: number;
    variance: number;
    onlineTotal: number;
  };
}

export interface DetailedExpenseCategoryItem {
  categoryName: string;
  amount: number;
}

export interface DetailedExpensesReportKPIs {
  nonOperatingCashOutflow?: number;
  totalCashOutflow?: number;
  unpaidSalaries?: number;
  unpaidCommissions?: number;
  paidSalaries?: number;
  paidCommissions?: number;
  totalExpenses: number;
  cashExpenses: number;
  onlineExpenses: number;
  totalVouchersCount: number;
  postedCount: number;
  reversedCount: number;
  draftCount: number;
  categoryCount: number;
}

export interface DetailedExpenseRow {
  id: string;
  voucherNumber: string;
  date: string;
  time: string;
  branchId: string;
  branchName: string;
  category: string;
  title: string;
  payee: string;
  description: string;
  amount: number;
  paymentSource: 'CASH_DRAWER' | 'ONLINE_ACCOUNT' | string;
  paymentAccountId?: string | null;
  paymentAccountName?: string | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  externalReference: string;
  notes: string;
  createdByUserId: string;
  createdByName: string;
  paidByName: string;
  isReversalRecord: boolean;
  reversalReason: string;
  reversedByName: string;
}

export interface DetailedExpensesReportQuery {
  branchId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  category?: string;
  status?: string;
  paymentSource?: string;
  paymentAccountId?: string;
  createdByUserId?: string;
  search?: string;
}

export interface DetailedExpensesReport {
  liabilities?: { unpaidSalaries: number; unpaidCommissions: number };
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: DetailedExpensesReportKPIs;
  tenderBreakdown: TenderBreakdown;
  categoryBreakdown: DetailedExpenseCategoryItem[];
  categories: string[];
  rows: DetailedExpenseRow[];
  totals: {
    amount: number;
    cash: number;
    online: number;
  };
}

export type InventorySubReportType = 'valuation' | 'movements' | 'purchases' | 'supplier-ledger' | 'consumption' | 'expiry' | 'summary';

export interface InventoryReportQuery {
  branchId?: string;
  type?: InventorySubReportType;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  supplierId?: string;
  itemId?: string;
  categoryId?: string;
  itemType?: string;
  movementType?: string;
  search?: string;
}

export interface InventoryValuationRow {
  id: string;
  batchId: string;
  batchNumber: string;
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  itemType: string;
  branchId: string;
  branchName: string;
  supplierName: string;
  receivedDate: string;
  expiryDate: string | null;
  remainingQuantity: number;
  unitCost: number;
  costValue: number;
  sellingPrice: number;
  retailValue: number;
  potentialProfit: number;
  potentialMargin: number;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  expiryStatus: 'VALID' | 'NEAR_EXPIRY' | 'EXPIRED';
}

export interface InventoryMovementRow {
  id: string;
  movementNumber: string;
  date: string;
  time: string;
  createdAt: string;
  branchId: string;
  branchName: string;
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  batchNumber: string;
  movementType: string;
  direction: 'IN' | 'OUT';
  quantity: number;
  unitCost: number;
  totalCost: number;
  sourceReferenceType: string;
  sourceReferenceNumber: string;
  reason: string;
  notes: string;
  userName: string;
}

export interface InventoryPurchaseRow {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  branchId: string;
  branchName: string;
  linesCount: number;
  totalQuantity: number;
  subtotal: number;
  discount: number;
  netAmount: number;
  paidAmount: number;
  balanceDue: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentAccountName: string | null;
  createdByName: string;
  status: string;
}

export interface InventorySupplierLedgerRow {
  id: string;
  date: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  entryType: string;
  referenceType: string;
  referenceNumber: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  userName: string;
}

export interface InventoryConsumptionRow {
  id: string;
  movementNumber: string;
  date: string;
  time: string;
  branchId: string;
  branchName: string;
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  batchNumber: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reason: string;
  notes: string;
  sourceReferenceNumber: string;
  userName: string;
}

export interface InventoryExpiryRow {
  id: string;
  batchNumber: string;
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  branchId: string;
  branchName: string;
  supplierName: string;
  receivedDate: string;
  expiryDate: string;
  daysRemaining: number;
  remainingQuantity: number;
  unitCost: number;
  costAtRisk: number;
  status: 'EXPIRED' | 'CRITICAL' | 'NEAR_EXPIRY' | 'VALID';
}

export interface InventoryReportData {
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  type: InventorySubReportType;
  kpis: Record<string, any>;
  tenderBreakdown?: TenderBreakdown;
  categoryBreakdown?: Array<{ categoryName: string; amount: number }>;
  categories?: string[];
  suppliers?: Array<{ id: string; name: string; code: string }>;
  rows: any[];
  totals: Record<string, any>;
}

export interface AttendanceOvertimeReportRow {
  id: string;
  date: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  designation: string;
  branchId: string;
  branchName: string;
  shift: string;
  checkIn: string;
  checkOut: string;
  scheduledHours: number;
  workedHours: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  isLate: boolean;
  status: string;
  source: string;
  otMinutes: number;
  otHours: number;
  otAmount: number;
  otStatus: string;
  otReason: string;
  otApprovedBy: string;
  notes: string;
}

export interface AttendanceOvertimeReportKPIs {
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  lateCount: number;
  totalWorkedHours: number;
  authorizedOtHours: number;
  authorizedOtAmount: number;
}

export interface AttendanceOvertimeReportTotals {
  scheduledHours: number;
  workedHours: number;
  lateMinutes: number;
  otMinutes: number;
  otHours: number;
  otAmount: number;
}

export interface AttendanceOvertimeReportQuery {
  branchId?: string;
  staffId?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  status?: string;
  otStatus?: string;
  search?: string;
}

export interface AttendanceOvertimeReport {
  meta: {
    branchId: string;
    branchName: string;
    from: string;
    to: string;
    preset: string;
    dateBasis: string;
    timezone: string;
    generatedAt: string;
    generatedBy: string;
  };
  kpis: AttendanceOvertimeReportKPIs;
  rows: AttendanceOvertimeReportRow[];
  totals: AttendanceOvertimeReportTotals;
}

export * from './devices';
