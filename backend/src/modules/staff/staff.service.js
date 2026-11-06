import { nextSequence } from '../../lib/sequence.js';
// src/modules/staff/staff.service.js
// Staff directory: profiles, compensation (with history), schedules and portal access.

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, ymd } from '../../lib/dates.js';
import { toDec } from '../../lib/money.js';
import { hashPassword } from '../auth/auth.service.js';
import { toUserDTO } from '../auth/auth.mapper.js';
import { toStaffDTO } from './staff.mapper.js';

const DEFAULT_PORTAL_PASSWORD = 'Staff@2026';
const NO_DEDUCTION = { enabled: false, type: 'FIXED', amount: 0 };
const include = { branch: { select: { name: true } }, user: { select: { id: true, email: true } } };

// Fields whose change must be preserved in StaffCompensationHistory.
const COMPENSATION_FIELDS = [
  'compensationType', 'baseSalary', 'dailySalaryRate', 'commissionRate', 'overtimeHourlyRate',
  'lateInDeduction', 'earlyExitDeduction', 'payrollDivisor', 'combinationPolicy',
];

const getOrThrow = async (tx, id) => {
  const staff = await tx.staff.findUnique({ where: { id }, include });
  if (!staff) throw notFound('STAFF_NOT_FOUND', `Employee '${id}' not found.`);
  return staff;
};

/**
 * Each compensation type only keeps the pay fields it uses (hidden inputs are cleared),
 * and commission-only staff can never carry salary deductions. Same rules as the mock.
 */
const normalizeCompensation = (c) => {
  const out = { ...c };
  switch (c.compensationType) {
    case 'MONTHLY_SALARY':          out.dailySalaryRate = 0; out.commissionRate = 0; break;
    case 'DAILY_SALARY':            out.baseSalary = 0; out.commissionRate = 0; break;
    case 'MONTHLY_PLUS_COMMISSION': out.dailySalaryRate = 0; break;
    case 'DAILY_PLUS_COMMISSION':   out.baseSalary = 0; break;
    case 'COMMISSION_ONLY':         out.baseSalary = 0; out.dailySalaryRate = 0; break;
    default: break;
  }
  if (c.compensationType === 'COMMISSION_ONLY') {
    out.lateInDeduction = NO_DEDUCTION;
    out.earlyExitDeduction = NO_DEDUCTION;
  }
  const isMonthly = c.compensationType === 'MONTHLY_SALARY' || c.compensationType === 'MONTHLY_PLUS_COMMISSION';
  const hasPercentage = [out.lateInDeduction, out.earlyExitDeduction].some((d) => d?.enabled && d.type === 'PERCENTAGE');
  if (isMonthly && hasPercentage && !(out.payrollDivisor > 0)) {
    throw badRequest('DIVISOR_REQUIRED', 'Payroll divisor (e.g. 26 or 30 days) is required for percentage deductions on monthly staff.');
  }
  return out;
};

const compensationSnapshot = (s) =>
  Object.fromEntries(COMPENSATION_FIELDS.map((f) => [f, typeof s[f] === 'object' && s[f]?.toNumber ? s[f].toNumber() : s[f]]));

const compensationChanged = (before, after) =>
  COMPENSATION_FIELDS.some((f) => {
    const a = before[f];
    const b = after[f];
    if (a?.toNumber || typeof a === 'number') return !toDec(a ?? 0).equals(toDec(b ?? 0));
    return JSON.stringify(a) !== JSON.stringify(b);
  });

const assertEmailFreeForLogin = async (tx, identifier, exceptUserId) => {
  const owner = await tx.user.findUnique({ where: { email: identifier } });
  if (owner && owner.id !== exceptUserId) {
    throw conflict('EMAIL_TAKEN', `Login identifier '${identifier}' is already registered to another account.`);
  }
};

// ── Queries ──────────────────────────────────────────────────────────────────

