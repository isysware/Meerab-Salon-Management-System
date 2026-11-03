// src/modules/reports/reports.service.js
// Read-only operational reports built from canonical tables:
//   • Appointment report  — bookings with their linked invoice outcome
//   • Staff performance   — invoice-line attribution + commission, tips, attendance, overtime
// Voided invoices never count as performance. Tips are reported separately from sales.

import prisma from '../../config/prisma.js';
import { forbidden, notFound } from '../../lib/AppError.js';
import { resolveReadBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, ymd, startOfDay, endOfDay, toDateString, toTimeString } from '../../lib/dates.js';
import { max0, round2, toDec } from '../../lib/money.js';
import { listAppointments } from '../appointments/appointments.service.js';
import { inventorySummary } from '../inventory/inventory.service.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';
import { allocatePaymentToInvoice } from '../../lib/calculations/collectionAllocation.js';

const n = (d) => round2(d ?? 0).toNumber();
const range = (startDate, endDate) => ({ gte: dateOnly(startDate), lte: dateOnly(endDate) });

const denyNonAdmins = (actor, what) => {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) throw forbidden('FORBIDDEN', `Access Denied: Only administrators can access ${what}.`);
};

// ═══ APPOINTMENT REPORT ═══════════════════════════════════════════════════════

export const appointmentReport = async (actor, q) => {
  denyNonAdmins(actor, 'appointment reports');
  const { startDate, endDate } = q;

  let list = await listAppointments(actor, {
    branchId: q.branchId, startDate, endDate, status: q.status, staffId: q.staffId, search: q.search,
  });
  if (q.billingStatus) list = list.filter((a) => a.billingStatus === q.billingStatus);
  if (q.customerSource) list = list.filter((a) => a.customerSource === q.customerSource);
  if (q.serviceId) {
    list = list.filter((a) => a.items.some((it) =>
      (it.type === 'SERVICE' && it.itemId === q.serviceId) || it.packageComponents?.some((pc) => pc.serviceId === q.serviceId)));
  }
  if (q.packageId) list = list.filter((a) => a.items.some((it) => it.type === 'PACKAGE' && it.itemId === q.packageId));

  const invoiceIds = [...new Set(list.map((a) => a.linkedInvoiceId).filter(Boolean))];
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, netSales: true, total: true, status: true } })
    : [];
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  const records = list.map((apt) => {
    const staffNames = new Set();
    for (const it of apt.items) {
      if (it.staffName) staffNames.add(it.staffName);
      for (const pc of it.packageComponents ?? []) if (pc.staffName) staffNames.add(pc.staffName);
    }
    const first = apt.items[0];
    const inv = apt.linkedInvoiceId ? invoiceById.get(apt.linkedInvoiceId) : undefined;
    return {
      id: apt.id,
      appointmentNumber: apt.appointmentNumber,
      branchId: apt.branchId,
      branchName: apt.branchName,
      date: apt.date,
      startTime: apt.startTime,
      endTime: apt.endTime,
      clientName: apt.clientName,
      clientPhone: apt.clientPhone,
      customerSource: apt.customerSource,
      serviceSummary: apt.items.map((it) => (it.type === 'PACKAGE' ? `${it.name} (Pkg)` : it.name)).join(', ') || 'Service',
      staffSummary: [...staffNames].join(', ') || 'Unassigned',
      primaryStaffId: first?.staffId ?? '',
      primaryStaffName: first?.staffName ?? '',
      quotedPrice: apt.price,
      status: apt.status,
      billingStatus: apt.billingStatus,
      linkedInvoiceId: apt.linkedInvoiceId,
      linkedInvoiceNumber: apt.linkedInvoiceNumber,
      actualNetSales: inv ? n(inv.netSales) : undefined,
      actualInvoiceTotal: inv ? n(inv.total) : undefined,
      invoicePaymentStatus: inv?.status,
      durationMinutes: apt.durationMinutes,
    };
  });

  const count = (pred) => records.filter(pred).length;
  const estimated = records
    .filter((r) => r.status !== 'CANCELLED' && r.status !== 'NO_SHOW')
    .reduce((s, r) => s.plus(r.quotedPrice), toDec(0));
  const invNet = invoices.reduce((s, i) => s.plus(i.netSales), toDec(0));
  const invTotal = invoices.reduce((s, i) => s.plus(i.total), toDec(0));

  return {
    records,
    summary: {
      totalAppointments: records.length,
      pendingCount: count((r) => r.status === 'PENDING'),
      confirmedCount: count((r) => r.status === 'CONFIRMED'),
      checkedInCount: count((r) => r.status === 'CHECKED_IN'),
      inServiceCount: count((r) => r.status === 'IN_SERVICE'),
      completedCount: count((r) => r.status === 'COMPLETED'),
      cancelledCount: count((r) => r.status === 'CANCELLED'),
      noShowCount: count((r) => r.status === 'NO_SHOW'),
      billedCount: count((r) => r.billingStatus === 'BILLED'),
      unbilledCount: count((r) => r.billingStatus !== 'BILLED'),
      totalQuotedValue: n(estimated),
      totalActualNetSales: n(invNet),
      totalEstimatedValue: n(estimated),
      actualInvoiceNetSales: n(invNet),
      actualInvoiceTotal: n(invTotal),
    },
  };
};

// ═══ STAFF PERFORMANCE ════════════════════════════════════════════════════════

const computePerformance = async (staffList, startDate, endDate, filters = {}) => {
  if (!staffList.length) return [];
  const ids = staffList.map((s) => s.id);
  const period = range(startDate, endDate);
  const activeInvoice = { date: period, lifecycle: { not: 'VOIDED' } };

  const [lines, statements, allocations, payouts, attendance, overtime] = await Promise.all([
    prisma.invoiceLine.findMany({
      where: {
        type: { not: 'PRODUCT' },
        invoice: activeInvoice,
        OR: [{ staffId: { in: ids } }, { components: { some: { staffId: { in: ids } } } }],
      },
      include: { components: true, invoice: { select: { id: true, invoiceNumber: true, date: true, time: true, clientId: true, clientName: true } } },
    }),
    prisma.commissionStatement.findMany({
      where: {
        staffId: { in: ids },
        run: { status: { notIn: ['DRAFT', 'CANCELLED'] }, startDate: { lte: dateOnly(endDate) }, endDate: { gte: dateOnly(startDate) } },
      },
      include: { payments: true },
    }),
    prisma.tipAllocation.findMany({ where: { staffId: { in: ids }, allocationDate: period, status: { not: 'CANCELLED' } } }),
    // Dated events (spec §4.4): a payout stays in its own period; a later reversal lands on the reversal date.
    prisma.tipPayout.findMany({ where: { staffId: { in: ids }, OR: [{ payoutDate: period }, { reversalDate: period }] } }),
    prisma.attendanceRecord.findMany({ where: { staffId: { in: ids }, workDate: period } }),
    prisma.overtimeRecord.findMany({ where: { staffId: { in: ids }, workDate: period, status: 'APPROVED' } }),
  ]);

  const branches = await prisma.branch.findMany({ where: { id: { in: [...new Set(staffList.map((s) => s.branchId))] } } });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const of = (rows, sid) => rows.filter((r) => r.staffId === sid);

  return staffList.map((st) => {
    const detailedServices = [];
    const clients = new Set();
    let direct = 0;
    let comps = 0;
    let gross = toDec(0);
    let disc = toDec(0);
    let net = toDec(0);
    let commissionEligibleNet = toDec(0);
    let commission = toDec(0);

    for (const line of lines) {
      const inv = line.invoice;
      const lineGross = toDec(line.unitPrice).times(line.quantity);
      const clientKey = inv.clientId || inv.clientName?.trim().toLowerCase();

      if (['SERVICE', 'CUSTOM_SERVICE'].includes(line.type) && line.staffId === st.id) {
        if (filters.serviceId && filters.serviceId !== 'ALL' && line.itemId !== filters.serviceId) continue;
        if (filters.packageId && filters.packageId !== 'ALL') continue;
        const rate = toDec(line.staffCommissionRate);
        const earned = round2(toDec(line.netSales).times(rate).dividedBy(100));
        direct += Number(line.quantity);
        gross = gross.plus(lineGross);
        disc = disc.plus(line.discountAllocated);
        net = net.plus(line.netSales);
        if (rate.gt(0)) {
          commissionEligibleNet = commissionEligibleNet.plus(line.netSales);
        }
        commission = commission.plus(earned);
        if (clientKey) clients.add(clientKey);
        detailedServices.push({
          invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, date: ymd(inv.date), time: inv.time, clientName: inv.clientName,
          itemId: line.itemId, serviceName: line.name, itemType: 'SERVICE',
          cataloguePrice: n(lineGross), discountAllocated: n(line.discountAllocated), netSales: n(line.netSales),
          commissionRatePercent: rate.toNumber(), commissionEarned: n(earned),
        });
      }

      if (line.type === 'PACKAGE') {
        if (filters.packageId && filters.packageId !== 'ALL' && line.itemId !== filters.packageId) continue;
        const netRatio = lineGross.gt(0) ? toDec(line.netSales).dividedBy(lineGross) : toDec(1);
        for (const c of [...line.components].sort((a, b) => a.sortOrder - b.sortOrder)) {
          if (c.staffId !== st.id) continue;
          if (filters.serviceId && filters.serviceId !== 'ALL' && c.serviceId !== filters.serviceId) continue;
          const allocated = toDec(c.allocatedAmount);
          const allocatedNet = round2(allocated.times(netRatio));
          const rate = toDec(c.staffCommissionRate);
          const earned = round2(allocatedNet.times(rate).dividedBy(100));
          comps += c.quantity || 1;
          gross = gross.plus(allocated);
          disc = disc.plus(allocated.minus(allocatedNet));
          net = net.plus(allocatedNet);
          if (rate.gt(0)) {
            commissionEligibleNet = commissionEligibleNet.plus(allocatedNet);
          }
          commission = commission.plus(earned);
          if (clientKey) clients.add(clientKey);
          detailedServices.push({
            invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, date: ymd(inv.date), time: inv.time, clientName: inv.clientName,
            itemId: c.serviceId, serviceName: `${c.serviceName} (${line.name})`, itemType: 'PACKAGE_COMPONENT',
            cataloguePrice: n(allocated), discountAllocated: n(allocated.minus(allocatedNet)), netSales: n(allocatedNet),
            commissionRatePercent: rate.toNumber(), commissionEarned: n(earned),
          });
        }
      }
    }

    const myStatements = of(statements, st.id);
    const finalized = myStatements.reduce((s, x) => s.plus(x.netPayable), toDec(0));
    const paidCommission = myStatements
      .flatMap((x) => x.payments)
      .filter((p) => p.status === 'COMPLETED')
      .reduce((s, p) => s.plus(p.amount), toDec(0));
    const allocatedTips = of(allocations, st.id).reduce((s, a) => s.plus(a.amount), toDec(0));
    const inPeriod = (x) => x && ymd(x) >= startDate && ymd(x) <= endDate;
    const paidTips = of(payouts, st.id).reduce((s, p) => s.plus(inPeriod(p.payoutDate) ? p.amount : 0).minus(inPeriod(p.reversalDate) ? p.amount : 0), toDec(0));
    const att = of(attendance, st.id);
    const ot = of(overtime, st.id);
    const outstanding = allocatedTips.minus(paidTips);

    return {
      staffId: st.id,
      staffName: st.name,
      staffCode: st.employeeCode,
      roleTitle: st.roleTitle || st.designation,
      branchId: st.branchId,
      branchName: branchName.get(st.branchId) ?? 'Branch',
      directServicesCount: direct,
      packageComponentsCount: comps,
      totalServiceUnits: direct + comps,
      uniqueClientsCount: clients.size,
      attributedGrossSales: n(gross),
      discountAllocation: n(disc),
      attributedNetSales: n(net),
      commissionEligibleSales: n(commissionEligibleNet),
      estimatedCommission: n(commission),
      finalizedCommission: n(finalized),
      paidCommission: n(paidCommission),
      allocatedTips: n(allocatedTips),
      paidTips: n(paidTips),
      outstandingTips: n(outstanding.gt(0) ? outstanding : 0),
      workedHours: n(att.reduce((s, a) => s.plus(a.workedHours), toDec(0))),
      presentDays: att.filter((a) => a.status === 'PRESENT').length,
      latePunchesCount: att.filter((a) => a.isLate).length,
      approvedOvertimeMinutes: ot.reduce((s, o) => s + o.approvedMinutes, 0),
      approvedOvertimePay: n(ot.reduce((s, o) => s.plus(o.amount ?? 0), toDec(0))),
      detailedServices: detailedServices.sort((a, b) => b.date.localeCompare(a.date) || String(b.time).localeCompare(String(a.time))),
    };
  });
};

export const staffPerformance = async (actor, q) => {
  denyNonAdmins(actor, 'staff performance');
  const b = resolveReadBranch(actor, q.branchId);
  const staff = await prisma.staff.findMany({
    where: {
      ...(b ? { branchId: b } : {}),
      ...(q.staffId && q.staffId !== 'ALL' ? { id: q.staffId } : {}),
    },
    orderBy: { name: 'asc' },
  });
  const rows = await computePerformance(staff, q.startDate, q.endDate, q);
  return rows.sort((x, y) => y.attributedNetSales - x.attributedNetSales);
};

export const personalPerformance = async (actor, q = {}) => {
  if (!actor.staffId) throw forbidden('FORBIDDEN', 'Staff record associated with the authenticated user could not be found.');
  const staff = await prisma.staff.findUnique({ where: { id: actor.staffId } });
  if (!staff) throw notFound('STAFF_NOT_FOUND', 'Staff record associated with the authenticated user could not be found.');
  const today = await getBusinessDate();
  const startDate = q.startDate || `${today.slice(0, 7)}-01`;
  const endDate = q.endDate || today;
  return (await computePerformance([staff], startDate, endDate))[0];
};

// ═══ SALES & INVOICES REPORT (Spec §9.2) ═════════════════════════════════════

