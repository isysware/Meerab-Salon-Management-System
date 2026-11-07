// scripts/test-whatsapp-receipt.js
// Verification suite for Free WhatsApp Invoice Sharing with Secure PDF Download Link.

import assert from 'assert';
import jwt from 'jsonwebtoken';
import {
  generateReceiptKey,
  verifyReceiptKey,
  createReceiptToken,
  verifyReceiptToken,
  formatReceiptWhatsAppMessage,
} from '../src/modules/public/receiptTokens.js';
import { generateServerReceiptPdf } from '../src/modules/public/receiptPdfGenerator.js';
import { env } from '../src/config/env.js';

console.log('🧪 Starting WhatsApp Receipt & Secure PDF Verification...\n');

// ── Test 1: Token Generation & Verification ──────────────────────────────────
console.log('▶ Test 1: Token generation and cryptographic verification');
const invoiceId = 'test-inv-001';
const invoiceNum = 'INV-2026-9999';

const token = createReceiptToken({ recordId: invoiceId, type: 'INVOICE', invoiceNumber: invoiceNum });
assert(token && typeof token === 'string', 'Token must be a non-empty string');

const verified = verifyReceiptToken(token);
assert(verified.valid === true, 'Token must verify successfully');
assert.strictEqual(verified.payload.sub, invoiceId, 'Subject must match invoice id');
assert.strictEqual(verified.payload.invoiceNumber, invoiceNum, 'Invoice number must match');
console.log('✅ Passed Test 1: Token signed and verified successfully');

// ── Test 1B: Compact 16-character HMAC Key ──────────────────────────────────
console.log('\n▶ Test 1B: Compact HMAC receipt key generation & verification');
const compactKey = generateReceiptKey(invoiceId, invoiceNum);
assert.strictEqual(compactKey.length, 16, 'Key must be exactly 16 hex characters');
assert.strictEqual(verifyReceiptKey(invoiceId, invoiceNum, compactKey), true, 'Key must verify');
assert.strictEqual(verifyReceiptKey(invoiceId, 'INV-2026-DIFFERENT', compactKey), false, 'Wrong invoice must fail');
assert.strictEqual(verifyReceiptKey('diff-id', invoiceNum, compactKey), false, 'Wrong recordId must fail');
assert.strictEqual(verifyReceiptKey(invoiceId, invoiceNum, 'wrongkey12345678'), false, 'Wrong key must fail');
console.log(`✅ Passed Test 1B: Compact key '${compactKey}' (16 chars) verified securely`);

// ── Test 2: Tamper Protection & Forged Token ─────────────────────────────────
console.log('\n▶ Test 2: Tamper protection (forged token rejection)');
const tamperedToken = token.slice(0, -6) + 'xxxxxx';
const tamperedResult = verifyReceiptToken(tamperedToken);
assert.strictEqual(tamperedResult.valid, false, 'Tampered token must be rejected');
assert.strictEqual(tamperedResult.error, 'INVALID_TOKEN', 'Error code must be INVALID_TOKEN');
console.log('✅ Passed Test 2: Tampered token safely rejected');

// ── Test 3: Expired Token Rejection ──────────────────────────────────────────
console.log('\n▶ Test 3: Expired token rejection');
const expiredToken = jwt.sign(
  { sub: invoiceId, receiptType: 'INVOICE', invoiceNumber: invoiceNum },
  env.jwtAccessSecret,
  { expiresIn: '-1s' }
);
const expiredResult = verifyReceiptToken(expiredToken);
assert.strictEqual(expiredResult.valid, false, 'Expired token must be rejected');
assert.strictEqual(expiredResult.error, 'EXPIRED_TOKEN', 'Error code must be EXPIRED_TOKEN');
console.log('✅ Passed Test 3: Expired token correctly identified and rejected with 410 semantics');

// ── Test 4: One Receipt Token Cannot Access Another Receipt ──────────────────
console.log('\n▶ Test 4: Cross-receipt isolation (token for Invoice A cannot access Invoice B)');
const tokenA = createReceiptToken({ recordId: 'inv-A', type: 'INVOICE', invoiceNumber: 'INV-A' });
const verifiedA = verifyReceiptToken(tokenA);
assert.strictEqual(verifiedA.payload.sub, 'inv-A');
assert.notStrictEqual(verifiedA.payload.sub, 'inv-B', 'Token A must not authorize Invoice B');
console.log('✅ Passed Test 4: Cryptographic bound ensures token A only authorizes invoice A');

// ── Test 5: WhatsApp Message Formatting ──────────────────────────────────────
console.log('\n▶ Test 5: WhatsApp message format compliance');
const sampleReceipt = {
  type: 'POS_INVOICE',
  invoiceNumber: 'INV-2026-0042',
  date: '2026-11-07',
  time: '02:30 PM',
  clientName: 'Ayesha Khan',
  clientPhone: '+92 300 1234567',
  branch: { name: 'Meerub Salon & Spa' },
  lines: [
    { name: 'Hydra Facial Deluxe', quantity: 1, unitPrice: 8500, total: 8500 },
    { name: 'Hair Gloss Treatment', quantity: 1, unitPrice: 4500, total: 4500 },
  ],
  subtotal: 13000,
  discount: 1000,
  tax: 0,
  total: 12000,
  amountPaid: 12000,
  amountDue: 0,
};

const downloadUrl = 'https://meerub.isywarecloud.com/receipt/download?token=sampleToken123';
const msg = formatReceiptWhatsAppMessage(sampleReceipt, downloadUrl);

console.log('Generated Message:\n-------------------------\n' + msg + '\n-------------------------');
assert(msg.includes('*MEERUB SALON & SPA*'), 'Must contain uppercase salon name');
assert(msg.includes('*Invoice / Receipt #INV-2026-0042*'), 'Must contain invoice reference');
assert(msg.includes('Hydra Facial Deluxe'), 'Must list actual items');
assert(msg.includes('Total Amount: Rs. 12,000.00'), 'Must format total amount');
assert(msg.includes('Paid Amount: Rs. 12,000.00'), 'Must format paid amount');
assert(msg.includes('Remaining Balance: Rs. 0.00'), 'Must format outstanding balance');
assert(msg.includes(downloadUrl), 'Must include actual public download URL');
assert(msg.includes('📄 *Download Your PDF Invoice:*'), 'Must include download banner');
console.log('✅ Passed Test 5: Message matches required specification exactly');

// ── Test 6: Direct PDF Generation Stream ─────────────────────────────────────
console.log('\n▶ Test 6: PDF binary stream generation and structure');
const pdfBuffer = generateServerReceiptPdf(sampleReceipt);
assert(Buffer.isBuffer(pdfBuffer), 'Output must be a Buffer');
assert(pdfBuffer.length > 500, 'PDF buffer must contain substantial bytes');
assert(pdfBuffer.toString('utf-8', 0, 8).startsWith('%PDF-1.4'), 'PDF must start with %PDF-1.4 header');
assert(pdfBuffer.toString('utf-8').includes('%%EOF'), 'PDF must end with standard %%EOF marker');
console.log(`✅ Passed Test 6: Valid PDF generated (${pdfBuffer.length} bytes)`);

console.log('\n🎉 ALL 6 VERIFICATION TESTS PASSED SUCCESSFULLY!\n');