export const listStaff = async (actor, { branchId, active, search } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const where = {
    ...(b ? { branchId: b } : {}),
    ...(active ? { isActive: active === 'true' } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const staff = await prisma.staff.findMany({ where, include, orderBy: [{ branchId: 'asc' }, { employeeCode: 'asc' }] });
  // Accountants & Staff may see who works where (POS/attendance/booking pickers) but never salary data.
  return staff.map((s) => toStaffDTO(s, { redactPay: actor.role === 'ACCOUNTANT' || actor.role === 'STAFF' }));
};

export const getStaff = async (actor, id) => {
  const staff = await prisma.staff.findUnique({ where: { id }, include });
  if (!staff) return null;
  if (actor.role === 'STAFF' && actor.staffId !== id) throw forbidden('FORBIDDEN', 'Access Denied: You can only view your own profile.');
  assertBranchAccess(actor, staff.branchId, 'Access Denied: Cannot view employee from another branch.');
  return toStaffDTO(staff, { redactPay: actor.role === 'ACCOUNTANT' });
};

export const getBranchNumber = async (tx, branchId) => {
  if (!branchId) return 1;
  const branches = await tx.branch.findMany({
    orderBy: [{ createdAt: 'asc' }, { code: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true },
  });
  const idx = branches.findIndex((b) => b.id === branchId);
  return idx !== -1 ? idx + 1 : 1;
};

export const peekNextEmployeeCode = async (actor, branchId) => {
  const targetBranch = resolveReadBranch(actor, branchId);
  const branchNum = await getBranchNumber(prisma, targetBranch);
  const prefix = `EMP${branchNum}`;
  const existingStaff = await prisma.staff.findMany({
    where: { employeeCode: { startsWith: `${prefix}-`, mode: 'insensitive' } },
    select: { employeeCode: true },
  });
  let maxNum = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  for (const s of existingStaff) {
    const m = s.employeeCode?.match(pattern);
    if (m) {
      const val = parseInt(m[1], 10);
      if (!isNaN(val) && val > maxNum) maxNum = val;
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
};

export const generateNextEmployeeCode = async (tx, branchId) => {
  const branchNum = await getBranchNumber(tx, branchId);
  return nextSequence(tx, branchId || '', `EMP${branchNum}`);
};

// ── Commands ─────────────────────────────────────────────────────────────────

export const createStaff = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot add staff to another branch.');

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch || !branch.isActive) throw badRequest('BRANCH_INACTIVE', 'Cannot add staff to an inactive or non-existent branch.');

    const isAutoPlaceholder = !input.employeeCode || /^EMP\d*-\d+$/i.test(input.employeeCode.trim());
    const employeeCode = isAutoPlaceholder
      ? await generateNextEmployeeCode(tx, branchId)
      : input.employeeCode.trim().toUpperCase();

    // Employee codes are unique across the whole company (biometric devices map by code).
    const clash = await tx.staff.findFirst({ where: { employeeCode: { equals: employeeCode, mode: 'insensitive' } } });
    if (clash) throw conflict('EMPLOYEE_CODE_TAKEN', `Employee code '${employeeCode}' is already assigned to another staff member.`);

    const today = await getBusinessDate(tx);
    const comp = normalizeCompensation({
      compensationType:   input.compensationType || 'MONTHLY_SALARY',
      baseSalary:         input.baseSalary ?? 0,
      dailySalaryRate:    input.dailySalaryRate ?? 0,
      commissionRate:     input.commissionRate ?? 0,
      overtimeHourlyRate: input.overtimeHourlyRate ?? 0,
      lateInDeduction:    input.lateInDeduction || NO_DEDUCTION,
      earlyExitDeduction: input.earlyExitDeduction || NO_DEDUCTION,
      payrollDivisor:     input.payrollDivisor ?? 30,
      combinationPolicy:  input.combinationPolicy || 'BOTH',
    });

    let staff = await tx.staff.create({
      data: {
        ...comp,
        employeeCode,
        branchId,
        name:                 input.name,
        phone:                input.phone,
        email:                input.email || null,
        designation:          input.designation,
        roleTitle:            input.designation,
        joiningDate:          dateOnly(input.joiningDate || today),
        effectiveDate:        dateOnly(input.effectiveDate || today),
        startTime:            input.startTime || '09:00',
        endTime:              input.endTime || '18:00',
        lateGraceMinutes:     input.lateGraceMinutes ?? 15,
        earlyGraceMinutes:    input.earlyGraceMinutes ?? 15,
        isOvernightShift:     input.isOvernightShift ?? false,
        allowedLeaveDays:     input.allowedLeaveDays ?? 12,
        leaveAllowancePeriod: input.leaveAllowancePeriod || 'YEARLY',
        specialties:          input.specialties || [],
        hasPortalAccess:      false,
      },
      include,
    });

    let user;
    if (input.enablePortalAccess) {
      const identifier = input.portalIdentifier || input.email;
      if (!identifier) throw badRequest('IDENTIFIER_REQUIRED', 'A valid login identifier is required to enable staff portal access.');
      await assertEmailFreeForLogin(tx, identifier);
      user = await tx.user.create({
        data: {
          name: staff.name, email: identifier, role: 'STAFF', branchId, staffId: staff.id,
          title: staff.designation, phone: staff.phone,
          passwordHash: await hashPassword(input.portalPassword || DEFAULT_PORTAL_PASSWORD),
        },
        include: { branch: { select: { name: true } } },
      });
      staff = await tx.staff.update({ where: { id: staff.id }, data: { hasPortalAccess: true }, include });
    }

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: 'STAFF_CREATED', entity: 'Staff',
      entityId: staff.id, branchId, after: { ...staff, branch: undefined, user: undefined },
    });
    return { staff: toStaffDTO(staff), user: user ? toUserDTO(user) : undefined };
  });
};

