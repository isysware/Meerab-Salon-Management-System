// src/modules/settings/settings.service.js
// Branch configuration: tax rules, payment accounts, expense categories, payroll policy, business date.

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, notFound, forbidden } from '../../lib/AppError.js';
import { accountBalances } from '../../lib/balances.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { getBusinessDate, setBusinessDate, clearBusinessDate, isBusinessDateOverridden, toDateString, toTimeString } from '../../lib/dates.js';
import * as branches from '../branches/branches.service.js';
import {
  toTaxRuleDTO, toPaymentAccountDTO, toOnlineAccountDTO, toExpenseCategoryDTO, toPayrollPolicyDTO,
} from './settings.mapper.js';

const ensureBranch = async (tx, id) => {
  const branch = await tx.branch.findUnique({ where: { id } });
  if (!branch) throw notFound('BRANCH_NOT_FOUND', `Branch '${id}' not found.`);
  return branch;
};

const membership = (branchId) => ({ OR: [{ branchId }, { branches: { some: { id: branchId } } }] });
const selectedBranches = async (tx, input, actor) => {
  const ids = [...new Set(input.branchIds ?? [resolveWriteBranch(actor, input.branchId)])];
  for (const id of ids) { assertBranchAccess(actor, id); await ensureBranch(tx, id); }
  return ids;
};
const audit = (tx, actor, action, entity, entityId, branchId, before, after) =>
  auditLog(tx, { userId: actor.id, userName: actor.name, action, entity, entityId, branchId, before, after });

// ═══ TAX RULES ════════════════════════════════════════════════════════════════

export const listTaxRules = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const rules = await prisma.taxRule.findMany({ where: b ? membership(b) : {}, include: { branches: true }, orderBy: { createdAt: 'asc' } });
  const defaults = await prisma.branch.findMany({ where: { ...(b ? { id: b } : {}), defaultTaxRuleId: { in: rules.map((r) => r.id) } }, select: { defaultTaxRuleId: true } });
  return rules.map((r) => ({ ...toTaxRuleDTO(r), isBranchDefault: defaults.some((d) => d.defaultTaxRuleId === r.id) }));
};

/** Make `ruleId` the branch default (or clear the default when null) and sync branch tax fields. */
const applyBranchDefault = async (tx, branchId, rule) => {
  await tx.taxRule.updateMany({ where: { branchId }, data: { isBranchDefault: false } });
  if (!rule) {
    return tx.branch.update({ where: { id: branchId }, data: { defaultTaxRuleId: null, taxRate: 0, taxEnabled: false } });
  }
  await tx.taxRule.update({ where: { id: rule.id }, data: { isBranchDefault: true } });
  return tx.branch.update({ where: { id: branchId }, data: { defaultTaxRuleId: rule.id, taxRate: rule.rate, taxEnabled: true } });
};

export const createTaxRule = async (input, actor) => {

  return prisma.$transaction(async (tx) => {
    const branchIds = await selectedBranches(tx, input, actor);
    const branchId = branchIds[0];
    let rule = await tx.taxRule.create({
      data: {
        branchId,
        branches: { connect: branchIds.map((id) => ({ id })) },
        name:        input.name,
        rate:        input.rate,
        description: input.description || null,
        isActive:    input.isActive ?? true,
      },
    });
    // Creating a rule never silently enables tax — only an explicit default selection does.
    if (input.isBranchDefault) {
      if (!rule.isActive) throw badRequest('RULE_INACTIVE', 'An inactive tax rule cannot be the branch default.');
      for (const id of branchIds) await applyBranchDefault(tx, id, rule);
      rule = await tx.taxRule.findUnique({ where: { id: rule.id } });
    }
    await audit(tx, actor, 'TAX_RULE_CREATED', 'TaxRule', rule.id, branchId, null, rule);
    return toTaxRuleDTO(await tx.taxRule.findUnique({ where: { id: rule.id }, include: { branches: true } }));
  });
};

