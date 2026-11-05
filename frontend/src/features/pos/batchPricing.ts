import Decimal from 'decimal.js';
import type { InventoryBatch, InventoryItem, POSCartItem } from '@/types/salon';

export interface BatchQuote { batchId: string; batchNumber: string; quantity: number; sellingPrice: number }

export function orderedSaleBatches(batches: InventoryBatch[], item: InventoryItem, branchId: string) {
  // Eligibility is derived by the server using its business date.
  const eligible = batches.filter(b => b.itemId === item.id && b.branchId === branchId &&
    ['VALID', 'NEAR_EXPIRY'].includes(b.status) && b.remainingQuantity > 0);
  const fefo = item.trackExpiry || eligible.some(b => b.expiryDate);
  return eligible.sort((a, b) => {
    if (fefo) {
      const ea = a.expiryDate ? Date.parse(a.expiryDate) : Infinity;
      const eb = b.expiryDate ? Date.parse(b.expiryDate) : Infinity;
      if (ea !== eb) return ea - eb;
    }
    return Date.parse(a.receivedDate) - Date.parse(b.receivedDate) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
  });
}

export function quoteCart(cart: POSCartItem[], batches: InventoryBatch[], branchId: string) {
  const used = new Map<string, Decimal>();
  const quotes = new Map<string, { allocations: BatchQuote[]; gross: number; complete: boolean }>();
  for (const row of cart) {
    if (row.type !== 'PRODUCT') continue;
    let need = new Decimal(row.quantity), gross = new Decimal(0);
    const allocations: BatchQuote[] = [];
    for (const batch of orderedSaleBatches(batches, row.item as InventoryItem, branchId)) {
      if (need.lte(0)) break;
      const available = new Decimal(batch.remainingQuantity).minus(used.get(batch.id) ?? 0);
      if (available.lte(0) || batch.sellingPrice == null) continue;
      const quantity = Decimal.min(need, available);
      allocations.push({ batchId: batch.id, batchNumber: batch.batchNumber, quantity: quantity.toNumber(), sellingPrice: batch.sellingPrice });
      gross = gross.plus(quantity.times(batch.sellingPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
      used.set(batch.id, (used.get(batch.id) ?? new Decimal(0)).plus(quantity));
      need = need.minus(quantity);
    }
    quotes.set(row.cartInstanceId, { allocations, gross: gross.toNumber(), complete: need.isZero() });
  }
  return quotes;
}