export const salesInvoicesReport = async (actor, q = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access sales & invoices report.');

  const ctx = await resolveReportContext(actor, q, 'INVOICE_POSTING');

  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const where = {
    date: dateRange,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  };

  // Scope to actor if ACCOUNTANT, or apply cashier/soldBy filter for administrators
  if (actor.role === 'ACCOUNTANT') {
    where.processedByUserId = actor.id;
  } else if (q.soldByUserId && q.soldByUserId !== 'ALL') {
    where.processedByUserId = q.soldByUserId;
  } else if (q.accountantId && q.accountantId !== 'ALL') {
    where.processedByUserId = q.accountantId;
  } else if (q.userId && q.userId !== 'ALL') {
    where.processedByUserId = q.userId;
  }

  if (q.paymentStatus && q.paymentStatus !== 'ALL') {
    where.status = q.paymentStatus;
  }

  if (q.lifecycle && q.lifecycle !== 'ALL') {
    where.lifecycle = q.lifecycle;
  }

  if (q.paymentMethod && q.paymentMethod !== 'ALL') {
    where.paymentMethod = q.paymentMethod;
  }

  if (q.staffId && q.staffId !== 'ALL') {
    where.OR = [
      { staffId: q.staffId },
      { lines: { some: { staffId: q.staffId } } },
    ];
  }

  if (q.clientId) {
    where.clientId = q.clientId;
  }

  if (q.search && q.search.trim()) {
    const s = q.search.trim();
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { invoiceNumber: { contains: s, mode: 'insensitive' } },
          { clientName: { contains: s, mode: 'insensitive' } },
          { clientPhone: { contains: s, mode: 'insensitive' } },
        ],
      },
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      lines: {
        select: {
          id: true,
          name: true,
          type: true,
          staffId: true,
          staffName: true,
          quantity: true,
          unitPrice: true,
          discountAllocated: true,
          netSales: true,
          tax: true,
          total: true,
        },
      },
      payments: {
        select: {
          id: true,
          amount: true,
          method: true,
          paymentAccountId: true,
          paymentAccountName: true,
          date: true,
        },
      },
      refunds: {
        select: {
          id: true,
          refundNumber: true,
          type: true,
          refundDate: true,
          netReversed: true,
          taxReversed: true,
          tipReversed: true,
          cashOut: true,
          receivableCancelled: true,
          reason: true,
        },
      },
    },
    orderBy: [
      { date: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  const branches = await prisma.branch.findMany({
    select: { id: true, name: true },
  });
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  let totalGross = toDec(0);
  let totalDiscount = toDec(0);
  let totalNetSales = toDec(0);
  let totalTaxCharged = toDec(0);
  let totalTaxReversed = toDec(0);
  let totalTips = toDec(0);
  let totalInvoiceAmount = toDec(0);
  let totalPaid = toDec(0);
  let totalRefunded = toDec(0);
  let totalOutstanding = toDec(0);

  let activeCount = 0;
  let partiallyRefundedCount = 0;
  let refundedCount = 0;
  let voidedCount = 0;

  let totalCashCollected = toDec(0);
  let totalOnlineCollected = toDec(0);
  const onlineAccountsMap = new Map();

  for (const inv of invoices) {
    for (const p of inv.payments) {
      const amt = toDec(p.amount);
      if (p.method === 'CASH') {
        totalCashCollected = totalCashCollected.plus(amt);
      } else {
        totalOnlineCollected = totalOnlineCollected.plus(amt);
        const accName = p.paymentAccountName || 'Online Account';
        const accId = p.paymentAccountId || 'online';
        const existing = onlineAccountsMap.get(accName) || { accountId: accId, accountName: accName, amount: toDec(0), count: 0 };
        existing.amount = existing.amount.plus(amt);
        existing.count += 1;
        onlineAccountsMap.set(accName, existing);
      }
    }
    // Deduct actually paid refunds from cash & online collection totals
    if (inv.lifecycle !== 'VOIDED') {
      for (const r of inv.refunds) {
        const cashOut = toDec(r.cashOut || 0);
        if (cashOut.greaterThan(0)) {
          if (r.method === 'CASH') {
            totalCashCollected = totalCashCollected.minus(cashOut);
          } else {
            totalOnlineCollected = totalOnlineCollected.minus(cashOut);
            for (const acc of onlineAccountsMap.values()) {
              if (r.accountId && acc.accountId === r.accountId) {
                acc.amount = acc.amount.minus(cashOut);
              }
            }
          }
        }
      }
    }
  }

  const onlineAccountsBreakdown = Array.from(onlineAccountsMap.values()).map((a) => ({
    accountId: a.accountId,
    accountName: a.accountName,
    amount: n(max0(a.amount)),
    count: a.count,
  }));

  const rows = invoices.map((inv) => {
    const gross = toDec(inv.subtotal);
    const discount = toDec(inv.discount);
    const netSales = toDec(inv.netSales);
    const taxCharged = toDec(inv.tax);
    const tip = toDec(inv.tip);
    const total = toDec(inv.total);
    const paid = inv.lifecycle === 'VOIDED' ? toDec(0) : toDec(inv.amountPaid);
    const outstanding = inv.lifecycle === 'VOIDED' ? toDec(0) : toDec(inv.amountDue);

    const refundedNet = inv.refunds.reduce((sum, r) => sum.plus(r.netReversed), toDec(0));
    const refundedTax = inv.refunds.reduce((sum, r) => sum.plus(r.taxReversed), toDec(0));
    const refundedTip = inv.refunds.reduce((sum, r) => sum.plus(r.tipReversed), toDec(0));
    const refundedCashOut = inv.refunds.reduce((sum, r) => sum.plus(r.cashOut || 0), toDec(0));
    const totalRefund = refundedNet.plus(refundedTax).plus(refundedTip);

    if (inv.lifecycle !== 'VOIDED') {
      totalGross = totalGross.plus(gross);
      totalDiscount = totalDiscount.plus(discount);
      totalNetSales = totalNetSales.plus(netSales).minus(refundedNet);
      totalTaxCharged = totalTaxCharged.plus(taxCharged).minus(refundedTax);
      totalTaxReversed = totalTaxReversed.plus(refundedTax);
      totalTips = totalTips.plus(tip).minus(refundedTip);
      totalInvoiceAmount = totalInvoiceAmount.plus(total).minus(totalRefund);
      totalPaid = totalPaid.plus(paid);
      totalOutstanding = totalOutstanding.plus(outstanding);
    }
    totalRefunded = totalRefunded.plus(totalRefund);

    if (inv.lifecycle === 'ACTIVE') activeCount++;
    else if (inv.lifecycle === 'PARTIALLY_REFUNDED') partiallyRefundedCount++;
    else if (inv.lifecycle === 'REFUNDED') refundedCount++;
    else if (inv.lifecycle === 'VOIDED') voidedCount++;

    const linesSummary = inv.lines.map((l) => `${l.name} (${Number(l.quantity)})`).join(', ') || 'General';
    const staffSummary = [...new Set(inv.lines.map((l) => l.staffName).filter(Boolean))].join(', ') || inv.staffName || 'Unassigned';

    let rowCash = toDec(0);
    let rowOnline = toDec(0);
    for (const p of inv.payments) {
      if (p.method === 'CASH') rowCash = rowCash.plus(toDec(p.amount));
      else rowOnline = rowOnline.plus(toDec(p.amount));
    }
    if (inv.lifecycle !== 'VOIDED') {
      for (const r of inv.refunds) {
        const cashOut = toDec(r.cashOut || 0);
        if (cashOut.greaterThan(0)) {
          if (r.method === 'CASH') rowCash = max0(rowCash.minus(cashOut));
          else rowOnline = max0(rowOnline.minus(cashOut));
        }
      }
    }

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: ymd(inv.date),
      time: inv.time,
      branchId: inv.branchId,
      branchName: branchMap.get(inv.branchId) || 'Branch',
      clientId: inv.clientId,
      clientName: inv.clientName,
      clientPhone: inv.clientPhone,
      customerSource: inv.customerSource,
      soldByUserId: inv.processedByUserId,
      soldByName: inv.processedByName,
      staffSummary,
      linesSummary,
      paymentMethod: inv.paymentMethod,
      paymentStatus: inv.status,
      lifecycle: inv.lifecycle,
      gross: n(gross),
      discount: n(discount),
      netSales: n(netSales),
      tax: n(taxCharged),
      taxCharged: n(taxCharged),
      taxReversed: n(refundedTax),
      netTaxLiability: n(taxCharged.minus(refundedTax)),
      tip: n(tip),
      total: n(total),
      paid: n(paid),
      refunded: n(totalRefund),
      refundedAmount: n(totalRefund),
      refundedCashOut: n(refundedCashOut),
      outstanding: n(outstanding),
      cashPaid: n(rowCash),
      onlinePaid: n(rowOnline),
      payments: inv.payments.map((p) => ({
        id: p.id,
        amount: n(p.amount),
        method: p.method,
        paymentAccountId: p.paymentAccountId,
        paymentAccountName: p.paymentAccountName,
        date: ymd(p.date),
      })),
      notes: inv.notes,
      refundCount: inv.refunds.length,
    };
  });

  const netTaxLiability = totalTaxCharged.minus(totalTaxReversed);

  const kpis = {
    totalInvoices: invoices.length,
    grossSales: n(totalGross),
    totalDiscounts: n(totalDiscount),
    netSales: n(totalNetSales),
    taxCharged: n(totalTaxCharged),
    taxReversed: n(totalTaxReversed),
    netTaxLiability: n(netTaxLiability),
    tipsCollected: n(totalTips),
    invoiceTotal: n(totalInvoiceAmount),
    totalPaid: n(totalPaid),
    totalRefunded: n(totalRefunded),
    totalOutstanding: n(totalOutstanding),
    totalCashCollected: n(totalCashCollected),
    totalOnlineCollected: n(totalOnlineCollected),
    activeCount,
    partiallyRefundedCount,
    refundedCount,
    voidedCount,
  };

  const tenderBreakdown = {
    totalCash: n(totalCashCollected),
    totalOnline: n(totalOnlineCollected),
    grandTotal: n(totalCashCollected.plus(totalOnlineCollected)),
    onlineAccounts: onlineAccountsBreakdown,
  };

  const totals = {
    gross: n(totalGross),
    discount: n(totalDiscount),
    netSales: n(totalNetSales),
    tax: n(totalTaxCharged),
    taxCharged: n(totalTaxCharged),
    taxReversed: n(totalTaxReversed),
    netTaxLiability: n(netTaxLiability),
    tip: n(totalTips),
    total: n(totalInvoiceAmount),
    paid: n(totalPaid),
    refunded: n(totalRefunded),
    outstanding: n(totalOutstanding),
    cashCollected: n(totalCashCollected),
    onlineCollected: n(totalOnlineCollected),
  };

  return formatReportResponse(ctx.meta, { kpis, tenderBreakdown, rows, totals });
};

// ═══ INCOME & EXPENSE REPORT ══════════════════════════════════════════════════

