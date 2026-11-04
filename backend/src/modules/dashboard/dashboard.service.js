// src/modules/dashboard/dashboard.service.js
// Role dashboards. Every figure is derived from posted records for the business date:
// sales by invoice date (less dated refunds), collections by payment date, custody and
// account balances from movement ledgers. Tips are shown separately — never as revenue.

import prisma from '../../config/prisma.js';
import { loadCollectionEvents, collectionTotals } from '../reports/collectionEvents.js';
import { loadStaffPayments } from '../reports/paidExpenses.report.js';
import { forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch } from '../../lib/scope.js';
import { dateOnly, getBusinessDate, ymd } from '../../lib/dates.js';
import { max0, round2, toDec } from '../../lib/money.js';
import { accountBalances } from '../../lib/balances.js';
import { toDTOs as branchDTOs } from '../branches/branches.service.js';
import { toStaffDTO } from '../staff/staff.mapper.js';
import { toOnlineAccountDTO } from '../settings/settings.mapper.js';
import { drawerDTOs } from '../cash/cash.service.js';
import { listAppointments } from '../appointments/appointments.service.js';
import { invoiceInclude } from '../pos/pos.service.js';
import { toInvoiceDTO } from '../pos/pos.mapper.js';
import { toExpenseDTO } from '../expenses/expenses.service.js';
import { toSettlementDTO } from '../settlements/settlements.service.js';

const ON_DUTY = ['PRESENT', 'LATE', 'HALF_DAY'];
const n = (d) => round2(d ?? 0).toNumber();
const sumOf = (agg, f) => toDec(agg._sum?.[f] ?? 0);
const inBranches = (ids) => ({ branchId: { in: ids } });

