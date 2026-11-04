import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  TaxReport,
  TaxReportServiceRow,
  TaxReportServiceSummary,
  TaxReportRow,
  TaxReportQuery,
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
  Search,
  Scissors,
  Layers,
  Landmark,
  TrendingUp,
  RotateCcw,
  Percent,
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

const formatMethod = (method: string) => {
  if (!method) return 'Cash';
  const m = method.toUpperCase();
  if (m === 'CASH') return 'Cash';
  if (m.includes('BANK') || m.includes('ONLINE') || m.includes('TRANSFER')) return 'Bank Transfer';
  if (m.includes('CARD')) return 'Card';
  return method;
};

type TaxViewTab = 'SERVICES' | 'SERVICE_SUMMARY' | 'INVOICES';

export const TaxReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/tax" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  // Filters State
  const [selectedBranch, setSelectedBranch] = useState<string>(activeBranchId || user.branchId || 'ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active Tab
  const [activeTab, setActiveTab] = useState<TaxViewTab>('SERVICES');

  // Page state: Only fetch when user explicitly clicks Filter (Matching Income & Expense Page UI)
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportData, setReportData] = useState<TaxReport | null>(null);

  // Synchronize branch when context updates
  useEffect(() => {
    if (!isSuperAdmin && user.branchId) {
      setSelectedBranch(user.branchId);
    } else if (activeBranchId) {
      setSelectedBranch(activeBranchId);
    }
  }, [activeBranchId, user.branchId, isSuperAdmin]);

  const fetchReport = useCallback(
    async (q: TaxReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await salonService.getTaxReport(q);
        setReportData(res);
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to fetch live tax report data from server.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: TaxReportQuery = {
      branchId: selectedBranch !== 'ALL' ? selectedBranch : undefined,
      startDate: fromDate || undefined,
      endDate: toDate || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      preset: !fromDate && !toDate ? 'THIS_MONTH' : 'CUSTOM',
      search: searchQuery.trim() || undefined,
    };

    fetchReport(query);
  };

  // Service rows & summaries
  const serviceRows: TaxReportServiceRow[] = useMemo(() => {
    if (!reportData) return [];
    if (reportData.serviceRows && reportData.serviceRows.length) return reportData.serviceRows;
    return (reportData.rows as TaxReportServiceRow[]) || [];
  }, [reportData]);

  const serviceSummary: TaxReportServiceSummary[] = useMemo(() => {
    if (!reportData) return [];
    if (reportData.serviceSummary && reportData.serviceSummary.length) return reportData.serviceSummary;
    const map = new Map<string, TaxReportServiceSummary>();
    serviceRows.forEach((r) => {
      const name = r.serviceName || 'Service';
      const existing = map.get(name) || {
        serviceName: name,
        serviceType: r.serviceType || 'SERVICE',
        count: 0,
        taxableBase: 0,
        taxAmount: 0,
        taxRate: r.taxRate || 0,
      };
      existing.count += r.quantity || 1;
      existing.taxableBase += r.taxableBase || 0;
      existing.taxAmount += r.taxAmount || 0;
      map.set(name, existing);
    });
    return Array.from(map.values());
  }, [reportData, serviceRows]);

  const invoiceRows: TaxReportRow[] = useMemo(() => {
    if (!reportData) return [];
    return reportData.invoiceRows || [];
  }, [reportData]);

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData) return;
    const meta: [string, string][] = [
      ['Uncollected Customer Tax (As of Period End)', formatPKR(reportData.kpis.uncollectedCustomerTax ?? 0)],
      ['Basis', 'Statutory output tax uses invoice/credit dates. Collected tax uses actual receipt/refund/reversal dates; tax remittances and input credits are not calculated here.'],
      ['Invoice Tax', formatPKR(reportData.kpis.totalTaxCharged ?? 0)],
      ['Tax Collected from Customer', formatPKR(reportData.kpis.totalTaxCollected)],
      ['Report', 'Tax Management & Summary Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    if (activeTab === 'SERVICES') {
      const headers = [
        '#',
        'Date',
        'Time',
        'Service Name',
        'Staff',
        'Invoice #',
        'Client',
        'Service Charge',
        'Discount',
        'Taxable Base',
        'Rate %',
        'Net Tax',
        'Total Bill',
      ];
      const rows = serviceRows.map((r, i) => [
        i + 1,
        formatDateDisplay(r.date),
        r.time || '—',
        r.serviceName,
        r.staffName || 'Staff',
        r.invoiceNumber,
        r.clientName || 'Walk-in',
        (r.unitPrice || 0).toFixed(2),
        (r.discount || 0).toFixed(2),
        r.taxableBase.toFixed(2),
        `${r.taxRate}%`,
        r.taxAmount.toFixed(2),
        r.total.toFixed(2),
      ]);
      downloadReportExcel('Tax_Services_Report', meta, [{ headers, rows }]);
    } else if (activeTab === 'SERVICE_SUMMARY') {
      const headers = [
        '#',
        'Service Name',
        'Category / Type',
        'Times Done (Qty)',
        'Total Taxable Sales',
        'Tax Rate %',
        'Net Tax',
      ];
      const rows = serviceSummary.map((s, i) => [
        i + 1,
        s.serviceName,
        s.serviceType,
        s.count,
        s.taxableBase.toFixed(2),
        `${s.taxRate}%`,
        s.taxAmount.toFixed(2),
      ]);
      downloadReportExcel('Tax_Service_Summary', meta, [{ headers, rows }]);
    } else {
      const headers = [
        '#',
        'Date',
        'Invoice #',
        'Branch',
        'Client',
        'Taxable Base',
        'Rate %',
        'Net Tax',
        'Total Bill',
        'Method',
        'Status',
      ];
      const rows = invoiceRows.map((r, i) => [
        i + 1,
        formatDateDisplay(r.date),
        r.reference,
        r.branchName || '—',
        r.clientName || 'Walk-in',
        r.taxableBase.toFixed(2),
        `${r.taxRate}%`,
        r.taxAmount.toFixed(2),
        r.total.toFixed(2),
        formatMethod(r.paymentMethod),
        r.status,
      ]);
      downloadReportExcel('Tax_Invoices_Report', meta, [{ headers, rows }]);
    }
  };

  const handleExportCsv = () => {
    if (!reportData) return;
    const meta: [string, string][] = [
      ['Uncollected Customer Tax (As of Period End)', formatPKR(reportData.kpis.uncollectedCustomerTax ?? 0)],
      ['Basis', 'Statutory output tax uses invoice/credit dates. Collected tax uses actual receipt/refund/reversal dates; tax remittances and input credits are not calculated here.'],
      ['Invoice Tax', formatPKR(reportData.kpis.totalTaxCharged ?? 0)],
      ['Tax Collected from Customer', formatPKR(reportData.kpis.totalTaxCollected)],
      ['Report', 'Tax Management & Summary Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    if (activeTab === 'SERVICES') {
      const headers = [
        '#',
        'Date',
        'Time',
        'Service Name',
        'Staff',
        'Invoice #',
        'Client',
        'Service Charge',
        'Discount',
        'Taxable Base',
        'Rate %',
        'Net Tax',
        'Total Bill',
      ];
      const rows = serviceRows.map((r, i) => [
        i + 1,
        formatDateDisplay(r.date),
        r.time || '—',
        r.serviceName,
        r.staffName || 'Staff',
        r.invoiceNumber,
        r.clientName || 'Walk-in',
        (r.unitPrice || 0).toFixed(2),
        (r.discount || 0).toFixed(2),
        r.taxableBase.toFixed(2),
        `${r.taxRate}%`,
        r.taxAmount.toFixed(2),
        r.total.toFixed(2),
      ]);
      downloadReportCsv('Tax_Services_Report', meta, [{ headers, rows }]);
    } else if (activeTab === 'INVOICES') {
      const headers = ['#', 'Date', 'Invoice #', 'Branch', 'Client', 'Taxable Base', 'Rate %', 'Net Tax', 'Total Bill', 'Method', 'Status'];
      const rows = invoiceRows.map((r, i) => [
        i + 1, formatDateDisplay(r.date), r.reference, r.branchName, r.clientName,
        r.taxableBase.toFixed(2), `${r.taxRate}%`, r.taxAmount.toFixed(2), r.total.toFixed(2),
        formatMethod(r.paymentMethod), r.status,
      ]);
      downloadReportCsv('Tax_Invoices_Report', meta, [{ headers, rows }]);
    } else {
      const headers = [
        '#',
        'Service Name',
        'Times Done',
        'Total Taxable Sales',
        'Tax Rate %',
        'Net Tax',
      ];
      const rows = serviceSummary.map((s, i) => [
        i + 1,
        s.serviceName,
        s.count,
        s.taxableBase.toFixed(2),
        `${s.taxRate}%`,
        s.taxAmount.toFixed(2),
      ]);
      downloadReportCsv('Tax_Service_Summary', meta, [{ headers, rows }]);
    }
  };

  const handleExportPdf = () => {
    handlePrint();
  };

  const handlePrint = () => {
    if (!reportData) {
      window.print();
      return;
    }
    const meta: [string, string][] = [
      ['Uncollected Customer Tax (As of Period End)', formatPKR(reportData.kpis.uncollectedCustomerTax ?? 0)],
      ['Basis', 'Statutory output tax uses invoice/credit dates. Collected tax uses actual receipt/refund/reversal dates; tax remittances and input credits are not calculated here.'],
      ['Invoice Tax', formatPKR(reportData.kpis.totalTaxCharged ?? 0)],
      ['Tax Collected from Customer', formatPKR(reportData.kpis.totalTaxCollected)],
      ['Report', 'Tax Management & Summary Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['Period', `${formatDateDisplay(reportData.meta.from)} – ${formatDateDisplay(reportData.meta.to)}`],
      ['Total Taxable Sales', `PKR ${formatPKR(reportData.kpis.totalTaxableSales)}`],
      ['Tax Collected from Customer', `PKR ${formatPKR(reportData.kpis.totalTaxCollected)}`],
      ['Tax Refunded', `PKR ${formatPKR(reportData.kpis.totalTaxRefunded)}`],
      ['Statutory Tax Payable', `PKR ${formatPKR(reportData.kpis.netTaxLiability)}`],
    ];

    if (activeTab === 'SERVICES') {
      const headers = [
        '#',
        'Date',
        'Service Name',
        'Staff',
        'Invoice #',
        'Client',
        'Price (PKR)',
        'Taxable (PKR)',
        'Rate %',
        'Tax (PKR)',
        'Total (PKR)',
      ];
      const rows = serviceRows.map((r, i) => [
        i + 1,
        formatDateDisplay(r.date),
        r.serviceName,
        r.staffName || '—',
        r.invoiceNumber,
        r.clientName || 'Walk-in',
        formatPKR(r.unitPrice),
        formatPKR(r.taxableBase),
        `${r.taxRate}%`,
        formatPKR(r.taxAmount),
        formatPKR(r.total),
      ]);
      printReportWindow({
        title: 'Tax Management Report — Service Breakdown',
        subtitle: `Branch: ${selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch}`,
        meta,
        headers,
        rows,
        totals: [
          'Total',
          '—',
          `${serviceRows.length} Services`,
          '—',
          '—',
          '—',
          '—',
          `PKR ${formatPKR(reportData.totals.taxableBase)}`,
          '—',
          `PKR ${formatPKR(reportData.totals.taxAmount)}`,
          `PKR ${formatPKR(reportData.totals.total ?? ((reportData.totals.taxableBase || 0) + (reportData.totals.taxAmount || 0)))}`,
        ],
      });
    } else if (activeTab === 'INVOICES') {
      printReportWindow({
        title: 'Tax Management Report — Invoices',
        subtitle: `Branch: ${selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch}`,
        meta,
        headers: ['#', 'Date', 'Invoice #', 'Branch', 'Client', 'Taxable Base', 'Rate %', 'Net Tax', 'Total Bill', 'Method', 'Status'],
        rows: invoiceRows.map((r, i) => [
          i + 1, formatDateDisplay(r.date), r.reference, r.branchName, r.clientName,
          formatPKR(r.taxableBase), `${r.taxRate}%`, formatPKR(r.taxAmount), formatPKR(r.total),
          formatMethod(r.paymentMethod), r.status,
        ]),
        totals: ['Total', '', '', '', '', formatPKR(reportData.totals.taxableBase), '',
          formatPKR(reportData.totals.taxAmount), formatPKR(reportData.totals.total ?? 0), '', ''],
      });
    } else {
      const headers = [
        '#',
        'Service Name',
        'Type',
        'Times Done',
        'Taxable Sales (PKR)',
        'Rate %',
        'Net Tax (PKR)',
      ];
      const rows = serviceSummary.map((s, i) => [
        i + 1,
        s.serviceName,
        s.serviceType,
        s.count,
        formatPKR(s.taxableBase),
        `${s.taxRate}%`,
        formatPKR(s.taxAmount),
      ]);
      printReportWindow({
        title: 'Tax Management Report — Service Summary',
        subtitle: `Branch: ${selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch}`,
        meta,
        headers,
        rows,
        totals: [
          'Total',
          '—',
          '—',
          '—',
          `PKR ${formatPKR(reportData.totals.taxableBase)}`,
          '—',
          `PKR ${formatPKR(reportData.totals.taxAmount)}`,
        ],
      });
    }
  };

  const availableBranches = useMemo(() => {
    if (!allBranches) return [];
    return allBranches;
  }, [allBranches]);

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      <p className="text-xs text-slate-600">Collected tax follows actual payment, refund and reversal dates. Statutory output tax follows invoice and credit dates; remittances and input-tax credits are not calculated here.</p>
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
                  Tax Management Reports
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  PST / SST Compliance
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Provincial & Federal Sales Tax audit register: Gross taxable base, output tax, adjustments, reversals and net liability
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5 items-end">
          {/* Branch Filter */}
          <div>
            <label className={labelClass}>Branch</label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              disabled={!isSuperAdmin}
              className={selectClass}
            >
              {isSuperAdmin && <option value="ALL">All Branches</option>}
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search / Service */}
          <div>
            <label className={labelClass}>Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Service, Invoice #, Client..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${inputClass} pl-8.5`}
              />
            </div>
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

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR KPI CARDS (when filtered) ── */}
      {hasFiltered && reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Gross Taxable Sales */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Invoice Tax
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData.kpis.totalTaxCharged ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Taxable turnover: PKR {formatPKR(reportData.totals.taxableBase || 0)}
              </span>
            </div>
          </div>

          {/* Card 2: Output Tax Collected */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <Receipt className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Tax Collected from Customer
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData.kpis?.totalTaxCollected ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Tax Collected from Actual Customer Receipts
              </span>
            </div>
          </div>

          {/* Card 3: Tax Refunded / Reversed */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                <RotateCcw className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Refunds
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData.kpis?.totalTaxRefunded ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Tax reversed & credited
              </span>
            </div>
          </div>

          {/* Card 4: Net Tax Liability */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Landmark className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Statutory Tax Payable
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#B82E69] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData.kpis?.netTaxLiability ?? reportData.totals.netTax ?? reportData.totals.taxAmount ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Net tax payable to authority
              </span>
            </div>
          </div>

          {/* Card 5: Effective Tax Rate */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-purple-600">
                <Percent className="w-4 h-4" />
              </div>
              <span className="bg-purple-50 text-purple-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Uncollected Customer Tax
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData.kpis.uncollectedCustomerTax ?? 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Customer balance as of period end; not statutory tax payable

              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. MAIN CONTENT AREA: TABLE & STATES ── */}
      {!hasFiltered ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 md:p-24 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69] mb-4">
            <Filter className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h3 className="text-base font-bold text-[#18191B]">No Filter Applied</h3>
          <p className="text-xs text-[#78616C] mt-1 max-w-sm">
            Select a branch and date range above, then click &ldquo;Apply Filters&rdquo; to query live sales tax audit transactions.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-sm animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#B82E69]" />
          </div>
          <p className="text-sm font-bold text-[#18191B]">Loading Tax Management Reports...</p>
          <p className="text-xs text-[#78616C] mt-0.5">Fetching audited PST/SST transactions from server</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-[24px] border border-rose-200/80 bg-white/85 p-8 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035)] text-center">
          <p className="text-rose-600 text-sm font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-4 py-2 bg-[#B82E69] text-white text-xs font-semibold rounded-xl shadow-xs hover:bg-[#A02358] transition-colors cursor-pointer"
          >
            Retry Query
          </button>
        </div>
      ) : (
        /* Filtered Data Layout: Frosted Table Card */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* Header Bar with View Switcher Tabs & Export Actions */}
          <div className="px-6 py-4 border-b border-white/80 bg-white/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 font-bold text-sm tracking-tight text-[#18191B]">
                <Receipt className="w-4 h-4 text-[#B82E69]" />
                <span>Audited Tax Register</span>
              </div>

              {/* View Switcher Tabs */}
              <div className="flex items-center bg-slate-100/70 p-1 rounded-xl border border-white/80 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('SERVICES')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'SERVICES'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Service Breakdown ({serviceRows.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('SERVICE_SUMMARY')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'SERVICE_SUMMARY'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Service Summary ({serviceSummary.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('INVOICES')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'INVOICES'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Invoice Summary ({invoiceRows.length})</span>
                </button>
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-rose-600" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* TAB 1: Service Breakdown */}
          {activeTab === 'SERVICES' && (
            <div className="overflow-x-auto">
              <table className="report-records w-full min-w-[1250px] text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4 text-center w-12">#</th>
                    <th className="py-3 px-4 whitespace-nowrap">Date & Time</th>
                    <th className="py-3 px-4 min-w-[190px]">Service Performed</th>
                    <th className="py-3 px-4 whitespace-nowrap">Staff / Stylist</th>
                    <th className="py-3 px-4 whitespace-nowrap">Invoice #</th>
                    <th className="py-3 px-4 min-w-[160px]">Client Name</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Service Price</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Discount</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Taxable Base</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Rate %</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Net Tax</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Total Bill</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {serviceRows.length > 0 ? (
                    serviceRows.map((row, idx) => {
                      const dateParts = formatDateParts(row.date);
                      return (
                        <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/30 transition-colors">
                          <td className="py-3 px-4 text-center text-slate-400 font-mono">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                            <div className="leading-tight">
                              <div className="font-semibold">{dateParts.dayMonth}</div>
                              <div className="text-[11px] text-slate-400">{row.time || dateParts.year}</div>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <span>{row.serviceName}</span>
                              {row.quantity > 1 && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-[#FDF2F5] text-[#B82E69]">
                                  ×{row.quantity}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-normal">{row.serviceType}</div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-700 font-medium">
                            {row.staffName || 'Staff'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono font-bold text-[#B82E69]">
                            {row.invoiceNumber}
                          </td>
                          <td className="py-3 px-4 text-slate-800">
                            {row.clientName || 'Walk-in Customer'}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-700 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.unitPrice)}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-500 whitespace-nowrap font-mono tabular-nums">
                            {row.discount > 0 ? `PKR ${formatPKR(row.discount)}` : '0.00'}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.taxableBase)}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                              {row.taxRate}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-600 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.taxAmount)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.total)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={12} className="py-16 text-center text-slate-400 font-medium">
                        No service tax transactions found for the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>

                {/* Table Footer Totals */}
                <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs">
                  <tr className="border-b border-slate-200/60 font-bold">
                    <td colSpan={6} className="py-3.5 px-4 text-right text-slate-800 tracking-wide">
                      TOTALS ({serviceRows.length} Services):
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-700 font-mono tabular-nums">
                      PKR {formatPKR(serviceRows.reduce((acc, r) => acc + (r.unitPrice || 0), 0))}
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-500 font-mono tabular-nums">
                      PKR {formatPKR(serviceRows.reduce((acc, r) => acc + (r.discount || 0), 0))}
                    </td>
                    <td className="py-3.5 px-4 text-right text-[#B82E69] font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.taxableBase || 0)}
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-400">—</td>
                    <td className="py-3.5 px-4 text-right text-emerald-600 font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.taxAmount ?? 0)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-900 font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.total || 0)}
                    </td>
                  </tr>

                  <tr className="border-b border-slate-200/60">
                    <td colSpan={8} className="py-2.5 px-4 text-right font-semibold text-slate-700">
                      Invoice Tax (Statutory Output Tax Charged)
                    </td>
                    <td colSpan={4} className="py-2.5 px-4 text-right font-bold font-mono tabular-nums text-emerald-600">
                      +PKR {formatPKR(reportData?.kpis.totalTaxCharged ?? 0)}
                    </td>
                  </tr>

                  <tr className="border-b border-slate-200/60">
                    <td colSpan={8} className="py-2.5 px-4 text-right font-semibold text-slate-700">
                      Tax Refunded / Reversed
                    </td>
                    <td colSpan={4} className="py-2.5 px-4 text-right font-bold font-mono tabular-nums text-amber-600">
                      -PKR {formatPKR(reportData?.kpis.totalTaxRefunded || 0)}
                    </td>
                  </tr>

                  <tr>
                    <td colSpan={8} className="py-3 px-4 text-right font-extrabold text-slate-900">
                      Statutory Tax Payable (Existing Recognition Basis)
                    </td>
                    <td colSpan={4} className="py-3 px-4 text-right font-extrabold font-mono tabular-nums text-[#B82E69] text-sm">
                      PKR {formatPKR(reportData?.kpis.netTaxLiability ?? reportData?.totals.netTax ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200"><td colSpan={8} className="py-3 px-4 text-right">Tax Collected (Customer Payments; Separate from Statutory Liability)</td><td colSpan={4} className="py-3 px-4 text-right font-mono">PKR {formatPKR(reportData?.kpis.totalTaxCollected ?? 0)}</td></tr>
                  <tr><td colSpan={8} className="py-3 px-4 text-right">Uncollected Customer Tax (As of Period End)</td><td colSpan={4} className="py-3 px-4 text-right font-mono">PKR {formatPKR(reportData?.kpis.uncollectedCustomerTax ?? 0)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* TAB 2: Service Summary */}
          {activeTab === 'SERVICE_SUMMARY' && (
            <div className="overflow-x-auto">
              <table className="report-records w-full min-w-[950px] text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4 text-center w-12">#</th>
                    <th className="py-3 px-4 min-w-[220px]">Service Name</th>
                    <th className="py-3 px-4 whitespace-nowrap">Category / Type</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Net Quantity</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Total Taxable Sales</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Tax Rate %</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Net Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {serviceSummary.length > 0 ? (
                    serviceSummary.map((s, idx) => (
                      <tr key={s.serviceName || idx} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        <td className="py-3 px-4 text-center text-slate-400 font-mono">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {s.serviceName}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {s.serviceType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-[#B82E69] font-mono">
                          {s.count}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                          PKR {formatPKR(s.taxableBase)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap font-medium text-slate-600">
                          {s.taxRate}%
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-600 whitespace-nowrap font-mono tabular-nums">
                          PKR {formatPKR(s.taxAmount)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-slate-400 font-medium">
                        No service summary data found.
                      </td>
                    </tr>
                  )}
                </tbody>

                <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs">
                  <tr className="font-bold">
                    <td colSpan={4} className="py-3.5 px-4 text-right text-slate-800">
                      TOTALS ({serviceSummary.length} Unique Services):
                    </td>
                    <td className="py-3.5 px-4 text-right text-[#B82E69] font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.taxableBase || 0)}
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-400">—</td>
                    <td className="py-3.5 px-4 text-right text-emerald-600 font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.taxAmount ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* TAB 3: Invoice Summary */}
          {activeTab === 'INVOICES' && (
            <div className="overflow-x-auto">
              <table className="report-records w-full min-w-[1100px] text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4 text-center w-12">#</th>
                    <th className="py-3 px-4 whitespace-nowrap">Date & Time</th>
                    <th className="py-3 px-4 whitespace-nowrap">Invoice #</th>
                    <th className="py-3 px-4 whitespace-nowrap">Branch</th>
                    <th className="py-3 px-4 min-w-[180px]">Client Name</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Taxable Base</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Rate %</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Net Tax</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Total Invoice</th>
                    <th className="py-3 px-4 whitespace-nowrap">Payment Method</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoiceRows.length > 0 ? (
                    invoiceRows.map((row, idx) => {
                      const dateParts = formatDateParts(row.date);
                      return (
                        <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/30 transition-colors">
                          <td className="py-3 px-4 text-center text-slate-400 font-mono">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                            <div className="leading-tight">
                              <div className="font-semibold">{dateParts.dayMonth}</div>
                              <div className="text-[11px] text-slate-400">{row.time || dateParts.year}</div>
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono font-bold text-[#B82E69]">
                            {row.reference}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                            {row.branchName || 'Branch'}
                          </td>
                          <td className="py-3 px-4 text-slate-800">
                            {row.clientName || 'Walk-in Customer'}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.taxableBase)}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                              {row.taxRate}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-600 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.taxAmount)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                            PKR {formatPKR(row.total)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                            {formatMethod(row.paymentMethod)}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={11} className="py-16 text-center text-slate-400 font-medium">
                        No invoice tax transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>

                <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs">
                  <tr className="font-bold">
                    <td colSpan={5} className="py-3.5 px-4 text-right text-slate-800">
                      TOTALS ({invoiceRows.length} Invoices):
                    </td>
                    <td className="py-3.5 px-4 text-right text-[#B82E69] font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.taxableBase || 0)}
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-400">—</td>
                    <td className="py-3.5 px-4 text-right text-emerald-600 font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.taxAmount ?? 0)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-900 font-mono tabular-nums">
                      PKR {formatPKR(reportData?.totals.total || 0)}
                    </td>
                    <td colSpan={2} className="py-3.5 px-4 text-slate-600">
                      Net Liability: <span className="text-[#B82E69] font-mono font-bold">PKR {formatPKR(reportData?.totals.netTax || 0)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaxReportPage;
