// backend/src/lib/calculations/collectionAllocation.js
// Canonical collection-based payment allocation engine for SalonOS.
// Determines exact proportional allocation of actual customer payments into:
//   1. Collected Service/Product Net (Excl. Tax)
//   2. Collected Tax
//   3. Incremental Staff Commission Earned
// Follows strict cumulative-difference math to guarantee zero penny drift across installments.

import Decimal from 'decimal.js';

export const toDec = (v) => {
  if (v instanceof Decimal) return v;
  if (typeof v === 'number' || typeof v === 'string') return new Decimal(v || 0);
  if (v && typeof v.toNumber === 'function') return new Decimal(v.toString());
  return new Decimal(0);
};

export const round2 = (v) => toDec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const extractCommissionRate = (rateVal, fallbackVal = 0) => {
  // Persisted snapshots are percentages (0–100), including 1% and explicit zero.
  const value = rateVal !== undefined && rateVal !== null && rateVal !== '' ? rateVal : fallbackVal;
  const rate = toDec(value);
  return rate.isFinite() && rate.gte(0) ? round2(Decimal.min(100, rate)) : toDec(0);
};

/** Exact, deterministic proportional split. Remaining cents flow to later parts. */
export const allocateRounded = (amount, weights) => {
  let remaining = round2(amount);
  let weightLeft = weights.reduce((sum, weight) => sum.plus(toDec(weight)), toDec(0));
  return weights.map(weight => {
    const w = toDec(weight);
    const part = weightLeft.gt(0) ? round2(remaining.times(w).div(weightLeft)) : toDec(0);
    remaining = remaining.minus(part);
    weightLeft = weightLeft.minus(w);
    return part;
  });
};

/**
 * Deterministically allocate a customer payment (or dues payment) to an invoice's lines.
 *
 * @param {Object} params
 * @param {Object} params.invoice - Invoice with lines, components, tax, netSales, etc.
 * @param {Decimal|number} params.paymentAmount - Amount paid toward the bill (excluding tips)
 * @param {Decimal|number} [params.previousBillPaid=0] - Cumulative bill amount paid prior to this payment
 * @returns {Object} Allocation result:
 *   - lineAllocations: Array of { lineId, line, paymentAmount, collectedNet, collectedTax, commissions: [] }
 *   - totalCollectedNet: Decimal
 *   - totalCollectedTax: Decimal
 *   - totalEarnedCommission: Decimal
 *   - commissionsToRecord: Array of { staffId, staff, lineId, componentId, attributedNet, rate, amount }
 */
