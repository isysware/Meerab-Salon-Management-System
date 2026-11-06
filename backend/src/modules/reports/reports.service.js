// src/modules/reports/reports.service.js
// Read-only operational reports built from canonical tables:
//   • Appointment report  — bookings with their linked invoice outcome
//   • Staff performance   — invoice-line attribution + commission, tips, attendance, overtime
// Voided invoices never count as performance. Tips are reported separately from sales.

import { accruedCommissionForPeriod } from './fullCommissionAccrual.js';
import { recognizedSalaryExpense } from './salaryRecognition.js';
import { loadInvoicePresentation, groupLedgerInvoices } from './invoicePresentation.js';
import { loadStaffLoanMovements, currentStaffLoanReceivable, STAFF_LOAN_CATEGORY } from './staffLoanMovements.js';
import prisma from '../../config/prisma.js';
import { forbidden, notFound } from '../../lib/AppError.js';
import { resolveReadBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, ymd, startOfDay, endOfDay, toDateString, toTimeString } from '../../lib/dates.js';
import { max0, round2, toDec } from '../../lib/money.js';
import { listAppointments } from '../appointments/appointments.service.js';
import { inventorySummary } from '../inventory/inventory.service.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';
import { loadCollectionEvents, staffShares, payoutEvents, collectionTotals, collectionReceipts } from './collectionEvents.js';
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
  const performanceScope = { branchId: { in: [...new Set(staffList.map(s => s.branchId))] } };
  const activeInvoice = { ...performanceScope, date: period, lifecycle: { not: 'VOIDED' } };

  const [lines, statements, allocations, payouts, attendance, overtime, collectionEvents, commissionPayments] = await Promise.all([
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
    loadCollectionEvents({ branchId: { in: [...new Set(staffList.map(s => s.branchId))] } }, startDate, endDate),
    prisma.commissionPayment.findMany({ where: { ...performanceScope, staffId: { in: ids }, status: { in: ['COMPLETED', 'REVERSED'] }, paidAt: { lte: endOfDay(endDate) } } }),
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

    let collected = toDec(0);
    const matches = (line, share) => (!filters.packageId || filters.packageId === 'ALL' || (line.type === 'PACKAGE' && line.itemId === filters.packageId))
      && (!filters.serviceId || filters.serviceId === 'ALL' || (share.serviceId || line.itemId) === filters.serviceId);
    for (const line of lines) {
      for (const share of staffShares(line, line.netSales).filter(c => c.staffId === st.id && matches(line, c))) {
        const proportion = toDec(line.netSales).gt(0) ? share.net.div(line.netSales) : toDec(0);
        const discount = round2(toDec(line.discountAllocated).times(proportion));
        gross = gross.plus(share.net).plus(discount);
        disc = disc.plus(discount); net = net.plus(share.net);
        if (line.type === 'PACKAGE') comps += Number(share.quantity || line.quantity || 1);
        else direct += Number(line.quantity || 1);
        const key = line.invoice.clientId || line.invoice.clientName?.trim().toLowerCase();
        if (key) clients.add(key);
      }
    }
    for (const event of collectionEvents) {
      const line = event.line;
      if (line.type === 'PRODUCT') continue;
      for (const share of event.staffAllocations.filter(c => c.staffId === st.id && matches(line, c))) {
        const earned = event.commissions.filter(c => c.staffId === st.id && c.componentId === share.componentId)
          .reduce((total, c) => total.plus(c.amount), toDec(0));
        collected = collected.plus(share.net); commission = commission.plus(earned);
        if (toDec(share.staffCommissionRate || 0).gt(0)) commissionEligibleNet = commissionEligibleNet.plus(share.net);
        const collectedDiscount = toDec(line.netSales).gt(0) ? round2(toDec(line.discountAllocated).times(share.net).div(line.netSales)) : toDec(0);
        detailedServices.push({ invoiceId: event.invoice.id, invoiceNumber: event.invoice.invoiceNumber,
          date: event.date, time: event.record.time || '', clientName: event.invoice.clientName,
          itemId: share.serviceId || line.itemId, serviceName: share.serviceName ? share.serviceName + ' (' + line.name + ')' : line.name,
          itemType: line.type === 'PACKAGE' ? 'PACKAGE_COMPONENT' : 'SERVICE',
          quantity: Number(line.quantity || 1),
          cataloguePrice: n(share.net.plus(collectedDiscount)), discountAllocated: n(collectedDiscount), netSales: n(share.net),
          commissionRatePercent: n(share.staffCommissionRate), commissionEarned: n(earned), eventType: event.kind });
      }
    }

    const myStatements = of(statements, st.id);
    const finalized = myStatements.reduce((s, x) => s.plus(x.netPayable), toDec(0));
    const paidCommission = payoutEvents(commissionPayments.filter(p => p.staffId === st.id))
      .filter(p => p.date >= startDate && p.date <= endDate).reduce((total, p) => total.plus(p.signedAmount), toDec(0));
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
      invoicedSales: n(net),
      collectedSales: n(collected),
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
  if (!actor.branchId || staff.branchId !== actor.branchId) throw forbidden('BRANCH_FORBIDDEN', 'Staff reports require the assigned branch.');
  const today = await getBusinessDate();
  const startDate = q.startDate || `${today.slice(0, 7)}-01`;
  const endDate = q.endDate || today;
  return (await computePerformance([staff], startDate, endDate))[0];
};

// ═══ SALES & INVOICES REPORT (Spec §9.2) ═════════════════════════════════════

export { salesInvoicesReport } from './salesCollections.report.js';

// ═══ INCOME & EXPENSE REPORT ══════════════════════════════════════════════════

export const incomeExpenseReport = async (actor, query = {}) => {
  const ctx = await resolveReportContext(actor, query, 'RECOGNITION');
  const dateRange = { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) };
  const utcRange = { gte: ctx.fromDate, lte: ctx.toDate };
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  const [branches, staffMembers, users, invoices, duesPayments, refunds, expenses, payrollRuns, commissionEvents, inventoryLosses, retailCogsAgg, consumableUsageAgg, returnedCogsAgg, supplierPayments, consumptionReversals] = await Promise.all([
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
        payments: { where: { reversedAt: null }, select: { id: true, kind: true, billAmountAllocated: true, receiptNumber: true, paymentAccountName: true, method: true } },
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
              select: { id: true, kind: true, billAmountAllocated: true, createdAt: true },
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
              { finalizedAt: null, generatedAt: utcRange },
              { payslips: { some: { payments: { some: { OR: [{ paidAt: utcRange }, { reversedAt: utcRange }] } } } } },
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
    // 10. Supplier / Vendor Payments (Inventory Cash Outflows)
    prisma.supplierPayment.findMany({
      where: {
        ...branchFilter,
        OR: [
          { paymentDate: dateRange },
          { reversalDate: dateRange },
          { reversedAt: utcRange },
        ],
        ...(actor.role === 'ACCOUNTANT' ? { paidById: actor.id } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    }),
    // 11. Reversals of internal consumption / salon usage
    actor.role === 'ACCOUNTANT' || !prisma.stockMovement?.findMany
      ? Promise.resolve([])
      : prisma.stockMovement.findMany({
          where: {
            createdAt: utcRange,
            movementType: 'POSITIVE_ADJUSTMENT',
            sourceReferenceType: 'STOCK_MOVEMENT_REVERSAL',
            ...branchFilter,
          },
          select: { id: true, totalCost: true, sourceReferenceId: true },
        }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const staffMap = new Map(staffMembers.map((s) => [s.id, `${s.name} (${s.employeeCode})`]));
  const userRoleMap = new Map();
  users.forEach((u) => { if (u.name) userRoleMap.set(u.name.toLowerCase(), u.role); });
  staffMembers.forEach((s) => { if (s.name) userRoleMap.set(s.name.toLowerCase(), 'STAFF'); });

  // Build unified item rows
  const rawRows = [];
  // Tip Management receipts are the source of collected tips, not invoice targets or staff allocations.
  // Key by payment so a tip on the original sale never repeats on later dues collection.
  const tipPaymentIds = [...new Set([
    ...invoices.flatMap(inv => (inv.payments || []).filter(p => p.kind === 'POS').map(p => p.id)),
    ...duesPayments.map(p => p.id),
  ].filter(Boolean))];
  const tipReceipts = tipPaymentIds.length ? await prisma.tipReceipt.findMany({
    where: { ...branchFilter, paymentId: { in: tipPaymentIds }, collectionDate: dateRange },
    select: { paymentId: true, collectedAmount: true },
  }) : [];
  const tipsByPayment = new Map(tipReceipts.map(r => [r.paymentId, toDec(r.collectedAmount)]));

  // Invoices -> Collection-Based Operational Income (Excl. Tax) & Accrual Recognized Sales
  for (const inv of invoices) {
    const net = toDec(inv.netSales);
    const due = toDec(inv.amountDue || 0);
    const posPayments = (inv.payments || []).filter((p) => p.kind === 'POS');
    const advanceAdjustedDec = toDec(inv.advanceAdjusted || 0);
    const posBillSettled = round2(posPayments.reduce((sum, p) => sum.plus(toDec(p.billAmountAllocated)), advanceAdjustedDec));
    const allocation = allocatePaymentToInvoice({ invoice: inv, paymentAmount: posBillSettled, previousBillPaid: 0 });
    const collectedNet = allocation.totalCollectedNet;
    const collectedTax = allocation.totalCollectedTax;
    const tipAmount = posPayments.reduce((sum, p) => sum.plus(tipsByPayment.get(p.id) || 0), toDec(0));

    // Canonical POS Cash Collection: Only new payment received at checkout, excluding previously adjusted advance
    const posNewBillPaid = round2(posPayments.reduce((sum, p) => sum.plus(toDec(p.billAmountAllocated)), toDec(0)));
    const posNewReceipt = posNewBillPaid.plus(tipAmount);

    const totalBill = round2(net.plus(inv.tax || 0));
    const balanceAfterInitial = round2(max0(totalBill.minus(posBillSettled)));
    const firstPosPayment = posPayments[0];

    rawRows.push({
      id: `inv-${inv.id}`,
      invoiceId: inv.id,
      recordType: 'ORIGINAL_INVOICE',
      recordTypeLabel: 'Original Invoice',
      paymentSequence: posBillSettled.gt(0) ? 1 : 0,
      receiptNumber: firstPosPayment?.receiptNumber || null,
      paymentAccountName: firstPosPayment?.paymentAccountName || null,
      balanceAfterPayment: n(balanceAfterInitial),
      invoiceBillTotal: n(totalBill),
      date: ymd(inv.date),
      type: 'INCOME',
      category: 'Sales & Services',
      source: 'POS Invoice',
      reference: inv.invoiceNumber,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.clientName || 'Walk-in',
      branchId: inv.branchId,
      branchName: branchMap.get(inv.branchId) || 'Branch',
      userOrPayee: inv.processedByName || 'Staff',
      description: `Invoice ${inv.invoiceNumber} - ${inv.clientName || 'Walk-in'} (Gross: ${n(toDec(inv.subtotal))}, Disc: ${n(toDec(inv.discount))})`,
      serviceAmount: n(collectedNet),
      serviceCollection: n(collectedNet),
      tax: n(toDec(inv.tax || 0)),
      totalBill: n(totalBill),
      tipAmount: n(tipAmount),
      collectedService: n(collectedNet),
      collectedTax: n(collectedTax),
      advanceAdjusted: n(advanceAdjustedDec),
      totalReceived: n(posNewReceipt),
      remainingDues: n(due),
      income: n(collectedNet),
      recognizedIncome: n(net),
      expense: 0,
      paid: n(posNewReceipt),
      collectionAmount: n(posNewReceipt),
      discount: n(toDec(inv.discount || 0)),
      remaining: n(due),
      paymentMethod: firstPosPayment?.method || inv.paymentMethod || 'CASH',
      status: inv.status,
    });
  }

  // Dues Collections -> Incremental Collection-Based Income (Excl. Tax)
  for (const dp of (duesPayments || [])) {
    if (!dp.invoice) continue;
    const invBill = round2(toDec(dp.invoice.netSales).plus(dp.invoice.tax || 0));
    const allInvPayments = (dp.invoice.payments || []).filter(p => !p.reversedAt).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const posPayments = allInvPayments.filter(p => p.kind === 'POS');
    const hasInitialPayment = posPayments.length > 0 || toDec(dp.invoice.advanceAdjusted || 0).gt(0);
    const earlierPayments = allInvPayments.filter((p) => new Date(p.createdAt) < new Date(dp.createdAt) && p.id !== dp.id);
    const earlierDues = earlierPayments.filter(p => p.kind === 'DUES_COLLECTION');
    const sequenceNum = hasInitialPayment ? 2 + earlierDues.length : 1 + earlierDues.length;
    const prevPaid = earlierPayments.reduce((s, p) => s.plus(toDec(p.billAmountAllocated)), toDec(dp.invoice.advanceAdjusted || 0));
    const alloc = allocatePaymentToInvoice({ invoice: dp.invoice, paymentAmount: toDec(dp.billAmountAllocated), previousBillPaid: prevPaid });
    const collectedNet = alloc.totalCollectedNet;
    const collectedTax = alloc.totalCollectedTax;
    const billAmt = toDec(dp.billAmountAllocated);
    const tipAmount = tipsByPayment.get(dp.id) || toDec(0);
    const grossReceipt = billAmt.plus(tipAmount);
    const totalPaidAfterThis = prevPaid.plus(billAmt);
    const balanceAfterThis = round2(max0(invBill.minus(totalPaidAfterThis)));

    rawRows.push({
      id: `due-${dp.id}`,
      invoiceId: dp.invoice.id,
      recordType: 'SUBSEQUENT_PAYMENT',
      recordTypeLabel: `Payment Receipt #${sequenceNum}`,
      paymentSequence: sequenceNum,
      receiptNumber: dp.receiptNumber || null,
      paymentAccountName: dp.paymentAccountName || null,
      balanceAfterPayment: n(balanceAfterThis),
      invoiceBillTotal: n(invBill),
      date: ymd(dp.date),
      type: 'INCOME',
      category: 'Sales & Services',
      source: 'POS Dues Collection',
      reference: dp.invoice.invoiceNumber,
      invoiceNumber: dp.invoice.invoiceNumber,
      customerName: dp.invoice.clientName || 'Customer',
      branchId: dp.branchId,
      branchName: branchMap.get(dp.branchId) || 'Branch',
      userOrPayee: dp.processedByName || 'Staff',
      description: `Payment Receipt #${sequenceNum} for Invoice ${dp.invoice.invoiceNumber} - ${dp.invoice.clientName || 'Customer'} (Net: ${n(collectedNet)}, Tax: ${n(collectedTax)})`,
      serviceAmount: n(collectedNet),
      serviceCollection: n(collectedNet),
      tax: n(collectedTax),
      totalBill: 0,
      tipAmount: n(tipAmount),
      collectedService: n(collectedNet),
      collectedTax: n(collectedTax),
      totalReceived: n(grossReceipt),
      remainingDues: n(balanceAfterThis),
      income: n(collectedNet),
      recognizedIncome: 0,
      expense: 0,
      paid: n(grossReceipt),
      collectionAmount: n(grossReceipt),
      discount: 0,
      remaining: n(balanceAfterThis),
      paymentMethod: dp.method || 'CASH',
      status: balanceAfterThis.isZero() ? 'PAID' : 'PARTIAL',
    });
  }

  // Refunds -> Recognized Income Reversal (Negative Income) & Actual Outflow Deduction
  for (const ref of refunds) {
    const reversedNet = toDec(ref.netReversed);
    const reversedTax = toDec(ref.taxReversed || 0);
    const actualCashOut = toDec(ref.cashOut || 0);
    const bId = ref.invoice?.branchId || '';
    rawRows.push({
      id: `ref-${ref.id}`,
      invoiceId: ref.invoice?.id,
      date: ymd(ref.refundDate),
      type: 'INCOME',
      category: 'Sales Refund / Reversal',
      source: 'Sales Refund',
      reference: ref.refundNumber,
      invoiceNumber: ref.invoice?.invoiceNumber || ref.refundNumber,
      customerName: 'Client Refund',
      branchId: bId,
      branchName: branchMap.get(bId) || 'Branch',
      userOrPayee: ref.byName || 'Admin',
      description: `Refund for ${ref.invoice?.invoiceNumber || 'Invoice'} (${ref.reason || 'Client Refund'})`,
      serviceAmount: -n(reversedNet),
      tax: -n(reversedTax),
      totalBill: -n(reversedNet.plus(reversedTax)),
      tipAmount: -n(toDec(ref.tipReversed || 0)),
      collectedService: -n(reversedNet),
      collectedTax: -n(reversedTax),
      totalReceived: -n(actualCashOut),
      remainingDues: 0,
      income: -n(reversedNet),
      recognizedIncome: -n(reversedNet),
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
      invoiceNumber: exp.voucherNumber,
      customerName: exp.payee || exp.title || 'Expense Payee',
      branchId: exp.branchId,
      branchName: branchMap.get(exp.branchId) || 'Branch',
      userOrPayee: exp.payee ? (exp.paidByName ? `${exp.payee} (Paid by ${exp.paidByName})` : exp.payee) : (exp.paidByName || 'Staff'),
      description: `${exp.title}${exp.description ? ` — ${exp.description}` : ''}`,
      serviceAmount: amountVal,
      tax: 0,
      totalBill: amountVal,
      collectedService: 0,
      collectedTax: 0,
      totalReceived: isPaid ? -amountVal : 0,
      remainingDues: isPaid ? 0 : amountVal,
      income: 0,
      expense: amountVal,
      paid: isPaid ? amountVal : 0,
      discount: 0,
      remaining: isPaid ? 0 : amountVal,
      paymentMethod: exp.paymentSource === 'CASH_DRAWER' ? 'CASH' : (exp.paymentAccountName || 'ONLINE'),
      status: exp.status,
    });
  }

  // Salary cash rows are actual dated payment events; accrual is recognized once per finalized slip.
  let accruedSalaryExpenses = toDec(0);
  const inRecognitionPeriod = date => date && date >= ctx.fromDate && date <= ctx.toDate;
  for (const run of payrollRuns) {
    if (run.status === 'CANCELLED' || run.status === 'DRAFT') continue;
    for (const p of run.payslips) {
      const snap = typeof p.snapshot === 'string' ? JSON.parse(p.snapshot) : p.snapshot || {};
      const staffLabel = snap.staffName || staffMap.get(p.staffId) || 'Staff';
      const salaryNet = round2(toDec(p.netPayable ?? p.grossPayable ?? 0));
      if (inRecognitionPeriod(run.finalizedAt || run.generatedAt)) {
        accruedSalaryExpenses = accruedSalaryExpenses.plus(recognizedSalaryExpense(p));
      }
      const events = payoutEvents((p.payments || []).filter(pay => ['COMPLETED', 'REVERSED'].includes(pay.status)));
      const paidToDate = events.filter(pay => pay.date <= ctx.toStr).reduce((sum, pay) => sum.plus(pay.signedAmount), toDec(0));
      const status = paidToDate.gte(salaryNet) && salaryNet.gt(0) ? 'PAID' : paidToDate.gt(0) ? 'PARTIALLY_PAID' : 'FINALIZED';
      const base = {
        type: 'SALARY_EXPENSE', category: 'Payroll & Salaries', source: 'Expense - Staff Salary',
        customerName: staffLabel, branchId: run.branchId, branchName: branchMap.get(run.branchId) || 'Branch',
        userOrPayee: staffLabel, description: 'Staff Salary for ' + staffLabel + ' (' + run.month + ')',
        income: 0, collectedService: 0, collectedTax: 0, discount: 0, remaining: 0, status,
      };
      const periodPayments = events.filter(pay => pay.date >= ctx.fromStr && pay.date <= ctx.toStr);
      for (const pay of periodPayments) rawRows.push({
        ...base, id: 'psl-' + p.id + '-' + pay.eventId, date: pay.date,
        reference: pay.paymentNumber || (p.payslipNumber !== 'DRAFT' ? p.payslipNumber : run.payrollNumber),
        expense: n(pay.signedAmount), paid: n(pay.signedAmount), totalReceived: n(pay.signedAmount.negated()),
        paymentMethod: pay.method, status: pay.reversal ? 'REVERSED' : status,
      });
      if (!periodPayments.length && paidToDate.lt(salaryNet) && (query.includeUnpaid === 'true' || query.includeCommission === 'true')) {
        rawRows.push({ ...base, id: 'psl-' + p.id, date: ymd(run.finalizedAt || run.generatedAt),
          reference: p.payslipNumber !== 'DRAFT' ? p.payslipNumber : run.payrollNumber,
          expense: n(salaryNet), paid: 0, totalReceived: 0, paymentMethod: 'PAYROLL_TRANSFER' });
      }
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

  // Standalone Commission Payments (Direct payouts made outside payroll)
  // F09: Excluded for Accountants; confidential HR compensation
  let hasEmittedCommissionPayouts = false;
  if (actor.role !== 'ACCOUNTANT') {
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
        if (standaloneCommPayments.length > 0) {
          hasEmittedCommissionPayouts = true;
          for (const cp of standaloneCommPayments) {
            const amt = n(toDec(cp.amount));
            rawRows.push({
              id: `compay-${cp.id}`,
              date: ymd(cp.paidAt),
              type: 'COMMISSION_EXPENSE',
              category: 'Staff Commission',
              source: 'Expense - Staff Commission',
              reference: cp.paymentNumber,
              invoiceNumber: cp.paymentNumber,
              customerName: cp.staffName,
              branchId: cp.branchId,
              branchName: branchMap.get(cp.branchId) || 'Branch',
              userOrPayee: cp.staffName,
              description: `Commission Payout to ${cp.staffName}`,
              serviceAmount: amt,
              tax: 0,
              totalBill: amt,
              collectedService: 0,
              collectedTax: 0,
              totalReceived: -amt,
              remainingDues: 0,
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
      }
    } catch {}
  }

  // F08: Commission Events -> Staff Commission
  // Prevent double counting: If commission payouts were already emitted, do not emit duplicate paid event rows.
  // When includeCommission is requested, emit accrued (unpaid) commission events as liabilities.
  for (const evt of commissionEvents) {
    const commAmt = toDec(evt.amount);
    const signedAmt = evt.type === 'EARN' ? commAmt : -commAmt;
    const staffLabel = staffMap.get(evt.staffId) || 'Staff';
    const isPaid = evt.consumedByRunId ? paidCommissionRunIds.has(evt.consumedByRunId) : false;
    const amountVal = n(signedAmt);

    // If payouts are already displayed, skip paid events so they are not double-counted
    if (hasEmittedCommissionPayouts && isPaid) {
      continue;
    }

    // If commission is NOT paid yet, only display when includeCommission is requested
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
      invoiceNumber: evt.invoiceNumber || `COM-${evt.id.slice(0, 8)}`,
      customerName: staffLabel,
      branchId: evt.branchId,
      branchName: branchMap.get(evt.branchId) || 'Branch',
      userOrPayee: staffLabel,
      description: `Commission ${evt.type === 'EARN' ? 'Earned' : 'Reversal'} on Invoice ${evt.invoiceNumber || 'N/A'}${evt.rate ? ` (${n(toDec(evt.rate))}% on ${n(toDec(evt.attributedNet || 0))})` : ''} - ${isPaid ? 'Paid to' : 'Payable to'} ${staffLabel}`,
      serviceAmount: amountVal,
      tax: 0,
      totalBill: amountVal,
      collectedService: 0,
      collectedTax: 0,
      totalReceived: isPaid ? -amountVal : 0,
      remainingDues: isPaid ? 0 : amountVal,
      income: 0,
      expense: amountVal,
      paid: isPaid ? amountVal : 0,
      discount: 0,
      remaining: isPaid ? 0 : amountVal,
      paymentMethod: isPaid ? 'PAYROLL_TRANSFER' : 'COMMISSION_ACCRUAL',
      status: isPaid ? 'PAID' : 'ACCRUED',
    });
  }

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

  // 10. Supplier Payments -> Inventory Cash Outflow (Balance Sheet liability settlement / upfront purchases)
  for (const sp of supplierPayments) {
    const spDate = ymd(sp.paymentDate);
    const supplierName = sp.supplier?.name || 'Supplier';
    const amountVal = n(toDec(sp.amount));
    const allocations = Array.isArray(sp.allocations) ? sp.allocations : [];
    const purchaseRef = sp.reference || allocations[0]?.invoiceNumber || '';
    if (spDate && spDate >= ctx.fromStr && spDate <= ctx.toStr) {
      rawRows.push({
        id: `sp-${sp.id}`,
        date: spDate,
        type: 'SUPPLIER_PAYMENT',
        category: 'Supplier/Vendor Payment — Inventory Cash Outflow',
        source: 'Supplier Payment',
        reference: sp.paymentNumber,
        invoiceNumber: sp.paymentNumber,
        customerName: supplierName,
        branchId: sp.branchId,
        branchName: branchMap.get(sp.branchId) || 'Branch',
        userOrPayee: sp.paidByName ? `${supplierName} (Paid by ${sp.paidByName})` : supplierName,
        description: `Supplier payment to ${supplierName} (${sp.paymentNumber}${purchaseRef ? ` · Ref: ${purchaseRef}` : ''}${sp.notes ? ` · ${sp.notes}` : ''})`,
        serviceAmount: 0,
        tax: 0,
        totalBill: amountVal,
        tipAmount: 0,
        collectedService: 0,
        collectedTax: 0,
        totalReceived: -amountVal,
        remainingDues: 0,
        income: 0,
        expense: 0,
        paid: 0,
        cashFlow: -amountVal,
        collectionAmount: 0,
        discount: 0,
        remaining: 0,
        paymentMethod: sp.method === 'CASH' ? 'CASH' : 'ONLINE',
        status: 'POSTED',
      });
    }
    if (sp.reversedAt) {
      const revDate = ymd(sp.reversalDate) || toDateString(sp.reversedAt);
      if (revDate >= ctx.fromStr && revDate <= ctx.toStr) {
        rawRows.push({
          id: `sp-${sp.id}-rev`,
          date: revDate,
          type: 'SUPPLIER_PAYMENT',
          category: 'Supplier/Vendor Payment — Inventory Cash Outflow',
          source: 'Supplier Payment',
          reference: `${sp.paymentNumber}-REV`,
          invoiceNumber: `${sp.paymentNumber}-REV`,
          customerName: supplierName,
          branchId: sp.branchId,
          branchName: branchMap.get(sp.branchId) || 'Branch',
          userOrPayee: sp.reversedByName ? `Reversal: ${supplierName} (By ${sp.reversedByName})` : `Reversal: ${supplierName}`,
          description: `Reversal of supplier payment ${sp.paymentNumber} to ${supplierName}${sp.reversalReason ? ` · Reason: ${sp.reversalReason}` : ''}`,
          serviceAmount: 0,
          tax: 0,
          totalBill: -amountVal,
          tipAmount: 0,
          collectedService: 0,
          collectedTax: 0,
          totalReceived: amountVal,
          remainingDues: 0,
          income: 0,
          expense: 0,
          paid: 0,
          cashFlow: amountVal,
          collectionAmount: 0,
          discount: 0,
          remaining: 0,
          paymentMethod: sp.method === 'CASH' ? 'CASH' : 'ONLINE',
          status: 'REVERSED',
        });
      }
    }
  }

  // Settlement events affect custody and liabilities, never recognized income or expense.
  // Note: Supplier payments are handled directly above from SupplierPayment model; supplier refunds are included here to reduce inventory cash outflow.
  const movementWhere = { ...branchFilter, createdAt: utcRange, sourceModule: { in: ['POS', 'BOOKING', 'INVENTORY'] }, type: { in: ['BOOKING_ADVANCE', 'BOOKING_REFUND', 'SUPPLIER_REFUND'] }, ...(actor.role === 'ACCOUNTANT' ? { userId: actor.id } : {}) };
  const [cashSettlements, onlineSettlements] = await Promise.all([
    prisma.drawerMovement.findMany({ where: movementWhere }),
    prisma.accountMovement.findMany({ where: movementWhere }),
  ]);
  for (const [method, movements] of [['CASH', cashSettlements], ['ONLINE_ACCOUNT', onlineSettlements]]) {
    for (const movement of movements) {
      if (movement.type === 'SUPPLIER_REFUND') {
        const amt = n(toDec(movement.amount));
        rawRows.push({
          id: `sr-${movement.id}`,
          date: toDateString(movement.createdAt),
          type: 'SUPPLIER_PAYMENT',
          category: 'Supplier/Vendor Payment — Inventory Cash Outflow',
          source: 'Supplier Refund',
          reference: movement.reference,
          invoiceNumber: movement.reference,
          customerName: movement.description?.replace(/^Supplier refund (?:from\s+)?/, '').split(' · ')[0] || 'Supplier',
          branchId: movement.branchId,
          branchName: branchMap.get(movement.branchId) || 'Branch',
          userOrPayee: movement.userName ? `Refund: ${movement.userName}` : 'Supplier Refund',
          description: movement.description || `Supplier refund received (${movement.reference})`,
          serviceAmount: 0,
          tax: 0,
          totalBill: -amt,
          tipAmount: 0,
          collectedService: 0,
          collectedTax: 0,
          totalReceived: amt,
          remainingDues: 0,
          income: 0,
          expense: 0,
          paid: 0,
          cashFlow: amt,
          collectionAmount: 0,
          discount: 0,
          remaining: 0,
          paymentMethod: method === 'CASH' ? 'CASH' : 'ONLINE',
          status: 'POSTED',
        });
      } else {
        rawRows.push({
          id: movement.id, date: toDateString(movement.createdAt), type: 'SETTLEMENT',
          category: movement.sourceModule === 'BOOKING' ? (movement.type === 'BOOKING_REFUND' ? 'Booking Advance Refunds' : 'Booking Advance Collections') : movement.sourceModule === 'POS' ? 'Client Collections' : 'Supplier Payments',
          recordTypeLabel: movement.sourceModule === 'BOOKING' ? (movement.type === 'BOOKING_REFUND' ? 'Booking Advance Refund' : 'Booking Advance Collection') : undefined,
          source: movement.sourceModule, reference: movement.reference, branchId: movement.branchId, branchName: branchMap.get(movement.branchId),
          userOrPayee: movement.userName, description: movement.description, income: 0, expense: 0, paid: 0, discount: 0, remaining: 0,
          cashFlow: n(toDec(movement.amount).times(movement.direction === 'IN' ? 1 : -1)), paymentMethod: method, paymentEventType: movement.type, status: 'POSTED',
        });
      }
    }
  }
  const loanMovements = ['ADMIN', 'SUPER_ADMIN'].includes(actor.role)
    ? await loadStaffLoanMovements(branchFilter, ctx.fromDate, ctx.toDate) : [];
  for (const m of loanMovements) rawRows.push({
    id: m.id, date: m.date, type: 'SETTLEMENT', category: STAFF_LOAN_CATEGORY,
    source: 'Staff Loan', reference: m.reference, branchId: m.branchId, branchName: branchMap.get(m.branchId),
    userOrPayee: m.userName, description: m.description, income: 0, expense: 0, paid: 0, discount: 0, remaining: 0,
    cashFlow: -m.signedOutflow, paymentMethod: m.paymentSource === 'CASH_DRAWER' ? 'CASH' : 'ONLINE_ACCOUNT',
    paymentEventType: m.type, status: m.direction === 'IN' ? 'REVERSED' : 'POSTED',
  });
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

  filteredRows.sort((a, b) => {
    const dDiff = (b.date || '').localeCompare(a.date || '');
    if (dDiff !== 0) return dDiff;
    return (b.reference || '').localeCompare(a.reference || '');
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
    if (r.remaining && isIncome) {
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

  let consumptionReversalsCost = toDec(0);
  if (consumptionReversals && consumptionReversals.length > 0) {
    const origMovements = await prisma.stockMovement.findMany({
      where: {
        id: { in: consumptionReversals.map((m) => m.sourceReferenceId).filter(Boolean) },
        movementType: { in: ['SALON_CONSUMPTION_OUT', 'INTERNAL_USE_OUT'] },
      },
      select: { id: true },
    });
    const reversedIds = new Set(origMovements.map((m) => m.id));
    for (const rev of consumptionReversals) {
      if (reversedIds.has(rev.sourceReferenceId)) {
        consumptionReversalsCost = consumptionReversalsCost.plus(toDec(rev.totalCost));
      }
    }
  }

  const consumableUsage = max0(toDec(consumableUsageAgg?._sum?.totalCost || 0).minus(consumptionReversalsCost));
  const totalCogs = round2(retailCogs.plus(consumableUsage));
  const grossContribution = round2(totalIncome.minus(totalCogs));
  const netOperatingPosition = round2(grossContribution.minus(totalOperatingExpenses));

  const settlementCashFlow = filteredRows.reduce((sum, row) => sum.plus(row.cashFlow || 0), toDec(0));
  const staffLoanCashOutflow = filteredRows.filter(r => r.source === 'Staff Loan')
    .reduce((sum, row) => sum.minus(row.cashFlow || 0), toDec(0));
  const supplierCashOutflow = filteredRows.filter(r => r.type === 'SUPPLIER_PAYMENT')
    .reduce((sum, row) => sum.minus(row.cashFlow || 0), toDec(0));
  // Non-customer settlements and supplier inventory outflows move cash without becoming operating expenses.
  const nonOperatingCashOutflows = filteredRows.filter(r => (r.type === 'SETTLEMENT' && !['POS', 'BOOKING'].includes(r.source)) || r.type === 'SUPPLIER_PAYMENT')
    .reduce((sum, row) => sum.minus(row.cashFlow || 0), toDec(0));
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

  // Accounting reference is scoped to branch/date, independent of cash table filters.
  const accruedCommission = actor.role === 'ACCOUNTANT' ? toDec(0) : await accruedCommissionForPeriod(branchFilter, ctx.fromStr, ctx.toStr);
  const reportedExpenseRecognition = expenses.filter(e => e.status !== 'DRAFT').reduce((sum, e) => sum.plus(toDec(e.amount).times(e.isReversalRecord ? -1 : 1)), toDec(0))
    .plus(accruedSalaryExpenses).plus(accruedCommission)
    .plus(inventoryLosses.reduce((sum, m) => sum.plus(m.totalCost || 0), toDec(0)));
  const uniqueInvoiceBills = new Map(filteredRows.filter(r => ['POS Invoice', 'POS Dues Collection'].includes(r.source))
    .map(r => [r.invoiceId || r.invoiceNumber || r.reference, toDec(r.invoiceBillTotal ?? r.totalBill ?? 0)]));
  const customerInvoiceTotal = [...uniqueInvoiceBills.values()].reduce((sum, amount) => sum.plus(amount), toDec(0));

  const invoiceContext = await loadInvoicePresentation({ ...branchFilter,
    ...(actor.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {}) },
    [...new Set(filteredRows.filter(r => r.type === 'INCOME').map(r => r.invoiceId).filter(Boolean))], ctx.toStr);
  const displayRows = groupLedgerInvoices(filteredRows, invoiceContext);
  const totalOutstandingDues = displayRows
    .filter(r => r.remainingDues !== null && r.remainingDues !== undefined)
    .reduce((sum, r) => sum.plus(toDec(r.remainingDues)), toDec(0));

  const kpis = {
    ...(['ADMIN', 'SUPER_ADMIN'].includes(actor.role)
      ? { staffLoanReceivable: await currentStaffLoanReceivable(branchFilter) } : {}),
    staffLoanCashOutflow: n(staffLoanCashOutflow),
    supplierPayments: n(supplierCashOutflow),
    supplierCashOutflow: n(supplierCashOutflow),
    totalCollectedIncome: n(totalIncome),
    totalRecognizedIncome: n(totalRecognizedIncome),
    totalCollectedTax: n(totalCollectedTax),
    totalCollections: n(totalCollections),
    totalOutstandingDues: n(totalOutstandingDues),
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
    customerInvoiceTotal: n(customerInvoiceTotal),
    reportedExpenseRecognition: n(reportedExpenseRecognition),
    accruedSalaryExpenses: n(accruedSalaryExpenses),
    customerCollections: n(totalCollections),
    staffLoanCashOutflow: n(staffLoanCashOutflow),
    supplierPayments: n(supplierCashOutflow),
    supplierCashOutflow: n(supplierCashOutflow),
    nonOperatingCashOutflows: n(nonOperatingCashOutflows),
    netCashMovement: n(totalPaid),
    tipAmount: n(filteredRows.reduce((sum, row) => sum.plus(row.tipAmount || 0), toDec(0))),
    income: n(totalIncome),
    collectedIncome: n(totalIncome),
    recognizedIncome: n(totalRecognizedIncome),
    collectedTax: n(totalCollectedTax),
    tax: n(totalCollectedTax),
    cogs: n(totalCogs),
    grossContribution: n(grossContribution),
    expense: n(totalOperatingExpenses),
    paid: n(totalPaid),
    collections: n(totalCollections),
    discount: n(totalDiscount),
    remaining: n(totalOutstandingDues),
    totalOutstandingDues: n(totalOutstandingDues),
    net: n(netOperatingPosition),
    revenueReversals: n(totalRevenueReversals),
    refundsPaid: n(totalRefundsPaid),
  };

  return formatReportResponse({ ...ctx.meta, displayBasis: 'Chronological transaction history showing actual collections, expenses, payment receipts, and remaining customer dues.' }, {
    kpis,
    rows: filteredRows,
    displayRows,
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

export const computePeriodMetrics = async (branchId, fromStr, toStr, fromDate, toDate) => {
  const branchFilter = branchId ? { branchId } : {};
  const dateRange = { gte: dateOnly(fromStr), lte: dateOnly(toStr) };
  const utcRange = { gte: fromDate, lte: toDate };

  const [invoices, duesPayments, refunds, movements, expenses, payrollRuns, salaryPaymentsInPeriod, commissionExpenses, commissionPayments] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        date: dateRange,
        ...branchFilter,
      },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        subtotal: true,
        discount: true,
        netSales: true,
        tax: true,
        total: true,
        amountPaid: true,
        amountDue: true,
        advanceAdjusted: true,
        lines: {
          select: {
            id: true,
            type: true,
            unitPrice: true,
            quantity: true,
            discountAllocated: true,
            netSales: true,
            tax: true,
            staffId: true,
            staffName: true,
            staffCommissionRate: true,
            components: true,
          },
        },
        payments: {
          where: { reversedAt: null },
          select: { id: true, kind: true, billAmountAllocated: true, createdAt: true },
        },
      },
    }),
    prisma.invoicePayment.findMany({
      where: {
        kind: 'DUES_COLLECTION',
        reversedAt: null,
        date: dateRange,
        invoice: branchFilter,
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            date: true,
            branchId: true,
            subtotal: true,
            discount: true,
            netSales: true,
            tax: true,
            total: true,
            advanceAdjusted: true,
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
            payments: {
              where: { reversedAt: null },
              orderBy: { createdAt: 'asc' },
              select: { id: true, kind: true, billAmountAllocated: true, createdAt: true },
            },
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
        taxReversed: true,
        cashOut: true,
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
            'POSITIVE_ADJUSTMENT',
          ],
        },
      },
      select: {
        id: true,
        movementType: true,
        totalCost: true,
        sourceReferenceType: true,
        sourceReferenceId: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        expenseDate: dateRange,
        status: { not: 'DRAFT' },
        ...branchFilter,
      },
      select: {
        category: true,
        amount: true,
        status: true,
        isReversalRecord: true,
      },
    }),
    prisma.payrollRun.findMany({
      where: {
        status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'PAID'] },
        OR: [
          { finalizedAt: utcRange },
          { finalizedAt: null, generatedAt: utcRange },
        ],
        ...branchFilter,
      },
      include: {
        payslips: {
          select: {
            netPayable: true,
            grossPayable: true,
            snapshot: true,
            payments: {
              where: { status: { not: 'REVERSED' } },
              select: { amount: true, paidAt: true },
            },
          },
        },
      },
    }),
    prisma.payrollPayment?.findMany
      ? prisma.payrollPayment.findMany({
          where: {
            status: 'COMPLETED',
            paidAt: utcRange,
            ...branchFilter,
          },
          select: { amount: true },
        })
      : Promise.resolve([]),
    accruedCommissionForPeriod(branchFilter, fromStr, toStr),
    prisma.commissionPayment.findMany({ where: { ...branchFilter,
      status: { in: ['COMPLETED', 'REVERSED'] }, paidAt: { lte: toDate } },
      select: { id: true, amount: true, paidAt: true, reversedAt: true } }),
  ]);

  // 1. Accrual Invoiced Turnover by streams
  let serviceSales = toDec(0);
  let packageSales = toDec(0);
  let productSales = toDec(0);
  let outstandingDues = toDec(0);

  // 1b. Collection-Based Turnover by streams
  let collectedServiceSales = toDec(0);
  let collectedPackageSales = toDec(0);
  let collectedProductSales = toDec(0);
  let totalCollectedTax = toDec(0);
  let totalEarnedCommissionOnCollections = toDec(0);
  let totalPOSCollections = toDec(0);

  for (const inv of invoices) {
    outstandingDues = outstandingDues.plus(toDec(inv.amountDue || 0));

    // Accrual line breakdown
    for (const l of inv.lines) {
      const lineNet = toDec(l.netSales);
      if (l.type === 'SERVICE' || l.type === 'CUSTOM_SERVICE') serviceSales = serviceSales.plus(lineNet);
      else if (l.type === 'PACKAGE') packageSales = packageSales.plus(lineNet);
      else if (l.type === 'PRODUCT') productSales = productSales.plus(lineNet);
      else serviceSales = serviceSales.plus(lineNet);
    }

    // Collection line allocation
    const posPayments = (inv.payments || []).filter((p) => p.kind === 'POS');
    const posBillCollected = round2(posPayments.reduce((sum, p) => sum.plus(toDec(p.billAmountAllocated)), toDec(inv.advanceAdjusted || 0)));
    const alloc = allocatePaymentToInvoice({ invoice: inv, paymentAmount: posBillCollected, previousBillPaid: 0 });

    for (const la of alloc.lineAllocations) {
      const lNet = la.collectedNet;
      if (la.line.type === 'SERVICE' || la.line.type === 'CUSTOM_SERVICE') collectedServiceSales = collectedServiceSales.plus(lNet);
      else if (la.line.type === 'PACKAGE') collectedPackageSales = collectedPackageSales.plus(lNet);
      else if (la.line.type === 'PRODUCT') collectedProductSales = collectedProductSales.plus(lNet);
      else collectedServiceSales = collectedServiceSales.plus(lNet);
    }
    totalCollectedTax = totalCollectedTax.plus(alloc.totalCollectedTax);
    totalEarnedCommissionOnCollections = totalEarnedCommissionOnCollections.plus(alloc.totalEarnedCommission);
    totalPOSCollections = totalPOSCollections.plus(posBillCollected);
  }

  // Dues Collections allocation into streams
  let duesCollectionsNet = toDec(0);
  let totalDuesCollections = toDec(0);

  for (const dp of duesPayments) {
    if (!dp.invoice) continue;
    const earlierPayments = (dp.invoice.payments || []).filter((p) => p.createdAt < dp.createdAt && p.id !== dp.id);
    const prevPaid = earlierPayments.reduce((s, p) => s.plus(toDec(p.billAmountAllocated)), toDec(dp.invoice.advanceAdjusted || 0));
    const alloc = allocatePaymentToInvoice({ invoice: dp.invoice, paymentAmount: toDec(dp.billAmountAllocated), previousBillPaid: prevPaid });

    duesCollectionsNet = duesCollectionsNet.plus(alloc.totalCollectedNet);
    for (const la of alloc.lineAllocations) {
      const lNet = la.collectedNet;
      if (la.line.type === 'SERVICE' || la.line.type === 'CUSTOM_SERVICE') collectedServiceSales = collectedServiceSales.plus(lNet);
      else if (la.line.type === 'PACKAGE') collectedPackageSales = collectedPackageSales.plus(lNet);
      else if (la.line.type === 'PRODUCT') collectedProductSales = collectedProductSales.plus(lNet);
      else collectedServiceSales = collectedServiceSales.plus(lNet);
    }
    totalCollectedTax = totalCollectedTax.plus(alloc.totalCollectedTax);
    totalEarnedCommissionOnCollections = totalEarnedCommissionOnCollections.plus(alloc.totalEarnedCommission);
    totalDuesCollections = totalDuesCollections.plus(toDec(dp.billAmountAllocated));
  }

  // Refunds calculations
  let totalRefunds = toDec(0);
  let totalRefundsTax = toDec(0);
  let totalRefundsCashOut = toDec(0);
  for (const r of refunds) {
    totalRefunds = totalRefunds.plus(toDec(r.netReversed));
    totalRefundsTax = totalRefundsTax.plus(toDec(r.taxReversed || 0));
    totalRefundsCashOut = totalRefundsCashOut.plus(toDec(r.cashOut || 0));
  }

  // Accrual net revenue
  const grossSales = serviceSales.plus(packageSales).plus(productSales);
  const totalNetSales = grossSales.minus(totalRefunds);

  // Collection net revenue
  const totalGrossCollections = totalPOSCollections.plus(totalDuesCollections).minus(totalRefundsCashOut);
  const finalCollectedTax = totalCollectedTax.minus(totalRefundsTax);
  const collectedGrossSales = collectedServiceSales.plus(collectedPackageSales).plus(collectedProductSales);
  const totalCollectedRevenue = collectedGrossSales.minus(totalRefundsCashOut);

  // 2. Direct Material Costs (COGS & Consumables)
  let productCogs = toDec(0);
  let materialConsumption = toDec(0);
  let inventoryLoss = toDec(0);

  const reversalMoves = movements.filter((m) => m.movementType === 'POSITIVE_ADJUSTMENT' && m.sourceReferenceType === 'STOCK_MOVEMENT_REVERSAL' && m.sourceReferenceId);
  const origMoves = reversalMoves.length > 0 ? await prisma.stockMovement.findMany({
    where: { id: { in: reversalMoves.map((m) => m.sourceReferenceId).filter(Boolean) } },
    select: { id: true, movementType: true },
  }) : [];
  const origTypeMap = new Map(origMoves.map((o) => [o.id, o.movementType]));

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
    } else if (m.movementType === 'POSITIVE_ADJUSTMENT' && m.sourceReferenceType === 'STOCK_MOVEMENT_REVERSAL') {
      const origType = origTypeMap.get(m.sourceReferenceId);
      if (origType === 'SALON_CONSUMPTION_OUT' || origType === 'INTERNAL_USE_OUT') {
        materialConsumption = materialConsumption.minus(cost);
      } else if (origType === 'EXPIRED_OUT' || origType === 'DAMAGED_OUT' || origType === 'NEGATIVE_ADJUSTMENT') {
        inventoryLoss = inventoryLoss.minus(cost);
      }
    }
  }
  materialConsumption = max0(materialConsumption);
  inventoryLoss = max0(inventoryLoss);

  const totalCostOfSales = productCogs.plus(materialConsumption);

  // Accrual Gross Contribution
  const grossContribution = totalNetSales.minus(totalCostOfSales);
  const grossMarginPercent = totalNetSales.greaterThan(0)
    ? round2(grossContribution.dividedBy(totalNetSales).times(100)).toNumber()
    : 0;

  // Collection Gross Contribution
  const collectionGrossContribution = totalCollectedRevenue.minus(totalCostOfSales);
  const collectionGrossMarginPercent = totalCollectedRevenue.greaterThan(0)
    ? round2(collectionGrossContribution.dividedBy(totalCollectedRevenue).times(100)).toNumber()
    : 0;

  // 3. Operating Overheads
  let directExpenses = toDec(0);
  let paidDirectExpenses = toDec(0);
  const expensesByCategory = new Map();
  const paidExpensesByCategory = new Map();

  for (const e of expenses) {
    const amt = toDec(e.amount);
    const signed = e.isReversalRecord ? amt.negated() : amt;
    directExpenses = directExpenses.plus(signed);

    const cat = e.category || 'General Operational';
    const curr = expensesByCategory.get(cat) || toDec(0);
    expensesByCategory.set(cat, curr.plus(signed));

    if (e.status !== 'PENDING' && e.status !== 'ACCRUED') {
      paidDirectExpenses = paidDirectExpenses.plus(signed);
      const paidCurr = paidExpensesByCategory.get(cat) || toDec(0);
      paidExpensesByCategory.set(cat, paidCurr.plus(signed));
    }
  }

  // F10 & F11: Accrual salary expense recognizes earned wages without loan recovery distortion.
  // Cash paid salaries strictly recognize payments made during the selected period.
  let salaryExpenses = toDec(0);
  for (const run of payrollRuns) {
    for (const p of run.payslips) {
      salaryExpenses = salaryExpenses.plus(recognizedSalaryExpense(p));
    }
  }

  let paidSalaryExpenses = toDec(0);
  if (salaryPaymentsInPeriod && salaryPaymentsInPeriod.length > 0) {
    for (const pay of salaryPaymentsInPeriod) {
      paidSalaryExpenses = paidSalaryExpenses.plus(toDec(pay.amount));
    }
  } else {
    for (const run of payrollRuns) {
      for (const p of run.payslips) {
        const activePayments = (p.payments || []).filter((pay) => pay.paidAt >= fromDate && pay.paidAt <= toDate);
        if (activePayments.length > 0) {
          paidSalaryExpenses = paidSalaryExpenses.plus(activePayments.reduce((acc, pay) => acc.plus(toDec(pay.amount)), toDec(0)));
        }
      }
    }
  }

  // Both standalone and payroll-linked commission payouts are counted once by payment ID.
  const paidCommissionExpenses = payoutEvents(commissionPayments)
    .filter(payment => payment.date >= fromStr && payment.date <= toStr)
    .reduce((sum, payment) => sum.plus(payment.signedAmount), toDec(0));

  // Accrual Operating Overheads
  const totalOperatingExpenses = directExpenses
    .plus(salaryExpenses)
    .plus(commissionExpenses)
    .plus(inventoryLoss);

  const netOperatingProfit = grossContribution.minus(totalOperatingExpenses);
  const operatingMarginPercent = !totalNetSales.isZero()
    ? round2(netOperatingProfit.dividedBy(totalNetSales.abs()).times(100)).toNumber()
    : 0;

  // Collection Operating Overheads & Cash Surplus
  const totalPaidOperatingExpenses = paidDirectExpenses
    .plus(paidSalaryExpenses)
    .plus(paidCommissionExpenses);

  const collectionCashSurplus = totalCollectedRevenue.minus(totalPaidOperatingExpenses);
  const collectionMarginPercent = !totalCollectedRevenue.isZero()
    ? round2(collectionCashSurplus.dividedBy(totalCollectedRevenue.abs()).times(100)).toNumber()
    : 0;

  const unpaidCommissionLiability = max0(totalEarnedCommissionOnCollections.minus(paidCommissionExpenses));

  return {
    // Accrual Metrics
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
    outstandingDues: n(outstandingDues),
    expensesByCategory: Object.fromEntries(
      [...expensesByCategory.entries()].map(([k, v]) => [k, n(v)])
    ),

    // Collection Metrics
    collectedServiceSales: n(collectedServiceSales),
    collectedPackageSales: n(collectedPackageSales),
    collectedProductSales: n(collectedProductSales),
    duesCollectionsNet: n(duesCollectionsNet),
    totalCollectedTax: n(finalCollectedTax),
    totalGrossCollections: n(totalGrossCollections),
    totalCollectedRevenue: n(totalCollectedRevenue),
    collectionGrossContribution: n(collectionGrossContribution),
    collectionGrossMarginPercent,
    paidDirectExpenses: n(paidDirectExpenses),
    paidSalaryExpenses: n(paidSalaryExpenses),
    paidCommissionExpenses: n(paidCommissionExpenses),
    totalPaidOperatingExpenses: n(totalPaidOperatingExpenses),
    collectionCashSurplus: n(collectionCashSurplus),
    collectionMarginPercent,
    collectionEarnedCommission: n(totalEarnedCommissionOnCollections),
    unpaidCommissionLiability: n(unpaidCommissionLiability),
    paidExpensesByCategory: Object.fromEntries(
      [...paidExpensesByCategory.entries()].map(([k, v]) => [k, n(v)])
    ),
  };
};

export const computeCustomerAdvanceMovements = async (branchId, fromStr, toStr) => {
  const branchFilter = branchId && branchId !== 'ALL' ? { branchId } : {};
  const fromDateOnly = dateOnly(fromStr);
  const toDateOnly = dateOnly(toStr);

  // 1. Historical opening balance prior to fromStr
  const [priorReceivedAgg, priorRefundsAgg, priorAppliedAgg] = await Promise.all([
    prisma.bookingPayment.aggregate({
      where: {
        ...branchFilter,
        isRefund: false,
        date: { lt: fromDateOnly },
      },
      _sum: { amount: true },
    }),
    prisma.bookingPayment.aggregate({
      where: {
        ...branchFilter,
        isRefund: true,
        date: { lt: fromDateOnly },
      },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: {
        ...branchFilter,
        advanceAdjusted: { gt: 0 },
        lifecycle: { not: 'VOIDED' },
        date: { lt: fromDateOnly },
      },
      _sum: { advanceAdjusted: true },
    }),
  ]);

  const priorRec = toDec(priorReceivedAgg._sum.amount ?? 0);
  const priorRef = toDec(priorRefundsAgg._sum.amount ?? 0);
  const priorApp = toDec(priorAppliedAgg._sum.advanceAdjusted ?? 0);
  const openingBalance = max0(priorRec.minus(priorRef).minus(priorApp)).toNumber();

  // 2. In-period transactions
  const [periodPayments, periodInvoices] = await Promise.all([
    prisma.bookingPayment.findMany({
      where: {
        ...branchFilter,
        date: {
          gte: fromDateOnly,
          lte: toDateOnly,
        },
      },
      include: {
        booking: {
          select: { id: true, bookingNumber: true, clientName: true, clientPhone: true },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.invoice.findMany({
      where: {
        ...branchFilter,
        advanceAdjusted: { gt: 0 },
        lifecycle: { not: 'VOIDED' },
        date: {
          gte: fromDateOnly,
          lte: toDateOnly,
        },
      },
      include: {
        booking: {
          select: { id: true, bookingNumber: true, clientName: true },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  let advancesReceivedDec = toDec(0);
  let advanceRefundsDec = toDec(0);
  const paymentMovements = [];

  for (const bp of periodPayments) {
    const amtDec = toDec(bp.amount);
    if (bp.isRefund) {
      advanceRefundsDec = advanceRefundsDec.plus(amtDec);
      paymentMovements.push({
        id: `m-bp-${bp.id}`,
        date: ymd(bp.date),
        type: 'ADVANCE_REFUND',
        typeLabel: 'Advance Refund',
        direction: 'DEBIT',
        receiptNumber: bp.receiptNumber,
        bookingNumber: bp.booking?.bookingNumber || '—',
        clientName: bp.booking?.clientName || 'Customer',
        paymentMethod: bp.method || 'CASH',
        paymentAccountName: bp.paymentAccountName || (bp.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
        amount: round2(amtDec).toNumber(),
        processedByName: bp.processedByName || 'System',
        description: `Customer advance refund (${bp.booking?.bookingNumber || 'Booking'})`,
        createdAt: bp.createdAt,
      });
    } else {
      advancesReceivedDec = advancesReceivedDec.plus(amtDec);
      paymentMovements.push({
        id: `m-bp-${bp.id}`,
        date: ymd(bp.date),
        type: 'ADVANCE_RECEIVED',
        typeLabel: 'Advance Received',
        direction: 'CREDIT',
        receiptNumber: bp.receiptNumber,
        bookingNumber: bp.booking?.bookingNumber || '—',
        clientName: bp.booking?.clientName || 'Customer',
        paymentMethod: bp.method || 'CASH',
        paymentAccountName: bp.paymentAccountName || (bp.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
        amount: round2(amtDec).toNumber(),
        processedByName: bp.processedByName || 'System',
        description: `Customer advance deposit (${bp.booking?.bookingNumber || 'Booking'})`,
        createdAt: bp.createdAt,
      });
    }
  }

  let advancesAppliedDec = toDec(0);
  const appliedMovements = [];

  for (const inv of periodInvoices) {
    const adjDec = toDec(inv.advanceAdjusted);
    advancesAppliedDec = advancesAppliedDec.plus(adjDec);
    appliedMovements.push({
      id: `m-inv-${inv.id}`,
      date: ymd(inv.date),
      type: 'ADVANCE_APPLIED',
      typeLabel: 'Advance Applied to Invoice',
      direction: 'DEBIT',
      receiptNumber: inv.invoiceNumber,
      bookingNumber: inv.booking?.bookingNumber || '—',
      clientName: inv.clientName || 'Customer',
      paymentMethod: 'ADJUSTMENT',
      paymentAccountName: 'Customer Deposit Liability',
      amount: round2(adjDec).toNumber(),
      processedByName: inv.processedByName || 'System',
      description: `Advance applied to checkout invoice ${inv.invoiceNumber}`,
      createdAt: inv.createdAt,
    });
  }

  const advancesReceived = round2(advancesReceivedDec).toNumber();
  const advanceRefunds = round2(advanceRefundsDec).toNumber();
  const advancesApplied = round2(advancesAppliedDec).toNumber();

  const closingBalanceDec = max0(
    toDec(openingBalance).plus(advancesReceivedDec).minus(advanceRefundsDec).minus(advancesAppliedDec)
  );
  const closingBalance = round2(closingBalanceDec).toNumber();

  const movements = [...paymentMovements, ...appliedMovements].sort((a, b) => {
    const dDiff = b.date.localeCompare(a.date);
    if (dDiff !== 0) return dDiff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    openingBalance,
    advancesReceived,
    advanceRefunds,
    advancesApplied,
    closingBalance,
    movements,
  };
};

export const operatingProfitReport = async (actor, query = {}) => {
  denyNonAdmins(actor, 'operating profit reports');
  const ctx = await resolveReportContext(actor, query, 'RECOGNITION');
  const prior = resolvePriorPeriodDates(ctx.fromStr, ctx.toStr);

  const [currentMetrics, priorMetrics, customerAdvances] = await Promise.all([
    computePeriodMetrics(ctx.branchId, ctx.fromStr, ctx.toStr, ctx.fromDate, ctx.toDate),
    computePeriodMetrics(ctx.branchId, prior.priorFromStr, prior.priorToStr, prior.priorFromDate, prior.priorToDate),
    computeCustomerAdvanceMovements(ctx.branchId, ctx.fromStr, ctx.toStr),
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
    { id: 'exp-comm', name: 'Full Completed-Service Commission (Accrual)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.commissionExpenses, percentOfRevenue: calcPct(currentMetrics.commissionExpenses), priorAmount: priorMetrics.commissionExpenses, growthPercent: calcGrowth(currentMetrics.commissionExpenses, priorMetrics.commissionExpenses) },
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
      accountName: 'Full Completed-Service Commission',
      classification: 'OPERATING_EXPENSE',
      department: 'Human Resources / Commission',
      currentAmount: currentMetrics.commissionExpenses,
      percentOfRevenue: calcPct(currentMetrics.commissionExpenses),
      priorAmount: priorMetrics.commissionExpenses,
      varianceAmount: currentMetrics.commissionExpenses - priorMetrics.commissionExpenses,
      growthPercent: calcGrowth(currentMetrics.commissionExpenses, priorMetrics.commissionExpenses),
      notes: 'Full commission from historical invoice service/package snapshots, recognized on invoice date; dated credits reverse it. Customer receipts and payouts do not recognize this expense again.',
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

  const accrualTotals = {
    revenue: currentMetrics.totalNetSales,
    costOfSales: currentMetrics.totalCostOfSales,
    grossMargin: currentMetrics.grossContribution,
    operatingExpenses: currentMetrics.totalOperatingExpenses,
    netProfit: currentMetrics.netOperatingProfit,
    outstandingDues: currentMetrics.outstandingDues,
  };

  const accrualViewData = {
    kpis,
    statementRows,
    rows: detailedRows,
    totals: accrualTotals,
    customerAdvances,
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // VIEW 2: COLLECTION-BASED PERFORMANCE
  // ══════════════════════════════════════════════════════════════════════════════
  const colRev = currentMetrics.totalCollectedRevenue;
  const calcColPct = (amt) => (colRev > 0 ? round2(toDec(amt).dividedBy(colRev).times(100)).toNumber() : 0);
  const calcColGrowth = (cur, pri) => {
    if (!pri || pri === 0) return null;
    return round2(toDec(cur - pri).dividedBy(Math.abs(pri)).times(100)).toNumber();
  };

  const collectionKpis = {
    totalCollectedRevenue: currentMetrics.totalCollectedRevenue,
    collectedServiceSales: currentMetrics.collectedServiceSales,
    collectedPackageSales: currentMetrics.collectedPackageSales,
    collectedProductSales: currentMetrics.collectedProductSales,
    duesCollectionsNet: currentMetrics.duesCollectionsNet,
    totalCollectedTax: currentMetrics.totalCollectedTax,
    totalGrossCollections: currentMetrics.totalGrossCollections,
    totalCostOfSales: currentMetrics.totalCostOfSales,
    productCogs: currentMetrics.productCogs,
    materialConsumption: currentMetrics.materialConsumption,
    collectionGrossContribution: currentMetrics.collectionGrossContribution,
    collectionGrossMarginPercent: currentMetrics.collectionGrossMarginPercent,
    totalPaidOperatingExpenses: currentMetrics.totalPaidOperatingExpenses,
    paidDirectExpenses: currentMetrics.paidDirectExpenses,
    paidSalaryExpenses: currentMetrics.paidSalaryExpenses,
    paidCommissionExpenses: currentMetrics.paidCommissionExpenses,
    inventoryLoss: currentMetrics.inventoryLoss,
    collectionCashSurplus: currentMetrics.collectionCashSurplus,
    collectionMarginPercent: currentMetrics.collectionMarginPercent,
    collectionEarnedCommission: currentMetrics.collectionEarnedCommission,
    unpaidCommissionLiability: currentMetrics.unpaidCommissionLiability,
    outstandingDues: currentMetrics.outstandingDues,
    // Comparisons
    priorCollectedRevenue: priorMetrics.totalCollectedRevenue,
    priorGrossContribution: priorMetrics.collectionGrossContribution,
    priorCashSurplus: priorMetrics.collectionCashSurplus,
    revenueGrowthPercent: calcColGrowth(currentMetrics.totalCollectedRevenue, priorMetrics.totalCollectedRevenue),
    profitGrowthPercent: calcColGrowth(currentMetrics.collectionCashSurplus, priorMetrics.collectionCashSurplus),
  };

  const collectionStatementRows = [
    // ── SECTION 1: COLLECTION-BASED OPERATING TURNOVER (EXCL. TAX) ──
    { id: 'col-sec-rev', name: '1. COLLECTION-BASED OPERATING TURNOVER (EXCL. TAX)', section: 'REVENUE', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'col-rev-service', name: 'Collected Service Sales (Excl. Tax)', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.collectedServiceSales, percentOfRevenue: calcColPct(currentMetrics.collectedServiceSales), priorAmount: priorMetrics.collectedServiceSales, growthPercent: calcColGrowth(currentMetrics.collectedServiceSales, priorMetrics.collectedServiceSales) },
    { id: 'col-rev-package', name: 'Collected Package Sales (Excl. Tax)', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.collectedPackageSales, percentOfRevenue: calcColPct(currentMetrics.collectedPackageSales), priorAmount: priorMetrics.collectedPackageSales, growthPercent: calcColGrowth(currentMetrics.collectedPackageSales, priorMetrics.collectedPackageSales) },
    { id: 'col-rev-product', name: 'Collected Retail Product Sales (Excl. Tax)', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.collectedProductSales, percentOfRevenue: calcColPct(currentMetrics.collectedProductSales), priorAmount: priorMetrics.collectedProductSales, growthPercent: calcColGrowth(currentMetrics.collectedProductSales, priorMetrics.collectedProductSales) },
    { id: 'col-rev-dues', name: 'Subsequent Dues Collections (Excl. Tax)', section: 'REVENUE', isSubItem: true, currentAmount: currentMetrics.duesCollectionsNet, percentOfRevenue: calcColPct(currentMetrics.duesCollectionsNet), priorAmount: priorMetrics.duesCollectionsNet, growthPercent: calcColGrowth(currentMetrics.duesCollectionsNet, priorMetrics.duesCollectionsNet) },
    { id: 'col-tot-rev', name: 'TOTAL COLLECTED OPERATING REVENUE (EXCL. TAX)', section: 'REVENUE', isTotal: true, currentAmount: currentMetrics.totalCollectedRevenue, percentOfRevenue: 100, priorAmount: priorMetrics.totalCollectedRevenue, growthPercent: calcColGrowth(currentMetrics.totalCollectedRevenue, priorMetrics.totalCollectedRevenue) },

    // ── SECTION 2: STATUTORY TAX COLLECTED (SEPARATE LIABILITY) ──
    { id: 'col-sec-tax', name: '2. STATUTORY TAX COLLECTED (SEPARATE LIABILITY)', section: 'STATUTORY_TAX', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'col-tax-coll', name: 'Sales Tax Collected on Receipts (Not Salon Income)', section: 'STATUTORY_TAX', isSubItem: true, currentAmount: currentMetrics.totalCollectedTax, percentOfRevenue: calcColPct(currentMetrics.totalCollectedTax), priorAmount: priorMetrics.totalCollectedTax, growthPercent: calcColGrowth(currentMetrics.totalCollectedTax, priorMetrics.totalCollectedTax) },
    { id: 'col-tot-gross', name: 'TOTAL GROSS INFLOW (REVENUE + TAX)', section: 'STATUTORY_TAX', isTotal: true, currentAmount: currentMetrics.totalGrossCollections, percentOfRevenue: calcColPct(currentMetrics.totalGrossCollections), priorAmount: priorMetrics.totalGrossCollections, growthPercent: calcColGrowth(currentMetrics.totalGrossCollections, priorMetrics.totalGrossCollections) },

    // ── SECTION 3: COST OF SALES ──
    { id: 'col-sec-cos', name: '3. COST OF SALES (SEPARATE NON-CASH INFORMATION)', section: 'COGS', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'col-cos-cogs', name: 'Retail Products COGS (FIFO/FEFO Landed)', section: 'COGS', isSubItem: true, currentAmount: currentMetrics.productCogs, percentOfRevenue: calcColPct(currentMetrics.productCogs), priorAmount: priorMetrics.productCogs, growthPercent: calcColGrowth(currentMetrics.productCogs, priorMetrics.productCogs) },
    { id: 'col-cos-cons', name: 'Salon Consumable Material Consumption', section: 'COGS', isSubItem: true, currentAmount: currentMetrics.materialConsumption, percentOfRevenue: calcColPct(currentMetrics.materialConsumption), priorAmount: priorMetrics.materialConsumption, growthPercent: calcColGrowth(currentMetrics.materialConsumption, priorMetrics.materialConsumption) },
    { id: 'col-tot-cos', name: 'TOTAL COST OF SALES', section: 'COGS', isTotal: true, currentAmount: currentMetrics.totalCostOfSales, percentOfRevenue: calcColPct(currentMetrics.totalCostOfSales), priorAmount: priorMetrics.totalCostOfSales, growthPercent: calcColGrowth(currentMetrics.totalCostOfSales, priorMetrics.totalCostOfSales) },

    // ── SECTION 4: COLLECTION GROSS CONTRIBUTION ──
    { id: 'col-sec-gc', name: '4. COLLECTION GROSS CONTRIBUTION', section: 'GROSS_PROFIT', isMajorTotal: true, currentAmount: currentMetrics.collectionGrossContribution, percentOfRevenue: currentMetrics.collectionGrossMarginPercent, priorAmount: priorMetrics.collectionGrossContribution, growthPercent: calcColGrowth(currentMetrics.collectionGrossContribution, priorMetrics.collectionGrossContribution) },

    // ── SECTION 5: ACTUAL OPERATING CASH OUTFLOWS ──
    { id: 'col-sec-opex', name: '5. ACTUAL OPERATING CASH EXPENSES & OUTFLOWS', section: 'EXPENSE', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'col-exp-salary', name: 'Disbursed Salaries & Wages (Paid Outflows)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.paidSalaryExpenses, percentOfRevenue: calcColPct(currentMetrics.paidSalaryExpenses), priorAmount: priorMetrics.paidSalaryExpenses, growthPercent: calcColGrowth(currentMetrics.paidSalaryExpenses, priorMetrics.paidSalaryExpenses) },
    { id: 'col-exp-comm', name: 'Disbursed Staff Commissions (Actual Paid)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.paidCommissionExpenses, percentOfRevenue: calcColPct(currentMetrics.paidCommissionExpenses), priorAmount: priorMetrics.paidCommissionExpenses, growthPercent: calcColGrowth(currentMetrics.paidCommissionExpenses, priorMetrics.paidCommissionExpenses) },
    { id: 'col-exp-direct', name: 'Paid Direct Operating Expenses (Vouchers / Cash Out)', section: 'EXPENSE', isSubItem: true, currentAmount: currentMetrics.paidDirectExpenses, percentOfRevenue: calcColPct(currentMetrics.paidDirectExpenses), priorAmount: priorMetrics.paidDirectExpenses, growthPercent: calcColGrowth(currentMetrics.paidDirectExpenses, priorMetrics.paidDirectExpenses) },
    { id: 'col-exp-loss', name: 'Inventory Shrinkage & Write-offs (Separate Non-Cash Information)', section: 'MEMORANDUM', isSubItem: true, currentAmount: currentMetrics.inventoryLoss, percentOfRevenue: calcColPct(currentMetrics.inventoryLoss), priorAmount: priorMetrics.inventoryLoss, growthPercent: calcColGrowth(currentMetrics.inventoryLoss, priorMetrics.inventoryLoss) },
    { id: 'col-tot-opex', name: 'TOTAL PAID OPERATING CASH OUTFLOWS', section: 'EXPENSE', isTotal: true, currentAmount: currentMetrics.totalPaidOperatingExpenses, percentOfRevenue: calcColPct(currentMetrics.totalPaidOperatingExpenses), priorAmount: priorMetrics.totalPaidOperatingExpenses, growthPercent: calcColGrowth(currentMetrics.totalPaidOperatingExpenses, priorMetrics.totalPaidOperatingExpenses) },

    // ── SECTION 6: COLLECTION-BASED CASH SURPLUS ──
    { id: 'col-sec-surplus', name: '6. COLLECTION-BASED CASH SURPLUS', section: 'NET_PROFIT', isFinalNet: true, currentAmount: currentMetrics.collectionCashSurplus, percentOfRevenue: currentMetrics.collectionMarginPercent, priorAmount: priorMetrics.collectionCashSurplus, growthPercent: calcColGrowth(currentMetrics.collectionCashSurplus, priorMetrics.collectionCashSurplus) },

    // ── SECTION 7: PERFORMANCE MEMORANDUM ──
    { id: 'col-sec-memo', name: '7. COMMISSION ACCRUAL & RECEIVABLES MEMORANDUM', section: 'MEMORANDUM', isHeader: true, currentAmount: 0, percentOfRevenue: 0, priorAmount: 0, growthPercent: null },
    { id: 'col-memo-comm-earned', name: 'Staff Commission Earned on Eligible Collections', section: 'MEMORANDUM', isSubItem: true, currentAmount: currentMetrics.collectionEarnedCommission, percentOfRevenue: calcColPct(currentMetrics.collectionEarnedCommission), priorAmount: priorMetrics.collectionEarnedCommission, growthPercent: calcColGrowth(currentMetrics.collectionEarnedCommission, priorMetrics.collectionEarnedCommission) },
    { id: 'col-memo-comm-unpaid', name: 'Unpaid Earned Commission Liability', section: 'MEMORANDUM', isSubItem: true, currentAmount: currentMetrics.unpaidCommissionLiability, percentOfRevenue: calcColPct(currentMetrics.unpaidCommissionLiability), priorAmount: priorMetrics.unpaidCommissionLiability, growthPercent: calcColGrowth(currentMetrics.unpaidCommissionLiability, priorMetrics.unpaidCommissionLiability) },
    { id: 'col-memo-dues', name: 'Outstanding Customer Receivables (Uncollected)', section: 'MEMORANDUM', isSubItem: true, currentAmount: currentMetrics.outstandingDues, percentOfRevenue: calcColPct(currentMetrics.outstandingDues), priorAmount: priorMetrics.outstandingDues, growthPercent: calcColGrowth(currentMetrics.outstandingDues, priorMetrics.outstandingDues) },
  ];

  const collectionDetailedRows = [
    {
      id: 'col-d-1',
      accountName: 'Service Collections (Excl. Tax)',
      classification: 'REVENUE',
      department: 'Salon Floor / Styling',
      currentAmount: currentMetrics.collectedServiceSales,
      percentOfRevenue: calcColPct(currentMetrics.collectedServiceSales),
      priorAmount: priorMetrics.collectedServiceSales,
      varianceAmount: currentMetrics.collectedServiceSales - priorMetrics.collectedServiceSales,
      growthPercent: calcColGrowth(currentMetrics.collectedServiceSales, priorMetrics.collectedServiceSales),
      notes: 'Actual collected service income excluding tax (deterministic line allocation)',
    },
    {
      id: 'col-d-2',
      accountName: 'Package Collections (Excl. Tax)',
      classification: 'REVENUE',
      department: 'Salon Floor / Packages',
      currentAmount: currentMetrics.collectedPackageSales,
      percentOfRevenue: calcColPct(currentMetrics.collectedPackageSales),
      priorAmount: priorMetrics.collectedPackageSales,
      varianceAmount: currentMetrics.collectedPackageSales - priorMetrics.collectedPackageSales,
      growthPercent: calcColGrowth(currentMetrics.collectedPackageSales, priorMetrics.collectedPackageSales),
      notes: 'Actual collected bundled package sales excluding tax',
    },
    {
      id: 'col-d-3',
      accountName: 'Retail Product Collections (Excl. Tax)',
      classification: 'REVENUE',
      department: 'Retail Counter',
      currentAmount: currentMetrics.collectedProductSales,
      percentOfRevenue: calcColPct(currentMetrics.collectedProductSales),
      priorAmount: priorMetrics.collectedProductSales,
      varianceAmount: currentMetrics.collectedProductSales - priorMetrics.collectedProductSales,
      growthPercent: calcColGrowth(currentMetrics.collectedProductSales, priorMetrics.collectedProductSales),
      notes: 'Actual collected retail product sales excluding tax',
    },
    {
      id: 'col-d-4',
      accountName: 'Subsequent Dues Collections (Excl. Tax)',
      classification: 'REVENUE',
      department: 'Billing & Front Desk',
      currentAmount: currentMetrics.duesCollectionsNet,
      percentOfRevenue: calcColPct(currentMetrics.duesCollectionsNet),
      priorAmount: priorMetrics.duesCollectionsNet,
      varianceAmount: currentMetrics.duesCollectionsNet - priorMetrics.duesCollectionsNet,
      growthPercent: calcColGrowth(currentMetrics.duesCollectionsNet, priorMetrics.duesCollectionsNet),
      notes: 'Dues received in current period allocated to net revenue portion',
    },
    {
      id: 'col-d-tax',
      accountName: 'Collected Statutory Sales Tax',
      classification: 'STATUTORY_TAX',
      department: 'Tax Authority / FBR / PRA',
      currentAmount: currentMetrics.totalCollectedTax,
      percentOfRevenue: calcColPct(currentMetrics.totalCollectedTax),
      priorAmount: priorMetrics.totalCollectedTax,
      varianceAmount: currentMetrics.totalCollectedTax - priorMetrics.totalCollectedTax,
      growthPercent: calcColGrowth(currentMetrics.totalCollectedTax, priorMetrics.totalCollectedTax),
      notes: 'Sales tax collected on payments; held as statutory liability, not income',
    },
    {
      id: 'col-d-5',
      accountName: 'Retail Cost of Goods Sold (COGS)',
      classification: 'COST_OF_SALES',
      department: 'Inventory Asset Layer',
      currentAmount: currentMetrics.productCogs,
      percentOfRevenue: calcColPct(currentMetrics.productCogs),
      priorAmount: priorMetrics.productCogs,
      varianceAmount: currentMetrics.productCogs - priorMetrics.productCogs,
      growthPercent: calcColGrowth(currentMetrics.productCogs, priorMetrics.productCogs),
      notes: 'Historical landed cost from stock layers consumed on POS product sales',
    },
    {
      id: 'col-d-6',
      accountName: 'Salon Consumable Material Consumption',
      classification: 'COST_OF_SALES',
      department: 'Backbar / Dispensary',
      currentAmount: currentMetrics.materialConsumption,
      percentOfRevenue: calcColPct(currentMetrics.materialConsumption),
      priorAmount: priorMetrics.materialConsumption,
      varianceAmount: currentMetrics.materialConsumption - priorMetrics.materialConsumption,
      growthPercent: calcColGrowth(currentMetrics.materialConsumption, priorMetrics.materialConsumption),
      notes: 'Internal stock consumption for salon treatments (colors, developers)',
    },
    {
      id: 'col-d-7',
      accountName: 'Disbursed Salaries & Wages (Paid Out)',
      classification: 'OPERATING_EXPENSE',
      department: 'Human Resources / Payroll',
      currentAmount: currentMetrics.paidSalaryExpenses,
      percentOfRevenue: calcColPct(currentMetrics.paidSalaryExpenses),
      priorAmount: priorMetrics.paidSalaryExpenses,
      varianceAmount: currentMetrics.paidSalaryExpenses - priorMetrics.paidSalaryExpenses,
      growthPercent: calcColGrowth(currentMetrics.paidSalaryExpenses, priorMetrics.paidSalaryExpenses),
      notes: 'Actual cash outflows disbursed for employee salaries in period',
    },
    {
      id: 'col-d-8',
      accountName: 'Disbursed Staff Commissions (Actual Paid)',
      classification: 'OPERATING_EXPENSE',
      department: 'Human Resources / Commission',
      currentAmount: currentMetrics.paidCommissionExpenses,
      percentOfRevenue: calcColPct(currentMetrics.paidCommissionExpenses),
      priorAmount: priorMetrics.paidCommissionExpenses,
      varianceAmount: currentMetrics.paidCommissionExpenses - priorMetrics.paidCommissionExpenses,
      growthPercent: calcColGrowth(currentMetrics.paidCommissionExpenses, priorMetrics.paidCommissionExpenses),
      notes: 'Actual commission payouts disbursed to staff in period',
    },
    ...Object.entries(currentMetrics.paidExpensesByCategory).map(([cat, amt], idx) => {
      const priorAmt = priorMetrics.paidExpensesByCategory[cat] || 0;
      return {
        id: `col-d-exp-${idx}`,
        accountName: `Paid Expense: ${cat}`,
        classification: 'OPERATING_EXPENSE',
        department: 'Operations & Facilities',
        currentAmount: amt,
        percentOfRevenue: calcColPct(amt),
        priorAmount: priorAmt,
        varianceAmount: amt - priorAmt,
        growthPercent: calcColGrowth(amt, priorAmt),
        notes: `Actual cash and bank payments disbursed for ${cat}`,
      };
    }),
    {
      id: 'col-d-loss',
      accountName: 'Inventory Losses & Expiry Write-Offs (Non-Cash Reference)',
      classification: 'MEMORANDUM',
      department: 'Stock Custody',
      currentAmount: currentMetrics.inventoryLoss,
      percentOfRevenue: calcColPct(currentMetrics.inventoryLoss),
      priorAmount: priorMetrics.inventoryLoss,
      varianceAmount: currentMetrics.inventoryLoss - priorMetrics.inventoryLoss,
      growthPercent: calcColGrowth(currentMetrics.inventoryLoss, priorMetrics.inventoryLoss),
      notes: 'Stock damaged, expired or adjusted downward at landed cost',
    },
    {
      id: 'col-d-memo-comm',
      accountName: 'Earned Staff Commission Liability (Unpaid)',
      classification: 'MEMORANDUM',
      department: 'Commission Liability',
      currentAmount: currentMetrics.unpaidCommissionLiability,
      percentOfRevenue: calcColPct(currentMetrics.unpaidCommissionLiability),
      priorAmount: priorMetrics.unpaidCommissionLiability,
      varianceAmount: currentMetrics.unpaidCommissionLiability - priorMetrics.unpaidCommissionLiability,
      growthPercent: calcColGrowth(currentMetrics.unpaidCommissionLiability, priorMetrics.unpaidCommissionLiability),
      notes: 'Earned commission on collected sales not yet disbursed to staff',
    },
    {
      id: 'col-d-memo-dues',
      accountName: 'Outstanding Customer Receivables',
      classification: 'MEMORANDUM',
      department: 'Receivables Custody',
      currentAmount: currentMetrics.outstandingDues,
      percentOfRevenue: calcColPct(currentMetrics.outstandingDues),
      priorAmount: priorMetrics.outstandingDues,
      varianceAmount: currentMetrics.outstandingDues - priorMetrics.outstandingDues,
      growthPercent: calcColGrowth(currentMetrics.outstandingDues, priorMetrics.outstandingDues),
      notes: 'Total uncollected customer invoices requiring collection',
    },
  ];

  const collectionTotals = {
    revenue: currentMetrics.totalCollectedRevenue,
    costOfSales: currentMetrics.totalCostOfSales,
    grossMargin: currentMetrics.collectionGrossContribution,
    operatingExpenses: currentMetrics.totalPaidOperatingExpenses,
    netProfit: currentMetrics.collectionCashSurplus,
    collectedTax: currentMetrics.totalCollectedTax,
    totalCollections: currentMetrics.totalGrossCollections,
    earnedCommission: currentMetrics.collectionEarnedCommission,
    paidCommission: currentMetrics.paidCommissionExpenses,
    unpaidCommission: currentMetrics.unpaidCommissionLiability,
    outstandingDues: currentMetrics.outstandingDues,
  };

  const collectionViewData = {
    kpis: collectionKpis,
    statementRows: collectionStatementRows,
    rows: collectionDetailedRows,
    totals: collectionTotals,
    customerAdvances,
  };

  const isCollectionRequested = query.viewMode === 'COLLECTION';
  const defaultView = isCollectionRequested ? collectionViewData : accrualViewData;

  const metaWithPrior = {
    ...ctx.meta,
    viewMode: isCollectionRequested ? 'COLLECTION' : 'ACCRUAL',
    priorFrom: prior.priorFromStr,
    priorTo: prior.priorToStr,
  };

  return formatReportResponse(metaWithPrior, {
    kpis: defaultView.kpis,
    statementRows: defaultView.statementRows,
    rows: defaultView.rows,
    totals: defaultView.totals,
    customerAdvances,
    accrual: accrualViewData,
    collection: collectionViewData,
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
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
  const visibleRows = rawRows.filter(r => (!query.direction || query.direction === 'ALL' || r.direction === query.direction)
    && (!query.transactionType || query.transactionType === 'ALL' || r.type === query.transactionType)
    && (!query.sourceModule || query.sourceModule === 'ALL' || r.sourceModule === query.sourceModule));
  const filteredRows = search
    ? visibleRows.filter((r) =>
        (r.reference && r.reference.toLowerCase().includes(search)) ||
        (r.description && r.description.toLowerCase().includes(search)) ||
        (r.userName && r.userName.toLowerCase().includes(search)) ||
        (r.accountName && r.accountName.toLowerCase().includes(search)) ||
        (r.sourceModule && r.sourceModule.toLowerCase().includes(search)) ||
        (r.type && r.type.toLowerCase().includes(search))
      )
    : visibleRows;

  // Customer receipts are a separate revenue/tax reconciliation, never added to ledger movements.
  const accountCollections = (await loadCollectionEvents(branchFilter, ctx.fromStr, ctx.toStr))
    .filter(e => e.record.method !== 'CASH' && accountIds.includes(e.record.paymentAccountId || e.record.accountId));

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
      ...collectionTotals(accountCollections.filter(e => (e.record.paymentAccountId || e.record.accountId) === a.id)),
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
    totalDebits: n(totalMoneyIn.plus(totalTransfersIn)),
    totalCredits: n(totalMoneyOut.plus(totalTransfersOut)),
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

  return formatReportResponse({ ...ctx.meta, basisNote: 'Balances and account summaries include all movements. Filters select detail rows only. Bank movements include tax/tips, transfers and non-sales items; they are not revenue. Customer collection components use business receipt dates; ledger balances use posting timestamps.' }, {
    collections: collectionTotals(accountCollections),
    filteredTotals: { moneyIn: n(filteredRows.reduce((sum, r) => sum.plus(r.debit), toDec(0))), moneyOut: n(filteredRows.reduce((sum, r) => sum.plus(r.credit), toDec(0))) },
    kpis,
    rows: filteredRows,
    totals,
    accountsSummary,
  });
};

// ═══ CASH DRAWER CUSTODY & SESSION REPORT ══════════════════════════════════

export const cashDrawerReport = async (actor, query = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Staff cannot access cash drawer reports.');
  const ctx = await resolveReportContext(actor, query, 'MOVEMENT_TIMESTAMP');
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};

  // 1. Fetch cash drawers
  const drawerWhere = {
    ...branchFilter,
    createdAt: { lte: ctx.toDate },
    ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
    ...(actor.role === 'ACCOUNTANT'
      ? { custodianUserId: actor.id }
      : (query.custodianUserId && query.custodianUserId !== 'ALL' ? { custodianUserId: query.custodianUserId } : {})),
  };

  const drawers = await prisma.cashDrawer.findMany({
    where: drawerWhere,
    include: {
      movements: {
        where: { createdAt: { lte: ctx.toDate } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
      settlements: {
        where: { createdAt: { lte: ctx.toDate } },
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
  const custodian = actor.role === 'ACCOUNTANT' ? actor.id : query.custodianUserId;
  const collectionEvents = (await loadCollectionEvents(branchFilter, ctx.fromStr, ctx.toStr)).filter(e =>
    !custodian || custodian === 'ALL' || (e.kind === 'REFUND' ? e.record.byUserId : e.kind === 'PAYMENT_REVERSAL' ? e.record.reversedByUserId : e.record.processedByUserId) === custodian);
  const invoicePayments = collectionReceipts(collectionEvents).map(e => ({ ...e.record, id: e.id, date: dateOnly(e.date),
    amount: e.billCollected.plus(e.tip), paymentAccountId: e.record.paymentAccountId || e.record.accountId,
    paymentAccountName: e.record.paymentAccountName, processedByUserId: e.record.processedByUserId || e.record.byUserId, method: e.record.method }));
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
    onlineAccountMap.set(acc.id, {
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
      const existing = onlineAccountMap.get(ip.paymentAccountId || 'unknown') || {
        accountId: ip.paymentAccountId || '',
        accountName: accName,
        accountType: 'ONLINE',
        providerName: '',
        amount: toDec(0),
        count: 0,
      };
      existing.amount = existing.amount.plus(amt);
      existing.count += 1;
      onlineAccountMap.set(ip.paymentAccountId || 'unknown', existing);
    }
  }

  const onlineAccountsBreakdown = Array.from(onlineAccountMap.values()).map((a) => ({
    accountId: a.accountId,
    accountName: a.accountName,
    accountType: a.accountType,
    providerName: a.providerName,
    amount: n(a.amount),
    count: a.count,
  }));

  // Map online collections per drawer (by drawerId or by custodianUserId + date)
  const onlineByDrawer = new Map();
  for (const ip of invoicePayments) {
    if (ip.method !== 'CASH') {
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
  let totalOpeningBalance = toDec(0);
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

    const openingBalance = d.movements.filter(m => m.createdAt < ctx.fromDate).reduce((sum, m) => m.direction === 'IN' ? sum.plus(m.amount) : sum.minus(m.amount), toDec(0));
    const periodMovements = d.movements.filter(m => m.createdAt >= ctx.fromDate && m.createdAt <= ctx.toDate);
    for (const m of periodMovements) {
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

    const expectedCash = openingBalance.plus(cashIn).minus(cashOut);
    const countedCash =
      d.lastCountedAt && d.lastCountedAt >= ctx.fromDate && d.lastCountedAt <= ctx.toDate && d.lastCountedCash !== null && d.lastCountedCash !== undefined
        ? toDec(d.lastCountedCash)
        : null;
    const countBalance = d.movements.filter(m => d.lastCountedAt && m.createdAt <= d.lastCountedAt).reduce((sum, m) => m.direction === 'IN' ? sum.plus(m.amount) : sum.minus(m.amount), toDec(0));
    const variance = countedCash !== null ? countedCash.minus(countBalance) : null;

    totalOpeningBalance = totalOpeningBalance.plus(openingBalance);
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
      closedAt: d.closedAt && d.closedAt <= ctx.toDate ? d.closedAt.toISOString() : null,
      status: d.closedAt && d.closedAt > ctx.toDate ? 'OPEN' : d.status,
      openingBalance: n(openingBalance),
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
      movementCount: periodMovements.length,
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
    totalOpeningBalance: n(totalOpeningBalance),
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
    openingBalance: n(totalOpeningBalance),
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

  return formatReportResponse({ ...ctx.meta, basisNote: 'Opening balance is carry-forward before the period; expected cash is opening plus period IN minus OUT. Counts use their recorded timestamp; unavailable historical counts are blank. Tender totals are customer receipts including tax/tips, separate from custody transfers. Session status is current unless a future close is known. Search selects detail rows only.' }, {
    collections: collectionTotals(collectionEvents),
    kpis,
    tenderBreakdown,
    rows: filteredRows,
    transactions,
    totals,
  });
};

// ═══ DETAILED OPERATIONAL EXPENSES REPORT ══════════════════════════════════

export { detailedExpensesReport } from './paidExpenses.report.js';

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
    const today = await getBusinessDate();
    const todayStr = ymd(today);
    const isHistorical = ctx.toStr < todayStr;

    const [items, batches, futureMovements] = await Promise.all([
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
          receivedDate: isHistorical ? { lte: dateOnly(ctx.toStr) } : undefined,
          ...(isHistorical ? {} : { remainingQuantity: { gt: 0 } }),
        },
        include: {
          item: true,
        },
        orderBy: [{ receivedDate: 'asc' }, { batchNumber: 'asc' }],
      }),
      isHistorical
        ? prisma.stockMovement.findMany({
            where: {
              ...branchFilter,
              createdAt: { gt: ctx.toDate },
              batchId: { not: null },
            },
            select: {
              batchId: true,
              direction: true,
              quantity: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const futureMovementsMap = new Map();
    if (isHistorical && futureMovements.length > 0) {
      for (const m of futureMovements) {
        const cur = futureMovementsMap.get(m.batchId) || toDec(0);
        const delta = m.direction === 'OUT' ? toDec(m.quantity) : toDec(m.quantity).negated();
        futureMovementsMap.set(m.batchId, cur.plus(delta));
      }
    }

    let totalCostVal = toDec(0);
    let totalRetailVal = toDec(0);
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let expiredBatchesCount = 0;
    let nearExpiryBatchesCount = 0;

    const itemStockMap = new Map();
    for (const b of batches) {
      const futureAdj = futureMovementsMap.get(b.id) || toDec(0);
      const rem = isHistorical ? max0(toDec(b.remainingQuantity).plus(futureAdj)) : toDec(b.remainingQuantity);
      if (rem.gt(0)) {
        const cur = itemStockMap.get(b.itemId) || toDec(0);
        itemStockMap.set(b.itemId, cur.plus(rem));
      }
    }

    const rows = [];
    for (const b of batches) {
      const item = b.item;
      if (query.itemType && query.itemType !== 'ALL' && item.itemType !== query.itemType) continue;
      if (query.categoryId && query.categoryId !== 'ALL' && item.category !== query.categoryId) continue;

      const futureAdj = futureMovementsMap.get(b.id) || toDec(0);
      const remQty = isHistorical ? max0(toDec(b.remainingQuantity).plus(futureAdj)) : toDec(b.remainingQuantity);
      if (remQty.lessThanOrEqualTo(0)) continue;

      const isConsumable = item.itemType === 'SALON_CONSUMABLE';
      const unitCost = toDec(b.unitCost);
      const costVal = remQty.times(unitCost);
      const sellingPrice = isConsumable ? toDec(0) : toDec(item.sellingPrice || 0);
      const retailVal = isConsumable ? toDec(0) : remQty.times(sellingPrice);

      totalCostVal = totalCostVal.plus(costVal);
      totalRetailVal = totalRetailVal.plus(retailVal);

      const expDateStr = b.expiryDate ? ymd(b.expiryDate) : null;
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

    const filteredCostValue = filteredRows.reduce((acc, r) => acc.plus(toDec(r.costValue)), toDec(0));
    const filteredRetailValue = filteredRows.reduce((acc, r) => acc.plus(toDec(r.retailValue)), toDec(0));

    const totals = {
      remainingQuantity: n(filteredRows.reduce((acc, r) => acc + r.remainingQuantity, 0)),
      costValue: n(filteredCostValue),
      retailValue: n(filteredRetailValue),
      potentialProfit: n(filteredRetailValue.minus(filteredCostValue)),
    };

    return formatReportResponse({
      ...ctx.meta,
      basisNote: isHistorical
        ? `Historical inventory valuation as of ${ctx.toStr} reconstructed from recorded stock movements.`
        : 'Current live inventory custody and valuation as of today; stock counts reflect active available batches.',
    }, {
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
        ...(ctx.branchId ? { OR: [{ branchId: ctx.branchId }, { branchId: 'ALL' }] } : {}),
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

    const supplierIds = suppliers.map((s) => s.id);
    const openingLedgerEntries = await prisma.supplierLedger.findMany({
      where: {
        supplierId: { in: supplierIds },
        entryType: 'OPENING_BALANCE',
        ...branchFilter,
      },
      select: { supplierId: true },
    });
    const hasOpeningEntry = new Set(openingLedgerEntries.map((e) => e.supplierId));

    const supplierRunning = new Map();
    let totalOpeningPayable = toDec(0);
    for (const s of suppliers) {
      const prior = priorMap.get(s.id) || toDec(0);
      // F07: If an OPENING_BALANCE ledger entry exists, prior or period ledger entries already capture it.
      // Only unledgered legacy supplier records should add openingPayable directly.
      const unledgeredOpening = !hasOpeningEntry.has(s.id) ? toDec(s.openingPayable || 0) : toDec(0);
      const open = prior.plus(unledgeredOpening);
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

    const movementIds = movements.map((m) => m.id);
    const reversals = movementIds.length > 0 ? await prisma.stockMovement.findMany({
      where: {
        sourceReferenceType: 'STOCK_MOVEMENT_REVERSAL',
        sourceReferenceId: { in: movementIds },
      },
      select: { sourceReferenceId: true, movementNumber: true, createdAt: true },
    }) : [];
    const reversalMap = new Map(reversals.map((r) => [r.sourceReferenceId, r]));

    let totalQty = toDec(0);
    let totalCost = toDec(0);
    const categoryCostMap = new Map();

    const rows = movements.map((m) => {
      const q = toDec(m.quantity);
      const c = toDec(m.totalCost);
      const isReversed = reversalMap.has(m.id);
      const revInfo = reversalMap.get(m.id);

      if (!isReversed) {
        totalQty = totalQty.plus(q);
        totalCost = totalCost.plus(c);

        const cat = m.item?.category || 'Consumable';
        categoryCostMap.set(cat, (categoryCostMap.get(cat) || toDec(0)).plus(c));
      }

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
        category: m.item?.category || 'Consumable',
        batchNumber: m.batch?.batchNumber || 'N/A',
        quantity: n(q),
        unitCost: n(m.unitCost),
        totalCost: n(c),
        reason: m.reason || 'Salon Consumption',
        notes: m.notes || '',
        sourceReferenceNumber: m.sourceReferenceNumber || '',
        userName: m.userName || 'Staff',
        isReversed,
        status: isReversed ? 'REVERSED' : 'POSTED',
        reversalMovementNumber: revInfo?.movementNumber || null,
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
    const todayStr = ymd(today);

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
      const expDateStr = ymd(b.expiryDate);
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
  for (const [key, dayOts] of otMap.entries()) {
    if (recordKeys.has(key)) continue;
    recordKeys.add(key);

    const firstOt = dayOts[0];
    const dateStr = ymd(firstOt.workDate) || String(firstOt.workDate).slice(0, 10);
    const st = staffMap.get(firstOt.staffId);
    const staffName = st?.name || 'Unknown Staff';
    const employeeCode = st?.employeeCode || '—';
    const designation = st?.designation || 'Staff';
    const branchName = branchMap.get(firstOt.branchId) || 'Branch';

    const approvedOt = dayOts.filter((o) => o.status === 'APPROVED');
    const otMin = approvedOt.reduce((sum, o) => sum + (o.approvedMinutes || o.minutes || 0), 0);
    const otHours = n(toDec(otMin).dividedBy(60));
    const otAmount = n(approvedOt.reduce((sum, o) => sum.plus(toDec(o.amount || 0)), toDec(0)));
    const otStatus = approvedOt.length > 0 ? 'APPROVED' : dayOts[0].status;
    const otReason = dayOts.map((o) => o.reason).filter(Boolean).join('; ') || '—';
    const otApprovedBy = dayOts.map((o) => o.approvedByName).filter(Boolean).join(', ') || '—';

    rows.push({
      id: `ot-${firstOt.id}`,
      date: dateStr,
      staffId: firstOt.staffId,
      staffName,
      employeeCode,
      designation,
      branchId: firstOt.branchId,
      branchName,
      shift: st?.shift || 'Overtime Entry',
      checkIn: '—',
      checkOut: '—',
      scheduledHours: 0,
      workedHours: 0,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      isLate: false,
      status: approvedOt.length > 0 ? 'APPROVED_OVERTIME' : 'OVERTIME_ENTRY',
      source: 'MANUAL',
      otMinutes: otMin,
      otHours,
      otAmount,
      otStatus,
      otReason,
      otApprovedBy,
      notes: dayOts.map((o) => o.notes).filter(Boolean).join('; ') || '',
    });
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

export { detailedIncomeReport } from './detailedCollections.report.js';
