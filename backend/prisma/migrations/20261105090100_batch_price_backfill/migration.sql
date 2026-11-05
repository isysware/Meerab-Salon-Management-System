-- Baseline legacy stock at the master price at deployment, never invent historical prices.
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
