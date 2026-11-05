import { BranchActionField } from '@/components/BranchActionField';
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../context/RouterContext';
import { salonService } from '../../services';
import {
  AttendanceRecord,
  StaffMember,
  Branch,
  CSVAttendanceImportRow,
  CSVAttendanceImportResult,
  AttendancePolicyConfig,
  LeaveAllowanceSummary,
} from '../../types/salon';
import {
  Clock,
  ClockAlert,
  Calendar,
  Filter,
  Check,
  X,
  Save,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Upload,
  FileSpreadsheet,
  RotateCcw,
  Building2,
  Users,
  ShieldCheck,
  HelpCircle,
  Loader2,
  ChevronDown,
  Sliders,
  Sparkles,
} from 'lucide-react';
import {
  formatMinutesToTime,
  parseTimeToMinutes,
  evaluateLateness,
  evaluateEarlyExit,
} from '../../lib/attendanceCalculations';
import { AccessDeniedView } from '../scaffold/AccessDeniedView';
import { toast } from '../../context/ToastContext';
import {
  LuxurySelect,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui';

function formatTo24Hour(timeStr?: string): string {
  if (!timeStr || !timeStr.trim()) return '';
  const clean = timeStr.trim().toUpperCase();
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) {
    return clean;
  }
  const mins = parseTimeToMinutes(clean);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface EditableAttendanceRow {
  staffId: string;
  employeeCode: string;
  name: string;
  phone: string;
  designation: string;
  roleTitle: string;
  compensationType: string;
  startTime: string; // e.g. "09:00"
  endTime: string;   // e.g. "18:00"
  lateGraceMinutes: number;
  earlyGraceMinutes: number;
  isOvernightShift: boolean;

  // Editable fields
  recordId?: string;
  status: 'SELECT_STATUS' | 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'PAID_LEAVE' | 'UNPAID_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';
  checkIn: string;   // "09:00"
  checkOut: string;  // "18:00"
  notes: string;
  isModified: boolean;
  isAutoAbsent?: boolean;
  isAutoHalfDay?: boolean;
}

export const StaffAttendancePage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();
  const { navigate } = useRouter();

  // Role guard: Super Admin and Admin only
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/operations/attendance" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const initialDate = demoDate || new Date().toISOString().slice(0, 10);

  // Filter Bar state
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    isSuperAdmin ? '' : (user.branchId || '')
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [attendanceType, setAttendanceType] = useState<string>('NORMAL');
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);

  // Data state
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [rawStaffList, setRawStaffList] = useState<StaffMember[]>([]);
  const [rawAttendanceList, setRawAttendanceList] = useState<AttendanceRecord[]>([]);
  const [rows, setRows] = useState<EditableAttendanceRow[]>([]);
  const [attendancePolicy, setAttendancePolicy] = useState<AttendancePolicyConfig | null>(null);
  const [leaveAllowances, setLeaveAllowances] = useState<Record<string, LeaveAllowanceSummary>>({});
  const [quotaAlertModal, setQuotaAlertModal] = useState<{
    isOpen: boolean;
    staffId: string;
    staffName: string;
    employeeCode: string;
    allowedDays: number;
    usedDays: number;
    period: 'MONTHLY' | 'YEARLY';
    previousStatus: EditableAttendanceRow['status'];
  } | null>(null);

  // Modals state (EOD finalize & CSV import)
  const [showFinalizeModal, setShowFinalizeModal] = useState<boolean>(false);
  const [importBranchId, setImportBranchId] = useState(isSuperAdmin ? '' : user.branchId || '');
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importCsvText, setImportCsvText] = useState<string>('');
  const [importLoading, setImportLoading] = useState<boolean>(false);

  // Effective branch
  const effectiveBranchId = isSuperAdmin ? selectedBranchId : (user.branchId || activeBranchId);
  const currentBranch = allBranches.find((b) => b.id === effectiveBranchId) || allBranches[0];

  // Fetch staff and existing attendance from backend database
  const loadAttendanceData = async (branchIdToLoad: string, dateToLoad: string) => {
    if (!branchIdToLoad) return;
    try {
      setLoading(true);
      const [allStaff, attRecords, attPolicy, allowances] = await Promise.all([
        salonService.getStaff(branchIdToLoad),
        salonService.getAttendance(branchIdToLoad, dateToLoad, undefined, user || undefined),
        salonService.getAttendancePolicy(branchIdToLoad).catch(() => null),
        salonService.getLeaveAllowances(branchIdToLoad, dateToLoad, user || undefined).catch(() => ({})),
      ]);
      setLeaveAllowances(allowances || {});

      const activeStaff = allStaff.filter((s) => s.isActive);
      setRawStaffList(activeStaff);
      setRawAttendanceList(attRecords);
      setAttendancePolicy(attPolicy);

      // Build initial editable rows map
      const attMap = new Map<string, AttendanceRecord>();
      attRecords.forEach((a) => {
        attMap.set(a.staffId, a);
      });

      const policyEnabled = attPolicy?.autoMarkAbsentEnabled ?? true;
      const thresholdMins = attPolicy?.autoAbsentThresholdMinutes ?? 60;
      const todayStr = demoDate || new Date().toISOString().slice(0, 10);
      const now = new Date();
      const currentDayMinutes = now.getHours() * 60 + now.getMinutes();

      const initialRows: EditableAttendanceRow[] = activeStaff.map((staff) => {
        const existing = attMap.get(staff.id);
        const defaultStart = staff.startTime ? formatTo24Hour(staff.startTime) : (attPolicy?.defaultStartTime || '09:00');
        const defaultEnd = staff.endTime ? formatTo24Hour(staff.endTime) : (attPolicy?.defaultEndTime || '18:00');

        if (existing) {
          let mappedStatus: EditableAttendanceRow['status'] = 'PRESENT';
          const exStatus = existing.status as string;
          if (exStatus === 'ABSENT') mappedStatus = 'ABSENT';
          else if (exStatus === 'HALF_DAY') mappedStatus = 'HALF_DAY';
          else if (exStatus === 'PAID_LEAVE') mappedStatus = 'PAID_LEAVE';
          else if (exStatus === 'UNPAID_LEAVE') mappedStatus = 'UNPAID_LEAVE';
          else if (exStatus === 'HOLIDAY') mappedStatus = 'HOLIDAY';
          else if (exStatus === 'WEEKLY_OFF') mappedStatus = 'WEEKLY_OFF';
          else mappedStatus = 'PRESENT';

          return {
            staffId: staff.id,
            employeeCode: staff.employeeCode || `EMP-${staff.id.slice(0, 4)}`,
            name: staff.name,
            phone: staff.phone || '-',
            designation: staff.designation || staff.roleTitle || 'Stylist',
            roleTitle: staff.roleTitle || '',
            compensationType: staff.compensationType || 'SALARY_ONLY',
            startTime: defaultStart,
            endTime: defaultEnd,
            lateGraceMinutes: staff.lateGraceMinutes ?? (attPolicy?.lateGraceMinutes ?? 15),
            earlyGraceMinutes: staff.earlyGraceMinutes ?? (attPolicy?.earlyGraceMinutes ?? 15),
            isOvernightShift: !!staff.isOvernightShift,

            recordId: existing.id,
            status: mappedStatus,
            checkIn: existing.checkIn && existing.checkIn !== 'ABSENT' && !existing.checkIn.includes('LEAVE') ? formatTo24Hour(existing.checkIn) : '',
            checkOut: existing.checkOut && existing.checkOut !== 'ABSENT' && !existing.checkOut.includes('LEAVE') ? formatTo24Hour(existing.checkOut) : '',
            notes: existing.notes || '',
            isModified: false,
            isAutoAbsent: false,
            isAutoHalfDay: mappedStatus === 'HALF_DAY',
          };
        }

        // New unrecorded row for this day — apply Auto-Mark Absent rule if threshold passed
        let newStatus: EditableAttendanceRow['status'] = 'SELECT_STATUS';
        let newNotes = '';
        let isAutoMarked = false;

        if (policyEnabled) {
          if (dateToLoad < todayStr) {
            // Past day with no check-in -> auto-mark absent
            newStatus = 'ABSENT';
            newNotes = 'Auto-marked absent: Day ended without check-in';
            isAutoMarked = true;
          } else if (dateToLoad === todayStr) {
            // Today: check if current time has passed (shiftStart + threshold)
            const shiftStartMins = parseTimeToMinutes(defaultStart);
            const cutoffMins = shiftStartMins + thresholdMins;

            if (currentDayMinutes >= cutoffMins) {
              newStatus = 'ABSENT';
              newNotes = `Auto-marked absent: Not checked in within ${thresholdMins}m of shift start (${defaultStart})`;
              isAutoMarked = true;
            }
          }
        }

        return {
          staffId: staff.id,
          employeeCode: staff.employeeCode || `EMP-${staff.id.slice(0, 4)}`,
          name: staff.name,
          phone: staff.phone || '-',
          designation: staff.designation || staff.roleTitle || 'Stylist',
          roleTitle: staff.roleTitle || '',
          compensationType: staff.compensationType || 'SALARY_ONLY',
          startTime: defaultStart,
          endTime: defaultEnd,
          lateGraceMinutes: staff.lateGraceMinutes ?? (attPolicy?.lateGraceMinutes ?? 15),
          earlyGraceMinutes: staff.earlyGraceMinutes ?? (attPolicy?.earlyGraceMinutes ?? 15),
          isOvernightShift: !!staff.isOvernightShift,

          recordId: undefined,
          status: newStatus,
          checkIn: '',
          checkOut: '',
          notes: newNotes,
          isModified: isAutoMarked,
          isAutoAbsent: isAutoMarked,
        };
      });

      setRows(initialRows);
    } catch (err: any) {
      console.error('Error loading attendance:', err);
      toast.error(err.message || 'Failed to load staff attendance.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!effectiveBranchId) return;
    salonService.getStaff(effectiveBranchId).then((allStaff) => {
      setRawStaffList(allStaff.filter((s) => s.isActive));
    }).catch((err) => console.error(err));
    setHasFiltered(false);
    setRows([]);
  }, [effectiveBranchId]);

  // Unique staff categories derived dynamically from active staff
  const staffCategories = useMemo(() => {
    const set = new Set<string>();
    rawStaffList.forEach((s) => {
      if (s.designation) set.add(s.designation);
      else if (s.roleTitle) set.add(s.roleTitle);
    });
    return Array.from(set);
  }, [rawStaffList]);

  // Filtered rows for display based on Category filter
  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== 'ALL' && r.designation !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [rows, categoryFilter]);

  // Handler: Manual Filter Button Click
  const handleApplyFilter = () => {
    if (!effectiveBranchId) { toast.error('Please select a branch for this action.'); return; }
    setHasFiltered(true);
    loadAttendanceData(effectiveBranchId, selectedDate);
  };

  // Handler: Bulk Quick Actions
  const handleMarkAll = (targetStatus: EditableAttendanceRow['status']) => {
    setRows((prev) =>
      prev.map((r) => {
        // If category filter is active, only update visible rows
        if (categoryFilter !== 'ALL' && r.designation !== categoryFilter) {
          return r;
        }

        let newCheckIn = r.checkIn;
        let newCheckOut = r.checkOut;

        if (targetStatus === 'ABSENT' || targetStatus === 'HOLIDAY' || targetStatus === 'WEEKLY_OFF') {
          newCheckIn = '';
          newCheckOut = '';
        }

        return {
          ...r,
          status: targetStatus,
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          isModified: true,
        };
      })
    );
    toast.success(`Marked all ${categoryFilter === 'ALL' ? '' : categoryFilter} staff as ${targetStatus}!`);
  };

  // Apply status change helper
  const applyStatusChange = (staffId: string, newStatus: EditableAttendanceRow['status'], isOverride = false) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.staffId !== staffId) return r;
        let cIn = r.checkIn;
        let cOut = r.checkOut;
        if (newStatus === 'ABSENT' || newStatus === 'HOLIDAY' || newStatus === 'WEEKLY_OFF' || newStatus === 'PAID_LEAVE' || newStatus === 'UNPAID_LEAVE') {
          cIn = '';
          cOut = '';
        }
        let note = r.notes;
        if (isOverride && newStatus === 'PAID_LEAVE') {
          note = (note ? note.replace(/Admin Override: Paid leave quota exceeded\s*\|?\s*/g, '') : '');
          note = (note ? note + ' | ' : '') + 'Admin Override: Paid leave quota exceeded';
        }
        return {
          ...r,
          status: newStatus,
          checkIn: cIn,
          checkOut: cOut,
          notes: note,
          isModified: true,
          isAutoAbsent: false,
        };
      })
    );
  };

  // Handler: Update row status with Leave Quota Check & Alert
  const handleRowStatusChange = (staffId: string, newStatus: EditableAttendanceRow['status']) => {
    if (newStatus === 'PAID_LEAVE') {
      const allowance = leaveAllowances[staffId];
      if (allowance && allowance.isConfigured && allowance.remainingDays <= 0) {
        const currentRow = rows.find((r) => r.staffId === staffId);
        setQuotaAlertModal({
          isOpen: true,
          staffId,
          staffName: currentRow?.name || 'Staff',
          employeeCode: currentRow?.employeeCode || '',
          allowedDays: allowance.allowedDays,
          usedDays: allowance.usedDays,
          period: allowance.period,
          previousStatus: currentRow?.status || 'SELECT_STATUS',
        });
        return;
      }
    }
    applyStatusChange(staffId, newStatus, false);
  };

  // Handler: Update row check-in time
  const handleRowCheckInChange = (staffId: string, val: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.staffId !== staffId) return r;

        let newStatus = r.status === 'SELECT_STATUS' ? 'PRESENT' : r.status;
        let isAutoHalfDay = false;
        let newNotes = r.notes;

        // Auto-Half Day check: if autoHalfDayEnabled is true and check-in time exceeds cutoff
        if (attendancePolicy?.autoHalfDayEnabled && val) {
          const shiftStartMins = parseTimeToMinutes(r.startTime || '09:00');
          const checkInMins = parseTimeToMinutes(val);
          const threshold = attendancePolicy.halfDayThresholdMinutes ?? 120;
          if (checkInMins >= shiftStartMins + threshold) {
            newStatus = 'HALF_DAY';
            isAutoHalfDay = true;
            if (!newNotes || newNotes.includes('Auto-marked')) {
              newNotes = `Auto-marked Half Day: Checked in at ${val} (>= ${threshold}m after shift start ${r.startTime})`;
            }
          }
        }

        return {
          ...r,
          checkIn: val,
          status: newStatus,
          isAutoHalfDay,
          notes: newNotes,
          isModified: true,
        };
      })
    );
  };

  // Handler: Update row check-out time
  const handleRowCheckOutChange = (staffId: string, val: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.staffId !== staffId) return r;
        return {
          ...r,
          checkOut: val,
          status: r.status === 'SELECT_STATUS' ? 'PRESENT' : r.status,
          isModified: true,
        };
      })
    );
  };

  // Helper: evaluate lateness for a row
  const getLateArrivalInfo = (r: EditableAttendanceRow) => {
    if (r.status !== 'PRESENT' && r.status !== 'HALF_DAY') return { text: '-', isLate: false };
    if (!r.checkIn) return { text: '-', isLate: false };
    const { isLate, lateMinutes } = evaluateLateness(r.checkIn, r.startTime, r.lateGraceMinutes);
    if (isLate) {
      return { text: `${lateMinutes}m Late`, isLate: true };
    }
    return { text: 'On Time', isLate: false };
  };

  // Helper: evaluate early exit for a row
  const getEarlyExitInfo = (r: EditableAttendanceRow) => {
    if (r.status !== 'PRESENT' && r.status !== 'HALF_DAY') return { text: '-', isEarly: false };
    if (!r.checkOut) return { text: '-', isEarly: false };
    const { isEarlyExit: isEarly, earlyExitMinutes } = evaluateEarlyExit(
      r.checkOut,
      r.endTime,
      r.earlyGraceMinutes,
      r.isOvernightShift
    );
    if (isEarly) {
      return { text: `${earlyExitMinutes}m Early Exit`, isEarly: true };
    }
    return { text: 'On Time', isEarly: false };
  };

  // Summary counts
  const summaryCounts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let leaves = 0;
    let holidays = 0;
    let unselected = 0;

    rows.forEach((r) => {
      if (r.status === 'PRESENT' || r.status === 'HALF_DAY') present++;
      else if (r.status === 'ABSENT') absent++;
      else if (r.status === 'PAID_LEAVE' || r.status === 'UNPAID_LEAVE') leaves++;
      else if (r.status === 'HOLIDAY' || r.status === 'WEEKLY_OFF') holidays++;
      else unselected++;
    });

    return { total: rows.length, present, absent, leaves, holidays, unselected };
  }, [rows]);

  // Handler: Save Attendance (Sends daily sheet to real backend DB)
  const handleSaveAttendance = async () => {
    if (!effectiveBranchId) { toast.error('Please select a branch for this action.'); return; }
    // Only send rows that have been given a valid status
    const validRows = rows.filter((r) => r.status !== 'SELECT_STATUS');
    if (validRows.length === 0) {
      toast.error('Please mark status for at least one staff member before saving.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        branchId: effectiveBranchId,
        date: selectedDate,
        records: validRows.map((r) => ({
          staffId: r.staffId,
          status: r.status,
          checkIn: r.checkIn ? formatMinutesToTime(parseTimeToMinutes(r.checkIn)) : undefined,
          checkOut: r.checkOut ? formatMinutesToTime(parseTimeToMinutes(r.checkOut)) : undefined,
          notes: r.notes || undefined,
        })),
      };

      const result = await salonService.saveDailyAttendance(payload, user);
      toast.success(`Attendance successfully saved for ${result.savedCount} staff members!`);
      // Reload fresh data from database
      await loadAttendanceData(effectiveBranchId, selectedDate);
    } catch (err: any) {
      console.error('Failed to save attendance:', err);
      toast.error(err.message || 'Failed to save attendance records.');
    } finally {
      setSaving(false);
    }
  };

  // Handler: End of Day Finalize
  const handleFinalizeDay = async () => {
    try {
      setLoading(true);
      const res = await salonService.finalizeDayAttendance(effectiveBranchId, selectedDate, user);
      toast.success(`Day finalized! ${res.finalizedCount} records locked. Marked absent: ${res.markedAbsentStaffNames.length}`);
      setShowFinalizeModal(false);
      await loadAttendanceData(effectiveBranchId, selectedDate);
    } catch (err: any) {
      toast.error(err.message || 'Failed to finalize attendance.');
    } finally {
      setLoading(false);
    }
  };

  // Handler: Biometric CSV Import
  const handleImportCSV = async () => {
    if (!importBranchId || !allBranches.some((b) => b.id === importBranchId)) { toast.error('Please select a branch for this import.'); return; }
    if (!importCsvText.trim()) return;
    try {
      setImportLoading(true);
      const lines = importCsvText.trim().split('\n');
      const rowsToImport: CSVAttendanceImportRow[] = [];
      lines.forEach((line, idx) => {
        const parts = line.split(',').map((p) => p.trim());
        if (parts.length >= 3 && idx > 0) {
          rowsToImport.push({
            rowNumber: idx + 1,
            employeeCode: parts[0],
            date: parts[1] || selectedDate,
            checkIn: parts[2] || '09:00',
            checkOut: parts[3] || undefined,
            status: 'VALID',
          });
        }
      });

      if (rowsToImport.length === 0) {
        toast.error('Invalid CSV format. Header: employeeCode,date,checkIn,checkOut');
        return;
      }

      const res = await salonService.importAttendanceCSV(importBranchId, rowsToImport, user);
      toast.success(`Import complete! Accepted: ${res.acceptedRows}, Rejected: ${res.rejectedRows}`);
      setShowImportModal(false);
      setImportCsvText('');
      await loadAttendanceData(effectiveBranchId, selectedDate);
    } catch (err: any) {
      toast.error(err.message || 'CSV import failed.');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Staff Attendance & Biometric Punches
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Daily attendance marking, shift verification, grace lateness penalties & biometric sync.
              </p>
            </div>
          </div>
        </div>

        {/* Secondary tools */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          <button
            type="button"
            onClick={() => navigate('/admin/attendance-settings')}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            title="Configure auto-absent cutoff threshold and shift grace"
          >
            <Sliders className="w-3.5 h-3.5 text-[#B82E69]" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            onClick={() => { setImportBranchId(isSuperAdmin ? '' : user.branchId || ''); setShowImportModal(true); }}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#78616C]" />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setShowFinalizeModal(true)}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Finalize Day (EOD)</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row - Pure White Frosted Glass */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Staff */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Users className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Total
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {summaryCounts.total}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Active staff on branch roster
            </span>
          </div>
        </div>

        {/* Present Today */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Present
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {summaryCounts.present}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Marked present or half-day
            </span>
          </div>
        </div>

        {/* Absent / Leaves */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
              <X className="w-4 h-4" />
            </div>
            <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Absent
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {summaryCounts.absent + summaryCounts.leaves}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Unexcused absentees & leaves
            </span>
          </div>
        </div>

        {/* Unmarked / Pending */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Pending
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {summaryCounts.unselected}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Staff awaiting attendance mark
            </span>
          </div>
        </div>
      </div>

      {/* ── FILTER CARD ────────────────────────────────────────────────────── */}
      <div className="bg-white/75 backdrop-blur-2xl rounded-[22px] border border-white/90 p-4 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
          {/* Branch Selector */}
          <LuxurySelect
            label="Branch Location"
            value={selectedBranchId}
            onValueChange={setSelectedBranchId}
            disabled={!isSuperAdmin}
            placeholder="Select branch"
            options={allBranches.map((b) => ({ value: b.id, label: b.name }))}
            triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
          />

          {/* Staff Category */}
          <LuxurySelect
            label="Staff Category"
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            options={[
              { value: 'ALL', label: 'All Categories' },
              ...staffCategories.map((cat) => ({ value: cat, label: cat })),
            ]}
            triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
          />

          {/* Type */}
          <LuxurySelect
            label="Type"
            value={attendanceType}
            onValueChange={setAttendanceType}
            options={[
              { value: 'NORMAL', label: 'Normal Attendance' },
              { value: 'ALL', label: 'All Attendance' },
            ]}
            triggerClassName="h-9 rounded-xl border-white/80 bg-white/80 text-xs font-semibold"
          />

          {/* Date */}
          <div>
            <label className="block text-[11px] font-semibold text-[#78616C] mb-1">Attendance Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setHasFiltered(false);
                setRows([]);
              }}
              className="w-full h-9 text-xs border border-white/80 rounded-xl px-3 bg-white/80 text-[#18191B] font-medium transition-colors cursor-pointer shadow-2xs"
            />
          </div>

          {/* Filter Button */}
          <div>
            <button
              type="button"
              onClick={handleApplyFilter}
              disabled={loading}
              className="w-full h-9 bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02359] hover:to-[#8B1A4B] text-white text-xs font-semibold rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-60"
            >
              {loading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" /> : <Filter className="w-3.5 h-3.5" />}
              <span>Filter Roster</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── SELECTED PILL & QUICK ACTION BUTTONS ROW ───────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white/75 backdrop-blur-2xl p-3.5 rounded-[22px] border border-white/90 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        {/* Branch Pill Badge */}
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#FDF2F5] text-[#B82E69] border border-white/60 text-xs font-semibold shadow-2xs">
            <Building2 className="w-3.5 h-3.5" />
            Branch: {currentBranch?.name || 'Main Branch'}
          </span>
        </div>

        {/* Quick Bulk Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasFiltered || loading || visibleRows.length === 0}
            onClick={() => handleMarkAll('PRESENT')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Mark All Present</span>
          </button>

          <button
            type="button"
            disabled={!hasFiltered || loading || visibleRows.length === 0}
            onClick={() => handleMarkAll('ABSENT')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Mark All Absent</span>
          </button>

          <button
            type="button"
            disabled={!hasFiltered || loading || visibleRows.length === 0}
            onClick={() => handleMarkAll('HOLIDAY')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Mark All Holiday</span>
          </button>

          <button
            type="button"
            disabled={!hasFiltered || loading || visibleRows.length === 0}
            onClick={() => handleMarkAll('WEEKLY_OFF')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs hover:bg-white text-slate-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Mark All Off</span>
          </button>
        </div>
      </div>

      {/* ── MAIN ATTENDANCE TABLE ────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="overflow-x-auto w-full">
          <table className="report-records min-w-[1100px] w-full text-left text-xs border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-[#FAF8F9]/80 border-b border-rose-100/40 text-[#78616C] font-semibold text-xs whitespace-nowrap">
                <th className="py-3 px-4 w-[110px] whitespace-nowrap">Emp. ID</th>
                <th className="py-3 px-4 min-w-[180px] whitespace-nowrap">Name</th>
                <th className="py-3 px-4 min-w-[140px] whitespace-nowrap">Phone / Info</th>
                <th className="py-3 px-4 min-w-[140px] whitespace-nowrap">Designation</th>
                <th className="py-3 px-4 min-w-[160px] whitespace-nowrap">Attendance Status</th>
                <th className="py-3 px-4 min-w-[140px] whitespace-nowrap">Arrival Timing</th>
                <th className="py-3 px-4 min-w-[140px] whitespace-nowrap">Exit Timing</th>
                <th className="py-3 px-4 min-w-[120px] whitespace-nowrap">Late Arrival</th>
                <th className="py-3 px-4 min-w-[120px] whitespace-nowrap">Early Exit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!hasFiltered ? (
                <tr>
                  <td colSpan={9} className="py-20 text-center text-slate-500">
                    <div className="max-w-md mx-auto space-y-2">
                      <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">No Records Displayed</p>
                      <p className="text-xs text-slate-400">
                        Please select criteria above and click <span className="font-semibold text-[#9D2558]">= Filter</span> to load staff attendance records.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="w-6 h-6 rounded-full border-2 border-[#F1DEE3] border-t-[#9D2558] animate-spin mx-auto mb-2" />
                    Loading staff attendance data...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No active staff found for this branch or category on {selectedDate}.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const isPresentLike = row.status === 'PRESENT' || row.status === 'HALF_DAY';
                  const lateInfo = getLateArrivalInfo(row);
                  const earlyInfo = getEarlyExitInfo(row);

                  return (
                    <tr
                      key={row.staffId}
                      className={`hover:bg-slate-50/60 transition-colors ${row.isModified ? 'bg-amber-50/20' : ''
                        }`}
                    >
                      {/* Emp ID */}
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-700">
                        {row.employeeCode}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-[10px] text-slate-400 capitalize">
                          {row.compensationType.replace(/_/g, ' ').toLowerCase()}
                        </div>
                      </td>

                      {/* Phone / Contact */}
                      <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                        {row.phone}
                      </td>

                      {/* Designation & Scheduled Shift */}
                      <td className="py-3.5 px-4 text-slate-700 font-medium">
                        <div>{row.designation}</div>
                        {row.startTime && row.endTime && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {row.startTime} - {row.endTime} (Grace: {row.lateGraceMinutes}m)
                          </div>
                        )}
                      </td>

                      {/* Attendance Status Dropdown */}
                      <td className="py-3.5 px-4">
                        <Select
                          value={row.status}
                          onValueChange={(val) =>
                            handleRowStatusChange(
                              row.staffId,
                              val as EditableAttendanceRow['status']
                            )
                          }
                        >
                          <SelectTrigger
                            className={`w-36 h-8 text-xs font-semibold rounded-xl border transition-colors shadow-2xs ${row.status === 'PRESENT'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : row.status === 'ABSENT'
                                  ? 'bg-rose-50 text-rose-700 border-rose-300'
                                  : row.status === 'HALF_DAY'
                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                    : row.status === 'HOLIDAY'
                                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                                      : row.status === 'WEEKLY_OFF'
                                        ? 'bg-[#FDF2F5] text-[#851C47] border-[#F8D2DC]'
                                        : row.status.includes('LEAVE')
                                          ? 'bg-purple-50 text-purple-700 border-purple-300'
                                          : 'bg-white text-slate-500 border-slate-200'
                              }`}
                          >
                            <SelectValue placeholder="Select Status" />
                          </SelectTrigger>
                          <SelectContent className="z-[70]">
                            <SelectItem value="SELECT_STATUS">Select Status</SelectItem>
                            <SelectItem value="PRESENT">Present</SelectItem>
                            <SelectItem value="ABSENT">Absent</SelectItem>
                            <SelectItem value="HALF_DAY">Half Day</SelectItem>
                            <SelectItem value="PAID_LEAVE">Leave (Paid)</SelectItem>
                            <SelectItem value="UNPAID_LEAVE">Leave (Unpaid)</SelectItem>
                            <SelectItem value="HOLIDAY">Holiday</SelectItem>
                            <SelectItem value="WEEKLY_OFF">Weekly Off</SelectItem>
                          </SelectContent>
                        </Select>
                        {row.isAutoAbsent && row.status === 'ABSENT' && (
                          <div className="mt-1">
                            <span
                              className="inline-block text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded shadow-2xs"
                              title={row.notes}
                            >
                              Auto-Absent (&gt;{attendancePolicy?.autoAbsentThresholdMinutes || 60}m)
                            </span>
                          </div>
                        )}
                        {row.isAutoHalfDay && row.status === 'HALF_DAY' && (
                          <div className="mt-1">
                            <span
                              className="inline-block text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shadow-2xs"
                              title={row.notes}
                            >
                              Auto-Half Day (&gt;{attendancePolicy?.halfDayThresholdMinutes || 120}m)
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Arrival Timing */}
                      <td className="py-3.5 px-4">
                        <div className="relative flex items-center">
                          <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                          <input
                            type="time"
                            value={row.checkIn}
                            disabled={!isPresentLike}
                            onChange={(e) => handleRowCheckInChange(row.staffId, e.target.value)}
                            className="w-full h-8 pl-8 pr-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-medium focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                          />
                        </div>
                      </td>

                      {/* Exit Timing */}
                      <td className="py-3.5 px-4">
                        <div className="relative flex items-center">
                          <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                          <input
                            type="time"
                            value={row.checkOut}
                            disabled={!isPresentLike}
                            onChange={(e) => handleRowCheckOutChange(row.staffId, e.target.value)}
                            className="w-full h-8 pl-8 pr-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-medium focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                          />
                        </div>
                      </td>

                      {/* Late Arrival Badge */}
                      <td className="py-3.5 px-4">
                        {lateInfo.isLate ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200">
                            {lateInfo.text}
                          </span>
                        ) : lateInfo.text === 'On Time' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">
                            On Time
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs font-mono">-</span>
                        )}
                      </td>

                      {/* Early Exit Badge */}
                      <td className="py-3.5 px-4">
                        {earlyInfo.isEarly ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            {earlyInfo.text}
                          </span>
                        ) : earlyInfo.text === 'On Time' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">
                            On Time
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs font-mono">-</span>
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

      {/* ── FOOTER: SUMMARY COUNTS & SAVE BUTTON ─────────────────────────── */}
      <div className="bg-white/75 backdrop-blur-2xl rounded-[22px] border border-white/90 px-5 py-4 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Summary status pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="px-3 py-1 rounded-xl bg-[#FAF8F9] text-[#78616C] shadow-2xs border border-white/60">
            Total Staff: <strong className="font-bold text-[#18191B]">{summaryCounts.total}</strong>
          </span>
          <span className="px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60">
            Present: <strong className="font-bold">{summaryCounts.present}</strong>
          </span>
          <span className="px-3 py-1 rounded-xl bg-rose-50 text-rose-700 shadow-2xs border border-white/60">
            Absent: <strong className="font-bold">{summaryCounts.absent}</strong>
          </span>
          <span className="px-3 py-1 rounded-xl bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60">
            Off/Holiday: <strong className="font-bold">{summaryCounts.holidays}</strong>
          </span>
          {summaryCounts.unselected > 0 && (
            <span className="px-3 py-1 rounded-xl bg-amber-50 text-amber-700 font-semibold shadow-2xs border border-white/60">
              Unmarked: {summaryCounts.unselected}
            </span>
          )}
        </div>

        {/* Save Attendance Button */}
        <div>
          <button
            type="button"
            onClick={handleSaveAttendance}
            disabled={!hasFiltered || saving || loading || visibleRows.length === 0}
            className="w-full sm:w-auto px-7 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Save Daily Sheet</span>
          </button>
        </div>
      </div>

      {/* ── MODAL: FINALIZE DAY (EOD) ───────────────────────────────────────── */}
      {/* ========================================================================= */}
      {/* ── PREMIUM GLOSSY MODAL: LEAVE QUOTA EXHAUSTED (VALIDATION & OVERRIDE) ── */}
      {/* ========================================================================= */}
      {quotaAlertModal && quotaAlertModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/90 bg-white/85 backdrop-blur-2xl p-6 shadow-[0_24px_70px_rgba(35,21,29,0.15),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col space-y-4 text-xs animate-in zoom-in-95 duration-150">
            {/* Top Gloss Reflection */}
            <div className="pointer-events-none absolute -top-24 -left-20 w-64 h-64 rounded-full bg-gradient-to-br from-white/80 via-rose-100/30 to-transparent blur-2xl" />

            {/* Header */}
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100/80 border border-amber-200/70 flex items-center justify-center text-amber-600 shrink-0 shadow-[0_4px_12px_rgba(245,158,11,0.12),inset_0_1px_1px_rgba(255,255,255,0.9)]">
                <AlertTriangle className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50/90 px-2.5 py-0.5 rounded-full border border-amber-200/60 shadow-2xs">
                  Quota Exceeded
                </span>
                <h3 className="text-base font-extrabold text-[#18191B] tracking-tight mt-1">Paid Leave Limit Reached</h3>
                <p className="text-slate-500 font-medium text-[11px]">
                  {quotaAlertModal.staffName} • <span className="font-mono text-slate-600">{quotaAlertModal.employeeCode}</span>
                </p>
              </div>
            </div>

            {/* Leave Quota Metrics Badge - Glossy style */}
            <div className="grid grid-cols-3 gap-2 bg-gradient-to-b from-white/90 to-slate-50/70 p-3 rounded-2xl border border-rose-100/70 shadow-[inset_0_1px_2px_rgba(255,255,255,1),0_2px_8px_rgba(0,0,0,0.02)] text-center relative z-10">
              <div className="p-1">
                <span className="text-slate-400 text-[10px] block font-semibold uppercase tracking-wider">Allowed</span>
                <span className="font-extrabold text-slate-800 text-sm font-mono block mt-0.5">{quotaAlertModal.allowedDays} Days</span>
                <span className="text-[9px] text-slate-400 font-semibold uppercase">{quotaAlertModal.period}</span>
              </div>
              <div className="p-1 border-x border-slate-200/60">
                <span className="text-slate-400 text-[10px] block font-semibold uppercase tracking-wider">Used</span>
                <span className="font-extrabold text-[#B82E69] text-sm font-mono block mt-0.5">{quotaAlertModal.usedDays} Days</span>
                <span className="text-[9px] text-[#B82E69]/70 font-semibold uppercase">Utilized</span>
              </div>
              <div className="p-1">
                <span className="text-slate-400 text-[10px] block font-semibold uppercase tracking-wider">Available</span>
                <span className="font-extrabold text-rose-600 text-sm font-mono block mt-0.5">0 Days</span>
                <span className="text-[9px] text-rose-500 font-bold uppercase">Exhausted</span>
              </div>
            </div>

            {/* Professional Short Notice - Glossy */}
            <div className="p-3 bg-gradient-to-r from-amber-50/90 via-amber-50/70 to-rose-50/40 border border-amber-200/70 rounded-2xl text-amber-950 flex items-center gap-2.5 relative z-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-[11px] text-amber-900 leading-snug font-medium">
                Paid leave balance is exhausted. You can convert to unpaid leave or grant an authorized admin override.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2 relative z-10">
              <button
                type="button"
                onClick={() => setQuotaAlertModal(null)}
                className="w-full sm:w-auto px-4 py-2 text-xs border border-slate-200/80 bg-white/80 hover:bg-white text-slate-700 rounded-xl font-semibold shadow-2xs cursor-pointer transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  applyStatusChange(quotaAlertModal.staffId, 'UNPAID_LEAVE', false);
                  toast.info(`Switched to Unpaid Leave for ${quotaAlertModal.staffName}.`);
                  setQuotaAlertModal(null);
                }}
                className="w-full sm:w-auto px-4 py-2 text-xs bg-amber-100/80 hover:bg-amber-100 text-amber-900 border border-amber-300/80 rounded-xl font-semibold shadow-2xs cursor-pointer transition-all active:scale-[0.98]"
              >
                Switch to Unpaid
              </button>
              <button
                type="button"
                onClick={() => {
                  applyStatusChange(quotaAlertModal.staffId, 'PAID_LEAVE', true);
                  toast.success(`Admin Override: Paid Leave approved for ${quotaAlertModal.staffName}.`);
                  setQuotaAlertModal(null);
                }}
                className="w-full sm:w-auto px-4 py-2 text-xs bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02358] hover:to-[#851C47] text-white rounded-xl font-semibold shadow-[0_4px_14px_rgba(184,46,105,0.25),inset_0_1px_1px_rgba(255,255,255,0.3)] cursor-pointer transition-all active:scale-[0.98]"
              >
                Authorize Override
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinalizeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <div className="flex items-center gap-3 text-emerald-600 mb-2">
              <ShieldCheck className="w-6 h-6" />
              <h3 className="font-bold text-slate-900 text-sm">Finalize Day Attendance</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Finalizing will lock all recorded attendance for <strong>{selectedDate}</strong> at{' '}
              <strong>{currentBranch?.name}</strong>. Any staff member who has not been marked present
              will be permanently recorded as <strong>ABSENT</strong>.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFinalizeModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFinalizeDay}
                disabled={loading}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs"
              >
                {loading ? 'Finalizing...' : 'Confirm & Lock Day'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: BIOMETRIC CSV IMPORT ─────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 border border-slate-200 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Upload className="w-4 h-4 text-[#9D2558]" />
                <span>Import Biometric / CSV Attendance</span>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Paste CSV rows below. Format: <code>employeeCode,date,checkIn,checkOut</code>
            </p>
            <BranchActionField value={importBranchId} onChange={setImportBranchId} disabled={importLoading} />
            <textarea
              rows={6}
              value={importCsvText}
              onChange={(e) => setImportCsvText(e.target.value)}
              placeholder="EMP-01,2026-10-11,09:05,18:00&#10;EMP-02,2026-10-11,09:30,18:15"
              className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportCSV}
                disabled={importLoading || !importCsvText.trim()}
                className="px-4 py-1.5 rounded-lg bg-[#9D2558] hover:bg-[#851C47] text-white text-xs font-semibold shadow-xs disabled:opacity-60"
              >
                {importLoading ? 'Importing...' : 'Upload & Process'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