/** Shared metric engine: one branch or the consolidated set of active branches. */
export const computeBranchMetrics = async (branchIds, date, { id, name, code }) => {
  const day = dateOnly(date);
  const scope = inBranches(branchIds);
  const live = { ...scope, lifecycle: { not: 'VOIDED' } };

  const [sales, refunds, dues, payments, expenses, reversals, onDuty, apptCount, drawers, accounts, collectionEvents, staffPayments] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...live, date: day }, _sum: { subtotal: true, discount: true, netSales: true, tax: true }, _count: true }),
    prisma.invoiceRefund.findMany({ where: { refundDate: day, invoice: scope }, select: { netReversed: true, taxReversed: true, tipReversed: true, cashOut: true, method: true } }),
    prisma.invoice.aggregate({ where: { ...live, amountDue: { gt: 0 } }, _sum: { amountDue: true } }),
    prisma.invoicePayment.groupBy({ by: ['method'], where: { ...scope, date: day }, _sum: { amount: true, tipAmountAllocated: true } }),
    prisma.expense.aggregate({ where: { ...scope, status: { in: ['POSTED', 'REVERSED'] }, isReversalRecord: false, expenseDate: day }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { ...scope, isReversalRecord: true, expenseDate: day }, _sum: { amount: true } }),
    prisma.attendanceRecord.count({ where: { ...scope, workDate: day, status: { in: ON_DUTY } } }),
    prisma.appointment.count({ where: { ...scope, date: day } }),
    prisma.cashDrawer.findMany({ where: { ...scope, kind: 'DRAWER', status: { in: ['OPEN', 'SETTLEMENT_PENDING'] } } }),
    prisma.paymentAccount.findMany({ where: { OR: [scope, { branches: { some: { id: scope.branchId } } }] }, select: { id: true } }),
    loadCollectionEvents(scope, date, date),
    loadStaffPayments(scope, date),
  ]);

  const netReversed = refunds.reduce((s, r) => s.plus(toDec(r.netReversed)), toDec(0));
  const taxReversed = refunds.reduce((s, r) => s.plus(toDec(r.taxReversed)), toDec(0));
  const cashRefundsPaid = refunds
    .filter((r) => r.method === 'CASH')
    .reduce((s, r) => s.plus(toDec(r.cashOut || 0)), toDec(0));
  const onlineRefundsPaid = refunds
    .filter((r) => r.method === 'ONLINE_ACCOUNT')
    .reduce((s, r) => s.plus(toDec(r.cashOut || 0)), toDec(0));
  const totalRefundsPaid = cashRefundsPaid.plus(onlineRefundsPaid);

  const byMethod = (m) => payments.find((p) => p.method === m);
  const grossCashCollected = sumOf(byMethod('CASH') ?? {}, 'amount');
  const grossOnlineCollected = sumOf(byMethod('ONLINE_ACCOUNT') ?? {}, 'amount');
  const tipsCollected = payments.reduce((s, p) => s.plus(sumOf(p, 'tipAmountAllocated')), toDec(0));

  const cashCollected = grossCashCollected.minus(cashRefundsPaid);
  const onlineCollected = grossOnlineCollected.minus(onlineRefundsPaid);
  const collected = collectionTotals(collectionEvents);
  const actualCollections = toDec(collected.actualCollections);
  const staffPaid = [...staffPayments.salary, ...staffPayments.commission].filter(p => p.date === date)
    .reduce((total, p) => total.plus(p.signedAmount), toDec(0));
  const totalExpensesPaid = sumOf(expenses, 'amount').minus(sumOf(reversals, 'amount')).plus(staffPaid);
  const custody = (await drawerDTOs(prisma, drawers)).reduce((s, d) => s.plus(d.expectedInDrawer), toDec(0));
  const balances = await accountBalances(accounts.map((a) => a.id), { branchIds });
  const onlineBalancesTotal = [...balances.values()].reduce((s, b) => s.plus(b), toDec(0));

  return {
    branchId: id, branchName: name, branchCode: code,
    grossSales: n(sumOf(sales, 'subtotal')),
    totalDiscounts: n(sumOf(sales, 'discount')),
    netSales: n(max0(sumOf(sales, 'netSales').minus(netReversed))),
    taxBilled: n(max0(sumOf(sales, 'tax').minus(taxReversed))),
    tipsCollected: collected.tipsCollected,
    collectedRevenue: collected.collectedRevenue,
    taxCollected: collected.taxCollected,
    actualCollections: n(actualCollections),
    cashCollected: collectionTotals(collectionEvents.filter(e => e.record.method === 'CASH')).actualCollections,
    onlineCollected: collectionTotals(collectionEvents.filter(e => e.record.method !== 'CASH')).actualCollections,
    grossCashCollected: n(grossCashCollected),
    grossOnlineCollected: n(grossOnlineCollected),
    refundsPaid: n(totalRefundsPaid),
    cashRefundsPaid: n(cashRefundsPaid),
    onlineRefundsPaid: n(onlineRefundsPaid),
    outstandingReceivables: n(sumOf(dues, 'amountDue')),
    cashInCustody: n(custody),
    onlineBalancesTotal: n(onlineBalancesTotal),
    totalExpensesPaid: n(totalExpensesPaid),
    netOperatingCashFlow: n(toDec(collected.collectedRevenue).minus(totalExpensesPaid)),
    activeStaffOnDuty: onDuty,
    appointmentsTodayCount: apptCount,
    invoicesCount: sales._count,
  };
};

const metricsFor = (b, date) => computeBranchMetrics([b.id], date, b);

const recentInvoices = async (where, take = 5) =>
  (await prisma.invoice.findMany({ where, include: invoiceInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take })).map(toInvoiceDTO);

