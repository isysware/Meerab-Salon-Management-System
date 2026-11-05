import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Invoice, Branch } from '@/types/salon';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/context/ToastContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Printer,
  PlusCircle,
  CheckCircle2,
  Copy,
  Check,
  RotateCcw,
  Send,
  Phone,
  X,
  FileDown,
  Loader2,
  AlertCircle,
  Info,
} from 'lucide-react';
import {
  downloadReceiptPdf,
  shareReceiptPdfViaWhatsApp,
  getCleanWhatsAppPhone,
  printThermalReceipt,
  getPaymentMethodSummary,
} from './receiptPdf';

const WhatsAppIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.888 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 00-3.48-8.413Z" />
  </svg>
);

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  branch: Branch | null;
  onNewSale?: () => void;
  onRefund?: (invoice: Invoice) => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  invoice,
  branch,
  onNewSale,
  onRefund,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isPromptingPhone, setIsPromptingPhone] = useState(false);
  const [inputPhone, setInputPhone] = useState('');
  const [copied, setCopied] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<{ fileName: string; phone: string } | null>(null);

  useEffect(() => {
    if (invoice?.clientPhone && invoice.clientPhone !== 'N/A') {
      setInputPhone(invoice.clientPhone);
    } else {
      setInputPhone('');
    }
    setIsPromptingPhone(false);
    setCopied(false);
    setPdfNotice(null);
  }, [invoice, isOpen]);

  const fullWhatsAppMessage = useMemo(() => {
    if (!invoice) return '';
    const branchTitle = (branch?.name || 'SALON & SPA').toUpperCase();
    const branchAddress = branch?.address ? `Branch: ${branch.address}${branch?.city ? `, ${branch.city}` : ''}` : '';
    const branchPhone = branch?.phone ? `Contact: ${branch.phone}` : '';

    const lines = invoice.lineItems || invoice.lines || [];
    const items = lines
      .map((li) => {
        const qty = li.quantity > 1 ? `${li.quantity}x ` : '';
        const stylist = li.staffName ? `\n  Stylist: ${li.staffName}` : '';
        const breakdown = li.batchAllocations?.map(a => `\n  ${a.quantity} × ${formatCurrency(a.sellingPrice)}`).join('') || '';
        return `• ${qty}${li.name}${stylist}\n  Amount: ${formatCurrency(li.netSales == null ? li.unitPrice * li.quantity : li.netSales + (li.discountAllocated ?? 0))}${breakdown}`;
      })
      .join('\n');

    let discounts = '';
    if (invoice.discount > 0) {
      discounts = `\nDiscount: -${formatCurrency(invoice.discount)}`;
    }

    let netSales = '';
    if (invoice.discount > 0) {
      netSales = `\nNet Amount: ${formatCurrency(invoice.netSales)}`;
    }

    let tax = '';
    if (invoice.tax > 0) {
      const taxRate = branch?.taxEnabled ? ` (${((branch.taxRate || 0) * 100).toFixed(0)}%)` : '';
      tax = `\nSales Tax${taxRate}: ${formatCurrency(invoice.tax)}`;
    }

    let tip = '';
    if (invoice.tip > 0) {
      tip = `\nStaff Gratuity: ${formatCurrency(invoice.tip)}`;
    }

    const methodSummary = getPaymentMethodSummary(invoice);

    const headerLines = [
      `*${branchTitle}*`,
      branchAddress,
      branchPhone,
    ].filter(Boolean).join('\n');

    const isBkg = Boolean(invoice.isBookingInvoice || invoice.invoiceNumber?.startsWith('BKG'));
    const bkgType =
      invoice.bookingType === 'BRIDAL'
        ? 'Bridal Event'
        : invoice.bookingType === 'GROOM'
        ? 'Groom Event'
        : 'Salon Reservation';

    if (isBkg) {
      return `${headerLines}
================================
*BOOKING ADVANCE INVOICE*
Booking Ref: ${invoice.invoiceNumber}
Event Type: ${bkgType}
Event Date: ${invoice.date}${invoice.time ? ` • ${invoice.time}` : ''}
Customer: ${invoice.clientName || 'Valued Customer'}${invoice.clientPhone && invoice.clientPhone !== 'N/A' ? ` (${invoice.clientPhone})` : ''}
================================
*RESERVED SERVICES:*
${items}
--------------------------------
Total Quoted Price: ${formatCurrency(invoice.total)}${discounts}
*Advance Paid (${methodSummary}): ${formatCurrency(invoice.amountPaid)}*
*Remaining Balance (Due on Event): ${formatCurrency(invoice.amountDue)}*
================================
* Advance payment received with thanks.
* Please settle remaining balance on the event date.
Thank you for choosing ${branch?.name || 'Meerub Salon & Spa'}!`;
    }

    return `${headerLines}
================================
*SALES INVOICE*
Invoice No: ${invoice.invoiceNumber}
Date: ${invoice.date}${invoice.time ? ` • ${invoice.time}` : ''}
Customer: ${invoice.clientName || 'Walk-in Customer'}
${invoice.processedByName ? `Cashier: ${invoice.processedByName}\n` : ''}================================
*SERVICES & ITEMS:*
${items}
--------------------------------
Gross Subtotal: ${formatCurrency(invoice.subtotal)}${discounts}${netSales}${tax}${tip}
*Total Payable: ${formatCurrency(invoice.total)}*
*Paid Amount (${methodSummary}): ${formatCurrency(invoice.amountPaid)}*
*Outstanding Balance: ${formatCurrency(invoice.amountDue)}*
================================
Thank you for your visit!
Powered by Isysware Software Solutions`;
  }, [invoice, branch]);

  const handleSendWhatsAppPdf = async (targetPhone: string) => {
    if (!invoice) return;
    const cleanPhone = getCleanWhatsAppPhone(targetPhone);
    if (!cleanPhone) {
      setIsPromptingPhone(true);
      toast.error('Please enter customer WhatsApp number.');
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const res = await shareReceiptPdfViaWhatsApp({
        invoice,
        branch,
        targetPhone: cleanPhone,
      });

      if (res.sharedDirectly) {
        toast.success('Receipt PDF shared to WhatsApp!');
        setIsPromptingPhone(false);
      } else {
        // Desktop browser flow
        setIsPromptingPhone(false);
        setPdfNotice({ fileName: res.fileName, phone: res.phone });
        toast.success(`Receipt PDF downloaded & WhatsApp opened for +${res.phone}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate receipt PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleWhatsAppClick = () => {
    if (!invoice) return;
    const phone = inputPhone || invoice.clientPhone || '';
    if (phone && phone !== 'N/A' && phone.trim() !== '') {
      handleSendWhatsAppPdf(phone);
    } else {
      setIsPromptingPhone(true);
    }
  };

  const handleDownloadPdf = async () => {
    if (!invoice) return;
    setIsGeneratingPdf(true);
    try {
      const fileName = await downloadReceiptPdf(invoice, branch);
      toast.success(`Downloaded ${fileName}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to download receipt PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(fullWhatsAppMessage);
    setCopied(true);
    toast.success('Invoice text copied to clipboard!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    if (!invoice) return;
    printThermalReceipt(invoice, branch);
  };

  if (!isOpen || !invoice) return null;

  const isPaid = invoice.status === 'PAID';
  const isPartial = invoice.status === 'PARTIAL';
  const isBkg = Boolean(invoice.isBookingInvoice || invoice.invoiceNumber?.startsWith('BKG'));
  const lines = invoice.lineItems || invoice.lines || [];
  const payments = invoice.payments || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[560px] w-[95vw] sm:w-full max-h-[88vh] flex flex-col p-0 overflow-hidden font-sans border border-white/90 shadow-[0_16px_50px_rgba(35,21,29,0.12)] rounded-[26px] bg-white/95 backdrop-blur-2xl print:p-0 print:border-none print:shadow-none print:rounded-none">
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 py-3.5 border-b border-rose-100/60 flex flex-row items-center justify-between shrink-0 bg-white/60 backdrop-blur-md print:hidden">
          <DialogTitle className="flex items-center gap-2 text-sm font-extrabold text-[#18191B]">
            <span className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            </span>
            <span>{isBkg ? 'Booking Advance Invoice' : 'Transaction Receipt'}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 pr-6">
            <Badge
              variant={isPaid ? 'success' : isPartial ? 'warning' : 'neutral'}
              className="text-[11px] font-bold rounded-full px-2.5 py-0.5"
            >
              {isBkg && isPartial ? 'ADVANCE PAID' : isBkg && isPaid ? 'FULLY PAID' : invoice.status}
            </Badge>
          </div>
        </DialogHeader>

        {/* Scrollable Receipt Area */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 overflow-y-auto flex-1 space-y-3">
          {/* Minimal Quick Phone Prompt when customer has no phone number on file */}
          {isPromptingPhone && (
            <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl p-3 space-y-2 animate-in fade-in duration-150 print:hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                  <WhatsAppIcon className="w-3.5 h-3.5 text-[#25D366]" />
                  Enter Customer WhatsApp Number
                </span>
                <button
                  type="button"
                  onClick={() => setIsPromptingPhone(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs p-0.5"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    autoFocus
                    value={inputPhone}
                    onChange={(e) => setInputPhone(e.target.value)}
                    placeholder="0300 1234567"
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-slate-900"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSendWhatsAppPdf(inputPhone);
                      }
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={isGeneratingPdf}
                  onClick={() => handleSendWhatsAppPdf(inputPhone)}
                  className="bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs gap-1.5 h-8 font-medium px-3 shrink-0"
                >
                  {isGeneratingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send PDF
                </Button>
              </div>
            </div>
          )}

          {/* Guidance Banner when PDF has been generated & downloaded on desktop */}
          {pdfNotice && (
            <div className="bg-emerald-50/95 border border-emerald-300 rounded-xl p-3 text-xs space-y-1.5 animate-in fade-in duration-150 print:hidden shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-900 flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  Receipt PDF Downloaded & WhatsApp Opened!
                </span>
                <button
                  type="button"
                  onClick={() => setPdfNotice(null)}
                  className="text-slate-400 hover:text-slate-600 text-xs p-0.5"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-slate-700 text-[11px] leading-relaxed">
                Downloaded: <strong className="font-mono text-emerald-950 font-bold">{pdfNotice.fileName}</strong>
              </p>
              <div className="bg-white/90 border border-emerald-200/90 rounded-lg p-2 text-[11px] text-slate-700 space-y-0.5">
                <p className="text-emerald-900 font-semibold">How to send on WhatsApp Web:</p>
                <p>1. Open the WhatsApp tab for <strong>+{pdfNotice.phone}</strong>.</p>
                <p>2. Drag & drop the downloaded PDF or press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px] text-slate-900 font-semibold">Ctrl + V</kbd> to paste receipt!</p>
              </div>
            </div>
          )}

          {/* Printable Receipt Card */}
          <div
            ref={receiptRef}
            className="receipt-print-area bg-white/90 border border-white/90 rounded-[20px] p-4 sm:p-5 text-xs text-slate-800 space-y-3 shadow-[0_4px_20px_rgba(35,21,29,0.04)] print:border-none print:shadow-none print:p-0 print:bg-white"
          >
            {invoice.lifecycle === 'VOIDED' && (
              <div className="bg-rose-50 border border-rose-300 text-rose-800 p-2 rounded-lg text-center font-bold text-xs tracking-wide flex items-center justify-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>THIS INVOICE IS VOIDED</span>
              </div>
            )}
            {invoice.lifecycle === 'REFUNDED' && (
              <div className="bg-purple-50 border border-purple-300 text-purple-800 p-2 rounded-lg text-center font-bold text-xs tracking-wide flex items-center justify-center gap-1.5">
                <Info className="w-4 h-4 shrink-0" />
                <span>FULLY REFUNDED</span>
              </div>
            )}
            {invoice.lifecycle === 'PARTIALLY_REFUNDED' && (
              <div className="bg-amber-50 border border-amber-300 text-amber-800 p-2 rounded-lg text-center font-bold text-xs tracking-wide flex items-center justify-center gap-1.5">
                <Info className="w-4 h-4 shrink-0" />
                <span>PARTIALLY REFUNDED</span>
              </div>
            )}

            {/* Header Brand */}
            <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
              {branch?.logoUrl ? (
                <div className="flex justify-center mb-1.5">
                  <img
                    src={branch.logoUrl}
                    alt={branch.name}
                    className="h-12 max-w-[160px] object-contain"
                  />
                </div>
              ) : (
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#9D2558] text-white font-bold text-xs mb-1">
                  {(branch?.name || 'iS').slice(0, 2).toUpperCase()}
                </div>
              )}
              <h2 className="font-bold text-sm tracking-tight text-slate-900">
                {branch?.name || 'Salon & Spa'}
              </h2>
              <p className="text-[11px] text-slate-500">{branch?.address}, {branch?.city}</p>
              <p className="text-[11px] text-slate-500">Tel: {branch?.phone || '+92 42 3578-9101'}</p>
              {branch?.taxRegistrationNumber && (
                <div className="pt-0.5 text-[10px] text-slate-500 font-mono">
                  <span className="text-slate-400 font-sans">
                    {branch.taxAuthority ? `${branch.taxAuthority}: ` : 'Tax Reg: '}
                  </span>
                  {branch.taxRegistrationNumber}
                </div>
              )}
            </div>

            {/* Invoice Meta */}
            <div className="grid grid-cols-2 gap-2 text-[11px] py-1 border-b border-slate-100">
              <div>
                <span className="text-slate-400 block text-[10px]">{isBkg ? 'Booking Ref' : 'Invoice No.'}</span>
                <span className="font-mono font-bold text-slate-900">{invoice.invoiceNumber}</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">{isBkg ? 'Event Date & Time' : 'Date & Time'}</span>
                <span className="font-medium text-slate-800">{invoice.date} • {invoice.time}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">{isBkg ? 'Event Type' : 'Cashier / Terminal'}</span>
                <span className="font-medium text-slate-800">
                  {isBkg
                    ? invoice.bookingType === 'BRIDAL'
                      ? 'Bridal Event'
                      : invoice.bookingType === 'GROOM'
                      ? 'Groom Event'
                      : 'Salon Reservation'
                    : invoice.processedByName}
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">Customer</span>
                <span className="font-bold text-slate-900">{invoice.clientName}</span>
                {invoice.clientPhone && invoice.clientPhone !== 'N/A' && (
                  <span className="text-[10px] text-slate-500 block font-mono">{invoice.clientPhone}</span>
                )}
              </div>
            </div>

            {/* Line Items Table */}
            <div className="space-y-1.5 py-1">
              <div className="flex justify-between font-semibold text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-1">
                <span>{isBkg ? 'Reserved Service / Item' : 'Item / Service'}</span>
                <span className="text-right">Amount</span>
              </div>

              {lines.map((li, idx) => (
                <div key={li.id || idx} className="space-y-0.5 pb-1.5 border-b border-slate-50 text-[11px]">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900 block truncate">
                        {li.quantity > 1 ? `${li.quantity}x ` : ''}{li.name}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Stylist: {li.staffName}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-slate-900 shrink-0 text-right">
                      {formatCurrency(li.netSales == null ? li.unitPrice * li.quantity : li.netSales + (li.discountAllocated ?? 0))}
                      {li.batchAllocations?.map(a => <span key={a.batchId} className="block text-[10px] font-normal text-slate-500">{a.batchNumber}: {a.quantity} × {formatCurrency(a.sellingPrice)}</span>)}
                    </span>
                  </div>

                  {li.type === 'PACKAGE' && li.packageComponents && (
                    <div className="pl-2 border-l-2 border-[#F1DEE3] space-y-0.5 mt-0.5 text-[10px] text-slate-600">
                      {li.packageComponents.map((comp) => (
                        <div key={comp.serviceId} className="flex justify-between items-center gap-2">
                          <span className="truncate">• {comp.serviceName}</span>
                          {comp.allocatedAmount > 0 && (
                            <span className="font-mono text-slate-500 shrink-0">{formatCurrency(comp.allocatedAmount)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Compact Payment Summary (3 Lines) */}
            <div className="space-y-1 pt-2 border-t border-dashed border-slate-300 text-xs">
              {invoice.discount > 0 && (
                <div className="flex justify-between items-center text-emerald-700">
                  <span>Discount:</span>
                  <span className="font-mono font-semibold">- {formatCurrency(invoice.discount)}</span>
                </div>
              )}

              {invoice.tax > 0 && (
                <div className="flex justify-between items-center text-slate-600">
                  <span>Sales Tax ({branch?.taxEnabled ? `${((branch.taxRate || 0) * 100).toFixed(0)}%` : 'Tax'}):</span>
                  <span className="font-mono font-semibold">{formatCurrency(invoice.tax)}</span>
                </div>
              )}

              {invoice.tip > 0 && (
                <div className="flex justify-between items-center text-amber-700">
                  <span>Staff Gratuity / Tip:</span>
                  <span className="font-mono font-semibold">+ {formatCurrency(invoice.tip)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-slate-900 font-bold pt-1 border-t border-slate-200">
                <span>{isBkg ? 'Total Quoted Price:' : 'Total Payable:'}</span>
                <span className="font-mono text-sm font-extrabold">{formatCurrency(invoice.total)}</span>
              </div>

              <div className="flex justify-between items-center text-slate-900 font-bold">
                <span>{isBkg ? 'Advance Paid' : 'Paid Amount'} ({getPaymentMethodSummary(invoice)}):</span>
                <span className="font-mono text-emerald-700">{formatCurrency(invoice.amountPaid)}</span>
              </div>

              <div className={`flex justify-between items-center font-bold ${invoice.amountDue > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                <span>{isBkg ? 'Remaining Balance (Due on Event):' : 'Outstanding Balance:'}</span>
                <span className="font-mono">{formatCurrency(invoice.amountDue)}</span>
              </div>
            </div>

            {/* Footer Brand Note */}
            <div className="text-center text-[10px] text-slate-400 pt-2 border-t border-dashed border-slate-200 space-y-0.5">
              {isBkg && (
                <p className="font-semibold text-emerald-800 text-[11px]">* Advance payment receipt. Remaining balance payable on event date.</p>
              )}
              <p>Thank you for choosing {branch?.name || 'Meerub Salon & Spa'}!</p>
              <p className="font-mono text-[9px] text-slate-400">Powered by Isysware Software Solutions</p>
            </div>
          </div>
        </div>

        {/* Footer Actions Toolbar */}
        <div className="px-3 sm:px-6 py-3 border-t border-rose-100/60 bg-white/70 backdrop-blur-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 print:hidden">
          {/* Secondary Actions (Close, Refund, Copy) */}
          <div className="flex items-center gap-1.5 order-2 sm:order-1">
            <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-8 px-3 text-[#18191B] rounded-xl border border-rose-100/80 bg-white/80 hover:bg-rose-50/50">
              Close
            </Button>
            {onRefund && invoice.lifecycle !== 'VOIDED' && invoice.lifecycle !== 'REFUNDED' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onRefund(invoice);
                }}
                className="text-xs gap-1 h-8 px-2.5 text-rose-700 border-rose-200 bg-rose-50/60 hover:bg-rose-100/60 rounded-xl font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                <span>Refund</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyMessage}
              title="Copy receipt text to clipboard"
              className="text-xs h-8 px-2.5 text-slate-700 border-rose-100/80 bg-white/80 hover:bg-rose-50/50 rounded-xl"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="sm:hidden text-[11px] ml-1">Copy Text</span>
            </Button>
          </div>

          {/* Primary Action Buttons (WhatsApp, PDF, Print, New Sale) */}
          <div className="flex items-center gap-1.5 order-1 sm:order-2 flex-wrap sm:flex-nowrap justify-end">
            {/* Direct WhatsApp PDF Share Button */}
            <Button
              size="sm"
              disabled={isGeneratingPdf}
              onClick={handleWhatsAppClick}
              className="bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs gap-1.5 h-8 px-2.5 sm:px-3 font-semibold rounded-xl cursor-pointer shadow-xs disabled:opacity-60 shrink-0"
              title="Send A to Z receipt PDF to customer WhatsApp"
            >
              {isGeneratingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <WhatsAppIcon className="w-3.5 h-3.5" />
              )}
              <span>WhatsApp PDF</span>
            </Button>

            {/* Direct PDF Download Button */}
            <Button
              variant="outline"
              size="sm"
              disabled={isGeneratingPdf}
              onClick={handleDownloadPdf}
              className="text-xs gap-1 h-8 px-2.5 text-slate-700 border-rose-100/80 bg-white/80 hover:bg-rose-50/50 rounded-xl shrink-0"
              title="Download receipt PDF directly"
            >
              <FileDown className="w-3.5 h-3.5 text-slate-600" />
              <span>PDF</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="text-xs gap-1 h-8 px-2.5 text-slate-700 border-rose-100/80 bg-white/80 hover:bg-rose-50/50 rounded-xl shrink-0"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>Print</span>
            </Button>

            {onNewSale && (
              <Button
                size="sm"
                onClick={() => {
                  onClose();
                  onNewSale();
                }}
                className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#9D2558] hover:to-[#831F49] text-white text-xs gap-1.5 h-8 px-3.5 font-bold rounded-xl shrink-0 cursor-pointer shadow-[0_4px_14px_rgba(184,46,105,0.25)] transition-all active:scale-[0.98]"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>New Sale</span>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
