import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { incomeExpenseCashFlow, incomeExpenseCashText, incomeExpenseCollectionSummary } from './incomeExpenseDisplay';
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
    if (typeof reportData?.totals?.netCashMovement === 'number') return reportData.totals.netCashMovement;
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

  const customerCollections = reportData?.totals.customerCollections ?? reportData?.totals.collections ?? 0;
  const nonOperatingCashOutflows = reportData?.totals.nonOperatingCashOutflows ?? reportData?.kpis.staffLoanCashOutflow ?? 0;

  // Export handlers
  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Collection-Based Operating Surplus', formatPKR(incomeExpenseCollectionSummary(reportData.totals.income, reportData.rows).surplus)],
      ['Actual Paid Operating Expenses', formatPKR(incomeExpenseCollectionSummary(reportData.totals.income, reportData.rows).paidOperatingExpenses)],
      ['Recognized Revenue (Accrual; Separate Information)', formatPKR(reportData.totals.recognizedIncome ?? 0)],
      ['COGS (Separate Accounting Information)', formatPKR(reportData.kpis.cogs ?? 0)],
      ['Total Customer Collections (Net of Customer Refunds; Incl. Tax and Tips)', formatPKR(customerCollections)],
      ['Staff Loan Cash Outflow (Net of Reversals)', formatPKR(reportData.kpis.staffLoanCashOutflow ?? 0)],
      ['Non-Operating Cash Outflows (Net of Reversals)', formatPKR(nonOperatingCashOutflows)],
      ['Net Cash Movement', formatPKR(signedPaid)],
      ...(reportData.kpis.staffLoanReceivable !== undefined ? [['Staff Loan Receivable (Current Branch Balance)', formatPKR(reportData.kpis.staffLoanReceivable)]] as [string, string][] : []),
      ['Report', 'Income & Expense Reports'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Invoice / Reference',
      'Customer / Payee',
      'Type',
      'Branch',
      'Service Amount (Excl. Tax)',
      'Tax Amount',
      'Total Bill (Incl. Tax, Excl. Tip)',
      'Tip Amount',
      'Total Received (Incl. Tip)',
      'Remaining Dues',
      'Payment Status',
      'Date',
      'Payment Method',
    ];

    const rows = reportData.rows.map((r, i) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isSettlement = r.type === 'SETTLEMENT';
      const isRefund = r.type === 'INCOME' && r.source === 'Sales Refund';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);

      const serviceAmountVal = isSettlement ? 0 : isIncome ? (r.serviceAmount ?? r.recognizedIncome ?? r.income) : r.expense;
      const taxVal = isSettlement || !isIncome ? 0 : (r.tax ?? r.collectedTax ?? 0);
      const totalBillVal = isSettlement ? 0 : isIncome ? (r.totalBill ?? (serviceAmountVal + taxVal)) : r.expense;
      const remainingVal = isAccruedComm ? (r.remaining || r.expense) : (r.remainingDues ?? r.remaining ?? 0);

      const customerOrPayee = r.customerName || (r.description?.includes('-') ? r.description.split('-')[1]?.trim() : (r.userOrPayee || r.description || '—'));

      return [
        i + 1,
        r.reference || r.invoiceNumber || r.source || '—',
        customerOrPayee,
        r.type === 'SETTLEMENT' ? 'Settlement' : isRefund ? 'Refund' : isIncome ? 'Income' : 'Expense',
        r.branchName || '—',
        isSettlement ? '0.00' : isRefund ? `-${Math.abs(serviceAmountVal).toFixed(2)}` : isIncome ? `+${serviceAmountVal.toFixed(2)}` : `-${serviceAmountVal.toFixed(2)}`,
        isSettlement || !isIncome ? '0.00' : isRefund ? `-${Math.abs(taxVal).toFixed(2)}` : taxVal.toFixed(2),
        isSettlement ? '0.00' : isRefund ? `-${Math.abs(totalBillVal).toFixed(2)}` : totalBillVal.toFixed(2),
        (r.tipAmount ?? 0).toFixed(2),
        incomeExpenseCashText(r),
        remainingVal.toFixed(2),
        r.status || 'PAID',
        formatDateDisplay(r.date),
        formatMethod(r.paymentMethod),
      ];
    });

    const customerCollectionsFormatted = customerCollections.toFixed(2);
    const totalsRow = [
      'TOTALS (PKR)',
      '',
      '',
      '',
      '',
      `+${(reportData.totals.income || 0).toFixed(2)}`,
      `+${(reportData.totals.collectedTax ?? reportData.kpis?.totalCollectedTax ?? 0).toFixed(2)}`,
      `+${totalBillSum.toFixed(2)}`,
      (reportData.totals.tipAmount ?? 0).toFixed(2),
      customerCollectionsFormatted,
      (reportData.totals.remaining || 0).toFixed(2),
      '',
      '',
      '',
    ];

    downloadReportExcel('Income_Expense_Report', meta, [{ headers, rows: [...rows, totalsRow] }]);
  };

  const handleExportCsv = () => {
    if (!reportData || !reportData.rows.length) return;
    const meta: [string, string][] = [
      ['Collection-Based Operating Surplus', formatPKR(incomeExpenseCollectionSummary(reportData.totals.income, reportData.rows).surplus)],
      ['Actual Paid Operating Expenses', formatPKR(incomeExpenseCollectionSummary(reportData.totals.income, reportData.rows).paidOperatingExpenses)],
      ['Recognized Revenue (Accrual; Separate Information)', formatPKR(reportData.totals.recognizedIncome ?? 0)],
      ['COGS (Separate Accounting Information)', formatPKR(reportData.kpis.cogs ?? 0)],
      ['Total Customer Collections (Net of Customer Refunds; Incl. Tax and Tips)', formatPKR(customerCollections)],
      ['Staff Loan Cash Outflow (Net of Reversals)', formatPKR(reportData.kpis.staffLoanCashOutflow ?? 0)],
      ['Non-Operating Cash Outflows (Net of Reversals)', formatPKR(nonOperatingCashOutflows)],
      ['Net Cash Movement', formatPKR(signedPaid)],
      ...(reportData.kpis.staffLoanReceivable !== undefined ? [['Staff Loan Receivable (Current Branch Balance)', formatPKR(reportData.kpis.staffLoanReceivable)]] as [string, string][] : []),
      ['Report', 'Income & Expense Reports'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Invoice / Reference',
      'Customer / Payee',
      'Type',
      'Branch',
      'Service Amount (Excl. Tax)',
      'Tax Amount',
      'Total Bill (Incl. Tax, Excl. Tip)',
      'Tip Amount',
      'Total Received (Incl. Tip)',
      'Remaining Dues',
      'Payment Status',
      'Date',
      'Payment Method',
    ];

    const rows = reportData.rows.map((r, i) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isSettlement = r.type === 'SETTLEMENT';
      const isRefund = r.type === 'INCOME' && r.source === 'Sales Refund';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);

      const serviceAmountVal = isSettlement ? 0 : isIncome ? (r.serviceAmount ?? r.recognizedIncome ?? r.income) : r.expense;
      const taxVal = isSettlement || !isIncome ? 0 : (r.tax ?? r.collectedTax ?? 0);
      const totalBillVal = isSettlement ? 0 : isIncome ? (r.totalBill ?? (serviceAmountVal + taxVal)) : r.expense;
      const remainingVal = isAccruedComm ? (r.remaining || r.expense) : (r.remainingDues ?? r.remaining ?? 0);

      const customerOrPayee = r.customerName || (r.description?.includes('-') ? r.description.split('-')[1]?.trim() : (r.userOrPayee || r.description || '—'));

      return [
        i + 1,
        r.reference || r.invoiceNumber || r.source || '—',
        customerOrPayee,
        r.type === 'SETTLEMENT' ? 'Settlement' : isRefund ? 'Refund' : isIncome ? 'Income' : 'Expense',
        r.branchName || '—',
        isSettlement ? '0.00' : isRefund ? `-${Math.abs(serviceAmountVal).toFixed(2)}` : isIncome ? `+${serviceAmountVal.toFixed(2)}` : `-${serviceAmountVal.toFixed(2)}`,
        isSettlement || !isIncome ? '0.00' : isRefund ? `-${Math.abs(taxVal).toFixed(2)}` : taxVal.toFixed(2),
        isSettlement ? '0.00' : isRefund ? `-${Math.abs(totalBillVal).toFixed(2)}` : totalBillVal.toFixed(2),
        (r.tipAmount ?? 0).toFixed(2),
        incomeExpenseCashText(r),
        remainingVal.toFixed(2),
        r.status || 'PAID',
        formatDateDisplay(r.date),
        formatMethod(r.paymentMethod),
      ];
    });

    const customerCollectionsFormatted = customerCollections.toFixed(2);
    const totalsRow = [
      'TOTALS (PKR)',
      '',
      '',
      '',
      '',
      `+${(reportData.totals.income || 0).toFixed(2)}`,
      `+${(reportData.totals.collectedTax ?? reportData.kpis?.totalCollectedTax ?? 0).toFixed(2)}`,
      `+${totalBillSum.toFixed(2)}`,
      (reportData.totals.tipAmount ?? 0).toFixed(2),
      customerCollectionsFormatted,
      (reportData.totals.remaining || 0).toFixed(2),
      '',
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
    const customerCollectionsFormatted = formatPKR(customerCollections);
    const meta: [string, string][] = [
      ['Collection-Based Operating Surplus', formatPKR(incomeExpenseCollectionSummary(reportData.totals.income, reportData.rows).surplus)],
      ['Actual Paid Operating Expenses', formatPKR(incomeExpenseCollectionSummary(reportData.totals.income, reportData.rows).paidOperatingExpenses)],
      ['Recognized Revenue (Accrual; Separate Information)', formatPKR(reportData.totals.recognizedIncome ?? 0)],
      ['COGS (Separate Accounting Information)', formatPKR(reportData.kpis.cogs ?? 0)],
      ['Total Customer Collections (Net of Customer Refunds; Incl. Tax and Tips)', formatPKR(customerCollections)],
      ['Staff Loan Cash Outflow (Net of Reversals)', formatPKR(reportData.kpis.staffLoanCashOutflow ?? 0)],
      ['Non-Operating Cash Outflows (Net of Reversals)', formatPKR(nonOperatingCashOutflows)],
      ['Net Cash Movement', formatPKR(signedPaid)],
      ...(reportData.kpis.staffLoanReceivable !== undefined ? [['Staff Loan Receivable (Current Branch Balance)', formatPKR(reportData.kpis.staffLoanReceivable)]] as [string, string][] : []),
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : reportData.meta.branchName || selectedBranch],
      ['From Date', fromDate || reportData.meta.from || '—'],
      ['To Date', toDate || reportData.meta.to || '—'],
      ['Revenue Collected (Excl. Tax)', `PKR ${formatPKR(reportData.totals.income)}`],
      ['Tax Collected', `PKR ${formatPKR(reportData.totals.collectedTax ?? reportData.kpis?.totalCollectedTax ?? 0)}`],
      ['Total Customer Collections (Incl. Tax and Tips)', `PKR ${formatPKR(customerCollections)}`],

      ['Outstanding Dues', `PKR ${formatPKR(reportData.totals.remaining || 0)}`],
    ];
    const headers = [
      '#',
      'Invoice / Reference',
      'Customer / Payee',
      'Type',
      'Branch',
      'Service Amount (Excl. Tax)',
      'Tax Amount',
      'Total Bill (Incl. Tax, Excl. Tip)',
      'Tip Amount',
      'Total Received (Incl. Tip)',
      'Remaining Dues',
      'Status',
      'Date',
      'Method',
    ];
    const rows = reportData.rows.map((r, i) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isSettlement = r.type === 'SETTLEMENT';
      const isRefund = r.type === 'INCOME' && r.source === 'Sales Refund';
      const isAccruedComm = r.type === 'COMMISSION_EXPENSE' && (r.status === 'ACCRUED' || !r.paid);

      const serviceAmountVal = isSettlement ? 0 : isIncome ? (r.serviceAmount ?? r.recognizedIncome ?? r.income) : r.expense;
      const taxVal = isSettlement || !isIncome ? 0 : (r.tax ?? r.collectedTax ?? 0);
      const totalBillVal = isSettlement ? 0 : isIncome ? (r.totalBill ?? (serviceAmountVal + taxVal)) : r.expense;
      const remainingVal = isAccruedComm ? (r.remaining || r.expense) : (r.remainingDues ?? r.remaining ?? 0);

      const customerOrPayee = r.customerName || (r.description?.includes('-') ? r.description.split('-')[1]?.trim() : (r.userOrPayee || r.description || '—'));

      return [
        i + 1,
        r.reference || r.invoiceNumber || r.source || '—',
        customerOrPayee,
        r.type === 'SETTLEMENT' ? 'Settlement' : isRefund ? 'Refund' : isIncome ? 'Income' : 'Expense',
        r.branchName || '—',
        isSettlement ? '0.00' : isRefund ? `-${formatPKR(Math.abs(serviceAmountVal))}` : isIncome ? `+${formatPKR(serviceAmountVal)}` : `-${formatPKR(serviceAmountVal)}`,
        isSettlement || !isIncome ? '0.00' : isRefund ? `-${formatPKR(Math.abs(taxVal))}` : formatPKR(taxVal),
        isSettlement ? '0.00' : isRefund ? `-${formatPKR(Math.abs(totalBillVal))}` : formatPKR(totalBillVal),
        formatPKR(r.tipAmount ?? 0),
        incomeExpenseCashText(r),
        formatPKR(remainingVal),
        r.status || 'PAID',
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
        `+${formatPKR(reportData.totals.income)}`,
        `+${formatPKR(reportData.totals.collectedTax ?? reportData.kpis?.totalCollectedTax ?? 0)}`,
        `+${formatPKR(totalBillSum)}`,
        formatPKR(reportData.totals.tipAmount ?? 0),
        customerCollectionsFormatted,
        `+${formatPKR(reportData.totals.remaining || 0)}`,
        '',
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
  const collectionSummary = incomeExpenseCollectionSummary(totals.income, reportData?.rows ?? []);
  const totalExpensesRecognized = collectionSummary.paidOperatingExpenses;
  const netRealizedPosition = collectionSummary.surplus;

  const totalBillSum = useMemo(() => {
    if (!reportData?.rows) return 0;
    return reportData.rows.reduce((acc, r) => {
      const isIncome = r.income > 0 || r.type === 'INCOME';
      const isSettlement = r.type === 'SETTLEMENT';
      if (isSettlement) return acc;
      if (isIncome) {
        const b = r.totalBill ?? ((r.serviceAmount ?? r.recognizedIncome ?? r.income) + (r.tax ?? r.collectedTax ?? 0));
        return acc + (b || 0);
      }
      return acc;
    }, 0);
  }, [reportData]);

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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* Card 1: Revenue Collected (Excluding Tax) */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Revenue
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals.income)}
              </span>
              <span className="text-[11px] text-[#78616C] font-medium mt-1 block leading-tight">
                Revenue Collected (excl. tax)
                {reportData?.totals?.recognizedIncome && reportData.totals.recognizedIncome !== totals.income ? (
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    Accrual sales: PKR {formatPKR(reportData.totals.recognizedIncome)}
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          {/* Card 2: Tax Collected (Dedicated KPI Card) */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-indigo-600">
                <Coins className="w-4 h-4" />
              </div>
              <span className="bg-indigo-50 text-indigo-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Tax Collected
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(reportData?.totals?.collectedTax ?? reportData?.kpis?.totalCollectedTax ?? 0)}
              </span>
              <span className="text-[11px] text-[#78616C] font-medium mt-1 block leading-tight">
                Statutory tax collected
              </span>
            </div>
          </div>

          {/* Card 3: Total Collections (Including Tax) */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <Wallet className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Collections
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(customerCollections)}
              </span>
              <span className="text-[11px] text-[#78616C] font-medium mt-1 block leading-tight">
                Total Customer Collections (incl. tax and tips)
              </span>
            </div>
          </div>

          {/* Card 4: Operating Expenses */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                <Receipt className="w-4 h-4" />
              </div>
              <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Expenses
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totalExpensesRecognized)}
              </span>
              <span className="text-[11px] text-[#78616C] font-medium mt-1 block leading-tight">
                Actual Paid Operating Expenses
              </span>
            </div>
          </div>

          {/* Card 5: Collection-Based Operating Surplus */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Landmark className="w-4 h-4" />
              </div>
              <span className={`shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full ${netRealizedPosition >= 0 ? 'bg-[#FDF2F5] text-[#B82E69]' : 'bg-rose-50 text-rose-700'}`}>
                Collection-Based Operating Surplus
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className={`text-xl sm:text-2xl font-extrabold font-mono tabular-nums tracking-tight block ${netRealizedPosition >= 0 ? 'text-[#18191B]' : 'text-rose-600'}`}>
                {netRealizedPosition >= 0 ? `PKR ${formatPKR(netRealizedPosition)}` : `-PKR ${formatPKR(Math.abs(netRealizedPosition))}`}
              </span>
              <span className="text-[11px] text-[#78616C] font-medium mt-1 block leading-tight">
                Collected revenue less paid operating expenses
              </span>
            </div>
          </div>

          {/* Card 6: Outstanding Dues */}
          <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                <Coins className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Outstanding
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-xl sm:text-2xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals.remaining || 0)}
              </span>
              <span className="text-[11px] text-[#78616C] font-medium mt-1 block leading-tight">
                Outstanding Dues
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
            <table className="report-records w-full min-w-[1000px] text-left border-collapse text-xs">
              <thead className="bg-[#FAF8F9]/80 text-slate-700 font-semibold border-b border-slate-100 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4 min-w-[200px]">Invoice / Customer</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Service Amount (Excl. Tax)</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Tax Amount</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Total Bill (Incl. Tax, Excl. Tip)</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Tip Amount</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Total Received (Incl. Tip)</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Remaining Dues</th>
                  <th className="py-3 px-4 text-center w-28 whitespace-nowrap">Payment Status</th>
                  <th className="py-3 px-4 whitespace-nowrap">Date / Payment Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportData && reportData.rows.length > 0 ? (
                  reportData.rows.map((row: IncomeExpenseReportRow, idx: number) => {
                    const isIncome = row.income > 0 || row.type === 'INCOME';
                    const isSettlement = row.type === 'SETTLEMENT';
                    const isRefund = row.type === 'INCOME' && row.source === 'Sales Refund';
                    const isAccruedComm = row.type === 'COMMISSION_EXPENSE' && (row.status === 'ACCRUED' || !row.paid);

                    const serviceAmountVal = isSettlement
                      ? 0
                      : isIncome
                      ? (row.serviceAmount ?? row.recognizedIncome ?? row.income)
                      : row.expense;

                    const collectedServiceVal = isSettlement
                      ? 0
                      : isIncome
                      ? (row.collectedService ?? row.income)
                      : 0;

                    const taxVal = isSettlement
                      ? 0
                      : isIncome
                      ? (row.tax ?? row.collectedTax ?? 0)
                      : 0;

                    const collectedTaxVal = row.collectedTax ?? 0;

                    const totalBillVal = isSettlement
                      ? 0
                      : isIncome
                      ? (row.totalBill ?? (serviceAmountVal + taxVal))
                      : row.expense;

                    const totalReceivedVal = isSettlement
                      ? (row.cashFlow || 0)
                      : isAccruedComm
                      ? 0
                      : isIncome
                      ? (row.totalReceived ?? row.collectionAmount ?? row.paid ?? row.income)
                      : (row.paid ? -row.paid : 0);

                    const remainingDuesVal = isAccruedComm
                      ? (row.remaining || row.expense)
                      : (row.remainingDues ?? row.remaining ?? 0);

                    const isPartial = row.status === 'PARTIAL' || row.status === 'PARTIALLY_PAID' || (remainingDuesVal > 0 && totalReceivedVal > 0);
                    const dateParts = formatDateParts(row.date);

                    return (
                      <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        {/* 1. Invoice / Customer */}
                        <td className="py-3.5 px-4">
                          <div className="leading-tight">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-[#18191B]">{row.reference || row.invoiceNumber || row.source}</span>
                              {row.type === 'SETTLEMENT' ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#FDF2F5] text-[#B82E69]">Settlement</span>
                              ) : isRefund ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700">Refund</span>
                              ) : row.source === 'POS Dues Collection' ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-50 text-amber-700">Dues</span>
                              ) : row.type === 'SALARY_EXPENSE' ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-700">Salary</span>
                              ) : row.type === 'COMMISSION_EXPENSE' ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-50 text-amber-700">Commission</span>
                              ) : !isIncome ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700">Expense</span>
                              ) : null}
                              {row.branchName && (
                                <span className="text-[10px] text-slate-400 font-normal">({row.branchName})</span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#78616C] font-medium mt-0.5 truncate max-w-[260px]" title={row.customerName || row.userOrPayee || row.description}>
                              {row.customerName || (row.description?.includes('-') ? row.description.split('-')[1]?.trim() : (row.userOrPayee || row.description || 'Walk-in'))}
                            </div>
                          </div>
                        </td>

                        {/* 2. Service Amount (Excl. Tax) */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums">
                          {isSettlement ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div>
                              <span className={`font-semibold ${isIncome ? (isRefund ? 'text-rose-700' : 'text-emerald-700') : 'text-rose-700'}`}>
                                {isRefund
                                  ? `-${formatPKR(Math.abs(serviceAmountVal))}`
                                  : isIncome
                                  ? `+${formatPKR(serviceAmountVal)}`
                                  : `-${formatPKR(serviceAmountVal)}`}
                              </span>
                              {isIncome && !isRefund && isPartial && collectedServiceVal !== serviceAmountVal && (
                                <div className="text-[10px] text-emerald-600 font-medium">
                                  Coll: PKR {formatPKR(collectedServiceVal)}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 3. Tax Amount */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums text-slate-700">
                          {isSettlement || !isIncome ? (
                            <span className="text-slate-400">—</span>
                          ) : isRefund ? (
                            <span className="text-rose-600">
                              {taxVal !== 0 ? `-${formatPKR(Math.abs(taxVal))}` : '0.00'}
                            </span>
                          ) : (
                            <div>
                              <span>{formatPKR(taxVal)}</span>
                              {isPartial && collectedTaxVal !== taxVal && (
                                <div className="text-[10px] text-indigo-600 font-medium">
                                  Coll: PKR {formatPKR(collectedTaxVal)}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 4. Total Bill (Incl. Tax, Excl. Tip) */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums font-semibold text-[#18191B]">
                          {isSettlement ? (
                            <span className="text-slate-400">—</span>
                          ) : isRefund ? (
                            <span className="text-rose-700">
                              -{formatPKR(Math.abs(totalBillVal))}
                            </span>
                          ) : (
                            <span>{formatPKR(totalBillVal)}</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums text-slate-700">PKR {formatPKR(row.tipAmount ?? 0)}</td>
                        {/* 5. Total Received */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums font-semibold">
                          {isSettlement ? (
                            <span className={totalReceivedVal >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                              {totalReceivedVal >= 0 ? `+${formatPKR(totalReceivedVal)}` : `-${formatPKR(Math.abs(totalReceivedVal))}`}
                            </span>
                          ) : isIncome ? (
                            <span className={isRefund ? 'text-rose-700' : 'text-emerald-700'}>
                              {totalReceivedVal === 0 ? '0.00' : isRefund ? `-${formatPKR(Math.abs(totalReceivedVal))}` : `+${formatPKR(totalReceivedVal)}`}
                            </span>
                          ) : (
                            <span className="text-rose-700">
                              {totalReceivedVal === 0 ? '0.00' : `-${formatPKR(Math.abs(totalReceivedVal))}`}
                            </span>
                          )}
                        </td>

                        {/* 6. Remaining Dues */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums">
                          {remainingDuesVal > 0 ? (
                            <span className="text-amber-700 font-bold">
                              {formatPKR(remainingDuesVal)}
                            </span>
                          ) : (
                            <span className="text-slate-400">0.00</span>
                          )}
                        </td>

                        {/* 7. Payment Status */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {row.status === 'PAID' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                              Paid
                            </span>
                          ) : row.status === 'PARTIAL' || row.status === 'PARTIALLY_PAID' || isPartial ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/50">
                              Partial
                            </span>
                          ) : row.status === 'REFUNDED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/50">
                              Refunded
                            </span>
                          ) : row.status === 'FINALIZED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/50">
                              Finalized
                            </span>
                          ) : row.status === 'ACCRUED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/50">
                              Accrued
                            </span>
                          ) : row.status === 'POSTED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200/50">
                              Posted
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200/50">
                              {row.status || 'Unpaid'}
                            </span>
                          )}
                        </td>

                        {/* 8. Date / Payment Method */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                          <div className="leading-tight">
                            <div className="font-medium text-[#18191B]">{dateParts.dayMonth} {dateParts.year}</div>
                            <div className="text-[11px] text-slate-500 font-normal mt-0.5">{formatMethod(row.paymentMethod)}</div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-400 font-medium">
                      No records found for the selected branch, dates, and filters.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Integrated Table Footer */}
              <tfoot className="bg-[#FAF8F9]/90 border-t-2 border-slate-200 text-xs">
                {reportData?.totals.collections !== undefined && (
                  <tr className="border-b border-slate-200/70">
                    <td colSpan={5} className="py-3 px-4 text-right font-semibold text-slate-700">Total Customer Collections (Net of Customer Refunds)</td>
                    <td className="py-3 px-4 text-right font-bold font-mono tabular-nums text-emerald-700">{formatPKR(customerCollections)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
                {/* Row 1: TOTALS (PKR) */}
                <tr className="border-b border-slate-200/70 font-bold">
                  <td className="py-3.5 px-4 text-left text-slate-900 tracking-wide uppercase text-[11px]">
                    TOTALS (PKR)
                  </td>
                  {/* Col 2: Service Amount (Collected Income excl tax) */}
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-sm text-emerald-700">
                    +{formatPKR(totals.income)}
                  </td>
                  {/* Col 3: Tax Amount */}
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-sm text-slate-700">
                    +{formatPKR(reportData?.totals?.collectedTax ?? reportData?.kpis?.totalCollectedTax ?? 0)}
                  </td>
                  {/* Col 4: Total Bill */}
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-sm text-[#18191B]">
                    +{formatPKR(totalBillSum)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-sm text-slate-700">PKR {formatPKR(reportData?.totals.tipAmount ?? 0)}</td>
                  {/* Col 5: Total Received */}
                  <td className={`py-3.5 px-4 text-right font-mono tabular-nums text-sm ${customerCollections >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatPKR(customerCollections)}
                  </td>
                  {/* Col 6: Remaining Dues */}
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-sm text-amber-700">
                    +{formatPKR(totals.remaining || 0)}
                  </td>
                  {/* Col 7 & 8 */}
                  <td colSpan={2} className="py-3.5 px-4"></td>
                </tr>

                {/* Row 2: Recognized Business Revenue */}
                <tr className="border-b border-slate-200/70">
                  <td colSpan={5} className="py-3 px-4 text-right font-medium text-slate-700">
                    Collected Net Revenue (Excl. Tax and Tips)
                  </td>
                  <td colSpan={2} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-emerald-700">
                    +{formatPKR(totals.income)}
                  </td>
                  <td colSpan={2} className="py-3 px-4"></td>
                </tr>

                {/* Row 4: Operating Overheads */}
                <tr className="border-b border-slate-200/70">
                  <td colSpan={5} className="py-3 px-4 text-right font-medium text-slate-700">
                    Actual Paid Operating Expenses (Including Salary and Commission Payouts)
                  </td>
                  <td colSpan={2} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-rose-700">
                    -{formatPKR(totalExpensesRecognized)}
                  </td>
                  <td colSpan={2} className="py-3 px-4"></td>
                </tr>

                {/* Collection-based summary excludes unpaid accruals and separate COGS. */}
                <tr>
                  <td colSpan={5} className="py-3 px-4 text-right font-bold text-slate-900">
                    Collection-Based Operating Surplus (Collected Revenue Less Paid Expenses)
                  </td>
                  <td colSpan={2} className={`py-3 px-4 text-right font-bold font-mono tabular-nums text-sm ${netRealizedPosition >= 0 ? 'text-[#B82E69]' : 'text-rose-700'}`}>
                    {netRealizedPosition >= 0 ? `+${formatPKR(netRealizedPosition)}` : `-${formatPKR(Math.abs(netRealizedPosition))}`}
                  </td>
                  <td colSpan={2} className="py-3 px-4"></td>
                </tr>
                <tr><td colSpan={5} className="py-3 px-4 text-right">Non-Operating Cash Outflows (Net of Reversals)</td><td colSpan={2} className="py-3 px-4 text-right font-mono">{formatPKR(nonOperatingCashOutflows)}</td><td colSpan={2} /></tr>
                <tr><td colSpan={5} className="py-3 px-4 text-right font-semibold">Net Cash Movement</td><td colSpan={2} className="py-3 px-4 text-right font-mono font-semibold">{formatPKR(signedPaid)}</td><td colSpan={2} /></tr>
                {reportData?.kpis.staffLoanReceivable !== undefined && <tr><td colSpan={5} className="py-3 px-4 text-right">Staff Loan Receivable (Current Branch Balance)</td><td colSpan={2} className="py-3 px-4 text-right font-mono">{formatPKR(reportData.kpis.staffLoanReceivable)}</td><td colSpan={2} /></tr>}
                <tr><td colSpan={5} className="py-3 px-4 text-right">Staff Loan Cash Outflow (Net of Reversals)</td><td colSpan={2} className="py-3 px-4 text-right font-mono">{formatPKR(reportData?.kpis.staffLoanCashOutflow ?? 0)}</td><td colSpan={2} /></tr>
                <tr className="border-t border-slate-200"><td colSpan={9} className="py-3 px-4 text-xs text-slate-600">Separate accounting information - not deducted from collection-based surplus</td></tr>
                <tr><td colSpan={5} className="py-3 px-4 text-right">Recognized Revenue (Accrual Net Sales)</td><td colSpan={2} className="py-3 px-4 text-right font-mono">{formatPKR(reportData?.totals.recognizedIncome ?? 0)}</td><td colSpan={2} /></tr>
                {/* Row 3: Cost of Goods Sold (COGS & Consumables) */}
                {reportData?.kpis?.cogs !== undefined && (
                  <tr className="border-b border-slate-200/70">
                    <td colSpan={5} className="py-3 px-4 text-right font-medium text-slate-700">
                      Cost of Goods Sold (Retail COGS & Consumable Usage)
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-right font-bold font-mono tabular-nums text-amber-600">
                      -{formatPKR(reportData.kpis.cogs || 0)}
                    </td>
                    <td colSpan={2} className="py-3 px-4"></td>
                  </tr>
                )}


                <tr><td colSpan={5} className="py-3 px-4 text-right">Reported Expense Recognition (Reference Only)</td><td colSpan={2} className="py-3 px-4 text-right font-mono">{formatPKR(totals.expense)}</td><td colSpan={2} /></tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncomeExpenseReportPage;