export const updateTaxRule = async (id, input, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.taxRule.findUnique({ where: { id } });
    if (!before) throw notFound('TAX_RULE_NOT_FOUND', `Tax rule '${id}' not found.`);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot edit tax rule from another branch.');

    const data = {};
    if (input.branchIds) {
      const ids = await selectedBranches(tx, input, actor);
      data.branches = { set: ids.map((id) => ({ id })) };
      data.branchId = ids[0];
    }
    if (input.name) data.name = input.name;
    if (input.rate !== undefined) data.rate = input.rate;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    let rule = await tx.taxRule.update({ where: { id }, data });

    const defaultBranches = await tx.branch.findMany({ where: { defaultTaxRuleId: id } });
    for (const branch of defaultBranches) {
      if (!rule.isActive || (input.branchIds && !input.branchIds.includes(branch.id))) await applyBranchDefault(tx, branch.id, null);
      else await tx.branch.update({ where: { id: branch.id }, data: { taxRate: rule.rate } });
    }
    if (input.isBranchDefault && rule.isActive) {
      const branch = input.branchId ?? rule.branchId;
      const applicable = await tx.taxRule.findFirst({ where: { id, ...membership(branch) } });
      if (!applicable) throw badRequest('RULE_BRANCH_MISMATCH', 'Tax rule is not assigned to this branch.');
      await applyBranchDefault(tx, branch, rule);
    }
    rule = await tx.taxRule.findUnique({ where: { id } });
    await audit(tx, actor, 'TAX_RULE_UPDATED', 'TaxRule', id, rule.branchId, before, rule);
    return toTaxRuleDTO(await tx.taxRule.findUnique({ where: { id: rule.id }, include: { branches: true } }));
  });
};

export const toggleTaxRule = async (id, actor) => {
  const rule = await prisma.taxRule.findUnique({ where: { id } });
  if (!rule) throw notFound('TAX_RULE_NOT_FOUND', `Tax rule '${id}' not found.`);
  return updateTaxRule(id, { isActive: !rule.isActive }, actor);
};

export const setBranchDefaultTaxRule = async ({ branchId: requested, ruleId }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Branch Administrators cannot configure default tax rules for other branches.');
  return prisma.$transaction(async (tx) => {
    const before = await ensureBranch(tx, branchId);
    let rule = null;
    if (ruleId) {
      rule = await tx.taxRule.findFirst({ where: { id: ruleId, ...membership(branchId) } });
      if (!rule) throw notFound('TAX_RULE_NOT_FOUND', `Tax rule '${ruleId}' not found in this branch.`);
      if (!rule.isActive) throw badRequest('RULE_INACTIVE', `Cannot set deactivated tax rule '${rule.name}' as branch default.`);
    }
    const branch = await applyBranchDefault(tx, branchId, rule);
    await audit(tx, actor, 'BRANCH_DEFAULT_TAX_SET', 'Branch', branchId, branchId,
      { defaultTaxRuleId: before.defaultTaxRuleId }, { defaultTaxRuleId: branch.defaultTaxRuleId });
    return (await branches.toDTOs([branch], tx))[0];
  });
};

// ═══ PAYMENT ACCOUNTS ═════════════════════════════════════════════════════════

const withBalances = async (accounts, mapper, branchId) => {
  const balances = await accountBalances(accounts.map((a) => a.id), { ...(branchId ? { branchIds: [branchId] } : {}) });
  return accounts.map((a) => mapper(a, balances.get(a.id)));
};

export const listPaymentAccounts = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const accounts = await prisma.paymentAccount.findMany({ where: b ? membership(b) : {}, include: { branches: true }, orderBy: { createdAt: 'asc' } });
  if (actor.role === 'ACCOUNTANT') return accounts.map((account) => {
    const { currentBalance, ...option } = toPaymentAccountDTO(account, 0);
    return option;
  });
  return withBalances(accounts, toPaymentAccountDTO, b);
};

export const listOnlineAccounts = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const accounts = await prisma.paymentAccount.findMany({ where: b ? membership(b) : {}, include: { branches: true }, orderBy: { createdAt: 'asc' } });
  if (actor.role === 'ACCOUNTANT') return accounts.map((account) => {
    const { currentBalance, ...option } = toOnlineAccountDTO(account, 0);
    return option;
  });
  return withBalances(accounts, toOnlineAccountDTO, b);
};

const accountDTO = async (account) => (await withBalances([await prisma.paymentAccount.findUnique({ where: { id: account.id }, include: { branches: true } })], toPaymentAccountDTO))[0];