export function allocatePaymentToInvoice({ invoice, paymentAmount, previousBillPaid = 0 }) {
  const pAmt = round2(paymentAmount);
  if (pAmt.lessThanOrEqualTo(0)) {
    return {
      lineAllocations: [],
      totalCollectedNet: toDec(0),
      totalCollectedTax: toDec(0),
      totalEarnedCommission: toDec(0),
      commissionsToRecord: [],
    };
  }

  const prevPaid = round2(previousBillPaid);
  const netSales = round2(invoice.netSales);
  const tax = round2(invoice.tax || 0);
  const billTotal = round2(netSales.plus(tax));

  if (billTotal.lessThanOrEqualTo(0)) {
    return {
      lineAllocations: [],
      totalCollectedNet: pAmt,
      totalCollectedTax: toDec(0),
      totalEarnedCommission: toDec(0),
      commissionsToRecord: [],
    };
  }

  // Bound cumulative paid amounts to billTotal
  const bPrev = Decimal.min(billTotal, Decimal.max(0, prevPaid));
  const bCurr = Decimal.min(billTotal, Decimal.max(0, bPrev.plus(pAmt)));

  if (bCurr.lessThanOrEqualTo(bPrev)) {
    return {
      lineAllocations: [],
      totalCollectedNet: toDec(0),
      totalCollectedTax: toDec(0),
      totalEarnedCommission: toDec(0),
      commissionsToRecord: [],
    };
  }

  const lines = invoice.lines || [];
  if (lines.length === 0) {
    const cumNetPrev = bPrev.equals(billTotal) ? netSales : round2(netSales.times(bPrev).dividedBy(billTotal));
    const cumNetCurr = bCurr.equals(billTotal) ? netSales : round2(netSales.times(bCurr).dividedBy(billTotal));
    const deltaNet = round2(cumNetCurr.minus(cumNetPrev));
    const deltaPaid = round2(bCurr.minus(bPrev));
    const deltaTax = round2(deltaPaid.minus(deltaNet));

    return {
      lineAllocations: [],
      totalCollectedNet: deltaNet,
      totalCollectedTax: deltaTax,
      totalEarnedCommission: toDec(0),
      commissionsToRecord: [],
    };
  }

  const lineAllocations = [];
  const commissionsToRecord = [];
  let totalCollectedNet = toDec(0);
  let totalCollectedTax = toDec(0);
  let totalEarnedCommission = toDec(0);

  const weights = lines.map(line => round2(toDec(line.netSales).plus(line.tax || 0)));
  const previousParts = allocateRounded(bPrev, weights);
  const currentParts = allocateRounded(bCurr, weights);

  for (const [lineIndex, line] of lines.entries()) {
    const lNet = round2(line.netSales);
    const lTax = round2(line.tax || 0);
    const lTotal = round2(lNet.plus(lTax));

    if (lTotal.lessThanOrEqualTo(0)) {
      continue;
    }

    // Cumulative line payment at bPrev and bCurr
    const pLinePrev = previousParts[lineIndex];
    const pLineCurr = currentParts[lineIndex];
    const deltaLinePaid = round2(pLineCurr.minus(pLinePrev));

    // Cumulative net (excl tax) at bPrev and bCurr
    const netLinePrev = pLinePrev.equals(lTotal) ? lNet : round2(lNet.times(pLinePrev).dividedBy(lTotal));
    const netLineCurr = pLineCurr.equals(lTotal) ? lNet : round2(lNet.times(pLineCurr).dividedBy(lTotal));
    const deltaLineNet = round2(netLineCurr.minus(netLinePrev));
    const deltaLineTax = round2(deltaLinePaid.minus(deltaLineNet));

    totalCollectedNet = totalCollectedNet.plus(deltaLineNet);
    totalCollectedTax = totalCollectedTax.plus(deltaLineTax);

    const lineCommissions = [];

    // Commission is only earned on service/package lines (not products or house/unassigned)
    const isServiceOrPackage = line.type === 'SERVICE' || line.type === 'CUSTOM_SERVICE' || line.type === 'PACKAGE';

    if (isServiceOrPackage && deltaLineNet.greaterThan(0)) {
      const assignedStaff = line.assignedStaff || line.assignedStaffList || [];
      const components = line.components || line.packageComponents || [];

      if (assignedStaff.length > 0) {
        // Multi-staff assigned directly on service or package
        const validAssigned = assignedStaff.filter(
          (s) => (s.staffId || s.id) && (s.staffId || s.id) !== 'house' && (s.staffId || s.id) !== 'unassigned'
        );

        if (validAssigned.length > 0) {
          const totalStaffAllocated = validAssigned.reduce(
            (sum, s) => sum.plus(toDec(s.allocatedAmount || 0)),
            toDec(0)
          );
          const hasCustom = totalStaffAllocated.greaterThan(0);
          const staffWeights = validAssigned.map(st => hasCustom ? toDec(st.allocatedAmount || 0) : toDec(1));
          const staffPrevious = allocateRounded(netLinePrev, staffWeights);
          const staffCurrent = allocateRounded(netLineCurr, staffWeights);

          for (const [staffIndex, st] of validAssigned.entries()) {
            const stId = st.staffId || st.id;

            // Cumulative staff net
            const staffCumNetPrev = staffPrevious[staffIndex];
            const staffCumNetCurr = staffCurrent[staffIndex];
            const deltaStaffNet = round2(staffCumNetCurr.minus(staffCumNetPrev));

            const ratePercent = extractCommissionRate(st.staffCommissionRate, st.commissionRate || line.staffCommissionRate);

            if (ratePercent.greaterThan(0) && deltaStaffNet.greaterThan(0)) {


              // Cumulative commission at bPrev and bCurr
              const cumCommPrev = round2(staffCumNetPrev.times(ratePercent).dividedBy(100));
              const cumCommCurr = round2(staffCumNetCurr.times(ratePercent).dividedBy(100));
              const commAmount = round2(cumCommCurr.minus(cumCommPrev));

              if (commAmount.greaterThan(0)) {
                lineCommissions.push({
                  staffId: stId,
                  staff: st.staff || st,
                  staffName: st.staffName || st.name,
                  lineId: line.id,
                  componentId: null,
                  attributedNet: deltaStaffNet,
                  rate: ratePercent,
                  amount: commAmount,
                });
                commissionsToRecord.push({
                  staffId: stId,
                  staff: st.staff || st,
                  staffName: st.staffName || st.name,
                  lineId: line.id,
                  componentId: null,
                  attributedNet: deltaStaffNet,
                  rate: ratePercent,
                  amount: commAmount,
                });
                totalEarnedCommission = totalEarnedCommission.plus(commAmount);
              }
            }
          }
        }
      } else if (components.length > 0) {
        // Line components breakdown (packages or multi-staff assigned services)
        const componentWeights = components.map(c => c.allocatedAmount ?? toDec(lNet).times(c.allocationPercentage || 0).div(100));
        const componentPrevious = allocateRounded(netLinePrev, componentWeights);
        const componentCurrent = allocateRounded(netLineCurr, componentWeights);
        for (const [componentIndex, comp] of components.entries()) {
          const compStaffId = comp.staffId;
          if (!compStaffId || compStaffId === 'house' || compStaffId === 'unassigned') continue;

          const compCumNetPrev = componentPrevious[componentIndex];
          const compCumNetCurr = componentCurrent[componentIndex];
          const deltaCompNet = round2(compCumNetCurr.minus(compCumNetPrev));

          const ratePercent = extractCommissionRate(comp.staffCommissionRate, comp.commissionRate || line.staffCommissionRate);

          if (ratePercent.greaterThan(0) && deltaCompNet.greaterThan(0)) {
            const cumCommPrev = round2(compCumNetPrev.times(ratePercent).dividedBy(100));
            const cumCommCurr = round2(compCumNetCurr.times(ratePercent).dividedBy(100));
            const commAmount = round2(cumCommCurr.minus(cumCommPrev));

            if (commAmount.greaterThan(0)) {
              lineCommissions.push({
                staffId: compStaffId,
                staff: comp.staff,
                staffName: comp.staffName,
                lineId: line.id,
                componentId: comp.id,
                attributedNet: deltaCompNet,
                rate: ratePercent,
                amount: commAmount,
              });
              commissionsToRecord.push({
                staffId: compStaffId,
                staff: comp.staff,
                staffName: comp.staffName,
                lineId: line.id,
                componentId: comp.id,
                attributedNet: deltaCompNet,
                rate: ratePercent,
                amount: commAmount,
              });
              totalEarnedCommission = totalEarnedCommission.plus(commAmount);
            }
          }
        }
      } else if (line.staffId && line.staffId !== 'house' && line.staffId !== 'unassigned') {
        // Single staff assigned to service line
        const ratePercent = extractCommissionRate(line.staffCommissionRate, line.commissionRate || (line.staff ? line.staff.commissionRate : 0));

        if (ratePercent.greaterThan(0)) {
          const cumCommPrev = round2(netLinePrev.times(ratePercent).dividedBy(100));
          const cumCommCurr = round2(netLineCurr.times(ratePercent).dividedBy(100));
          const commAmount = round2(cumCommCurr.minus(cumCommPrev));

          if (commAmount.greaterThan(0)) {
            lineCommissions.push({
              staffId: line.staffId,
              staff: line.staff,
              staffName: line.staffName,
              lineId: line.id,
              componentId: null,
              attributedNet: deltaLineNet,
              rate: ratePercent,
              amount: commAmount,
            });
            commissionsToRecord.push({
              staffId: line.staffId,
              staff: line.staff,
              staffName: line.staffName,
              lineId: line.id,
              componentId: null,
              attributedNet: deltaLineNet,
              rate: ratePercent,
              amount: commAmount,
            });
            totalEarnedCommission = totalEarnedCommission.plus(commAmount);
          }
        }
      }
    }

    lineAllocations.push({
      lineId: line.id,
      line,
      paymentAmount: deltaLinePaid,
      collectedNet: deltaLineNet,
      collectedTax: deltaLineTax,
      commissions: lineCommissions,
    });
  }

  return {
    lineAllocations,
    totalCollectedNet: round2(totalCollectedNet),
    totalCollectedTax: round2(totalCollectedTax),
    totalEarnedCommission: round2(totalEarnedCommission),
    commissionsToRecord,
  };
}

