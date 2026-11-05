// src/modules/inventory/inventory.service.js
// Items, batches (cost layers), suppliers + payable ledger, purchases (landed cost), supplier
// returns, manual stock-out, physical stock count, summary and COGS. Spec §5–§6.
//
// Accounting rules enforced here:
//   • Purchases and supplier payments are NOT expense and NOT COGS (stock is an asset).
//   • Quantity changes only through StockMovement rows (see src/lib/stock.js).
//   • Supplier payable = Σ ledger credit − Σ ledger debit; a negative value is an advance (not clamped).

import prisma from '../../config/prisma.js';
import { paymentPosting } from '../../lib/paymentPosting.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, startOfDay, endOfDay } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { consumeStock, postStockMovement, previewBatchPicks, reverseStockMovement, qty } from '../../lib/stock.js';
import { getActiveDrawer, postCashMovement, postAccountMovement } from '../cash/cash.service.js';
import {
  toItemDTO, toBatchDTO, deriveBatchStatus, toSupplierDTO, toLedgerEntryDTO, toPurchaseDTO,
  toSupplierPaymentDTO, toSupplierReturnDTO, toMovementDTO, toStockSettlementDTO,
} from './inventory.mapper.js';

const audit = (tx, actor, action, entity, entityId, branchId, after) =>
  auditLog(tx, { userId: actor.id, userName: actor.name, action, entity, entityId, branchId, after });

const activeBranch = async (tx, branchId) => {
  const b = await tx.branch.findUnique({ where: { id: branchId } });
  if (!b || !b.isActive) throw badRequest('BRANCH_INACTIVE', `Branch '${branchId}' is invalid or deactivated.`);
  return b;
};

const availableIn = (item, branchId) => item.branchAvailability.includes('ALL') || item.branchAvailability.includes(branchId);

const accountName = async (tx, id) => (id ? (await tx.paymentAccount.findUnique({ where: { id } }))?.name : undefined);

// ═══ ITEMS ════════════════════════════════════════════════════════════════════

export const listItems = async (actor, { branchId, itemType, category, search, isActive } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const items = await prisma.inventoryItem.findMany({
    where: {
      ...(itemType ? { itemType } : {}),
      ...(category && category !== 'ALL' ? { category } : {}),
      ...(isActive !== undefined ? { isActive: isActive === 'true' || isActive === true } : {}),
      ...(search ? {
        OR: ['name', 'sku', 'barcode', 'brand'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } })),
      } : {}),
    },
    orderBy: { sku: 'asc' },
  });
  return items.filter((i) => !b || availableIn(i, b)).map(toItemDTO);
};

export const getItem = async (id) => {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) throw notFound('ITEM_NOT_FOUND', `Inventory item '${id}' not found.`);
  return toItemDTO(item);
};

const itemData = (input) => {
  const data = {};
  for (const f of ['barcode', 'name', 'category', 'description', 'brand', 'imageUrl', 'itemType', 'purchaseUnit', 'issueUnit',
    'taxTreatment', 'specificTaxRuleId', 'trackBatch', 'trackExpiry', 'nearExpiryAlertDays', 'isActive']) {
    if (input[f] !== undefined) data[f] = input[f];
  }
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.defaultPurchaseCost !== undefined) data.defaultPurchaseCost = round2(input.defaultPurchaseCost);
  if (input.itemType === 'SALON_CONSUMABLE') {
    data.sellingPrice = round2(0);
  } else if (input.sellingPrice !== undefined) {
    data.sellingPrice = round2(input.sellingPrice);
  }
  if (input.minStockLevel !== undefined) data.minStockLevel = Math.max(0, input.minStockLevel);
  if (input.unitConversionRatio !== undefined) data.unitConversionRatio = input.unitConversionRatio || null;
  if (input.branchAvailability !== undefined) data.branchAvailability = input.branchAvailability.length ? input.branchAvailability : ['ALL'];
  return data;
};

const generateNextSku = async (tx) => nextSequence(tx, '', 'SKU');

export const createItem = async (input, actor) =>
  prisma.$transaction(async (tx) => {
    const sku = input.sku && !/^SKU-\d+$/i.test(input.sku.trim()) ? input.sku.trim().toUpperCase() : await generateNextSku(tx);
    if (await tx.inventoryItem.findFirst({ where: { sku: { equals: sku, mode: 'insensitive' } } })) {
      throw conflict('SKU_TAKEN', `An inventory item with SKU '${sku}' already exists.`);
    }
    const item = await tx.inventoryItem.create({
      data: { branchAvailability: ['ALL'], ...itemData(input), sku, name: input.name, category: input.category || 'General', itemType: input.itemType },
    });
    await audit(tx, actor, 'INVENTORY_ITEM_CREATED', 'InventoryItem', item.id, null, item);

    const openingQty = Number(input.openingStock ?? input.openingQuantity ?? 0);
    if (openingQty > 0) {
      const branchId = input.branchId || actor.branchId || (await tx.branch.findFirst({ select: { id: true } }))?.id;
      if (branchId) {
        const branch = await tx.branch.findUnique({ where: { id: branchId } });
        if (branch) {
          const unitCost = input.openingCost !== undefined && input.openingCost !== null && !isNaN(Number(input.openingCost))
            ? Number(input.openingCost)
            : (Number(item.defaultPurchaseCost) || 0);

          let supplierName = null;
          if (input.supplierId) {
            const supp = await tx.supplier.findUnique({ where: { id: input.supplierId } });
            if (supp) supplierName = supp.name;
          }

          const batchNumber = await nextSequence(tx, '', 'BAT');
          const batch = await tx.inventoryBatch.create({
            data: {
              itemId: item.id,
              branchId: branch.id,
              batchNumber,
              supplierId: input.supplierId || null,
              supplierName: supplierName || null,
              receivedDate: new Date(),
              initialQuantity: openingQty,
              remainingQuantity: 0,
              unitCost,
              sellingPrice: item.sellingPrice, priceSource: 'STOCK_IN',
            },
          });

          await postStockMovement(tx, {
            branchCode: branch.code,
            branchId: branch.id,
            itemId: item.id,
            batch,
            movementType: 'OPENING_STOCK',
            quantity: openingQty,
            unitCost,
            sourceReferenceType: 'OPENING',
            sourceReferenceId: batch.id,
            sourceReferenceNumber: `OPN-${batch.batchNumber}`,
            reason: 'Opening stock balance on product creation',
            actor,
          });
        }
      }
    }

    return toItemDTO(item);
  });

export const updateItem = async (id, input, actor) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.inventoryItem.findUnique({ where: { id } });
    if (!before) throw notFound('ITEM_NOT_FOUND', `Inventory item '${id}' not found.`);
    if (input.sku && (await tx.inventoryItem.findFirst({ where: { sku: { equals: input.sku, mode: 'insensitive' }, NOT: { id } } }))) {
      throw conflict('SKU_TAKEN', `Another inventory item with SKU '${input.sku}' already exists.`);
    }
    const targetType = input.itemType ?? before.itemType;
    const patch = itemData(input);
    if (targetType === 'SALON_CONSUMABLE') {
      patch.sellingPrice = round2(0);
    }
    const item = await tx.inventoryItem.update({ where: { id }, data: patch });
    await audit(tx, actor, 'INVENTORY_ITEM_UPDATED', 'InventoryItem', id, null, item);
    return toItemDTO(item);
  });