export const createPaymentAccount = async (input, actor) => {

  const account = await prisma.$transaction(async (tx) => {
    const branchIds = await selectedBranches(tx, input, actor);
    const branchId = branchIds[0];
    // New accounts always start at zero; balances only change through postings.
    const created = await tx.paymentAccount.create({
      data: {
        branchId,
        branches: { connect: branchIds.map((id) => ({ id })) },
        name:              input.name,
        accountType:       input.accountType,
        providerName:      input.providerName,
        accountHolder:     input.accountHolder,
        accountIdentifier: input.accountIdentifier || null,
        isActive:          input.isActive ?? true,
        openingBalance:    0,
      },
    });
    await audit(tx, actor, 'PAYMENT_ACCOUNT_CREATED', 'PaymentAccount', created.id, branchId, null, created);
    return created;
  });
  return accountDTO(account);
};

export const updatePaymentAccount = async (id, input, actor) => {
  const account = await prisma.$transaction(async (tx) => {
    const before = await tx.paymentAccount.findUnique({ where: { id } });
    if (!before) throw notFound('ACCOUNT_NOT_FOUND', `Payment account '${id}' not found.`);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot edit payment account from another branch.');

    const data = {};
    if (input.branchIds) {
      const ids = await selectedBranches(tx, input, actor);
      data.branches = { set: ids.map((id) => ({ id })) };
      data.branchId = ids[0];
    }
    for (const f of ['name', 'providerName', 'accountHolder', 'accountType']) if (input[f]) data[f] = input[f];
    if (input.accountIdentifier !== undefined) data.accountIdentifier = input.accountIdentifier || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await tx.paymentAccount.update({ where: { id }, data });
    await audit(tx, actor, 'PAYMENT_ACCOUNT_UPDATED', 'PaymentAccount', id, updated.branchId, before, updated);
    return updated;
  });
  return accountDTO(account);
};

export const togglePaymentAccount = async (id, actor) => {
  const account = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!account) throw notFound('ACCOUNT_NOT_FOUND', `Payment account '${id}' not found.`);
  return updatePaymentAccount(id, { isActive: !account.isActive }, actor);
};

export const deletePaymentAccount = async (id, actor) => {
  return prisma.$transaction(async (tx) => {
    const account = await tx.paymentAccount.findUnique({ where: { id } });
    if (!account) throw notFound('ACCOUNT_NOT_FOUND', `Payment account '${id}' not found.`);
    assertBranchAccess(actor, account.branchId, 'Access Denied: Cannot delete payment account from another branch.');

    const movementCount = await tx.accountMovement.count({ where: { accountId: id } });
    const hasOpeningBalance = Number(account.openingBalance) !== 0;
    if (movementCount > 0 || hasOpeningBalance) {
      const updated = await tx.paymentAccount.update({
        where: { id },
        data: { isActive: false },
      });
      await audit(tx, actor, 'PAYMENT_ACCOUNT_ARCHIVED', 'PaymentAccount', id, account.branchId, account, updated);
      return {
        id,
        deleted: false,
        archived: true,
        message: `Account '${account.name}' has balance or transaction movements and cannot be permanently deleted. It has been deactivated and archived instead.`,
      };
    }

    await tx.paymentAccount.delete({ where: { id } });
    await audit(tx, actor, 'PAYMENT_ACCOUNT_DELETED', 'PaymentAccount', id, account.branchId, account, null);
    return {
      id,
      deleted: true,
      archived: false,
      message: `Payment account '${account.name}' removed successfully.`,
    };
  });
};

// ═══ EXPENSE CATEGORIES ═══════════════════════════════════════════════════════

export const listExpenseCategories = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const cats = await prisma.expenseCategory.findMany({ where: b ? { branchId: b } : {}, orderBy: { createdAt: 'asc' } });
  return cats.map(toExpenseCategoryDTO);
};

const assertCategoryNameFree = async (tx, branchId, name, exceptId) => {
  const clash = await tx.expenseCategory.findFirst({
    where: { branchId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw conflict('CATEGORY_EXISTS', `An expense category named '${name}' already exists in this branch.`);
};

export const createExpenseCategory = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot create categories for another branch.');
  return prisma.$transaction(async (tx) => {
    await ensureBranch(tx, branchId);
    await assertCategoryNameFree(tx, branchId, input.name);
    const cat = await tx.expenseCategory.create({ data: { branchId, name: input.name, description: input.description || null } });
    await audit(tx, actor, 'EXPENSE_CATEGORY_CREATED', 'ExpenseCategory', cat.id, branchId, null, cat);
    return toExpenseCategoryDTO(cat);
  });
};

export const updateExpenseCategory = async (id, input, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.expenseCategory.findUnique({ where: { id } });
    if (!before) throw notFound('CATEGORY_NOT_FOUND', 'Expense category not found.');
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot update categories for another branch.');

    const data = {};

    if (input.name !== undefined) {
      await assertCategoryNameFree(tx, before.branchId, input.name, id);
      data.name = input.name;
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const cat = await tx.expenseCategory.update({ where: { id }, data });
    await audit(tx, actor, 'EXPENSE_CATEGORY_UPDATED', 'ExpenseCategory', id, cat.branchId, before, cat);
    return toExpenseCategoryDTO(cat);
  });
};

export const toggleExpenseCategory = async (id, actor) => {
  const cat = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!cat) throw notFound('CATEGORY_NOT_FOUND', 'Expense category not found.');
  return updateExpenseCategory(id, { isActive: !cat.isActive }, actor);
};

