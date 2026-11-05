import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../context/RouterContext';
import { salonService } from '../../services';
import {
  TipReceiptRecord,
  TipAllocationRecord,
  TipPayoutRecord,
  TipsStatementSummary,
  Branch,
  StaffMember,
  PaymentAccount,
} from '../../types/salon';
import {
  Filter,
  Search,
  Printer,
  X,
  FileSpreadsheet,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Coins,
} from 'lucide-react';
import { AccessDeniedView } from '../scaffold/AccessDeniedView';
import {
  DATE_PRESETS,
  DatePreset,
  downloadReportCsv,
  downloadReportExcel,
  printReportWindow,
  resolvePreset,
} from './reportUtils';

const selectClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const inputClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const labelClass = 'block text-[11px] font-semibold text-[#23151D] mb-1.5';

function formatCurrency(val: number): string {
  const num = Number(val) || 0;
  return Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const TipsStatementPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();
  const { navigate } = useRouter();

  // Role guard: Super Admin and Branch Admin only. Accountant and Staff denied.
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/accounts/tips-statement" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = resolvePreset('THIS_MONTH', businessDate)!;

  // Filters State
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);

  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState<string>(defaultMonth.from);
  const [endDate, setEndDate] = useState<string>(defaultMonth.to);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [selectedPaymentSource, setSelectedPaymentSource] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'SUMMARY' | 'COLLECTIONS' | 'ALLOCATIONS' | 'PAYOUTS'>('SUMMARY');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<TipsStatementSummary>({
    openingLiability: 0,
    netTipsCollected: 0,
    netPayouts: 0,
    closingLiability: 0,
    unallocatedTips: 0,
    allocatedUnpaidTips: 0,
    receiptsCount: 0,
    allocationsCount: 0,
    payoutsCount: 0,
  });
  const [receipts, setReceipts] = useState<TipReceiptRecord[]>([]);
  const [allocations, setAllocations] = useState<TipAllocationRecord[]>([]);
  const [payouts, setPayouts] = useState<TipPayoutRecord[]>([]);

  // Load auxiliary data
  useEffect(() => {
    const loadAux = async () => {
      try {
        const branchParam = selectedBranchId || 'ALL';
        const [bList, sList, pList] = await Promise.all([
          allBranches && allBranches.length > 0 ? Promise.resolve(allBranches) : salonService.getBranches(),
          salonService.getStaff(branchParam),
          salonService.getPaymentAccounts(branchParam),
        ]);
        setBranches(bList);
        setAllStaff(sList);
        setPaymentAccounts(pList);
      } catch (err) {
        console.error('Failed to load auxiliary tips statement data', err);
      }
    };
    loadAux();
  }, [allBranches, selectedBranchId]);

  const handlePresetChange = (p: DatePreset) => {
    setPreset(p);
    const r = resolvePreset(p, businessDate);
    if (r) {
      setStartDate(r.from);
      setEndDate(r.to);
    }
  };

  const branchNameDisplay = useMemo(() => {
    if (selectedBranchId === 'ALL') return 'All Branches';
    return branches.find((b) => b.id === selectedBranchId)?.name || selectedBranchId;
  }, [selectedBranchId, branches]);

  // Load statement data on demand from backend API
  const fetchStatement = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await salonService.getTipsStatement(
        selectedBranchId,
        startDate,
        endDate,
        {
          staffId: selectedStaffId !== 'ALL' ? selectedStaffId : undefined,
          paymentSource: selectedPaymentSource !== 'ALL' ? selectedPaymentSource : undefined,
        },
        user
      );
      setSummary(res.summary);
      setReceipts(res.receipts);
      setAllocations(res.allocations);
      setPayouts(res.payouts);
    } catch (err: any) {
      console.error('Failed to load tips statement', err);
      setErrorMessage(err.message || 'Failed to fetch live tips statement from server.');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, startDate, endDate, selectedStaffId, selectedPaymentSource, user]);

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);
    fetchStatement();
  };

  // Auto-fetch default monthly date range on mount or when branch changes
  useEffect(() => {
    fetchStatement();
  }, [fetchStatement]);

  // Filtered lists for search query
  const filteredReceipts = useMemo(() => {
    if (!searchQuery.trim()) return receipts;
    const q = searchQuery.toLowerCase();
    return receipts.filter(
      (r) =>
        r.receiptNumber.toLowerCase().includes(q) ||
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) ||
        (r.directStaffName && r.directStaffName.toLowerCase().includes(q))
    );
  }, [receipts, searchQuery]);

  const filteredAllocations = useMemo(() => {
    if (!searchQuery.trim()) return allocations;
    const q = searchQuery.toLowerCase();
    return allocations.filter(
      (a) =>
        a.allocationNumber.toLowerCase().includes(q) ||
        a.tipReceiptNumber.toLowerCase().includes(q) ||
        a.invoiceNumber.toLowerCase().includes(q) ||
        a.staffName.toLowerCase().includes(q)
    );
  }, [allocations, searchQuery]);

  const filteredPayouts = useMemo(() => {
    if (!searchQuery.trim()) return payouts;
    const q = searchQuery.toLowerCase();
    return payouts.filter(
      (p) =>
        p.payoutNumber.toLowerCase().includes(q) ||
        p.allocationNumber.toLowerCase().includes(q) ||
        p.staffName.toLowerCase().includes(q) ||
        (p.onlineAccountName && p.onlineAccountName.toLowerCase().includes(q)) ||
        (p.reference && p.reference.toLowerCase().includes(q))
    );
  }, [payouts, searchQuery]);

  const isEquationBalanced = useMemo(() => {
    const calc = summary.openingLiability + summary.netTipsCollected - summary.netPayouts;
    return Math.abs(calc - summary.closingLiability) <= 1;
  }, [summary]);

  // Export handlers
  const handleExportCSV = () => {
    const meta: [string, string][] = [
      ['Report', 'Tips & Gratuity Financial Statement'],
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Opening Liability', summary.openingLiability.toFixed(2)],
      ['Net Tips Collected', summary.netTipsCollected.toFixed(2)],
      ['Net Payouts', summary.netPayouts.toFixed(2)],
      ['Closing Liability', summary.closingLiability.toFixed(2)],
      ['Generated At', new Date().toLocaleString()],
    ];

    const receiptHeaders = ['Receipt #', 'Date', 'Time', 'Invoice #', 'Client', 'Channel', 'Collected', 'Allocated', 'Unallocated', 'Status'];
    const receiptRows = filteredReceipts.map((r) => [
      r.receiptNumber, r.collectionDate, r.collectionTime, r.invoiceNumber, r.clientName, r.method,
      r.collectedAmount.toFixed(2), r.allocatedAmount.toFixed(2), r.unallocatedAmount.toFixed(2), r.status
    ]);

    const allocHeaders = ['Allocation #', 'Date', 'Receipt #', 'Staff Recipient', 'Type', 'Amount', 'Paid', 'Outstanding', 'Status'];
    const allocRows = filteredAllocations.map((a) => [
      a.allocationNumber, a.allocationDate, a.tipReceiptNumber, a.staffName, a.allocationType,
      a.amount.toFixed(2), a.paidAmount.toFixed(2), a.outstandingAmount.toFixed(2), a.status
    ]);

    const payoutHeaders = ['Payout #', 'Date', 'Time', 'Staff Recipient', 'Allocation #', 'Source', 'Amount', 'Processed By', 'Status'];
    const payoutRows = filteredPayouts.map((p) => [
      p.payoutNumber, p.payoutDate, p.payoutTime, p.staffName, p.allocationNumber, p.method,
      p.amount.toFixed(2), p.paidByName, p.status
    ]);

    downloadReportCsv(`Tips_Statement_${startDate}_${endDate}.csv`, meta, [
      { title: 'Tip Receipts', headers: receiptHeaders, rows: receiptRows },
      { title: 'Tip Allocations', headers: allocHeaders, rows: allocRows },
      { title: 'Tip Disbursements', headers: payoutHeaders, rows: payoutRows },
    ]);
  };

  const handleExportExcel = () => {
    const meta: [string, string][] = [
      ['Report', 'Tips & Gratuity Financial Statement'],
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Opening Liability', summary.openingLiability.toFixed(2)],
      ['Net Tips Collected', summary.netTipsCollected.toFixed(2)],
      ['Net Payouts', summary.netPayouts.toFixed(2)],
      ['Closing Liability', summary.closingLiability.toFixed(2)],
      ['Generated At', new Date().toLocaleString()],
    ];

    const receiptHeaders = ['Receipt #', 'Date', 'Time', 'Invoice #', 'Client', 'Channel', 'Collected', 'Allocated', 'Unallocated', 'Status'];
    const receiptRows = filteredReceipts.map((r) => [
      r.receiptNumber, r.collectionDate, r.collectionTime, r.invoiceNumber, r.clientName, r.method,
      r.collectedAmount.toFixed(2), r.allocatedAmount.toFixed(2), r.unallocatedAmount.toFixed(2), r.status
    ]);

    const allocHeaders = ['Allocation #', 'Date', 'Receipt #', 'Staff Recipient', 'Type', 'Amount', 'Paid', 'Outstanding', 'Status'];
    const allocRows = filteredAllocations.map((a) => [
      a.allocationNumber, a.allocationDate, a.tipReceiptNumber, a.staffName, a.allocationType,
      a.amount.toFixed(2), a.paidAmount.toFixed(2), a.outstandingAmount.toFixed(2), a.status
    ]);

    const payoutHeaders = ['Payout #', 'Date', 'Time', 'Staff Recipient', 'Allocation #', 'Source', 'Amount', 'Processed By', 'Status'];
    const payoutRows = filteredPayouts.map((p) => [
      p.payoutNumber, p.payoutDate, p.payoutTime, p.staffName, p.allocationNumber, p.method,
      p.amount.toFixed(2), p.paidByName, p.status
    ]);

    downloadReportExcel(`Tips_Statement_${startDate}_${endDate}.csv`, meta, [
      { title: 'Tip Receipts', headers: receiptHeaders, rows: receiptRows },
      { title: 'Tip Allocations', headers: allocHeaders, rows: allocRows },
      { title: 'Tip Disbursements', headers: payoutHeaders, rows: payoutRows },
    ]);
  };

  const handlePrint = () => {
    const meta: [string, string][] = [
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Opening Liability', formatCurrency(summary.openingLiability)],
      ['Net Tips Collected', formatCurrency(summary.netTipsCollected)],
      ['Net Payouts Disbursed', formatCurrency(summary.netPayouts)],
      ['Closing Liability', formatCurrency(summary.closingLiability)],
      ['Generated By', user.name],
    ];

    if (activeTab === 'COLLECTIONS') {
      const headers = ['Receipt #', 'Date', 'Invoice #', 'Client', 'Channel', 'Collected', 'Allocated', 'Unallocated', 'Status'];
      const rows = filteredReceipts.map((r) => [
        r.receiptNumber, r.collectionDate, r.invoiceNumber, r.clientName, r.method,
        formatCurrency(r.collectedAmount), formatCurrency(r.allocatedAmount), formatCurrency(r.unallocatedAmount), r.status
      ]);
      printReportWindow({ title: 'Tip Collections Statement', subtitle: `Receipts Breakdown`, meta, headers, rows });
    } else if (activeTab === 'ALLOCATIONS') {
      const headers = ['Allocation #', 'Date', 'Receipt #', 'Staff Recipient', 'Type', 'Amount', 'Paid', 'Outstanding', 'Status'];
      const rows = filteredAllocations.map((a) => [
        a.allocationNumber, a.allocationDate, a.tipReceiptNumber, a.staffName, a.allocationType,
        formatCurrency(a.amount), formatCurrency(a.paidAmount), formatCurrency(a.outstandingAmount), a.status
      ]);
      printReportWindow({ title: 'Tip Allocations Statement', subtitle: `Staff Payable Entitlements`, meta, headers, rows });
    } else if (activeTab === 'PAYOUTS') {
      const headers = ['Payout #', 'Date', 'Staff Recipient', 'Allocation #', 'Source', 'Amount', 'Processed By', 'Status'];
      const rows = filteredPayouts.map((p) => [
        p.payoutNumber, p.payoutDate, p.staffName, p.allocationNumber, p.method,
        formatCurrency(p.amount), p.paidByName, p.status
      ]);
      printReportWindow({ title: 'Tip Disbursements Statement', subtitle: `Staff Gratuity Payouts`, meta, headers, rows });
    } else {
      const headers = ['Liability Metric', 'Status', 'Amount (PKR)'];
      const rows = [
        ['Opening Gratuity Liability (Prior to period)', 'Opening', formatCurrency(summary.openingLiability)],
        ['Net Gratuity Collected (Period Receipts)', 'Inflow (+)', formatCurrency(summary.netTipsCollected)],
        ['Net Gratuity Disbursed (Period Payouts)', 'Outflow (-)', formatCurrency(summary.netPayouts)],
        ['Closing Gratuity Liability (At cutoff date)', 'Closing Balance', formatCurrency(summary.closingLiability)],
        ['Unallocated Gratuity Pool (Awaiting Assignment)', 'Internal Pool', formatCurrency(summary.unallocatedTips)],
        ['Allocated Unpaid Tips (Awaiting Disbursement)', 'Staff Payable', formatCurrency(summary.allocatedUnpaidTips)],
      ];
      printReportWindow({ title: 'Tips Financial Statement', subtitle: `Comprehensive Audit Reconciliation`, meta, headers, rows });
    }
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Coins className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Tips & Gratuity Financial Statement
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  Gratuity Ledger
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Audit of client tip collections at POS, staff entitlements, cash/bank disbursements, and unallocated float reconciliation
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
            {/* Branch */}
            <div>
              <label className={labelClass}>Branch</label>
              <select
                className={selectClass}
                value={selectedBranchId}
                disabled={!isSuperAdmin}
                onChange={(e) => {
                  setSelectedBranchId(e.target.value);
                  setSelectedStaffId('ALL');
                }}
              >
                {isSuperAdmin && <option value="ALL">All Branches</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Staff Member */}
            <div>
              <label className={labelClass}>Staff Member</label>
              <select
                className={selectClass}
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
              >
                <option value="ALL">All Staff</option>
                {allStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment Source */}
            <div>
              <label className={labelClass}>Payment Channel</label>
              <select
                className={selectClass}
                value={selectedPaymentSource}
                onChange={(e) => setSelectedPaymentSource(e.target.value)}
              >
                <option value="ALL">All Channels</option>
                <option value="CASH">Cash Float</option>
                <option value="ONLINE">Bank / Online Account</option>
              </select>
            </div>

            {/* Date Preset */}
            <div>
              <label className={labelClass}>Date Preset</label>
              <select
                className={selectClass}
                value={preset}
                onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
              >
                {DATE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* From Date */}
            <div>
              <label className={labelClass}>From Date</label>
              <input
                type="date"
                className={inputClass}
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPreset('CUSTOM');
                }}
              />
            </div>

            {/* To Date */}
            <div>
              <label className={labelClass}>To Date</label>
              <input
                type="date"
                className={inputClass}
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPreset('CUSTOM');
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3.5 items-end">
            {/* Search Query */}
            <div className="md:col-span-5 relative">
              <label className={labelClass}>Search</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search receipt #, invoice #, staff recipient..."
                  className={`${inputClass} pl-8.5`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Filter Action Button */}
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-9 bg-[#B82E69] hover:bg-[#A02358] active:bg-[#851C47] text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-70"
              >
                {loading ? (
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
          </div>
        </form>
      </div>

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR FINANCIAL KPI CARDS (when filtered) ── */}
      {hasFiltered && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Opening Gratuity Liability */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-slate-600">
                <Scale className="w-4 h-4" />
              </div>
              <span className="bg-slate-100 text-slate-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Opening
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatCurrency(summary.openingLiability)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Unsettled balance prior
              </span>
            </div>
          </div>

          {/* Card 2: Net Tips Collected at POS */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <Coins className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Inflow (+)
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono tabular-nums tracking-tight block">
                +PKR {formatCurrency(summary.netTipsCollected)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {summary.receiptsCount} client receipts collected
              </span>
            </div>
          </div>

          {/* Card 3: Net Payouts Disbursed to Staff */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-rose-600">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <span className="bg-rose-50 text-rose-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Outflow (−)
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-rose-600 font-mono tabular-nums tracking-tight block">
                -PKR {formatCurrency(summary.netPayouts)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {summary.payoutsCount} staff payouts disbursed
              </span>
            </div>
          </div>

          {/* Card 4: Closing Gratuity Liability */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Scale className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Closing
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#B82E69] font-mono tabular-nums tracking-tight block">
                PKR {formatCurrency(summary.closingLiability)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Net liability payable to staff
              </span>
            </div>
          </div>

          {/* Card 5: Unallocated Tips Pool */}
          <div
            onClick={() => navigate('/accounts/tips-management')}
            className="p-5 rounded-[24px] border border-amber-200/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-amber-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group cursor-pointer"
            title="Click to allocate and pay staff tips in Tips Management"
          >
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-amber-50 shadow-2xs border border-amber-100 flex items-center justify-center text-amber-600">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Unallocated
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatCurrency(summary.unallocatedTips)}
              </span>
              <span className="text-xs text-amber-800 font-semibold mt-1 flex items-center justify-between">
                <span>Collected float pool</span>
                <span className="text-[10px] font-bold text-[#B82E69] underline">Allocate & Pay ➔</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. MAIN CONTENT AREA: TABLE & STATES ── */}
      {!hasFiltered ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 md:p-24 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69] mb-4">
            <Filter className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h3 className="text-base font-bold text-[#18191B]">No Filter Applied</h3>
          <p className="text-xs text-[#78616C] mt-1 max-w-sm">
            Select a branch and date range above, then click &ldquo;Apply Filters&rdquo; to load tip financial ledger statements.
          </p>
        </div>
      ) : loading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-sm animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#B82E69]" />
          </div>
          <p className="text-sm font-bold text-[#18191B]">Reconciling Tip Ledger Records...</p>
          <p className="text-xs text-[#78616C] mt-0.5">Calculating staff tip allocations and disbursements from server</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-[24px] border border-rose-200/80 bg-white/85 p-8 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035)] text-center">
          <p className="text-rose-600 text-sm font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={() => handleApplyFilters()}
            className="px-4 py-2 bg-[#B82E69] text-white text-xs font-semibold rounded-xl shadow-xs hover:bg-[#A02358] transition-colors cursor-pointer"
          >
            Retry Query
          </button>
        </div>
      ) : (
        /* Filtered Data Layout: Frosted Table Card */
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* Header Bar with View Switcher Tabs & Export Actions */}
          <div className="px-6 py-4 border-b border-white/80 bg-white/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 font-bold text-sm tracking-tight text-[#18191B]">
                <Coins className="w-4 h-4 text-[#B82E69]" />
                <span>Tips Statement Ledger</span>
              </div>

              {/* View Switcher Tabs */}
              <div className="flex items-center bg-slate-100/70 p-1 rounded-xl border border-white/80 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('SUMMARY')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeTab === 'SUMMARY'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Summary
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('COLLECTIONS')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeTab === 'COLLECTIONS'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Collections ({filteredReceipts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('ALLOCATIONS')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeTab === 'ALLOCATIONS'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Allocations ({filteredAllocations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('PAYOUTS')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeTab === 'PAYOUTS'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Disbursements ({filteredPayouts.length})
                </button>
              </div>
            </div>

            {/* Export & Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/accounts/tips-management')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02358] hover:to-[#851C47] text-white shadow-xs text-xs font-bold transition-all cursor-pointer active:scale-[0.98]"
                title="Go to Tips Management to allocate and disburse payouts to staff"
              >
                <Coins className="w-3.5 h-3.5" />
                <span>Allocate & Pay Tips ➔</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-rose-600" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            {activeTab === 'SUMMARY' ? (
              <table className="report-records w-full text-left border-collapse min-w-[800px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4">Financial Liability Metric</th>
                    <th className="py-3 px-4 text-center">Accounting Classification</th>
                    <th className="py-3 px-4 text-right">Balance (PKR)</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-[#FDF2F5]/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">Opening Gratuity Liability</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                        OPENING BALANCE
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                      {formatCurrency(summary.openingLiability)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">Unsettled tip balance prior to {startDate}</td>
                  </tr>
                  <tr className="hover:bg-[#FDF2F5]/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">Net Tips Collected at POS</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                        PERIOD INFLOW (+)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 tabular-nums">
                      +{formatCurrency(summary.netTipsCollected)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{summary.receiptsCount} client receipts posted</td>
                  </tr>
                  <tr className="hover:bg-[#FDF2F5]/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">Net Payouts Disbursed to Staff</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200/60">
                        PERIOD OUTFLOW (−)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 tabular-nums">
                      -{formatCurrency(summary.netPayouts)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{summary.payoutsCount} staff cash/bank payouts</td>
                  </tr>
                  <tr className="bg-[#FDF2F5]/60 border-t-2 border-b-2 border-slate-200/80 font-bold text-slate-900">
                    <td className="py-3 px-4 font-black">Closing Gratuity Liability</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[#B82E69] text-white">
                        CLOSING BALANCE
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-sm font-black text-[#B82E69] tabular-nums">
                      {formatCurrency(summary.closingLiability)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-semibold">
                      Current staff liability (Opening + Inflows − Outflows)
                    </td>
                  </tr>
                  <tr className="hover:bg-[#FDF2F5]/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-700">Unallocated Tips (Float pool)</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">
                        UNASSIGNED POOL
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-amber-600 tabular-nums">
                      {formatCurrency(summary.unallocatedTips)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">Collected at POS but not yet assigned to stylists</td>
                  </tr>
                  <tr className="hover:bg-[#FDF2F5]/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-700">Allocated Tips Awaiting Payout</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                        STAFF PAYABLE
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-blue-600 tabular-nums">
                      {formatCurrency(summary.allocatedUnpaidTips)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">Assigned to staff accounts; pending disbursement</td>
                  </tr>
                </tbody>
              </table>
            ) : activeTab === 'COLLECTIONS' ? (
              <table className="report-records w-full text-left border-collapse min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4">Receipt #</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Channel</th>
                    <th className="py-3 px-4 text-right">Collected</th>
                    <th className="py-3 px-4 text-right">Allocated</th>
                    <th className="py-3 px-4 text-right">Unallocated</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-slate-400 font-medium">
                        No tip receipts found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredReceipts.map((r) => (
                      <tr key={r.id} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#B82E69]">{r.receiptNumber}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600 font-mono">{r.collectionDate} <span className="text-slate-400 text-[11px]">{r.collectionTime}</span></td>
                        <td className="py-3 px-4 font-mono text-slate-700">{r.invoiceNumber}</td>
                        <td className="py-3 px-4 text-slate-800 font-medium">{r.clientName}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {r.method === 'CASH' ? 'Cash Float' : 'Bank / Online'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {formatCurrency(r.collectedAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-600 tabular-nums">
                          {formatCurrency(r.allocatedAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-amber-600 tabular-nums">
                          {formatCurrency(r.unallocatedAmount)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20">
                              {r.status}
                            </span>
                            {r.unallocatedAmount > 0 && (
                              <button
                                type="button"
                                onClick={() => navigate('/accounts/tips-management')}
                                className="px-2 py-0.5 bg-[#B82E69] hover:bg-[#A02358] text-white text-[10px] font-bold rounded-lg shadow-2xs cursor-pointer transition-colors"
                                title="Allocate and disburse this tip in Tips Management"
                              >
                                Allocate & Pay
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredReceipts.length > 0 && (
                  <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs font-bold text-slate-800">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">{filteredReceipts.length} Receipts</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                        {formatCurrency(filteredReceipts.reduce((s, r) => s + r.collectedAmount, 0))}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-emerald-600">
                        {formatCurrency(filteredReceipts.reduce((s, r) => s + r.allocatedAmount, 0))}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-amber-600">
                        {formatCurrency(filteredReceipts.reduce((s, r) => s + r.unallocatedAmount, 0))}
                      </td>
                      <td className="py-3.5 px-4"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : activeTab === 'ALLOCATIONS' ? (
              <table className="report-records w-full text-left border-collapse min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4">Allocation #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Receipt #</th>
                    <th className="py-3 px-4">Staff Recipient</th>
                    <th className="py-3 px-4 text-center">Type</th>
                    <th className="py-3 px-4 text-right">Allocated</th>
                    <th className="py-3 px-4 text-right">Disbursed (Paid)</th>
                    <th className="py-3 px-4 text-right">Outstanding</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAllocations.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-slate-400 font-medium">
                        No tip allocations found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredAllocations.map((a) => (
                      <tr key={a.id} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#B82E69]">{a.allocationNumber}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600 font-mono">{a.allocationDate}</td>
                        <td className="py-3 px-4 font-mono text-slate-700">{a.tipReceiptNumber}</td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{a.staffName}</td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {a.allocationType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {formatCurrency(a.amount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-600 tabular-nums">
                          {formatCurrency(a.paidAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#B82E69] tabular-nums">
                          {formatCurrency(a.outstandingAmount)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20">
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredAllocations.length > 0 && (
                  <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs font-bold text-slate-800">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">{filteredAllocations.length} Allocations</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                        {formatCurrency(filteredAllocations.reduce((s, a) => s + a.amount, 0))}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                        {formatCurrency(filteredAllocations.reduce((s, a) => s + a.paidAmount, 0))}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#B82E69]">
                        {formatCurrency(filteredAllocations.reduce((s, a) => s + a.outstandingAmount, 0))}
                      </td>
                      <td className="py-3.5 px-4"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <table className="report-records w-full text-left border-collapse min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-3 px-4">Payout #</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Staff Recipient</th>
                    <th className="py-3 px-4">Allocation #</th>
                    <th className="py-3 px-4">Disbursement Source</th>
                    <th className="py-3 px-4 text-right">Disbursed Amount</th>
                    <th className="py-3 px-4">Processed By</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPayouts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-slate-400 font-medium">
                        No tip disbursements found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredPayouts.map((p) => (
                      <tr key={p.id} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#B82E69]">{p.payoutNumber}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600 font-mono">{p.payoutDate} <span className="text-slate-400 text-[11px]">{p.payoutTime}</span></td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{p.staffName}</td>
                        <td className="py-3 px-4 font-mono text-slate-700">{p.allocationNumber}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {p.method === 'CASH' ? 'Cash Drawer' : p.onlineAccountName || 'Bank Account'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 tabular-nums">
                          {formatCurrency(p.amount)}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{p.paidByName}</td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredPayouts.length > 0 && (
                  <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs font-bold text-slate-800">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">{filteredPayouts.length} Disbursements</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold tabular-nums text-rose-600">
                        {formatCurrency(filteredPayouts.reduce((s, p) => s + p.amount, 0))}
                      </td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      {/* Footer Branding */}
      <div className="mt-8 text-center text-xs text-slate-400 pb-6">
        © iSysware Management System
      </div>
    </div>
  );
};

export default TipsStatementPage;