export const updateStaff = async (id, input, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, id);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot edit employee from another branch.');
    if (input.branchId && input.branchId !== before.branchId) {
      throw badRequest('TRANSFER_NOT_SUPPORTED', 'Employee branch transfers require an explicit operational transfer workflow.');
    }

    const comp = normalizeCompensation({
      compensationType:   input.compensationType ?? before.compensationType,
      baseSalary:         input.baseSalary ?? num(before.baseSalary),
      dailySalaryRate:    input.dailySalaryRate ?? num(before.dailySalaryRate),
      commissionRate:     input.commissionRate ?? num(before.commissionRate),
      overtimeHourlyRate: input.overtimeHourlyRate ?? num(before.overtimeHourlyRate),
      lateInDeduction:    input.lateInDeduction ?? before.lateInDeduction ?? NO_DEDUCTION,
      earlyExitDeduction: input.earlyExitDeduction ?? before.earlyExitDeduction ?? NO_DEDUCTION,
      payrollDivisor:     input.payrollDivisor ?? before.payrollDivisor,
      combinationPolicy:  input.combinationPolicy ?? before.combinationPolicy,
    });

    const payChanged = compensationChanged(before, comp);
    const effectiveDate = input.effectiveDate || (payChanged ? await getBusinessDate(tx) : ymd(before.effectiveDate));

    // Keep the old pay terms so payroll/commission for earlier periods is never rewritten.
    if (payChanged) {
      await tx.staffCompensationHistory.create({
        data: {
          staffId: id, snapshot: compensationSnapshot(before),
          effectiveDate: before.effectiveDate, changedBy: actor.id,
        },
      });
    }

    const data = {
      ...comp,
      effectiveDate:              dateOnly(effectiveDate),
      requiresCompensationReview: false,
    };
    for (const f of ['name', 'phone', 'startTime', 'endTime', 'leaveAllowancePeriod']) if (input[f]) data[f] = input[f];
    if (input.email !== undefined) data.email = input.email || null;
    if (input.designation) { data.designation = input.designation; data.roleTitle = input.designation; }
    for (const f of ['lateGraceMinutes', 'earlyGraceMinutes', 'isOvernightShift', 'allowedLeaveDays', 'specialties']) {
      if (input[f] !== undefined) data[f] = input[f];
    }
    if (input.joiningDate) data.joiningDate = dateOnly(input.joiningDate);

    if (input.isActive === false) {
      data.isActive = false;
      data.hasPortalAccess = false;
      // Last employed day — payroll prorates the exit month and still pays the days worked.
      if (before.isActive || !before.exitDate) data.exitDate = dateOnly(input.exitDate || await getBusinessDate(tx));
    } else if (input.isActive === true) {
      data.isActive = true;
      data.exitDate = null;
    }

    const staff = await tx.staff.update({ where: { id }, data, include });

    // Keep the linked login in sync (and disable it when the employee is deactivated).
    if (staff.user) {
      await tx.user.update({
        where: { id: staff.user.id },
        data: {
          name: staff.name, title: staff.designation, phone: staff.phone,
          ...(input.isActive === false ? { isActive: false } : {}),
        },
      });
      if (input.isActive === false) {
        await tx.refreshToken.updateMany({ where: { userId: staff.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: payChanged ? 'STAFF_COMPENSATION_UPDATED' : 'STAFF_UPDATED',
      entity: 'Staff', entityId: id, branchId: staff.branchId,
      before: { ...before, branch: undefined, user: undefined }, after: { ...staff, branch: undefined, user: undefined },
    });
    if (input.enablePortalAccess !== undefined && input.isActive !== false) {
      const result = await configurePortalAccess(tx, id, {
        enable: input.enablePortalAccess, identifier: input.portalIdentifier, password: input.portalPassword,
      }, actor);
      return result.staff;
    }
    return toStaffDTO(staff);
  });
};