// ═══ PAYROLL POLICY ═══════════════════════════════════════════════════════════

export const getPayrollPolicy = async (actor, requested) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot view payroll policy of another branch.');
  const existing = await prisma.payrollPolicy.findUnique({ where: { branchId } });
  if (existing) return toPayrollPolicyDTO(existing);
  // Not configured yet → defaults (same as the mock).
  return {
    id:                             `policy-${branchId}`,
    branchId,
    monthlyAbsenceDivisor:          30,
    customDivisorDays:              30,
    dailyStaffPaidLeaveEligibility: true,
    nonWorkedWeeklyOffPaid:         false,
    nonWorkedHolidayPaid:           true,
    prorationMethod:                'CALENDAR_DAYS',
    updatedAt:                      await getBusinessDate(),
    updatedByUserId:                'SYSTEM',
  };
};

export const updatePayrollPolicy = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: You do not have permission to configure payroll policy for this branch.');
  return prisma.$transaction(async (tx) => {
    await ensureBranch(tx, branchId);
    const before = await tx.payrollPolicy.findUnique({ where: { branchId } });

    const data = { updatedByUserId: actor.id };
    if (input.monthlyAbsenceDivisor !== undefined) data.monthlyAbsenceDivisor = String(input.monthlyAbsenceDivisor);
    for (const f of ['customDivisorDays', 'dailyStaffPaidLeaveEligibility', 'nonWorkedWeeklyOffPaid', 'nonWorkedHolidayPaid', 'prorationMethod']) {
      if (input[f] !== undefined) data[f] = input[f];
    }

    const policy = await tx.payrollPolicy.upsert({ where: { branchId }, update: data, create: { branchId, ...data } });
    await audit(tx, actor, 'PAYROLL_POLICY_UPDATED', 'PayrollPolicy', policy.id, branchId, before, policy);
    return toPayrollPolicyDTO(policy);
  });
};

// ═══ BUSINESS / SYSTEM DATE ═══════════════════════════════════════════════════

export const getSystemDate = () => getBusinessDate();

export const getSystemDateInfo = async () => {
  const date = await getBusinessDate();
  const realDate = toDateString();
  const isOverridden = await isBusinessDateOverridden();
  return {
    date,
    realDate,
    isOverridden,
    time: toTimeString(),
  };
};

export const setSystemDate = async (date, actor) => {
  return await prisma.$transaction(async (tx) => {
    const before = await getBusinessDate(tx);
    if (!date || date === toDateString()) {
      await clearBusinessDate(tx);
      const live = toDateString();
      await audit(tx, actor, 'SYSTEM_DATE_RESET', 'SystemSetting', 'businessDate', null, { date: before }, { date: live, mode: 'LIVE' });
      return live;
    }
    await setBusinessDate(date, tx);
    await audit(tx, actor, 'SYSTEM_DATE_SET', 'SystemSetting', 'businessDate', null, { date: before }, { date, mode: 'OVERRIDE' });
    return date;
  });
};

export const clearSystemDate = async (actor) => {
  return await prisma.$transaction(async (tx) => {
    const before = await getBusinessDate(tx);
    const live = await clearBusinessDate(tx);
    await audit(tx, actor, 'SYSTEM_DATE_RESET', 'SystemSetting', 'businessDate', null, { date: before }, { date: live, mode: 'LIVE' });
    return live;
  });
};

// ═══ TEST DATA RESET ══════════════════════════════════════════════════════════