export const archiveItem = (id, isActive, actor) => updateItem(id, { isActive }, actor);

// ═══ STOCK LEVELS & BATCHES ═══════════════════════════════════════════════════

export const stockSnapshots = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const today = await getBusinessDate();
  const [items, branches, batches] = await Promise.all([
    prisma.inventoryItem.findMany({ orderBy: { sku: 'asc' } }),
    prisma.branch.findMany({ where: b ? { id: b } : {}, orderBy: { createdAt: 'asc' } }),
    prisma.inventoryBatch.findMany({ where: b ? { branchId: b } : {} }),
  ]);
  const out = [];
  for (const br of branches) {
    for (const item of items) {
      if (!availableIn(item, br.id)) continue;
      const own = batches.filter((x) => x.itemId === item.id && x.branchId === br.id);
      let stock = toDec(0);
      let value = toDec(0);
      const counts = { VALID: 0, NEAR_EXPIRY: 0, EXPIRED: 0 };
      for (const x of own) {
        stock = stock.plus(x.remainingQuantity);
        value = value.plus(toDec(x.remainingQuantity).times(x.unitCost));
        const st = deriveBatchStatus(x, today, item.nearExpiryAlertDays);
        if (st in counts) counts[st] += 1;
      }
      const current = stock.toNumber();
      const min = toDec(item.minStockLevel).toNumber();
      out.push({
        itemId: item.id, itemName: item.name, sku: item.sku, category: item.category, itemType: item.itemType, branchId: br.id,
        currentStock: current, minStockLevel: min,
        isLowStock: current <= min && current > 0, isOutOfStock: current <= 0,
        valuationCostBasis: round2(value).toNumber(),
        potentialRetailValue: item.itemType === 'SALON_CONSUMABLE' ? 0 : round2(own.reduce((sum, batch) => sum.plus(toDec(batch.remainingQuantity).times(batch.sellingPrice ?? item.sellingPrice)), toDec(0))).toNumber(),
        validBatchesCount: counts.VALID, nearExpiryBatchesCount: counts.NEAR_EXPIRY, expiredBatchesCount: counts.EXPIRED,
      });
    }
  }
  return out;
};

export const itemStock = async (actor, itemId, branchId) => {
  const b = resolveWriteBranch(actor, branchId);
  const today = await getBusinessDate();
  const batches = await prisma.inventoryBatch.findMany({
    where: { itemId, branchId: b, remainingQuantity: { gt: 0 } }, include: { item: true }, orderBy: { receivedDate: 'asc' },
  });
  let current = toDec(0);
  let valid = toDec(0);
  for (const x of batches) {
    current = current.plus(x.remainingQuantity);
    if (x.status !== 'QUARANTINED' && !(x.expiryDate && x.expiryDate < dateOnly(today))) valid = valid.plus(x.remainingQuantity);
  }
  return { currentStock: current.toNumber(), validStock: valid.toNumber(), batches: batches.map((x) => toBatchDTO(x, today)) };
};

export const listBatches = async (actor, { branchId, itemId } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const today = await getBusinessDate();
  const batches = await prisma.inventoryBatch.findMany({
    where: { ...(b ? { branchId: b } : {}), ...(itemId ? { itemId } : {}) },
    include: { item: true },
    orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
  });
  return batches.map((x) => toBatchDTO(x, today));
};

const setBatchQuarantine = async (actor, batchId, reason) =>
  prisma.$transaction(async (tx) => {
    const batch = await tx.inventoryBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw notFound('BATCH_NOT_FOUND', `Batch '${batchId}' not found.`);
    assertBranchAccess(actor, batch.branchId, 'Access Denied: Cannot modify batches from another branch.');
    const updated = await tx.inventoryBatch.update({
      where: { id: batchId },
      data: reason === null ? { status: 'VALID', quarantinedReason: null } : { status: 'QUARANTINED', quarantinedReason: reason },
      include: { item: true },
    });
    await audit(tx, actor, reason === null ? 'BATCH_RELEASED' : 'BATCH_QUARANTINED', 'InventoryBatch', batchId, batch.branchId, { reason });
    return toBatchDTO(updated, await getBusinessDate(tx));
  });

export const quarantineBatch = (actor, batchId, reason) => setBatchQuarantine(actor, batchId, reason);
export const releaseBatch = (actor, batchId) => setBatchQuarantine(actor, batchId, null);

// ═══ SUPPLIERS & LEDGER ═══════════════════════════════════════════════════════

/** Derived payable totals per supplier (optionally limited to one branch). */
const supplierTotals = async (tx, supplierIds, branchId) => {
  const rows = await tx.supplierLedger.groupBy({
    by: ['supplierId', 'entryType'],
    where: { supplierId: { in: supplierIds }, ...(branchId ? { branchId } : {}) },
    _sum: { debit: true, credit: true },
  });
  const totals = new Map(supplierIds.map((id) => [id, { currentPayable: 0, totalPurchases: 0, totalPayments: 0, totalReturns: 0 }]));
  for (const r of rows) {
    const t = totals.get(r.supplierId);
    const credit = toDec(r._sum.credit ?? 0);
    const debit = toDec(r._sum.debit ?? 0);
    t.currentPayable = round2(toDec(t.currentPayable).plus(credit).minus(debit)).toNumber();
    if (['PURCHASE_BILL', 'PURCHASE_CREDIT'].includes(r.entryType)) t.totalPurchases = round2(toDec(t.totalPurchases).plus(credit)).toNumber();
    if (r.entryType === 'SUPPLIER_PAYMENT') t.totalPayments = round2(toDec(t.totalPayments).plus(debit).minus(credit)).toNumber();
    if (r.entryType === 'PURCHASE_RETURN') t.totalReturns = round2(toDec(t.totalReturns).plus(debit)).toNumber();
  }
  return totals;
};

const supplierDTOs = async (tx, suppliers, branchId) => {
  const totals = await supplierTotals(tx, suppliers.map((s) => s.id), branchId);
  return suppliers.map((s) => toSupplierDTO(s, totals.get(s.id)));
};

const supplierVisibleTo = (s, branchId) => !branchId || s.branchId === 'ALL' || s.branchId === branchId;

export const listSuppliers = async (actor, { branchId, search } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const suppliers = await prisma.supplier.findMany({
    where: {
      ...(b ? { branchId: { in: ['ALL', b] } } : {}),
      ...(search ? {
        OR: ['name', 'supplierCode', 'phone', 'contactPerson'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } })),
      } : {}),
    },
    orderBy: { supplierCode: 'asc' },
  });
  return supplierDTOs(prisma, suppliers, b);
};

