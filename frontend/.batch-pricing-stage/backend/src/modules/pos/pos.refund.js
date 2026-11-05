// src/modules/pos/pos.refund.js
// Refunds & voids (spec §12). The original invoice is never edited or deleted — each correction is a
// dated InvoiceRefund event that reverses: net sales, tax (at the original rate snapshot), commission
// (dated REVERSAL events), stock (RETURN_IN at the original cost layers) and money actually received.

import { refundBatchSlices } from '../../lib/batchPricing.js';
import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden } from '../../lib/AppError.js';
import { assertInvoiceAccess, assertBranchAccess } from '../../lib/scope.js';
import { dateOnly, getBusinessDate } from '../../lib/dates.js';
import { round2, splitWithRemainder, toDec } from '../../lib/money.js';
import { nextSequence } from '../../lib/sequence.js';
import { postStockMovement } from '../../lib/stock.js';
import { getActiveDrawer, postCashMovement, postAccountMovement } from '../cash/cash.service.js';
import { invoiceInclude } from './pos.service.js';
import { toInvoiceDTO } from './pos.mapper.js';
import { lockCommissionBranch } from '../commission/payrollCommission.js';

const refundInclude = { ...invoiceInclude, refunds: { include: { lines: true } } };

/** Quantity of each invoice line already refunded by earlier events. */
const refundedQty = (invoice) => {
  const map = new Map();
  for (const r of invoice.refunds) for (const l of r.lines) map.set(l.lineId, toDec(map.get(l.lineId) ?? 0).plus(l.quantity));
  return map;
};

/** Bill money actually held for this invoice = bill receipts − bill refunds already paid out. */
const billMoneyHeld = (invoice) => {
  const received = invoice.payments.filter((p) => !p.reversedAt).reduce((s, p) => s.plus(p.billAmountAllocated), toDec(invoice.advanceAdjusted));
  const refunded = invoice.refunds.reduce((s, r) => s.plus(r.cashOut).minus(r.tipReversed), toDec(0));
  return round2(received.minus(refunded));
};

const effectiveBill = (invoice, extraNet = toDec(0), extraTax = toDec(0)) => {
  const reversed = invoice.refunds.reduce((s, r) => s.plus(r.netReversed).plus(r.taxReversed), toDec(0));
  return round2(toDec(invoice.netSales).plus(invoice.tax).minus(reversed).minus(extraNet).minus(extraTax));
};

/**
 * @param {{ invoiceId: string, type: 'REFUND'|'VOID', lines?: Array<{lineId, quantity, restock?}>, reason: string,
 *           refundMethod?: 'CASH'|'ONLINE_ACCOUNT', paymentAccountId?: string }} input
 */