/**
 * Compute the overall collection breakdown for an invoice up to its current paid amount.
 */
export function getInvoiceCollectionSummary(invoice) {
  const netSales = round2(invoice.netSales);
  const tax = round2(invoice.tax || 0);
  const tip = round2(invoice.tip || 0);
  const billTotal = round2(netSales.plus(tax));
  const fullTotal = round2(billTotal.plus(tip));

  const payments = (invoice.payments || []).filter((p) => !p.reversedAt);
  const billPaid = payments.length > 0
    ? round2(payments.reduce((sum, p) => sum.plus(toDec(p.billAmountAllocated ?? p.amount)), toDec(0)))
    : round2(Decimal.max(0, toDec(invoice.amountPaid).minus(tip)));

  const effectiveBillPaid = Decimal.min(billTotal, Decimal.max(0, billPaid));
  const remainingBill = round2(billTotal.minus(effectiveBillPaid));

  let collectedNet = toDec(0);
  let collectedTax = toDec(0);

  if (billTotal.greaterThan(0)) {
    collectedNet = effectiveBillPaid.equals(billTotal)
      ? netSales
      : round2(netSales.times(effectiveBillPaid).dividedBy(billTotal));
    collectedTax = round2(effectiveBillPaid.minus(collectedNet));
  }

  return {
    netSales,
    tax,
    tip,
    billTotal,
    fullTotal,
    billPaid: effectiveBillPaid,
    collectedNet,
    collectedTax,
    remainingBill,
    status: remainingBill.lessThanOrEqualTo(0) ? 'PAID' : effectiveBillPaid.greaterThan(0) ? 'PARTIAL' : 'UNPAID',
  };
}

