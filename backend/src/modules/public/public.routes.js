// src/modules/public/public.routes.js
// Safe, customer-accessible HTTPS receipt download & verification endpoints with compact cryptographically secure tokens.

import { Router } from 'express';
import prisma from '../../config/prisma.js';
import { ymd } from '../../lib/dates.js';
import { toDec, toNum } from '../../lib/money.js';
import { normalizePhoneDigits } from '../../lib/phone.js';
import {
  generateReceiptKey,
  verifyReceiptKey,
  createReceiptToken,
  verifyReceiptToken,
  getPublicBaseUrl,
  formatReceiptWhatsAppMessage,
} from './receiptTokens.js';
import { generateServerReceiptPdf } from './receiptPdfGenerator.js';

const publicRoutes = Router();

// Helper to sanitize invoice into customer receipt snapshot
async function formatInvoiceSnapshot(invoice) {
  const branch = await prisma.branch.findUnique({ where: { id: invoice.branchId } });
  const isBkg = Boolean(invoice.isBookingInvoice || invoice.invoiceNumber?.startsWith('BKG'));

  return {
    id: invoice.id,
    type: isBkg ? 'BOOKING_INVOICE' : 'POS_INVOICE',
    invoiceNumber: invoice.invoiceNumber,
    bookingNumber: invoice.isBookingInvoice ? invoice.invoiceNumber : null,
    bookingType: invoice.bookingType || null,
    date: ymd(invoice.date),
    time: invoice.time || null,
    clientName: invoice.clientName || 'Walk-in Customer',
    clientPhone: invoice.clientPhone || '',
    lifecycle: invoice.lifecycle,
    status: invoice.status,
    branch: branch ? {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      city: branch.city,
      phone: branch.phone,
      taxAuthority: branch.taxAuthority,
      taxRegistrationNumber: branch.taxRegistrationNumber,
    } : null,
    lines: (invoice.lines || []).map((l, idx) => ({
      id: l.id || `line-${idx}`,
      name: l.name,
      type: l.type,
      quantity: l.quantity,
      unitPrice: toNum(l.unitPrice),
      netSales: toNum(l.netSales),
      discountAllocated: toNum(l.discountAllocated),
      total: toNum(l.totalPrice || toDec(l.unitPrice).times(l.quantity)),
      components: (l.components || []).map((c) => ({
        serviceName: c.serviceName,
      })),
    })),
    subtotal: toNum(invoice.subtotal),
    discount: toNum(invoice.discount),
    tax: toNum(invoice.tax),
    tip: toNum(invoice.tip),
    total: toNum(invoice.total),
    amountPaid: toNum(invoice.amountPaid),
    amountDue: toNum(invoice.amountDue),
    advanceAdjusted: toNum(invoice.advanceAdjusted),
    totalAdvanceReceived: toNum(invoice.totalAdvanceReceived),
    payments: (invoice.payments || []).map((p) => ({
      receiptNumber: p.receiptNumber,
      date: ymd(p.date),
      time: p.time,
      method: p.method,
      amount: toNum(p.amount),
    })),
  };
}

// Helper to sanitize booking into customer receipt snapshot
async function formatBookingSnapshot(booking) {
  const branch = await prisma.branch.findUnique({ where: { id: booking.branchId } });
  const advancePaid = (booking.payments || []).reduce((sum, p) => {
    const amt = toDec(p.amount);
    return p.isRefund ? sum.minus(amt) : sum.plus(amt);
  }, toDec(0));

  const totalAmount = toDec(booking.totalAmount || 0);
  const remainingBalance = booking.remainingBalance != null
    ? toDec(booking.remainingBalance)
    : totalAmount.minus(advancePaid);

  return {
    id: booking.id,
    type: 'BOOKING_INVOICE',
    invoiceNumber: booking.bookingNumber,
    bookingNumber: booking.bookingNumber,
    bookingType: booking.type,
    date: ymd(booking.eventDate),
    time: booking.serviceTime || null,
    clientName: booking.clientName,
    clientPhone: booking.clientPhone,
    status: booking.status,
    lifecycle: booking.status === 'CANCELLED' ? 'VOIDED' : 'ACTIVE',
    paymentStatus: remainingBalance.lte(0) ? 'FULLY_PAID' : advancePaid.gt(0) ? 'PARTIALLY_PAID' : 'UNPAID',
    branch: branch ? {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      city: branch.city,
      phone: branch.phone,
      taxAuthority: branch.taxAuthority,
      taxRegistrationNumber: branch.taxRegistrationNumber,
    } : null,
    lines: (booking.items || []).map((it, idx) => ({
      id: it.id || `item-${idx}`,
      name: it.name,
      type: it.type || 'SERVICE',
      quantity: it.quantity || 1,
      unitPrice: toNum(it.unitPrice),
      total: toDec(it.unitPrice).times(it.quantity || 1).toNumber(),
      components: (it.components || []).map((c) => ({
        serviceName: c.serviceName,
      })),
    })),
    subtotal: toNum(booking.subtotal),
    discount: toNum(booking.discount),
    tax: toNum(booking.taxAmount),
    tip: 0,
    total: totalAmount.toNumber(),
    amountPaid: advancePaid.toNumber(),
    amountDue: Math.max(0, remainingBalance.toNumber()),
    payments: (booking.payments || []).map((p) => ({
      receiptNumber: p.receiptNumber,
      date: ymd(p.date),
      time: p.time,
      method: p.method,
      isRefund: p.isRefund,
      amount: toNum(p.amount),
    })),
  };
}

