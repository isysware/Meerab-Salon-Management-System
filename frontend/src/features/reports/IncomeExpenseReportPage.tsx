import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { incomeExpenseCashFlow, incomeExpenseCashText } from './incomeExpenseDisplay';
import { User } from '@/types/auth';
import {
  IncomeExpenseReport,
  IncomeExpenseReportRow,
  IncomeExpenseReportQuery,
} from '@/types/salon';
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
  List,
  Scale,
  TrendingUp,
  Receipt,
  Wallet,
  Landmark,
  Coins,
  ArrowRightLeft,
} from 'lucide-react';

const selectClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium cursor-pointer transition-all';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

const formatPKR = (amt: number, withSign = false) => {
  const num = Number(amt) || 0;
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (withSign) {
    return num >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return formatted;
};

const formatDateParts = (dateStr: string) => {
  if (!dateStr) return { dayMonth: '—', year: '' };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { dayMonth: dateStr, year: '' };
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = String(d.getFullYear());
    return { dayMonth: `${day} ${month}`, year };
  } catch {
    return { dayMonth: dateStr, year: '' };
  }
};

const formatDateDisplay = (dateStr: string) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDate();
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month}, ${year}`;
  } catch {
    return dateStr;
  }
};

const formatMethod = (method: string) => {
  if (!method) return 'Cash Payment';
  const m = method.toUpperCase();
  if (m === 'CASH') return 'Cash Payment';
  if (m.includes('BANK') || m.includes('ONLINE') || m.includes('TRANSFER')) return 'Bank Transfer';
  if (m.includes('CARD')) return 'Card Payment';
  return method;
};

export const IncomeExpenseReportPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/income-expense" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isAccountant = user.role === 'ACCOUNTANT';
  const defaultBranch = isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '');

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(defaultBranch);
  const [selectedUserType, setSelectedUserType] = useState<string>('ALL');
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Loaded users for filter dropdown
  const [usersList, setUsersList] = useState<User[]>([]);

  // Page state: Only fetch when user explicitly clicks Filter ("filter karna sa aae default nhi")
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<IncomeExpenseReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load users list dynamically
  useEffect(() => {
    let active = true;
    const branchForUsers = selectedBranch !== 'ALL' ? selectedBranch : undefined;
    salonService
      .getUsers(user, branchForUsers)
      .then((data) => {
        if (active && Array.isArray(data)) {
          setUsersList(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load users for filter:', err);
      });
    return () => {
      active = false;
    };
  }, [user, selectedBranch]);

  // Filter user options based on selected user type
  const filteredUsers = useMemo(() => {
    if (selectedUserType === 'ALL') return usersList;
    return usersList.filter((u) => u.role === selectedUserType);
  }, [usersList, selectedUserType]);

  // Execute report fetch on filter submit
  const fetchReport = useCallback(
    async (q: IncomeExpenseReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getIncomeExpenseReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Income & Expense report:', err);
        setErrorMessage(err.message || 'Failed to fetch live income & expense report from server.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const query: IncomeExpenseReportQuery = {
      branchId: selectedBranch,
      startDate: fromDate || undefined,
      endDate: toDate || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      preset: !fromDate && !toDate ? 'THIS_MONTH' : 'CUSTOM',
      userType: isAccountant ? 'ACCOUNTANT' : (selectedUserType !== 'ALL' ? selectedUserType : undefined),
      user: isAccountant ? user.name : (selectedUser !== 'ALL' ? selectedUser : undefined),
    };

    fetchReport(query);
  };

  // Signed Paid total: Net cash settled = income paid - expense paid (e.g. 2,000 - 150 - 50 = PKR 1,800)
  const signedPaid = useMemo(() => {
    if (typeof reportData?.totals?.paid === 'number') {
      return reportData.totals.paid;
    }
    if (!reportData?.rows) return 0;
    return reportData.rows.reduce((acc, r) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);
      const paidVal = isAccruedComm ? 0 : isIncome ? (r.collectionAmount ?? r.paid ?? r.income) : (r.paid ?? r.expense);
      return r.cashFlow !== undefined ? acc + r.cashFlow : isIncome ? acc + paidVal : acc - paidVal;
    }, 0);
  }, [reportData]);

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Income & Expense Reports'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Type',
      'Source',
      'User',
      'Branch',
      'Title',
      'Status',
      'Amount',
      'Paid',
      'Discount',
      'Remaining',
      'Date',
      'Method',
    ];

    const rows = reportData.rows.map((r, i) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);
      const paidVal = isAccruedComm ? 0 : isIncome ? (r.paid ?? r.income) : (r.paid ?? r.expense);
      const remainingVal = isAccruedComm ? (r.remaining || r.expense) : (r.remaining || 0);

      return [
        i + 1,
        r.type === 'SETTLEMENT' ? 'Settlement' : isIncome ? 'Income' : 'Expense',
        r.source || '—',
        r.userOrPayee || '—',
        r.branchName || '—',
        r.description || r.reference || '—',
        r.status || 'PAID',
        (isIncome ? r.income : r.expense) === 0 ? '0.00' : isIncome ? `+${r.income.toFixed(2)}` : `-${r.expense.toFixed(2)}`,
        incomeExpenseCashText(r),
        (r.discount || 0).toFixed(2),
        remainingVal.toFixed(2),
        formatDateDisplay(r.date),
        formatMethod(r.paymentMethod),
      ];
    });

    const signedPaidFormatted = signedPaid >= 0 ? `+${signedPaid.toFixed(2)}` : `-${Math.abs(signedPaid).toFixed(2)}`;
    const totalsRow = [
      'TOTALS (PKR)',
      '',
      '',
      '',
      '',
      '',
      '',
      reportData.totals.net >= 0 ? `+${reportData.totals.net.toFixed(2)}` : `-${Math.abs(reportData.totals.net).toFixed(2)}`,
      signedPaidFormatted,
      (reportData.totals.discount || 0).toFixed(2),
      (reportData.totals.remaining || 0).toFixed(2),
      '',
      '',
    ];

    downloadReportExcel('Income_Expense_Report', meta, [{ headers, rows: [...rows, totalsRow] }]);
  };

  const handleExportCsv = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Report', 'Income & Expense Reports'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Type',
      'Source',
      'User',
      'Branch',
      'Title',
      'Status',
      'Amount',
      'Paid',
      'Discount',
      'Remaining',
      'Date',
      'Method',
    ];

    const rows = reportData.rows.map((r, i) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);
      const paidVal = isAccruedComm ? 0 : isIncome ? (r.paid ?? r.income) : (r.paid ?? r.expense);
      const remainingVal = isAccruedComm ? (r.remaining || r.expense) : (r.remaining || 0);

      return [
        i + 1,
        r.type === 'SETTLEMENT' ? 'Settlement' : isIncome ? 'Income' : 'Expense',
        r.source || '—',
        r.userOrPayee || '—',
        r.branchName || '—',
        r.description || r.reference || '—',
        r.status || 'PAID',
        (isIncome ? r.income : r.expense) === 0 ? '0.00' : isIncome ? `+${r.income.toFixed(2)}` : `-${r.expense.toFixed(2)}`,
        incomeExpenseCashText(r),
        (r.discount || 0).toFixed(2),
        remainingVal.toFixed(2),
        formatDateDisplay(r.date),
        formatMethod(r.paymentMethod),
      ];
    });

    const signedPaidFormatted = signedPaid >= 0 ? `+${signedPaid.toFixed(2)}` : `-${Math.abs(signedPaid).toFixed(2)}`;
    const totalsRow = [
      'TOTALS (PKR)',
      '',
      '',
      '',
      '',
      '',
      '',
      reportData.totals.net >= 0 ? `+${reportData.totals.net.toFixed(2)}` : `-${Math.abs(reportData.totals.net).toFixed(2)}`,
      signedPaidFormatted,
      (reportData.totals.discount || 0).toFixed(2),
      (reportData.totals.remaining || 0).toFixed(2),
      '',
      '',
    ];

    downloadReportCsv('Income_Expense_Report', meta, [{ headers, rows: [...rows, totalsRow] }]);
  };

  const handleExportPdf = () => {
    if (!reportData || !reportData.rows.length) {
      window.print();
      return;
    }
    const signedPaidFormatted = signedPaid >= 0 ? `+${formatPKR(signedPaid)}` : `-${formatPKR(Math.abs(signedPaid))}`;
    const meta: [string, string][] = [
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Total Income', `PKR ${formatPKR(reportData.totals.income)}`],
      ['Total Expense', `PKR ${formatPKR(reportData.totals.expense)}`],
      ['Net Settled (Paid)', `PKR ${signedPaidFormatted}`],
      ['Net Position', `PKR ${reportData.totals.net >= 0 ? '+' : '-'}${formatPKR(Math.abs(reportData.totals.net))}`],
    ];
    const headers = ['#', 'Type', 'Source', 'User', 'Branch', 'Title', 'Status', 'Amount', 'Paid', 'Discount', 'Remaining', 'Date', 'Method'];
    const rows = reportData.rows.map((r, i) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);
      const paidVal = isAccruedComm ? 0 : isIncome ? (r.paid ?? r.income) : (r.paid ?? r.expense);
      const remainingVal = isAccruedComm ? (r.remaining || r.expense) : (r.remaining || 0);

      return [
        i + 1,
        r.type === 'SETTLEMENT' ? 'Settlement' : isIncome ? 'Income' : 'Expense',
        r.source || '—',
        r.userOrPayee || '—',
        r.branchName || '—',
        r.description || r.reference || '—',
        r.status || 'PAID',
        (isIncome ? r.income : r.expense) === 0 ? '0.00' : isIncome ? `+${formatPKR(r.income)}` : `-${formatPKR(r.expense)}`,
        r.cashFlow !== undefined ? `${r.cashFlow >= 0 ? '+' : '-'}${formatPKR(Math.abs(r.cashFlow))}` : isAccruedComm || paidVal === 0 ? '0.00' : isIncome ? `+${formatPKR(paidVal)}` : `-${formatPKR(paidVal)}`,
        formatPKR(r.discount || 0),
        formatPKR(remainingVal),
        formatDateDisplay(r.date),
        formatMethod(r.paymentMethod),
      ];
    });

    printReportWindow({
      title: 'Income & Expense Reports',
      subtitle: 'Generated Report Document',
      meta,
      headers,
      rows,
      totals: [
        'TOTALS (PKR)',
        '',
        '',
        '',
        '',
        '',
        '',
        reportData.totals.net >= 0 ? `+${formatPKR(reportData.totals.net)}` : `-${formatPKR(Math.abs(reportData.totals.net))}`,
        signedPaidFormatted,
        `+${formatPKR(reportData.totals.discount || 0)}`,
        `+${formatPKR(reportData.totals.remaining || 0)}`,
        '',
        '',
      ],
    });
  };

  const handlePrint = () => {
    handleExportPdf();
  };

  // Calculations for bottom summary & Row 3 KPI Cards
  const totals = reportData?.totals ? { ...reportData.totals, paid: signedPaid } : { income: 0, expense: 0, paid: 0, discount: 0, remaining: 0, net: 0 };
  const totalCashCollected = totals.income;
  const totalExpensesRecognized = totals.expense;
  const netRealizedPosition = totals.net ?? ((totals.income || 0) - (totals.expense || 0));

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Scale className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Income & Expense Reports
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  Accrual & Cash
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Executive revenue register: POS sales and fee collections · Operational expense vouchers, salaries & commissions
              </p>
            </div>
          </div>

          {isAccountant && (
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FDF2F5] border border-white/80 shadow-2xs text-xs font-semibold text-[#B82E69]">
              <span className="w-2 h-2 rounded-full bg-[#B82E69] animate-pulse" />
              <span>Personal Accountant Register: {user.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters} className={`grid grid-cols-1 sm:grid-cols-2 ${!isAccountant ? 'md:grid-cols-6' : 'md:grid-cols-5'} gap-3.5 items-end`}>
          {/* Branch Filter */}
          <div>
            <label className={labelClass}>Branch</label>
            <select
              value={selectedBranch}
              disabled={!isSuperAdmin}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setSelectedUser('ALL');
              }}
              className={selectClass}
            >
              {isSuperAdmin && <option value="ALL">All Branches</option>}
              {allBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {!isAccountant ? (
            <>
              {/* User Type Filter */}
              <div>
                <label className={labelClass}>User Type</label>
                <select
                  value={selectedUserType}
                  onChange={(e) => {
                    setSelectedUserType(e.target.value);
                    setSelectedUser('ALL');
                  }}
                  className={selectClass}
                >
                  <option value="ALL">All Types</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                  <option value="ADMIN">Admin</option>
                  <option value="ACCOUNTANT">Accountant</option>
                  <option value="STAFF">Staff</option>
                </select>
              </div>

              {/* User Filter */}
              <div>
                <label className={labelClass}>User</label>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className={selectClass}
                >
                  <option value="ALL">All Users</option>
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div>
              <label className={labelClass}>Account Scope</label>
              <input
                type="text"
                disabled
                value={`${user.name} (My Sales & Expenses)`}
                className={`${inputClass} bg-slate-100/70 text-slate-600 font-medium cursor-not-allowed`}
              />
            </div>
          )}

          {/* From Date */}
          <div>
            <label className={labelClass}>From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* To Date */}
          <div>
            <label className={labelClass}>To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass}
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
        </form>
      </div>

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR FINANCIAL KPI CARDS (when filtered) ── */}
      {hasFiltered && reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Recognized Revenue */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Revenue
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals.income)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Collected revenue (excl. tax)
                {reportData?.totals?.recognizedIncome && reportData.totals.recognizedIncome !== totals.income ? (
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    Accrual sales: PKR {formatPKR(reportData.totals.recognizedIncome)}
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          {/* Card 2: Operating Expenses */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                <Receipt className="w-4 h-4" />
              </div>
              <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Expenses
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totalExpensesRecognized)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Vouchers, salaries & commissions
              </span>
            </div>
          </div>

          {/* Card 3: Net Operating Profit */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Landmark className="w-4 h-4" />
              </div>
              <span className={`shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full ${netRealizedPosition >= 0 ? 'bg-[#FDF2F5] text-[#B82E69]' : 'bg-rose-50 text-rose-700'}`}>
                {netRealizedPosition >= 0 ? 'Net Profit' : 'Net Loss'}
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className={`text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight block ${netRealizedPosition >= 0 ? 'text-[#18191B]' : 'text-rose-600'}`}>
                {netRealizedPosition >= 0 ? `PKR ${formatPKR(netRealizedPosition)}` : `-PKR ${formatPKR(Math.abs(netRealizedPosition))}`}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Operating bottomline position
              </span>
            </div>
          </div>

          {/* Card 4: Net Cash Collected / Paid */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <Wallet className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Collections
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData?.totals?.collections ?? signedPaid)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Net cash & bank payments
                {reportData?.totals?.collectedTax && reportData.totals.collectedTax > 0 ? (
                  <span className="block text-[10px] text-blue-500 mt-0.5">
                    Tax portion: PKR {formatPKR(reportData.totals.collectedTax)}
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          {/* Card 5: Outstanding Balance */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                <Coins className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Outstanding
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals.remaining || 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Receivables & accrued payables
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. MAIN CONTENT AREA ── */}
      {!hasFiltered ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 md:p-24 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-2xs">
            <Filter className="w-8 h-8 stroke-[1.75]" />
          </div>
          <h3 className="text-base font-semibold text-[#18191B]">Ready to Generate Report</h3>
          <p className="text-xs text-[#78616C] font-medium mt-1 max-w-sm">
            Select branch, date range, or user scope above and click Apply Filters to load live data.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center min-h-[380px] text-center">
          <div className="w-12 h-12 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-4" />
          <p className="text-slate-800 text-sm font-semibold">Loading Income & Expense Reports...</p>
          <p className="text-xs text-slate-500 mt-0.5">Fetching reconciled data from database</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-[24px] border border-rose-200 bg-white/90 p-8 backdrop-blur-2xl shadow-xs text-center">
          <p className="text-rose-600 text-sm font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-4 py-2 bg-[#B82E69] text-white text-xs font-semibold rounded-xl shadow-xs hover:bg-[#A02358] cursor-pointer"
          >
            Retry Fetch
          </button>
        </div>
      ) : (
        /* ── FILTERED DATA TABLE ── */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* Table Header Bar */}
          <div className="p-5 border-b border-white/80 flex flex-wrap items-center justify-between gap-3 bg-white/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <List className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-[#18191B] tracking-tight">Income & Expense Ledger</h3>
                  <span className="bg-[#FDF2F5] text-[#B82E69] border border-white/80 shadow-2xs text-[11px] font-bold px-2 py-0.5 rounded-full font-mono">
                    {reportData?.rows.length ?? 0} records
                  </span>
                </div>
                <p className="text-[11px] text-[#78616C] mt-0.5">
                  Showing detailed operational vouchers, sales invoices and settlements
                </p>
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={handleExportExcel}
                className="h-8 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Export data to Excel"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="h-8 px-3 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Export raw data to CSV"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-600" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="h-8 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Download or Print PDF"
              >
                <Printer className="w-3.5 h-3.5 text-rose-600" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Print ledger statement"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto w-full">
            <table className="report-records w-full min-w-[1300px] text-left border-collapse text-xs">
              <thead className="bg-[#FAF8F9]/80 text-slate-700 font-semibold border-b border-slate-100 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4 text-center w-12 text-slate-500">#</th>
                  <th className="py-3 px-4 w-24">Type</th>
                  <th className="py-3 px-4 whitespace-nowrap">Source</th>
                  <th className="py-3 px-4 whitespace-nowrap">User</th>
                  <th className="py-3 px-4 whitespace-nowrap">Branch</th>
                  <th className="py-3 px-4 min-w-[220px]">Title</th>
                  <th className="py-3 px-4 text-center w-24">Status</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Amount</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Total Paid / Collection</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Discount</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Remaining</th>
                  <th className="py-3 px-4 whitespace-nowrap">Date</th>
                  <th className="py-3 px-4 whitespace-nowrap">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportData && reportData.rows.length > 0 ? (
                  reportData.rows.map((row: IncomeExpenseReportRow, idx: number) => {
                    const isIncome = row.income > 0 || row.type === 'INCOME';
                    const amountValue = isIncome ? row.income : row.expense;
                    const isAccruedComm = row.type === 'COMMISSION_EXPENSE' && (row.status === 'ACCRUED' || !row.paid);
                    const paidValue = isAccruedComm ? 0 : isIncome ? (row.paid ?? row.income) : (row.paid ?? row.expense);
                    const discountValue = row.discount || 0;
                    const remainingValue = isAccruedComm ? (row.remaining || row.expense) : (row.remaining || 0);
                    const dateParts = formatDateParts(row.date);

                    return (
                      <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        {/* 1. # */}
                        <td className="py-3.5 px-4 text-center font-medium text-slate-400 font-mono">
                          {idx + 1}
                        </td>

                        {/* 2. Type */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {row.type === 'SETTLEMENT' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69]">
                              Settlement
                            </span>
                          ) : isIncome ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                              Income
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700">
                              Expense
                            </span>
                          )}
                        </td>

                        {/* 3. Source */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] font-medium">
                          {row.paymentEventType ? row.paymentEventType.replaceAll('_', ' ') : row.source || (isIncome ? 'Fee Collection' : 'Expense')}
                        </td>

                        {/* 4. User */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#334155] font-medium">
                          {row.userOrPayee || 'Staff'}
                        </td>

                        {/* 5. Branch */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-[#475569]">
                          {row.branchName || 'Main Branch'}
                        </td>

                        {/* 6. Title */}
                        <td className="py-3.5 px-4 text-[#18191B] font-medium max-w-[240px] truncate" title={row.description || row.reference}>
                          {row.description || row.reference || '—'}
                        </td>

                        {/* 7. Status */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {row.status === 'PAID' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                              Paid
                            </span>
                          ) : row.status === 'FINALIZED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                              Finalized
                            </span>
                          ) : row.status === 'ACCRUED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
                              Accrued
                            </span>
                          ) : row.status === 'PARTIAL' || row.status === 'PARTIALLY_PAID' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
                              Partial
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                              {row.status || 'Unpaid'}
                            </span>
                          )}
                        </td>

                        {/* 8. Amount (Recognized) */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums font-semibold">
                          <span className={isIncome ? 'text-emerald-700' : 'text-rose-700'}>
                            {amountValue === 0 ? '0.00' : formatPKR(amountValue * (isIncome ? 1 : -1), true)}
                          </span>
                        </td>

                        {/* 9. Paid (Cash Flow) */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums font-semibold">
                          <span className={incomeExpenseCashFlow(row) < 0 ? 'text-rose-700' : incomeExpenseCashFlow(row) > 0 ? 'text-emerald-700' : 'text-slate-400'}>
                            {incomeExpenseCashFlow(row) === 0 ? '0.00' : formatPKR(incomeExpenseCashFlow(row), true)}
                          </span>
                        </td>

                        {/* 10. Discount */}
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatPKR(discountValue)}
                        </td>

                        {/* 11. Remaining (Receivable / Payable) */}
                        <td className={`py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap ${isAccruedComm ? 'text-amber-700 font-semibold' : remainingValue > 0 ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>
                          <span>{formatPKR(remainingValue)}</span>
                          {isAccruedComm && <span className="ml-1 text-[10px] text-amber-600 font-normal">(Payable)</span>}
                        </td>

                        {/* 12. Date */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                          <div className="leading-tight">
                            <div className="font-medium text-[#18191B]">{dateParts.dayMonth}</div>
                            {dateParts.year && <div className="text-[11px] text-slate-400">{dateParts.year}</div>}
                          </div>
                        </td>

                        {/* 13. Method */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 font-medium">
                          {formatMethod(row.paymentMethod)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={13} className="py-16 text-center text-slate-400 font-medium">
                      No records found for the selected branch, dates, and filters.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Integrated Table Footer */}
              <tfoot className="bg-[#FAF8F9]/90 border-t-2 border-slate-200 text-xs">
                {reportData?.totals.collections !== undefined && (
                  <tr className="border-b border-slate-200/70">
                    <td colSpan={7} className="py-3 px-4 text-right font-semibold text-slate-700">Total Collections (Net Client Payments)</td>
                    <td colSpan={4} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-emerald-700">{formatPKR(reportData.totals.collections, true)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
                {/* Row 1: TOTALS (PKR) */}
                <tr className="border-b border-slate-200/70 font-bold">
                  <td colSpan={7} className="py-3.5 px-4 text-right text-slate-900 tracking-wide uppercase text-[11px]">
                    TOTALS (PKR)
                  </td>
                  {/* Col 8: Amount (Net recognized position) */}
                  <td className={`py-3.5 px-4 text-right font-mono tabular-nums text-sm ${totals.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {totals.net >= 0 ? `+${formatPKR(totals.net)}` : `-${formatPKR(Math.abs(totals.net))}`}
                  </td>
                  {/* Col 9: Paid */}
                  <td className={`py-3.5 px-4 text-right font-mono tabular-nums text-sm ${signedPaid >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {signedPaid >= 0 ? `+${formatPKR(signedPaid)}` : `-${formatPKR(Math.abs(signedPaid))}`}
                  </td>
                  {/* Col 10: Discount */}
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                    +{formatPKR(totals.discount || 0)}
                  </td>
                  {/* Col 11: Remaining */}
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-amber-700">
                    +{formatPKR(totals.remaining || 0)}
                  </td>
                  {/* Col 12 & 13: Date & Method */}
                  <td colSpan={2} className="py-3.5 px-4"></td>
                </tr>

                {/* Row 2: Recognized Business Revenue */}
                <tr className="border-b border-slate-200/70">
                  <td colSpan={7} className="py-3 px-4 text-right font-medium text-slate-700">
                    Recognized Business Revenue (Accrual Net Sales)
                  </td>
                  <td colSpan={4} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-emerald-700">
                    +{formatPKR(totals.income)}
                  </td>
                  <td colSpan={2} className="py-3 px-4"></td>
                </tr>

                {/* Row 3: Cost of Goods Sold (COGS & Consumables) */}
                {reportData?.kpis?.cogs !== undefined && (
                  <tr className="border-b border-slate-200/70">
                    <td colSpan={7} className="py-3 px-4 text-right font-medium text-slate-700">
                      Cost of Goods Sold (Retail COGS & Consumable Usage)
                    </td>
                    <td colSpan={4} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-amber-600">
                      -{formatPKR(reportData.kpis.cogs || 0)}
                    </td>
                    <td colSpan={2} className="py-3 px-4"></td>
                  </tr>
                )}

                {/* Row 4: Operating Overheads */}
                <tr className="border-b border-slate-200/70">
                  <td colSpan={7} className="py-3 px-4 text-right font-medium text-slate-700">
                    Operating Expenses (Vouchers, Finalized Salaries & Commission Earned)
                  </td>
                  <td colSpan={4} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-rose-700">
                    -{formatPKR(totalExpensesRecognized)}
                  </td>
                  <td colSpan={2} className="py-3 px-4"></td>
                </tr>

                {/* Row 5: Operating Profit (Revenue - COGS - Expenses) */}
                <tr>
                  <td colSpan={7} className="py-3 px-4 text-right font-bold text-slate-900">
                    Net Operating Profit (Revenue − COGS − Operating Expenses)
                  </td>
                  <td colSpan={4} className={`py-3 px-4 text-right font-bold font-mono tabular-nums text-sm ${netRealizedPosition >= 0 ? 'text-[#B82E69]' : 'text-rose-700'}`}>
                    {netRealizedPosition >= 0 ? `+${formatPKR(netRealizedPosition)}` : `-${formatPKR(Math.abs(netRealizedPosition))}`}
                  </td>
                  <td colSpan={2} className="py-3 px-4"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncomeExpenseReportPage;

