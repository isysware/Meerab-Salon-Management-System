import { nextSequence } from '../../lib/sequence.js';
// src/modules/catalogue/catalogue.service.js
// Service catalogue, packages (multi-component, weights total 100%) and categories.
// Price/weight edits only affect FUTURE sales — invoices snapshot everything at posting time.

import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { round2, toDec } from '../../lib/money.js';
import { toCategoryDTO, toServiceDTO, toPackageDTO } from './catalogue.mapper.js';

const serviceInclude = { category: true };
const packageInclude = { components: { include: { service: true } } };

const audit = (tx, actor, action, entity, entityId, branchId, before, after) =>
  auditLog(tx, { userId: actor.id, userName: actor.name, action, entity, entityId, branchId, before, after });

const assertActiveBranch = async (tx, branchId) => {
  const branch = await tx.branch.findUnique({ where: { id: branchId } });
  if (!branch || !branch.isActive) throw badRequest('BRANCH_INACTIVE', `Branch '${branchId}' is invalid or deactivated.`);
};

const assertTaxRule = async (tx, branchId, taxTreatment, ruleId) => {
  if (taxTreatment !== 'SPECIFIC_RULE') return null;
  if (!ruleId) throw badRequest('TAX_RULE_REQUIRED', 'A specific tax rule must be selected when Tax Treatment is set to Specific Rule.');
  const rule = await tx.taxRule.findFirst({ where: { id: ruleId, OR: [{ branchId }, { branches: { some: { id: branchId } } }] } });
  if (!rule) throw badRequest('TAX_RULE_NOT_FOUND', 'Selected specific tax rule does not exist in this branch.');
  if (!rule.isActive) throw badRequest('TAX_RULE_INACTIVE', `Selected tax rule '${rule.name}' is currently deactivated.`);
  return ruleId;
};

/** The UI sends a category NAME; reuse the branch category or create it. */
const categoryIdFor = async (tx, branchId, name) => {
  const clean = (name || 'General').trim();
  const existing = await tx.serviceCategory.findFirst({ where: { branchId, name: { equals: clean, mode: 'insensitive' } } });
  if (existing) {
    if (!existing.isActive) await tx.serviceCategory.update({ where: { id: existing.id }, data: { isActive: true } });
    return existing.id;
  }
  return (await tx.serviceCategory.create({ data: { branchId, name: clean } })).id;
};

// ═══ CATEGORIES ═══════════════════════════════════════════════════════════════

export const listCategories = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const cats = await prisma.serviceCategory.findMany({ where: { ...(b ? { branchId: b } : {}), isActive: true }, orderBy: { name: 'asc' } });
  return cats.map(toCategoryDTO);
};

export const createCategory = async ({ branchId: requested, name }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot manage categories of another branch.');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceCategory.findFirst({ where: { branchId, name: { equals: name, mode: 'insensitive' } } });
    if (existing) {
      if (existing.isActive) throw conflict('CATEGORY_EXISTS', `Category '${name}' already exists.`);
      return toCategoryDTO(await tx.serviceCategory.update({ where: { id: existing.id }, data: { isActive: true } }));
    }
    const cat = await tx.serviceCategory.create({ data: { branchId, name } });
    await audit(tx, actor, 'SERVICE_CATEGORY_CREATED', 'ServiceCategory', cat.id, branchId, null, cat);
    return toCategoryDTO(cat);
  });
};

// ═══ SERVICES ═════════════════════════════════════════════════════════════════

export const listServices = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const services = await prisma.service.findMany({
    where: {
      ...(b ? { branchId: b } : {}),
      OR: [
        { description: null },
        {
          AND: [
            { NOT: { description: { startsWith: 'PACKAGE_EXCLUSIVE' } } },
            { NOT: { description: { startsWith: 'Auto-created' } } },
          ],
        },
      ],
    },
    include: serviceInclude,
    orderBy: { code: 'asc' },
  });
  return services.map(toServiceDTO);
};

export const getService = async (actor, id) => {
  const s = await prisma.service.findUnique({ where: { id }, include: serviceInclude });
  if (!s) return null;
  assertBranchAccess(actor, s.branchId, 'Access Denied: Cannot view service from another branch.');
  return toServiceDTO(s);
};

const generateNextServiceCode = async (tx) => nextSequence(tx, '', 'SVR');

