import assert from 'node:assert/strict';
import { orderedSaleBatches, quoteCart } from '../src/features/pos/batchPricing';
import type { InventoryBatch, InventoryItem, POSCartItem } from '../src/types/salon';
const item = { id: 'p', trackExpiry: false } as InventoryItem;
const batch = (id: string, quantity: number, price: number, date: string, expiryDate?: string) => ({
  id, itemId: 'p', branchId: 'b', batchNumber: id, status: 'VALID', remainingQuantity: quantity,
  sellingPrice: price, receivedDate: date, createdAt: date, expiryDate,
} as InventoryBatch);
const a = batch('a', 3, 300, '2026-01-01'), b = batch('b', 5, 400, '2026-02-01');
const row = (quantity: number, id = 'row') => ({ cartInstanceId: id, type: 'PRODUCT', item, quantity } as POSCartItem);
assert.equal(quoteCart([row(2)], [b,a], 'b').get('row')?.gross, 600);
assert.equal(quoteCart([row(3)], [{...a,remainingQuantity:1},b], 'b').get('row')?.gross, 1100);
assert.equal(quoteCart([row(1)], [{...a,remainingQuantity:0},b], 'b').get('row')?.allocations[0].sellingPrice, 400);
assert.equal(orderedSaleBatches([{...a,expiryDate:'2029-01-01'}, {...b,expiryDate:'2028-01-01'}],item,'b')[0].id, 'b');
const duplicate = quoteCart([row(2,'first'),row(3,'second')], [a,b], 'b');
assert.equal(duplicate.get('second')?.gross, 1100);
assert.equal(quoteCart([row(1)], [a,b], 'other').get('row')?.complete, false);
assert.equal(quoteCart([row(1)], [{...a,status:'QUARANTINED'}], 'b').get('row')?.complete, false);
console.log('7 frontend batch-pricing checks passed.');
