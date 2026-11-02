import { BranchActionField } from '@/components/BranchActionField';
import { useBranchAction } from '@/hooks/useBranchAction';
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Calendar, Palmtree, Users, CheckCircle2, AlertCircle, Building2, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { salonService } from '../../services';
import { LeaveRecord, StaffMember, BranchHoliday } from '../../types/salon';
import { evaluateLeaveAllowance } from '../../lib/attendanceCalculations';
import { toast } from '../../context/ToastContext';
import { AccessDeniedView } from '../scaffold/AccessDeniedView';
import { LuxurySelect } from '@/components/ui';

const loadLeaveAction = async (branchId: string) => {
  const [staff, leaves, holidays] = await Promise.all([salonService.getStaff(branchId), salonService.getLeaves(branchId), salonService.getBranchHolidays(branchId)]);
  return { staff, leaves, holidays };
};

export const LeaveManagementPage: React.FC = () => {
  const { user } = useAuth();
  if (!user || !['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return <AccessDeniedView attemptedPath="/operations/leaves" />;
  return <LeaveManagementContent />;
};

const LeaveManagementContent: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();
  const initialDate = demoDate || new Date().toISOString().slice(0, 10);
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [leavesList, setLeavesList] = useState<LeaveRecord[]>([]);
  const [holidaysList, setHolidaysList] = useState<BranchHoliday[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState(activeBranchId);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedMonth, setSelectedMonth] = useState(initialDate.slice(0, 7));
  const [viewMode, setViewMode] = useState<'DAY' | 'MONTH'>('MONTH');
  const [staffFilter, setStaffFilter] = useState('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [allowOverride, setAllowOverride] = useState(false);
  const actionScope = useBranchAction(showLeaveModal, loadLeaveAction);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const effectiveBranchId = user?.role === 'SUPER_ADMIN' ? selectedBranchId : (user?.branchId || activeBranchId);
  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [staff, leaves, holidays] = await Promise.all([
        salonService.getStaff(effectiveBranchId),
        salonService.getLeaves(effectiveBranchId, undefined, user || undefined),
        salonService.getBranchHolidays(effectiveBranchId),
      ]);
      setStaffList(staff); setLeavesList(leaves); setHolidaysList(holidays);
    } catch (error: any) { setLoadError(error.message || 'Failed to load leaves.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, [effectiveBranchId]);
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('ALL');
  const [leaveStatusFilter, setLeaveStatusFilter] = useState('ALL');
  const [leaveToCancel, setLeaveToCancel] = useState<LeaveRecord | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellingLeave, setCancellingLeave] = useState(false);

  const [leaveForm, setLeaveForm] = useState({
    staffId: '',
    startDate: selectedDate,
    endDate: selectedDate,
    type: 'PAID' as 'PAID' | 'UNPAID',
    reason: '',
  });

  const filteredLeaves = useMemo(() => {
    const from = viewMode === 'DAY' ? selectedDate : `${selectedMonth}-01`;
    const to = viewMode === 'DAY' ? selectedDate : `${selectedMonth}-31`;
    return leavesList.filter((leave) => {
      const staff = staffList.find((s) => s.id === leave.staffId);
      if (leave.startDate > to || leave.endDate < from) return false;
      if (staffFilter !== 'ALL' && leave.staffId !== staffFilter) return false;
      if (designationFilter !== 'ALL' && (staff?.designation || staff?.roleTitle) !== designationFilter) return false;
      if (leaveTypeFilter !== 'ALL' && leave.type !== leaveTypeFilter) return false;
      if (leaveStatusFilter !== 'ALL' && leave.status !== leaveStatusFilter) return false;
      const q = searchQuery.toLowerCase().trim();
      return !q || [leave.staffName, leave.employeeCode, staff?.employeeCode].some((value) => value?.toLowerCase().includes(q));
    }).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [leavesList, staffList, viewMode, selectedDate, selectedMonth, staffFilter, designationFilter, leaveTypeFilter, leaveStatusFilter, searchQuery]);

  const leaveKPIs = useMemo(() => {
    const total = filteredLeaves.length;
    const approved = filteredLeaves.filter((l) => l.status === 'APPROVED').length;
    const totalDays = filteredLeaves
      .filter((l) => l.status === 'APPROVED')
      .reduce((sum, l) => sum + (l.totalDays || 1), 0);
    const cancelled = filteredLeaves.filter((l) => l.status === 'CANCELLED').length;
    return { total, approved, totalDays, cancelled };
  }, [filteredLeaves]);

  const handleCancelLeave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!leaveToCancel || !cancellationReason.trim() || cancellingLeave) return;
    setCancellingLeave(true);
    try {
      await salonService.cancelLeave(leaveToCancel.id, cancellationReason.trim(), user || undefined);
      setLeaveToCancel(null);
      setCancellationReason('');
      toast.success('Leave cancelled and attendance updated.');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel leave.');
    } finally {
      setCancellingLeave(false);
    }
  };

  // Handle Mark Leave
  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionScope.validate()) return;
    if (saving) return;
    const selectedStaff = actionScope.data?.staff.find((s) => s.id === leaveForm.staffId);
    if (!selectedStaff) {
      toast.error('Please select an employee.');
      return;
    }
    if (leaveForm.endDate < leaveForm.startDate || !leaveForm.reason.trim()) { toast.error('Enter a valid date range and leave reason.'); return; }
    if (leaveForm.type === 'PAID' && leaveStaffPreview?.isConfigured && leaveStaffPreview.remainingDays <= 0 && !allowOverride) {
      toast.error('Paid leave quota exhausted for this employee. Check "Approve with Admin Override" or switch to Unpaid Leave.');
      return;
    }
    setSaving(true);
    try {
      const bId = selectedStaff.branchId;
      const res = await salonService.markLeave(
        {
          branchId: bId,
          staffId: leaveForm.staffId,
          startDate: leaveForm.startDate,
          endDate: leaveForm.endDate,
          type: leaveForm.type,
          reason: leaveForm.reason,
          allowOverride,
        },
        user || undefined
      );

      toast.success(`Leave ${res.leaveNumber} marked for ${res.staffName} (${res.totalDays} working days).`);
      setShowLeaveModal(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark leave.');
    } finally { setSaving(false); }
  };

  const leaveStaffPreview = useMemo(() => {
    if (!leaveForm.staffId) return null;
    const staff = actionScope.data?.staff.find((s) => s.id === leaveForm.staffId);
    if (!staff) return null;
    return evaluateLeaveAllowance(staff, actionScope.data?.leaves || [], leaveForm.startDate, actionScope.data?.holidays || []);
  }, [leaveForm.staffId, leaveForm.startDate, actionScope.data]);


  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Palmtree className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Employee Leave & Entitlement Management
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Approve vacation vouchers, calculate annual allowances, track active absences and adjustments.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          <button
            onClick={() => {
              setLeaveForm({
                staffId: staffFilter === 'ALL' ? '' : staffFilter,
                startDate: selectedDate,
                endDate: selectedDate,
                type: 'PAID',
                reason: '',
              });
              setAllowOverride(false);
              setShowLeaveModal(true);
            }}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-[#B82E69] hover:bg-[#A02358] text-white text-xs font-semibold shadow-xs cursor-pointer transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Mark Leave</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="p-4 bg-rose-50 text-rose-700 rounded-2xl border border-rose-200 text-xs">
          {loadError}
          <button onClick={loadData} className="ml-3 underline font-semibold">Retry</button>
        </div>
      )}

      {/* KPI Cards Row - Pure White Frosted Glass */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Vouchers */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Palmtree className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Leaves
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {leaveKPIs.total}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Total recorded leave vouchers
            </span>
          </div>
        </div>

        {/* Approved Leaves */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Approved
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {leaveKPIs.approved}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Active validated leave passes
            </span>
          </div>
        </div>

        {/* Cumulative Days */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="bg-[#FAF8F9] text-[#78616C] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Days
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {leaveKPIs.totalDays}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Cumulative approved leave days
            </span>
          </div>
        </div>

        {/* Cancelled / Revoked */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Revoked
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {leaveKPIs.cancelled}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Cancelled or revoked passes
            </span>
          </div>
        </div>
      </div>

      {/* Filter Card */}
      <div className="bg-white/75 backdrop-blur-2xl rounded-[22px] border border-white/90 p-4 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3 items-end">
          {user?.role === 'SUPER_ADMIN' && (
            <LuxurySelect
              label="Branch"
              value={selectedBranchId}
              onValueChange={(val) => {
                setSelectedBranchId(val);
                setStaffFilter('ALL');
                setDesignationFilter('ALL');
              }}
              options={[
                { value: 'ALL', label: 'All branches' },
                ...allBranches.map((b) => ({ value: b.id, label: b.name })),
              ]}
              triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
            />
          )}

          <LuxurySelect
            label="Period Scope"
            value={viewMode}
            onValueChange={(val) => setViewMode(val as 'DAY' | 'MONTH')}
            options={[
              { value: 'MONTH', label: 'Month Scope' },
              { value: 'DAY', label: 'Daily Scope' },
            ]}
            triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
          />

          <div>
            <label className="block text-[11px] font-semibold text-[#78616C] mb-1">
              {viewMode === 'DAY' ? 'Date' : 'Month'}
            </label>
            <input
              type={viewMode === 'DAY' ? 'date' : 'month'}
              value={viewMode === 'DAY' ? selectedDate : selectedMonth}
              onChange={(e) =>
                viewMode === 'DAY' ? setSelectedDate(e.target.value) : setSelectedMonth(e.target.value)
              }
              className="w-full h-9 text-xs border border-white/80 rounded-xl px-3 bg-white/80 text-[#18191B] font-medium transition-colors cursor-pointer shadow-2xs"
            />
          </div>

          <LuxurySelect
            label="Employee"
            value={staffFilter}
            onValueChange={setStaffFilter}
            options={[
              { value: 'ALL', label: 'All employees' },
              ...staffList.map((staff) => ({
                value: staff.id,
                label: `${staff.name} (${staff.employeeCode})`,
              })),
            ]}
            triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
          />

          <LuxurySelect
            label="Designation"
            value={designationFilter}
            onValueChange={setDesignationFilter}
            options={[
              { value: 'ALL', label: 'All designations' },
              ...Array.from(
                new Set(staffList.map((staff) => staff.designation || staff.roleTitle).filter(Boolean))
              ).map((title) => ({ value: title, label: title })),
            ]}
            triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
          />

          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-semibold text-[#78616C] mb-1">Search Filter</label>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Employee name or code..."
              className="w-full h-9 text-xs border border-white/80 rounded-xl px-3 bg-white/80 text-[#18191B] font-medium transition-colors shadow-2xs"
            />
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="p-4 border-b border-rose-100/40 flex flex-wrap items-center justify-between gap-3 bg-[#FAF8F9]/60">
          <div>
            <h2 className="text-sm font-semibold text-[#18191B]">Leave Vouchers Register</h2>
            <p className="text-xs text-[#78616C] mt-0.5">
              {filteredLeaves.length} vouchers recorded in current view scope.
            </p>
          </div>
        </div>

        <div className="p-3.5 flex flex-wrap items-center gap-3 bg-white/40 border-b border-rose-100/30">
          <label className="text-xs font-medium text-[#78616C] flex items-center">
            Leave type:
            <select
              value={leaveTypeFilter}
              onChange={(e) => setLeaveTypeFilter(e.target.value)}
              className="ml-2 border border-white/80 rounded-xl bg-white/90 shadow-2xs px-2.5 py-1 text-xs text-[#18191B] cursor-pointer"
            >
              <option value="ALL">All types</option>
              <option value="PAID">Paid</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </label>
          <label className="text-xs font-medium text-[#78616C] flex items-center">
            Leave status:
            <select
              value={leaveStatusFilter}
              onChange={(e) => setLeaveStatusFilter(e.target.value)}
              className="ml-2 border border-white/80 rounded-xl bg-white/90 shadow-2xs px-2.5 py-1 text-xs text-[#18191B] cursor-pointer"
            >
              <option value="ALL">All statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <button
            onClick={() => {
              setStaffFilter('ALL');
              setDesignationFilter('ALL');
              setSearchQuery('');
              setLeaveTypeFilter('ALL');
              setLeaveStatusFilter('ALL');
            }}
            className="text-xs font-semibold text-[#B82E69] hover:underline cursor-pointer ml-auto"
          >
            Reset Filters
          </button>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="report-records w-full min-w-[1050px] text-left text-xs border-collapse whitespace-nowrap">
            <thead className="bg-[#FAF8F9]/80 text-[#78616C] border-b border-rose-100/40 text-xs font-semibold">
              <tr>
                {['Employee / Voucher', 'Branch', 'Leave period', 'Working days', 'Type', 'Status', 'Reason / Audit', 'Action'].map(
                  (title) => (
                    <th key={title} className="px-4 py-3.5 whitespace-nowrap">
                      {title}
                    </th>
                  )
                )}
              </tr>
            </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  <div className="w-6 h-6 rounded-full border-2 border-[#F1DEE3] border-t-[#9D2558] animate-spin mx-auto mb-2" />
                  Loading leaves...
                </td>
              </tr>
            ) : filteredLeaves.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No leaves match your filters. Choose another day or month, or add a leave.
                </td>
              </tr>
            ) : (
              filteredLeaves.map((leave) => (
                <tr key={leave.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="font-semibold text-slate-900">{leave.staffName}</p>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      {leave.employeeCode || staffList.find((s) => s.id === leave.staffId)?.employeeCode}
                    </p>
                    <p className="font-mono text-[#9D2558] text-[11px] mt-0.5">{leave.leaveNumber}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700 font-medium">
                    {allBranches.find((b) => b.id === leave.branchId)?.name || leave.branchId}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-700">
                    {leave.startDate} to {leave.endDate}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{leave.totalDays}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs font-medium text-slate-700">
                      {leave.type === 'PAID' ? 'Paid Leave' : 'Unpaid Leave'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        leave.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {leave.status === 'APPROVED' ? 'Approved' : 'Cancelled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 min-w-48 max-w-xs whitespace-normal break-words">
                    <p className="text-slate-800">{leave.reason}</p>
                    <p className="text-slate-400 text-[10px] mt-0.5">Recorded by {leave.createdByName}</p>
                    {leave.status === 'CANCELLED' && (
                      <p className="text-rose-600 text-[10px] mt-0.5">
                        {leave.cancellationReason} · {leave.cancelledByName}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {leave.status === 'APPROVED' && (
                      <button
                        onClick={() => {
                          setCancellationReason('');
                          setLeaveToCancel(leave);
                        }}
                        className="px-2.5 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>

      {leaveToCancel && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form onSubmit={handleCancelLeave} role="dialog" aria-modal="true" aria-labelledby="cancel-leave-title" className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 id="cancel-leave-title" className="text-lg font-bold text-slate-900">Cancel leave</h2>
            <p className="text-sm text-slate-500">{leaveToCancel.staffName} · {leaveToCancel.leaveNumber}<br />{leaveToCancel.startDate} to {leaveToCancel.endDate}</p>
            <label className="block text-sm font-medium text-slate-700">Cancellation reason<textarea required value={cancellationReason} onChange={(e) => setCancellationReason(e.target.value)} rows={3} className="block w-full border border-slate-300 rounded-lg p-3 mt-2" /></label>
            <div className="flex justify-end gap-2"><button type="button" disabled={cancellingLeave} onClick={() => setLeaveToCancel(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm">Keep leave</button><button disabled={cancellingLeave || !cancellationReason.trim()} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold disabled:opacity-50">{cancellingLeave ? 'Cancelling...' : 'Cancel leave'}</button></div>
          </form>
        </div>
      )}

      {/* MODAL 3: MARK LEAVE */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Mark Staff Leave</h3>
                <p className="text-xs text-slate-500 mt-0.5">Approve paid or unpaid absence with allowance preview</p>
              </div>
              <button onClick={() => setShowLeaveModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLeaveSubmit} className="p-5 space-y-4">
              <BranchActionField value={actionScope.branchId} onChange={(id) => { actionScope.setBranchId(id); setLeaveForm((prev) => ({ ...prev, staffId: '' })); }} />
              {actionScope.error && <p role="alert" className="text-xs text-rose-600">{actionScope.error}</p>}
              <fieldset disabled={!actionScope.ready} className="space-y-4 disabled:opacity-50">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Employee *</label>
                <select
                  required
                  value={leaveForm.staffId}
                  onChange={(e) => setLeaveForm({ ...leaveForm, staffId: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20 bg-white"
                >
                  <option value="">-- Choose Staff Member --</option>
                  {(actionScope.data?.staff || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.employeeCode})
                    </option>
                  ))}
                </select>
              </div>

              {/* Allowance preview badge */}
              {leaveStaffPreview && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                  <div className="font-semibold text-slate-800 flex items-center justify-between">
                    <span>Leave Entitlement Preview:</span>
                    <span className="text-[10px] text-[#851C47] bg-[#FDF2F5] px-2 py-0.5 rounded border border-[#F1DEE3]">
                      {leaveStaffPreview.period} Policy
                    </span>
                  </div>
                  {leaveStaffPreview.isConfigured ? (
                    <>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div>
                        <span className="text-slate-400 text-[10px]">Allowed:</span>
                        <div className="font-bold text-slate-900">{leaveStaffPreview.allowedDays} days</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">Used:</span>
                        <div className="font-bold text-amber-600">{leaveStaffPreview.usedDays} days</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">Remaining:</span>
                        <div className={`font-bold ${leaveStaffPreview.remainingDays <= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {leaveStaffPreview.remainingDays} days {leaveStaffPreview.remainingDays <= 0 ? '(Exhausted)' : ''}
                        </div>
                      </div>
                    </div>
                    {leaveForm.type === 'PAID' && leaveStaffPreview.remainingDays <= 0 && (
                      <div className="mt-2.5 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1 text-amber-900">
                        <div className="font-semibold text-amber-950 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Leave Quota Exhausted</span>
                        </div>
                        <p className="text-[11px] text-amber-800">
                          Is employee ki {leaveStaffPreview.allowedDays} {leaveStaffPreview.period.toLowerCase()} paid leaves limit khatam ho chuki hai. Super Admin / Admin hone ke nate aap Override ke sath mark kar sakte hain.
                        </p>
                        <label className="flex items-center gap-2 font-semibold text-xs text-amber-950 pt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowOverride}
                            onChange={(e) => setAllowOverride(e.target.checked)}
                            className="rounded text-[#B82E69] focus:ring-[#B82E69]"
                          />
                          <span>Approve with Admin Override (Allow exceeding quota)</span>
                        </label>
                      </div>
                    )}
                    </>
                  ) : (
                    <div className="text-amber-800 font-medium text-xs">
                      Paid leave allowance: <strong>Not configured</strong> (Must use unpaid leave or configure staff profile first).
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date *</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.startDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">End Date *</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs font-medium ${
                      leaveForm.type === 'PAID'
                        ? 'bg-[#FDF2F5] border-[#F8D2DC] text-[#23151D] font-semibold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="leaveType"
                      value="PAID"
                      checked={leaveForm.type === 'PAID'}
                      onChange={() => setLeaveForm({ ...leaveForm, type: 'PAID' })}
                      className="text-[#9D2558]"
                    />
                    <span>Paid Leave (Counted)</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs font-medium ${
                      leaveForm.type === 'UNPAID'
                        ? 'bg-slate-100 border-slate-400 text-slate-900 font-semibold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="leaveType"
                      value="UNPAID"
                      checked={leaveForm.type === 'UNPAID'}
                      onChange={() => setLeaveForm({ ...leaveForm, type: 'UNPAID' })}
                      className="text-slate-600"
                    />
                    <span>Unpaid Leave (No Pay)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Leave *</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Medical emergency, vacation, personal reason..."
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] shadow-xs"
                >
                  {saving ? 'Saving...' : 'Confirm Leave'}
                </button>
              </div>
            
              </fieldset>
</form>
          </div>
        </div>
      )}


    </div>
  );
};
