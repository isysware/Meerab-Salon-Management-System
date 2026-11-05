import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  AttendanceOvertimeReport,
  AttendanceOvertimeReportRow,
  AttendanceOvertimeReportQuery,
  StaffMember,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  Loader2,
  Clock,
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

export const AttendanceOvertimeReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role guard: Super Admin and Admin only (Accountants denied confidential HR data)
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/reports/attendance" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = resolvePreset('THIS_MONTH', businessDate)!;

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedOtStatus, setSelectedOtStatus] = useState<string>('ALL');
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState<string>(defaultMonth.from);
  const [customTo, setCustomTo] = useState<string>(defaultMonth.to);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<AttendanceOvertimeReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load staff list for filter
  useEffect(() => {
    salonService
      .getStaff(selectedBranch || 'ALL')
      .then(setStaffList)
      .catch(() => setStaffList([]));
  }, [selectedBranch]);

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

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(
    async (q: AttendanceOvertimeReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getAttendanceOvertimeReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Attendance & Overtime report:', err);
        setErrorMessage(
          err.message || 'Failed to fetch live attendance report from server.'
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

    const query: AttendanceOvertimeReportQuery = {
      branchId: selectedBranch,
      staffId: selectedStaffId,
      status: selectedStatus,
      otStatus: selectedOtStatus,
      preset: selectedPreset,
      from: customFrom || undefined,
      to: customTo || undefined,
      search: searchQuery.trim() || undefined,
    };

    fetchReport(query);
  };

  // Auto-fetch default monthly date range on mount or when branch changes
  useEffect(() => {
    fetchReport({
      branchId: selectedBranch,
      staffId: selectedStaffId,
      status: selectedStatus,
      otStatus: selectedOtStatus,
      preset: selectedPreset,
      from: customFrom || undefined,
      to: customTo || undefined,
      search: searchQuery.trim() || undefined,
    });
  }, [fetchReport, selectedBranch]);

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Staff Attendance & Overtime Reports'],
      ['Branch', branchNameDisplay],
      ['From Date', customFrom || reportData.meta.from || '—'],
      ['To Date', customTo || reportData.meta.to || '—'],
      ['Generated By', user.name],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      'Date',
      'Staff Name',
      'Code',
      'Designation',
      'Branch',
      'Shift',
      'Check-In',
      'Check-Out',
      'Scheduled Hours',
      'Worked Hours',
      'Late Minutes',
      'Early Exit Minutes',
      'Status',
      'OT Hours',
      'OT Amount (PKR)',
      'OT Status',
      'Approved By',
      'Notes',
    ];

    const rows = [
      ...reportData.rows.map((r) => [
        r.date,
        r.staffName,
        r.employeeCode,
        r.designation,
        r.branchName,
        r.shift,
        r.checkIn,
        r.checkOut,
        r.scheduledHours,
        r.workedHours,
        r.lateMinutes,
        r.earlyExitMinutes,
        r.status,
        r.otHours,
        r.otAmount.toFixed(2),
        r.otStatus,
        r.otApprovedBy,
        r.notes || r.otReason,
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
        reportData.totals.scheduledHours.toFixed(1),
        reportData.totals.workedHours.toFixed(1),
        '',
        '',
        '',
        reportData.totals.otHours.toFixed(1),
        reportData.totals.otAmount.toFixed(2),
        '',
        '',
        '',
      ],
    ];

    downloadReportExcel(`Attendance_Report_${customFrom}_${customTo}.csv`, meta, [
      { title: 'Attendance & Overtime Records', headers, rows },
    ]);
  };

  const handleExportCsv = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Staff Attendance & Overtime Reports'],
      ['Branch', branchNameDisplay],
      ['Date Range', `${customFrom} to ${customTo}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      'Date',
      'Staff Name',
      'Code',
      'Designation',
      'Branch',
      'Shift',
      'Check-In',
      'Check-Out',
      'Scheduled Hours',
      'Worked Hours',
      'Late Minutes',
      'Early Exit Minutes',
      'Status',
      'OT Hours',
      'OT Amount (PKR)',
      'OT Status',
      'Approved By',
      'Notes',
    ];

    const rows = [
      ...reportData.rows.map((r) => [
        r.date,
        r.staffName,
        r.employeeCode,
        r.designation,
        r.branchName,
        r.shift,
        r.checkIn,
        r.checkOut,
        r.scheduledHours,
        r.workedHours,
        r.lateMinutes,
        r.earlyExitMinutes,
        r.status,
        r.otHours,
        r.otAmount.toFixed(2),
        r.otStatus,
        r.otApprovedBy,
        r.notes || r.otReason,
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
        reportData.totals.scheduledHours.toFixed(1),
        reportData.totals.workedHours.toFixed(1),
        '',
        '',
        '',
        reportData.totals.otHours.toFixed(1),
        reportData.totals.otAmount.toFixed(2),
        '',
        '',
        '',
      ],
    ];

    downloadReportCsv(`Attendance_Report_${customFrom}_${customTo}.csv`, meta, [
      { title: 'Attendance Records', headers, rows },
    ]);
  };

  const handlePrint = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Branch', branchNameDisplay],
      ['Date Range', `${customFrom} to ${customTo}`],
      ['Generated By', user.name],
    ];

    const headers = [
      'Date',
      'Staff Name',
      'Branch',
      'Shift',
      'In / Out',
      'Sched.',
      'Worked',
      'Late/Early',
      'Status',
      'OT Hours',
      'OT Amount',
    ];

    const rows = reportData.rows.map((r) => [
      r.date,
      `${r.staffName} (${r.employeeCode})`,
      r.branchName,
      r.shift,
      `${r.checkIn} - ${r.checkOut}`,
      `${r.scheduledHours}h`,
      `${r.workedHours}h`,
      r.lateMinutes > 0 ? `${r.lateMinutes}m late` : 'On time',
      r.status,
      `${r.otHours}h`,
      formatPKR(r.otAmount),
    ]);

    const footers = [
      'TOTALS',
      '',
      '',
      '',
      '',
      `${reportData.totals.scheduledHours.toFixed(1)}h`,
      `${reportData.totals.workedHours.toFixed(1)}h`,
      '',
      '',
      `${reportData.totals.otHours.toFixed(1)}h`,
      formatPKR(reportData.totals.otAmount),
    ];

    printReportWindow({
      title: 'Staff Attendance & Overtime Report',
      subtitle: `Working Hours, Overtime Audits & Shift Compliance`,
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
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Staff Attendance & Overtime Reports
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  HR Timesheets
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Audit of staff attendance, working hours, punctuality, and overtime costs across branches
              </p>
            </div>
          </div>
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
                value={selectedBranch}
                disabled={!isSuperAdmin}
                onChange={(e) => {
                  setSelectedBranch(e.target.value);
                  setSelectedStaffId('ALL');
                }}
              >
                {isSuperAdmin && <option value="ALL">All Branches</option>}
                {allBranches?.map((b) => (
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

            {/* Attendance Status */}
            <div>
              <label className={labelClass}>Attendance Status</label>
              <select
                className={selectClass}
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="PAID_LEAVE">Paid Leave</option>
                <option value="UNPAID_LEAVE">Unpaid Leave</option>
                <option value="HALF_DAY">Half Day</option>
                <option value="MISSING_PUNCH">Missing Punch</option>
                <option value="OFF_DAY">Off Day</option>
                <option value="HOLIDAY">Holiday</option>
              </select>
            </div>

            {/* OT Status */}
            <div>
              <label className={labelClass}>OT Status</label>
              <select
                className={selectClass}
                value={selectedOtStatus}
                onChange={(e) => setSelectedOtStatus(e.target.value)}
              >
                <option value="ALL">All OT Statuses</option>
                <option value="APPROVED">Approved</option>
                <option value="SUBMITTED">Pending Review</option>
                <option value="REJECTED">Rejected</option>
                <option value="NONE">No Overtime</option>
              </select>
            </div>

            {/* Date Preset */}
            <div>
              <label className={labelClass}>Date Preset</label>
              <select
                className={selectClass}
                value={selectedPreset}
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
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setSelectedPreset('CUSTOM');
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
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setSelectedPreset('CUSTOM');
                }}
              />
            </div>

            {/* Search Query */}
            <div className="md:col-span-4 relative">
              <label className={labelClass}>Search</label>
              <input
                type="text"
                placeholder="Search staff, code, shift, designation..."
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

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR KPI CARDS (when filtered) ── */}
      {hasFiltered && reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Total Records */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <Clock className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Logs
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                {reportData.rows.length}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Total attendance entries
              </span>
            </div>
          </div>

          {/* Card 2: Scheduled Hours */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-purple-600">
                <Clock className="w-4 h-4" />
              </div>
              <span className="bg-purple-50 text-purple-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Scheduled
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                {reportData.totals.scheduledHours.toFixed(1)}h
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Roster planned work hours
              </span>
            </div>
          </div>

          {/* Card 3: Worked Hours */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <Clock className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Actual
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono tabular-nums tracking-tight block">
                {reportData.totals.workedHours.toFixed(1)}h
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Punched recognized shift hours
              </span>
            </div>
          </div>

          {/* Card 4: Overtime Hours */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                <Clock className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Overtime
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono tabular-nums tracking-tight block">
                {reportData.totals.otHours.toFixed(1)}h
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Additional overtime hours logged
              </span>
            </div>
          </div>

          {/* Card 5: Overtime Cost */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Clock className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                OT Expense
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#B82E69] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData.totals.otAmount)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Approved OT payout obligation
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
            Select a branch, status, or date range above, then click &ldquo;Apply Filters&rdquo; to load staff timesheet reports.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-sm animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#B82E69]" />
          </div>
          <p className="text-sm font-bold text-[#18191B]">Loading Attendance & Overtime Reports...</p>
          <p className="text-xs text-[#78616C] mt-0.5">Fetching audited biometric shift records from server</p>
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
              <Clock className="w-4 h-4 text-[#B82E69]" />
              <span>Staff Attendance & Overtime ({reportData?.rows.length ?? 0} records)</span>
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
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Shift</th>
                  <th className="py-3 px-4">In / Out</th>
                  <th className="py-3 px-4 text-right">Sched.</th>
                  <th className="py-3 px-4 text-right">Worked</th>
                  <th className="py-3 px-4">Late / Early</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Overtime</th>
                  <th className="py-3 px-4 text-right">OT Amount</th>
                  <th className="py-3 px-4">Approved By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!reportData || reportData.rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-16 text-center text-slate-400 font-medium">
                      No attendance and overtime records found for the selected criteria.
                    </td>
                  </tr>
                ) : (
                  reportData.rows.map((r, i) => (
                    <tr key={`${r.date}-${r.staffId}-${i}`} className="hover:bg-[#FDF2F5]/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap font-mono">
                        {r.date}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{r.staffName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {r.employeeCode} • {r.designation}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {r.branchName}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                        {r.shift}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                        <span className="text-slate-900 font-semibold">{r.checkIn}</span>
                        <span className="text-slate-400 mx-1">→</span>
                        <span className="text-slate-700">{r.checkOut}</span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 whitespace-nowrap font-mono tabular-nums">
                        {r.scheduledHours}h
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap font-mono tabular-nums">
                        {r.workedHours}h
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-[11px]">
                        {r.lateMinutes > 0 ? (
                          <span className="text-[#B82E69] font-semibold">{r.lateMinutes}m late</span>
                        ) : r.earlyExitMinutes > 0 ? (
                          <span className="text-slate-600 font-semibold">{r.earlyExitMinutes}m early</span>
                        ) : (
                          <span className="text-slate-400">On time</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20">
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {r.otHours > 0 ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60 font-mono">
                            {r.otHours.toFixed(1)}h {r.otStatus}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#B82E69] whitespace-nowrap font-mono tabular-nums">
                        {r.otAmount > 0 ? `PKR ${formatPKR(r.otAmount)}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                        {r.otApprovedBy || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {reportData && reportData.rows.length > 0 && (
                <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs font-bold text-slate-800">
                  <tr>
                    <td className="py-3.5 px-4 text-left">Totals</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">{reportData.rows.length} Records</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                      {reportData.totals.scheduledHours.toFixed(1)}h
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                      {reportData.totals.workedHours.toFixed(1)}h
                    </td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4">—</td>
                    <td className="py-3.5 px-4 text-center font-mono tabular-nums text-amber-600">
                      {reportData.totals.otHours.toFixed(1)}h
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#B82E69]">
                      PKR {formatPKR(reportData.totals.otAmount)}
                    </td>
                    <td className="py-3.5 px-4">—</td>
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

export default AttendanceOvertimeReportPage;
