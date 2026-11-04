import { drawerDebits, drawerMoney } from './cashDrawerUtils';
import React, { useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  PaymentAccountsReport,
  PaymentAccountMovementRow,
  PaymentAccountsReportQuery,
  CashDrawerReport,
  CashDrawerReportRow,
  CashDrawerReportQuery,
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
  Landmark,
  Wallet,
  ArrowRightLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  CheckCircle2,
  Clock,
  Layers,
  ListOrdered,
} from 'lucide-react';

const selectClass =
  'w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30 transition-all';
const inputClass =
  'w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white text-slate-700 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/30 transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

const formatPKR = (amt: number, withSign = false) => {
  const num = Number(amt) || 0;
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (withSign) {
    return num >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return num < 0 ? `-${formatted}` : formatted;
};

const collectionExportMeta = (collections?: { collectedRevenue: number; taxCollected: number; tipsCollected: number }): [string, string][] => collections ? [
  ['Customer Collected Revenue (Excl. Tax/Tips)', formatPKR(collections.collectedRevenue)],
  ['Customer Tax Collected', formatPKR(collections.taxCollected)],
  ['Customer Tips Collected', formatPKR(collections.tipsCollected)],
] : [];

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

export const DebitCreditStatementPage: React.FC<{ initialTab?: 'PAYMENT_ACCOUNTS' | 'CASH_DRAWER' }> = ({ initialTab = 'PAYMENT_ACCOUNTS' }) => {
  const { user, activeBranchId, allBranches } = useAuth();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/debit-credit" />;
  }

  // Active Main Tab: 'PAYMENT_ACCOUNTS' | 'CASH_DRAWER'
  const [activeTab, setActiveTab] = useState<'PAYMENT_ACCOUNTS' | 'CASH_DRAWER'>(user.role === 'ACCOUNTANT' ? 'CASH_DRAWER' : initialTab);

  // Cash Drawer Sub-view: 'TRANSACTIONS' (Debit/Credit Ledger) | 'SHIFTS' (Shift Reconciliation)
  const [cashSubView, setCashSubView] = useState<'TRANSACTIONS' | 'SHIFTS'>('TRANSACTIONS');

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  // Shared Filters
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Payment Accounts Specific Filters
  const [selectedAccountType, setSelectedAccountType] = useState<string>('ALL');
  const [selectedDirection, setSelectedDirection] = useState<string>('ALL');
  const [selectedSourceModule, setSelectedSourceModule] = useState<string>('ALL');

  // Cash Drawer Specific Filters
  const [selectedDrawerStatus, setSelectedDrawerStatus] = useState<string>('ALL');

  // State
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [accountsReport, setAccountsReport] = useState<PaymentAccountsReport | null>(null);
  const [drawerReport, setDrawerReport] = useState<CashDrawerReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch report data on demand from backend API
  const fetchReport = useCallback(
    async (tab: 'PAYMENT_ACCOUNTS' | 'CASH_DRAWER') => {
      setIsLoading(true);
      setHasFiltered(true);
      setErrorMessage(null);
      try {
        if (tab === 'PAYMENT_ACCOUNTS') {
          const q: PaymentAccountsReportQuery = {
            branchId: selectedBranch !== 'ALL' ? selectedBranch : undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            direction: selectedDirection !== 'ALL' ? selectedDirection : undefined,
            sourceModule: selectedSourceModule !== 'ALL' ? selectedSourceModule : undefined,
            search: searchQuery.trim() || undefined,
          };
          const data = await salonService.getPaymentAccountsReport(q);
          setAccountsReport(data);
        } else {
          const q: CashDrawerReportQuery = {
            branchId: selectedBranch !== 'ALL' ? selectedBranch : undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            status: selectedDrawerStatus !== 'ALL' ? selectedDrawerStatus : undefined,
            search: searchQuery.trim() || undefined,
          };
          const data = await salonService.getCashDrawerReport(q);
          setDrawerReport(data);
        }
        setHasFiltered(true);
      } catch (err: any) {
        console.error('Failed to load Debit/Credit statement:', err);
        setErrorMessage(err.message || 'Failed to fetch live report from server.');
      } finally {
        setIsLoading(false);
      }
    },
    [selectedBranch, fromDate, toDate, selectedDirection, selectedSourceModule, selectedDrawerStatus, searchQuery]
  );

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    fetchReport(activeTab);
  };

  const handleTabChange = (newTab: 'PAYMENT_ACCOUNTS' | 'CASH_DRAWER') => {
    setActiveTab(newTab);
    fetchReport(newTab);
  };

  // Filter Payment Accounts rows by Account Type if selected
  const filteredAccountRows = useMemo(() => {
    if (!accountsReport) return [];
    let rows = accountsReport.rows;
    if (selectedAccountType !== 'ALL') {
      rows = rows.filter((r) => r.accountType === selectedAccountType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          r.accountName.toLowerCase().includes(q) ||
          r.reference?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          (r.userName && r.userName.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [accountsReport, selectedAccountType, searchQuery]);

  // Flattened and running-balance computed Cash Transactions
  const filteredCashTransactions = useMemo(() => {
    if (!drawerReport || !drawerReport.transactions) return [];
    let txs = [...drawerReport.transactions];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      txs = txs.filter(
        (t) =>
          t.type?.toLowerCase().includes(q) ||
          t.reference?.toLowerCase().includes(q) ||
          t.actor?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      );
    }
    return txs;
  }, [drawerReport, searchQuery]);

  // Export handlers for Payment Accounts
  const handleExportAccountsCsv = () => {
    if (!accountsReport || filteredAccountRows.length === 0) return;
    const headers = [
      '#',
      'Date',
      'Time',
      'Account',
      'Type',
      'Branch',
      'Source',
      'Reference',
      'Actual User',
      'Description',
      'Debit (In)',
      'Credit (Out)',
      'Running Balance',
      'Status',
    ];
    const rows = filteredAccountRows.map((r, i) => [
      i + 1,
      r.date,
      r.time || '',
      r.accountName,
      r.accountType,
      r.branchName,
      r.sourceModule,
      r.reference,
      r.userName || '—',
      r.description,
      (r.direction === 'IN' ? r.amount : 0).toFixed(2),
      (r.direction === 'OUT' ? r.amount : 0).toFixed(2),
      r.runningBalance.toFixed(2),
      'COMPLETED',
    ]);
    downloadReportCsv('debit-credit-payment-accounts', [['Basis', 'Balances include all movements; filters select detail rows. Transfers and tax/tips are cash movements, not revenue.'], ...collectionExportMeta(accountsReport.collections)], [{ headers, rows }]);
  };

  const handleExportAccountsExcel = () => {
    if (!accountsReport || filteredAccountRows.length === 0) return;
    const headers = [
      '#',
      'Date',
      'Time',
      'Account',
      'Type',
      'Branch',
      'Source',
      'Reference',
      'Actual User',
      'Description',
      'Debit (In)',
      'Credit (Out)',
      'Running Balance',
      'Status',
    ];
    const rows = filteredAccountRows.map((r, i) => [
      i + 1,
      r.date,
      r.time || '',
      r.accountName,
      r.accountType,
      r.branchName,
      r.sourceModule,
      r.reference,
      r.userName || '—',
      r.description,
      (r.direction === 'IN' ? r.amount : 0).toFixed(2),
      (r.direction === 'OUT' ? r.amount : 0).toFixed(2),
      r.runningBalance.toFixed(2),
      'COMPLETED',
    ]);
    downloadReportExcel('debit-credit-payment-accounts', [['Basis', 'Balances include all movements; filters select detail rows. Transfers and tax/tips are cash movements, not revenue.'], ...collectionExportMeta(accountsReport.collections)], [{ headers, rows }]);
  };

  const handlePrintAccounts = () => {
    if (!accountsReport || filteredAccountRows.length === 0) return;
    const headers = ['#', 'Date', 'Account', 'Source', 'Reference', 'User', 'Debit (In)', 'Credit (Out)', 'Running Balance'];
    const rows = filteredAccountRows.map((r, i) => [
      i + 1,
      formatDateDisplay(r.date),
      r.accountName,
      r.sourceModule,
      r.reference,
      r.userName || '—',
      (r.direction === 'IN' ? r.amount : 0).toFixed(2),
      (r.direction === 'OUT' ? r.amount : 0).toFixed(2),
      r.runningBalance.toFixed(2),
    ]);
    printReportWindow({
      title: 'Debit / Credit Statement — Payment Accounts',
      meta: [['Basis', 'Full account balances; filters select detail rows only.'], ...collectionExportMeta(accountsReport.collections)],
      headers,
      rows,
      totals: [
        'ACCOUNT TOTALS (ALL MOVEMENTS)',
        '',
        '',
        '',
        '',
        '',
        `+${formatPKR(accountsReport.kpis.totalDebits ?? accountsReport.kpis.totalMoneyIn)}`,
        `-${formatPKR(accountsReport.kpis.totalCredits ?? accountsReport.kpis.totalMoneyOut)}`,
        formatPKR(accountsReport.kpis.totalClosingBalance),
      ],
    });
  };

  // Export handlers for Cash Drawer
  const getCashExportData = () => {
    if (!drawerReport) return;
    if (cashSubView === 'TRANSACTIONS') {
      const headers = ['#', 'Date', 'Time', 'Type', 'Reference', 'Actual User', 'Description', 'Debit (Cash In)', 'Credit (Cash Out)'];
      const rows = filteredCashTransactions.map((t, i) => [
        i + 1,
        t.date,
        t.time,
        t.type,
        t.reference || '—',
        t.actor || '—',
        t.description || '—',
        (t.direction === 'IN' ? t.amount : 0).toFixed(2),
        (t.direction === 'OUT' ? t.amount : 0).toFixed(2),
      ]);
      return { fileName: 'debit-credit-cash-transactions', headers, rows };
    } else {
      const headers = ['#', 'Date', 'Custodian', 'Branch', 'Status', 'Opening Balance', 'Debits (In)', 'Credits (Out)', 'Expected Cash', 'Counted Cash', 'Variance'];
      const rows = (drawerReport.rows || []).map((r, i) => [
        i + 1,
        r.date,
        r.custodianName,
        r.branchName,
        r.status,
        (r.openingBalance ?? 0).toFixed(2),
        drawerDebits(r).toFixed(2),
        r.totalCashOut.toFixed(2),
        r.expectedCash.toFixed(2),
        r.countedCash !== null ? r.countedCash.toFixed(2) : '—',
        r.variance == null ? '\u2014' : r.variance.toFixed(2),
      ]);
      return { fileName: 'debit-credit-cash-shifts', headers, rows };
    }
  };

  const handleExportCashCsv = () => {
    const data = getCashExportData();
    if (data) downloadReportCsv(data.fileName, [['Basis', 'Opening is before-period carry-forward; debits/credits are in-period; expected cash is period-end. Historical counts unavailable after later counts are blank.'], ...collectionExportMeta(drawerReport?.collections)], [data]);
  };

  const handleExportCashExcel = () => {
    const data = getCashExportData();
    if (data) downloadReportExcel(data.fileName, [['Basis', 'Opening is before-period carry-forward; debits/credits are in-period; expected cash is period-end. Historical counts unavailable after later counts are blank.'], ...collectionExportMeta(drawerReport?.collections)], [data]);
  };

  const handlePrintCash = () => {
    const data = getCashExportData();
    if (!data) return;
    printReportWindow({
      title: cashSubView === 'TRANSACTIONS' ? 'Cash Transactions — Debit / Credit' : 'Cash Shift Reconciliation',
      meta: [
        ...collectionExportMeta(drawerReport?.collections),
        ['Basis', 'Opening is carry-forward; transactions are in-period. Balances include all movements; filters select details only.'],
        ['Branch', selectedBranch === 'ALL' ? 'All Branches' : allBranches.find((branch) => branch.id === selectedBranch)?.name || selectedBranch],
        ['From', drawerReport?.meta.from || fromDate || 'All dates'],
        ['To', drawerReport?.meta.to || toDate || 'All dates'],
      ],
      headers: data.headers,
      rows: data.rows,
    });
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      <p className="text-xs text-slate-600">Balances include all movements; filters select detail rows only. Opening is before-period carry-forward. Cash movements include tax, tips and transfers and are not revenue.</p>
      {activeTab === 'PAYMENT_ACCOUNTS' && accountsReport?.collections && <p className="text-xs text-slate-600">Account customer receipts: net revenue PKR {formatPKR(accountsReport.collections.collectedRevenue)}, tax PKR {formatPKR(accountsReport.collections.taxCollected)}, tips PKR {formatPKR(accountsReport.collections.tipsCollected)}. Receipt business dates can differ from ledger posting dates.</p>}
      {activeTab === 'CASH_DRAWER' && drawerReport?.collections && <p className="text-xs text-slate-600">Customer receipts: net revenue PKR {formatPKR(drawerReport.collections.collectedRevenue)}, tax PKR {formatPKR(drawerReport.collections.taxCollected)}, tips PKR {formatPKR(drawerReport.collections.tipsCollected)}. Drawer balances include custody transfers and other movements.</p>}
      {/* 1. Top Header Banner */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <ArrowRightLeft className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#23151D]">
                  Debit / Credit Financial Statement
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#B82E69]/10 text-[#B82E69] border border-[#B82E69]/20">
                  Double-Entry
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Universal Double-Entry Ledger: <span className="font-semibold text-emerald-700">Debit = In (+)</span>, <span className="font-semibold text-rose-700">Credit = Out (−)</span> · <span className="font-mono text-[#B82E69] font-bold">Closing = Opening + Debit − Credit</span>
              </p>
            </div>
          </div>

          {/* Master Tab Switcher */}
          <div className="inline-flex p-1.5 bg-white/80 rounded-2xl border border-slate-200/80 shadow-2xs gap-1">
            {user.role !== 'ACCOUNTANT' && <button
              type="button"
              onClick={() => handleTabChange('PAYMENT_ACCOUNTS')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                activeTab === 'PAYMENT_ACCOUNTS'
                  ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Landmark className="w-4 h-4" />
              <span>1. Payment Accounts</span>
            </button>}
            <button
              type="button"
              onClick={() => handleTabChange('CASH_DRAWER')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                activeTab === 'CASH_DRAWER'
                  ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>2. Cash Drawer</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Filter Card */}
      <div className="rounded-[20px] border border-white/90 bg-white/75 p-5 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Branch */}
            <div>
              <label className={labelClass}>Branch</label>
              <select
                value={selectedBranch}
                disabled={!isSuperAdmin}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className={selectClass}
              >
                {user.role === 'SUPER_ADMIN' && <option value="ALL">All Branches</option>}
                {allBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city})
                  </option>
                ))}
              </select>
            </div>

            {/* Tab-Specific Filters */}
            {activeTab === 'PAYMENT_ACCOUNTS' ? (
              <>
                {/* Account Type */}
                <div>
                  <label className={labelClass}>Account Type</label>
                  <select
                    value={selectedAccountType}
                    onChange={(e) => setSelectedAccountType(e.target.value)}
                    className={selectClass}
                  >
                    <option value="ALL">All Account Types</option>
                    <option value="BANK">Bank Account</option>
                    <option value="CARD_CLEARING">Card Terminal Clearing</option>
                    <option value="WALLET">Online Wallet (JazzCash / EasyPaisa)</option>
                  </select>
                </div>

                {/* Direction (Debit vs Credit) */}
                <div>
                  <label className={labelClass}>Entry Flow (Debit / Credit)</label>
                  <select
                    value={selectedDirection}
                    onChange={(e) => setSelectedDirection(e.target.value)}
                    className={selectClass}
                  >
                    <option value="ALL">All Movements (Debit & Credit)</option>
                    <option value="IN">Debit (+Money In)</option>
                    <option value="OUT">Credit (-Money Out)</option>
                  </select>
                </div>

                {/* Source Module */}
                <div>
                  <label className={labelClass}>Source Module</label>
                  <select
                    value={selectedSourceModule}
                    onChange={(e) => setSelectedSourceModule(e.target.value)}
                    className={selectClass}
                  >
                    <option value="ALL">All Sources</option>
                    <option value="POS_INVOICE">POS Invoice</option>
                    <option value="EXPENSE">Expense Disbursement</option>
                    <option value="PAYROLL">Payroll & Commission</option>
                    <option value="DRAWER_SETTLEMENT">Drawer Settlement</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                {/* Status Filter */}
                <div>
                  <label className={labelClass}>Shift Session Status</label>
                  <select
                    value={selectedDrawerStatus}
                    onChange={(e) => setSelectedDrawerStatus(e.target.value)}
                    className={selectClass}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="OPEN">Open (Active Custody)</option>
                    <option value="SETTLED">Settled & Handed Over</option>
                    <option value="SETTLEMENT_PENDING">Pending Settlement</option>
                  </select>
                </div>

                {/* Sub-View Switcher for Cash Drawer */}
                <div className="sm:col-span-2">
                  <label className={labelClass}>Cash View Mode</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCashSubView('TRANSACTIONS')}
                      className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                        cashSubView === 'TRANSACTIONS'
                          ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white border-transparent shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <ListOrdered className="w-3.5 h-3.5" />
                      <span>Cash Transactions (Debit/Credit)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCashSubView('SHIFTS')}
                      className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                        cashSubView === 'SHIFTS'
                          ? 'bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white border-transparent shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Shift Reconciliation</span>
                    </button>
                  </div>
                </div>
              </>
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

            {/* Search query */}
            <div className="sm:col-span-2">
              <label className={labelClass}>Search Statement</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by account, reference, user, or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-end pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-xl bg-gradient-to-r from-[#B82E69] to-[#9D2558] px-6 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-95 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-70"
            >
              {isLoading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
                  <span>Loading Statement...</span>
                </>
              ) : (
                <>
                  <Filter className="w-3.5 h-3.5 fill-current" />
                  <span>Filter Statement</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Main Content Area */}
      {!hasFiltered ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-16 flex flex-col items-center justify-center min-h-[360px] shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-[#F8D7E3] border border-[#F1DEE3] flex items-center justify-center text-[#B82E69] mb-4 shadow-sm">
            <Filter className="w-7 h-7" />
          </div>
          <p className="text-slate-800 text-base font-bold">Apply Filters to Generate Statement</p>
          <p className="text-slate-500 text-xs mt-1 max-w-sm">Select your desired branch, payment account, or date window and click 'Filter Statement' to compile live double-entry records.</p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-16 flex flex-col items-center justify-center min-h-[360px] shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-10 h-10 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-4" />
          <p className="text-slate-700 text-sm font-semibold">Compiling Double-Entry Records...</p>
          <p className="text-slate-400 text-xs mt-1">Reconciling ledger entries and running balances</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-[24px] border border-rose-200/80 bg-white/80 backdrop-blur-xl p-8 shadow-sm text-center">
          <p className="text-rose-600 text-sm font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-5 py-2 bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white text-xs font-semibold rounded-xl shadow-sm hover:opacity-95 cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : activeTab === 'PAYMENT_ACCOUNTS' && accountsReport ? (
        /* ═══════════ TAB 1: PAYMENT ACCOUNTS ═══════════ */
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="rounded-[20px] border border-white/90 bg-white/75 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Opening Balance</span>
              <span className="text-lg font-extrabold text-slate-800 font-mono tabular-nums block mt-1.5">
                PKR {formatPKR(accountsReport.kpis.totalOpeningBalance)}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">Start of period</span>
            </div>

            <div className="rounded-[20px] border border-emerald-200/80 bg-emerald-50/25 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>Debit (Money In)</span>
              </span>
              <span className="text-lg font-extrabold text-emerald-700 font-mono tabular-nums block mt-1.5">
                +PKR {formatPKR(accountsReport.kpis.totalDebits ?? accountsReport.kpis.totalMoneyIn)}
              </span>
              <span className="text-[11px] text-emerald-600/80 mt-1 block">Client Collections & Transfers</span>
            </div>

            <div className="rounded-[20px] border border-rose-200/80 bg-rose-50/25 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Credit (Money Out)</span>
              </span>
              <span className="text-lg font-extrabold text-rose-700 font-mono tabular-nums block mt-1.5">
                -PKR {formatPKR(accountsReport.kpis.totalCredits ?? accountsReport.kpis.totalMoneyOut)}
              </span>
              <span className="text-[11px] text-rose-600/80 mt-1 block">Expenses & Supplier Payouts</span>
            </div>

            <div className="rounded-[20px] border border-white/90 bg-white/75 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Net Flow (In − Out)</span>
              <span className={`text-lg font-extrabold font-mono tabular-nums block mt-1.5 ${accountsReport.kpis.netMovement >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {accountsReport.kpis.netMovement >= 0 ? '+' : '-'}PKR {formatPKR(Math.abs(accountsReport.kpis.netMovement))}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">Net period movement</span>
            </div>

            <div className="rounded-[20px] border border-[#F1DEE3] bg-[#FDF2F5]/70 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 col-span-2 sm:col-span-1 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-[#B82E69] uppercase tracking-wider block">Closing Balance</span>
              <span className="text-lg font-extrabold text-[#B82E69] font-mono tabular-nums block mt-1.5">
                PKR {formatPKR(accountsReport.kpis.totalClosingBalance)}
              </span>
              <span className="text-[11px] text-[#B82E69]/80 mt-1 block font-mono">Opening + Debit − Credit</span>
            </div>
          </div>

          {/* Table Container */}
          <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
            {/* Banner */}
            <div className="bg-gradient-to-r from-[#B82E69] via-[#A8285F] to-[#8F1D4E] text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                  <Landmark className="w-4 h-4 text-white" />
                </div>
                <div>
                  <span className="font-bold text-sm tracking-wide block">
                    Payment Accounts Ledger
                  </span>
                  <span className="text-[11px] text-white/80">
                    {filteredAccountRows.length} recorded movement entries
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportAccountsCsv}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportAccountsExcel}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={handlePrintAccounts}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="report-records w-full min-w-[1250px] text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#FDF2F5]/80 border-b border-[#F1DEE3] text-[#5C3B4B] font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 px-3 text-center w-8">#</th>
                    <th className="py-3.5 px-3.5 whitespace-nowrap">Date / Time</th>
                    <th className="py-3.5 px-3.5">Account</th>
                    <th className="py-3.5 px-3.5">Type</th>
                    <th className="py-3.5 px-3.5">Branch</th>
                    <th className="py-3.5 px-3.5">Source</th>
                    <th className="py-3.5 px-3.5">Reference</th>
                    <th className="py-3.5 px-3.5">Actual User</th>
                    <th className="py-3.5 px-3.5">Description</th>
                    <th className="py-3.5 px-3.5 text-right whitespace-nowrap text-emerald-800">Debit (+In)</th>
                    <th className="py-3.5 px-3.5 text-right whitespace-nowrap text-rose-800">Credit (−Out)</th>
                    <th className="py-3.5 px-3.5 text-right whitespace-nowrap text-slate-900 font-bold">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200/90 text-[#334155]">
                  {filteredAccountRows.length > 0 ? (
                    filteredAccountRows.map((row: PaymentAccountMovementRow, idx: number) => (
                      <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/35 transition-colors">
                        <td className="py-3.5 px-3 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                        <td className="py-3.5 px-3.5 whitespace-nowrap">
                          <span className="font-semibold text-slate-800">{formatDateDisplay(row.date)}</span>
                          {row.time && <span className="block text-[11px] text-slate-400">{row.time}</span>}
                        </td>
                        <td className="py-3.5 px-3.5 font-bold text-slate-900 whitespace-nowrap">{row.accountName}</td>
                        <td className="py-3.5 px-3.5 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            {row.accountType}
                          </span>
                        </td>
                        <td className="py-3.5 px-3.5 text-slate-600 whitespace-nowrap">{row.branchName}</td>
                        <td className="py-3.5 px-3.5 whitespace-nowrap text-slate-600">{row.sourceModule}</td>
                        <td className="py-3.5 px-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">{row.reference || '—'}</td>
                        <td className="py-3.5 px-3.5 font-semibold text-slate-800 whitespace-nowrap">{row.userName || 'Staff'}</td>
                        <td className="py-3.5 px-3.5 text-slate-600 max-w-[240px] truncate" title={row.description}>
                          {row.description || '—'}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                          {row.direction === 'IN' ? `+${formatPKR(row.amount)}` : '—'}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-bold text-rose-700 tabular-nums">
                          {row.direction === 'OUT' ? `-${formatPKR(row.amount)}` : '—'}
                        </td>
                        <td className="py-3.5 px-3.5 text-right font-mono font-extrabold text-slate-900 tabular-nums">
                          PKR {formatPKR(row.runningBalance)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-slate-400 text-xs">
                        No transactions found for the selected payment account filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'CASH_DRAWER' && drawerReport ? (
        /* ═══════════ TAB 2: CASH DRAWER ═══════════ */
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3.5">
            <div className="rounded-[20px] border border-white/90 bg-white/75 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Opening Balance</span>
              <span className="text-sm font-extrabold text-slate-800 font-mono tabular-nums block mt-1">
                PKR {formatPKR(drawerReport.kpis.totalOpeningBalance ?? 0)}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Balance before selected period</span>
            </div>

            <div className="rounded-[20px] border border-emerald-200/80 bg-emerald-50/25 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>Debit (Cash In)</span>
              </span>
              <span className="text-sm font-extrabold text-emerald-700 font-mono tabular-nums block mt-1">
                +PKR {formatPKR(drawerReport.kpis.totalCashIn)}
              </span>
              <span className="text-[10px] text-emerald-600 mt-0.5 block">Sales, Dues & Tips In</span>
            </div>

            <div className="rounded-[20px] border border-rose-200/80 bg-rose-50/25 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Credit (Cash Out)</span>
              </span>
              <span className="text-sm font-extrabold text-rose-700 font-mono tabular-nums block mt-1">
                -PKR {formatPKR(drawerReport.kpis.totalCashOut)}
              </span>
              <span className="text-[10px] text-rose-600 mt-0.5 block">Expenses & Tip Payouts</span>
            </div>

            <div className="rounded-[20px] border border-[#F1DEE3] bg-[#FDF2F5]/70 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-[#B82E69] uppercase tracking-wider block">Expected Cash</span>
              <span className="text-sm font-extrabold text-[#B82E69] font-mono tabular-nums block mt-1">
                PKR {formatPKR(drawerReport.kpis.totalExpectedCash)}
              </span>
              <span className="text-[10px] text-[#B82E69] mt-0.5 block">Opening + In − Out</span>
            </div>

            <div className="rounded-[20px] border border-white/90 bg-white/75 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Counted Cash</span>
              <span className="text-sm font-extrabold text-slate-800 font-mono tabular-nums block mt-1">
                PKR {formatPKR(drawerReport.kpis.totalCountedCash)}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Physical drawer audit</span>
            </div>

            <div className="rounded-[20px] border border-white/90 bg-white/75 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Variance</span>
              <span className={`text-sm font-extrabold font-mono tabular-nums block mt-1 ${Math.abs(drawerReport.kpis.totalVariance) < 0.01 ? 'text-emerald-700' : 'text-amber-600'}`}>
                {formatPKR(drawerReport.kpis.totalVariance, true)}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Counted − Expected</span>
            </div>

            <div className="rounded-[20px] border border-indigo-200/80 bg-indigo-50/30 backdrop-blur-xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-3.5 transition-all duration-200 hover:-translate-y-0.5">
              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Settlement Handover</span>
              <span className="text-sm font-extrabold text-indigo-700 font-mono tabular-nums block mt-1">
                PKR {formatPKR(drawerReport.kpis.totalSettlementsOut)}
              </span>
              <span className="text-[10px] text-indigo-600 mt-0.5 block">Accepted handovers</span>
            </div>
          </div>

          {/* Table Container */}
          <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
            {/* Banner */}
            <div className="bg-gradient-to-r from-[#B82E69] via-[#A8285F] to-[#8F1D4E] text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                  <Wallet className="w-4 h-4 text-white" />
                </div>
                <div>
                  <span className="font-bold text-sm tracking-wide block">
                    {cashSubView === 'TRANSACTIONS' ? 'Cash Transactions Ledger (Double-Entry Debit/Credit)' : 'Shift Reconciliation & Custody Sessions'}
                  </span>
                  <span className="text-[11px] text-white/80">
                    Live cash custody records and vault audits
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCashCsv}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportCashExcel}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={handlePrintCash}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={handlePrintCash}
                  className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
              </div>
            </div>

            {/* Table Rendering Based on Sub-View */}
            {cashSubView === 'TRANSACTIONS' ? (
              /* VIEW A: Cash Transactions Ledger */
              <div className="overflow-x-auto">
                <table className="report-records w-full min-w-[1100px] text-left border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-[#FDF2F5]/80 border-b border-[#F1DEE3] text-[#5C3B4B] font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-3.5 px-3 text-center w-8">#</th>
                      <th className="py-3.5 px-3.5 whitespace-nowrap">Date / Time</th>
                      <th className="py-3.5 px-3.5">Type / Source</th>
                      <th className="py-3.5 px-3.5">Reference</th>
                      <th className="py-3.5 px-3.5">Actual User</th>
                      <th className="py-3.5 px-3.5">Description</th>
                      <th className="py-3.5 px-3.5 text-right whitespace-nowrap text-emerald-800">Debit (+Cash In)</th>
                      <th className="py-3.5 px-3.5 text-right whitespace-nowrap text-rose-800">Credit (−Cash Out)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-200/90 text-[#334155]">
                    {filteredCashTransactions.length > 0 ? (
                      filteredCashTransactions.map((tx, idx: number) => {
                        const isDebit = tx.direction === 'IN';
                        const debitAmt = isDebit ? tx.amount : 0;
                        const creditAmt = !isDebit ? tx.amount : 0;

                        return (
                          <tr key={tx.id || idx} className="hover:bg-[#FDF2F5]/35 transition-colors">
                            <td className="py-3.5 px-3 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                            <td className="py-3.5 px-3.5 whitespace-nowrap">
                              <span className="font-semibold text-slate-800">{formatDateDisplay(tx.date)}</span>
                              {tx.time && <span className="block text-[11px] text-slate-400">{tx.time}</span>}
                            </td>
                            <td className="py-3.5 px-3.5 whitespace-nowrap">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                isDebit ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}>
                                {tx.type || (isDebit ? 'Cash In' : 'Cash Out')}
                              </span>
                            </td>
                            <td className="py-3.5 px-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">{tx.reference || '—'}</td>
                            <td className="py-3.5 px-3.5 font-semibold text-slate-800 whitespace-nowrap">{tx.actor || 'Custodian'}</td>
                            <td className="py-3.5 px-3.5 text-slate-600 max-w-[240px] truncate" title={tx.description}>
                              {tx.description || '—'}
                            </td>
                            <td className="py-3.5 px-3.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                              {debitAmt > 0 ? `+${formatPKR(debitAmt)}` : '—'}
                            </td>
                            <td className="py-3.5 px-3.5 text-right font-mono font-bold text-rose-700 tabular-nums">
                              {creditAmt > 0 ? `-${formatPKR(creditAmt)}` : '—'}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                          No cash transaction entries found for the selected date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* VIEW B: Shift Reconciliation & Custody */
              <div className="overflow-x-auto">
                <table className="report-records w-full min-w-[1250px] text-left border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-[#FDF2F5]/80 border-b border-[#F1DEE3] text-[#5C3B4B] font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-3.5 px-3 text-center w-8">#</th>
                      <th className="py-3.5 px-3.5 whitespace-nowrap">Session Date</th>
                      <th className="py-3.5 px-3.5">Custodian</th>
                      <th className="py-3.5 px-3.5">Branch</th>
                      <th className="py-3.5 px-3.5 text-center">Status</th>
                      <th className="py-3.5 px-3.5 text-right">Opening Balance</th>
                      <th className="py-3.5 px-3.5 text-right text-emerald-800">Debits (+In)</th>
                      <th className="py-3.5 px-3.5 text-right text-rose-800">Credits (−Out)</th>
                      <th className="py-3.5 px-3.5 text-right font-bold text-[#B82E69]">Expected Cash</th>
                      <th className="py-3.5 px-3.5 text-right">Counted Cash</th>
                      <th className="py-3.5 px-3.5 text-right">Variance</th>
                      <th className="py-3.5 px-3.5 text-center">Accepted Settlement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-200/90 text-[#334155]">
                    {drawerReport.rows.length > 0 ? (
                      drawerReport.rows.map((row: CashDrawerReportRow, idx: number) => {
                        const hasVariance = Math.abs(row.variance ?? 0) > 0.01;
                        return (
                          <tr key={row.id || idx} className="hover:bg-[#FDF2F5]/35 transition-colors">
                            <td className="py-3.5 px-3 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                            <td className="py-3.5 px-3.5 whitespace-nowrap font-semibold text-slate-800">{formatDateDisplay(row.date)}</td>
                            <td className="py-3.5 px-3.5 font-bold text-slate-900 whitespace-nowrap">{row.custodianName}</td>
                            <td className="py-3.5 px-3.5 text-slate-600 whitespace-nowrap">{row.branchName}</td>
                            <td className="py-3.5 px-3.5 text-center whitespace-nowrap">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                                row.status === 'SETTLED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : row.status === 'OPEN'
                                  ? 'bg-[#FCE8EC] text-[#23151D]'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-3.5 text-right font-mono tabular-nums">{formatPKR(row.openingBalance ?? 0)}</td>
                            <td className="py-3.5 px-3.5 text-right font-mono font-bold text-emerald-700 tabular-nums">{drawerMoney(drawerDebits(row), true)}</td>
                            <td className="py-3.5 px-3.5 text-right font-mono font-bold text-rose-700 tabular-nums">{drawerMoney(-row.totalCashOut, true)}</td>
                            <td className="py-3.5 px-3.5 text-right font-mono font-extrabold text-[#B82E69] tabular-nums">PKR {formatPKR(row.expectedCash)}</td>
                            <td className="py-3.5 px-3.5 text-right font-mono tabular-nums">
                              {row.countedCash !== null ? `PKR ${formatPKR(row.countedCash)}` : '—'}
                            </td>
                            <td className="py-3.5 px-3.5 text-right font-mono font-bold tabular-nums">
                              <span className={hasVariance ? 'text-amber-600' : 'text-slate-500'}>
                                {drawerMoney(row.variance, true)}
                              </span>
                            </td>
                            <td className="py-3.5 px-3.5 text-center whitespace-nowrap text-xs">
                              {row.latestSettlement ? (
                                <span className={`inline-flex items-center gap-1 font-semibold ${
                                  row.latestSettlement.status === 'ACCEPTED' ? 'text-emerald-700' : 'text-amber-700'
                                }`}>
                                  {row.latestSettlement.status === 'ACCEPTED' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                                  <span>PKR {formatPKR(row.latestSettlement.handoverAmount)} ({row.latestSettlement.status})</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">None</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={12} className="py-12 text-center text-slate-400 text-xs">
                          No cash drawer sessions found for the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
