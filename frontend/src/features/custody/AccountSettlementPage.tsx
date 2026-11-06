import { BranchActionField } from '@/components/BranchActionField';
import { useBranchAction } from '@/hooks/useBranchAction';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import {
  Settlement,
  SettlementStatus,
  CashDrawer,
  CreateSettlementInput,
  ApproveSettlementInput,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { toast } from '@/context/ToastContext';
import {
  downloadReportExcel,
  downloadReportCsv,
  printReportWindow,
} from '@/features/reports/reportUtils';
import {
  Search,
  Printer,
  FileSpreadsheet,
  FileText,
  RotateCw,
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRightLeft,
  X,
  FileCheck,
  Eye,
  Check,
  Landmark,
  ShieldCheck,
  Wallet,
  TrendingUp,
} from 'lucide-react';

const formatPKR = (num: number) => {
  const val = Number(num) || 0;
  return `PKR ${Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

export const AccountSettlementPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();
  const { navigate } = useRouter();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/accounts/account-settlement" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isAdmin = user.role === 'ADMIN';
  const canReview = isSuperAdmin || isAdmin;

  // Branch scope
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    isSuperAdmin
      ? activeBranchId && activeBranchId !== 'ALL'
        ? activeBranchId
        : user.branchId || allBranches[0]?.id || ''
      : (user.branchId as string)
  );

  useEffect(() => {
    if (isSuperAdmin && activeBranchId && activeBranchId !== 'ALL') {
      setSelectedBranchId(activeBranchId);
    }
  }, [activeBranchId, isSuperAdmin]);

  // Main state
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [myDrawers, setMyDrawers] = useState<CashDrawer[]>([]);
  const [activeDrawerExpectedCash, setActiveDrawerExpectedCash] = useState<number>(0);
  const [activeDrawer, setActiveDrawer] = useState<CashDrawer | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Settle Current Shift inline form state
  const [countedCashInput, setCountedCashInput] = useState<string>('');
  const [retainedFloatInput, setRetainedFloatInput] = useState<string>('0');
  const [varianceExplanation, setVarianceExplanation] = useState<string>('');
  const [settlementNotes, setSettlementNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showSettleForm, setShowSettleForm] = useState<boolean>(false);

  // Modals for Admin Review & Settlement View
  const [selectedSettlement, setSelectedSettlement] = useState<Settlement | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState<boolean>(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState<boolean>(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState<boolean>(false);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [approvalNotes, setApprovalNotes] = useState<string>('');

  // Load settlements and user drawer
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const list = await salonService.getSettlements(selectedBranchId, undefined, user);
      setSettlements(list || []);

      // Load open drawers for active user
      const drawers = await salonService.getCashDrawers(selectedBranchId, user.id);
      setMyDrawers(drawers || []);
      const openDrawer = drawers.find((d) => d.status === 'OPEN') || drawers[0] || null;
      setActiveDrawer(openDrawer);

      // Fetch custody to get expected cash in drawer
      if (openDrawer) {
        try {
          const res = await salonService.getCashCustodyStatement(
            { branchId: selectedBranchId, userId: user.id, drawerId: openDrawer.id },
            user
          );
          setActiveDrawerExpectedCash(res.summary.expectedCashInCustody || 0);
        } catch {
          setActiveDrawerExpectedCash(openDrawer.expectedInDrawer || 0);
        }
      } else {
        setActiveDrawerExpectedCash(0);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load settlements.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranchId, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadSettlementAction = useCallback(async (branchId: string) => {
    const drawers = await salonService.getCashDrawers(branchId, user.id);
    const drawer = drawers.find((d) => d.branchId === branchId && d.custodianUserId === user.id && d.status === 'OPEN') || null;
    if (!drawer) return { drawer, expected: 0 };
    const statement = await salonService.getCashCustodyStatement({ branchId, userId: user.id, drawerId: drawer.id }, user);
    return { drawer, expected: statement.summary.expectedCashInCustody || 0 };
  }, [user]);
  const actionScope = useBranchAction(true, loadSettlementAction);
  const formDrawer = actionScope.data?.drawer;
  const formExpectedCash = actionScope.data?.expected || 0;

  // Form Calculations
  const countedNum = parseFloat(countedCashInput) || 0;
  const retainedNum = parseFloat(retainedFloatInput) || 0;
  const handoverNum = Math.max(0, countedNum - retainedNum);
  const varianceNum = countedNum - formExpectedCash;

  // Handle inline submit settlement
  const handleInlineSubmitSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionScope.validate()) return;
    if (!formDrawer) {
      const msg = 'No active cash drawer found for settlement.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    if (countedNum < 0 || retainedNum < 0) {
      const msg = 'Amounts must be non-negative numbers.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    if (handoverNum + retainedNum !== countedNum) {
      const msg = 'Handover amount + Retained float must equal total counted cash.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    if (Math.abs(varianceNum) > 0.001 && !varianceExplanation.trim()) {
      const msg = 'A variance explanation is required for a cash shortage or overage.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const destinationVaultName = user.role === 'ACCOUNTANT'
        ? 'Branch Admin'
        : 'Super Admin / Main Vault';
      const payload: CreateSettlementInput = {
        drawerId: formDrawer.id,
        branchId: actionScope.branchId,
        countedCash: countedNum,
        handoverAmount: handoverNum,
        retainedFloat: retainedNum,
        varianceExplanation: varianceExplanation.trim() || undefined,
        destinationVaultName,
        notes: settlementNotes.trim() || undefined,
      };

      await salonService.submitSettlement(payload, user);
      const msg = 'Shift settlement submitted successfully for manager review.';
      setSuccessMessage(msg);
      toast.success(msg);
      setCountedCashInput('');
      setRetainedFloatInput('0');
      setVarianceExplanation('');
      setSettlementNotes('');
      setShowSettleForm(false);
      actionScope.refresh();
      await loadData();
    } catch (err: any) {
      const msg = err.message || 'Failed to submit settlement.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered settlements list
  const filteredSettlements = useMemo(() => {
    return settlements.filter((s) => {
      // Role scoping: Cashier sees only their own; Admin sees all
      if (!canReview && s.submittedByUserId !== user.id) {
        return false;
      }

      // Status Filter
      if (selectedStatus !== 'ALL' && s.status !== selectedStatus) {
        return false;
      }

      // Period Filter
      if (selectedPeriod !== 'ALL' && s.date) {
        const today = new Date().toISOString().slice(0, 10);
        if (selectedPeriod === 'TODAY' && s.date !== today) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesNum = s.settlementNumber.toLowerCase().includes(q);
        const matchesSubmitter = (s.submittedByName || '').toLowerCase().includes(q);
        const matchesNotes = (s.notes || '').toLowerCase().includes(q);
        if (!matchesNum && !matchesSubmitter && !matchesNotes) return false;
      }

      return true;
    });
  }, [settlements, canReview, user.id, selectedStatus, selectedPeriod, searchQuery]);

  // Export handlers
  const handleExportExcel = () => {
    const meta: [string, string][] = [
      ['Report', 'Settlement History'],
      ['Period', selectedPeriod],
      ['Status', selectedStatus],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'SUBMITTED AT',
      'STATUS',
      'EXPECTED CASH',
      'COUNTED CASH',
      'DIFFERENCE',
      'CARRIED FORWARD',
      'REASON',
      'SHIFT PERIOD',
    ];

    const rows = filteredSettlements.map((s, idx) => [
      idx + 1,
      s.submittedAt ? new Date(s.submittedAt).toLocaleString() : s.date,
      s.status,
      `PKR ${(s.expectedCash || 0).toLocaleString()}`,
      `PKR ${(s.countedCash || 0).toLocaleString()}`,
      `PKR ${((s as any).difference ?? s.variance ?? 0).toLocaleString()}`,
      `PKR ${(s.retainedFloat || 0).toLocaleString()}`,
      s.notes || s.varianceExplanation || '—',
      s.date || 'Shift',
    ]);

    downloadReportExcel('Settlement_History', meta, [{ headers, rows }]);
  };

  const handleExportCSV = () => {
    const meta: [string, string][] = [
      ['Report', 'Settlement History'],
      ['Period', selectedPeriod],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Submitted At',
      'Status',
      'Expected Cash',
      'Counted Cash',
      'Difference',
      'Carried Forward',
      'Reason',
      'Date',
    ];

    const rows = filteredSettlements.map((s, idx) => [
      idx + 1,
      s.submittedAt || s.date,
      s.status,
      s.expectedCash,
      s.countedCash,
      (s as any).difference ?? s.variance ?? 0,
      s.retainedFloat || 0,
      s.notes || s.varianceExplanation || '—',
      s.date,
    ]);

    downloadReportCsv('Settlement_History', meta, [{ headers, rows }]);
  };

  const handlePrint = () => {
    window.print();
  };

  // Admin Approve Handler
  const handleApproveSettlement = async () => {
    if (!selectedSettlement) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const payload: ApproveSettlementInput = {
        actualCashReceived: selectedSettlement.handoverAmount,
        destinationVaultId: 'VAULT-MAIN',
        notes: approvalNotes.trim() || undefined,
        acceptVariance: true,
      };
      await salonService.approveSettlement(selectedSettlement.id, payload, user);
      const msg = `Settlement ${selectedSettlement.settlementNumber} approved successfully.`;
      setSuccessMessage(msg);
      toast.success(msg);
      setIsApproveModalOpen(false);
      setSelectedSettlement(null);
      await loadData();
    } catch (err: any) {
      const msg = err.message || 'Failed to approve settlement.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Admin Reject Handler
  const handleRejectSettlement = async () => {
    if (!selectedSettlement) return;
    if (!rejectionReason.trim()) {
      const msg = 'Please provide a reason for rejecting the settlement.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await salonService.rejectSettlement(selectedSettlement.id, rejectionReason.trim(), user);
      const msg = `Settlement ${selectedSettlement.settlementNumber} rejected.`;
      setSuccessMessage(msg);
      toast.success(msg);
      setIsRejectModalOpen(false);
      setSelectedSettlement(null);
      await loadData();
    } catch (err: any) {
      const msg = err.message || 'Failed to reject settlement.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasUnsettledCash = activeDrawerExpectedCash > 0;

  const canApproveSettlement = useCallback(
    (s: Settlement) => {
      if (s.status !== 'SUBMITTED' && s.status !== 'PENDING_VERIFICATION') return false;
      if (s.submittedByUserId === user?.id) return false;

      if (isSuperAdmin) {
        return s.submittedByRole === 'ADMIN';
      }
      if (isAdmin) {
        return (
          s.submittedByRole === 'ACCOUNTANT' &&
          (!selectedBranchId || selectedBranchId === 'ALL' || s.branchId === selectedBranchId)
        );
      }
      return false;
    },
    [isSuperAdmin, isAdmin, user?.id, selectedBranchId]
  );

  const pendingApprovalsCount = useMemo(() => {
    return settlements.filter(canApproveSettlement).length;
  }, [settlements, canApproveSettlement]);

  const totalSettledAmount = useMemo(() => {
    return settlements
      .filter((s) => s.status === 'APPROVED')
      .reduce((acc, s) => acc + (s.handoverAmount || s.countedCash || 0), 0);
  }, [settlements]);

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* 1. Top Header Banner */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Landmark className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#23151D]">
                  {canReview ? 'Account Settlements & Safe Vault' : 'My Account Settlement'}
                </h1>
                {pendingApprovalsCount > 0 && canReview && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                    {pendingApprovalsCount} Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Count the physical drawer cash, reconcile shift variance, and hand over custody to the safe vault.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/accounts/my-balance-sheet')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/80 px-3.5 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-white hover:text-[#B82E69] transition-colors cursor-pointer"
            >
              <FileCheck className="w-3.5 h-3.5 text-[#B82E69]" />
              <span>View Balance Sheet</span>
            </button>

            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/80 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-white transition-colors cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#B82E69]' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Top Metric KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Drawer Expected Cash */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Drawer Expected</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-emerald-600 font-mono tracking-tight">
              {formatPKR(formExpectedCash)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Physical cash due in till</p>
          </div>
        </div>

        {/* Calculated Handover */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Handover Prepared</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-[#B82E69]">
              <ArrowRightLeft className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-[#B82E69] font-mono tracking-tight">
              {formatPKR(handoverNum)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Cash to transfer to vault</p>
          </div>
        </div>

        {/* Retained Float */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Retained Float</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-slate-800 font-mono tracking-tight">
              {formatPKR(retainedNum)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Left in drawer for next shift</p>
          </div>
        </div>

        {/* Total Settled / Pending */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-gradient-to-br from-white/90 via-white/80 to-[#B82E69]/5 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {canReview ? 'Total Approved Vault' : 'Approved Settled'}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#B82E69]/10 text-[#B82E69]">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-[#23151D] font-mono tracking-tight">
              {formatPKR(totalSettledAmount)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">{settlements.length} total records</p>
          </div>
        </div>
      </div>

      {/* 3. Settle Current Shift Card */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
        <div className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArrowRightLeft className="w-4 h-4 text-white/90" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Settle Current Shift Cash Drawer
            </h2>
          </div>
          <span className="text-[11px] font-mono text-white/80">Custodian Handover</span>
        </div>

        <div className="p-6">
          {!isSuperAdmin && !hasUnsettledCash && !showSettleForm ? (
            <div className="py-8 text-center text-slate-500 text-xs font-medium">
              Nothing to settle — you have no unsettled physical cash in custody right now.
            </div>
          ) : (
            <form onSubmit={handleInlineSubmitSettlement} className="space-y-5">
              <BranchActionField
                value={actionScope.branchId}
                disabled={isSubmitting}
                onChange={(id) => {
                  actionScope.setBranchId(id);
                  setCountedCashInput('');
                  setRetainedFloatInput('0');
                  setVarianceExplanation('');
                }}
              />
              {actionScope.error && (
                <p role="alert" className="text-xs text-rose-600 font-medium">
                  {actionScope.error}
                </p>
              )}
              {actionScope.ready && !formDrawer && (
                <p role="status" className="text-xs text-slate-500">
                  No open cash drawer in your custody for this branch.
                </p>
              )}
              <fieldset
                disabled={!actionScope.ready || !formDrawer}
                className="space-y-4 disabled:opacity-50"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Expected Cash in drawer */}
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Expected Cash in Drawer
                    </span>
                    <span className="text-lg font-extrabold text-emerald-700 font-mono tabular-nums">
                      {formatPKR(formExpectedCash)}
                    </span>
                  </div>

                  {/* Counted Cash input */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
                      Counted Cash (PKR) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Enter counted amount"
                      value={countedCashInput}
                      onChange={(e) => setCountedCashInput(e.target.value)}
                      required
                      className="w-full text-xs font-mono font-semibold border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white text-slate-800 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
                    />
                  </div>

                  {/* Retained Float input */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
                      Retained Float (PKR)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Cash left in drawer (usually 0)"
                      value={retainedFloatInput}
                      onChange={(e) => setRetainedFloatInput(e.target.value)}
                      className="w-full text-xs font-mono font-semibold border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white text-slate-800 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
                    />
                  </div>

                  {/* Handover Amount calculated */}
                  <div className="rounded-xl border border-[#B82E69]/20 bg-[#B82E69]/5 p-4">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      {user.role === 'ACCOUNTANT' ? 'Handover to Branch Admin' : 'Handover to Super Admin'}
                    </span>
                    <span className="text-lg font-extrabold text-[#B82E69] font-mono tabular-nums">
                      {formatPKR(handoverNum)}
                    </span>
                  </div>
                </div>

                {/* Difference Indicator */}
                {countedCashInput && (
                  <div
                    className={`text-xs p-3.5 rounded-xl border flex items-center justify-between font-mono ${
                      varianceNum === 0
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : varianceNum > 0
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-rose-50 text-rose-800 border-rose-200'
                    }`}
                  >
                    <span className="font-bold">
                      Difference / Variance:{' '}
                      {varianceNum === 0
                        ? 'Exact Match (Rs. 0)'
                        : varianceNum > 0
                        ? `Cash Overage (+${formatPKR(varianceNum)})`
                        : `Cash Shortage (-${formatPKR(Math.abs(varianceNum))})`}
                    </span>
                  </div>
                )}

                {/* Variance reason if mismatch */}
                {Math.abs(varianceNum) > 0.001 && countedCashInput && (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
                      Variance Explanation *
                    </label>
                    <input
                      type="text"
                      placeholder="Reason for cash difference..."
                      value={varianceExplanation}
                      onChange={(e) => setVarianceExplanation(e.target.value)}
                      required
                      className="w-full text-xs border border-slate-200 rounded-xl px-3.5 py-2 bg-white text-slate-800 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
                    />
                  </div>
                )}

                {/* Submit Buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-xl bg-gradient-to-r from-[#B82E69] to-[#9D2558] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-95 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? 'Submitting Handover...' : 'Submit Settlement Handover'}
                  </button>
                  {showSettleForm && (
                    <button
                      type="button"
                      onClick={() => setShowSettleForm(false)}
                      className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 cursor-pointer font-semibold"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
        </div>
      </div>

      {/* 4. Settlement History Section */}
      <div className="space-y-3">
        {/* Filters Toolbar */}
        <div className="rounded-[20px] border border-white/90 bg-white/75 p-4 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Period Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Period:</span>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="text-xs font-semibold border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
              >
                <option value="ALL">All Time</option>
                <option value="TODAY">Today</option>
                <option value="THIS_WEEK">This Week</option>
                <option value="THIS_MONTH">This Month</option>
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="text-xs font-semibold border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
              >
                <option value="ALL">All</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <button
              type="button"
              onClick={loadData}
              className="rounded-xl bg-gradient-to-r from-[#B82E69] to-[#9D2558] px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-95 cursor-pointer"
            >
              Filter
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedPeriod('ALL');
                setSelectedStatus('ALL');
                setSearchQuery('');
              }}
              className="border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-slate-50 shadow-2xs cursor-pointer"
            >
              Reset
            </button>
          </div>
        </div>

        {/* History Table Container */}
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-5 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <RotateCw className="w-4 h-4 opacity-90" />
              <span className="font-bold text-sm tracking-wide">Settlement History</span>
              <span className="bg-white/20 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full backdrop-blur-xs">
                {filteredSettlements.length} items
              </span>
            </div>

            {/* Search & Export Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search settlements..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="text-xs bg-white/10 hover:bg-white/15 focus:bg-white text-white focus:text-slate-800 placeholder-white/60 focus:placeholder-slate-400 pl-8 pr-3 py-1.5 rounded-xl border border-white/20 focus:border-white focus:outline-hidden transition-all w-44"
                />
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <FileSpreadsheet className="w-3 h-3" />
                <span>Excel</span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="bg-teal-600/90 hover:bg-teal-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <FileText className="w-3 h-3" />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <Printer className="w-3 h-3" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 text-center w-10">#</th>
                  <th className="py-3 px-4">Submitted At</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Expected Cash</th>
                  <th className="py-3 px-4 text-right">Counted Cash</th>
                  <th className="py-3 px-4 text-right">Difference</th>
                  <th className="py-3 px-4 text-right">Float Retained</th>
                  <th className="py-3 px-4">Notes / Variance</th>
                  <th className="py-3 px-4">Shift Period</th>
                  {canReview && <th className="py-3 px-4 text-center">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-dashed divide-slate-100">
                {filteredSettlements.length > 0 ? (
                  filteredSettlements.map((s, idx) => (
                    <tr key={s.id || idx} className="hover:bg-[#B82E69]/[0.02] transition-colors">
                      <td className="py-3 px-4 text-center text-slate-400 font-medium">{idx + 1}</td>
                      <td className="py-3 px-4 font-semibold text-slate-700">
                        <div>
                          {s.submittedAt
                            ? new Date(s.submittedAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : s.date}
                        </div>
                        <div className="text-[11px] text-slate-500 font-normal mt-0.5">
                          {s.submittedByName || 'User'} · <span className="font-medium text-slate-600">{s.submittedByRole === 'ACCOUNTANT' ? 'Sales / Cashier' : s.submittedByRole === 'ADMIN' ? 'Branch Admin' : s.submittedByRole}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              s.status === 'APPROVED'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : s.status === 'REJECTED'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {s.status}
                          </span>
                          {(s.status === 'SUBMITTED' || s.status === 'PENDING_VERIFICATION') && (
                            <span className="text-[9px] font-medium text-slate-500 whitespace-nowrap">
                              {s.submittedByRole === 'ACCOUNTANT' ? '→ Route: Branch Admin' : '→ Route: Super Admin'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-700 font-mono tabular-nums">
                        PKR {(s.expectedCash || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-600 font-mono tabular-nums">
                        PKR {(s.countedCash || 0).toLocaleString()}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-bold font-mono tabular-nums ${
                          (((s as any).difference ?? s.variance ?? 0) === 0)
                            ? 'text-slate-400'
                            : (((s as any).difference ?? s.variance ?? 0) > 0)
                            ? 'text-[#B82E69]'
                            : 'text-rose-600'
                        }`}
                      >
                        PKR {((s as any).difference ?? s.variance ?? 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-600 font-mono tabular-nums">
                        PKR {(s.retainedFloat || 0).toLocaleString()}
                      </td>
                      <td
                        className="py-3 px-4 text-slate-600 max-w-[200px] truncate"
                        title={s.notes || s.varianceExplanation}
                      >
                        {s.notes || s.varianceExplanation || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {s.date || 'Current Shift'}
                      </td>
                      {canReview && (
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSettlement(s);
                                setIsViewModalOpen(true);
                              }}
                              className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                              title="View Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {canApproveSettlement(s) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSettlement(s);
                                    setIsApproveModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-700 shadow-2xs"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSettlement(s);
                                    setIsRejectModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 bg-rose-600 text-white rounded-lg text-[10px] font-bold hover:bg-rose-700 shadow-2xs"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={canReview ? 10 : 9} className="py-12 text-center text-slate-400 font-medium">
                      No settlements recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Admin Approve Modal */}
      {isApproveModalOpen && selectedSettlement && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl border border-white/90 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <h3 className="text-base font-bold text-slate-900 mb-2">
              {isAdmin ? 'Approve Settlement (Accountant → Branch Admin Custody)' : 'Approve Settlement (Branch Admin → Super Admin Custody)'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Confirm cash handover from <span className="font-semibold text-slate-800">{selectedSettlement.submittedByName}</span> ({selectedSettlement.submittedByRole === 'ACCOUNTANT' ? 'Sales / Cashier' : 'Branch Admin'}) for settlement #{selectedSettlement.settlementNumber}.
            </p>
            <div className="bg-slate-50/80 border border-slate-100 p-4 rounded-xl mb-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Handover Amount:</span>
                <span className="font-bold text-emerald-700 font-mono">PKR {selectedSettlement.handoverAmount?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Difference / Variance:</span>
                <span className="font-bold text-slate-800 font-mono">PKR {((selectedSettlement as any).difference ?? selectedSettlement.variance ?? 0).toLocaleString()}</span>
              </div>
            </div>
            <textarea
              placeholder="Approval notes / safe receipt remarks..."
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-xl p-3 mb-4 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
              rows={2}
            />
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsApproveModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveSettlement}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-xs cursor-pointer"
              >
                {isSubmitting ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Reject Modal */}
      {isRejectModalOpen && selectedSettlement && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl border border-white/90 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <h3 className="text-base font-bold text-rose-700 mb-2">Reject Settlement</h3>
            <p className="text-xs text-slate-500 mb-4">
              Return settlement #{selectedSettlement.settlementNumber} to cashier for recount or correction.
            </p>
            <textarea
              placeholder="Reason for rejection (e.g. cash count mismatch)..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              required
              className="w-full text-xs border border-slate-200 rounded-xl p-3 mb-4 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-rose-500/30"
              rows={3}
            />
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectSettlement}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 disabled:opacity-50 shadow-xs cursor-pointer"
              >
                {isSubmitting ? 'Rejecting...' : 'Reject Settlement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Settlement Modal */}
      {isViewModalOpen && selectedSettlement && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl border border-white/90 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Settlement Details ({selectedSettlement.settlementNumber})
              </h3>
              <button onClick={() => setIsViewModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs space-y-2.5 mb-5">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Submitted By:</span>
                <span className="font-semibold text-slate-800">{selectedSettlement.submittedByName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Expected Cash:</span>
                <span className="font-semibold text-slate-800 font-mono">PKR {selectedSettlement.expectedCash?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Counted Cash:</span>
                <span className="font-semibold text-emerald-700 font-mono">PKR {selectedSettlement.countedCash?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Difference:</span>
                <span className="font-semibold text-slate-800 font-mono">PKR {((selectedSettlement as any).difference ?? selectedSettlement.variance ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Handover to Safe:</span>
                <span className="font-semibold text-[#B82E69] font-mono">PKR {selectedSettlement.handoverAmount?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Status:</span>
                <span className="font-bold text-slate-800">{selectedSettlement.status}</span>
              </div>
              {selectedSettlement.notes && (
                <div className="py-1">
                  <span className="text-slate-500 block mb-1">Notes:</span>
                  <p className="text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">{selectedSettlement.notes}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsViewModalOpen(false)}
                className="px-5 py-2 text-xs bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountSettlementPage;
