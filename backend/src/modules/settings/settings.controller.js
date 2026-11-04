// src/modules/settings/settings.controller.js

import * as s from './settings.service.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const send = (fn, status = 200) => asyncHandler(async (req, res) => {
  res.status(status).json({ data: await fn(req) });
});

// Tax rules
export const listTaxRules     = send((req) => s.listTaxRules(req.user, req.query.branchId));
export const createTaxRule    = send((req) => s.createTaxRule(req.body, req.user), 201);
export const updateTaxRule    = send((req) => s.updateTaxRule(req.params.id, req.body, req.user));
export const toggleTaxRule    = send((req) => s.toggleTaxRule(req.params.id, req.user));
export const setDefaultTaxRule = send((req) => s.setBranchDefaultTaxRule(req.body, req.user));

// Payment accounts
export const listPaymentAccounts  = send((req) => s.listPaymentAccounts(req.user, req.query.branchId));
export const listOnlineAccounts   = send((req) => s.listOnlineAccounts(req.user, req.query.branchId));
export const createPaymentAccount = send((req) => s.createPaymentAccount(req.body, req.user), 201);
export const updatePaymentAccount = send((req) => s.updatePaymentAccount(req.params.id, req.body, req.user));
export const togglePaymentAccount = send((req) => s.togglePaymentAccount(req.params.id, req.user));
export const deletePaymentAccount = send((req) => s.deletePaymentAccount(req.params.id, req.user));

// Expense categories
export const listExpenseCategories  = send((req) => s.listExpenseCategories(req.user, req.query.branchId));
export const createExpenseCategory  = send((req) => s.createExpenseCategory(req.body, req.user), 201);
export const updateExpenseCategory  = send((req) => s.updateExpenseCategory(req.params.id, req.body, req.user));
export const toggleExpenseCategory  = send((req) => s.toggleExpenseCategory(req.params.id, req.user));

// Payroll policy
export const getPayrollPolicy    = send((req) => s.getPayrollPolicy(req.user, req.query.branchId));
export const updatePayrollPolicy = send((req) => s.updatePayrollPolicy(req.body, req.user));

// Attendance policy
export const getAttendancePolicy    = send((req) => s.getAttendancePolicy(req.user, req.query.branchId));
export const updateAttendancePolicy = send((req) => s.updateAttendancePolicy(req.body, req.user));

// System date
export const getSystemDate   = send(async () => s.getSystemDateInfo());
export const setSystemDate   = send(async (req) => {
  await s.setSystemDate(req.body?.date, req.user);
  return s.getSystemDateInfo();
});
export const clearSystemDate = send(async (req) => {
  await s.clearSystemDate(req.user);
  return s.getSystemDateInfo();
});

// Test data reset
export const resetTestData = send((req) => s.resetTestData(req.body, req.user));

