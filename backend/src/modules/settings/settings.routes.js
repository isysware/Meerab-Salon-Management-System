// src/modules/settings/settings.routes.js
// Exports one router per resource; each is mounted in src/routes.js.

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as v from './settings.schema.js';
import * as c from './settings.controller.js';

const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const BACK_OFFICE = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STAFF'];

// ── /tax-rules ───────────────────────────────────────────────────────────────
export const taxRuleRoutes = Router();
taxRuleRoutes.use(authenticate);
taxRuleRoutes.get('/options', authorize(...BACK_OFFICE), validate(v.branchQuery, 'query'), c.listTaxRules);
taxRuleRoutes.use(authorize('SUPER_ADMIN'));
taxRuleRoutes.get('/', authorize(...BACK_OFFICE), validate(v.branchQuery, 'query'), c.listTaxRules);
taxRuleRoutes.post('/', authorize(...ADMINS), validate(v.createTaxRuleSchema), c.createTaxRule);
taxRuleRoutes.post('/branch-default', authorize(...ADMINS), validate(v.setDefaultTaxRuleSchema), c.setDefaultTaxRule);
taxRuleRoutes.put('/:id', authorize(...ADMINS), validate(v.updateTaxRuleSchema), c.updateTaxRule);
taxRuleRoutes.post('/:id/toggle', authorize(...ADMINS), c.toggleTaxRule);

// ── /payment-accounts ────────────────────────────────────────────────────────
export const paymentAccountRoutes = Router();
paymentAccountRoutes.use(authenticate);
paymentAccountRoutes.get('/options', authorize(...BACK_OFFICE), validate(v.branchQuery, 'query'), c.listPaymentAccounts);
paymentAccountRoutes.use(authorize('SUPER_ADMIN'));
paymentAccountRoutes.get('/', authorize(...BACK_OFFICE), validate(v.branchQuery, 'query'), c.listPaymentAccounts);
paymentAccountRoutes.post('/', authorize(...ADMINS), validate(v.createPaymentAccountSchema), c.createPaymentAccount);
paymentAccountRoutes.put('/:id', authorize(...ADMINS), validate(v.updatePaymentAccountSchema), c.updatePaymentAccount);
paymentAccountRoutes.post('/:id/toggle', authorize(...ADMINS), c.togglePaymentAccount);
paymentAccountRoutes.delete('/:id', authorize(...ADMINS), c.deletePaymentAccount);

// ── /online-accounts (legacy read-only view of payment accounts) ─────────────
export const onlineAccountRoutes = Router();
onlineAccountRoutes.use(authenticate);
onlineAccountRoutes.get('/', authorize(...BACK_OFFICE), validate(v.branchQuery, 'query'), c.listOnlineAccounts);

// ── /expense-categories ──────────────────────────────────────────────────────
export const expenseCategoryRoutes = Router();
expenseCategoryRoutes.use(authenticate);
expenseCategoryRoutes.get('/', authorize(...BACK_OFFICE), validate(v.branchQuery, 'query'), c.listExpenseCategories);
expenseCategoryRoutes.post('/', authorize(...ADMINS), validate(v.createExpenseCategorySchema), c.createExpenseCategory);
expenseCategoryRoutes.put('/:id', authorize(...ADMINS), validate(v.updateExpenseCategorySchema), c.updateExpenseCategory);
expenseCategoryRoutes.post('/:id/toggle', authorize(...ADMINS), c.toggleExpenseCategory);

// ── /payroll-policy (Accountant excluded) ────────────────────────────────────
export const payrollPolicyRoutes = Router();
payrollPolicyRoutes.use(authenticate, authorize(...ADMINS));
payrollPolicyRoutes.get('/', validate(v.branchQuery, 'query'), c.getPayrollPolicy);
payrollPolicyRoutes.put('/', validate(v.updatePayrollPolicySchema), c.updatePayrollPolicy);

// ── /attendance-policy (Accountant excluded) ─────────────────────────────────
export const attendancePolicyRoutes = Router();
attendancePolicyRoutes.use(authenticate, authorize(...ADMINS));
attendancePolicyRoutes.get('/', c.getAttendancePolicy);
attendancePolicyRoutes.put('/', c.updateAttendancePolicy);

// ── /system/date (business date used as "today") ────────────────────────────
export const systemRoutes = Router();
systemRoutes.use(authenticate);
systemRoutes.get('/date', c.getSystemDate);
systemRoutes.put('/date', authorize(...ADMINS), validate(v.systemDateSchema), c.setSystemDate);
systemRoutes.delete('/date', authorize(...ADMINS), c.clearSystemDate);
systemRoutes.post('/reset-test-data', authorize(...ADMINS), validate(v.resetTestDataSchema), c.resetTestData);

