import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { Invoice, PaymentAccount, POSPaymentEntry } from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { ReceiptModal } from '@/features/pos/ReceiptModal';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/context/ToastContext';
import {
  downloadReportCsv,
  downloadReportExcel,
  printReportWindow,
} from '@/features/reports/reportUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Filter,
  FileSpreadsheet,
  FileText,
  Printer,
  CreditCard,
  Banknote,
  Receipt,
  Phone,
  RefreshCw,
  Coins,
  CheckCircle2,
} from 'lucide-react';

const selectClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const inputClass =
  'w-full text-xs border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558] focus:border-[#9D2558] transition-colors';
const labelClass = 'block text-[11px] font-semibold text-[#23151D] mb-1.5';

const formatPKR = (amt: number) => {
  const num = Number(amt) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const UnpaidInvoicesPage: React.FC = () => {
  const { user, activeBranchId, allBranches, demoDate } = useAuth();

  // Role guard: Super Admin, Admin, and Accountant
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/reports/unpaid-invoices" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  // Filters State
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSuperAdmin ? (activeBranchId || 'ALL') : (user.branchId || '')
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPAID' | 'PARTIAL'>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Collect Payment Modal state
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [collectMethod, setCollectMethod] = useState<'CASH' | 'ONLINE'>('CASH');
  const [collectAmount, setCollectAmount] = useState<number>(0);
  const [isPartialMode, setIsPartialMode] = useState<boolean>(false);
  const [selectedOnlineAccountId, setSelectedOnlineAccountId] = useState<string>('');
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectionIdempotencyKey, setCollectionIdempotencyKey] = useState<string>('');

  // Receipt Modal state
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchScope = selectedBranch && selectedBranch !== 'ALL' ? selectedBranch : 'ALL';
      const [allInvs, allAccs] = await Promise.all([
        salonService.getInvoices(branchScope),
        salonService.getPaymentAccounts(branchScope),
      ]);
      // Only invoices with pending receivable balances
      const unpaidList = allInvs.filter((inv) => inv.amountDue > 0 && inv.status !== 'PAID');
      setInvoices(unpaidList);
      const activeAccs = allAccs.filter((a) => a.isActive);
      setPaymentAccounts(activeAccs);
      if (activeAccs.length > 0) {
        setSelectedOnlineAccountId(activeAccs[0].id);
      }
    } catch (err) {
      console.error('Failed to load unpaid invoices:', err);
      toast.error('Failed to load unpaid receivables.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    loadData();
  }, [loadData, demoDate]);

  const getBranchName = useCallback((bId: string) => {
    return allBranches.find((b) => b.id === bId)?.name || bId;
  }, [allBranches]);

  // Filtered unpaid invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Branch check
      if (selectedBranch !== 'ALL' && inv.branchId !== selectedBranch) {
        return false;
      }

      // Search check
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesQuery =
          inv.invoiceNumber.toLowerCase().includes(q) ||
          inv.clientName.toLowerCase().includes(q) ||
          (inv.clientPhone && inv.clientPhone.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }

      // Status check
      if (statusFilter === 'UNPAID') {
        if (inv.amountPaid > 0) return false;
      } else if (statusFilter === 'PARTIAL') {
        if (inv.amountPaid <= 0) return false;
      }

      // Date Range check
      if (fromDate && inv.date < fromDate) return false;
      if (toDate && inv.date > toDate) return false;

      return true;
    });
  }, [invoices, selectedBranch, searchQuery, statusFilter, fromDate, toDate]);

  // Totals calculations
  const totals = useMemo(() => {
    let billTotal = 0;
    let amountPaid = 0;
    let amountDue = 0;

    for (const inv of filteredInvoices) {
      billTotal += inv.netSales + (inv.tax || 0);
      amountPaid += inv.amountPaid || 0;
      amountDue += inv.amountDue || 0;
    }

    return { billTotal, amountPaid, amountDue };
  }, [filteredInvoices]);

  // Export CSV
  const handleExportCsv = () => {
    if (!filteredInvoices.length) {
      toast.info('No unpaid records to export.');
      return;
    }
    const meta: [string, string][] = [
      ['Report', 'Unpaid Invoices & Receivables Statement'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : getBranchName(selectedBranch)],
      ['From Date', fromDate || 'Beginning'],
      ['To Date', toDate || 'Present'],
      ['Total Outstanding Receivables', `PKR ${formatPKR(totals.amountDue)}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Sale Date',
      'Client',
      'Phone',
      'Branch',
      'Bill Total (PKR)',
      'Paid So Far (PKR)',
      'Balance Due (PKR)',
      'Status',
    ];

    const rows = filteredInvoices.map((inv, idx) => [
      idx + 1,
      inv.invoiceNumber,
      inv.date,
      inv.clientName || 'Walk-in',
      inv.clientPhone || '—',
      getBranchName(inv.branchId),
      (inv.netSales + (inv.tax || 0)).toFixed(2),
      (inv.amountPaid || 0).toFixed(2),
      inv.amountDue.toFixed(2),
      inv.status,
    ]);

    downloadReportCsv('Unpaid_Invoices_Report', meta, [{ headers, rows }]);
  };

  // Export Excel
  const handleExportExcel = () => {
    if (!filteredInvoices.length) {
      toast.info('No unpaid records to export.');
      return;
    }
    const meta: [string, string][] = [
      ['Report', 'Unpaid Invoices & Receivables Statement'],
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : getBranchName(selectedBranch)],
      ['From Date', fromDate || 'Beginning'],
      ['To Date', toDate || 'Present'],
      ['Total Outstanding Receivables', `PKR ${formatPKR(totals.amountDue)}`],
      ['Generated At', new Date().toLocaleString()],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Sale Date',
      'Client',
      'Phone',
      'Branch',
      'Bill Total (PKR)',
      'Paid So Far (PKR)',
      'Balance Due (PKR)',
      'Status',
    ];

    const rows = filteredInvoices.map((inv, idx) => [
      idx + 1,
      inv.invoiceNumber,
      inv.date,
      inv.clientName || 'Walk-in',
      inv.clientPhone || '—',
      getBranchName(inv.branchId),
      (inv.netSales + (inv.tax || 0)).toFixed(2),
      (inv.amountPaid || 0).toFixed(2),
      inv.amountDue.toFixed(2),
      inv.status,
    ]);

    downloadReportExcel('Unpaid_Invoices_Report', meta, [{ headers, rows }]);
  };

  // Print Window
  const handlePrint = () => {
    if (!filteredInvoices.length) {
      window.print();
      return;
    }
    const meta: [string, string][] = [
      ['Branch', selectedBranch === 'ALL' ? 'All Branches' : getBranchName(selectedBranch)],
      ['From Date', fromDate || 'Beginning'],
      ['To Date', toDate || 'Present'],
      ['Total Pending Invoices', String(filteredInvoices.length)],
      ['Total Receivable Balance', `PKR ${formatPKR(totals.amountDue)}`],
    ];

    const headers = [
      '#',
      'Invoice #',
      'Date',
      'Client',
      'Branch',
      'Bill Total',
      'Paid',
      'Balance Due',
      'Status',
    ];

    const rows = filteredInvoices.map((inv, idx) => [
      idx + 1,
      inv.invoiceNumber,
      inv.date,
      `${inv.clientName || 'Walk-in'} ${inv.clientPhone ? `(${inv.clientPhone})` : ''}`,
      getBranchName(inv.branchId),
      formatPKR(inv.netSales + (inv.tax || 0)),
      formatPKR(inv.amountPaid || 0),
      formatPKR(inv.amountDue),
      inv.status,
    ]);

    printReportWindow({
      title: 'Unpaid Invoices & Receivables Statement',
      meta,
      headers,
      rows,
    });
  };

  // Open Collect Modal
  const handleOpenCollect = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setCollectAmount(inv.amountDue);
    setIsPartialMode(false);
    setCollectMethod('CASH');

    const key = `COLLECT-${inv.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setCollectionIdempotencyKey(key);

    // Find accounts for this invoice's branch
    const branchAccs = paymentAccounts.filter(
      (a) => (a.branchIds ?? [a.branchId]).includes(inv.branchId) && a.isActive
    );
    if (branchAccs.length > 0) {
      setSelectedOnlineAccountId(branchAccs[0].id);
    }

    setIsCollectModalOpen(true);
  };

  // Submit collection
  const handleSubmitCollection = async () => {
    if (!selectedInvoice || isCollecting) return;
    setIsCollecting(true);

    try {
      const paymentAmount = Math.max(0, collectAmount);
      if (paymentAmount <= 0) {
        throw new Error('Please enter a collection amount greater than 0.');
      }
      if (paymentAmount > selectedInvoice.amountDue) {
        throw new Error(`Collection amount cannot exceed outstanding balance (${formatCurrency(selectedInvoice.amountDue)}).`);
      }

      const payments: POSPaymentEntry[] = [];

      if (collectMethod === 'CASH') {
        payments.push({
          method: 'CASH',
          amount: paymentAmount,
          billAllocation: paymentAmount,
          tipAllocation: 0,
          cashTendered: paymentAmount,
          changeReturned: 0,
        });
      } else {
        const acc = paymentAccounts.find((a) => a.id === selectedOnlineAccountId);
        if (!acc) {
          throw new Error('Please select an active payment account.');
        }
        payments.push({
          method: 'ONLINE_ACCOUNT',
          paymentAccountId: acc.id,
          paymentAccountName: `${acc.name} (${acc.accountIdentifier})`,
          amount: paymentAmount,
          billAllocation: paymentAmount,
          tipAllocation: 0,
        });
      }

      const updated = await salonService.collectInvoicePayment(
        {
          invoiceId: selectedInvoice.id,
          payments,
          idempotencyKey: collectionIdempotencyKey,
          notes: `Receivable collection for ${selectedInvoice.invoiceNumber}`,
        },
        user
      );

      // Successfully collected
      setIsCollectModalOpen(false);
      setReceiptInvoice(updated);
      setIsReceiptOpen(true);
      toast.success('Payment collected and invoice settled successfully!');
      await loadData();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('refresh-notifications'));
      }
    } catch (err: any) {
      console.error('Failed to collect payment:', err);
      const msg = err.message || 'Payment collection failed.';
      toast.error(msg);
    } finally {
      setIsCollecting(false);
    }
  };

  return (
    <div className="w-full text-slate-800">
      {/* ── 1. TOP HEADER CARD WITH TITLE & FILTERS (MATCHING SALES INVOICES STYLE) ── */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200/90 p-5 md:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-[#23151D] tracking-tight">Unpaid Invoices & Receivables</h1>
            <p className="text-xs text-slate-500 mt-1">
              Complete receivables ledger: follow up customer balances, record payments into cashier drawers, and settle outstanding bills
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 self-start sm:self-center transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#9D2558]' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Filters Form Row */}
        <form onSubmit={(e) => { e.preventDefault(); }} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5 items-end">
          {/* Branch Filter */}
          <div>
            <label className={labelClass}>Branch</label>
            <Select
              value={selectedBranch}
              disabled={!isSuperAdmin}
              onValueChange={(val) => setSelectedBranch(val)}
            >
              <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                {isSuperAdmin && <SelectItem value="ALL">All Branches</SelectItem>}
                {allBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search Query */}
          <div>
            <label className={labelClass}>Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Client, phone, invoice #..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${inputClass} pl-8 h-9`}
              />
            </div>
          </div>

          {/* Pay Status Filter */}
          <div>
            <label className={labelClass}>Pay Status</label>
            <Select
              value={statusFilter}
              onValueChange={(val: any) => setStatusFilter(val)}
            >
              <SelectTrigger className="w-full text-xs h-9 border border-slate-300 rounded-md bg-white text-slate-700 font-medium">
                <SelectValue placeholder="Pay Status" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Pending (Unpaid & Partial)</SelectItem>
                <SelectItem value="UNPAID">Unpaid Only</SelectItem>
                <SelectItem value="PARTIAL">Partially Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
        </form>
      </div>

      {/* ── 2. MAIN TABLE REGISTER CARD (ROYAL BERRY BANNER & CRISP REPORT ROWS) ── */}
      <div className="shadow-sm rounded-xl overflow-hidden border border-slate-200/90 mb-8 bg-white">
        {/* Royal Berry Banner Header */}
        <div className="bg-[#9D2558] text-white px-5 py-3 flex flex-wrap items-center justify-between gap-3 rounded-t-xl">
          <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
            <Receipt className="w-4 h-4 stroke-[2.5]" />
            <span>Unpaid Receivables Register</span>
            <span className="text-[11px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full ml-1">
              {filteredInvoices.length} Pending
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="bg-[#009688] hover:bg-[#00897B] active:bg-[#00796B] text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B] text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="bg-[#4B5563] hover:bg-[#374151] active:bg-[#1F2937] text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Table Container */}
        <div className="bg-white overflow-x-auto rounded-b-xl border-t border-[#F1DEE3]/40">
          <table className="report-records w-full min-w-[1100px] text-left border-collapse font-['Inter',sans-serif] text-[13px] antialiased">
            <thead>
              <tr className="bg-[#FDF2F5] border-b border-[#F1DEE3] text-[#475569] font-medium text-[13px]">
                <th className="py-3.5 px-4 text-center w-12 font-medium text-[#475569]">#</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] whitespace-nowrap">Invoice #</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] whitespace-nowrap">Sale Date</th>
                <th className="py-3.5 px-4 font-medium text-[#475569]">Client</th>
                <th className="py-3.5 px-4 font-medium text-[#475569]">Branch</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Bill Total</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Paid So Far</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] text-right whitespace-nowrap">Balance Due</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] text-center w-24">Status</th>
                <th className="py-3.5 px-4 font-medium text-[#475569] text-center w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-500 font-medium">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-8 h-8 rounded-full border-2 border-[#F1DEE3] border-t-[#9D2558] animate-spin mb-2" />
                      <span>Loading unpaid receivables...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400 font-medium">
                    No outstanding unpaid invoices found. All client balances are fully reconciled!
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv, idx) => {
                  const billTotal = inv.netSales + (inv.tax || 0);
                  const isPartial = inv.status === 'PARTIAL' || (inv.amountPaid > 0 && inv.amountDue > 0);

                  return (
                    <tr key={inv.id} className="hover:bg-[#FDF2F5]/20 transition-colors border-b border-dashed border-slate-200">
                      {/* 1. # */}
                      <td className="py-3.5 px-4 text-center font-normal text-slate-500 text-[13px]">
                        {idx + 1}
                      </td>

                      {/* 2. Invoice # */}
                      <td className="py-3.5 px-4 font-semibold whitespace-nowrap text-[13px]">
                        <span className="text-[#9D2558]">{inv.invoiceNumber}</span>
                      </td>

                      {/* 3. Sale Date */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] text-[13px]">
                        <div className="leading-tight">
                          <div className="font-medium text-slate-800">{inv.date}</div>
                          {inv.time && <div className="text-[11px] text-slate-400">{inv.time}</div>}
                        </div>
                      </td>

                      {/* 4. Client */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#334155] text-[13px]">
                        <div className="leading-tight">
                          <div className="font-semibold text-slate-900">{inv.clientName || 'Walk-in'}</div>
                          {inv.clientPhone && (
                            <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
                              <Phone className="w-2.5 h-2.5 text-slate-400" />
                              <span>{inv.clientPhone}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 5. Branch */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#475569] text-[13px]">
                        {getBranchName(inv.branchId)}
                      </td>

                      {/* 6. Bill Total */}
                      <td className="py-3.5 px-4 text-right tabular-nums font-medium text-slate-700 whitespace-nowrap text-[13px]">
                        {formatCurrency(billTotal)}
                      </td>

                      {/* 7. Paid So Far */}
                      <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap text-[13px]">
                        {formatCurrency(inv.amountPaid || 0)}
                      </td>

                      {/* 8. Balance Due */}
                      <td className="py-3.5 px-4 text-right tabular-nums font-bold text-rose-600 whitespace-nowrap text-[13px]">
                        {formatCurrency(inv.amountDue)}
                      </td>

                      {/* 9. Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold shadow-2xs ${
                          isPartial
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-rose-100 text-rose-800 border border-rose-200'
                        }`}>
                          {isPartial ? 'PARTIAL' : 'UNPAID'}
                        </span>
                      </td>

                      {/* 10. Action */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenCollect(inv)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-[#9D2558] text-white hover:bg-[#851C47] transition-all shadow-2xs cursor-pointer active:scale-95"
                        >
                          <Coins className="w-3.5 h-3.5" />
                          <span>Collect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Integrated Table Footer */}
            <tfoot className="bg-[#F8FAFC] border-t-2 border-slate-200 font-['Inter',sans-serif] text-[13px]">
              <tr className="border-b border-slate-200/70">
                <td colSpan={5} className="py-3.5 px-4 text-right font-bold text-slate-800 tracking-wide">
                  TOTALS (PKR)
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold text-slate-800">
                  {formatCurrency(totals.billTotal)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold text-[#10B981]">
                  +{formatCurrency(totals.amountPaid)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold text-[#EF4444]">
                  {formatCurrency(totals.amountDue)}
                </td>
                <td colSpan={2} className="py-3.5 px-4"></td>
              </tr>
              <tr>
                <td colSpan={5} className="py-3 px-4 text-right font-medium text-slate-700">
                  Total Outstanding Receivables
                </td>
                <td colSpan={3} className="py-3 px-4 text-right tabular-nums font-bold text-rose-600 text-sm">
                  {formatCurrency(totals.amountDue)}
                </td>
                <td colSpan={2} className="py-3.5 px-4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="text-center py-4 text-xs text-slate-400 font-medium tracking-wide">
        © iSysware Management System
      </div>

      {/* ── 3. COLLECT PAYMENT MODAL (SIMPLIFIED OUTSTANDING RECEIVABLE) ── */}
      <Dialog open={isCollectModalOpen} onOpenChange={setIsCollectModalOpen}>
        <DialogContent className="max-w-md font-sans p-5 space-y-4 rounded-2xl bg-white shadow-xl border border-slate-200">
          <DialogHeader className="pb-2 border-b border-slate-100">
            <div className="flex items-center justify-between pr-4">
              <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-600" />
                Collect Outstanding Receivable
              </DialogTitle>
              <Badge variant="neutral" className="text-xs font-mono bg-[#FDF2F5] text-[#9D2558] border-[#F1DEE3] font-bold px-2 py-0.5">
                {selectedInvoice?.invoiceNumber}
              </Badge>
            </div>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Record customer payment against Invoice {selectedInvoice?.invoiceNumber}.
            </DialogDescription>
          </DialogHeader>

          {/* Form Content */}
          {selectedInvoice && (
            <div className="space-y-4 text-xs">
              {/* Customer & Outstanding Balance Card */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-rose-50/70 via-white to-rose-50/30 border border-rose-100 flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Customer</span>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">
                    {selectedInvoice.clientName}
                  </div>
                  {selectedInvoice.clientPhone && (
                    <span className="text-xs text-slate-500 font-mono block mt-0.5">
                      {selectedInvoice.clientPhone}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">Remaining Balance</span>
                  <span className="font-mono font-extrabold text-rose-700 text-lg block mt-0.5">
                    {formatCurrency(selectedInvoice.amountDue)}
                  </span>
                </div>
              </div>

              {/* Method Choice: Cash / Online Account */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCollectMethod('CASH')}
                    className={`h-9 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      collectMethod === 'CASH'
                        ? 'bg-emerald-50/80 border-emerald-500 text-emerald-800 shadow-2xs ring-1 ring-emerald-500/20'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Banknote className="w-4 h-4 text-emerald-600" />
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setCollectMethod('ONLINE')}
                    className={`h-9 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      collectMethod === 'ONLINE'
                        ? 'bg-emerald-50/80 border-emerald-500 text-emerald-800 shadow-2xs ring-1 ring-emerald-500/20'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-emerald-600" />
                    Online Account
                  </button>
                </div>
              </div>

              {/* Named Account Selection (Shown when Online Account is selected) */}
              {collectMethod === 'ONLINE' && (
                <div className="space-y-1.5 animate-in fade-in duration-150">
                  <label className="text-xs font-bold text-slate-700 block">Deposit To Payment Account</label>
                  <Select
                    value={selectedOnlineAccountId}
                    onValueChange={setSelectedOnlineAccountId}
                  >
                    <SelectTrigger className="h-9 text-xs rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder="Select Account" />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentAccounts
                        .filter((a) => (a.branchIds ?? [a.branchId]).includes(selectedInvoice.branchId) && a.isActive)
                        .map((acc) => (
                          <SelectItem key={acc.id} value={acc.id} className="text-xs font-medium">
                            {acc.name} ({acc.accountIdentifier})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Partial Payment Toggle & Input */}
              {!isPartialMode ? (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-slate-500">
                    Collecting full balance: <strong className="font-mono text-slate-800">{formatCurrency(selectedInvoice.amountDue)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPartialMode(true);
                    }}
                    className="text-xs font-semibold text-[#9D2558] hover:text-[#851C47] hover:underline cursor-pointer"
                  >
                    Collect Partial Amount
                  </button>
                </div>
              ) : (
                <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-200 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Partial Amount to Collect (PKR)</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPartialMode(false);
                        setCollectAmount(selectedInvoice.amountDue);
                      }}
                      className="text-[11px] font-semibold text-[#9D2558] hover:underline cursor-pointer"
                    >
                      Collect Full Balance ({formatCurrency(selectedInvoice.amountDue)})
                    </button>
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max={selectedInvoice.amountDue}
                    step="any"
                    autoFocus
                    value={collectAmount || ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setCollectAmount(Math.min(selectedInvoice.amountDue, Math.max(0, val)));
                    }}
                    placeholder={`Enter amount (max ${formatCurrency(selectedInvoice.amountDue)})`}
                    className="font-mono font-bold text-sm h-9 bg-white rounded-lg border-slate-300"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                    <span>Collecting: {formatCurrency(collectAmount)}</span>
                    <span className="text-rose-600 font-semibold">
                      Remaining Due: {formatCurrency(Math.max(0, selectedInvoice.amountDue - collectAmount))}
                    </span>
                  </div>
                </div>
              )}

              {/* Single Clear Accept Payment Button */}
              <div className="pt-2">
                <Button
                  disabled={isCollecting || collectAmount <= 0 || collectAmount > selectedInvoice.amountDue}
                  onClick={handleSubmitCollection}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {isCollecting ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
                      <span>Recording Collection...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Accept Payment — {formatCurrency(collectAmount)}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── 4. PRINTABLE RECEIPT MODAL ── */}
      {isReceiptOpen && receiptInvoice && (
        <ReceiptModal
          isOpen={isReceiptOpen}
          onClose={() => setIsReceiptOpen(false)}
          invoice={receiptInvoice}
          branch={allBranches.find((b) => b.id === receiptInvoice?.branchId) || null}
        />
      )}
    </div>
  );
};
