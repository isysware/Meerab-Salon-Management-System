const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve('..', 'backend');
const manifest = [];
function edit(file, change) {
  const target = path.join(root, file);
  const original = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  let text = change(original?.replace(/\r\n/g, '\n') ?? '');
  const staged = path.join(__dirname, 'backend', file);
  fs.mkdirSync(path.dirname(staged), {recursive:true});
  fs.writeFileSync(staged, text);
  manifest.push({file, hash: original === null ? null : crypto.createHash('sha256').update(original).digest('hex')});
}
function replace(s,a,b) { if (!s.includes(a)) throw Error('Missing anchor: '+a.slice(0,100)); return s.replace(a,b); }
edit('prisma/schema.prisma', s => replace(replace(s,
'  unitCost          Decimal     @db.Decimal(14, 4) // historical',
'  sellingPrice      Decimal?    @db.Decimal(14, 2) // immutable receipt price; null during expansion only\n  priceSource       String?     // STOCK_IN or LEGACY_MASTER\n  unitCost          Decimal     @db.Decimal(14, 4) // historical'),
'  unitCost    Decimal @db.Decimal(14, 4)\n\n  line InvoiceLine',
'  unitCost    Decimal @db.Decimal(14, 4)\n  sortOrder Int @default(0)\n  sellingPrice Decimal? @db.Decimal(14, 2)\n  discountAllocated Decimal? @db.Decimal(14, 2)\n  taxAllocated Decimal? @db.Decimal(14, 2)\n\n  line InvoiceLine'));
edit('src/modules/inventory/inventory.service.js', s => {
  s = replace(s,'              unitCost,','              unitCost,\n              sellingPrice: item.sellingPrice, priceSource: \'STOCK_IN\',');
  s = replace(s,'initialQuantity: qty(l.quantity), remainingQuantity: 0, unitCost: costs[i].landedUnitCost,','initialQuantity: qty(l.quantity), remainingQuantity: 0, unitCost: costs[i].landedUnitCost,\n          sellingPrice: round2(l.item.itemType === \'SALON_CONSUMABLE\' ? 0 : (l.sellingPrice ?? l.item.sellingPrice)), priceSource: \'STOCK_IN\',');
  s = s.replace(/      \/\/ Synchronize authorized selling-price update[\s\S]*?\n      }\n/, '      // The Product Master remains a default; receipt prices belong to this batch.\n');
  s = replace(s,'round2(stock.times(item.sellingPrice)).toNumber()','round2(own.reduce((sum, batch) => sum.plus(toDec(batch.remainingQuantity).times(batch.sellingPrice ?? item.sellingPrice)), toDec(0))).toNumber()');
  return s;
});
edit('src/modules/inventory/inventory.mapper.js',s=>replace(s,'  unitCostSnapshot:  num(b.unitCost),','  unitCostSnapshot:  num(b.unitCost),\n  sellingPrice: b.sellingPrice == null ? undefined : num(b.sellingPrice),\n  priceSource: b.priceSource,\n  allocationOrder: b.allocationOrder,'));
edit('src/lib/stock.js',s=>s.replaceAll('return ca - cb;',"return ca - cb || String(a.id).localeCompare(String(b.id));"));
edit('src/lib/batchPricing.js',()=>`import { toDec, round2, splitWithRemainder } from './money.js';
import { conflict } from './AppError.js';

export const pricePicks = (picks) => picks.map(({ batch, quantity }) => {
  if (batch.sellingPrice == null) throw conflict('BATCH_PRICE_MISSING', 'Batch price migration is required before selling this stock.');
  return { batch, quantity, sellingPrice: toDec(batch.sellingPrice), gross: round2(toDec(quantity).times(batch.sellingPrice)) };
});

export const assertBatchQuote = (picks, quote) => {
  if (!Array.isArray(quote) || quote.length !== picks.length || picks.some((p, i) =>
    quote[i].batchId !== p.batch.id || !toDec(quote[i].quantity).equals(p.quantity) ||
    !toDec(quote[i].sellingPrice).equals(p.sellingPrice))) {
    throw conflict('PRICE_OUTDATED', 'Batch availability or prices changed. Refresh the cart before checkout.');
  }
};

export const allocateBatchAmounts = (picks, discount, tax) => {
  const gross = picks.map(p => p.gross);
  const sum = gross.reduce((s, v) => s.plus(v), toDec(0));
  const discounts = sum.isZero() ? gross.map(() => toDec(0)) : splitWithRemainder(discount, gross);
  const nets = gross.map((v, i) => v.minus(discounts[i]));
  const taxes = nets.every(v => v.isZero()) ? nets.map(() => toDec(0)) : splitWithRemainder(tax, nets);
  return picks.map((p, i) => ({ ...p, discountAllocated: discounts[i], taxAllocated: taxes[i] }));
};

// Refund in original allocation order. Skip every previously refunded unit, including non-restocked goods.
// Cumulative rounding makes repeated partial returns reconcile exactly to each saved allocation.
export const refundBatchSlices = (batches, refunded, requested) => {
  let skip = toDec(refunded), need = toDec(requested);
  const slices = [];
  for (const b of [...batches].sort((a,b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)))) {
    const size = toDec(b.qty);
    if (skip.greaterThanOrEqualTo(size)) { skip = skip.minus(size); continue; }
    if (need.lessThanOrEqualTo(0)) break;
    const take = toDec(size.minus(skip).lessThan(need) ? size.minus(skip) : need);
    const share = total => round2(toDec(total).times(skip.plus(take)).div(size)).minus(round2(toDec(total).times(skip).div(size)));
    slices.push({ ...b, quantity: take,
      net: b.sellingPrice == null ? null : share(size.times(b.sellingPrice).minus(b.discountAllocated ?? 0)),
      tax: b.taxAllocated == null ? null : share(b.taxAllocated) });
    need = need.minus(take); skip = toDec(0);
  }
  if (need.greaterThan(0)) throw conflict('REFUND_BATCH_MISMATCH', 'Historical batch quantities do not cover this return.');
  return slices;
};
`);
edit('src/modules/pos/pos.service.js', s => {
 s = replace(s,"import { consumeStock }", "import { pricePicks, assertBatchQuote, allocateBatchAmounts } from '../../lib/batchPricing.js';\nimport { pickBatches, postStockMovement } from '../../lib/stock.js';\nimport { consumeStock }");
 s = replace(s,'    const drafts = input.cartItems.map((c) => {',`    // Lock products in stable order before quoting. Repeated cart rows share one allocation pool.
    const productPicks = new Map();
    for (const id of [...new Set(ids('PRODUCT'))].sort()) {
      const rows = input.cartItems.filter(c => c.type === 'PRODUCT' && c.item.id === id);
      const quantity = rows.reduce((sum, c) => sum + c.quantity, 0);
      const picks = await pickBatches(tx, { itemId: id, branchId, quantity, businessDate: today });
      let cursor = 0, used = toDec(0);
      for (const row of rows) {
        let need = toDec(row.quantity); const allocated = [];
        while (need.greaterThan(0)) {
          const p = picks[cursor], available = p.quantity.minus(used);
          const take = Decimal.min(need, available);
          allocated.push({ batch: p.batch, quantity: take });
          need = need.minus(take); used = used.plus(take);
          if (used.equals(p.quantity)) { cursor++; used = toDec(0); }
        }
        const priced = pricePicks(allocated);
        assertBatchQuote(priced, row.item.batchQuote);
        productPicks.set(row, priced);
      }
    }
    const drafts = input.cartItems.map((c) => {`);
 s = replace(s,"const price = toDec(c.type === 'PRODUCT' ? catalogue.sellingPrice : catalogue.price);", "const picks = productPicks.get(c);\n      const price = picks ? picks[0].sellingPrice : toDec(catalogue.price);");
 s = replace(s,"if (!round2(c.item.price ?? c.item.sellingPrice ?? 0).equals(round2(price)))", "if (!picks && !round2(c.item.price ?? c.item.sellingPrice ?? 0).equals(round2(price)))");
 s = replace(s,'return { c, catalogue, staff, unitPrice: price, gross: round2(price.times(c.quantity)), taxRate };','return { c, catalogue, staff, unitPrice: price, picks, gross: picks ? round2(picks.reduce((sum, p) => sum.plus(p.gross), toDec(0))) : round2(price.times(c.quantity)), taxRate };');
 const start = s.indexOf("        const movements = await consumeStock(tx, {");
 const end = s.indexOf('        await tx.invoiceLine.update({',start);
 if(start<0||end<0) throw Error('stock block');
 s = s.slice(0,start)+`        let cogs = toDec(0);
        const allocations = allocateBatchAmounts(d.picks, d.discount, d.tax);
        for (const [sortOrder, p] of allocations.entries()) {
          const m = await postStockMovement(tx, {
            itemId: d.catalogue.id, branchId, branchCode: branch.code, batch: p.batch, quantity: p.quantity, unitCost: p.batch.unitCost,
            movementType: 'POS_SALE_OUT', sourceReferenceType: 'INVOICE', sourceReferenceId: invoice.id,
            sourceReferenceNumber: invoiceNumber, reason: 'POS Retail Product Sale', actor,
          });
          await tx.invoiceLineBatch.create({ data: { lineId: line.id, batchId: p.batch.id, batchNumber: p.batch.batchNumber,
            qty: p.quantity, unitCost: m.unitCost, sortOrder, sellingPrice: p.sellingPrice,
            discountAllocated: p.discountAllocated, taxAllocated: p.taxAllocated } });
          cogs = cogs.plus(m.totalCost);
        }
`+s.slice(end);
 return s.replace("import { consumeStock } from '../../lib/stock.js';\n",'');
});
edit('src/modules/pos/pos.mapper.js', s=>replace(s,"      batchId:          batches[0]?.batchId,",`      batchAllocations: [...batches].sort((a,b) => a.sortOrder - b.sortOrder).map(b => ({
        batchId: b.batchId, batchNumber: b.batchNumber, quantity: num(b.qty), unitCost: num(b.unitCost),
        sellingPrice: b.sellingPrice == null ? num(l.unitPrice) : num(b.sellingPrice),
        discountAllocated: b.discountAllocated == null ? undefined : num(b.discountAllocated),
        taxAllocated: b.taxAllocated == null ? undefined : num(b.taxAllocated),
      })),
      batchId:          batches[0]?.batchId,`));
