import Decimal from 'decimal.js';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import { toast } from '@/context/ToastContext';
import {
  BalanceSheetSummary,
  CustodyTransaction,
  CashDrawer,
} from '@/types/salon';
import { User } from '@/types/auth';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  downloadReportExcel,
  downloadReportCsv,
  printReportWindow,
} from '@/features/reports/reportUtils';
import {
  FileSpreadsheet,
  FileText,
  Printer,
  RotateCw,
  MinusSquare,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  Scale,
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  ShieldCheck,
} from 'lucide-react';

const formatPKR = (num: number) => {
  const val = Number(num) || 0;
  return `PKR ${Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const MyBalanceSheetPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();
  const { navigate } = useRouter();

  // Role guard: Super Admin, Admin, and Accountant.
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/accounts/my-balance-sheet" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isAdmin = user.role === 'ADMIN';

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

  // Target User (Admin can select other staff/cashiers, otherwise strictly logged in user)
  const [targetUserId, setTargetUserId] = useState<string>(user.id);
  const [branchUsers, setBranchUsers] = useState<User[]>([]);

  // Period preset state
  type PeriodType = 'CURRENT_SHIFT' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('CURRENT_SHIFT');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Loaded data
  const [summary, setSummary] = useState<BalanceSheetSummary | null>(null);
  const [transactions, setTransactions] = useState<CustodyTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load branch users for the Admin/SuperAdmin selector dropdown
  useEffect(() => {
    let isMounted = true;
    async function loadUsers() {
      if (user && (isSuperAdmin || isAdmin)) {
        try {
          const users = await salonService.getUsers(user, selectedBranchId || 'ALL');
          if (isMounted) {
            setBranchUsers(users.filter((u) => u.role !== 'STAFF'));
          }
        } catch {
          // ignore
        }
      }
    }
    loadUsers();
    return () => {
      isMounted = false;
    };
  }, [selectedBranchId, isSuperAdmin, isAdmin]);

  // Compute date range from period preset
  const { dateFrom, dateTo } = useMemo(() => {
    const today = new Date();
    const todayStr = ymd(today);

    switch (selectedPeriod) {
      case 'TODAY':
        return { dateFrom: todayStr, dateTo: todayStr };
      case 'YESTERDAY': {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        const yStr = ymd(y);
        return { dateFrom: yStr, dateTo: yStr };
      }
      case 'THIS_WEEK': {
        const offset = (today.getDay() + 6) % 7;
        const monday = new Date(today);
        monday.setDate(monday.getDate() - offset);
        return { dateFrom: ymd(monday), dateTo: todayStr };
      }
      case 'THIS_MONTH': {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        return { dateFrom: ymd(firstDay), dateTo: todayStr };
      }
      case 'CUSTOM':
        return { dateFrom: customStartDate || undefined, dateTo: customEndDate || undefined };
      case 'CURRENT_SHIFT':
      default:
        // Current shift passes undefined dates to query active custody/session
        return { dateFrom: undefined, dateTo: undefined };
    }
  }, [selectedPeriod, customStartDate, customEndDate]);

  // Fetch statement data
  const loadStatement = useCallback(async (isManual = false) => {
    if (!selectedBranchId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await salonService.getCashCustodyStatement(
        {
          branchId: selectedBranchId,
          userId: targetUserId,
          startDate: dateFrom,
          endDate: dateTo,
        },
        user
      );
      setSummary(res.summary);
      setTransactions(res.transactions || []);
      if (isManual) toast.success('Balance sheet refreshed.');
    } catch (err: any) {
      console.warn('Cash custody load warning:', err);
      if (isManual) toast.error(err.message || 'Failed to refresh cash custody balance sheet.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranchId, targetUserId, dateFrom, dateTo, user]);

  useEffect(() => {
    loadStatement(false);
  }, [loadStatement]);

  // Separate transactions into Collections (Payments) and Expenses & Refunds
  const collectionsList = useMemo(() => {
    return transactions.filter(
      (t) =>
        t.cashIn > 0 ||
        t.type === 'STAFF_LOAN_REVERSAL' ||
        t.type === 'POS_SALE' ||
        t.type === 'DUES_COLLECTION' ||
        t.type === 'TIP_RECEIVED' ||
        t.type === 'FLOAT_RECEIVED'
    );
  }, [transactions]);

  const expensesList = useMemo(() => {
    return transactions.filter(
      (t) =>
        t.cashOut > 0 ||
        t.type === 'STAFF_LOAN_DISBURSEMENT' ||
        t.type === 'EXPENSE_PAID' ||
        t.type === 'INVOICE_REFUND' ||
        t.type === 'HANDOVER_SETTLEMENT'
    );
  }, [transactions]);

  // Totals
  const totalCollections = useMemo(() => {
    return collectionsList.reduce((acc, t) => acc + (t.cashIn || 0), 0);
  }, [collectionsList]);

  const totalExpenses = useMemo(() => {
    return expensesList.reduce((acc, t) => acc + (t.cashOut || 0), 0);
  }, [expensesList]);

  // Summary Metrics
  const openingCash = summary?.openingCash ?? 0;
  const cashSales = summary?.cashSalesTotal ?? 0;
  const duesCollected = summary?.previousDuesCollectedTotal ?? 0;
  const tipsCollected = summary?.cashTipsTotal ?? 0;
  const bookingAdvances = summary?.bookingAdvancesTotal ?? 0;
  const bookingRefunds = summary?.bookingRefundsTotal ?? 0;
  const totalCashCollections = cashSales + duesCollected + tipsCollected + bookingAdvances || totalCollections;
  const cashExpenses = summary?.cashExpensesPaidTotal ?? expensesList.filter((t) => t.type !== 'INVOICE_REFUND' && t.type !== 'HANDOVER_SETTLEMENT' && t.type !== 'STAFF_LOAN_DISBURSEMENT').reduce((acc, t) => acc + (t.cashOut || 0), 0);
  const cashRefunds = (summary?.cashRefundsPaidTotal ?? expensesList.filter((t) => t.type === 'INVOICE_REFUND').reduce((acc, t) => acc + (t.cashOut || 0), 0)) + bookingRefunds;
  const handovers = summary?.approvedHandoversTotal ?? expensesList.filter((t) => t.type === 'HANDOVER_SETTLEMENT').reduce((acc, t) => acc + (t.cashOut || 0), 0);
  const nonCash = summary?.onlineCollectionsTotal ?? 0;
  const loanCash = (type: CustodyTransaction['type'], field: 'cashIn' | 'cashOut') => transactions.filter(t => t.type === type).reduce((sum, t) => sum.plus(t[field] || 0), new Decimal(0));
  const staffLoanOutflow = new Decimal(summary?.staffLoanDisbursementsTotal ?? loanCash('STAFF_LOAN_DISBURSEMENT', 'cashOut')).minus(summary?.staffLoanReversalsTotal ?? loanCash('STAFF_LOAN_REVERSAL', 'cashIn')).toDecimalPlaces(2).toNumber();
  const expectedCash = summary?.expectedCashInCustody ?? Math.max(0, openingCash + totalCashCollections - cashExpenses - staffLoanOutflow - cashRefunds - handovers);
  const remainingUnsettled = Math.max(0, expectedCash);
  const isSettled = remainingUnsettled === 0;

  // Header Title
  const isViewingSelf = targetUserId === user.id;
  const isSupervisorMode = (isSuperAdmin || isAdmin) && !isViewingSelf;
  const pageTitle = isSupervisorMode ? 'Cash Balance Sheets' : 'My Cash Balance Sheet';

  // Export handlers
  const handleExportExcel = () => {
    const meta: [string, string][] = [
      ['Report', pageTitle],
      ['User', (summary?.user?.name || user.name) + ` (${summary?.user?.role || user.role})`],
      ['Branch', summary?.branch?.name || selectedBranchId],
      ['Period', selectedPeriod],
      ['Expected Cash', formatPKR(expectedCash)],
      ['Staff Loan Disbursements - Non-Operating (Net of Reversals)', formatPKR(staffLoanOutflow)],
      ['Generated At', new Date().toLocaleString()],
    ];

    const collHeaders = ['#', 'RECEIPT / REF', 'CATEGORY', 'METHOD', 'AMOUNT'];
    const collRows = collectionsList.map((t, idx) => [
      idx + 1,
      t.referenceNumber || '—',
      t.type === 'STAFF_LOAN_REVERSAL' ? 'Staff Loan Reversal' : t.type === 'POS_SALE' ? 'Collection' : t.type === 'DUES_COLLECTION' ? 'Dues' : t.type === 'TIP_RECEIVED' ? 'Tip' : 'Collection',
      (t as any).paymentMethod || 'CASH',
      `PKR ${(t.cashIn || 0).toLocaleString()}`,
    ]);

    const expHeaders = ['#', 'REF / RECEIPT', 'EXPENSE / REASON', 'METHOD', 'AMOUNT'];
    const expRows = expensesList.map((t, idx) => [
      idx + 1,
      t.referenceNumber || '—',
      t.description || t.type || 'Expense',
      (t as any).paymentMethod || 'CASH',
      `PKR ${(t.cashOut || 0).toLocaleString()}`,
    ]);

    downloadReportExcel(
      `${pageTitle.replace(/\s+/g, '_')}_${ymd(new Date())}`,
      meta,
      [
        { headers: collHeaders, rows: collRows },
        { headers: expHeaders, rows: expRows },
      ]
    );
  };

  const handleExportCSV = () => {
    const meta: [string, string][] = [
      ['Report', pageTitle],
      ['User', (summary?.user?.name || user.name)],
      ['Period', selectedPeriod],
      ['Expected Cash', formatPKR(expectedCash)],
      ['Staff Loan Disbursements - Non-Operating (Net of Reversals)', formatPKR(staffLoanOutflow)],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = ['#', 'Type', 'Receipt / Ref', 'Category / Reason', 'Method', 'Amount (PKR)', 'Date', 'Time'];
    const rows = [
      ...collectionsList.map((t, i) => [
        i + 1,
        'Collection',
        t.referenceNumber || '—',
        t.type,
        (t as any).paymentMethod || 'CASH',
        (t.cashIn || 0).toFixed(2),
        t.date || '—',
        t.time || '—',
      ]),
      ...expensesList.map((t, i) => [
        collectionsList.length + i + 1,
        t.type === 'STAFF_LOAN_DISBURSEMENT' ? 'Non-Operating Staff Loan' : 'Expense',
        t.referenceNumber || '—',
        t.description || t.type,
        (t as any).paymentMethod || 'CASH',
        `-${(t.cashOut || 0).toFixed(2)}`,
        t.date || '—',
        t.time || '—',
      ]),
    ];

    downloadReportCsv(`${pageTitle.replace(/\s+/g, '_')}_${ymd(new Date())}`, meta, [{ headers, rows }]);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* 1. Header Banner with Actions */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Scale className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#23151D]">{pageTitle}</h1>
                {!isSupervisorMode && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold border ${
                      isSettled
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {isSettled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Settled</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Unsettled</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {selectedPeriod === 'CURRENT_SHIFT'
                  ? 'Real-time shift drawer balance audit and physical cash tracking'
                  : `Historical statement audit period: ${selectedPeriod}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors shadow-2xs cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50/80 px-3 py-2 text-xs font-bold text-teal-700 hover:bg-teal-100 transition-colors shadow-2xs cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors shadow-2xs cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>

            <button
              type="button"
              onClick={() => loadStatement(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/80 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-white hover:text-slate-900 transition-colors cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#B82E69]' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Top Metric KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Opening Cash */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Opening Balance</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-slate-800 font-mono tracking-tight">
              {formatPKR(openingCash)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Float / Carry forward</p>
          </div>
        </div>

        {/* Cash In (Collections) */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Collections</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-emerald-600 font-mono tracking-tight">
              +{formatPKR(totalCashCollections)}
            </div>
            <p className="text-[11px] text-emerald-700/80 mt-0.5">{collectionsList.length} receipt records</p>
          </div>
        </div>

        {/* Cash Out (Expenses & Refunds) */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Paid Out</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-[#B82E69]">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-[#B82E69] font-mono tracking-tight">
              -{formatPKR(totalExpenses)}
            </div>
            <p className="text-[11px] text-rose-600/80 mt-0.5">{expensesList.length} expense/refund records</p>
          </div>
        </div>

        {/* Expected Physical Cash */}
        <div className="relative overflow-hidden rounded-[20px] border border-white/90 bg-gradient-to-br from-white/90 via-white/80 to-[#B82E69]/5 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Expected In Drawer</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#B82E69]/10 text-[#B82E69]">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl font-extrabold text-[#23151D] font-mono tracking-tight">
              {formatPKR(expectedCash)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Physical cash in custody</p>
          </div>
        </div>
      </div>

      {/* 3. Filter Bar (PERIOD Pills + Dropdowns) */}
      <div className="rounded-[20px] border border-white/90 bg-white/75 p-4 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: PERIOD Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase mr-1">
            PERIOD:
          </span>

          {(
            [
              { id: 'CURRENT_SHIFT', label: 'Current Shift' },
              { id: 'TODAY', label: 'Today' },
              { id: 'YESTERDAY', label: 'Yesterday' },
              { id: 'THIS_WEEK', label: 'This Week' },
              { id: 'THIS_MONTH', label: 'This Month' },
              { id: 'CUSTOM', label: 'Custom' },
            ] as const
          ).map((p) => {
            const isActive = selectedPeriod === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPeriod(p.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white shadow-xs'
                    : 'bg-white/80 hover:bg-white text-slate-600 border border-slate-200/80'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Right: Branch & User dropdown for Supervisor/Admin */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Branch selector for Super Admin */}
          {isSuperAdmin && allBranches && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase">BRANCH:</span>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="text-xs font-semibold border border-slate-200 rounded-xl px-3 py-1.5 bg-white/90 text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
              >
                {allBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* User Selector for Admins */}
          {(isSuperAdmin || isAdmin) && branchUsers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase">USER:</span>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="text-xs font-semibold border border-slate-200 rounded-xl px-3 py-1.5 bg-white/90 text-slate-800 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
              >
                <option value={user.id}>
                  {user.name} ({user.role === 'ADMIN' ? 'Admin' : user.role})
                </option>
                {branchUsers
                  .filter((u) => u.id !== user.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role === 'ACCOUNTANT' ? 'Front Desk / Cashier' : u.role})
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Custom Date Pickers row if Custom is selected */}
      {selectedPeriod === 'CUSTOM' && (
        <div className="rounded-[20px] border border-white/90 bg-white/75 p-4 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">From:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">To:</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30"
            />
          </div>
          <button
            type="button"
            onClick={() => loadStatement(true)}
            className="rounded-xl bg-gradient-to-r from-[#B82E69] to-[#9D2558] px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-95 cursor-pointer"
          >
            Apply Dates
          </button>
        </div>
      )}

      {/* 4. Main Grid: Two Tables Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Card: Payments (Collections) */}
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <MinusSquare className="w-4 h-4 opacity-90" />
              <span className="font-bold text-sm tracking-wide">Payments (Collections)</span>
            </div>
            <span className="bg-white/20 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full backdrop-blur-xs">
              {collectionsList.length} items
            </span>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 text-center w-10">#</th>
                  <th className="py-3 px-4">Receipt / Ref</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Debit (In)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dashed divide-slate-100">
                {collectionsList.length > 0 ? (
                  collectionsList.map((t, idx) => (
                    <tr key={t.id || idx} className="hover:bg-[#B82E69]/[0.02] transition-colors">
                      <td className="py-3 px-4 text-center text-slate-400 font-medium">{idx + 1}</td>
                      <td className="py-3 px-4 font-bold text-[#B82E69]">
                        {t.referenceNumber || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {t.type === 'POS_SALE'
                          ? 'Collection'
                          : t.type === 'DUES_COLLECTION'
                          ? 'Dues'
                          : t.type === 'TIP_RECEIVED'
                          ? 'Tip'
                          : 'Collection'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700 uppercase">
                        {(t as any).paymentMethod || 'CASH'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-600 font-mono tabular-nums">
                        PKR {(t.cashIn || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 font-medium">
                      No payment records in current custody
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50/40 border-t border-emerald-100 font-bold text-xs">
                  <td colSpan={4} className="py-3 px-4 uppercase tracking-wide text-slate-700">
                    Total Inflow
                  </td>
                  <td className="py-3 px-4 text-right font-extrabold text-emerald-700 font-mono tabular-nums">
                    PKR {totalCollections.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Right Card: Expenses & Refunds */}
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <RotateCw className="w-4 h-4 opacity-90" />
              <span className="font-bold text-sm tracking-wide">Expenses & Refunds</span>
            </div>
            <span className="bg-white/20 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full backdrop-blur-xs">
              {expensesList.length} items
            </span>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 text-center w-10">#</th>
                  <th className="py-3 px-4">Ref / Receipt</th>
                  <th className="py-3 px-4">Expense / Reason</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Credit (Out)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dashed divide-slate-100">
                {expensesList.length > 0 ? (
                  expensesList.map((t, idx) => (
                    <tr key={t.id || idx} className="hover:bg-rose-50/30 transition-colors">
                      <td className="py-3 px-4 text-center text-slate-400 font-medium">{idx + 1}</td>
                      <td className="py-3 px-4 font-bold text-[#B82E69]">
                        {t.referenceNumber || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {t.description || t.type || 'Expense'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700 uppercase">
                        {(t as any).paymentMethod || 'CASH'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#B82E69] font-mono tabular-nums">
                        PKR {(t.cashOut || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 font-medium">
                      No expense / refund records in current custody
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-rose-50/40 border-t border-rose-100 font-bold text-xs">
                  <td colSpan={4} className="py-3 px-4 uppercase tracking-wide text-slate-700">
                    Total Outflow
                  </td>
                  <td className="py-3 px-4 text-right font-extrabold text-[#B82E69] font-mono tabular-nums">
                    PKR {totalExpenses.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* 5. Bottom Full-Width Card: BALANCE SUMMARY */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider">BALANCE AUDIT & RECONCILIATION SUMMARY</h2>
          </div>
          <span className="text-[11px] text-slate-300 font-mono">Real-Time Ledger</span>
        </div>

        <div className="divide-y divide-slate-100 text-xs font-medium">
          {/* Row 1: Opening / Carry Forward Cash */}
          <div className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/50">
            <span className="text-slate-600 font-medium">Opening / Carry Forward Cash:</span>
            <span className="font-bold text-slate-800 font-mono tabular-nums">{formatPKR(openingCash)}</span>
          </div>

          {/* Row 2: (+) Cash Collections (Debit / In) */}
          <div className="flex items-center justify-between px-6 py-3.5 bg-emerald-50/30">
            <div>
              <span className="text-slate-700 font-semibold">(+) Cash Collections (Debit / In)</span>
              {bookingAdvances > 0 && (
                <span className="block text-[11px] text-emerald-700 font-normal">
                  Includes booking advances {formatPKR(bookingAdvances)}
                </span>
              )}
            </div>
            <span className="font-bold text-emerald-700 bg-emerald-100/70 px-3 py-1 rounded-lg font-mono tabular-nums">
              + {formatPKR(totalCashCollections)}
            </span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-slate-100"><span className="text-slate-700 font-medium">Staff Loan Disbursements - Non-Operating (Net of Reversals):</span><span>{formatPKR(staffLoanOutflow)}</span></div>
          {/* Row 3: (-) Cash Expenses (Credit / Out) */}
          <div className="flex items-center justify-between px-6 py-3.5 bg-rose-50/20">
            <span className="text-slate-700 font-medium">(-) Cash Expenses (Credit / Out):</span>
            <span className="font-bold text-[#B82E69] bg-rose-100/60 px-3 py-1 rounded-lg font-mono tabular-nums">
              - {formatPKR(cashExpenses)}
            </span>
          </div>

          {/* Row 4: (-) Cash Refunds (Credit / Out) */}
          <div className="flex items-center justify-between px-6 py-3.5 bg-rose-50/20">
            <span className="text-slate-700 font-medium">(-) Cash Refunds (Credit / Out):</span>
            <span className="font-bold text-[#B82E69] bg-rose-100/60 px-3 py-1 rounded-lg font-mono tabular-nums">
              - {formatPKR(cashRefunds)}
            </span>
          </div>

          {/* Row 5: Non-Cash (Card / Bank / Online) */}
          <div className="flex items-center justify-between px-6 py-3.5 bg-sky-50/20">
            <div>
              <span className="text-slate-700 font-medium">Non-Cash (Card / Bank / Online):</span>
              <span className="block text-[11px] text-slate-400">Directly settled to bank accounts; not physical cash</span>
            </div>
            <span className="font-bold text-sky-700 bg-sky-100/70 px-3 py-1 rounded-lg font-mono tabular-nums">
              {formatPKR(nonCash)}
            </span>
          </div>

          {/* Row 6: Expected Cash (Physical) */}
          <div className="flex items-center justify-between px-6 py-4 bg-emerald-50/60 border-t border-slate-200">
            <span className="text-slate-900 font-bold">Expected Physical Cash in Drawer:</span>
            <span className="font-extrabold text-base text-emerald-700 bg-emerald-100 px-4 py-1.5 rounded-xl font-mono tabular-nums">
              {formatPKR(expectedCash)}
            </span>
          </div>

          {/* Row 7: Remaining (Unsettled) Cash for My Balance Sheet */}
          {!isSupervisorMode && (
            <div className="flex items-center justify-between px-6 py-4 bg-amber-50/50 border-t border-amber-100">
              <span className="text-slate-900 font-bold">Remaining Unsettled Shift Balance:</span>
              <span className="font-extrabold text-base text-amber-700 bg-amber-100 px-4 py-1.5 rounded-xl font-mono tabular-nums">
                {formatPKR(remainingUnsettled)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyBalanceSheetPage;
