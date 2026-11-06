import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { Invoice, Branch } from '@/types/salon';
import { formatCurrency } from '@/lib/formatters';

export const getCleanWhatsAppPhone = (rawPhone: string): string => {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('3')) return `92${digits}`;
  return digits;
};

export interface GeneratedReceipt {
  pdf: jsPDF;
  blob: Blob;
  file: File;
  dataUrl: string;
  fileName: string;
  imageBlob?: Blob;
}

export const formatPkr = (val: number | undefined | null): string => {
  const num = typeof val === 'number' && !isNaN(val) ? val : 0;
  return `PKR ${num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function getPaymentMethodSummary(invoice: Invoice): string {
  const payments = invoice.payments || [];
  if (payments.length > 0) {
    const methods = payments.map((p) => {
      if (p.method === 'CASH') return 'Cash';
      if (p.paymentAccountName) return p.paymentAccountName;
      return 'Online';
    });
    const unique = Array.from(new Set(methods.filter(Boolean)));
    return unique.join(' / ') || 'Cash';
  }
  if (invoice.paymentMethod) {
    if (invoice.paymentMethod === 'CASH') return 'Cash';
    if (invoice.paymentAccountName) return invoice.paymentAccountName;
    return 'Online';
  }
  return invoice.amountPaid > 0 ? 'Cash' : 'Unpaid';
}

export function generateThermalReceiptHtml(invoice: Invoice, branch: Branch | null): string {
  const branchName = (branch?.name || 'MEERUB SALON & SPA').toUpperCase();
  const branchAddress = branch?.address ? `${branch.address}${branch?.city ? `, ${branch.city}` : ''}` : 'Salon & Spa';
  const branchPhone = branch?.phone ? `Tel: ${branch.phone}` : '';
  const taxReg = branch?.taxRegistrationNumber
    ? `${branch.taxAuthority || 'Tax Reg'}: ${branch.taxRegistrationNumber}`
    : '';

  const lines = invoice.lineItems || invoice.lines || [];
  const methodSummary = getPaymentMethodSummary(invoice);
  const isBkg = Boolean(invoice.isBookingInvoice || invoice.invoiceNumber?.startsWith('BKG'));
  const bkgTypeLabel =
    invoice.bookingType === 'BRIDAL'
      ? 'Bridal Event'
      : invoice.bookingType === 'GROOM'
      ? 'Groom Event'
      : 'Salon Reservation';

  const itemsHtml = lines.map((li) => {
    const qtyText = !li.batchAllocations?.length && li.quantity > 1 ? ` (${li.quantity}x @ ${formatPkr(li.unitPrice)})` : '';
    const lineTotal = formatPkr(li.total || (li.netSales == null ? li.unitPrice * li.quantity : li.netSales + (li.discountAllocated ?? 0)));
    const stylistText = li.staffName
      ? `<div style="font-size: 9px; color: #222; padding-left: 3px;">Stylist: ${escapeHtml(li.staffName)}</div>`
      : '';

    const comps = li.packageComponentsSnapshot || li.packageComponents || [];
    const compsHtml = comps.length > 0
      ? `<div style="padding-left: 5px; font-size: 8.5px; color: #333;">
          ${comps.map((c) => `<div>• ${escapeHtml(c.serviceName)}${c.staffName ? ` (${escapeHtml(c.staffName)})` : ''}</div>`).join('')}
         </div>`
      : '';

    return `
      <tr>
        <td style="padding: 1.5px 0; vertical-align: top; text-align: left;">
          <div style="font-weight: bold; font-size: 10.5px;">${escapeHtml(li.name)}${qtyText}</div>
          ${stylistText}
          ${compsHtml}
          ${(li.batchAllocations || []).map(a => `<div>${a.quantity} x ${formatPkr(a.sellingPrice)}</div>`).join('')}
        </td>
        <td style="padding: 1.5px 0; vertical-align: top; text-align: center; font-size: 10px; width: 12%;">
          ${li.quantity}
        </td>
        <td style="padding: 1.5px 0; vertical-align: top; text-align: right; font-weight: bold; font-size: 10.5px; width: 32%;">
          ${lineTotal}
        </td>
      </tr>
    `;
  }).join('');

  let discountRow = '';
  if (invoice.discount > 0) {
    discountRow = `
      <tr>
        <td style="text-align: left; padding: 1px 0;">Discount:</td>
        <td style="text-align: right; font-weight: bold;">- ${formatPkr(invoice.discount)}</td>
      </tr>
    `;
  }

  let taxRow = '';
  if (invoice.tax > 0) {
    const rateText = branch?.taxEnabled && branch?.taxRate ? ` (${((branch.taxRate || 0) * 100).toFixed(0)}%)` : '';
    taxRow = `
      <tr>
        <td style="text-align: left; padding: 1px 0;">Sales Tax${rateText}:</td>
        <td style="text-align: right; font-weight: bold;">${formatPkr(invoice.tax)}</td>
      </tr>
    `;
  }

  let tipRow = '';
  if (invoice.tip > 0) {
    tipRow = `
      <tr>
        <td style="text-align: left; padding: 1px 0;">Staff Gratuity / Tip:</td>
        <td style="text-align: right; font-weight: bold;">${formatPkr(invoice.tip)}</td>
      </tr>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt-${invoice.invoiceNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    @media print { html, body { width: 80mm !important; margin: 0 !important; padding: 0 !important; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, Monaco, monospace;
      color: #000000; background: #ffffff; width: 72mm; margin: 0 auto;
      padding: 3mm 0 5mm 0; font-size: 11px; line-height: 1.22;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .brand-title { font-size: 13.5px; font-weight: bold; text-align: center; margin-bottom: 1.5px; }
    .brand-meta { font-size: 9.5px; text-align: center; line-height: 1.2; color: #111; }
    .divider { border-top: 1px dashed #000000; margin: 2.5px 0; width: 100%; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .meta-table td { padding: 1px 0; font-size: 10px; vertical-align: top; }
    .items-table th { font-size: 9.5px; font-weight: bold; border-bottom: 1px dashed #000; padding: 2px 0; }
    .items-table td { padding: 1.5px 0; vertical-align: top; }
    .summary-table td { padding: 1.5px 0; font-size: 11px; }
    .footer-note { text-align: center; font-size: 9px; line-height: 1.25; margin-top: 4px; color: #222; }
  </style>
</head>
<body>
  <div class="brand-title">${escapeHtml(branchName)}</div>
  <div class="brand-meta">
    ${escapeHtml(branchAddress)}<br>
    ${branchPhone ? `${escapeHtml(branchPhone)}<br>` : ''}
    ${taxReg ? `${escapeHtml(taxReg)}<br>` : ''}
  </div>
  <div class="divider"></div>
  <table class="meta-table">
    <tr>
      <td colspan="2" style="text-align: center; font-weight: bold; font-size: 10.5px; padding-bottom: 2px;">
        ${isBkg ? (invoice.currentPaymentAmount !== undefined ? 'BOOKING ADVANCE PAYMENT RECEIPT' : 'BOOKING ADVANCE INVOICE') : branch?.taxRegistrationNumber ? 'TAX INVOICE' : 'RETAIL INVOICE'}
      </td>
    </tr>
    ${isBkg && invoice.bookingReceiptNumber
      ? `<tr>
           <td style="width: 50%;"><strong>Receipt #:</strong> ${escapeHtml(invoice.bookingReceiptNumber)}</td>
           <td style="text-align: right; width: 50%;"><strong>Booking Ref:</strong> ${escapeHtml(invoice.invoiceNumber)}</td>
         </tr>
         <tr>
           <td colspan="2"><strong>Date:</strong> ${escapeHtml(invoice.date)}${invoice.time ? ` ${escapeHtml(invoice.time)}` : ''}</td>
         </tr>`
      : `<tr>
           <td style="width: 50%;"><strong>${isBkg ? 'Booking #:' : 'Inv #:'}</strong> ${escapeHtml(invoice.invoiceNumber)}</td>
           <td style="text-align: right; width: 50%;">${isBkg ? 'Event: ' : ''}${escapeHtml(invoice.date)}${invoice.time ? ` ${escapeHtml(invoice.time)}` : ''}</td>
         </tr>`}
    ${isBkg ? `<tr><td colspan="2"><strong>Type:</strong> ${escapeHtml(bkgTypeLabel)}</td></tr>` : ''}
    <tr>
      <td colspan="2"><strong>Client:</strong> ${escapeHtml(invoice.clientName || 'Walk-in Customer')}${invoice.clientPhone && invoice.clientPhone !== 'N/A' ? ` (${escapeHtml(invoice.clientPhone)})` : ''}</td>
    </tr>
    ${invoice.processedByName ? `<tr><td colspan="2"><strong>Cashier:</strong> ${escapeHtml(invoice.processedByName)}</td></tr>` : ''}
  </table>
  <div class="divider"></div>
  <table class="items-table">
    <thead>
      <tr>
        <th style="text-align: left; width: 58%;">${isBkg ? 'RESERVED SERVICE / ITEM' : 'ITEM / SERVICE'}</th>
        <th style="text-align: center; width: 12%;">QTY</th>
        <th style="text-align: right; width: 30%;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <table class="summary-table">
    ${discountRow}
    ${taxRow}
    ${tipRow}
    <tr>
      <td style="text-align: left; font-weight: bold;">${isBkg ? 'Total Quoted Price:' : 'Total Bill:'}</td>
      <td style="text-align: right; font-weight: bold;">${formatPkr(invoice.total)}</td>
    </tr>
    ${isBkg ? (
      invoice.currentPaymentAmount !== undefined ? `
        <tr>
          <td style="text-align: left; font-weight: bold;">Payment Received (${escapeHtml(methodSummary)}):</td>
          <td style="text-align: right; font-weight: bold;">${formatPkr(invoice.currentPaymentAmount)}</td>
        </tr>
        <tr>
          <td style="text-align: left; font-size: 10px; color: #444;">Total Advance to Date:</td>
          <td style="text-align: right; font-size: 10px; font-weight: bold;">${formatPkr(invoice.totalAdvanceReceived ?? invoice.amountPaid)}</td>
        </tr>` : `
        <tr>
          <td style="text-align: left; font-weight: bold;">Total Advance Paid (${escapeHtml(methodSummary)}):</td>
          <td style="text-align: right; font-weight: bold;">${formatPkr(invoice.totalAdvanceReceived ?? invoice.amountPaid)}</td>
        </tr>`
    ) : (
      invoice.advanceAdjusted && invoice.advanceAdjusted > 0 ? `
        <tr>
          <td style="text-align: left; font-size: 10px; color: #166534;">Booking Advance Applied:</td>
          <td style="text-align: right; font-size: 10px; font-weight: bold; color: #166534;">- ${formatPkr(invoice.advanceAdjusted)}</td>
        </tr>
        <tr>
          <td style="text-align: left; font-size: 10px; color: #444;">Remaining Payable:</td>
          <td style="text-align: right; font-size: 10px; font-weight: bold;">${formatPkr(Math.max(0, invoice.total - invoice.advanceAdjusted))}</td>
        </tr>
        <tr>
          <td style="text-align: left; font-weight: bold;">Checkout Payment (${escapeHtml(methodSummary)}):</td>
          <td style="text-align: right; font-weight: bold;">${formatPkr(Math.max(0, invoice.amountPaid - invoice.advanceAdjusted))}</td>
        </tr>
        <tr>
          <td style="text-align: left; font-size: 10px; font-weight: bold; border-top: 1px dashed #ccc;">Total Settled:</td>
          <td style="text-align: right; font-size: 10px; font-weight: bold; border-top: 1px dashed #ccc;">${formatPkr(invoice.amountPaid)}</td>
        </tr>` : `
        <tr>
          <td style="text-align: left; font-weight: bold;">Paid Amount (${escapeHtml(methodSummary)}):</td>
          <td style="text-align: right; font-weight: bold;">${formatPkr(invoice.amountPaid)}</td>
        </tr>`
    )}
    <tr>
      <td style="text-align: left; font-weight: bold; ${invoice.amountDue > 0 ? 'color: #b91c1c;' : ''}">${isBkg ? 'Remaining Balance (Due on Event):' : 'Outstanding Balance:'}</td>
      <td style="text-align: right; font-weight: bold; ${invoice.amountDue > 0 ? 'color: #b91c1c;' : ''}">${formatPkr(invoice.amountDue)}</td>
    </tr>
  </table>
  <div class="divider"></div>
  <div class="footer-note">
    ${isBkg ? '<div style="font-weight: bold; margin-bottom: 2px; color: #166534;">* Advance payment receipt. Remaining balance payable on event date.</div>' : ''}
    ${invoice.notes ? `<div style="font-weight: bold; margin-bottom: 2px;">Note: ${escapeHtml(invoice.notes)}</div>` : ''}
    <div>Thank you for choosing ${escapeHtml(branchName)}!</div>
    <div style="font-size: 8px; color: #555; margin-top: 1.5px;">Powered by Isysware Software Solutions</div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function printThermalReceipt(invoice: Invoice, branch: Branch | null): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const htmlContent = generateThermalReceiptHtml(invoice, branch);
  const existingFrame = document.getElementById('pos-thermal-print-frame');
  if (existingFrame && existingFrame.parentNode) existingFrame.parentNode.removeChild(existingFrame);

  const iframe = document.createElement('iframe');
  iframe.id = 'pos-thermal-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0'; iframe.style.bottom = '0';
  iframe.style.width = '0'; iframe.style.height = '0';
  iframe.style.border = '0'; iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc || !iframe.contentWindow) return;
  doc.open(); doc.write(htmlContent); doc.close();

  const printWindow = iframe.contentWindow;
  setTimeout(() => {
    try { printWindow.focus(); printWindow.print(); } catch {}
    finally { setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 3000); }
  }, 250);
}

export async function generateReceiptPdf(
  invoiceOrElement: Invoice | HTMLElement,
  branchOrInvoiceNo?: Branch | null | string,
  maybeInvoice?: Invoice
): Promise<GeneratedReceipt> {
  let invoice: Invoice;
  let branch: Branch | null = null;
  if (invoiceOrElement && 'invoiceNumber' in invoiceOrElement) {
    invoice = invoiceOrElement as Invoice;
    branch = (typeof branchOrInvoiceNo === 'object' ? branchOrInvoiceNo : null) as Branch | null;
  } else if (maybeInvoice) {
    invoice = maybeInvoice;
    branch = (typeof branchOrInvoiceNo === 'object' ? branchOrInvoiceNo : null) as Branch | null;
  } else {
    throw new Error('Invoice data is required to generate receipt PDF.');
  }

  const safeInvoiceNo = (invoice.invoiceNumber || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Receipt-${safeInvoiceNo}.pdf`;
  const branchName = (branch?.name || 'MEERUB SALON & SPA').toUpperCase();
  const branchAddress = branch?.address ? `${branch.address}${branch?.city ? `, ${branch.city}` : ''}` : 'Salon & Spa';
  const branchPhone = branch?.phone ? `Tel: ${branch.phone}` : '';
  const taxReg = branch?.taxRegistrationNumber ? `${branch.taxAuthority || 'Tax Reg'}: ${branch.taxRegistrationNumber}` : '';
  const lines = invoice.lineItems || invoice.lines || [];
  const methodSummary = getPaymentMethodSummary(invoice);
  const isBkg = Boolean(invoice.isBookingInvoice || invoice.invoiceNumber?.startsWith('BKG'));
  const bkgTypeLabel =
    invoice.bookingType === 'BRIDAL'
      ? 'Bridal Event'
      : invoice.bookingType === 'GROOM'
      ? 'Groom Event'
      : 'Salon Reservation';

  let estimatedHeight = 42;
  lines.forEach((li) => {
    estimatedHeight += 7;
    if (li.staffName) estimatedHeight += 3;
    const comps = li.packageComponentsSnapshot || li.packageComponents || [];
    estimatedHeight += comps.length * 2.8;
  });
  if (invoice.discount > 0) estimatedHeight += 3.5;
  if (invoice.tax > 0) estimatedHeight += 3.5;
  if (invoice.tip > 0) estimatedHeight += 3.5;
  estimatedHeight += 24;
  estimatedHeight += 18;
  const pdfHeight = Math.max(85, Math.ceil(estimatedHeight));

  const pdfWidth = 80;
  const leftMargin = 5; const rightMargin = 75; const center = 40;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, pdfHeight], compress: true });

  let y = 7;
  const dashLine = '--------------------------------------------';
  pdf.setFont('courier', 'bold'); pdf.setFontSize(10.5);
  pdf.text(branchName, center, y, { align: 'center' }); y += 4;
  pdf.setFont('courier', 'normal'); pdf.setFontSize(7.2);
  pdf.text(branchAddress, center, y, { align: 'center' }); y += 3.2;
  if (branchPhone) { pdf.text(branchPhone, center, y, { align: 'center' }); y += 3.2; }
  if (taxReg) { pdf.text(taxReg, center, y, { align: 'center' }); y += 3.2; }
  pdf.text(dashLine, center, y, { align: 'center' }); y += 3.5;
  pdf.setFont('courier', 'bold'); pdf.setFontSize(8.5);
  pdf.text(isBkg ? (invoice.currentPaymentAmount !== undefined ? 'BOOKING ADVANCE PAYMENT RECEIPT' : 'BOOKING ADVANCE INVOICE') : branch?.taxRegistrationNumber ? 'TAX INVOICE' : 'RETAIL INVOICE', center, y, { align: 'center' }); y += 3.5;
  pdf.setFont('courier', 'normal'); pdf.setFontSize(7.2);
  if (isBkg && invoice.bookingReceiptNumber) {
    pdf.text(`Receipt #: ${invoice.bookingReceiptNumber}`, leftMargin, y);
    pdf.text(`Booking Ref: ${invoice.invoiceNumber}`, rightMargin, y, { align: 'right' }); y += 3.2;
    pdf.text(`Event: ${invoice.date}${invoice.time ? ` ${invoice.time}` : ''}`, leftMargin, y); y += 3.2;
  } else {
    pdf.text(`${isBkg ? 'Booking #:' : 'Inv #: '} ${invoice.invoiceNumber}`, leftMargin, y);
    pdf.text(`${isBkg ? 'Event: ' : ''}${invoice.date}${invoice.time ? ` ${invoice.time}` : ''}`, rightMargin, y, { align: 'right' }); y += 3.2;
  }
  if (isBkg) {
    pdf.text(`Type: ${bkgTypeLabel}`, leftMargin, y); y += 3.2;
  }
  const clientText = `Client: ${invoice.clientName || 'Walk-in Customer'}${invoice.clientPhone && invoice.clientPhone !== 'N/A' ? ` (${invoice.clientPhone})` : ''}`;
  pdf.text(clientText.substring(0, 42), leftMargin, y); y += 3.2;
  if (invoice.processedByName) { pdf.text(`Cashier: ${invoice.processedByName}`, leftMargin, y); y += 3.2; }
  pdf.text(dashLine, center, y, { align: 'center' }); y += 3.5;

  pdf.setFont('courier', 'bold'); pdf.setFontSize(7.2);
  pdf.text(isBkg ? 'RESERVED SERVICE' : 'ITEM / SERVICE', leftMargin, y); pdf.text('QTY', 51, y, { align: 'center' }); pdf.text('AMOUNT', rightMargin, y, { align: 'right' }); y += 2.2;
  pdf.setFont('courier', 'normal'); pdf.text(dashLine, center, y, { align: 'center' }); y += 3.2;

  lines.forEach((li) => {
    pdf.setFont('courier', 'bold'); pdf.setFontSize(7.2);
    const qtySuffix = li.quantity > 1 ? ` (${li.quantity}x)` : '';
    const itemName = `${li.name}${qtySuffix}`;
    pdf.text(itemName.length > 25 ? `${itemName.substring(0, 23)}..` : itemName, leftMargin, y);
    pdf.setFont('courier', 'normal');
    pdf.text(String(li.quantity), 51, y, { align: 'center' });
    pdf.text(formatPkr(li.total || (li.netSales == null ? li.unitPrice * li.quantity : li.netSales + (li.discountAllocated ?? 0))), rightMargin, y, { align: 'right' }); y += 3;
    if (li.staffName) { pdf.setFontSize(6.5); pdf.text(`  Stylist: ${li.staffName}`, leftMargin, y); y += 2.8; }
    li.batchAllocations?.forEach(a => {
      pdf.setFontSize(6.5); pdf.text(`  ${a.quantity} x ${formatPkr(a.sellingPrice)}`, leftMargin, y); y += 2.8;
    });
    const comps = li.packageComponentsSnapshot || li.packageComponents || [];
    comps.forEach((c) => {
      pdf.setFontSize(6.2); pdf.text(`  • ${c.serviceName}${c.staffName ? ` (${c.staffName})` : ''}`, leftMargin, y); y += 2.6;
    });
  });

  pdf.setFontSize(7.2); pdf.text(dashLine, center, y, { align: 'center' }); y += 3.2;
  const printRow = (label: string, val: string, isBold = false) => {
    if (isBold) pdf.setFont('courier', 'bold'); else pdf.setFont('courier', 'normal');
    pdf.text(label, leftMargin, y); pdf.text(val, rightMargin, y, { align: 'right' }); y += 3.2;
  };
  if (invoice.discount > 0) printRow('Discount:', `- ${formatPkr(invoice.discount)}`);
  if (invoice.tax > 0) printRow(`Sales Tax:`, formatPkr(invoice.tax));
  if (invoice.tip > 0) printRow('Staff Gratuity / Tip:', formatPkr(invoice.tip));
  printRow(isBkg ? 'Total Quoted Price:' : 'Total Bill:', formatPkr(invoice.total), true);
  if (isBkg) {
    if (invoice.currentPaymentAmount !== undefined) {
      printRow(`Payment Received (${methodSummary}):`, formatPkr(invoice.currentPaymentAmount), true);
      printRow('Total Advance to Date:', formatPkr(invoice.totalAdvanceReceived ?? invoice.amountPaid), false);
    } else {
      printRow(`Total Advance Paid (${methodSummary}):`, formatPkr(invoice.totalAdvanceReceived ?? invoice.amountPaid), true);
    }
  } else {
    if (invoice.advanceAdjusted && invoice.advanceAdjusted > 0) {
      printRow('Booking Advance Applied:', `- ${formatPkr(invoice.advanceAdjusted)}`, false);
      printRow('Remaining Payable:', formatPkr(Math.max(0, invoice.total - invoice.advanceAdjusted)), false);
      printRow(`Checkout Payment (${methodSummary}):`, formatPkr(Math.max(0, invoice.amountPaid - invoice.advanceAdjusted)), true);
      printRow('Total Settled:', formatPkr(invoice.amountPaid), true);
    } else {
      printRow(`Paid Amount (${methodSummary}):`, formatPkr(invoice.amountPaid), true);
    }
  }
  printRow(isBkg ? 'Remaining Balance (Due on Event):' : 'Outstanding Balance:', formatPkr(invoice.amountDue), true);
  pdf.setFont('courier', 'normal'); pdf.setFontSize(6.8);
  pdf.text(dashLine, center, y, { align: 'center' }); y += 3.2;
  if (isBkg) {
    pdf.text(invoice.currentPaymentAmount !== undefined ? '* Advance payment installment receipt. Balance due on event.' : '* Advance payment receipt. Remaining due on event.', center, y, { align: 'center' }); y += 2.8;
  }
  pdf.text(`Thank you for choosing ${branchName}!`, center, y, { align: 'center' }); y += 2.8;
  pdf.text('Powered by Isysware Software Solutions', center, y, { align: 'center' });

  const blob = pdf.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const dataUrl = URL.createObjectURL(blob);
  return { pdf, blob, file, dataUrl, fileName };
}

export async function downloadReceiptPdf(invoiceOrElement: Invoice | HTMLElement, branchOrInvoiceNo?: Branch | null | string, maybeInvoice?: Invoice): Promise<string> {
  const generated = await generateReceiptPdf(invoiceOrElement, branchOrInvoiceNo, maybeInvoice);
  generated.pdf.save(generated.fileName);
  return generated.fileName;
}

export interface ShareWhatsAppResult {
  sharedDirectly: boolean; downloaded: boolean; fileName: string; phone: string; file: File;
}

export async function shareReceiptPdfViaWhatsApp({ invoice, branch, targetPhone }: { invoice: Invoice; branch: Branch | null; targetPhone: string; }): Promise<ShareWhatsAppResult> {
  const cleanPhone = getCleanWhatsAppPhone(targetPhone);
  if (!cleanPhone) throw new Error('Please enter a valid customer WhatsApp number.');
  const generated = await generateReceiptPdf(invoice, branch);
  generated.pdf.save(generated.fileName);
  const branchName = (branch?.name || 'MEERUB SALON & SPA').toUpperCase();
  const methodSummary = getPaymentMethodSummary(invoice);
  const isBkg = Boolean(invoice.isBookingInvoice || invoice.invoiceNumber?.startsWith('BKG'));
  const summaryText = isBkg
    ? (invoice.currentPaymentAmount !== undefined
        ? `*${branchName} — BOOKING ADVANCE PAYMENT RECEIPT*\nReceipt No: *${invoice.bookingReceiptNumber || invoice.invoiceNumber}*\nBooking Ref: *${invoice.invoiceNumber}*\nEvent Date: ${invoice.date}${invoice.time ? ` • ${invoice.time}` : ''}\nCustomer: ${invoice.clientName || 'Valued Customer'}\n*Total Quoted Price:* ${formatCurrency(invoice.total)}\n*Payment Received (${methodSummary}):* ${formatCurrency(invoice.currentPaymentAmount)}\n*Total Advance to Date:* ${formatCurrency(invoice.totalAdvanceReceived ?? invoice.amountPaid)}\n*Remaining Balance (Due on Event):* ${formatCurrency(invoice.amountDue)}\n\n📄 _Please find your official Booking Advance Receipt PDF attached above._\nThank you for choosing ${branchName}!`
        : `*${branchName} — BOOKING ADVANCE INVOICE*\nBooking Ref: *${invoice.invoiceNumber}*\nEvent Date: ${invoice.date}${invoice.time ? ` • ${invoice.time}` : ''}\nCustomer: ${invoice.clientName || 'Valued Customer'}\n*Total Quoted Price:* ${formatCurrency(invoice.total)}\n*Total Advance Paid (${methodSummary}):* ${formatCurrency(invoice.totalAdvanceReceived ?? invoice.amountPaid)}\n*Remaining Balance (Due on Event):* ${formatCurrency(invoice.amountDue)}\n\n📄 _Please find your official Booking Advance Invoice PDF attached above._\nThank you for choosing ${branchName}!`)
    : (invoice.advanceAdjusted && invoice.advanceAdjusted > 0
        ? `*${branchName} — OFFICIAL RECEIPT*\nInvoice No: *${invoice.invoiceNumber}*\nDate: ${invoice.date}${invoice.time ? ` • ${invoice.time}` : ''}\nCustomer: ${invoice.clientName || 'Valued Customer'}\n*Total Bill:* ${formatCurrency(invoice.total)}\nBooking Advance Applied: - ${formatCurrency(invoice.advanceAdjusted)}\nRemaining Payable: ${formatCurrency(Math.max(0, invoice.total - invoice.advanceAdjusted))}\n*Checkout Payment (${methodSummary}):* ${formatCurrency(Math.max(0, invoice.amountPaid - invoice.advanceAdjusted))}\n*Total Settled:* ${formatCurrency(invoice.amountPaid)}\n*Outstanding Balance:* ${formatCurrency(invoice.amountDue)}\n\n📄 _Please find your official PDF Receipt attached above._\nThank you for visiting!`
        : `*${branchName} — OFFICIAL RECEIPT*\nInvoice No: *${invoice.invoiceNumber}*\nDate: ${invoice.date}${invoice.time ? ` • ${invoice.time}` : ''}\nCustomer: ${invoice.clientName || 'Valued Customer'}\n*Total Payable:* ${formatCurrency(invoice.total)}\n*Paid Amount (${methodSummary}):* ${formatCurrency(invoice.amountPaid)}\n*Outstanding Balance:* ${formatCurrency(invoice.amountDue)}\n\n📄 _Please find your official PDF Receipt attached above._\nThank you for visiting!`);
  const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(summaryText)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
  return { sharedDirectly: false, downloaded: true, fileName: generated.fileName, phone: cleanPhone, file: generated.file };
}