const loadSupplier = async (tx, actor, id) => {
  const s = await tx.supplier.findUnique({ where: { id } });
  if (!s) throw notFound('SUPPLIER_NOT_FOUND', `Supplier '${id}' not found.`);
  if (actor.role !== 'SUPER_ADMIN' && !supplierVisibleTo(s, actor.branchId)) {
    throw forbidden('BRANCH_FORBIDDEN', 'Access Denied: Supplier belongs to another branch.');
  }
  return s;
};

export const getSupplier = async (actor, id) => {
  const s = await loadSupplier(prisma, actor, id);
  return (await supplierDTOs(prisma, [s], resolveReadBranch(actor)))[0];
};

const nextSupplierCode = async (tx) => nextSequence(tx, '', 'SUP');

export const createSupplier = async (input, actor) => {
  const branchId = actor.role === 'SUPER_ADMIN' ? input.branchId || 'ALL' : input.branchId === 'ALL' ? 'ALL' : actor.branchId;
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        supplierCode: await nextSupplierCode(tx), name: input.name, companyName: input.companyName || null, phone: input.phone,
        email: input.email || null, contactPerson: input.contactPerson || null, address: input.address || null,
        taxNumber: input.taxNumber || null, notes: input.notes || null, branchId,
        openingPayable: round2(input.openingPayable || 0), createdById: actor.id, createdByName: actor.name,
      },
    });
    if (toDec(supplier.openingPayable).greaterThan(0)) {
      await tx.supplierLedger.create({
        data: {
          supplierId: supplier.id, branchId: branchId === 'ALL' ? actor.branchId || 'ALL' : branchId, date: dateOnly(await getBusinessDate(tx)),
          entryType: 'OPENING_BALANCE', referenceType: 'OPENING', referenceId: supplier.id, referenceNumber: `OPN-${supplier.supplierCode}`,
          description: 'Authorized Opening Payable Balance', credit: supplier.openingPayable, userId: actor.id, userName: actor.name,
        },
      });
    }
    await audit(tx, actor, 'SUPPLIER_CREATED', 'Supplier', supplier.id, branchId === 'ALL' ? null : branchId, supplier);
    return (await supplierDTOs(tx, [supplier]))[0];
  });
};

export const updateSupplier = async (id, input, actor) =>
  prisma.$transaction(async (tx) => {
    await loadSupplier(tx, actor, id);
    const data = {};
    for (const f of ['name', 'companyName', 'phone', 'email', 'contactPerson', 'address', 'taxNumber', 'notes', 'isActive']) {
      if (input[f] !== undefined) data[f] = input[f] === '' ? null : input[f];
    }
    // Opening payable is a ledger fact — it is never edited after creation.
    const s = await tx.supplier.update({ where: { id }, data });
    await audit(tx, actor, 'SUPPLIER_UPDATED', 'Supplier', id, null, data);
    return (await supplierDTOs(tx, [s]))[0];
  });

export const archiveSupplier = (id, isActive, actor) => updateSupplier(id, { isActive }, actor);