export const incomeExpenseReport = async (actor, query = {}) => {
  const ctx = await resolveReportContext(actor, query, 'RECOGNITION');
  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const utcRange = { gte: ctx.fromDate, lte: ctx.toDate };
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  const [branches, staffMembers, users, invoices, duesPayments, refunds, expenses, payrollRuns, commissionEvents, inventoryLosses, retailCogsAgg, consumableUsageAgg, returnedCogsAgg] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true, city: true } }),
    prisma.staff.findMany({ select: { id: true, name: true, employeeCode: true, branchId: true } }),
    prisma.user.findMany({ select: { id: true, name: true, role: true, branchId: true } }),
    // Original invoice recognition remains dated; refund/void events reverse it on their own date.
    prisma.invoice.findMany({
      where: {
        date: dateRange,
        ...branchFilter,
        ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        time: true,
        branchId: true,
        clientId: true,
        clientName: true,
        subtotal: true,
        discount: true,
        netSales: true,
        tax: true,
        total: true,
        amountPaid: true,
        amountDue: true,
        advanceAdjusted: true,
        paymentMethod: true,
        status: true,
        lifecycle: true,
        processedByName: true,
        notes: true,
        lines: {
          select: {
            id: true,
            type: true,
            netSales: true,
            tax: true,
            staffId: true,
            staffName: true,
            staffCommissionRate: true,
            components: true,
          },
        },
        payments: { where: { reversedAt: null }, select: { kind: true, billAmountAllocated: true } },
      },
    }),
    // Dues collections received during this reporting period
    prisma.invoicePayment.findMany({
      where: {
        kind: 'DUES_COLLECTION',
        reversedAt: null,
        date: dateRange,
        invoice: {
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
          ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}),
        },
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            date: true,
            branchId: true,
            clientName: true,
            subtotal: true,
            discount: true,
            netSales: true,
            tax: true,
            total: true,
            advanceAdjusted: true,
            lines: { select: { id: true, type: true, netSales: true, tax: true, staffId: true, staffName: true, staffCommissionRate: true, components: true } },
            payments: {
              where: { reversedAt: null },
              orderBy: { createdAt: 'asc' },
              select: { id: true, billAmountAllocated: true, createdAt: true },
            },
          },
        },
      },
    }),
    // 2. Sales Refunds (Dated Reversal Events reducing recognized income)
    prisma.invoiceRefund.findMany({
      where: {
        refundDate: dateRange,
        invoice: {
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
          ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}),
        },
      },
      select: {
        id: true,
        refundNumber: true,
        refundDate: true,
        netReversed: true,
        taxReversed: true,
        tipReversed: true,
        cashOut: true,
        receivableCancelled: true,
        method: true,
        reason: true,
        byName: true,
        invoice: { select: { id: true, invoiceNumber: true, branchId: true } },
      },
    }),
    // 3. Operating Expenses (excludes DRAFT unless explicitly requested)
    prisma.expense.findMany({
      where: {
        expenseDate: dateRange,
        ...branchFilter,
        ...(actor.role === 'ACCOUNTANT' ? { OR: [{ paidByUserId: actor.id }, { createdByUserId: actor.id }] } : {}),
        ...(query.status && query.status !== 'ALL'
          ? { status: query.status }
          : { status: { not: 'DRAFT' } }),
      },
      select: {
        id: true,
        voucherNumber: true,
        expenseDate: true,
        time: true,
        title: true,
        payee: true,
        description: true,
        category: true,
        amount: true,
        paymentSource: true,
        paymentAccountName: true,
        status: true,
        isReversalRecord: true,
        paidByName: true,
        createdByName: true,
        branchId: true,
      },
    }),
    // 4. Finalized & Paid Payroll Runs (Excluded for Accountants; Admin only)
    actor.role === 'ACCOUNTANT'
      ? Promise.resolve([])
      : prisma.payrollRun.findMany({
          where: {
            status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'PAID'] },
            ...branchFilter,
            OR: [
              { finalizedAt: utcRange },
              { generatedAt: utcRange },
            ],
          },
          include: {
            payslips: {
              include: {
                payments: true,
              },
            },
          },
        }),
    // 5. Commission Events (Excluded for Accountants; Admin only)
    actor.role === 'ACCOUNTANT'
      ? Promise.resolve([])
      : prisma.commissionEvent.findMany({
          where: {
            eventDate: dateRange,
            ...branchFilter,
          },
          select: {
            id: true,
            branchId: true,
            staffId: true,
            invoiceId: true,
            invoiceNumber: true,
            type: true,
            attributedNet: true,
            rate: true,
            amount: true,
            eventDate: true,
            consumedByRunId: true,
          },
        }),
    // 6. Inventory Write-offs / Shrinkage Losses (Excluded for Accountants; Admin only)
    actor.role === 'ACCOUNTANT'
      ? Promise.resolve([])
      : prisma.stockMovement.findMany({
          where: {
            createdAt: utcRange,
            movementType: { in: ['EXPIRED_OUT', 'DAMAGED_OUT', 'NEGATIVE_ADJUSTMENT'] },
            ...branchFilter,
          },
          include: {
            item: { select: { name: true, sku: true } },
          },
        }),
    // 7. Retail COGS
    prisma.invoiceLine?.aggregate
      ? prisma.invoiceLine.aggregate({
          where: {
            invoice: {
              date: dateRange,
              lifecycle: { not: 'VOIDED' },
              ...branchFilter,
              ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}),
            },
            type: 'PRODUCT',
          },
          _sum: { cogsAmount: true },
        })
      : Promise.resolve({ _sum: { cogsAmount: 0 } }),
    // 8. Salon usage consumable internal consumption
    actor.role === 'ACCOUNTANT' || !prisma.stockMovement?.aggregate
      ? Promise.resolve({ _sum: { totalCost: 0 } })
      : prisma.stockMovement.aggregate({
          where: {
            createdAt: utcRange,
            movementType: { in: ['SALON_CONSUMPTION_OUT', 'INTERNAL_USE_OUT'] },
            ...branchFilter,
          },
          _sum: { totalCost: true },
        }),
    // 9. Stock returns reversing retail COGS
    actor.role === 'ACCOUNTANT' || !prisma.stockMovement?.aggregate
      ? Promise.resolve({ _sum: { totalCost: 0 } })
      : prisma.stockMovement.aggregate({
          where: {
            createdAt: utcRange,
            movementType: { in: ['POS_RETURN_IN', 'SALES_RETURN_IN'] },
            ...branchFilter,
          },
          _sum: { totalCost: true },
        }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const staffMap = new Map(staffMembers.map((s) => [s.id, `${s.name} (${s.employeeCode})`]));
  const userRoleMap = new Map();
  users.forEach((u) => { if (u.name) userRoleMap.set(u.name.toLowerCase(), u.role); });
  staffMembers.forEach((s) => { if (s.name) userRoleMap.set(s.name.toLowerCase(), 'STAFF'); });

  // Build unified item rows
  const rawRows = [];

  // Invoices -> Collection-Based Operational Income (Excl. Tax) & Accrual Recognized Sales
  for (const inv of invoices) {
    const net = toDec(inv.netSales);
    const due = toDec(inv.amountDue || 0);
    const posPayments = (inv.payments || []).filter((p) => p.kind === 'POS');
    const posBillCollected = round2(posPayments.reduce((sum, p) => sum.plus(toDec(p.billAmountAllocated)), toDec(inv.advanceAdjusted || 0)));
    const allocation = allocatePaymentToInvoice({ invoice: inv, paymentAmount: posBillCollected, previousBillPaid: 0 });
    const collectedNet = allocation.totalCollectedNet;
    const collectedTax = allocation.totalCollectedTax;

    rawRows.push({
      id: `inv-${inv.id}`,
      date: ymd(inv.date),
      type: 'INCOME',
      category: 'Sales & Services',
      source: 'POS Invoice',
      reference: inv.invoiceNumber,
      branchId: inv.branchId,
      branchName: branchMap.get(inv.branchId) || 'Branch',
      userOrPayee: inv.processedByName || 'Staff',
      description: `Invoice ${inv.invoiceNumber} - ${inv.clientName || 'Walk-in'} (Gross: ${n(toDec(inv.subtotal))}, Disc: ${n(toDec(inv.discount))})`,
      income: n(collectedNet),
      recognizedIncome: n(net),
      expense: 0,
      paid: n(posBillCollected),
      collectionAmount: n(posBillCollected),
      collectedTax: n(collectedTax),
      discount: n(toDec(inv.discount || 0)),
      remaining: n(due),
      paymentMethod: inv.paymentMethod || 'CASH',
      status: inv.status,
    });
  }

  // Dues Collections -> Incremental Collection-Based Income (Excl. Tax)
  for (const dp of (duesPayments || [])) {
    if (!dp.invoice) continue;
    const earlierPayments = (dp.invoice.payments || []).filter((p) => p.createdAt < dp.createdAt && p.id !== dp.id);
    const prevPaid = earlierPayments.reduce((s, p) => s.plus(toDec(p.billAmountAllocated)), toDec(dp.invoice.advanceAdjusted || 0));
    const allocation = allocatePaymentToInvoice({ invoice: dp.invoice, paymentAmount: toDec(dp.billAmountAllocated), previousBillPaid: prevPaid });
    const collectedNet = allocation.totalCollectedNet;
    const collectedTax = allocation.totalCollectedTax;
    const billAmt = toDec(dp.billAmountAllocated);

    rawRows.push({
      id: `due-${dp.id}`,
      date: ymd(dp.date),
      type: 'INCOME',
      category: 'Sales & Services',
      source: 'POS Dues Collection',
      reference: dp.invoice.invoiceNumber,
      branchId: dp.branchId,
      branchName: branchMap.get(dp.branchId) || 'Branch',
      userOrPayee: dp.processedByName || 'Staff',
      description: `Dues Collection for Invoice ${dp.invoice.invoiceNumber} - ${dp.invoice.clientName || 'Customer'} (Net: ${n(collectedNet)}, Tax: ${n(collectedTax)})`,
      income: n(collectedNet),
      recognizedIncome: 0,
      expense: 0,
      paid: n(billAmt),
      collectionAmount: n(billAmt),
      collectedTax: n(collectedTax),
      discount: 0,
      remaining: n(toDec(dp.remainingBalance || 0)),
      paymentMethod: dp.method || 'CASH',
      status: toDec(dp.remainingBalance || 0).isZero() ? 'PAID' : 'PARTIAL',
    });
  }

  // Refunds -> Recognized Income Reversal (Negative Income) & Actual Outflow Deduction
  for (const ref of refunds) {
    const reversedNet = toDec(ref.netReversed);
    const actualCashOut = toDec(ref.cashOut || 0);
    const bId = ref.invoice?.branchId || '';
    rawRows.push({
      id: `ref-${ref.id}`,
      date: ymd(ref.refundDate),
      type: 'INCOME',
      category: 'Sales Refund / Reversal',
      source: 'Sales Refund',
      reference: ref.refundNumber,
      branchId: bId,
      branchName: branchMap.get(bId) || 'Branch',
      userOrPayee: ref.byName || 'Admin',
      description: `Refund for ${ref.invoice?.invoiceNumber || 'Invoice'} (${ref.reason || 'Client Refund'})`,
      income: -n(reversedNet),
      expense: 0,
      paid: -n(actualCashOut),
      collectionAmount: -n(actualCashOut),
      discount: 0,
      remaining: 0,
      paymentMethod: ref.method || 'CASH',
      status: 'REFUNDED',
    });
  }

  // Expenses -> Operating Expenses
  for (const exp of expenses) {
    const amt = toDec(exp.amount);
    const signedAmt = exp.isReversalRecord ? -amt : amt;
    const isPaid = exp.status !== 'PENDING' && exp.status !== 'ACCRUED';
    const amountVal = n(signedAmt);
    rawRows.push({
      id: `exp-${exp.id}`,
      date: ymd(exp.expenseDate),
      type: 'OPERATING_EXPENSE',
      category: exp.category || 'General Operational',
      source: `Expense - ${exp.category || 'General'}`,
      reference: exp.voucherNumber,
      branchId: exp.branchId,
      branchName: branchMap.get(exp.branchId) || 'Branch',
      userOrPayee: exp.payee ? (exp.paidByName ? `${exp.payee} (Paid by ${exp.paidByName})` : exp.payee) : (exp.paidByName || 'Staff'),
      description: `${exp.title}${exp.description ? ` — ${exp.description}` : ''}`,
      income: 0,
      expense: amountVal,
      paid: isPaid ? amountVal : 0,
      discount: 0,
      remaining: isPaid ? 0 : amountVal,
      paymentMethod: exp.paymentSource === 'CASH_DRAWER' ? 'CASH' : (exp.paymentAccountName || 'ONLINE'),
      status: exp.status,
    });
  }

  // Finalized / Paid Payroll -> Salary Expense (Included ONLY when salary has actually been paid/disbursed)
  for (const run of payrollRuns) {
    if (run.status === 'CANCELLED') continue;
    for (const p of run.payslips) {
      const snap = typeof p.snapshot === 'string' ? JSON.parse(p.snapshot) : p.snapshot || {};
      const staffLabel = snap.staffName || staffMap.get(p.staffId) || 'Staff';
      const salAmt = round2(toDec(p.netPayable ?? p.grossPayable ?? 0));
      const amountVal = n(salAmt);

      const activePayments = (p.payments || []).filter((pay) => pay.status !== 'REVERSED');
      const paidDec = activePayments.reduce((acc, pay) => acc.plus(toDec(pay.amount)), toDec(0));
      const hasMockPaid = p.paidAmount !== undefined ? toDec(p.paidAmount).gt(0) : false;
      const isFullyPaid = run.status === 'PAID' || (activePayments.length > 0 && paidDec.gte(salAmt));
      const paidVal = isFullyPaid ? amountVal : (activePayments.length > 0 ? n(round2(paidDec)) : (hasMockPaid ? n(toDec(p.paidAmount)) : 0));
      const remainingVal = Math.max(0, round2(toDec(amountVal).minus(paidVal)).toNumber());
      const statusLabel = isFullyPaid ? 'PAID' : (paidVal > 0 ? 'PARTIALLY_PAID' : 'FINALIZED');

      // Unpaid salary should NOT appear in Income & Expense unless explicitly requested via query
      if (paidVal <= 0 && query.includeUnpaid !== 'true' && query.includeCommission !== 'true') {
        continue;
      }

      const effectiveExpense = paidVal > 0 ? paidVal : amountVal;
      const effectivePaid = paidVal > 0 ? paidVal : 0;

      rawRows.push({
        id: `psl-${p.id}`,
        date: ymd(activePayments[0]?.paidAt || run.finalizedAt || run.generatedAt),
        type: 'SALARY_EXPENSE',
        category: 'Payroll & Salaries',
        source: 'Expense - Staff Salary',
        reference: p.payslipNumber !== 'DRAFT' ? p.payslipNumber : run.payrollNumber,
        branchId: run.branchId,
        branchName: branchMap.get(run.branchId) || 'Branch',
        userOrPayee: staffLabel,
        description: `Staff Salary for ${staffLabel} (${run.month})`,
        income: 0,
        expense: effectiveExpense,
        paid: effectivePaid,
        discount: 0,
        remaining: paidVal > 0 ? 0 : remainingVal,
        paymentMethod: activePayments[0]?.method || 'PAYROLL_TRANSFER',
        status: statusLabel,
      });
    }
  }

  // Fetch commission runs to check whether consumed commissions have an actual completed payout
  let paidCommissionRunIds = new Set();
  try {
    if (prisma.commissionRun?.findMany) {
      const cRuns = await prisma.commissionRun.findMany({
        where: {
          ...branchFilter,
          OR: [
            { status: 'PAID' },
            { payments: { some: { status: 'COMPLETED', reversedAt: null } } },
            { statements: { some: { payrollPayslip: { is: { payments: { some: { status: { not: 'REVERSED' } } } } } } } },
          ],
        },
        select: { id: true },
      });
      paidCommissionRunIds = new Set(cRuns.map((r) => r.id));
    }
  } catch {
    // Graceful fallback for mock tests that don't mock commissionRun
  }

  // Commission Events -> Staff Commission (Shows ONLY actual paid commission payouts unless includeCommission is requested)
  for (const evt of commissionEvents) {
    const commAmt = toDec(evt.amount);
    const signedAmt = evt.type === 'EARN' ? commAmt : -commAmt;
    const staffLabel = staffMap.get(evt.staffId) || 'Staff';
    const isPaid = evt.consumedByRunId ? paidCommissionRunIds.has(evt.consumedByRunId) : false;
    const amountVal = n(signedAmt);

    // If commission is NOT paid yet (just accrued/earned on an invoice), DO NOT display as an expense unless requested
    if (!isPaid && query.includeCommission !== 'true') {
      continue;
    }

    rawRows.push({
      id: `com-${evt.id}`,
      date: ymd(evt.eventDate),
      type: 'COMMISSION_EXPENSE',
      category: 'Staff Commission',
      source: 'Expense - Staff Commission',
      reference: evt.invoiceNumber || `COM-${evt.id.slice(0, 8)}`,
      branchId: evt.branchId,
      branchName: branchMap.get(evt.branchId) || 'Branch',
      userOrPayee: staffLabel,
      description: `Commission ${evt.type === 'EARN' ? 'Earned' : 'Reversal'} on Invoice ${evt.invoiceNumber || 'N/A'}${evt.rate ? ` (${n(toDec(evt.rate))}% on ${n(toDec(evt.attributedNet || 0))})` : ''} - ${isPaid ? 'Paid to' : 'Payable to'} ${staffLabel}`,
      income: 0,
      expense: amountVal,
      paid: isPaid ? amountVal : 0,
      discount: 0,
      remaining: isPaid ? 0 : amountVal,
      paymentMethod: isPaid ? 'PAYROLL_TRANSFER' : 'COMMISSION_ACCRUAL',
      status: isPaid ? 'PAID' : 'ACCRUED',
    });
  }

  // Standalone Commission Payments (Direct payouts made outside payroll)
  try {
    if (prisma.commissionPayment?.findMany) {
      const standaloneCommPayments = await prisma.commissionPayment.findMany({
        where: {
          status: 'COMPLETED',
          reversedAt: null,
          payrollPaymentId: null,
          paidAt: utcRange,
          ...branchFilter,
        },
      });
      for (const cp of standaloneCommPayments) {
        const amt = n(toDec(cp.amount));
        rawRows.push({
          id: `compay-${cp.id}`,
          date: ymd(cp.paidAt),
          type: 'COMMISSION_EXPENSE',
          category: 'Staff Commission',
          source: 'Expense - Staff Commission',
          reference: cp.paymentNumber,
          branchId: cp.branchId,
          branchName: branchMap.get(cp.branchId) || 'Branch',
          userOrPayee: cp.staffName,
          description: `Commission Payout to ${cp.staffName}`,
          income: 0,
          expense: amt,
          paid: amt,
          discount: 0,
          remaining: 0,
          paymentMethod: cp.method || 'CASH',
          status: 'PAID',
        });
      }
    }
  } catch {}

  if (query.includeInventoryLoss === 'true') {
    for (const m of inventoryLosses) {
      const lossVal = n(toDec(m.totalCost));
      rawRows.push({
        id: `loss-${m.id}`,
        date: ymd(m.createdAt),
        type: 'INVENTORY_WRITEOFF',
        category: 'Inventory Write-off & Loss',
        source: 'Expense - Inventory Loss',
        reference: m.movementNumber,
        branchId: m.branchId,
        branchName: branchMap.get(m.branchId) || 'Branch',
        userOrPayee: m.userName || 'Custodian',
        description: `Stock Loss: ${m.item?.name || 'Item'} (${m.reason || m.movementType})`,
        income: 0,
        expense: lossVal,
        paid: 0,
        discount: 0,
        remaining: 0,
        paymentMethod: 'NON_CASH',
        status: 'WRITTEN_OFF',
      });
    }
  }

  // Sort chronologically descending
  rawRows.sort((a, b) => {
    const dDiff = (b.date || '').localeCompare(a.date || '');
    if (dDiff !== 0) return dDiff;
    return (b.reference || '').localeCompare(a.reference || '');
  });

  // Apply filters
  // Settlement events affect custody and liabilities, never recognized income or expense.
  const movementWhere = { ...branchFilter, createdAt: utcRange, sourceModule: { in: ['POS', 'INVENTORY', 'BOOKING'] }, type: { in: ['SUPPLIER_PAYMENT', 'REVERSAL', 'BOOKING_ADVANCE', 'BOOKING_REFUND'] }, ...(actor.role === 'ACCOUNTANT' ? { userId: actor.id } : {}) };
  const [cashSettlements, onlineSettlements] = await Promise.all([
    prisma.drawerMovement.findMany({ where: movementWhere }),
    prisma.accountMovement.findMany({ where: movementWhere }),
  ]);
  for (const [method, movements] of [['CASH', cashSettlements], ['ONLINE_ACCOUNT', onlineSettlements]]) {
    for (const movement of movements) rawRows.push({
      id: movement.id, date: toDateString(movement.createdAt), type: 'SETTLEMENT', category: movement.sourceModule === 'BOOKING' ? (movement.type === 'BOOKING_REFUND' ? 'Booking Advance Refunds' : 'Booking Advances / Deposits') : movement.sourceModule === 'POS' ? 'Client Collections' : 'Supplier Payments',
      source: movement.sourceModule, reference: movement.reference, branchId: movement.branchId, branchName: branchMap.get(movement.branchId),
      userOrPayee: movement.userName, description: movement.description, income: 0, expense: 0, paid: 0, discount: 0, remaining: 0,
      cashFlow: n(toDec(movement.amount).times(movement.direction === 'IN' ? 1 : -1)), paymentMethod: method, paymentEventType: movement.type, status: 'POSTED',
    });
  }
  const cancellationEvents = await prisma.bookingHistory.findMany({ where: { type: 'BOOKING_CANCELLED',
    booking: branchFilter, ...(actor.role === 'ACCOUNTANT' ? { userId: actor.id } : {}) }, include: { booking: true } });
  for (const event of cancellationEvents) {
    const eventDate = event.after?.date || toDateString(event.createdAt);
    if (eventDate < ctx.fromStr || eventDate > ctx.toStr) continue;
    const fee = n(toDec(event.after?.totalAmount || 0));
    if (fee > 0) rawRows.push({ id: event.id, date: eventDate, type: 'INCOME', category: 'Booking Cancellation Fees', source: 'BOOKING', reference: event.booking.bookingNumber,
      branchId: event.booking.branchId, branchName: branchMap.get(event.booking.branchId), userOrPayee: event.userName, description: event.reason, income: fee, expense: 0, paid: fee,
      collectionAmount: 0, discount: 0, remaining: 0, status: 'PAID', paymentMethod: 'ADVANCE_ADJUSTMENT' });
  }
  const typeFilter = query.type && query.type !== 'ALL' ? query.type : null;
  const categoryFilter = query.category && query.category !== 'ALL' ? query.category : null;
  const statusFilter = query.status && query.status !== 'ALL' ? query.status : null;
  const paymentMethodFilter = query.paymentMethod && query.paymentMethod !== 'ALL' ? query.paymentMethod : null;
  const searchFilter = query.search?.trim().toLowerCase();
  const userFilter = (query.user && query.user !== 'ALL' ? query.user : (query.userId && query.userId !== 'ALL' ? query.userId : null))?.trim().toLowerCase();
  const userTypeFilter = query.userType && query.userType !== 'ALL' ? query.userType.toUpperCase() : null;

  const filteredRows = rawRows.filter((r) => {
    // 1. Strict branch filter if a specific branch is selected
    if (ctx.branchId && r.branchId && r.branchId !== ctx.branchId) return false;

    // 2. Type, category, status, paymentMethod filters
    if (typeFilter && r.type !== typeFilter) return false;
    if (categoryFilter && r.category !== categoryFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (paymentMethodFilter && r.paymentMethod !== paymentMethodFilter) return false;

    // 3. User Filter
    if (userFilter && (!r.userOrPayee || !r.userOrPayee.toLowerCase().includes(userFilter))) return false;

    // 4. User Type Filter
    if (userTypeFilter) {
      const uStr = (r.userOrPayee || '').toLowerCase();
      let matched = false;
      for (const [name, role] of userRoleMap.entries()) {
        if (uStr.includes(name) && role === userTypeFilter) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (userTypeFilter === 'STAFF' && (r.source?.toLowerCase().includes('staff') || r.source?.toLowerCase().includes('payroll') || r.source?.toLowerCase().includes('commission'))) matched = true;
        if (userTypeFilter === 'ADMIN' && (uStr.includes('admin') || r.source?.toLowerCase().includes('pos invoice'))) matched = true;
      }
      if (!matched) return false;
    }

    // 5. Search Filter
    if (searchFilter) {
      const match =
        (r.reference && r.reference.toLowerCase().includes(searchFilter)) ||
        (r.description && r.description.toLowerCase().includes(searchFilter)) ||
        (r.userOrPayee && r.userOrPayee.toLowerCase().includes(searchFilter)) ||
        (r.category && r.category.toLowerCase().includes(searchFilter)) ||
        (r.branchName && r.branchName.toLowerCase().includes(searchFilter));
      if (!match) return false;
    }
    return true;
  });

  // Calculate KPIs and Totals across filtered rows
  let totalIncome = toDec(0);
  let totalRecognizedIncome = toDec(0);
  let totalCollectedTax = toDec(0);
  let totalDirectExpenses = toDec(0);
  let totalSalaryExpenses = toDec(0);
  let totalCommissionExpenses = toDec(0);
  let totalInventoryLoss = toDec(0);
  let totalDiscount = toDec(0);
  let totalRemaining = toDec(0);
  let totalPaidIncome = toDec(0);
  let totalPaidExpense = toDec(0);

  const categoryMap = new Map();

  for (const r of filteredRows) {
    const isIncome = r.type === 'INCOME' || (r.income > 0);
    if (r.income) {
      totalIncome = totalIncome.plus(r.income);
    }
    if (r.recognizedIncome !== undefined) {
      totalRecognizedIncome = totalRecognizedIncome.plus(r.recognizedIncome);
    } else if (r.income && isIncome) {
      totalRecognizedIncome = totalRecognizedIncome.plus(r.income);
    }
    if (r.collectedTax) {
      totalCollectedTax = totalCollectedTax.plus(r.collectedTax);
    }
    if (r.discount) {
      totalDiscount = totalDiscount.plus(r.discount);
    }
    if (r.remaining) {
      totalRemaining = totalRemaining.plus(r.remaining);
    }
    if (r.paid) {
      if (isIncome) {
        totalPaidIncome = totalPaidIncome.plus(r.collectionAmount ?? r.paid);
      } else {
        totalPaidExpense = totalPaidExpense.plus(r.paid);
      }
    }
    if (r.expense) {
      if (r.type === 'OPERATING_EXPENSE') totalDirectExpenses = totalDirectExpenses.plus(r.expense);
      else if (r.type === 'SALARY_EXPENSE') totalSalaryExpenses = totalSalaryExpenses.plus(r.expense);
      else if (r.type === 'COMMISSION_EXPENSE') totalCommissionExpenses = totalCommissionExpenses.plus(r.expense);
      else if (r.type === 'INVENTORY_WRITEOFF') totalInventoryLoss = totalInventoryLoss.plus(r.expense);
    }

    const cat = r.category || 'Other';
    const netImpact = toDec(r.income).minus(r.expense);
    const existing = categoryMap.get(cat) || toDec(0);
    categoryMap.set(cat, existing.plus(netImpact));
  }

  const totalOperatingExpenses = totalDirectExpenses
    .plus(totalSalaryExpenses)
    .plus(totalCommissionExpenses)
    .plus(totalInventoryLoss);

  const returnedCogs = toDec(returnedCogsAgg?._sum?.totalCost || 0);
  const retailCogs = max0(toDec(retailCogsAgg?._sum?.cogsAmount || 0).minus(returnedCogs));
  const consumableUsage = toDec(consumableUsageAgg?._sum?.totalCost || 0);
  const totalCogs = round2(retailCogs.plus(consumableUsage));
  const grossContribution = round2(totalIncome.minus(totalCogs));
  const netOperatingPosition = round2(grossContribution.minus(totalOperatingExpenses));

  const settlementCashFlow = filteredRows.reduce((sum, row) => sum.plus(row.cashFlow || 0), toDec(0));
  const totalCollections = filteredRows.reduce((sum, row) => row.type === 'SETTLEMENT' && ['POS', 'BOOKING'].includes(row.source)
    ? sum.plus(row.cashFlow || 0) : sum, totalPaidIncome);
  const totalPaid = totalPaidIncome.minus(totalPaidExpense).plus(settlementCashFlow);
  const operatingMarginPercent = totalIncome.greaterThan(0)
    ? round2(netOperatingPosition.dividedBy(totalIncome).times(100)).toNumber()
    : 0;

  // Extract distinct categories for filter dropdown
  const allCategories = [...new Set(rawRows.map((r) => r.category).filter(Boolean))].sort();

  const totalRevenueReversals = refunds.reduce((s, r) => s.plus(toDec(r.netReversed)), toDec(0));
  const totalRefundsPaid = refunds.reduce((s, r) => s.plus(toDec(r.cashOut || 0)), toDec(0));

  const kpis = {
    totalCollectedIncome: n(totalIncome),
    totalRecognizedIncome: n(totalRecognizedIncome),
    totalCollectedTax: n(totalCollectedTax),
    totalCollections: n(totalCollections),
    cogs: n(totalCogs),
    retailCogs: n(retailCogs),
    returnedCogs: n(returnedCogs),
    consumableUsage: n(consumableUsage),
    grossContribution: n(grossContribution),
    directExpenses: n(totalDirectExpenses),
    salaryExpenses: n(totalSalaryExpenses),
    commissionExpenses: n(totalCommissionExpenses),
    inventoryLoss: n(totalInventoryLoss),
    totalOperatingExpenses: n(totalOperatingExpenses),
    netOperatingPosition: n(netOperatingPosition),
    operatingMarginPercent,
    totalTransactions: filteredRows.length,
    totalRevenueReversals: n(totalRevenueReversals),
    totalRefundsPaid: n(totalRefundsPaid),
  };

  const totals = {
    income: n(totalIncome),
    collectedIncome: n(totalIncome),
    recognizedIncome: n(totalRecognizedIncome),
    collectedTax: n(totalCollectedTax),
    cogs: n(totalCogs),
    grossContribution: n(grossContribution),
    expense: n(totalOperatingExpenses),
    paid: n(totalPaid),
    collections: n(totalCollections),
    discount: n(totalDiscount),
    remaining: n(totalRemaining),
    net: n(netOperatingPosition),
    revenueReversals: n(totalRevenueReversals),
    refundsPaid: n(totalRefundsPaid),
  };

  return formatReportResponse(ctx.meta, {
    kpis,
    rows: filteredRows,
    totals,
    categories: allCategories,
  });
};

// ═══ OPERATING PROFIT & P&L REPORT ════════════════════════════════════════════

const resolvePriorPeriodDates = (fromStr, toStr) => {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const fromD = new Date(fy, fm - 1, fd);
  const toD = new Date(ty, tm - 1, td);
  const daysDiff = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  const priorToD = new Date(fromD);
  priorToD.setDate(priorToD.getDate() - 1);
  const priorFromD = new Date(priorToD);
  priorFromD.setDate(priorFromD.getDate() - (daysDiff - 1));

  const pFromStr = `${priorFromD.getFullYear()}-${String(priorFromD.getMonth() + 1).padStart(2, '0')}-${String(priorFromD.getDate()).padStart(2, '0')}`;
  const pToStr = `${priorToD.getFullYear()}-${String(priorToD.getMonth() + 1).padStart(2, '0')}-${String(priorToD.getDate()).padStart(2, '0')}`;
  return {
    priorFromStr: pFromStr,
    priorToStr: pToStr,
    priorFromDate: startOfDay(pFromStr),
    priorToDate: endOfDay(pToStr),
  };
};

const computePeriodMetrics = async (branchId, fromStr, toStr, fromDate, toDate) => {
  const branchFilter = branchId ? { branchId } : {};
  const dateRange = { gte: dateOnly(fromStr), lte: dateOnly(toStr) };
  const utcRange = { gte: fromDate, lte: toDate };

  const [invoices, refunds, movements, expenses, payrollRuns, commissionEvents] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        date: dateRange,
        lifecycle: { not: 'VOIDED' },
        ...branchFilter,
      },
      select: {
        id: true,
        subtotal: true,
        discount: true,
        netSales: true,
        lines: {
          select: {
            type: true,
            unitPrice: true,
            quantity: true,
            discountAllocated: true,
            netSales: true,
          },
        },
      },
    }),
    prisma.invoiceRefund.findMany({
      where: {
        refundDate: dateRange,
        invoice: branchId ? { branchId } : undefined,
      },
      select: {
        netReversed: true,
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        createdAt: utcRange,
        ...branchFilter,
        movementType: {
          in: [
            'POS_SALE_OUT',
            'POS_RETURN_IN',
            'SALES_RETURN_IN',
            'SALON_CONSUMPTION_OUT',
            'INTERNAL_USE_OUT',
            'EXPIRED_OUT',
            'DAMAGED_OUT',
            'NEGATIVE_ADJUSTMENT',
          ],
        },
      },
      select: {
        movementType: true,
        totalCost: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        expenseDate: dateRange,
        status: 'POSTED',
        ...branchFilter,
      },
      select: {
        category: true,
        amount: true,
        isReversalRecord: true,
      },
    }),
    prisma.payrollRun.findMany({
      where: {
        status: 'FINALIZED',
        finalizedAt: utcRange,
        ...branchFilter,
      },
      include: {
        payslips: {
          select: {
            netPayable: true,
            grossPayable: true,
          },
        },
      },
    }),
    prisma.commissionEvent.findMany({
      where: {
        eventDate: dateRange,
        ...branchFilter,
      },
      select: {
        type: true,
        amount: true,
      },
    }),
  ]);

  // 1. Turnover by streams
  let serviceSales = toDec(0);
  let packageSales = toDec(0);
  let productSales = toDec(0);

  for (const inv of invoices) {
    for (const l of inv.lines) {
      const lineNet = toDec(l.netSales);
      if (l.type === 'SERVICE' || l.type === 'CUSTOM_SERVICE') serviceSales = serviceSales.plus(lineNet);
      else if (l.type === 'PACKAGE') packageSales = packageSales.plus(lineNet);
      else if (l.type === 'PRODUCT') productSales = productSales.plus(lineNet);
      else serviceSales = serviceSales.plus(lineNet);
    }
  }

  let totalRefunds = toDec(0);
  for (const r of refunds) {
    totalRefunds = totalRefunds.plus(r.netReversed);
  }

  const grossSales = serviceSales.plus(packageSales).plus(productSales);
  const totalNetSales = max0(grossSales.minus(totalRefunds));

  // 2. Direct Material Costs (COGS & Consumables)
  let productCogs = toDec(0);
  let materialConsumption = toDec(0);
  let inventoryLoss = toDec(0);

  for (const m of movements) {
    const cost = toDec(m.totalCost);
    if (m.movementType === 'POS_SALE_OUT') {
      productCogs = productCogs.plus(cost);
    } else if (m.movementType === 'POS_RETURN_IN' || m.movementType === 'SALES_RETURN_IN') {
      productCogs = productCogs.minus(cost);
    } else if (m.movementType === 'SALON_CONSUMPTION_OUT' || m.movementType === 'INTERNAL_USE_OUT') {
      materialConsumption = materialConsumption.plus(cost);
    } else if (
      m.movementType === 'EXPIRED_OUT' ||
      m.movementType === 'DAMAGED_OUT' ||
      m.movementType === 'NEGATIVE_ADJUSTMENT'
    ) {
      inventoryLoss = inventoryLoss.plus(cost);
    }
  }
  productCogs = max0(productCogs);
  materialConsumption = max0(materialConsumption);
  inventoryLoss = max0(inventoryLoss);

  const totalCostOfSales = productCogs.plus(materialConsumption);
  const grossContribution = totalNetSales.minus(totalCostOfSales);
  const grossMarginPercent = totalNetSales.greaterThan(0)
    ? round2(grossContribution.dividedBy(totalNetSales).times(100)).toNumber()
    : 0;

  // 3. Operating Overheads
  let directExpenses = toDec(0);
  const expensesByCategory = new Map();

  for (const e of expenses) {
    const amt = toDec(e.amount);
    const signed = e.isReversalRecord ? amt.negated() : amt;
    directExpenses = directExpenses.plus(signed);

    const cat = e.category || 'General Operational';
    const curr = expensesByCategory.get(cat) || toDec(0);
    expensesByCategory.set(cat, curr.plus(signed));
  }

  let salaryExpenses = toDec(0);
  for (const run of payrollRuns) {
    for (const p of run.payslips) {
      // Use the stored salary, never the combined payroll DTO or payout amounts.
      salaryExpenses = salaryExpenses.plus(p.netPayable ?? p.grossPayable ?? 0);
    }
  }

  let commissionExpenses = toDec(0);
  for (const c of commissionEvents) {
    const amt = toDec(c.amount);
    commissionExpenses = c.type === 'EARN' ? commissionExpenses.plus(amt) : commissionExpenses.minus(amt);
  }
  commissionExpenses = max0(commissionExpenses);

  const totalOperatingExpenses = directExpenses
    .plus(salaryExpenses)
    .plus(commissionExpenses)
    .plus(inventoryLoss);

  const netOperatingProfit = grossContribution.minus(totalOperatingExpenses);
  const operatingMarginPercent = totalNetSales.greaterThan(0)
    ? round2(netOperatingProfit.dividedBy(totalNetSales).times(100)).toNumber()
    : 0;

  return {
    serviceSales: n(serviceSales),
    packageSales: n(packageSales),
    productSales: n(productSales),
    totalRefunds: n(totalRefunds),
    totalNetSales: n(totalNetSales),
    productCogs: n(productCogs),
    materialConsumption: n(materialConsumption),
    totalCostOfSales: n(totalCostOfSales),
    grossContribution: n(grossContribution),
    grossMarginPercent,
    directExpenses: n(directExpenses),
    salaryExpenses: n(salaryExpenses),
    commissionExpenses: n(commissionExpenses),
    inventoryLoss: n(inventoryLoss),
    totalOperatingExpenses: n(totalOperatingExpenses),
    netOperatingProfit: n(netOperatingProfit),
    operatingMarginPercent,
    expensesByCategory: Object.fromEntries(
      [...expensesByCategory.entries()].map(([k, v]) => [k, n(v)])
    ),
  };
};

