import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  DetailedIncomeReport,
  DetailedIncomeRow,
  DetailedIncomeReportQuery,
  InvoiceStatus,
  InvoiceLifecycle,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  downloadReportCsv,
  printReportWindow,
  resolvePreset,
} from '@/features/reports/reportUtils';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  Loader2,
  Receipt,
  ChevronDown,
  ChevronUp,
  Scissors,
  ShoppingBag,
  PackageCheck,
  CreditCard,
  Search,
  RotateCw,
  Calendar,
} from 'lucide-react';

const selectClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium cursor-pointer transition-all';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

const formatPKR = (amt: number) => {
  const num = Number(amt) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDateParts = (dateStr: string) => {
  if (!dateStr) return { dayMonth: '—', year: '' };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { dayMonth: dateStr, year: '' };
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = String(d.getFullYear());
    return { dayMonth: `${day} ${month}`, year };
  } catch {
    return { dayMonth: dateStr, year: '' };
  }
};

const formatDateDisplay = (dateStr: string) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDate();
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month}, ${year}`;
  } catch {
    return dateStr;
  }
};

export const DetailedIncomeReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/detailed-income" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isAccountant = user.role === 'ACCOUNTANT';
  const defaultBranch = isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '');

  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultRange = resolvePreset('THIS_MONTH', businessDate) || {
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    to: businessDate,
  };

  // Filters State
  const [selectedBranch, setSelectedBranch] = useState<string>(defaultBranch);
  const [fromDate, setFromDate] = useState<string>(defaultRange.from);
  const [toDate, setToDate] = useState<string>(defaultRange.to);
  const [sourceType, setSourceType] = useState<string>('ALL');
  const [paymentStatus, setPaymentStatus] = useState<string>('ALL');
  const [lifecycle, setLifecycle] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Page State
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportData, setReportData] = useState<DetailedIncomeReport | null>(null);

  // Expandable Row Set
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchReport = useCallback(
    async (q: DetailedIncomeReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getDetailedIncomeReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load detailed income report:', err);
        setErrorMessage(err.message || 'Failed to fetch live detailed income report.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: DetailedIncomeReportQuery = {
      branchId: selectedBranch !== 'ALL' ? selectedBranch : undefined,
      startDate: fromDate || undefined,
      endDate: toDate || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      preset: !fromDate && !toDate ? 'THIS_MONTH' : 'CUSTOM',
      sourceType: (sourceType as any) || 'ALL',
      paymentStatus: (paymentStatus as any) || 'ALL',
      lifecycle: (lifecycle as any) || 'ALL',
      search: searchQuery.trim() || undefined,
      soldByUserId: isAccountant ? user.id : undefined,
    };

    fetchReport(query);
  };

  // Auto-fetch default monthly report on initial mount
  useEffect(() => {
    const query: DetailedIncomeReportQuery = {
      branchId: defaultBranch !== 'ALL' ? defaultBranch : undefined,
      startDate: defaultRange.from,
      endDate: defaultRange.to,
      from: defaultRange.from,
      to: defaultRange.to,
      preset: 'THIS_MONTH',
      sourceType: 'ALL',
      paymentStatus: 'ALL',
      lifecycle: 'ALL',
      soldByUserId: isAccountant ? user.id : undefined,
    };
    fetchReport(query);
  }, [defaultBranch, defaultRange.from, defaultRange.to, isAccountant, user.id, fetchReport]);

  const filteredRows = useMemo(() => {
    if (!reportData) return [];
    return reportData.displayRows ?? reportData.rows;
  }, [reportData]);

  const handleExportCsv = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Display Basis', 'One row per original invoice/service line. Net amounts use selected payment/refund dates; original bills are reference values.'],
      ['Gross Customer Collection (Incl. Tax/Tips)', formatPKR(reportData.kpis.totalPaid)],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Source Filter', sourceType],
      ['Total Line Transactions', String(reportData.kpis.totalTransactions)],
      ['Total Collected Net Revenue', formatPKR(reportData.kpis.recognizedNetRevenue)],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Date',
      'Source',
      'Item Name',
      'Client',
      'Staff',
      'Branch',
      'Qty',
      'Unit Price',
      'Allocated Sales Before Discount (Excl. Tax)',
      'Discount',
      'Collected Net',
      'Tax',
      'Total',
      'Status',
      'Lifecycle',
      'Created By',
    ];

    const rows = (reportData.displayRows ?? reportData.rows).map((r, i) => [
      i + 1,
      r.invoiceNumber,
      formatDateDisplay(r.date),
      r.incomeSource,
      r.itemName + ' | Original net: ' + formatPKR(r.originalNetAmount ?? r.netSales) + '; Original line bill (incl. tax): ' + formatPKR(r.originalBillAmount ?? r.total) + '; Period refund credit (incl. tax): ' + formatPKR(r.refundAmount ?? 0) + '; Outstanding at period end: ' + formatPKR(r.outstanding ?? 0) + '; Dated events: ' + r.payments.map(p => p.date + ' ' + (p.receiptNumber || p.id) + ' ' + formatPKR(p.amount)).join('; '),
      r.clientName,
      r.staffName,
      r.branchName,
      r.quantity,
      r.unitPrice.toFixed(2),
      r.gross.toFixed(2),
      r.discount.toFixed(2),
      r.recognizedNet.toFixed(2),
      r.tax.toFixed(2),
      r.total.toFixed(2),
      r.lifecycle === 'REFUNDED' || r.lifecycle === 'PARTIALLY_REFUNDED' ? r.lifecycle : r.paymentStatus,
      r.lifecycle,
      r.createdByName,
    ]);

    downloadReportCsv('Detailed_Income_Report', meta, [{ headers, rows }]);
  };

  const handlePrint = () => {
    if (!reportData || !reportData.rows.length) {
      window.print();
      return;
    }
    const meta: [string, string][] = [
      ['Display Basis', 'One row per original invoice/service line. Net amounts use selected payment/refund dates; original bills are reference values.'],
      ['Gross Customer Collection (Incl. Tax/Tips)', formatPKR(reportData.kpis.totalPaid)],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Total Transactions', String(reportData.kpis.totalTransactions)],
      ['Collected Net Revenue', `PKR ${formatPKR(reportData.kpis.recognizedNetRevenue)}`],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Date',
      'Source',
      'Item',
      'Client',
      'Staff',
      'Net Sales',
      'Tax',
      'Total',
      'Status',
    ];

    const rows = (reportData.displayRows ?? reportData.rows).map((r, i) => [
      i + 1,
      r.invoiceNumber,
      formatDateDisplay(r.date),
      r.incomeSource,
      r.itemName + ' | Original net: ' + formatPKR(r.originalNetAmount ?? r.netSales) + '; Original line bill (incl. tax): ' + formatPKR(r.originalBillAmount ?? r.total) + '; Period refund credit (incl. tax): ' + formatPKR(r.refundAmount ?? 0) + '; Outstanding at period end: ' + formatPKR(r.outstanding ?? 0) + '; Dated events: ' + r.payments.map(p => p.date + ' ' + (p.receiptNumber || p.id) + ' ' + formatPKR(p.amount)).join('; '),
      r.clientName,
      r.staffName,
      formatPKR(r.recognizedNet),
      formatPKR(r.tax),
      formatPKR(r.total),
      r.lifecycle === 'REFUNDED' || r.lifecycle === 'PARTIALLY_REFUNDED' ? r.lifecycle : r.paymentStatus,
    ]);

    printReportWindow({
      title: 'Detailed Income Report (Collected Revenue)',
      meta,
      headers,
      rows,
    });
  };

  const totals = reportData?.totals || {
    gross: 0,
    discount: 0,
    netSales: 0,
    refundedNet: 0,
    recognizedNet: 0,
    tax: 0,
    netTax: 0,
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Detailed Income Report
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  Collected Revenue
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Transaction-level collection register by payment date: granular drilldown by service, package component and retail product
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3.5 items-end">
          {/* Branch */}
          <div>
            <label className={labelClass}>Branch</label>
            <select
              value={selectedBranch}
              disabled={!isSuperAdmin}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className={selectClass}
            >
              {isSuperAdmin && <option value="ALL">All Branches</option>}
              {allBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Source Type */}
          <div>
            <label className={labelClass}>Income Source</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">All Sources</option>
              <option value="SERVICE">Services Only</option>
              <option value="PRODUCT">Retail Products Only</option>
              <option value="PACKAGE">Packages Only</option>
              <option value="BOOKING_ADVANCE">Advance Deposits Only</option>
            </select>
          </div>

          {/* Payment Status */}
          <div>
            <label className={labelClass}>Pay Status</label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">All Statuses</option>
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partially Paid</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </div>

          {/* Lifecycle */}
          <div>
            <label className={labelClass}>Lifecycle</label>
            <select
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">Active & Refunded</option>
              <option value="ACTIVE">Active Only</option>
              <option value="PARTIALLY_REFUNDED">Partial Refund</option>
              <option value="REFUNDED">Refunded</option>
              <option value="VOIDED">Voided</option>
            </select>
          </div>

          {/* From Date */}
          <div>
            <label className={labelClass}>From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* To Date */}
          <div>
            <label className={labelClass}>To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Filter Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-9 bg-[#B82E69] hover:bg-[#A02358] active:bg-[#851C47] text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-70"
            >
              {isLoading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <Filter className="w-3.5 h-3.5 fill-current" />
                  <span>Apply Filters</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── 3. MAIN CONTENT AREA ── */}
      {!hasFiltered ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 md:p-24 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-2xs">
            <Filter className="w-8 h-8 stroke-[1.75]" />
          </div>
          <h3 className="text-base font-semibold text-[#18191B]">Ready to Generate Report</h3>
          <p className="text-xs text-[#78616C] font-medium mt-1 max-w-sm">
            Select branch, date range, or lifecycle above and click Apply Filters to load detailed income.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-12 h-12 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-4" />
          <p className="text-slate-800 text-sm font-semibold">Loading Detailed Income Drilldown...</p>
          <p className="text-xs text-slate-500 mt-0.5">Fetching transaction-level data</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-[24px] border border-rose-200 bg-white/90 p-8 backdrop-blur-2xl shadow-xs text-center">
          <p className="text-rose-600 text-sm font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-4 py-2 bg-[#B82E69] text-white text-xs font-semibold rounded-xl shadow-xs hover:bg-[#A02358] cursor-pointer"
          >
            Retry Fetch
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── FROSTED TABLE CONTAINER ── */}
          <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
            <div className="p-5 border-b border-white/80 flex flex-wrap items-center justify-between gap-3 bg-white/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                  <Receipt className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#18191B] tracking-tight">Transaction-Level Income Register</h3>
                    <span className="bg-[#FDF2F5] text-[#B82E69] border border-white/80 shadow-2xs text-[11px] font-bold px-2 py-0.5 rounded-full font-mono">
                      {filteredRows.length} items
                    </span>
                  </div>
                  <p className="text-[11px] text-[#78616C] mt-0.5">
                    Collected revenues across services, products, and packages
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 print:hidden">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="h-8 px-3 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-600" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="h-8 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-rose-600" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-600" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="report-records w-full min-w-[1380px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F9]/80 text-slate-700 font-semibold border-b border-slate-100 uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-3 text-center w-10 font-medium text-[#475569]">#</th>
                    <th className="py-3.5 px-3 whitespace-nowrap font-medium text-[#475569]">Date & Time</th>
                    <th className="py-3.5 px-3 whitespace-nowrap font-medium text-[#475569]">Invoice #</th>
                    <th className="py-3.5 px-3 text-center font-medium text-[#475569]">Source</th>
                    <th className="py-3.5 px-3 min-w-[180px] font-medium text-[#475569]">Item / Description</th>
                    <th className="py-3.5 px-3 min-w-[140px] font-medium text-[#475569]">Client</th>
                    <th className="py-3.5 px-3 whitespace-nowrap font-medium text-[#475569]">Staff / Stylist</th>
                    <th className="py-3.5 px-3 text-center w-14 font-medium text-[#475569]">Qty</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap font-medium text-[#475569]">Allocated Sales (Excl. Tax)</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap font-medium text-[#475569]">Discount</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap font-bold text-[#9D2558]">Collected Net</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap font-medium text-[#475569]">Tax</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap font-medium text-[#475569]">Total</th>
                    <th className="py-3.5 px-3 text-center w-24 font-medium text-[#475569]">Status</th>
                    <th className="py-3.5 px-3 text-center w-20 font-medium text-[#475569]">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200">
                  {filteredRows.length > 0 ? (
                    filteredRows.map((row: DetailedIncomeRow, idx: number) => {
                      const dateParts = formatDateParts(row.date);
                      const isExpanded = expandedRows.has(row.id);

                      return (
                        <React.Fragment key={row.id || idx}>
                          <tr className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                            {/* # */}
                            <td className="py-3.5 px-3 text-center font-normal text-slate-500 text-[13px]">
                              {idx + 1}
                            </td>

                            {/* Date */}
                            <td className="py-3.5 px-3 whitespace-nowrap text-slate-700">
                              <div className="leading-tight">
                                <div>{dateParts.dayMonth}</div>
                                <div className="text-[11px] text-slate-400">{row.time || dateParts.year}</div>
                              </div>
                            </td>

                            {/* Invoice # */}
                            <td className="py-3.5 px-3 font-semibold text-[#9D2558] whitespace-nowrap">
                              <div>{row.invoiceNumber}</div>
                              {row.bookingNumber && (
                                <div className="text-[10px] text-slate-500 font-normal">Booking: {row.bookingNumber}</div>
                              )}
                            </td>

                            {/* Source Type Badge */}
                            <td className="py-3.5 px-3 text-center whitespace-nowrap">
                              {row.incomeSource === 'SERVICE' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#FDF2F5] text-[#851C47] border border-[#F1DEE3]">
                                  <Scissors className="w-3 h-3" />
                                  <span>Service</span>
                                </span>
                              ) : row.incomeSource === 'PRODUCT' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                  <ShoppingBag className="w-3 h-3" />
                                  <span>Product</span>
                                </span>
                              ) : row.incomeSource === 'BOOKING_ADVANCE' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                                  <Calendar className="w-3 h-3 text-teal-600" />
                                  <span>Advance Deposit</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  <PackageCheck className="w-3 h-3" />
                                  <span>Package</span>
                                </span>
                              )}
                            </td>

                            {/* Item Name */}
                            <td className="py-3.5 px-3 font-semibold text-slate-900">
                              <div>{row.itemName}</div>
                              <div className="text-[10px] font-normal text-slate-500">Original net: PKR {formatPKR(row.originalNetAmount ?? row.netSales)}; original bill: PKR {formatPKR(row.originalBillAmount ?? row.total)}; period refund credit: PKR {formatPKR(row.refundAmount ?? 0)}; invoice outstanding: PKR {formatPKR(row.outstanding ?? 0)}</div>
                              {row.itemCode && row.itemCode !== '—' && (
                                <div className="text-[11px] text-slate-400 font-normal">{row.itemCode}</div>
                              )}
                            </td>

                            {/* Client */}
                            <td className="py-3.5 px-3 text-slate-800 whitespace-nowrap">
                              {row.clientName}
                            </td>

                            {/* Staff */}
                            <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap font-medium">
                              {row.staffName}
                            </td>

                            {/* Qty */}
                            <td className="py-3.5 px-3 text-center font-bold text-slate-800">
                              {row.quantity}
                            </td>

                            {/* Gross */}
                            <td className="py-3.5 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                              PKR {formatPKR(row.gross)}
                            </td>

                            {/* Discount */}
                            <td className="py-3.5 px-3 text-right tabular-nums text-slate-500 whitespace-nowrap">
                              {row.discount > 0 ? `-PKR ${formatPKR(row.discount)}` : '0.00'}
                            </td>

                            {/* Collected Net */}
                            <td className="py-3.5 px-3 text-right tabular-nums whitespace-nowrap">
                              <div className="font-bold text-[#9D2558]">PKR {formatPKR(row.recognizedNet)}</div>
                              {row.refundedNet > 0 && (
                                <div className="text-[10px] text-rose-600 font-medium">
                                  Reversal: -PKR {formatPKR(row.refundedNet)}
                                </div>
                              )}
                            </td>

                            {/* Tax */}
                            <td className="py-3.5 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                              +PKR {formatPKR(row.tax)}
                            </td>

                            {/* Total */}
                            <td className="py-3.5 px-3 text-right tabular-nums font-bold text-slate-800 whitespace-nowrap">
                              PKR {formatPKR(row.total)}
                            </td>

                            {/* Status */}
                            <td className="py-3.5 px-3 text-center whitespace-nowrap">
                              {row.lifecycle === 'REFUNDED' || row.lifecycle === 'PARTIALLY_REFUNDED' ? <span className="text-rose-700 font-semibold">{row.lifecycle === 'REFUNDED' ? 'Refunded' : 'Partially Refunded'}</span> : row.paymentStatus === 'PAID' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#10B981] text-white">
                                  Paid
                                </span>
                              ) : row.paymentStatus === 'PARTIAL' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F59E0B] text-white">
                                  Partial
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#64748B] text-white">
                                  {row.paymentStatus || 'Unpaid'}
                                </span>
                              )}
                            </td>

                            {/* Details Toggle */}
                            <td className="py-3.5 px-3 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => toggleRow(row.id)}
                                className="p-1.5 rounded-md hover:bg-[#FDF2F5] text-slate-500 hover:text-[#9D2558] transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-medium"
                              >
                                <span>{isExpanded ? 'Hide' : 'View'}</span>
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Drawer Row */}
                          {isExpanded && (
                            <tr className="bg-[#FDF2F5]/40 border-b border-[#F1DEE3]/50">
                              <td colSpan={15} className="p-4 pl-12 text-xs">
                                <div className="space-y-3">
                                  {/* Package Components (if package) */}
                                  {row.incomeSource === 'PACKAGE' && row.components && row.components.length > 0 && (
                                    <div className="bg-white p-3 rounded-lg border border-slate-200">
                                      <span className="font-bold text-[#23151D] block mb-2">Package Service Components Breakdown:</span>
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {row.components.map((comp) => (
                                          <div key={comp.id} className="p-2 rounded bg-slate-50 border border-slate-200 text-xs">
                                            <div className="font-semibold text-slate-800">{comp.serviceName}</div>
                                            <div className="text-slate-500">Stylist: {comp.staffName}</div>
                                            <div className="text-[#9D2558] font-bold mt-1">
                                              Allocated: PKR {formatPKR(comp.allocatedAmount)} ({comp.allocationPercentage}%)
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Cash / Bank Payments History for this invoice */}
                                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-bold text-[#23151D]">Invoice Payment Audit (Cash / Bank Accounts):</span>
                                      <span className="text-[11px] text-slate-500 italic">
                                        * Collections are shown on payment dates, net of tax and tips. Dated payments and refunds are grouped under their original invoice/service line. Only selected-period events affect these totals.
                                      </span>
                                    </div>
                                    {row.payments && row.payments.length > 0 ? (
                                      <div className="flex flex-wrap gap-2">
                                        {row.payments.map((p) => (
                                          <div key={p.id} className="px-3 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                                            <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                                            <span>{p.date}</span>
                                            {p.receiptNumber && <span className="font-mono font-bold">{p.receiptNumber}</span>}
                                            <span className="font-semibold">{p.paymentAccountName} ({p.method})</span>
                                            <span className="font-bold text-emerald-700">PKR {formatPKR(p.amount)}</span>
                                            {p.processedByName && <span className="text-[10px] text-slate-500">by {p.processedByName}</span>}
                                            {p.kind && (
                                              <span className="text-[10px] bg-emerald-200/60 px-1 rounded uppercase font-semibold">
                                                {p.kind === 'BOOKING_PAYMENT' ? 'Booking Advance' : p.kind}
                                              </span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400">No payment records yet (Bill is Unpaid).</span>
                                    )}
                                  </div>

                                  {/* Refunds & Reversals linked to this invoice */}
                                  {row.refunds && row.refunds.length > 0 && (
                                    <div className="bg-white p-3 rounded-lg border border-rose-200">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="font-bold text-rose-800">Linked Refund & Reversal Entries ({row.invoiceNumber}):</span>
                                        <span className="text-[11px] text-slate-500 italic">
                                          * Only actual refunded collections reduce collected revenue. Credits against unpaid dues reduce outstanding balances.
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {row.refunds.map((r) => (
                                          <div key={r.id} className="px-3 py-1.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                                            <RotateCw className="w-3.5 h-3.5 text-rose-600" />
                                            <span className="font-semibold">{r.refundNumber}</span>
                                            <span>{r.refundDate}</span>
                                            <span>Reversal: <strong className="text-rose-700">PKR {formatPKR(r.netReversed)}</strong></span>
                                            {r.cashOut > 0 && <span>(Cash Out: PKR {formatPKR(r.cashOut)})</span>}
                                            {r.lineRefund && <span>[Line Net: -PKR {formatPKR(r.lineRefund.net)}]</span>}
                                            {r.reason && <span className="text-[11px] text-slate-500 italic">({r.reason})</span>}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="text-[11px] text-slate-400">
                                    Created & Posted by: <strong className="text-slate-700">{row.createdByName}</strong> • Branch: <strong className="text-slate-700">{row.branchName}</strong>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={15} className="py-16 text-center text-slate-400 font-medium">
                        No detailed income transactions found for the selected branch and date filters.
                      </td>
                    </tr>
                  )}
                </tbody>

                {/* Table Footer */}
                <tfoot className="bg-[#F8FAFC] border-t-2 border-slate-200 font-['Inter',sans-serif] text-[13px]">
                  <tr className="border-b border-slate-200/70">
                    <td colSpan={8} className="py-3.5 px-3 text-right font-bold text-slate-800 tracking-wide">
                      TOTALS ({filteredRows.length} Line Items):
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums text-slate-700 font-bold">
                      PKR {formatPKR(totals.gross)}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums text-slate-500 font-medium">
                      {totals.discount > 0 ? `-PKR ${formatPKR(totals.discount)}` : '0.00'}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums font-bold text-[#9D2558] text-sm">
                      PKR {formatPKR(totals.recognizedNet)}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums text-slate-700 font-semibold">
                      +PKR {formatPKR(totals.netTax)}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums font-bold text-slate-900">
                      PKR {formatPKR(totals.recognizedNet + totals.netTax)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>

                  <tr>
                    <td colSpan={8} className="py-3 px-3 text-right font-medium text-slate-700">
                      Collected Net Revenue Summary (Excl. Tax)
                    </td>
                    <td colSpan={7} className="py-3 px-3 text-right text-xs">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold mr-4">
                        Services: PKR {formatPKR(reportData?.kpis.serviceRevenue || 0)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-purple-700 font-semibold mr-4">
                        Products: PKR {formatPKR(reportData?.kpis.productRevenue || 0)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-amber-700 font-semibold mr-4">
                        Packages: PKR {formatPKR(reportData?.kpis.packageRevenue || 0)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[#9D2558] font-bold">
                        Collected Revenue Total: PKR {formatPKR(totals.recognizedNet)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Footer Branding */}
      <div className="text-center py-4 text-xs text-slate-400 font-medium tracking-wide">
        © iSysware Management System
      </div>
    </div>
  );
};