edit('src/modules/pos/pos.refund.js', s=>{
 s = replace(s,"import prisma from", "import { refundBatchSlices } from '../../lib/batchPricing.js';\nimport prisma from");
 s = replace(s,"    if (!requested.length)", "    if (new Set(requested.map(r => r.lineId)).size !== requested.length) throw badRequest('DUPLICATE_REFUND_LINE', 'Select each invoice line only once.');\n    if (!requested.length)");
 s = replace(s,'      const net = lastUnits ?', "      const slices = line.type === 'PRODUCT' ? refundBatchSlices(line.batches, already.get(line.id) ?? 0, r.quantity) : [];\n      const priced = slices.length > 0 && slices.every(b => b.net !== null && b.tax !== null);\n      const net = priced ? round2(slices.reduce((sum, b) => sum.plus(b.net), toDec(0))) : lastUnits ?");
 s = replace(s,'      const tax = lastUnits ?', '      const tax = priced ? round2(slices.reduce((sum, b) => sum.plus(b.tax), toDec(0))) : lastUnits ?');
 s = replace(s,`        let toReturn = r.quantity;
        for (const lb of [...line.batches].reverse()) {
          if (toReturn.lessThanOrEqualTo(0)) break;
          const qtyBack = toDec(lb.qty).lessThan(toReturn) ? toDec(lb.qty) : toReturn;
          toReturn = toReturn.minus(qtyBack);
          const batch = await tx.inventoryBatch.findUnique({ where: { id: lb.batchId } });`, `        for (const lb of slices) {
          const qtyBack = lb.quantity;
          const batch = await tx.inventoryBatch.findFirst({ where: { id: lb.batchId, itemId: line.itemId, branchId: invoice.branchId } });
          if (!batch) throw conflict('RETURN_BATCH_MISSING', 'Original batch is unavailable in this branch.');`);
 return s;
});
edit('prisma/migrations/20261105090000_batch_selling_price/migration.sql',()=>`-- Expand only. Existing invoices and ledger entries are never rewritten.
ALTER TABLE "InventoryBatch" ADD COLUMN "sellingPrice" DECIMAL(14,2), ADD COLUMN "priceSource" TEXT;
ALTER TABLE "InvoiceLineBatch" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "sellingPrice" DECIMAL(14,2), ADD COLUMN "discountAllocated" DECIMAL(14,2), ADD COLUMN "taxAllocated" DECIMAL(14,2);
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_sellingPrice_nonnegative" CHECK ("sellingPrice" >= 0) NOT VALID;
`);
fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(manifest,null,2));
