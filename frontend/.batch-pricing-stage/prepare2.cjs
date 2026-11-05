const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve('../backend'), manifest=[];
function edit(file,fn){const p=path.join(root,file),old=fs.existsSync(p)?fs.readFileSync(p,'utf8'):null;const dest=path.join(__dirname,'backend',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,fn(old?.replace(/\r\n/g,'\n')??''));manifest.push({file,hash:old===null?null:crypto.createHash('sha256').update(old).digest('hex')});}
function rep(s,a,b){if(!s.includes(a))throw Error(a);return s.replace(a,b);}
edit('src/modules/pos/pos.schema.js',s=>rep(s,'sellingPrice: z.number().optional()','sellingPrice: z.number().optional(), batchQuote: z.array(z.object({ batchId: z.string().min(1), quantity: z.number().finite().positive(), sellingPrice: money.min(0) })).optional()'));
edit('src/modules/pos/pos.service.js',s=>rep(s,'  return paymentPosting(actor, request, async (tx) => {',"  if (!branchId) throw forbidden('BRANCH_REQUIRED', 'A branch assignment is required.');\n  for (const c of input.cartItems) {\n    if (!Number.isInteger(c.quantity) || c.quantity <= 0) throw badRequest('INVALID_QUANTITY', 'Cart quantities must be positive whole numbers.');\n  }\n  return paymentPosting(actor, request, async (tx) => {"));
edit('prisma/migrations/20261105090000_batch_selling_price/migration.sql',s=>s+`
-- Capture defaults for every insertion path, including older application instances during rollout.
CREATE FUNCTION protect_batch_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND OLD."sellingPrice" IS NOT NULL AND
   (NEW."sellingPrice" IS DISTINCT FROM OLD."sellingPrice" OR NEW."priceSource" IS DISTINCT FROM OLD."priceSource") THEN
   RAISE EXCEPTION 'Batch receipt selling prices are immutable';
 END IF;
 IF TG_OP = 'INSERT' AND NEW."sellingPrice" IS NULL THEN
   SELECT "sellingPrice" INTO NEW."sellingPrice" FROM "InventoryItem" WHERE id = NEW."itemId";
   NEW."priceSource" := 'STOCK_IN_DEFAULT';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "InventoryBatch_protect_price" BEFORE INSERT OR UPDATE ON "InventoryBatch"
FOR EACH ROW EXECUTE FUNCTION protect_batch_price();
`);
edit('prisma/migrations/20261105090100_batch_price_backfill/migration.sql',()=>`-- Baseline legacy stock at the master price at deployment, never invent historical prices.
-- Repeatable-read control totals distinguish this migration from concurrent stock activity.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$
DECLARE before_totals JSONB; after_totals JSONB;
BEGIN
 SELECT jsonb_agg(t ORDER BY t."branchId", t."itemId") INTO before_totals FROM
 (SELECT "branchId", "itemId", sum("remainingQuantity") quantity,
 sum("remainingQuantity" * "unitCost") cost FROM "InventoryBatch" GROUP BY 1,2) t;
 UPDATE "InventoryBatch" b SET "sellingPrice" = i."sellingPrice", "priceSource" = 'LEGACY_MASTER'
 FROM "InventoryItem" i WHERE b."itemId" = i.id AND b."sellingPrice" IS NULL;
 IF EXISTS (SELECT 1 FROM "InventoryBatch" WHERE "sellingPrice" IS NULL OR "sellingPrice" < 0) THEN
  RAISE EXCEPTION 'Missing or invalid batch prices';
 END IF;
 SELECT jsonb_agg(t ORDER BY t."branchId", t."itemId") INTO after_totals FROM
 (SELECT "branchId", "itemId", sum("remainingQuantity") quantity,
 sum("remainingQuantity" * "unitCost") cost FROM "InventoryBatch" GROUP BY 1,2) t;
 IF before_totals IS DISTINCT FROM after_totals THEN RAISE EXCEPTION 'Stock reconciliation failed'; END IF;
END $$;
ALTER TABLE "InventoryBatch" VALIDATE CONSTRAINT "InventoryBatch_sellingPrice_nonnegative";
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_price_required" CHECK ("sellingPrice" IS NOT NULL) NOT VALID;
ALTER TABLE "InventoryBatch" VALIDATE CONSTRAINT "InventoryBatch_price_required";
COMMIT;
`);
edit('scripts/verify-batch-prices.js',()=>`import prisma from '../src/config/prisma.js';
try {
 const missing = await prisma.inventoryBatch.count({ where: { sellingPrice: null } });
 const totals = await prisma.$queryRaw\`SELECT "branchId", "itemId", sum("remainingQuantity") AS quantity,
 sum("remainingQuantity" * "unitCost") AS "costValue", sum("remainingQuantity" * "sellingPrice") AS "retailValue"
 FROM "InventoryBatch" GROUP BY 1,2 ORDER BY 1,2\`;
 console.log(JSON.stringify({ missing, totals }, null, 2));
 if (missing) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
`);
edit('vitest.batch-pricing.config.js',()=>`import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
 resolve: { alias: { '@prisma/client': path.resolve('node_modules/.batch-pricing-client/index.js') } },
 test: { environment: 'node', include: ['tests/batch-pricing.test.js', 'tests/inventory-fifo-fefo.test.js', 'tests/batch-pricing.integration.test.js'],
 setupFiles: ['./tests/setupEnv.js'], fileParallelism: false, testTimeout: 30000, hookTimeout: 120000 }
});
`);
edit('tests/batch-pricing.test.js',()=>`import { describe, it, expect } from 'vitest';
import { pricePicks, assertBatchQuote, allocateBatchAmounts, refundBatchSlices } from '../src/lib/batchPricing.js';
import { toDec } from '../src/lib/money.js';
const picks = () => pricePicks([{batch:{id:'a',sellingPrice:300},quantity:toDec(1)}, {batch:{id:'b',sellingPrice:400},quantity:toDec(2)}]);
describe('batch selling price math', () => {
 it('reconciles mixed prices, discount, tax, partial and full refunds to the cent', () => {
  const allocated=allocateBatchAmounts(picks(),toDec(110),toDec(158.4));
  expect(allocated.map(a=>a.gross.toNumber())).toEqual([300,800]);
  expect(allocated.map(a=>a.discountAllocated.toNumber())).toEqual([30,80]);
  const rows=allocated.map((a,i)=>({...a,id:String(i),sortOrder:i,qty:a.quantity}));
  const first=refundBatchSlices(rows,0,1);
  expect(first[0].net.toNumber()).toBe(270); expect(first[0].tax.toNumber()).toBe(43.2);
  const second=refundBatchSlices(rows,1,1); const third=refundBatchSlices(rows,2,1);
  expect(second[0].net.plus(third[0].net).toNumber()).toBe(720);
  expect(second[0].tax.plus(third[0].tax).toNumber()).toBe(115.2);
 });
 it('rejects stale allocation identity even at the same price',()=>{
  expect(()=>assertBatchQuote(picks(),[{batchId:'x',quantity:1,sellingPrice:300},{batchId:'b',quantity:2,sellingPrice:400}])).toThrow();
 });
 it('rejects missing prices and accepts explicit zero',()=>{
  expect(()=>pricePicks([{batch:{},quantity:toDec(1)}])).toThrow();
  expect(pricePicks([{batch:{sellingPrice:0},quantity:toDec(1)}])[0].gross.toNumber()).toBe(0);
 });
 it('handles penny rounding and non-restocked earlier refunds',()=>{
  const rows=[{id:'a',sortOrder:0,qty:3,sellingPrice:1,discountAllocated:0.01,taxAllocated:0.48}];
  const parts=[0,1,2].map(skip=>refundBatchSlices(rows,skip,1)[0]);
  expect(parts.reduce((s,p)=>s.plus(p.net),toDec(0)).toNumber()).toBe(2.99);
  expect(parts.reduce((s,p)=>s.plus(p.tax),toDec(0)).toNumber()).toBe(0.48);
  expect(()=>refundBatchSlices(rows,2,2)).toThrow();
 });
});
`);
fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(manifest,null,2));
