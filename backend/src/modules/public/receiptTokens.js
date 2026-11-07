// src/modules/public/receiptTokens.js
// Compact, cryptographically secure receipt key generation, verification, and WhatsApp message formatting.

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../config/env.js';

// ── 1. Compact 16-character HMAC Key ─────────────────────────────────────────
export function generateReceiptKey(recordId, invoiceNumber) {
  return crypto
    .createHmac('sha256', env.jwtAccessSecret)
    .update(`${recordId}:${invoiceNumber}`)
    .digest('hex')
    .substring(0, 16);
}

export function verifyReceiptKey(recordId, invoiceNumber, key) {
  if (!key || typeof key !== 'string') return false;
  const expected = generateReceiptKey(recordId, invoiceNumber);
  if (key.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key, 'utf-8'), Buffer.from(expected, 'utf-8'));
}

// ── 2. Backward compatible JWT Token ─────────────────────────────────────────
export function createReceiptToken({ recordId, type = 'INVOICE', invoiceNumber }) {
  const nonce = crypto.randomBytes(8).toString('hex');
  return jwt.sign(
    {
      sub: recordId,
      receiptType: type,
      invoiceNumber,
      nonce,
    },
    env.jwtAccessSecret,
    { expiresIn: '90d' }
  );
}

export function verifyReceiptToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'MISSING_TOKEN', message: 'Receipt access token is required.' };
  }
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    return { valid: true, payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'EXPIRED_TOKEN', message: 'This receipt download link has expired.' };
    }
    return { valid: false, error: 'INVALID_TOKEN', message: 'Invalid or unverified receipt link.' };
  }
}

// ── 3. Base URL Resolution (Guarantees Live Production Domain on Prod, Localhost on Dev) ──
export function getPublicBaseUrl(req) {
  // 1. Explicit production public URL if configured
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/+$/, '');
  if (env.publicAppUrl) return env.publicAppUrl.replace(/\/+$/, '');

  // 2. In local development only, map local backend to local frontend port 3002
  if (req && typeof req.get === 'function' && (env.isDev || env.nodeEnv === 'development')) {
    const origin = req.get('origin');
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return origin.replace(/\/+$/, '');
    }
    const host = req.get('host');
    if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
      return host.startsWith('127.0.0.1') ? 'http://127.0.0.1:3002' : 'http://localhost:3002';
    }
  }

  // 3. Client live origin or referer from request (production domain)
  if (req && typeof req.get === 'function') {
    const origin = req.get('origin');
    if (origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin.replace(/\/+$/, '');
    }

    const referer = req.get('referer');
    if (referer) {
      try {
        const u = new URL(referer);
        if (!u.hostname.includes('localhost') && !u.hostname.includes('127.0.0.1')) {
          return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
        }
      } catch {}
    }

    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }

  // 4. Extract from configured HTTPS production origins (e.g. https://meerub.isywarecloud.com)
  const configuredOrigins = (env.corsOrigin || process.env.CORS_ORIGIN || '');
  const httpsOrigins = configuredOrigins.split(',').map(s => s.trim()).filter(s => s.startsWith('https://'));
  if (httpsOrigins.length > 0) {
    return httpsOrigins[0].replace(/\/+$/, '');
  }

  // 5. In production mode, NEVER return localhost
  if (env.nodeEnv === 'production') {
    return 'https://meerub.isywarecloud.com';
  }

  // 6. Local dev fallback
  return 'http://localhost:3002';
}

const fmtNumber = (val) => {
  const num = typeof val === 'number' && !isNaN(val) ? val : Number(val) || 0;
  return num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ── 4. WhatsApp Message Formatter ────────────────────────────────────────────
export function formatReceiptWhatsAppMessage(receipt, downloadUrl) {
  const branchName = (receipt.branch?.name || 'MEERUB SALON & SPA').toUpperCase();
  const isBkg = receipt.type === 'BOOKING_INVOICE' || receipt.invoiceNumber?.startsWith('BKG');
  const itemsList = (receipt.lines || [])
    .map(l => l.name)
    .filter(Boolean)
    .join(', ') || 'Salon Services';

  const refLabel = isBkg
    ? `Booking / Advance Receipt #${receipt.invoiceNumber}`
    : `Invoice / Receipt #${receipt.invoiceNumber}`;

  const dateLabel = isBkg ? 'Event Date' : 'Date';

  return `*${branchName}*
*${refLabel}*

Dear Customer,
Thank you for choosing us!

${dateLabel}: ${receipt.date}${receipt.time ? ` • ${receipt.time}` : ''}
Services / Products: ${itemsList}
Total Amount: Rs. ${fmtNumber(receipt.total)}
Paid Amount: Rs. ${fmtNumber(receipt.amountPaid)}
Remaining Balance: Rs. ${fmtNumber(receipt.amountDue)}

📄 *Download Your PDF Invoice:*
${downloadUrl}

Thank you for visiting!`;
}