const assertServiceCodeFree = async (tx, branchId, code, exceptId) => {
  const clash = await tx.service.findFirst({
    where: { branchId, code: { equals: code, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw conflict('SERVICE_CODE_TAKEN', `Service code '${code}' is already registered in this branch.`);
};

export const createService = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot create services for another branch.');
  return prisma.$transaction(async (tx) => {
    await assertActiveBranch(tx, branchId);
    const code = input.code && !/^(?:SRV|SVR)-\d+$/i.test(input.code.trim()) ? input.code.trim().toUpperCase() : await generateNextServiceCode(tx);
    await assertServiceCodeFree(tx, branchId, code);
    const specificTaxRuleId = await assertTaxRule(tx, branchId, input.taxTreatment, input.specificTaxRuleId);

    const s = await tx.service.create({
      data: {
        branchId,
        categoryId:      await categoryIdFor(tx, branchId, input.category),
        code,
        name:            input.name,
        description:     input.description || null,
        durationMinutes: input.durationMinutes,
        price:           round2(input.price),
        taxTreatment:    input.taxTreatment,
        specificTaxRuleId,
        isActive:        input.isActive ?? true,
      },
      include: serviceInclude,
    });
    await audit(tx, actor, 'SERVICE_CREATED', 'Service', s.id, branchId, null, s);
    return toServiceDTO(s);
  });
};

export const updateService = async (id, input, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.service.findUnique({ where: { id }, include: serviceInclude });
    if (!before) throw notFound('SERVICE_NOT_FOUND', `Service '${id}' not found.`);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot edit service from another branch.');
    await assertActiveBranch(tx, before.branchId);

    if (input.code) await assertServiceCodeFree(tx, before.branchId, input.code, id);
    const taxTreatment = input.taxTreatment ?? before.taxTreatment;
    const ruleId = input.specificTaxRuleId !== undefined ? input.specificTaxRuleId : before.specificTaxRuleId;
    const specificTaxRuleId = await assertTaxRule(tx, before.branchId, taxTreatment, ruleId);

    const data = { taxTreatment, specificTaxRuleId };
    for (const f of ['code', 'name', 'durationMinutes']) if (input[f] !== undefined) data[f] = input[f];
    if (input.price !== undefined) data.price = round2(input.price);
    if (input.description !== undefined) data.description = input.description || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.category) data.categoryId = await categoryIdFor(tx, before.branchId, input.category);

    const s = await tx.service.update({ where: { id }, data, include: serviceInclude });
    await audit(tx, actor, 'SERVICE_UPDATED', 'Service', id, s.branchId, before, s);
    return toServiceDTO(s);
  });
};

export const toggleService = async (id, actor) => {
  const s = await prisma.service.findUnique({ where: { id } });
  if (!s) throw notFound('SERVICE_NOT_FOUND', `Service '${id}' not found.`);
  return updateService(id, { isActive: !s.isActive }, actor);
};

// ═══ PACKAGES ═════════════════════════════════════════════════════════════════

/** Validates components (same branch, active services, weights total exactly 100%). */
const validateComponents = async (tx, branchId, components) => {
  const services = await tx.service.findMany({ where: { id: { in: components.map((c) => c.serviceId) } } });
  for (const c of components) {
    const srv = services.find((s) => s.id === c.serviceId);
    if (!srv) throw badRequest('COMPONENT_NOT_FOUND', `Component service '${c.serviceName || c.serviceId}' not found.`);
    if (srv.branchId !== branchId) throw badRequest('COMPONENT_BRANCH', `Component service '${srv.name}' belongs to a different branch.`);
    if (!srv.isActive) throw badRequest('COMPONENT_INACTIVE', `Cannot include deactivated service '${srv.name}' in package.`);
  }
  const hasAllocations = components.some((c) => c.allocationPercentage !== undefined && c.allocationPercentage !== null);
  if (hasAllocations) {
    const total = components.reduce((sum, c) => sum.plus(round2(c.allocationPercentage || 0)), toDec(0));
    if (!total.equals(100)) {
      throw badRequest('ALLOCATION_NOT_100', `Component allocation percentages must total exactly 100% (currently ${total.toNumber()}%).`);
    }
  }
};

const generateNextPackageCode = async (tx) => nextSequence(tx, '', 'PKG');

