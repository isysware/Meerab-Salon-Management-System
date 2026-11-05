// src/modules/inventory/inventory.schema.js

import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine((value) => { const date = new Date(value + 'T00:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Date must be a valid calendar date.');
const optYmd = ymd.optional().or(z.literal('').transform(() => undefined));
const positive = (label) => z.number({ message: `${label} must be a number.` }).positive(`${label} must be a positive number.`);
const nonNeg = (label) => z.number({ message: `${label} must be a number.` }).min(0, `${label} must be non-negative.`);

export const itemType = z.enum(['RETAIL_PRODUCT', 'SALON_CONSUMABLE', 'BOTH']);

const itemFields = {
  sku:                 z.string().trim().optional().transform((s) => (s ? s.toUpperCase() : undefined)),
  barcode:             z.string().trim().optional(),
  name:                z.string().trim().min(1, 'Item name is required.'),
  category:            z.string().trim().min(1).default('General'),
  description:         z.string().trim().optional(),
  brand:               z.string().trim().optional(),
  imageUrl:            z.string().trim().optional(),
  itemType,
  defaultPurchaseCost: nonNeg('Default purchase cost').default(0),
  sellingPrice:        nonNeg('Selling price').default(0),
  purchaseUnit:        z.string().trim().default('PIECE'),
  issueUnit:           z.string().trim().default('PIECE'),
  unitConversionRatio: z.number().positive().nullable().optional(),
  taxTreatment:        z.enum(['BRANCH_DEFAULT', 'SPECIFIC_RULE', 'EXEMPT']).default('BRANCH_DEFAULT'),
  specificTaxRuleId:   z.string().nullable().optional(),
  minStockLevel:       nonNeg('Minimum stock level').default(0),
  trackBatch:          z.boolean().default(true),
  trackExpiry:         z.boolean().default(false),
  nearExpiryAlertDays: z.number().int().min(0).default(60),
  isActive:            z.boolean().optional(),
  branchAvailability:  z.array(z.string()).default(['ALL']),
  openingStock:        nonNeg('Opening stock').optional().default(0),
  openingQuantity:     nonNeg('Opening quantity').optional().default(0),
  openingCost:         nonNeg('Opening cost').optional(),
  branchId:            z.string().optional(),
  supplierId:          z.string().optional(),
};

export const createItemSchema = z.object(itemFields).passthrough();
export const updateItemSchema = z.object(
  Object.fromEntries(Object.entries(itemFields).map(([k, v]) => [k, (v._def?.innerType ?? v).optional()]))
).passthrough();

export const itemsQuery = z.object({
  branchId: z.string().optional(), itemType: itemType.optional(), category: z.string().optional(),
  search: z.string().optional(), isActive: z.enum(['true', 'false']).optional(),
});

export const branchQuery = z.object({ branchId: z.string().optional() }).passthrough();
export const batchesQuery = z.object({ branchId: z.string().optional(), itemId: z.string().optional() });
export const archiveSchema = z.object({ isActive: z.boolean() });
export const quarantineSchema = z.object({ reason: z.string().trim().min(1, 'A quarantine reason is required.') });

const supplierFields = {
  name:          z.string().trim().min(1, 'Supplier name is required.'),
  companyName:   z.string().trim().optional(),
  phone:         z.string().trim().min(1, 'Supplier phone number is required.'),
  email:         z.string().trim().optional(),
  contactPerson: z.string().trim().optional(),
  address:       z.string().trim().optional(),
  taxNumber:     z.string().trim().optional(),
  notes:         z.string().trim().optional(),
};

export const createSupplierSchema = z.object({
  ...supplierFields, branchId: z.string().optional(), openingPayable: nonNeg('Opening payable').optional(),
}).passthrough();

export const updateSupplierSchema = z.object({
  ...Object.fromEntries(Object.entries(supplierFields).map(([k, v]) => [k, v.optional()])),
  isActive: z.boolean().optional(),
}).passthrough();

export const suppliersQuery = z.object({ branchId: z.string().optional(), search: z.string().optional() });
export const ledgerQuery = z.object({ branchId: z.string().optional(), startDate: optYmd, endDate: optYmd });

export const paySupplierSchema = z.object({
  branchId:         z.string().optional(),
  amount:           positive('Payment amount'),
  paymentDate:      ymd,
  method:           z.enum(['CASH', 'ONLINE']).optional(),
  paymentMethod:    z.enum(['CASH', 'ONLINE', 'ONLINE_ACCOUNT']).optional(),
  paymentAccountId: z.string().optional(),
  reference:        z.string().trim().optional(),
  notes:            z.string().trim().optional(),
}).passthrough().refine((v) => !!(v.method || v.paymentMethod), { message: 'Cash or Online payment method is required.' });

export const reversePaymentSchema = z.object({ reason: z.string().trim().min(3), reversalDate: ymd });

export const createPurchaseSchema = z.object({
  branchId:              z.string().optional(),
  supplierId:            z.string().min(1, 'Supplier is required.'),
  purchaseDate:          optYmd,
  supplierInvoiceNumber: z.string().trim().optional(),
  supplierInvoiceNo:     z.string().trim().optional(),
  invoiceNumber:         z.string().trim().optional(),
  notes:                 z.string().trim().optional(),
  discount:              nonNeg('Discount').optional(),
  paymentMethod:         z.enum(['CASH', 'ONLINE', 'CREDIT', 'PARTIAL']),
  paidAmount:            nonNeg('Paid amount').optional(),
  partialPaidAmount:     nonNeg('Paid amount').optional(),
  paymentAccountId:      z.string().optional(),
  lines: z.array(z.object({
    itemId:           z.string().min(1),
    quantity:         positive('Quantity'),
    unitPurchaseCost: nonNeg('Unit purchase cost').optional(),
    unitCost:         nonNeg('Unit purchase cost').optional(),
    sellingPrice:     nonNeg('Selling price').optional(),
    lineDiscount:     nonNeg('Line discount').optional(),
    batchNumber:      z.string().trim().optional(),
    expiryDate:       optYmd,
    mfgDate:          optYmd,
  }).refine((l) => l.unitPurchaseCost !== undefined || l.unitCost !== undefined, { message: 'Unit purchase cost is required.' }))
    .min(1, 'A purchase must contain at least one line item.'),
}).passthrough();

export const purchasesQuery = z.object({ branchId: z.string().optional(), startDate: optYmd, endDate: optYmd });

export const createReturnSchema = z.object({
  branchId:           z.string().optional(),
  supplierId:         z.string().min(1),
  purchaseId:         z.string().optional(),
  originalPurchaseId: z.string().optional(),
  returnDate:         optYmd,
  reason:             z.string().trim().min(1, 'A return reason is required.'),
  notes:              z.string().trim().optional(),
  refundTreatment:    z.enum(['REDUCE_PAYABLE', 'SUPPLIER_CREDIT', 'CASH_REFUND', 'ONLINE_REFUND']).optional(),
  paymentAccountId:   z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1), batchId: z.string().optional(), batchNumber: z.string().optional(),
    quantity: positive('Quantity'), unitCost: nonNeg('Unit cost').optional(),
  })).min(1, 'A supplier return must include at least one item line.'),
}).passthrough();

