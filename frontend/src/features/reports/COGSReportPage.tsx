import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  OperatingProfitReport,
  OperatingProfitStatementRow,
  OperatingProfitDetailRow,
  OperatingProfitReportQuery,
  OperatingProfitReportViewData,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  TrendingUp,
  Receipt,
  Landmark,
  Scale,
  Percent,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import {
  DATE_PRESETS,
  DatePreset,
  downloadReportCsv,
  formatSignedPKR,
  printReportWindow,
  resolvePreset,
} from './reportUtils';

const selectClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium cursor-pointer transition-all';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

const formatPKR = formatSignedPKR;

export const COGSReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role guard: Super Admin and Admin
  if (!user || !['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
    return <AccessDeniedView attemptedPath="/reports/operating-profit" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = resolvePreset('THIS_MONTH', businessDate)!;

  // View Mode: Accounting P&L (Accrual) vs Collection-Based Performance
  const [viewMode, setViewMode] = useState<'ACCRUAL' | 'COLLECTION'>('ACCRUAL');

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState<string>(defaultMonth.from);
  const [customTo, setCustomTo] = useState<string>(defaultMonth.to);
  const [activeTab, setActiveTab] = useState<'STATEMENT' | 'DETAILED'>('STATEMENT');

  // Page state: Only fetch when user explicitly clicks Filter ("filter karna sa aae default nhi")
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<OperatingProfitReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePresetChange = (p: DatePreset) => {
    setSelectedPreset(p);
    const r = resolvePreset(p, businessDate);
    if (r) {
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  };

  const branchNameDisplay = useMemo(() => {
    if (selectedBranch === 'ALL') return 'All Branches';
    return (
      allBranches?.find((b) => b.id === selectedBranch)?.name ||
      reportData?.meta.branchName ||
      selectedBranch
    );
  }, [selectedBranch, allBranches, reportData]);

  // Fetch report data from live backend API (100% Real DB)
  const fetchReport = useCallback(
    async (q: OperatingProfitReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getOperatingProfitReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Operating Profit report:', err);
        setErrorMessage(
          err.message || 'Failed to fetch live operating profit report from server.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: OperatingProfitReportQuery = {
      branchId: selectedBranch,
      preset: selectedPreset,
      startDate: customFrom || undefined,
      endDate: customTo || undefined,
      from: customFrom || undefined,
      to: customTo || undefined,
      viewMode,
    };

    fetchReport(query);
  };

  // Active view payload (Accrual vs Collection)
  const activeViewData: OperatingProfitReportViewData | null = useMemo(() => {
    if (!reportData) return null;
    if (viewMode === 'COLLECTION' && reportData.collection) {
      return reportData.collection;
    }
    if (reportData.accrual) {
      return reportData.accrual;
    }
    return {
      kpis: reportData.kpis,
      statementRows: reportData.statementRows,
      rows: reportData.rows,
      totals: reportData.totals,
    };
  }, [reportData, viewMode]);

  // Export handlers
  const exportHeaders = [
    'Account / Line Item',
    'Classification',
    'Department / Category',
    'Current Period (PKR)',
    '% of Net Revenue',
    'Prior Period (PKR)',
    'Variance (PKR)',
    'Growth (%)',
    'Notes / Details',
  ];

  const exportRows = useMemo(() => {
    if (!activeViewData?.rows) return [];
    return activeViewData.rows.map((r) => [
      r.accountName,
      r.classification,
      r.department,
      r.currentAmount.toFixed(2),
      `${r.percentOfRevenue}%`,
      r.priorAmount.toFixed(2),
      r.varianceAmount.toFixed(2),
      r.growthPercent !== null ? `${r.growthPercent}%` : 'N/A',
      r.notes,
    ]);
  }, [activeViewData]);

  const exportMeta: [string, string][] = useMemo(() => {
    const meta = reportData?.meta;
    return [
      ['Report', `Operating Profit & P&L Statement (${viewMode === 'ACCRUAL' ? 'Accounting Accrual' : 'Collection-Based'})`],
      ['Accounting Basis', viewMode === 'ACCRUAL' ? 'Accrual Basis (Invoiced Sales)' : 'Collection Basis (Actual Cash Inflow)'],
      ['Branch', branchNameDisplay],
      ['Current Period', `${customFrom || meta?.from || ''} to ${customTo || meta?.to || ''}`],
      ['Generated By', user?.name || 'Administrator'],
      ['Generated At', new Date().toLocaleString()],
    ];
  }, [reportData, user, branchNameDisplay, customFrom, customTo, viewMode]);

  const handleExportCsv = () => {
    if (!activeViewData || !activeViewData.rows.length) return;
    const prefix = viewMode === 'ACCRUAL' ? 'operating_profit_accrual' : 'operating_profit_collection';
    downloadReportCsv(prefix, exportMeta, [
      { headers: exportHeaders, rows: exportRows },
    ]);
  };

  const handlePrint = () => {
    if (!activeViewData || !activeViewData.rows.length) return;
    const totals = activeViewData.totals;
    const isAccrual = viewMode === 'ACCRUAL';
    const footers = [
      isAccrual ? 'NET OPERATING PROFIT' : 'COLLECTION CASH SURPLUS',
      isAccrual ? 'NET_PROFIT' : 'CASH_SURPLUS',
      'Total Business',
      formatPKR(totals.netProfit),
      `${activeViewData.kpis.operatingMarginPercent}%`,
      formatPKR(activeViewData.kpis.priorOperatingProfit ?? activeViewData.kpis.priorCashSurplus ?? 0),
      formatPKR(totals.netProfit - (activeViewData.kpis.priorOperatingProfit ?? activeViewData.kpis.priorCashSurplus ?? 0)),
      activeViewData.kpis.profitGrowthPercent !== null ? `${activeViewData.kpis.profitGrowthPercent}%` : 'N/A',
      `${isAccrual ? 'Operating Margin' : 'Surplus Margin'}: ${activeViewData.kpis.operatingMarginPercent}%`,
    ];

    printReportWindow({
      title: `Operating Profit Statement — ${isAccrual ? 'Accounting P&L (Accrual)' : 'Collection-Based Performance'}`,
      subtitle: `Branch: ${branchNameDisplay} · Period: ${customFrom} to ${customTo}`,
      meta: exportMeta,
      headers: exportHeaders,
      rows: exportRows,
      totals: footers,
    });
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism with Dual-View Switcher) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Operating Profit & P&L Statement
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  {viewMode === 'ACCRUAL' ? 'Accounting P&L (Accrual)' : 'Collection-Based Performance'}
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                {viewMode === 'ACCRUAL'
                  ? 'Recognized net sales, COGS and full completed-service commission expense; later collections do not recognize commission again'
                  : 'Actual collected service/product revenue (excl. tax), statutory tax segregation, and direct cash disbursements'}
              </p>
            </div>
          </div>

          {/* Segmented Controls for Dual View */}
          <div className="inline-flex p-1.5 bg-white/90 rounded-2xl border border-white/90 shadow-2xs gap-1.5 backdrop-blur-md self-start lg:self-center">
            <button
              type="button"
              onClick={() => setViewMode('ACCRUAL')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'ACCRUAL'
                  ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Accounting P&L (Accrual)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('COLLECTION')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'COLLECTION'
                  ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Collection-Based Performance</span>
            </button>
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
              className={selectClass}
            >
              {isSuperAdmin && <option value="ALL">All Branches</option>}
              {allBranches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Preset Filter */}
          <div>
            <label className={labelClass}>Date Preset</label>
            <select
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
              className={selectClass}
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* From Date */}
          <div>
            <label className={labelClass}>From Date</label>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setSelectedPreset('CUSTOM');
              }}
              className={inputClass}
            />
          </div>

          {/* To Date */}
          <div>
            <label className={labelClass}>To Date</label>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setSelectedPreset('CUSTOM');
              }}
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

      {/* ── 3. TOP 6 KPI CARDS (DYNMICALLY SWITCHED PER VIEW) ── */}
      {hasFiltered && activeViewData && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {viewMode === 'ACCRUAL' ? (
              <>
                {/* Accrual Card 1: Net Revenue */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Revenue
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.totals.revenue)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Net recognized turnover
                    </span>
                  </div>
                </div>

                {/* Accrual Card 2: COGS & Consumables */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      COGS
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.totals.costOfSales)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Retail goods & backbar usage
                    </span>
                  </div>
                </div>

                {/* Accrual Card 3: Operating Overheads */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Overheads
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.totals.operatingExpenses)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Accrued payroll & expenses
                    </span>
                  </div>
                </div>

                {/* Accrual Card 4: Net Operating Profit */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                      <Landmark className="w-4 h-4" />
                    </div>
                    <span className={`shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full ${activeViewData.totals.netProfit >= 0 ? 'bg-[#FDF2F5] text-[#B82E69]' : 'bg-rose-50 text-rose-700'}`}>
                      {activeViewData.totals.netProfit >= 0 ? 'Operating Profit' : 'Operating Loss'}
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className={`text-xl sm:text-2xl font-extrabold font-mono tabular-nums tracking-tight block ${activeViewData.totals.netProfit >= 0 ? 'text-[#18191B]' : 'text-rose-600'}`}>
                      PKR {formatPKR(activeViewData.totals.netProfit)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Net Operating Result
                    </span>
                  </div>
                </div>

                {/* Accrual Card 5: Operating Margin */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-indigo-600">
                      <Percent className="w-4 h-4" />
                    </div>
                    <span className="bg-indigo-50 text-indigo-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Margin
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      {activeViewData.kpis.operatingMarginPercent}%
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Operating ROS Margin
                    </span>
                  </div>
                </div>

                {/* Accrual Card 6: Customer Outstanding Dues */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-orange-600">
                      <Scale className="w-4 h-4" />
                    </div>
                    <span className="bg-orange-50 text-orange-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Outstanding
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.kpis.outstandingDues ?? activeViewData.totals.outstandingDues ?? 0)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Uncollected customer dues
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Collection Card 1: Collected Revenue (Excl Tax) */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Revenue
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.totals.revenue)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Collected revenue (excl. tax)
                    </span>
                  </div>
                </div>

                {/* Collection Card 2: Tax Collected (Separate) */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-sky-600">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="bg-sky-50 text-sky-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Tax Collected
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.kpis.totalCollectedTax ?? activeViewData.totals.collectedTax ?? 0)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Statutory tax (not income)
                    </span>
                  </div>
                </div>

                {/* Collection Card 3: Total Collections */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Collections
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.kpis.totalGrossCollections ?? activeViewData.totals.totalCollections ?? 0)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Net cash & bank received
                    </span>
                  </div>
                </div>

                {/* Collection Card 4: Actual Paid Expenses */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Paid Expenses
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.totals.operatingExpenses)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Paid vouchers & wages
                    </span>
                  </div>
                </div>

                {/* Collection Card 5: Collection Cash Surplus */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                      <Landmark className="w-4 h-4" />
                    </div>
                    <span className={`shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full ${activeViewData.totals.netProfit >= 0 ? 'bg-[#FDF2F5] text-[#B82E69]' : 'bg-rose-50 text-rose-700'}`}>
                      {activeViewData.totals.netProfit >= 0 ? 'Cash Surplus' : 'Cash Deficit'}
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className={`text-xl sm:text-2xl font-extrabold font-mono tabular-nums tracking-tight block ${activeViewData.totals.netProfit >= 0 ? 'text-[#18191B]' : 'text-rose-600'}`}>
                      PKR {formatPKR(activeViewData.totals.netProfit)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Realized Operating Surplus
                    </span>
                  </div>
                </div>

                {/* Collection Card 6: Customer Outstanding Dues */}
                <div className="p-4 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg transition-all duration-300 relative overflow-hidden group">
                  <div className="flex items-center justify-between relative z-10">
                    <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-orange-600">
                      <Scale className="w-4 h-4" />
                    </div>
                    <span className="bg-orange-50 text-orange-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Outstanding
                    </span>
                  </div>
                  <div className="mt-3 relative z-10">
                    <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                      PKR {formatPKR(activeViewData.kpis.outstandingDues ?? activeViewData.totals.outstandingDues ?? 0)}
                    </span>
                    <span className="text-[11px] text-[#78616C] font-medium mt-1 block truncate">
                      Uncollected customer dues
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Collection Basis Realization Note */}
          {viewMode === 'COLLECTION' && (
            <div className="rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50/70 to-blue-50/70 p-3 px-4 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs text-sky-950 shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                <span className="font-semibold text-slate-800">Collection Basis Rule:</span>
                <span className="text-slate-600 text-[11.5px]">
                  Only realized cash receipts excl. tax are recognized as operating turnover. Sales tax is separated as statutory liability. Full service commission is recognized separately in Accounting P&L. Cash surplus deducts actual paid operating expenses only; COGS and inventory write-offs are separate information.
                </span>
              </div>
              <div className="flex items-center gap-2.5 font-mono text-[11px]">
                <span className="bg-white/90 px-2.5 py-1 rounded-lg border border-sky-200/60 shadow-2xs text-slate-800">
                  Earned Comm: PKR {formatPKR(activeViewData.kpis.collectionEarnedCommission ?? 0)}
                </span>
                <span className="bg-white/90 px-2.5 py-1 rounded-lg border border-sky-200/60 shadow-2xs text-amber-800 font-semibold">
                  Unpaid Liability: PKR {formatPKR(activeViewData.kpis.unpaidCommissionLiability ?? 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4. MAIN CONTENT AREA ── */}
      {!hasFiltered ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 md:p-24 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-2xs">
            <Filter className="w-8 h-8 stroke-[1.75]" />
          </div>
          <h3 className="text-base font-semibold text-[#18191B]">Ready to Calculate P&L Statement</h3>
          <p className="text-xs text-[#78616C] font-medium mt-1 max-w-sm">
            Select branch and date preset above and click Apply Filters to generate operating profit report.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-12 h-12 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-4" />
          <p className="text-slate-800 text-sm font-semibold">Calculating Operating Profit Statement...</p>
          <p className="text-xs text-slate-500 mt-0.5">Aggregating live collections, COGS, and operating expenses</p>
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
        /* ── FILTERED DATA TABLE ── */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* Table Header Bar */}
          <div className="p-5 border-b border-white/80 flex flex-wrap items-center justify-between gap-3 bg-white/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                {viewMode === 'ACCRUAL' ? <Scale className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#18191B] tracking-tight">
                    {viewMode === 'ACCRUAL' ? 'Accounting P&L Statement (Accrual)' : 'Collection-Based Performance Statement'}
                  </h3>
                  <p className="text-[11px] text-[#78616C] mt-0.5">
                    Branch: {branchNameDisplay} · Period: {customFrom} to {customTo}
                  </p>
                </div>
                {/* Tab Switcher */}
                <div className="inline-flex p-1 bg-white/80 rounded-xl border border-white/80 shadow-2xs gap-1 ml-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('STATEMENT')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'STATEMENT'
                        ? 'bg-[#B82E69] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Statement View
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('DETAILED')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'DETAILED'
                        ? 'bg-[#B82E69] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Detailed Ledger ({activeViewData?.rows.length ?? 0})
                  </button>
                </div>
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={handleExportCsv}
                className="h-8 px-3 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Export raw data to CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-600" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="h-8 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Download or Print PDF"
              >
                <FileText className="w-3.5 h-3.5 text-rose-600" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Print report"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto w-full">
            {activeTab === 'STATEMENT' ? (
              <table className="report-records w-full text-xs text-left text-slate-700 whitespace-nowrap border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-4 text-left">Financial Line Item</th>
                    <th className="py-3.5 px-4 text-center">Section / Type</th>
                    <th className="py-3.5 px-4 text-right">Current Period (PKR)</th>
                    <th className="py-3.5 px-4 text-right">% of Revenue</th>
                    <th className="py-3.5 px-4 text-right">Prior Period (PKR)</th>
                    <th className="py-3.5 px-4 text-right">Variance / Growth</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!activeViewData?.statementRows?.length ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        No financial records found for the selected period.
                      </td>
                    </tr>
                  ) : (
                    activeViewData.statementRows.map((line) => {
                      if (line.isHeader) {
                        const isTaxSec = line.section === 'STATUTORY_TAX';
                        const isMemoSec = line.section === 'MEMORANDUM';
                        return (
                          <tr key={line.id} className={`${isTaxSec ? 'bg-sky-50/80' : isMemoSec ? 'bg-amber-50/80' : 'bg-slate-100/60'} font-bold text-[#23151D]`}>
                            <td colSpan={6} className={`py-2.5 px-4 uppercase tracking-wider text-[11px] ${isTaxSec ? 'text-sky-800' : isMemoSec ? 'text-amber-800' : 'text-[#9D2558]'}`}>
                              {line.name}
                            </td>
                          </tr>
                        );
                      }

                      if (line.isTotal || line.isMajorTotal || line.isFinalNet) {
                        return (
                          <tr
                            key={line.id}
                            className={`font-bold border-t border-b ${
                              line.isFinalNet
                                ? 'bg-slate-100 font-extrabold text-[#23151D] border-slate-300'
                                : 'bg-slate-50 text-[#23151D] border-slate-200'
                            }`}
                          >
                            <td className="py-2.5 px-4">{line.name}</td>
                            <td className="py-2.5 px-4 text-center text-[10px] text-slate-500 font-mono">
                              {line.isFinalNet ? (viewMode === 'ACCRUAL' ? 'NET RESULT' : 'CASH SURPLUS') : 'SUBTOTAL'}
                            </td>
                            <td className={`py-2.5 px-4 text-right font-mono font-bold ${line.isFinalNet || line.section === 'GROSS_PROFIT' ? (line.currentAmount < 0 ? 'text-red-600' : 'text-green-600') : 'text-[#23151D]'}`}>
                              {formatPKR(line.currentAmount)}
                            </td>
                            <td className={`py-2.5 px-4 text-right font-mono ${line.isFinalNet ? (line.currentAmount < 0 ? 'text-red-600' : 'text-green-600') : 'text-slate-600'}`}>
                              {line.percentOfRevenue}%
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                              {formatPKR(line.priorAmount)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono">
                              {line.growthPercent !== null ? (
                                <span className="text-[#9D2558] font-semibold">
                                  {line.growthPercent >= 0 ? `+${line.growthPercent}%` : `${line.growthPercent}%`}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      }

                      const isTaxItem = line.section === 'STATUTORY_TAX';
                      const isMemoItem = line.section === 'MEMORANDUM';

                      return (
                        <tr key={line.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2 px-4 pl-8 text-slate-800 font-medium flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${isTaxItem ? 'bg-sky-500' : isMemoItem ? 'bg-amber-500' : 'bg-slate-400'}`} />
                            {line.name}
                          </td>
                          <td className="py-2 px-4 text-center">
                            {isTaxItem ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                                STATUTORY
                              </span>
                            ) : isMemoItem ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                MEMORANDUM
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono">{line.section}</span>
                            )}
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-slate-900 font-medium">
                            {formatPKR(line.currentAmount)}
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-slate-500">
                            {line.percentOfRevenue}%
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-slate-400">
                            {formatPKR(line.priorAmount)}
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-slate-600">
                            {line.growthPercent !== null ? `${line.growthPercent}%` : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className="report-records w-full text-[13px] text-left text-slate-700 whitespace-nowrap border-collapse min-w-[1000px] font-['Inter',sans-serif]">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-3">Account / Line Item</th>
                    <th className="py-3.5 px-3">Classification</th>
                    <th className="py-3.5 px-3">Department / Layer</th>
                    <th className="py-3.5 px-3 text-right">Current Period (PKR)</th>
                    <th className="py-3.5 px-3 text-right">% of Revenue</th>
                    <th className="py-3.5 px-3 text-right">Prior Period (PKR)</th>
                    <th className="py-3.5 px-3 text-right">Variance (PKR)</th>
                    <th className="py-3.5 px-3 text-right">Growth (%)</th>
                    <th className="py-3.5 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!activeViewData?.rows?.length ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        No ledger items recorded for this criteria.
                      </td>
                    </tr>
                  ) : (
                    activeViewData.rows.map((r, i) => (
                      <tr key={`${r.accountName}-${i}`} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-[#23151D]">{r.accountName}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            r.classification === 'STATUTORY_TAX'
                              ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : r.classification === 'MEMORANDUM'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-[#FDF2F5] text-[#9D2558] border-[#F1DEE3]'
                          }`}>
                            {r.classification}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{r.department}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-[#23151D]">
                          {formatPKR(r.currentAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500">{r.percentOfRevenue}%</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{formatPKR(r.priorAmount)}</td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                          {formatPKR(r.varianceAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          {r.growthPercent !== null ? `${r.growthPercent}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px] max-w-xs truncate" title={r.notes}>
                          {r.notes || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {activeViewData && activeViewData.rows.length > 0 && (
                  <tfoot className="bg-slate-50 font-bold text-[#23151D] border-t-2 border-slate-200 text-xs">
                    <tr>
                      <td className="py-2.5 px-3 text-left">
                        {viewMode === 'ACCRUAL' ? 'Net Operating Profit' : 'Collection Cash Surplus'}
                      </td>
                      <td className="py-2.5 px-3">—</td>
                      <td className="py-2.5 px-3">{activeViewData.rows.length} Items</td>
                      <td className={`py-2.5 px-3 text-right ${activeViewData.totals.netProfit < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatPKR(activeViewData.totals.netProfit)}
                      </td>
                      <td className="py-2.5 px-3 text-right">{activeViewData.kpis.operatingMarginPercent}%</td>
                      <td className="py-2.5 px-3 text-right">
                        {formatPKR(activeViewData.kpis.priorOperatingProfit ?? activeViewData.kpis.priorCashSurplus ?? 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {formatPKR(activeViewData.totals.netProfit - (activeViewData.kpis.priorOperatingProfit ?? activeViewData.kpis.priorCashSurplus ?? 0))}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {activeViewData.kpis.profitGrowthPercent !== null
                          ? `${activeViewData.kpis.profitGrowthPercent}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      {/* Footer Branding */}
      <div className="mt-8 text-center text-xs text-slate-400 pb-6">
        © iSysware Management System
      </div>
    </div>
  );
};

export default COGSReportPage;