const assertPackageCodeFree = async (tx, branchId, code, exceptId) => {
  const clash = await tx.package.findFirst({
    where: { branchId, code: { equals: code, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw conflict('PACKAGE_CODE_TAKEN', `Package code '${code}' is already registered in this branch.`);
};

const componentRows = (components) => {
  const n = components.length;
  const hasValid = components.every((c) => c.allocationPercentage !== undefined && c.allocationPercentage !== null);
  const sumValid = hasValid ? components.reduce((s, c) => s.plus(round2(c.allocationPercentage)), toDec(0)) : toDec(0);
  const useSupplied = hasValid && sumValid.equals(100);

  const base = n > 0 ? toDec(Math.floor((100 / n) * 100) / 100) : toDec(0);
  let accumulated = toDec(0);

  return components.map((c, i) => {
    let alloc;
    if (useSupplied) {
      alloc = round2(c.allocationPercentage);
    } else if (i === n - 1) {
      alloc = round2(toDec(100).minus(accumulated));
    } else {
      alloc = base;
      accumulated = accumulated.plus(base);
    }
    return {
      serviceId: c.serviceId,
      quantity: c.quantity ?? 1,
      allocationPercentage: alloc,
      sortOrder: i,
    };
  });
};

export const listPackages = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const pkgs = await prisma.package.findMany({ where: b ? { branchId: b } : {}, include: packageInclude, orderBy: { code: 'asc' } });
  return pkgs.map(toPackageDTO);
};

export const getPackage = async (actor, id) => {
  const p = await prisma.package.findUnique({ where: { id }, include: packageInclude });
  if (!p) return null;
  assertBranchAccess(actor, p.branchId, 'Access Denied: Cannot view package from another branch.');
  return toPackageDTO(p);
};

export const createPackage = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot create packages for another branch.');
  return prisma.$transaction(async (tx) => {
    await assertActiveBranch(tx, branchId);
    const code = input.code && !/^(?:PKG)-\d+$/i.test(input.code.trim()) ? input.code.trim().toUpperCase() : await generateNextPackageCode(tx);
    await assertPackageCodeFree(tx, branchId, code);
    await validateComponents(tx, branchId, input.components);
    const specificTaxRuleId = await assertTaxRule(tx, branchId, input.taxTreatment, input.specificTaxRuleId);

    const p = await tx.package.create({
      data: {
        branchId,
        code,
        name:         input.name,
        description:  input.description || null,
        price:        round2(input.price),
        taxTreatment: input.taxTreatment,
        specificTaxRuleId,
        isActive:     input.isActive ?? true,
        components:   { create: componentRows(input.components) },
      },
      include: packageInclude,
    });
    await audit(tx, actor, 'PACKAGE_CREATED', 'Package', p.id, branchId, null, p);
    return toPackageDTO(p);
  });
};

export const updatePackage = async (id, input, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.package.findUnique({ where: { id }, include: packageInclude });
    if (!before) throw notFound('PACKAGE_NOT_FOUND', `Package '${id}' not found.`);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot edit package from another branch.');
    await assertActiveBranch(tx, before.branchId);

    if (input.code) await assertPackageCodeFree(tx, before.branchId, input.code, id);
    const taxTreatment = input.taxTreatment ?? before.taxTreatment;
    const ruleId = input.specificTaxRuleId !== undefined ? input.specificTaxRuleId : before.specificTaxRuleId;
    const specificTaxRuleId = await assertTaxRule(tx, before.branchId, taxTreatment, ruleId);

    const isActive = input.isActive ?? before.isActive;
    const components = input.components ?? before.components.map((c) => ({
      serviceId: c.serviceId, quantity: c.quantity, allocationPercentage: toDec(c.allocationPercentage).toNumber(),
    }));
    // Active packages must always be sellable (valid, active components totalling 100%).
    if (input.components || (isActive && !before.isActive)) await validateComponents(tx, before.branchId, components);

    const data = { taxTreatment, specificTaxRuleId, isActive };
    for (const f of ['code', 'name']) if (input[f] !== undefined) data[f] = input[f];
    if (input.price !== undefined) data.price = round2(input.price);
    if (input.description !== undefined) data.description = input.description || null;
    if (input.components) {
      await tx.packageComponent.deleteMany({ where: { packageId: id } });
      data.components = { create: componentRows(input.components) };
    }

    const p = await tx.package.update({ where: { id }, data, include: packageInclude });
    await audit(tx, actor, 'PACKAGE_UPDATED', 'Package', id, p.branchId, before, p);
    return toPackageDTO(p);
  });
};

export const togglePackage = async (id, actor) => {
  const p = await prisma.package.findUnique({ where: { id } });
  if (!p) throw notFound('PACKAGE_NOT_FOUND', `Package '${id}' not found.`);
  return updatePackage(id, { isActive: !p.isActive }, actor);
};

