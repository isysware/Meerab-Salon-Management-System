import { BranchActionField } from '@/components/BranchActionField';
import { useInventoryActionScope } from './useInventoryActionScope';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import {
  Purchase,
  InventoryItem,
  Supplier,
  CreatePurchaseInput,
  PurchasePaymentMethod,
  PaymentAccount,
  CashDrawer,
  InventoryBatch,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { InventoryNavHeader } from './InventoryNavHeader';
import { toast } from '@/context/ToastContext';
import {
  ArrowDownRight,
  Plus,
  Search,
  Filter,
  Truck,
  Package,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Info,
  Banknote,
  Receipt,
  Layers,
  Loader2,
  X,
  CreditCard,
  Building2,
  BookOpen,
  RotateCcw,
  Eye,
  History,
} from 'lucide-react';

const formatPKR = (amt: number) => {
  return (Number(amt) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const StockInPurchasesPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();
  const { navigate } = useRouter();

  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/operations/stock-in" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const defaultBranchId = isSuperAdmin
    ? (activeBranchId !== 'ALL' ? activeBranchId : allBranches[0]?.id || '')
    : (user.branchId || '');

  const [selectedBranchId, setSelectedBranchId] = useState<string>(defaultBranchId);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [activeDrawer, setActiveDrawer] = useState<CashDrawer | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Stock In Modal State
  const [isStockInModalOpen, setIsStockInModalOpen] = useState<boolean>(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<'CREDIT' | 'CASH' | 'ONLINE' | 'PARTIAL'>('CREDIT');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paymentSourceMethod, setPaymentSourceMethod] = useState<'CASH' | 'ONLINE'>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState<string>('');
  const [purchaseNotes, setPurchaseNotes] = useState<string>('');

  // Purchase Line Items
  interface StockInLine {
    itemId: string;
    quantity: number;
    unitPurchaseCost: number;
    sellingPrice?: number;
    batchNumber: string;
    expiryDate?: string;
  }
  const [stockInLines, setStockInLines] = useState<StockInLine[]>([]);
  const [isSubmittingStockIn, setIsSubmittingStockIn] = useState<boolean>(false);

  // Inline Quick Add Vendor Modal
  const [isQuickVendorModalOpen, setIsQuickVendorModalOpen] = useState<boolean>(false);
  const [quickVendorName, setQuickVendorName] = useState<string>('');
  const [quickVendorCompany, setQuickVendorCompany] = useState<string>('');
  const [quickVendorPhone, setQuickVendorPhone] = useState<string>('');

  // Inline Quick Add Product Modal
  const [isQuickProductModalOpen, setIsQuickProductModalOpen] = useState<boolean>(false);
  const [quickProductName, setQuickProductName] = useState<string>('');
  const [quickProductCategory, setQuickProductCategory] = useState<string>('Hair Care');
  const [quickProductCost, setQuickProductCost] = useState<number>(0);
  const [quickProductPrice, setQuickProductPrice] = useState<number>(0);

  // Return to Supplier Modal State
  interface ReturnLineItem {
    itemId: string;
    itemName: string;
    itemSku: string;
    batchId?: string;
    batchNumber?: string;
    originalQuantity: number;
    alreadyReturned: number;
    availableStock: number;
    maxReturnable: number;
    returnQuantity: number;
    unitCost: number;
    lineTotal: number;
    selected: boolean;
  }
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [selectedReturnPurchaseId, setSelectedReturnPurchaseId] = useState<string>('');
  const [selectedReturnPurchase, setSelectedReturnPurchase] = useState<Purchase | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLineItem[]>([]);
  const [returnReason, setReturnReason] = useState<string>('DEFECTIVE');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [returnTreatment, setReturnTreatment] = useState<'REDUCE_PAYABLE' | 'CASH_REFUND' | 'ONLINE_REFUND'>('REDUCE_PAYABLE');
  const [returnPaymentAccountId, setReturnPaymentAccountId] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState<boolean>(false);

  // Purchase Details Modal State
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);
  const [viewingPurchase, setViewingPurchase] = useState<Purchase | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

  const loadData = useCallback(async (bId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [purchList, itemList, suppList, batchList, accounts, drawers] = await Promise.all([
        salonService.getPurchases(bId || 'ALL', user).catch(() => []),
        salonService.getInventoryItems(bId || 'ALL', user).catch(() => []),
        salonService.getSuppliers(bId || 'ALL', user).catch(() => []),
        salonService.getInventoryBatches(bId || 'ALL', undefined, user).catch(() => []),
        salonService.getPaymentAccounts(bId || 'ALL').catch(() => []),
        salonService.getCashDrawers(bId || 'ALL').catch(() => []),
      ]);

      setPurchases(purchList);
      setItems(itemList);
      setSuppliers(suppList);
      setBatches(batchList);
      setPaymentAccounts(accounts);

      const userDrawer = drawers.find((d: any) => d.status === 'OPEN' && d.custodianUserId === user.id) || null;
      setActiveDrawer(userDrawer);

      // Compute stockMap from batches
      const smap: Record<string, number> = {};
      itemList.forEach((it) => {
        const itemBatches = batchList.filter((b) => b.itemId === it.id && (bId === 'ALL' || b.branchId === bId));
        smap[it.id] = itemBatches.reduce((sum, b) => sum + (b.remainingQuantity || 0), 0);
      });
      setStockMap(smap);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load stock in purchases.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData(selectedBranchId);
  }, [loadData, selectedBranchId]);

  const actionScope = useInventoryActionScope(isStockInModalOpen);
  const changeActionBranch = (id: string) => {
    actionScope.setBranchId(id);
    setSelectedSupplierId(''); setPaymentAccountId(''); setPaidAmount(0); setStockInLines([{ itemId: '', quantity: 1, unitPurchaseCost: 0, batchNumber: '' }]);
  };

  // Open Stock In Modal
  const handleOpenStockIn = () => {
    const firstItem = actionScope.items[0];
    setSelectedSupplierId(actionScope.suppliers[0]?.id || '');
    setInvoiceNumber('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setPaidAmount(0);
    setPaymentSourceMethod('CASH');
    setPaymentAccountId(actionScope.accounts[0]?.id || '');
    setPurchaseNotes('');
    setStockInLines([
      {
        itemId: firstItem?.id || '',
        quantity: 10,
        unitPurchaseCost: firstItem?.defaultPurchaseCost || 0,
        batchNumber: '',
      },
    ]);
    setIsStockInModalOpen(true);
  };

  const handleAddLine = () => {
    const firstItem = actionScope.items[0];
    setStockInLines((prev) => [
      ...prev,
      {
        itemId: firstItem?.id || '',
        quantity: 1,
        unitPurchaseCost: firstItem?.defaultPurchaseCost || 0,
        batchNumber: '',
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setStockInLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateLine = (idx: number, updates: Partial<StockInLine>) => {
    setStockInLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const updated = { ...l, ...updates };
        if (updates.itemId) {
          const matched = actionScope.items.find((it) => it.id === updates.itemId);
          if (matched && updates.unitPurchaseCost === undefined) {
            updated.unitPurchaseCost = matched.defaultPurchaseCost || 0;
          }
        }
        return updated;
      })
    );
  };

  // Total Calculations
  const calculatedGrandTotal = useMemo(() => {
    return stockInLines.reduce((sum, line) => sum + (line.quantity || 0) * (line.unitPurchaseCost || 0), 0);
  }, [stockInLines]);

  const totalUnitsReceiving = useMemo(() => {
    return stockInLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  }, [stockInLines]);

  const computedPaymentStatus = useMemo<'PAID' | 'PARTIAL' | 'UNPAID'>(() => {
    if (paidAmount <= 0) return 'UNPAID';
    if (paidAmount >= calculatedGrandTotal) return 'PAID';
    return 'PARTIAL';
  }, [paidAmount, calculatedGrandTotal]);

  const remainingDue = useMemo(() => {
    return Math.max(0, calculatedGrandTotal - paidAmount);
  }, [calculatedGrandTotal, paidAmount]);

  // Submit Stock In
  const handleSubmitStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionScope.validate()) return;
    if (!selectedSupplierId) {
      const msg = 'Please select or add a supplier/vendor.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    if (stockInLines.length === 0) {
      const msg = 'Please add at least one product line.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }
    if (stockInLines.some((line) => !actionScope.items.some((item) => item.id === line.itemId))) {
      toast.error('Select a product from this branch for every stock-in line.');
      return;
    }

    const finalPaymentMethod: PurchasePaymentMethod =
      paidAmount <= 0
        ? 'CREDIT'
        : paidAmount < calculatedGrandTotal
        ? 'PARTIAL'
        : paymentSourceMethod === 'ONLINE'
        ? 'ONLINE'
        : 'CASH';

    if (paidAmount > 0 && paymentSourceMethod === 'ONLINE' && !paymentAccountId) {
      const msg = 'Please select a Bank / Online Account for payment.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    setIsSubmittingStockIn(true);
    setErrorMessage(null);
    try {
      const input: CreatePurchaseInput = {
        branchId: actionScope.branchId,
        supplierId: selectedSupplierId,
        invoiceNumber: invoiceNumber.trim() || '',
        purchaseDate,
        paymentMethod: finalPaymentMethod,
        paidAmount: paidAmount > 0 ? paidAmount : 0,
        paymentAccountId: paidAmount > 0 && paymentSourceMethod === 'ONLINE' ? paymentAccountId : undefined,
        payerDrawerId: paidAmount > 0 && paymentSourceMethod === 'CASH' ? actionScope.activeDrawer?.id : undefined,
        notes: purchaseNotes,
        lines: stockInLines.map((l) => ({
          itemId: l.itemId,
          batchNumber: l.batchNumber,
          quantity: Number(l.quantity) || 1,
          unitPurchaseCost: Number(l.unitPurchaseCost) || 0,
          sellingPrice: l.sellingPrice !== undefined ? Number(l.sellingPrice) : undefined,
          expiryDate: l.expiryDate || undefined,
        })),
      };

      await salonService.createPurchase(input, user);
      const msg = `Stock-in recorded successfully! ${totalUnitsReceiving} units added to inventory.`;
      setSuccessMessage(msg);
      toast.success(msg);
      setIsStockInModalOpen(false);
      loadData(selectedBranchId);
    } catch (err: any) {
      const msg = err?.message || 'Failed to record stock in.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmittingStockIn(false);
    }
  };

  // Quick Vendor Creation
  const handleQuickAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionScope.validate()) return;
    if (!quickVendorName.trim()) {
      toast.error('Vendor name is required.');
      return;
    }
    try {
      const created = await salonService.createSupplier(
        {
          branchId: actionScope.branchId,
          name: quickVendorName.trim(),
          companyName: quickVendorCompany.trim() || quickVendorName.trim(),
          phone: quickVendorPhone.trim() || '—',
          openingPayable: 0,
          isActive: true,
        },
        user
      );
      actionScope.refresh();
      setSelectedSupplierId(created.id);
      setIsQuickVendorModalOpen(false);
      setQuickVendorName('');
      setQuickVendorCompany('');
      setQuickVendorPhone('');
      const msg = `Vendor "${created.name}" registered and selected.`;
      setSuccessMessage(msg);
      toast.success(msg);
    } catch (err: any) {
      const msg = err?.message || 'Failed to create vendor.';
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Quick Product Creation
  const handleQuickAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionScope.validate()) return;
    if (!quickProductName.trim()) return;
    try {
      const created = await salonService.createInventoryItem(
        {
          branchAvailability: [actionScope.branchId],
          name: quickProductName.trim(),
          sku: '',
          code: '',
          category: quickProductCategory || 'General',
          itemType: 'RETAIL_PRODUCT',
          purchaseUnit: 'BOTTLE',
          issueUnit: 'BOTTLE',
          defaultPurchaseCost: Number(quickProductCost) || 0,
          sellingPrice: Number(quickProductPrice) || 0,
          price: Number(quickProductPrice) || 0,
          minStockLevel: 5,
          taxTreatment: 'BRANCH_DEFAULT',
          trackBatch: true,
          trackExpiry: false,
          nearExpiryAlertDays: 60,
          isActive: true,
        },
        user
      );
      actionScope.refresh();
      if (stockInLines.length > 0) {
        handleUpdateLine(stockInLines.length - 1, { itemId: created.id, unitPurchaseCost: created.defaultPurchaseCost });
      }
      setIsQuickProductModalOpen(false);
      setQuickProductName('');
      setQuickProductCost(0);
      setQuickProductPrice(0);
      setSuccessMessage(`Product "${created.name}" added to catalogue.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create product.');
    }
  };

  const populateReturnLines = (pur: Purchase) => {
    const lines: ReturnLineItem[] = (pur.lines || []).map((l: any) => {
      const origQty = Number(l.quantity) || 0;
      const returned = Number(l.returnedQuantity) || 0;
      const availBatch = l.currentBatchRemainingQuantity !== undefined ? Number(l.currentBatchRemainingQuantity) : origQty;
      const eligible = l.remainingEligibleQuantity !== undefined ? Number(l.remainingEligibleQuantity) : Math.max(0, origQty - returned);
      const maxRet = Math.max(0, Math.min(eligible, availBatch));
      const cost = Number(l.historicalCostSnapshot || l.landedUnitCost || l.unitPurchaseCost) || 0;
      return {
        itemId: l.itemId,
        itemName: l.itemName,
        itemSku: l.itemSku,
        batchId: l.batchId,
        batchNumber: l.batchNumber,
        originalQuantity: origQty,
        alreadyReturned: returned,
        availableStock: availBatch,
        maxReturnable: maxRet,
        returnQuantity: maxRet > 0 ? maxRet : 0,
        unitCost: cost,
        lineTotal: maxRet > 0 ? Number((maxRet * cost).toFixed(2)) : 0,
        selected: maxRet > 0,
      };
    });
    setReturnLines(lines);
  };

  const handleOpenReturnModal = async (pur?: Purchase) => {
    setErrorMessage(null);
    setReturnReason('DEFECTIVE');
    setReturnNotes('');
    setReturnTreatment('REDUCE_PAYABLE');
    setReturnPaymentAccountId(paymentAccounts[0]?.id || '');
    setReturnDate(new Date().toISOString().split('T')[0]);

    if (pur) {
      setSelectedReturnPurchaseId(pur.id);
      setSelectedReturnPurchase(pur);
      try {
        const full = await salonService.getPurchase(pur.id, user);
        setSelectedReturnPurchase(full);
        populateReturnLines(full);
      } catch {
        populateReturnLines(pur);
      }
    } else {
      setSelectedReturnPurchaseId('');
      setSelectedReturnPurchase(null);
      setReturnLines([]);
    }
    setIsReturnModalOpen(true);
  };

  const handleSelectReturnPurchase = async (purId: string) => {
    setSelectedReturnPurchaseId(purId);
    const found = purchases.find((p) => p.id === purId);
    if (!found) {
      setSelectedReturnPurchase(null);
      setReturnLines([]);
      return;
    }
    try {
      const full = await salonService.getPurchase(purId, user);
      setSelectedReturnPurchase(full);
      populateReturnLines(full);
    } catch {
      setSelectedReturnPurchase(found);
      populateReturnLines(found);
    }
  };

  const handleToggleReturnLine = (idx: number) => {
    setReturnLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const nextSel = !l.selected;
        return {
          ...l,
          selected: nextSel,
          lineTotal: nextSel ? Number((l.returnQuantity * l.unitCost).toFixed(2)) : 0,
        };
      })
    );
  };

  const handleReturnQuantityChange = (idx: number, qtyVal: number) => {
    setReturnLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const validQty = Math.max(0, Math.min(l.maxReturnable, qtyVal));
        return {
          ...l,
          returnQuantity: validQty,
          lineTotal: Number((validQty * l.unitCost).toFixed(2)),
        };
      })
    );
  };

  const calculatedReturnTotal = useMemo(() => {
    return returnLines
      .filter((l) => l.selected)
      .reduce((sum, l) => sum + l.lineTotal, 0);
  }, [returnLines]);

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReturnPurchase) {
      toast.error('Please select a purchase to return.');
      return;
    }
    const selectedLines = returnLines.filter((l) => l.selected && l.returnQuantity > 0);
    if (selectedLines.length === 0) {
      toast.error('Please select at least one item with a return quantity greater than 0.');
      return;
    }
    if (returnTreatment === 'ONLINE_REFUND' && !returnPaymentAccountId) {
      toast.error('Please select an active payment account for online refund.');
      return;
    }

    setIsSubmittingReturn(true);
    try {
      const input = {
        branchId: selectedBranchId === 'ALL' ? selectedReturnPurchase.branchId : selectedBranchId,
        supplierId: selectedReturnPurchase.supplierId,
        purchaseId: selectedReturnPurchase.id,
        returnDate,
        reason: returnReason,
        notes: returnNotes.trim() || undefined,
        refundTreatment: returnTreatment,
        paymentAccountId: returnTreatment === 'ONLINE_REFUND' ? returnPaymentAccountId : undefined,
        lines: selectedLines.map((l) => ({
          itemId: l.itemId,
          batchId: l.batchId,
          batchNumber: l.batchNumber,
          quantity: Number(l.returnQuantity),
          unitCost: Number(l.unitCost),
        })),
      };

      const res = await salonService.createSupplierReturn(input as any, user);
      toast.success(`Purchase return ${res.returnNumber} of PKR ${formatPKR(res.totalAmount)} successfully posted!`);
      setIsReturnModalOpen(false);
      loadData(selectedBranchId);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to post return to supplier.');
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  const handleOpenDetailsModal = async (pur: Purchase) => {
    setIsLoadingDetails(true);
    setViewingPurchase(pur);
    setIsDetailsModalOpen(true);
    try {
      const full = await salonService.getPurchase(pur.id, user);
      setViewingPurchase(full);
    } catch {
      // keep basic
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Filtered Purchases
  const filteredPurchases = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return purchases;
    return purchases.filter(
      (p) =>
        (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q)) ||
        (p.supplierName && p.supplierName.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q))
    );
  }, [purchases, searchQuery]);

  // KPIs
  const kpis = useMemo(() => {
    let totalSpent = 0;
    let totalPurchases = purchases.length;
    let totalCredit = 0;

    purchases.forEach((p) => {
      totalSpent += p.totalCost || 0;
      if (p.paymentMethod === 'CREDIT' || p.paymentStatus === 'UNPAID') {
        totalCredit += p.totalCost || 0;
      }
    });

    return {
      totalPurchases,
      totalSpent,
      totalCredit,
    };
  }, [purchases]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Header */}
      <InventoryNavHeader
        title="Stock In & Purchases"
        subtitle="Receive new stock shipments from suppliers, verify stock on hand before merging, and record vendor ledger bills."
        icon={<ArrowDownRight className="w-6 h-6 text-[#B82E69]" />}
        activePath="/operations/stock-in"
        selectedBranchId={selectedBranchId}
        onBranchChange={setSelectedBranchId}
        primaryAction={{
          label: 'New Stock In',
          icon: <ArrowDownRight className="w-4 h-4" />,
          onClick: handleOpenStockIn,
        }}
        secondaryAction={{
          label: 'Suppliers Directory',
          icon: <Truck className="w-4 h-4 text-[#B82E69]" />,
          onClick: () => navigate('/operations/suppliers'),
        }}
      />

      {/* KPI Cards: Pure White Frosted Glass (Zero Wavy Lines, Zero Watermarks) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Total Stock-In Orders */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Stock-In Shipments
            </span>
            <div className="w-8 h-8 rounded-2xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-[#18191B] tracking-tight">
            {kpis.totalPurchases}
          </div>
          <div className="text-[11px] font-medium text-slate-400 mt-1 truncate">
            Recorded purchase invoices
          </div>
        </div>

        {/* Total Purchased Value */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Total Purchased Value
            </span>
            <div className="w-8 h-8 rounded-2xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-emerald-600 shrink-0">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-[#18191B] tracking-tight truncate">
            PKR {formatPKR(kpis.totalSpent)}
          </div>
          <div className="text-[11px] font-semibold text-emerald-600 mt-1 truncate">
            Cumulative intake value
          </div>
        </div>

        {/* Vendor Credit (Payable) */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-amber-700/80 uppercase tracking-wider">
              Vendor Khata (Payable)
            </span>
            <div className="w-8 h-8 rounded-2xl bg-amber-50/80 border border-amber-200/50 shadow-2xs flex items-center justify-center text-amber-600 shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-amber-950 tracking-tight truncate">
            PKR {formatPKR(kpis.totalCredit)}
          </div>
          <div className="text-[11px] font-semibold text-amber-700 mt-1 truncate">
            Outstanding supplier credit
          </div>
        </div>
      </div>

      {/* Search Bar: Frosted Card */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search by PO #, Supplier, Invoice..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs pl-10 pr-4 py-2.5 rounded-2xl border border-white/90 bg-white/70 backdrop-blur-xl focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-[#B82E69]/10 text-[#18191B] font-medium shadow-2xs transition-all placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleOpenReturnModal()}
            className="w-full sm:w-auto h-10 px-4 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-2xl shadow-2xs transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 whitespace-nowrap active:scale-[0.98]"
            title="Return goods to supplier"
          >
            <RotateCcw className="w-4 h-4 text-amber-700" />
            <span>Return to Supplier</span>
          </button>
          <button
            type="button"
            onClick={handleOpenStockIn}
            className="w-full sm:w-auto h-10 px-4.5 text-xs font-bold text-white bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02359] hover:to-[#851C47] rounded-2xl shadow-[0_8px_20px_rgba(184,46,105,0.25)] hover:shadow-[0_10px_26px_rgba(184,46,105,0.35)] transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 whitespace-nowrap active:scale-[0.98]"
          >
            <ArrowDownRight className="w-4 h-4" />
            <span>New Stock In</span>
          </button>
        </div>
      </div>

      {/* Main Table: Luxury Frosted Container */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3 bg-white/50 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69]">
              <ArrowDownRight className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#18191B] tracking-tight">
                Stock In Orders & Receiving Log
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                {filteredPurchases.length} purchase shipments recorded
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-3" />
            <p className="text-slate-600 text-sm font-medium">Loading stock in records...</p>
          </div>
        ) : filteredPurchases.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-slate-400 mb-3">
              <ArrowDownRight className="w-7 h-7 stroke-[1.5]" />
            </div>
            <p className="text-[#18191B] text-sm font-bold mb-1">No stock in orders recorded yet</p>
            <p className="text-slate-400 text-xs mb-4">Record your first stock shipment from a supplier to update inventory.</p>
            <button
              onClick={handleOpenStockIn}
              className="text-xs font-bold px-4 py-2 bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white rounded-xl shadow-[0_4px_14px_rgba(184,46,105,0.2)] hover:shadow-[0_6px_20px_rgba(184,46,105,0.3)] transition-all cursor-pointer"
            >
              Record First Stock In
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-400 font-bold text-[11px] uppercase tracking-wider">
                  <th className="py-3.5 px-4 text-center w-12">#</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">PO / Invoice #</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Date</th>
                  <th className="py-3.5 px-4 min-w-[180px]">Supplier / Vendor</th>
                  <th className="py-3.5 px-4 text-center whitespace-nowrap">Items Received</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap font-bold">Total Bill (PKR)</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Payment Method</th>
                  <th className="py-3.5 px-4 text-center whitespace-nowrap">Status</th>
                  <th className="py-3.5 px-4 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {filteredPurchases.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-rose-50/20 transition-colors">
                    <td className="py-3.5 px-4 text-center text-slate-400 font-medium">
                      {idx + 1}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-bold text-[#B82E69]">
                      <button
                        type="button"
                        onClick={() => handleOpenDetailsModal(p)}
                        className="hover:underline text-left cursor-pointer font-bold"
                        title="Click to view purchase details"
                      >
                        {p.invoiceNumber || p.supplierInvoiceNumber || `PO-${p.id.slice(0, 6)}`}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 font-medium">
                      {formatDate(p.purchaseDate)}
                    </td>
                    <td className="py-3.5 px-4 text-[#18191B] font-bold">
                      <div className="flex items-center justify-between gap-2">
                        <span>{p.supplierName}</span>
                        {p.supplierId && (
                          <button
                            type="button"
                            onClick={() => navigate(`/operations/supplier-ledger?supplierId=${p.supplierId}`)}
                            className="text-[11px] font-bold text-[#B82E69] bg-white/90 hover:bg-white border border-white/80 shadow-2xs px-2.5 py-1 rounded-xl cursor-pointer transition-all flex items-center gap-1 shrink-0"
                            title="View Supplier Khata Ledger"
                          >
                            <BookOpen className="w-3 h-3" />
                            <span>Khata</span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-700 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/90 border border-white/80 shadow-2xs text-[#18191B]">
                        {p.lines?.length || 1} Products
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-[#18191B] whitespace-nowrap">
                      <div>PKR {formatPKR(p.totalCost ?? 0)}</div>
                      {Boolean(p.totalReturnedAmount && p.totalReturnedAmount > 0) && (
                        <div className="text-[10px] font-bold text-amber-700 mt-0.5">
                          Ret: PKR {formatPKR(p.totalReturnedAmount!)}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                      {p.paymentMethod === 'CREDIT' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60 shadow-2xs">
                          Supplier Credit (Khata)
                        </span>
                      ) : p.paymentMethod === 'CASH' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-2xs">
                          Cash Drawer
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60 shadow-2xs">
                          Bank Transfer
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-2xs">
                        {p.paymentStatus === 'PAID' ? 'Fully Paid' : p.paymentStatus === 'PARTIAL' ? 'Partially Paid' : p.paymentStatus === 'UNPAID' ? 'Unpaid' : 'Completed'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenDetailsModal(p)}
                          className="p-1.5 rounded-xl bg-white/90 hover:bg-white text-slate-600 hover:text-slate-900 border border-white/80 shadow-2xs transition-all cursor-pointer"
                          title="View Purchase Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenReturnModal(p)}
                          className="text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 shadow-2xs px-2.5 py-1 rounded-xl cursor-pointer transition-all flex items-center gap-1 shrink-0"
                          title="Return to Supplier (Wapas Karna)"
                        >
                          <RotateCcw className="w-3 h-3 text-amber-700" />
                          <span>Return</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- MODAL: NEW STOCK IN (MANGWANA) --- */}
      {isStockInModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ArrowDownRight className="w-5 h-5 text-[#9D2558]" />
                  <span>Receive Stock Shipment (Stock In)</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Record vendor purchase invoice, receive inventory into stock, and manage payment settlement.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsStockInModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="stock-in-form" onSubmit={handleSubmitStockIn} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <BranchActionField value={actionScope.branchId} onChange={changeActionBranch} disabled={isSubmittingStockIn} />
              {actionScope.error && <p role="alert" className="text-xs text-rose-600">{actionScope.error}</p>}
              {actionScope.loading && <p role="status" className="text-xs text-slate-500">Loading branch data...</p>}
              <fieldset disabled={!actionScope.ready} className="space-y-4 disabled:opacity-50">
              {/* Row 1: Supplier Picker with Quick Add Button */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">
                      Supplier / Vendor *
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsQuickVendorModalOpen(true)}
                      className="text-[11px] font-bold text-[#9D2558] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add New Vendor</span>
                    </button>
                  </div>
                  <select
                    required
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden"
                  >
                    <option value="">Select a Supplier</option>
                    {actionScope.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.companyName || 'Vendor'}) — Khata: PKR {formatPKR(s.currentPayable ?? s.currentBalance ?? 0)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supplier Invoice # (Optional)
                  </label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    placeholder="Supplier reference, if available"
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Shipment Products & Quantities
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsQuickProductModalOpen(true)}
                      className="text-xs font-semibold text-slate-700 hover:text-[#9D2558] flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add New Product</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddLine}
                      className="text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] flex items-center gap-1 px-3 py-1 rounded-md cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Another Item</span>
                    </button>
                  </div>
                </div>

                {stockInLines.map((line, idx) => {
                  const item = actionScope.items.find((it) => it.id === line.itemId);
                  const currentStockOnHand = item ? (actionScope.stockMap[item.id] ?? 0) : 0;
                  const newQuantity = Number(line.quantity) || 0;
                  const totalAfterStockIn = currentStockOnHand + newQuantity;
                  const lineTotalCost = newQuantity * (Number(line.unitPurchaseCost) || 0);

                  return (
                    <div
                      key={idx}
                      className="p-4 bg-white border border-[#F1DEE3]/80 rounded-xl space-y-3 shadow-2xs"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        {/* Select Product */}
                        <div className="sm:col-span-5">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Product #{idx + 1}
                          </label>
                          <select
                            required
                            value={line.itemId}
                            onChange={(e) => handleUpdateLine(idx, { itemId: e.target.value })}
                            className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden"
                          >
                            <option value="">Select a product</option>
                            {actionScope.items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.name} ({it.sku})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Quantity Receiving */}
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1 whitespace-nowrap">
                            Quantity Received *
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => handleUpdateLine(idx, { quantity: Number(e.target.value) })}
                            className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg focus:outline-hidden"
                          />
                        </div>

                        {/* Unit Purchase Cost */}
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1 whitespace-nowrap">
                            Unit Cost (PKR)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPurchaseCost}
                            onChange={(e) => handleUpdateLine(idx, { unitPurchaseCost: Number(e.target.value) })}
                            className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg focus:outline-hidden"
                          />
                        </div>

                        {/* Line Total */}
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1 text-right whitespace-nowrap">
                            Ledger Bill
                          </label>
                          <div className="text-xs font-bold text-slate-800 py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg text-right">
                            PKR {formatPKR(lineTotalCost)}
                          </div>
                        </div>

                        {/* Remove Button */}
                        <div className="sm:col-span-1 flex items-center justify-end pb-1">
                          {stockInLines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(idx)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                              title="Remove item"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <label htmlFor={'stock-in-expiry-' + idx} className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Expiry Date <span className="text-slate-400 font-normal">(Optional)</span>
                          </label>
                          <input
                            id={'stock-in-expiry-' + idx}
                            type="date"
                            value={line.expiryDate || ''}
                            onChange={(e) => handleUpdateLine(idx, { expiryDate: e.target.value || undefined })}
                            className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg focus:outline-hidden"
                          />
                        </div>
                        <div>
                          <label htmlFor={'stock-in-sale-price-' + idx} className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Batch Sale Price <span className="text-slate-400 font-normal">(Optional — defaults to {item?.sellingPrice !== undefined ? `PKR ${item.sellingPrice}` : ''} if blank)</span>
                          </label>
                          <input
                            id={'stock-in-sale-price-' + idx}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={item?.sellingPrice !== undefined ? `Current: PKR ${item.sellingPrice}` : 'Use product default'}
                            value={line.sellingPrice !== undefined ? line.sellingPrice : ''}
                            onChange={(e) => handleUpdateLine(idx, { sellingPrice: e.target.value ? Number(e.target.value) : undefined })}
                            className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg focus:outline-hidden font-mono"
                          />
                        </div>
                      </div>

                      {/* Stock Clarity Banner */}
                      <div className="bg-[#FDF2F5] border border-[#F1DEE3]/60 rounded-lg px-3.5 py-2 flex flex-wrap items-center justify-between text-xs gap-2">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Info className="w-3.5 h-3.5 text-[#9D2558]" />
                          <span>
                            Current Stock:{' '}
                            <strong className="text-slate-900 font-bold">
                              {currentStockOnHand} {item?.purchaseUnit || 'Units'}
                            </strong>
                          </span>
                        </div>
                        <div className="text-slate-700">
                          Received Intake:{' '}
                          <strong className="text-[#9D2558] font-bold">
                            +{newQuantity} {item?.purchaseUnit || 'Units'}
                          </strong>
                        </div>
                        <div className="text-emerald-800 font-semibold">
                          Total Stock After:{' '}
                          <span className="underline font-bold">
                            {totalAfterStockIn} {item?.purchaseUnit || 'Units'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Payment & Vendor Khata Settlement */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-[#9D2558]" />
                    <span>Payment & Vendor Khata Settlement</span>
                  </label>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide border ${
                      computedPaymentStatus === 'PAID'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : computedPaymentStatus === 'PARTIAL'
                        ? 'bg-[#FCE8EC] text-[#23151D] border-[#F8D2DC]'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }`}
                  >
                    Payment Status: {computedPaymentStatus}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  {/* Total Bill */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Total Bill</label>
                    <div className="text-xs font-bold text-slate-900 py-2 px-3 bg-white border border-slate-300 rounded-lg">
                      PKR {formatPKR(calculatedGrandTotal)}
                    </div>
                  </div>

                  {/* Amount Paid Now */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-slate-700">Amount Paid Now (PKR)</label>
                      <span className="text-[10px] text-slate-400">0 = Unpaid</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={calculatedGrandTotal}
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(calculatedGrandTotal, Number(e.target.value) || 0));
                        setPaidAmount(val);
                      }}
                      placeholder="0.00"
                      className="w-full text-xs font-bold px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                    />
                  </div>

                  {/* Remaining Khata Due */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Remaining Khata Due (Payable)
                    </label>
                    <div
                      className={`text-xs font-bold py-2 px-3 rounded-lg border ${
                        remainingDue > 0
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      PKR {formatPKR(remainingDue)}
                    </div>
                  </div>
                </div>

                {/* Quick Payment Set Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] text-slate-500 font-medium">Quick Set:</span>
                  <button
                    type="button"
                    onClick={() => setPaidAmount(0)}
                    className="text-[11px] font-semibold px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 transition-colors cursor-pointer"
                  >
                    Unpaid (PKR 0)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaidAmount(Math.round(calculatedGrandTotal / 2))}
                    className="text-[11px] font-semibold px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 transition-colors cursor-pointer"
                  >
                    Partial 50% (PKR {formatPKR(Math.round(calculatedGrandTotal / 2))})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaidAmount(calculatedGrandTotal)}
                    className="text-[11px] font-semibold px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 transition-colors cursor-pointer"
                  >
                    Full Paid (100%)
                  </button>
                </div>

                {/* Payment Source Selection (when paying) */}
                {paidAmount > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Payment Method *
                      </label>
                      <select
                        value={paymentSourceMethod}
                        onChange={(e) => setPaymentSourceMethod(e.target.value as 'CASH' | 'ONLINE')}
                        className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden"
                      >
                        <option value="CASH">Cash Drawer (Cash in Hand)</option>
                        <option value="ONLINE">Bank / Online Account</option>
                      </select>
                    </div>

                    {paymentSourceMethod === 'ONLINE' && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Bank / Online Account *
                        </label>
                        <select
                          value={paymentAccountId}
                          onChange={(e) => setPaymentAccountId(e.target.value)}
                          className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden"
                        >
                          <option value="">Select a bank / online account</option>
                          {actionScope.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.bankName || 'Bank'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {paymentSourceMethod === 'CASH' && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Cash Custody
                        </label>
                        <div className="text-xs py-2 px-3 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium">
                          {actionScope.activeDrawer ? `Drawer: ${actionScope.activeDrawer.drawerName}` : 'Branch Vault / Active Cash Drawer'}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[11px] text-slate-500 pt-1">
                  {remainingDue > 0
                    ? `PKR ${formatPKR(remainingDue)} will be posted to ${actionScope.suppliers.find((s) => s.id === selectedSupplierId)?.name || 'vendor'}'s payable khata.`
                    : 'Bill is fully settled. No debt added to vendor khata.'}
                </p>
              </div>
            
              </fieldset>
</form>

            {/* Modal Sticky Footer */}
            <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
              <div className="text-sm font-bold text-slate-900">
                Total Bill: <span className="text-[#9D2558]">PKR {formatPKR(calculatedGrandTotal)}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsStockInModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="stock-in-form"
                  disabled={isSubmittingStockIn || !actionScope.ready}
                  className="px-6 py-2 text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] disabled:opacity-50 rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  {isSubmittingStockIn ? (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5" />
                  )}
                  <span>{isSubmittingStockIn ? 'Recording...' : 'Confirm & Stock In'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- INLINE MODAL: QUICK ADD VENDOR --- */}
      {isQuickVendorModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#9D2558]" />
                <span>Add New Vendor / Supplier Directly</span>
              </h3>
              <button onClick={() => setIsQuickVendorModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleQuickAddVendor} className="space-y-3.5 pt-3">
              <BranchActionField value={actionScope.branchId} onChange={changeActionBranch} disabled={true} />
              {actionScope.error && <p role="alert" className="text-xs text-rose-600">{actionScope.error}</p>}
              {actionScope.loading && <p role="status" className="text-xs text-slate-500">Loading branch data...</p>}
              <fieldset disabled={!actionScope.ready} className="space-y-4 disabled:opacity-50">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Vendor Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Asad Traders"
                  value={quickVendorName}
                  onChange={(e) => setQuickVendorName(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Company / Brand Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. L'Oreal Official Distributor"
                  value={quickVendorCompany}
                  onChange={(e) => setQuickVendorCompany(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Phone
                </label>
                <input
                  type="text"
                  placeholder="e.g. 0300-1234567"
                  value={quickVendorPhone}
                  onChange={(e) => setQuickVendorPhone(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsQuickVendorModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] rounded-lg shadow-xs"
                >
                  Register Vendor
                </button>
              </div>
            
              </fieldset>
</form>
          </div>
        </div>
      )}

      {/* --- INLINE MODAL: QUICK ADD PRODUCT --- */}
      {isQuickProductModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-[#9D2558]" />
                <span>Add New Product to Catalogue</span>
              </h3>
              <button onClick={() => setIsQuickProductModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleQuickAddProduct} className="space-y-3.5 pt-3">
              <BranchActionField value={actionScope.branchId} onChange={changeActionBranch} disabled={true} />
              {actionScope.error && <p role="alert" className="text-xs text-rose-600">{actionScope.error}</p>}
              {actionScope.loading && <p role="status" className="text-xs text-slate-500">Loading branch data...</p>}
              <fieldset disabled={!actionScope.ready} className="space-y-4 disabled:opacity-50">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Keratin Shampoo 500ml"
                  value={quickProductName}
                  onChange={(e) => setQuickProductName(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Category
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hair Care"
                  value={quickProductCategory}
                  onChange={(e) => setQuickProductCategory(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Default Cost (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={quickProductCost}
                    onChange={(e) => setQuickProductCost(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Retail Price (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={quickProductPrice}
                    onChange={(e) => setQuickProductPrice(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsQuickProductModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[#9D2558] hover:bg-[#851C47] rounded-lg shadow-xs cursor-pointer"
                >
                  Save Product
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: RETURN TO SUPPLIER (WAPAS KARNA) --- */}
      {isReturnModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200/80 shadow-2xs flex items-center justify-center text-amber-700">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Return to Supplier (Purchase Return)
                  </h2>
                  <p className="text-[11px] text-slate-400 font-medium">
                    Deduct stock from original purchase batch and adjust supplier payable / credit
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReturnModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleConfirmReturn} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Step 1: Purchase Order Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  1. Select Posted Purchase Order *
                </label>
                {selectedReturnPurchase ? (
                  <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/70 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-amber-950">
                          {selectedReturnPurchase.invoiceNumber || selectedReturnPurchase.supplierInvoiceNumber || selectedReturnPurchase.purchaseNumber}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-800 font-bold">
                          {selectedReturnPurchase.paymentStatus}
                        </span>
                      </div>
                      <div className="text-xs text-amber-900/80 mt-1">
                        Supplier: <strong>{selectedReturnPurchase.supplierName}</strong> · Date: {formatDate(selectedReturnPurchase.purchaseDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right text-xs">
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase">Net Bill</div>
                        <div className="font-extrabold text-slate-900">PKR {formatPKR(selectedReturnPurchase.netAmount || selectedReturnPurchase.totalCost || 0)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase">Paid</div>
                        <div className="font-extrabold text-emerald-700">PKR {formatPKR(selectedReturnPurchase.paidAmount || 0)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase">Outstanding Due</div>
                        <div className="font-extrabold text-rose-700">PKR {formatPKR(selectedReturnPurchase.balanceDue || 0)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReturnPurchase(null);
                          setSelectedReturnPurchaseId('');
                          setReturnLines([]);
                        }}
                        className="text-[11px] font-bold text-amber-800 underline hover:text-amber-950 ml-2 cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                ) : (
                  <select
                    value={selectedReturnPurchaseId}
                    onChange={(e) => handleSelectReturnPurchase(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium"
                    required
                  >
                    <option value="">-- Choose a posted purchase shipment to return items from --</option>
                    {purchases.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.invoiceNumber || p.supplierInvoiceNumber || p.purchaseNumber} — {p.supplierName} ({formatDate(p.purchaseDate)}) — PKR {formatPKR(p.totalCost || p.netAmount || 0)} (Due: PKR {formatPKR(p.balanceDue || 0)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Step 2: Select Items to Return */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    2. Purchased Products & Batches for Return *
                  </label>
                  {returnLines.length > 0 && (
                    <span className="text-[11px] text-slate-500 font-medium">
                      Select items and enter quantity to return
                    </span>
                  )}
                </div>

                {!selectedReturnPurchase ? (
                  <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                    Please select a purchase order above to inspect purchased products and available stock.
                  </div>
                ) : returnLines.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                    No items found on this purchase order.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                          <th className="py-2.5 px-3 text-center w-10">Select</th>
                          <th className="py-2.5 px-3">Product Name & SKU</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Batch #</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap">Purchased</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap">Already Ret.</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap">Batch Stock</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap font-bold text-amber-800">Max Returnable</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap w-28">Return Qty</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Unit Cost</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap font-bold">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {returnLines.map((line, idx) => {
                          const isEligible = line.maxReturnable > 0;
                          return (
                            <tr
                              key={line.batchId || idx}
                              className={`transition-colors ${line.selected ? 'bg-amber-50/30' : 'hover:bg-slate-50/60'} ${!isEligible ? 'opacity-60 bg-slate-50/40' : ''}`}
                            >
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={line.selected}
                                  disabled={!isEligible}
                                  onChange={() => handleToggleReturnLine(idx)}
                                  className="w-4 h-4 rounded-md text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="py-2.5 px-3 font-medium text-slate-900">
                                <div className="font-bold">{line.itemName}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{line.itemSku}</div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                                {line.batchNumber || '—'}
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-700 font-medium">
                                {line.originalQuantity}
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-500 font-medium">
                                {line.alreadyReturned > 0 ? (
                                  <span className="text-amber-700 font-bold">{line.alreadyReturned}</span>
                                ) : (
                                  '0'
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-700 font-medium">
                                {line.availableStock}
                              </td>
                              <td className="py-2.5 px-3 text-center whitespace-nowrap font-extrabold text-amber-800">
                                {line.maxReturnable > 0 ? (
                                  line.maxReturnable
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-normal">Exhausted / Returned</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  max={line.maxReturnable}
                                  step="any"
                                  disabled={!line.selected || !isEligible}
                                  value={line.selected ? line.returnQuantity : 0}
                                  onChange={(e) => handleReturnQuantityChange(idx, Number(e.target.value))}
                                  className="w-20 text-center text-xs font-bold px-2 py-1 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-500 disabled:bg-slate-100"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-700 font-mono">
                                PKR {formatPKR(line.unitCost)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-amber-900 font-mono">
                                PKR {formatPKR(line.lineTotal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                        <tr>
                          <td colSpan={9} className="py-2.5 px-3 text-right text-slate-700">
                            Calculated Total Return Value:
                          </td>
                          <td className="py-2.5 px-3 text-right font-black text-amber-900 text-sm font-mono">
                            PKR {formatPKR(calculatedReturnTotal)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Step 3: Return Reason & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    3. Return Reason *
                  </label>
                  <select
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium"
                    required
                  >
                    <option value="DEFECTIVE">Defective Goods / Manufacturing Defect</option>
                    <option value="DAMAGED">Damaged in Transit / Broken Packaging</option>
                    <option value="EXPIRED">Expired / Near Expiry Date</option>
                    <option value="WRONG_ITEM">Wrong Item / Incorrect Specification</option>
                    <option value="OTHER">Other Reason</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Return Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Reason Description / Return Notes
                </label>
                <input
                  type="text"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="e.g. Broken seals on 3 bottles; batch rejected upon quality check"
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium"
                />
              </div>

              {/* Step 4: Financial Settlement Method */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  4. Financial Settlement Method *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                      returnTreatment === 'REDUCE_PAYABLE'
                        ? 'border-amber-500 bg-amber-50/70 shadow-2xs ring-2 ring-amber-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <input
                        type="radio"
                        name="returnTreatment"
                        checked={returnTreatment === 'REDUCE_PAYABLE'}
                        onChange={() => setReturnTreatment('REDUCE_PAYABLE')}
                        className="text-amber-600 focus:ring-amber-500 cursor-pointer"
                      />
                      <span className="font-bold text-xs text-slate-900">Supplier Khata (Credit)</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Deduct from purchase payable. Excess amount becomes supplier credit. No cash movement.
                    </p>
                  </label>

                  <label
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                      returnTreatment === 'CASH_REFUND'
                        ? 'border-amber-500 bg-amber-50/70 shadow-2xs ring-2 ring-amber-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <input
                        type="radio"
                        name="returnTreatment"
                        checked={returnTreatment === 'CASH_REFUND'}
                        onChange={() => setReturnTreatment('CASH_REFUND')}
                        className="text-amber-600 focus:ring-amber-500 cursor-pointer"
                      />
                      <span className="font-bold text-xs text-slate-900">Cash Drawer Refund</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Supplier immediately refunds cash. Inflow is deposited into your active Cash Drawer.
                    </p>
                  </label>

                  <label
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                      returnTreatment === 'ONLINE_REFUND'
                        ? 'border-amber-500 bg-amber-50/70 shadow-2xs ring-2 ring-amber-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <input
                        type="radio"
                        name="returnTreatment"
                        checked={returnTreatment === 'ONLINE_REFUND'}
                        onChange={() => setReturnTreatment('ONLINE_REFUND')}
                        className="text-amber-600 focus:ring-amber-500 cursor-pointer"
                      />
                      <span className="font-bold text-xs text-slate-900">Bank / Online Refund</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Supplier transfers refund to bank account. Inflow recorded in selected account.
                    </p>
                  </label>
                </div>

                {returnTreatment === 'ONLINE_REFUND' && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Select Receiving Bank / Online Account *
                    </label>
                    <select
                      value={returnPaymentAccountId}
                      onChange={(e) => setReturnPaymentAccountId(e.target.value)}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium"
                      required
                    >
                      <option value="">Select an active payment account</option>
                      {paymentAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.bankName || 'Bank'}) — PKR {formatPKR(a.currentBalance || 0)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Step 5: Financial Impact Preview */}
              {selectedReturnPurchase && calculatedReturnTotal > 0 && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                  <div className="font-bold text-slate-900 text-sm flex items-center justify-between">
                    <span>Financial Settlement Impact:</span>
                    <span className="text-amber-800 font-mono">PKR {formatPKR(calculatedReturnTotal)}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Purchase Bill</span>
                      <span className="font-bold text-slate-800">PKR {formatPKR(selectedReturnPurchase.netAmount || selectedReturnPurchase.totalCost || 0)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Current Due</span>
                      <span className="font-bold text-rose-700">PKR {formatPKR(selectedReturnPurchase.balanceDue || 0)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Payable Offset</span>
                      <span className="font-bold text-emerald-700">
                        -PKR {formatPKR(Math.min(calculatedReturnTotal, selectedReturnPurchase.balanceDue || 0))}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Excess Khata Credit</span>
                      <span className="font-bold text-amber-800">
                        PKR {formatPKR(Math.max(0, calculatedReturnTotal - (selectedReturnPurchase.balanceDue || 0)))}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-600 bg-white p-2.5 rounded-xl border border-slate-100 font-medium">
                    {calculatedReturnTotal <= (selectedReturnPurchase.balanceDue || 0) ? (
                      <span>
                        • Outstanding balance on this purchase order will decrease from <strong>PKR {formatPKR(selectedReturnPurchase.balanceDue || 0)}</strong> to <strong>PKR {formatPKR((selectedReturnPurchase.balanceDue || 0) - calculatedReturnTotal)}</strong>.
                      </span>
                    ) : (
                      <span>
                        • Outstanding payable on this purchase (<strong>PKR {formatPKR(selectedReturnPurchase.balanceDue || 0)}</strong>) will be fully cleared to <strong>PKR 0.00</strong>. The excess <strong>PKR {formatPKR(calculatedReturnTotal - (selectedReturnPurchase.balanceDue || 0))}</strong> will become credit in {selectedReturnPurchase.supplierName}&apos;s Khata.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Modal Sticky Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReturnModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReturn || calculatedReturnTotal <= 0}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 rounded-xl shadow-[0_4px_14px_rgba(217,119,6,0.3)] flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingReturn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Posting Return...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirm & Post Return (PKR {formatPKR(calculatedReturnTotal)})</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: PURCHASE ORDER DETAILS & RETURNS HISTORY --- */}
      {isDetailsModalOpen && viewingPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200/80 shadow-2xs flex items-center justify-center text-[#B82E69]">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">
                      Purchase Order: {viewingPurchase.invoiceNumber || viewingPurchase.supplierInvoiceNumber || viewingPurchase.purchaseNumber}
                    </h2>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-800">
                      {viewingPurchase.paymentStatus}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium">
                    Received on {formatDate(viewingPurchase.purchaseDate)} · Supplier: {viewingPurchase.supplierName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Financial Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Bill</div>
                  <div className="text-base font-black text-slate-900 mt-0.5">
                    PKR {formatPKR(viewingPurchase.netAmount || viewingPurchase.totalCost || 0)}
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Amount Paid</div>
                  <div className="text-base font-black text-emerald-800 mt-0.5">
                    PKR {formatPKR(viewingPurchase.paidAmount || 0)}
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-100">
                  <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Balance Due</div>
                  <div className="text-base font-black text-rose-800 mt-0.5">
                    PKR {formatPKR(viewingPurchase.balanceDue || 0)}
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-100">
                  <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Total Returned</div>
                  <div className="text-base font-black text-amber-800 mt-0.5">
                    PKR {formatPKR(viewingPurchase.totalReturnedAmount || 0)}
                  </div>
                </div>
              </div>

              {/* Items Received Table */}
              <div>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Items Received in this Shipment
                </h3>
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                        <th className="py-2.5 px-3">Product Name & SKU</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Batch #</th>
                        <th className="py-2.5 px-3 text-center whitespace-nowrap">Purchased Qty</th>
                        <th className="py-2.5 px-3 text-center whitespace-nowrap">Returned Qty</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Unit Cost</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap font-bold">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(viewingPurchase.lines || []).map((l: any, i: number) => (
                        <tr key={l.id || i} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            <div className="font-bold">{l.itemName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{l.itemSku}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {l.batchNumber || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-800">
                            {l.quantity}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-amber-700">
                            {l.returnedQuantity || 0}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            PKR {formatPKR(l.historicalCostSnapshot || l.landedUnitCost || l.unitPurchaseCost || 0)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-900 font-mono">
                            PKR {formatPKR(l.lineTotal || (l.quantity * (l.unitPurchaseCost || 0)))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Previous Returns History */}
              {viewingPurchase.returns && viewingPurchase.returns.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Purchase Returns Log ({viewingPurchase.returns.length} returns recorded)</span>
                  </h3>
                  <div className="border border-amber-200/80 rounded-2xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-amber-50/50 border-b border-amber-200/60 text-amber-900 font-bold text-[11px] uppercase tracking-wider">
                          <th className="py-2 px-3 whitespace-nowrap">Return #</th>
                          <th className="py-2 px-3 whitespace-nowrap">Date</th>
                          <th className="py-2 px-3">Reason</th>
                          <th className="py-2 px-3">Settlement</th>
                          <th className="py-2 px-3 text-right whitespace-nowrap font-bold">Total Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100/60">
                        {viewingPurchase.returns.map((ret: any) => (
                          <tr key={ret.id} className="hover:bg-amber-50/20">
                            <td className="py-2 px-3 font-mono font-bold text-amber-900">
                              {ret.returnNumber}
                            </td>
                            <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                              {formatDate(ret.returnDate)}
                            </td>
                            <td className="py-2 px-3 text-slate-700">
                              {ret.reason} {ret.notes ? `(${ret.notes})` : ''}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-white border border-amber-200 text-amber-800">
                                {ret.refundTreatment}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-amber-900 font-mono">
                              PKR {formatPKR(ret.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
              <div className="flex items-center gap-2">
                {viewingPurchase.supplierId && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsDetailsModalOpen(false);
                      navigate(`/operations/supplier-ledger?supplierId=${viewingPurchase.supplierId}`);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-[#B82E69] bg-white border border-slate-200 hover:bg-slate-50 rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>View Supplier Khata</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    handleOpenReturnModal(viewingPurchase);
                  }}
                  className="px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                  <span>Return to Supplier</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsDetailsModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-xl cursor-pointer"
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
export default StockInPurchasesPage;
