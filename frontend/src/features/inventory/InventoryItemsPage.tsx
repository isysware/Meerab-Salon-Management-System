import { BranchActionField } from '@/components/BranchActionField';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import { toast } from '@/context/ToastContext';
import {
  InventoryItem,
  InventoryBatch,
  ItemType,
  UnitOfMeasure,
  TaxTreatment,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { InventoryNavHeader } from './InventoryNavHeader';
import { LuxurySelect } from '@/components/ui';
import {
  Boxes,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Banknote,
  Package,
  Layers,
  Edit2,
  ArrowDownRight,
  Loader2,
  Barcode,
  X,
} from 'lucide-react';

const formatPKR = (amt: number) => {
  return (Number(amt) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const InventoryItemsPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();
  const { navigate } = useRouter();

  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/operations/inventory" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const defaultBranchId = isSuperAdmin
    ? (activeBranchId !== 'ALL' ? activeBranchId : allBranches[0]?.id || '')
    : (user.branchId || '');

  const [selectedBranchId, setSelectedBranchId] = useState<string>(defaultBranchId);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, { currentStock: number; valuation: number }>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockStatusFilter, setStockStatusFilter] = useState<'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'>('ALL');

  const [formBranchId, setFormBranchId] = useState(isSuperAdmin ? '' : user.branchId || '');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    sku: string;
    barcode: string;
    category: string;
    itemType: ItemType;
    purchaseUnit: UnitOfMeasure;
    issueUnit: UnitOfMeasure;
    defaultPurchaseCost: number;
    sellingPrice: number;
    minStockLevel: number;
    openingStock: number;
    openingCost: number;
  }>({
    name: '',
    sku: '',
    barcode: '',
    category: 'Hair Care',
    itemType: 'RETAIL_PRODUCT',
    purchaseUnit: 'BOTTLE',
    issueUnit: 'BOTTLE',
    defaultPurchaseCost: 0,
    sellingPrice: 0,
    minStockLevel: 5,
    openingStock: 0,
    openingCost: 0,
  });

  const loadData = useCallback(async (bId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [itemList, batchList] = await Promise.all([
        salonService.getInventoryItems(bId || 'ALL', user),
        salonService.getInventoryBatches(bId || 'ALL', undefined, user).catch(() => []),
      ]);
      setItems(itemList);
      setBatches(batchList);

      // Build stock map from batch quantities
      const smap: Record<string, { currentStock: number; valuation: number }> = {};
      itemList.forEach((it) => {
        const itemBatches = batchList.filter((b) => b.itemId === it.id && (bId === 'ALL' || b.branchId === bId));
        const currentQty = itemBatches.reduce((sum, b) => sum + (b.remainingQuantity || 0), 0);
        const val = itemBatches.reduce(
          (sum, b) => sum + (b.remainingQuantity || 0) * (b.unitCostSnapshot || it.defaultPurchaseCost || 0),
          0
        );
        smap[it.id] = { currentStock: currentQty, valuation: val };
      });
      setStockMap(smap);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load inventory items.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData(selectedBranchId);
  }, [loadData, selectedBranchId]);

  const handleBranchChange = (newBranchId: string) => {
    setSelectedBranchId(newBranchId);
  };

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set);
  }, [items]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const matches =
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          (item.barcode && item.barcode.toLowerCase().includes(q)) ||
          item.category.toLowerCase().includes(q);
        if (!matches) return false;
      }

      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
        return false;
      }

      const currentStock = stockMap[item.id]?.currentStock ?? 0;
      if (stockStatusFilter === 'OUT_OF_STOCK' && currentStock > 0) return false;
      if (stockStatusFilter === 'LOW_STOCK' && (currentStock <= 0 || currentStock > item.minStockLevel)) return false;
      if (stockStatusFilter === 'IN_STOCK' && currentStock <= item.minStockLevel) return false;

      return true;
    });
  }, [items, searchQuery, selectedCategory, stockStatusFilter, stockMap]);

  // KPIs
  const kpis = useMemo(() => {
    let totalStockValuation = 0;
    let totalItems = items.length;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    items.forEach((it) => {
      const stock = stockMap[it.id]?.currentStock ?? 0;
      const val = stockMap[it.id]?.valuation ?? (stock * (it.defaultPurchaseCost || 0));
      totalStockValuation += val;

      if (stock <= 0) {
        outOfStockCount++;
      } else if (stock <= it.minStockLevel) {
        lowStockCount++;
      }
    });

    return {
      totalItems,
      inStockCount: totalItems - outOfStockCount,
      lowStockCount,
      outOfStockCount,
      totalStockValuation,
    };
  }, [items, stockMap]);

  // Modal Handlers
  const handleOpenAddModal = () => {
    setFormBranchId(isSuperAdmin ? '' : user.branchId || '');
    setEditingItem(null);
    setFormData({
      name: '',
      sku: '',
      barcode: '',
      category: 'Hair Care',
      itemType: 'RETAIL_PRODUCT',
      purchaseUnit: 'BOTTLE',
      issueUnit: 'BOTTLE',
      defaultPurchaseCost: 0,
      sellingPrice: 0,
      minStockLevel: 5,
      openingStock: 0,
      openingCost: 0,
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      sku: item.sku,
      barcode: item.barcode || '',
      category: item.category,
      itemType: item.itemType,
      purchaseUnit: item.purchaseUnit,
      issueUnit: item.issueUnit,
      defaultPurchaseCost: item.defaultPurchaseCost,
      sellingPrice: item.sellingPrice,
      minStockLevel: item.minStockLevel,
      openingStock: 0,
      openingCost: 0,
    });
    setIsModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem && (!formBranchId || formBranchId === 'ALL' || !allBranches.some((b) => b.id === formBranchId))) {
      toast.error('Please select a branch for this product.');
      return;
    }
    if (!formData.name?.trim()) {
      toast.error('Product name is required.');
      return;
    }

    try {
      if (editingItem) {
        await salonService.updateInventoryItem(
          editingItem.id,
          {
            name: formData.name,
            category: formData.category,
            itemType: formData.itemType,
            purchaseUnit: formData.purchaseUnit,
            issueUnit: formData.issueUnit,
            defaultPurchaseCost: Number(formData.defaultPurchaseCost) || 0,
            sellingPrice: Number(formData.sellingPrice) || 0,
            price: Number(formData.sellingPrice) || 0,
            minStockLevel: Number(formData.minStockLevel) || 1,
            barcode: formData.barcode || undefined,
          },
          user
        );
        const msg = `Product "${formData.name}" updated successfully.`;
        setSuccessMessage(msg);
        toast.success(msg);
      } else {
        const openingStock = Math.max(0, Number(formData.openingStock) || 0);
        const openingCost = Number(formData.openingCost || formData.defaultPurchaseCost || 0);

        await salonService.createInventoryItem(
          {
            branchAvailability: [formBranchId],
            name: formData.name,
            sku: formData.sku || '',
            code: formData.sku || '',
            barcode: formData.barcode || undefined,
            category: formData.category || 'General',
            itemType: formData.itemType,
            purchaseUnit: formData.purchaseUnit,
            issueUnit: formData.issueUnit,
            defaultPurchaseCost: Number(formData.defaultPurchaseCost) || 0,
            sellingPrice: Number(formData.sellingPrice) || 0,
            price: Number(formData.sellingPrice) || 0,
            minStockLevel: Number(formData.minStockLevel) || 5,
            openingStock,
            openingQuantity: openingStock,
            openingCost,
            branchId: formBranchId,
            taxTreatment: 'BRANCH_DEFAULT',
            trackBatch: true,
            trackExpiry: true,
            nearExpiryAlertDays: 60,
            isActive: true,
          },
          user
        );
        const stockNote = openingStock > 0 ? ` with opening stock of ${openingStock} ${formData.purchaseUnit}` : '';
        const msg = `New product "${formData.name}" added to catalogue${stockNote}.`;
        setSuccessMessage(msg);
        toast.success(msg);
      }
      setIsModalOpen(false);
      loadData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to save product.';
      setErrorMessage(errMsg);
      toast.error(errMsg);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Shared Navigation Header */}
      <InventoryNavHeader
        title="Inventory & Stocks"
        subtitle="Manage product catalogue, current stock levels on hand, retail pricing and inventory valuation."
        icon={<Boxes className="w-6 h-6 text-[#B82E69]" />}
        activePath="/operations/inventory"
        selectedBranchId={selectedBranchId}
        onBranchChange={handleBranchChange}
        primaryAction={{
          label: 'Add New Product',
          icon: <Plus className="w-4 h-4" />,
          onClick: handleOpenAddModal,
        }}
        secondaryAction={{
          label: 'Stock In (Purchases)',
          icon: <ArrowDownRight className="w-4 h-4 text-[#B82E69]" />,
          onClick: () => navigate('/operations/stock-in'),
        }}
      />

      {/* KPI Cards: Pure White Frosted Glass (Zero Wavy Lines, Zero Watermarks) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Products */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Total Products
            </span>
            <div className="w-8 h-8 rounded-2xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-[#18191B] tracking-tight">
            {kpis.totalItems}
          </div>
          <div className="text-[11px] font-medium text-slate-400 mt-1 truncate">
            {kpis.inStockCount} active in stock
          </div>
        </div>

        {/* Total Valuation */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Stock Valuation
            </span>
            <div className="w-8 h-8 rounded-2xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-emerald-600 shrink-0">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-[#18191B] tracking-tight truncate">
            PKR {formatPKR(kpis.totalStockValuation)}
          </div>
          <div className="text-[11px] font-semibold text-emerald-600 mt-1 truncate">
            Cost value on hand
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-amber-700/80 uppercase tracking-wider">
              Low Stock Alerts
            </span>
            <div className="w-8 h-8 rounded-2xl bg-amber-50/80 border border-amber-200/50 shadow-2xs flex items-center justify-center text-amber-600 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-950 tracking-tight">
            {kpis.lowStockCount}
          </div>
          <div className="text-[11px] font-semibold text-amber-700 mt-1 truncate">
            At or below threshold
          </div>
        </div>

        {/* Out of Stock */}
        <div className="group relative overflow-hidden rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:bg-white/85 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-rose-700/80 uppercase tracking-wider">
              Out of Stock
            </span>
            <div className="w-8 h-8 rounded-2xl bg-rose-50/80 border border-rose-200/50 shadow-2xs flex items-center justify-center text-rose-600 shrink-0">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-rose-950 tracking-tight">
            {kpis.outOfStockCount}
          </div>
          <div className="text-[11px] font-semibold text-rose-700 mt-1 truncate">
            Requires urgent re-order
          </div>
        </div>
      </div>

      {/* Filter and Search Bar: Frosted Card */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search by product name, SKU, barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-10 pr-4 py-2.5 rounded-2xl border border-white/90 bg-white/70 backdrop-blur-xl focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-[#B82E69]/10 text-[#18191B] font-medium shadow-2xs transition-all placeholder:text-slate-400"
            />
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {/* Category Filter */}
            <LuxurySelect
              value={selectedCategory}
              onValueChange={setSelectedCategory}
              options={[
                { value: 'ALL', label: 'All Categories' },
                ...categories.map((c) => ({ value: c, label: c })),
              ]}
              triggerClassName="w-44 text-xs font-semibold rounded-2xl border-white/90 bg-white/70 backdrop-blur-xl"
            />

            {/* Stock Level Filter */}
            <LuxurySelect
              value={stockStatusFilter}
              onValueChange={(val) => setStockStatusFilter(val as any)}
              options={[
                { value: 'ALL', label: 'All Stock Levels' },
                { value: 'IN_STOCK', label: 'In Stock' },
                { value: 'LOW_STOCK', label: 'Low Stock' },
                { value: 'OUT_OF_STOCK', label: 'Out of Stock' },
              ]}
              triggerClassName="w-44 text-xs font-semibold rounded-2xl border-white/90 bg-white/70 backdrop-blur-xl"
            />
          </div>
        </div>
      </div>

      {/* Main Table: Luxury Frosted Container */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3 bg-white/50 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69]">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#18191B] tracking-tight">
                Product Catalogue & Stock Levels
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                {filteredItems.length} products listed in active branch
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="text-xs font-bold px-3.5 py-2 bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02359] hover:to-[#851C47] text-white rounded-xl shadow-[0_4px_14px_rgba(184,46,105,0.2)] transition-all flex items-center gap-1.5 cursor-pointer active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Product</span>
          </button>
        </div>

        {isLoading ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 rounded-full border-3 border-[#F1DEE3] border-t-[#B82E69] animate-spin mb-3" />
            <p className="text-slate-600 text-sm font-medium">Loading inventory catalogue...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/90 border border-white/80 shadow-2xs flex items-center justify-center text-slate-400 mb-3">
              <Boxes className="w-7 h-7 stroke-[1.5]" />
            </div>
            <p className="text-[#18191B] text-sm font-bold mb-1">No products found</p>
            <p className="text-slate-400 text-xs mb-4">Add your first product to begin tracking salon inventory.</p>
            <button
              onClick={handleOpenAddModal}
              className="text-xs font-bold px-4 py-2 bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-white rounded-xl shadow-[0_4px_14px_rgba(184,46,105,0.2)] hover:shadow-[0_6px_20px_rgba(184,46,105,0.3)] transition-all cursor-pointer"
            >
              Add Product Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-400 font-bold text-[11px] uppercase tracking-wider">
                  <th className="py-3.5 px-4 text-center w-12">#</th>
                  <th className="py-3.5 px-4 min-w-[200px]">Product Name & SKU</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Category</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Item Type</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Purchase Cost</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Retail Price</th>
                  <th className="py-3.5 px-4 text-center whitespace-nowrap font-bold">Stock on Hand</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Stock Valuation</th>
                  <th className="py-3.5 px-4 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {filteredItems.map((item, idx) => {
                  const currentStock = stockMap[item.id]?.currentStock ?? 0;
                  const valuation = stockMap[item.id]?.valuation ?? (currentStock * (item.defaultPurchaseCost || 0));
                  const isOut = currentStock <= 0;
                  const isLow = currentStock > 0 && currentStock <= item.minStockLevel;

                  return (
                    <tr key={item.id} className="hover:bg-rose-50/20 transition-colors">
                      <td className="py-3.5 px-4 text-center text-slate-400 font-medium">
                        {idx + 1}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#18191B]">{item.name}</div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                          <span>SKU: {item.sku}</span>
                          {item.barcode && <span>• Barcode: {item.barcode}</span>}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/90 border border-white/80 shadow-2xs text-[#18191B]">
                          {item.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                        {item.itemType === 'RETAIL_PRODUCT' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-2xs">
                            Retail Product
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60 shadow-2xs">
                            Salon Consumable
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right text-slate-700 whitespace-nowrap font-medium">
                        PKR {formatPKR(item.defaultPurchaseCost)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-[#18191B] whitespace-nowrap">
                        PKR {formatPKR(item.sellingPrice)}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/60 shadow-2xs">
                            0 {item.purchaseUnit} (Out of Stock)
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200/60 shadow-2xs">
                            {currentStock} {item.purchaseUnit} (Low Stock)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-2xs">
                            {currentStock} {item.purchaseUnit}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-[#18191B] whitespace-nowrap">
                        PKR {formatPKR(valuation)}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(item)}
                            title="Edit Product"
                            className="p-1.5 text-slate-400 hover:text-[#B82E69] hover:bg-white rounded-xl transition-all shadow-2xs cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('/operations/stock-in')}
                            title="Quick Stock In"
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-white rounded-xl transition-all shadow-2xs cursor-pointer"
                          >
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#18191B]/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="rounded-[28px] border border-white/90 bg-white/95 backdrop-blur-2xl shadow-[0_25px_60px_rgba(35,21,29,0.15)] max-w-lg w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#18191B]">
                {editingItem ? 'Edit Product' : 'Add New Product'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4 pt-4">
              {!editingItem && <BranchActionField value={formBranchId} onChange={setFormBranchId} />}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. L'Oreal Keratin Shampoo 500ml"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-xs px-3.5 py-2.5 rounded-2xl border border-white/90 bg-white/80 focus:bg-white focus:outline-hidden focus:ring-4 focus:ring-[#B82E69]/10 text-[#18191B] font-medium shadow-2xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    SKU Code
                  </label>
                  <input
                    type="text"
                    value={formData.sku || ''}
                    placeholder="Assigned automatically on save"
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Barcode (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Scan or enter barcode"
                    value={formData.barcode || ''}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Hair Care, Skin Care"
                    value={formData.category || ''}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
                <div>
                  <LuxurySelect
                    label="Item Type"
                    value={formData.itemType}
                    onValueChange={(val) => setFormData({ ...formData, itemType: val as any })}
                    options={[
                      { value: 'RETAIL_PRODUCT', label: 'Retail Product (Sell)' },
                      { value: 'SALON_CONSUMABLE', label: 'Salon Consumable (Service)' },
                    ]}
                    triggerClassName="h-9 rounded-xl border border-slate-300 bg-white text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <LuxurySelect
                    label="Unit"
                    value={formData.purchaseUnit}
                    onValueChange={(val) => setFormData({ ...formData, purchaseUnit: val as any, issueUnit: val as any })}
                    options={[
                      { value: 'BOTTLE', label: 'Bottle' },
                      { value: 'PIECE', label: 'Piece' },
                      { value: 'BOX', label: 'Box' },
                      { value: 'JAR', label: 'Jar' },
                      { value: 'TUBE', label: 'Tube' },
                      { value: 'PACKET', label: 'Packet' },
                      { value: 'ML', label: 'ML' },
                      { value: 'GRAM', label: 'Gram' },
                    ]}
                    triggerClassName="h-9 rounded-xl border border-slate-300 bg-white text-xs font-semibold px-2.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cost (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.defaultPurchaseCost || 0}
                    onChange={(e) => setFormData({ ...formData, defaultPurchaseCost: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Retail (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.sellingPrice || 0}
                    onChange={(e) => setFormData({ ...formData, sellingPrice: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Alert Level
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.minStockLevel || 5}
                    onChange={(e) => setFormData({ ...formData, minStockLevel: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                  />
                </div>
              </div>

              {!editingItem && (
                <div className="bg-gradient-to-r from-blue-50/80 to-slate-50 border border-[#F1DEE3]/90 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#23151D] flex items-center gap-1.5">
                      <Boxes className="w-3.5 h-3.5 text-[#9D2558]" />
                      <span>Opening Stock on Hand (Initial Inventory)</span>
                    </span>
                    <span className="text-[10px] font-semibold text-[#9D2558] bg-white px-2 py-0.5 rounded-md border border-[#F1DEE3]">
                      Auto-initializes Stock
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Opening Quantity ({formData.purchaseUnit}) *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0 (Units on shelf)"
                        value={formData.openingStock === 0 ? '' : formData.openingStock}
                        onChange={(e) => setFormData({ ...formData, openingStock: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        How many units are currently in stock?
                      </p>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Opening Unit Cost (PKR)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={String(formData.defaultPurchaseCost || 0)}
                        value={formData.openingCost === 0 ? '' : formData.openingCost}
                        onChange={(e) => setFormData({ ...formData, openingCost: Number(e.target.value) || 0 })}
                        className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Unit purchase value (Default: PKR {formatPKR(formData.defaultPurchaseCost || 0)})
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 rounded-2xl border border-white/90 bg-white/80 hover:bg-white shadow-2xs cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02359] hover:to-[#851C47] rounded-2xl shadow-[0_4px_14px_rgba(184,46,105,0.25)] transition-all cursor-pointer active:scale-[0.98]"
                >
                  {editingItem ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default InventoryItemsPage;
