import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { toast } from '@/context/ToastContext';
import {
  StaffMember,
  Branch,
  CompensationType,
  LeaveAllowancePeriod,
  DeductionType,
  PenaltyCombinationPolicy,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { formatCurrency } from '@/lib/formatters';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Users,
  Plus,
  Search,
  MoreVertical,
  Edit,
  Eye,
  KeyRound,
  UserX,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  Building2,
  Calendar,
  Lock,
  RefreshCw,
  Phone,
  Mail,
  Coins,
  ShieldCheck,
  Scissors,
  Clock,
  Briefcase,
  Percent,
  AlertTriangle,
  Palmtree,
  Calculator,
  Info,
} from 'lucide-react';

const COMPENSATION_TYPE_LABELS: Record<CompensationType, string> = {
  MONTHLY_SALARY: 'Monthly Salary',
  DAILY_SALARY: 'Daily Salary',
  MONTHLY_PLUS_COMMISSION: 'Monthly Plus Commission',
  DAILY_PLUS_COMMISSION: 'Daily Plus Commission',
  COMMISSION_ONLY: 'Commission Only',
};

function formatCompensationSummary(staff: StaffMember): string {
  switch (staff.compensationType) {
    case 'MONTHLY_SALARY':
      return `Monthly Base: ${formatCurrency(staff.baseSalary)}`;
    case 'DAILY_SALARY':
      return `Daily Rate: ${formatCurrency(staff.dailySalaryRate)}/day`;
    case 'MONTHLY_PLUS_COMMISSION':
      return `Monthly: ${formatCurrency(staff.baseSalary)} + ${staff.commissionRate}% Comm`;
    case 'DAILY_PLUS_COMMISSION':
      return `Daily: ${formatCurrency(staff.dailySalaryRate)}/day + ${staff.commissionRate}% Comm`;
    case 'COMMISSION_ONLY':
      return `Commission Only (${staff.commissionRate}%)`;
    default:
      return formatCurrency(staff.baseSalary || 0);
  }
}

function computeDerivedThresholds(startTime: string, endTime: string, lateGrace: number, earlyGrace: number) {
  const parseMins = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const formatMins = (m: number) => {
    const normalized = ((m % 1440) + 1440) % 1440;
    const hrs = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const period = hrs >= 12 ? 'PM' : 'AM';
    const displayHrs = hrs % 12 === 0 ? 12 : hrs % 12;
    return `${String(displayHrs).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${period}`;
  };

  const startMins = parseMins(startTime);
  const endMins = parseMins(endTime);

  const latestArrival = formatMins(startMins + (lateGrace || 0));
  const earliestDeparture = formatMins(endMins - (earlyGrace || 0));

  const isOvernight = endMins <= startMins;

  return { latestArrival, earliestDeparture, isOvernight };
}

function computeSampleDeductionPreview(
  compType: CompensationType,
  baseSalary: number,
  dailySalaryRate: number,
  payrollDivisor: number,
  lateRule: { enabled: boolean; type: DeductionType; amount: number },
  earlyRule: { enabled: boolean; type: DeductionType; amount: number },
  policy: PenaltyCombinationPolicy
) {
  if (compType === 'COMMISSION_ONLY') {
    return {
      dailyBasePay: 0,
      latePenalty: 0,
      earlyPenalty: 0,
      totalPenalty: 0,
      note: 'Salary deductions are unavailable for Commission Only staff as no base salary exists.'
    };
  }

  let dailyBasePay = 0;
  if (compType === 'DAILY_SALARY' || compType === 'DAILY_PLUS_COMMISSION') {
    dailyBasePay = dailySalaryRate;
  } else if (compType === 'MONTHLY_SALARY' || compType === 'MONTHLY_PLUS_COMMISSION') {
    const now = new Date();
    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    dailyBasePay = baseSalary / daysInCurrentMonth;
  }

  let latePenalty = 0;
  if (lateRule.enabled) {
    latePenalty = lateRule.type === 'FIXED' ? lateRule.amount : (dailyBasePay * lateRule.amount) / 100;
  }

  let earlyPenalty = 0;
  if (earlyRule.enabled) {
    earlyPenalty = earlyRule.type === 'FIXED' ? earlyRule.amount : (dailyBasePay * earlyRule.amount) / 100;
  }

  let totalPenalty = 0;
  if (policy === 'HIGHEST_ONLY') {
    totalPenalty = Math.max(latePenalty, earlyPenalty);
  } else {
    totalPenalty = latePenalty + earlyPenalty;
  }

  return {
    dailyBasePay,
    latePenalty,
    earlyPenalty,
    totalPenalty,
    note: null
  };
}