const computeRevenueTrend = async (scope) => {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999));
    months.push({
      start,
      end,
      label: d.toLocaleString('en-US', { month: 'short' }),
    });
  }

  const results = await Promise.all(
    months.map(async (m) => {
      const [expenseEvents, collections, staffPayments] = await Promise.all([
        prisma.expense.findMany({ where: { ...scope, status: { in: ['POSTED', 'REVERSED'] }, expenseDate: { gte: m.start, lte: m.end } },
          select: { amount: true, isReversalRecord: true } }),
        loadCollectionEvents(scope, ymd(m.start), ymd(m.end)),
        loadStaffPayments(scope, ymd(m.end)),
      ]);
      const paidStaff = [...staffPayments.salary, ...staffPayments.commission].filter(p => p.date >= ymd(m.start) && p.date <= ymd(m.end))
        .reduce((sum, p) => sum.plus(p.signedAmount), toDec(0));
      const paidExpenses = expenseEvents.reduce((sum, e) => sum.plus(toDec(e.amount).times(e.isReversalRecord ? -1 : 1)), paidStaff);
      return {
        label: m.label,
        revenue: collectionTotals(collections).collectedRevenue,
        expenses: n(paidExpenses),
        collections: collectionTotals(collections).actualCollections,
      };
    })
  );

  return results;
};

const computeCategoryBreakdown = async (scope) => {
  const items = await prisma.invoiceLine.groupBy({
    by: ['type'],
    where: { invoice: { ...scope, lifecycle: { not: 'VOIDED' } } },
    _sum: { netSales: true },
    _count: true,
  });
  return items.map((it) => ({
    type: it.type,
    count: it._count,
    revenue: n(it._sum?.netSales ?? 0),
  }));
};

// ═══ SUPER ADMIN ══════════════════════════════════════════════════════════════

export const superAdminDashboard = async (actor, { branchId = 'ALL' } = {}) => {
  if (actor.role !== 'SUPER_ADMIN') throw forbidden('FORBIDDEN', 'Access Denied: Consolidated dashboard is restricted to Super Admins.');
  const isConsolidated = branchId === 'ALL';
  const all = await prisma.branch.findMany({ orderBy: { createdAt: 'asc' } });
  const active = all.filter((b) => b.isActive);
  const target = isConsolidated ? null : all.find((b) => b.id === branchId);
  if (!isConsolidated && !target) throw notFound('BRANCH_NOT_FOUND', `Invalid branch identifier '${branchId}' in Super Admin scope.`);

  const date = await getBusinessDate();
  const ids = isConsolidated ? active.map((b) => b.id) : [target.id];
  const scope = inBranches(ids);
  const label = isConsolidated ? { id: 'ALL', name: 'All Branches (Consolidated)', code: 'ALL' } : target;

  const [metrics, branchStats, accounts, todayAppointments, invoices, drawers, pending, totalClientsCount, totalServicesCount, totalAppointmentsCount, staffList, revenueTrend, categoryBreakdown] = await Promise.all([
    computeBranchMetrics(ids, date, label),
    Promise.all(active.map((b) => metricsFor(b, date))),
    prisma.paymentAccount.findMany({ where: { OR: [scope, { branches: { some: { id: scope.branchId } } }] }, orderBy: { createdAt: 'asc' } }),
    listAppointments(actor, { ...(isConsolidated ? {} : { branchId }), date }),
    recentInvoices(scope),
    prisma.cashDrawer.findMany({ where: { ...scope, kind: 'DRAWER' }, orderBy: { createdAt: 'desc' } }),
    prisma.settlement.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
    prisma.client.count({ where: scope }),
    prisma.service.count({ where: { ...scope, isActive: true } }),
    prisma.appointment.count({ where: scope }),
    prisma.staff.findMany({ where: { ...scope, isActive: true }, select: { id: true, name: true, roleTitle: true } }),
    computeRevenueTrend(scope),
    computeCategoryBreakdown(scope),
  ]);
  const balances = await accountBalances(accounts.map((a) => a.id), { branchIds: ids });

  return {
    isConsolidated, activeBranchId: branchId, activeBranchName: label.name,
    metrics, branchStats,
    onlineAccounts: accounts.map((a) => toOnlineAccountDTO(a, balances.get(a.id))),
    todayAppointments: isConsolidated ? todayAppointments.filter((a) => ids.includes(a.branchId)) : todayAppointments,
    recentInvoices: invoices,
    cashDrawers: await drawerDTOs(prisma, drawers),
    pendingSettlementsCount: pending.length,
    pendingSettlementsTotal: n(pending.reduce((s, x) => s.plus(x.handoverAmount), toDec(0))),
    totalClientsCount,
    totalServicesCount,
    totalAppointmentsCount,
    staffList,
    revenueTrend,
    categoryBreakdown,
  };
};

