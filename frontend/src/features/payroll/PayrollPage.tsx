import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { salonService } from '../../services';
import {
  PayrollRun,
  PayrollRunType,
  PayslipRecord,
  StaffMember,
  CompensationType,
  PayrollRunStatus,
  PayrollPolicyConfig,
  OnlineAccount,
  CashDrawer,
  SalaryAdvance,
} from '../../types/salon';
import {
  DollarSign,
  MinusCircle,
  Calendar,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  Printer,
  FileSpreadsheet,
  Settings,
  Eye,
  CreditCard,
  Ban,
  RotateCcw,
  AlertTriangle,
  ChevronRight,
  UserCheck,
  Building,
  History,
  X,
  Lock,
  Trash2,
  MapPin,
  Briefcase,
  Banknote,
  Building2,
} from 'lucide-react';
import { roundCurrency } from '../../lib/taxCalculations';
import { formatCurrency } from '../../lib/formatters';
import { AccessDeniedView } from '../scaffold/AccessDeniedView';
import { PayrollExtrasPanel } from './PayrollExtrasPanel';
import { useRouter } from '../../context/RouterContext';
import { toast } from '../../context/ToastContext';

// Payslip parts added with allowances/adjustments/advances (absent on older payslips → 0).
const plusExtras = (p: PayslipRecord) => (p.allowancesTotal ?? 0) + (p.holidayEarnings ?? 0);
const minusExtras = (p: PayslipRecord) => (p.otherDeductions ?? 0) + (p.advanceRecoveryAmount ?? 0);
const money = (n: number, sign: '+' | '-') => (n > 0 ? `${sign}Rs. ${formatSalaryNumber(n)}` : '0');
const formatSalaryNumber = (num: number | string | undefined | null): string => {
  if (num === undefined || num === null || num === '') return '0.00';
  const val = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(val)) return '0.00';
  const hasSubCents = Math.abs(val * 100 - Math.round(val * 100)) > 0.0001;
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: hasSubCents ? 4 : 2,
  });
};
const BaseExplanation = ({ payslip: p }: { payslip: PayslipRecord }) => (
  <div className="text-[11px] text-slate-500 mt-1 font-normal whitespace-normal min-w-44">
    {p.startDate && <div>Eligible period: {p.startDate}{p.endDate && p.endDate !== p.startDate ? ` to ${p.endDate}` : ''}</div>}
    {p.joiningDate && <div>Joined: {p.joiningDate}{p.exitDate ? ` · Exit: ${p.exitDate}` : ''}</div>}
    {p.calculationDetails?.payableDays !== undefined && (
      <div>Eligible days: {p.calculationDetails.payableDays}{p.calculationDetails.prorationDivisor ? ` / ${p.calculationDetails.prorationDivisor}` : ''}</div>
    )}
    <div>{p.calculationDetails?.prorationFormula || (p.compensationType.startsWith('MONTHLY') ? 'Full eligible month: configured monthly salary' : '')}</div>
    {p.employmentNotes?.map((note) => <div key={note} className="text-amber-700">{note}</div>)}
  </div>
);

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const YEARS = ['2024', '2025', '2026', '2027', '2028'];

interface PayrollPageProps {
  mode?: 'GENERATE' | 'MANAGE' | 'ALLOWANCES';
}