/**
 * Standard business collection formula:
 * Service Collection = Actual Service Amount Collected
 * Tax = Service Collection × Tax Rate / 100
 * Staff Commission = Service Collection × Commission Rate / 100
 * Total Collection = Service Collection + Tax
 * Outstanding = Invoice Total - Total Collection Received
 */
export function calculateCollectionBreakdown({ serviceCollection, taxRate = 10, commissionRate = 10, invoiceTotal = 1100 }) {
  const sCol = round2(serviceCollection);
  const tRate = toDec(taxRate);
  const cRate = toDec(commissionRate);
  const invTot = round2(invoiceTotal);

  const tax = round2(sCol.times(tRate).dividedBy(100));
  const staffCommission = round2(sCol.times(cRate).dividedBy(100));
  const totalReceived = round2(sCol.plus(tax));
  const remainingDues = round2(invTot.minus(totalReceived));

  return {
    serviceCollection: sCol,
    tax,
    staffCommission,
    totalReceived,
    remainingDues,
  };
}

export function calculateServiceFromReceived({ totalReceived, taxRate = 10, commissionRate = 10, invoiceTotal = 1100 }) {
  const tRec = round2(totalReceived);
  const tRate = toDec(taxRate);
  const cRate = toDec(commissionRate);
  const invTot = round2(invoiceTotal);

  const divisor = toDec(1).plus(tRate.dividedBy(100));
  const sCol = round2(tRec.dividedBy(divisor));
  const tax = round2(tRec.minus(sCol));
  const staffCommission = round2(sCol.times(cRate).dividedBy(100));
  const remainingDues = round2(invTot.minus(tRec));

  return {
    serviceCollection: sCol,
    tax,
    staffCommission,
    totalReceived: tRec,
    remainingDues,
  };
}
