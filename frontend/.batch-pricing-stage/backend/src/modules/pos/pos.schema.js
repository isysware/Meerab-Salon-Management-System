// src/modules/pos/pos.schema.js

import { z } from 'zod';
import { customerSource } from '../clients/clients.schema.js';
import { updateSchema as bookingUpdateSchema } from '../bookings/bookings.schema.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine((value) => { const date = new Date(value + 'T00:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Date must be a valid calendar date.');
const money = z.number({ message: 'Amounts must be numbers.' }).finite();

const payment = z.object({
  method:             z.enum(['CASH', 'ONLINE_ACCOUNT']),
  paymentAccountId:   z.string().optional(),
  paymentAccountName: z.string().optional(),
  amount:             money,
  billAllocation:     money,
  tipAllocation:      money.default(0),
  cashTendered:       money.optional(),
  changeReturned:     money.optional(),
});

const cartItem = z.object({
  cartInstanceId: z.string().optional(),
  type:           z.enum(['SERVICE', 'PACKAGE', 'PRODUCT']),
  item:           z.object({ id: z.string().min(1), name: z.string().optional(), price: z.number().optional(), sellingPrice: z.number().optional(), batchQuote: z.array(z.object({ batchId: z.string().min(1), quantity: z.number().finite().positive(), sellingPrice: money.min(0) })).optional() }).passthrough(),
  quantity:       z.number(),
  staffId:        z.string().optional().nullable().default('house'),
  staffName:      z.string().optional().nullable(),
  assignedStaff:  z.array(z.object({ staffId: z.string().optional().nullable(), staffName: z.string().optional(), staffCommissionRate: z.number().optional(), allocatedAmount: z.number().optional() }).passthrough()).optional(),
  packageComponents: z.array(z.object({ serviceId: z.string(), staffId: z.string().optional().nullable() }).passthrough()).optional(),
}).passthrough();

export const checkoutSchema = z.object({
  bookingId: z.string().optional(),
  bookingRevision: z.number().int().positive().optional(),
  bookingUpdate: bookingUpdateSchema.optional(),
  branchId:              z.string().optional(),
  appointmentId:         z.string().optional(),
  clientId:              z.string().optional(),
  clientName:            z.string().optional().default(''),
  clientPhone:           z.string().optional().default(''),
  customerSource:        customerSource.optional(),
  customerSourceDetails: z.string().optional(),
  discountType:          z.enum(['FIXED', 'PERCENTAGE']).default('FIXED'),
  discountValue:         money.min(0).default(0),
  tip:                   money.min(0).default(0),
  applyTax:              z.boolean().optional().default(true),
  cartItems:             z.array(cartItem).default([]),
  payments:              z.array(payment).default([]),
  idempotencyKey:        z.string().optional(),
  notes:                 z.string().optional(),
}).passthrough();

export const reverseCollectionSchema = z.object({ reason: z.string().trim().min(3), reversalDate: ymd });

export const collectSchema = z.object({
  paymentDate: ymd.optional(),
  payments:       z.array(payment).min(1, 'No payment amount provided.'),
  idempotencyKey: z.string().optional(),
  notes:          z.string().optional(),
});

export const refundSchema = z.object({
  type:             z.enum(['REFUND', 'VOID']).default('REFUND'),
  reason:           z.string().trim().min(3, 'A refund/void reason is required.'),
  refundMethod:     z.enum(['CASH', 'ONLINE_ACCOUNT']).optional(),
  paymentAccountId: z.string().optional(),
  lines: z.array(z.object({
    lineId:   z.string(),
    quantity: z.number().positive(),
    restock:  z.enum(['RESALABLE', 'DAMAGED', 'NONE']).optional(),
  })).optional(),
});

export const listQuery = z.object({
  branchId:  z.string().optional(),
  status:    z.enum(['PAID', 'UNPAID', 'PARTIAL']).optional(),
  date:      ymd.optional(),
  startDate: ymd.optional(),
  endDate:   ymd.optional(),
  clientId:  z.string().optional(),
  soldByUserId: z.string().optional(),
  processedByUserId: z.string().optional(),
});

export const outstandingQuery = z.object({
  branchId:        z.string().optional(),
  clientIdOrPhone: z.string().min(1),
});
