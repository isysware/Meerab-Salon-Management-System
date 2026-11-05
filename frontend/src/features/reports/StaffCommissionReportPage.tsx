import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import {
  Branch,
  StaffCommissionReport,
  StaffCommissionReportQuery,
  StaffMember,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  Loader2,
  ExternalLink,
  BadgePercent,
} from 'lucide-react';
import {
  DATE_PRESETS,
  DatePreset,
  downloadReportCsv,
  downloadReportExcel,
  printReportWindow,
  resolvePreset,
} from './reportUtils';

const selectClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all cursor-pointer';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

const formatPKR = (amt: number) => {
  const num = Number(amt) || 0;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

export const StaffCommissionReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();
  const { navigate } = useRouter();

  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/reports/staff-commission" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = resolvePreset('THIS_MONTH', businessDate)!;

  // Filter Form State
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    activeBranchId || user.branchId || 'ALL'
  );
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [fromDate, setFromDate] = useState<string>(defaultMonth.from);
  const [toDate, setToDate] = useState<string>(defaultMonth.to);

  // Tab State
  const [tab, setTab] = useState<'STAFF' | 'LINES'>('STAFF');

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<StaffCommissionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load branches
  useEffect(() => {
    if (allBranches && allBranches.length > 0) {
      setBranches(allBranches);
    } else {
      salonService.getBranches().then(setBranches).catch(() => undefined);
    }
  }, [allBranches]);

  // Load staff dynamically when branch selection changes
  useEffect(() => {
    salonService
      .getStaff(selectedBranch || 'ALL')
      .then(setStaffList)
      .catch(() => setStaffList([]));
  }, [selectedBranch]);

  const handlePresetChange = (p: DatePreset) => {
    setPreset(p);
    const r = resolvePreset(p, businessDate);
    if (r) {
      setFromDate(r.from);
      setToDate(r.to);
    }
  };

  const branchName = (id?: string) => {
    if (!id || id === 'ALL') return 'All Branches';
    return branches.find((b) => b.id === id)?.name || id;
  };

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(
    async (q: StaffCommissionReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getStaffCommissionReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Staff Commission report:', err);
        setErrorMessage(
          err.message || 'Failed to fetch live commission report from server.'
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

    const query: StaffCommissionReportQuery = {
      branchId: selectedBranch,
      staffId: selectedStaffId !== 'ALL' ? selectedStaffId : undefined,
      source:
        selectedSource !== 'ALL'
          ? (selectedSource as StaffCommissionReportQuery['source'])
          : undefined,
      invoiceNumber: invoiceNumber.trim() || undefined,
      startDate: fromDate || defaultMonth.from,
      endDate: toDate || defaultMonth.to,
    };

    fetchReport(query);
  };

  // Auto-fetch default monthly date range on mount or when branch changes
  useEffect(() => {
    fetchReport({
      branchId: selectedBranch,
      staffId: selectedStaffId !== 'ALL' ? selectedStaffId : undefined,
      source:
        selectedSource !== 'ALL'
          ? (selectedSource as StaffCommissionReportQuery['source'])
          : undefined,
      invoiceNumber: invoiceNumber.trim() || undefined,
      startDate: fromDate || defaultMonth.from,
      endDate: toDate || defaultMonth.to,
    });
  }, [fetchReport, selectedBranch]);

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData) return;
    const meta: [string, string][] = [
      ['Full Invoice Commission (After Credits)', formatPKR(reportData.totals.fullInvoiceCommission ?? 0)],
      ['Collection-Based Payable (As of End Date)', formatPKR(reportData.totals.collectionBasedPayable ?? 0)],
      ['Remaining Not-Yet-Payable (As of End Date)', formatPKR(reportData.totals.remainingNotYetPayable ?? 0)],
      ['Commission Basis', 'Accounting recognizes full completed-service commission once. Collection payable and remaining not-yet-payable are separate end-date balances, not additional payouts.'],
      ['Invoice Eligible Net Sales (Distinct Period Lines)', formatPKR(reportData.totals.invoiceEligibleNetSales ?? 0)],
      ['Full-Invoice Commission (Reference Only)', formatPKR(reportData.totals.invoiceCommissionReference ?? 0)],
      ['Report', 'Staff Commission Reports'],
      ['Calculation Basis', reportData.dateBasis || 'Actual eligible customer collections; balances include all sources'],
      ['Branch', branchName(selectedBranch)],
      ['From Date', fromDate || '—'],
      ['To Date', toDate || '—'],
      ['Staff Filter', selectedStaffId !== 'ALL' ? staffList.find((s) => s.id === selectedStaffId)?.name || selectedStaffId : 'All Staff'],
      ['Generated By', user.name],
      ['Generated At', new Date().toLocaleString()],
    ];

    const staffHeaders = [
      'Staff',
      'Employee Code',
      'Full Invoice Commission (After Credits)', 'Collection-Based Payable (End Date)', 'Remaining Not-Yet-Payable (End Date)', 'Invoice Eligible Net Sales',
      'Eligible Collected Net Sales',
      'Opening Liability',
      'Collection-Based Earned Commission',
      'Reversed',
      'Net',
      'Paid',
      'Outstanding Earned Commission',
    ];

    const staffRows = [
      ...reportData.byStaff.map((s) => [
        s.staffName,
        s.employeeCode,
        (s.fullInvoiceCommission ?? 0).toFixed(2), (s.collectionBasedPayable ?? 0).toFixed(2), (s.remainingNotYetPayable ?? 0).toFixed(2), (s.invoiceEligibleNetSales ?? 0).toFixed(2),
        s.attributedNetSales.toFixed(2),
        s.openingLiability.toFixed(2),
        s.earned.toFixed(2),
        s.reversed.toFixed(2),
        s.net.toFixed(2),
        s.paid.toFixed(2),
        s.outstanding.toFixed(2),
      ]),
      [
        'TOTALS',
        '',
        (reportData.totals.fullInvoiceCommission ?? 0).toFixed(2), (reportData.totals.collectionBasedPayable ?? 0).toFixed(2), (reportData.totals.remainingNotYetPayable ?? 0).toFixed(2), (reportData.totals.invoiceEligibleNetSales ?? 0).toFixed(2),
        reportData.totals.attributedNetSales.toFixed(2),
        reportData.totals.openingLiability.toFixed(2),
        reportData.totals.earned.toFixed(2),
        reportData.totals.reversed.toFixed(2),
        reportData.totals.net.toFixed(2),
        reportData.totals.paid.toFixed(2),
        reportData.totals.outstanding.toFixed(2),
      ],
    ];

    const linesHeaders = [
      'Date',
      'Staff',
      'Invoice #',
      'Customer',
      'Item',
      'Source',
      'Event Type',
      'Invoice Eligible Net Sales (Original Reference)',
      'Payment Status (Period End)',
      'Eligible Collected Net Sales',
      'Rate %',
      'Collection-Based Earned Commission',
      'Reversed',
      'Net',
      'Run Status', 'Full Invoice Commission (After Credits)', 'Collection-Based Payable (End Date)', 'Remaining Not-Yet-Payable (End Date)',
    ];

    const linesRows = reportData.rows.map((r) => [
      r.date,
      r.staffName,
      r.invoiceNumber,
      r.customer,
      r.itemName,
      r.source,
      r.eventType,
      (r.invoiceEligibleNetSales ?? 0).toFixed(2),
      r.paymentStatus || '',
      r.attributedNetSales.toFixed(2),
      `${r.rateSnapshot}%`,
      r.earned.toFixed(2),
      r.reversed.toFixed(2),
      r.net.toFixed(2),
      r.runStatus, (r.fullInvoiceCommission ?? 0).toFixed(2), (r.collectionBasedPayable ?? 0).toFixed(2), (r.remainingNotYetPayable ?? 0).toFixed(2),
    ]);

    downloadReportExcel(`Staff_Commission_${fromDate}_${toDate}.csv`, meta, [
      { title: 'Summary By Staff', headers: staffHeaders, rows: staffRows },
      { title: 'Commission Detail Events', headers: linesHeaders, rows: linesRows },
    ]);
  };

  const handleExportCsv = () => {
    if (!reportData) return;
    const meta: [string, string][] = [
      ['Full Invoice Commission (After Credits)', formatPKR(reportData.totals.fullInvoiceCommission ?? 0)],
      ['Collection-Based Payable (As of End Date)', formatPKR(reportData.totals.collectionBasedPayable ?? 0)],
      ['Remaining Not-Yet-Payable (As of End Date)', formatPKR(reportData.totals.remainingNotYetPayable ?? 0)],
      ['Commission Basis', 'Accounting recognizes full completed-service commission once. Collection payable and remaining not-yet-payable are separate end-date balances, not additional payouts.'],
      ['Invoice Eligible Net Sales (Distinct Period Lines)', formatPKR(reportData.totals.invoiceEligibleNetSales ?? 0)],
      ['Full-Invoice Commission (Reference Only)', formatPKR(reportData.totals.invoiceCommissionReference ?? 0)],
      ['Report', 'Staff Commission Reports'],
      ['Calculation Basis', reportData.dateBasis || 'Actual eligible customer collections; balances include all sources'],
      ['Branch', branchName(selectedBranch)],
      ['Date Range', `${fromDate} to ${toDate}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const staffHeaders = [
      'Staff',
      'Employee Code',
      'Full Invoice Commission (After Credits)', 'Collection-Based Payable (End Date)', 'Remaining Not-Yet-Payable (End Date)', 'Invoice Eligible Net Sales',
      'Eligible Collected Net Sales',
      'Opening Liability',
      'Collection-Based Earned Commission',
      'Reversed',
      'Net',
      'Paid',
      'Outstanding Earned Commission',
    ];

    const staffRows = [
      ...reportData.byStaff.map((s) => [
        s.staffName,
        s.employeeCode,
        (s.fullInvoiceCommission ?? 0).toFixed(2), (s.collectionBasedPayable ?? 0).toFixed(2), (s.remainingNotYetPayable ?? 0).toFixed(2), (s.invoiceEligibleNetSales ?? 0).toFixed(2),
        s.attributedNetSales.toFixed(2),
        s.openingLiability.toFixed(2),
        s.earned.toFixed(2),
        s.reversed.toFixed(2),
        s.net.toFixed(2),
        s.paid.toFixed(2),
        s.outstanding.toFixed(2),
      ]),
      [
        'TOTALS',
        '',
        (reportData.totals.fullInvoiceCommission ?? 0).toFixed(2), (reportData.totals.collectionBasedPayable ?? 0).toFixed(2), (reportData.totals.remainingNotYetPayable ?? 0).toFixed(2), (reportData.totals.invoiceEligibleNetSales ?? 0).toFixed(2),
        reportData.totals.attributedNetSales.toFixed(2),
        reportData.totals.openingLiability.toFixed(2),
        reportData.totals.earned.toFixed(2),
        reportData.totals.reversed.toFixed(2),
        reportData.totals.net.toFixed(2),
        reportData.totals.paid.toFixed(2),
        reportData.totals.outstanding.toFixed(2),
      ],
    ];

    downloadReportCsv(`Staff_Commission_${fromDate}_${toDate}.csv`, meta, [
      { title: 'By Staff', headers: staffHeaders, rows: staffRows },
      { title: 'Collection Explanation', headers: ['Date', 'Invoice', 'Staff', 'Payment Status (Period End)', 'Invoice Eligible Net Sales (Original Reference)', 'Eligible Collected Net Sales', 'Collection-Based Earned Commission', 'Commission Reversed', 'Full Invoice Commission (After Credits)', 'Collection-Based Payable (End Date)', 'Remaining Not-Yet-Payable (End Date)'],
        rows: reportData.rows.map(r => [r.date, r.invoiceNumber, r.staffName, r.paymentStatus || '', (r.invoiceEligibleNetSales ?? 0).toFixed(2), r.attributedNetSales.toFixed(2), r.earned.toFixed(2), r.reversed.toFixed(2), (r.fullInvoiceCommission ?? 0).toFixed(2), (r.collectionBasedPayable ?? 0).toFixed(2), (r.remainingNotYetPayable ?? 0).toFixed(2)]) },
    ]);
  };

  const handlePrint = () => {
    if (!reportData) return;
    const meta: [string, string][] = [
      ['Full Invoice Commission (After Credits)', formatPKR(reportData.totals.fullInvoiceCommission ?? 0)],
      ['Collection-Based Payable (As of End Date)', formatPKR(reportData.totals.collectionBasedPayable ?? 0)],
      ['Remaining Not-Yet-Payable (As of End Date)', formatPKR(reportData.totals.remainingNotYetPayable ?? 0)],
      ['Commission Basis', 'Accounting recognizes full completed-service commission once. Collection payable and remaining not-yet-payable are separate end-date balances, not additional payouts.'],
      ['Invoice Eligible Net Sales (Distinct Period Lines)', formatPKR(reportData.totals.invoiceEligibleNetSales ?? 0)],
      ['Full-Invoice Commission (Reference Only)', formatPKR(reportData.totals.invoiceCommissionReference ?? 0)],
      ['Branch', branchName(selectedBranch)],
      ['Date Range', `${fromDate} to ${toDate}`],
      ['Generated By', user.name],
    ];

    if (tab === 'STAFF') {
      const headers = [
        'Staff',
        'Code',
        'Full Invoice Commission (After Credits)', 'Collection-Based Payable (End Date)', 'Remaining Not-Yet-Payable (End Date)', 'Invoice Eligible Net Sales',
        'Eligible Collected Net Sales',
        'Opening Liab.',
        'Collection-Based Earned Commission',
        'Reversed',
        'Net',
        'Paid',
        'Outstanding Earned Commission',
      ];
      const rows = reportData.byStaff.map((s) => [
        s.staffName,
        s.employeeCode,
        formatPKR(s.fullInvoiceCommission ?? 0), formatPKR(s.collectionBasedPayable ?? 0), formatPKR(s.remainingNotYetPayable ?? 0), formatPKR(s.invoiceEligibleNetSales ?? 0),
        formatPKR(s.attributedNetSales),
        formatPKR(s.openingLiability),
        formatPKR(s.earned),
        formatPKR(s.reversed),
        formatPKR(s.net),
        formatPKR(s.paid),
        formatPKR(s.outstanding),
      ]);
      const footers = [
        'TOTALS',
        '',
        formatPKR(reportData.totals.fullInvoiceCommission ?? 0), formatPKR(reportData.totals.collectionBasedPayable ?? 0), formatPKR(reportData.totals.remainingNotYetPayable ?? 0), formatPKR(reportData.totals.invoiceEligibleNetSales ?? 0),
        formatPKR(reportData.totals.attributedNetSales),
        formatPKR(reportData.totals.openingLiability),
        formatPKR(reportData.totals.earned),
        formatPKR(reportData.totals.reversed),
        formatPKR(reportData.totals.net),
        formatPKR(reportData.totals.paid),
        formatPKR(reportData.totals.outstanding),
      ];

      printReportWindow({
        title: 'Staff Commission Report (By Staff)',
        subtitle: `Performance & Commission Liability Breakdown`,
        meta,
        headers,
        rows,
        totals: footers,
      });
    } else {
      const headers = [
        'Date',
        'Staff',
        'Invoice',
        'Customer',
        'Item',
        'Invoice Eligible Net Sales (Original Reference)',
        'Payment Status (Period End)',
        'Eligible Collected Net Sales',
        'Rate', 'Full Invoice Commission (After Credits)', 'Collection-Based Payable (End Date)', 'Remaining Not-Yet-Payable (End Date)',
        'Collection-Based Earned Commission',
        'Reversed',
        'Net',
      ];
      const rows = reportData.rows.map((r) => [
        r.date,
        r.staffName,
        r.invoiceNumber,
        r.customer,
        r.itemName,
        formatPKR(r.invoiceEligibleNetSales ?? 0),
        r.paymentStatus || '',
        formatPKR(r.attributedNetSales),
        `${r.rateSnapshot}%`, formatPKR(r.fullInvoiceCommission ?? 0), formatPKR(r.collectionBasedPayable ?? 0), formatPKR(r.remainingNotYetPayable ?? 0),
        formatPKR(r.earned),
        formatPKR(r.reversed),
        formatPKR(r.net),
      ]);

      printReportWindow({
        title: 'Staff Commission Report (Events)',
        subtitle: `Commission Event Logs`,
        meta,
        headers,
        rows,
      });
    }
  };

  const t = reportData?.totals;

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {reportData ? <p className="text-xs text-slate-600">{reportData.dateBasis}</p> : null}
      {/* Top Header Card */}
      <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-6 rounded-[24px] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69]">
            <BadgePercent className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Staff Commission Reports</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Attributed net sales, commission earned, reversals, paid amounts, and outstanding liability.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => navigate('/accounts/commission')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-white/90 bg-white/80 hover:bg-white rounded-xl text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#B82E69]" />
            Open Commission Runs
          </button>
        </div>
      </div>

      {/* Filter Card */}
      <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px]">
        <form onSubmit={handleApplyFilters}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
            {/* Branch */}
            <div>
              <label className={labelClass}>Branch</label>
              <select
                className={selectClass}
                value={selectedBranch}
                onChange={(e) => {
                  setSelectedBranch(e.target.value);
                  setSelectedStaffId('ALL');
                }}
              >
                {isSuperAdmin && <option value="ALL">All Branches</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Staff */}
            <div>
              <label className={labelClass}>Staff</label>
              <select
                className={selectClass}
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
              >
                <option value="ALL">All Staff</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Source */}
            <div>
              <label className={labelClass}>Source</label>
              <select
                className={selectClass}
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
              >
                <option value="ALL">All Sources</option>
                <option value="SERVICE">Service</option>
                <option value="PACKAGE">Package Component</option>
              </select>
            </div>

            {/* Invoice # */}
            <div>
              <label className={labelClass}>Invoice #</label>
              <input
                type="text"
                placeholder="e.g. INV-..."
                className={inputClass}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>

            {/* Date Preset */}
            <div>
              <label className={labelClass}>Date Preset</label>
              <select
                className={selectClass}
                value={preset}
                onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
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
                className={inputClass}
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPreset('CUSTOM');
                }}
              />
            </div>

            {/* To Date */}
            <div>
              <label className={labelClass}>To Date</label>
              <input
                type="date"
                className={inputClass}
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPreset('CUSTOM');
                }}
              />
            </div>

            {/* Filter Button */}
            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-[38px] bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#9D2558] hover:to-[#831F4A] text-white font-semibold text-xs rounded-xl shadow-md shadow-[#B82E69]/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
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
          </div>
        </form>
      </div>

      {/* Main Content Area */}
      {!hasFiltered ? (
        /* Empty State before Filter clicked */
        <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-16 md:p-24 flex flex-col items-center justify-center min-h-[380px] rounded-[24px] text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-rose-100/80 text-[#B82E69] flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Filter className="w-7 h-7 stroke-[1.5]" />
          </div>
          <p className="text-slate-500 text-sm font-semibold">Please apply filters to view commission reports</p>
          <p className="text-slate-400 text-xs mt-1">Select date ranges or staff members above to generate commission records</p>
        </div>
      ) : isLoading ? (
        /* Loading Skeleton */
        <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-16 flex flex-col items-center justify-center min-h-[380px] rounded-[24px] text-center">
          <div className="w-10 h-10 rounded-full border-3 border-rose-100 border-t-[#B82E69] animate-spin mb-3" />
          <p className="text-slate-600 text-sm font-medium">Loading Staff Commission Reports...</p>
        </div>
      ) : errorMessage ? (
        /* Error Message */
        <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-8 rounded-[24px] text-center">
          <p className="text-rose-600 text-sm font-medium mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-5 py-2 bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#9D2558] text-white text-xs font-semibold rounded-xl shadow-sm transition-all cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : (
        /* Filtered Data Layout */
        <div className="space-y-6 mb-8">
          {/* 4 Pure White Frosted KPI Cards */}
          {t && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Eligible Collected Net Sales</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">PKR {formatPKR(t.attributedNetSales)}</p>
                  <p className="text-[11px] text-slate-500">Invoice eligible: PKR {formatPKR(t.invoiceEligibleNetSales ?? 0)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Completed services baseline</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <BadgePercent className="w-5 h-5" />
                </div>
              </div>

              <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gross Commission</p>
                  <p className="text-xl font-bold text-[#B82E69] mt-1 font-mono tabular-nums">PKR {formatPKR(t.earned)}</p>
                  <p className="text-[11px] text-slate-500">Full Invoice Commission: PKR {formatPKR(t.fullInvoiceCommission ?? 0)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Collection-Based Payable: PKR {formatPKR(t.collectionBasedPayable ?? 0)}; Not-Yet-Payable: PKR {formatPKR(t.remainingNotYetPayable ?? 0)}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-[#B82E69] flex items-center justify-center">
                  <BadgePercent className="w-5 h-5" />
                </div>
              </div>

              <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Commission Paid</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1 font-mono tabular-nums">PKR {formatPKR(t.paid)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Disbursed to date</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <BadgePercent className="w-5 h-5" />
                </div>
              </div>

              <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Outstanding Earned Commission</p>
                  <p className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">PKR {formatPKR(t.outstanding)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Pending settlement</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <BadgePercent className="w-5 h-5" />
                </div>
              </div>
            </div>
          )}

          {/* Table Container with Horizontal Scroll */}
          <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] rounded-[24px] overflow-hidden">
            {/* Banner Header */}
            <div className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <BadgePercent className="w-5 h-5 text-white/90" />
                  <span className="font-semibold text-sm tracking-wide">
                    Staff Commission Reports
                  </span>
                </div>
                <div className="flex items-center bg-black/15 p-0.5 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTab('STAFF')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      tab === 'STAFF'
                        ? 'bg-white text-[#B82E69] shadow-xs'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    By Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('LINES')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      tab === 'LINES'
                        ? 'bg-white text-[#B82E69] shadow-xs'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    Commission Events ({reportData?.rows.length ?? 0})
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 backdrop-blur-sm transition-all cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  CSV Export
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 backdrop-blur-sm transition-all cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF Export
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 backdrop-blur-sm transition-all cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              {tab === 'STAFF' ? (
                <table className="report-records w-full min-w-[1100px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF8F9] border-b border-rose-100/60 text-[#B82E69] font-bold text-[11px] uppercase tracking-wider">
                      <th className="py-3.5 px-4">Staff</th>
                      <th className="py-3.5 px-4">Employee Code</th>
                      <th className="py-3.5 px-4 text-right">Eligible Collected Net Sales</th>
                      <th className="py-3.5 px-4 text-right">Opening Liability</th>
                      <th className="py-3.5 px-4 text-right">Collection-Based Earned</th>
                      <th className="py-3.5 px-4 text-right">Reversed</th>
                      <th className="py-3.5 px-4 text-right">Net Commission</th>
                      <th className="py-3.5 px-4 text-right">Paid</th>
                      <th className="py-3.5 px-4 text-right">Outstanding Earned</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 divide-y divide-rose-100/50">
                    {(!reportData || reportData.byStaff.length === 0) ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                          No staff commission records found for the selected criteria.
                        </td>
                      </tr>
                    ) : (
                      reportData.byStaff.map((s) => (
                        <tr key={s.staffId} className="hover:bg-[#B82E69]/[0.02] transition-colors border-b border-dashed border-rose-100/60">
                          <td className="py-3.5 px-4 font-semibold text-slate-900">
                            {s.staffName}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                            {s.employeeCode || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-800">
                            {formatPKR(s.attributedNetSales)}
                            <span className="block text-[10px] text-slate-500">Invoice eligible: {formatPKR(s.invoiceEligibleNetSales ?? 0)}</span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                            {formatPKR(s.openingLiability)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#B82E69]">
                            {formatPKR(s.earned)}
                            <span className="block text-[10px] text-slate-500">Full: {formatPKR(s.fullInvoiceCommission ?? 0)} / Not yet payable: {formatPKR(s.remainingNotYetPayable ?? 0)}</span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-rose-600">
                            {s.reversed ? formatPKR(s.reversed) : '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                            {formatPKR(s.net)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600">
                            {formatPKR(s.paid)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-amber-600">
                            {formatPKR(s.outstanding)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {t && reportData && reportData.byStaff.length > 0 && (
                    <tfoot className="bg-[#FAF8F9] border-t-2 border-rose-200/60 text-xs font-semibold">
                      <tr>
                        <td className="py-3.5 px-4 text-left font-bold text-slate-900 uppercase tracking-wider">Totals</td>
                        <td className="py-3.5 px-4 text-left text-slate-400">—</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">{formatPKR(t.attributedNetSales)}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-700">{formatPKR(t.openingLiability)}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-[#B82E69]">{formatPKR(t.earned)}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-rose-600">{formatPKR(t.reversed)}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">{formatPKR(t.net)}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600">{formatPKR(t.paid)}</td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-amber-600">{formatPKR(t.outstanding)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              ) : (
                <table className="report-records w-full min-w-[1250px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF8F9] border-b border-rose-100/60 text-[#B82E69] font-bold text-[11px] uppercase tracking-wider">
                      <th className="py-3.5 px-4 whitespace-nowrap">Date</th>
                      <th className="py-3.5 px-4">Staff</th>
                      <th className="py-3.5 px-4">Invoice #</th>
                      <th className="py-3.5 px-4">Customer</th>
                      <th className="py-3.5 px-4">Item Name</th>
                      <th className="py-3.5 px-4">Source</th>
                      <th className="py-3.5 px-4 text-right">Attributed Net</th>
                      <th className="py-3.5 px-4 text-right">Rate %</th>
                      <th className="py-3.5 px-4 text-right">Collection-Based Earned</th>
                      <th className="py-3.5 px-4 text-right">Reversed</th>
                      <th className="py-3.5 px-4 text-right">Net</th>
                      <th className="py-3.5 px-4 text-center">Run Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 divide-y divide-rose-100/50">
                    {(!reportData || reportData.rows.length === 0) ? (
                      <tr>
                        <td colSpan={12} className="py-12 text-center text-slate-400 font-medium">
                          No commission events found for the selected criteria.
                        </td>
                      </tr>
                    ) : (
                      reportData.rows.map((r) => {
                        const dateParts = formatDateParts(r.date);
                        return (
                          <tr key={r.eventId} className="hover:bg-[#B82E69]/[0.02] transition-colors border-b border-dashed border-rose-100/60">
                            <td className="py-3.5 px-4 whitespace-nowrap leading-tight">
                              <div className="font-semibold text-slate-800">{dateParts.dayMonth}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{dateParts.year}</div>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-900">
                              {r.staffName}
                            </td>
                            <td className="py-3.5 px-4 text-slate-700 font-medium whitespace-nowrap">
                              <span className="font-semibold text-[#B82E69] font-mono">{r.invoiceNumber}</span>
                              <span className="block text-[10px] text-amber-700">{r.paymentStatus} (period end)</span>
                              {r.eventType === 'REVERSAL' && (
                                <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  REVERSAL
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-700">{r.customer}</td>
                            <td className="py-3.5 px-4 text-slate-800 font-medium">{r.itemName}</td>
                            <td className="py-3.5 px-4 text-slate-500 capitalize">{r.source.toLowerCase()}</td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-800">
                              {formatPKR(r.attributedNetSales)}
                              <span className="block text-[10px] text-slate-500">Invoice eligible: {formatPKR(r.invoiceEligibleNetSales ?? 0)}</span>
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                              {r.rateSnapshot}%
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#B82E69]">
                              {r.earned ? formatPKR(r.earned) : '—'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums text-rose-600">
                              {r.reversed ? formatPKR(r.reversed) : '—'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                              {formatPKR(r.net)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                  r.runStatus === 'IN_RUN'
                                    ? 'bg-rose-50 text-[#B82E69] border-rose-200 shadow-2xs'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {r.runStatus === 'IN_RUN' ? 'In Run' : r.runStatus === 'CALCULATED' ? 'Calculated' : 'Not Run'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffCommissionReportPage;