// ── 1. Generate Secure Link (Used when staff clicks "Send WhatsApp") ────────
publicRoutes.post(['/receipt-link', '/receipts/link'], async (req, res) => {
  try {
    const { invoiceId, bookingId, reference } = req.body || {};
    const ref = invoiceId || bookingId || reference;

    if (!ref) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invoice or booking reference is required.' } });
    }

    // Try finding invoice first
    let record = await prisma.invoice.findFirst({
      where: {
        OR: [{ id: ref }, { invoiceNumber: ref }],
      },
      include: {
        lines: { include: { components: true } },
        payments: { where: { reversedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });

    let type = 'INVOICE';
    let snapshot = null;

    if (record) {
      if (record.lifecycle === 'VOIDED') {
        return res.status(400).json({ error: { code: 'INVOICE_VOIDED', message: 'Cannot generate receipt link for a voided invoice.' } });
      }
      snapshot = await formatInvoiceSnapshot(record);
    } else {
      // Try finding booking
      const bkg = await prisma.booking.findFirst({
        where: {
          OR: [{ id: ref }, { bookingNumber: ref }],
        },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!bkg) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Invoice or booking '${ref}' not found.` } });
      }

      if (bkg.status === 'CANCELLED') {
        return res.status(400).json({ error: { code: 'BOOKING_CANCELLED', message: 'Cannot generate receipt link for a cancelled booking.' } });
      }

      record = bkg;
      type = 'BOOKING';
      snapshot = await formatBookingSnapshot(record);
    }

    // Generate short, cryptographically unguessable HMAC key (16 hex chars)
    const key = generateReceiptKey(record.id, snapshot.invoiceNumber);

    // Also generate backward-compatible JWT token
    const token = createReceiptToken({
      recordId: record.id,
      type,
      invoiceNumber: snapshot.invoiceNumber,
    });

    const baseUrl = getPublicBaseUrl(req);
    // Compact, elegant customer URL: https://domain/receipt/BKG-0022?k=5e71d768ab953732
    const shortReceiptUrl = `${baseUrl}/receipt/${encodeURIComponent(snapshot.invoiceNumber)}?k=${key}`;
    const directPdfUrl = `${baseUrl}/api/v1/public/receipts/pdf?ref=${encodeURIComponent(snapshot.invoiceNumber)}&k=${key}`;
    const whatsappMessage = formatReceiptWhatsAppMessage(snapshot, shortReceiptUrl);

    // Normalize phone number for WhatsApp
    const digits = normalizePhoneDigits(snapshot.clientPhone || '');
    const cleanPhone = digits.startsWith('92')
      ? digits
      : digits.startsWith('0')
      ? `92${digits.slice(1)}`
      : digits.length === 10 && digits.startsWith('3')
      ? `92${digits}`
      : digits;

    return res.status(200).json({
      data: {
        key,
        token,
        receiptUrl: shortReceiptUrl,
        directPdfUrl,
        whatsappMessage,
        cleanPhone,
        invoiceNumber: snapshot.invoiceNumber,
        clientName: snapshot.clientName,
      },
    });
  } catch (err) {
    console.error('Failed to generate receipt link:', err);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to generate receipt link.' } });
  }
});

// Helper to resolve and verify record by either token OR compact key
async function resolveVerifiedRecord(query, params = {}) {
  const token = query.token;
  const key = query.k || query.key;
  let ref = (params.reference || query.ref || query.reference || '').trim();
  if (ref.toLowerCase() === 'download' || ref.toLowerCase() === 'verify') {
    ref = (query.ref || query.reference || '').trim();
  }

  // Mode 1: Compact HMAC key verification
  if (key && ref) {
    const inv = await prisma.invoice.findFirst({
      where: { OR: [{ invoiceNumber: { equals: ref, mode: 'insensitive' } }, { id: ref }] },
      include: {
        lines: { include: { components: true } },
        payments: { where: { reversedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (inv) {
      if (!verifyReceiptKey(inv.id, inv.invoiceNumber, key)) {
        return { valid: false, statusCode: 403, error: 'INVALID_KEY', message: 'Invalid receipt verification key.' };
      }
      if (inv.lifecycle === 'VOIDED') {
        return { valid: false, statusCode: 404, error: 'RECEIPT_VOIDED', message: 'Invoice receipt is voided.' };
      }
      return { valid: true, snapshot: await formatInvoiceSnapshot(inv) };
    }

    const bkg = await prisma.booking.findFirst({
      where: { OR: [{ bookingNumber: { equals: ref, mode: 'insensitive' } }, { id: ref }] },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (bkg) {
      if (!verifyReceiptKey(bkg.id, bkg.bookingNumber, key)) {
        return { valid: false, statusCode: 403, error: 'INVALID_KEY', message: 'Invalid receipt verification key.' };
      }
      if (bkg.status === 'CANCELLED') {
        return { valid: false, statusCode: 404, error: 'RECEIPT_CANCELLED', message: 'Booking has been cancelled.' };
      }
      return { valid: true, snapshot: await formatBookingSnapshot(bkg) };
    }

    return { valid: false, statusCode: 404, error: 'NOT_FOUND', message: `Receipt '${ref}' not found.` };
  }

  // Mode 2: JWT token verification
  if (token) {
    const verification = verifyReceiptToken(token);
    if (!verification.valid) {
      const statusCode = verification.error === 'EXPIRED_TOKEN' ? 410 : 403;
      return { valid: false, statusCode, error: verification.error, message: verification.message };
    }

    const { sub, receiptType } = verification.payload;
    if (receiptType === 'BOOKING') {
      const booking = await prisma.booking.findUnique({
        where: { id: sub },
        include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } } },
      });
      if (!booking || booking.status === 'CANCELLED') {
        return { valid: false, statusCode: 404, error: 'NOT_FOUND', message: 'Booking receipt not found or cancelled.' };
      }
      return { valid: true, snapshot: await formatBookingSnapshot(booking) };
    } else {
      const invoice = await prisma.invoice.findUnique({
        where: { id: sub },
        include: { lines: { include: { components: true } }, payments: { where: { reversedAt: null } } },
      });
      if (!invoice || invoice.lifecycle === 'VOIDED') {
        return { valid: false, statusCode: 404, error: 'NOT_FOUND', message: 'Invoice receipt not found or voided.' };
      }
      return { valid: true, snapshot: await formatInvoiceSnapshot(invoice) };
    }
  }

  // Mode 3: Direct reference without key (safe fallback if allowed)
  if (ref) {
    const inv = await prisma.invoice.findFirst({
      where: { OR: [{ invoiceNumber: { equals: ref, mode: 'insensitive' } }, { id: ref }] },
      include: { lines: { include: { components: true } }, payments: { where: { reversedAt: null } } },
    });
    if (inv && inv.lifecycle !== 'VOIDED') {
      return { valid: true, snapshot: await formatInvoiceSnapshot(inv) };
    }
    const bkg = await prisma.booking.findFirst({
      where: { OR: [{ bookingNumber: { equals: ref, mode: 'insensitive' } }, { id: ref }] },
      include: { items: true, payments: true },
    });
    if (bkg && bkg.status !== 'CANCELLED') {
      return { valid: true, snapshot: await formatBookingSnapshot(bkg) };
    }
  }

  return { valid: false, statusCode: 400, error: 'MISSING_PARAMS', message: 'Receipt reference or token is required.' };
}

// ── 2. Verify Token / Key & Return Sanitized Snapshot (For Customer View) ──
publicRoutes.get(['/receipts/verify', '/verify'], async (req, res) => {
  const result = await resolveVerifiedRecord(req.query, req.params);
  if (!result.valid) {
    return res.status(result.statusCode).json({ error: { code: result.error, message: result.message } });
  }
  return res.status(200).json({ data: result.snapshot });
});

// ── 3. Direct PDF Download Stream (For Customer 1-Click Download) ────────────
publicRoutes.get(['/receipts/pdf', '/pdf', '/download'], async (req, res) => {
  const result = await resolveVerifiedRecord(req.query, req.params);
  if (!result.valid) {
    return res.status(result.statusCode).send(result.message);
  }

  try {
    const pdfBuffer = generateServerReceiptPdf(result.snapshot);
    const safeName = (result.snapshot.invoiceNumber || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Receipt-${safeName}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('Failed to stream receipt PDF:', err);
    return res.status(500).send('Failed to generate receipt PDF.');
  }
});

// ── 4. Unified Direct Reference & Download Route ────────────────────────────
// Supports: /receipt/:reference?k=... OR /receipt/:reference?download=pdf
publicRoutes.get('/:reference', async (req, res) => {
  const result = await resolveVerifiedRecord(req.query, req.params);
  if (!result.valid) {
    return res.status(result.statusCode).json({ error: { code: result.error, message: result.message } });
  }

  // If download parameter requested or client accepts application/pdf directly
  if (req.query.download === 'pdf' || req.headers.accept?.includes('application/pdf')) {
    const pdfBuffer = generateServerReceiptPdf(result.snapshot);
    const safeName = (result.snapshot.invoiceNumber || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Receipt-${safeName}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.status(200).send(pdfBuffer);
  }

  return res.status(200).json({ data: result.snapshot });
});

export default publicRoutes;
