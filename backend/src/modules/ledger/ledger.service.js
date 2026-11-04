// src/modules/ledger/ledger.service.js
import prisma from '../../config/prisma.js';
import { resolveReadBranch } from '../../lib/scope.js';
import { startOfDay, endOfDay, toDateString } from '../../lib/dates.js';
import { toDec, round2, toNum } from '../../lib/money.js';

export const getGeneralLedger = async (actor, query) => {
  const branchId = resolveReadBranch(actor, query.branchId);
  const fromDate = query.from || query.startDate;
  const toDate = query.to || query.endDate;
  const channel = query.channel || 'ALL';

  const includeCash = channel === 'ALL' || channel === 'CASH';
  const includeBank = channel === 'ALL' || channel === 'BANK';

  // Base scope filters
  const drawerWhere = {};
  const accountWhere = {};

  if (branchId) {
    drawerWhere.branchId = branchId;
    accountWhere.branchId = branchId;
  }
  if (query.source) {
    const s = query.source.toUpperCase();
    drawerWhere.sourceModule = { equals: s, mode: 'insensitive' };
    accountWhere.sourceModule = { equals: s, mode: 'insensitive' };
  }
  if (query.direction) {
    drawerWhere.direction = query.direction;
    accountWhere.direction = query.direction;
  }
  if (query.drawerId) {
    drawerWhere.drawerId = query.drawerId;
  }
  if (query.accountId) {
    accountWhere.accountId = query.accountId;
  }
  if (query.search) {
    const s = query.search.trim();
    const searchCondition = [
      { description: { contains: s, mode: 'insensitive' } },
      { reference:   { contains: s, mode: 'insensitive' } },
      { userName:    { contains: s, mode: 'insensitive' } },
    ];
    drawerWhere.OR = searchCondition;
    accountWhere.OR = searchCondition;
  }

  // Calculate opening balance
  let openingBalance = toDec(0);
  if (includeBank && !query.drawerId) {
    const accWhere = {};
    if (branchId) accWhere.branchId = branchId;
    if (query.accountId) accWhere.id = query.accountId;
    const initialAccs = await prisma.paymentAccount.aggregate({
      _sum: { openingBalance: true },
      where: accWhere,
    });
    openingBalance = openingBalance.plus(toDec(initialAccs._sum.openingBalance ?? 0));
  }

  if (fromDate) {
    const priorDate = startOfDay(fromDate);

    const [priorDrawerIn, priorDrawerOut, priorAccountIn, priorAccountOut] = await Promise.all([
      includeCash && !query.accountId
        ? prisma.drawerMovement.aggregate({
            _sum: { amount: true },
            where: {
              ...(branchId ? { branchId } : {}),
              ...(query.drawerId ? { drawerId: query.drawerId } : {}),
              direction: 'IN',
              createdAt: { lt: priorDate },
            },
          })
        : { _sum: { amount: 0 } },
      includeCash && !query.accountId
        ? prisma.drawerMovement.aggregate({
            _sum: { amount: true },
            where: {
              ...(branchId ? { branchId } : {}),
              ...(query.drawerId ? { drawerId: query.drawerId } : {}),
              direction: 'OUT',
              createdAt: { lt: priorDate },
            },
          })
        : { _sum: { amount: 0 } },
      includeBank && !query.drawerId
        ? prisma.accountMovement.aggregate({
            _sum: { amount: true },
            where: {
              ...(branchId ? { branchId } : {}),
              ...(query.accountId ? { accountId: query.accountId } : {}),
              direction: 'IN',
              createdAt: { lt: priorDate },
            },
          })
        : { _sum: { amount: 0 } },
      includeBank && !query.drawerId
        ? prisma.accountMovement.aggregate({
            _sum: { amount: true },
            where: {
              ...(branchId ? { branchId } : {}),
              ...(query.accountId ? { accountId: query.accountId } : {}),
              direction: 'OUT',
              createdAt: { lt: priorDate },
            },
          })
        : { _sum: { amount: 0 } },
    ]);

    const cashPrior = toDec(priorDrawerIn._sum.amount ?? 0).minus(toDec(priorDrawerOut._sum.amount ?? 0));
    const bankPrior = toDec(priorAccountIn._sum.amount ?? 0).minus(toDec(priorAccountOut._sum.amount ?? 0));
    openingBalance = openingBalance.plus(cashPrior).plus(bankPrior);
  }

  // Date filters for in-period movements
  if (fromDate || toDate) {
    const dateFilter = {};
    if (fromDate) {
      dateFilter.gte = startOfDay(fromDate);
    }
    if (toDate) {
      dateFilter.lte = endOfDay(toDate);
    }
    drawerWhere.createdAt = dateFilter;
    accountWhere.createdAt = dateFilter;
  }

  // Fetch movements and master data for names
  const [drawerMovements, accountMovements, branches, drawers, paymentAccounts] = await Promise.all([
    includeCash && !query.accountId
      ? prisma.drawerMovement.findMany({ where: drawerWhere, orderBy: { createdAt: 'asc' } })
      : [],
    includeBank && !query.drawerId
      ? prisma.accountMovement.findMany({ where: accountWhere, orderBy: { createdAt: 'asc' } })
      : [],
    prisma.branch.findMany({ select: { id: true, name: true, code: true } }),
    prisma.cashDrawer.findMany({ select: { id: true, kind: true, custodianName: true } }),
    prisma.paymentAccount.findMany({ select: { id: true, name: true, providerName: true } }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, b]));
  const drawerMap = new Map(drawers.map((d) => [d.id, d.kind === 'VAULT' ? 'Branch Vault' : `Drawer (${d.custodianName})`]));
  const accountMap = new Map(paymentAccounts.map((a) => [a.id, `${a.name} (${a.providerName})`]));

  // Unify and standardize rows
  const cashRows = drawerMovements.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    date: toDateString(m.createdAt),
    channel: 'CASH',
    branchId: m.branchId,
    branchName: branchMap.get(m.branchId)?.name ?? 'Unknown Branch',
    holderId: m.drawerId,
    holderName: drawerMap.get(m.drawerId) ?? 'Cash Drawer',
    type: m.type,
    direction: m.direction,
    amount: round2(m.amount).toNumber(),
    signedAmount: m.direction === 'IN' ? round2(m.amount).toNumber() : -round2(m.amount).toNumber(),
    sourceModule: m.sourceModule,
    sourceId: m.sourceId,
    reference: m.reference,
    description: m.description,
    userId: m.userId,
    userName: m.userName,
  }));

  const bankRows = accountMovements.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    date: toDateString(m.createdAt),
    channel: 'BANK',
    branchId: m.branchId,
    branchName: branchMap.get(m.branchId)?.name ?? 'Unknown Branch',
    holderId: m.accountId,
    holderName: accountMap.get(m.accountId) ?? 'Payment Account',
    type: m.type,
    direction: m.direction,
    amount: round2(m.amount).toNumber(),
    signedAmount: m.direction === 'IN' ? round2(m.amount).toNumber() : -round2(m.amount).toNumber(),
    sourceModule: m.sourceModule,
    sourceId: m.sourceId,
    reference: m.reference,
    description: m.description,
    userId: m.userId,
    userName: m.userName,
  }));

  // Sort unified chronological movements ascending to calculate running balance
  const allMovements = [...cashRows, ...bankRows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  let currentBalance = toDec(openingBalance);
  let totalIn = toDec(0);
  let totalOut = toDec(0);

  const calculatedRows = allMovements.map((row) => {
    const amt = toDec(row.amount);
    if (row.direction === 'IN') {
      currentBalance = currentBalance.plus(amt);
      totalIn = totalIn.plus(amt);
    } else {
      currentBalance = currentBalance.minus(amt);
      totalOut = totalOut.plus(amt);
    }
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      balanceAfter: round2(currentBalance).toNumber(),
    };
  });

  const netMovement = totalIn.minus(totalOut);
  const closingBalance = openingBalance.plus(netMovement);

  // Default display order: newest first (descending)
  const displayRows = [...calculatedRows].reverse();

  // Pagination
  const page = query.page || 1;
  const limit = query.limit || 100;
  const skip = (page - 1) * limit;
  const paginatedRows = displayRows.slice(skip, skip + limit);

  return {
    movements: paginatedRows,
    summary: {
      openingBalance: toNum(round2(openingBalance)),
      totalIn:        toNum(round2(totalIn)),
      totalOut:       toNum(round2(totalOut)),
      netMovement:    toNum(round2(netMovement)),
      closingBalance: toNum(round2(closingBalance)),
      count:          allMovements.length,
    },
    pagination: {
      page,
      limit,
      total: allMovements.length,
      totalPages: Math.ceil(allMovements.length / limit) || 1,
    },
  };
};