// ═══ BRANCH ADMIN ═════════════════════════════════════════════════════════════

const loadBranch = async (actor, branchId) => {
  const id = resolveReadBranch(actor, branchId);
  if (!id) throw forbidden('BRANCH_REQUIRED', 'A branch must be selected for this dashboard.');
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) throw notFound('BRANCH_NOT_FOUND', `Unauthorized or invalid branch context: '${id}'. Access denied.`);
  assertBranchAccess(actor, branch.id);
  return branch;
};

const pkr = (v) => `PKR ${Number(v).toLocaleString('en-PK')}`;
const addDays = (date, k) => ymd(new Date(dateOnly(date).getTime() + k * 86400000));

export const adminDashboard = async (actor, { branchId } = {}) => {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) throw forbidden('FORBIDDEN', 'Access Denied: Branch dashboard is restricted to administrators.');
  const branch = await loadBranch(actor, branchId);
  const date = await getBusinessDate();
  const scope = { branchId: branch.id };

  const [metrics, present, totalCount, todayAppointments, invoices, expenses, pending, unpaid, accounts, drawers, totalClientsCount, totalServicesCount, totalAppointmentsCount, staffList, revenueTrend, categoryBreakdown] = await Promise.all([
    metricsFor(branch, date),
    prisma.attendanceRecord.findMany({ where: { ...scope, workDate: dateOnly(date), status: { in: ON_DUTY } }, select: { staffId: true } }),
    prisma.staff.count({ where: { ...scope, isActive: true } }),
    listAppointments(actor, { branchId: branch.id, date }),
    recentInvoices(scope),
    prisma.expense.findMany({ where: scope, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], take: 5 }),
    prisma.settlement.findMany({ where: { ...scope, status: 'SUBMITTED' }, orderBy: { createdAt: 'asc' } }),
    prisma.invoice.count({ where: { ...scope, lifecycle: { not: 'VOIDED' }, status: { in: ['UNPAID', 'PARTIAL'] } } }),
    prisma.paymentAccount.findMany({ where: { OR: [scope, { branches: { some: { id: scope.branchId } } }] }, orderBy: { createdAt: 'asc' } }),
    prisma.cashDrawer.findMany({ where: { ...scope, kind: 'DRAWER' }, orderBy: { createdAt: 'desc' } }),
    prisma.client.count({ where: scope }),
    prisma.service.count({ where: { ...scope, isActive: true } }),
    prisma.appointment.count({ where: scope }),
    prisma.staff.findMany({ where: { ...scope, isActive: true }, select: { id: true, name: true, roleTitle: true } }),
    computeRevenueTrend(scope),
    computeCategoryBreakdown(scope),
  ]);
  const balances = await accountBalances(accounts.map((a) => a.id), { branchIds: [branch.id] });
  const names = await prisma.staff.findMany({ where: { id: { in: present.map((p) => p.staffId) } }, select: { name: true } });
  const staffAttendanceSummary = { presentCount: present.length, totalCount, onDutyStaffNames: names.map((s) => s.name) };

  // 7 Days Booking and Appointment Alerts
  const todayDateOnly = dateOnly(date);
  const sevenDaysAheadDate = dateOnly(addDays(date, 7));

  const [upcomingBookings, upcomingAppointments] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...scope,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        eventDate: {
          gte: todayDateOnly,
          lte: sevenDaysAheadDate,
        },
      },
      orderBy: [{ eventDate: 'asc' }, { serviceTime: 'asc' }],
      take: 15,
    }),
    prisma.appointment.findMany({
      where: {
        ...scope,
        status: { in: ['CONFIRMED', 'PENDING'] },
        date: {
          gte: todayDateOnly,
          lte: sevenDaysAheadDate,
        },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 15,
    }),
  ]);

  const bookingAlerts = upcomingBookings.map((b) => {
    const diffMs = new Date(b.eventDate).getTime() - todayDateOnly.getTime();
    const diffDays = Math.max(0, Math.round(diffMs / 86400000));
    const dayLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`;
    const eventDateStr = new Date(b.eventDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return {
      id: `booking-${b.id}`,
      type: 'BOOKING_REMINDER',
      title: `Upcoming Booking (${dayLabel})`,
      description: `${b.clientName} · ${b.bookingNumber} (${b.type}) scheduled on ${eventDateStr} at ${b.serviceTime}. Total: ${pkr(b.totalAmount)}.`,
      urgency: diffDays <= 2 ? 'high' : 'medium',
      href: `/operations/bookings?search=${encodeURIComponent(b.bookingNumber)}`,
      daysRemaining: diffDays,
      isBookingAlert: true,
      bookingNumber: b.bookingNumber,
    };
  });

  const appointmentAlerts = upcomingAppointments.map((a) => {
    const diffMs = new Date(a.date).getTime() - todayDateOnly.getTime();
    const diffDays = Math.max(0, Math.round(diffMs / 86400000));
    const dayLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`;
    const appDateStr = new Date(a.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return {
      id: `appointment-${a.id}`,
      type: 'BOOKING_REMINDER',
      title: `Upcoming Appointment (${dayLabel})`,
      description: `${a.clientName} · ${a.appointmentNumber} scheduled on ${appDateStr} at ${a.startTime}. Price: ${pkr(a.price)}.`,
      urgency: diffDays <= 2 ? 'high' : 'medium',
      href: `/operations/appointments?date=${new Date(a.date).toISOString().slice(0, 10)}`,
      daysRemaining: diffDays,
      isBookingAlert: true,
      bookingNumber: a.appointmentNumber,
    };
  });

  const pendingActions = [
    ...bookingAlerts,
    ...appointmentAlerts,
    ...(pending.length ? [{
      id: 'pa-settlement', title: 'Pending Cash Settlement',
      description: pending.length === 1
        ? `${pending[0].submittedByName} submitted ${pkr(n(pending[0].handoverAmount))} for safe transfer.`
        : `${pending.length} settlements awaiting verification.`,
      count: pending.length, urgency: 'high', href: '/accounts/account-settlement',
    }] : []),
    ...(unpaid ? [{
      id: 'pa-unpaid', title: 'Outstanding Client Invoices',
      description: `${unpaid} invoice(s) totaling ${pkr(metrics.outstandingReceivables)} awaiting payment collection.`,
      count: unpaid, urgency: 'medium', href: '/reports/unpaid-invoices',
    }] : []),
  ];

  return {
    branch: (await branchDTOs([branch]))[0], metrics, staffAttendanceSummary, todayAppointments, pendingActions,
    recentInvoices: invoices, recentExpenses: expenses.map(toExpenseDTO),
    onlineAccounts: accounts.map((a) => toOnlineAccountDTO(a, balances.get(a.id))),
    cashDrawers: await drawerDTOs(prisma, drawers),
    totalClientsCount,
    totalServicesCount,
    totalAppointmentsCount,
    staffList,
    revenueTrend,
    categoryBreakdown,
  };
};

