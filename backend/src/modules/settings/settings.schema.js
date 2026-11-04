// src/modules/settings/settings.schema.js

import { z } from 'zod';

const rate = z.number({ message: 'Tax rate must be a number' })
  .min(0, 'Tax rate must be between 0 and 1 (e.g. 0.16 for 16% or 0.125 for 12.5%).')
  .max(1, 'Tax rate must be between 0 and 1 (e.g. 0.16 for 16% or 0.125 for 12.5%).');

export const branchQuery = z.object({ branchId: z.string().optional() }).passthrough();

// ── Tax rules ────────────────────────────────────────────────────────────────
export const createTaxRuleSchema = z.object({
  branchIds: z.array(z.string().trim().min(1)).min(1).optional(),
  branchId:        z.string().optional(),
  name:            z.string().trim().min(1, 'Tax rule name is required.'),
  rate,
  description:     z.string().trim().optional(),
  isActive:        z.boolean().optional(),
  isBranchDefault: z.boolean().optional(),
});

export const updateTaxRuleSchema = z.object({
  branchIds: z.array(z.string().trim().min(1)).min(1).optional(),
  name:            z.string().trim().min(1).optional(),
  rate:            rate.optional(),
  description:     z.string().trim().nullable().optional(),
  isActive:        z.boolean().optional(),
  isBranchDefault: z.boolean().optional(),
}).passthrough();

export const setDefaultTaxRuleSchema = z.object({
  branchId: z.string().optional(),
  ruleId:   z.string().nullable(),
});

// ── Payment accounts ─────────────────────────────────────────────────────────
const accountType = z.enum(['BANK', 'EASYPAISA', 'JAZZCASH', 'OTHER']);

export const createPaymentAccountSchema = z.object({
  branchIds: z.array(z.string().trim().min(1)).min(1).optional(),
  branchId:          z.string().optional(),
  name:              z.string().trim().min(1, 'Account display name is required.'),
  accountType:       accountType.default('BANK'),
  providerName:      z.string().trim().min(1, 'Provider / bank name is required.'),
  accountHolder:     z.string().trim().min(1, 'Account holder name is required.'),
  accountIdentifier: z.string().trim().optional(),
  isActive:          z.boolean().optional(),
});

// Balance is never editable directly — only operational postings change it.
export const updatePaymentAccountSchema = z.object({
  branchIds: z.array(z.string().trim().min(1)).min(1).optional(),
  name:              z.string().trim().min(1).optional(),
  accountType:       accountType.optional(),
  providerName:      z.string().trim().min(1).optional(),
  accountHolder:     z.string().trim().min(1).optional(),
  accountIdentifier: z.string().trim().nullable().optional(),
  isActive:          z.boolean().optional(),
}).passthrough();

// ── Expense categories ───────────────────────────────────────────────────────
export const createExpenseCategorySchema = z.object({
  branchId:    z.string().optional(),
  name:        z.string().trim().min(1, 'Expense category name is required.'),
  description: z.string().trim().optional(),
});

export const updateExpenseCategorySchema = z.object({
  name:        z.string().trim().min(1, 'Category name cannot be empty.').optional(),
  description: z.string().trim().optional(),
  isActive:    z.boolean().optional(),
}).passthrough();

// ── Payroll policy ───────────────────────────────────────────────────────────
export const updatePayrollPolicySchema = z.object({
  branchId:                       z.string().optional(),
  monthlyAbsenceDivisor:          z.union([z.literal(26), z.literal(30), z.literal('CALENDAR_DAYS'), z.literal('WORKING_DAYS')]).optional(),
  customDivisorDays:              z.number().positive('Custom divisor days must be a positive number.').optional(),
  dailyStaffPaidLeaveEligibility: z.boolean().optional(),
  nonWorkedWeeklyOffPaid:         z.boolean().optional(),
  nonWorkedHolidayPaid:           z.boolean().optional(),
  prorationMethod:                z.enum(['CALENDAR_DAYS', 'WORKING_DAYS']).optional(),
}).passthrough();

// ── System (business) date ───────────────────────────────────────────────────
export const systemDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),
});

// ── Test Data Reset ──────────────────────────────────────────────────────────
export const resetTestDataSchema = z.object({
  branchId: z.string().optional(),
  wipeCatalogue: z.boolean().optional(),
  wipeInventory: z.boolean().optional(),
  wipeClients: z.boolean().optional(),
  wipeStaff: z.boolean().optional(),
  wipeSuppliers: z.boolean().optional(),
}).optional();

