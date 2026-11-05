import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import prisma from '../src/config/prisma.js';
import { createPurchase, stockSnapshots } from '../src/modules/inventory/inventory.service.js';
import { postInvoice } from '../src/modules/pos/pos.service.js';
import { refundInvoice } from '../src/modules/pos/pos.refund.js';
import { paymentRequestHash } from '../src/lib/paymentPosting.js';
import { pickBatches } from '../src/lib/stock.js';
let admin, staff, other, counter=0;
const request = (body,key=`batch-${++counter}`) => ({key,route:'batch-pricing-test',hash:paymentRequestHash(body)});
async function item(suffix, expiry=false) {
 return prisma.inventoryItem.create({data:{sku:`BP-${suffix}`,name:`Batch ${suffix}`,category:'Test',itemType:'RETAIL_PRODUCT',
 defaultPurchaseCost:100,sellingPrice:300,purchaseUnit:'BOTTLE',issueUnit:'BOTTLE',branchAvailability:['branch-1'],trackExpiry:expiry}});
}
async function buy(product, quantity, cost, price, expiryDate) {
 const body={branchId:'branch-1',supplierId:'sup-1',paymentMethod:'CREDIT',purchaseDate:'2026-09-28',
 lines:[{itemId:product.id,quantity,unitPurchaseCost:cost,sellingPrice:price,expiryDate}]};
 return createPurchase(body,admin,request(body));
}
async function saleBody(product, quantity, extra={}) {
 const picks=await prisma.$transaction(tx=>pickBatches(tx,{itemId:product.id,branchId:'branch-1',quantity,businessDate:'2026-09-28'}));
 return {branchId:'branch-1',clientName:'Batch Test',clientPhone:'03001112222',applyTax:false,discountType:'FIXED',discountValue:0,payments:[],
 cartItems:[{type:'PRODUCT',item:{id:product.id,price:300,batchQuote:picks.map(p=>({batchId:p.batch.id,quantity:Number(p.quantity),sellingPrice:Number(p.batch.sellingPrice)}))},quantity,staffId:'house'}],...extra};
}
const sell = async body => postInvoice(body,admin,undefined,request(body));
describe('real PostgreSQL batch pricing',()=>{
 beforeAll(async()=>{
  admin=await prisma.user.findFirst({where:{role:'ADMIN',branchId:'branch-1'}});
  staff=await prisma.user.findFirst({where:{role:'STAFF',branchId:'branch-1'}});
  other={...admin,branchId:'branch-2'};
  // Use existing seeded business date, set through its existing setting record.
 });
 afterAll(()=>prisma.$disconnect());
 it('required FIFO scenario, historical invoice, valuation, COGS and automatic switch',async()=>{
  const p=await item('fifo'); await buy(p,5,100,300); await sell(await saleBody(p,2));
  await buy(p,5,200,400);
  const first=await sell(await saleBody(p,2)); expect(first.subtotal).toBe(600);
  const second=await sell(await saleBody(p,3)); expect(second.subtotal).toBe(1100);
  expect(second.lineItems[0].batchAllocations.map(b=>[b.quantity,b.sellingPrice])).toEqual([[1,300],[2,400]]);
  expect(second.lineItems[0].cogsAmount).toBe(500);
  expect(second.netSales-second.lineItems[0].cogsAmount).toBe(600);
  const snapshot=(await stockSnapshots(admin,'branch-1')).find(s=>s.itemId===p.id);
  expect(snapshot.currentStock).toBe(3);expect(snapshot.valuationCostBasis).toBe(600);
  expect((await saleBody(p,1)).cartItems[0].item.batchQuote[0].sellingPrice).toBe(400);
  expect(Number((await prisma.invoice.findUnique({where:{id:first.id}})).subtotal)).toBe(600);
  expect(Number((await prisma.inventoryItem.findUnique({where:{id:p.id}})).sellingPrice)).toBe(300);
 });
 it('FEFO chooses newer stock with earlier expiry and rejects stale prices',async()=>{
  const p=await item('fefo',true); await buy(p,2,100,300,'2029-12-01');
  const stale=await saleBody(p,1); await buy(p,2,200,400,'2028-01-01');
  await expect(sell(stale)).rejects.toMatchObject({code:'PRICE_OUTDATED'});
  const invoice=await sell(await saleBody(p,1));expect(invoice.subtotal).toBe(400);expect(invoice.lineItems[0].cogsAmount).toBe(200);
 });
 it('mixed discounts/tax and repeated partial/full returns restore original batches',async()=>{
  const p=await item('returns');await buy(p,1,100,300);await buy(p,2,200,400);
  const invoice=await sell(await saleBody(p,3,{applyTax:true,discountType:'PERCENTAGE',discountValue:10}));
  expect(invoice.subtotal).toBe(1100);expect(invoice.discount).toBe(110);expect(invoice.tax).toBe(158.4);expect(invoice.total).toBe(1148.4);
  const line=invoice.lineItems[0];
  const refund=qty=>refundInvoice({invoiceId:invoice.id,type:'REFUND',reason:'Batch return test',lines:[{lineId:line.id,quantity:qty,restock:'RESALABLE'}]},admin);
  const a=await refund(1);expect(a.refund.netReversed).toBe(270);expect(a.refund.taxReversed).toBe(43.2);
  const b=await refund(1);expect(b.refund.netReversed).toBe(360);
  const c=await refund(1);expect(c.refund.netReversed).toBe(360);expect(c.invoice.lifecycle).toBe('REFUNDED');
  const batches=await prisma.inventoryBatch.findMany({where:{itemId:p.id},orderBy:{sellingPrice:'asc'}});
  expect(batches.map(b=>Number(b.remainingQuantity))).toEqual([1,2]);
  expect(batches.map(b=>Number(b.sellingPrice))).toEqual([300,400]);
 });
 it('concurrent checkouts cannot oversell; concurrent retries deduct once',async()=>{
  const p=await item('concurrent');await buy(p,1,100,300);
  const body=await saleBody(p,1);
  const results=await Promise.allSettled([sell(body),sell(body)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const p2=await item('retry');await buy(p2,2,100,300);const body2=await saleBody(p2,1);const req=request(body2,'same-checkout');
  const invoices=await Promise.all([postInvoice(body2,admin,undefined,req),postInvoice(body2,admin,undefined,req)]);
  expect(invoices[0].id).toBe(invoices[1].id);
  expect(await prisma.stockMovement.count({where:{itemId:p2.id,movementType:'POS_SALE_OUT'}})).toBe(1);
 });
 it('rejects staff and cross-branch checkout; snapshots fail closed without assigned branch',async()=>{
  const p=await item('auth');await buy(p,1,100,300);const body=await saleBody(p,1);
  await expect(postInvoice(body,staff)).rejects.toMatchObject({status:403});
  await expect(postInvoice(body,other)).rejects.toMatchObject({status:403});
  await expect(postInvoice({...body,branchId:undefined},{...admin,branchId:null})).rejects.toMatchObject({status:403});
  const superActor={...admin,role:'SUPER_ADMIN'};expect((await postInvoice(body,superActor,undefined,request(body))).subtotal).toBe(300);
 });
});