// ═══ ACCOUNTANT (personal custody only) ═══════════════════════════════════════

export const accountantDashboard = async (actor, { branchId } = {}) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot view the accountant dashboard.');
  const branch = await loadBranch(actor, branchId);
  const date = await getBusinessDate();
  const scope = { branchId: branch.id };
  const me = actor.id;

  const [drawer, payments, myRefunds, expensesPaid, settlements, unpaid, receiptInvoices, disbursements, collectionEvents] = await Promise.all([
    prisma.cashDrawer.findFirst({ where: { ...scope, kind: 'DRAWER', custodianUserId: me, status: { in: ['OPEN', 'SETTLEMENT_PENDING'] } }, orderBy: { createdAt: 'desc' } }),
    prisma.invoicePayment.groupBy({ by: ['method'], where: { ...scope, date: dateOnly(date), processedByUserId: me }, _sum: { amount: true } }),
    prisma.invoiceRefund.findMany({ where: { invoice: scope, refundDate: dateOnly(date), byUserId: me }, select: { cashOut: true, method: true } }),
    prisma.expense.aggregate({ where: { ...scope, status: 'POSTED', isReversalRecord: false, paidByUserId: me }, _sum: { amount: true } }),
    prisma.settlement.findMany({ where: { ...scope, submittedByUserId: me }, orderBy: { createdAt: 'desc' } }),
    prisma.invoice.aggregate({ where: { ...scope, processedByUserId: me, lifecycle: { not: 'VOIDED' }, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { amountDue: true }, _count: true }),
    recentInvoices({ ...scope, processedByUserId: me }),
    prisma.expense.findMany({ where: { ...scope, paidByUserId: me }, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], take: 5 }),
    loadCollectionEvents(scope, date, date),
  ]);
  const d = drawer ? (await drawerDTOs(prisma, [drawer]))[0] : null;
  const pending = settlements.find((s) => s.status === 'SUBMITTED');
  const lastApproved = settlements.find((s) => s.status === 'APPROVED');
  const myCashRefunds = myRefunds.filter((r) => r.method === 'CASH').reduce((s, r) => s.plus(toDec(r.cashOut || 0)), toDec(0));
  const myOnlineRefunds = myRefunds.filter((r) => r.method === 'ONLINE_ACCOUNT').reduce((s, r) => s.plus(toDec(r.cashOut || 0)), toDec(0));
  const ownCollections = collectionEvents.filter(e => (e.kind === 'REFUND' ? e.record.byUserId
    : e.kind === 'PAYMENT_REVERSAL' ? e.record.reversedById : e.record.processedByUserId) === me);
  const todayCashCollected = collectionTotals(ownCollections.filter(e => e.record.method === 'CASH')).actualCollections;
  const todayOnlineCollected = collectionTotals(ownCollections.filter(e => e.record.method !== 'CASH')).actualCollections;

  return {
    branch: (await branchDTOs([branch]))[0],
    cashCustodyBalance: d?.expectedInDrawer ?? 0,
    expectedCashInCustody: d?.expectedInDrawer ?? 0,
    lastCountedCash: drawer?.lastCountedCash != null ? n(drawer.lastCountedCash) : lastApproved ? n(lastApproved.countedCash) : 0,
    todayCashCollected,
    todayOnlineCollected,
    expensesPaidByAccountant: n(sumOf(expensesPaid, 'amount')),
    pendingSettlementAmount: pending ? n(pending.handoverAmount) : 0,
    settlementStatus: pending ? 'PENDING_VERIFICATION' : lastApproved ? 'APPROVED_TRANSFERRED' : 'NO_PENDING',
    unpaidInvoicesCount: unpaid._count,
    unpaidInvoicesTotal: n(sumOf(unpaid, 'amountDue')),
    recentCashReceipts: receiptInvoices,
    recentDisbursements: disbursements.map(toExpenseDTO),
    activeSettlements: settlements.map(toSettlementDTO),
  };
};

