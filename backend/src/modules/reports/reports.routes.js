// src/modules/reports/reports.routes.js — role dashboards + operational reports (read-only).

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import * as d from '../dashboard/dashboard.service.js';
import * as r from './reports.service.js';
import * as sp from './staffPay.report.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const send = (fn) => asyncHandler(async (req, res) => res.status(200).json({ data: await fn(req) }));
const branchQuery = z.object({ branchId: z.string().optional() });

// ── /dashboard ───────────────────────────────────────────────────────────────
export const dashboardRoutes = Router();
dashboardRoutes.use(authenticate);
dashboardRoutes.get('/super-admin', authorize('SUPER_ADMIN'), validate(branchQuery, 'query'), send((req) => d.superAdminDashboard(req.user, req.query)));
dashboardRoutes.get('/admin', authorize('SUPER_ADMIN', 'ADMIN'), validate(branchQuery, 'query'), send((req) => d.adminDashboard(req.user, req.query)));
dashboardRoutes.get('/accountant', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), validate(branchQuery, 'query'), send((req) => d.accountantDashboard(req.user, req.query)));
dashboardRoutes.get('/staff', authorize('STAFF'), send((req) => d.staffDashboard(req.user)));

// ── /reports ─────────────────────────────────────────────────────────────────
const appointmentQuery = z.object({
  branchId: z.string().optional(), startDate: ymd, endDate: ymd,
  status: z.string().optional(), staffId: z.string().optional(), serviceId: z.string().optional(), packageId: z.string().optional(),
  customerSource: z.string().optional(), billingStatus: z.string().optional(), search: z.string().optional(),
});
const performanceQuery = z.object({
  branchId: z.string().optional(), startDate: ymd, endDate: ymd,
  staffId: z.string().optional(), categoryId: z.string().optional(), serviceId: z.string().optional(), packageId: z.string().optional(),
});
const personalQuery = z.object({ startDate: ymd.optional(), endDate: ymd.optional() });

export const reportRoutes = Router();
reportRoutes.use(authenticate);
reportRoutes.get('/staff-performance/me', authorize('STAFF'), validate(personalQuery, 'query'), send((req) => r.personalPerformance(req.user, req.query)));
reportRoutes.get('/appointments', authorize('SUPER_ADMIN', 'ADMIN'), validate(appointmentQuery, 'query'), send((req) => r.appointmentReport(req.user, req.query)));
reportRoutes.get('/staff-performance', authorize('SUPER_ADMIN', 'ADMIN'), validate(performanceQuery, 'query'), send((req) => r.staffPerformance(req.user, req.query)));
const ym = z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM');
const salaryQuery = z.object({
  branchId: z.string().optional(), month: ym.optional(), fromMonth: ym.optional(), toMonth: ym.optional(), staffId: z.string().optional(),
  designation: z.string().optional(), paymentStatus: z.enum(['FINALIZED', 'PARTIALLY_PAID', 'PAID', 'ALL']).optional(), paymentMethod: z.enum(['CASH', 'ONLINE', 'ALL']).optional(),
}).refine((q) => q.month || q.fromMonth, { message: 'Provide month or fromMonth/toMonth.' });
const commissionQuery = z.object({
  branchId: z.string().optional(), startDate: ymd, endDate: ymd, staffId: z.string().optional(),
  source: z.enum(['SERVICE', 'PACKAGE', 'PRODUCT']).optional(), invoiceNumber: z.string().optional(),
});
reportRoutes.get('/staff-salary', authorize('SUPER_ADMIN', 'ADMIN'), validate(salaryQuery, 'query'), send((req) => sp.staffSalaryReport(req.user, req.query)));
reportRoutes.get('/staff-commission', authorize('SUPER_ADMIN', 'ADMIN'), validate(commissionQuery, 'query'), send((req) => sp.staffCommissionReport(req.user, req.query)));

const salesInvoicesQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  search: z.string().optional(),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'UNPAID', 'ALL']).optional(),
  lifecycle: z.enum(['ACTIVE', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'ALL']).optional(),
  paymentMethod: z.string().optional(),
  staffId: z.string().optional(),
  clientId: z.string().optional(),
  soldByUserId: z.string().optional(),
  accountantId: z.string().optional(),
  userId: z.string().optional(),
});
reportRoutes.get('/sales-invoices', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), validate(salesInvoicesQuery, 'query'), send((req) => r.salesInvoicesReport(req.user, req.query)));

const incomeExpenseQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
  userType: z.string().optional(),
  userId: z.string().optional(),
  user: z.string().optional(),
  includeUnpaid: z.string().optional(),
  includeCommission: z.string().optional(),
  includeInventoryLoss: z.string().optional(),
  includePayroll: z.string().optional(),
});
reportRoutes.get(
  '/income-expense',
  authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'),
  validate(incomeExpenseQuery, 'query'),
  send((req) => r.incomeExpenseReport(req.user, req.query))
);

const operatingProfitQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
});
reportRoutes.get(
  '/operating-profit',
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(operatingProfitQuery, 'query'),
  send((req) => r.operatingProfitReport(req.user, req.query))
);

const paymentAccountsQuery = z.object({
  branchId: z.string().optional(),
  accountId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  transactionType: z.string().optional(),
  direction: z.string().optional(),
  sourceModule: z.string().optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/payment-accounts',
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(paymentAccountsQuery, 'query'),
  send((req) => r.paymentAccountsReport(req.user, req.query))
);

const cashDrawerQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  custodianUserId: z.string().optional(),
  status: z.enum(['OPEN', 'SETTLEMENT_PENDING', 'SETTLED', 'ALL']).optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/cash-drawer',
  authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'),
  validate(cashDrawerQuery, 'query'),
  send((req) => r.cashDrawerReport(req.user, req.query))
);

const detailedExpensesQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['POSTED', 'REVERSED', 'DRAFT', 'ALL']).optional(),
  paymentSource: z.enum(['CASH_DRAWER', 'ONLINE_ACCOUNT', 'ALL']).optional(),
  paymentAccountId: z.string().optional(),
  createdByUserId: z.string().optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/detailed-expenses',
  authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'),
  validate(detailedExpensesQuery, 'query'),
  send((req) => r.detailedExpensesReport(req.user, req.query))
);

const inventoryReportQuery = z.object({
  branchId: z.string().optional(),
  type: z.enum(['valuation', 'movements', 'purchases', 'supplier-ledger', 'consumption', 'expiry', 'summary']).optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  supplierId: z.string().optional(),
  itemId: z.string().optional(),
  categoryId: z.string().optional(),
  itemType: z.string().optional(),
  movementType: z.string().optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/inventory',
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(inventoryReportQuery, 'query'),
  send((req) => r.inventoryReport(req.user, req.query))
);

const attendanceOvertimeQuery = z.object({
  branchId: z.string().optional(),
  staffId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  status: z.string().optional(),
  otStatus: z.string().optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/attendance-overtime',
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(attendanceOvertimeQuery, 'query'),
  send((req) => r.attendanceOvertimeReport(req.user, req.query))
);
reportRoutes.get(
  '/attendance',
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(attendanceOvertimeQuery, 'query'),
  send((req) => r.attendanceOvertimeReport(req.user, req.query))
);

const taxReportQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/tax',
  authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'),
  validate(taxReportQuery, 'query'),
  send((req) => r.taxReport(req.user, req.query))
);

const detailedIncomeQuery = z.object({
  branchId: z.string().optional(),
  preset: z.string().optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  viewMode: z.string().optional(),
  sourceType: z.enum(['ALL', 'SERVICE', 'PRODUCT', 'PACKAGE']).optional(),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'UNPAID', 'ALL']).optional(),
  lifecycle: z.enum(['ACTIVE', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'ALL']).optional(),
  paymentMethod: z.string().optional(),
  staffId: z.string().optional(),
  soldByUserId: z.string().optional(),
  search: z.string().optional(),
});
reportRoutes.get(
  '/detailed-income',
  authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'),
  validate(detailedIncomeQuery, 'query'),
  send((req) => r.detailedIncomeReport(req.user, req.query))
);