export const supplierLedger = async (actor, supplierId, { branchId, startDate, endDate } = {}) => {
  const s = await loadSupplier(prisma, actor, supplierId);
  const b = resolveReadBranch(actor, branchId);
  const entries = await prisma.supplierLedger.findMany({
    where: { supplierId, ...(b ? { branchId: b } : {}) },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  let running = toDec(0);
  let opening = toDec(0);
  const totals = { purchases: toDec(0), payments: toDec(0), returns: toDec(0) };
  const out = [];
  for (const e of entries) {
    running = running.plus(e.credit).minus(e.debit);
    const d = e.date.toISOString().slice(0, 10);
    if (startDate && d < startDate) { opening = running; continue; }
    if (endDate && d > endDate) continue;
    if (['PURCHASE_BILL', 'PURCHASE_CREDIT'].includes(e.entryType)) totals.purchases = totals.purchases.plus(e.credit);
    if (e.entryType === 'SUPPLIER_PAYMENT') totals.payments = totals.payments.plus(e.debit).minus(e.credit);
    if (e.entryType === 'PURCHASE_RETURN') totals.returns = totals.returns.plus(e.debit);
    out.push(toLedgerEntryDTO(e, s.name, running));
  }
  return {
    entries: out,
    openingPayable: opening.toNumber(),
    closingPayable: running.toNumber(),
    totalPurchases: totals.purchases.toNumber(),
    totalPayments: totals.payments.toNumber(),
    totalReturns: totals.returns.toNumber(),
  };
};

/** Money out for a supplier: cash from the actor's own open drawer, or a named bank account. */
const payOut = async (tx, actor, { branchId, method, paymentAccountId, amount, reference, description, sourceId, transactionDate }) => {
  const common = { type: 'SUPPLIER_PAYMENT', direction: 'OUT', amount, sourceModule: 'INVENTORY', sourceId, reference, description, actor, transactionDate };
  if (method === 'CASH') {
    const drawer = await getActiveDrawer(tx, actor, branchId, { autoOpen: false });
    await postCashMovement(tx, { ...common, holderId: drawer.id });
    return { cashDrawerId: drawer.id, paymentAccountId: null };
  }
  if (!paymentAccountId) throw badRequest('ACCOUNT_REQUIRED', 'Select a branch payment account.');
  await postAccountMovement(tx, { ...common, accountId: paymentAccountId, branchId });
  return { cashDrawerId: null, paymentAccountId };
};

export const paySupplier = async (input, actor, request) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot pay suppliers for another branch.');
  const method = input.method ?? (input.paymentMethod === 'CASH' ? 'CASH' : 'ONLINE');
  const amount = round2(input.amount);
  return paymentPosting(actor, request, async (tx) => {
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) throw badRequest('INVALID_AMOUNT', 'Payment amount must be positive.');
    if (!['CASH', 'ONLINE'].includes(method) || !input.paymentDate) throw badRequest('PAYMENT_REQUIRED', 'Payment date and method are required.');
    await tx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${input.supplierId} FOR UPDATE`;
    const branch = await activeBranch(tx, branchId);
    const supplier = await loadSupplier(tx, actor, input.supplierId);
    if (!supplier.isActive) throw badRequest('SUPPLIER_INACTIVE', `Supplier '${supplier.name}' is deactivated.`);

    const payable = (await supplierTotals(tx, [supplier.id], branchId)).get(supplier.id).currentPayable;
    if (amount.greaterThan(payable)) throw badRequest('OVERPAYMENT', 'Payment exceeds the outstanding supplier payable in this branch.');
    const paymentDate = dateOnly(input.paymentDate);
    const purchases = await tx.purchase.findMany({ where: { supplierId: supplier.id, branchId, balanceDue: { gt: 0 } }, orderBy: [{ purchaseDate: 'asc' }, { id: 'asc' }] });
    let unallocated = amount;
    const allocations = [];
    for (const purchase of purchases) {
      if (unallocated.isZero()) break;
      const allocated = round2(toDec(purchase.balanceDue).lessThan(unallocated) ? purchase.balanceDue : unallocated);
      const due = round2(toDec(purchase.balanceDue).minus(allocated));
      await tx.purchase.update({ where: { id: purchase.id }, data: { paidAmount: round2(toDec(purchase.paidAmount).plus(allocated)), balanceDue: due, paymentStatus: due.isZero() ? 'PAID' : 'PARTIAL' } });
      allocations.push({ purchaseId: purchase.id, invoiceNumber: purchase.purchaseNumber, amount: allocated.toNumber() });
      unallocated = round2(unallocated.minus(allocated));
    }
    if (unallocated.greaterThan(0)) allocations.push({ purchaseId: null, invoiceNumber: 'Opening payable', amount: unallocated.toNumber() });
    const paymentNumber = await nextSequence(tx, branch.code, 'SP');
    const paidFrom = await payOut(tx, actor, {
      branchId, method, paymentAccountId: input.paymentAccountId, amount, reference: paymentNumber,
      description: `Supplier payment to ${supplier.name}`, transactionDate: paymentDate,
    });
    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber, supplierId: supplier.id, branchId, paymentDate, amount, method, ...paidFrom, allocations,
        reference: input.reference || null, notes: input.notes || null, paidById: actor.id, paidByName: actor.name,
      },
    });
    const entry = await tx.supplierLedger.create({
      data: {
        supplierId: supplier.id, branchId, date: paymentDate, entryType: 'SUPPLIER_PAYMENT', referenceType: 'PAYMENT',
        referenceId: payment.id, referenceNumber: paymentNumber,
        description: `Payment via ${method}: ${paymentNumber}${input.reference ? ` (${input.reference})` : ''}`,
        debit: amount, userId: actor.id, userName: actor.name,
      },
    });
    await tx.drawerMovement.updateMany({ where: { reference: paymentNumber }, data: { sourceId: payment.id } });
    await tx.accountMovement.updateMany({ where: { reference: paymentNumber }, data: { sourceId: payment.id } });
    await audit(tx, actor, 'SUPPLIER_PAID', 'SupplierPayment', payment.id, branchId, { paymentNumber, amount: amount.toNumber(), method });

    const updatedPayable = (await supplierTotals(tx, [supplier.id], branchId)).get(supplier.id).currentPayable;
    return {
      payment: toSupplierPaymentDTO(payment, supplier.name, await accountName(tx, payment.paymentAccountId)),
      ledgerEntry: toLedgerEntryDTO(entry, supplier.name, updatedPayable),
      updatedPayable,
    };
  });
};

// ═══ PURCHASES (stock in) ═════════════════════════════════════════════════════

/**
 * Landed cost (spec §5.1): line net = qty × price − line discount; the header discount is
 * allocated to lines in proportion to line net; landed unit cost = landed line / qty.
 */
const landedCosts = (lines, headerDiscount) => {
  const nets = lines.map((l) => round2(toDec(l.quantity).times(l.unitPurchaseCost).minus(l.lineDiscount || 0)));
  const total = nets.reduce((s, n) => s.plus(n), toDec(0));
  const discount = round2(headerDiscount || 0);
  let allocated = toDec(0);
  return nets.map((net, i) => {
    const share = i === nets.length - 1
      ? discount.minus(allocated) // last line absorbs the rounding remainder so Σ shares = header discount
      : total.isZero() ? toDec(0) : round2(discount.times(net).dividedBy(total));
    allocated = allocated.plus(share);
    const landedLine = net.minus(share);
    return { net, landedUnitCost: landedLine.dividedBy(lines[i].quantity).toDecimalPlaces(4) };
  });
};

export const listPurchases = async (actor, { branchId, startDate, endDate } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const purchases = await prisma.purchase.findMany({
    where: {
      ...(b ? { branchId: b } : {}),
      ...(startDate || endDate ? { purchaseDate: { ...(startDate ? { gte: dateOnly(startDate) } : {}), ...(endDate ? { lte: dateOnly(endDate) } : {}) } } : {}),
    },
    include: { lines: true },
    orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
  });
  const accounts = await prisma.paymentAccount.findMany({ select: { id: true, name: true } });
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return purchases.map((p) => toPurchaseDTO(p, names.get(p.paymentAccountId)));
};

export const getPurchase = async (actor, id) => {
  const p = await prisma.purchase.findUnique({ where: { id }, include: { lines: true } });
  if (!p) throw notFound('PURCHASE_NOT_FOUND', `Purchase '${id}' not found.`);
  assertBranchAccess(actor, p.branchId);
  return toPurchaseDTO(p, await accountName(prisma, p.paymentAccountId));
};

export const createPurchase = async (input, actor, request) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot post purchases for another branch.');
  return paymentPosting(actor, request, async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${input.supplierId} FOR UPDATE`;
    const branch = await activeBranch(tx, branchId);
    const supplier = await loadSupplier(tx, actor, input.supplierId);
    if (!supplier.isActive) throw badRequest('SUPPLIER_INACTIVE', `Supplier '${supplier.name}' is invalid or deactivated.`);
    if (!supplierVisibleTo(supplier, branchId)) throw badRequest('SUPPLIER_BRANCH', 'Supplier is not registered for this branch.');

    const items = await tx.inventoryItem.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
    const lines = input.lines.map((l, i) => {
      const item = items.find((x) => x.id === l.itemId);
      if (!item || !item.isActive) throw badRequest('ITEM_INVALID', `Line ${i + 1}: Item '${l.itemId}' is invalid or deactivated.`);
      if (!availableIn(item, branchId)) throw badRequest('ITEM_NOT_IN_BRANCH', `Line ${i + 1}: '${item.name}' is not enabled for this branch.`);
      if (item.trackExpiry && !l.expiryDate) throw badRequest('EXPIRY_REQUIRED', `Line ${i + 1}: Item '${item.name}' requires an expiry date.`);
      return { ...l, item, unitPurchaseCost: l.unitPurchaseCost ?? l.unitCost };
    });

    const costs = landedCosts(lines, input.discount);
    const subtotal = costs.reduce((s, c) => s.plus(c.net), toDec(0));
    const discount = round2(input.discount || 0);
    if (discount.greaterThan(subtotal)) throw badRequest('DISCOUNT_TOO_LARGE', 'Purchase discount cannot exceed the purchase subtotal.');
    const netAmount = round2(subtotal.minus(discount));

    let paid = toDec(0);
    const requested = input.paidAmount ?? input.partialPaidAmount;
    if (input.paymentMethod === 'CASH' || input.paymentMethod === 'ONLINE') paid = requested !== undefined ? round2(requested) : netAmount;
    else if (input.paymentMethod === 'PARTIAL') {
      paid = round2(requested || 0);
      if (paid.lessThanOrEqualTo(0) || paid.greaterThanOrEqualTo(netAmount)) {
        throw badRequest('INVALID_PARTIAL', 'Partial payment must be more than zero and less than the purchase total.');
      }
    }
    if (paid.greaterThan(netAmount)) throw badRequest('OVERPAYMENT', 'Paid amount cannot exceed the purchase total.');
    const balanceDue = round2(netAmount.minus(paid));
    const paymentStatus = balanceDue.isZero() ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : 'UNPAID';

    const purchaseNumber = await nextSequence(tx, branch.code, 'PO');
    const purchaseDate = dateOnly(input.purchaseDate || (await getBusinessDate(tx)));

    let paidFrom = { cashDrawerId: null, paymentAccountId: null };
    if (paid.greaterThan(0)) {
      const method = input.paymentMethod === 'CASH' || (input.paymentMethod === 'PARTIAL' && !input.paymentAccountId) ? 'CASH' : 'ONLINE';
      paidFrom = await payOut(tx, actor, {
        branchId, method, paymentAccountId: input.paymentAccountId, amount: paid, reference: purchaseNumber,
        description: `Upfront payment for ${purchaseNumber} (${supplier.name})`, transactionDate: purchaseDate,
      });
    }

    const purchase = await tx.purchase.create({
      data: {
        purchaseNumber, branchId, supplierId: supplier.id, supplierName: supplier.name, purchaseDate,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? input.supplierInvoiceNo ?? input.invoiceNumber ?? null,
        notes: input.notes || null, subtotal, discount, netAmount, paidAmount: paid, balanceDue,
        paymentMethod: input.paymentMethod, paymentStatus, ...paidFrom, createdById: actor.id, createdByName: actor.name,
      },
    });

    for (const [i, l] of lines.entries()) {
      // Every purchase line is its own cost layer — never merged with an older batch.
      const batch = await tx.inventoryBatch.create({
        data: {
          itemId: l.item.id, branchId, batchNumber: l.batchNumber?.trim() || await nextSequence(tx, '', 'BAT'),
          purchaseId: purchase.id, purchaseNumber, supplierId: supplier.id, supplierName: supplier.name,
          receivedDate: purchaseDate, mfgDate: l.mfgDate ? dateOnly(l.mfgDate) : null, expiryDate: l.expiryDate ? dateOnly(l.expiryDate) : null,
          initialQuantity: qty(l.quantity), remainingQuantity: 0, unitCost: costs[i].landedUnitCost,
          sellingPrice: round2(l.item.itemType === 'SALON_CONSUMABLE' ? 0 : (l.sellingPrice ?? l.item.sellingPrice)), priceSource: 'STOCK_IN',
        },
      });
      await postStockMovement(tx, {
        branchCode: branch.code, branchId, itemId: l.item.id, batch, movementType: 'PURCHASE_IN', quantity: l.quantity,
        unitCost: costs[i].landedUnitCost, sourceReferenceType: 'PURCHASE', sourceReferenceId: purchase.id,
        sourceReferenceNumber: purchaseNumber, reason: `Stock receipt from ${purchaseNumber}`, actor,
      });
      await tx.purchaseLine.create({
        data: {
          purchaseId: purchase.id, sortOrder: i, itemId: l.item.id, itemName: l.item.name, itemSku: l.item.sku,
          quantity: qty(l.quantity), unitPurchaseCost: round2(l.unitPurchaseCost), lineDiscount: round2(l.lineDiscount || 0),
          lineTotal: costs[i].net, landedUnitCost: costs[i].landedUnitCost, batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate, mfgDate: batch.mfgDate, batchId: batch.id,
        },
      });

      // The Product Master remains a default; receipt prices belong to this batch.
    }

    const ledgerBase = { supplierId: supplier.id, branchId, date: purchaseDate, referenceType: 'PURCHASE', referenceId: purchase.id, referenceNumber: purchaseNumber, userId: actor.id, userName: actor.name };
    await tx.supplierLedger.create({
      data: {
        ...ledgerBase, entryType: 'PURCHASE_BILL', credit: netAmount,
        description: `Purchase: ${purchaseNumber}${purchase.supplierInvoiceNumber ? ` (Inv #${purchase.supplierInvoiceNumber})` : ''}`,
      },
    });
    let paymentId = purchase.id;
    if (paid.greaterThan(0)) {
      const initialPayment = await tx.supplierPayment.create({ data: {
        paymentNumber: purchaseNumber, supplierId: supplier.id, branchId, paymentDate: purchaseDate, amount: paid,
        method: paidFrom.cashDrawerId ? 'CASH' : 'ONLINE', ...paidFrom, paidById: actor.id, paidByName: actor.name, notes: input.notes || null,
        allocations: [{ purchaseId: purchase.id, invoiceNumber: purchaseNumber, amount: paid.toNumber() }],
      } });
      paymentId = initialPayment.id;
      await tx.supplierLedger.create({
        data: { ...ledgerBase, referenceType: 'PAYMENT', referenceId: paymentId, entryType: 'SUPPLIER_PAYMENT', debit: paid, description: `Upfront Payment at Purchase (${input.paymentMethod}): ${purchaseNumber}` },
      });
    }
    await tx.drawerMovement.updateMany({ where: { reference: purchaseNumber }, data: { sourceId: paymentId } });
    await tx.accountMovement.updateMany({ where: { reference: purchaseNumber }, data: { sourceId: paymentId } });
    await audit(tx, actor, 'PURCHASE_POSTED', 'Purchase', purchase.id, branchId, { purchaseNumber, netAmount: netAmount.toNumber(), paid: paid.toNumber() });

    const full = await tx.purchase.findUnique({ where: { id: purchase.id }, include: { lines: true } });
    return toPurchaseDTO(full, await accountName(tx, full.paymentAccountId));
  });
};

// ═══ SUPPLIER RETURNS ═════════════════════════════════════════════════════════

export const listReturns = async (actor, { branchId } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.supplierReturn.findMany({
    where: b ? { branchId: b } : {}, include: { lines: true, supplier: true }, orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => toSupplierReturnDTO(r, r.supplier.name));
};

export const createReturn = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot post supplier returns for another branch.');
  const treatment = input.refundTreatment ?? 'REDUCE_PAYABLE';
  return prisma.$transaction(async (tx) => {
    const branch = await activeBranch(tx, branchId);
    const supplier = await loadSupplier(tx, actor, input.supplierId);
    const purchaseId = input.purchaseId ?? input.originalPurchaseId ?? null;
    const purchase = purchaseId ? await tx.purchase.findFirst({ where: { id: purchaseId, branchId, supplierId: supplier.id } }) : null;
    if (purchaseId && !purchase) throw badRequest('PURCHASE_INVALID', 'Original purchase not found for this supplier and branch.');

    const returnNumber = await nextSequence(tx, branch.code, 'PR');
    const returnDate = dateOnly(input.returnDate || (await getBusinessDate(tx)));
    const ret = await tx.supplierReturn.create({
      data: {
        returnNumber, branchId, supplierId: supplier.id, purchaseId: purchase?.id ?? null, purchaseNumber: purchase?.purchaseNumber ?? null,
        returnDate, totalAmount: 0, refundTreatment: treatment, reason: input.reason, notes: input.notes || null,
        createdById: actor.id, createdByName: actor.name,
      },
    });

    let total = toDec(0);
    for (const l of input.lines) {
      const item = await tx.inventoryItem.findUnique({ where: { id: l.itemId } });
      if (!item) throw badRequest('ITEM_INVALID', `Item '${l.itemId}' not found.`);
      // Returns leave from a specific cost layer (the batch received from this supplier).
      let batch = l.batchId ? await tx.inventoryBatch.findFirst({ where: { id: l.batchId, itemId: item.id, branchId } }) : null;
      if (!batch && l.batchNumber) batch = await tx.inventoryBatch.findFirst({ where: { batchNumber: l.batchNumber, itemId: item.id, branchId } });
      if (!batch) {
        batch = await tx.inventoryBatch.findFirst({
          where: { itemId: item.id, branchId, remainingQuantity: { gte: l.quantity }, ...(purchase ? { purchaseId: purchase.id } : {}) },
          orderBy: { receivedDate: 'asc' },
        });
      }
      if (!batch) throw conflict('INSUFFICIENT_STOCK', `No batch of '${item.name}' holds ${l.quantity} units to return.`);

      const unitCost = l.unitCost !== undefined ? toDec(l.unitCost) : toDec(batch.unitCost);
      const lineTotal = round2(qty(l.quantity).times(unitCost));
      total = total.plus(lineTotal);
      await postStockMovement(tx, {
        branchCode: branch.code, branchId, itemId: item.id, batch, movementType: 'SUPPLIER_RETURN_OUT', quantity: l.quantity,
        unitCost: batch.unitCost, sourceReferenceType: 'RETURN', sourceReferenceId: ret.id, sourceReferenceNumber: returnNumber,
        reason: input.reason || 'Supplier Return', actor,
      });
      await tx.supplierReturnLine.create({
        data: {
          returnId: ret.id, itemId: item.id, itemName: item.name, itemSku: item.sku, batchId: batch.id, batchNumber: batch.batchNumber,
          quantity: qty(l.quantity), unitCost, totalCost: lineTotal,
        },
      });
    }
    total = round2(total);

    // Returned goods always reduce what we owe (debit). A cash/online refund then settles that
    // credit (money comes back in), so the payable nets to zero for refunds.
    const ledgerBase = { supplierId: supplier.id, branchId, date: returnDate, referenceType: 'RETURN', referenceId: ret.id, referenceNumber: returnNumber, userId: actor.id, userName: actor.name };
    await tx.supplierLedger.create({ data: { ...ledgerBase, entryType: 'PURCHASE_RETURN', debit: total, description: `Return: ${returnNumber} (${input.reason})` } });

    let refundTo = { cashDrawerId: null, paymentAccountId: null };
    if (treatment === 'CASH_REFUND' || treatment === 'ONLINE_REFUND') {
      if (treatment === 'CASH_REFUND') {
        const drawer = await getActiveDrawer(tx, actor, branchId);
        await postCashMovement(tx, {
          holderId: drawer.id, type: 'SUPPLIER_REFUND', direction: 'IN', amount: total, sourceModule: 'INVENTORY',
          sourceId: ret.id, reference: returnNumber, description: `Supplier refund from ${supplier.name}`, actor,
        });
        refundTo.cashDrawerId = drawer.id;
      } else {
        if (!input.paymentAccountId) throw badRequest('ACCOUNT_REQUIRED', 'Payment account required for online supplier refund.');
        await postAccountMovement(tx, {
          accountId: input.paymentAccountId, branchId, type: 'SUPPLIER_REFUND', direction: 'IN', amount: total, sourceModule: 'INVENTORY',
          sourceId: ret.id, reference: returnNumber, description: `Supplier refund from ${supplier.name}`, actor,
        });
        refundTo.paymentAccountId = input.paymentAccountId;
      }
      await tx.supplierLedger.create({ data: { ...ledgerBase, entryType: 'SUPPLIER_REFUND', credit: total, description: `Refund received for ${returnNumber}` } });
    }

    const saved = await tx.supplierReturn.update({ where: { id: ret.id }, data: { totalAmount: total, ...refundTo }, include: { lines: true } });
    await audit(tx, actor, 'SUPPLIER_RETURN_POSTED', 'SupplierReturn', ret.id, branchId, { returnNumber, total: total.toNumber(), treatment });
    return toSupplierReturnDTO(saved, supplier.name);
  });
};

// ═══ STOCK MOVEMENTS & MANUAL STOCK-OUT ═══════════════════════════════════════

export const listMovements = async (actor, { branchId, itemId, type, direction, startDate, endDate, search } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.stockMovement.findMany({
    where: {
      ...(b ? { branchId: b } : {}), ...(itemId ? { itemId } : {}), ...(type ? { movementType: type } : {}), ...(direction ? { direction } : {}),
      ...(startDate || endDate ? { createdAt: { ...(startDate ? { gte: startOfDay(startDate) } : {}), ...(endDate ? { lte: endOfDay(endDate) } : {}) } } : {}),
      ...(search ? {
        OR: [
          { movementNumber: { contains: search, mode: 'insensitive' } },
          { sourceReferenceNumber: { contains: search, mode: 'insensitive' } },
          { item: { name: { contains: search, mode: 'insensitive' } } },
          { item: { sku: { contains: search, mode: 'insensitive' } } },
          { batch: { batchNumber: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: { item: true, batch: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toMovementDTO);
};

const STOCK_OUT_TYPES = {
  SALON_CONSUMPTION: 'SALON_CONSUMPTION_OUT', DAMAGE: 'DAMAGED_OUT', DAMAGED: 'DAMAGED_OUT', EXPIRED: 'EXPIRED_OUT',
  INTERNAL_USE: 'INTERNAL_USE_OUT', PROMOTIONAL: 'PROMOTIONAL_OUT', OTHER: 'NEGATIVE_ADJUSTMENT',
};

export const manualStockOut = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot issue stock in another branch.');
  const movementType = STOCK_OUT_TYPES[input.reasonType] ?? (Object.values(STOCK_OUT_TYPES).includes(input.reasonType) ? input.reasonType : 'SALON_CONSUMPTION_OUT');
  return prisma.$transaction(async (tx) => {
    const branch = await activeBranch(tx, branchId);
    const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item || !item.isActive) throw badRequest('ITEM_INVALID', `Item '${input.itemId}' is invalid.`);
    const ref = await nextSequence(tx, branch.code, 'MSO');

    const deptTag = input.department ? `[Dept: ${input.department}] ` : '';
    const respTag = input.responsibleStaffName ? `[Responsible: ${input.responsibleStaffName}] ` : '';
    const fullNotes = [deptTag + respTag, input.notes].filter(Boolean).join(' ').trim() || null;

    const movements = await consumeStock(tx, {
      itemId: item.id, branchId, branchCode: branch.code, quantity: input.quantity, businessDate: await getBusinessDate(tx),
      movementType, source: { type: 'MANUAL_OUT', id: ref, number: ref }, reason: input.reason || movementType,
      notes: fullNotes, actor, batchId: input.batchId,
    });
    await audit(tx, actor, 'STOCK_OUT_POSTED', 'StockMovement', movements[0].id, branchId, {
      ref, movementType, quantity: input.quantity, department: input.department, responsibleStaff: input.responsibleStaffName,
    });
    const rows = await tx.stockMovement.findMany({ where: { id: { in: movements.map((m) => m.id) } }, include: { item: true, batch: true }, orderBy: { createdAt: 'asc' } });
    // Contract returns one movement; when FEFO split across layers the rest are attached.
    const [first, ...rest] = rows.map(toMovementDTO);
    return rest.length ? { ...first, splitMovements: rest } : first;
  });
};

export const consumptionPreview = async (actor, query) => {
  const branchId = resolveReadBranch(actor, query.branchId);
  const today = await getBusinessDate();
  return previewBatchPicks(prisma, {
    itemId: query.itemId,
    branchId,
    quantity: query.quantity,
    businessDate: today,
    allowExpired: query.reasonType === 'EXPIRED',
    batchId: query.batchId,
  });
};

export const reverseMovement = async (actor, movementId, input) => {
  return prisma.$transaction(async (tx) => {
    const movement = await reverseStockMovement(tx, {
      movementId,
      reason: input.reason,
      actor,
      branchId: resolveWriteBranch(actor),
    });
    await audit(tx, actor, 'STOCK_MOVEMENT_REVERSED', 'StockMovement', movement.id, movement.branchId, {
      originalMovementId: movementId,
      quantity: movement.quantity.toNumber(),
      reason: input.reason,
    });
    return toMovementDTO(movement);
  });
};

// ═══ PHYSICAL STOCK COUNT (settlement) ════════════════════════════════════════

export const listStockSettlements = async (actor, { branchId } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const rows = await prisma.stockSettlement.findMany({ where: b ? { branchId: b } : {}, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  return rows.map(toStockSettlementDTO);
};

export const getStockSettlement = async (actor, id) => {
  const s = await prisma.stockSettlement.findUnique({ where: { id }, include: { lines: true } });
  if (!s) throw notFound('STOCK_SETTLEMENT_NOT_FOUND', `Stock settlement '${id}' not found.`);
  assertBranchAccess(actor, s.branchId);
  return toStockSettlementDTO(s);
};

export const createStockSettlement = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot count stock in another branch.');
  return prisma.$transaction(async (tx) => {
    const branch = await activeBranch(tx, branchId);
    const settlementNumber = await nextSequence(tx, branch.code, 'ST');
    const settlement = await tx.stockSettlement.create({
      data: {
        settlementNumber, branchId, countDate: dateOnly(input.countDate || (await getBusinessDate(tx))), notes: input.notes || null,
        createdById: actor.id, createdByName: actor.name, approvedById: actor.id, approvedByName: actor.name, postedAt: new Date(),
      },
    });

    for (const l of input.lines) {
      const item = await tx.inventoryItem.findUnique({ where: { id: l.itemId } });
      if (!item) throw badRequest('ITEM_INVALID', `Item '${l.itemId}' not found.`);
      // Counts are per batch (cost layer). Without a batch id the item's oldest layer is used.
      await tx.$executeRaw`SELECT 1 FROM "InventoryBatch" WHERE "itemId" = ${item.id} AND "branchId" = ${branchId} FOR UPDATE`;
      const batch = l.batchId
        ? await tx.inventoryBatch.findFirst({ where: { id: l.batchId, itemId: item.id, branchId } })
        : await tx.inventoryBatch.findFirst({ where: { itemId: item.id, branchId }, orderBy: [{ remainingQuantity: 'desc' }, { receivedDate: 'asc' }] });
      if (l.batchId && !batch) throw badRequest('BATCH_NOT_FOUND', `Batch '${l.batchId}' not found for '${item.name}'.`);
      if (!batch) throw badRequest('NO_BATCH', `'${item.name}' has no stock layer in this branch to reconcile.`);

      const system = qty(batch.remainingQuantity);
      const counted = qty(l.countedQuantity);
      if (counted.lessThan(0)) throw badRequest('INVALID_COUNT', 'Counted quantity cannot be negative.');
      const diff = counted.minus(system);
      if (!diff.isZero() && !l.reason) {
        throw badRequest('REASON_REQUIRED', `A non-zero difference of ${diff.toNumber()} for '${item.name}' requires a documented discrepancy reason.`);
      }
      const unitCost = toDec(batch.unitCost);
      if (!diff.isZero()) {
        await postStockMovement(tx, {
          branchCode: branch.code, branchId, itemId: item.id, batch,
          movementType: diff.greaterThan(0) ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT', quantity: diff.abs(), unitCost,
          sourceReferenceType: 'SETTLEMENT', sourceReferenceId: settlement.id, sourceReferenceNumber: settlementNumber,
          reason: `${diff.greaterThan(0) ? 'Reconciliation adjustment' : 'Reconciliation shortage'} (${l.reason})`, notes: l.notes, actor,
        });
      }
      await tx.stockSettlementLine.create({
        data: {
          settlementId: settlement.id, itemId: item.id, itemName: item.name, itemSku: item.sku, batchId: batch.id, batchNumber: batch.batchNumber,
          systemQuantity: system, countedQuantity: counted, difference: diff, unitCost, costImpact: round2(diff.times(unitCost)),
          reason: l.reason || 'COUNTING_CORRECTION', notes: l.notes || null,
        },
      });
    }
    await audit(tx, actor, 'STOCK_SETTLEMENT_POSTED', 'StockSettlement', settlement.id, branchId, { settlementNumber });
    return toStockSettlementDTO(await tx.stockSettlement.findUnique({ where: { id: settlement.id }, include: { lines: true } }));
  });
};

// ═══ SUMMARY & COGS ═══════════════════════════════════════════════════════════

export const inventorySummary = async (actor, branchId) => {
  const b = resolveReadBranch(actor, branchId);
  const snaps = await stockSnapshots(actor, branchId);
  const suppliers = await prisma.supplier.findMany({ where: b ? { branchId: { in: ['ALL', b] } } : {}, select: { id: true } });
  const totals = await supplierTotals(prisma, suppliers.map((s) => s.id), b);
  const purchases = await prisma.purchase.aggregate({ where: b ? { branchId: b } : {}, _sum: { netAmount: true } });
  const sum = (f) => round2(snaps.reduce((s, x) => s.plus(x[f]), toDec(0))).toNumber();
  return {
    totalInventoryCostValue: sum('valuationCostBasis'),
    totalRetailValue:        sum('potentialRetailValue'),
    totalItemsCount:         snaps.length,
    lowStockCount:           snaps.filter((s) => s.isLowStock).length,
    outOfStockCount:         snaps.filter((s) => s.isOutOfStock).length,
    nearExpiryCount:         snaps.reduce((s, x) => s + x.nearExpiryBatchesCount, 0),
    expiredCount:            snaps.reduce((s, x) => s + x.expiredBatchesCount, 0),
    totalSupplierPayable:    round2([...totals.values()].reduce((s, t) => s.plus(t.currentPayable), toDec(0))).toNumber(),
    recentPurchasesAmount:   toDec(purchases._sum.netAmount ?? 0).toNumber(),
  };
};

/**
 * Product COGS & material consumption (spec §5.4, §11.2).
 * COGS = cost of POS_SALE_OUT movements − POS_RETURN_IN reversals; salon consumption is separate.
 */
export const cogsReport = async (actor, { branchId, startDate, endDate } = {}) => {
  const b = resolveReadBranch(actor, branchId);
  const created = startDate || endDate ? { createdAt: { ...(startDate ? { gte: startOfDay(startDate) } : {}), ...(endDate ? { lte: endOfDay(endDate) } : {}) } } : {};
  const dates = startDate || endDate ? { date: { ...(startDate ? { gte: dateOnly(startDate) } : {}), ...(endDate ? { lte: dateOnly(endDate) } : {}) } } : {};

  const [movements, lines, branches] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { ...(b ? { branchId: b } : {}), ...created, movementType: { in: ['POS_SALE_OUT', 'POS_RETURN_IN', 'SALES_RETURN_IN', 'SALON_CONSUMPTION_OUT'] } },
      include: { item: true },
    }),
    prisma.invoiceLine.findMany({
      where: { invoice: { ...(b ? { branchId: b } : {}), ...dates, lifecycle: { not: 'VOIDED' } } },
      include: { invoice: { select: { branchId: true } } },
    }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
  ]);
  const branchName = new Map(branches.map((x) => [x.id, x.name]));
  const stats = new Map();
  const key = (br, item) => `${br}_${item}`;
  let serviceRevenue = toDec(0);

  for (const l of lines) {
    if (l.type !== 'PRODUCT') { serviceRevenue = serviceRevenue.plus(l.netSales); continue; }
    const k = key(l.invoice.branchId, l.itemId);
    const s = stats.get(k) ?? { productId: l.itemId, productName: l.name, sku: l.code, branchId: l.invoice.branchId, qtySold: toDec(0), qtyReturned: toDec(0), gross: toDec(0), discount: toDec(0), net: toDec(0), cogs: toDec(0) };
    s.qtySold = s.qtySold.plus(l.quantity);
    s.gross = s.gross.plus(toDec(l.unitPrice).times(l.quantity));
    s.discount = s.discount.plus(l.discountAllocated);
    s.net = s.net.plus(l.netSales);
    stats.set(k, s);
  }
  let consumption = toDec(0);
  for (const m of movements) {
    if (m.movementType === 'SALON_CONSUMPTION_OUT') { consumption = consumption.plus(m.totalCost); continue; }
    const k = key(m.branchId, m.itemId);
    const s = stats.get(k) ?? { productId: m.itemId, productName: m.item.name, sku: m.item.sku, branchId: m.branchId, qtySold: toDec(0), qtyReturned: toDec(0), gross: toDec(0), discount: toDec(0), net: toDec(0), cogs: toDec(0) };
    if (m.movementType === 'POS_SALE_OUT') s.cogs = s.cogs.plus(m.totalCost);
    else { s.cogs = s.cogs.minus(m.totalCost); s.qtyReturned = s.qtyReturned.plus(m.quantity); }
    s.category = m.item.category;
    stats.set(k, s);
  }

  const records = [...stats.values()].map((s) => {
    const profit = round2(s.net.minus(s.cogs));
    return {
      productId: s.productId, productName: s.productName, sku: s.sku, category: s.category ?? 'Retail', branchId: s.branchId,
      branchName: branchName.get(s.branchId) ?? s.branchId,
      quantitySold: s.qtySold.toNumber(), quantityReturned: s.qtyReturned.toNumber(), netQuantity: s.qtySold.minus(s.qtyReturned).toNumber(),
      grossSales: round2(s.gross).toNumber(), discountAllocated: round2(s.discount).toNumber(), netSales: round2(s.net).toNumber(),
      cogs: round2(s.cogs).toNumber(), grossProfit: profit.toNumber(),
      marginPercentage: s.net.greaterThan(0) ? round2(profit.dividedBy(s.net).times(100)).toNumber() : 0,
    };
  });
  const totalNet = records.reduce((t, r) => t + r.netSales, 0);
  const totalCogs = records.reduce((t, r) => t + r.cogs, 0);
  const totalProfit = Math.round((totalNet - totalCogs) * 100) / 100;
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    records,
    summary: {
      totalRetailNetSales: r2(totalNet), netProductSales: r2(totalNet),
      totalRetailCOGS: r2(totalCogs), totalCOGS: r2(totalCogs),
      totalRetailGrossProfit: totalProfit, grossProfit: totalProfit,
      retailGrossMarginPercentage: totalNet > 0 ? r2((totalProfit / totalNet) * 100) : 0,
      totalConsumableMaterialCost: round2(consumption).toNumber(),
      totalServiceRevenue: round2(serviceRevenue).toNumber(),
      serviceContributionBeforeExpenses: round2(serviceRevenue.minus(consumption)).toNumber(),
    },
  };
};

export const reverseSupplierPayment = (input, actor, request) => paymentPosting(actor, request, async (tx) => {
  await tx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${input.supplierId} FOR UPDATE`;
  const payment = await tx.supplierPayment.findUnique({ where: { id: input.paymentId } });
  if (!payment || payment.supplierId !== input.supplierId) throw notFound('PAYMENT_NOT_FOUND', 'Supplier payment not found.');
  assertBranchAccess(actor, payment.branchId);
  if (payment.reversedAt) throw conflict('PAYMENT_REVERSED', 'Payment has already been reversed.');
  const date = dateOnly(input.reversalDate);
  if (date < payment.paymentDate) throw badRequest('REVERSAL_DATE', 'Reversal date cannot precede the payment date.');
  const common = { type: 'REVERSAL', direction: 'IN', amount: payment.amount, sourceModule: 'INVENTORY', sourceId: payment.id, reference: payment.paymentNumber, description: input.reason, actor, transactionDate: date };
  if (payment.method === 'CASH') await postCashMovement(tx, { ...common, holderId: payment.cashDrawerId });
  else await postAccountMovement(tx, { ...common, accountId: payment.paymentAccountId, branchId: payment.branchId });
  for (const allocation of payment.allocations) {
    if (!allocation.purchaseId) continue;
    const purchase = await tx.purchase.findUnique({ where: { id: allocation.purchaseId } });
    const paid = round2(toDec(purchase.paidAmount).minus(allocation.amount));
    const due = round2(toDec(purchase.balanceDue).plus(allocation.amount));
    await tx.purchase.update({ where: { id: purchase.id }, data: { paidAmount: paid, balanceDue: due, paymentStatus: due.isZero() ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : 'UNPAID' } });
  }
  await tx.supplierLedger.create({ data: { supplierId: payment.supplierId, branchId: payment.branchId, date, entryType: 'SUPPLIER_PAYMENT', referenceType: 'PAYMENT_REVERSAL', referenceId: payment.id, referenceNumber: payment.paymentNumber, description: input.reason, credit: payment.amount, userId: actor.id, userName: actor.name } });
  const reversed = await tx.supplierPayment.update({ where: { id: payment.id }, data: { reversedAt: new Date(), reversedById: actor.id, reversedByName: actor.name, reversalReason: input.reason, reversalDate: date } });
  await audit(tx, actor, 'SUPPLIER_PAYMENT_REVERSED', 'SupplierPayment', payment.id, payment.branchId, { amount: payment.amount.toString(), reason: input.reason });
  return toSupplierPaymentDTO(reversed);
});