// ═══ STAFF (own performance only) ═════════════════════════════════════════════

const monthBounds = (date) => {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};

export const staffDashboard = async (actor) => {
  if (!actor.staffId) throw forbidden('FORBIDDEN', 'Staff record associated with the authenticated user could not be found.');
  const staff = await prisma.staff.findUnique({ where: { id: actor.staffId }, include: { branch: true } });
  if (!staff) throw notFound('STAFF_NOT_FOUND', `Staff profile '${actor.staffId}' not found.`);
  if (!actor.branchId || staff.branchId !== actor.branchId) throw forbidden('BRANCH_FORBIDDEN', 'Staff reports require the assigned branch.');
  const date = await getBusinessDate();
  const { start, end } = monthBounds(date);
  const month = { gte: dateOnly(start), lte: dateOnly(end) };
  const sid = staff.id;

  const [events, tips, overtime, today, week, lines] = await Promise.all([
    loadCollectionEvents({ branchId: staff.branchId }, start, date),
    prisma.tipAllocation.aggregate({ where: { staffId: sid, status: { not: 'CANCELLED' }, allocationDate: month }, _sum: { amount: true } }),
    prisma.overtimeRecord.findMany({ where: { staffId: sid, workDate: month, status: 'APPROVED' } }),
    prisma.attendanceRecord.findUnique({ where: { staffId_workDate: { staffId: sid, workDate: dateOnly(date) } } }),
    prisma.attendanceRecord.findMany({ where: { staffId: sid, workDate: { gte: dateOnly(addDays(date, -6)), lte: dateOnly(date) } } }),
    prisma.invoiceLine.findMany({
      where: { OR: [{ staffId: sid }, { components: { some: { staffId: sid } } }], type: { not: 'PRODUCT' }, invoice: { branchId: staff.branchId, lifecycle: { not: 'VOIDED' } } },
      include: { invoice: { select: { date: true, clientName: true } } },
      orderBy: { invoice: { date: 'desc' } }, take: 200,
    }),
  ]);

  const earnEvents = events.flatMap(e => e.commissions).filter(c => c.staffId === sid);
  const collectedSales = events.flatMap(e => e.line.type === 'PRODUCT' ? [] : e.staffAllocations).filter(c => c.staffId === sid).reduce((sum, c) => sum.plus(c.net), toDec(0));
  const monthlyLines = lines.filter((l) => ymd(l.invoice.date) >= start && ymd(l.invoice.date) <= end);
  const earned = earnEvents.reduce((s, e) => s.plus(e.amount), toDec(0)); // Signed collection earnings and reversals
  const tipsTotal = sumOf(tips, 'amount');
  const otMinutes = overtime.reduce((s, o) => s + o.approvedMinutes, 0);
  const otPay = overtime.reduce((s, o) => s.plus(o.amount ?? 0), toDec(0));
  const baseSalary = toDec(staff.baseSalary);
  const commissionByLine = new Map();
  for (const e of earnEvents) commissionByLine.set(e.lineId, toDec(commissionByLine.get(e.lineId) ?? 0).plus(e.amount));

  return {
    staffMember: toStaffDTO(staff),
    branch: (await branchDTOs([staff.branch]))[0],
    monthlyServicesCompletedCount: monthlyLines.length,
    monthlyServiceSalesTotal: n(collectedSales),
    earnedCommissionTotal: n(earned),
    personalTipsTotal: n(tipsTotal),
    attendanceSummary: {
      todayCheckIn: today?.checkIn ?? 'Not recorded',
      scheduledHoursWeek: n(week.reduce((s, a) => s.plus(a.scheduledHours), toDec(0))),
      workedHoursWeek: n(week.reduce((s, a) => s.plus(a.workedHours), toDec(0))),
      approvedOvertimeMinutesMonth: otMinutes,
      status: today?.status ?? 'Not recorded',
    },
    monthlyEarningsSummary: {
      baseSalary: n(baseSalary), earnedCommission: n(earned), directTips: n(tipsTotal), approvedOvertimePay: n(otPay),
      estimatedGrossPayout: n(baseSalary.plus(earned).plus(tipsTotal).plus(otPay)),
    },
    recentCompletedServices: lines.slice(0, 10).map((l) => ({
      id: `rcs-${l.id}`, date: ymd(l.invoice.date), serviceName: l.name, clientName: l.invoice.clientName,
      servicePrice: n(l.netSales), commissionEarned: n(commissionByLine.get(l.id) ?? 0), tipReceived: 0,
    })),
  };
};