export const deactivateStaff = async (id, actor, exitDate) => {
  const staff = await prisma.staff.findUnique({ where: { id } });
  if (!staff) throw notFound('STAFF_NOT_FOUND', `Employee '${id}' not found.`);
  assertBranchAccess(actor, staff.branchId, 'Access Denied: Cannot deactivate employee from another branch.');
  if (exitDate && !/^\d{4}-\d{2}-\d{2}$/.test(exitDate)) throw badRequest('INVALID_EXIT_DATE', 'Exit date must be YYYY-MM-DD.');
  await updateStaff(id, { isActive: false, exitDate }, actor);
  return {
    success: true,
    message: `Employee '${staff.name}' (${staff.employeeCode}) has been deactivated and portal access revoked.`,
  };
};

export const setPortalAccess = async (staffId, { enable, identifier, password }, actor) => {
  return prisma.$transaction((tx) => configurePortalAccess(tx, staffId, { enable, identifier, password }, actor));
};

const configurePortalAccess = async (tx, staffId, { enable, identifier, password }, actor) => {
    const staff = await tx.staff.findUnique({ where: { id: staffId }, include: { ...include, user: true } });
    if (!staff) throw notFound('STAFF_NOT_FOUND', `Staff record '${staffId}' not found.`);
    assertBranchAccess(actor, staff.branchId, 'Access Denied: Cannot configure portal access for an employee in another branch.');

    let user = staff.user;

    if (!enable) {
      await tx.staff.update({ where: { id: staffId }, data: { hasPortalAccess: false } });
      if (user) {
        user = await tx.user.update({ where: { id: user.id }, data: { isActive: false }, include: { branch: { select: { name: true } } } });
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    } else {
      if (!staff.isActive) throw badRequest('STAFF_INACTIVE', 'Cannot enable portal access for an inactive employee. Re-activate employment first.');
      const branch = await tx.branch.findUnique({ where: { id: staff.branchId } });
      if (!branch?.isActive) throw badRequest('BRANCH_INACTIVE', 'Cannot enable portal access for an employee in an inactive branch.');

      const loginId = (identifier || user?.email || staff.email)?.trim().toLowerCase();
      if (!loginId) throw badRequest('IDENTIFIER_REQUIRED', 'A valid login identifier is required to enable portal access.');
      await assertEmailFreeForLogin(tx, loginId, user?.id);

      if (user) {
        // Re-enable the existing account instead of creating another.
        const data = { isActive: true, email: loginId, branchId: staff.branchId };
        if (password) {
          data.passwordHash = await hashPassword(password);
          data.plainPassword = null;
        }
        user = await tx.user.update({ where: { id: user.id }, data, include: { branch: { select: { name: true } } } });
        if (password) await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      } else {
        user = await tx.user.create({
          data: {
            name: staff.name, email: loginId, role: 'STAFF', branchId: staff.branchId, staffId: staff.id,
            title: staff.designation, phone: staff.phone,
            passwordHash: await hashPassword(password || DEFAULT_PORTAL_PASSWORD),
          },
          include: { branch: { select: { name: true } } },
        });
      }
      await tx.staff.update({ where: { id: staffId }, data: { hasPortalAccess: true } });
    }

    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: enable ? 'STAFF_PORTAL_ENABLED' : 'STAFF_PORTAL_DISABLED',
      entity: 'Staff', entityId: staffId, branchId: staff.branchId,
    });

    const fresh = await tx.staff.findUnique({ where: { id: staffId }, include });
    return { staff: toStaffDTO(fresh), user: user ? toUserDTO(user) : undefined };
};

const num = (v) => toDec(v ?? 0).toNumber();
