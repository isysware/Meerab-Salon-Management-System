// AUTO-PORTED from frontend src/lib/commissionCalculations.ts (types stripped with esbuild). Keep logic identical to the frontend.
import { roundCurrency } from "./taxCalculations.js";
function isCompensationEligibleForCommission(compensationType) {
  return compensationType === "MONTHLY_PLUS_COMMISSION" || compensationType === "DAILY_PLUS_COMMISSION" || compensationType === "COMMISSION_ONLY";
}
function evaluateStaffCommission(staff, startDate, endDate, invoices, consumedLineItemIds = /* @__PURE__ */ new Set()) {
  const isEligible = isCompensationEligibleForCommission(staff.compensationType);
  if (!isEligible) {
    return {
      isEligible: false,
      consumedAttributionIds: [],
      statement: {
        staffId: staff.id,
        staffName: staff.name,
        employeeCode: staff.employeeCode,
        designation: staff.designation || staff.roleTitle,
        branchId: staff.branchId,
        startDate,
        endDate,
        compensationType: staff.compensationType,
        commissionRatePercent: staff.commissionRate || 0,
        servicesCompletedCount: 0,
        attributedNetSales: 0,
        grossCommissionEarned: 0,
        refundAdjustments: 0,
        netCommissionPayable: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        lineItems: []
      }
    };
  }
  const relevantInvoices = invoices.filter((inv) => {
    if (inv.branchId !== staff.branchId) return false;
    if (inv.date < startDate || inv.date > endDate) return false;
    return true;
  });
  const attributionLines = [];
  const newlyConsumedIds = [];
  let attributedNetSales = 0;
  let grossCommissionEarned = 0;
  let refundAdjustments = 0;
  let servicesCompletedCount = 0;
  for (const inv of relevantInvoices) {
    const isDuesOnly = (inv.lineItems || []).length === 0;
    if (isDuesOnly) continue;
    const isVoided = !!(inv.notes && inv.notes.toLowerCase().includes("void"));
    const collectionRatio = (inv.status === 'UNPAID' || (inv.amountPaid !== undefined && Number(inv.amountPaid || 0) <= 0 && inv.status !== 'PAID'))
      ? 0
      : (inv.status === 'PAID' || inv.amountPaid === undefined || !inv.total || Number(inv.total) <= 0)
      ? 1
      : Math.min(1, Math.max(0, Number(inv.amountPaid || 0) / Number(inv.total)));
    (inv.lineItems || []).forEach((item, itemIdx) => {
      if (item.type === "SERVICE" && item.staffId === staff.id) {
        const lineKey = item.id || item.lineInstanceId || `idx-${itemIdx}-${item.itemId || "svc"}`;
        const attributionId = `${inv.id}-li-${lineKey}`;
        if (consumedLineItemIds.has(attributionId)) {
          return;
        }
        const lineGross = item.unitPrice * (item.quantity || 1);
        let discountAllocation = typeof item.discountAllocated === "number" ? item.discountAllocated : 0;
        if (!discountAllocation && inv.discount && inv.subtotal > 0) {
          discountAllocation = roundCurrency(lineGross / inv.subtotal * inv.discount);
        }
        const netServiceSalesFull = typeof item.netSales === "number" ? item.netSales : roundCurrency(lineGross - discountAllocation);
        const netServiceSales = roundCurrency(netServiceSalesFull * collectionRatio);
        const rawRate = typeof item.staffCommissionRate === "number" ? item.staffCommissionRate : typeof item.commissionRate === "number" ? item.commissionRate : staff.commissionRate || 0;
        const effectiveRatePercent = rawRate > 0 && rawRate <= 1 ? roundCurrency(rawRate * 100) : rawRate;
        const earned = roundCurrency((netServiceSalesFull * (effectiveRatePercent / 100)) * collectionRatio);
        if (isVoided) {
          refundAdjustments -= earned;
        } else {
          attributedNetSales += netServiceSales;
          grossCommissionEarned += earned;
          servicesCompletedCount += item.quantity || 1;
        }
        newlyConsumedIds.push(attributionId);
        attributionLines.push({
          id: attributionId,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          clientName: inv.clientName,
          serviceOrPackageId: item.itemId || item.id,
          serviceOrPackageName: item.name,
          itemType: "SERVICE",
          isPackageComponent: false,
          cataloguePrice: lineGross,
          discountAllocation,
          netAttributedAmount: isVoided ? -netServiceSales : netServiceSales,
          commissionRatePercent: effectiveRatePercent,
          commissionEarned: isVoided ? -earned : earned
        });
      }

      if (item.assignedStaff && item.assignedStaff.length > 0) {
        const assignedStaffList = item.assignedStaff;
        const isStaffAssigned = assignedStaffList.some((st) => st.staffId === staff.id);
        if (isStaffAssigned) {
          const numStaff = assignedStaffList.length;
          const lineGross = (item.unitPrice || 0) * (item.quantity || 1);
          let discountAllocation = typeof item.discountAllocated === 'number' ? item.discountAllocated : 0;
          if (!discountAllocation && inv.discount && inv.subtotal > 0) {
            discountAllocation = roundCurrency((lineGross / inv.subtotal) * inv.discount);
          }
          const netSales =
            typeof item.netSales === 'number'
              ? item.netSales
              : roundCurrency(lineGross - discountAllocation);

          const staffEntry = assignedStaffList.find((st) => st.staffId === staff.id);
          const hasCustom = typeof staffEntry?.allocatedAmount === 'number' && staffEntry.allocatedAmount > 0;
          const discountRatio = lineGross > 0 ? netSales / lineGross : 1;
          const staffShareGross = hasCustom ? staffEntry.allocatedAmount : roundCurrency(lineGross / numStaff);
          const staffShareNetFull = hasCustom ? roundCurrency(staffEntry.allocatedAmount * discountRatio) : roundCurrency(netSales / numStaff);
          const staffShareNet = roundCurrency(staffShareNetFull * collectionRatio);
          const staffShareDiscount = roundCurrency(Math.max(0, staffShareGross - staffShareNetFull));

          const rawRate = typeof staffEntry?.staffCommissionRate === 'number'
            ? staffEntry.staffCommissionRate
            : (staff.commissionRate || 0);
          const effectiveRatePercent = rawRate > 0 && rawRate <= 1 ? roundCurrency(rawRate * 100) : rawRate;
          const earned = roundCurrency((staffShareNetFull * (effectiveRatePercent / 100)) * collectionRatio);

          const lineKey = item.id || item.lineInstanceId || `idx-${itemIdx}-${item.itemId || 'pkg'}`;
          const attributionId = `${inv.id}-pkg-${lineKey}-${staff.id}`;
          if (!consumedLineItemIds.has(attributionId)) {
            if (isVoided) {
              refundAdjustments -= earned;
            } else {
              attributedNetSales += staffShareNet;
              grossCommissionEarned += earned;
              servicesCompletedCount += (item.quantity || 1);
            }
            newlyConsumedIds.push(attributionId);
            attributionLines.push({
              id: attributionId,
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              date: inv.date,
              clientName: inv.clientName,
              serviceOrPackageId: item.itemId || item.id,
              serviceOrPackageName: item.name,
              itemType: item.type || 'PACKAGE',
              isPackageComponent: false,
              componentPackageName: item.name,
              cataloguePrice: staffShareGross,
              discountAllocation: staffShareDiscount,
              netAttributedAmount: isVoided ? -staffShareNet : staffShareNet,
              commissionRatePercent: effectiveRatePercent,
              commissionEarned: isVoided ? -earned : earned,
            });
          }
        }
      }

      const comps = item.packageComponents || item.components;
      if (item.type === "PACKAGE" && Array.isArray(comps)) {
        comps.forEach((comp, compIdx) => {
          if (comp.staffId === staff.id) {
            const lineKey = item.id || item.lineInstanceId || `idx-${itemIdx}-${item.itemId || "pkg"}`;
            const compKey = comp.componentInstanceId || comp.id || (comp.serviceId && compIdx === 0 ? comp.serviceId : `${comp.serviceId || "comp"}-${compIdx}`);
            const attributionId = `${inv.id}-comp-${lineKey}-${compKey}`;
            if (consumedLineItemIds.has(attributionId)) {
              return;
            }
            let allocatedAmount = 0;
            let rawAllocated = comp.allocatedAmount || 0;
            let compDiscount = 0;
            if (typeof comp.netAllocatedAmount === "number") {
              allocatedAmount = comp.netAllocatedAmount;
              rawAllocated = comp.allocatedAmount || allocatedAmount;
              compDiscount = roundCurrency(Math.max(0, rawAllocated - allocatedAmount));
            } else if (typeof comp.netSales === "number") {
              allocatedAmount = comp.netSales;
              rawAllocated = comp.allocatedAmount || allocatedAmount;
              compDiscount = roundCurrency(Math.max(0, rawAllocated - allocatedAmount));
            } else {
              rawAllocated = comp.allocatedAmount || 0;
              if (inv.discount && inv.subtotal > 0) {
                compDiscount = roundCurrency(rawAllocated / inv.subtotal * inv.discount);
              }
              allocatedAmount = roundCurrency(rawAllocated - compDiscount);
            }
            const rawCompRate = typeof comp.staffCommissionRate === "number" ? comp.staffCommissionRate : typeof comp.commissionRate === "number" ? comp.commissionRate : staff.commissionRate || 0;
            const compRatePercent = rawCompRate > 0 && rawCompRate <= 1 ? roundCurrency(rawCompRate * 100) : rawCompRate;
            const allocatedAmountFull = allocatedAmount;
            const earned = roundCurrency((allocatedAmountFull * (compRatePercent / 100)) * collectionRatio);
            allocatedAmount = roundCurrency(allocatedAmountFull * collectionRatio);
            if (isVoided) {
              refundAdjustments -= earned;
            } else {
              attributedNetSales += allocatedAmount;
              grossCommissionEarned += earned;
              servicesCompletedCount += comp.quantity || 1;
            }
            newlyConsumedIds.push(attributionId);
            attributionLines.push({
              id: attributionId,
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              date: inv.date,
              clientName: inv.clientName,
              serviceOrPackageId: comp.serviceId,
              serviceOrPackageName: comp.serviceName,
              itemType: "PACKAGE",
              isPackageComponent: true,
              componentPackageName: item.name,
              cataloguePrice: rawAllocated,
              discountAllocation: compDiscount,
              netAttributedAmount: isVoided ? -allocatedAmount : allocatedAmount,
              commissionRatePercent: compRatePercent,
              commissionEarned: isVoided ? -earned : earned
            });
          }
        });
      }
    });
  }
  attributedNetSales = roundCurrency(attributedNetSales);
  grossCommissionEarned = roundCurrency(grossCommissionEarned);
  refundAdjustments = roundCurrency(refundAdjustments);
  const netCommissionPayable = roundCurrency(Math.max(0, grossCommissionEarned + refundAdjustments));
  return {
    isEligible: true,
    consumedAttributionIds: newlyConsumedIds,
    statement: {
      staffId: staff.id,
      staffName: staff.name,
      employeeCode: staff.employeeCode,
      designation: staff.designation || staff.roleTitle,
      branchId: staff.branchId,
      startDate,
      endDate,
      compensationType: staff.compensationType,
      commissionRatePercent: staff.commissionRate || 0,
      servicesCompletedCount,
      attributedNetSales,
      grossCommissionEarned,
      refundAdjustments,
      netCommissionPayable,
      paidAmount: 0,
      outstandingAmount: netCommissionPayable,
      lineItems: attributionLines
    }
  };
}
export {
  evaluateStaffCommission,
  isCompensationEligibleForCommission
};
