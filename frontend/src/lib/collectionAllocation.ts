// frontend/src/lib/collectionAllocation.ts
// Canonical collection-based payment allocation engine for SalonOS (Frontend mirror).

export interface LineAllocationResult {
  lineId: string;
  paymentAmount: number;
  collectedNet: number;
  collectedTax: number;
  commissions: Array<{
    staffId: string;
    staffName?: string;
    lineId: string;
    componentId?: string | null;
    attributedNet: number;
    rate: number;
    amount: number;
  }>;
}

export interface PaymentAllocationResult {
  lineAllocations: LineAllocationResult[];
  totalCollectedNet: number;
  totalCollectedTax: number;
  totalEarnedCommission: number;
  commissionsToRecord: Array<{
    staffId: string;
    staffName?: string;
    lineId: string;
    componentId?: string | null;
    attributedNet: number;
    rate: number;
    amount: number;
  }>;
}

const round2 = (val: number): number => Math.round(val * 100) / 100;

export function allocatePaymentToInvoice({
  invoice,
  paymentAmount,
  previousBillPaid = 0,
}: {
  invoice: any;
  paymentAmount: number;
  previousBillPaid?: number;
}): PaymentAllocationResult {
  const pAmt = round2(paymentAmount);
  if (pAmt <= 0) {
    return {
      lineAllocations: [],
      totalCollectedNet: 0,
      totalCollectedTax: 0,
      totalEarnedCommission: 0,
      commissionsToRecord: [],
    };
  }

  const prevPaid = round2(previousBillPaid);
  const netSales = round2(Number(invoice.netSales) || 0);
  const tax = round2(Number(invoice.tax) || 0);
  const billTotal = round2(netSales + tax);

  if (billTotal <= 0) {
    return {
      lineAllocations: [],
      totalCollectedNet: pAmt,
      totalCollectedTax: 0,
      totalEarnedCommission: 0,
      commissionsToRecord: [],
    };
  }

  const bPrev = Math.min(billTotal, Math.max(0, prevPaid));
  const bCurr = Math.min(billTotal, Math.max(0, bPrev + pAmt));

  if (bCurr <= bPrev) {
    return {
      lineAllocations: [],
      totalCollectedNet: 0,
      totalCollectedTax: 0,
      totalEarnedCommission: 0,
      commissionsToRecord: [],
    };
  }

  const lines = invoice.lines || [];
  if (lines.length === 0) {
    const cumNetPrev = bPrev === billTotal ? netSales : round2((netSales * bPrev) / billTotal);
    const cumNetCurr = bCurr === billTotal ? netSales : round2((netSales * bCurr) / billTotal);
    const deltaNet = round2(cumNetCurr - cumNetPrev);
    const deltaPaid = round2(bCurr - bPrev);
    const deltaTax = round2(deltaPaid - deltaNet);

    return {
      lineAllocations: [],
      totalCollectedNet: deltaNet,
      totalCollectedTax: deltaTax,
      totalEarnedCommission: 0,
      commissionsToRecord: [],
    };
  }

  const lineAllocations: LineAllocationResult[] = [];
  const commissionsToRecord: PaymentAllocationResult['commissionsToRecord'] = [];
  let totalCollectedNet = 0;
  let totalCollectedTax = 0;
  let totalEarnedCommission = 0;

  for (const line of lines) {
    const lNet = round2(Number(line.netSales) || 0);
    const lTax = round2(Number(line.tax) || 0);
    const lTotal = round2(lNet + lTax);

    if (lTotal <= 0) continue;

    const pLinePrev = bPrev === billTotal ? lTotal : round2((lTotal * bPrev) / billTotal);
    const pLineCurr = bCurr === billTotal ? lTotal : round2((lTotal * bCurr) / billTotal);
    const deltaLinePaid = round2(pLineCurr - pLinePrev);

    const netLinePrev = pLinePrev === lTotal ? lNet : round2((lNet * pLinePrev) / lTotal);
    const netLineCurr = pLineCurr === lTotal ? lNet : round2((lNet * pLineCurr) / lTotal);
    const deltaLineNet = round2(netLineCurr - netLinePrev);
    const deltaLineTax = round2(deltaLinePaid - deltaLineNet);

    totalCollectedNet += deltaLineNet;
    totalCollectedTax += deltaLineTax;

    const lineCommissions: LineAllocationResult['commissions'] = [];
    const isServiceOrPackage = line.type === 'SERVICE' || line.type === 'CUSTOM_SERVICE' || line.type === 'PACKAGE';

    if (isServiceOrPackage && deltaLineNet > 0) {
      const assignedStaff = line.assignedStaff || line.assignedStaffList || [];
      const components = line.components || line.packageComponents || [];

      if (assignedStaff.length > 0) {
        const validAssigned = assignedStaff.filter(
          (s: any) => (s.staffId || s.id) && (s.staffId || s.id) !== 'house' && (s.staffId || s.id) !== 'unassigned'
        );

        if (validAssigned.length > 0) {
          const totalStaffAllocated = validAssigned.reduce(
            (sum: number, s: any) => sum + (Number(s.allocatedAmount) || 0),
            0
          );
          const hasCustom = totalStaffAllocated > 0;

          for (const st of validAssigned) {
            const stId = st.staffId || st.id;
            const stAlloc = hasCustom ? (Number(st.allocatedAmount) || 0) : lNet / validAssigned.length;

            const staffCumNetPrev = netLinePrev === lNet ? round2(stAlloc) : round2((stAlloc * netLinePrev) / lNet);
            const staffCumNetCurr = netLineCurr === lNet ? round2(stAlloc) : round2((stAlloc * netLineCurr) / lNet);
            const deltaStaffNet = round2(staffCumNetCurr - staffCumNetPrev);

            const rawRate = typeof st.staffCommissionRate === 'number'
              ? st.staffCommissionRate
              : typeof st.commissionRate === 'number'
              ? st.commissionRate
              : Number(line.staffCommissionRate || 0);
            const ratePercent = rawRate > 0 && rawRate <= 1 ? round2(rawRate * 100) : round2(rawRate);

            if (ratePercent > 0 && deltaStaffNet > 0) {
              const fullStaffComm = round2((stAlloc * ratePercent) / 100);
              const cumCommPrev = bPrev === billTotal ? fullStaffComm : round2((fullStaffComm * bPrev) / billTotal);
              const cumCommCurr = bCurr === billTotal ? fullStaffComm : round2((fullStaffComm * bCurr) / billTotal);
              const commAmount = round2(cumCommCurr - cumCommPrev);

              if (commAmount > 0) {
                const commEntry = {
                  staffId: stId,
                  staffName: st.staffName || st.name,
                  lineId: line.id,
                  componentId: null,
                  attributedNet: deltaStaffNet,
                  rate: ratePercent,
                  amount: commAmount,
                };
                lineCommissions.push(commEntry);
                commissionsToRecord.push(commEntry);
                totalEarnedCommission += commAmount;
              }
            }
          }
        }
      } else if (components.length > 0) {
        for (const comp of components) {
          const compStaffId = comp.staffId;
          if (!compStaffId || compStaffId === 'house' || compStaffId === 'unassigned') continue;

          const rawAlloc = Number(comp.allocatedAmount) || 0;
          const compAlloc = rawAlloc > 0
            ? rawAlloc
            : (Number(comp.allocationPercentage) > 0
                ? round2((lNet * Number(comp.allocationPercentage)) / 100)
                : round2(lNet / components.length));
          const compCumNetPrev = netLinePrev === lNet ? round2(compAlloc) : round2((compAlloc * netLinePrev) / lNet);
          const compCumNetCurr = netLineCurr === lNet ? round2(compAlloc) : round2((compAlloc * netLineCurr) / lNet);
          const deltaCompNet = round2(compCumNetCurr - compCumNetPrev);

          const rawRate = typeof comp.staffCommissionRate === 'number'
            ? comp.staffCommissionRate
            : typeof comp.commissionRate === 'number'
            ? comp.commissionRate
            : 0;
          const ratePercent = rawRate > 0 && rawRate <= 1 ? round2(rawRate * 100) : round2(rawRate);

          if (ratePercent > 0 && deltaCompNet > 0) {
            const fullCompComm = round2((compAlloc * ratePercent) / 100);
            const cumCommPrev = bPrev === billTotal ? fullCompComm : round2((fullCompComm * bPrev) / billTotal);
            const cumCommCurr = bCurr === billTotal ? fullCompComm : round2((fullCompComm * bCurr) / billTotal);
            const commAmount = round2(cumCommCurr - cumCommPrev);

            if (commAmount > 0) {
              const commEntry = {
                staffId: compStaffId,
                staffName: comp.staffName,
                lineId: line.id,
                componentId: comp.id,
                attributedNet: deltaCompNet,
                rate: ratePercent,
                amount: commAmount,
              };
              lineCommissions.push(commEntry);
              commissionsToRecord.push(commEntry);
              totalEarnedCommission += commAmount;
            }
          }
        }
      } else if (line.staffId && line.staffId !== 'house' && line.staffId !== 'unassigned') {
        const rawRate = Number(line.staffCommissionRate || 0);
        const ratePercent = rawRate > 0 && rawRate <= 1 ? round2(rawRate * 100) : round2(rawRate);

        if (ratePercent > 0 && deltaLineNet > 0) {
          const fullLineComm = round2((lNet * ratePercent) / 100);
          const cumCommPrev = bPrev === billTotal ? fullLineComm : round2((fullLineComm * bPrev) / billTotal);
          const cumCommCurr = bCurr === billTotal ? fullLineComm : round2((fullLineComm * bCurr) / billTotal);
          const commAmount = round2(cumCommCurr - cumCommPrev);

          if (commAmount > 0) {
            const commEntry = {
              staffId: line.staffId,
              staffName: line.staffName,
              lineId: line.id,
              componentId: null,
              attributedNet: deltaLineNet,
              rate: ratePercent,
              amount: commAmount,
            };
            lineCommissions.push(commEntry);
            commissionsToRecord.push(commEntry);
            totalEarnedCommission += commAmount;
          }
        }
      }
    }

    lineAllocations.push({
      lineId: line.id,
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

export function getInvoiceCollectionSummary(invoice: any) {
  const netSales = round2(Number(invoice.netSales) || 0);
  const tax = round2(Number(invoice.tax) || 0);
  const tip = round2(Number(invoice.tip) || 0);
  const billTotal = round2(netSales + tax);
  const fullTotal = round2(billTotal + tip);

  const payments = (invoice.payments || []).filter((p: any) => !p.reversedAt);
  const billPaid = payments.length > 0
    ? round2(payments.reduce((sum: number, p: any) => sum + (Number(p.billAmountAllocated ?? p.amount) || 0), 0))
    : round2(Math.max(0, (Number(invoice.amountPaid) || 0) - tip));

  const effectiveBillPaid = Math.min(billTotal, Math.max(0, billPaid));
  const remainingBill = round2(billTotal - effectiveBillPaid);

  let collectedNet = 0;
  let collectedTax = 0;

  if (billTotal > 0) {
    collectedNet = effectiveBillPaid === billTotal
      ? netSales
      : round2((netSales * effectiveBillPaid) / billTotal);
    collectedTax = round2(effectiveBillPaid - collectedNet);
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
    status: remainingBill <= 0 ? 'PAID' : effectiveBillPaid > 0 ? 'PARTIAL' : 'UNPAID',
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
export function calculateCollectionBreakdown({
  serviceCollection,
  taxRate = 10,
  commissionRate = 10,
  invoiceTotal = 1100,
}: {
  serviceCollection: number;
  taxRate?: number;
  commissionRate?: number;
  invoiceTotal?: number;
}) {
  const sCol = round2(serviceCollection);
  const tax = round2((sCol * taxRate) / 100);
  const staffCommission = round2((sCol * commissionRate) / 100);
  const totalReceived = round2(sCol + tax);
  const remainingDues = round2(invoiceTotal - totalReceived);

  return {
    serviceCollection: sCol,
    tax,
    staffCommission,
    totalReceived,
    remainingDues,
  };
}

export function calculateServiceFromReceived({
  totalReceived,
  taxRate = 10,
  commissionRate = 10,
  invoiceTotal = 1100,
}: {
  totalReceived: number;
  taxRate?: number;
  commissionRate?: number;
  invoiceTotal?: number;
}) {
  const tRec = round2(totalReceived);
  const divisor = 1 + taxRate / 100;
  const sCol = round2(tRec / divisor);
  const tax = round2(tRec - sCol);
  const staffCommission = round2((sCol * commissionRate) / 100);
  const remainingDues = round2(invoiceTotal - tRec);

  return {
    serviceCollection: sCol,
    tax,
    staffCommission,
    totalReceived: tRec,
    remainingDues,
  };
}
