import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Download, Printer, AlertCircle } from 'lucide-react';
import { formatPkr, downloadReceiptPdf } from '../pos/receiptPdf';
import { Invoice, Branch } from '@/types/salon';
import { ScissorLoader } from '@/components/ui/ScissorLoader';

interface PublicReceiptPageProps {
  reference?: string;
  token?: string | null;
  keyParam?: string | null;
}

export const PublicReceiptPage: React.FC<PublicReceiptPageProps> = ({ reference, token, keyParam }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadTriggered, setDownloadTriggered] = useState(false);

  // 1. Fetch receipt data snapshot
  useEffect(() => {
    let isMounted = true;
    const fetchReceipt = async () => {
      try {
        setLoading(true);
        setError(null);
        let endpoint = '';
        if (keyParam && reference) {
          endpoint = `/api/v1/public/receipts/verify?ref=${encodeURIComponent(reference)}&k=${encodeURIComponent(keyParam)}`;
        } else if (token) {
          endpoint = `/api/v1/public/receipts/verify?token=${encodeURIComponent(token)}`;
        } else {
          endpoint = `/api/v1/public/receipt/${encodeURIComponent(reference || '')}`;
        }

        const res = await fetch(endpoint);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || 'Invoice or Booking receipt not found or verification key is invalid.');
        }
        const json = await res.json();
        if (isMounted) setData(json.data);
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load receipt.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (token || reference || keyParam) {
      fetchReceipt();
    } else {
      setLoading(false);
      setError('No receipt reference or access token provided.');
    }
    return () => { isMounted = false; };
  }, [reference, token, keyParam]);

  // 2. Prepare Invoice object for PDF generation
  const invoiceForPdf = useMemo<Invoice | null>(() => {
    if (!data) return null;
    const branch = data.branch;
    const isBkg = data.type === 'BOOKING_INVOICE' || data.invoiceNumber?.startsWith('BKG');
    return {
      id: data.invoiceNumber || 'INV',
      invoiceNumber: data.invoiceNumber,
      branchId: branch?.id || '',
      date: data.date,
      time: data.time || '',
      clientName: data.clientName,
      clientPhone: data.clientPhone,
      subtotal: data.subtotal,
      discount: data.discount,
      discountType: 'FIXED',
      discountValue: data.discount,
      netSales: (data.subtotal || 0) - (data.discount || 0),
      tax: data.tax,
      tip: data.tip || 0,
      total: data.total,
      paymentMethod: data.payments?.[0]?.method || 'CASH',
      status: data.amountDue <= 0 ? 'PAID' : (data.amountPaid > 0 ? 'PARTIAL' : 'UNPAID'),
      lifecycle: 'ACTIVE',
      amountPaid: data.amountPaid,
      amountDue: data.amountDue,
      advanceAdjusted: data.advanceAdjusted || 0,
      totalAdvanceReceived: data.totalAdvanceReceived ?? data.amountPaid,
      staffId: '',
      staffName: '',
      processedByName: '',
      processedByUserId: '',
      isBookingInvoice: isBkg,
      bookingType: data.bookingType,
      lineItems: (data.lines || []).map((l: any, i: number) => ({
        id: l.id || `l-${i}`,
        lineInstanceId: `li-${i}`,
        name: l.name,
        type: l.type || 'SERVICE',
        quantity: l.quantity || 1,
        unitPrice: l.unitPrice || 0,
        tax: 0,
        netSales: l.netSales || 0,
        discountAllocated: l.discountAllocated || 0,
        total: l.total || (l.unitPrice * (l.quantity || 1)),
        staffId: '',
        staffName: '',
        packageComponentsSnapshot: (l.components || []).map((c: any) => ({
          serviceId: '',
          serviceCode: '',
          serviceName: c.serviceName,
          staffId: '',
          staffName: '',
          quantity: 1,
          allocationPercentage: 0,
          allocatedAmount: 0,
          staffCommissionRate: 0,
        })),
      })),
      payments: data.payments || [],
    };
  }, [data]);

  // 3. Download handler: stream direct server PDF or fallback to client generator
  const handleDownload = useCallback(async () => {
    if (!data) return;
    try {
      setIsDownloading(true);
      const ref = data.invoiceNumber || reference || '';
      const downloadUrl = keyParam && ref
        ? `/api/v1/public/receipts/pdf?ref=${encodeURIComponent(ref)}&k=${encodeURIComponent(keyParam)}`
        : token
        ? `/api/v1/public/receipts/pdf?token=${encodeURIComponent(token)}`
        : `/api/v1/public/receipt/${encodeURIComponent(ref)}?download=pdf`;

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `Receipt-${ref || 'INV'}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      if (invoiceForPdf) {
        await downloadReceiptPdf(invoiceForPdf, data.branch);
      }
    } finally {
      setIsDownloading(false);
    }
  }, [data, keyParam, reference, token, invoiceForPdf]);

  // 4. Auto-download once data is ready
  useEffect(() => {
    if (data && !downloadTriggered) {
      setDownloadTriggered(true);
      const timer = setTimeout(() => {
        handleDownload();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [data, downloadTriggered, handleDownload]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ── Render States ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F5F6] flex flex-col items-center justify-center font-sans p-4">
        <ScissorLoader size="lg" />
        <p className="mt-4 text-[#78616C] text-sm font-medium animate-pulse">Loading Invoice...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F8F5F6] flex items-center justify-center font-sans p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center shadow-md">
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl">
            <AlertCircle className="w-7 h-7 text-rose-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Invoice Not Found</h2>
          <p className="text-sm text-slate-600 mb-6">{error || 'The requested booking or invoice record could not be found.'}</p>
          <a
            href="/"
            className="inline-block px-5 py-2.5 bg-[#9D2558] hover:bg-[#851C47] text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
          >
            Return to Homepage
          </a>
        </div>
      </div>
    );
  }

  const branch: Branch | null = data.branch;
  const isBkg = data.type === 'BOOKING_INVOICE' || data.invoiceNumber?.startsWith('BKG');
  const lines = data.lines || [];

  return (
    <div className="min-h-screen bg-[#F2EFF1] py-6 px-3 sm:px-4 font-sans text-slate-800">
      <div className="max-w-[440px] mx-auto space-y-3">
        {/* Top Control Bar with Download & Print Options */}
        <div className="flex items-center justify-between gap-3 bg-white px-4 py-2.5 rounded-2xl border border-slate-200/90 shadow-sm print:hidden">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-xs font-bold text-slate-800">Official Invoice</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#9D2558] hover:bg-[#851C47] text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isDownloading ? 'Downloading...' : 'Download PDF'}</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center justify-center p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs transition-colors cursor-pointer"
              title="Print Invoice"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Authentic Printable Thermal Invoice Paper Slip */}
        <div className="bg-white border border-slate-300 rounded-2xl p-5 sm:p-6 shadow-sm text-xs text-black font-sans space-y-3 print:border-none print:shadow-none print:p-0 print:m-0">
          {/* Header Brand */}
          <div className="text-center space-y-1 pb-3 border-b-2 border-dashed border-black">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#9D2558] text-white font-bold text-xs mb-1">
              {(branch?.name || 'MS').slice(0, 2).toUpperCase()}
            </div>
            <h1 className="font-extrabold text-base tracking-tight text-black uppercase">
              {branch?.name || 'MEERUB SALON & SPA'}
            </h1>
            <p className="text-[11.5px] font-semibold text-black">{branch?.address}{branch?.city ? `, ${branch.city}` : ''}</p>
            {branch?.phone && <p className="text-[11.5px] font-semibold text-black">Tel: {branch.phone}</p>}
            {branch?.taxRegistrationNumber && (
              <div className="pt-0.5 text-[10.5px] font-bold text-black font-mono">
                {branch.taxAuthority || 'Tax Reg'}: {branch.taxRegistrationNumber}
              </div>
            )}
          </div>

          {/* Invoice Document Title */}
          <div className="text-center font-extrabold text-xs uppercase tracking-wider text-black py-0.5">
            {isBkg ? 'BOOKING ADVANCE INVOICE' : 'TRANSACTION RECEIPT'}
          </div>

          {/* Metadata Section */}
          <div className="grid grid-cols-2 gap-2 text-[11px] py-2 border-y-2 border-dashed border-black">
            <div>
              <span className="text-black block text-[10px] uppercase font-bold">
                {isBkg ? 'Booking Ref:' : 'Invoice No:'}
              </span>
              <span className="font-mono font-bold text-black text-xs">{data.invoiceNumber}</span>
            </div>
            <div className="text-right">
              <span className="text-black block text-[10px] uppercase font-bold">
                {isBkg ? 'Event Date & Time:' : 'Date & Time:'}
              </span>
              <span className="font-bold text-black">{data.date}{data.time ? ` • ${data.time}` : ''}</span>
            </div>
            <div className="col-span-2">
              <span className="text-black block text-[10px] uppercase font-bold">Customer:</span>
              <span className="font-extrabold text-black">{data.clientName} {data.clientPhone ? `(${data.clientPhone})` : ''}</span>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="py-1 space-y-2">
            <div className="flex justify-between font-extrabold text-[10.5px] text-black uppercase tracking-wider border-b-2 border-dashed border-black pb-1">
              <span>{isBkg ? 'Reserved Service / Item' : 'Item / Service'}</span>
              <span className="text-right">Amount</span>
            </div>

            <div className="space-y-1.5">
              {lines.map((li: any, idx: number) => (
                <div key={idx} className="space-y-0.5 pb-1 border-b border-slate-200 text-[11.5px]">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1">
                      <span className="font-bold text-black block">
                        {li.quantity > 1 ? `${li.quantity}x ` : ''}{li.name}
                      </span>
                      {li.components && li.components.length > 0 && (
                        <div className="pl-2 border-l-2 border-black mt-0.5 text-[10.5px] font-semibold text-black space-y-0.5">
                          {li.components.map((c: any, ci: number) => (
                            <div key={ci}>• {c.serviceName}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="font-mono font-bold text-black shrink-0 text-right">
                      {formatPkr(li.total || (li.unitPrice * (li.quantity || 1)))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Calculation Summary (Thermal Slip Style) */}
          <div className="space-y-1.5 pt-2 border-t-2 border-dashed border-black text-xs font-semibold">
            <div className="flex justify-between text-black">
              <span>Subtotal:</span>
              <span className="font-mono font-bold">{formatPkr(data.subtotal)}</span>
            </div>
            {data.discount > 0 && (
              <div className="flex justify-between text-black">
                <span>Discount:</span>
                <span className="font-mono font-bold">- {formatPkr(data.discount)}</span>
              </div>
            )}
            {data.tax > 0 && (
              <div className="flex justify-between text-black">
                <span>Sales Tax:</span>
                <span className="font-mono font-bold">{formatPkr(data.tax)}</span>
              </div>
            )}

            <div className="flex justify-between items-center text-black font-extrabold pt-1.5 border-t border-slate-300 text-sm">
              <span>{isBkg ? 'Total Quoted Price:' : 'Total Bill:'}</span>
              <span className="font-mono font-black text-black">{formatPkr(data.total)}</span>
            </div>

            <div className="flex justify-between items-center text-black font-bold">
              <span>{isBkg ? 'Total Advance Paid:' : 'Total Paid:'}</span>
              <span className="font-mono font-extrabold">{formatPkr(data.amountPaid)}</span>
            </div>

            <div className="flex justify-between items-center font-black pt-1.5 border-t-2 border-dashed border-black text-sm">
              <span className={data.amountDue > 0 ? 'text-rose-700' : 'text-black'}>
                {isBkg ? 'Remaining Balance (Due on Event):' : 'Outstanding Balance:'}
              </span>
              <span className={`font-mono ${data.amountDue > 0 ? 'text-rose-700' : 'text-black'}`}>
                {formatPkr(data.amountDue)}
              </span>
            </div>
          </div>

          {/* Footer Note */}
          <div className="text-center text-[10.5px] font-semibold text-black pt-3 border-t-2 border-dashed border-black space-y-1">
            {isBkg && (
              <p className="font-bold text-black text-[11px]">
                * Advance payment receipt. Remaining balance payable on event date.
              </p>
            )}
            <p className="font-bold">Thank you for choosing {branch?.name || 'MEERUB SALON & SPA'}!</p>
            <p className="font-mono text-[9.5px] font-medium text-black">Powered by Isysware Software Solutions</p>
          </div>
        </div>
      </div>
    </div>
  );
};
