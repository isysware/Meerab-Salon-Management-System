// src/modules/clients/clients.service.js
// Customer directory. Balances/visits are always DERIVED from invoices & appointments.

import { invoiceBalanceAsOf } from '../reports/collectionEvents.js';
import prisma from '../../config/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/AppError.js';
import { assertBranchAccess, resolveReadBranch, resolveWriteBranch } from '../../lib/scope.js';
import { ymd } from '../../lib/dates.js';
import { toDec } from '../../lib/money.js';
import { formatPhoneNumber, normalizePhoneDigits } from '../../lib/phone.js';
import { toClientDTO } from './clients.mapper.js';

/**
 * Derived stats per client: outstanding dues and distinct visit dates
 * (a day with an invoice or a completed appointment counts once).
 */
export const clientStats = async (clientIds, tx = prisma, actor) => {
  const stats = new Map(clientIds.map((id) => [id, { outstandingBalance: 0, totalVisits: 0, lastVisitDate: undefined }]));
  if (!clientIds.length) return stats;

  const ownSales = actor?.role === 'ACCOUNTANT' ? { processedByUserId: actor.id } : {};
  const bookings = await tx.booking.findMany({ where: { ...(actor?.role === 'ACCOUNTANT' ? { createdById: actor.id } : {}), clientId: { in: clientIds }, status: { in: ['CONFIRMED', 'IN_PROGRESS'] }, invoice: null }, include: { payments: true } });
  for (const b of bookings) {
    const s = stats.get(b.clientId);
    const paid = b.payments.reduce((sum, p) => p.isRefund ? sum.minus(p.amount) : sum.plus(p.amount), toDec(0));
    s.activeBookingsCount = (s.activeBookingsCount || 0) + 1;
    s.bookingAdvanceBalance = toDec(s.bookingAdvanceBalance || 0).plus(paid).toNumber();
    s.bookingOutstandingBalance = toDec(s.bookingOutstandingBalance || 0).plus(toDec(b.totalAmount).minus(paid)).toNumber();
  }

  const branchId = actor ? resolveReadBranch(actor) : undefined;
  const dues = await tx.invoice.findMany({
    where: { clientId: { in: clientIds }, ...ownSales, ...(branchId ? { branchId } : {}), lifecycle: { not: 'VOIDED' } },
    include: { lines: { include: { components: true } }, payments: true, refunds: { include: { lines: true } } },
  });
  for (const invoice of dues) {
    const stat = stats.get(invoice.clientId);
    stat.outstandingBalance = toDec(stat.outstandingBalance).plus(invoiceBalanceAsOf(invoice).outstanding).toNumber();
  }

  const invoiceDays = await tx.invoice.findMany({
    where: { clientId: { in: clientIds }, ...ownSales, lifecycle: { not: 'VOIDED' } }, select: { clientId: true, date: true }, distinct: ['clientId', 'date'],
  });
  const apptDays = actor?.role === 'ACCOUNTANT' ? [] : await tx.appointment.findMany({
    where: { clientId: { in: clientIds }, status: 'COMPLETED' }, select: { clientId: true, date: true }, distinct: ['clientId', 'date'],
  });
  const days = new Map();
  for (const r of [...invoiceDays, ...apptDays]) {
    if (!days.has(r.clientId)) days.set(r.clientId, new Set());
    days.get(r.clientId).add(ymd(r.date));
  }
  for (const [id, set] of days) {
    const sorted = [...set].sort();
    stats.get(id).totalVisits = sorted.length;
    stats.get(id).lastVisitDate = sorted[sorted.length - 1];
  }
  return stats;
};

const withStats = async (clients, tx, actor) => {
  const stats = await clientStats(clients.map((c) => c.id), tx, actor);
  return clients.map((c) => toClientDTO(c, stats.get(c.id)));
};

const assertNotStaff = (actor) => {
  if (actor.role === 'STAFF') throw forbidden('FORBIDDEN', 'Access Denied: Staff members cannot access customer financial records.');
};

const assertValidPhone = (raw) => {
  const norm = normalizePhoneDigits(raw);
  if (!norm || norm.length < 10) throw badRequest('INVALID_PHONE', 'A valid phone number (at least 10 digits) is required.');
  return norm;
};

// ── Queries ──────────────────────────────────────────────────────────────────