export const operatingProfitReport = async (actor, query = {}) => {
  denyNonAdmins(actor, 'operating profit reports');
  const ctx = await resolveReportContext(actor, query, 'RECOGNITION');
  const prior = resolvePriorPeriodDates(ctx.fromStr, ctx.toStr);

  const [currentMetrics, priorMetrics] = await Promise.all([
    computePeriodMetrics(ctx.branchId, ctx.fromStr, ctx.toStr, ctx.fromDate, ctx.toDate),
    computePeriodMetrics(ctx.branchId, prior.priorFromStr, prior.priorToStr, prior.priorFromDate, prior.priorToDate),
  ]);

  const rev = currentMetrics.totalNetSales;
  const calcPct = (amt) => (rev > 0 ? round2(toDec(amt).dividedBy(rev).times(100)).toNumber() : 0);
  const calcGrowth = (cur, pri) => {
    if (!pri || pri === 0) return null;
    return round2(toDec(cur - pri).dividedBy(Math.abs(pri)).times(100)).toNumber();
  };

  // Structured Financial Statement Rows
  const statementRows = [
    // ── SECTION 1: REVENUE ──
    { id: 'sec-rev', name: '1. OPERATING REVENUE / TURNOVER', section: 'REVENUE', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'rev-services', name: 'Service Sales (Hair, Beauty, Spa)', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.serviceSales, percentOfRevenue: calcPct(currentMetrics.serviceSales), priorAmount: priorMetrics.serviceSales, growthPercent: calcGrowth(currentMetrics.serviceSales, priorMetrics.serviceSales) },
    { id: 'rev-packages', name: 'Package Sales (Bundled Services)', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.packageSales, percentOfRevenue: calcPct(currentMetrics.packageSales), priorAmount: priorMetrics.packageSales, growthPercent: calcGrowth(currentMetrics.packageSales, priorMetrics.packageSales) },
    { id: 'rev-products', name: 'Retail Product Sales', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.productSales, percentOfRevenue: calcPct(currentMetrics.productSales), priorAmount: priorMetrics.productSales, growthPercent: calcGrowth(currentMetrics.productSales, priorMetrics.productSales) },
    { id: 'rev-refunds', name: 'Less: Sales Refunds & Reversals', section: 'REVENUE', isSubItem: true, isDeduction: true, currentAmount: -currentMetrics.totalRefunds, percentOfRevenue: calcPct(-currentMetrics.totalRefunds), priorAmount: -priorMetrics.totalRefunds, growthPercent: calcGrowth(currentMetrics.totalRefunds, priorMetrics.totalRefunds) },
    { id: 'tot-rev', name: 'TOTAL NET REVENUE', section: 'REVENUE', isTotal: true, currentAmount: currentMetrics.totalNetSales, percentOfRevenue: 100, priorAmount: priorMetrics.totalNetSales, growthPercent: calcGrowth(currentMetrics.totalNetSales, priorMetrics.totalNetSales) },

    // ── SECTION 2: COST OF SALES ──
    { id: 'sec-cos', name: '2. COST OF SALES (DIRECT MATERIAL COSTS)', section: 'COGS', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'cos-cogs', name: 'Retail Products COGS (FIFO/FEFO Landed)', section: 'COGS', isSubItem: true, currentAmount: currentMetrics.productCogs, percentOfRevenue: calcPct(currentMetrics.productCogs), priorAmount: priorMetrics.productCogs, growthPercent: calcGrowth(currentMetrics.productCogs, priorMetrics.productCogs) },
    { id: 'cos-cons', name: 'Salon Consumable Material Consumption', section: 'COGS', isSubItem: true, currentAmount: currentMetrics.materialConsumption, percentOfRevenue: calcPct(currentMetrics.materialConsumption), priorAmount: priorMetrics.materialConsumption, growthPercent: calcGrowth(currentMetrics.materialConsumption, priorMetrics.materialConsumption) },
    { id: 'tot-cos', name: 'TOTAL COST OF SALES', section: 'COGS', isTotal: true, currentAmount: currentMetrics.totalCostOfSales, percentOfRevenue: calcPct(currentMetrics.totalCostOfSales), priorAmount: priorMetrics.totalCostOfSales, growthPercent: calcGrowth(currentMetrics.totalCostOfSales, priorMetrics.totalCostOfSales) },

    // ── SECTION 3: GROSS CONTRIBUTION ──
    { id: 'sec-gc', name: '3. GROSS CONTRIBUTION (GROSS MARGIN)', section: 'GROSS_PROFIT', isMajorTotal: true, currentAmount: currentMetrics.grossContribution, percentOfRevenue: currentMetrics.grossMarginPercent, priorAmount: priorMetrics.grossContribution, growthPercent: calcGrowth(currentMetrics.grossContribution, priorMetrics.grossContribution) },

    // ── SECTION 4: OPERATING EXPENSES ──
    { id: 'sec-opex', name: '4. OPERATING OVERHEADS & EXPENSES', section: 'EXPENSE', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'exp-salaries', name: 'Salaries & Wages (Finalized Payroll)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.salaryExpenses, percentOfRevenue: calcPct(currentMetrics.salaryExpenses), priorAmount: priorMetrics.salaryExpenses, growthPercent: calcGrowth(currentMetrics.salaryExpenses, priorMetrics.salaryExpenses) },
    { id: 'exp-comm', name: 'Staff Commissions (Earned Attribution)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.commissionExpenses, percentOfRevenue: calcPct(currentMetrics.commissionExpenses), priorAmount: priorMetrics.commissionExpenses, growthPercent: calcGrowth(currentMetrics.commissionExpenses, priorMetrics.commissionExpenses) },
    { id: 'exp-direct', name: 'Direct Operating Expenses (Rent, Utilities, etc.)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.directExpenses, percentOfRevenue: calcPct(currentMetrics.directExpenses), priorAmount: priorMetrics.directExpenses, growthPercent: calcGrowth(currentMetrics.directExpenses, priorMetrics.directExpenses) },
    { id: 'exp-loss', name: 'Inventory Shrinkage & Write-offs (Damage/Loss)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.inventoryLoss, percentOfRevenue: calcPct(currentMetrics.inventoryLoss), priorAmount: priorMetrics.inventoryLoss, growthPercent: calcGrowth(currentMetrics.inventoryLoss, priorMetrics.inventoryLoss) },
    { id: 'tot-opex', name: 'TOTAL OPERATING EXPENSES', section: 'EXPENSE', isTotal: true, currentAmount: currentMetrics.totalOperatingExpenses, percentOfRevenue: calcPct(currentMetrics.totalOperatingExpenses), priorAmount: priorMetrics.totalOperatingExpenses, growthPercent: calcGrowth(currentMetrics.totalOperatingExpenses, priorMetrics.totalOperatingExpenses) },

    // ── SECTION 5: NET OPERATING PROFIT ──
    { id: 'sec-net', name: '5. NET OPERATING PROFIT / (LOSS)', section: 'NET_PROFIT', isFinalNet: true, currentAmount: currentMetrics.netOperatingProfit, percentOfRevenue: currentMetrics.operatingMarginPercent, priorAmount: priorMetrics.netOperatingProfit, growthPercent: calcGrowth(currentMetrics.netOperatingProfit, priorMetrics.netOperatingProfit) },
  ];

  // Detailed Landscape Rows for table panning
  const detailedRows = [
    {
      id: 'd-1',
      accountName: 'Service Sales Turnover',
      classification: 'REVENUE',
      department: 'Salon Floor / Styling',
      currentAmount: currentMetrics.serviceSales,
      percentOfRevenue: calcPct(currentMetrics.serviceSales),
      priorAmount: priorMetrics.serviceSales,
      varianceAmount: currentMetrics.serviceSales - priorMetrics.serviceSales,
      growthPercent: calcGrowth(currentMetrics.serviceSales, priorMetrics.serviceSales),
      notes: 'Net service appointments & walk-in billings after discounts',
    },
    {
      id: 'd-2',
      accountName: 'Bundled Package Sales',
      classification: 'REVENUE',
      department: 'Salon Floor / Packages',
      currentAmount: currentMetrics.packageSales,
      percentOfRevenue: calcPct(currentMetrics.packageSales),
      priorAmount: priorMetrics.packageSales,
      varianceAmount: currentMetrics.packageSales - priorMetrics.packageSales,
      growthPercent: calcGrowth(currentMetrics.packageSales, priorMetrics.packageSales),
      notes: 'Bundled service packages sold at POS',
    },
    {
      id: 'd-3',
      accountName: 'Retail Product Sales',
      classification: 'REVENUE',
      department: 'Retail Counter',
      currentAmount: currentMetrics.productSales,
      percentOfRevenue: calcPct(currentMetrics.productSales),
      priorAmount: priorMetrics.productSales,
      varianceAmount: currentMetrics.productSales - priorMetrics.productSales,
      growthPercent: calcGrowth(currentMetrics.productSales, priorMetrics.productSales),
      notes: 'Over-the-counter retail hair, skin & cosmetic product sales',
    },
    {
      id: 'd-4',
      accountName: 'Sales Refunds & Customer Credits',
      classification: 'REVENUE_REVERSAL',
      department: 'Billing & Front Desk',
      currentAmount: -currentMetrics.totalRefunds,
      percentOfRevenue: calcPct(-currentMetrics.totalRefunds),
      priorAmount: -priorMetrics.totalRefunds,
      varianceAmount: -(currentMetrics.totalRefunds - priorMetrics.totalRefunds),
      growthPercent: calcGrowth(currentMetrics.totalRefunds, priorMetrics.totalRefunds),
      notes: 'Dated customer refunds and voided invoice reversals',
    },
    {
      id: 'd-5',
      accountName: 'Retail Cost of Goods Sold (COGS)',
      classification: 'COST_OF_SALES',
      department: 'Inventory Asset Layer',
      currentAmount: currentMetrics.productCogs,
      percentOfRevenue: calcPct(currentMetrics.productCogs),
      priorAmount: priorMetrics.productCogs,
      varianceAmount: currentMetrics.productCogs - priorMetrics.productCogs,
      growthPercent: calcGrowth(currentMetrics.productCogs, priorMetrics.productCogs),
      notes: 'Historical landed cost from stock layers consumed on POS product sales',
    },
    {
      id: 'd-6',
      accountName: 'Salon Consumable Material Consumption',
      classification: 'COST_OF_SALES',
      department: 'Backbar / Dispensary',
      currentAmount: currentMetrics.materialConsumption,
      percentOfRevenue: calcPct(currentMetrics.materialConsumption),
      priorAmount: priorMetrics.materialConsumption,
      varianceAmount: currentMetrics.materialConsumption - priorMetrics.materialConsumption,
      growthPercent: calcGrowth(currentMetrics.materialConsumption, priorMetrics.materialConsumption),
      notes: 'Internal stock consumption for salon treatments (colors, foils, developers)',
    },
    {
      id: 'd-7',
      accountName: 'Staff Basic Salaries & Allowances',
      classification: 'OPERATING_EXPENSE',
      department: 'Human Resources / Payroll',
      currentAmount: currentMetrics.salaryExpenses,
      percentOfRevenue: calcPct(currentMetrics.salaryExpenses),
      priorAmount: priorMetrics.salaryExpenses,
      varianceAmount: currentMetrics.salaryExpenses - priorMetrics.salaryExpenses,
      growthPercent: calcGrowth(currentMetrics.salaryExpenses, priorMetrics.salaryExpenses),
      notes: 'Finalized monthly staff payslips (Basic + OT + Allowances - Deductions)',
    },
    {
      id: 'd-8',
      accountName: 'Staff Performance Commissions',
      classification: 'OPERATING_EXPENSE',
      department: 'Human Resources / Commission',
      currentAmount: currentMetrics.commissionExpenses,
      percentOfRevenue: calcPct(currentMetrics.commissionExpenses),
      priorAmount: priorMetrics.commissionExpenses,
      varianceAmount: currentMetrics.commissionExpenses - priorMetrics.commissionExpenses,
      growthPercent: calcGrowth(currentMetrics.commissionExpenses, priorMetrics.commissionExpenses),
      notes: 'Staff-attributed net sales commissions earned across services/packages',
    },
    ...Object.entries(currentMetrics.expensesByCategory).map(([cat, amt], idx) => {
      const priorAmt = priorMetrics.expensesByCategory[cat] || 0;
      return {
        id: `d-exp-${idx}`,
        accountName: `Direct Expense: ${cat}`,
        classification: 'OPERATING_EXPENSE',
        department: 'Operations & Facilities',
        currentAmount: amt,
        percentOfRevenue: calcPct(amt),
        priorAmount: priorAmt,
        varianceAmount: amt - priorAmt,
        growthPercent: calcGrowth(amt, priorAmt),
        notes: `Operational disbursements and bank payment vouchers for ${cat}`,
      };
    }),
    {
      id: 'd-loss',
      accountName: 'Inventory Losses & Expiry Write-Offs',
      classification: 'OPERATING_EXPENSE',
      department: 'Stock Custody',
      currentAmount: currentMetrics.inventoryLoss,
      percentOfRevenue: calcPct(currentMetrics.inventoryLoss),
      priorAmount: priorMetrics.inventoryLoss,
      varianceAmount: currentMetrics.inventoryLoss - priorMetrics.inventoryLoss,
      growthPercent: calcGrowth(currentMetrics.inventoryLoss, priorMetrics.inventoryLoss),
      notes: 'Stock damaged, expired or adjusted downward at historical landed cost',
    },
  ];

  const kpis = {
    totalNetRevenue: currentMetrics.totalNetSales,
    serviceSales: currentMetrics.serviceSales,
    packageSales: currentMetrics.packageSales,
    productSales: currentMetrics.productSales,
    totalCostOfSales: currentMetrics.totalCostOfSales,
    productCogs: currentMetrics.productCogs,
    materialConsumption: currentMetrics.materialConsumption,
    grossContribution: currentMetrics.grossContribution,
    grossMarginPercent: currentMetrics.grossMarginPercent,
    totalOperatingExpenses: currentMetrics.totalOperatingExpenses,
    directExpenses: currentMetrics.directExpenses,
    salaryExpenses: currentMetrics.salaryExpenses,
    commissionExpenses: currentMetrics.commissionExpenses,
    inventoryLoss: currentMetrics.inventoryLoss,
    netOperatingProfit: currentMetrics.netOperatingProfit,
    operatingMarginPercent: currentMetrics.operatingMarginPercent,
    // Prior period comparisons
    priorNetRevenue: priorMetrics.totalNetSales,
    priorGrossContribution: priorMetrics.grossContribution,
    priorOperatingProfit: priorMetrics.netOperatingProfit,
    revenueGrowthPercent: calcGrowth(currentMetrics.totalNetSales, priorMetrics.totalNetSales),
    profitGrowthPercent: calcGrowth(currentMetrics.netOperatingProfit, priorMetrics.netOperatingProfit),
  };

  const totals = {
    revenue: currentMetrics.totalNetSales,
    costOfSales: currentMetrics.totalCostOfSales,
    grossMargin: currentMetrics.grossContribution,
    operatingExpenses: currentMetrics.totalOperatingExpenses,
    netProfit: currentMetrics.netOperatingProfit,
  };

  const metaWithPrior = {
    ...ctx.meta,
    priorFrom: prior.priorFromStr,
    priorTo: prior.priorToStr,
  };

  return formatReportResponse(metaWithPrior, {
    kpis,
    statementRows,
    rows: detailedRows,
    totals,
  });
};

// ═══ PAYMENT ACCOUNTS LEDGER REPORT ══════════════════════════════════════════

export const paymentAccountsReport = async (actor, query = {}) => {
  denyNonAdmins(actor, 'payment account reports');
  const ctx = await resolveReportContext(actor, query, 'MOVEMENT_TIMESTAMP');
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  // 1. Fetch matching payment accounts
  const accountWhere = {
    ...(ctx.branchId ? { OR: [{ branchId: ctx.branchId }, { branches: { some: { id: ctx.branchId } } }] } : {}),
    ...(query.accountId && query.accountId !== 'ALL' ? { id: query.accountId } : {}),
  };

  const accounts = await prisma.paymentAccount.findMany({
    where: accountWhere,
    include: {
      branch: { select: { id: true, name: true, city: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  const accountIds = accounts.map((a) => a.id);

  if (!accountIds.length) {
    const kpis = {
      totalOpeningBalance: 0,
      totalMoneyIn: 0,
      totalMoneyOut: 0,
      totalTransfersIn: 0,
      totalTransfersOut: 0,
      totalClosingBalance: 0,
      netMovement: 0,
      transactionCount: 0,
      accountsCount: 0,
    };
    const totals = {
      opening: 0,
      moneyIn: 0,
      moneyOut: 0,
      transfer: 0,
      closing: 0,
    };
    return formatReportResponse(ctx.meta, {
      kpis,
      rows: [],
      totals,
      accountsSummary: [],
    });
  }

  // 2. Compute pre-period movements strictly before ctx.fromDate
  const preMovementsSums = await prisma.accountMovement.groupBy({
    by: ['accountId', 'direction'],
    where: {
      ...branchFilter,
      accountId: { in: accountIds },
      createdAt: { lt: ctx.fromDate },
    },
    _sum: { amount: true },
  });

  // Calculate opening balance for each account as of ctx.fromDate
  const openingBalanceMap = new Map();
  for (const a of accounts) {
    const inBefore = preMovementsSums.find((s) => s.accountId === a.id && s.direction === 'IN')?._sum.amount ?? 0;
    const outBefore = preMovementsSums.find((s) => s.accountId === a.id && s.direction === 'OUT')?._sum.amount ?? 0;
    const opening = toDec(!ctx.branchId || a.branchId === ctx.branchId ? a.openingBalance : 0).plus(toDec(inBefore)).minus(toDec(outBefore));
    openingBalanceMap.set(a.id, opening);
  }

  // 3. Fetch movements within range [ctx.fromDate, ctx.toDate]
  const movementWhere = {
    ...branchFilter,
    accountId: { in: accountIds },
    createdAt: { gte: ctx.fromDate, lte: ctx.toDate },
    ...(query.transactionType && query.transactionType !== 'ALL' ? { type: query.transactionType } : {}),
    ...(query.direction && query.direction !== 'ALL' ? { direction: query.direction } : {}),
    ...(query.sourceModule && query.sourceModule !== 'ALL' ? { sourceModule: query.sourceModule } : {}),
  };

  const movements = await prisma.accountMovement.findMany({
    where: movementWhere,
    include: {
      account: {
        select: {
          id: true,
          name: true,
          accountType: true,
          providerName: true,
          accountIdentifier: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  // 4. Calculate Running Balance per Account
  const runningMap = new Map();
  for (const a of accounts) {
    runningMap.set(a.id, openingBalanceMap.get(a.id));
  }

  const branchNames = new Map((await prisma.branch.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const rawRows = [];
  for (const m of movements) {
    const prevBal = runningMap.get(m.accountId) || toDec(0);
    const amt = toDec(m.amount);
    const isTransfer = m.type === 'TRANSFER_IN' || m.type === 'TRANSFER_OUT';
    const isMoneyIn = m.direction === 'IN' && !isTransfer;
    const isMoneyOut = m.direction === 'OUT' && !isTransfer;

    let newBal;
    if (m.direction === 'IN') {
      newBal = prevBal.plus(amt);
    } else {
      newBal = prevBal.minus(amt);
    }
    runningMap.set(m.accountId, newBal);

    const mDate = toDateString(m.createdAt);
    const mTime = toTimeString(m.createdAt);

    rawRows.push({
      id: m.id,
      date: mDate,
      time: mTime,
      createdAt: m.createdAt.toISOString(),
      accountId: m.accountId,
      accountName: m.account.name,
      accountType: m.account.accountType,
      providerName: m.account.providerName,
      branchId: m.branchId,
      branchName: branchNames.get(m.branchId) || 'Branch',
      type: m.type,
      direction: m.direction,
      reference: m.reference || 'REF-N/A',
      sourceModule: m.sourceModule,
      description: m.description || '',
      userName: m.userName || 'System',
      debit: m.direction === 'IN' ? n(amt) : 0,
      credit: m.direction === 'OUT' ? n(amt) : 0,
      moneyIn: isMoneyIn ? n(amt) : 0,
      moneyOut: isMoneyOut ? n(amt) : 0,
      transfer: m.type === 'TRANSFER_IN' ? n(amt) : m.type === 'TRANSFER_OUT' ? -n(amt) : 0,
      amount: n(amt),
      runningBalance: n(newBal),
    });
  }

  // Apply optional search filter
  const search = query.search?.trim().toLowerCase();
  const filteredRows = search
    ? rawRows.filter((r) =>
        (r.reference && r.reference.toLowerCase().includes(search)) ||
        (r.description && r.description.toLowerCase().includes(search)) ||
        (r.userName && r.userName.toLowerCase().includes(search)) ||
        (r.accountName && r.accountName.toLowerCase().includes(search)) ||
        (r.sourceModule && r.sourceModule.toLowerCase().includes(search)) ||
        (r.type && r.type.toLowerCase().includes(search))
      )
    : rawRows;

  // 5. Account Summaries (Portfolio Breakdown)
  const accountsSummary = accounts.map((a) => {
    const opening = openingBalanceMap.get(a.id) || toDec(0);
    const accRows = rawRows.filter((r) => r.accountId === a.id);

    let mIn = toDec(0);
    let mOut = toDec(0);
    let tIn = toDec(0);
    let tOut = toDec(0);

    for (const r of accRows) {
      if (r.direction === 'IN' && r.type !== 'TRANSFER_IN') mIn = mIn.plus(r.amount);
      else if (r.direction === 'OUT' && r.type !== 'TRANSFER_OUT') mOut = mOut.plus(r.amount);
      else if (r.type === 'TRANSFER_IN') tIn = tIn.plus(r.amount);
      else if (r.type === 'TRANSFER_OUT') tOut = tOut.plus(r.amount);
    }

    const netMove = mIn.plus(tIn).minus(mOut).minus(tOut);
    const closing = opening.plus(netMove);

    return {
      accountId: a.id,
      accountName: a.name,
      accountType: a.accountType,
      providerName: a.providerName,
      accountHolder: a.accountHolder,
      accountIdentifier: a.accountIdentifier,
      branchId: ctx.branchId ?? a.branchId,
      branchName: branchNames.get(ctx.branchId ?? a.branchId) || 'Branch',
      openingBalance: n(opening),
      moneyIn: n(mIn),
      moneyOut: n(mOut),
      transfersIn: n(tIn),
      transfersOut: n(tOut),
      netMovement: n(netMove),
      closingBalance: n(closing),
      transactionCount: accRows.length,
    };
  });

  // 6. KPIs & Totals
  let totalOpening = toDec(0);
  let totalMoneyIn = toDec(0);
  let totalMoneyOut = toDec(0);
  let totalTransfersIn = toDec(0);
  let totalTransfersOut = toDec(0);
  let totalClosing = toDec(0);

  for (const s of accountsSummary) {
    totalOpening = totalOpening.plus(s.openingBalance);
    totalMoneyIn = totalMoneyIn.plus(s.moneyIn);
    totalMoneyOut = totalMoneyOut.plus(s.moneyOut);
    totalTransfersIn = totalTransfersIn.plus(s.transfersIn);
    totalTransfersOut = totalTransfersOut.plus(s.transfersOut);
    totalClosing = totalClosing.plus(s.closingBalance);
  }

  const kpis = {
    totalOpeningBalance: n(totalOpening),
    totalMoneyIn: n(totalMoneyIn),
    totalMoneyOut: n(totalMoneyOut),
    totalTransfersIn: n(totalTransfersIn),
    totalTransfersOut: n(totalTransfersOut),
    totalClosingBalance: n(totalClosing),
    netMovement: n(totalClosing.minus(totalOpening)),
    transactionCount: filteredRows.length,
    accountsCount: accounts.length,
  };

  const totals = {
    opening: n(totalOpening),
    moneyIn: n(totalMoneyIn),
    moneyOut: n(totalMoneyOut),
    transferIn: n(totalTransfersIn),
    transferOut: n(totalTransfersOut),
    closing: n(totalClosing),
    netMovement: n(totalClosing.minus(totalOpening)),
  };

  return formatReportResponse(ctx.meta, {
    kpis,
    rows: filteredRows,
    totals,
    accountsSummary,
  });
};

// ═══ CASH DRAWER CUSTODY & SESSION REPORT ══════════════════════════════════

export const cashDrawerReport = async (actor, query = {}) => {
  const ctx = await resolveReportContext(actor, query, 'CUSTODY');
  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  // 1. Fetch cash drawers
  const drawerWhere = {
    ...branchFilter,
    OR: [{ date: dateRange }, { movements: { some: { createdAt: { gte: ctx.fromDate, lte: ctx.toDate } } } }],
    ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
    ...(actor.role === 'ACCOUNTANT'
      ? { custodianUserId: actor.id }
      : (query.custodianUserId && query.custodianUserId !== 'ALL' ? { custodianUserId: query.custodianUserId } : {})),
  };

  const drawers = await prisma.cashDrawer.findMany({
    where: drawerWhere,
    include: {
      movements: {
        orderBy: { createdAt: 'asc' },
      },
      settlements: {
        select: {
          id: true,
          status: true,
          handoverAmount: true,
          retainedFloat: true,
          notes: true,
          reviewedAt: true,
          receivedByName: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  // 2. Fetch invoice payments in this range for digital tender breakdown (Cash vs Online accounts)
  const paymentRecords = await prisma.invoicePayment.findMany({
    where: {
      ...branchFilter,
      OR: [{ date: dateRange }, { reversalDate: dateRange }],
      ...(actor.role === 'ACCOUNTANT'
        ? { processedByUserId: actor.id }
        : (query.custodianUserId && query.custodianUserId !== 'ALL' ? { processedByUserId: query.custodianUserId } : {})),
    },
    select: {
      id: true,
      amount: true,
      method: true,
      paymentAccountId: true,
      paymentAccountName: true,
      drawerId: true,
      processedByUserId: true,
      processedByName: true,
      date: true,
      reversalDate: true,
    },
  });

  const inPeriod = (date) => date && ymd(date) >= ctx.fromStr && ymd(date) <= ctx.toStr;
  const invoicePayments = paymentRecords.flatMap((payment) => [
    ...(inPeriod(payment.date) ? [payment] : []),
    ...(inPeriod(payment.reversalDate) ? [{ ...payment, amount: toDec(payment.amount).negated(), date: payment.reversalDate }] : []),
  ]);
  const transactions = drawers.flatMap((drawer) => drawer.movements.filter((movement) => movement.createdAt >= ctx.fromDate && movement.createdAt <= ctx.toDate).map((movement) => ({
    id: movement.id, drawerId: drawer.id, date: toDateString(movement.createdAt), time: toTimeString(movement.createdAt), reference: movement.reference,
    sourceId: movement.sourceId, type: movement.type, direction: movement.direction, amount: n(toDec(movement.amount)),
    debit: movement.direction === 'IN' ? n(toDec(movement.amount)) : 0,
    credit: movement.direction === 'OUT' ? n(toDec(movement.amount)) : 0,
    cashIn: movement.direction === 'IN' ? n(toDec(movement.amount)) : 0,
    cashOut: movement.direction === 'OUT' ? n(toDec(movement.amount)) : 0,
    actor: movement.userName, actorUserId: movement.userId, branchId: drawer.branchId,
    custodianUserId: drawer.custodianUserId, paymentMethod: 'CASH', description: movement.description,
  }))).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  // Fetch active payment accounts for this scope to list all accounts (even if 0)
  const paymentAccounts = await prisma.paymentAccount.findMany({
    where: { ...branchFilter, isActive: true },
    select: { id: true, name: true, accountType: true, providerName: true },
    orderBy: { name: 'asc' },
  });

  let overallCashReceipts = toDec(0);
  let overallOnlineReceipts = toDec(0);
  const onlineAccountMap = new Map();

  for (const acc of paymentAccounts) {
    onlineAccountMap.set(acc.name, {
      accountId: acc.id,
      accountName: acc.name,
      accountType: acc.accountType,
      providerName: acc.providerName,
      amount: toDec(0),
      count: 0,
    });
  }

  for (const ip of invoicePayments) {
    const amt = toDec(ip.amount);
    if (ip.method === 'CASH') {
      overallCashReceipts = overallCashReceipts.plus(amt);
    } else {
      overallOnlineReceipts = overallOnlineReceipts.plus(amt);
      const accName = ip.paymentAccountName || 'Online Account';
      const existing = onlineAccountMap.get(accName) || {
        accountId: ip.paymentAccountId || '',
        accountName: accName,
        accountType: 'ONLINE',
        providerName: '',
        amount: toDec(0),
        count: 0,
      };
      existing.amount = existing.amount.plus(amt);
      existing.count += 1;
      onlineAccountMap.set(accName, existing);
    }
  }

  const refundRecords = await prisma.invoiceRefund.findMany({
    where: {
      refundDate: dateRange,
      invoice: {
        ...branchFilter,
        ...(actor.role === 'ACCOUNTANT'
          ? { processedByUserId: actor.id }
          : (query.custodianUserId && query.custodianUserId !== 'ALL' ? { processedByUserId: query.custodianUserId } : {})),
      },
    },
    select: {
      id: true,
      refundNumber: true,
      cashOut: true,
      method: true,
      accountId: true,
      drawerId: true,
    },
  });

  for (const ref of refundRecords) {
    const out = toDec(ref.cashOut || 0);
    if (out.greaterThan(0)) {
      if (ref.method === 'CASH') {
        overallCashReceipts = overallCashReceipts.minus(out);
      } else {
        overallOnlineReceipts = overallOnlineReceipts.minus(out);
        if (ref.accountId) {
          for (const acc of onlineAccountMap.values()) {
            if (acc.accountId === ref.accountId) {
              acc.amount = acc.amount.minus(out);
            }
          }
        }
      }
    }
  }

  const onlineAccountsBreakdown = Array.from(onlineAccountMap.values()).map((a) => ({
    accountId: a.accountId,
    accountName: a.accountName,
    accountType: a.accountType,
    providerName: a.providerName,
    amount: n(max0(a.amount)),
    count: a.count,
  }));

  // Map online collections per drawer (by drawerId or by custodianUserId + date)
  const onlineByDrawer = new Map();
  for (const ip of invoicePayments) {
    if (ip.method === 'ONLINE_ACCOUNT') {
      const amt = toDec(ip.amount);
      const key = ip.drawerId || `${ip.processedByUserId}_${ymd(ip.date)}`;
      const current = onlineByDrawer.get(key) || { total: toDec(0), accounts: new Map() };
      current.total = current.total.plus(amt);
      const accName = ip.paymentAccountName || 'Online Account';
      current.accounts.set(accName, (current.accounts.get(accName) || toDec(0)).plus(amt));
      onlineByDrawer.set(key, current);
    }
  }

  // 3. Aggregate drawers
  let totalOpeningFloat = toDec(0);
  let totalCashSales = toDec(0);
  let totalDuesCollected = toDec(0);
  let totalCashTips = toDec(0);
  let totalCashIn = toDec(0);
  let totalCashRefunds = toDec(0);
  let totalCashExpenses = toDec(0);
  let totalSettlementsOut = toDec(0);
  let totalOtherCashOut = toDec(0);
  let totalCashOut = toDec(0);
  let totalExpectedCash = toDec(0);
  let totalCountedCash = toDec(0);
  let totalVariance = toDec(0);

  const rawRows = drawers.map((d) => {
    let openingFloat = toDec(0);
    let cashSales = toDec(0);
    let duesCollected = toDec(0);
    let cashTips = toDec(0);
    let otherCashIn = toDec(0);
    let cashIn = toDec(0);

    let cashRefunds = toDec(0);
    let cashExpenses = toDec(0);
    let settlementsOut = toDec(0);
    let otherCashOut = toDec(0);
    let cashOut = toDec(0);

    for (const m of d.movements) {
      const amt = toDec(m.amount);
      if (m.direction === 'IN') {
        cashIn = cashIn.plus(amt);
        if (m.type === 'OPENING_FLOAT') openingFloat = openingFloat.plus(amt);
        else if (m.type === 'CASH_SALE') cashSales = cashSales.plus(amt);
        else if (m.type === 'DUES_COLLECTION') duesCollected = duesCollected.plus(amt);
        else if (m.type === 'CASH_TIP') cashTips = cashTips.plus(amt);
        else otherCashIn = otherCashIn.plus(amt);
      } else {
        cashOut = cashOut.plus(amt);
        if (m.type === 'CASH_REFUND') cashRefunds = cashRefunds.plus(amt);
        else if (m.type === 'EXPENSE') cashExpenses = cashExpenses.plus(amt);
        else if (m.type === 'SETTLEMENT_OUT') settlementsOut = settlementsOut.plus(amt);
        else otherCashOut = otherCashOut.plus(amt);
      }
    }

    const expectedCash = cashIn.minus(cashOut);
    const countedCash =
      d.lastCountedCash !== null && d.lastCountedCash !== undefined
        ? toDec(d.lastCountedCash)
        : null;
    const variance =
      countedCash !== null && d.lastVariance !== null && d.lastVariance !== undefined
        ? toDec(d.lastVariance)
        : (countedCash !== null ? countedCash.minus(expectedCash) : null);

    totalOpeningFloat = totalOpeningFloat.plus(openingFloat);
    totalCashSales = totalCashSales.plus(cashSales);
    totalDuesCollected = totalDuesCollected.plus(duesCollected);
    totalCashTips = totalCashTips.plus(cashTips);
    totalCashIn = totalCashIn.plus(cashIn);
    totalCashRefunds = totalCashRefunds.plus(cashRefunds);
    totalCashExpenses = totalCashExpenses.plus(cashExpenses);
    totalSettlementsOut = totalSettlementsOut.plus(settlementsOut);
    totalOtherCashOut = totalOtherCashOut.plus(otherCashOut);
    totalCashOut = totalCashOut.plus(cashOut);
    totalExpectedCash = totalExpectedCash.plus(expectedCash);
    if (countedCash !== null) totalCountedCash = totalCountedCash.plus(countedCash);
    if (variance !== null) totalVariance = totalVariance.plus(variance);

    // Online breakdown for this drawer
    const onlineInfo = onlineByDrawer.get(d.id) || onlineByDrawer.get(`${d.custodianUserId}_${ymd(d.date)}`);
    const drawerOnlineTotal = onlineInfo ? onlineInfo.total : toDec(0);
    const drawerOnlineBreakdown = onlineInfo
      ? Array.from(onlineInfo.accounts.entries()).map(([name, amt]) => ({ accountName: name, amount: n(amt) }))
      : [];

    const latestSettlement = d.settlements[0];

    return {
      id: d.id,
      sessionCode: `DRW-${d.id.slice(0, 8).toUpperCase()}`,
      branchId: d.branchId,
      branchName: branchMap.get(d.branchId) || 'Branch',
      kind: d.kind,
      custodianUserId: d.custodianUserId,
      custodianName: d.custodianName,
      date: ymd(d.date),
      openedAt: d.createdAt.toISOString(),
      closedAt: d.closedAt ? d.closedAt.toISOString() : null,
      status: d.status,
      openingFloat: n(openingFloat),
      cashSales: n(cashSales),
      duesCollected: n(duesCollected),
      cashTips: n(cashTips),
      otherCashIn: n(otherCashIn),
      totalCashIn: n(cashIn),
      cashRefunds: n(cashRefunds),
      cashExpenses: n(cashExpenses),
      settlementsOut: n(settlementsOut),
      otherCashOut: n(otherCashOut),
      totalCashOut: n(cashOut),
      expectedCash: n(expectedCash),
      countedCash: countedCash !== null ? n(countedCash) : null,
      variance: variance !== null ? n(variance) : null,
      onlineTotal: n(drawerOnlineTotal),
      onlineBreakdown: drawerOnlineBreakdown,
      latestSettlement: latestSettlement
        ? {
            id: latestSettlement.id,
            status: latestSettlement.status,
            handoverAmount: n(latestSettlement.handoverAmount),
            retainedFloat: n(latestSettlement.retainedFloat),
            reviewedByName: latestSettlement.receivedByName,
          }
        : null,
      movementCount: d.movements.length,
    };
  });

  let filteredRows = rawRows;
  if (query.search && query.search.trim()) {
    const s = query.search.toLowerCase().trim();
    filteredRows = rawRows.filter(
      (r) =>
        r.sessionCode.toLowerCase().includes(s) ||
        r.custodianName.toLowerCase().includes(s) ||
        r.branchName.toLowerCase().includes(s)
    );
  }

  const kpis = {
    totalSessions: drawers.length,
    openSessionsCount: drawers.filter((d) => d.status === 'OPEN').length,
    settledSessionsCount: drawers.filter((d) => d.status === 'SETTLED').length,
    pendingSessionsCount: drawers.filter((d) => d.status === 'SETTLEMENT_PENDING').length,
    totalOpeningFloat: n(totalOpeningFloat),
    totalCashSales: n(totalCashSales),
    totalDuesCollected: n(totalDuesCollected),
    totalCashTips: n(totalCashTips),
    totalCashIn: n(totalCashIn),
    totalCashRefunds: n(totalCashRefunds),
    totalCashExpenses: n(totalCashExpenses),
    totalSettlementsOut: n(totalSettlementsOut),
    totalCashOut: n(totalCashOut),
    totalExpectedCash: n(totalExpectedCash),
    totalCountedCash: n(totalCountedCash),
    totalVariance: n(totalVariance),
    totalPhysicalCashCollected: n(overallCashReceipts),
    totalOnlineCollected: n(overallOnlineReceipts),
    grandTotalCollections: n(
      (overallCashReceipts).plus(overallOnlineReceipts)
    ),
  };

  const tenderBreakdown = {
    totalCash: kpis.totalPhysicalCashCollected,
    totalOnline: kpis.totalOnlineCollected,
    grandTotal: kpis.grandTotalCollections,
    onlineAccounts: onlineAccountsBreakdown,
  };

  const totals = {
    openingFloat: n(totalOpeningFloat),
    cashSales: n(totalCashSales),
    cashIn: n(totalCashIn),
    cashRefunds: n(totalCashRefunds),
    cashExpenses: n(totalCashExpenses),
    settlementsOut: n(totalSettlementsOut),
    cashOut: n(totalCashOut),
    expectedCash: n(totalExpectedCash),
    countedCash: n(totalCountedCash),
    variance: n(totalVariance),
    onlineTotal: n(overallOnlineReceipts),
  };

  return formatReportResponse(ctx.meta, {
    kpis,
    tenderBreakdown,
    rows: filteredRows,
    transactions,
    totals,
  });
};

// ═══ DETAILED OPERATIONAL EXPENSES REPORT ══════════════════════════════════

export const detailedExpensesReport = async (actor, query = {}) => {
  const ctx = await resolveReportContext(actor, query, 'RECOGNITION');
  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  const where = {
    expenseDate: dateRange,
    ...branchFilter,
    ...(query.category && query.category !== 'ALL' ? { category: query.category } : {}),
    ...(query.status && query.status !== 'ALL'
      ? { status: query.status }
      : { status: { not: 'DRAFT' } }),
    ...(query.paymentSource && query.paymentSource !== 'ALL' ? { paymentSource: query.paymentSource } : {}),
    ...(query.paymentAccountId && query.paymentAccountId !== 'ALL' ? { paymentAccountId: query.paymentAccountId } : {}),
    ...(actor.role === 'ACCOUNTANT'
      ? { OR: [{ createdByUserId: actor.id }, { paidByUserId: actor.id }] }
      : (query.createdByUserId && query.createdByUserId !== 'ALL' ? { createdByUserId: query.createdByUserId } : {})),
  };

  const [expenses, branches, categories, paymentAccounts] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.expenseCategory.findMany({
      where: { ...branchFilter, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.paymentAccount.findMany({
      where: { ...branchFilter, isActive: true },
      select: { id: true, name: true, accountType: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  let totalExpenses = toDec(0);
  let totalCashExpenses = toDec(0);
  let totalOnlineExpenses = toDec(0);
  let postedCount = 0;
  let reversedCount = 0;
  let draftCount = 0;

  const categoryMap = new Map();
  const onlineAccountMap = new Map();

  for (const acc of paymentAccounts) {
    onlineAccountMap.set(acc.name, {
      accountId: acc.id,
      accountName: acc.name,
      amount: toDec(0),
      count: 0,
    });
  }

  const rawRows = expenses.map((exp) => {
    const amt = toDec(exp.amount);
    const isPosted = exp.status === 'POSTED';
    const isReversed = exp.status === 'REVERSED';
    const isDraft = exp.status === 'DRAFT';

    if (isPosted) postedCount++;
    else if (isReversed) reversedCount++;
    else if (isDraft) draftCount++;

    if (isPosted) {
      totalExpenses = totalExpenses.plus(amt);
      if (exp.paymentSource === 'CASH_DRAWER') {
        totalCashExpenses = totalCashExpenses.plus(amt);
      } else {
        totalOnlineExpenses = totalOnlineExpenses.plus(amt);
        const accName = exp.paymentAccountName || 'Online Account';
        const existing = onlineAccountMap.get(accName) || {
          accountId: exp.paymentAccountId || '',
          accountName: accName,
          amount: toDec(0),
          count: 0,
        };
        existing.amount = existing.amount.plus(amt);
        existing.count += 1;
        onlineAccountMap.set(accName, existing);
      }

      const catName = exp.category || 'General';
      categoryMap.set(catName, (categoryMap.get(catName) || toDec(0)).plus(amt));
    }

    return {
      id: exp.id,
      voucherNumber: exp.voucherNumber,
      date: ymd(exp.expenseDate),
      time: exp.time,
      branchId: exp.branchId,
      branchName: branchMap.get(exp.branchId) || 'Branch',
      category: exp.category,
      title: exp.title,
      payee: exp.payee,
      description: exp.description || '',
      amount: n(amt),
      paymentSource: exp.paymentSource,
      paymentAccountId: exp.paymentAccountId,
      paymentAccountName: exp.paymentAccountName,
      status: exp.status,
      externalReference: exp.externalReference || '',
      notes: exp.notes || '',
      createdByUserId: exp.createdByUserId,
      createdByName: exp.createdByName,
      paidByName: exp.paidByName || '',
      isReversalRecord: exp.isReversalRecord,
      reversalReason: exp.reversalReason || '',
      reversedByName: exp.reversedByName || '',
    };
  });

  let filteredRows = rawRows;
  if (query.search && query.search.trim()) {
    const s = query.search.toLowerCase().trim();
    filteredRows = rawRows.filter(
      (r) =>
        r.voucherNumber.toLowerCase().includes(s) ||
        r.title.toLowerCase().includes(s) ||
        r.payee.toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s) ||
        r.branchName.toLowerCase().includes(s) ||
        r.createdByName.toLowerCase().includes(s) ||
        r.externalReference.toLowerCase().includes(s)
    );
  }

  const categoryBreakdown = Array.from(categoryMap.entries()).map(([name, sum]) => ({
    categoryName: name,
    amount: n(sum),
  })).sort((a, b) => b.amount - a.amount);

  const onlineAccountsBreakdown = Array.from(onlineAccountMap.values()).map((a) => ({
    accountId: a.accountId,
    accountName: a.accountName,
    amount: n(a.amount),
    count: a.count,
  }));

  const kpis = {
    totalExpenses: n(totalExpenses),
    cashExpenses: n(totalCashExpenses),
    onlineExpenses: n(totalOnlineExpenses),
    totalVouchersCount: expenses.length,
    postedCount,
    reversedCount,
    draftCount,
    categoryCount: categoryMap.size,
  };

  const tenderBreakdown = {
    totalCash: n(totalCashExpenses),
    totalOnline: n(totalOnlineExpenses),
    grandTotal: n(totalExpenses),
    onlineAccounts: onlineAccountsBreakdown,
  };

  const totals = {
    amount: n(totalExpenses),
    cash: n(totalCashExpenses),
    online: n(totalOnlineExpenses),
  };

  return formatReportResponse(ctx.meta, {
    kpis,
    tenderBreakdown,
    categoryBreakdown,
    categories: categories.map((c) => c.name),
    rows: filteredRows,
    totals,
  });
};

// ═══ INVENTORY & SUPPLY CHAIN REPORTS SUITE ══════════════════════════════════
export const inventoryReport = async (actor, query = {}) => {
  denyNonAdmins(actor, 'inventory reports');

  const subType = query.type || 'valuation';
  const ctx = await resolveReportContext(actor, query, subType === 'valuation' || subType === 'expiry' ? 'AS_OF' : 'TRANSACTION');

  const branches = await prisma.branch.findMany({ select: { id: true, name: true, code: true } });
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const accounts = await prisma.paymentAccount.findMany({ select: { id: true, name: true } });
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  if (subType === 'valuation') {
    const [items, batches] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: {
          ...(query.itemType && query.itemType !== 'ALL' ? { itemType: query.itemType } : {}),
          ...(query.categoryId && query.categoryId !== 'ALL' ? { category: query.categoryId } : {}),
        },
        orderBy: { name: 'asc' },
      }),
      prisma.inventoryBatch.findMany({
        where: {
          ...branchFilter,
          remainingQuantity: { gt: 0 },
        },
        include: {
          item: true,
        },
        orderBy: [{ receivedDate: 'asc' }, { batchNumber: 'asc' }],
      }),
    ]);

    const today = await getBusinessDate();
    const todayStr = dateOnly(today);

    let totalCostVal = toDec(0);
    let totalRetailVal = toDec(0);
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let expiredBatchesCount = 0;
    let nearExpiryBatchesCount = 0;

    const itemStockMap = new Map();
    for (const b of batches) {
      const cur = itemStockMap.get(b.itemId) || toDec(0);
      itemStockMap.set(b.itemId, cur.plus(b.remainingQuantity));
    }

    const rows = [];
    for (const b of batches) {
      const item = b.item;
      if (query.itemType && query.itemType !== 'ALL' && item.itemType !== query.itemType) continue;
      if (query.categoryId && query.categoryId !== 'ALL' && item.category !== query.categoryId) continue;

      const isConsumable = item.itemType === 'SALON_CONSUMABLE';
      const remQty = toDec(b.remainingQuantity);
      const unitCost = toDec(b.unitCost);
      const costVal = remQty.times(unitCost);
      const sellingPrice = isConsumable ? toDec(0) : toDec(item.sellingPrice || 0);
      const retailVal = isConsumable ? toDec(0) : remQty.times(sellingPrice);

      totalCostVal = totalCostVal.plus(costVal);
      totalRetailVal = totalRetailVal.plus(retailVal);

      const expDateStr = b.expiryDate ? dateOnly(b.expiryDate) : null;
      let expStatus = 'VALID';
      if (expDateStr && expDateStr < todayStr) {
        expStatus = 'EXPIRED';
        expiredBatchesCount++;
      } else if (expDateStr) {
        const days = Math.round((new Date(expDateStr).getTime() - new Date(todayStr).getTime()) / (1000 * 3600 * 24));
        if (days <= (item.nearExpiryAlertDays || 60)) {
          expStatus = 'NEAR_EXPIRY';
          nearExpiryBatchesCount++;
        }
      }

      const totalItemStock = itemStockMap.get(item.id) || toDec(0);
      let stockStatus = 'IN_STOCK';
      if (totalItemStock.lessThanOrEqualTo(0)) {
        stockStatus = 'OUT_OF_STOCK';
      } else if (totalItemStock.lessThanOrEqualTo(item.minStockLevel || 0)) {
        stockStatus = 'LOW_STOCK';
      }

      rows.push({
        id: b.id,
        batchId: b.id,
        batchNumber: b.batchNumber,
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        category: item.category,
        itemType: item.itemType,
        branchId: b.branchId,
        branchName: branchMap.get(b.branchId) || 'Branch',
        supplierName: b.supplierName || 'N/A',
        receivedDate: ymd(b.receivedDate),
        expiryDate: b.expiryDate ? ymd(b.expiryDate) : null,
        remainingQuantity: n(remQty),
        unitCost: n(unitCost),
        costValue: n(costVal),
        sellingPrice: isConsumable ? 0 : n(sellingPrice),
        retailValue: isConsumable ? 0 : n(retailVal),
        potentialProfit: isConsumable ? 0 : n(retailVal.minus(costVal)),
        potentialMargin: isConsumable || retailVal.lessThanOrEqualTo(0) ? 0 : n(retailVal.minus(costVal).dividedBy(retailVal).times(100)),
        stockStatus,
        expiryStatus: expStatus,
      });
    }

    for (const item of items) {
      const stock = itemStockMap.get(item.id) || toDec(0);
      if (stock.lessThanOrEqualTo(0)) outOfStockCount++;
      else if (stock.lessThanOrEqualTo(item.minStockLevel || 0)) lowStockCount++;
    }

    let filteredRows = rows;
    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      filteredRows = rows.filter(
        (r) =>
          r.itemName.toLowerCase().includes(s) ||
          r.sku.toLowerCase().includes(s) ||
          r.batchNumber.toLowerCase().includes(s) ||
          r.category.toLowerCase().includes(s)
      );
    }

    const categories = [...new Set(items.map((i) => i.category))];

    const kpis = {
      totalCostValue: n(totalCostVal),
      totalRetailValue: n(totalRetailVal),
      potentialGrossProfit: n(totalRetailVal.minus(totalCostVal)),
      totalBatchesCount: rows.length,
      totalItemsCount: items.length,
      lowStockCount,
      outOfStockCount,
      expiredBatchesCount,
      nearExpiryBatchesCount,
    };

    const totals = {
      remainingQuantity: n(filteredRows.reduce((acc, r) => acc + r.remainingQuantity, 0)),
      costValue: n(totalCostVal),
      retailValue: n(totalRetailVal),
      potentialProfit: n(totalRetailVal.minus(totalCostVal)),
    };

    return formatReportResponse(ctx.meta, {
      type: subType,
      kpis,
      rows: filteredRows,
      totals,
      categories,
    });
  }

  if (subType === 'movements') {
    const movements = await prisma.stockMovement.findMany({
      where: {
        ...branchFilter,
        createdAt: {
          gte: ctx.fromDate,
          lte: ctx.toDate,
        },
        ...(query.itemId ? { itemId: query.itemId } : {}),
        ...(query.movementType && query.movementType !== 'ALL' ? { movementType: query.movementType } : {}),
      },
      include: {
        item: true,
        batch: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalInQty = toDec(0);
    let totalOutQty = toDec(0);
    let totalInCost = toDec(0);
    let totalOutCost = toDec(0);

    const rows = movements.map((m) => {
      const qtyVal = toDec(m.quantity);
      const costVal = toDec(m.totalCost);
      const isIncoming = m.direction === 'IN';

      if (isIncoming) {
        totalInQty = totalInQty.plus(qtyVal);
        totalInCost = totalInCost.plus(costVal);
      } else {
        totalOutQty = totalOutQty.plus(qtyVal);
        totalOutCost = totalOutCost.plus(costVal);
      }

      return {
        id: m.id,
        movementNumber: m.movementNumber,
        date: toDateString(m.createdAt),
        time: toTimeString(m.createdAt),
        createdAt: m.createdAt.toISOString(),
        branchId: m.branchId,
        branchName: branchMap.get(m.branchId) || 'Branch',
        itemId: m.itemId,
        itemName: m.item?.name || 'Item',
        sku: m.item?.sku || 'SKU',
        category: m.item?.category || 'General',
        batchNumber: m.batch?.batchNumber || 'N/A',
        movementType: m.movementType,
        direction: m.direction,
        quantity: n(qtyVal),
        unitCost: n(m.unitCost),
        totalCost: n(costVal),
        sourceReferenceType: m.sourceReferenceType,
        sourceReferenceNumber: m.sourceReferenceNumber,
        reason: m.reason || '',
        notes: m.notes || '',
        userName: m.userName || 'System',
      };
    });

    let filteredRows = rows;
    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      filteredRows = rows.filter(
        (r) =>
          r.movementNumber.toLowerCase().includes(s) ||
          r.itemName.toLowerCase().includes(s) ||
          r.sku.toLowerCase().includes(s) ||
          r.batchNumber.toLowerCase().includes(s) ||
          r.sourceReferenceNumber.toLowerCase().includes(s) ||
          r.reason.toLowerCase().includes(s)
      );
    }

    const kpis = {
      totalMovementsCount: movements.length,
      totalInQuantity: n(totalInQty),
      totalOutQuantity: n(totalOutQty),
      netQuantityChange: n(totalInQty.minus(totalOutQty)),
      totalInCostValue: n(totalInCost),
      totalOutCostValue: n(totalOutCost),
    };

    const totals = {
      inQuantity: n(totalInQty),
      outQuantity: n(totalOutQty),
      inCostValue: n(totalInCost),
      outCostValue: n(totalOutCost),
    };

    return formatReportResponse(ctx.meta, {
      type: subType,
      kpis,
      rows: filteredRows,
      totals,
    });
  }

  if (subType === 'purchases') {
    const purchases = await prisma.purchase.findMany({
      where: {
        ...branchFilter,
        purchaseDate: {
          gte: dateOnly(ctx.fromStr),
          lte: dateOnly(ctx.toStr),
        },
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      include: {
        supplier: true,
        lines: true,
      },
      orderBy: { purchaseDate: 'desc' },
    });

    let totalNet = toDec(0);
    let totalPaid = toDec(0);
    let totalDue = toDec(0);
    let totalCashPaid = toDec(0);
    let totalOnlinePaid = toDec(0);
    const onlineAccountMap = new Map();

    const rows = purchases.map((p) => {
      const net = toDec(p.netAmount);
      const paid = toDec(p.paidAmount);
      const due = toDec(p.balanceDue);

      totalNet = totalNet.plus(net);
      totalPaid = totalPaid.plus(paid);
      totalDue = totalDue.plus(due);

      if (paid.greaterThan(0)) {
        if (p.paymentMethod === 'CASH') {
          totalCashPaid = totalCashPaid.plus(paid);
        } else {
          totalOnlinePaid = totalOnlinePaid.plus(paid);
          const accName = accountMap.get(p.paymentAccountId) || 'Online Account';
          const existing = onlineAccountMap.get(accName) || {
            accountId: p.paymentAccountId || '',
            accountName: accName,
            amount: toDec(0),
            count: 0,
          };
          existing.amount = existing.amount.plus(paid);
          existing.count += 1;
          onlineAccountMap.set(accName, existing);
        }
      }

      const totalQty = p.lines.reduce((s, l) => s + Number(l.quantity || 0), 0);

      return {
        id: p.id,
        purchaseNumber: p.purchaseNumber,
        purchaseDate: ymd(p.purchaseDate),
        supplierId: p.supplierId,
        supplierName: p.supplierName || p.supplier?.name || 'Supplier',
        supplierInvoiceNumber: p.supplierInvoiceNumber || '',
        branchId: p.branchId,
        branchName: branchMap.get(p.branchId) || 'Branch',
        linesCount: p.lines.length,
        totalQuantity: totalQty,
        subtotal: n(p.subtotal),
        discount: n(p.discount),
        netAmount: n(net),
        paidAmount: n(paid),
        balanceDue: n(due),
        paymentMethod: p.paymentMethod,
        paymentStatus: p.paymentStatus,
        paymentAccountName: accountMap.get(p.paymentAccountId) || null,
        createdByName: p.createdByName,
        status: p.status,
      };
    });

    let filteredRows = rows;
    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      filteredRows = rows.filter(
        (r) =>
          r.purchaseNumber.toLowerCase().includes(s) ||
          r.supplierName.toLowerCase().includes(s) ||
          r.supplierInvoiceNumber.toLowerCase().includes(s)
      );
    }

    const onlineAccountsBreakdown = Array.from(onlineAccountMap.values()).map((a) => ({
      accountId: a.accountId,
      accountName: a.accountName,
      amount: n(a.amount),
      count: a.count,
    }));

    const tenderBreakdown = {
      totalCash: n(totalCashPaid),
      totalOnline: n(totalOnlinePaid),
      grandTotal: n(totalPaid),
      onlineAccounts: onlineAccountsBreakdown,
    };

    const kpis = {
      totalPurchasesCount: purchases.length,
      totalPurchasedValue: n(totalNet),
      totalPaidAmount: n(totalPaid),
      totalBalanceDue: n(totalDue),
    };

    const totals = {
      netAmount: n(totalNet),
      paidAmount: n(totalPaid),
      balanceDue: n(totalDue),
    };

    return formatReportResponse(ctx.meta, {
      type: subType,
      kpis,
      tenderBreakdown,
      rows: filteredRows,
      totals,
    });
  }

  if (subType === 'supplier-ledger') {
    const suppliers = await prisma.supplier.findMany({
      where: {
        ...(query.supplierId ? { id: query.supplierId } : {}),
      },
      orderBy: { name: 'asc' },
    });

    const fromDate = dateOnly(ctx.fromStr);
    const priorEntries = await prisma.supplierLedger.groupBy({
      by: ['supplierId'],
      where: {
        date: { lt: fromDate },
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...branchFilter,
      },
      _sum: {
        credit: true,
        debit: true,
      },
    });

    const priorMap = new Map();
    for (const p of priorEntries) {
      const c = toDec(p._sum.credit ?? 0);
      const d = toDec(p._sum.debit ?? 0);
      priorMap.set(p.supplierId, c.minus(d));
    }

    const periodEntries = await prisma.supplierLedger.findMany({
      where: {
        date: {
          gte: fromDate,
          lte: dateOnly(ctx.toStr),
        },
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...branchFilter,
      },
      include: {
        supplier: true,
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    const supplierRunning = new Map();
    let totalOpeningPayable = toDec(0);
    for (const s of suppliers) {
      const prior = priorMap.get(s.id) || toDec(0);
      const open = toDec(s.openingPayable || 0).plus(prior);
      supplierRunning.set(s.id, open);
      totalOpeningPayable = totalOpeningPayable.plus(open);
    }

    let totalPeriodDebit = toDec(0);
    let totalPeriodCredit = toDec(0);

    const rows = [];
    for (const e of periodEntries) {
      const prev = supplierRunning.get(e.supplierId) || toDec(0);
      const dr = toDec(e.debit);
      const cr = toDec(e.credit);

      totalPeriodDebit = totalPeriodDebit.plus(dr);
      totalPeriodCredit = totalPeriodCredit.plus(cr);

      const next = prev.plus(cr).minus(dr);
      supplierRunning.set(e.supplierId, next);

      rows.push({
        id: e.id,
        date: ymd(e.date),
        supplierId: e.supplierId,
        supplierName: e.supplier?.name || 'Supplier',
        branchId: e.branchId,
        branchName: branchMap.get(e.branchId) || 'Branch',
        entryType: e.entryType,
        referenceType: e.referenceType,
        referenceNumber: e.referenceNumber,
        description: e.description,
        debit: n(dr),
        credit: n(cr),
        runningBalance: n(next),
        userName: e.userName,
      });
    }

    let closingPayable = toDec(0);
    for (const val of supplierRunning.values()) {
      closingPayable = closingPayable.plus(val);
    }

    let filteredRows = rows;
    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      filteredRows = rows.filter(
        (r) =>
          r.supplierName.toLowerCase().includes(s) ||
          r.referenceNumber.toLowerCase().includes(s) ||
          r.description.toLowerCase().includes(s)
      );
    }

    const kpis = {
      openingPayable: n(totalOpeningPayable),
      periodPurchasesCredit: n(totalPeriodCredit),
      periodPaymentsDebit: n(totalPeriodDebit),
      closingPayable: n(closingPayable),
      activeSuppliersCount: suppliers.length,
    };

    const totals = {
      debit: n(totalPeriodDebit),
      credit: n(totalPeriodCredit),
    };

    return formatReportResponse(ctx.meta, {
      type: subType,
      kpis,
      rows: filteredRows,
      totals,
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, code: s.supplierCode })),
    });
  }

  if (subType === 'consumption') {
    const movements = await prisma.stockMovement.findMany({
      where: {
        ...branchFilter,
        movementType: { in: ['SALON_CONSUMPTION_OUT', 'INTERNAL_USE_OUT'] },
        createdAt: {
          gte: ctx.fromDate,
          lte: ctx.toDate,
        },
        ...(query.itemId ? { itemId: query.itemId } : {}),
      },
      include: {
        item: true,
        batch: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalQty = toDec(0);
    let totalCost = toDec(0);
    const categoryCostMap = new Map();

    const rows = movements.map((m) => {
      const q = toDec(m.quantity);
      const c = toDec(m.totalCost);

      totalQty = totalQty.plus(q);
      totalCost = totalCost.plus(c);

      const cat = m.item?.category || 'Consumable';
      categoryCostMap.set(cat, (categoryCostMap.get(cat) || toDec(0)).plus(c));

      return {
        id: m.id,
        movementNumber: m.movementNumber,
        date: toDateString(m.createdAt),
        time: toTimeString(m.createdAt),
        branchId: m.branchId,
        branchName: branchMap.get(m.branchId) || 'Branch',
        itemId: m.itemId,
        itemName: m.item?.name || 'Item',
        sku: m.item?.sku || 'SKU',
        category: cat,
        batchNumber: m.batch?.batchNumber || 'N/A',
        quantity: n(q),
        unitCost: n(m.unitCost),
        totalCost: n(c),
        reason: m.reason || 'Salon Consumption',
        notes: m.notes || '',
        sourceReferenceNumber: m.sourceReferenceNumber || '',
        userName: m.userName || 'Staff',
      };
    });

    let filteredRows = rows;
    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      filteredRows = rows.filter(
        (r) =>
          r.movementNumber.toLowerCase().includes(s) ||
          r.itemName.toLowerCase().includes(s) ||
          r.sku.toLowerCase().includes(s) ||
          r.reason.toLowerCase().includes(s)
      );
    }

    const categoryBreakdown = Array.from(categoryCostMap.entries()).map(([name, sum]) => ({
      categoryName: name,
      amount: n(sum),
    })).sort((a, b) => b.amount - a.amount);

    const kpis = {
      totalConsumptionCount: movements.length,
      totalConsumedQuantity: n(totalQty),
      totalMaterialCost: n(totalCost),
      categoryCount: categoryCostMap.size,
    };

    const totals = {
      quantity: n(totalQty),
      totalCost: n(totalCost),
    };

    return formatReportResponse(ctx.meta, {
      type: subType,
      kpis,
      categoryBreakdown,
      rows: filteredRows,
      totals,
    });
  }

  if (subType === 'expiry') {
    const today = await getBusinessDate();
    const todayStr = dateOnly(today);

    const batches = await prisma.inventoryBatch.findMany({
      where: {
        ...branchFilter,
        expiryDate: { not: null },
        remainingQuantity: { gt: 0 },
      },
      include: {
        item: true,
      },
      orderBy: { expiryDate: 'asc' },
    });

    let expiredCost = toDec(0);
    let criticalCost = toDec(0);
    let nearExpiryCost = toDec(0);
    let expiredCount = 0;
    let criticalCount = 0;
    let nearExpiryCount = 0;

    const rows = [];
    for (const b of batches) {
      const expDateStr = dateOnly(b.expiryDate);
      const days = Math.round((new Date(expDateStr).getTime() - new Date(todayStr).getTime()) / (1000 * 3600 * 24));
      const rem = toDec(b.remainingQuantity);
      const cost = rem.times(b.unitCost);

      let status = 'VALID';
      if (days < 0) {
        status = 'EXPIRED';
        expiredCount++;
        expiredCost = expiredCost.plus(cost);
      } else if (days <= 30) {
        status = 'CRITICAL';
        criticalCount++;
        criticalCost = criticalCost.plus(cost);
      } else if (days <= (b.item.nearExpiryAlertDays || 60)) {
        status = 'NEAR_EXPIRY';
        nearExpiryCount++;
        nearExpiryCost = nearExpiryCost.plus(cost);
      }

      rows.push({
        id: b.id,
        batchNumber: b.batchNumber,
        itemId: b.itemId,
        itemName: b.item.name,
        sku: b.item.sku,
        category: b.item.category,
        branchId: b.branchId,
        branchName: branchMap.get(b.branchId) || 'Branch',
        supplierName: b.supplierName || 'N/A',
        receivedDate: ymd(b.receivedDate),
        expiryDate: expDateStr,
        daysRemaining: days,
        remainingQuantity: n(rem),
        unitCost: n(b.unitCost),
        costAtRisk: n(cost),
        status,
      });
    }

    let filteredRows = rows;
    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      filteredRows = rows.filter(
        (r) =>
          r.itemName.toLowerCase().includes(s) ||
          r.sku.toLowerCase().includes(s) ||
          r.batchNumber.toLowerCase().includes(s)
      );
    }

    const kpis = {
      totalTrackedBatches: batches.length,
      expiredBatchesCount: expiredCount,
      expiredCostLoss: n(expiredCost),
      criticalBatchesCount: criticalCount,
      criticalCostAtRisk: n(criticalCost),
      nearExpiryBatchesCount: nearExpiryCount,
      nearExpiryCostAtRisk: n(nearExpiryCost),
    };

    const totals = {
      remainingQuantity: n(filteredRows.reduce((acc, r) => acc + r.remainingQuantity, 0)),
      costAtRisk: n(filteredRows.reduce((acc, r) => acc + r.costAtRisk, 0)),
    };

    return formatReportResponse(ctx.meta, {
      type: subType,
      kpis,
      rows: filteredRows,
      totals,
    });
  }

  const summaryData = await inventorySummary(actor, ctx.branchId);
  return formatReportResponse(ctx.meta, {
    type: 'summary',
    kpis: summaryData,
    rows: [],
    totals: {},
  });
};

// ═══ ATTENDANCE & OVERTIME REPORT ═════════════════════════════════════════════
export const attendanceOvertimeReport = async (actor, query = {}) => {
  denyNonAdmins(actor, 'staff attendance or overtime reports');

  const ctx = await resolveReportContext(actor, query, 'WORK_DATE');
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};
  const staffFilter = query.staffId && query.staffId !== 'ALL' ? { staffId: query.staffId } : {};

  const [staffList, branches] = await Promise.all([
    prisma.staff.findMany({
      where: {
        ...branchFilter,
        ...(query.staffId && query.staffId !== 'ALL' ? { id: query.staffId } : {}),
      },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        designation: true,
        branchId: true,
        startTime: true,
        endTime: true,
        baseSalary: true,
      },
    }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
  ]);

  const staffMap = new Map(staffList.map((s) => [s.id, s]));
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const [attendanceRecords, overtimeRecords] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        ...branchFilter,
        ...staffFilter,
        workDate: { gte: ctx.fromDate, lte: ctx.toDate },
      },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.overtimeRecord.findMany({
      where: {
        ...branchFilter,
        ...staffFilter,
        workDate: { gte: ctx.fromDate, lte: ctx.toDate },
      },
      orderBy: [{ workDate: 'desc' }, { enteredAt: 'desc' }],
    }),
  ]);

  // Group overtime by staffId + YYYY-MM-DD
  const otMap = new Map();
  for (const ot of overtimeRecords) {
    const dStr = ymd(ot.workDate) || String(ot.workDate).slice(0, 10);
    const key = `${ot.staffId}_${dStr}`;
    if (!otMap.has(key)) otMap.set(key, []);
    otMap.get(key).push(ot);
  }

  const recordKeys = new Set();
  const rows = [];

  for (const att of attendanceRecords) {
    const dateStr = ymd(att.workDate) || String(att.workDate).slice(0, 10);
    const key = `${att.staffId}_${dateStr}`;
    recordKeys.add(key);

    const st = staffMap.get(att.staffId);
    const staffName = st?.name || 'Unknown Staff';
    const employeeCode = st?.employeeCode || '—';
    const designation = st?.designation || 'Staff';
    const branchName = branchMap.get(att.branchId) || 'Branch';

    const dayOts = otMap.get(key) || [];
    const approvedOt = dayOts.filter((o) => o.status === 'APPROVED');
    const otMinutes = approvedOt.reduce((sum, o) => sum + (o.approvedMinutes || o.minutes || 0), 0);
    const otHours = n(toDec(otMinutes).dividedBy(60));
    const otAmount = n(approvedOt.reduce((sum, o) => sum.plus(toDec(o.amount || 0)), toDec(0)));
    const otStatus = dayOts.length > 0 ? dayOts[0].status : 'NONE';
    const otReason = dayOts.map((o) => o.reason).filter(Boolean).join('; ') || '—';
    const otApprovedBy = dayOts.map((o) => o.approvedByName).filter(Boolean).join(', ') || '—';

    rows.push({
      id: att.id,
      date: dateStr,
      staffId: att.staffId,
      staffName,
      employeeCode,
      designation,
      branchId: att.branchId,
      branchName,
      shift: st?.startTime && st?.endTime ? `${st.startTime} - ${st.endTime}` : 'Standard (9h)',
      checkIn: att.checkIn || '—',
      checkOut: att.checkOut || '—',
      scheduledHours: n(att.scheduledHours || 8),
      workedHours: n(att.workedHours || 0),
      lateMinutes: att.lateMinutes || 0,
      earlyExitMinutes: att.earlyExitMinutes || 0,
      isLate: Boolean(att.isLate || att.lateMinutes > 0),
      status: att.status,
      source: att.source || 'MANUAL',
      otMinutes,
      otHours,
      otAmount,
      otStatus,
      otReason,
      otApprovedBy,
      notes: att.notes || '',
    });
  }

  // Include standalone overtime records that don't have an attendance punch on that date
  for (const ot of overtimeRecords) {
    const dateStr = ymd(ot.workDate) || String(ot.workDate).slice(0, 10);
    const key = `${ot.staffId}_${dateStr}`;
    if (!recordKeys.has(key)) {
      recordKeys.add(key);
      const st = staffMap.get(ot.staffId);
      const staffName = st?.name || 'Unknown Staff';
      const employeeCode = st?.employeeCode || '—';
      const designation = st?.designation || 'Staff';
      const branchName = branchMap.get(ot.branchId) || 'Branch';

      const isApproved = ot.status === 'APPROVED';
      const otMin = isApproved ? (ot.approvedMinutes || ot.minutes || 0) : ot.minutes;
      const otHours = n(toDec(otMin).dividedBy(60));
      const otAmount = isApproved ? n(ot.amount || 0) : 0;

      rows.push({
        id: `ot-${ot.id}`,
        date: dateStr,
        staffId: ot.staffId,
        staffName,
        employeeCode,
        designation,
        branchId: ot.branchId,
        branchName,
        shift: st?.shift || 'Overtime Entry',
        checkIn: '—',
        checkOut: '—',
        scheduledHours: 0,
        workedHours: 0,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        isLate: false,
        status: isApproved ? 'APPROVED_OVERTIME' : 'OVERTIME_ENTRY',
        source: 'MANUAL',
        otMinutes: otMin,
        otHours,
        otAmount,
        otStatus: ot.status,
        otReason: ot.reason || '—',
        otApprovedBy: ot.approvedByName || '—',
        notes: ot.notes || '',
      });
    }
  }

  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.staffName || '').localeCompare(String(b.staffName || '')));

  let filteredRows = rows;
  if (query.status && query.status !== 'ALL') {
    filteredRows = filteredRows.filter((r) => r.status === query.status);
  }
  if (query.otStatus && query.otStatus !== 'ALL') {
    filteredRows = filteredRows.filter((r) => r.otStatus === query.otStatus);
  }
  if (query.search && query.search.trim()) {
    const s = query.search.toLowerCase().trim();
    filteredRows = filteredRows.filter(
      (r) =>
        r.staffName.toLowerCase().includes(s) ||
        r.employeeCode.toLowerCase().includes(s) ||
        r.designation.toLowerCase().includes(s)
    );
  }

  const presentCount = rows.filter((r) => r.status === 'PRESENT' || r.workedHours > 0).length;
  const absentCount = rows.filter((r) => r.status === 'ABSENT').length;
  const leaveCount = rows.filter((r) => r.status.includes('LEAVE')).length;
  const lateCount = rows.filter((r) => r.isLate || r.lateMinutes > 0).length;
  const totalWorkedHours = n(rows.reduce((sum, r) => sum + r.workedHours, 0));
  const authorizedOtHours = n(rows.reduce((sum, r) => sum + r.otHours, 0));
  const authorizedOtAmount = n(rows.reduce((sum, r) => sum + r.otAmount, 0));

  const kpis = {
    totalRecords: rows.length,
    presentCount,
    absentCount,
    leaveCount,
    lateCount,
    totalWorkedHours,
    authorizedOtHours,
    authorizedOtAmount,
  };

  const totals = {
    scheduledHours: n(filteredRows.reduce((sum, r) => sum + r.scheduledHours, 0)),
    workedHours: n(filteredRows.reduce((sum, r) => sum + r.workedHours, 0)),
    lateMinutes: filteredRows.reduce((sum, r) => sum + r.lateMinutes, 0),
    otMinutes: filteredRows.reduce((sum, r) => sum + r.otMinutes, 0),
    otHours: n(filteredRows.reduce((sum, r) => sum + r.otHours, 0)),
    otAmount: n(filteredRows.reduce((sum, r) => sum + r.otAmount, 0)),
  };

  return formatReportResponse(ctx.meta, {
    kpis,
    rows: filteredRows,
    totals,
  });
};

// ═══ TAX MANAGEMENT & AUDIT REPORT ═══════════════════════════════════════════

export { taxReport } from './tax.report.js';

// ═══ DETAILED INCOME REPORT (Report 07) ═════════════════════════════════════════

export const detailedIncomeReport = async (actor, query = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access detailed income report.');

  const ctx = await resolveReportContext(actor, query, 'INVOICE_POSTING');
  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const where = {
    date: dateRange,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  };

  if (actor.role === 'ACCOUNTANT') {
    where.processedByUserId = actor.id;
  } else if (query.soldByUserId && query.soldByUserId !== 'ALL') {
    where.processedByUserId = query.soldByUserId;
  }

  if (query.paymentStatus && query.paymentStatus !== 'ALL') {
    where.status = query.paymentStatus;
  }

  if (query.lifecycle && query.lifecycle !== 'ALL') {
    where.lifecycle = query.lifecycle;
  } else {
    where.lifecycle = { not: 'VOIDED' };
  }

  if (query.paymentMethod && query.paymentMethod !== 'ALL') {
    where.paymentMethod = query.paymentMethod;
  }

  if (query.staffId && query.staffId !== 'ALL') {
    where.OR = [
      { staffId: query.staffId },
      { lines: { some: { staffId: query.staffId } } },
    ];
  }

  if (query.sourceType && query.sourceType !== 'ALL') {
    where.lines = { some: { type: query.sourceType } };
  }

  if (query.search && query.search.trim()) {
    const s = query.search.trim();
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { invoiceNumber: { contains: s, mode: 'insensitive' } },
          { clientName: { contains: s, mode: 'insensitive' } },
          { clientPhone: { contains: s, mode: 'insensitive' } },
          { lines: { some: { name: { contains: s, mode: 'insensitive' } } } },
        ],
      },
    ];
  }

  const [branches, invoices] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true, city: true } }),
    prisma.invoice.findMany({
      where,
      include: {
        lines: {
          include: {
            components: {
              select: {
                id: true,
                serviceCode: true,
                serviceName: true,
                quantity: true,
                staffId: true,
                staffName: true,
                allocatedAmount: true,
                allocationPercentage: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        payments: {
          select: {
            id: true,
            receiptNumber: true,
            amount: true,
            method: true,
            paymentAccountId: true,
            paymentAccountName: true,
            date: true,
            time: true,
            kind: true,
          },
          orderBy: { date: 'asc' },
        },
        refunds: {
          select: {
            id: true,
            refundNumber: true,
            type: true,
            refundDate: true,
            netReversed: true,
            taxReversed: true,
            tipReversed: true,
            cashOut: true,
            receivableCancelled: true,
            method: true,
            reason: true,
            byName: true,
            lines: {
              select: {
                id: true,
                lineId: true,
                quantity: true,
                net: true,
                tax: true,
              },
            },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  let totalGross = toDec(0);
  let totalDiscount = toDec(0);
  let totalNetSales = toDec(0);
  let totalRefundedNet = toDec(0);
  let totalRecognizedNet = toDec(0);
  let totalTax = toDec(0);
  let totalNetTax = toDec(0);
  let totalTips = toDec(0);
  let totalPaid = toDec(0);

  let serviceRevenue = toDec(0);
  let productRevenue = toDec(0);
  let packageRevenue = toDec(0);

  let serviceCount = 0;
  let productCount = 0;
  let packageCount = 0;

  const rows = [];

  for (const inv of invoices) {
    const isVoided = inv.lifecycle === 'VOIDED';
    const invPayments = inv.payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amount: n(p.amount),
      method: p.method,
      paymentAccountId: p.paymentAccountId,
      paymentAccountName: p.paymentAccountName || (p.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
      date: ymd(p.date),
      time: p.time,
      kind: p.kind,
    }));

    if (!isVoided) {
      totalPaid = totalPaid.plus(toDec(inv.amountPaid));
      totalTips = totalTips.plus(toDec(inv.tip));
    }

    for (const line of inv.lines) {
      if (query.sourceType && query.sourceType !== 'ALL' && line.type !== query.sourceType) {
        continue;
      }
      if (query.staffId && query.staffId !== 'ALL' && line.staffId !== query.staffId) {
        continue;
      }

      const lineGross = toDec(line.quantity).times(toDec(line.unitPrice));
      const lineDiscount = toDec(line.discountAllocated);
      const lineNet = toDec(line.netSales);
      const lineTax = toDec(line.tax);

      let lineRefundNet = toDec(0);
      let lineRefundTax = toDec(0);
      for (const ref of inv.refunds) {
        for (const rl of ref.lines || []) {
          if (rl.lineId === line.id) {
            lineRefundNet = lineRefundNet.plus(toDec(rl.net));
            lineRefundTax = lineRefundTax.plus(toDec(rl.tax));
          }
        }
      }

      const recognizedNet = isVoided ? toDec(0) : lineNet.minus(lineRefundNet);
      const netTax = isVoided ? toDec(0) : lineTax.minus(lineRefundTax);

      if (!isVoided) {
        totalGross = totalGross.plus(lineGross);
        totalDiscount = totalDiscount.plus(lineDiscount);
        totalNetSales = totalNetSales.plus(lineNet);
        totalRefundedNet = totalRefundedNet.plus(lineRefundNet);
        totalRecognizedNet = totalRecognizedNet.plus(recognizedNet);
        totalTax = totalTax.plus(lineTax);
        totalNetTax = totalNetTax.plus(netTax);

        if (line.type === 'SERVICE' || line.type === 'CUSTOM_SERVICE') {
          serviceRevenue = serviceRevenue.plus(recognizedNet);
          serviceCount += Number(line.quantity);
        } else if (line.type === 'PRODUCT') {
          productRevenue = productRevenue.plus(recognizedNet);
          productCount += Number(line.quantity);
        } else if (line.type === 'PACKAGE') {
          packageRevenue = packageRevenue.plus(recognizedNet);
          packageCount += Number(line.quantity);
        }
      }

      rows.push({
        id: line.id,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: ymd(inv.date),
        time: inv.time,
        branchId: inv.branchId,
        branchName: branchMap.get(inv.branchId) || 'Branch',
        incomeSource: line.type,
        clientId: inv.clientId,
        clientName: inv.clientName || 'Walk-in Customer',
        clientPhone: inv.clientPhone || '',
        itemCode: line.code || '—',
        itemName: line.name,
        staffId: line.staffId,
        staffName: line.staffName || 'Staff',
        quantity: Number(line.quantity),
        unitPrice: n(toDec(line.unitPrice)),
        gross: n(lineGross),
        discount: n(lineDiscount),
        netSales: n(lineNet),
        refundedNet: n(lineRefundNet),
        recognizedNet: n(recognizedNet),
        taxRate: round2(toDec(line.taxRate).times(100)).toNumber(),
        tax: n(lineTax),
        netTax: n(netTax),
        total: n(toDec(line.total)),
        paymentStatus: inv.status,
        lifecycle: inv.lifecycle,
        createdByName: inv.processedByName,
        payments: invPayments,
        refunds: inv.refunds.map((r) => ({
          id: r.id,
          refundNumber: r.refundNumber,
          type: r.type,
          refundDate: ymd(r.refundDate),
          method: r.method,
          reason: r.reason,
          byName: r.byName,
          netReversed: n(r.netReversed),
          taxReversed: n(r.taxReversed),
          tipReversed: n(r.tipReversed),
          cashOut: n(r.cashOut),
          receivableCancelled: n(r.receivableCancelled),
          lineRefund: r.lines?.find((rl) => rl.lineId === line.id)
            ? {
                quantity: Number(r.lines.find((rl) => rl.lineId === line.id).quantity),
                net: n(r.lines.find((rl) => rl.lineId === line.id).net),
                tax: n(r.lines.find((rl) => rl.lineId === line.id).tax),
              }
            : null,
        })),
        components: (line.components || []).map((c) => ({
          id: c.id,
          serviceCode: c.serviceCode,
          serviceName: c.serviceName,
          quantity: c.quantity,
          staffId: c.staffId,
          staffName: c.staffName,
          allocatedAmount: n(toDec(c.allocatedAmount)),
          allocationPercentage: Number(c.allocationPercentage),
        })),
      });
    }
  }

  const kpis = {
    totalTransactions: rows.length,
    grossSales: n(totalGross),
    totalDiscounts: n(totalDiscount),
    netSales: n(totalNetSales),
    totalRefunded: n(totalRefundedNet),
    recognizedNetRevenue: n(totalRecognizedNet),
    totalTaxCharged: n(totalTax),
    netTaxLiability: n(totalNetTax),
    tipsCollected: n(totalTips),
    serviceRevenue: n(serviceRevenue),
    serviceCount,
    productRevenue: n(productRevenue),
    productCount,
    packageRevenue: n(packageRevenue),
    packageCount,
    totalPaid: n(totalPaid),
  };

  const totals = {
    gross: n(totalGross),
    discount: n(totalDiscount),
    netSales: n(totalNetSales),
    refundedNet: n(totalRefundedNet),
    recognizedNet: n(totalRecognizedNet),
    tax: n(totalTax),
    netTax: n(totalNetTax),
  };

  return formatReportResponse(ctx.meta, { kpis, rows, totals });
};