export const movementsQuery = z.object({
  branchId: z.string().optional(), itemId: z.string().optional(), type: z.string().optional(),
  direction: z.enum(['IN', 'OUT']).optional(), startDate: optYmd, endDate: optYmd, search: z.string().optional(),
});

export const stockOutSchema = z.object({
  branchId:             z.string().optional(),
  itemId:               z.string().min(1),
  batchId:              z.string().optional(),
  quantity:             positive('Stock out quantity'),
  reasonType:           z.string().optional(),
  department:           z.string().optional(),
  responsibleStaffId:   z.string().optional(),
  responsibleStaffName: z.string().optional(),
  reason:               z.string().trim().min(1, 'A stock-out reason is required.'),
  notes:                z.string().trim().optional(),
});

export const consumptionPreviewQuery = z.object({
  branchId:   z.string().optional(),
  itemId:     z.string().min(1, 'Item ID is required.'),
  quantity:   positive('Quantity'),
  batchId:    z.string().optional(),
  reasonType: z.string().optional(),
});

export const reverseStockMovementSchema = z.object({
  reason: z.string().trim().min(3, 'Reversal reason must be at least 3 characters.'),
});

export const stockSettlementSchema = z.object({
  branchId:  z.string().optional(),
  countDate: optYmd,
  notes:     z.string().trim().optional(),
  lines: z.array(z.object({
    itemId:          z.string().min(1),
    batchId:         z.string().optional(),
    systemQuantity:  z.number().optional(),
    countedQuantity: nonNeg('Counted quantity'),
    reason:          z.enum(['DAMAGE', 'MISSING', 'UNRECORDED_CONSUMPTION', 'COUNTING_CORRECTION', 'EXPIRED', 'OTHER']).optional(),
    notes:           z.string().trim().optional(),
  })).min(1, 'Stock settlement requires at least one item line to reconcile.'),
});

export const cogsQuery = z.object({ branchId: z.string().optional(), startDate: optYmd, endDate: optYmd });
