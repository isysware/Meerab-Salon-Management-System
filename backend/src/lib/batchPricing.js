import { toDec, round2, splitWithRemainder } from './money.js';
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