export const listClients = async (actor, { branchId, search, includeArchived } = {}) => {
  assertNotStaff(actor);
  const b = resolveReadBranch(actor, branchId);
  const digits = search ? search.replace(/\D/g, '') : '';
  const where = {
    ...(b ? { branchId: b } : {}),
    ...(includeArchived === 'false' ? { isArchived: false } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        ...(digits ? [{ phoneNormalized: { contains: normalizePhoneDigits(digits) || digits } }] : []),
        { email: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const clients = await prisma.client.findMany({ where, orderBy: { name: 'asc' } });
  return withStats(clients, prisma, actor);
};

export const getClient = async (actor, id) => {
  assertNotStaff(actor);
  const c = await prisma.client.findUnique({ where: { id } });
  if (!c) return null;
  assertBranchAccess(actor, c.branchId, 'Access Denied: Cannot access customer records from another branch.');
  return (await withStats([c], prisma, actor))[0];
};

/** POS / booking quick search: by name or any part of the phone digits. Empty query → first 10. */
export const searchClients = async (actor, { branchId, q }) => {
  assertNotStaff(actor);
  const b = resolveReadBranch(actor, branchId);
  if (!b) throw badRequest('BRANCH_REQUIRED', 'Please select a specific branch to search customers.');
  const query = (q || '').trim();
  const digits = query.replace(/\D/g, '');
  const where = {
    branchId: b,
    isArchived: false,
    ...(query ? {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        ...(digits ? [{ phoneNormalized: { contains: digits.startsWith('92') && digits.length === 12 ? `0${digits.slice(2)}` : digits } }] : []),
      ],
    } : {}),
  };
  const clients = await prisma.client.findMany({ where, orderBy: { name: 'asc' }, take: query ? 50 : 10 });
  return withStats(clients, prisma, actor);
};

// ── Commands ─────────────────────────────────────────────────────────────────

/**
 * Find a branch client by id or normalized phone, or create one (used by booking & POS too).
 * Must run inside the caller's transaction.
 */
export const findOrCreateClient = async (tx, { branchId, clientId, name, phone, email, source, sourceDetails }) => {
  let client = clientId ? await tx.client.findFirst({ where: { id: clientId, branchId } }) : null;
  if (!client) {
    const norm = assertValidPhone(phone);
    client = await tx.client.findUnique({ where: { branchId_phoneNormalized: { branchId, phoneNormalized: norm } } });
    if (!client) {
      client = await tx.client.create({
        data: {
          branchId, name, phone: formatPhoneNumber(phone), phoneNormalized: norm,
          email: email || null, source: source || 'WALK_IN', sourceDetails: sourceDetails || null,
        },
      });
    }
  }

  if ((source && !client.source) || (sourceDetails && !client.sourceDetails)) {
    client = await tx.client.update({
      where: { id: client.id },
      data: { source: client.source ?? source, sourceDetails: client.sourceDetails ?? sourceDetails },
    });
  }
  return client;
};

export const createClient = async (input, actor) => {
  const branchId = resolveWriteBranch(actor, input.branchId, 'Access Denied: Cannot create customers for another branch.');
  const norm = assertValidPhone(input.phone);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.client.findUnique({ where: { branchId_phoneNormalized: { branchId, phoneNormalized: norm } } });
    if (existing) {
      throw conflict('CLIENT_EXISTS', `A client with phone number '${input.phone}' already exists: ${existing.name}.`, { clientId: existing.id });
    }
    const c = await tx.client.create({
      data: {
        branchId,
        name:            input.name,
        phone:           formatPhoneNumber(input.phone),
        phoneNormalized: norm,
        email:           input.email || null,
        source:          input.source || 'WALK_IN',
        sourceDetails:   input.sourceDetails || null,
        loyaltyPoints:   input.loyaltyPoints ?? 0,
        notes:           input.notes || null,
      },
    });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'CLIENT_CREATED', entity: 'Client', entityId: c.id, branchId, after: c });
    return toClientDTO(c);
  });
};

export const updateClient = async (id, input, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.client.findUnique({ where: { id } });
    if (!before) throw notFound('CLIENT_NOT_FOUND', `Client '${id}' not found.`);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot modify client from another branch.');

    const data = {};
    if (input.name) data.name = input.name;
    if (input.phone) {
      const norm = assertValidPhone(input.phone);
      const clash = await tx.client.findFirst({ where: { branchId: before.branchId, phoneNormalized: norm, NOT: { id } } });
      if (clash) throw conflict('CLIENT_EXISTS', `A client with phone number '${input.phone}' already exists: ${clash.name}.`);
      data.phone = formatPhoneNumber(input.phone);
      data.phoneNormalized = norm;
    }
    if (input.email !== undefined) data.email = input.email || null;
    if (input.source) data.source = input.source;
    if (input.sourceDetails !== undefined) data.sourceDetails = input.sourceDetails || null;
    if (input.notes !== undefined) data.notes = input.notes || null;

    const c = await tx.client.update({ where: { id }, data });
    await auditLog(tx, { userId: actor.id, userName: actor.name, action: 'CLIENT_UPDATED', entity: 'Client', entityId: id, branchId: c.branchId, before, after: c });
    return (await withStats([c], tx, actor))[0];
  });
};

export const archiveClient = async (id, isArchived, actor) => {
  return prisma.$transaction(async (tx) => {
    const before = await tx.client.findUnique({ where: { id } });
    if (!before) throw notFound('CLIENT_NOT_FOUND', `Client '${id}' not found.`);
    assertBranchAccess(actor, before.branchId, 'Access Denied: Cannot archive client from another branch.');
    const c = await tx.client.update({ where: { id }, data: { isArchived } });
    await auditLog(tx, {
      userId: actor.id, userName: actor.name, action: isArchived ? 'CLIENT_ARCHIVED' : 'CLIENT_RESTORED',
      entity: 'Client', entityId: id, branchId: c.branchId,
    });
    return (await withStats([c], tx, actor))[0];
  });
};
