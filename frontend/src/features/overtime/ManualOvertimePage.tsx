import { BranchActionField } from '@/components/BranchActionField';
import { useBranchAction } from '@/hooks/useBranchAction';
import { LuxurySelect } from '@/components/ui/LuxurySelect';
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { salonService } from '../../services';
import { OvertimeRecord, StaffMember, OvertimeStatus } from '../../types/salon';
import {
  Timer,
  Clock,
  Plus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileSpreadsheet,
  Printer,
  Search,
  Filter,
  Ban,
  Edit,
  X,
  UserCheck,
  TrendingUp,
  Info,
  Calendar,
} from 'lucide-react';
import { roundCurrency } from '../../lib/taxCalculations';
import { formatCurrency } from '@/lib/formatters';
import { AccessDeniedView } from '../scaffold/AccessDeniedView';
import { toast } from '../../context/ToastContext';

const loadOvertimeAction = async (branchId: string) => ({ staff: await salonService.getStaff(branchId) });

export const ManualOvertimePage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role guard: Super Admin and Admin only (Accountant and Staff denied)
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/operations/manual-overtime" />;
  }

  const todayStr = demoDate || new Date().toISOString().slice(0, 10);
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;

  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [overtimeList, setOvertimeList] = useState<OvertimeRecord[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Filters
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId);
  const [startDate, setStartDate] = useState<string>(monthStartStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const effectiveBranchId = user?.role === 'SUPER_ADMIN' ? selectedBranchId : (user?.branchId || activeBranchId);

  // Modals
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const actionScope = useBranchAction(showAddModal, loadOvertimeAction, effectiveBranchId);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showApproveModal, setShowApproveModal] = useState<boolean>(false);
  const [showRejectModal, setShowRejectModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  // Active record
  const [activeRecord, setActiveRecord] = useState<OvertimeRecord | null>(null);

  // Form states
  const [addForm, setAddForm] = useState({
    staffId: '',
    date: todayStr,
    minutes: 60,
    reason: '',
    notes: '',
    status: 'SUBMITTED' as 'DRAFT' | 'SUBMITTED',
    isIntentionalAdditional: false,
  });

  const [editForm, setEditForm] = useState({
    minutes: 60,
    reason: '',
    notes: '',
  });

  const [reasonForm, setReasonForm] = useState({
    reason: '',
  });

  // Load data
  const loadData = async () => {
    try {
      setLoading(true);
      const [sysDate, allStaff, ots] = await Promise.all([
        salonService.getSystemDate(),
        salonService.getStaff(effectiveBranchId),
        salonService.getOvertime(effectiveBranchId, undefined, user || undefined),
      ]);

      setStaffList(allStaff);
      setOvertimeList(ots);

      if (!addForm.date) {
        setAddForm((prev) => ({ ...prev, date: sysDate }));
      }
    } catch (err: any) {
      console.warn('Initial overtime records load warning:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [effectiveBranchId]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return overtimeList.filter((ot) => {
      if (ot.date < startDate || ot.date > endDate) return false;
      if (staffFilter !== 'ALL' && ot.staffId !== staffFilter) return false;
      if (statusFilter !== 'ALL' && ot.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = ot.staffName.toLowerCase().includes(q);
        const matchesCode = (ot.employeeCode || '').toLowerCase().includes(q);
        const matchesVoucher = (ot.overtimeNumber || '').toLowerCase().includes(q);
        const matchesReason = (ot.reason || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesVoucher && !matchesReason) return false;
      }
      return true;
    });
  }, [overtimeList, startDate, endDate, staffFilter, statusFilter, searchQuery]);

  // Summary KPIs
  const summaryKpis = useMemo(() => {
    let totalEnteredMinutes = 0;
    let totalApprovedMinutes = 0;
    let totalApprovedAmount = 0;
    let pendingCount = 0;

    for (const ot of filteredRecords) {
      totalEnteredMinutes += ot.minutes || 0;
      if (ot.status === 'APPROVED') {
        totalApprovedMinutes += ot.approvedMinutes || 0;
        totalApprovedAmount += ot.amount || 0;
      } else if (ot.status === 'SUBMITTED' || ot.status === 'DRAFT') {
        pendingCount++;
      }
    }

    return {
      totalEnteredMinutes,
      totalApprovedMinutes,
      totalApprovedAmount: roundCurrency(totalApprovedAmount),
      pendingCount,
    };
  }, [filteredRecords]);

  const availableStaff = useMemo(() => {
    if (actionScope.branchId && actionScope.data?.staff) {
      return actionScope.data.staff;
    }
    if (actionScope.branchId) {
      return staffList.filter((s) => s.branchId === actionScope.branchId);
    }
    return user?.role === 'SUPER_ADMIN' ? [] : staffList;
  }, [actionScope.branchId, actionScope.data?.staff, staffList, user?.role]);

  // Auto-select staff member if only one is available
  useEffect(() => {
    if (showAddModal && actionScope.ready && !addForm.staffId && availableStaff.length === 1) {
      setAddForm((prev) => ({ ...prev, staffId: availableStaff[0].id }));
    }
  }, [showAddModal, actionScope.ready, availableStaff, addForm.staffId]);

  // Add form effective hourly rate & amount preview
  const addFormPreview = useMemo(() => {
    if (!addForm.staffId) return null;
    const staff = availableStaff.find((s) => s.id === addForm.staffId);
    if (!staff) return null;
    const rate = Number(staff.overtimeHourlyRate ?? 0);
    const hours = (addForm.minutes || 0) / 60;
    const estimatedAmount = roundCurrency(hours * rate);
    return {
      rate,
      hours: hours.toFixed(2),
      estimatedAmount,
    };
  }, [addForm.staffId, addForm.minutes, availableStaff]);

  // Handle Add Overtime
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionScope.validate()) return;
    if (!addForm.staffId) {
      toast.error('Please select an employee.');
      return;
    }
    if (!Number.isInteger(Number(addForm.minutes)) || Number(addForm.minutes) <= 0) {
      toast.error('Overtime minutes must be a positive whole number.');
      return;
    }
    if (!addForm.reason || !addForm.reason.trim()) {
      toast.error('Please enter a reason for the overtime.');
      return;
    }

    try {
      const selectedStaff = availableStaff.find((s) => s.id === addForm.staffId);
      if (!selectedStaff) {
        toast.error('Please select an employee in this branch.');
        return;
      }
      const bId = actionScope.branchId || selectedStaff.branchId;
      if (!bId || bId === 'ALL') {
        toast.error('Please select a specific branch.');
        return;
      }
      const notes = addForm.isIntentionalAdditional
        ? `${addForm.notes ? addForm.notes + ' | ' : ''}INTENTIONAL_ADDITIONAL`
        : (addForm.notes || undefined);

      const res = await salonService.createOvertime(
        {
          branchId: bId,
          staffId: addForm.staffId,
          date: addForm.date,
          minutes: Number(addForm.minutes),
          reason: addForm.reason.trim(),
          notes,
          status: addForm.status,
        },
        user || undefined
      );

      const msg = `Overtime record ${res.overtimeNumber || ''} created for ${res.staffName} (${res.minutes} mins).`;
      toast.success(msg);
      setShowAddModal(false);
      setAddForm({
        staffId: '',
        date: addForm.date,
        minutes: 60,
        reason: '',
        notes: '',
        status: 'SUBMITTED',
        isIntentionalAdditional: false,
      });
      loadData();
    } catch (err: any) {
      let errMsg = err.message || 'Failed to create overtime.';
      if (err.code === 'OVERTIME_EXISTS' || errMsg.includes('already exists')) {
        errMsg = `${errMsg} (Tip: Check "Explicit intentional additional overtime" if this is a second entry for the same day)`;
      }
      toast.error(errMsg);
    }
  };

  // Open Edit Modal
  const openEditModal = (rec: OvertimeRecord) => {
    setActiveRecord(rec);
    setEditForm({
      minutes: rec.minutes || 0,
      reason: rec.reason || '',
      notes: rec.notes || '',
    });
    setShowEditModal(true);
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRecord) return;
    try {
      await salonService.updateOvertime(
        activeRecord.id,
        {
          minutes: Number(editForm.minutes),
          reason: editForm.reason,
          notes: editForm.notes,
        },
        user || undefined
      );

      const msg = `Overtime record ${activeRecord.overtimeNumber || ''} updated.`;
      toast.success(msg);
      setShowEditModal(false);
      loadData();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to update overtime.';
      toast.error(errMsg);
    }
  };

  // Handle Approve
  const handleApprove = async () => {
    if (!activeRecord) return;
    try {
      const res = await salonService.approveOvertime(activeRecord.id, user || undefined);
      const msg = `Overtime record ${res.overtimeNumber || ''} approved: ${res.approvedMinutes} mins @ Rs. ${res.hourlyRate}/hr = Rs. ${(res.amount ?? 0).toLocaleString()}.`;
      toast.success(msg);
      setShowApproveModal(false);
      loadData();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to approve overtime.';
      toast.error(errMsg);
    }
  };

  // Handle Reject
  const handleReject = async () => {
    if (!activeRecord) return;
    if (!reasonForm.reason.trim()) {
      toast.error('A rejection reason is required.');
      return;
    }
    try {
      const res = await salonService.rejectOvertime(activeRecord.id, reasonForm.reason, user || undefined);
      const msg = `Overtime record ${res.overtimeNumber || ''} rejected.`;
      toast.success(msg);
      setShowRejectModal(false);
      setReasonForm({ reason: '' });
      loadData();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to reject overtime.';
      toast.error(errMsg);
    }
  };

  // Handle Cancel
  const handleCancel = async () => {
    if (!activeRecord) return;
    if (!reasonForm.reason.trim()) {
      toast.error('A cancellation reason is required.');
      return;
    }
    try {
      const res = await salonService.cancelOvertime(activeRecord.id, reasonForm.reason, user || undefined);
      const msg = `Overtime record ${res.overtimeNumber || ''} cancelled.`;
      toast.success(msg);
      setShowCancelModal(false);
      setReasonForm({ reason: '' });
      loadData();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to cancel overtime.';
      toast.error(errMsg);
    }
  };

  // Export Filtered CSV
  const handleExportCsv = () => {
    const headers = [
      'Voucher #',
      'Work Date',
      'Employee Code',
      'Employee Name',
      'Entered Minutes',
      'Approved Minutes',
      'Hourly Rate (PKR)',
      'Approved Amount (PKR)',
      'Status',
      'Reason',
      'Entered By',
      'Approved By',
    ];

    const rows = filteredRecords.map((r) => [
      `"${r.overtimeNumber || r.id}"`,
      `"${r.date}"`,
      `"${r.employeeCode || ''}"`,
      `"${r.staffName}"`,
      r.minutes || 0,
      r.approvedMinutes || 0,
      r.hourlyRate || 0,
      r.amount || 0,
      `"${r.status || 'DRAFT'}"`,
      `"${(r.reason || '').replace(/"/g, '""')}"`,
      `"${r.enteredByName || ''}"`,
      `"${r.approvedByName || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Manual_Overtime_Audit_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Timer className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Manual Overtime Management
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Manual overtime minute logging, snapshotted hourly rates, and payroll review queue.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          <button
            onClick={handleExportCsv}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 shadow-2xs transition-all cursor-pointer"
            title="Export CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setShowPrintModal(true)}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 shadow-2xs transition-all cursor-pointer"
            title="Print Overtime Audit"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print Report</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-[#B82E69] hover:bg-[#A02358] text-white text-xs font-semibold shadow-xs cursor-pointer transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Overtime Entry</span>
          </button>
        </div>
      </div>

      {/* SUMMARY KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Entered Minutes */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Clock className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Entered
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {summaryKpis.totalEnteredMinutes.toLocaleString()} <span className="text-xs font-semibold text-[#78616C]">mins</span>
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              ≈ {((summaryKpis.totalEnteredMinutes || 0) / 60).toFixed(1)} submitted hours
            </span>
          </div>
        </div>

        {/* Approved Minutes */}
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
              {summaryKpis.totalApprovedMinutes.toLocaleString()} <span className="text-xs font-semibold text-[#78616C]">mins</span>
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              ≈ {((summaryKpis.totalApprovedMinutes || 0) / 60).toFixed(1)} verified hours
            </span>
          </div>
        </div>

        {/* Approved Amount */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="bg-[#FAF8F9] text-[#78616C] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Payable
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {formatCurrency(summaryKpis.totalApprovedAmount)}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Payable in upcoming payroll
            </span>
          </div>
        </div>

        {/* Pending Review */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
              <Timer className="w-4 h-4" />
            </div>
            <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Pending
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {summaryKpis.pendingCount}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Awaiting manager signoff
            </span>
          </div>
        </div>
      </div>

      {/* FILTERS BAR */}
      <div className="bg-white/75 backdrop-blur-2xl p-4 rounded-[22px] border border-white/90 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[#78616C]">
              <span className="font-medium">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-white/80 rounded-xl bg-white/80 text-[#18191B] font-medium shadow-2xs cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#78616C]">
              <span className="font-medium">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-white/80 rounded-xl bg-white/80 text-[#18191B] font-medium shadow-2xs cursor-pointer"
              />
            </div>
          </div>

          {user?.role === 'SUPER_ADMIN' && (
            <div className="flex items-center gap-1.5 text-xs min-w-[170px]">
              <span className="font-medium text-[#78616C]">Branch:</span>
              <div className="flex-1">
                <LuxurySelect
                  value={selectedBranchId}
                  onValueChange={setSelectedBranchId}
                  options={[
                    { value: 'ALL', label: 'All Branches' },
                    ...allBranches.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                  placeholder="All Branches"
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-rose-100/40">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search voucher, staff, reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-white/80 rounded-xl bg-white/80 text-[#18191B] font-medium shadow-2xs"
            />
          </div>

          <LuxurySelect
            value={staffFilter}
            onValueChange={setStaffFilter}
            options={[
              { value: 'ALL', label: 'All Employees' },
              ...staffList.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.employeeCode})`,
              })),
            ]}
            placeholder="All Employees"
          />

          <LuxurySelect
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'SUBMITTED', label: 'Submitted (Pending)' },
              { value: 'DRAFT', label: 'Draft' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            placeholder="All Statuses"
          />
        </div>
      </div>

      {/* OVERTIME TABLE */}
      <div className="overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="overflow-x-auto">
          <table className="report-records w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#FAF8F9]/80 border-b border-rose-100/40 text-[11px] font-semibold text-[#78616C] uppercase tracking-wider">
                <th className="py-3 px-4">Voucher & Date</th>
                <th className="py-3 px-3">Employee</th>
                <th className="py-3 px-3">Minutes (Hours)</th>
                <th className="py-3 px-3">Hourly Rate</th>
                <th className="py-3 px-3">Amount</th>
                <th className="py-3 px-3">Reason & Notes</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Audit Trails</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded-full border-2 border-[#F1DEE3] border-t-[#9D2558] animate-spin shrink-0" />
                      <span>Loading overtime records...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Timer className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-semibold text-slate-600">No overtime entries found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      No records match the selected date range or status filters.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => {
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Voucher & Date */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-[#851C47]">
                          {rec.overtimeNumber || rec.id}
                        </div>
                        <div className="text-[11px] text-slate-400">{rec.date}</div>
                      </td>

                      {/* Employee */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{rec.staffName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {rec.employeeCode || 'N/A'}
                        </div>
                      </td>

                      {/* Minutes */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-900">
                          {rec.status === 'APPROVED' ? rec.approvedMinutes : rec.minutes} mins
                        </span>
                        <span className="text-[11px] text-slate-400 block">
                          ≈ {(((rec.status === 'APPROVED' ? rec.approvedMinutes : rec.minutes) || 0) / 60).toFixed(1)}h
                        </span>
                      </td>

                      {/* Hourly Rate */}
                      <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-700">
                        Rs. {(rec.hourlyRate ?? 0).toLocaleString()}/hr
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            rec.status === 'APPROVED' ? 'text-[#851C47]' : 'text-slate-400'
                          }`}
                        >
                          Rs. {(rec.amount || 0).toLocaleString()}
                        </span>
                        {rec.status !== 'APPROVED' && (
                          <span className="text-[10px] text-slate-400 block font-normal">(Estimated)</span>
                        )}
                      </td>

                      {/* Reason & Notes */}
                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-medium text-slate-800 line-clamp-1">{rec.reason}</div>
                        {rec.notes && <div className="text-[11px] text-slate-400 line-clamp-1">{rec.notes}</div>}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {rec.status === 'APPROVED' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Approved
                          </span>
                        ) : rec.status === 'SUBMITTED' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Submitted
                          </span>
                        ) : rec.status === 'DRAFT' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            Draft
                          </span>
                        ) : rec.status === 'REJECTED' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                            Rejected
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                            Cancelled
                          </span>
                        )}
                        {rec.payrollId && (
                          <span className="block mt-0.5 text-[9px] font-bold text-purple-700 bg-purple-50 px-1 rounded border border-purple-200">
                            Payroll Locked
                          </span>
                        )}
                      </td>

                      {/* Audit Trails */}
                      <td className="py-3 px-3 whitespace-nowrap text-[11px] text-slate-500">
                        <div>
                          <strong>Entered:</strong> {rec.enteredByName || 'Admin'}
                        </div>
                        {rec.approvedByName && (
                          <div className="text-emerald-700">
                            <strong>Approved:</strong> {rec.approvedByName}
                          </div>
                        )}
                        {rec.rejectedByName && (
                          <div className="text-rose-600">
                            <strong>Rejected:</strong> {rec.rejectedByName}
                          </div>
                        )}
                        {rec.cancelledByName && (
                          <div className="text-slate-400">
                            <strong>Cancelled:</strong> {rec.cancelledByName}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                        {rec.status === 'SUBMITTED' || rec.status === 'DRAFT' ? (
                          <>
                            <button
                              onClick={() => {
                                setActiveRecord(rec);
                                setShowApproveModal(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Approve
                            </button>

                            <button
                              onClick={() => {
                                setActiveRecord(rec);
                                setShowRejectModal(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
                            >
                              <XCircle className="w-3 h-3" />
                              Reject
                            </button>

                            <button
                              onClick={() => openEditModal(rec)}
                              className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                              title="Edit draft entry"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : rec.status === 'APPROVED' ? (
                          <button
                            disabled={!!rec.payrollId}
                            onClick={() => {
                              setActiveRecord(rec);
                              setShowCancelModal(true);
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${
                              rec.payrollId
                                ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                                : 'text-slate-600 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 border border-slate-200'
                            }`}
                            title={rec.payrollId ? 'Locked: Overtime already linked to finalized payroll' : 'Cancel approved overtime'}
                          >
                            <Ban className="w-3 h-3" />
                            Cancel
                          </button>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: ADD MANUAL OVERTIME */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Log Manual Overtime</h3>
                <p className="text-xs text-slate-500 mt-0.5">Submit verified employee overtime minutes for review</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-5 space-y-4">
              <BranchActionField
                value={actionScope.branchId}
                onChange={(id) => {
                  actionScope.setBranchId(id);
                  setAddForm((prev) => ({ ...prev, staffId: '' }));
                }}
              />
              {actionScope.error && <p role="alert" className="text-xs text-rose-600">{actionScope.error}</p>}
              {user?.role === 'SUPER_ADMIN' && !actionScope.branchId && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200/80 rounded-xl p-2.5">
                  Please select a branch above to view and select employees.
                </p>
              )}
              <fieldset disabled={!actionScope.ready} className="space-y-4 disabled:opacity-50">
                <LuxurySelect
                  label="Select Employee *"
                  value={addForm.staffId}
                  onValueChange={(val) => setAddForm({ ...addForm, staffId: val })}
                  options={[
                    {
                      value: '',
                      label: !actionScope.ready
                        ? '-- Select a branch first --'
                        : availableStaff.length === 0
                        ? '-- No employees found in this branch --'
                        : '-- Choose Staff Member --',
                    },
                    ...availableStaff.map((s) => ({
                      value: s.id,
                      label: `${s.name} (${s.employeeCode}) • Rate: Rs. ${(s.overtimeHourlyRate ?? 0).toLocaleString()}/hr`,
                    })),
                  ]}
                  placeholder="-- Choose Staff Member --"
                  contentClassName="z-[100]"
                />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Work Date *</label>
                  <input
                    type="date"
                    required
                    value={addForm.date}
                    onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Overtime Minutes *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    placeholder="e.g. 60"
                    value={addForm.minutes}
                    onChange={(e) => setAddForm({ ...addForm, minutes: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                  />
                </div>
              </div>

              {/* Rate & Amount Preview */}
              {addFormPreview && (
                <div className="p-3 bg-[#FDF2F5]/70 rounded-xl border border-[#F1DEE3] flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500">Effective Rate:</span>
                    <span className="font-semibold text-slate-800 ml-1">
                      Rs. {addFormPreview.rate.toLocaleString()}/hr
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Calculated Payout:</span>
                    <span className="font-bold text-[#851C47] ml-1">
                      Rs. {addFormPreview.estimatedAmount.toLocaleString()} ({addFormPreview.hours}h)
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Overtime *</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Extended bridal trial session, late client service, weekend rush coverage..."
                  value={addForm.reason}
                  onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Internal Notes</label>
                <input
                  type="text"
                  placeholder="Optional manager notes..."
                  value={addForm.notes}
                  onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="intentionalAdditional"
                  checked={addForm.isIntentionalAdditional}
                  onChange={(e) => setAddForm({ ...addForm, isIntentionalAdditional: e.target.checked })}
                  className="rounded border-slate-300 text-[#9D2558] focus:ring-[#9D2558]/20"
                />
                <label htmlFor="intentionalAdditional" className="text-xs text-slate-600 cursor-pointer">
                  Explicit intentional additional overtime for this date (allows second entry)
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] shadow-xs"
                >
                  Submit Overtime
                </button>
              </div>
            
              </fieldset>
</form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT OVERTIME */}
      {showEditModal && activeRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Edit Overtime Entry</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Voucher: {activeRecord.overtimeNumber || activeRecord.id} • {activeRecord.staffName}
                </p>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Overtime Minutes *</label>
                <input
                  type="number"
                  required
                  min={1}
                  step={1}
                  value={editForm.minutes}
                  onChange={(e) => setEditForm({ ...editForm, minutes: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason *</label>
                <textarea
                  required
                  rows={2}
                  value={editForm.reason}
                  onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: APPROVE OVERTIME */}
      {showApproveModal && activeRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Approve Overtime Voucher</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Confirm payout calculation for {activeRecord.staffName}
                </p>
              </div>
              <button onClick={() => setShowApproveModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Employee:</span>
                  <span className="font-semibold text-slate-900">{activeRecord.staffName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Work Date:</span>
                  <span className="font-medium text-slate-800">{activeRecord.date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Minutes Approved:</span>
                  <span className="font-bold text-slate-900">{activeRecord.minutes} mins</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Snapshotted Hourly Rate:</span>
                  <span className="font-semibold text-slate-800">
                    Rs. {(activeRecord.hourlyRate ?? 0).toLocaleString()}/hr
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between text-sm">
                  <span className="font-bold text-slate-800">Approved Payout:</span>
                  <span className="font-bold text-emerald-700">
                    Rs. {roundCurrency(((activeRecord.minutes || 0) / 60) * (activeRecord.hourlyRate ?? 0)).toLocaleString()}
                  </span>
                </div>
              </div>

              <p className="text-slate-500 text-[11px] leading-relaxed">
                Approving this voucher will freeze the effective hourly rate and amount.
                The approved minutes will become eligible for future payroll generation.
              </p>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs"
              >
                Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: REJECT OVERTIME */}
      {showRejectModal && activeRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Reject Overtime Voucher</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Voucher: {activeRecord.overtimeNumber || activeRecord.id}
                </p>
              </div>
              <button onClick={() => setShowRejectModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Rejection *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Specify why overtime is disputed or rejected..."
                  value={reasonForm.reason}
                  onChange={(e) => setReasonForm({ reason: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-xs"
              >
                Reject Voucher
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CANCEL OVERTIME */}
      {showCancelModal && activeRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Cancel Approved Overtime</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Voucher: {activeRecord.overtimeNumber || activeRecord.id}
                </p>
              </div>
              <button onClick={() => setShowCancelModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs">
                Cancelled overtime records are excluded from payroll. Overtime cannot be cancelled if already paid in finalized payroll.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cancellation Reason *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Audit reason for cancellation..."
                  value={reasonForm.reason}
                  onChange={(e) => setReasonForm({ reason: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9D2558]/20"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 shadow-xs"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: PRINT OVERTIME AUDIT */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between print:hidden">
              <span className="font-bold text-slate-900 text-sm">Print Overtime Audit Sheet</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#9D2558] text-white text-xs font-semibold hover:bg-[#851C47]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Now
                </button>
                <button onClick={() => setShowPrintModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-8 space-y-6 print:p-0">
              <div className="border-b border-slate-200 pb-4 text-center">
                <h2 className="text-xl font-bold text-slate-900 uppercase tracking-tight">iSysware SalonOS</h2>
                <p className="text-sm font-semibold text-slate-700 mt-1">Manual Overtime & Payout Audit Report</p>
                <p className="text-xs text-slate-500">
                  Period: {startDate} to {endDate} • Branch: {allBranches.find((b) => b.id === effectiveBranchId)?.name || 'Consolidated'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs border border-slate-200 rounded-lg p-3">
                <div>
                  <span className="text-slate-400 block text-[10px]">Entered Minutes:</span>
                  <span className="font-bold text-slate-900">{summaryKpis.totalEnteredMinutes} mins</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Approved Minutes:</span>
                  <span className="font-bold text-emerald-700">{summaryKpis.totalApprovedMinutes} mins</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Total Approved Pay:</span>
                  <span className="font-bold text-[#851C47]">Rs. {summaryKpis.totalApprovedAmount.toLocaleString()}</span>
                </div>
              </div>

              <table className="report-records w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-300 font-semibold text-slate-800 text-[11px]">
                    <th className="py-2">Voucher</th>
                    <th className="py-2">Date</th>
                    <th className="py-2">Staff</th>
                    <th className="py-2">Minutes</th>
                    <th className="py-2">Rate</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Approver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRecords.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 font-mono text-[11px]">{r.overtimeNumber || r.id}</td>
                      <td className="py-2">{r.date}</td>
                      <td className="py-2 font-medium">{r.staffName}</td>
                      <td className="py-2">{r.status === 'APPROVED' ? r.approvedMinutes : r.minutes}m</td>
                      <td className="py-2">Rs. {(r.hourlyRate ?? 0).toLocaleString()}</td>
                      <td className="py-2 font-semibold">Rs. {(r.amount || 0).toLocaleString()}</td>
                      <td className="py-2 font-semibold">{r.status}</td>
                      <td className="py-2">{r.approvedByName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pt-8 grid grid-cols-2 gap-8 text-xs text-center border-t border-slate-200">
                <div>
                  <div className="border-b border-slate-300 w-48 mx-auto pb-6" />
                  <p className="mt-2 text-slate-600 font-medium">Head of Operations</p>
                </div>
                <div>
                  <div className="border-b border-slate-300 w-48 mx-auto pb-6" />
                  <p className="mt-2 text-slate-600 font-medium">Finance Controller</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
