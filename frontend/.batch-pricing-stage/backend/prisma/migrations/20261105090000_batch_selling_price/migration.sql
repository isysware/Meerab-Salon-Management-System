-- Expand only. Existing invoices and ledger entries are never rewritten.
ALTER TABLE "InventoryBatch" ADD COLUMN "sellingPrice" DECIMAL(14,2), ADD COLUMN "priceSource" TEXT;
ALTER TABLE "InvoiceLineBatch" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "sellingPrice" DECIMAL(14,2), ADD COLUMN "discountAllocated" DECIMAL(14,2), ADD COLUMN "taxAllocated" DECIMAL(14,2);
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_sellingPrice_nonnegative" CHECK ("sellingPrice" >= 0) NOT VALID;

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
