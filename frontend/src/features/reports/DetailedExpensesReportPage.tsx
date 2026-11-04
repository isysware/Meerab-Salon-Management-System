import React, { useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  DetailedExpensesReport,
  DetailedExpenseRow,
  DetailedExpensesReportQuery,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
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
  Receipt,
  CreditCard,
  RotateCcw,
  Banknote,
  Search,
} from 'lucide-react';

const selectClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium cursor-pointer transition-all';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

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
    const year = d.getFullYear();
    return { dayMonth: `${day} ${month}`, year: `${year}` };
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

export const DetailedExpensesReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/detailed-expenses" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedPaymentSource, setSelectedPaymentSource] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Page state: Only fetch when user explicitly clicks Filter ("filter karna sa aae default nhi")
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<DetailedExpensesReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(
    async (q: DetailedExpensesReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getDetailedExpensesReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Detailed Expenses report:', err);
        setErrorMessage(err.message || 'Failed to fetch live expenses report from server.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: DetailedExpensesReportQuery = {
      branchId: selectedBranch,
      startDate: fromDate || undefined,
      endDate: toDate || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      preset: !fromDate && !toDate ? 'THIS_MONTH' : 'CUSTOM',
      category: selectedCategory !== 'ALL' ? selectedCategory : undefined,
      status: (selectedStatus as any) || 'ALL',
      paymentSource: (selectedPaymentSource as any) || 'ALL',
      search: searchQuery.trim() || undefined,
    };

    fetchReport(query);
  };

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Detailed Expenses Report'],
      ['Basis', 'Actual paid expenses; unpaid liabilities shown separately'],
      ...(reportData.liabilities ? [['Unpaid Salaries (branch, period end)', formatPKR(reportData.liabilities.unpaidSalaries)], ['Unpaid Commissions (branch, period end)', formatPKR(reportData.liabilities.unpaidCommissions)]] as [string, string][] : []),
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Voucher #',
      'Date',
      'Branch',
      'Category',
      'Title',
      'Payee',
      'Payment Source',
      'Status',
      'Created By',
      'Amount (PKR)',
    ];

    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.voucherNumber,
      formatDateDisplay(r.date),
      r.branchName,
      r.category,
      r.title,
      r.payee,
      r.paymentSource,
      r.status,
      r.createdByName || 'Staff',
      r.amount.toFixed(2),
    ]);

    downloadReportExcel('Detailed_Expenses_Report', meta, [{ headers, rows }]);
  };

  const handleExportPdf = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Detailed Expenses Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Voucher #',
      'Date',
      'Branch',
      'Category',
      'Title',
      'Payee',
      'Payment Source',
      'Status',
      'Created By',
      'Amount (PKR)',
    ];

    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.voucherNumber,
      formatDateDisplay(r.date),
      r.branchName,
      r.category,
      r.title,
      r.payee,
      r.paymentSource,
      r.status,
      r.createdByName || 'Staff',
      r.amount.toFixed(2),
    ]);

    downloadReportCsv('Detailed_Expenses_Report', meta, [{ headers, rows }]);
  };

  const handlePrint = () => {
    if (!reportData || !reportData.rows.length) {
      window.print();
      return;
    }
    const meta: [string, string][] = [
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Total Expenses', formatPKR(reportData.totals.amount)],
      ...(reportData.liabilities ? [['Unpaid Salaries (branch, period end)', formatPKR(reportData.liabilities.unpaidSalaries)], ['Unpaid Commissions (branch, period end)', formatPKR(reportData.liabilities.unpaidCommissions)]] as [string, string][] : []),
    ];
    const headers = ['#', 'Voucher #', 'Date', 'Branch', 'Category', 'Title', 'Payee', 'Source', 'Status', 'Amount'];
    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.voucherNumber,
      formatDateDisplay(r.date),
      r.branchName,
      r.category,
      r.title,
      r.payee,
      r.paymentSource,
      r.status,
      formatPKR(r.amount),
    ]);

    printReportWindow({
      title: 'Detailed Expenses Report',
      meta,
      headers,
      rows,
    });
  };

  const kpis = reportData?.kpis || {
    totalPostedAmount: 0,
    totalReversedAmount: 0,
    netExpenseAmount: 0,
    totalVouchersCount: 0,
    activeVouchersCount: 0,
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {reportData?.liabilities ? (
        <div className="rounded-xl border border-slate-200 bg-white/75 p-3 text-xs text-slate-600">
          Unpaid at period end: salaries PKR {formatPKR(reportData.liabilities.unpaidSalaries)}; commissions PKR {formatPKR(reportData.liabilities.unpaidCommissions)}.
          These branch liabilities are separate from paid expenses and do not change with table filters.
        </div>
      ) : null}
      {/* ── 1. TOP HEADER BANNER (FROSTED GLASS CONTAINER) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Receipt className="w-5 h-5 text-[#B82E69]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Detailed Expenses Drilldown
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Itemized operational expenditure audit: voucher-level disbursements, payee accounting, and tender breakdowns
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. FILTER CONTROLS (FROSTED GLASS CARD) ── */}
      <div className="p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] space-y-3">
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 items-end">
          {/* Branch Filter */}
          <div className="min-w-0">
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

          {/* Payment Source Filter */}
          <div className="min-w-0">
            <label className={labelClass}>Payment Source</label>
            <select
              value={selectedPaymentSource}
              onChange={(e) => setSelectedPaymentSource(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">All Sources</option>
              <option value="CASH_DRAWER">Cash Drawer</option>
              <option value="ONLINE_ACCOUNT">Online / Bank Account</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="min-w-0">
            <label className={labelClass}>Voucher Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">All Statuses</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>

          {/* From Date */}
          <div className="min-w-0">
            <label className={labelClass}>From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* To Date */}
          <div className="min-w-0">
            <label className={labelClass}>To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Filter Action Button */}
          <div className="min-w-0">
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

      {/* ── 3. KPI SUMMARY METRICS: PURE WHITE FROSTED GLASS CARDS (when filtered) ── */}
      {hasFiltered && reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Net Operating Expenses */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Receipt className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Net Expense
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR((kpis as any).totalExpenses ?? (kpis as any).netExpenseAmount ?? reportData?.totals?.amount ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Net recognized disbursements
              </span>
            </div>
          </div>

          {/* Total Posted */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <CreditCard className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Posted
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR((kpis as any).totalPostedAmount ?? (kpis as any).totalExpenses ?? reportData?.totals?.amount ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Actual paid expenses, salaries and commissions
              </span>
            </div>
          </div>

          {/* Reversed / Voided */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                <RotateCcw className="w-4 h-4" />
              </div>
              <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Reversed
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR((kpis as any).totalReversedAmount ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Dated expense reversals
              </span>
            </div>
          </div>

          {/* Voucher Count */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <FileText className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Vouchers
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                {reportData.rows.length}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Records returned in audit
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. MAIN CONTENT AREA (EMPTY / LOADING / ERROR / TABLE) ── */}
      {!hasFiltered ? (
        /* Empty State before Filter clicked */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-16 md:p-24 flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] mb-4">
            <Filter className="w-7 h-7 stroke-[1.5]" />
          </div>
          <h3 className="text-base font-bold text-[#18191B] mb-1">Apply Filters to Generate Report</h3>
          <p className="text-xs text-[#78616C] font-medium max-w-sm">
            Select branch, date range, or tender type above to view itemized expense drilldown.
          </p>
        </div>
      ) : isLoading ? (
        /* Loading Skeleton */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-16 flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-10 h-10 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-3" />
          <p className="text-slate-600 text-sm font-semibold">Loading Detailed Expenses Drilldown...</p>
          <p className="text-xs text-slate-400 mt-1">Aggregating live ledger transactions</p>
        </div>
      ) : errorMessage ? (
        /* Error Message */
        <div className="rounded-[24px] border border-rose-200 bg-white/85 backdrop-blur-2xl p-8 shadow-xs text-center">
          <p className="text-rose-600 text-sm font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-4 py-2 bg-[#B82E69] hover:bg-[#A02358] text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer transition-all"
          >
            Retry
          </button>
        </div>
      ) : (
        /* Filtered Data Layout */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* Banner Header with Brand Gradient */}
          <div className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
              <Receipt className="w-4 h-4 stroke-[2.5]" />
              <span>Expense Disbursements Register</span>
              <span className="text-[11px] font-bold bg-white/20 text-white px-2.5 py-0.5 rounded-full ml-1">
                {reportData?.rows.length || 0} Vouchers
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                className="h-8 px-3 text-xs font-semibold rounded-xl bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm border border-white/20 shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="h-8 px-3 text-xs font-semibold rounded-xl bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm border border-white/20 shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="h-8 px-3 text-xs font-semibold rounded-xl bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm border border-white/20 shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Table Container with Horizontal Scroll */}
          <div className="bg-transparent overflow-x-auto">
            <table className="report-records w-full min-w-[1200px] text-left border-collapse font-sans text-[13px] antialiased">
              <thead>
                <tr className="bg-[#FAF8F9]/80 border-b border-white/80 text-[#78616C] font-semibold text-xs tracking-wider">
                  <th className="py-3.5 px-4 text-center w-12 font-medium text-[#475569]">#</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] whitespace-nowrap">Voucher #</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] whitespace-nowrap">Date</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Branch</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Category</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Title & Payee</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Source</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-center w-24">Status</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569]">Created By</th>
                  <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dashed divide-slate-200">
                {reportData && reportData.rows.length > 0 ? (
                  reportData.rows.map((row: DetailedExpenseRow, idx: number) => {
                    const isPosted = row.status === 'POSTED';
                    const isReversed = row.status === 'REVERSED';
                    const dateParts = formatDateParts(row.date);

                    return (
                      <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        {/* 1. # */}
                        <td className="py-3.5 px-4 text-center font-normal text-slate-500 text-[13px]">
                          {idx + 1}
                        </td>

                        {/* 2. Voucher # */}
                        <td className="py-3.5 px-4 font-semibold whitespace-nowrap text-[13px]">
                          <span className="text-[#9D2558] font-mono">{row.voucherNumber}</span>
                        </td>

                        {/* 3. Date */}
                        <td className="py-3.5 px-4 whitespace-nowrap leading-tight text-[13px]">
                          <div className="font-medium text-slate-800">{dateParts.dayMonth}</div>
                          <div className="text-[11px] text-slate-400">{dateParts.year}</div>
                        </td>

                        {/* 4. Branch */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 text-[13px]">
                          {row.branchName || 'Main Branch'}
                        </td>

                        {/* 5. Category */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[13px]">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                            {row.category}
                          </span>
                        </td>

                        {/* 6. Title & Payee */}
                        <td className="py-3.5 px-4 text-[13px]">
                          <div className="font-semibold text-slate-900 leading-tight">{row.payee || 'Supplier / Vendor'}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[240px] mt-0.5">{row.title}</div>
                        </td>

                        {/* 7. Source */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] text-[13px]">
                          <div className="flex items-center gap-1.5">
                            {row.paymentSource === 'CASH_DRAWER' ? (
                              <>
                                <Banknote className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span className="text-slate-700">Cash Drawer</span>
                              </>
                            ) : (
                              <>
                                <CreditCard className="w-3.5 h-3.5 text-[#9D2558] shrink-0" />
                                <span className="text-slate-700 truncate max-w-[130px]">
                                  {row.paymentAccountName || 'Bank / Online'}
                                </span>
                              </>
                            )}
                          </div>
                        </td>

                        {/* 8. Status */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {isPosted ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#9D2558] border border-[#F1DEE3]">
                              POSTED
                            </span>
                          ) : isReversed ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              REVERSED
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              {row.status}
                            </span>
                          )}
                        </td>

                        {/* 9. Created By */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 text-[12px]">
                          {row.createdByName || 'Staff'}
                        </td>

                        {/* 10. Amount */}
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap text-[13px]">
                          {isReversed ? (
                            <span className="text-rose-600">PKR {formatPKR(row.amount)}</span>
                          ) : (
                            <span className="text-slate-900">PKR {formatPKR(row.amount)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400 font-medium">
                      No expense disbursements found for the selected branch, dates, and filters.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Integrated Table Footer */}
              <tfoot className="bg-[#FAF8F9]/80 border-t border-white/80 font-sans text-xs">
                {/* Row 1: TOTALS (PKR) */}
                <tr className="border-b border-white/60">
                  <td colSpan={9} className="py-3.5 px-4 text-right font-bold text-slate-800 tracking-wide">
                    NET PAID EXPENSES (PKR)
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    PKR {formatPKR((kpis as any).totalExpenses ?? (kpis as any).totalPostedAmount ?? reportData?.totals?.amount ?? 0)}
                  </td>
                </tr>

                {/* Row 2: Net Operating Disbursements */}
                <tr>
                  <td colSpan={9} className="py-3 px-4 text-right font-semibold text-slate-700">
                    Net Recognized Disbursements
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-extrabold text-[#B82E69] text-sm">
                    PKR {formatPKR((kpis as any).totalExpenses ?? (kpis as any).netExpenseAmount ?? reportData?.totals?.amount ?? 0)}
                  </td>
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
    </div>
  );
};

export default DetailedExpensesReportPage;
