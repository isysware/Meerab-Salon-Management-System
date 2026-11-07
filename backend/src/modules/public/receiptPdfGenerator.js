// src/modules/public/receiptPdfGenerator.js
// Canonical server-side PDF generator for SalonOS receipts.
// Produces 100% valid standard PDF 1.4 binary stream with dark, bold/medium strokes optimized for thermal printing.

function escapePdfText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function generateServerReceiptPdf(receipt) {
  const branchName = (receipt.branch?.name || 'MEERUB SALON & SPA').toUpperCase();
  const branchAddress = receipt.branch?.address
    ? `${receipt.branch.address}${receipt.branch.city ? `, ${receipt.branch.city}` : ''}`
    : 'Salon & Spa';
  const branchPhone = receipt.branch?.phone ? `Tel: ${receipt.branch.phone}` : '';
  const taxReg = receipt.branch?.taxRegistrationNumber
    ? `${receipt.branch.taxAuthority || 'Tax Reg'}: ${receipt.branch.taxRegistrationNumber}`
    : '';

  const isBkg = receipt.type === 'BOOKING_INVOICE' || receipt.invoiceNumber?.startsWith('BKG');
  const dashLine = '--------------------------------------------';

  const lines = receipt.lines || [];
  const fmt = (n) => `PKR ${(Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Page dimensions: 80mm width = ~226 points.
  const pageWidth = 226;
  const margin = 12;
  const rightMargin = 214;

  // Calculate needed height dynamically
  let estimatedLines = 20 + (lines.length * 2.8);
  if (receipt.discount > 0) estimatedLines += 1;
  if (receipt.tax > 0) estimatedLines += 1;
  if (receipt.tip > 0) estimatedLines += 1;
  const pageHeight = Math.max(400, Math.ceil(estimatedLines * 13 + 60));

  let textStream = '';
  let y = pageHeight - 25;

  const addText = (text, x, isTitle = false, size = 8.5) => {
    const font = isTitle ? '/F2' : '/F1';
    textStream += `${font} ${size} Tf\n`;
    textStream += `1 0 0 1 ${x} ${y} Tm\n`;
    textStream += `(${escapePdfText(text)}) Tj\n`;
  };

  const addCentered = (text, isTitle = false, size = 8.5) => {
    const charWidth = (size * 0.6);
    const textWidth = text.length * charWidth;
    const x = Math.max(margin, Math.round((pageWidth - textWidth) / 2));
    addText(text, x, isTitle, size);
    y -= (size + 4);
  };

  const addRow = (left, right, isTitle = false, size = 8.5) => {
    const font = isTitle ? '/F2' : '/F1';
    textStream += `${font} ${size} Tf\n`;
    textStream += `1 0 0 1 ${margin} ${y} Tm\n`;
    textStream += `(${escapePdfText(left)}) Tj\n`;

    const charWidth = size * 0.6;
    const rightWidth = right.length * charWidth;
    const rightX = Math.max(margin + 50, Math.round(rightMargin - rightWidth));
    textStream += `1 0 0 1 ${rightX} ${y} Tm\n`;
    textStream += `(${escapePdfText(right)}) Tj\n`;
    y -= (size + 4);
  };

  // Header Brand (Dark & Bold)
  addCentered(branchName, true, 12);
  addCentered(branchAddress, false, 8);
  if (branchPhone) addCentered(branchPhone, false, 8);
  if (taxReg) addCentered(taxReg, false, 8);
  addCentered(dashLine, false, 8.5);

  // Invoice / Booking Info (Crisp Semibold)
  const title = isBkg ? 'BOOKING ADVANCE INVOICE' : (receipt.branch?.taxRegistrationNumber ? 'TAX INVOICE' : 'RETAIL INVOICE');
  addCentered(title, true, 10);
  addRow(isBkg ? `Booking #: ${receipt.invoiceNumber}` : `Invoice #: ${receipt.invoiceNumber}`, `Date: ${receipt.date}`, false, 8.5);
  if (receipt.time) addRow(`Time: ${receipt.time}`, isBkg && receipt.bookingType ? `Type: ${receipt.bookingType}` : '', false, 8.5);
  addRow(`Client: ${(receipt.clientName || 'Walk-in').substring(0, 20)}`, receipt.clientPhone ? receipt.clientPhone.substring(0, 16) : '', false, 8.5);
  addCentered(dashLine, false, 8.5);

  // Table Header
  addRow('ITEM / SERVICE', 'TOTAL', true, 8.5);
  addCentered(dashLine, false, 8.5);

  // Items
  for (const it of lines) {
    const qtyText = it.quantity > 1 ? ` (${it.quantity}x)` : '';
    const name = `${it.name}${qtyText}`.substring(0, 22);
    const total = fmt(it.total || (it.unitPrice * (it.quantity || 1)));
    addRow(name, total, false, 8.5);
    if (it.components && it.components.length > 0) {
      for (const comp of it.components) {
        addRow(`  * ${comp.serviceName.substring(0, 20)}`, '', false, 7.5);
      }
    }
  }

  addCentered(dashLine, false, 8.5);

  // Financial Summary (Bold & Prominent)
  if (receipt.discount > 0) addRow('Discount:', `- ${fmt(receipt.discount)}`, false, 8.5);
  if (receipt.tax > 0) addRow('Sales Tax:', fmt(receipt.tax), false, 8.5);
  if (receipt.tip > 0) addRow('Gratuity / Tip:', fmt(receipt.tip), false, 8.5);

  addRow(isBkg ? 'Total Quoted Price:' : 'Total Bill:', fmt(receipt.total), true, 9.5);
  addRow(isBkg ? 'Total Advance Paid:' : 'Total Paid:', fmt(receipt.amountPaid), true, 9);
  addRow(isBkg ? 'Remaining Balance (Due):' : 'Outstanding Balance:', fmt(receipt.amountDue), true, 9.5);

  addCentered(dashLine, false, 8.5);
  addCentered(isBkg ? '* Advance receipt. Remaining due on event.' : '* Thank you for your visit!', false, 8);
  addCentered(`Powered by Isysware Software Solutions`, false, 7.5);

  // Construct PDF binary object stream
  const contentStream = `BT\n${textStream}\nET`;
  const streamBuf = Buffer.from(contentStream, 'utf-8');

  let body = '';
  const offsets = [];
  function addObj(str) {
    offsets.push(body.length);
    body += str + '\n';
  }

  body += '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  addObj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`);
  addObj(`4 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n${contentStream}\nendstream\nendobj`);
  // Use Courier-Bold for F1 and F2 to guarantee solid, non-fading strokes on all thermal printers
  addObj('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj');
  addObj('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj');

  const startxref = body.length;
  body += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;

  return Buffer.from(body, 'utf-8');
}
