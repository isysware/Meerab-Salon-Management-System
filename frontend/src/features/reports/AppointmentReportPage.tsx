import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import {
  AppointmentBillingStatus,
  AppointmentReportRecord,
  AppointmentReportSummary,
  AppointmentStatus,
  Branch,
  CustomerSource,
  StaffMember,
} from '@/types/salon';
import { formatCurrency, formatPhoneNumber } from '@/lib/formatters';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  Loader2,
  ExternalLink,
  CalendarCheck,
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
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const inputClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const labelClass = 'block text-[11px] font-semibold text-[#23151D] mb-1.5';

const formatPKR = (amt: number) => {
  const num = Number(amt) || 0;
  return Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const AppointmentReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();
  const { navigate } = useRouter();

  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/reports/appointments" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = resolvePreset('THIS_MONTH', businessDate)!;

  // Filter Form State
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedBillingStatus, setSelectedBillingStatus] = useState<string>('ALL');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState<string>(defaultMonth.from);
  const [endDate, setEndDate] = useState<string>(defaultMonth.to);

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [records, setRecords] = useState<AppointmentReportRecord[]>([]);
  const [summary, setSummary] = useState<AppointmentReportSummary>({
    totalAppointments: 0,
    pendingCount: 0,
    confirmedCount: 0,
    checkedInCount: 0,
    inServiceCount: 0,
    completedCount: 0,
    cancelledCount: 0,
    noShowCount: 0,
    billedCount: 0,
    unbilledCount: 0,
    totalQuotedValue: 0,
    totalActualNetSales: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load auxiliary branches and staff
  useEffect(() => {
    if (allBranches && allBranches.length > 0) {
      setBranches(allBranches);
    } else {
      salonService.getBranches().then(setBranches).catch(() => undefined);
    }
  }, [allBranches]);

  useEffect(() => {
    salonService
      .getStaff(selectedBranchId || 'ALL')
      .then(setStaffList)
      .catch(() => setStaffList([]));
  }, [selectedBranchId]);

  const handlePresetChange = (p: DatePreset) => {
    setPreset(p);
    const r = resolvePreset(p, businessDate);
    if (r) {
      setStartDate(r.from);
      setEndDate(r.to);
    }
  };

  const branchNameDisplay = useMemo(() => {
    if (selectedBranchId === 'ALL') return 'All Branches';
    return branches.find((b) => b.id === selectedBranchId)?.name || selectedBranchId;
  }, [selectedBranchId, branches]);

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await salonService.getAppointmentReport(
        selectedBranchId,
        startDate,
        endDate,
        {
          status: selectedStatus !== 'ALL' ? (selectedStatus as AppointmentStatus) : undefined,
          billingStatus:
            selectedBillingStatus !== 'ALL'
              ? (selectedBillingStatus as AppointmentBillingStatus)
              : undefined,
          staffId: selectedStaffId !== 'ALL' ? selectedStaffId : undefined,
          customerSource: selectedSource !== 'ALL' ? (selectedSource as CustomerSource) : undefined,
          search: searchQuery.trim() || undefined,
        },
        user || undefined
      );

      setRecords(data.records);
      setSummary(data.summary);
    } catch (err: any) {
      console.error('Failed to load Appointment report:', err);
      setErrorMessage(
        err.message || 'Failed to fetch live appointment report from server.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    selectedBranchId,
    startDate,
    endDate,
    selectedStatus,
    selectedBillingStatus,
    selectedStaffId,
    selectedSource,
    searchQuery,
    user,
  ]);

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);
    fetchReport();
  };

  // Auto-fetch default monthly date range on mount or when branch changes
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Export Handlers
  const handleExportExcel = () => {
    if (!records.length) return;
    const meta: [string, string][] = [
      ['Report', 'Appointment Audit Reports'],
      ['Branch', branchNameDisplay],
      ['From Date', startDate || '—'],
      ['To Date', endDate || '—'],
      ['Status Filter', selectedStatus],
      ['Generated By', user.name],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      'Ref #',
      'Scheduled Date',
      'Time',
      'Customer Name',
      'Phone',
      'Branch',
      'Services / Packages',
      'Staff',
      'Status',
      'Billing Status',
      'Quoted Value (PKR)',
      'Linked Invoice #',
      'Invoice Net Sales (PKR)',
      'Invoice Status',
    ];

    const rows = [
      ...records.map((r) => [
        r.appointmentNumber || r.id,
        r.date,
        r.startTime,
        r.clientName,
        r.clientPhone,
        r.branchName || r.branchId,
        r.serviceSummary,
        r.staffSummary,
        r.status,
        r.billingStatus,
        r.quotedPrice.toFixed(2),
        r.linkedInvoiceNumber || '—',
        (r.actualNetSales || 0).toFixed(2),
        r.invoicePaymentStatus || '—',
      ]),
      [
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        summary.totalQuotedValue.toFixed(2),
        '',
        summary.totalActualNetSales.toFixed(2),
        '',
      ],
    ];

    downloadReportExcel(`Appointments_Report_${startDate}_${endDate}.csv`, meta, [
      { title: 'Appointment Records', headers, rows },
    ]);
  };

  const handleExportCsv = () => {
    if (!records.length) return;
    const meta: [string, string][] = [
      ['Report', 'Appointment Audit Reports'],
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      'Ref #',
      'Scheduled Date',
      'Time',
      'Customer Name',
      'Phone',
      'Branch',
      'Services / Packages',
      'Staff',
      'Status',
      'Billing Status',
      'Quoted Value (PKR)',
      'Linked Invoice #',
      'Invoice Net Sales (PKR)',
      'Invoice Status',
    ];

    const rows = [
      ...records.map((r) => [
        r.appointmentNumber || r.id,
        r.date,
        r.startTime,
        r.clientName,
        r.clientPhone,
        r.branchName || r.branchId,
        r.serviceSummary,
        r.staffSummary,
        r.status,
        r.billingStatus,
        r.quotedPrice.toFixed(2),
        r.linkedInvoiceNumber || '—',
        (r.actualNetSales || 0).toFixed(2),
        r.invoicePaymentStatus || '—',
      ]),
      [
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        summary.totalQuotedValue.toFixed(2),
        '',
        summary.totalActualNetSales.toFixed(2),
        '',
      ],
    ];

    downloadReportCsv(`Appointments_Report_${startDate}_${endDate}.csv`, meta, [
      { title: 'Appointment Records', headers, rows },
    ]);
  };

  const handlePrint = () => {
    if (!records.length) return;
    const meta: [string, string][] = [
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Generated By', user.name],
    ];

    const headers = [
      'Date',
      'Ref #',
      'Customer',
      'Branch',
      'Services & Staff',
      'Quoted Value',
      'Status',
      'Billing',
      'Invoice #',
      'Invoice Net',
    ];

    const rows = records.map((r) => [
      r.date,
      r.appointmentNumber || r.id.slice(-6),
      r.clientName,
      r.branchName || r.branchId,
      r.serviceSummary,
      formatPKR(r.quotedPrice),
      r.status,
      r.billingStatus,
      r.linkedInvoiceNumber || '—',
      formatPKR(r.actualNetSales || 0),
    ]);

    const footers = [
      'TOTALS',
      '',
      '',
      '',
      '',
      formatPKR(summary.totalQuotedValue),
      '',
      '',
      '',
      formatPKR(summary.totalActualNetSales),
    ];

    printReportWindow({
      title: 'Appointment Audit Report',
      subtitle: `Scheduled Reservation Audits & Revenue Conversion`,
      meta,
      headers,
      rows,
      totals: footers,
    });
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <CalendarCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Appointment Audit Reports
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  Booking Velocity
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Audit of scheduled reservations, status velocity, estimated booking values & actual POS conversions
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/operations/appointments')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-xs font-semibold text-slate-700 shadow-2xs transition-all cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#B82E69]" />
            <span>Go to Calendar</span>
          </button>
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
            {/* Branch */}
            <div>
              <label className={labelClass}>Branch</label>
              <select
                className={selectClass}
                value={selectedBranchId}
                disabled={!isSuperAdmin}
                onChange={(e) => {
                  setSelectedBranchId(e.target.value);
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

            {/* Status */}
            <div>
              <label className={labelClass}>Status</label>
              <select
                className={selectClass}
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="CHECKED_IN">Checked In</option>
                <option value="IN_SERVICE">In Service</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="NO_SHOW">No-Show</option>
              </select>
            </div>

            {/* Billing State */}
            <div>
              <label className={labelClass}>Billing State</label>
              <select
                className={selectClass}
                value={selectedBillingStatus}
                onChange={(e) => setSelectedBillingStatus(e.target.value)}
              >
                <option value="ALL">All Billing States</option>
                <option value="BILLED">Billed</option>
                <option value="UNBILLED">Unbilled</option>
              </select>
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
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPreset('CUSTOM');
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3.5 items-end">
            {/* To Date */}
            <div>
              <label className={labelClass}>To Date</label>
              <input
                type="date"
                className={inputClass}
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPreset('CUSTOM');
                }}
              />
            </div>

            {/* Search Query */}
            <div className="md:col-span-4 relative">
              <label className={labelClass}>Search</label>
              <input
                type="text"
                placeholder="Search ref #, customer, phone, stylist..."
                className={inputClass}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
          </div>
        </form>
      </div>

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR FINANCIAL KPI CARDS (when filtered) ── */}
      {hasFiltered && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Total Appointments */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Bookings
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                {summary.totalAppointments}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {summary.completedCount} completed · {summary.confirmedCount} confirmed
              </span>
            </div>
          </div>

          {/* Card 2: Quoted Booking Value */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-purple-600">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <span className="bg-purple-50 text-purple-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Quoted
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(summary.totalQuotedValue)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Estimated service reservation value
              </span>
            </div>
          </div>

          {/* Card 3: Converted POS Sales */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Realized
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(summary.totalActualNetSales)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Actual billed sales conversion
              </span>
            </div>
          </div>

          {/* Card 4: Billed Invoices */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Conversion
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#B82E69] font-mono tabular-nums tracking-tight block">
                {summary.totalAppointments > 0 ? ((summary.billedCount / summary.totalAppointments) * 100).toFixed(1) : '0.0'}%
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {summary.billedCount} of {summary.totalAppointments} converted to invoice
              </span>
            </div>
          </div>

          {/* Card 5: No-Shows & Cancellations */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Dropouts
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-rose-600 font-mono tabular-nums tracking-tight block">
                {(summary.noShowCount || 0) + (summary.cancelledCount || 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {summary.noShowCount || 0} no-shows · {summary.cancelledCount || 0} cancelled
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
            Select a branch, status, or date range above, then click &ldquo;Apply Filters&rdquo; to load scheduled appointment audits.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-sm animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#B82E69]" />
          </div>
          <p className="text-sm font-bold text-[#18191B]">Loading Appointment Reports...</p>
          <p className="text-xs text-[#78616C] mt-0.5">Fetching scheduled reservation and invoice conversion data from server</p>
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
          {/* Header Bar */}
          <div className="px-6 py-4 border-b border-white/80 bg-white/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 font-bold text-sm tracking-tight text-[#18191B]">
              <CalendarCheck className="w-4 h-4 text-[#B82E69]" />
              <span>Appointment Audit Log ({records.length} records)</span>
            </div>

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

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="report-records w-full text-left border-collapse min-w-[1100px] text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                  <th className="py-3 px-4">Scheduled Date</th>
                  <th className="py-3 px-4">Ref #</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Services & Staff</th>
                  <th className="py-3 px-4 text-right">Quoted Value</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Billing State</th>
                  <th className="py-3 px-4">Linked Invoice</th>
                  <th className="py-3 px-4 text-right">Invoice Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center text-slate-400 font-medium">
                      No appointments found matching the selected criteria.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FDF2F5]/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap font-mono">
                        {r.date}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-[#B82E69] whitespace-nowrap">
                        {r.appointmentNumber || r.id.slice(-6)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{r.clientName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {formatPhoneNumber(r.clientPhone)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {r.branchName || r.branchId}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-slate-800 truncate" title={r.serviceSummary}>
                          {r.serviceSummary}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate" title={r.staffSummary}>
                          Stylists: {r.staffSummary}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-700 whitespace-nowrap font-mono tabular-nums">
                        PKR {formatPKR(r.quotedPrice)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20">
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.billingStatus === 'BILLED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {r.billingStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-[#B82E69] whitespace-nowrap">
                        {r.linkedInvoiceNumber || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                        {r.actualNetSales ? `PKR ${formatPKR(r.actualNetSales)}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {records.length > 0 && (
                <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs font-bold text-slate-800">
                  <tr>
                    <td className="py-3.5 px-4 text-left">Totals</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">{records.length} Appointments</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#B82E69]">
                      PKR {formatPKR(summary.totalQuotedValue)}
                    </td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                      PKR {formatPKR(summary.totalActualNetSales)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
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

export default AppointmentReportPage;