export const refundInvoice = async (input, actor) => {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) {
    throw forbidden('FORBIDDEN', 'Access Denied: Only administrators can approve refunds and voids.');
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: refundInclude });
    if (!invoice) throw badRequest('INVOICE_NOT_FOUND', `Invoice '${input.invoiceId}' not found.`);
    assertBranchAccess(actor, invoice.branchId, 'Access Denied: Cannot refund invoices of another branch.');
    await lockCommissionBranch(tx, invoice.branchId);
    if (['VOIDED', 'REFUNDED'].includes(invoice.lifecycle)) throw conflict('INVOICE_CLOSED', `Invoice '${invoice.invoiceNumber}' is already ${invoice.lifecycle.toLowerCase()}.`);

    const branch = await tx.branch.findUnique({ where: { id: invoice.branchId } });
    const today = await getBusinessDate(tx);
    const already = refundedQty(invoice);
    const isVoid = input.type === 'VOID';

    // Which lines/quantities are being reversed.
    const requested = isVoid
      ? invoice.lines.map((l) => ({ lineId: l.id, quantity: toDec(l.quantity).minus(already.get(l.id) ?? 0), restock: l.type === 'PRODUCT' ? 'RESALABLE' : 'NONE' }))
          .filter((r) => r.quantity.greaterThan(0))
      : (input.lines ?? []).map((r) => ({ ...r, quantity: toDec(r.quantity) }));
    if (new Set(requested.map(r => r.lineId)).size !== requested.length) throw badRequest('DUPLICATE_REFUND_LINE', 'Select each invoice line only once.');
    if (!requested.length) throw badRequest('NOTHING_TO_REFUND', 'Select at least one line and quantity to refund.');

    // A void or a refund that closes the invoice also returns the tip (spec §12.1), so the tip
    // must still be unallocated — allocated tips belong to staff until those allocations are cancelled.
    const closesInvoice = isVoid || invoice.lines.every((l) => {
      const done = toDec(already.get(l.id) ?? 0).plus(requested.filter((r) => r.lineId === l.id).reduce((s, r) => s.plus(r.quantity), toDec(0)));
      return done.greaterThanOrEqualTo(l.quantity);
    });
    const tipReceipts = await tx.tipReceipt.findMany({ where: { invoiceId: invoice.id } });
    if (closesInvoice && tipReceipts.some((t) => toDec(t.allocatedAmount).greaterThan(0))) {
      throw conflict('TIPS_ALLOCATED', `This invoice has tips already allocated to staff. Cancel those tip allocations before ${isVoid ? 'voiding' : 'a full refund'}.`);
    }

    const refundNumber = await nextSequence(tx, branch.code, isVoid ? 'VOID' : 'RFD');
    const refund = await tx.invoiceRefund.create({
      data: {
        refundNumber, invoiceId: invoice.id, type: isVoid ? 'VOID' : 'REFUND', refundDate: dateOnly(today),
        netReversed: 0, taxReversed: 0, reason: input.reason, byUserId: actor.id, byName: actor.name,
      },
    });

    let netReversed = toDec(0);
    let taxReversed = toDec(0);
    for (const r of requested) {
      const line = invoice.lines.find((l) => l.id === r.lineId);
      if (!line) throw badRequest('LINE_NOT_FOUND', `Invoice line '${r.lineId}' not found.`);
      const remaining = toDec(line.quantity).minus(already.get(line.id) ?? 0);
      if (r.quantity.lessThanOrEqualTo(0) || r.quantity.greaterThan(remaining)) {
        throw badRequest('INVALID_REFUND_QTY', `'${line.name}': refundable quantity is ${remaining.toNumber()}.`);
      }
      if (line.type === 'PACKAGE' && !r.quantity.equals(line.quantity)) {
        throw badRequest('PACKAGE_PARTIAL', `Packages are refunded as a whole line ('${line.name}').`);
      }
      const ratio = r.quantity.dividedBy(line.quantity);
      const lastUnits = r.quantity.equals(remaining);
      // Final refund of a line takes exactly what is left so totals reconcile to the cent.
      const prevNet = invoice.refunds.flatMap((x) => x.lines).filter((x) => x.lineId === line.id).reduce((s, x) => s.plus(x.net), toDec(0));
      const prevTax = invoice.refunds.flatMap((x) => x.lines).filter((x) => x.lineId === line.id).reduce((s, x) => s.plus(x.tax), toDec(0));
      const slices = line.type === 'PRODUCT' ? refundBatchSlices(line.batches, already.get(line.id) ?? 0, r.quantity) : [];
      const priced = slices.length > 0 && slices.every(b => b.net !== null && b.tax !== null);
      const net = priced ? round2(slices.reduce((sum, b) => sum.plus(b.net), toDec(0))) : lastUnits ? round2(toDec(line.netSales).minus(prevNet)) : round2(toDec(line.netSales).times(ratio));
      const tax = priced ? round2(slices.reduce((sum, b) => sum.plus(b.tax), toDec(0))) : lastUnits ? round2(toDec(line.tax).minus(prevTax)) : round2(net.times(line.taxRate));
      netReversed = netReversed.plus(net);
      taxReversed = taxReversed.plus(tax);
      const restock = line.type === 'PRODUCT' ? (r.restock || 'RESALABLE') : 'NONE';
      await tx.refundLine.create({ data: { refundId: refund.id, lineId: line.id, quantity: r.quantity, net, tax, restock } });

      // Commission reversal on the refund date, proportioned to actual collection earnings
      const reverse = async (staffId, attributedNet, rate, componentId) => {
        if (!staffId || staffId === 'house' || staffId === 'unassigned' || toDec(rate).isZero()) return;
        const lineEvents = await tx.commissionEvent.findMany({
          where: {
            invoiceId: invoice.id,
            lineId: line.id,
            staffId,
            ...(componentId ? { componentId } : {}),
          },
        });
        const netEarnedAmount = lineEvents.reduce((s, e) => s.plus(e.type === 'EARN' ? e.amount : -e.amount), toDec(0));
        const netEarnedAttributed = lineEvents.reduce((s, e) => s.plus(e.type === 'EARN' ? e.attributedNet : -e.attributedNet), toDec(0));
        if (netEarnedAmount.lessThanOrEqualTo(0)) return;

        const refundRatio = r.quantity.dividedBy(remaining);
        const amountToReverse = lastUnits ? netEarnedAmount : round2(netEarnedAmount.times(refundRatio));
        const attributedToReverse = lastUnits ? netEarnedAttributed : round2(netEarnedAttributed.times(refundRatio));

        if (amountToReverse.greaterThan(0)) {
          await tx.commissionEvent.create({
            data: {
              branchId: invoice.branchId,
              staffId,
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              lineId: line.id,
              componentId: componentId ?? null,
              type: 'REVERSAL',
              attributedNet: attributedToReverse,
              rate,
              eventDate: dateOnly(today),
              amount: amountToReverse,
            },
          });
        }
      };

      if (line.type === 'SERVICE' || line.type === 'CUSTOM_SERVICE') {
        if (line.components && line.components.length > 0) {
          for (const c of line.components) {
            await reverse(c.staffId, c.allocatedAmount, c.staffCommissionRate, c.id);
          }
        } else {
          await reverse(line.staffId, net, line.staffCommissionRate);
        }
      }
      if (line.type === 'PACKAGE') {
        const comps = [...line.components].sort((a, b) => a.sortOrder - b.sortOrder);
        const shares = splitWithRemainder(net, comps.map((c) => toDec(c.allocatedAmount)));
        for (const [i, c] of comps.entries()) await reverse(c.staffId, shares[i], c.staffCommissionRate, c.id);
      }

      // Stock: resalable goods return to their original cost layers; damaged ones are written off.
      if (line.type === 'PRODUCT' && restock !== 'NONE') {
        for (const lb of slices) {
          const qtyBack = lb.quantity;
          const batch = await tx.inventoryBatch.findFirst({ where: { id: lb.batchId, itemId: line.itemId, branchId: invoice.branchId } });
          if (!batch) throw conflict('RETURN_BATCH_MISSING', 'Original batch is unavailable in this branch.');
          const common = {
            branchCode: branch.code, branchId: invoice.branchId, itemId: line.itemId, batch, quantity: qtyBack, unitCost: lb.unitCost,
            sourceReferenceType: 'RETURN', sourceReferenceId: refund.id, sourceReferenceNumber: refundNumber, actor,
          };
          await postStockMovement(tx, { ...common, movementType: 'POS_RETURN_IN', reason: `Customer return on ${invoice.invoiceNumber}` });
          if (restock === 'DAMAGED') {
            await postStockMovement(tx, { ...common, movementType: 'DAMAGED_OUT', reason: `Damaged customer return (${refundNumber})` });
          }
        }
      }
    }
    netReversed = round2(netReversed);
    taxReversed = round2(taxReversed);

    // Money: refund only what was actually received beyond the new effective bill; otherwise
    // the reversal just cancels part of the receivable (spec §12.2).
    const newEffective = effectiveBill(invoice, netReversed, taxReversed);
    const held = billMoneyHeld(invoice);
    const billRefund = round2(held.greaterThan(newEffective) ? held.minus(newEffective) : toDec(0));
    const tipRefund = closesInvoice ? round2(tipReceipts.reduce((s, t) => s.plus(t.unallocatedAmount), toDec(0))) : toDec(0);
    const cashOut = round2(billRefund.plus(tipRefund));
    const prevDue = toDec(invoice.amountDue);
    const newDue = round2(Decimal_max0(newEffective.minus(held.minus(billRefund))));

    if (cashOut.greaterThan(0)) {
      const method = input.refundMethod || 'CASH';
      const common = { sourceModule: 'POS', sourceId: refund.id, reference: refundNumber, actor, description: `Refund on ${invoice.invoiceNumber}` };
      if (method === 'CASH') {
        const drawer = await getActiveDrawer(tx, actor, invoice.branchId, { autoOpen: false });
        await postCashMovement(tx, { ...common, holderId: drawer.id, type: 'CASH_REFUND', direction: 'OUT', amount: cashOut });
        await tx.invoiceRefund.update({ where: { id: refund.id }, data: { method: 'CASH', drawerId: drawer.id } });
      } else {
        if (!input.paymentAccountId) throw badRequest('ACCOUNT_REQUIRED', 'Select the bank/online account the refund is paid from.');
        await postAccountMovement(tx, { ...common, accountId: input.paymentAccountId, branchId: invoice.branchId, type: 'CASH_REFUND', direction: 'OUT', amount: cashOut });
        await tx.invoiceRefund.update({ where: { id: refund.id }, data: { method: 'ONLINE_ACCOUNT', accountId: input.paymentAccountId } });
      }
    }
    if (tipRefund.greaterThan(0)) {
      for (const t of tipReceipts) await tx.tipReceipt.update({ where: { id: t.id }, data: { unallocatedAmount: 0 } });
    }

    const lifecycle = isVoid ? 'VOIDED' : closesInvoice ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const paidNow = held.minus(billRefund);
    const status = newDue.isZero() ? 'PAID' : paidNow.greaterThan(0) ? 'PARTIAL' : 'UNPAID';

    await tx.invoiceRefund.update({
      where: { id: refund.id },
      data: { netReversed, taxReversed, tipReversed: tipRefund, cashOut, receivableCancelled: round2(Decimal_max0(prevDue.minus(newDue))) },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { lifecycle, status, amountDue: newDue, amountPaid: round2(toDec(invoice.amountPaid).minus(cashOut)) },
    });
    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: isVoid ? 'INVOICE_VOIDED' : 'INVOICE_REFUNDED', entity: 'Invoice',
      entityId: invoice.id, branchId: invoice.branchId,
      after: { refundNumber, netReversed: netReversed.toNumber(), taxReversed: taxReversed.toNumber(), cashOut: cashOut.toNumber(), reason: input.reason },
    });

    const fresh = await tx.invoice.findUnique({ where: { id: invoice.id }, include: refundInclude });
    return { invoice: toInvoiceDTO(fresh), refund: { refundNumber, type: refund.type, netReversed: netReversed.toNumber(), taxReversed: taxReversed.toNumber(), tipReversed: tipRefund.toNumber(), cashOut: cashOut.toNumber() } };
  });
};

const Decimal_max0 = (d) => (d.lessThan(0) ? toDec(0) : d);

export const listRefunds = async (actor, invoiceId) => {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { branchId: true, processedByUserId: true } });
  if (!inv) throw badRequest('INVOICE_NOT_FOUND', `Invoice '${invoiceId}' not found.`);
  assertInvoiceAccess(actor, inv);
  const rows = await prisma.invoiceRefund.findMany({ where: { invoiceId }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({
    id: r.id, refundNumber: r.refundNumber, type: r.type, refundDate: r.refundDate.toISOString().slice(0, 10),
    netReversed: toDec(r.netReversed).toNumber(), taxReversed: toDec(r.taxReversed).toNumber(), tipReversed: toDec(r.tipReversed).toNumber(),
    cashOut: toDec(r.cashOut).toNumber(), receivableCancelled: toDec(r.receivableCancelled).toNumber(),
    method: r.method ?? undefined, reason: r.reason, byName: r.byName, createdAt: r.createdAt.toISOString(),
    lines: r.lines.map((l) => ({ lineId: l.lineId, quantity: toDec(l.quantity).toNumber(), net: toDec(l.net).toNumber(), tax: toDec(l.tax).toNumber(), restock: l.restock })),
  }));
};