export const resetTestData = async (input = {}, actor) => {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) {
    throw forbidden('FORBIDDEN', 'Access Denied: Only administrators can reset system test data.');
  }

  const {
    branchId: requestedBranchId,
    wipeCatalogue = false,
    wipeInventory = false,
    wipeClients = true,
    wipeStaff = false,
    wipeSuppliers = true,
  } = input;

  const targetBranchId = actor.role === 'SUPER_ADMIN'
    ? (requestedBranchId && requestedBranchId !== 'ALL' ? requestedBranchId : actor.branchId)
    : actor.branchId;

  const bFilter = targetBranchId && targetBranchId !== 'ALL' ? { branchId: targetBranchId } : {};

  // 1. Refunds, Payments & Invoices
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.refundLine.deleteMany({ where: { refund: { invoice: { branchId: targetBranchId } } } });
    await prisma.invoiceRefund.deleteMany({ where: { invoice: { branchId: targetBranchId } } });
    await prisma.invoiceLineBatch.deleteMany({ where: { line: { invoice: { branchId: targetBranchId } } } });
    await prisma.invoiceLineComponent.deleteMany({ where: { line: { invoice: { branchId: targetBranchId } } } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { branchId: targetBranchId } } });
    await prisma.invoicePayment.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.commissionEvent.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.invoice.deleteMany({ where: { branchId: targetBranchId } });
  } else {
    await prisma.refundLine.deleteMany({});
    await prisma.invoiceRefund.deleteMany({});
    await prisma.invoiceLineBatch.deleteMany({});
    await prisma.invoiceLineComponent.deleteMany({});
    await prisma.invoiceLine.deleteMany({});
    await prisma.invoicePayment.deleteMany({});
    await prisma.commissionEvent.deleteMany({});
    await prisma.invoice.deleteMany({});
  }

  // 2. Appointments
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.appointmentPackageComponent.deleteMany({ where: { appointmentItem: { appointment: { branchId: targetBranchId } } } });
    await prisma.appointmentItem.deleteMany({ where: { appointment: { branchId: targetBranchId } } });
    await prisma.appointmentReschedule.deleteMany({ where: { appointment: { branchId: targetBranchId } } });
    await prisma.appointment.deleteMany({ where: { branchId: targetBranchId } });
  } else {
    await prisma.appointmentPackageComponent.deleteMany({});
    await prisma.appointmentItem.deleteMany({});
    await prisma.appointmentReschedule.deleteMany({});
    await prisma.appointment.deleteMany({});
  }

  // 3. Tips, Commission, Payroll & Staff Loans
  await prisma.tipPayout.deleteMany({ where: bFilter });
  await prisma.tipAllocation.deleteMany({ where: bFilter });
  await prisma.tipReceipt.deleteMany({ where: bFilter });
  await prisma.commissionPayment.deleteMany({ where: bFilter });
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.commissionStatement.deleteMany({ where: { run: { branchId: targetBranchId } } });
  } else {
    await prisma.commissionStatement.deleteMany({});
  }
  await prisma.commissionRun.deleteMany({ where: bFilter });

  // 3a. Staff Loans / Advances & Recoveries (recoveries must be deleted before advances)
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.advanceRecovery.deleteMany({ where: { advance: { branchId: targetBranchId } } });
  } else {
    await prisma.advanceRecovery.deleteMany({});
  }
  await prisma.salaryAdvance.deleteMany({ where: bFilter });

  // 3b. One-off Payroll Adjustments
  await prisma.payrollAdjustment.deleteMany({ where: bFilter });

  // 3c. Payroll Payments, Payslips & Runs (Payments MUST be deleted before Payslips due to FK constraint)
  await prisma.payrollPayment.deleteMany({ where: bFilter });
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.payslip.deleteMany({ where: { run: { branchId: targetBranchId } } });
  } else {
    await prisma.payslip.deleteMany({});
  }
  await prisma.payrollRun.deleteMany({ where: bFilter });

  // 4. Attendance & Overtime
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.attendanceCorrection.deleteMany({ where: { record: { branchId: targetBranchId } } });
    await prisma.attendancePunch.deleteMany({ where: { record: { branchId: targetBranchId } } });
  } else {
    await prisma.attendanceCorrection.deleteMany({});
    await prisma.attendancePunch.deleteMany({});
  }
  await prisma.attendanceRecord.deleteMany({ where: bFilter });
  await prisma.leaveRecord.deleteMany({ where: bFilter });
  await prisma.overtimeRecord.deleteMany({ where: bFilter });

  // 5. Inventory & Purchases & Suppliers
  if (targetBranchId && targetBranchId !== 'ALL') {
    await prisma.stockSettlementLine.deleteMany({ where: { settlement: { branchId: targetBranchId } } });
    await prisma.stockSettlement.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.supplierReturnLine.deleteMany({ where: { return: { branchId: targetBranchId } } });
    await prisma.supplierReturn.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.purchaseLine.deleteMany({ where: { purchase: { branchId: targetBranchId } } });
    await prisma.purchase.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.supplierPayment.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.supplierLedger.deleteMany({ where: { branchId: targetBranchId } });
    if (wipeSuppliers) {
      await prisma.supplier.deleteMany({ where: { branchId: targetBranchId } });
    } else {
      await prisma.supplier.updateMany({ where: { branchId: targetBranchId }, data: { openingPayable: 0 } });
    }
    await prisma.stockMovement.deleteMany({ where: { branchId: targetBranchId } });
    await prisma.inventoryBatch.deleteMany({ where: { branchId: targetBranchId } });
  } else {
    await prisma.stockSettlementLine.deleteMany({});
    await prisma.stockSettlement.deleteMany({});
    await prisma.supplierReturnLine.deleteMany({});
    await prisma.supplierReturn.deleteMany({});
    await prisma.purchaseLine.deleteMany({});
    await prisma.purchase.deleteMany({});
    await prisma.supplierPayment.deleteMany({});
    await prisma.supplierLedger.deleteMany({});
    if (wipeSuppliers) {
      await prisma.supplier.deleteMany({});
    } else {
      await prisma.supplier.updateMany({ data: { openingPayable: 0 } });
    }
    await prisma.stockMovement.deleteMany({});
    await prisma.inventoryBatch.deleteMany({});
  }

  // 6. Expenses, Cash Drawers & Settlements
  await prisma.expense.deleteMany({ where: bFilter });
  await prisma.cashVarianceAdjustment.deleteMany({ where: bFilter });
  await prisma.settlement.deleteMany({ where: bFilter });
  await prisma.cashTransfer.deleteMany({ where: bFilter });
  await prisma.drawerMovement.deleteMany({ where: bFilter });
  await prisma.accountMovement.deleteMany({ where: bFilter });
  await prisma.cashDrawer.deleteMany({ where: bFilter });

  // 7. Audit events, Idempotency keys, Sequences
  await prisma.auditEvent.deleteMany({ where: bFilter });
  await prisma.idempotencyKey.deleteMany({});
  if (targetBranchId && targetBranchId !== 'ALL') {
    const branchRow = await prisma.branch.findUnique({ where: { id: targetBranchId } });
    if (branchRow) {
      await prisma.sequence.deleteMany({
        where: {
          OR: [
            { branchCode: branchRow.code },
            { branchCode: { startsWith: `${branchRow.code}:` } },
          ],
        },
      });
    }
  } else {
    await prisma.sequence.deleteMany({});
  }

  // 8. Clients
  if (wipeClients) {
    await prisma.client.deleteMany({ where: bFilter });
  }

  // 9. Staff (Profiles only; users/credentials are never deleted!)
  if (wipeStaff) {
    if (targetBranchId && targetBranchId !== 'ALL') {
      await prisma.staffCompensationHistory.deleteMany({ where: { staff: { branchId: targetBranchId } } });
    } else {
      await prisma.staffCompensationHistory.deleteMany({});
    }
    await prisma.staffAllowance.deleteMany({ where: bFilter });
    await prisma.staff.deleteMany({ where: bFilter });
  }

  // 10. Catalogue & Inventory Items
  if (wipeCatalogue) {
    if (targetBranchId && targetBranchId !== 'ALL') {
      await prisma.packageComponent.deleteMany({ where: { package: { branchId: targetBranchId } } });
      await prisma.package.deleteMany({ where: { branchId: targetBranchId } });
      await prisma.service.deleteMany({ where: { branchId: targetBranchId } });
      await prisma.serviceCategory.deleteMany({ where: { branchId: targetBranchId } });
    } else {
      await prisma.packageComponent.deleteMany({});
      await prisma.package.deleteMany({});
      await prisma.service.deleteMany({});
      await prisma.serviceCategory.deleteMany({});
    }
  }

  if (wipeCatalogue || wipeInventory) {
    if (targetBranchId && targetBranchId !== 'ALL') {
      // Find all inventory items that were associated with this branch or only this branch
      const items = await prisma.inventoryItem.findMany({
        include: {
          batches: { where: { branchId: { not: targetBranchId } } },
          movements: { where: { branchId: { not: targetBranchId } } },
        },
      });

      for (const item of items) {
        const isAssociated =
          item.branchAvailability.includes(targetBranchId) ||
          item.branchAvailability.includes('ALL') ||
          item.branchAvailability.length === 0;

        if (isAssociated) {
          // If no other branch has batches or movements for this item, delete it completely
          if (item.batches.length === 0 && item.movements.length === 0) {
            await prisma.inventoryItem.delete({ where: { id: item.id } }).catch(() => {});
          } else {
            // Remove this branch from availability so it disappears from this branch's catalogue
            const updatedAvail = item.branchAvailability.filter((b) => b !== targetBranchId && b !== 'ALL');
            await prisma.inventoryItem.update({
              where: { id: item.id },
              data: { branchAvailability: updatedAvail },
            }).catch(() => {});
          }
        }
      }
    } else {
      // All branches: wipe all inventory items
      await prisma.inventoryItem.deleteMany({});
    }
  }

  // 11. Reset payment account opening balances to 0
  await prisma.paymentAccount.updateMany({
    where: bFilter,
    data: { openingBalance: 0 },
  });

  // 12. Create clean opening Vault cash drawer with 0 balance
  const branchesToInit = targetBranchId && targetBranchId !== 'ALL'
    ? await prisma.branch.findMany({ where: { id: targetBranchId } })
    : await prisma.branch.findMany({ where: { isActive: true } });

  for (const b of branchesToInit) {
    await prisma.cashDrawer.create({
      data: {
        kind: 'VAULT',
        branchId: b.id,
        custodianName: `${b.name} Main Vault`,
        date: new Date(),
        status: 'OPEN',
        lastCountedCash: 0,
      },
    });
  }

  return {
    success: true,
    message: 'Test data has been successfully reset. Balances and sequences are back to 0.',
    branchId: targetBranchId || 'ALL',
    resetAt: new Date().toISOString(),
  };
};

