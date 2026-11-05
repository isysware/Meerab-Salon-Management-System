const fs=require('fs');
function edit(file, fn) {const s=fs.readFileSync(file,'utf8'); fs.writeFileSync(file, fn(s));}
function rep(s,a,b){if(!s.includes(a))throw Error(a);return s.replace(a,b);}
edit('src/types/salon.ts',s=>{
 s=rep(s,'  unitPurchaseCost?: number; // alias for unitCostSnapshot','  sellingPrice?: number; // immutable batch receipt price\n  priceSource?: string;\n  unitPurchaseCost?: number; // alias for unitCostSnapshot');
 s=rep(s,'export interface InvoiceLineItem {','export interface InvoiceLineItem {\n  batchAllocations?: Array<{ batchId: string; batchNumber: string; quantity: number; unitCost: number; sellingPrice: number; discountAllocated?: number; taxAllocated?: number }>;');
 return s;
});
edit('src/features/pos/POSBillingPage.tsx',s=>{
 s=rep(s,"import React,", "import Decimal from 'decimal.js';\nimport { orderedSaleBatches, quoteCart } from './batchPricing';\nimport type { InventoryBatch } from '@/types/salon';\nimport React,");
 s=rep(s,'  const [productStockMap,','  const [saleBatches, setSaleBatches] = useState<InventoryBatch[]>([]);\n  const [productStockMap,');
 s=rep(s,'      setProducts(retailProds);',`      setSaleBatches(batchList);
      setProducts(retailProds.map(p => {
        const next = orderedSaleBatches(batchList, p, bId)[0];
        return { ...p, sellingPrice: next?.sellingPrice ?? 0, price: next?.sellingPrice ?? 0 };
      }));`);
 s=rep(s,'  const calculations = useMemo(() => {',`  const batchQuotes = useMemo(() => quoteCart(cart, saleBatches, selectedBranchId), [cart, saleBatches, selectedBranchId]);
  const lineGross = (ci: POSCartItem) => ci.type === 'PRODUCT' ? (batchQuotes.get(ci.cartInstanceId)?.gross ?? 0) : new Decimal(getCatalogueSellingPrice(ci.item)).times(ci.quantity).toNumber();
  const calculations = useMemo(() => {`);
 // Only replace price arithmetic used for totals/rendering; service assignment behavior stays intact.
 const index=s.indexOf('  const batchQuotes =');
 s=s.slice(0,index)+s.slice(index).replaceAll('getCatalogueSellingPrice(ci.item) * ci.quantity','lineGross(ci)').replaceAll('getCatalogueSellingPrice(cart[best].item) * cart[best].quantity','lineGross(cart[best])').replace('roundCurrency(itemPrice * ci.quantity)','roundCurrency(lineGross(ci))');
 s=rep(s,'if (loadedBooking && cart.length > 0 && grossSubtotal > 0)', 'if (cart.length > 0 && grossSubtotal > 0)');
 s=rep(s,': branchTaxRate;\n      const lineTax',": (ci.item.taxTreatment === 'EXEMPT' ? 0 : ci.item.taxTreatment === 'SPECIFIC_RULE' ? taxRules.find(r => r.id === getCatalogueTaxRuleId(ci.item))?.rate || 0 : branchTaxRate);\n      const lineTax");
 s=rep(s,'[cart, discountType, discountValue, tipAmount, currentBranch, applyBranchTax, loadedBooking, taxRules]', '[cart, batchQuotes, discountType, discountValue, tipAmount, currentBranch, applyBranchTax, loadedBooking, taxRules]');
 s=rep(s,'      const sanitizedCart = cart.map((ci) => {',`      if (cart.some(ci => ci.type === 'PRODUCT' && !batchQuotes.get(ci.cartInstanceId)?.complete)) {
        throw new Error('Insufficient priced stock. Refresh the catalogue before checkout.');
      }
      const sanitizedCart = cart.map((ci) => {`);
 s=rep(s,'          staffId: primary.staffId,',"          item: ci.type === 'PRODUCT' ? { ...ci.item, batchQuote: batchQuotes.get(ci.cartInstanceId)?.allocations } : ci.item,\n          staffId: primary.staffId,");
 s=rep(s,'{formatCurrency(lineGross(ci))}\n                    </span>',`{formatCurrency(lineGross(ci))}
                      {ci.type === 'PRODUCT' && <span className="block text-[10px] font-normal text-slate-500">
                        {batchQuotes.get(ci.cartInstanceId)?.allocations.map(a => <span key={a.batchId} className="block">{a.quantity} × {formatCurrency(a.sellingPrice)}</span>)}
                      </span>}
                    </span>`);
 return s;
});
edit('src/features/inventory/StockInPurchasesPage.tsx',s=>s.replace('Update Sale Price','Batch Sale Price').replace('Optional — preserves current','Optional — defaults to').replace('Keep previous price','Use product default').replace('l.sellingPrice !== undefined && Number(l.sellingPrice) > 0','l.sellingPrice !== undefined'));
edit('src/features/inventory/InventoryPage.tsx',s=>{
 s=s.replace('(b.unitCostSnapshot || item.defaultPurchaseCost)','(b.unitCostSnapshot ?? item.defaultPurchaseCost)');
 s=s.replace('totalRetailVal += isConsumable ? 0 : currentQty * (item.sellingPrice || 0);','totalRetailVal += isConsumable ? 0 : itemBatches.reduce((sum, b) => sum + (b.remainingQuantity || 0) * (b.sellingPrice ?? item.sellingPrice ?? 0), 0);');
 return rep(s,'{formatCurrency(batch.unitCostSnapshot || 0)}</span>','{formatCurrency(batch.unitCostSnapshot || 0)}</span>\n                    <span className="text-[10px] text-slate-400 block">Batch Sale Price:</span>\n                    <span className="font-mono">{batch.sellingPrice == null ? \'Pending migration\' : formatCurrency(batch.sellingPrice)}</span>');
});
edit('src/features/pos/ReceiptModal.tsx',s=>{
 s=s.replaceAll('li.unitPrice * li.quantity','li.netSales + li.discountAllocated');
 return rep(s,'{formatCurrency(li.netSales + li.discountAllocated)}','{formatCurrency(li.netSales + li.discountAllocated)}\n                      {li.batchAllocations?.map(a => <div key={a.batchId} className="text-[10px] font-normal text-slate-500">{a.batchNumber}: {a.quantity} × {formatCurrency(a.sellingPrice)}</div>)}');
});
edit('src/features/pos/receiptPdf.ts',s=>s.replaceAll('li.unitPrice * li.quantity','li.netSales + li.discountAllocated'));