export const bulkImportServices = async ({ branchId: requested, rows }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot import services for another branch.');
  return prisma.$transaction(async (tx) => {
    await assertActiveBranch(tx, branchId);
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const details = [];

    const existing = await tx.service.findMany({ where: { branchId } });
    const seenCodes = new Set(existing.map((s) => s.code.toUpperCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const name = (row.name || '').trim();
        if (!name) {
          rejected++;
          details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: 'Service name is missing.' });
          continue;
        }

        const numPrice = Number(row.price);
        if (isNaN(numPrice) || numPrice < 0) {
          rejected++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: 'Price must be a non-negative number.' });
          continue;
        }

        let code = row.code && row.code.trim() ? row.code.trim().toUpperCase() : null;
        if (code) {
          if (seenCodes.has(code)) {
            duplicates++;
            details.push({ rowNumber: rowNum, name, code, status: 'DUPLICATE', reason: `Service code '${code}' already exists.` });
            continue;
          }
        } else {
          code = await generateNextServiceCode(tx);
        }
        seenCodes.add(code);

        const duration = row.durationMinutes ? Math.round(Number(row.durationMinutes)) : 30;
        const taxTreatment = row.taxTreatment || 'BRANCH_DEFAULT';
        const specificTaxRuleId = await assertTaxRule(tx, branchId, taxTreatment, row.specificTaxRuleId);
        const categoryId = await categoryIdFor(tx, branchId, row.category || 'General');

        const s = await tx.service.create({
          data: {
            branchId,
            categoryId,
            code,
            name,
            description: row.description?.trim() || null,
            durationMinutes: duration > 0 ? duration : 30,
            price: round2(numPrice),
            taxTreatment,
            specificTaxRuleId,
            isActive: row.isActive !== false,
          },
          include: serviceInclude,
        });

        accepted++;
        details.push({ rowNumber: rowNum, id: s.id, name: s.name, code: s.code, status: 'ACCEPTED' });
      } catch (err) {
        rejected++;
        details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: err.message });
      }
    }

    await auditLog(tx, {
      userId: actor.id,
      userName: actor.name,
      action: 'SERVICES_BULK_IMPORTED',
      entity: 'Service',
      entityId: 'bulk',
      branchId,
      after: { accepted, duplicates, rejected },
    });

    return { totalRows: rows.length, acceptedRows: accepted, duplicateRows: duplicates, rejectedRows: rejected, details };
  }, {
    maxWait: 10000,
    timeout: 60000,
  });
};