export const PayrollPage: React.FC<PayrollPageProps> = ({ mode = 'GENERATE' }) => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();
  const { navigate } = useRouter();

  // Role guard: Super Admin and Admin only
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/accounts/payroll" />;
  }

  const businessToday = demoDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const initialMonth = businessToday.slice(0, 7);

  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [onlineAccounts, setOnlineAccounts] = useState<OnlineAccount[]>([]);
  const [cashDrawers, setCashDrawers] = useState<CashDrawer[]>([]);
  const [payrollPolicy, setPayrollPolicy] = useState<PayrollPolicyConfig | null>(null);

  const getStored = (key: string, fallback: string) => {
    try {
      return sessionStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };

  const initialStoredMonth = getStored('salonos_payroll_month', initialMonth);
  const initialStoredYear = getStored('salonos_payroll_year', initialStoredMonth.slice(0, 4) || '2026');
  const initialStoredMonthNum = getStored('salonos_payroll_month_num', initialStoredMonth.slice(5, 7) || '11');
  const initialStoredBranch = getStored(
    'salonos_payroll_branch',
    user.role === 'SUPER_ADMIN' ? (activeBranchId || user.branchId || allBranches[0]?.id || '') : (user.branchId || activeBranchId || '')
  );

  // Filters with session persistence across mode/page switches
  const [selectedBranchId, setSelectedBranchId] = useState<string>(initialStoredBranch);
  const [selectedMonth, setSelectedMonth] = useState<string>(initialStoredMonth);
  const [selectedMonthNum, setSelectedMonthNum] = useState<string>(initialStoredMonthNum);
  const [selectedYear, setSelectedYear] = useState<string>(initialStoredYear);

  const updateSelectedBranch = (branchId: string) => {
    setSelectedBranchId(branchId);
    try { sessionStorage.setItem('salonos_payroll_branch', branchId); } catch {}
  };

  const updateSelectedMonth = (year: string, monthNum: string) => {
    const m = `${year}-${monthNum}`;
    setSelectedYear(year);
    setSelectedMonthNum(monthNum);
    setSelectedMonth(m);
    try {
      sessionStorage.setItem('salonos_payroll_year', year);
      sessionStorage.setItem('salonos_payroll_month_num', monthNum);
      sessionStorage.setItem('salonos_payroll_month', m);
    } catch {}
  };
  const [salaryAdvances, setSalaryAdvances] = useState<SalaryAdvance[]>([]);
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [runType, setRunType] = useState<PayrollRunType>('MONTHLY');
  const [startDate, setStartDate] = useState(businessToday);
  const [endDate, setEndDate] = useState(businessToday);
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [compTypeFilter, setCompTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  useEffect(() => {
    if (!selectedBranchId) {
      const fallback = activeBranchId || user.branchId || allBranches[0]?.id || '';
      if (fallback) setSelectedBranchId(fallback);
    }
  }, [activeBranchId, user.branchId, allBranches, selectedBranchId]);

  // Active Draft Run (preview currently being inspected / generated)
  const [activeDraft, setActiveDraft] = useState<PayrollRun | null>(null);
  const [selectedPayslip, setSelectedPayslip] = useState<PayslipRecord | null>(null);

  // Modals
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);
  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [showPolicyModal, setShowPolicyModal] = useState<boolean>(false);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [showDeductionModal, setShowDeductionModal] = useState<boolean>(false);
  const [deductionTargetRun, setDeductionTargetRun] = useState<PayrollRun | null>(null);
  const [deductionTargetPayslip, setDeductionTargetPayslip] = useState<PayslipRecord | null>(null);
  const [deductionForm, setDeductionForm] = useState({
    amount: 0,
    title: 'Missed Attendance / Punch',
    notes: '',
  });

  // Payment Form
  const [paymentTargetRun, setPaymentTargetRun] = useState<PayrollRun | null>(null);
  const [paymentTargetPayslip, setPaymentTargetPayslip] = useState<PayslipRecord | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    method: 'CASH' as 'CASH' | 'ONLINE',
    onlineAccountId: '',
    reference: '',
  });

  // Cancel / Reversal Form
  const [cancelReason, setCancelReason] = useState<string>('');
  const [runToCancel, setRunToCancel] = useState<PayrollRun | null>(null);
  const [payslipToDelete, setPayslipToDelete] = useState<{ run: PayrollRun; payslip: PayslipRecord } | null>(null);
  const [singleDeleteReason, setSingleDeleteReason] = useState<string>('');
  const [showSingleDeleteModal, setShowSingleDeleteModal] = useState<boolean>(false);
  const [isCancellingAllMonthRuns, setIsCancellingAllMonthRuns] = useState<boolean>(false);
  const [paymentToReverse, setPaymentToReverse] = useState<{ id: string; amount: number; staffName: string } | null>(null);
  const [reverseReason, setReverseReason] = useState<string>('');

  // Policy Form
  const [policyForm, setPolicyForm] = useState<Partial<PayrollPolicyConfig>>({
    monthlyAbsenceDivisor: 30,
    dailyStaffPaidLeaveEligibility: true,
    nonWorkedWeeklyOffPaid: false,
    nonWorkedHolidayPaid: true,
    prorationMethod: 'CALENDAR_DAYS',
  });

  // Action feedback
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const effectiveBranchId = user.role === 'SUPER_ADMIN' ? selectedBranchId : (user.branchId || activeBranchId);

  // Fetch all initial data
  const loadData = async () => {
    if (!effectiveBranchId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [runs, staff, accounts, drawers, policy, advances] = await Promise.all([
        salonService.getPayrollRuns(effectiveBranchId, undefined, user),
        salonService.getStaff(effectiveBranchId),
        salonService.getOnlineAccounts(effectiveBranchId),
        salonService.getCashDrawers(effectiveBranchId),
        salonService.getPayrollPolicy(effectiveBranchId),
        salonService.getSalaryAdvances(effectiveBranchId),
      ]);

      setPayrollRuns(runs);
      setStaffList(staff);
      setOnlineAccounts(accounts);
      setCashDrawers(drawers);
      setPayrollPolicy(policy);
      setPolicyForm(policy);
      setSalaryAdvances(advances || []);

      setSelectedStaffIds([]);
      setHasFiltered(false);
    } catch (err: any) {
      console.warn('Initial payroll data load warning:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [effectiveBranchId, selectedMonth, mode]);

  useEffect(() => {
    setSelectedStaffIds([]);
    setHasFiltered(false);
    setSelectedMonth(runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7));
  }, [runType, selectedYear, selectedMonthNum, startDate, endDate]);

  // Derived Statistics for the Selected Month / Branch
  const summaryStats = useMemo(() => {
    let finalizedPayable = 0;
    let paid = 0;
    let outstanding = 0;
    let employeeCount = 0;

    payrollRuns
      .filter((r) => r.status !== 'CANCELLED' && r.status !== 'DRAFT')
      .forEach((r) => {
        finalizedPayable += r.totalPayable;
        paid += r.totalPaid;
        outstanding += r.totalOutstanding;
        employeeCount += r.employeeCount;
      });

    return {
      finalizedPayable: roundCurrency(finalizedPayable),
      paid: roundCurrency(paid),
      outstanding: roundCurrency(outstanding),
      employeeCount,
    };
  }, [payrollRuns]);

  // Filtered finalized/history payslips for the main table view
  const displayRuns = useMemo(() => {
    return payrollRuns.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      return true;
    });
  }, [payrollRuns, statusFilter]);

  const effectiveBranchName = useMemo(() => {
    return allBranches.find((b) => b.id === effectiveBranchId)?.name || 'Main Branch';
  }, [allBranches, effectiveBranchId]);

  const monthLabel = useMemo(() => {
    return MONTHS.find((m) => m.value === selectedMonthNum)?.label || 'October';
  }, [selectedMonthNum]);

  // Active staff in this branch (deduplicated by staff ID)
  const branchStaff = useMemo(() => {
    const map = new Map<string, StaffMember>();
    staffList.forEach((s) => {
      const month = runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7);
      const from = runType === 'MONTHLY' ? `${month}-01` : startDate;
      const selectedEnd = runType === 'MONTHLY' ? `${month}-${new Date(Number(selectedYear), Number(selectedMonthNum), 0).getDate()}` : runType === 'DAILY' ? startDate : endDate;
      const to = selectedEnd > businessToday ? businessToday : selectedEnd;
      if (s.branchId === effectiveBranchId && s.joiningDate <= to && (!s.exitDate || s.exitDate >= from) && (s.isActive || !!s.exitDate) && !map.has(s.id)) {
        map.set(s.id, s);
      }
    });
    return Array.from(map.values());
  }, [staffList, effectiveBranchId, runType, selectedYear, selectedMonthNum, startDate, endDate, businessToday]);

  const periodLabel = useMemo(() => {
    if (runType === 'DAILY') return startDate;
    if (runType === 'CUSTOM_RANGE') return `${startDate} to ${endDate}`;
    const month = `${selectedYear}-${selectedMonthNum}`;
    const end = `${month}-${new Date(Number(selectedYear), Number(selectedMonthNum), 0).getDate()}`;
    return `${monthLabel} ${selectedYear}: ${month}-01 to ${end > businessToday ? businessToday : end}`;
  }, [runType, startDate, endDate, monthLabel, selectedYear, selectedMonthNum, businessToday]);

  // Set of staff IDs that already have a finalized payslip in current month/run
  const generatedStaffIdSet = useMemo(() => {
    const set = new Set<string>();
    const targetMonth = runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7);
    payrollRuns
      .filter((r) => r.status !== 'CANCELLED' && r.status !== 'DRAFT' && r.month === targetMonth)
      .filter((r) => {
        if (runType === 'DAILY') return r.runType === 'DAILY' && r.startDate === startDate;
        if (runType === 'CUSTOM_RANGE') return r.runType === 'CUSTOM_RANGE' && r.startDate === startDate && r.endDate === endDate;
        return r.runType === 'MONTHLY' || !r.runType;
      })
      .forEach((r) => {
        r.payslips.forEach((p) => set.add(p.staffId));
      });
    return set;
  }, [payrollRuns, runType, selectedYear, selectedMonthNum, startDate, endDate]);

  // Active Draft Runs for current month/branch
  const draftRuns = useMemo(() => {
    const targetMonth = runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7);
    return payrollRuns.filter((r) => r.status === 'DRAFT' && r.month === targetMonth);
  }, [payrollRuns, runType, selectedYear, selectedMonthNum, startDate]);

  // Draft Payslip Rows for the main table view - Strictly UNIQUE per employee and NEVER include already-finalized staff
  const draftPayslipRows = useMemo(() => {
    const list: { run: PayrollRun; payslip: PayslipRecord }[] = [];
    const seenStaffIds = new Set<string>();

    // Sort draft runs newest first so the freshest calculation is used
    const sortedDraftRuns = [...draftRuns].sort((a, b) => {
      const tA = new Date(a.generatedAt || 0).getTime();
      const tB = new Date(b.generatedAt || 0).getTime();
      return tB - tA;
    });

    sortedDraftRuns.forEach((r) => {
      r.payslips.forEach((p) => {
        // Exclude staff who are already finalized in this period
        if (generatedStaffIdSet.has(p.staffId)) {
          return;
        }
        // Deduplicate staff across multiple draft runs
        if (seenStaffIds.has(p.staffId)) {
          return;
        }
        seenStaffIds.add(p.staffId);
        list.push({ run: r, payslip: p });
      });
    });
    return list;
  }, [draftRuns, generatedStaffIdSet]);

  // Active advance map by staffId
  const staffLoanMap = useMemo(() => {
    const map = new Map<string, SalaryAdvance>();
    (salaryAdvances || [])
      .filter((a) => a.status === 'ACTIVE' && a.balance > 0)
      .forEach((a) => map.set(a.staffId, a));
    return map;
  }, [salaryAdvances]);

  // Payslips from finalized (non-draft, non-cancelled) runs for the selected month / period, strictly unique per employee
  const generatedPayslipRows = useMemo(() => {
    const map = new Map<string, { run: PayrollRun; payslip: PayslipRecord }>();
    const targetMonth = runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7);
    payrollRuns
      .filter((r) => r.status !== 'CANCELLED' && r.status !== 'DRAFT' && r.month === targetMonth)
      .filter((r) => {
        if (mode === 'MANAGE') return true;
        if (runType === 'DAILY') return r.runType === 'DAILY' && r.startDate === startDate;
        if (runType === 'CUSTOM_RANGE') return r.runType === 'CUSTOM_RANGE' && r.startDate === startDate && r.endDate === endDate;
        return r.runType === 'MONTHLY' || !r.runType;
      })
      .forEach((r) => {
        r.payslips.forEach((p) => {
          if (!map.has(p.staffId)) {
            map.set(p.staffId, { run: r, payslip: p });
          } else {
            const existing = map.get(p.staffId)!;
            const rTime = new Date(r.finalizedAt || r.generatedAt).getTime();
            const eTime = new Date(existing.run.finalizedAt || existing.run.generatedAt).getTime();
            if (rTime > eTime) {
              map.set(p.staffId, { run: r, payslip: p });
            }
          }
        });
      });
    return Array.from(map.values());
  }, [payrollRuns, runType, selectedYear, selectedMonthNum, startDate, endDate, mode]);

  const generatedTotals = useMemo(() => {
    let basic = 0;
    let salaryGenerated = 0;
    let amountPaid = 0;
    let loanRepayment = 0;

    generatedPayslipRows.forEach(({ payslip: p }) => {
      basic += (p.effectiveBaseSalary ?? p.baseEarnings) || 0;
      salaryGenerated += p.netPayable || 0;
      amountPaid += p.paidAmount || 0;
      loanRepayment += p.advanceRecoveryAmount || 0;
    });

    return {
      basic: roundCurrency(basic),
      salaryGenerated: roundCurrency(salaryGenerated),
      amountPaid: roundCurrency(amountPaid),
      loanRepayment: roundCurrency(loanRepayment),
    };
  }, [generatedPayslipRows]);

  const handleSelectAll = () => {
    const unfinalized = branchStaff.filter((s) => !generatedStaffIdSet.has(s.id)).map((s) => s.id);
    setSelectedStaffIds(unfinalized);
  };

  const handleSelectNone = () => {
    setSelectedStaffIds([]);
  };

  const toggleStaffSelection = (id: string) => {
    if (generatedStaffIdSet.has(id)) {
      toast.info('This staff member already has a finalized salary for the selected period.');
      return;
    }
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((sid) => sid !== id) : [...prev, id]
    );
  };

  const handleFilter = async () => {
    if (!effectiveBranchId || effectiveBranchId === 'ALL') { toast.error('Please select a branch for this action.'); return; }
    try {
      setActionLoading(true);
      const targetMonth = runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7);
      setSelectedMonth(targetMonth);
      if (runType !== 'MONTHLY') {
        setSelectedYear(startDate.slice(0, 4));
        setSelectedMonthNum(startDate.slice(5, 7));
      }
      const [runs, staff, advances] = await Promise.all([
        salonService.getPayrollRuns(effectiveBranchId, undefined, user),
        salonService.getStaff(effectiveBranchId),
        salonService.getSalaryAdvances(effectiveBranchId),
      ]);
      setPayrollRuns(runs);
      setStaffList(staff);
      setSalaryAdvances(advances || []);
      setHasFiltered(true);

      const generatedStaffIds = new Set<string>();
      runs
        .filter((r) => r.status !== 'CANCELLED' && r.status !== 'DRAFT')
        .filter((r) => {
          if (runType === 'DAILY') return r.runType === 'DAILY' && r.startDate === startDate;
          if (runType === 'CUSTOM_RANGE') return r.runType === 'CUSTOM_RANGE' && r.startDate === startDate && r.endDate === endDate;
          return r.runType === 'MONTHLY' || !r.runType;
        })
        .forEach((r) => {
          r.payslips.forEach((p) => generatedStaffIds.add(p.staffId));
        });
      setSelectedStaffIds([]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to filter payroll data.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleGenerateSalary = async () => {
    if (!effectiveBranchId || effectiveBranchId === 'ALL') { toast.error('Please select a branch for this action.'); return; }
    if (!hasFiltered) {
      toast.error('Please click Filter first to view and select eligible staff.');
      return;
    }
    try {
      setActionLoading(true);
      const targetMonth = runType === 'MONTHLY' ? `${selectedYear}-${selectedMonthNum}` : startDate.slice(0, 7);
      const effStartDate = runType === 'MONTHLY' ? undefined : startDate;
      const effEndDate = runType === 'MONTHLY' ? undefined : (runType === 'DAILY' ? startDate : endDate);

      const preview = await salonService.generatePayrollPreview(
        effectiveBranchId,
        targetMonth,
        undefined,
        user,
        {
          runType,
          startDate: effStartDate,
          endDate: effEndDate,
          compensationType: 'ALL',
          staffIds: selectedStaffIds.length ? selectedStaffIds : undefined,
          includeDaily: true,
        }
      );
      // Save as DRAFT in database and state (do NOT immediately finalize!)
      setPayrollRuns((runs) => [preview, ...runs.filter((run) => run.id !== preview.id)]);
      toast.success(`Draft salary successfully generated for ${preview.employeeCount} staff! It is now saved in Drafts until finalized or deleted.`);
      navigate('/accounts/salary/manage');
      await loadData();

      // Immediately navigate to Manage Salaries page
      navigate('/accounts/salary/manage');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate salary.');
    } finally {
      setActionLoading(false);
    }
  };

  // Open open drawer for active user in current branch
  const activeUserOpenDrawer = useMemo(() => {
    return cashDrawers.find(
      (d) => d.branchId === effectiveBranchId && d.custodianUserId === user.id && d.status === 'OPEN'
    );
  }, [cashDrawers, effectiveBranchId, user.id]);

  // Generate Draft Preview
  const handleGeneratePreview = async () => {
    if (!effectiveBranchId || effectiveBranchId === 'ALL') { toast.error('Please select a branch for this action.'); return; }
    try {
      setActionLoading(true);
      const preview = await salonService.generatePayrollPreview(
        effectiveBranchId,
        selectedMonth,
        staffFilter !== 'ALL' ? staffFilter : undefined,
        user,
        {
          runType,
          compensationType: compTypeFilter as CompensationType | 'ALL',
          ...(runType !== 'MONTHLY' ? { startDate, endDate: runType === 'DAILY' ? startDate : endDate } : {}),
        }
      );
      setActiveDraft(preview);
      setShowPreviewModal(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate payroll preview.');
    } finally {
      setActionLoading(false);
    }
  };

  // Finalize Draft Payroll
  const handleFinalizePayroll = async () => {
    if (!activeDraft) return;
    try {
      setActionLoading(true);
      const finalized = await salonService.finalizePayroll(activeDraft.id, user);
      setPayrollRuns((runs) => [finalized, ...runs.filter((run) => run.id !== finalized.id)]);
      toast.success(
        `Payroll ${finalized.payrollNumber} successfully finalized! Total payable: Rs. ${finalized.totalPayable.toLocaleString()}. Inputs are now locked.`
      );
      setShowPreviewModal(false);
      setActiveDraft(null);
      navigate('/accounts/salary/manage');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to finalize payroll.');
    } finally {
      setActionLoading(false);
    }
  };

  // Open Payment Modal
  const openPaymentModal = (run: PayrollRun, ps?: PayslipRecord) => {
    setPaymentTargetRun(run);
    const targetPs = ps || run.payslips.find((p) => p.outstandingAmount > 0) || run.payslips[0];
    setPaymentTargetPayslip(targetPs);
    setPaymentForm({
      amount: targetPs ? Number(targetPs.outstandingAmount.toFixed(2)) : 0,
      method: 'CASH',
      onlineAccountId: onlineAccounts[0]?.id || '',
      reference: `Salary payment for ${targetPs?.staffName || 'staff'} (${selectedMonth})`,
    });
    setShowPaymentModal(true);
  };

  // Record Payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentTargetRun || !paymentTargetPayslip) return;

    const maxAllowed = Number(paymentTargetPayslip.outstandingAmount.toFixed(2));
    if (paymentForm.amount <= 0 || Number(paymentForm.amount.toFixed(2)) > maxAllowed) {
      toast.error(`Payment amount must be between 0.01 and Rs. ${formatSalaryNumber(paymentTargetPayslip.outstandingAmount)}`);
      return;
    }

    try {
      setActionLoading(true);
      await salonService.recordPayrollPayment(
        {
          payrollRunId: paymentTargetRun.id,
          payslipId: paymentTargetPayslip.id,
          amount: paymentForm.amount,
          method: paymentForm.method,
          onlineAccountId: paymentForm.method === 'ONLINE' ? paymentForm.onlineAccountId : undefined,
          reference: paymentForm.reference,
        },
        user
      );

      toast.success(`Successfully paid Rs. ${paymentForm.amount.toLocaleString()} to ${paymentTargetPayslip.staffName}!`);
      setShowPaymentModal(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Payment failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Open Manual Deduction Modal
  const openDeductionModal = (run: PayrollRun, ps: PayslipRecord) => {
    setDeductionTargetRun(run);
    setDeductionTargetPayslip(ps);
    setDeductionForm({
      amount: 0,
      title: 'Missed Attendance / Punch',
      notes: '',
    });
    setShowDeductionModal(true);
  };

  // Apply Manual Deduction
  const handleApplyDeduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deductionTargetPayslip || !deductionTargetRun) return;

    if (deductionForm.amount <= 0) {
      toast.error('Deduction amount must be greater than zero.');
      return;
    }

    if (deductionForm.amount > deductionTargetPayslip.outstandingAmount) {
      toast.error(`Deduction amount cannot exceed unpaid salary balance of Rs. ${deductionTargetPayslip.outstandingAmount.toLocaleString()}`);
      return;
    }

    if (!deductionForm.title.trim()) {
      toast.error('Deduction title or reason is required.');
      return;
    }

    try {
      setActionLoading(true);
      await salonService.addManualDeduction(
        deductionTargetPayslip.id,
        {
          amount: deductionForm.amount,
          title: deductionForm.title.trim(),
          notes: deductionForm.notes.trim() || undefined,
        },
        user
      );

      toast.success(`Successfully applied deduction of Rs. ${deductionForm.amount.toLocaleString()} for ${deductionTargetPayslip.staffName}!`);
      setShowDeductionModal(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply deduction.');
    } finally {
      setActionLoading(false);
    }
  };

  // Finalize a single staff member from a Draft Payroll Run
  const handleFinalizeDraftPayslip = async (runId: string, staffId: string, payslipId: string, staffName: string) => {
    try {
      setActionLoading(true);
      const finalized = await salonService.finalizePayroll(runId, user, { staffId, payslipId });
      toast.success(`${staffName}'s salary successfully finalized! Moved to Finalized Salary Register.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || `Failed to finalize ${staffName}'s salary.`);
    } finally {
      setActionLoading(false);
    }
  };

  // Finalize an active Draft Payroll Run
  const handleFinalizeDraftRun = async (runId: string) => {
    try {
      setActionLoading(true);
      const finalized = await salonService.finalizePayroll(runId, user);
      setPayrollRuns((runs) => [finalized, ...runs.filter((r) => r.id !== runId)]);
      toast.success(`Payroll ${finalized.payrollNumber} successfully finalized! Moved to Finalized Salary Register.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to finalize draft payroll.');
    } finally {
      setActionLoading(false);
    }
  };

  // Finalize all active draft runs for this period
  const handleFinalizeAllDraftRuns = async () => {
    try {
      setActionLoading(true);
      for (const dr of draftRuns) {
        await salonService.finalizePayroll(dr.id, user);
      }
      toast.success(`All ${draftRuns.length} draft payroll run(s) successfully finalized!`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to finalize draft payroll.');
    } finally {
      setActionLoading(false);
    }
  };

  // Discard / Delete all active draft runs for this period
  const handleDeleteAllDraftRuns = async () => {
    try {
      setActionLoading(true);
      for (const dr of draftRuns) {
        await salonService.cancelPayrollRun(dr.id, 'Draft deleted by admin', user);
      }
      toast.success('All draft salaries discarded and removed.');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete draft payroll.');
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel Unpaid Run(s) - All Delete
  const handleCancelRun = async () => {
    if (!cancelReason.trim()) return;
    try {
      setActionLoading(true);
      if (isCancellingAllMonthRuns) {
        const uniqueRunIds = Array.from(new Set(generatedPayslipRows.map((r) => r.run.id)));
        for (const rId of uniqueRunIds) {
          await salonService.cancelPayrollRun(rId, cancelReason, user);
        }
        toast.success(`All ${uniqueRunIds.length} payroll run(s) cancelled and attendance/overtime released.`);
      } else if (runToCancel) {
        await salonService.cancelPayrollRun(runToCancel.id, cancelReason, user);
        toast.success(`Payroll run ${runToCancel.payrollNumber} cancelled and attendance/overtime released.`);
      }
      setShowCancelModal(false);
      setRunToCancel(null);
      setIsCancellingAllMonthRuns(false);
      setCancelReason('');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel payroll run.');
    } finally {
      setActionLoading(false);
    }
  };

  // Delete Single Staff Salary
  const handleDeleteSinglePayslip = async () => {
    if (!payslipToDelete || !singleDeleteReason.trim()) return;
    try {
      setActionLoading(true);
      await salonService.cancelPayslip(payslipToDelete.payslip.id, singleDeleteReason, user);
      toast.success(`Salary for ${payslipToDelete.payslip.staffName} deleted successfully. Attendance and overtime locks released.`);
      setShowSingleDeleteModal(false);
      setPayslipToDelete(null);
      setSingleDeleteReason('');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete employee salary.');
    } finally {
      setActionLoading(false);
    }
  };

  // Exclude staff from draft preview before finalizing
  const handleRemoveStaffFromDraft = async (staffId: string) => {
    if (!activeDraft) return;
    const targetPs = activeDraft.payslips.find((p) => p.staffId === staffId);
    const updatedPayslips = activeDraft.payslips.filter((p) => p.staffId !== staffId);
    if (updatedPayslips.length === 0) {
      try {
        await salonService.cancelPayrollRun(activeDraft.id, 'Draft cleared', user);
      } catch (e) {
        // ignore
      }
      setActiveDraft(null);
      setShowPreviewModal(false);
      toast.success('All employees removed. Draft preview cleared.');
      return;
    }

    if (targetPs && targetPs.id) {
      try {
        await salonService.cancelPayslip(targetPs.id, 'Excluded from draft', user);
      } catch (e) {
        // ignore
      }
    }

    setActiveDraft({
      ...activeDraft,
      payslips: updatedPayslips,
      employeeCount: updatedPayslips.length,
      totalPayable: updatedPayslips.reduce((s, p) => s + (p.netPayable || 0), 0),
    });
    toast.success(`Removed ${targetPs?.staffName || 'employee'} from draft preview.`);
  };

  // Reverse Payment
  const handleReversePayment = async () => {
    if (!paymentToReverse || !reverseReason.trim()) return;
    try {
      setActionLoading(true);
      await salonService.reversePayrollPayment(paymentToReverse.id, reverseReason, user);
      toast.success(`Payment of Rs. ${paymentToReverse.amount.toLocaleString()} reversed. Funds restored to source balance.`);
      setPaymentToReverse(null);
      setReverseReason('');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reverse payment.');
    } finally {
      setActionLoading(false);
    }
  };

  // Save Policy Configuration
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      const updated = await salonService.updatePayrollPolicy(effectiveBranchId, policyForm, user);
      setPayrollPolicy(updated);
      toast.success('Payroll policy settings successfully updated.');
      setShowPolicyModal(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update payroll policy.');
    } finally {
      setActionLoading(false);
    }
  };

  // Export CSV
  const handleExportCSV = (run: PayrollRun) => {
    const headers = [
      'Payslip Number',
      'Employee Code',
      'Staff Name',
      'Compensation Type',
      'Period Type',
      'From Date',
      'To Date',
      'Base Earnings',
      'Leave Earnings',
      'Absence Deductions',
      'Late/Early Penalties',
      'Approved Overtime (Mins)',
      'Overtime Amount',
      'Holiday/Weekly-off Pay',
      'Allowances + Bonus',
      'Other Deductions',
      'Advance Recovery',
      'Gross Payable',
      'Total Deductions',
      'Net Salary',
      'Commission',
      'Combined Net Payable',
      'Paid Amount',
      'Outstanding',
      'Status',
    ];

    const rows = run.payslips.map((p) => [
      p.payslipNumber,
      p.employeeCode,
      `"${p.staffName}"`,
      p.compensationType,
      run.runType || 'MONTHLY',
      run.startDate || `${run.month}-01`,
      run.endDate || run.month,
      p.baseEarnings,
      p.leaveEarnings,
      p.absenceDeductions,
      p.attendancePenaltyDeductions,
      p.approvedOvertimeMinutes,
      p.approvedOvertimeAmount,
      p.holidayEarnings ?? 0,
      p.allowancesTotal ?? 0,
      p.otherDeductions ?? 0,
      p.advanceRecoveryAmount ?? 0,
      p.grossPayable,
      p.totalDeductions,
      p.salaryNetPayable ?? p.netPayable,
      p.commissionPayable ?? 0,
      p.netPayable,
      p.paidAmount,
      p.outstandingAmount,
      p.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Payroll_${run.payrollNumber}_${run.month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (FROSTED GLASS CONTAINER) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Banknote className="w-5 h-5 text-[#B82E69]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                {mode === 'MANAGE'
                  ? 'Manage Salaries'
                  : mode === 'ALLOWANCES'
                  ? 'Allowances & Adjustments'
                  : 'Generate Salary'}
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                {mode === 'MANAGE'
                  ? 'Review finalized salary disbursements, payslips, and payment records'
                  : mode === 'ALLOWANCES'
                  ? 'Staff bonuses, allowances, and compensation adjustments'
                  : 'Select branch, month and year to filter and generate staff salaries'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/accounts/salary/generate')}
            className={`h-9 px-3.5 font-semibold gap-1.5 shadow-xs text-xs rounded-xl transition-all flex items-center cursor-pointer ${
              mode === 'GENERATE'
                ? 'bg-[#B82E69] text-white shadow-[#B82E69]/20 shadow-md'
                : 'bg-white/80 hover:bg-white text-slate-700 border border-white/80'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Generate Salary</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/accounts/salary/manage')}
            className={`h-9 px-3.5 font-semibold gap-1.5 shadow-xs text-xs rounded-xl transition-all flex items-center cursor-pointer ${
              mode === 'MANAGE'
                ? 'bg-[#B82E69] text-white shadow-[#B82E69]/20 shadow-md'
                : 'bg-white/80 hover:bg-white text-slate-700 border border-white/80'
            }`}
          >
            <Banknote className="w-3.5 h-3.5" />
            <span>Manage Salaries</span>
            {generatedPayslipRows.length > 0 && (
              <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                mode === 'MANAGE' ? 'bg-white/20 text-white' : 'bg-[#FDF2F5] text-[#B82E69]'
              }`}>
                {generatedPayslipRows.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* GENERATE SALARY VIEW */}
      {mode === 'GENERATE' && (
        <div className="space-y-6">
          {/* Top Form & Staff Selection */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Filter Card */}
            <div className="lg:col-span-4 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] space-y-4">
              <h2 className="text-base font-bold text-[#18191B] pb-2 border-b border-white/80 flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#B82E69]" />
                <span>Payroll Run Settings</span>
              </h2>

              {/* Branch */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Branch <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <MapPin className="w-4 h-4 text-[#B82E69]" />
                  </div>
                  <select
                    value={effectiveBranchId}
                    onChange={(e) => {
                      updateSelectedBranch(e.target.value);
                      setHasFiltered(false);
                    }}
                    disabled={user.role !== 'SUPER_ADMIN'}
                    className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {user.role === 'SUPER_ADMIN' && <option value="">Select branch for this action</option>}
                    {allBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Payroll Type */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Payroll Type <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-white/80 border border-white/80 rounded-xl shadow-2xs">
                  <button
                    type="button"
                    onClick={() => {
                      setRunType('MONTHLY');
                      setHasFiltered(false);
                    }}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      runType === 'MONTHLY'
                        ? 'bg-[#B82E69] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRunType('DAILY');
                      setHasFiltered(false);
                    }}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      runType === 'DAILY'
                        ? 'bg-[#B82E69] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRunType('CUSTOM_RANGE');
                      setHasFiltered(false);
                    }}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      runType === 'CUSTOM_RANGE'
                        ? 'bg-[#B82E69] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    Custom
                  </button>
                </div>
              </div>

              {/* Monthly Date Controls */}
              {runType === 'MONTHLY' && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Month <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Calendar className="w-4 h-4 text-[#B82E69]" />
                      </div>
                      <select
                        value={selectedMonthNum}
                        onChange={(e) => {
                          setSelectedMonthNum(e.target.value);
                          setSelectedMonth(`${selectedYear}-${e.target.value}`);
                          setHasFiltered(false);
                        }}
                        className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all cursor-pointer"
                      >
                        {MONTHS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Year <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Calendar className="w-4 h-4 text-[#B82E69]" />
                      </div>
                      <select
                        value={selectedYear}
                        onChange={(e) => {
                          setSelectedYear(e.target.value);
                          setSelectedMonth(`${e.target.value}-${selectedMonthNum}`);
                          setHasFiltered(false);
                        }}
                        className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all cursor-pointer"
                      >
                        {YEARS.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Daily Date Controls */}
              {runType === 'DAILY' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Date <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Calendar className="w-4 h-4 text-[#B82E69]" />
                    </div>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setEndDate(e.target.value);
                        setHasFiltered(false);
                      }}
                      className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Custom Range Date Controls */}
              {runType === 'CUSTOM_RANGE' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Start Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setHasFiltered(false);
                      }}
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      End Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setHasFiltered(false);
                      }}
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 space-y-2.5">
                <button
                  type="button"
                  onClick={handleFilter}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <Filter className="w-4 h-4" /> Filter Staff
                </button>

                <button
                  type="button"
                  onClick={handleGenerateSalary}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 bg-[#B82E69] hover:bg-[#A02358] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <Briefcase className="w-4 h-4" /> Generate Salary
                </button>
              </div>
            </div>

            {/* Right Eligible Staff Card */}
            <div className="lg:col-span-8 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col min-h-[420px]">
              {!hasFiltered ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] mb-4">
                    <Filter className="w-7 h-7 stroke-[1.5]" />
                  </div>
                  <p className="text-slate-800 text-sm font-bold mb-1">
                    Please apply filters to view staff
                  </p>
                  <p className="text-slate-500 text-xs max-w-sm">
                    Select branch, payroll type, month and year on the left, then click <strong>Filter Staff</strong> to load eligible employees.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-white/80 gap-3">
                    <div className="text-xs sm:text-sm font-bold text-slate-800">
                      Staff Code | <span className="text-[#B82E69]">Name</span> | Designation ({branchStaff.length})
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="h-8 px-3 text-xs font-semibold rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs transition-all cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectNone}
                        className="h-8 px-3 text-xs font-semibold rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs transition-all cursor-pointer"
                      >
                        Select None
                      </button>
                    </div>
                  </div>

                  {/* Staff List */}
                  <div className="mt-4 flex-1 overflow-y-auto max-h-[360px] space-y-2.5 pr-1">
                    {branchStaff.length === 0 ? (
                      <div className="p-12 text-center text-slate-400 text-sm">
                        No active staff found for this branch.
                      </div>
                    ) : (
                      branchStaff.map((s) => {
                        const isSelected = selectedStaffIds.includes(s.id);
                        const isGenerated = generatedStaffIdSet.has(s.id);
                        const loan = staffLoanMap.get(s.id);

                        return (
                          <div
                            key={s.id}
                            onClick={() => toggleStaffSelection(s.id)}
                            className={`p-3.5 rounded-2xl border transition-all shadow-2xs flex items-center justify-between text-xs sm:text-sm select-none ${
                              isGenerated
                                ? 'bg-emerald-50/50 border-emerald-200/80 cursor-default opacity-85'
                                : isSelected
                                ? 'border-[#B82E69]/40 bg-[#FDF2F5]/60 hover:bg-[#FDF2F5] cursor-pointer'
                                : 'border-white/80 bg-white/70 hover:bg-white cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <input
                                type="checkbox"
                                checked={isSelected && !isGenerated}
                                disabled={isGenerated}
                                onChange={() => {}}
                                className={`w-4 h-4 rounded text-[#B82E69] focus:ring-[#B82E69]/20 ${
                                  isGenerated ? 'cursor-not-allowed opacity-40' : 'cursor-pointer pointer-events-none'
                                }`}
                              />
                              <span className="text-slate-600 font-mono font-medium">
                                {s.employeeCode || `EMP-${s.id.slice(-3).toUpperCase()}`}
                              </span>
                              <span className="text-slate-300">|</span>
                              <span className={`font-bold ${isGenerated ? 'text-emerald-800' : 'text-[#B82E69]'}`}>{s.name}</span>
                              <span className="text-slate-300">|</span>
                              <span className="text-slate-600 capitalize">
                                {s.designation || s.roleTitle || 'Staff'}
                              </span>
                              {loan && (
                                <span className="ml-1 px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold rounded-full shadow-2xs font-mono tabular-nums">
                                  Loan: {roundCurrency(loan.recoveryPerMonth || loan.balance)}.00/instalment
                                </span>
                              )}
                            </div>

                            <div className="pl-3">
                              {isGenerated ? (
                                <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100/80 text-emerald-800 border border-emerald-300/80 text-xs font-bold rounded-full shadow-2xs">
                                  <span>✓ Already Finalized</span>
                                </span>
                              ) : (
                                <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
                                  Not Generated
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      )}

      {mode === 'ALLOWANCES' && (
        <PayrollExtrasPanel
          view="INPUTS"
          branchId={effectiveBranchId}
          month={selectedMonth}
          staffList={staffList}
          onlineAccounts={onlineAccounts}
          hasOpenDrawer={!!activeUserOpenDrawer}
          onFeedback={(type, message) => {
            if (type === 'error') toast.error(message);
            else toast.success(message);
          }}
        />
      )}

      {/* MANAGE SALARIES VIEW */}
      {mode === 'MANAGE' && (
        <div className="space-y-6">
          {/* Top Bar for Manage Salaries */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {user.role === 'SUPER_ADMIN' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Branch:</span>
                  <select
                    value={effectiveBranchId}
                    onChange={(e) => updateSelectedBranch(e.target.value)}
                    className="text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-1.5 text-slate-800 shadow-2xs font-medium transition-all cursor-pointer"
                  >
                    {allBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Month:</span>
                <select
                  value={selectedMonthNum}
                  onChange={(e) => {
                    updateSelectedMonth(selectedYear, e.target.value);
                  }}
                  className="text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-1.5 text-slate-800 shadow-2xs font-medium transition-all cursor-pointer"
                >
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    updateSelectedMonth(e.target.value, selectedMonthNum);
                  }}
                  className="text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-1.5 text-slate-800 shadow-2xs font-medium transition-all cursor-pointer"
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FDF2F5] text-[#B82E69] border border-white/80 text-xs font-bold rounded-xl shadow-2xs">
                {effectiveBranchName} • {periodLabel}
              </span>
            </div>

            <button
              onClick={() => navigate('/accounts/salary/generate')}
              className="h-9 px-4 font-semibold gap-1.5 shadow-xs text-xs sm:text-sm bg-[#B82E69] hover:bg-[#A02358] text-white rounded-xl transition-all flex items-center cursor-pointer shrink-0 self-start md:self-auto"
            >
              <Briefcase className="w-4 h-4" />
              <span>Generate Salary</span>
            </button>
          </div>

          {/* Draft Salaries Table - Persistent until finalized or deleted */}
          {draftPayslipRows.length > 0 && (
            <div className="rounded-[24px] border border-amber-200/90 bg-white/85 backdrop-blur-2xl shadow-[0_10px_35px_rgba(245,158,11,0.05),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
              {/* Draft Gradient Banner */}
              <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-amber-800 text-white px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
                  <Clock className="w-4 h-4 stroke-[2.5]" />
                  <span>Draft Salary Register (Pending Finalization)</span>
                  <span className="text-[11px] font-bold bg-white/20 text-white px-2.5 py-0.5 rounded-full ml-1">
                    {draftPayslipRows.length} Draft Payslips
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteAllDraftRuns}
                    disabled={actionLoading}
                    title="Discard all draft salaries"
                    className="px-3 py-1.5 bg-white/15 hover:bg-rose-600 text-white text-xs font-semibold rounded-xl border border-white/25 shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Discard All Drafts</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleFinalizeAllDraftRuns}
                    disabled={actionLoading}
                    title="Finalize and lock all draft salaries"
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Finalize All Drafts</span>
                  </button>
                </div>
              </div>

              <div className="bg-transparent overflow-x-auto">
                <table className="report-records w-full text-left border-collapse min-w-[1100px] text-xs font-sans">
                  <thead>
                    <tr className="bg-amber-50/70 text-amber-900 text-[11px] font-semibold border-b border-amber-100 tracking-wider">
                      <th className="py-3.5 px-4 text-left whitespace-nowrap">Staff</th>
                      <th className="py-3.5 px-3 text-center whitespace-nowrap">{runType === 'MONTHLY' ? 'Salary Month' : 'Period'}</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Present Days</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Absent Days</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Paid Leave</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Unpaid Leave</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Holidays</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Weekly Offs</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">OT Hours</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Basic</th>
                      <th className="py-3.5 px-3 text-right whitespace-nowrap">Late/Early Cut</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Loan Recovery</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Salary Generated</th>
                      <th className="py-3.5 px-3 text-center whitespace-nowrap">Status</th>
                      <th className="py-3.5 px-4 text-center whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-amber-100 text-xs">
                    {draftPayslipRows.map(({ run, payslip: p }) => {
                      const periodDisplay =
                        run.runType === 'DAILY'
                          ? run.startDate || run.month
                          : run.runType === 'CUSTOM_RANGE'
                          ? `${run.startDate} to ${run.endDate}`
                          : `${run.startDate || `${run.month}-01`} to ${run.endDate || run.month}`;

                      return (
                        <tr key={`${run.id}_${p.id}`} className="hover:bg-amber-50/30 transition-colors border-b border-dashed border-amber-100">
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="font-semibold text-slate-800">{p.staffName}</div>
                            <div className="text-[11px] text-slate-400">
                              {p.employeeCode || p.staffId} • {p.designation}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 text-center whitespace-nowrap font-medium text-slate-600">
                            {periodDisplay}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-slate-700">
                            {p.presentDays ?? 0}
                            {p.workedWeeklyOffDays ? (
                              <span className="block text-[9px] text-indigo-600 font-normal">
                                +{p.workedWeeklyOffDays} off-work
                              </span>
                            ) : null}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-rose-600">
                            {p.absentDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-emerald-600">
                            {p.paidLeaveDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-amber-600">
                            {p.unpaidLeaveDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-purple-600">
                            {p.paidHolidayDays ?? p.holidayDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-blue-600">
                            {p.paidWeeklyOffDays ?? p.weeklyOffDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-indigo-700">
                            {(p.approvedOvertimeHours ?? (p.approvedOvertimeMinutes ? p.approvedOvertimeMinutes / 60 : 0)).toFixed(1)}h
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {formatSalaryNumber((p.effectiveBaseSalary ?? p.baseEarnings) || 0)}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono tabular-nums text-rose-600 font-medium">
                            {(p.lateEarlyDeductions || p.attendancePenaltyDeductions || 0) > 0
                              ? `-${formatSalaryNumber(p.lateEarlyDeductions || p.attendancePenaltyDeductions || 0)}`
                              : '0.00'}
                          </td>
                          <td
                            className="py-3.5 px-4 text-right font-mono tabular-nums text-rose-600 font-medium"
                            title={
                              p.advanceRecoveries && p.advanceRecoveries.length > 0
                                ? p.advanceRecoveries
                                    .map(
                                      (a: any) =>
                                        `${a.advanceNumber || 'Loan'}: Rs. ${formatSalaryNumber(a.amount)} (Remaining: Rs. ${formatSalaryNumber(a.balanceAfter)})`
                                    )
                                    .join('\n')
                                : undefined
                            }
                          >
                            {(p.advanceRecoveryAmount || 0) > 0
                              ? `-${formatSalaryNumber(p.advanceRecoveryAmount || 0)}`
                              : '0.00'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-amber-800 font-bold">
                            {formatSalaryNumber(p.netPayable || 0)}
                          </td>
                          <td className="py-3.5 px-3 text-center whitespace-nowrap">
                            {p.canFinalize === false ? (
                              <span
                                className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                                title={p.blockReason}
                              >
                                BLOCKED
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                                DRAFT
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleFinalizeDraftPayslip(run.id, p.staffId, p.id, p.staffName)}
                                disabled={actionLoading || p.canFinalize === false}
                                title={p.canFinalize === false ? (p.blockReason || 'Cannot finalize payroll') : `Finalize ${p.staffName}'s salary`}
                                className={`px-3 py-1 text-white text-xs font-semibold rounded-xl shadow-2xs transition-all whitespace-nowrap flex items-center gap-1 ${
                                  p.canFinalize === false
                                    ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                                    : 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer'
                                }`}
                              >
                                <Lock className="w-3 h-3" />
                                <span>Finalize</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveStaffFromDraft(p.staffId)}
                                disabled={actionLoading}
                                title={`Delete ${p.staffName} from draft`}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Generated Salaries Table - Only displayed if salaries have been generated */}
          {generatedPayslipRows.length > 0 ? (
            <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
              {/* Gradient Banner */}
              <div className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
                  <Banknote className="w-4 h-4 stroke-[2.5]" />
                  <span>Finalized Salary Register</span>
                  <span className="text-[11px] font-bold bg-white/20 text-white px-2.5 py-0.5 rounded-full ml-1">
                    {generatedPayslipRows.length} Payslips
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCancellingAllMonthRuns(true);
                      setRunToCancel(generatedPayslipRows[0]?.run || null);
                      setCancelReason('');
                      setShowCancelModal(true);
                    }}
                    title="Delete / Cancel all finalized salaries in this list"
                    className="px-3 py-1.5 bg-white/15 hover:bg-red-600/90 text-white text-xs font-semibold rounded-xl border border-white/25 shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete All Salaries</span>
                  </button>
                </div>
              </div>

              <div className="bg-transparent overflow-x-auto">
                <table className="report-records w-full text-left border-collapse min-w-[1100px] text-xs font-sans">
                  <thead>
                    <tr className="bg-[#FAF8F9]/80 text-[#78616C] text-[11px] font-semibold border-b border-white/80 tracking-wider">
                      <th className="py-3.5 px-4 text-left whitespace-nowrap">Staff</th>
                      <th className="py-3.5 px-3 text-center whitespace-nowrap">{runType === 'MONTHLY' ? 'Salary Month' : 'Period'}</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Present Days</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Absent Days</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Paid Leave</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Unpaid Leave</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Holidays</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">Weekly Offs</th>
                      <th className="py-3.5 px-2 text-center whitespace-nowrap">OT Hours</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Basic</th>
                      <th className="py-3.5 px-3 text-right whitespace-nowrap">Late/Early Cut</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Loan Recovery</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Salary Generated</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Amount Paid</th>
                      <th className="py-3.5 px-3 text-center whitespace-nowrap">Status</th>
                      <th className="py-3.5 px-4 text-center whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-200 text-xs">
                    {generatedPayslipRows.map(({ run, payslip: p }) => {
                      const isPaid = p.outstandingAmount <= 0 && p.paidAmount > 0;
                      const compLabel =
                        p.compensationType === 'MONTHLY_SALARY'
                          ? 'Monthly'
                          : p.compensationType === 'MONTHLY_PLUS_COMMISSION'
                          ? 'Monthly + Commission'
                          : p.compensationType === 'DAILY_SALARY'
                          ? 'Daily'
                          : p.compensationType === 'DAILY_PLUS_COMMISSION'
                          ? 'Daily + Commission'
                          : 'Commission';

                      const periodDisplay =
                        run.runType === 'DAILY'
                          ? run.startDate || run.month
                          : run.runType === 'CUSTOM_RANGE'
                          ? `${run.startDate} to ${run.endDate}`
                          : `${run.startDate || `${run.month}-01`} to ${run.endDate || run.month}`;

                      return (
                        <tr key={`${run.id}_${p.id}`} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="font-semibold text-slate-800">{p.staffName}</div>
                            <div className="text-[11px] text-slate-400">
                              {p.employeeCode || p.staffId} • {p.designation || compLabel}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 text-center whitespace-nowrap font-medium text-slate-600">
                            {periodDisplay}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-slate-700">
                            {p.presentDays ?? 0}
                            {p.workedWeeklyOffDays ? (
                              <span className="block text-[9px] text-indigo-600 font-normal">
                                +{p.workedWeeklyOffDays} off-work
                              </span>
                            ) : null}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-rose-600">
                            {p.absentDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-emerald-600">
                            {p.paidLeaveDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-amber-600">
                            {p.unpaidLeaveDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-purple-600">
                            {p.paidHolidayDays ?? p.holidayDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-blue-600">
                            {p.paidWeeklyOffDays ?? p.weeklyOffDays ?? 0}
                          </td>
                          <td className="py-3.5 px-2 text-center font-mono tabular-nums text-indigo-700">
                            {(p.approvedOvertimeHours ?? (p.approvedOvertimeMinutes ? p.approvedOvertimeMinutes / 60 : 0)).toFixed(1)}h
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {formatSalaryNumber((p.effectiveBaseSalary ?? p.baseEarnings) || 0)}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono tabular-nums text-rose-600 font-medium">
                            {(p.lateEarlyDeductions || p.attendancePenaltyDeductions || 0) > 0
                              ? `-${formatSalaryNumber(p.lateEarlyDeductions || p.attendancePenaltyDeductions || 0)}`
                              : '0.00'}
                          </td>
                          <td
                            className="py-3.5 px-4 text-right font-mono tabular-nums text-rose-600 font-medium"
                            title={
                              p.advanceRecoveries && p.advanceRecoveries.length > 0
                                ? p.advanceRecoveries
                                    .map(
                                      (a: any) =>
                                        `${a.advanceNumber || 'Loan'}: Rs. ${formatSalaryNumber(a.amount)} (Remaining: Rs. ${formatSalaryNumber(a.balanceAfter)})`
                                    )
                                    .join('\n')
                                : undefined
                            }
                          >
                            {(p.advanceRecoveryAmount || 0) > 0
                              ? `-${formatSalaryNumber(p.advanceRecoveryAmount || 0)}`
                              : '0.00'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#B82E69] font-bold">
                            {formatSalaryNumber(p.netPayable || 0)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-emerald-700 font-medium">
                            {formatSalaryNumber(p.paidAmount || 0)}
                          </td>
                          <td className="py-3.5 px-3 text-center whitespace-nowrap">
                            <span
                              className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                                isPaid
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : p.paidAmount > 0
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {isPaid ? 'PAID' : p.paidAmount > 0 ? 'PARTIAL' : 'UNPAID'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openPaymentModal(run, p)}
                                disabled={isPaid}
                                className="px-3 py-1 bg-[#B82E69] hover:bg-[#A02358] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-2xs transition-all whitespace-nowrap cursor-pointer"
                              >
                                Make Payment
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeductionModal(run, p)}
                                disabled={run.status !== 'DRAFT' || p.outstandingAmount <= 0}
                                title="Deductions must be entered before finalization"
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold rounded-xl shadow-2xs transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer"
                              >
                                <MinusCircle className="w-3.5 h-3.5" />
                                Deduct
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPayslipToDelete({ run, payslip: p });
                                  setSingleDeleteReason('');
                                  setShowSingleDeleteModal(true);
                                }}
                                title={`Delete Salary for ${p.staffName}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  <tfoot className="bg-[#FAF8F9]/80 border-t border-white/80 font-sans text-xs">
                    <tr className="font-bold text-slate-800">
                      <td colSpan={9} className="py-3.5 px-4 text-right uppercase tracking-wider text-[11px] font-bold">
                        Total:
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800">
                        {generatedTotals.basic.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#B82E69] font-extrabold text-sm">
                        {generatedTotals.salaryGenerated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-emerald-700 font-bold">
                        {generatedTotals.amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                        {generatedTotals.loanRepayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-12 text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] mx-auto mb-2">
                <Calendar className="w-7 h-7 stroke-[1.5]" />
              </div>
              <h3 className="text-base font-bold text-[#18191B]">
                No Salaries Generated for {effectiveBranchName} ({periodLabel})
              </h3>
              <p className="text-xs text-[#78616C] font-medium max-w-md mx-auto">
                Salary has not been generated for this period yet. Click below to select staff and generate salaries.
              </p>
              <button
                onClick={() => navigate('/accounts/salary/generate')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#B82E69] hover:bg-[#A02358] text-white font-semibold rounded-xl text-xs sm:text-sm shadow-xs transition-all cursor-pointer"
              >
                <Briefcase className="w-4 h-4" />
                <span>Go to Generate Salary</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: PREVIEW & FINALIZATION MODAL                                     */}
      {/* ========================================================================= */}
      {showPreviewModal && activeDraft && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-[90rem] max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Payroll Preview: {activeDraft.startDate || activeDraft.month} {activeDraft.endDate && activeDraft.endDate !== activeDraft.startDate ? `to ${activeDraft.endDate}` : ''} ({activeDraft.branchName})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Draft calculations based on finalized canonical attendance and approved overtime. Money does not move.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Blocking issues banner */}
              {activeDraft.payslips.some((p) => p.canFinalize === false) && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="font-bold text-rose-900">Finalization Blocked</h4>
                    <p className="text-rose-700">
                      One or more employees have overlapping salary days or negative net
                      salary entitlement. Review adjustments before finalizing.
                    </p>
                  </div>
                </div>
              )}

              {/* Table */}
              <p className="text-xs text-slate-600">Base + Paid Leave/Holidays + OT + Allowances + Commission − Deductions − Loan = Net Payable. Finalization reserves commission; payment settles it.</p>
              <div className="border border-slate-200 rounded-2xl overflow-x-auto">
                <table className="report-records w-full text-left">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Employee</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Present Days</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Absent Days</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Paid Leave</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Unpaid Leave</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Holidays</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Weekly Offs</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">OT Hours</th>
                      <th className="py-2.5 px-3 text-right">Base Earnings</th>
                      <th className="py-2.5 px-3 text-right">Paid Leave</th>
                      <th className="py-2.5 px-3 text-right">Absence Ded.</th>
                      <th className="py-2.5 px-3 text-right">Late/Early Cut</th>
                      <th className="py-2.5 px-3 text-right">Overtime</th>
                      <th className="py-2.5 px-3 text-right">Allow./Bonus/Holiday</th>
                      
                      <th className="py-2.5 px-3 text-right">Other Ded.</th>
                      <th className="py-2.5 px-3 text-right">Loan Recovery</th>
                      <th className="py-2.5 px-3 text-right font-bold">Net Payable</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeDraft.payslips.map((p) => (
                      <tr
                        key={p.staffId}
                        className={!p.canFinalize ? 'bg-rose-50/50' : 'hover:bg-slate-50 transition-colors'}
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{p.staffName}</div>
                          <div className="text-[10px] text-slate-400">{p.employeeCode}</div>
                          {!p.canFinalize && (
                            <div className="text-[10px] text-rose-600 font-medium mt-0.5">{p.blockReason}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px]">
                            {p.compensationType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono font-medium text-slate-800">
                          {p.presentDays}
                          {p.workedWeeklyOffDays ? (
                            <span className="block text-[9px] text-indigo-600 font-normal">
                              +{p.workedWeeklyOffDays} off-work
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-rose-600">
                          {p.absentDays}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-emerald-600">
                          {p.paidLeaveDays}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-amber-600">
                          {p.unpaidLeaveDays}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-purple-600">
                          {p.paidHolidayDays ?? (p as any).holidayDays ?? 0}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-blue-600">
                          {p.paidWeeklyOffDays ?? (p as any).weeklyOffDays ?? 0}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-indigo-700">
                          {(p.approvedOvertimeHours ?? (p.approvedOvertimeMinutes ? p.approvedOvertimeMinutes / 60 : 0)).toFixed(1)}h
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium">Rs. {formatSalaryNumber(p.baseEarnings)}<BaseExplanation payslip={p} /></td>
                        <td className="py-2.5 px-3 text-right text-emerald-600">{money(p.leaveEarnings, '+')}</td>
                        <td className="py-2.5 px-3 text-right text-rose-600">
                          {p.absenceDeductions > 0 ? `-Rs. ${formatSalaryNumber(p.absenceDeductions)}` : '0'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-600">
                          {money((p as any).lateEarlyDeductions || p.attendancePenaltyDeductions, '-')}
                        </td>
                        <td className="py-2.5 px-3 text-right text-indigo-600">
                          {p.approvedOvertimeAmount > 0 ? `+Rs. ${formatSalaryNumber(p.approvedOvertimeAmount)}` : '0'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-600">{money(plusExtras(p), '+')}</td>
                        
                        <td className="py-2.5 px-3 text-right text-rose-600">{money(p.otherDeductions ?? 0, '-')}</td>
                        <td className="py-2.5 px-3 text-right text-rose-600">{money(p.advanceRecoveryAmount ?? 0, '-')}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          Rs. {formatSalaryNumber(p.netPayable)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {p.canFinalize ? (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-semibold">
                              Ready
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[10px] font-semibold">
                              Blocked
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveStaffFromDraft(p.staffId)}
                            title={`Exclude ${p.staffName} from draft`}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total Summary */}
              <div className="flex justify-end">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 w-72 space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span>Total Employees:</span>
                    <span className="font-semibold text-slate-900">{activeDraft.employeeCount}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Gross Salary:</span>
                    <span className="font-semibold text-slate-900">
                      Rs.{' '}
                      {activeDraft.payslips
                        .reduce((sum, p) => sum + p.grossPayable, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Deductions:</span>
                    <span className="font-semibold text-rose-600">
                      -Rs.{' '}
                      {activeDraft.payslips
                        .reduce((sum, p) => sum + p.totalDeductions, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="border-t border-slate-200 pt-1.5 flex justify-between font-bold text-sm text-slate-900">
                    <span>Total Net Payable:</span>
                    <span className="text-indigo-600">Rs. {activeDraft.totalPayable.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Finalizing freezes attendance snapshots, overtime IDs, and marks payable. Money is paid separately.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-medium"
                >
                  Close
                </button>
                <button
                  onClick={handleFinalizePayroll}
                  disabled={actionLoading || activeDraft.payslips.some((p) => !p.canFinalize)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-sm flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  Finalize & Lock Payroll Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: DETAILED CALCULATION BREAKDOWN MODAL                             */}
      {/* ========================================================================= */}
      {showDetailsModal && selectedPayslip && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-x-hidden overflow-y-auto flex flex-col max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Payslip Calculation: {selectedPayslip.staffName}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedPayslip.payslipNumber} • Period: {selectedPayslip.startDate || selectedPayslip.month}{selectedPayslip.endDate && selectedPayslip.endDate !== selectedPayslip.startDate ? ` to ${selectedPayslip.endDate}` : ''} • {selectedPayslip.compensationType}
                </p>
              </div>
              <button onClick={() => setShowDetailsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
              {/* Formula & Policy banner */}
              <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-100 space-y-2">
                <span className="font-semibold text-indigo-900 text-sm">Policy & Formula Applied:</span>
                <p className="font-mono text-indigo-800 bg-white/80 p-2 rounded border border-indigo-200">
                  {selectedPayslip.calculationDetails.formula}
                </p>
                <div className="grid grid-cols-2 gap-2 text-indigo-900">
                  <div>
                    {selectedPayslip.compensationType?.startsWith('DAILY')
                      ? `Contract Model: ${selectedPayslip.calculationDetails.divisorRule || 'Strict Worked Days'}`
                      : `Absence Divisor: ${selectedPayslip.calculationDetails.divisorRule || `Actual Calendar Days (/${selectedPayslip.calculationDetails.divisorUsed})`}`}
                  </div>
                  <div>
                    {selectedPayslip.compensationType?.startsWith('DAILY')
                      ? `Daily Rate: ${formatCurrency(selectedPayslip.calculationDetails.dailyRateUsed || selectedPayslip.effectiveDailyRate)}/day`
                      : `Deduction Rate: ${formatCurrency(selectedPayslip.calculationDetails.dailyRateUsed || selectedPayslip.effectiveDailyRate)}/day`}
                  </div>
                  <div className="col-span-2"><BaseExplanation payslip={selectedPayslip} /></div>
                  {selectedPayslip.calculationDetails.prorationApplied && (
                    <div className="col-span-2 text-amber-700 font-medium">
                      {selectedPayslip.calculationDetails.prorationFormula || 'Proration applied (joined/left mid-month)'}
                    </div>
                  )}
                </div>
              </div>

              {/* Base Salary & Proration Breakdown */}
              <div className="border border-slate-100 rounded-xl p-4 space-y-2">
                <h4 className="font-semibold text-slate-800 text-sm">Base Salary & Proration</h4>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-700">
                    <span>Contractual Base Salary:</span>
                    <span className="font-semibold text-slate-900">Rs. {(selectedPayslip.effectiveBaseSalary ?? selectedPayslip.baseEarnings).toLocaleString()}</span>
                  </div>
                  {selectedPayslip.calculationDetails?.prorationApplied && (
                    <div className="flex justify-between text-amber-700 bg-amber-50/70 p-2 rounded-lg">
                      <div>
                        <span className="font-medium">Proration Adjustment:</span>
                        <span className="block text-[11px] text-amber-600">{selectedPayslip.calculationDetails.prorationFormula}</span>
                      </div>
                      <span className="font-semibold">
                        -Rs. {Math.max(0, (selectedPayslip.effectiveBaseSalary || 0) - selectedPayslip.baseEarnings).toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between bg-slate-50 p-2 rounded-lg font-medium text-slate-800">
                    <span>Earned Base Salary:</span>
                    <span className="font-bold text-slate-900">Rs. {selectedPayslip.baseEarnings.toLocaleString()}</span>
                  </div>
                  {Boolean(selectedPayslip.previouslyPaidCustomSalary && selectedPayslip.previouslyPaidCustomSalary > 0) && (
                    <div className="flex justify-between text-indigo-700 bg-indigo-50/70 p-2 rounded-lg">
                      <div>
                        <span className="font-medium">Previously Paid (Custom Salary):</span>
                        <span className="block text-[11px] text-indigo-600">Deducted from monthly payroll to prevent duplicate payout</span>
                      </div>
                      <span className="font-semibold">
                        -Rs. {Number(selectedPayslip.previouslyPaidCustomSalary).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Attendance metrics */}
              <div className="border border-slate-100 rounded-xl p-4 space-y-2">
                <h4 className="font-semibold text-slate-800 text-sm">Attendance Summary</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-slate-400 block text-[11px]">Present Days</span>
                    <span className="text-sm font-bold text-slate-800">{selectedPayslip.presentDays}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-slate-400 block text-[11px]">Paid Leave</span>
                    <span className="text-sm font-bold text-emerald-600">{selectedPayslip.paidLeaveDays}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-slate-400 block text-[11px]">Absent Days</span>
                    <span className="text-sm font-bold text-rose-600">{selectedPayslip.absentDays}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-slate-400 block text-[11px]">Half Day</span>
                    <span className="text-sm font-bold text-amber-700">{selectedPayslip.halfDayDays ?? 'N/A'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <span className="text-slate-400 block text-[11px]">Unpaid Leave</span>
                    <span className="text-sm font-bold text-rose-600">{selectedPayslip.unpaidLeaveDays ?? 0}</span>
                  </div>
                  <div className="p-2 bg-rose-50/70 border border-rose-100 rounded-lg">
                    <span className="text-rose-600 block text-[11px] font-medium">Late / Early Cut</span>
                    <span className="text-sm font-bold text-rose-700">
                      {(selectedPayslip.lateEarlyDeductions || selectedPayslip.attendancePenaltyDeductions || 0) > 0
                        ? `-Rs. ${(selectedPayslip.lateEarlyDeductions || selectedPayslip.attendancePenaltyDeductions || 0).toLocaleString()}`
                        : 'Rs. 0'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Overtime consumption */}
              <div className="border border-slate-100 rounded-xl p-4 space-y-2">
                <h4 className="font-semibold text-slate-800 text-sm">Overtime Snapshot</h4>
                <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-lg">
                  <div>
                    <span className="font-medium text-slate-800">
                      {selectedPayslip.approvedOvertimeMinutes} Minutes Approved
                    </span>
                    <span className="block text-[11px] text-slate-400">
                      Rate: Rs. {selectedPayslip.approvedOvertimeHourlyRate}/hr
                    </span>
                  </div>
                  <span className="text-sm font-bold text-indigo-600">
                    +Rs. {selectedPayslip.approvedOvertimeAmount.toLocaleString()}
                  </span>
                </div>
                {selectedPayslip.consumedOvertimeIds.length > 0 && (
                  <p className="text-[10px] text-slate-400">
                    Consumed Overtime IDs: {selectedPayslip.consumedOvertimeIds.join(', ')}
                  </p>
                )}
              </div>

              {/* Allowances, adjustments & advance recovery */}
              {(plusExtras(selectedPayslip) > 0 || minusExtras(selectedPayslip) > 0) && (
                <div className="border border-slate-100 rounded-xl p-4 space-y-1.5">
                  <h4 className="font-semibold text-slate-800 text-sm">Allowances, Adjustments & Loan Recoveries</h4>
                  {(selectedPayslip.holidayEarnings ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Holiday / weekly-off pay ({(selectedPayslip.paidHolidayDays ?? 0) + (selectedPayslip.paidWeeklyOffDays ?? 0)} days)</span>
                      <span className="text-emerald-600 font-semibold">+Rs. {selectedPayslip.holidayEarnings!.toLocaleString()}</span>
                    </div>
                  )}
                  {(selectedPayslip.allowanceLines ?? []).map((a) => (
                    <div key={a.id} className="flex justify-between">
                      <span>{a.name} <span className="text-slate-400">(monthly allowance)</span></span>
                      <span className="text-emerald-600 font-semibold">+Rs. {a.amount.toLocaleString()}</span>
                    </div>
                  ))}
                  {(selectedPayslip.adjustments ?? []).map((a) => (
                    <div key={a.id} className="flex justify-between">
                      <span>{a.title} <span className="text-slate-400">({a.type.toLowerCase()})</span></span>
                      <span className={`font-semibold ${a.type === 'DEDUCTION' ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {a.type === 'DEDUCTION' ? '-' : '+'}Rs. {a.amount.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {(selectedPayslip.advanceRecoveries ?? []).map((r) => (
                    <div key={r.advanceId} className="flex justify-between py-1 border-t border-slate-100 text-rose-600">
                      <span>
                        Loan Recovery: <strong>{r.advanceNumber}</strong>{' '}
                        <span className="text-slate-500 font-normal">
                          ({selectedPayslip.status === 'DRAFT' ? 'Projected balance after' : 'Remaining balance'}: Rs. {r.balanceAfter.toLocaleString()})
                        </span>
                      </span>
                      <span className="font-semibold">-Rs. {r.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Net Payout Summary */}
              <div className="bg-slate-50 p-4 rounded-xl space-y-2">
                <div className="flex justify-between text-slate-700">
                  <span>Gross Earnings (Base + Leave + Overtime + Allowances):</span>
                  <span className="font-semibold">Rs. {formatSalaryNumber(selectedPayslip.grossPayable)}</span>
                </div>
                <div className="flex justify-between text-rose-600">
                  <span>Total Deductions (Absence + Late/Early + Other + Loans):</span>
                  <span className="font-semibold">-Rs. {formatSalaryNumber(selectedPayslip.totalDeductions)}</span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between text-sm font-bold text-slate-900">
                  <span>Net Salary Payable:</span>
                  <span className="text-indigo-600">Rs. {formatSalaryNumber(selectedPayslip.netPayable)}</span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowDetailsModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: RECORD PAYMENT MODAL                                             */}
      {/* ========================================================================= */}
      {showPaymentModal && paymentTargetPayslip && paymentTargetRun && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-x-hidden overflow-y-auto flex flex-col max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Disburse Salary Payment</h3>
                  <p className="text-xs text-slate-500">
                    Pay {paymentTargetPayslip.staffName} ({paymentTargetPayslip.employeeCode})
                  </p>
                </div>
              </div>
              <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="p-6 space-y-4 text-xs">
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex justify-between items-center text-amber-900">
                <span>Outstanding Salary Balance:</span>
                <span className="text-sm font-bold">
                  Rs. {paymentTargetPayslip.outstandingAmount.toLocaleString()}
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Disbursement Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentForm({ ...paymentForm, method: 'CASH' })}
                    className={`p-3 rounded-xl border text-center font-medium transition-all flex items-center justify-center gap-2 ${
                      paymentForm.method === 'CASH'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-500'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <Banknote className="w-4 h-4 text-emerald-600" />
                    <span>Cash (Open Drawer)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentForm({ ...paymentForm, method: 'ONLINE' })}
                    className={`p-3 rounded-xl border text-center font-medium transition-all flex items-center justify-center gap-2 ${
                      paymentForm.method === 'ONLINE'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-500'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <span>Bank / Online Account</span>
                  </button>
                </div>
              </div>

              {/* Source balance verification */}
              {paymentForm.method === 'CASH' ? (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex justify-between text-slate-600 mb-1">
                    <span>Custodian Drawer:</span>
                    <span className="font-semibold text-slate-800">
                      {activeUserOpenDrawer ? `${user.name} (OPEN)` : 'No Open Drawer!'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Available Cash in Drawer:</span>
                    <span
                      className={`font-bold ${
                        (activeUserOpenDrawer?.expectedInDrawer || 0) < paymentForm.amount
                          ? 'text-rose-600'
                          : 'text-emerald-600'
                      }`}
                    >
                      Rs. {(activeUserOpenDrawer?.expectedInDrawer || 0).toLocaleString()}
                    </span>
                  </div>
                  {!activeUserOpenDrawer && (
                    <p className="text-[11px] text-rose-600 mt-2">
                      Cash payout cannot proceed without an active OPEN drawer registered to your user.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Select Bank / Online Account</label>
                  <select
                    value={paymentForm.onlineAccountId}
                    onChange={(e) => setPaymentForm({ ...paymentForm, onlineAccountId: e.target.value })}
                    className="w-full border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50"
                  >
                    {onlineAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} - {b.accountName} (Bal: Rs. {b.currentBalance.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-600 font-medium mb-1">Payment Amount (Rs.)</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  max={Number(paymentTargetPayslip.outstandingAmount.toFixed(2))}
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                  className="w-full border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <span className="text-[11px] text-slate-400">
                  Partial payments are permitted up to Rs. {paymentTargetPayslip.outstandingAmount.toLocaleString()}
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Reference / Voucher Note</label>
                <input
                  type="text"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  placeholder="e.g. Sept salary payout voucher #12"
                  className="w-full border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    actionLoading ||
                    (paymentForm.method === 'CASH' &&
                      (!activeUserOpenDrawer || activeUserOpenDrawer.expectedInDrawer < paymentForm.amount))
                  }
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-semibold shadow-sm flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm Disbursement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* MODAL: MANUAL SALARY DEDUCTION MODAL                                       */}
      {/* ========================================================================= */}
      {showDeductionModal && deductionTargetPayslip && deductionTargetRun && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-x-hidden overflow-y-auto flex flex-col max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                  <MinusCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Apply Manual Deduction</h3>
                  <p className="text-xs text-slate-500">
                    {deductionTargetPayslip.staffName} ({deductionTargetPayslip.employeeCode}) • {deductionTargetPayslip.designation}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowDeductionModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyDeduction} className="p-6 space-y-4 text-xs">
              {/* Summary card */}
              <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                <div>
                  <div className="text-[10px] text-slate-400 font-medium">Net Salary</div>
                  <div className="text-xs font-bold text-slate-800">
                    Rs. {deductionTargetPayslip.netPayable.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-medium">Already Paid</div>
                  <div className="text-xs font-bold text-[#00bcd4]">
                    Rs. {(deductionTargetPayslip.paidAmount || 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-600 font-medium">Unpaid Balance</div>
                  <div className="text-xs font-bold text-amber-700">
                    Rs. {deductionTargetPayslip.outstandingAmount.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Preset Chips */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">Quick Reasons (Click to set)</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Missed Attendance Punch',
                    'Late Penalty',
                    'Unapproved Absence Penalty',
                    'Salon Equipment / Material Damage',
                    'Cash Register Discrepancy',
                    'Disciplinary Fine',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDeductionForm((prev) => ({ ...prev, title: preset }))}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                        deductionForm.title === preset
                          ? 'bg-amber-100 border-amber-300 text-amber-900 font-semibold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title / Reason Input */}
              <div>
                <label className="block text-slate-600 font-medium mb-1">Deduction Title / Reason *</label>
                <input
                  type="text"
                  value={deductionForm.title}
                  onChange={(e) => setDeductionForm({ ...deductionForm, title: e.target.value })}
                  placeholder="e.g. Missed punch on 2026-08-12"
                  className="w-full border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              {/* Amount Input */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-slate-600 font-medium">Deduction Amount (Rs.) *</label>
                  <button
                    type="button"
                    onClick={() => setDeductionForm({ ...deductionForm, amount: deductionTargetPayslip.outstandingAmount })}
                    className="text-[11px] text-amber-700 hover:underline font-semibold"
                  >
                    Max: Rs. {deductionTargetPayslip.outstandingAmount.toLocaleString()}
                  </button>
                </div>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  max={Number(deductionTargetPayslip.outstandingAmount.toFixed(2))}
                  value={deductionForm.amount || ''}
                  onChange={(e) => setDeductionForm({ ...deductionForm, amount: Number(e.target.value) })}
                  placeholder="e.g. 500"
                  className="w-full border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold focus:ring-2 focus:ring-amber-500"
                  required
                />
                <span className="text-[11px] text-slate-400">
                  Deduction will be applied to this payslip, reducing net payable salary and unpaid balance.
                </span>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-slate-600 font-medium mb-1">Additional Notes / Remarks (Optional)</label>
                <textarea
                  value={deductionForm.notes}
                  onChange={(e) => setDeductionForm({ ...deductionForm, notes: e.target.value })}
                  placeholder="Explanation or administrative justification..."
                  rows={2}
                  className="w-full border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeductionModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || deductionForm.amount <= 0 || deductionForm.amount > deductionTargetPayslip.outstandingAmount}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-semibold shadow-sm flex items-center gap-1.5"
                >
                  <MinusCircle className="w-4 h-4" />
                  Confirm Deduction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* ========================================================================= */}
      {/* MODAL 4: PAYMENT HISTORY & REVERSAL MODAL                                 */}
      {/* ========================================================================= */}
      {showHistoryModal && selectedPayslip && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-x-hidden overflow-y-auto flex flex-col max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Disbursement History: {selectedPayslip.staffName}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedPayslip.payslipNumber} • Net: Rs. {selectedPayslip.netPayable.toLocaleString()} • Paid: Rs.{' '}
                  {selectedPayslip.paidAmount.toLocaleString()}
                </p>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[70vh]">
              {selectedPayslip.payments.length === 0 ? (
                <p className="text-slate-500 text-center py-4">No disbursements recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {selectedPayslip.payments.map((pmt) => (
                    <div
                      key={pmt.id}
                      className={`p-4 rounded-xl border flex items-center justify-between ${
                        pmt.status === 'REVERSED'
                          ? 'bg-rose-50/50 border-rose-100 opacity-75'
                          : 'bg-white border-slate-200 shadow-sm'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">Rs. {pmt.amount.toLocaleString()}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              pmt.status === 'REVERSED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {pmt.status}
                          </span>
                          <span className="text-slate-400">via {pmt.method}</span>
                        </div>
                        <p className="text-slate-500 text-[11px]">
                          Payer: {pmt.paidByName} | Ref: {pmt.paymentNumber} ({new Date(pmt.paidAt).toLocaleString()})
                        </p>
                        {pmt.status === 'REVERSED' && (
                          <p className="text-rose-600 text-[11px] font-medium">
                            Reversed by {pmt.reversedByName} on {new Date(pmt.reversedAt || '').toLocaleString()}:{' '}
                            {pmt.reversalReason}
                          </p>
                        )}
                      </div>

                      {pmt.status === 'COMPLETED' && (
                        <button
                          onClick={() => {
                            setPaymentToReverse({
                              id: pmt.id,
                              amount: pmt.amount,
                              staffName: selectedPayslip.staffName,
                            });
                          }}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reverse
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-form for reversal reason */}
              {paymentToReverse && (
                <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
                  <h4 className="font-bold text-rose-900 text-sm">
                    Confirm Reversal of Rs. {paymentToReverse.amount.toLocaleString()}
                  </h4>
                  <p className="text-rose-700 text-xs">
                    Reversal will restore funds back to the original cash drawer or bank account, increment outstanding
                    balance, and maintain an immutable audit trail.
                  </p>
                  <div>
                    <label className="block text-rose-900 font-medium mb-1">Reason for Reversal *</label>
                    <input
                      type="text"
                      value={reverseReason}
                      onChange={(e) => setReverseReason(e.target.value)}
                      placeholder="e.g. Duplicate voucher entered in error"
                      className="w-full border-rose-300 rounded-xl px-3 py-2 text-xs"
                      required
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setPaymentToReverse(null)}
                      className="px-3 py-1.5 border border-rose-300 text-rose-800 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReversePayment}
                      disabled={actionLoading || !reverseReason.trim()}
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg shadow-sm"
                    >
                      Confirm Reversal
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4B: DELETE SINGLE STAFF SALARY MODAL                                */}
      {/* ========================================================================= */}
      {showSingleDeleteModal && payslipToDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-x-hidden overflow-y-auto flex flex-col p-6 space-y-4 text-xs max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Staff Salary</h3>
                <p className="text-slate-500 font-medium">
                  {payslipToDelete.payslip.staffName} ({payslipToDelete.payslip.employeeCode || payslipToDelete.payslip.staffId})
                </p>
              </div>
            </div>

            <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-3 text-xs text-amber-900 space-y-1 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]">
              <p className="font-semibold text-amber-950">
                Only this employee ({payslipToDelete.payslip.staffName})'s salary record will be removed:
              </p>
              <p>• All other employees' salary records remain preserved in the register.</p>
              <p>• Locked attendance dates, approved overtime, and advance recoveries will be released.</p>
              <p>• If payment has already been disbursed for this payslip, reverse payment first.</p>
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Reason for Deletion *</label>
              <textarea
                value={singleDeleteReason}
                onChange={(e) => setSingleDeleteReason(e.target.value)}
                placeholder="e.g. Attendance punch correction required, wrong rate configured..."
                rows={3}
                className="w-full border border-slate-200 rounded-xl p-3 text-xs focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSingleDeleteModal(false);
                  setPayslipToDelete(null);
                  setSingleDeleteReason('');
                }}
                className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-medium cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleDeleteSinglePayslip}
                disabled={actionLoading || !singleDeleteReason.trim()}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl font-semibold shadow-sm cursor-pointer"
              >
                {actionLoading ? 'Deleting...' : `Delete ${payslipToDelete.payslip.staffName}'s Salary`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: CANCEL PAYROLL RUN MODAL                                         */}
      {/* ========================================================================= */}
      {showCancelModal && runToCancel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-x-hidden overflow-y-auto flex flex-col p-6 space-y-4 text-xs max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                <Ban className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isCancellingAllMonthRuns ? 'Cancel All Salaries (Entire Period)' : 'Cancel Payroll Run'}
                </h3>
                <p className="text-slate-500">
                  {isCancellingAllMonthRuns ? `${generatedPayslipRows.length} staff payslips will be cancelled` : runToCancel.payrollNumber}
                </p>
              </div>
            </div>

            <p className="text-slate-600">
              Cancelling releases all consumed attendance references and overtime locks so they can be re-evaluated. Runs
              with active payments must have payments reversed first.
            </p>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Cancellation Reason *</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Roster corrections required for August attendance"
                rows={3}
                className="w-full border-slate-200 rounded-xl p-3 text-xs focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setRunToCancel(null);
                }}
                className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-medium"
              >
                Back
              </button>
              <button
                onClick={handleCancelRun}
                disabled={actionLoading || !cancelReason.trim()}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl font-semibold shadow-sm"
              >
                {actionLoading ? 'Cancelling...' : isCancellingAllMonthRuns ? `Cancel All (${generatedPayslipRows.length}) Salaries` : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: PAYROLL POLICY CONFIGURATION MODAL                                */}
      {/* ========================================================================= */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-x-hidden overflow-y-auto flex flex-col max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Payroll Calculation Policy</h3>
                  <p className="text-xs text-slate-500">Configure divisors, paid leave, and proration rules</p>
                </div>
              </div>
              <button onClick={() => setShowPolicyModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePolicy} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1">
                <label className="block text-indigo-950 font-bold">
                  Monthly Staff Divisor: Actual Calendar Days Model
                </label>
                <p className="text-[11px] text-indigo-800 leading-relaxed">
                  Daily deduction & proration rates are strictly derived from actual calendar days in the month (28 in Feb non-leap, 29 in Feb leap, 30 in Apr/Jun/Sep/Nov, 31 in Jan/Mar/May/Jul/Aug/Oct/Dec). Full calendar month = 100% of configured monthly salary.
                </p>
                <div className="text-[10px] text-indigo-700 font-mono bg-white/70 px-2 py-1 rounded border border-indigo-100 mt-1">
                  Formula: Daily Rate = Monthly Base Salary ÷ Actual Calendar Days
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                <label className="block text-amber-950 font-bold">
                  Daily Staff Contract: Strict Worked-Days Only
                </label>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Applies to Daily Salary & Daily + Commission contracts. Earned base = configured dailySalaryRate × verified worked-day equivalents (1.0 for full day, 0.5 for half day). Non-worked days, leaves, and holidays earn Rs. 0 and are never deducted.
                </p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <label className="block text-slate-800 font-semibold mb-1">Mid-Month Proration Method</label>
                <p className="text-[11px] text-slate-600">
                  Prorated dynamically by actual calendar days (Employed Days ÷ Month Calendar Days).
                </p>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.nonWorkedHolidayPaid ?? true}
                    onChange={(e) => setPolicyForm({ ...policyForm, nonWorkedHolidayPaid: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Pay gazetted holidays for monthly salaried staff</span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowPolicyModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-sm"
                >
                  Save Policy Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 7: PRINT PAYSLIP MODAL                                              */}
      {/* ========================================================================= */}
      {showPrintModal && selectedPayslip && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-xl overflow-x-hidden overflow-y-auto flex flex-col max-h-[calc(100dvh-2rem)] overscroll-contain">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="font-bold text-slate-800 text-sm">Official Employee Payslip</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Now
                </button>
                <button onClick={() => setShowPrintModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Payslip Body */}
            <div className="p-8 space-y-6 text-xs bg-white text-slate-900" id="printable-payslip">
              <div className="text-center pb-4 border-b border-slate-200">
                <h2 className="text-lg font-bold tracking-tight">SALON OS MANAGEMENT</h2>
                <p className="text-xs text-slate-500">Official Monthly Salary Slip</p>
                <div className="mt-2 inline-block px-3 py-1 bg-slate-100 rounded-full font-semibold text-slate-700">
                  Period: {selectedPayslip.startDate || selectedPayslip.month}{selectedPayslip.endDate && selectedPayslip.endDate !== selectedPayslip.startDate ? ` to ${selectedPayslip.endDate}` : ''}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Employee Details</span>
                  <p className="font-bold text-sm text-slate-900">{selectedPayslip.staffName}</p>
                  <p className="text-slate-600">{selectedPayslip.employeeCode} • {selectedPayslip.designation}</p>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[10px] uppercase">Payslip Reference</span>
                  <p className="font-bold text-slate-900">{selectedPayslip.payslipNumber}</p>
                  <p className="text-slate-600">Status: {selectedPayslip.status}</p>
                </div>
              </div>

              <div className="space-y-2">
                {/* 1. Base Salary & Proration */}
                <p className="text-xs text-slate-600">
                  {selectedPayslip.compensationType?.startsWith('DAILY')
                    ? `Strict Worked Days Model. Daily Rate: ${formatCurrency(selectedPayslip.calculationDetails?.dailyRateUsed || selectedPayslip.effectiveDailyRate)}/day. `
                    : `Divisor: Actual Calendar Days (/${selectedPayslip.calculationDetails?.divisorUsed}). Daily Rate: ${formatCurrency(selectedPayslip.calculationDetails?.dailyRateUsed || selectedPayslip.effectiveDailyRate)}/day. `}
                  {selectedPayslip.calculationDetails?.prorationFormula || selectedPayslip.calculationDetails?.formula}
                </p>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Contractual Base Salary</span>
                  <span className="font-semibold text-slate-900">Rs. {(selectedPayslip.effectiveBaseSalary ?? selectedPayslip.baseEarnings).toLocaleString()}</span>
                </div>
                {selectedPayslip.calculationDetails?.prorationApplied && (
                  <div className="flex justify-between py-1 border-b border-slate-100 text-amber-700 bg-amber-50/50 px-1 rounded">
                    <span>
                      Proration Adjustment
                      <span className="block text-[10px] text-amber-600 font-normal">
                        {selectedPayslip.calculationDetails.prorationFormula}
                      </span>
                    </span>
                    <span className="font-semibold">
                      -Rs. {Math.max(0, (selectedPayslip.effectiveBaseSalary || 0) - selectedPayslip.baseEarnings).toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100 bg-slate-50/60 px-1 rounded">
                  <span className="text-slate-700 font-medium">Earned Base Salary</span>
                  <span className="font-bold text-slate-900">Rs. {selectedPayslip.baseEarnings.toLocaleString()}</span>
                </div>

                {/* 2. Other Earnings & Overtime */}
                {selectedPayslip.leaveEarnings > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600">Eligible Paid Leave ({selectedPayslip.paidLeaveDays} days)</span>
                    <span className="font-semibold text-slate-900">Rs. {selectedPayslip.leaveEarnings.toLocaleString()}</span>
                  </div>
                )}
                {(selectedPayslip.holidayEarnings ?? 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600">Holiday / Weekly-off Pay</span>
                    <span className="font-semibold text-slate-900">+Rs. {selectedPayslip.holidayEarnings!.toLocaleString()}</span>
                  </div>
                )}
                {selectedPayslip.approvedOvertimeAmount > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600">Approved Overtime ({selectedPayslip.approvedOvertimeMinutes} mins @ Rs. {selectedPayslip.approvedOvertimeHourlyRate}/hr)</span>
                    <span className="font-semibold text-indigo-600">+Rs. {selectedPayslip.approvedOvertimeAmount.toLocaleString()}</span>
                  </div>
                )}
                {(selectedPayslip.allowanceLines ?? []).map((a) => (
                  <div key={a.id} className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600">{a.name} Allowance</span>
                    <span className="font-semibold text-slate-900">+Rs. {a.amount.toLocaleString()}</span>
                  </div>
                ))}
                {(selectedPayslip.adjustments ?? []).filter((a) => a.type !== 'DEDUCTION').map((a) => (
                  <div key={a.id} className="flex justify-between py-1 border-b border-slate-100 text-emerald-600">
                    <span>{a.title} ({a.type.toLowerCase()})</span>
                    <span className="font-semibold">+Rs. {a.amount.toLocaleString()}</span>
                  </div>
                ))}

                {/* Gross Earnings Subtotal */}
                <div className="flex justify-between py-1.5 border-b-2 border-slate-200 bg-slate-100/70 px-2 rounded font-semibold text-slate-900">
                  <span>Gross Earnings</span>
                  <span>Rs. {formatSalaryNumber(selectedPayslip.grossPayable)}</span>
                </div>

                {/* 3. Itemized Deductions */}
                {selectedPayslip.absenceDeductions > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100 text-rose-600">
                    <span>Absence Deductions ({selectedPayslip.absentDays + (selectedPayslip.unpaidLeaveDays || 0)} days)</span>
                    <span className="font-semibold">-Rs. {formatSalaryNumber(selectedPayslip.absenceDeductions)}</span>
                  </div>
                )}
                {((selectedPayslip.lateEarlyDeductions || selectedPayslip.attendancePenaltyDeductions || 0) > 0) && (
                  <div className="flex justify-between py-1 border-b border-slate-100 text-rose-600">
                    <span>Late & Early Attendance Penalties</span>
                    <span className="font-semibold">-Rs. {formatSalaryNumber(selectedPayslip.lateEarlyDeductions || selectedPayslip.attendancePenaltyDeductions || 0)}</span>
                  </div>
                )}
                {(selectedPayslip.adjustments ?? []).filter((a) => a.type === 'DEDUCTION').map((a) => (
                  <div key={a.id} className="flex justify-between py-1 border-b border-slate-100 text-rose-600">
                    <span>{a.title} (deduction)</span>
                    <span className="font-semibold">-Rs. {formatSalaryNumber(a.amount)}</span>
                  </div>
                ))}

                {/* Loan Recoveries (Itemized separately) */}
                {(selectedPayslip.advanceRecoveries ?? []).map((r) => (
                  <div key={r.advanceId} className="flex justify-between py-1 border-b border-slate-100 text-rose-600">
                    <span>
                      Loan Recovery ({r.advanceNumber}){' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({selectedPayslip.status === 'DRAFT' ? 'Projected balance' : 'Remaining balance'}: Rs. {formatSalaryNumber(r.balanceAfter)})
                      </span>
                    </span>
                    <span className="font-semibold">-Rs. {formatSalaryNumber(r.amount)}</span>
                  </div>
                ))}

                {/* Total Deductions Subtotal */}
                <div className="flex justify-between py-1.5 border-b border-slate-200 text-rose-600 font-semibold px-2">
                  <span>Total Deductions</span>
                  <span>-Rs. {formatSalaryNumber(selectedPayslip.totalDeductions)}</span>
                </div>
                {Boolean(selectedPayslip.previouslyPaidCustomSalary && selectedPayslip.previouslyPaidCustomSalary > 0) && (
                  <div className="flex justify-between py-1.5 border-b border-indigo-200 bg-indigo-50/70 text-indigo-700 font-semibold px-2 rounded">
                    <div>
                      <span>Previously Paid (Custom Salary)</span>
                      <span className="block text-[10px] text-indigo-500 font-normal">
                        Full Month Earned: Rs. {formatSalaryNumber(selectedPayslip.monthlyEarnedSalary ?? selectedPayslip.netPayable)}
                      </span>
                    </div>
                    <span>-Rs. {formatSalaryNumber(selectedPayslip.previouslyPaidCustomSalary)}</span>
                  </div>
                )}

                {/* 4. Net Salary Payable */}
                <div className="pt-2 flex justify-between font-bold text-sm text-slate-900 border-t-2 border-slate-900">
                  <span>Net Salary Payable</span>
                  <span className="text-indigo-600">Rs. {formatSalaryNumber(selectedPayslip.netPayable)}</span>
                </div>

                <div className="flex justify-between text-slate-500 pt-1">
                  <span>Total Disbursed: Rs. {selectedPayslip.paidAmount.toLocaleString()}</span>
                  <span>Outstanding: Rs. {selectedPayslip.outstandingAmount.toLocaleString()}</span>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-200 text-[10px] text-slate-400 text-center">
                This payslip is system generated by SalonOS and reflects canonical attendance and locked overtime snapshots.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
