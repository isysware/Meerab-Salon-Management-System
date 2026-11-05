import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { Branch, StaffMember, StaffSalaryReport, StaffSalaryReportQuery } from '@/types/salon';
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
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';

const selectClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all cursor-pointer';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

const formatPKR = (amt: number, withSign = false) => {
  const num = Number(amt) || 0;
  const abs = Math.abs(num);
  const hasSubCents = Math.abs(abs * 100 - Math.round(abs * 100)) > 0.0001;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: hasSubCents ? 4 : 2,
  });
  if (withSign) {
    return num >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return formatted;
};

const formatExportNum = (amt: number) => {
  const num = Number(amt) || 0;
  const hasSubCents = Math.abs(num * 100 - Math.round(num * 100)) > 0.0001;
  return hasSubCents ? num.toFixed(4) : num.toFixed(2);
};

export const StaffSalaryReportPage: React.FC = () => {
  const { user, demoDate } = useAuth();

  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/reports/staff-salary" />;
  }

  const thisMonth = (demoDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const yearStart = `${thisMonth.slice(0, 4)}-01`;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (user.branchId || 'ALL') : (user.branchId || '')
  );
  const [selectedStaff, setSelectedStaff] = useState<string>('ALL');
  const [paymentStatus, setPaymentStatus] = useState<string>('ALL');
  const [fromMonth, setFromMonth] = useState<string>(thisMonth);
  const [toMonth, setToMonth] = useState<string>(thisMonth);

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<StaffSalaryReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    salonService.getBranches().then(setBranches).catch(() => undefined);
  }, []);

  useEffect(() => {
    salonService.getStaff(selectedBranch || 'ALL').then(setStaffList).catch(() => setStaffList([]));
  }, [selectedBranch]);

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(
    async (q: StaffSalaryReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getStaffSalaryReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Staff Salary report:', err);
        setErrorMessage(err.message || 'Failed to fetch live staff salary report from server.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: StaffSalaryReportQuery = {
      branchId: selectedBranch,
      fromMonth,
      toMonth,
      staffId: selectedStaff !== 'ALL' ? selectedStaff : undefined,
      paymentStatus: paymentStatus !== 'ALL' ? (paymentStatus as any) : undefined,
    };

    fetchReport(query);
  };

  // Auto-fetch default monthly date range on mount or when branch changes
  useEffect(() => {
    fetchReport({
      branchId: selectedBranch,
      fromMonth,
      toMonth,
      staffId: selectedStaff !== 'ALL' ? selectedStaff : undefined,
      paymentStatus: paymentStatus !== 'ALL' ? (paymentStatus as any) : undefined,
    });
  }, [fetchReport, selectedBranch]);

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Staff Salary Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : branches.find((b) => b.id === selectedBranch)?.name || selectedBranch],
      ['Payroll Period', `${fromMonth} to ${toMonth}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Period',
      'Payslip #',
      'Staff',
      'Code',
      'Branch',
      'Basic',
      'Gross',
      'Net Salary',
      'Paid',
      'Outstanding',
      'Status',
    ];

    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.period,
      r.payslipNumber,
      r.staffName,
      r.employeeCode,
      r.branchName,
      formatExportNum(r.basic),
      formatExportNum(r.gross),
      formatExportNum(r.net),
      formatExportNum(r.paid),
      formatExportNum(r.outstanding),
      r.status,
    ]);

    downloadReportExcel('Staff_Salary_Report', meta, [{ headers, rows }]);
  };

  const handleExportPdf = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Staff Salary Report'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : branches.find((b) => b.id === selectedBranch)?.name || selectedBranch],
      ['Payroll Period', `${fromMonth} to ${toMonth}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Period',
      'Payslip #',
      'Staff',
      'Code',
      'Branch',
      'Basic',
      'Gross',
      'Net Salary',
      'Paid',
      'Outstanding',
      'Status',
    ];

    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.period,
      r.payslipNumber,
      r.staffName,
      r.employeeCode,
      r.branchName,
      formatExportNum(r.basic),
      formatExportNum(r.gross),
      formatExportNum(r.net),
      formatExportNum(r.paid),
      formatExportNum(r.outstanding),
      r.status,
    ]);

    downloadReportCsv('Staff_Salary_Report', meta, [{ headers, rows }]);
  };

  const handlePrint = () => {
    if (!reportData || !reportData.rows.length) {
      window.print();
      return;
    }
    const meta: [string, string][] = [
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : branches.find((b) => b.id === selectedBranch)?.name || selectedBranch],
      ['Payroll Period', `${fromMonth} to ${toMonth}`],
      ['Total Gross', formatPKR(reportData.totals.gross)],
      ['Total Net Salary', formatPKR(reportData.totals.net)],
      ['Total Paid', formatPKR(reportData.totals.paid)],
    ];
    const headers = ['#', 'Period', 'Payslip #', 'Staff', 'Branch', 'Gross', 'Net', 'Paid', 'Outstanding', 'Status'];
    const rows = reportData.rows.map((r, i) => [
      i + 1,
      r.period,
      r.payslipNumber,
      r.staffName,
      r.branchName,
      formatPKR(r.gross),
      formatPKR(r.net),
      formatPKR(r.paid),
      formatPKR(r.outstanding),
      r.status,
    ]);

    printReportWindow({
      title: 'Staff Salary Report',
      meta,
      headers,
      rows,
    });
  };

  const totals = reportData?.totals || {
    basic: 0,
    attendance: 0,
    overtime: 0,
    allowances: 0,
    deductions: 0,
    advanceRecovery: 0,
    gross: 0,
    net: 0,
    paid: 0,
    outstanding: 0,
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* Top Header Banner Card */}
      <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-6 rounded-[24px] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69]">
            <Banknote className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Staff Salary Reports</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Finalized staff remuneration payroll audit: basic wages, attendance penalties, overtime additions, allowances, gross earnings, net pay and payouts
            </p>
          </div>
        </div>
      </div>

      {/* Filter Form Card */}
      <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px]">
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3.5 items-end">
          {/* Branch Filter */}
          <div>
            <label className={labelClass}>Branch</label>
            <select
              value={selectedBranch}
              disabled={!isSuperAdmin}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className={selectClass}
            >
              {isSuperAdmin && <option value="ALL">All Branches</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Staff Filter */}
          <div>
            <label className={labelClass}>Staff Member</label>
            <select
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">All Staff</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.employeeCode})
                </option>
              ))}
            </select>
          </div>

          {/* From Month */}
          <div>
            <label className={labelClass}>From Month</label>
            <input
              type="month"
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* To Month */}
          <div>
            <label className={labelClass}>To Month</label>
            <input
              type="month"
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Payment Status */}
          <div>
            <label className={labelClass}>Status</label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className={selectClass}
            >
              <option value="ALL">All Statuses</option>
              <option value="PAID">Paid</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="FINALIZED">Finalized</option>
            </select>
          </div>

          {/* Filter Action Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-[38px] bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#9D2558] hover:to-[#831F4A] text-white font-semibold text-xs rounded-xl shadow-md shadow-[#B82E69]/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
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
        </form>
      </div>

      {/* Main Content Area */}
      {!hasFiltered ? (
        /* Empty State before Filter clicked */
        <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-16 md:p-24 flex flex-col items-center justify-center min-h-[380px] rounded-[24px] text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-rose-100/80 text-[#B82E69] flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Filter className="w-7 h-7 stroke-[1.5]" />
          </div>
          <p className="text-slate-500 text-sm font-semibold">Please apply filters to view salary reports</p>
          <p className="text-slate-400 text-xs mt-1">Select branch and date range above to load auditable payroll register</p>
        </div>
      ) : isLoading ? (
        /* Loading Skeleton */
        <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-16 flex flex-col items-center justify-center min-h-[380px] rounded-[24px] text-center">
          <div className="w-10 h-10 rounded-full border-3 border-rose-100 border-t-[#B82E69] animate-spin mb-3" />
          <p className="text-slate-600 text-sm font-medium">Loading Staff Salary Reports...</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gross Salary</p>
                <p className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">PKR {formatPKR(totals.gross)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Pre-deduction earnings</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>

            <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Net Salary</p>
                <p className="text-xl font-bold text-[#B82E69] mt-1 font-mono tabular-nums">PKR {formatPKR(totals.net)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Payable after deductions</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-[#B82E69] flex items-center justify-center">
                <Banknote className="w-5 h-5" />
              </div>
            </div>

            <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Disbursed (Paid)</p>
                <p className="text-xl font-bold text-emerald-600 mt-1 font-mono tabular-nums">PKR {formatPKR(totals.paid)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Successfully settled</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-5 rounded-[24px] flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Outstanding</p>
                <p className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">PKR {formatPKR(totals.outstanding)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Pending disbursement</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Table Container with Horizontal Scroll */}
          <div className="border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] rounded-[24px] overflow-hidden">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2.5">
                <Banknote className="w-5 h-5 text-white/90" />
                <span className="font-semibold text-sm tracking-wide">Staff Salary Register</span>
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
                  onClick={handleExportPdf}
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

            <div className="overflow-x-auto">
              <table className="report-records w-full min-w-[1200px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F9] border-b border-rose-100/60 text-[#B82E69] font-bold text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 px-3 text-center w-8">#</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Period</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Payslip #</th>
                    <th className="py-3.5 px-4">Staff</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">Present Days</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">Absent Days</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">Paid Leave</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">Unpaid Leave</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">Holidays</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">Weekly Offs</th>
                    <th className="py-3.5 px-2 text-center whitespace-nowrap">OT Hours</th>
                    <th className="py-3.5 px-4 text-right">Basic</th>
                    <th className="py-3.5 px-4 text-right">Gross</th>
                    <th className="py-3.5 px-4 text-right">Net Salary</th>
                    <th className="py-3.5 px-4 text-right">Paid</th>
                    <th className="py-3.5 px-4 text-right">Outstanding</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 divide-y divide-rose-100/50">
                  {reportData && reportData.rows.length > 0 ? (
                    reportData.rows.map((row, idx) => {
                      const isPaid = row.status === 'PAID';

                      return (
                        <tr key={row.payslipId || idx} className="hover:bg-[#B82E69]/[0.02] transition-colors border-b border-dashed border-rose-100/60">
                          {/* 1. # */}
                          <td className="py-3.5 px-3 text-center font-normal text-slate-400">
                            {idx + 1}
                          </td>

                          {/* 2. Period */}
                          <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-700">
                            {row.period}
                          </td>

                          {/* 3. Payslip # */}
                          <td className="py-3.5 px-4 font-semibold text-[#B82E69] whitespace-nowrap font-mono">
                            {row.payslipNumber}
                          </td>

                          {/* 4. Staff */}
                          <td className="py-3.5 px-4 whitespace-nowrap font-semibold text-slate-900">
                            {row.staffName} <span className="text-slate-400 font-mono text-[11px]">({row.employeeCode})</span>
                          </td>

                          {/* 5. Branch */}
                          <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                            {row.branchName || 'Main Branch'}
                          </td>

                          {/* Present Days */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-slate-700 whitespace-nowrap">
                            {row.presentDays ?? 0}
                            {row.workedWeeklyOffDays ? (
                              <span className="block text-[9px] text-indigo-600 font-normal">
                                +{row.workedWeeklyOffDays} off-work
                              </span>
                            ) : null}
                          </td>

                          {/* Absent Days */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-rose-600 whitespace-nowrap">
                            {row.absentDays ?? 0}
                          </td>

                          {/* Paid Leave */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-emerald-600 whitespace-nowrap">
                            {row.paidLeaveDays ?? 0}
                          </td>

                          {/* Unpaid Leave */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-amber-600 whitespace-nowrap">
                            {row.unpaidLeaveDays ?? 0}
                          </td>

                          {/* Holidays */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-purple-600 whitespace-nowrap">
                            {row.holidayDays ?? row.paidHolidayDays ?? 0}
                          </td>

                          {/* Weekly Offs */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-blue-600 whitespace-nowrap">
                            {row.weeklyOffDays ?? row.paidWeeklyOffDays ?? 0}
                          </td>

                          {/* Overtime Hours */}
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-indigo-700 whitespace-nowrap">
                            {row.overtimeHours ? `${row.overtimeHours.toFixed(1)}h` : '0h'}
                          </td>

                          {/* Basic */}
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {formatPKR(row.basic)}
                          </td>

                          {/* 7. Gross */}
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                            {formatPKR(row.gross)}
                          </td>

                          {/* 8. Net Salary */}
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-[#B82E69] whitespace-nowrap">
                            {formatPKR(row.net)}
                          </td>

                          {/* 9. Paid */}
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600 whitespace-nowrap">
                            {formatPKR(row.paid)}
                          </td>

                          {/* 10. Outstanding */}
                          <td
                            className={`py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                              row.outstanding > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'
                            }`}
                          >
                            {formatPKR(row.outstanding)}
                          </td>

                          {/* 11. Status */}
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            {isPaid ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                                PAID
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
                                {row.status}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={18} className="py-12 text-center text-slate-400 font-medium">
                        No salary records found for the selected branch, dates, and filters.
                      </td>
                    </tr>
                  )}
                </tbody>

                {/* Integrated Table Footer */}
                <tfoot className="bg-[#FAF8F9] border-t-2 border-rose-200/60 text-xs text-slate-800 font-semibold">
                  {/* Row 1: TOTALS (PKR) */}
                  <tr className="border-b border-rose-100/60">
                    <td colSpan={5} className="py-3.5 px-4 text-right font-bold text-slate-800 tracking-wide">
                      TOTAL SALARIES (PKR)
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-700">
                      {formatPKR(totals.basic)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-800">
                      {formatPKR(totals.gross)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-[#B82E69]">
                      {formatPKR(totals.net)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600">
                      {formatPKR(totals.paid)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-amber-600">
                      {formatPKR(totals.outstanding)}
                    </td>
                    <td className="py-3.5 px-4"></td>
                  </tr>

                  {/* Row 2: Net Disbursed */}
                  <tr>
                    <td colSpan={5} className="py-3 px-4 text-right font-medium text-slate-500">
                      Net Paid Salary Disbursements
                    </td>
                    <td colSpan={6} className="py-3 px-4 text-right font-mono tabular-nums font-bold text-[#B82E69] text-sm">
                      +{formatPKR(totals.paid)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffSalaryReportPage;
