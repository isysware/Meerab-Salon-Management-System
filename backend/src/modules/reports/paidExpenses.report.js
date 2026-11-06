import prisma from '../../config/prisma.js';
import { forbidden } from '../../lib/AppError.js';
import { dateOnly, toDateString, toTimeString, ymd } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { resolveReportContext, formatReportResponse } from '../../lib/reportRange.js';
import { loadCollectionEvents, payoutEvents } from './collectionEvents.js';
import { loadStaffLoanMovements, STAFF_LOAN_CATEGORY } from './staffLoanMovements.js';

export const SUPPLIER_PAYMENT_CATEGORY = 'Supplier/Vendor Payment — Inventory Cash Outflow';

const n = value => round2(value ?? 0).toNumber();
const sum = (rows, field) => rows.reduce((total, row) => total.plus(row[field] ?? 0), toDec(0));

/** Paid salary and commission are separate settlements, including legacy payroll-linked commission. */
export async function loadStaffPayments(scope, to, db = prisma) {
  const paidAt = { lte: new Date(`${to}T23:59:59.999+05:00`) };
  const [salary, commission] = await Promise.all([
    db.payrollPayment.findMany({ where: { ...scope, paidAt, status: { in: ['COMPLETED', 'REVERSED'] } } }),
    db.commissionPayment.findMany({ where: { ...scope, paidAt, status: { in: ['COMPLETED', 'REVERSED'] } } }),
  ]);
  // PayrollPayment.amount is salary only. Linked commission rows represent the commission once.
  return { salary: payoutEvents(salary), commission: payoutEvents(commission) };
}