export const bulkImportPackages = async ({ branchId: requested, rows }, actor) => {
  const branchId = resolveWriteBranch(actor, requested, 'Access Denied: Cannot import packages for another branch.');
  return prisma.$transaction(async (tx) => {
    await assertActiveBranch(tx, branchId);
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const details = [];

    const branchServices = await tx.service.findMany({ where: { branchId } });
    const serviceById = new Map(branchServices.map((s) => [s.id, s]));
    const serviceByCode = new Map(branchServices.map((s) => [s.code.toUpperCase(), s]));
    const serviceByName = new Map(branchServices.map((s) => [s.name.trim().toLowerCase(), s]));

    const existingPkgs = await tx.package.findMany({ where: { branchId } });
    const seenCodes = new Set(existingPkgs.map((p) => p.code.toUpperCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const name = (row.name || '').trim();
        if (!name) {
          rejected++;
          details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: 'Package name is missing.' });
          continue;
        }

        const numPrice = Number(row.price);
        if (isNaN(numPrice) || numPrice < 0) {
          rejected++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: 'Price must be a non-negative number.' });
          continue;
        }

        let code = row.code && row.code.trim() ? row.code.trim().toUpperCase() : null;
        if (code) {
          if (seenCodes.has(code)) {
            duplicates++;
            details.push({ rowNumber: rowNum, name, code, status: 'DUPLICATE', reason: `Package code '${code}' already exists.` });
            continue;
          }
        } else {
          code = await generateNextPackageCode(tx);
        }
        seenCodes.add(code);

        let inputComponents = row.components;
        if ((!inputComponents || !Array.isArray(inputComponents) || inputComponents.length === 0) && row.services) {
          const rawTokens = Array.isArray(row.services)
            ? row.services
            : String(row.services)
                .split(/[,;\n\r]+/)
                .map((s) => s.trim())
                .filter(Boolean);

          inputComponents = rawTokens.map((rawToken) => {
            let sName = String(rawToken).trim();
            let qty = 1;
            const prefixMatch = sName.match(/^(\d+)\s*[xX*]\s*(.+)$/);
            if (prefixMatch) {
              qty = parseInt(prefixMatch[1], 10) || 1;
              sName = prefixMatch[2].trim();
            } else {
              const suffixMatch = sName.match(/^(.+?)\s*(?:[xX*:]|\()\s*(\d+)\s*\)?$/);
              if (suffixMatch) {
                sName = suffixMatch[1].trim();
                qty = parseInt(suffixMatch[2], 10) || 1;
              }
            }
            return { serviceName: sName, quantity: qty };
          });
        }

        if (!inputComponents || !Array.isArray(inputComponents) || inputComponents.length === 0) {
          rejected++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: 'Package must have at least one component service.' });
          continue;
        }

        const resolvedComponents = [];
        let compError = null;

        for (const c of inputComponents) {
          let srv = null;
          const targetName = (c.serviceName || c.serviceIdentifier || '').trim().toLowerCase();
          const targetCode = (c.serviceCode || c.serviceIdentifier || '').trim().toUpperCase();

          if (c.serviceId && serviceById.has(c.serviceId)) {
            srv = serviceById.get(c.serviceId);
          } else if (targetCode && serviceByCode.has(targetCode)) {
            srv = serviceByCode.get(targetCode);
          } else if (targetName && serviceByName.has(targetName)) {
            srv = serviceByName.get(targetName);
          } else if (targetName && serviceByCode.has(targetName.toUpperCase())) {
            srv = serviceByCode.get(targetName.toUpperCase());
          }

          if (!srv) {
            const rawServiceName = (c.serviceName || c.serviceCode || c.serviceIdentifier || '').trim();
            if (!rawServiceName) {
              compError = 'Component service name is missing.';
              break;
            }
            const sCode = await generateNextServiceCode(tx);
            const defaultCategoryId = await categoryIdFor(tx, branchId, 'General');
            srv = await tx.service.create({
              data: {
                branchId,
                categoryId: defaultCategoryId,
                code: sCode,
                name: rawServiceName,
                description: `PACKAGE_EXCLUSIVE`,
                durationMinutes: 30,
                price: round2(0),
                taxTreatment: 'BRANCH_DEFAULT',
                isActive: true,
              },
              include: serviceInclude,
            });
            serviceById.set(srv.id, srv);
            serviceByCode.set(srv.code.toUpperCase(), srv);
            serviceByName.set(srv.name.trim().toLowerCase(), srv);
          }

          if (!srv.isActive) {
            await tx.service.update({ where: { id: srv.id }, data: { isActive: true } });
            srv.isActive = true;
          }

          resolvedComponents.push({
            serviceId: srv.id,
            serviceName: srv.name,
            quantity: c.quantity ? Number(c.quantity) : 1,
            allocationPercentage: c.allocationPercentage !== undefined && c.allocationPercentage !== '' ? Number(c.allocationPercentage) : undefined,
          });
        }

        if (compError) {
          rejected++;
          details.push({ rowNumber: rowNum, name, status: 'REJECTED', reason: compError });
          continue;
        }

        await validateComponents(tx, branchId, resolvedComponents);
        const taxTreatment = row.taxTreatment || 'BRANCH_DEFAULT';
        const specificTaxRuleId = await assertTaxRule(tx, branchId, taxTreatment, row.specificTaxRuleId);

        const p = await tx.package.create({
          data: {
            branchId,
            code,
            name,
            description: row.description?.trim() || null,
            price: round2(numPrice),
            taxTreatment,
            specificTaxRuleId,
            isActive: row.isActive !== false,
            components: { create: componentRows(resolvedComponents) },
          },
          include: packageInclude,
        });

        accepted++;
        details.push({ rowNumber: rowNum, id: p.id, name: p.name, code: p.code, status: 'ACCEPTED' });
      } catch (err) {
        rejected++;
        details.push({ rowNumber: rowNum, name: row.name, status: 'REJECTED', reason: err.message });
      }
    }

    await auditLog(tx, {
      userId: actor.id,
      userName: actor.name,
      action: 'PACKAGES_BULK_IMPORTED',
      entity: 'Package',
      entityId: 'bulk',
      branchId,
      after: { accepted, duplicates, rejected },
    });

    return { totalRows: rows.length, acceptedRows: accepted, duplicateRows: duplicates, rejectedRows: rejected, details };
  }, {
    maxWait: 10000,
    timeout: 60000,
  });
};

