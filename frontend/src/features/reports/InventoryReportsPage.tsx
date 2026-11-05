import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import {
  InventoryReportData,
  InventorySubReportType,
  InventoryReportQuery,
  InventoryValuationRow,
  InventoryMovementRow,
  InventoryPurchaseRow,
  InventorySupplierLedgerRow,
  InventoryConsumptionRow,
  InventoryExpiryRow,
  Branch,
  Supplier,
} from '@/types/salon';
import { useRouter } from '@/context/RouterContext';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import {
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  Loader2,
  Boxes,
  History,
  ShoppingCart,
  BookOpen,
  Scissors,
  AlertTriangle,
} from 'lucide-react';
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

const formatPKR = (amt: number) => {
  const num = Number(amt) || 0;
  return Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const InventoryReportsPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role Guard: SUPER_ADMIN, ADMIN, ACCOUNTANT (Staff cannot access)
  if (!user || !['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
    return <AccessDeniedView attemptedPath="/reports/inventory" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const businessDate = demoDate || new Date().toISOString().slice(0, 10);
  const defaultMonth = resolvePreset('THIS_MONTH', businessDate)!;

  const { navigate } = useRouter();

  // Sub-report type
  const [activeTab, setActiveTab] = useState<InventorySubReportType>('valuation');

  // Filter Form State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedItemType, setSelectedItemType] = useState<string>('ALL');
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState<string>(defaultMonth.from);
  const [customTo, setCustomTo] = useState<string>(defaultMonth.to);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Suppliers for Single Supplier Ledger Selection
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('ALL');

  useEffect(() => {
    salonService
      .getSuppliers(selectedBranch || 'ALL', user)
      .then((res) => setSuppliers(res || []))
      .catch(() => setSuppliers([]));
  }, [selectedBranch, user]);

  // Page state: Auto-load default monthly date range on mount
  const [hasFiltered, setHasFiltered] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<InventoryReportData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePresetChange = (p: DatePreset) => {
    setSelectedPreset(p);
    const r = resolvePreset(p, businessDate);
    if (r) {
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  };

  const branchNameDisplay = useMemo(() => {
    if (selectedBranch === 'ALL') return 'All Branches';
    const found = allBranches?.find((b: Branch) => b.id === selectedBranch);
    return found ? `${found.name} (${found.city})` : reportData?.meta?.branchName || selectedBranch;
  }, [selectedBranch, allBranches, reportData]);

  // Fetch Report Data from Live Express Backend
  const fetchReport = useCallback(
    async (q: InventoryReportQuery) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await salonService.getInventoryReport(q);
        setReportData(data);
      } catch (err: any) {
        console.error('Failed to load Inventory report:', err);
        setErrorMessage(
          err.message || 'Failed to fetch live inventory report from server.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleApplyFilters = (e?: React.FormEvent, overrideTab?: InventorySubReportType) => {
    if (e) e.preventDefault();
    setHasFiltered(true);

    const targetTab = overrideTab || activeTab;
    const isLedger = targetTab === 'supplier-ledger' || activeTab === 'supplier-ledger';
    const query: InventoryReportQuery = {
      branchId: selectedBranch,
      type: targetTab,
      categoryId: selectedCategory !== 'ALL' ? selectedCategory : undefined,
      itemType: selectedItemType !== 'ALL' ? selectedItemType : undefined,
      supplierId: isLedger && selectedSupplierId !== 'ALL' ? selectedSupplierId : undefined,
      preset: selectedPreset,
      from: customFrom || undefined,
      to: customTo || undefined,
      search: searchQuery.trim() || undefined,
    };

    fetchReport(query);
  };

  // Auto-fetch default monthly date range on mount or when branch/tab changes
  useEffect(() => {
    handleApplyFilters(undefined, activeTab);
  }, [selectedBranch, activeTab]);

  const handleTabChange = (tab: InventorySubReportType) => {
    setActiveTab(tab);
    if (hasFiltered) {
      handleApplyFilters(undefined, tab);
    }
  };

  // Export handlers
  const exportMeta: [string, string][] = useMemo(() => [
    ['Report', `Inventory Report (${activeTab.toUpperCase()})`],
    ['Branch', branchNameDisplay],
    ['Period', `${customFrom} to ${customTo}`],
    ['Generated By', user?.name || 'Administrator'],
    ['Generated At', new Date().toLocaleString()],
  ], [activeTab, branchNameDisplay, customFrom, customTo, user]);

  const handleExportCsv = () => {
    if (!reportData || !reportData.rows.length) return;
    const headers = Object.keys(reportData.rows[0] || {});
    const rows = reportData.rows.map((r: any) => Object.values(r));
    downloadReportCsv(`inventory_${activeTab}_report.csv`, exportMeta, [
      { headers, rows },
    ]);
  };

  const handleExportExcel = () => {
    if (!reportData || !reportData.rows.length) return;
    const headers = Object.keys(reportData.rows[0] || {});
    const rows = reportData.rows.map((r: any) => Object.values(r));
    downloadReportExcel(`inventory_${activeTab}_report.csv`, exportMeta, [
      { headers, rows },
    ]);
  };

  const handleExportPrint = () => {
    if (!reportData || !reportData.rows.length) return;
    const headers = Object.keys(reportData.rows[0] || {});
    const rows = reportData.rows.map((r: any) => Object.values(r).map(v => typeof v === 'number' ? formatPKR(v) : String(v ?? '—')));
    printReportWindow({
      title: `Inventory Report (${activeTab.toUpperCase()})`,
      subtitle: branchNameDisplay,
      meta: exportMeta,
      headers,
      rows,
    });
  };

  const totals = reportData?.totals;

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Inventory & Supply Chain Reports
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  FIFO & Landed Cost
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Valuation at historical landed cost layers, stock movements, supplier ledgers, salon consumption, and expiry tracking
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={(e) => handleApplyFilters(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
            {/* Branch */}
            <div>
              <label className={labelClass}>Branch</label>
              <select
                className={selectClass}
                value={selectedBranch}
                disabled={!isSuperAdmin}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                {isSuperAdmin && <option value="ALL">All Branches</option>}
                {allBranches?.map((b: Branch) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city})
                  </option>
                ))}
              </select>
            </div>

            {activeTab === 'supplier-ledger' ? (
              <div className="sm:col-span-2">
                <label className={labelClass}>Vendor / Supplier (Single or All)</label>
                <select
                  className={selectClass}
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                >
                  <option value="ALL">All Suppliers (Aggregate Ledger)</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({(s as any).code || s.contactPerson || 'Vendor'})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                {/* Category */}
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    className={selectClass}
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    <option value="ALL">All Categories</option>
                    <option value="HAIR_CARE">Hair Care</option>
                    <option value="SKIN_CARE">Skin Care</option>
                    <option value="COLOR">Hair Color / Dye</option>
                    <option value="NAIL_CARE">Nails</option>
                    <option value="TREATMENTS">Treatments</option>
                    <option value="SPA_WELLNESS">Spa & Wellness</option>
                    <option value="OTHER">Other Salon Supplies</option>
                  </select>
                </div>

                {/* Item Type */}
                <div>
                  <label className={labelClass}>Item Intent</label>
                  <select
                    className={selectClass}
                    value={selectedItemType}
                    onChange={(e) => setSelectedItemType(e.target.value)}
                  >
                    <option value="ALL">All Types</option>
                    <option value="RETAIL">Retail Product (For Sale)</option>
                    <option value="CONSUMABLE">In-House Consumable (Usage)</option>
                  </select>
                </div>
              </>
            )}

            {/* Date Preset */}
            <div>
              <label className={labelClass}>Date Preset</label>
              <select
                className={selectClass}
                value={selectedPreset}
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
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setSelectedPreset('CUSTOM');
                }}
              />
            </div>

            {/* To Date */}
            <div>
              <label className={labelClass}>To Date</label>
              <input
                type="date"
                className={inputClass}
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setSelectedPreset('CUSTOM');
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3.5 items-end">
            {/* Search Query */}
            <div className="md:col-span-5 relative">
              <label className={labelClass}>Search</label>
              <input
                type="text"
                placeholder="Search item name, SKU, barcode, supplier, batch..."
                className={inputClass}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
          </div>
        </form>
      </div>

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR KPI CARDS (when filtered) ── */}
      {hasFiltered && reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Valuation / Purchases Inflow */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <Boxes className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Cost Valuation
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals?.costValue || totals?.totalPurchases || totals?.totalCost || 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {activeTab === 'purchases' ? 'Total purchase acquisitions' : activeTab === 'consumption' ? 'Total salon consumption cost' : 'Landed cost asset valuation'}
              </span>
            </div>
          </div>

          {/* Card 2: Retail Asset Potential */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-purple-600">
                <Boxes className="w-4 h-4" />
              </div>
              <span className="bg-purple-50 text-purple-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Retail Potential
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals?.retailValue || totals?.paidAmount || 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {activeTab === 'purchases' ? 'Paid to vendors' : 'Estimated catalog retail turnover'}
              </span>
            </div>
          </div>

          {/* Card 3: Potential Profit / Outstanding */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <Boxes className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Profit Margin
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono tabular-nums tracking-tight block">
                PKR {formatPKR(totals?.potentialProfit || totals?.outstandingAmount || 0)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {activeTab === 'purchases' ? 'Vendor payables outstanding' : 'Expected gross inventory margin'}
              </span>
            </div>
          </div>

          {/* Card 4: Inventory Units */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Boxes className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                On Hand Units
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#B82E69] font-mono tabular-nums tracking-tight block">
                {totals?.remainingQuantity?.toLocaleString() || totals?.totalConsumedQuantity?.toLocaleString() || 0}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Total physical unit count
              </span>
            </div>
          </div>

          {/* Card 5: Expiry & Risk Exposure */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Audit Scope
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono tabular-nums tracking-tight block">
                {reportData.rows.length} Items
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Audited ledger entries in period
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
            Select a branch, category, or date range above, then click &ldquo;Apply Filters&rdquo; to load inventory reports.
          </p>
        </div>
      ) : isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-sm animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#B82E69]" />
          </div>
          <p className="text-sm font-bold text-[#18191B]">Loading Inventory Reports...</p>
          <p className="text-xs text-[#78616C] mt-0.5">Querying canonical database records for {activeTab} report...</p>
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
          {/* Header Bar with Sub-Report Tabs & Export Actions */}
          <div className="px-6 py-4 border-b border-white/80 bg-white/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 font-bold text-sm tracking-tight text-[#18191B]">
                <Boxes className="w-4 h-4 text-[#B82E69]" />
                <span>Inventory Reports</span>
              </div>
              <div className="flex flex-wrap items-center bg-slate-100/70 p-1 rounded-xl border border-white/80 gap-1 text-xs">
                {[
                  { id: 'valuation', label: 'Valuation & Layers' },
                  { id: 'movements', label: 'Movement Trail' },
                  { id: 'purchases', label: 'Purchases' },
                  { id: 'supplier-ledger', label: 'Supplier Ledger' },
                  { id: 'consumption', label: 'Salon Usage' },
                  { id: 'expiry', label: 'Expiry & Risk' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTabChange(t.id as InventorySubReportType)}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                      activeTab === t.id
                        ? 'bg-white text-[#B82E69] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
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
                onClick={handleExportPrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print</span>
              </button>
            </div>
          </div>

{/* Table Container */}
          <div className="bg-white overflow-x-auto rounded-b-xl border-t border-[#F1DEE3]/40">
            {activeTab === 'valuation' && (
              <table className="report-records w-full text-left border-collapse min-w-[1000px] font-['Inter',sans-serif] text-[13px] antialiased">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-4">Item & SKU</th>
                    <th className="py-3.5 px-4">Category</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4 text-right">On Hand Qty</th>
                    <th className="py-3.5 px-4 text-right">Landed Unit Cost</th>
                    <th className="py-3.5 px-4 text-right">Cost Value</th>
                    <th className="py-3.5 px-4 text-right">Retail Price</th>
                    <th className="py-3.5 px-4 text-right">Retail Value</th>
                    <th className="py-3.5 px-4 text-right">Potential Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200">
                  {(!reportData?.rows || reportData.rows.length === 0) ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        No valuation records found for the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    (reportData.rows as InventoryValuationRow[]).map((r, i) => (
                      <tr key={`${r.sku}-${i}`} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#23151D]">{r.itemName}</div>
                          <div className="text-[10px] font-mono text-slate-400">SKU: {r.sku}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{r.category}</td>
                        <td className="py-3.5 px-4 text-slate-600">{r.branchName}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          {r.remainingQuantity.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-600">{formatPKR(r.unitCost)}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-[#23151D]">{formatPKR(r.costValue)}</td>
                        <td className="py-3.5 px-4 text-right text-slate-600">{formatPKR(r.sellingPrice)}</td>
                        <td className="py-3.5 px-4 text-right text-slate-700">{formatPKR(r.retailValue)}</td>
                        <td className="py-3.5 px-4 text-right font-semibold text-[#9D2558]">
                          {formatPKR(r.potentialProfit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {totals && reportData && reportData.rows.length > 0 && (
                  <tfoot className="bg-[#F8FAFC] font-bold text-[#23151D] border-t-2 border-slate-200 text-[13px]">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right">{totals.remainingQuantity?.toLocaleString()}</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right text-[#23151D]">{formatPKR(totals.costValue)}</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right">{formatPKR(totals.retailValue)}</td>
                      <td className="py-3.5 px-4 text-right text-[#9D2558]">{formatPKR(totals.potentialProfit)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}

            {activeTab === 'movements' && (
              <table className="report-records w-full text-left border-collapse min-w-[1000px] font-['Inter',sans-serif] text-[13px] antialiased">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-4">Date & Time</th>
                    <th className="py-3.5 px-4">Item & SKU</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4">Event / Reason</th>
                    <th className="py-3.5 px-4">Ref #</th>
                    <th className="py-3.5 px-4 text-right">In Qty</th>
                    <th className="py-3.5 px-4 text-right">Out Qty</th>
                    <th className="py-3.5 px-4 text-right">Total Cost</th>
                    <th className="py-3.5 px-4">Performed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200">
                  {(!reportData?.rows || reportData.rows.length === 0) ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        No stock movement records found for the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    (reportData.rows as InventoryMovementRow[]).map((r, i) => (
                      <tr key={r.id || i} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        <td className="py-3.5 px-4 font-mono text-[12px] text-slate-600">{r.date} {r.time}</td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#23151D]">{r.itemName}</div>
                          <div className="text-[10px] font-mono text-slate-400">SKU: {r.sku}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{r.branchName}</td>
                        <td className="py-3.5 px-4 text-slate-700">{r.movementType}</td>
                        <td className="py-3.5 px-4 font-mono text-[12px] text-slate-600">{r.movementNumber}</td>
                        <td className="py-3.5 px-4 text-right font-medium text-[#9D2558]">
                          {r.direction === 'IN' ? `+${r.quantity.toLocaleString()}` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-700">
                          {r.direction === 'OUT' ? `-${r.quantity.toLocaleString()}` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-[#23151D]">
                          {r.totalCost > 0 ? formatPKR(r.totalCost) : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{r.userName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {totals && reportData && reportData.rows.length > 0 && (
                  <tfoot className="bg-[#F8FAFC] font-bold text-[#23151D] border-t-2 border-slate-200 text-[13px]">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right text-[#9D2558]">+{totals.inQuantity?.toLocaleString()}</td>
                      <td className="py-3.5 px-4 text-right">-{totals.outQuantity?.toLocaleString()}</td>
                      <td className="py-3.5 px-4 text-right text-[#23151D]">{formatPKR(totals.outCostValue)}</td>
                      <td className="py-3.5 px-4">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}

            {activeTab === 'purchases' && (
              <table className="report-records w-full text-left border-collapse min-w-[900px] font-['Inter',sans-serif] text-[13px] antialiased">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">PO / Invoice #</th>
                    <th className="py-3.5 px-4">Supplier</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4 text-right">Net Amount</th>
                    <th className="py-3.5 px-4 text-right">Paid Amount</th>
                    <th className="py-3.5 px-4 text-right">Balance Due</th>
                    <th className="py-3.5 px-4 text-center">Payment Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200">
                  {(!reportData?.rows || reportData.rows.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        No purchase records found for the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    (reportData.rows as InventoryPurchaseRow[]).map((r, i) => (
                      <tr key={r.id || i} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        <td className="py-3.5 px-4 text-slate-600">{r.purchaseDate}</td>
                        <td className="py-3.5 px-4 font-mono font-medium text-slate-900">{r.purchaseNumber}</td>
                        <td className="py-3.5 px-4 font-semibold text-[#23151D]">{r.supplierName}</td>
                        <td className="py-3.5 px-4 text-slate-600">{r.branchName}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-[#23151D]">{formatPKR(r.netAmount)}</td>
                        <td className="py-3.5 px-4 text-right text-slate-700">{formatPKR(r.paidAmount)}</td>
                        <td className="py-3.5 px-4 text-right font-semibold text-[#9D2558]">{formatPKR(r.balanceDue)}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FDF2F5] text-[#9D2558] border border-[#F1DEE3]">
                            {r.paymentStatus}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {totals && reportData && reportData.rows.length > 0 && (
                  <tfoot className="bg-[#F8FAFC] font-bold text-[#23151D] border-t-2 border-slate-200 text-[13px]">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">{reportData.rows.length} Purchases</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right text-[#23151D]">{formatPKR(totals.netAmount)}</td>
                      <td className="py-3.5 px-4 text-right">{formatPKR(totals.paidAmount)}</td>
                      <td className="py-3.5 px-4 text-right text-[#9D2558]">{formatPKR(totals.balanceDue)}</td>
                      <td className="py-3.5 px-4">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}

            {activeTab === 'supplier-ledger' && (
              <>
                {selectedSupplierId !== 'ALL' && (
                  <div className="bg-gradient-to-r from-blue-50/90 to-white border border-[#F1DEE3]/90 rounded-xl p-4 mb-4 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <h3 className="text-sm font-bold text-[#23151D]">
                          Single Supplier Khata: {suppliers.find((s) => s.id === selectedSupplierId)?.name || 'Selected Vendor'}
                        </h3>
                        {suppliers.find((s) => s.id === selectedSupplierId)?.companyName && (
                          <span className="text-xs text-slate-500">
                            ({suppliers.find((s) => s.id === selectedSupplierId)?.companyName})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Contact: {suppliers.find((s) => s.id === selectedSupplierId)?.contactPerson || '—'}</span>
                        <span>Phone: {suppliers.find((s) => s.id === selectedSupplierId)?.phone || '—'}</span>
                        <span>Period: {customFrom} to {customTo}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSupplierId('ALL');
                          const query: InventoryReportQuery = {
                            branchId: selectedBranch,
                            type: 'supplier-ledger',
                            preset: selectedPreset,
                            from: customFrom || undefined,
                            to: customTo || undefined,
                            search: searchQuery.trim() || undefined,
                          };
                          fetchReport(query);
                        }}
                        className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                      >
                        View All Suppliers
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/operations/supplier-ledger?supplierId=${selectedSupplierId}`)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Open Operational Khata</span>
                      </button>
                    </div>
                  </div>
                )}

                <table className="report-records w-full text-left border-collapse min-w-[900px] font-['Inter',sans-serif] text-[13px] antialiased">
                  <thead>
                    <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                      <th className="py-3.5 px-4">Date</th>
                      <th className="py-3.5 px-4">Type</th>
                      <th className="py-3.5 px-4">Ref #</th>
                      <th className="py-3.5 px-4">Supplier</th>
                      <th className="py-3.5 px-4 text-right">Debit (Payments)</th>
                      <th className="py-3.5 px-4 text-right">Credit (Bills)</th>
                      <th className="py-3.5 px-4 text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-200">
                    {(!reportData?.rows || reportData.rows.length === 0) ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          No supplier ledger records found for the selected criteria.
                        </td>
                      </tr>
                    ) : (
                      (reportData.rows as InventorySupplierLedgerRow[]).map((r, i) => (
                        <tr key={r.id || i} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                          <td className="py-3.5 px-4 text-slate-600">{r.date}</td>
                          <td className="py-3.5 px-4">
                            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                              {r.entryType}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">{r.referenceNumber}</td>
                          <td className="py-3.5 px-4 font-semibold text-[#23151D]">
                            <button
                              type="button"
                              onClick={() => {
                                if (r.supplierId) {
                                  setSelectedSupplierId(r.supplierId);
                                  const query: InventoryReportQuery = {
                                    branchId: selectedBranch,
                                    type: 'supplier-ledger',
                                    supplierId: r.supplierId,
                                    preset: selectedPreset,
                                    from: customFrom || undefined,
                                    to: customTo || undefined,
                                    search: searchQuery.trim() || undefined,
                                  };
                                  fetchReport(query);
                                }
                              }}
                              className="hover:text-[#9D2558] hover:underline text-left cursor-pointer flex items-center gap-1.5"
                              title="Filter ledger for this single supplier"
                            >
                              <span>{r.supplierName}</span>
                              {selectedSupplierId === 'ALL' && (
                                <span className="text-[10px] text-[#9D2558] bg-[#FDF2F5] border border-[#F1DEE3] px-1.5 py-0.2 rounded font-normal">
                                  Single View
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-700 font-medium">{formatPKR(r.debit)}</td>
                          <td className="py-3.5 px-4 text-right font-medium text-[#9D2558]">{formatPKR(r.credit)}</td>
                          <td className="py-3.5 px-4 text-right font-bold text-[#23151D]">{formatPKR(r.runningBalance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                {totals && reportData && reportData.rows.length > 0 && (
                  <tfoot className="bg-[#F8FAFC] font-bold text-[#23151D] border-t-2 border-slate-200 text-[13px]">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right">{formatPKR(totals.debit)}</td>
                      <td className="py-3.5 px-4 text-right text-[#9D2558]">{formatPKR(totals.credit)}</td>
                      <td className="py-3.5 px-4 text-right text-[#23151D]">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </>
          )}

            {activeTab === 'consumption' && (
              <table className="report-records w-full text-left border-collapse min-w-[900px] font-['Inter',sans-serif] text-[13px] antialiased">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Item & SKU</th>
                    <th className="py-3.5 px-4">Category</th>
                    <th className="py-3.5 px-4 text-right">Consumed Qty</th>
                    <th className="py-3.5 px-4 text-right">Unit Cost</th>
                    <th className="py-3.5 px-4 text-right">Total Material Cost</th>
                    <th className="py-3.5 px-4">Reason / Service</th>
                    <th className="py-3.5 px-4">Issued To / By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200">
                  {(!reportData?.rows || reportData.rows.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        No salon consumption records found for the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    (reportData.rows as InventoryConsumptionRow[]).map((r, i) => (
                      <tr key={r.id || i} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        <td className="py-3.5 px-4 text-slate-600">{r.date}</td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#23151D]">{r.itemName}</div>
                          <div className="text-[10px] font-mono text-slate-400">SKU: {r.sku}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{r.category}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">{r.quantity.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right text-slate-600">{formatPKR(r.unitCost)}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-[#23151D]">{formatPKR(r.totalCost)}</td>
                        <td className="py-3.5 px-4 text-slate-700">{r.reason}</td>
                        <td className="py-3.5 px-4 text-slate-600">{r.userName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {totals && reportData && reportData.rows.length > 0 && (
                  <tfoot className="bg-[#F8FAFC] font-bold text-[#23151D] border-t-2 border-slate-200 text-[13px]">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right">{totals.quantity?.toLocaleString()}</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right text-[#23151D]">{formatPKR(totals.totalCost)}</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}

            {activeTab === 'expiry' && (
              <table className="report-records w-full text-left border-collapse min-w-[900px] font-['Inter',sans-serif] text-[13px] antialiased">
                <thead>
                  <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                    <th className="py-3.5 px-4">Item & SKU</th>
                    <th className="py-3.5 px-4">Batch #</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4">Expiry Date</th>
                    <th className="py-3.5 px-4 text-right">Days Left</th>
                    <th className="py-3.5 px-4 text-right">Remaining Qty</th>
                    <th className="py-3.5 px-4 text-right">Unit Cost</th>
                    <th className="py-3.5 px-4 text-right">Cost At Risk</th>
                    <th className="py-3.5 px-4 text-center">Risk Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-slate-200">
                  {(!reportData?.rows || reportData.rows.length === 0) ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        No batches tracked for expiry in this criteria.
                      </td>
                    </tr>
                  ) : (
                    (reportData.rows as InventoryExpiryRow[]).map((r, i) => (
                      <tr key={`${r.batchNumber}-${i}`} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#23151D]">{r.itemName}</div>
                          <div className="text-[10px] font-mono text-slate-400">SKU: {r.sku}</div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs">{r.batchNumber}</td>
                        <td className="py-3.5 px-4 text-slate-600">{r.branchName}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-700">{r.expiryDate}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          {r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d ago` : `${r.daysRemaining}d`}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-800">
                          {r.remainingQuantity.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-600">{formatPKR(r.unitCost)}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-[#23151D]">{formatPKR(r.costAtRisk)}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FDF2F5] text-[#9D2558] border border-[#F1DEE3]">
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {totals && reportData && reportData.rows.length > 0 && (
                  <tfoot className="bg-[#F8FAFC] font-bold text-[#23151D] border-t-2 border-slate-200 text-[13px]">
                    <tr>
                      <td className="py-3.5 px-4 text-left">Totals</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right">{totals.remainingQuantity?.toLocaleString()}</td>
                      <td className="py-3.5 px-4">—</td>
                      <td className="py-3.5 px-4 text-right text-[#23151D]">{formatPKR(totals.costAtRisk)}</td>
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

export default InventoryReportsPage;
