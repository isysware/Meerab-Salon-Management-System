import { describe, it, expect } from 'vitest';
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
