import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { User } from '@/types/auth';
import {
  Invoice,
  SalesInvoicesReport,
  SalesInvoiceReportRow,
  SalesInvoicesReportQuery,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { ReceiptModal } from '@/features/pos/ReceiptModal';
import { printThermalReceipt } from '@/features/pos/receiptPdf';
import {
  downloadReportCsv,
  downloadReportExcel,
  printReportWindow,
} from '@/features/reports/reportUtils';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  Loader2,
  Eye,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RefundVoidModal } from './components/RefundVoidModal';

const selectClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const inputClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const labelClass = 'block text-[11px] font-semibold text-[#23151D] mb-1.5';

const formatPKR = (amt: number, withSign = false) => {
  const num = Number(amt) || 0;
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (withSign) {
    return num >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return num < 0 ? `-${formatted}` : formatted;
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

export const SalesInvoicesPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/sales-invoices" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isAccountant = user.role === 'ACCOUNTANT';

  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = useMemo(() => {
    const parts = businessDate.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
    return { from: firstDay, to: businessDate };
  }, [businessDate]);

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [selectedCashier, setSelectedCashier] = useState<string>('ALL');
  const [cashiersList, setCashiersList] = useState<User[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<string>('ALL');
  const [lifecycle, setLifecycle] = useState<string>('ALL');
  const [paymentMethod, setPaymentMethod] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>(defaultMonth.from);
  const [toDate, setToDate] = useState<string>(defaultMonth.to);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<SalesInvoicesReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Receipt Modal State
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState<boolean>(false);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState<boolean>(false);

  // Refund / Void Modal State
  const [refundTargetInvoice, setRefundTargetInvoice] = useState<Invoice | null>(null);
  const [isRefundModalOpen, setIsRefundModalOpen] = useState<boolean>(false);
  const [isLoadingRefundTarget, setIsLoadingRefundTarget] = useState<boolean>(false);

  // Load cashiers / accountants list for filter dropdown (for Admin / Super Admin)
  useEffect(() => {
    let active = true;
    if (!isAccountant) {
      const branchForUsers = selectedBranch !== 'ALL' ? selectedBranch : undefined;
      salonService
        .getUsers(user, branchForUsers)
        .then((data) => {
          if (active && Array.isArray(data)) {
            setCashiersList(data.filter((u) => u.role === 'ACCOUNTANT' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN'));
          }
        })
        .catch((err) => {
          console.error('Failed to load cashiers for filter:', err);
        });
    }
    return () => {
      active = false;
    };
  }, [user, selectedBranch, isAccountant]);

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(
    async (q: SalesInvoicesReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getSalesInvoicesReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Sales & Invoices report:', err);
        setErrorMessage(err.message || 'Failed to fetch live sales & invoices report from server.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: SalesInvoicesReportQuery = {
      branchId: selectedBranch,
      startDate: fromDate || undefined,
      endDate: toDate || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      preset: !fromDate && !toDate ? 'THIS_MONTH' : 'CUSTOM',
      paymentStatus: (paymentStatus as any) || 'ALL',
      lifecycle: (lifecycle as any) || 'ALL',
      paymentMethod: paymentMethod === 'ALL' ? undefined : paymentMethod,
      soldByUserId: isAccountant ? user.id : (selectedCashier !== 'ALL' ? selectedCashier : undefined),
      search: searchQuery.trim() || undefined,
    };

    fetchReport(query);
  };

  // Auto-fetch default monthly date range on mount or when branch changes
  useEffect(() => {
    fetchReport({
      branchId: selectedBranch,
      startDate: fromDate || defaultMonth.from,
      endDate: toDate || defaultMonth.to,
      from: fromDate || defaultMonth.from,
      to: toDate || defaultMonth.to,
      preset: 'THIS_MONTH',
      paymentStatus: (paymentStatus as any) || 'ALL',
      lifecycle: (lifecycle as any) || 'ALL',
      paymentMethod: paymentMethod === 'ALL' ? undefined : paymentMethod,
      soldByUserId: isAccountant ? user.id : (selectedCashier !== 'ALL' ? selectedCashier : undefined),
      search: searchQuery.trim() || undefined,
    });
  }, [fetchReport, selectedBranch]);

  const [printingInvoiceId, setPrintingInvoiceId] = useState<string | null>(null);

  const handleQuickPrint = async (invoiceId: string) => {
    setPrintingInvoiceId(invoiceId);
    try {
      const fullInvoice = await salonService.getInvoice(invoiceId);
      if (fullInvoice) {
        const branch = allBranches.find((b) => b.id === fullInvoice.branchId) || null;
        printThermalReceipt(fullInvoice, branch);
      }
    } catch (err) {
      console.error('Failed to load invoice receipt details for print:', err);
    } finally {
      setPrintingInvoiceId(null);
    }
  };

  // Open Receipt Modal
  const handleOpenReceipt = async (invoiceId: string) => {
    setIsLoadingReceipt(true);
    try {
      const fullInvoice = await salonService.getInvoice(invoiceId);
      if (fullInvoice) {
        setReceiptInvoice(fullInvoice);
        setIsReceiptOpen(true);
      }
    } catch (err) {
      console.error('Failed to load invoice receipt details:', err);
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  // Open Refund / Void Modal
  const handleOpenRefund = async (invoiceId: string) => {
    setIsLoadingRefundTarget(true);
    try {
      const fullInvoice = await salonService.getInvoice(invoiceId);
      if (fullInvoice) {
        setRefundTargetInvoice(fullInvoice);
        setIsRefundModalOpen(true);
      }
    } catch (err) {
      console.error('Failed to load invoice details for refund:', err);
    } finally {
      setIsLoadingRefundTarget(false);
    }
  };

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Basis', 'Original invoice values; dated collections/refunds/reversals; outstanding as of period end. Sales totals include only invoices/credits dated in period.'],
      ['Collected Revenue (excl. tax/tips)', formatPKR(reportData.kpis.collectedRevenue ?? 0)],
      ['Tax Collected', formatPKR(reportData.kpis.taxCollected ?? 0)],
      ['Report', 'Sales & Invoices Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Date',
      'Client',
      'Branch',
      'Sold By',
      'Status',
      'Lifecycle',
      'Gross (PKR)',
      'Discount (PKR)',
      'Net Sales (PKR)',
      'Tax (PKR)',
      'Tip (PKR)',
      'Total (PKR)',
      'Period Collections (PKR)',
      'Remaining (PKR)',
    ];

    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.invoiceNumber,
      formatDateDisplay(r.date),
      r.clientName || 'Walk-in',
      r.branchName,
      r.soldByName || 'Staff',
      r.paymentStatus,
      r.lifecycle,
      r.gross.toFixed(2),
      r.discount.toFixed(2),
      r.netSales.toFixed(2),
      (r.taxCharged ?? r.tax ?? 0).toFixed(2),
      (r.tip || 0).toFixed(2),
      r.total.toFixed(2),
      r.paid.toFixed(2),
      r.outstanding.toFixed(2),
    ]);

    downloadReportExcel('Sales_Invoices_Report', meta, [{ headers, rows }]);
  };

  const handleExportPdf = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Basis', 'Original invoice values; dated collections/refunds/reversals; outstanding as of period end. Sales totals include only invoices/credits dated in period.'],
      ['Collected Revenue (excl. tax/tips)', formatPKR(reportData.kpis.collectedRevenue ?? 0)],
      ['Tax Collected', formatPKR(reportData.kpis.taxCollected ?? 0)],
      ['Report', 'Sales & Invoices Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Date',
      'Client',
      'Branch',
      'Sold By',
      'Status',
      'Lifecycle',
      'Gross (PKR)',
      'Discount (PKR)',
      'Net Sales (PKR)',
      'Tax (PKR)',
      'Tip (PKR)',
      'Total (PKR)',
      'Period Collections (PKR)',
      'Remaining (PKR)',
    ];

    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.invoiceNumber,
      formatDateDisplay(r.date),
      r.clientName || 'Walk-in',
      r.branchName,
      r.soldByName || 'Staff',
      r.paymentStatus,
      r.lifecycle,
      r.gross.toFixed(2),
      r.discount.toFixed(2),
      r.netSales.toFixed(2),
      (r.taxCharged ?? r.tax ?? 0).toFixed(2),
      (r.tip || 0).toFixed(2),
      r.total.toFixed(2),
      r.paid.toFixed(2),
      r.outstanding.toFixed(2),
    ]);

    downloadReportCsv('Sales_Invoices_Report', meta, [{ headers, rows }]);
  };

  const handlePrint = () => {
    if (!reportData || !reportData.rows.length) {
      window.print();
      return;
    }
    const meta: [string, string][] = [
      ['Basis', 'Original invoice values; dated collections/refunds/reversals; outstanding as of period end. Sales totals include only invoices/credits dated in period.'],
      ['Collected Revenue (excl. tax/tips)', formatPKR(reportData.kpis.collectedRevenue ?? 0)],
      ['Tax Collected', formatPKR(reportData.kpis.taxCollected ?? 0)],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Total Gross', formatPKR(reportData.totals.gross || 0)],
      ['Total Net Sales', formatPKR(reportData.totals.netSales || 0)],
      ['Total Tax', formatPKR(reportData.totals.taxCharged ?? reportData.totals.tax ?? 0)],
      ['Total Tips', formatPKR(reportData.totals.tip || 0)],
      ['Total Paid', formatPKR(reportData.totals.paid || 0)],
    ];
    const headers = ['#', 'Invoice #', 'Date', 'Client', 'Branch', 'Sold By', 'Status', 'Net Sales', 'Tax', 'Tip', 'Total', 'Period Collections', 'Remaining'];
    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.invoiceNumber,
      formatDateDisplay(r.date),
      r.clientName || 'Walk-in',
      r.branchName,
      r.soldByName || 'Staff',
      r.paymentStatus,
      formatPKR(r.netSales),
      formatPKR(r.taxCharged ?? r.tax ?? 0),
      formatPKR(r.tip || 0),
      formatPKR(r.total),
      formatPKR(r.paid),
      formatPKR(r.outstanding),
    ]);

    printReportWindow({
      title: 'Sales & Invoices Report',
      meta,
      headers,
      rows,
    });
  };

  const totals = reportData?.totals || {
    gross: 0,
    discount: 0,
    netSales: 0,
    tax: 0,
    taxCharged: 0,
    netTax: 0,
    tip: 0,
    total: 0,
    paid: 0,
    outstanding: 0,
  };

  return (
    <div className="w-full text-slate-800">
      {/* Top Header Card with Title & Filters */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200/90 p-5 md:p-6 mb-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-[#23151D] tracking-tight">Sales & Invoices Reports</h1>
          <p className="text-xs text-slate-500 mt-1">
            Complete billing register: posted POS invoices, discounts, taxes, tender collections and lifecycle statuses
          </p>
        </div>

        {/* Role Scope Notice */}
        {isAccountant && (
          <div className="mb-4 p-3 rounded-lg bg-[#FDF2F5] border border-[#F1DEE3] flex items-center justify-between text-xs text-[#23151D]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#9D2558] animate-pulse" />
              <span className="font-semibold">Accountant Salesman Mode:</span>
              <span>Displaying invoices, sales and collections posted by your account (<strong>{user.name}</strong>).</span>
            </div>
            <span className="text-[11px] font-medium bg-white px-2 py-0.5 rounded border border-[#F1DEE3] text-[#851C47] shadow-2xs">
              Accountant Scoped
            </span>
          </div>
        )}

        {/* Filters Form Row */}
        <form onSubmit={handleApplyFilters} className={`grid grid-cols-1 sm:grid-cols-2 ${!isAccountant ? 'md:grid-cols-4 lg:grid-cols-8' : 'md:grid-cols-7'} gap-3.5 items-end`}>
          {/* Branch Filter */}
          <div>
            <label className={labelClass}>Branch</label>
            <Select
              value={selectedBranch}
              disabled={!isSuperAdmin}
              onValueChange={(val) => setSelectedBranch(val)}
            >
              <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                {isSuperAdmin && <SelectItem value="ALL">All Branches</SelectItem>}
                {allBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cashier / Sold By Filter (Admin / Super Admin view) */}
          {!isAccountant && (
            <div>
              <label className={labelClass}>Cashier / Sold By</label>
              <Select
                value={selectedCashier}
                onValueChange={(val) => setSelectedCashier(val)}
              >
                <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                  <SelectValue placeholder="Cashier" />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  <SelectItem value="ALL">All Cashiers / Admins</SelectItem>
                  {cashiersList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.role === 'ACCOUNTANT' ? 'Accountant' : c.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Pay Status Filter */}
          <div>
            <label className={labelClass}>Pay Status</label>
            <Select
              value={paymentStatus}
              onValueChange={(val) => setPaymentStatus(val)}
            >
              <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                <SelectValue placeholder="Pay Status" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="PARTIAL">Partially Paid</SelectItem>
                <SelectItem value="UNPAID">Unpaid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Lifecycle Filter */}
          <div>
            <label className={labelClass}>Lifecycle</label>
            <Select
              value={lifecycle}
              onValueChange={(val) => setLifecycle(val)}
            >
              <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                <SelectValue placeholder="Lifecycle" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Lifecycles</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="PARTIALLY_REFUNDED">Partial Refund</SelectItem>
                <SelectItem value="REFUNDED">Refunded</SelectItem>
                <SelectItem value="VOIDED">Voided</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Payment Type */}
          <div>
            <label className={labelClass}>Payment Type</label>
            <Select
              value={paymentMethod}
              onValueChange={(val) => setPaymentMethod(val)}
            >
              <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                <SelectValue placeholder="Payment Type" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="ONLINE_ACCOUNT">Online / Card</SelectItem>
                <SelectItem value="SPLIT">Split Payment</SelectItem>
              </SelectContent>
            </Select>
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

          {/* Filter Action Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-[35px] bg-[#9D2558] hover:bg-[#851C47] active:bg-[#002b66] text-white font-medium text-xs rounded-md shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-70"
            >
              {isLoading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <Filter className="w-3.5 h-3.5 fill-current" />
                  <span>Filter</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Main Content Area */}
      {!hasFiltered ? (
        /* Empty State before Filter clicked */
        <div className="bg-white rounded-xl border border-slate-200/90 p-16 md:p-24 flex flex-col items-center justify-center min-h-[380px] shadow-xs text-center">
          <div className="text-slate-400 mb-3">
            <Filter className="w-14 h-14 stroke-[1.25] text-slate-400" />
          </div>
          <p className="text-slate-400 text-sm font-medium">Please apply filters to view reports</p>
        </div>
      ) : isLoading ? (
        /* Loading Skeleton */
        <div className="bg-white rounded-xl border border-slate-200/90 p-16 flex flex-col items-center justify-center min-h-[380px] shadow-xs text-center font-sans">
          <div className="w-10 h-10 rounded-full border-3 border-[#F1DEE3] border-t-[#9D2558] animate-spin mb-3" />
          <p className="text-slate-600 text-sm font-medium">Loading Sales & Invoices Reports...</p>
        </div>
      ) : errorMessage ? (
        /* Error Message */
        <div className="bg-white rounded-xl border border-rose-200 p-8 shadow-xs text-center">
          <p className="text-rose-600 text-sm font-medium mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-4 py-1.5 bg-[#9D2558] text-white text-xs font-semibold rounded-md shadow-xs hover:bg-[#851C47]"
          >
            Retry
          </button>
        </div>
      ) : (
        /* Filtered Data Layout */
        <div className="shadow-sm rounded-xl overflow-hidden border border-slate-200/90 mb-8 bg-white">
          {/* Royal Blue Banner Header */}
          <div className="bg-[#9D2558] text-white px-5 py-3 flex flex-wrap items-center justify-between gap-3 rounded-t-xl">
            <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
              <Receipt className="w-4 h-4 stroke-[2.5]" />
              <span>Sales & Invoices Register</span>
              <span className="text-xs font-normal">Collected revenue: PKR {formatPKR(reportData?.kpis.collectedRevenue ?? 0)} (excl. tax/tips). Original invoice columns; period collections; dues as of end date.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportPdf}
                className="bg-[#009688] hover:bg-[#00897B] active:bg-[#00796B] text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B] text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="bg-[#4B5563] hover:bg-[#374151] active:bg-[#1F2937] text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Table Container with smooth horizontal scroll and generous column space */}
          <div className="bg-white overflow-x-auto rounded-b-xl border-t border-[#F1DEE3]/40">
            <table className="report-records w-full min-w-[1380px] text-left border-collapse font-['Inter',sans-serif] text-[13px] antialiased">
              <thead>
                <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                  <th className="py-3.5 px-4 text-center w-12 font-medium text-[#475569]">#</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] whitespace-nowrap">Invoice #</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] whitespace-nowrap">Date</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Client</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Branch</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Cashier / Sold By</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-center w-24">Status</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-center w-24">Lifecycle</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Gross</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Discount</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Net Sales</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Tax</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Tip</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Total</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Period Collections</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Remaining</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-center w-16">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dashed divide-slate-200">
                {reportData && reportData.rows.length > 0 ? (
                  reportData.rows.map((row: SalesInvoiceReportRow, idx: number) => {
                    const dateParts = formatDateParts(row.date);

                    return (
                      <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        {/* 1. # */}
                        <td className="py-3.5 px-4 text-center font-normal text-slate-500 text-[13px]">
                          {idx + 1}
                        </td>

                        {/* 2. Invoice # */}
                        <td className="py-3.5 px-4 font-semibold whitespace-nowrap text-[13px]">
                          <span className={row.lifecycle === 'VOIDED' ? 'line-through text-slate-400' : 'text-[#9D2558]'}>
                            {row.invoiceNumber}
                          </span>
                        </td>

                        {/* 3. Date */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] text-[13px]">
                          <div className="leading-tight">
                            <div>{dateParts.dayMonth}</div>
                            {dateParts.year && <div className="text-[12px] text-slate-400">{dateParts.year}</div>}
                          </div>
                        </td>

                        {/* 4. Client */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#334155] font-normal text-[13px]">
                          {row.clientName || 'Walk-in'}
                        </td>

                        {/* 5. Branch */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] font-normal text-[13px]">
                          {row.branchName || 'Main Branch'}
                        </td>

                        {/* 6. Sold By */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] font-normal text-[13px]">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            <span>{row.soldByName || 'Cashier'}</span>
                            {row.soldByUserId === user.id && (
                              <span className="text-[10px] font-bold text-[#851C47] bg-[#FCE8EC] px-1 rounded">
                                You
                              </span>
                            )}
                          </span>
                        </td>

                        {/* 7. Status */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {row.paymentStatus === 'PAID' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#10B981] text-white">
                              Paid
                            </span>
                          ) : row.paymentStatus === 'PARTIAL' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F59E0B] text-white">
                              Partial
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#64748B] text-white">
                              {row.paymentStatus || 'Unpaid'}
                            </span>
                          )}
                        </td>

                        {/* 8. Lifecycle */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {row.lifecycle === 'VOIDED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                              VOIDED
                            </span>
                          ) : row.lifecycle === 'REFUNDED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                              REFUNDED
                            </span>
                          ) : row.lifecycle === 'PARTIALLY_REFUNDED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                              PARTIAL REFUND
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ACTIVE
                            </span>
                          )}
                        </td>

                        {/* 9. Gross */}
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#475569] text-[13px] whitespace-nowrap">
                          {formatPKR(row.gross)}
                        </td>

                        {/* 10. Discount */}
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#475569] text-[13px] whitespace-nowrap">
                          +{formatPKR(row.discount)}
                        </td>

                        {/* 11. Net Sales */}
                        <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-[#9D2558] text-[13px] whitespace-nowrap">
                          {formatPKR(row.netSales)}
                        </td>

                        {/* 12. Tax */}
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#475569] text-[13px] whitespace-nowrap">
                          +{formatPKR(row.taxCharged ?? row.tax ?? 0)}
                        </td>

                        {/* 13. Tip */}
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#475569] text-[13px] whitespace-nowrap">
                          +{formatPKR(row.tip || 0)}
                        </td>

                        {/* 14. Total */}
                        <td className="py-3.5 px-4 text-right tabular-nums font-bold text-slate-800 text-[13px] whitespace-nowrap">
                          {formatPKR(row.total)}
                        </td>

                        {/* 15. Paid */}
                        <td className="py-3.5 px-4 text-right tabular-nums text-[13px] whitespace-nowrap">
                          <div className="font-semibold text-[#10B981]">{formatPKR(row.paid)}</div>
                          {(row.refunded > 0 || (row.refundedAmount ?? 0) > 0) && (
                            <div className="text-[11px] text-rose-500 font-medium">
                              Refund: -{formatPKR(row.refundedAmount ?? row.refunded)}
                            </div>
                          )}
                        </td>

                        {/* 16. Remaining */}
                        <td
                          className={`py-3.5 px-4 text-right tabular-nums text-[13px] whitespace-nowrap ${
                            row.outstanding > 0 ? 'text-[#EF4444] font-semibold' : 'text-[#475569]'
                          }`}
                        >
                          {formatPKR(row.outstanding)}
                        </td>

                        {/* 17. Action */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenReceipt(row.id)}
                              disabled={isLoadingReceipt}
                              className="p-1 rounded text-slate-500 hover:text-[#9D2558] hover:bg-[#FDF2F5] transition-colors cursor-pointer"
                              title="View receipt"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickPrint(row.id)}
                              disabled={printingInvoiceId === row.id}
                              className="p-1 rounded text-slate-500 hover:text-[#0047AB] hover:bg-blue-50 transition-colors cursor-pointer"
                              title="Print thermal receipt (80mm)"
                            >
                              {printingInvoiceId === row.id ? (
                                <Loader2 className="w-4 h-4 animate-spin text-[#0047AB]" />
                              ) : (
                                <Printer className="w-4 h-4" />
                              )}
                            </button>
                            {['SUPER_ADMIN', 'ADMIN'].includes(user.role) && row.lifecycle !== 'VOIDED' && row.lifecycle !== 'REFUNDED' && (
                              <button
                                type="button"
                                onClick={() => handleOpenRefund(row.id)}
                                disabled={isLoadingRefundTarget}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Void or Refund invoice"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={19} className="py-16 text-center text-slate-400 font-medium">
                      No sales invoices found for the selected branch, dates, and filters.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Integrated Table Footer */}
              <tfoot className="bg-[#F8FAFC] border-t-2 border-slate-200 font-['Inter',sans-serif] text-[13px]">
                {/* Row 1: TOTALS (PKR) */}
                <tr className="border-b border-slate-200/70">
                  <td colSpan={8} className="py-3.5 px-4 text-right font-bold text-slate-800 tracking-wide">
                    TOTALS (PKR)
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-[#475569]">
                    {formatPKR(totals.gross)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-[#475569]">
                    +{formatPKR(totals.discount)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums font-bold text-[#9D2558]">
                    {formatPKR(totals.netSales)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-[#475569]">
                    +{formatPKR(totals.taxCharged ?? totals.tax ?? 0)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-[#475569]">
                    {formatPKR(totals.tip || 0, true)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums font-bold text-slate-800">
                    {formatPKR(totals.total)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums font-bold text-[#10B981]">
                    {formatPKR(totals.paid)}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums font-bold text-[#EF4444]">
                    {formatPKR(totals.outstanding)}
                  </td>
                  <td className="py-3.5 px-4"></td>
                </tr>

                {/* Row 2: Net Collection Amount */}
                <tr>
                  <td colSpan={8} className="py-3 px-4 text-right font-medium text-slate-700">
                    Net Paid Collections
                  </td>
                  <td colSpan={8} className="py-3 px-4 text-right tabular-nums font-bold text-[#10B981] text-sm">
                    {formatPKR(totals.paid, true)}
                  </td>
                  <td className="py-3.5 px-4"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Footer Branding */}
      <div className="text-center py-4 text-xs text-slate-400 font-medium tracking-wide">
        © iSysware Management System
      </div>

      {/* PRINTABLE RECEIPT MODAL */}
      {isReceiptOpen && receiptInvoice && (
        <ReceiptModal
          isOpen={isReceiptOpen}
          onClose={() => setIsReceiptOpen(false)}
          invoice={receiptInvoice}
          branch={allBranches.find((b) => b.id === receiptInvoice?.branchId) || null}
          onRefund={(inv) => handleOpenRefund(inv.id)}
        />
      )}

      {/* REFUND / VOID MODAL */}
      <RefundVoidModal
        isOpen={isRefundModalOpen}
        onClose={() => setIsRefundModalOpen(false)}
        invoice={refundTargetInvoice}
        onSuccess={() => {
          handleApplyFilters();
        }}
      />
    </div>
  );
};

export default SalesInvoicesPage;
