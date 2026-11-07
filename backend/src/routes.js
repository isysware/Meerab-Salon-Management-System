// src/routes.js
// Central router — mounts all module routers under /api/v1.

import { Router } from 'express';
import prisma from './config/prisma.js';
import authRoutes from './modules/auth/auth.routes.js';
import branchRoutes from './modules/branches/branches.routes.js';
import userRoutes from './modules/users/users.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import { categoryRoutes, serviceRoutes, packageRoutes } from './modules/catalogue/catalogue.routes.js';
import clientRoutes from './modules/clients/clients.routes.js';
import appointmentRoutes from './modules/appointments/appointments.routes.js';
import bookingRoutes from './modules/bookings/bookings.routes.js';
import { drawerRoutes, transferRoutes, accountLedgerRoutes } from './modules/cash/cash.routes.js';
import {
  inventoryRoutes, supplierRoutes, purchaseRoutes, supplierReturnRoutes, stockMovementRoutes, stockSettlementRoutes,
} from './modules/inventory/inventory.routes.js';
import { posRoutes, invoiceRoutes } from './modules/pos/pos.routes.js';
import expenseRoutes from './modules/expenses/expenses.routes.js';
import { custodyRoutes, settlementRoutes } from './modules/settlements/settlements.routes.js';
import { attendanceRoutes, leaveRoutes, holidayRoutes, overtimeRoutes } from './modules/attendance/attendance.routes.js';
import payrollRoutes from './modules/payroll/payroll.routes.js';
import commissionRoutes from './modules/commission/commission.routes.js';
import tipRoutes from './modules/tips/tips.routes.js';
import { dashboardRoutes, reportRoutes } from './modules/reports/reports.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import ledgerRoutes from './modules/ledger/ledger.routes.js';
import {
  taxRuleRoutes,
  paymentAccountRoutes,
  onlineAccountRoutes,
  expenseCategoryRoutes,
  payrollPolicyRoutes,
  attendancePolicyRoutes,
  systemRoutes,
} from './modules/settings/settings.routes.js';
import deviceRoutes from './modules/devices/device.routes.js';
import publicRoutes from './modules/public/public.routes.js';

const router = Router();

// ── Public Routes (Unauthenticated, safe customer-facing endpoints) ───
router.use('/public', publicRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ data: { status: 'ok', db: 'ok', timestamp: new Date().toISOString() } });
  } catch {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'Database connection failed' } });
  }
});

// ── Module routes (in build order — see PROJECT.md) ───────────────────────────
router.use('/auth',               authRoutes);            // Step 1
router.use('/branches',           branchRoutes);          // Step 2
router.use('/users',              userRoutes);            // Step 3
router.use('/tax-rules',          taxRuleRoutes);         // Step 4
router.use('/payment-accounts',   paymentAccountRoutes);  // Step 4
router.use('/online-accounts',    onlineAccountRoutes);   // Step 4
router.use('/expense-categories', expenseCategoryRoutes); // Step 4
router.use('/payroll-policy',     payrollPolicyRoutes);   // Step 4
router.use('/attendance-policy',  attendancePolicyRoutes); // Step 4
router.use('/system',             systemRoutes);          // Step 4
router.use('/staff',              staffRoutes);           // Step 5
router.use('/service-categories', categoryRoutes);        // Step 6
router.use('/services',           serviceRoutes);         // Step 6
router.use('/packages',           packageRoutes);         // Step 6
router.use('/clients',            clientRoutes);          // Step 7
router.use('/appointments',       appointmentRoutes);     // Step 8
router.use('/bookings',           bookingRoutes);
router.use('/cash-drawers',       drawerRoutes);          // Step 9
router.use('/cash-transfers',     transferRoutes);        // Step 9
router.use('/account-statements', accountLedgerRoutes);   // Step 9
router.use('/inventory',          inventoryRoutes);       // Step 10
router.use('/suppliers',          supplierRoutes);        // Step 10
router.use('/purchases',          purchaseRoutes);        // Step 10
router.use('/supplier-returns',   supplierReturnRoutes);  // Step 10
router.use('/stock-movements',    stockMovementRoutes);   // Step 10
router.use('/stock-settlements',  stockSettlementRoutes); // Step 10
router.use('/pos',                posRoutes);             // Step 11
router.use('/invoices',           invoiceRoutes);         // Step 11
router.use('/expenses',           expenseRoutes);         // Step 12
router.use('/custody',            custodyRoutes);         // Step 13
router.use('/settlements',        settlementRoutes);      // Step 13
router.use('/attendance',         attendanceRoutes);      // Step 14
router.use('/leaves',             leaveRoutes);           // Step 14
router.use('/holidays',           holidayRoutes);         // Step 14
router.use('/overtime',           overtimeRoutes);        // Step 15
router.use('/payroll',            payrollRoutes);         // Step 16
router.use('/commission',         commissionRoutes);      // Step 17
router.use('/tips',               tipRoutes);             // Step 18
router.use('/dashboard',          dashboardRoutes);       // Step 19
router.use('/reports',            reportRoutes);          // Step 20–21
router.use('/audit-events',       auditRoutes);           // Step 22
router.use('/ledger',             ledgerRoutes);          // Step 22
router.use('/devices',            deviceRoutes);          // Step 23 Hardware Integration

export default router;