export async function detailedExpensesReport(actor, query = {}) {
  if (!['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(actor.role)) throw forbidden('FORBIDDEN', 'Access Denied: Financial reports are restricted.');
  const ctx = await resolveReportContext(actor, query, 'PAYMENT_DATE');
  const scope = ctx.branchId ? { branchId: ctx.branchId } : {};
  const admin = ['SUPER_ADMIN', 'ADMIN'].includes(actor.role);
  const [
    expenses,
    branches,
    categories,
    payments,
    slips,
    commissions,
    rawSupplierPayments,
    drawerRefundMovements,
    accountRefundMovements,
    rawSupplierReturns,
    paymentAccounts,
  ] = await Promise.all([
    prisma.expense.findMany({ where: { ...scope, expenseDate: { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) },
      ...(actor.role === 'ACCOUNTANT' ? { OR: [{ paidByUserId: actor.id }, { createdByUserId: actor.id }] } : {}) } }),
    prisma.branch.findMany({ where: ctx.branchId ? { id: ctx.branchId } : {}, select: { id: true, name: true } }),
    prisma.expenseCategory.findMany({ where: { ...scope, isActive: true }, select: { name: true } }),
    admin ? loadStaffPayments(scope, ctx.toStr) : { salary: [], commission: [] },
    admin ? prisma.payslip.findMany({ where: { run: { ...scope, finalizedAt: { lte: ctx.toDate },
      OR: [{ cancelledAt: null }, { cancelledAt: { gt: ctx.toDate } }] } }, include: { run: true } }) : [],
    admin ? loadCollectionEvents(scope, null, ctx.toStr) : [],
    prisma.supplierPayment.findMany({
      where: {
        ...scope,
        OR: [
          { paymentDate: { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) } },
          { reversalDate: { gte: dateOnly(ctx.fromStr), lte: dateOnly(ctx.toStr) } },
          { reversedAt: { gte: ctx.fromDate, lte: ctx.toDate } },
        ],
        ...(actor.role === 'ACCOUNTANT' ? { paidById: actor.id } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    }),
    prisma.drawerMovement?.findMany
      ? prisma.drawerMovement.findMany({
          where: {
            ...scope,
            type: 'SUPPLIER_REFUND',
            createdAt: { gte: ctx.fromDate, lte: ctx.toDate },
            ...(actor.role === 'ACCOUNTANT' ? { userId: actor.id } : {}),
          },
        })
      : Promise.resolve([]),
    prisma.accountMovement?.findMany
      ? prisma.accountMovement.findMany({
          where: {
            ...scope,
            type: 'SUPPLIER_REFUND',
            createdAt: { gte: ctx.fromDate, lte: ctx.toDate },
            ...(actor.role === 'ACCOUNTANT' ? { userId: actor.id } : {}),
          },
        })
      : Promise.resolve([]),
    prisma.supplierReturn?.findMany
      ? prisma.supplierReturn.findMany({
          where: {
            ...scope,
            refundTreatment: { in: ['CASH_REFUND', 'ONLINE_REFUND'] },
          },
          include: {
            supplier: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.paymentAccount.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(branches.map(b => [b.id, b.name]));
  const accountNames = new Map(paymentAccounts.map(a => [a.id, a.name]));
  const loans = admin ? await loadStaffLoanMovements(scope, ctx.fromDate, ctx.toDate) : [];
  const rawRows = expenses.map(e => ({
    ...e, date: e.expenseDate.toISOString().slice(0, 10), branchName: names.get(e.branchId) || 'Branch',
    // Original paid voucher remains positive; its separately dated reversal is negative.
    amount: n(toDec(e.amount).times(e.isReversalRecord ? -1 : 1)),
    paidAmount: e.status === 'DRAFT' ? 0 : n(toDec(e.amount).times(e.isReversalRecord ? -1 : 1)),
    status: e.isReversalRecord ? 'REVERSED' : e.status === 'DRAFT' ? 'DRAFT' : 'POSTED',
    sourceType: 'OPERATING_EXPENSE', externalReference: e.externalReference || '', notes: e.notes || '',
    description: e.description || '', reversalReason: e.reversalReason || '', reversedByName: e.reversedByName || '',
  }));
  for (const [sourceType, events] of [['SALARY', payments.salary], ['COMMISSION', payments.commission]]) {
    for (const p of events.filter(p => p.date >= ctx.fromStr && p.date <= ctx.toStr)) rawRows.push({
      id: `${sourceType}-${p.eventId}`, voucherNumber: p.paymentNumber, date: p.date, time: '',
      branchId: p.branchId, branchName: names.get(p.branchId) || 'Branch', category: sourceType === 'SALARY' ? 'Payroll & Salaries' : 'Staff Commission',
      title: `${p.reversal ? 'Reversal: ' : ''}${sourceType === 'SALARY' ? 'Salary' : 'Commission'} payment`,
      payee: p.staffName, description: `${p.reversal ? 'Reversal of ' : ''}${p.paymentNumber}`,
      sourceType, amount: n(p.signedAmount), paidAmount: n(p.signedAmount),
      paymentSource: p.method === 'CASH' ? 'CASH_DRAWER' : 'ONLINE_ACCOUNT',
      paymentAccountId: p.onlineAccountId, paymentAccountName: p.onlineAccountName,
      status: p.reversal ? 'REVERSED' : 'POSTED', externalReference: p.reference || '', notes: p.notes || '',
      createdByUserId: p.paidByUserId, createdByName: p.paidByName, paidByName: p.paidByName,
      isReversalRecord: p.reversal, reversalReason: p.reversalReason || '', reversedByName: p.reversedByName || '',
    });
  }
  for (const sp of rawSupplierPayments) {
    const spDate = ymd(sp.paymentDate);
    const supplierName = sp.supplier?.name || 'Supplier';
    const accName = sp.paymentAccountId ? accountNames.get(sp.paymentAccountId) : null;
    const allocations = Array.isArray(sp.allocations) ? sp.allocations : [];
    const purchaseRef = sp.reference || allocations[0]?.invoiceNumber || '';
    if (spDate && spDate >= ctx.fromStr && spDate <= ctx.toStr) {
      rawRows.push({
        id: `sp-${sp.id}`,
        voucherNumber: sp.paymentNumber,
        date: spDate,
        time: sp.createdAt ? toTimeString(sp.createdAt) : '',
        branchId: sp.branchId,
        branchName: names.get(sp.branchId) || 'Branch',
        category: SUPPLIER_PAYMENT_CATEGORY,
        title: `Supplier Payment — ${supplierName}`,
        payee: supplierName,
        description: `Supplier payment to ${supplierName} (${sp.paymentNumber}${purchaseRef ? ` · Ref: ${purchaseRef}` : ''}${sp.notes ? ` · ${sp.notes}` : ''})`,
        sourceType: 'SUPPLIER_PAYMENT',
        amount: n(sp.amount),
        paidAmount: n(sp.amount),
        paymentSource: sp.method === 'CASH' ? 'CASH_DRAWER' : 'ONLINE_ACCOUNT',
        paymentAccountId: sp.paymentAccountId || null,
        paymentAccountName: accName || (sp.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
        status: 'POSTED',
        externalReference: purchaseRef,
        notes: sp.notes || '',
        createdByUserId: sp.paidById,
        createdByName: sp.paidByName,
        paidByName: sp.paidByName,
        isReversalRecord: false,
        reversalReason: '',
        reversedByName: '',
      });
    }
    if (sp.reversedAt) {
      const revDate = ymd(sp.reversalDate) || toDateString(sp.reversedAt);
      if (revDate >= ctx.fromStr && revDate <= ctx.toStr) {
        rawRows.push({
          id: `sp-${sp.id}-rev`,
          voucherNumber: `${sp.paymentNumber}-REV`,
          date: revDate,
          time: toTimeString(sp.reversedAt),
          branchId: sp.branchId,
          branchName: names.get(sp.branchId) || 'Branch',
          category: SUPPLIER_PAYMENT_CATEGORY,
          title: `Reversal: Supplier Payment — ${supplierName}`,
          payee: supplierName,
          description: `Reversal of supplier payment ${sp.paymentNumber} to ${supplierName}${sp.reversalReason ? ` · Reason: ${sp.reversalReason}` : ''}`,
          sourceType: 'SUPPLIER_PAYMENT',
          amount: -n(sp.amount),
          paidAmount: -n(sp.amount),
          paymentSource: sp.method === 'CASH' ? 'CASH_DRAWER' : 'ONLINE_ACCOUNT',
          paymentAccountId: sp.paymentAccountId || null,
          paymentAccountName: accName || (sp.method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
          status: 'REVERSED',
          externalReference: purchaseRef,
          notes: sp.notes || '',
          createdByUserId: sp.reversedById || sp.paidById,
          createdByName: sp.reversedByName || sp.paidByName,
          paidByName: sp.reversedByName || sp.paidByName,
          isReversalRecord: true,
          reversalReason: sp.reversalReason || '',
          reversedByName: sp.reversedByName || '',
        });
      }
    }
  }
  const returnMap = new Map();
  for (const ret of rawSupplierReturns) {
    if (ret.id) returnMap.set(ret.id, ret);
    if (ret.returnNumber) returnMap.set(ret.returnNumber, ret);
  }

  for (const [method, movements] of [['CASH', drawerRefundMovements], ['ONLINE', accountRefundMovements]]) {
    for (const m of movements) {
      const refDate = toDateString(m.createdAt) || ymd(m.createdAt);
      if (refDate >= ctx.fromStr && refDate <= ctx.toStr) {
        const ret = (m.sourceId && returnMap.get(m.sourceId)) || (m.reference && returnMap.get(m.reference));
        const supplierName = ret?.supplier?.name || m.description?.replace(/^Supplier refund (?:from\s+)?/, '').split(' for ')[0]?.split(' · ')[0] || 'Supplier';
        const purchaseRef = ret?.purchaseNumber || m.reference || '';
        const amt = n(toDec(m.amount));
        const accName = m.accountId ? accountNames.get(m.accountId) : null;
        rawRows.push({
          id: `sr-${m.id}`,
          voucherNumber: m.reference || ret?.returnNumber || 'SR-REFUND',
          date: refDate,
          time: toTimeString(m.createdAt),
          branchId: m.branchId,
          branchName: names.get(m.branchId) || 'Branch',
          category: SUPPLIER_PAYMENT_CATEGORY,
          title: `Supplier Refund Received — ${supplierName}`,
          payee: supplierName,
          description: m.description || `Supplier refund received from ${supplierName} (${m.reference}${purchaseRef ? ` · Ref: ${purchaseRef}` : ''})`,
          sourceType: 'SUPPLIER_REFUND',
          amount: -amt,
          paidAmount: -amt,
          paymentSource: method === 'CASH' ? 'CASH_DRAWER' : 'ONLINE_ACCOUNT',
          paymentAccountId: method === 'CASH' ? null : (m.accountId || null),
          paymentAccountName: accName || (method === 'CASH' ? 'Cash Drawer' : 'Online Account'),
          status: 'POSTED',
          externalReference: purchaseRef,
          notes: ret?.notes || '',
          createdByUserId: m.userId,
          createdByName: m.userName,
          paidByName: m.userName,
          isReversalRecord: false,
          reversalReason: '',
          reversedByName: '',
        });
      }
    }
  }
  const search = query.search?.trim().toLowerCase();
  for (const m of loans) rawRows.push({
    id: m.id, voucherNumber: m.reference, date: m.date, time: '', branchId: m.branchId,
    branchName: names.get(m.branchId) || 'Branch', category: STAFF_LOAN_CATEGORY,
    title: m.direction === 'IN' ? 'Staff Loan Disbursement Reversal' : 'Staff Loan Disbursement',
    payee: '', description: m.description || '', sourceType: 'STAFF_LOAN',
    amount: m.signedOutflow, paidAmount: m.signedOutflow, paymentSource: m.paymentSource,
    paymentAccountId: m.accountId, paymentAccountName: m.account?.name,
    status: m.direction === 'IN' ? 'REVERSED' : 'POSTED', externalReference: m.reference || '', notes: '',
    createdByUserId: m.userId, createdByName: m.userName, paidByName: m.userName,
    isReversalRecord: m.direction === 'IN', reversalReason: '', reversedByName: '',
  });
  const rows = rawRows.filter(r => (!query.category || query.category === 'ALL' || r.category === query.category)
    && (query.status && query.status !== 'ALL' ? r.status === query.status : r.status !== 'DRAFT' || query.status === 'ALL')
    && (!query.paymentSource || query.paymentSource === 'ALL' || r.paymentSource === query.paymentSource)
    && (!query.paymentAccountId || query.paymentAccountId === 'ALL' || r.paymentAccountId === query.paymentAccountId)
    && (!query.createdByUserId || query.createdByUserId === 'ALL' || r.createdByUserId === query.createdByUserId)
    && (!search || [r.voucherNumber, r.title, r.payee, r.category, r.branchName, r.createdByName, r.externalReference, ...(r.sourceType === 'STAFF_LOAN' ? [r.description] : [])].some(v => v?.toLowerCase().includes(search))))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const cash = sum(rows.filter(r => r.paymentSource === 'CASH_DRAWER'), 'paidAmount');
  const online = sum(rows.filter(r => r.paymentSource !== 'CASH_DRAWER'), 'paidAmount');
  const total = cash.plus(online);
  const operatingRows = rows.filter(r => r.sourceType !== 'STAFF_LOAN' && r.sourceType !== 'SUPPLIER_PAYMENT' && r.sourceType !== 'SUPPLIER_REFUND');
  const nonOperatingCashOutflow = n(sum(rows.filter(r => r.sourceType === 'STAFF_LOAN'), 'paidAmount'));
  const supplierRows = rows.filter(r => r.sourceType === 'SUPPLIER_PAYMENT' || r.sourceType === 'SUPPLIER_REFUND');
  const supplierPayments = n(sum(supplierRows, 'paidAmount'));
  const supplierGrossPayments = n(sum(rows.filter(r => r.sourceType === 'SUPPLIER_PAYMENT' && !r.isReversalRecord), 'paidAmount'));
  const supplierReversals = n(sum(rows.filter(r => r.sourceType === 'SUPPLIER_PAYMENT' && r.isReversalRecord), 'paidAmount').abs());
  const supplierRefunds = n(sum(rows.filter(r => r.sourceType === 'SUPPLIER_REFUND'), 'paidAmount').abs());
  const totalDisbursementReversals = n(sum(rows.filter(r => r.status === 'REVERSED' || r.isReversalRecord), 'paidAmount').abs());
  const categoryNames = [...new Set(rows.map(r => r.category))];
  const accountIds = [...new Set(rows.filter(r => r.paymentSource === 'ONLINE_ACCOUNT').map(r => r.paymentAccountId || 'online'))];
  const onlineAccounts = accountIds.map(id => {
    const selected = rows.filter(r => r.paymentSource === 'ONLINE_ACCOUNT' && (r.paymentAccountId || 'online') === id);
    return { accountId: id, accountName: selected[0]?.paymentAccountName || 'Online Account', amount: n(sum(selected, 'paidAmount')), count: selected.length };
  });
  const salaryPayable = sum(slips, 'netPayable').minus(sum(payments.salary.filter(p => p.date <= ctx.toStr), 'signedAmount'));
  const commissionEarned = commissions.reduce((total, e) => total.plus(e.commissions.reduce((s, c) => s.plus(c.amount), toDec(0))), toDec(0));
  const commissionPayable = commissionEarned.minus(sum(payments.commission.filter(p => p.date <= ctx.toStr), 'signedAmount'));
  return formatReportResponse({ ...ctx.meta, liabilityBasis: 'Branch closing liabilities at period end; not reduced by table filters.' }, {
    rows, categories: [...new Set([...categories.map(c => c.name), ...rawRows.map(r => r.category)])].sort(),
    kpis: {
      totalExpenses: n(sum(operatingRows, 'paidAmount')),
      cashExpenses: n(sum(operatingRows.filter(r => r.paymentSource === 'CASH_DRAWER'), 'paidAmount')),
      onlineExpenses: n(sum(operatingRows.filter(r => r.paymentSource !== 'CASH_DRAWER'), 'paidAmount')),
      nonOperatingCashOutflow,
      supplierPayments,
      supplierCashOutflow: supplierPayments,
      supplierGrossPayments,
      supplierReversals,
      supplierRefunds,
      totalCashOutflow: n(total),
      totalVouchersCount: rows.length,
      totalPostedAmount: n(sum(operatingRows.filter(r => r.status === 'POSTED'), 'paidAmount')),
      totalReversedAmount: totalDisbursementReversals,
      postedCount: rows.filter(r => r.status === 'POSTED').length,
      reversedCount: rows.filter(r => r.status === 'REVERSED').length,
      draftCount: rows.filter(r => r.status === 'DRAFT').length,
      categoryCount: categoryNames.length,
      paidSalaries: n(sum(rows.filter(r => r.sourceType === 'SALARY'), 'paidAmount')),
      paidCommissions: n(sum(rows.filter(r => r.sourceType === 'COMMISSION'), 'paidAmount')),
      ...(admin ? { unpaidSalaries: n(salaryPayable), unpaidCommissions: n(commissionPayable) } : {}),
    },
    liabilities: admin ? { unpaidSalaries: n(salaryPayable), unpaidCommissions: n(commissionPayable) } : undefined,
    tenderBreakdown: { totalCash: n(cash), totalOnline: n(online), grandTotal: n(total), onlineAccounts },
    categoryBreakdown: categoryNames.map(categoryName => ({ categoryName, amount: n(sum(rows.filter(r => r.category === categoryName), 'paidAmount')) })),
    totals: {
      amount: n(total),
      cash: n(cash),
      online: n(online),
      operatingExpenses: n(sum(operatingRows, 'paidAmount')),
      nonOperatingCashOutflow,
      supplierPayments,
      supplierCashOutflow: supplierPayments,
      supplierGrossPayments,
      supplierReversals,
      supplierRefunds,
      totalCashOutflow: n(total),
    },
  });
}