export const StaffDirectoryPage: React.FC = () => {
  const { user } = useAuth();

  // Role guard: Only SUPER_ADMIN and ADMIN
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/operations/staff" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [allStaffList, setAllStaffList] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [portalFilter, setPortalFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>(isSuperAdmin ? 'ALL' : (user.branchId as string));

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isPortalModalOpen, setIsPortalModalOpen] = useState(false);
  const [isDeactivateAlertOpen, setIsDeactivateAlertOpen] = useState(false);

  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    employeeCode: '',
    name: '',
    phone: '',
    email: '',
    branchId: isSuperAdmin ? '' : (user.branchId as string),
    designation: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    isActive: true,

    // Compensation
    compensationType: 'MONTHLY_SALARY' as CompensationType,
    baseSalary: 0,
    dailySalaryRate: 0,
    commissionRate: 0,
    overtimeHourlyRate: 0,
    effectiveDate: new Date().toISOString().slice(0, 10),

    // Working Schedule
    startTime: '09:00',
    endTime: '18:00',
    lateGraceMinutes: 15,
    earlyGraceMinutes: 15,
    isOvernightShift: false,

    // Leaves
    allowedLeaveDays: 12,
    leaveAllowancePeriod: 'YEARLY' as LeaveAllowancePeriod,

    // Deductions
    lateInEnabled: false,
    lateInType: 'FIXED' as DeductionType,
    lateInAmount: 0,

    earlyExitEnabled: false,
    earlyExitType: 'FIXED' as DeductionType,
    earlyExitAmount: 0,

    payrollDivisor: 30,
    combinationPolicy: 'BOTH' as PenaltyCombinationPolicy,

    // Portal
    specialties: '',
    enablePortalAccess: false,
    portalIdentifier: '',
    portalPassword: 'Staff@2026',
  });

  const [portalToggleData, setPortalToggleData] = useState({
    enable: false,
    identifier: '',
    password: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [fetchedStaff, allStaff, fetchedBranches] = await Promise.all([
        salonService.getStaffMembers(user, branchFilter),
        salonService.getStaffMembers(user, 'ALL'),
        salonService.getBranches(),
      ]);
      setStaffList(fetchedStaff);
      setAllStaffList(allStaff);
      setBranches(fetchedBranches);
    } catch (err: any) {
      console.error('Failed to load staff list:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [branchFilter]);

  // Filtered staff list
  const filteredStaff = staffList.filter((st) => {
    const matchesSearch =
      st.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      st.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      st.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
      st.phone.includes(searchQuery);

    if (!matchesSearch) return false;

    if (statusFilter === 'ACTIVE' && !st.isActive) return false;
    if (statusFilter === 'INACTIVE' && st.isActive) return false;

    if (portalFilter === 'ENABLED' && !st.hasPortalAccess) return false;
    if (portalFilter === 'DISABLED' && st.hasPortalAccess) return false;

    if (isSuperAdmin && branchFilter !== 'ALL' && st.branchId !== branchFilter) return false;

    return true;
  });

  const getBranchIndexNumber = (branchId?: string, branchList: Branch[] = branches): number => {
    if (!branchId) return 1;
    const idx = branchList.findIndex((b) => b.id === branchId);
    if (idx !== -1) return idx + 1;
    const match = branchId.match(/(\d+)$/);
    if (match) return parseInt(match[1], 10);
    return 1;
  };

  const generateNextEmployeeCode = (
    targetBranchId?: string,
    currentList: StaffMember[] = (allStaffList.length > 0 ? allStaffList : staffList),
    branchList: Branch[] = branches
  ) => {
    const branchNum = getBranchIndexNumber(targetBranchId, branchList);
    const prefix = `EMP${branchNum}`;
    let maxNum = 0;
    const existingCodes = new Set(
      currentList
        .map((s) => s.employeeCode?.trim().toUpperCase())
        .filter(Boolean) as string[]
    );

    const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
    for (const s of currentList) {
      if (!s.employeeCode) continue;
      const m = s.employeeCode.match(pattern);
      if (m) {
        const val = parseInt(m[1], 10);
        if (!isNaN(val) && val > maxNum) maxNum = val;
      }
    }

    let nextNum = maxNum + 1;
    let candidate = `${prefix}-${String(nextNum).padStart(4, '0')}`;
    while (existingCodes.has(candidate)) {
      nextNum++;
      candidate = `${prefix}-${String(nextNum).padStart(4, '0')}`;
    }
    return candidate;
  };

  const handleOpenAdd = () => {
    const defaultBranch = isSuperAdmin ? (branches[0]?.id || '') : (user.branchId as string);
    const code = generateNextEmployeeCode(defaultBranch, allStaffList.length > 0 ? allStaffList : staffList, branches);

    setFormData({
      employeeCode: code,
      name: '',
      phone: '',
      email: '',
      branchId: defaultBranch,
      designation: '',
      joiningDate: new Date().toISOString().slice(0, 10),
      isActive: true,

      compensationType: 'MONTHLY_SALARY',
      baseSalary: 0,
      dailySalaryRate: 0,
      commissionRate: 0,
      overtimeHourlyRate: 0,
      effectiveDate: new Date().toISOString().slice(0, 10),

      startTime: '09:00',
      endTime: '18:00',
      lateGraceMinutes: 15,
      earlyGraceMinutes: 15,
      isOvernightShift: false,

      allowedLeaveDays: 12,
      leaveAllowancePeriod: 'YEARLY',

      lateInEnabled: false,
      lateInType: 'FIXED',
      lateInAmount: 0,

      earlyExitEnabled: false,
      earlyExitType: 'FIXED',
      earlyExitAmount: 0,

      payrollDivisor: 30,
      combinationPolicy: 'BOTH',

      specialties: '',
      enablePortalAccess: false,
      portalIdentifier: '',
      portalPassword: 'Staff@2026',
    });
    setFormError(null);
    setFormSuccess(null);
    setIsAddModalOpen(true);
  };

  const handleBranchChangeInAdd = (newBranchId: string) => {
    const code = generateNextEmployeeCode(newBranchId, allStaffList.length > 0 ? allStaffList : staffList);
    setFormData((prev) => ({
      ...prev,
      branchId: newBranchId,
      employeeCode: code,
    }));
  };

  const handleOpenEdit = (staff: StaffMember) => {
    setSelectedStaff(staff);
    setFormData({
      employeeCode: staff.employeeCode,
      name: staff.name,
      phone: staff.phone,
      email: staff.email || '',
      branchId: staff.branchId,
      designation: staff.designation,
      joiningDate: staff.joiningDate,
      isActive: staff.isActive,

      compensationType: staff.compensationType || 'MONTHLY_SALARY',
      baseSalary: staff.baseSalary || 0,
      dailySalaryRate: staff.dailySalaryRate || 0,
      commissionRate: staff.commissionRate || 0,
      overtimeHourlyRate: staff.overtimeHourlyRate || 0,
      effectiveDate: staff.effectiveDate || staff.joiningDate || new Date().toISOString().slice(0, 10),

      startTime: staff.startTime || '09:00',
      endTime: staff.endTime || '18:00',
      lateGraceMinutes: staff.lateGraceMinutes ?? 15,
      earlyGraceMinutes: staff.earlyGraceMinutes ?? 15,
      isOvernightShift: !!staff.isOvernightShift,

      allowedLeaveDays: staff.allowedLeaveDays ?? 12,
      leaveAllowancePeriod: staff.leaveAllowancePeriod || 'YEARLY',

      lateInEnabled: !!staff.lateInDeduction?.enabled,
      lateInType: staff.lateInDeduction?.type || 'FIXED',
      lateInAmount: staff.lateInDeduction?.amount || 0,

      earlyExitEnabled: !!staff.earlyExitDeduction?.enabled,
      earlyExitType: staff.earlyExitDeduction?.type || 'FIXED',
      earlyExitAmount: staff.earlyExitDeduction?.amount || 0,

      payrollDivisor: staff.payrollDivisor || 30,
      combinationPolicy: staff.combinationPolicy || 'BOTH',

      specialties: (staff.specialties || []).join(', '),
      enablePortalAccess: !!staff.hasPortalAccess,
      portalIdentifier: staff.linkedUserEmail || staff.email || '',
      portalPassword: '',
    });
    setFormError(null);
    setFormSuccess(null);
    setIsEditModalOpen(true);
  };

  const handleOpenPortalAccess = (staff: StaffMember) => {
    setSelectedStaff(staff);
    setPortalToggleData({
      enable: !staff.hasPortalAccess,
      identifier: staff.linkedUserEmail || staff.email || `${staff.name.toLowerCase().replace(/\s+/g, '.')}@isysware.com`,
      password: staff.linkedUserId ? '' : 'Staff@2026',
    });
    setFormError(null);
    setFormSuccess(null);
    setIsPortalModalOpen(true);
  };

  const handleOpenDeactivate = (staff: StaffMember) => {
    setSelectedStaff(staff);
    setIsDeactivateAlertOpen(true);
  };

  const handleCreateStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isEditModalOpen && isSuperAdmin && !branches.some((branch) => branch.id === formData.branchId)) {
      setFormError('Please select a branch for this staff member.');
      toast.error('Please select a branch for this staff member.');
      return;
    }
    if (!formData.name.trim() || !formData.employeeCode.trim() || !formData.phone.trim()) {
      const msg = 'Full name, employee code, and primary phone number are required.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (formData.baseSalary < 0 || formData.dailySalaryRate < 0 || formData.overtimeHourlyRate < 0) {
      const msg = 'Salary amounts and overtime hourly rate must be non-negative.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (formData.commissionRate < 0 || formData.commissionRate > 100) {
      const msg = 'Commission percentage must be between 0% and 100%.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (formData.enablePortalAccess && !formData.portalIdentifier.trim()) {
      const msg = 'Login identifier is required when enabling staff portal access.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    const upperCode = formData.employeeCode.trim().toUpperCase();
    const sourceList = allStaffList.length > 0 ? allStaffList : staffList;
    const isCodeTaken = sourceList.some((s) => s.employeeCode?.toUpperCase() === upperCode);
    if (isCodeTaken) {
      const msg = `Employee code '${upperCode}' is already assigned to an existing staff member in the salon. Please enter a unique code.`;
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setIsSubmitting(true);
    try {
      const specialtiesArray = formData.specialties
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await salonService.createStaffMember(
        {
          employeeCode: upperCode,
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim() || undefined,
          branchId: isSuperAdmin ? formData.branchId : (user.branchId as string),
          designation: formData.designation.trim(),
          joiningDate: formData.joiningDate,
          compensationType: formData.compensationType,
          baseSalary: Number(formData.baseSalary),
          dailySalaryRate: Number(formData.dailySalaryRate),
          commissionRate: Number(formData.commissionRate),
          overtimeHourlyRate: Number(formData.overtimeHourlyRate),
          effectiveDate: formData.effectiveDate,

          startTime: formData.startTime,
          endTime: formData.endTime,
          lateGraceMinutes: Number(formData.lateGraceMinutes),
          earlyGraceMinutes: Number(formData.earlyGraceMinutes),
          isOvernightShift: formData.isOvernightShift,

          allowedLeaveDays: Number(formData.allowedLeaveDays),
          leaveAllowancePeriod: formData.leaveAllowancePeriod,

          lateInDeduction: {
            enabled: formData.lateInEnabled,
            type: formData.lateInType,
            amount: Number(formData.lateInAmount),
          },
          earlyExitDeduction: {
            enabled: formData.earlyExitEnabled,
            type: formData.earlyExitType,
            amount: Number(formData.earlyExitAmount),
          },
          payrollDivisor: Number(formData.payrollDivisor),
          combinationPolicy: formData.combinationPolicy,

          specialties: specialtiesArray,
          enablePortalAccess: formData.enablePortalAccess,
          portalIdentifier: formData.enablePortalAccess && formData.portalIdentifier.trim()
            ? formData.portalIdentifier.trim().toLowerCase()
            : undefined,
          portalPassword: formData.enablePortalAccess && formData.portalPassword.trim()
            ? formData.portalPassword.trim()
            : undefined,
        },
        user
      );

      const successMsg = `Staff member '${formData.name}' created successfully.`;
      setFormSuccess(successMsg);
      toast.success(successMsg);
      await loadData();
      setTimeout(() => {
        setIsAddModalOpen(false);
      }, 700);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to register staff member.';
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff) return;
    setFormError(null);

    if (!formData.name.trim() || !formData.phone.trim()) {
      const msg = 'Full name and primary phone number are required.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (formData.baseSalary < 0 || formData.dailySalaryRate < 0 || formData.overtimeHourlyRate < 0) {
      const msg = 'Salary amounts and overtime hourly rate must be non-negative.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (formData.commissionRate < 0 || formData.commissionRate > 100) {
      const msg = 'Commission percentage must be between 0% and 100%.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setIsSubmitting(true);
    try {
      const specialtiesArray = formData.specialties
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await salonService.updateStaffMember(
        selectedStaff.id,
        {
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim() || undefined,
          designation: formData.designation.trim(),
          joiningDate: formData.joiningDate,
          compensationType: formData.compensationType,
          baseSalary: Number(formData.baseSalary),
          dailySalaryRate: Number(formData.dailySalaryRate),
          commissionRate: Number(formData.commissionRate),
          overtimeHourlyRate: Number(formData.overtimeHourlyRate),
          effectiveDate: formData.effectiveDate,

          startTime: formData.startTime,
          endTime: formData.endTime,
          lateGraceMinutes: Number(formData.lateGraceMinutes),
          earlyGraceMinutes: Number(formData.earlyGraceMinutes),
          isOvernightShift: formData.isOvernightShift,

          allowedLeaveDays: Number(formData.allowedLeaveDays),
          leaveAllowancePeriod: formData.leaveAllowancePeriod,

          lateInDeduction: {
            enabled: formData.lateInEnabled,
            type: formData.lateInType,
            amount: Number(formData.lateInAmount),
          },
          earlyExitDeduction: {
            enabled: formData.earlyExitEnabled,
            type: formData.earlyExitType,
            amount: Number(formData.earlyExitAmount),
          },
          payrollDivisor: Number(formData.payrollDivisor),
          combinationPolicy: formData.combinationPolicy,

          specialties: specialtiesArray,
          isActive: formData.isActive,
          enablePortalAccess: formData.enablePortalAccess,
          portalIdentifier: formData.enablePortalAccess ? formData.portalIdentifier.trim().toLowerCase() || undefined : undefined,
          portalPassword: formData.enablePortalAccess ? formData.portalPassword.trim() || undefined : undefined,
        },
        user
      );

      const successMsg = `Employee details for '${formData.name}' updated successfully.`;
      setFormSuccess(successMsg);
      toast.success(successMsg);
      await loadData();
      setTimeout(() => {
        setIsEditModalOpen(false);
      }, 700);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to update employee profile.';
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePortalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff) return;
    setFormError(null);

    setIsSubmitting(true);
    try {
      const res = await salonService.setStaffPortalAccess(
        selectedStaff.id,
        portalToggleData.enable,
        {
          identifier: portalToggleData.identifier.trim().toLowerCase(),
          password: portalToggleData.password.trim() || undefined,
        },
        user
      );

      const successMsg = portalToggleData.enable
        ? `Portal access enabled for ${res.staff.name}. Login: ${portalToggleData.identifier}`
        : `Portal access revoked for ${res.staff.name}.`;
      setFormSuccess(successMsg);
      toast.success(successMsg);
      await loadData();
      setTimeout(() => {
        setIsPortalModalOpen(false);
      }, 900);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to update portal access.';
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!selectedStaff) return;
    try {
      await salonService.deactivateStaffMember(selectedStaff.id, user);
      toast.success(`Staff member '${selectedStaff.name}' deactivated.`);
      await loadData();
      setIsDeactivateAlertOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to deactivate staff member.');
    }
  };

  const handleReactivateStaff = async (staff: StaffMember) => {
    try {
      await salonService.updateStaffMember(staff.id, { isActive: true }, user);
      toast.success(`Staff member '${staff.name}' reactivated.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reactivate staff member.');
    }
  };

  // Derived threshold calculations
  const scheduleDerived = computeDerivedThresholds(
    formData.startTime,
    formData.endTime,
    Number(formData.lateGraceMinutes),
    Number(formData.earlyGraceMinutes)
  );

  // Live deduction preview calculation
  const sampleDeduction = computeSampleDeductionPreview(
    formData.compensationType,
    Number(formData.baseSalary),
    Number(formData.dailySalaryRate),
    Number(formData.payrollDivisor),
    { enabled: formData.lateInEnabled, type: formData.lateInType, amount: Number(formData.lateInAmount) },
    { enabled: formData.earlyExitEnabled, type: formData.earlyExitType, amount: Number(formData.earlyExitAmount) },
    formData.combinationPolicy
  );

  const staffKPIs = {
    totalStaff: staffList.length,
    activeStaff: staffList.filter((s) => s.isActive).length,
    portalEnabled: staffList.filter((s) => s.hasPortalAccess).length,
    totalBranches: branches.length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Staff & Compensation Directory
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Manage employee profiles, 5 compensation structures, working schedules, and attendance deduction rules.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadData}
            isLoading={isLoading}
            className="h-9 px-3.5 text-xs font-semibold rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 shadow-2xs transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleOpenAdd}
            className="h-9 font-semibold gap-1.5 shadow-xs text-xs sm:text-sm bg-[#B82E69] hover:bg-[#A02358] text-white rounded-xl transition-all shrink-0"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Employee
          </Button>
        </div>
      </div>

      {/* KPI Cards Row - Pure White Frosted Glass */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Personnel */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Users className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Staff
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {staffKPIs.totalStaff}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Registered employee roster
            </span>
          </div>
        </div>

        {/* Active on Duty */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Active
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {staffKPIs.activeStaff}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Currently rostered & active
            </span>
          </div>
        </div>

        {/* Portal Access */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <KeyRound className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Portal
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {staffKPIs.portalEnabled}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Self-service portal logins
            </span>
          </div>
        </div>

        {/* Operating Branches */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Building2 className="w-4 h-4" />
            </div>
            <span className="bg-[#FAF8F9] text-[#78616C] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Branches
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {staffKPIs.totalBranches}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Active salon locations
            </span>
          </div>
        </div>
      </div>

      {/* FILTERS TOOLBAR */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white/75 backdrop-blur-2xl p-3.5 rounded-[22px] border border-white/90 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search by staff name, code, designation, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-white/80 border-white/80 rounded-xl"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isSuperAdmin && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">Branch:</span>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-[160px] h-9 text-xs bg-white/80 border-white/80 rounded-xl">
                  <SelectValue placeholder="Branch Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Portal:</span>
            <Select value={portalFilter} onValueChange={(val: any) => setPortalFilter(val)}>
              <SelectTrigger className="w-[130px] h-9 text-xs bg-white/80 border-white/80 rounded-xl">
                <SelectValue placeholder="Portal Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Staff</SelectItem>
                <SelectItem value="ENABLED">Portal Enabled</SelectItem>
                <SelectItem value="DISABLED">Portal Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Status:</span>
            <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
              <SelectTrigger className="w-[120px] h-9 text-xs bg-white/80 border-white/80 rounded-xl">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* STAFF TABLE */}
      <Card variant="glass" padding="none" className="overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="overflow-x-auto w-full">
          <Table className="min-w-[1180px] w-full">
            <TableHeader className="bg-[#FAF8F9]/80 border-b border-rose-100/40">
              <TableRow className="border-b border-rose-100/40 hover:bg-transparent">
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Employee & Code</TableHead>
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Branch Location</TableHead>
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Designation & Role</TableHead>
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Compensation Model</TableHead>
                <TableHead className="text-right whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Overtime Rate</TableHead>
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Schedule & Grace</TableHead>
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Portal Access</TableHead>
                <TableHead className="whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Status</TableHead>
                <TableHead className="text-right whitespace-nowrap text-[#78616C] font-semibold text-xs py-3.5 px-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStaff.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="h-32 text-center text-[#78616C] text-xs">
                    {searchQuery
                      ? `No staff members found matching "${searchQuery}".`
                      : 'No employees registered under current filters.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredStaff.map((staff) => (
                  <TableRow key={staff.id} className="hover:bg-[#FDF2F5]/40 transition-colors border-b border-rose-100/30">
                    <TableCell className="whitespace-nowrap py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-2xl bg-white/90 text-[#B82E69] border border-white/80 shadow-2xs font-bold text-xs flex items-center justify-center shrink-0">
                          {staff.name
                            ? staff.name
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0].toUpperCase())
                                .join('')
                            : 'S'}
                        </div>
                        <div>
                          <p className="font-semibold text-[#18191B] leading-tight whitespace-nowrap">{staff.name}</p>
                          <p className="text-[11px] text-[#78616C] font-mono mt-0.5 whitespace-nowrap">{staff.employeeCode}</p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-nowrap py-3.5 px-4">
                      <div className="text-xs text-[#18191B] flex items-center gap-1.5 whitespace-nowrap">
                        <Building2 className="w-3.5 h-3.5 text-[#B82E69] shrink-0" />
                        <span>{staff.branchName || staff.branchId}</span>
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-nowrap py-3.5 px-4">
                      <div className="text-xs font-medium text-[#18191B] whitespace-nowrap">{staff.designation}</div>
                      <div className="text-[11px] text-[#78616C] flex items-center gap-1 mt-0.5 whitespace-nowrap">
                        <Calendar className="w-3 h-3" />
                        <span>Joined: {staff.joiningDate}</span>
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-nowrap py-3.5 px-4 min-w-[200px]">
                      <div className="text-xs font-semibold text-[#18191B] whitespace-nowrap">
                        {COMPENSATION_TYPE_LABELS[staff.compensationType || 'MONTHLY_SALARY']}
                      </div>
                      <div className="text-[11px] text-[#78616C] font-medium mt-0.5 whitespace-nowrap">
                        {formatCompensationSummary(staff)}
                      </div>
                      {staff.requiresCompensationReview && (
                        <Badge variant="warning" size="sm" className="mt-1 shadow-2xs border border-white/60">
                          Review Needed
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-right font-medium text-slate-800 tabular-nums whitespace-nowrap py-3.5 px-4">
                      {formatCurrency(staff.overtimeHourlyRate || 0)}/hr
                    </TableCell>

                    <TableCell className="whitespace-nowrap py-3.5 px-4">
                      <div className="text-xs text-[#18191B] font-mono whitespace-nowrap">
                        {staff.startTime || '09:00'} - {staff.endTime || '18:00'}
                      </div>
                      <div className="text-[10px] text-[#78616C] mt-0.5 whitespace-nowrap">
                        Grace: +{staff.lateGraceMinutes ?? 15}m late / -{staff.earlyGraceMinutes ?? 15}m early
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-nowrap py-3.5 px-4">
                      {staff.hasPortalAccess ? (
                        <div>
                          <Badge variant="primary" dot className="whitespace-nowrap shadow-2xs">
                            Portal Active
                          </Badge>
                          <span className="text-[10px] text-[#78616C] block font-mono mt-0.5 truncate max-w-[130px]">
                            {staff.linkedUserEmail || staff.email}
                          </span>
                        </div>
                      ) : (
                        <Badge variant="secondary" className="whitespace-nowrap shadow-2xs">
                          No Login
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap py-3.5 px-4">
                      <Badge variant={staff.isActive ? 'success' : 'secondary'} dot className="whitespace-nowrap shadow-2xs">
                        {staff.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right whitespace-nowrap py-3.5 px-4">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-xl hover:bg-white/90 text-slate-600">
                            <MoreVertical className="w-4 h-4 text-slate-600" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-white/95 backdrop-blur-xl border border-white/90 rounded-2xl shadow-xl" onCloseAutoFocus={(e) => e.preventDefault()}>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedStaff(staff);
                              setIsViewModalOpen(true);
                            }}
                            className="cursor-pointer text-xs"
                          >
                            <Eye className="w-3.5 h-3.5 mr-2 text-slate-500" />
                            View Full Profile
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleOpenEdit(staff)}
                            className="cursor-pointer text-xs"
                          >
                            <Edit className="w-3.5 h-3.5 mr-2 text-slate-500" />
                            Edit Employee
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleOpenPortalAccess(staff)}
                            className="cursor-pointer text-xs text-[#9D2558] focus:bg-[#FDF2F5] focus:text-[#851C47]"
                          >
                            <KeyRound className="w-3.5 h-3.5 mr-2" />
                            {staff.hasPortalAccess ? 'Manage Portal Access' : 'Enable Portal Access'}
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          {staff.isActive ? (
                            <DropdownMenuItem
                              onClick={() => handleOpenDeactivate(staff)}
                              className="cursor-pointer text-xs text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                            >
                              <UserX className="w-3.5 h-3.5 mr-2" />
                              Deactivate Employee
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleReactivateStaff(staff)}
                              className="cursor-pointer text-xs text-emerald-600 focus:bg-emerald-50 focus:text-emerald-700"
                            >
                              <UserCheck className="w-3.5 h-3.5 mr-2" />
                              Reactivate Employee
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* --- ADD / EDIT STAFF DIALOG --- */}
      {(isAddModalOpen || isEditModalOpen) && (
        <Dialog
          open={isAddModalOpen || isEditModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsAddModalOpen(false);
              setIsEditModalOpen(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto font-sans p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">
                {isAddModalOpen ? 'Add New Employee Profile' : `Edit Employee Profile: ${selectedStaff?.name}`}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Configure basic info, compensation model, shift schedules, leave allowances, and attendance penalties.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={isAddModalOpen ? handleCreateStaffSubmit : handleEditStaffSubmit} className="space-y-6 py-2">
              {/* SECTION 1: BASIC INFORMATION */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs uppercase tracking-wider border-b border-slate-200 pb-2">
                  <Users className="w-4 h-4 text-[#9D2558]" />
                  <span>1. Basic Information</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Full Name *"
                    type="text"
                    required
                    placeholder="e.g. Mahira Abbasi"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />

                  <div>
                    <Input
                      label="Employee Code * (Auto-generated)"
                      type="text"
                      required
                      disabled={isEditModalOpen}
                      placeholder="e.g. EMP-01"
                      value={formData.employeeCode}
                      onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value.toUpperCase() })}
                    />
                    {isAddModalOpen && formData.employeeCode && (allStaffList.length > 0 ? allStaffList : staffList).some((s) => s.employeeCode?.toUpperCase() === formData.employeeCode.trim().toUpperCase()) && (
                      <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>This employee code is already taken in the system.</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Phone Number *"
                    type="text"
                    required
                    placeholder="+92 (300) 123-4567"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Assigned Branch *</label>
                    {isSuperAdmin && isAddModalOpen ? (
                      <Select value={formData.branchId} onValueChange={handleBranchChangeInAdd}>
                        <SelectTrigger className="h-10 text-xs">
                          <SelectValue placeholder="Branch" />
                        </SelectTrigger>
                        <SelectContent>
                          {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name} ({b.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="h-10 px-3 flex items-center bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700">
                        <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                        <span>{branches.find((b) => b.id === formData.branchId)?.name || formData.branchId}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label="Designation / Role *"
                    type="text"
                    required
                    placeholder="e.g. Senior Stylist"
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  />

                  <Input
                    label="Specialties (Optional)"
                    type="text"
                    placeholder="e.g. Hair Coloring, Facial, Manicure"
                    value={formData.specialties}
                    onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                  />

                  <Input
                    label="Date of Joining *"
                    type="date"
                    required
                    value={formData.joiningDate}
                    onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })}
                  />
                </div>
              </div>

              {/* SECTION 2: COMPENSATION CONFIGURATION */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs uppercase tracking-wider border-b border-slate-200 pb-2">
                  <Briefcase className="w-4 h-4 text-[#9D2558]" />
                  <span>2. Compensation Configuration</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Compensation Model Type *
                    </label>
                    <Select
                      value={formData.compensationType}
                      onValueChange={(val: CompensationType) => setFormData({ ...formData, compensationType: val })}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue placeholder="Select Compensation Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY_SALARY">Monthly Salary</SelectItem>
                        <SelectItem value="DAILY_SALARY">Daily Salary</SelectItem>
                        <SelectItem value="MONTHLY_PLUS_COMMISSION">Monthly Plus Commission</SelectItem>
                        <SelectItem value="DAILY_PLUS_COMMISSION">Daily Plus Commission</SelectItem>
                        <SelectItem value="COMMISSION_ONLY">Commission Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Input
                    label="Policy Effective Date *"
                    type="date"
                    required
                    value={formData.effectiveDate}
                    onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Monthly Base Salary input */}
                  {(formData.compensationType === 'MONTHLY_SALARY' || formData.compensationType === 'MONTHLY_PLUS_COMMISSION') && (
                    <Input
                      label="Monthly Base Salary (PKR) *"
                      type="number"
                      min="0"
                      required
                      value={formData.baseSalary}
                      onChange={(e) => setFormData({ ...formData, baseSalary: Number(e.target.value) })}
                    />
                  )}

                  {/* Daily Salary Rate input */}
                  {(formData.compensationType === 'DAILY_SALARY' || formData.compensationType === 'DAILY_PLUS_COMMISSION') && (
                    <Input
                      label="Daily Salary Rate (PKR) *"
                      type="number"
                      min="0"
                      required
                      value={formData.dailySalaryRate}
                      onChange={(e) => setFormData({ ...formData, dailySalaryRate: Number(e.target.value) })}
                    />
                  )}

                  {/* Commission Rate % input */}
                  {formData.compensationType !== 'MONTHLY_SALARY' && formData.compensationType !== 'DAILY_SALARY' && (
                    <Input
                      label="Commission Rate (0-100%) *"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      required
                      value={formData.commissionRate}
                      onChange={(e) => setFormData({ ...formData, commissionRate: Number(e.target.value) })}
                    />
                  )}

                  {/* Manual Overtime Rate input */}
                  <Input
                    label="Overtime Rate (PKR / Hour) *"
                    type="number"
                    min="0"
                    required
                    value={formData.overtimeHourlyRate}
                    onChange={(e) => setFormData({ ...formData, overtimeHourlyRate: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* SECTION 3: WORKING SCHEDULE */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs uppercase tracking-wider border-b border-slate-200 pb-2">
                  <Clock className="w-4 h-4 text-[#9D2558]" />
                  <span>3. Working Schedule & Shift</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Input
                    label="Scheduled Start Time *"
                    type="time"
                    required
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  />

                  <Input
                    label="Scheduled End Time *"
                    type="time"
                    required
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  />

                  <Input
                    label="Late Arrival Grace (Mins) *"
                    type="number"
                    min="0"
                    required
                    value={formData.lateGraceMinutes}
                    onChange={(e) => setFormData({ ...formData, lateGraceMinutes: Number(e.target.value) })}
                  />

                  <Input
                    label="Early Exit Grace (Mins) *"
                    type="number"
                    min="0"
                    required
                    value={formData.earlyGraceMinutes}
                    onChange={(e) => setFormData({ ...formData, earlyGraceMinutes: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* SECTION 4: ATTENDANCE PENALTY RULES (LATE IN & EARLY EXIT PRICE CUT) */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs uppercase tracking-wider border-b border-slate-200 pb-2">
                  <AlertCircle className="w-4 h-4 text-[#9D2558]" />
                  <span>4. Attendance Penalty Rules (Late In & Early Exit Price Cut)</span>
                </div>

                {formData.compensationType === 'COMMISSION_ONLY' ? (
                  <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-xs">
                    Commission-Only staff have zero salary deductions; commission and tips are protected.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Late In Penalty Card */}
                    <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">Late In Penalty (Price Cut)</p>
                          <p className="text-[11px] text-slate-500">Apply deduction if staff arrives after grace period ({formData.lateGraceMinutes} mins)</p>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={formData.lateInEnabled}
                            onChange={(e) => setFormData({ ...formData, lateInEnabled: e.target.checked })}
                            className="rounded border-slate-300 text-[#9D2558] focus:ring-[#9D2558] w-4 h-4"
                          />
                          <span>Enable Late Cut</span>
                        </label>
                      </div>

                      {formData.lateInEnabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Cut Calculation Type *</label>
                            <Select
                              value={formData.lateInType}
                              onValueChange={(val) => setFormData({ ...formData, lateInType: val })}
                            >
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="FIXED">Fixed Price Cut (PKR)</SelectItem>
                                <SelectItem value="PERCENTAGE">Percentage of Daily Rate (%)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Input
                              label={formData.lateInType === 'PERCENTAGE' ? "Late Cut Rate (%) *" : "Late Cut Price (PKR) *"}
                              type="number"
                              min="0"
                              step={formData.lateInType === 'PERCENTAGE' ? "0.1" : "1"}
                              value={formData.lateInAmount}
                              onChange={(e) => setFormData({ ...formData, lateInAmount: Number(e.target.value) })}
                              placeholder={formData.lateInType === 'PERCENTAGE' ? "e.g. 10" : "e.g. 500"}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Early Exit Penalty Card */}
                    <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">Early Exit Penalty (Price Cut)</p>
                          <p className="text-[11px] text-slate-500">Apply deduction if staff leaves before scheduled shift end ({formData.earlyGraceMinutes} mins grace)</p>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={formData.earlyExitEnabled}
                            onChange={(e) => setFormData({ ...formData, earlyExitEnabled: e.target.checked })}
                            className="rounded border-slate-300 text-[#9D2558] focus:ring-[#9D2558] w-4 h-4"
                          />
                          <span>Enable Early Exit Cut</span>
                        </label>
                      </div>

                      {formData.earlyExitEnabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Cut Calculation Type *</label>
                            <Select
                              value={formData.earlyExitType}
                              onValueChange={(val) => setFormData({ ...formData, earlyExitType: val })}
                            >
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="FIXED">Fixed Price Cut (PKR)</SelectItem>
                                <SelectItem value="PERCENTAGE">Percentage of Daily Rate (%)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Input
                              label={formData.earlyExitType === 'PERCENTAGE' ? "Early Exit Cut Rate (%) *" : "Early Exit Cut Price (PKR) *"}
                              type="number"
                              min="0"
                              step={formData.earlyExitType === 'PERCENTAGE' ? "0.1" : "1"}
                              value={formData.earlyExitAmount}
                              onChange={(e) => setFormData({ ...formData, earlyExitAmount: Number(e.target.value) })}
                              placeholder={formData.earlyExitType === 'PERCENTAGE' ? "e.g. 10" : "e.g. 500"}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Multiple Occurrence Policy */}
                    {(formData.lateInEnabled || formData.earlyExitEnabled) && (
                      <div className="p-3 bg-white border border-slate-200 rounded-xl">
                        <label className="block text-xs font-medium text-slate-700 mb-1">Same-Day Multiple Occurrence Policy</label>
                        <Select
                          value={formData.combinationPolicy}
                          onValueChange={(val) => setFormData({ ...formData, combinationPolicy: val })}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Select Policy" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="BOTH">Apply Both (Deduct Late In + Early Exit)</SelectItem>
                            <SelectItem value="HIGHEST_ONLY">Highest Only (Deduct the larger cut)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 5: PAID LEAVE POLICY */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs uppercase tracking-wider border-b border-slate-200 pb-2">
                  <Calendar className="w-4 h-4 text-[#9D2558]" />
                  <span>5. Paid Leave Policy</span>
                </div>

                {formData.compensationType.startsWith('DAILY') ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                    <p className="font-semibold mb-1">Strict Worked-Days Model (Daily Contract)</p>
                    <p className="text-[11px] text-amber-800">
                      Daily staff earn strictly for verified worked days (1.0 for full day, 0.5 for half day). Non-worked days, leaves, and holidays earn Rs. 0 and are never deducted. Paid leave allowance is disabled for daily contracts.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Paid Leave Days Allowance *"
                      type="number"
                      min="0"
                      required
                      value={formData.allowedLeaveDays}
                      onChange={(e) => setFormData({ ...formData, allowedLeaveDays: Number(e.target.value) })}
                    />

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Leave Allowance Period *</label>
                      <Select
                        value={formData.leaveAllowancePeriod}
                        onValueChange={(val: LeaveAllowancePeriod) => setFormData({ ...formData, leaveAllowancePeriod: val })}
                      >
                        <SelectTrigger className="h-10 text-xs">
                          <SelectValue placeholder="Period" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MONTHLY">Monthly Entitlement</SelectItem>
                          <SelectItem value="YEARLY">Yearly Entitlement</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 5: STAFF PORTAL ACCESS (OPTIONAL) */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs uppercase tracking-wider">
                    <KeyRound className="w-4 h-4 text-[#9D2558]" />
                    <span>6. Self-Service Portal Login (Optional)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="enable-portal-switch"
                      checked={formData.enablePortalAccess}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          enablePortalAccess: checked === true,
                          portalIdentifier:
                            formData.portalIdentifier ||
                            formData.email ||
                            `${formData.name.toLowerCase().replace(/\s+/g, '.')}@isysware.com`,
                        })
                      }
                    />
                    <Label htmlFor="enable-portal-switch" className="text-xs font-medium text-slate-700 cursor-pointer">
                      Enable Portal Access
                    </Label>
                  </div>
                </div>

                {formData.enablePortalAccess && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <Input
                      label="Login Identifier (Email) *"
                      type="email"
                      required
                      placeholder="e.g. employee@salon.com"
                      value={formData.portalIdentifier}
                      onChange={(e) => setFormData({ ...formData, portalIdentifier: e.target.value })}
                    />

                    {(isAddModalOpen || !selectedStaff?.linkedUserId) && (
                      <Input
                        label="Initial Password *"
                        type="text"
                        required
                        placeholder="Staff@2026"
                        value={formData.portalPassword}
                        onChange={(e) => setFormData({ ...formData, portalPassword: e.target.value })}
                      />
                    )}
                  </div>
                )}
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setIsEditModalOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="default" size="sm" isLoading={isSubmitting}>
                  {isAddModalOpen ? 'Save Employee Profile' : 'Update Employee Profile'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* VIEW STAFF PROFILE MODAL */}
      {isViewModalOpen && selectedStaff && (
        <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
          <DialogContent className="sm:max-w-md font-sans">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#9D2558]/10 text-[#9D2558] font-bold text-xs flex items-center justify-center shrink-0">
                  {selectedStaff.name
                    ? selectedStaff.name
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((n) => n[0].toUpperCase())
                        .join('')
                    : 'S'}
                </div>
                <div>
                  <span>{selectedStaff.name}</span>
                  <span className="text-xs text-slate-400 font-mono block font-normal">{selectedStaff.employeeCode}</span>
                </div>
              </DialogTitle>
              <DialogDescription className="text-xs">{selectedStaff.designation}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-semibold text-slate-800">Compensation Model</p>
                <p className="text-slate-900 font-bold">{COMPENSATION_TYPE_LABELS[selectedStaff.compensationType || 'MONTHLY_SALARY']}</p>
                <p className="text-slate-600">{formatCompensationSummary(selectedStaff)}</p>
                <p className="text-slate-500 text-[10px]">Overtime Rate: {formatCurrency(selectedStaff.overtimeHourlyRate || 0)}/hr</p>
                <p className="text-slate-500 text-[10px]">Effective Date: {selectedStaff.effectiveDate || selectedStaff.joiningDate}</p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-semibold text-slate-800">Working Schedule & Leave</p>
                <p className="text-slate-700 font-mono">{selectedStaff.startTime || '09:00'} - {selectedStaff.endTime || '18:00'}</p>
                <p className="text-slate-600">Leave Allowance: {selectedStaff.allowedLeaveDays ?? 12} days ({selectedStaff.leaveAllowancePeriod || 'YEARLY'})</p>
                <p className="text-slate-500 text-[10px]">
                  Late Grace: {selectedStaff.lateGraceMinutes ?? 15}m | Early Grace: {selectedStaff.earlyGraceMinutes ?? 15}m
                </p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-semibold text-slate-800">Attendance Penalty Rules</p>
                <p className="text-slate-600">
                  Late In: {selectedStaff.lateInDeduction?.enabled ? `${selectedStaff.lateInDeduction.amount} (${selectedStaff.lateInDeduction.type})` : 'Disabled'}
                </p>
                <p className="text-slate-600">
                  Early Exit: {selectedStaff.earlyExitDeduction?.enabled ? `${selectedStaff.earlyExitDeduction.amount} (${selectedStaff.earlyExitDeduction.type})` : 'Disabled'}
                </p>
                <p className="text-slate-500 text-[10px]">
                  {selectedStaff.compensationType?.startsWith('DAILY')
                    ? 'Contract: Strict Worked Days (No non-worked pay or deductions)'
                    : selectedStaff.compensationType === 'COMMISSION_ONLY'
                    ? 'Contract: Commission Only'
                    : 'Divisor Model: Actual Calendar Days in Month (28/29/30/31)'}{' '}
                  | Combination: {selectedStaff.combinationPolicy || 'BOTH'}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => setIsViewModalOpen(false)}>
                Close Profile
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* MANAGE PORTAL ACCESS MODAL */}
      {isPortalModalOpen && selectedStaff && (
        <Dialog open={isPortalModalOpen} onOpenChange={setIsPortalModalOpen}>
          <DialogContent className="sm:max-w-md font-sans">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold">Configure Portal Access: {selectedStaff.name}</DialogTitle>
              <DialogDescription className="text-xs">
                Grant or revoke personal staff portal access for viewing commissions and shifts.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handlePortalSubmit} className="space-y-3 py-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="portal-enable-dialog-switch"
                  checked={portalToggleData.enable}
                  onCheckedChange={(c) => setPortalToggleData({ ...portalToggleData, enable: c === true })}
                />
                <Label htmlFor="portal-enable-dialog-switch" className="text-xs font-semibold text-slate-900 cursor-pointer">
                  Enable Portal Access for {selectedStaff.name}
                </Label>
              </div>

              {portalToggleData.enable && (
                <div className="space-y-3 pt-2">
                  <Input
                    label="Login Identifier (Email) *"
                    type="email"
                    required
                    value={portalToggleData.identifier}
                    onChange={(e) => setPortalToggleData({ ...portalToggleData, identifier: e.target.value })}
                  />

                  <Input
                    label="Password (Leave blank to preserve existing password)"
                    type="text"
                    placeholder="Staff@2026"
                    value={portalToggleData.password}
                    onChange={(e) => setPortalToggleData({ ...portalToggleData, password: e.target.value })}
                  />
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsPortalModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="default" size="sm" isLoading={isSubmitting}>
                  Save Portal Settings
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* DEACTIVATE CONFIRMATION DIALOG */}
      <AlertDialog open={isDeactivateAlertOpen} onOpenChange={setIsDeactivateAlertOpen}>
        <AlertDialogContent className="font-sans">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-rose-600">Deactivate Employee Profile?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              This will deactivate <strong>{selectedStaff?.name}</strong> and automatically revoke their portal login access.
              Historical invoices, attendance logs, and financial records will remain completely intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700 text-white" onClick={handleConfirmDeactivate}>
              Deactivate Employee
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
