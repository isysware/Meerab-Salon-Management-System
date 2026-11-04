import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { salonService } from '../../services';
import {
  StaffPerformanceRecord,
  StaffPerformanceServiceItem,
  Branch,
  StaffMember,
  ServiceItem,
  PackageItem,
} from '../../types/salon';
import {
  Award,
  Filter,
  Search,
  Printer,
  Download,
  Eye,
  X,
  FileSpreadsheet,
  FileText,
  Loader2,
  TrendingUp,
  Users,
  Scissors,
  Coins,
  Clock,
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
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium cursor-pointer transition-all';
const inputClass =
  'w-full text-xs rounded-xl border border-white/80 bg-white/80 hover:bg-white px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#B82E69]/20 focus:border-[#B82E69] shadow-2xs font-medium transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';

function formatCurrency(val: number): string {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const StaffPerformancePage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role guard: Super Admin and Branch Admin only. Accountant and Staff denied.
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/reports/staff-performance" />;
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
  const [servicesList, setServicesList] = useState<ServiceItem[]>([]);
  const [packagesList, setPackagesList] = useState<PackageItem[]>([]);

  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState<string>(defaultMonth.from);
  const [endDate, setEndDate] = useState<string>(defaultMonth.to);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('ALL');
  const [selectedPackageId, setSelectedPackageId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Page state: Only fetch when user explicitly clicks Filter ("filter karna sa aae default nhi")
  const [hasFiltered, setHasFiltered] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [performanceRecords, setPerformanceRecords] = useState<StaffPerformanceRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Drilldown Modal State
  const [selectedStaffRecord, setSelectedStaffRecord] = useState<StaffPerformanceRecord | null>(null);
  const [drilldownSearch, setDrilldownSearch] = useState<string>('');
  const [drilldownFilterType, setDrilldownFilterType] = useState<'ALL' | 'SERVICE' | 'PACKAGE_COMPONENT'>('ALL');

  // Load auxiliary data
  useEffect(() => {
    const loadAux = async () => {
      try {
        const branchParam = selectedBranchId || 'ALL';
        const [bList, sList, svcList, pkgList] = await Promise.all([
          allBranches && allBranches.length > 0 ? Promise.resolve(allBranches) : salonService.getBranches(),
          salonService.getStaff(branchParam),
          salonService.getServices(branchParam),
          salonService.getPackages(branchParam),
        ]);
        setBranches(bList);
        setAllStaff(sList);
        setServicesList(svcList);
        setPackagesList(pkgList);
      } catch (err) {
        console.error('Failed to load auxiliary staff performance data', err);
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

  // Load performance report data on demand from backend API
  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const data = await salonService.getStaffPerformanceReport(
        selectedBranchId,
        startDate,
        endDate,
        {
          staffId: selectedStaffId !== 'ALL' ? selectedStaffId : undefined,
          serviceId: selectedServiceId !== 'ALL' ? selectedServiceId : undefined,
          packageId: selectedPackageId !== 'ALL' ? selectedPackageId : undefined,
        },
        user
      );
      setPerformanceRecords(data);
    } catch (err: any) {
      console.error('Failed to load staff performance report', err);
      setErrorMessage(err.message || 'Failed to fetch live staff performance data.');
    } finally {
      setLoading(false);
    }
  }, [
    selectedBranchId,
    startDate,
    endDate,
    selectedStaffId,
    selectedServiceId,
    selectedPackageId,
    user,
  ]);

  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHasFiltered(true);
    fetchReport();
  };

  // Filter records by search query
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return performanceRecords;
    const q = searchQuery.toLowerCase().trim();
    return performanceRecords.filter(
      (r) =>
        r.staffName.toLowerCase().includes(q) ||
        r.staffCode.toLowerCase().includes(q) ||
        r.roleTitle.toLowerCase().includes(q)
    );
  }, [performanceRecords, searchQuery]);

  // Consolidated Aggregated Summary Metrics across active records
  const aggregatedMetrics = useMemo(() => {
    let totalDirectServices = 0;
    let totalPackageComponents = 0;
    let totalUnits = 0;
    let totalUniqueClients = 0;
    let totalGrossSales = 0;
    let totalDiscount = 0;
    let totalNetSales = 0;
    let totalCollectedSales = 0;
    let totalEstimatedCommission = 0;
    let totalFinalizedCommission = 0;
    let totalAllocatedTips = 0;
    let totalPaidTips = 0;
    let totalOutstandingTips = 0;
    let totalWorkedHours = 0;
    let totalOvertimeMinutes = 0;

    filteredRecords.forEach((r) => {
      totalDirectServices += r.directServicesCount;
      totalPackageComponents += r.packageComponentsCount;
      totalUnits += r.totalServiceUnits;
      totalUniqueClients += r.uniqueClientsCount;
      totalGrossSales += r.attributedGrossSales;
      totalDiscount += r.discountAllocation;
      totalNetSales += r.attributedNetSales;
      totalCollectedSales += r.collectedSales ?? 0;
      totalEstimatedCommission += r.estimatedCommission;
      totalFinalizedCommission += r.finalizedCommission;
      totalAllocatedTips += r.allocatedTips;
      totalPaidTips += r.paidTips;
      totalOutstandingTips += r.outstandingTips;
      totalWorkedHours += r.workedHours;
      totalOvertimeMinutes += r.approvedOvertimeMinutes;
    });

    return {
      totalDirectServices,
      totalPackageComponents,
      totalUnits,
      totalUniqueClients,
      totalGrossSales,
      totalDiscount,
      totalNetSales,
      totalCollectedSales,
      totalEstimatedCommission,
      totalFinalizedCommission,
      totalAllocatedTips,
      totalPaidTips,
      totalOutstandingTips,
      totalWorkedHours,
      totalOvertimeMinutes,
    };
  }, [filteredRecords]);

  // Filtered detailed services for drilldown modal
  const filteredDetailedServices = useMemo(() => {
    if (!selectedStaffRecord) return [];
    let items = selectedStaffRecord.detailedServices || [];

    if (drilldownFilterType !== 'ALL') {
      items = items.filter((item) => item.itemType === drilldownFilterType);
    }

    if (drilldownSearch.trim()) {
      const q = drilldownSearch.toLowerCase().trim();
      items = items.filter(
        (item) =>
          item.serviceName.toLowerCase().includes(q) ||
          item.invoiceNumber.toLowerCase().includes(q) ||
          (item.clientName && item.clientName.toLowerCase().includes(q))
      );
    }

    return items;
  }, [selectedStaffRecord, drilldownFilterType, drilldownSearch]);

  // Export Handlers
  const handleExportCSV = () => {
    if (!filteredRecords.length) return;
    const meta: [string, string][] = [
      ['Report', 'Staff Productivity & Performance Reports'],
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      'Staff Code',
      'Staff Name',
      'Role',
      'Branch',
      'Total Units',
      'Direct Services',
      'Package Components',
      'Unique Clients',
      'Gross Sales (PKR)',
      'Discount (PKR)',
      'Invoiced Net Sales (PKR)',
      'Collected Net Sales (PKR)',
      'Earned Collection Commission (PKR)',
      'Finalized Commission (PKR)',
      'Allocated Tips (PKR)',
      'Worked Hours',
      'Overtime Minutes',
    ];

    const rows = [
      ...filteredRecords.map((r) => [
        r.staffCode,
        r.staffName,
        r.roleTitle,
        r.branchName,
        r.totalServiceUnits,
        r.directServicesCount,
        r.packageComponentsCount,
        r.uniqueClientsCount,
        r.attributedGrossSales.toFixed(2),
        r.discountAllocation.toFixed(2),
        r.attributedNetSales.toFixed(2),
        (r.collectedSales ?? 0).toFixed(2),
        r.estimatedCommission.toFixed(2),
        r.finalizedCommission.toFixed(2),
        r.allocatedTips.toFixed(2),
        r.workedHours,
        r.approvedOvertimeMinutes,
      ]),
      [
        'TOTALS',
        '',
        '',
        '',
        aggregatedMetrics.totalUnits,
        aggregatedMetrics.totalDirectServices,
        aggregatedMetrics.totalPackageComponents,
        aggregatedMetrics.totalUniqueClients,
        aggregatedMetrics.totalGrossSales.toFixed(2),
        aggregatedMetrics.totalDiscount.toFixed(2),
        aggregatedMetrics.totalNetSales.toFixed(2),
        aggregatedMetrics.totalCollectedSales.toFixed(2),
        aggregatedMetrics.totalEstimatedCommission.toFixed(2),
        aggregatedMetrics.totalFinalizedCommission.toFixed(2),
        aggregatedMetrics.totalAllocatedTips.toFixed(2),
        aggregatedMetrics.totalWorkedHours,
        aggregatedMetrics.totalOvertimeMinutes,
      ],
    ];

    downloadReportCsv(`Staff_Performance_${startDate}_${endDate}.csv`, meta, [
      { title: 'Performance Summary', headers, rows },
    ]);
  };

  const handleExportExcel = () => {
    if (!filteredRecords.length) return;
    const meta: [string, string][] = [
      ['Report', 'Staff Productivity & Performance Reports'],
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      'Staff Code',
      'Staff Name',
      'Role',
      'Branch',
      'Total Units',
      'Direct Services',
      'Package Components',
      'Unique Clients',
      'Gross Sales (PKR)',
      'Discount (PKR)',
      'Invoiced Net Sales (PKR)',
      'Collected Net Sales (PKR)',
      'Earned Collection Commission (PKR)',
      'Finalized Commission (PKR)',
      'Allocated Tips (PKR)',
      'Worked Hours',
      'Overtime Minutes',
    ];

    const rows = [
      ...filteredRecords.map((r) => [
        r.staffCode,
        r.staffName,
        r.roleTitle,
        r.branchName,
        r.totalServiceUnits,
        r.directServicesCount,
        r.packageComponentsCount,
        r.uniqueClientsCount,
        r.attributedGrossSales.toFixed(2),
        r.discountAllocation.toFixed(2),
        r.attributedNetSales.toFixed(2),
        (r.collectedSales ?? 0).toFixed(2),
        r.estimatedCommission.toFixed(2),
        r.finalizedCommission.toFixed(2),
        r.allocatedTips.toFixed(2),
        r.workedHours,
        r.approvedOvertimeMinutes,
      ]),
      [
        'TOTALS',
        '',
        '',
        '',
        aggregatedMetrics.totalUnits,
        aggregatedMetrics.totalDirectServices,
        aggregatedMetrics.totalPackageComponents,
        aggregatedMetrics.totalUniqueClients,
        aggregatedMetrics.totalGrossSales.toFixed(2),
        aggregatedMetrics.totalDiscount.toFixed(2),
        aggregatedMetrics.totalNetSales.toFixed(2),
        aggregatedMetrics.totalCollectedSales.toFixed(2),
        aggregatedMetrics.totalEstimatedCommission.toFixed(2),
        aggregatedMetrics.totalFinalizedCommission.toFixed(2),
        aggregatedMetrics.totalAllocatedTips.toFixed(2),
        aggregatedMetrics.totalWorkedHours,
        aggregatedMetrics.totalOvertimeMinutes,
      ],
    ];

    downloadReportExcel(`Staff_Performance_${startDate}_${endDate}.csv`, meta, [
      { title: 'Performance Summary', headers, rows },
    ]);
  };

  const handlePrint = () => {
    if (!filteredRecords.length) return;
    const meta: [string, string][] = [
      ['Branch', branchNameDisplay],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Generated By', user.name],
    ];

    const headers = [
      '#',
      'Employee',
      'Branch',
      'Units',
      'Clients',
      'Invoiced Net Sales',
      'Collected Net Sales',
      'Commission',
      'Tips',
      'Worked Hours',
    ];

    const rows = filteredRecords.map((r, i) => [
      i + 1,
      `${r.staffName} (${r.staffCode})`,
      r.branchName,
      `${r.totalServiceUnits} (${r.directServicesCount} dir / ${r.packageComponentsCount} pkg)`,
      r.uniqueClientsCount,
      formatCurrency(r.attributedNetSales),
      formatCurrency(r.collectedSales ?? 0),
      formatCurrency(r.estimatedCommission),
      formatCurrency(r.allocatedTips),
      `${r.workedHours}h (OT ${r.approvedOvertimeMinutes}m)`,
    ]);

    const footers = [
      'TOTALS',
      '',
      '',
      `${aggregatedMetrics.totalUnits} Units`,
      aggregatedMetrics.totalUniqueClients,
      formatCurrency(aggregatedMetrics.totalNetSales),
      formatCurrency(aggregatedMetrics.totalCollectedSales),
      formatCurrency(aggregatedMetrics.totalEstimatedCommission),
      formatCurrency(aggregatedMetrics.totalAllocatedTips),
      `${aggregatedMetrics.totalWorkedHours}h`,
    ];

    printReportWindow({
      title: 'Staff Productivity & Performance Report',
      subtitle: `Attributed Sales Velocity & Commission Analysis`,
      meta,
      headers,
      rows,
      totals: footers,
    });
  };

  const handleExportDrilldownCSV = () => {
    if (!selectedStaffRecord || !filteredDetailedServices.length) return;
    let csv = `STAFF SERVICE DETAIL: ${selectedStaffRecord.staffName} (${selectedStaffRecord.staffCode})\n`;
    csv += `Scope: ${selectedStaffRecord.branchName}\n`;
    csv += `Period: ${startDate} to ${endDate}\n`;
    csv += `Generated On: ${new Date().toLocaleString()}\n\n`;

    csv += 'Date,Time,Invoice #,Type,Item Name,Client Name,Gross Price,Discount,Attributed Net,Commission Est,Tip Alloc\n';
    filteredDetailedServices.forEach((item) => {
      csv += `"${item.date}","${item.time || ''}","${item.invoiceNumber}","${item.itemType}","${item.serviceName}","${item.clientName || '-'}","${item.cataloguePrice}","${item.discountAllocated}","${item.netSales}","${item.commissionEarned}","0"\n`;
    });

    const encodedUri = encodeURI('data:text/csv;charset=utf-8,' + csv);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Staff_Detail_${selectedStaffRecord.staffCode}_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full space-y-6 text-slate-800 font-sans">
      {/* ── 1. TOP HEADER BANNER (Frosted Glassmorphism) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#B82E69]/10 via-[#D94883]/5 to-transparent blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white shadow-lg shadow-[#B82E69]/25">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#18191B]">
                  Staff Productivity & Performance Reports
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-[#B82E69]/20 uppercase tracking-wider">
                  Attributed Sales
                </span>
              </div>
              <p className="text-xs text-[#78616C] font-medium mt-0.5">
                Staff productivity audit: Direct & package service units, net revenue attribution, earned commission and tip allocations
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. FILTER CARD (Frosted Glass) ── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 p-5 md:p-6 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <form onSubmit={handleApplyFilters}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
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

            {/* Staff */}
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
                    {s.name} ({s.employeeCode || s.id.slice(-4)})
                  </option>
                ))}
              </select>
            </div>

            {/* Catalogue Filter */}
            <div>
              <label className={labelClass}>Catalogue Item</label>
              <select
                className={selectClass}
                value={
                  selectedServiceId !== 'ALL'
                    ? `svc:${selectedServiceId}`
                    : selectedPackageId !== 'ALL'
                    ? `pkg:${selectedPackageId}`
                    : 'ALL'
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'ALL') {
                    setSelectedServiceId('ALL');
                    setSelectedPackageId('ALL');
                  } else if (val.startsWith('svc:')) {
                    setSelectedServiceId(val.replace('svc:', ''));
                    setSelectedPackageId('ALL');
                  } else if (val.startsWith('pkg:')) {
                    setSelectedPackageId(val.replace('pkg:', ''));
                    setSelectedServiceId('ALL');
                  }
                }}
              >
                <option value="ALL">All Services & Packages</option>
                <optgroup label="Direct Services">
                  {servicesList.map((svc) => (
                    <option key={svc.id} value={`svc:${svc.id}`}>
                      {svc.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Bundled Packages">
                  {packagesList.map((pkg) => (
                    <option key={pkg.id} value={`pkg:${pkg.id}`}>
                      {pkg.name}
                    </option>
                  ))}
                </optgroup>
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

            {/* Search Query */}
            <div>
              <label className={labelClass}>Search</label>
              <input
                type="text"
                placeholder="Code, name, role..."
                className={inputClass}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Filter Button */}
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

      {/* ── 3. ROW 3 PURE WHITE FROSTED BLUR KPI CARDS (when filtered) ── */}
      {hasFiltered && filteredRecords.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Invoiced Net Sales */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-emerald-600">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Attributed Sales
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                PKR {formatCurrency(aggregatedMetrics.totalNetSales)}
                      <span className="block text-xs text-emerald-700">Collected: PKR {formatCurrency(aggregatedMetrics.totalCollectedSales)}</span>
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Gross: PKR {formatCurrency(aggregatedMetrics.totalGrossSales)}
              </span>
            </div>
          </div>

          {/* Card 2: Total Service Units */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-blue-600">
                <Scissors className="w-4 h-4" />
              </div>
              <span className="bg-blue-50 text-blue-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Volume
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                {aggregatedMetrics.totalUnits} Units
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                {aggregatedMetrics.totalDirectServices} direct · {aggregatedMetrics.totalPackageComponents} package
              </span>
            </div>
          </div>

          {/* Card 3: Unique Clients */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-purple-600">
                <Users className="w-4 h-4" />
              </div>
              <span className="bg-purple-50 text-purple-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Clients
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
                {aggregatedMetrics.totalUniqueClients}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Total unique clients served
              </span>
            </div>
          </div>

          {/* Card 4: Commissions */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
                <Coins className="w-4 h-4" />
              </div>
              <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Commission
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-[#B82E69] font-mono tabular-nums tracking-tight block">
                PKR {formatCurrency(aggregatedMetrics.totalEstimatedCommission)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Finalized: PKR {formatCurrency(aggregatedMetrics.totalFinalizedCommission)}
              </span>
            </div>
          </div>

          {/* Card 5: Gratuities & Tips */}
          <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-amber-600">
                <Clock className="w-4 h-4" />
              </div>
              <span className="bg-amber-50 text-amber-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                Gratuities
              </span>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono tabular-nums tracking-tight block">
                PKR {formatCurrency(aggregatedMetrics.totalAllocatedTips)}
              </span>
              <span className="text-xs text-[#78616C] font-medium mt-1 block">
                Hours: {aggregatedMetrics.totalWorkedHours}h (OT: {aggregatedMetrics.totalOvertimeMinutes}m)
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
            Select a branch, staff, or date range above, then click &ldquo;Apply Filters&rdquo; to load staff performance calculations.
          </p>
        </div>
      ) : loading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 p-16 flex flex-col items-center justify-center min-h-[380px] backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FDF2F5] border border-white/80 flex items-center justify-center text-[#B82E69] mb-4 shadow-sm animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#B82E69]" />
          </div>
          <p className="text-sm font-bold text-[#18191B]">Calculating Staff Performance Metrics...</p>
          <p className="text-xs text-[#78616C] mt-0.5">Aggregating attributed services and commissions from server</p>
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
          {/* Header Bar */}
          <div className="px-6 py-4 border-b border-white/80 bg-white/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-bold text-sm tracking-tight text-[#18191B]">
              <Award className="w-4 h-4 text-[#B82E69]" />
              <span>Staff Productivity & Performance ({filteredRecords.length} staff members)</span>
            </div>

            {/* Export Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs font-semibold transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
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
            <table className="report-records w-full min-w-[1300px] text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                  <th className="py-3 px-3 text-center w-8">#</th>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4 text-center">Units (Dir / Pkg)</th>
                  <th className="py-3 px-4 text-center">Clients</th>
                  <th className="py-3 px-4 text-right">Invoiced / Collected Net Sales</th>
                  <th className="py-3 px-4 text-right">Commission (Est / Fin)</th>
                  <th className="py-3 px-4 text-right">Tips (Alloc / Due)</th>
                  <th className="py-3 px-4 text-center">Worked Hours</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center text-slate-400 font-medium">
                      No staff performance records found for the selected criteria.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record, idx) => (
                    <tr
                      key={record.staffId}
                      className="hover:bg-[#FDF2F5]/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedStaffRecord(record)}
                    >
                      <td className="py-3 px-3 text-center text-slate-400 font-mono">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{record.staffName}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-slate-100 text-slate-600">
                            {record.staffCode}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">{record.roleTitle}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {record.branchName}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-semibold text-slate-900 font-mono">{record.totalServiceUnits}</div>
                        <div className="text-[11px] text-slate-400">
                          {record.directServicesCount} dir · {record.packageComponentsCount} pkg
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-semibold text-slate-800 font-mono">
                        {record.uniqueClientsCount}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-semibold text-slate-900 font-mono tabular-nums">PKR {formatCurrency(record.attributedNetSales)}</div>
                        <div className="text-xs text-emerald-700">Collected: PKR {formatCurrency(record.collectedSales ?? 0)}</div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          Gross: PKR {formatCurrency(record.attributedGrossSales)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-bold text-emerald-600 font-mono tabular-nums">PKR {formatCurrency(record.estimatedCommission)}</div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          Fin: PKR {formatCurrency(record.finalizedCommission)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-semibold text-slate-900 font-mono tabular-nums">PKR {formatCurrency(record.allocatedTips)}</div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          Due: PKR {formatCurrency(record.outstandingTips)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-semibold text-slate-900 font-mono">
                          {record.workedHours}h
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          OT: {record.approvedOvertimeMinutes}m
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStaffRecord(record);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FDF2F5] text-[#B82E69] hover:bg-[#FCE8EC] font-semibold text-xs transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Drilldown</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredRecords.length > 0 && (
                <tfoot className="border-t-2 border-slate-200/80 bg-white/90 text-xs font-bold text-slate-800">
                  <tr>
                    <td colSpan={3} className="py-3.5 px-4 text-right uppercase tracking-wider">
                      TOTALS:
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono">
                      {aggregatedMetrics.totalUnits}
                      <div className="text-[10px] font-normal text-slate-400">
                        ({aggregatedMetrics.totalDirectServices} dir / {aggregatedMetrics.totalPackageComponents} pkg)
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono">{aggregatedMetrics.totalUniqueClients}</td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                      PKR {formatCurrency(aggregatedMetrics.totalNetSales)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-emerald-600">
                      PKR {formatCurrency(aggregatedMetrics.totalEstimatedCommission)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                      PKR {formatCurrency(aggregatedMetrics.totalAllocatedTips)}
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-600 font-mono">
                      OT: {aggregatedMetrics.totalOvertimeMinutes}m
                    </td>
                    <td className="py-3.5 px-4"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Employee Service Drilldown Modal (Frosted Glass) */}
      {selectedStaffRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="rounded-[24px] border border-white/90 bg-white/95 p-6 backdrop-blur-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-[0_20px_50px_rgba(0,0,0,0.15),inset_0_1.5px_2px_rgba(255,255,255,1)] animate-in fade-in zoom-in-95 duration-150 overflow-y-auto overscroll-contain">
            {/* Modal Header */}
            <div className="pb-5 border-b border-slate-100 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-[#FDF2F5] text-[#B82E69] rounded-2xl shadow-2xs border border-white/80">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-[#18191B] tracking-tight">
                      {selectedStaffRecord.staffName}
                    </h3>
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {selectedStaffRecord.staffCode}
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#FDF2F5] text-[#B82E69] font-bold border border-[#B82E69]/20">
                      {selectedStaffRecord.branchName}
                    </span>
                  </div>
                  <p className="text-xs text-[#78616C] mt-0.5">
                    {selectedStaffRecord.roleTitle} · Detailed Service Ledger ({startDate} to {endDate})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportDrilldownCSV}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/80 bg-white text-slate-700 shadow-2xs text-xs font-semibold hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#B82E69]" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStaffRecord(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Filters */}
            <div className="py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrilldownFilterType('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    drilldownFilterType === 'ALL'
                      ? 'bg-[#B82E69] text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Items ({selectedStaffRecord.detailedServices.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDrilldownFilterType('SERVICE')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    drilldownFilterType === 'SERVICE'
                      ? 'bg-[#B82E69] text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Direct Services
                </button>
                <button
                  type="button"
                  onClick={() => setDrilldownFilterType('PACKAGE_COMPONENT')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    drilldownFilterType === 'PACKAGE_COMPONENT'
                      ? 'bg-[#B82E69] text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Package Components
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter drilldown items..."
                  className={`${inputClass} pl-8.5 w-60`}
                  value={drilldownSearch}
                  onChange={(e) => setDrilldownSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Modal Table */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full min-w-[850px] text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#FDF2F5]/50 text-slate-600 font-bold">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Invoice #</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3">Client</th>
                    <th className="py-2.5 px-3 text-right">Price</th>
                    <th className="py-2.5 px-3 text-right">Discount</th>
                    <th className="py-2.5 px-3 text-right">Collected Net</th>
                    <th className="py-2.5 px-3 text-right">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDetailedServices.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                        No service records found.
                      </td>
                    </tr>
                  ) : (
                    filteredDetailedServices.map((item, idx) => (
                      <tr key={idx} className="hover:bg-[#FDF2F5]/30 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-slate-600">{item.date}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#B82E69]">{item.invoiceNumber}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.itemType === 'SERVICE'
                                ? 'bg-[#FDF2F5] text-[#B82E69]'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {item.itemType === 'SERVICE' ? 'Direct' : 'Package'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{item.serviceName}</td>
                        <td className="py-2.5 px-3 text-slate-700">{item.clientName || 'Walk-in'}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">{formatCurrency(item.cataloguePrice)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">{formatCurrency(item.discountAllocated)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#18191B]">{formatCurrency(item.netSales)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-600">{formatCurrency(item.commissionEarned)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffPerformancePage;