// ═══ ATTENDANCE POLICY ═════════════════════════════════════════════════════════

const DEFAULT_ATTENDANCE_POLICY = (branchId) => ({
  branchId,
  autoMarkAbsentEnabled: true,
  autoAbsentThresholdMinutes: 60, // 1 hour after shift start
  defaultStartTime: '09:00',
  defaultEndTime: '18:00',
  lateGraceMinutes: 15,
  earlyGraceMinutes: 15,
  updatedAt: new Date().toISOString(),
});

export const getAttendancePolicy = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const key = `attendance_policy_${b || 'default'}`;
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  if (!setting) {
    return DEFAULT_ATTENDANCE_POLICY(b || 'default');
  }
  try {
    const parsed = JSON.parse(setting.value);
    return { ...DEFAULT_ATTENDANCE_POLICY(b || 'default'), ...parsed, branchId: b || 'default', updatedAt: setting.updatedAt };
  } catch {
    return DEFAULT_ATTENDANCE_POLICY(b || 'default');
  }
};

export const updateAttendancePolicy = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot configure attendance policy for another branch.');
  const key = `attendance_policy_${branchId || 'default'}`;
  const current = await getAttendancePolicy(actor, branchId);
  const updated = {
    ...current,
    autoMarkAbsentEnabled: input.autoMarkAbsentEnabled !== undefined ? Boolean(input.autoMarkAbsentEnabled) : current.autoMarkAbsentEnabled,
    autoAbsentThresholdMinutes: input.autoAbsentThresholdMinutes !== undefined ? Number(input.autoAbsentThresholdMinutes) : current.autoAbsentThresholdMinutes,
    defaultStartTime: input.defaultStartTime || current.defaultStartTime,
    defaultEndTime: input.defaultEndTime || current.defaultEndTime,
    lateGraceMinutes: input.lateGraceMinutes !== undefined ? Number(input.lateGraceMinutes) : current.lateGraceMinutes,
    earlyGraceMinutes: input.earlyGraceMinutes !== undefined ? Number(input.earlyGraceMinutes) : current.earlyGraceMinutes,
    updatedAt: new Date().toISOString(),
    updatedByUserId: actor.id,
  };

  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(updated) },
    create: { key, value: JSON.stringify(updated) },
  });

  return updated;
};


