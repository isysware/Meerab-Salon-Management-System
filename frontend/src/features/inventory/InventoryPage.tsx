import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { toast } from '@/context/ToastContext';
import {
  InventoryItem,
  InventoryBatch,
  BatchStatus,
  Supplier,
  SupplierLedgerEntry,
  Purchase,
  PurchaseLineItem,
  PurchasePaymentMethod,
  StockMovement,
  StockSettlement,
  StockSettlementLine,
  ItemType,
  UnitOfMeasure,
  TaxTreatment,
  Branch,
  PaymentAccount,
  CashDrawer,
  StaffMember,
  ConsumptionPreview,
  CreateInventoryItemInput,
  CreatePurchaseInput,
  PaySupplierInput,
  CreateSupplierReturnInput,
  CreateManualStockOutInput,
  CreateStockSettlementInput,
} from '@/types/salon';
import { AccessDeniedView } from '@/features/scaffold/AccessDeniedView';
import { formatCurrency } from '@/lib/formatters';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Package,
  Boxes,
  Truck,
  ArrowDownRight,
  ArrowUpRight,
  Plus,
  Search,
  Filter,
  DollarSign,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  Layers,
  Archive,
  RefreshCw,
  Building2,
  ArrowRightLeft,
  FileText,
  CreditCard,
  Banknote,
  ShieldAlert,
  RotateCcw,
  Edit,
  Trash2,
  Eye,
  X,
  History,
} from 'lucide-react';

export const InventoryPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();

  // Role Guard: SUPER_ADMIN, ADMIN, and ACCOUNTANT (Accountant can view / pay suppliers)
  if (!user || user.role === 'STAFF') {
    return <AccessDeniedView attemptedPath="/operations/inventory-suppliers" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isAccountant = user.role === 'ACCOUNTANT';
  const isAdmin = user.role === 'ADMIN' || isSuperAdmin;

  const currentSelectedBranchId = isSuperAdmin
    ? (activeBranchId !== 'ALL' ? activeBranchId : allBranches[0]?.id || '')
    : (user.branchId as string);

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentSelectedBranchId);

  useEffect(() => {
    if (isSuperAdmin && activeBranchId !== 'ALL') {
      setSelectedBranchId(activeBranchId);
    }
  }, [activeBranchId, isSuperAdmin]);

  // Main Tab State
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'ITEMS' | 'PURCHASES' | 'SUPPLIERS' | 'MOVEMENTS' | 'SETTLEMENT'>('OVERVIEW');

  // Loading & Error States
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Data Collections
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [allInventoryItems, setAllInventoryItems] = useState<InventoryItem[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, { currentStock: number; valuation: number }>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [settlements, setSettlements] = useState<StockSettlement[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [activeDrawer, setActiveDrawer] = useState<CashDrawer | null>(null);

  // Summary Metrics
  const [summaryData, setSummaryData] = useState<{
    totalValuationCost: number;
    totalRetailPotential: number;
    lowStockCount: number;
    outOfStockCount: number;
    nearExpiryCount: number;
    totalSupplierPayables: number;
  }>({
    totalValuationCost: 0,
    totalRetailPotential: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    nearExpiryCount: 0,
    totalSupplierPayables: 0,
  });

  // Load All Branch Inventory Data
  const loadInventoryData = async (bId: string) => {
    setIsLoading(true);
    setActionError(null);
    try {
      const [items, allItems, sups, purs, moves, stls, bts, accs, drawers, staffs] = await Promise.all([
        salonService.getInventoryItems(bId, user),
        salonService.getInventoryItems('ALL', user),
        salonService.getSuppliers(bId, user),
        salonService.getPurchases(bId, user),
        salonService.getStockMovements(bId, undefined, user),
        salonService.getStockSettlements(bId, user),
        salonService.getInventoryBatches(bId, undefined, user),
        salonService.getPaymentAccounts(bId),
        salonService.getCashDrawers(bId),
        salonService.getStaffMembers(bId || 'ALL', user).catch(() => []),
      ]);

      setInventoryItems(items);
      setAllInventoryItems(allItems);
      setSuppliers(sups);
      setPurchases(purs);
      setStockMovements(moves);
      setSettlements(stls);
      setBatches(bts);
      setPaymentAccounts(accs);
      setStaffList(staffs || []);

      // Find active drawer for current authenticated user
      const userDrawer = drawers.find((d) => d.status === 'OPEN' && d.custodianUserId === user.id) || null;
      setActiveDrawer(userDrawer);

      // Compute Stock Map for each item
      const sMap: Record<string, { currentStock: number; valuation: number }> = {};
      let totalCostVal = 0;
      let totalRetailVal = 0;
      let lowCount = 0;
      let outCount = 0;

      for (const item of items) {
        const itemBatches = bts.filter((b) => b.itemId === item.id && (bId === 'ALL' || b.branchId === bId));
        const currentQty = itemBatches.reduce((sum, b) => sum + (b.remainingQuantity || 0), 0);
        const itemVal = itemBatches.reduce((sum, b) => sum + (b.remainingQuantity || 0) * (b.unitCostSnapshot ?? item.defaultPurchaseCost), 0);

        sMap[item.id] = { currentStock: currentQty, valuation: itemVal };
        totalCostVal += itemVal;
        const isConsumable = item.itemType === 'SALON_CONSUMABLE';
        totalRetailVal += isConsumable ? 0 : itemBatches.reduce((sum, b) => sum + (b.remainingQuantity || 0) * (b.sellingPrice ?? item.sellingPrice ?? 0), 0);

        if (currentQty <= 0) {
          outCount++;
        } else if (currentQty <= item.minStockLevel) {
          lowCount++;
        }
      }
      setStockMap(sMap);

      const nearExpCount = bts.filter((b) => b.status === 'NEAR_EXPIRY' || b.status === 'EXPIRED').length;
      const totalPayable = sups.reduce((sum, s) => sum + Math.max(0, s.currentBalance || 0), 0);

      setSummaryData({
        totalValuationCost: totalCostVal,
        totalRetailPotential: totalRetailVal,
        lowStockCount: lowCount,
        outOfStockCount: outCount,
        nearExpiryCount: nearExpCount,
        totalSupplierPayables: totalPayable,
      });
    } catch (err: any) {
      console.error('Failed to load inventory data:', err);
      setActionError(err.message || 'Failed to load inventory data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBranchId) {
      loadInventoryData(selectedBranchId);
    }
  }, [selectedBranchId]);

  // Filters for Item Master
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState<'ALL' | ItemType>('ALL');
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('ALL');
  const [itemStatusFilter, setItemStatusFilter] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL'>('ACTIVE');

  const filteredItems = useMemo(() => {
    return inventoryItems.filter((i) => {
      const matchesSearch =
        i.name.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
        i.sku.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
        (i.barcode && i.barcode.toLowerCase().includes(itemSearchQuery.toLowerCase()));
      const matchesType = itemTypeFilter === 'ALL' || i.itemType === itemTypeFilter;
      const matchesCat = itemCategoryFilter === 'ALL' || i.category === itemCategoryFilter;
      const matchesStatus =
        itemStatusFilter === 'ALL'
          ? true
          : itemStatusFilter === 'ACTIVE'
          ? i.isActive
          : !i.isActive;
      return matchesSearch && matchesType && matchesCat && matchesStatus;
    });
  }, [inventoryItems, itemSearchQuery, itemTypeFilter, itemCategoryFilter, itemStatusFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    inventoryItems.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set);
  }, [inventoryItems]);

  // ----------------------------------------------------
  // ITEM MASTER MODAL (Create / Edit)
  // ----------------------------------------------------
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [itemFormData, setItemFormData] = useState<Partial<CreateInventoryItemInput>>({
    name: '',
    sku: '',
    code: '',
    barcode: '',
    category: 'HAIR_CARE',
    description: '',
    brand: '',
    itemType: 'RETAIL_PRODUCT',
    defaultPurchaseCost: 0,
    sellingPrice: 0,
    purchaseUnit: 'PIECE',
    issueUnit: 'PIECE',
    unitConversionRatio: 1,
    taxTreatment: 'BRANCH_DEFAULT',
    minStockLevel: 5,
    trackBatch: true,
    trackExpiry: true,
    nearExpiryAlertDays: 60,
    branchAvailability: ['ALL'],
    isActive: true,
  });

  const generateNextSku = (currentList: InventoryItem[] = (allInventoryItems.length > 0 ? allInventoryItems : inventoryItems)) => {
    let maxNum = 0;
    const existingCodes = new Set(
      currentList
        .map((i) => (i.sku || i.code || '').trim().toUpperCase())
        .filter(Boolean) as string[]
    );

    for (const item of currentList) {
      const code = item.sku || item.code;
      if (!code) continue;
      const m = code.match(/(\d+)$/);
      if (m) {
        const val = parseInt(m[1], 10);
        if (!isNaN(val) && val > maxNum) maxNum = val;
      }
    }

    let nextNum = maxNum + 1;
    let candidate = `SKU-${String(nextNum).padStart(4, '0')}`;
    while (existingCodes.has(candidate)) {
      nextNum++;
      candidate = `SKU-${String(nextNum).padStart(4, '0')}`;
    }
    return candidate;
  };

  const handleOpenCreateItem = () => {
    setEditingItem(null);
    const nextSku = generateNextSku(allInventoryItems.length > 0 ? allInventoryItems : inventoryItems);
    setItemFormData({
      name: '',
      sku: nextSku,
      code: nextSku,
      barcode: '',
      category: 'HAIR_CARE',
      description: '',
      brand: '',
      itemType: 'RETAIL_PRODUCT',
      defaultPurchaseCost: 0,
      sellingPrice: 0,
      purchaseUnit: 'PIECE',
      issueUnit: 'PIECE',
      unitConversionRatio: 1,
      taxTreatment: 'BRANCH_DEFAULT',
      minStockLevel: 5,
      trackBatch: true,
      trackExpiry: true,
      nearExpiryAlertDays: 60,
      branchAvailability: [selectedBranchId],
      isActive: true,
    });
    setIsItemModalOpen(true);
  };

  const handleOpenEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setItemFormData({
      name: item.name,
      sku: item.sku,
      code: item.code || item.sku,
      barcode: item.barcode || '',
      category: item.category,
      description: item.description || '',
      brand: item.brand || '',
      itemType: item.itemType,
      defaultPurchaseCost: item.defaultPurchaseCost,
      sellingPrice: item.itemType === 'SALON_CONSUMABLE' ? 0 : item.sellingPrice,
      purchaseUnit: item.purchaseUnit,
      issueUnit: item.issueUnit,
      unitConversionRatio: item.unitConversionRatio || 1,
      taxTreatment: item.taxTreatment,
      minStockLevel: item.minStockLevel,
      trackBatch: item.trackBatch,
      trackExpiry: item.trackExpiry,
      nearExpiryAlertDays: item.nearExpiryAlertDays,
      branchAvailability: item.branchAvailability,
      isActive: item.isActive,
    });
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async () => {
    try {
      setActionError(null);
      if (!itemFormData.name || !itemFormData.sku) {
        throw new Error('Item name and SKU are required.');
      }
      const isConsumable = itemFormData.itemType === 'SALON_CONSUMABLE';
      const effectiveSellingPrice = isConsumable ? 0 : Number(itemFormData.sellingPrice) || 0;

      if (editingItem) {
        await salonService.updateInventoryItem(
          editingItem.id,
          {
            ...itemFormData,
            code: itemFormData.code || itemFormData.sku,
            sellingPrice: effectiveSellingPrice,
            price: effectiveSellingPrice,
          },
          user
        );
        const msg = `Updated item '${itemFormData.name}' successfully.`;
        setActionSuccess(msg);
        toast.success(msg);
      } else {
        await salonService.createInventoryItem(
          {
            name: itemFormData.name!,
            sku: itemFormData.sku!,
            code: itemFormData.code || itemFormData.sku!,
            barcode: itemFormData.barcode,
            category: itemFormData.category || 'General',
            description: itemFormData.description,
            brand: itemFormData.brand,
            itemType: itemFormData.itemType || 'RETAIL_PRODUCT',
            defaultPurchaseCost: Number(itemFormData.defaultPurchaseCost) || 0,
            sellingPrice: effectiveSellingPrice,
            price: effectiveSellingPrice,
            purchaseUnit: itemFormData.purchaseUnit || 'PIECE',
            issueUnit: itemFormData.issueUnit || 'PIECE',
            unitConversionRatio: Number(itemFormData.unitConversionRatio) || 1,
            taxTreatment: itemFormData.taxTreatment || 'BRANCH_DEFAULT',
            minStockLevel: isNaN(Number(itemFormData.minStockLevel)) ? 5 : Number(itemFormData.minStockLevel),
            trackBatch: Boolean(itemFormData.trackBatch),
            trackExpiry: Boolean(itemFormData.trackExpiry),
            nearExpiryAlertDays: Number(itemFormData.nearExpiryAlertDays) || 60,
            branchAvailability: itemFormData.branchAvailability || ['ALL'],
            openingStock: Number(itemFormData.openingStock) || 0,
            openingQuantity: Number(itemFormData.openingStock) || 0,
            openingCost: Number(itemFormData.openingCost || itemFormData.defaultPurchaseCost) || 0,
            branchId: selectedBranchId,
            isActive: true,
          },
          user
        );
        const opStock = Number(itemFormData.openingStock) || 0;
        const msg = `Created item '${itemFormData.name}'${opStock > 0 ? ` with opening stock of ${opStock} units` : ''}.`;
        setActionSuccess(msg);
        toast.success(msg);
      }
      setIsItemModalOpen(false);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to save item';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  // ----------------------------------------------------
  // BATCH DETAILS DRAWER
  // ----------------------------------------------------
  const [selectedItemForBatches, setSelectedItemForBatches] = useState<InventoryItem | null>(null);
  const [isBatchDrawerOpen, setIsBatchDrawerOpen] = useState(false);

  const activeItemBatches = useMemo(() => {
    if (!selectedItemForBatches) return [];
    return batches.filter(
      (b) => b.itemId === selectedItemForBatches.id && b.branchId === selectedBranchId
    );
  }, [batches, selectedItemForBatches, selectedBranchId]);

  const handleToggleBatchQuarantine = async (batchId: string, currentStatus: BatchStatus) => {
    try {
      if (currentStatus === 'QUARANTINED') {
        await salonService.unquarantineBatch(batchId, user);
        const msg = 'Batch released from quarantine to VALID.';
        setActionSuccess(msg);
        toast.success(msg);
      } else {
        await salonService.quarantineBatch(batchId, 'Manual quarantine from inventory manager', user);
        const msg = 'Batch successfully moved to QUARANTINED status.';
        setActionSuccess(msg);
        toast.success(msg);
      }
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to update batch status';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  // ----------------------------------------------------
  // PURCHASES / STOCK-IN MODAL
  // ----------------------------------------------------
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('');
  const [purchaseInvoiceNumber, setPurchaseInvoiceNumber] = useState('');
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState<PurchasePaymentMethod>('CREDIT');
  const [purchasePaidAmount, setPurchasePaidAmount] = useState<number>(0);
  const [purchasePaymentAccountId, setPurchasePaymentAccountId] = useState<string>('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [purchaseLines, setPurchaseLines] = useState<
    Array<{
      itemId: string;
      batchNumber: string;
      mfgDate?: string;
      expiryDate?: string;
      quantity: number;
      unitPurchaseCost: number;
    }>
  >([]);

  const handleOpenCreatePurchase = () => {
    setPurchaseSupplierId(suppliers[0]?.id || '');
    setPurchaseInvoiceNumber('');
    setPurchasePaymentMethod('CREDIT');
    setPurchasePaidAmount(0);
    setPurchasePaymentAccountId(paymentAccounts[0]?.id || '');
    setPurchaseNotes('');
    setPurchaseLines([
      {
        itemId: inventoryItems[0]?.id || '',
        batchNumber: '',
        quantity: 10,
        unitPurchaseCost: inventoryItems[0]?.defaultPurchaseCost ?? 0,
      },
    ]);
    setIsPurchaseModalOpen(true);
  };

  const handleAddPurchaseLine = () => {
    setPurchaseLines((prev) => [
      ...prev,
      {
        itemId: inventoryItems[0]?.id || '',
        batchNumber: '',
        quantity: 1,
        unitPurchaseCost: inventoryItems[0]?.defaultPurchaseCost ?? 0,
      },
    ]);
  };

  const handleRemovePurchaseLine = (index: number) => {
    setPurchaseLines((prev) => prev.filter((_, idx) => idx !== index));
  };

  const purchaseCalculatedTotal = useMemo(() => {
    return purchaseLines.reduce((sum, line) => sum + (line.quantity || 0) * (line.unitPurchaseCost || 0), 0);
  }, [purchaseLines]);

  const handleSavePurchase = async () => {
    try {
      setActionError(null);
      if (!purchaseSupplierId) throw new Error('Please select a supplier.');
      if (purchaseLines.length === 0) throw new Error('Please add at least one line item.');

      // Validations for cash drawer if cash is used
      if (purchasePaymentMethod === 'CASH' || (purchasePaymentMethod === 'PARTIAL' && purchasePaidAmount > 0)) {
        if (!activeDrawer) {
          throw new Error('Cash purchase requires an active OPEN cash drawer in your custody.');
        }
      }

      const input: CreatePurchaseInput = {
        branchId: selectedBranchId,
        supplierId: purchaseSupplierId,
        invoiceNumber: purchaseInvoiceNumber,
        purchaseDate: new Date().toISOString().split('T')[0],
        paymentMethod: purchasePaymentMethod,
        paidAmount: purchasePaymentMethod === 'CREDIT' ? 0 : purchasePaidAmount,
        paymentAccountId: purchasePaymentMethod === 'ONLINE' ? purchasePaymentAccountId : undefined,
        payerDrawerId: purchasePaymentMethod === 'CASH' ? activeDrawer?.id : undefined,
        notes: purchaseNotes,
        lines: purchaseLines.map((l) => ({
          itemId: l.itemId,
          batchNumber: l.batchNumber,
          mfgDate: l.mfgDate,
          expiryDate: l.expiryDate,
          quantity: Number(l.quantity),
          unitPurchaseCost: Number(l.unitPurchaseCost),
        })),
      };

      await salonService.createPurchase(input, user);
      const msg = `Stock-in purchase recorded successfully for PKR ${purchaseCalculatedTotal.toLocaleString()}.`;
      setActionSuccess(msg);
      toast.success(msg);
      setIsPurchaseModalOpen(false);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to record purchase';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  // ----------------------------------------------------
  // SUPPLIER MANAGEMENT & LEDGER
  // ----------------------------------------------------
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierFormData, setSupplierFormData] = useState<Partial<Supplier>>({
    name: '',
    companyName: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    openingBalance: 0,
  });

  const handleOpenCreateSupplier = () => {
    setEditingSupplier(null);
    setSupplierFormData({
      name: '',
      companyName: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      taxNumber: '',
      openingBalance: 0,
    });
    setIsSupplierModalOpen(true);
  };

  const handleOpenEditSupplier = (sup: Supplier) => {
    setEditingSupplier(sup);
    setSupplierFormData({ ...sup });
    setIsSupplierModalOpen(true);
  };

  const handleSaveSupplier = async () => {
    try {
      setActionError(null);
      if (!supplierFormData.name && !supplierFormData.companyName) {
        throw new Error('Supplier name is required.');
      }
      if (!supplierFormData.phone?.trim()) {
        throw new Error('Supplier phone number is required.');
      }
      const finalName = supplierFormData.name || supplierFormData.companyName || 'Supplier';

      if (editingSupplier) {
        await salonService.updateSupplier(
          editingSupplier.id,
          {
            name: finalName,
            companyName: supplierFormData.companyName,
            contactPerson: supplierFormData.contactPerson,
            phone: supplierFormData.phone.trim(),
            email: supplierFormData.email,
            address: supplierFormData.address,
            taxNumber: supplierFormData.taxNumber,
          },
          user
        );
        const msg = `Supplier '${finalName}' updated successfully.`;
        setActionSuccess(msg);
        toast.success(msg);
      } else {
        await salonService.createSupplier(
          {
            branchId: selectedBranchId,
            name: finalName,
            companyName: supplierFormData.companyName,
            contactPerson: supplierFormData.contactPerson,
            phone: supplierFormData.phone.trim(),
            email: supplierFormData.email,
            address: supplierFormData.address,
            taxNumber: supplierFormData.taxNumber,
            openingPayable: Number(supplierFormData.openingBalance) || 0,
            openingBalance: Number(supplierFormData.openingBalance) || 0,
            isActive: true,
          },
          user
        );
        const msg = `Supplier '${finalName}' created successfully.`;
        setActionSuccess(msg);
        toast.success(msg);
      }
      setIsSupplierModalOpen(false);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to save supplier';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  // Dedicated Supplier Ledger Drawer
  const [selectedSupplierForLedger, setSelectedSupplierForLedger] = useState<Supplier | null>(null);
  const [supplierLedgerEntries, setSupplierLedgerEntries] = useState<SupplierLedgerEntry[]>([]);
  const [supplierLedgerSummary, setSupplierLedgerSummary] = useState<{
    openingPayable: number;
    closingPayable: number;
    totalPurchases: number;
    totalPayments: number;
    totalReturns: number;
  }>({
    openingPayable: 0,
    closingPayable: 0,
    totalPurchases: 0,
    totalPayments: 0,
    totalReturns: 0,
  });
  const [isLedgerDrawerOpen, setIsLedgerDrawerOpen] = useState(false);

  const handleOpenSupplierLedger = async (sup: Supplier) => {
    setSelectedSupplierForLedger(sup);
    setIsLedgerDrawerOpen(true);
    try {
      const ledgerResult = await salonService.getSupplierLedger(sup.id, selectedBranchId, user);
      setSupplierLedgerEntries(ledgerResult.entries || []);
      setSupplierLedgerSummary({
        openingPayable: ledgerResult.openingPayable || 0,
        closingPayable: ledgerResult.closingPayable || 0,
        totalPurchases: ledgerResult.totalPurchases || 0,
        totalPayments: ledgerResult.totalPayments || 0,
        totalReturns: ledgerResult.totalReturns || 0,
      });
    } catch (err: any) {
      setActionError(err.message || 'Failed to load supplier ledger');
    }
  };

  // Pay Supplier Modal
  const [isPaySupplierModalOpen, setIsPaySupplierModalOpen] = useState(false);
  const [paySupplierTarget, setPaySupplierTarget] = useState<Supplier | null>(null);
  const [paySupplierAmount, setPaySupplierAmount] = useState<number>(0);
  const [paySupplierMethod, setPaySupplierMethod] = useState<'CASH' | 'ONLINE_ACCOUNT'>('CASH');
  const [paySupplierAccountId, setPaySupplierAccountId] = useState<string>('');
  const [paySupplierNotes, setPaySupplierNotes] = useState<string>('');

  const handleOpenPaySupplier = (sup: Supplier) => {
    setPaySupplierTarget(sup);
    setPaySupplierAmount(Math.max(0, sup.currentBalance || 0));
    setPaySupplierMethod('CASH');
    setPaySupplierAccountId(paymentAccounts[0]?.id || '');
    setPaySupplierNotes('');
    setIsPaySupplierModalOpen(true);
  };

  const handleExecutePaySupplier = async () => {
    try {
      setActionError(null);
      if (!paySupplierTarget) return;
      if (paySupplierAmount <= 0) throw new Error('Payment amount must be greater than zero.');

      if (paySupplierMethod === 'CASH' && !activeDrawer) {
        throw new Error('Cash payment requires an active OPEN cash drawer in your custody.');
      }

      const input: PaySupplierInput = {
        branchId: selectedBranchId,
        supplierId: paySupplierTarget.id,
        amount: Number(paySupplierAmount),
        paymentMethod: paySupplierMethod,
        paymentAccountId: paySupplierMethod === 'ONLINE_ACCOUNT' ? paySupplierAccountId : undefined,
        payerDrawerId: paySupplierMethod === 'CASH' ? activeDrawer?.id : undefined,
        paymentDate: new Date().toISOString().split('T')[0],
        notes: paySupplierNotes,
      };

      await salonService.paySupplier(input, user);
      const payMsg = `Payment of PKR ${paySupplierAmount.toLocaleString()} recorded for ${paySupplierTarget.name}.`;
      setActionSuccess(payMsg);
      toast.success(payMsg);
      setIsPaySupplierModalOpen(false);
      loadInventoryData(selectedBranchId);
      if (isLedgerDrawerOpen && selectedSupplierForLedger?.id === paySupplierTarget.id) {
        const refreshed = await salonService.getSupplierLedger(paySupplierTarget.id, selectedBranchId, user);
        setSupplierLedgerEntries(refreshed.entries || []);
        setSupplierLedgerSummary({
          openingPayable: refreshed.openingPayable || 0,
          closingPayable: refreshed.closingPayable || 0,
          totalPurchases: refreshed.totalPurchases || 0,
          totalPayments: refreshed.totalPayments || 0,
          totalReturns: refreshed.totalReturns || 0,
        });
      }
    } catch (err: any) {
      const errMsg = err.message || 'Failed to record supplier payment';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  // Supplier Return Modal
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnPurchaseId, setReturnPurchaseId] = useState<string>('');
  const [returnSupplierId, setReturnSupplierId] = useState<string>('');
  const [returnLines, setReturnLines] = useState<
    Array<{
      itemId: string;
      batchId?: string;
      quantity: number;
      unitCost: number;
    }>
  >([]);
  const [returnReason, setReturnReason] = useState<string>('DAMAGED_DELIVERY');

  const handleOpenSupplierReturn = () => {
    const defaultSup = suppliers[0];
    setReturnSupplierId(defaultSup?.id || '');
    setReturnPurchaseId('');
    setReturnReason('DAMAGED_DELIVERY');
    setReturnLines([
      {
        itemId: inventoryItems[0]?.id || '',
        quantity: 1,
        unitCost: inventoryItems[0]?.defaultPurchaseCost ?? 0,
      },
    ]);
    setIsReturnModalOpen(true);
  };

  const handleExecuteSupplierReturn = async () => {
    try {
      setActionError(null);
      if (!returnSupplierId) throw new Error('Supplier is required.');
      if (returnLines.length === 0) throw new Error('Please specify items to return.');

      const input: CreateSupplierReturnInput = {
        branchId: selectedBranchId,
        supplierId: returnSupplierId,
        originalPurchaseId: returnPurchaseId || undefined,
        returnDate: new Date().toISOString().split('T')[0],
        reason: returnReason,
        lines: returnLines.map((l) => ({
          itemId: l.itemId,
          batchId: l.batchId,
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
        })),
      };

      await salonService.createSupplierReturn(input, user);
      const retMsg = 'Supplier return and debit adjustment posted successfully.';
      setActionSuccess(retMsg);
      toast.success(retMsg);
      setIsReturnModalOpen(false);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to execute supplier return';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  // ----------------------------------------------------
  // MANUAL STOCK-OUT / SALON CONSUMPTION
  // ----------------------------------------------------
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isStockOutModalOpen, setIsStockOutModalOpen] = useState(false);
  const [stockOutItemId, setStockOutItemId] = useState<string>('');
  const [stockOutBatchId, setStockOutBatchId] = useState<string>('');
  const [stockOutQuantity, setStockOutQuantity] = useState<number>(1);
  const [stockOutReasonType, setStockOutReasonType] = useState<'SALON_CONSUMPTION' | 'DAMAGE' | 'EXPIRED' | 'INTERNAL_USE' | 'OTHER'>('SALON_CONSUMPTION');
  const [stockOutDepartment, setStockOutDepartment] = useState<string>('Salon Service');
  const [stockOutStaffId, setStockOutStaffId] = useState<string>('');
  const [stockOutNotes, setStockOutNotes] = useState<string>('');
  const [stockOutPreview, setStockOutPreview] = useState<ConsumptionPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isStockOutSubmitting, setIsStockOutSubmitting] = useState<boolean>(false);

  // Stock Movement Reversal State
  const [isReverseModalOpen, setIsReverseModalOpen] = useState(false);
  const [movementToReverse, setMovementToReverse] = useState<StockMovement | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');
  const [isReversing, setIsReversing] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    if (!isStockOutModalOpen || !stockOutItemId || stockOutQuantity <= 0) {
      setStockOutPreview(null);
      return;
    }
    setIsPreviewLoading(true);
    salonService
      .getConsumptionPreview(
        {
          itemId: stockOutItemId,
          branchId: selectedBranchId,
          quantity: Number(stockOutQuantity),
          batchId: stockOutBatchId || undefined,
          reasonType: stockOutReasonType,
        },
        user
      )
      .then((prev) => {
        if (active) setStockOutPreview(prev);
      })
      .catch(() => {
        if (active) setStockOutPreview(null);
      })
      .finally(() => {
        if (active) setIsPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isStockOutModalOpen, stockOutItemId, stockOutQuantity, stockOutBatchId, stockOutReasonType, selectedBranchId, user]);

  const handleOpenStockOutModal = (presetItemId?: string) => {
    const targetItem = presetItemId ? inventoryItems.find((i) => i.id === presetItemId) : inventoryItems[0];
    setStockOutItemId(targetItem?.id || '');
    setStockOutBatchId('');
    setStockOutQuantity(1);
    setStockOutReasonType('SALON_CONSUMPTION');
    setStockOutDepartment('Salon Service');
    setStockOutStaffId(staffList[0]?.id || '');
    setStockOutNotes('');
    setStockOutPreview(null);
    setIsStockOutModalOpen(true);
  };

  const handleExecuteStockOut = async () => {
    if (isStockOutSubmitting) return;
    try {
      setActionError(null);
      if (!stockOutItemId) throw new Error('Please select an item.');
      if (stockOutQuantity <= 0) throw new Error('Quantity must be greater than zero.');
      if (stockOutPreview && !stockOutPreview.isFulfillable) {
        throw new Error(`Insufficient stock for this deduction. Available: ${stockOutPreview.availableStock}, Requested: ${stockOutQuantity}`);
      }

      setIsStockOutSubmitting(true);
      const chosenStaff = staffList.find((s) => s.id === stockOutStaffId);
      const input: CreateManualStockOutInput = {
        branchId: selectedBranchId,
        itemId: stockOutItemId,
        batchId: stockOutBatchId || undefined,
        quantity: Number(stockOutQuantity),
        reasonType: stockOutReasonType,
        department: stockOutDepartment,
        responsibleStaffId: stockOutStaffId || undefined,
        responsibleStaffName: chosenStaff?.name || undefined,
        reason: stockOutReasonType,
        notes: stockOutNotes,
      };

      await salonService.createManualStockOut(input, user);
      const outMsg = 'Stock-out movement logged and inventory updated.';
      setActionSuccess(outMsg);
      toast.success(outMsg);
      setIsStockOutModalOpen(false);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to record manual stock out';
      setActionError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsStockOutSubmitting(false);
    }
  };

  const handleOpenReverseModal = (m: StockMovement) => {
    setMovementToReverse(m);
    setReversalReason('');
    setIsReverseModalOpen(true);
  };

  const handleExecuteReverseMovement = async () => {
    if (!movementToReverse || isReversing) return;
    if (!reversalReason.trim() || reversalReason.trim().length < 3) {
      toast.error('Please enter a valid reversal reason (at least 3 characters).');
      return;
    }
    setIsReversing(true);
    try {
      await salonService.reverseStockMovement(movementToReverse.id, reversalReason.trim(), user);
      toast.success(`Movement ${movementToReverse.movementNumber} reversed and stock restored.`);
      setIsReverseModalOpen(false);
      setMovementToReverse(null);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to reverse stock movement.');
    } finally {
      setIsReversing(false);
    }
  };

  // ----------------------------------------------------
  // STOCK SETTLEMENT (PHYSICAL RECONCILIATION)
  // ----------------------------------------------------
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [settlementLines, setSettlementLines] = useState<
    Array<{
      itemId: string;
      itemName: string;
      systemQuantity: number;
      countedQuantity: number;
      reason: 'COUNTING_CORRECTION' | 'DAMAGE' | 'MISSING' | 'UNRECORDED_CONSUMPTION' | 'EXPIRED' | 'OTHER';
      notes?: string;
    }>
  >([]);
  const [settlementNotes, setSettlementNotes] = useState<string>('');

  const handleOpenSettlementModal = () => {
    // Populate all active items with their current system stock
    const lines = inventoryItems.map((item) => {
      const sysQty = stockMap[item.id]?.currentStock || 0;
      return {
        itemId: item.id,
        itemName: item.name,
        systemQuantity: sysQty,
        countedQuantity: sysQty,
        reason: 'COUNTING_CORRECTION' as const,
        notes: '',
      };
    });
    setSettlementLines(lines);
    setSettlementNotes('');
    setIsSettlementModalOpen(true);
  };

  const handleUpdateSettlementLine = (index: number, counted: number, reason: any, notes?: string) => {
    setSettlementLines((prev) =>
      prev.map((l, idx) => (idx === index ? { ...l, countedQuantity: counted, reason, notes } : l))
    );
  };

  const handleExecuteSettlement = async () => {
    try {
      setActionError(null);
      const input: CreateStockSettlementInput = {
        branchId: selectedBranchId,
        countDate: new Date().toISOString().split('T')[0],
        notes: settlementNotes,
        lines: settlementLines.map((l) => ({
          itemId: l.itemId,
          systemQuantity: l.systemQuantity,
          countedQuantity: Number(l.countedQuantity),
          reason: l.reason,
          notes: l.notes,
        })),
      };

      await salonService.createStockSettlement(input, user);
      const setMsg = 'Stock settlement posted and physical reconciliation complete.';
      setActionSuccess(setMsg);
      toast.success(setMsg);
      setIsSettlementModalOpen(false);
      loadInventoryData(selectedBranchId);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to execute stock settlement';
      setActionError(errMsg);
      toast.error(errMsg);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Inventory & Suppliers
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Track stock levels, purchase batches, historical cost snapshots, supplier ledgers, and salon consumption.
              </p>
            </div>
          </div>
        </div>

        {/* Branch Context Selector & Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          {isSuperAdmin && (
            <div className="shrink-0">
              <Select value={selectedBranchId} onValueChange={(val) => setSelectedBranchId(val)}>
                <SelectTrigger className="h-9 px-3 rounded-xl border border-white/80 bg-white/70 hover:bg-white text-xs font-semibold text-slate-700 shadow-2xs flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-[#B82E69] shrink-0" />
                  <SelectValue placeholder="Select Branch" />
                </SelectTrigger>
                <SelectContent>
                  {allBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadInventoryData(selectedBranchId)}
            className="h-9 px-3.5 text-xs font-semibold rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 shadow-2xs transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {isAdmin && (
            <Button
              size="sm"
              onClick={handleOpenCreatePurchase}
              className="h-9 font-semibold gap-1.5 shadow-xs text-xs sm:text-sm bg-[#B82E69] hover:bg-[#A02358] text-white rounded-xl transition-all shrink-0"
            >
              <Plus className="w-4 h-4" />
              Stock-In Purchase
            </Button>
          )}
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="bg-slate-100 p-1 rounded-xl w-full justify-start overflow-x-auto flex-nowrap border border-slate-200">
          <TabsTrigger value="OVERVIEW" className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#9D2558] data-[state=active]:shadow-xs">
            <Layers className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="ITEMS" className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#9D2558] data-[state=active]:shadow-xs">
            <Package className="w-3.5 h-3.5" /> Items & Stock ({inventoryItems.length})
          </TabsTrigger>
          <TabsTrigger value="PURCHASES" className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#9D2558] data-[state=active]:shadow-xs">
            <Truck className="w-3.5 h-3.5" /> Purchases & Stock-In ({purchases.length})
          </TabsTrigger>
          <TabsTrigger value="SUPPLIERS" className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#9D2558] data-[state=active]:shadow-xs">
            <Building2 className="w-3.5 h-3.5" /> Suppliers & Ledger ({suppliers.length})
          </TabsTrigger>
          <TabsTrigger value="MOVEMENTS" className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#9D2558] data-[state=active]:shadow-xs">
            <History className="w-3.5 h-3.5" /> Stock Movements ({stockMovements.length})
          </TabsTrigger>
          <TabsTrigger value="SETTLEMENT" className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#9D2558] data-[state=active]:shadow-xs">
            <ArrowRightLeft className="w-3.5 h-3.5" /> Physical Reconciliation ({settlements.length})
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------- */}
        {/* OVERVIEW TAB */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="OVERVIEW" className="space-y-6 pt-2">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="p-3.5 bg-white border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Inventory Valuation</span>
              <p className="text-lg font-bold text-slate-900 mt-1 font-mono">
                {formatCurrency(summaryData.totalValuationCost)}
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Historical purchase cost</span>
            </Card>

            <Card className="p-3.5 bg-white border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Retail Potential</span>
              <p className="text-lg font-bold text-[#9D2558] mt-1 font-mono">
                {formatCurrency(summaryData.totalRetailPotential)}
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">At current selling prices</span>
            </Card>

            <Card className="p-3.5 bg-white border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Low Stock Alert</span>
              <p className={`text-lg font-bold mt-1 font-mono ${summaryData.lowStockCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                {summaryData.lowStockCount} Items
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Below reorder threshold</span>
            </Card>

            <Card className="p-3.5 bg-white border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Out of Stock</span>
              <p className={`text-lg font-bold mt-1 font-mono ${summaryData.outOfStockCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {summaryData.outOfStockCount} Items
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Zero units remaining</span>
            </Card>

            <Card className="p-3.5 bg-white border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Near / Expired</span>
              <p className={`text-lg font-bold mt-1 font-mono ${summaryData.nearExpiryCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                {summaryData.nearExpiryCount} Batches
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Batches requiring review</span>
            </Card>

            <Card className="p-3.5 bg-white border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Supplier Payables</span>
              <p className="text-lg font-bold text-rose-600 mt-1 font-mono">
                {formatCurrency(summaryData.totalSupplierPayables)}
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Outstanding balance</span>
            </Card>
          </div>

          {/* Quick Operations Bar */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-xl border border-slate-200">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Quick Actions:</span>
            {isAdmin && (
              <>
                <Button size="sm" variant="outline" onClick={handleOpenCreateItem} className="text-xs h-8 gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> New Item
                </Button>
                <Button size="sm" variant="outline" onClick={handleOpenCreatePurchase} className="text-xs h-8 gap-1.5">
                  <Truck className="w-3.5 h-3.5" /> New Purchase
                </Button>
                <Button size="sm" variant="outline" onClick={handleOpenStockOutModal} className="text-xs h-8 gap-1.5">
                  <ArrowUpRight className="w-3.5 h-3.5" /> Salon Consumption
                </Button>
                <Button size="sm" variant="outline" onClick={handleOpenSettlementModal} className="text-xs h-8 gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5" /> Physical Count
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={handleOpenCreateSupplier} className="text-xs h-8 gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> New Supplier
            </Button>
          </div>

          {/* Two-Column Alert Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Low Stock Watchlist */}
            <Card className="p-4 bg-white border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <h3 className="font-bold text-slate-900 text-sm">Low Stock & Reorder Watchlist</h3>
                </div>
                <Badge variant="neutral" className="text-[10px]">
                  {summaryData.lowStockCount + summaryData.outOfStockCount} Alerts
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Item & SKU</TableHead>
                      <TableHead className="text-[11px] text-right">In Stock</TableHead>
                      <TableHead className="text-[11px] text-right">Min Threshold</TableHead>
                      <TableHead className="text-[11px] text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryItems
                      .filter((i) => (stockMap[i.id]?.currentStock || 0) <= i.minStockLevel)
                      .slice(0, 5)
                      .map((item) => {
                        const cur = stockMap[item.id]?.currentStock || 0;
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="py-2">
                              <span className="font-bold text-xs text-slate-900 block">{item.name}</span>
                              <span className="font-mono text-[10px] text-slate-500">{item.sku}</span>
                            </TableCell>
                            <TableCell className="py-2 text-right font-mono font-bold text-xs">
                              {cur} {item.issueUnit}
                            </TableCell>
                            <TableCell className="py-2 text-right font-mono text-xs text-slate-500">
                              {item.minStockLevel} {item.issueUnit}
                            </TableCell>
                            <TableCell className="py-2 text-center">
                              {cur <= 0 ? (
                                <Badge variant="destructive" className="text-[9px]">Out of Stock</Badge>
                              ) : (
                                <Badge variant="neutral" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                                  Low Stock
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    {inventoryItems.filter((i) => (stockMap[i.id]?.currentStock || 0) <= i.minStockLevel).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-6 text-xs text-slate-400">
                          All items are adequately stocked above reorder thresholds.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* Near Expiry Batches */}
            <Card className="p-4 bg-white border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <h3 className="font-bold text-slate-900 text-sm">Batch Expiry Monitoring (FEFO)</h3>
                </div>
                <Badge variant="neutral" className="text-[10px]">
                  {batches.filter((b) => b.status === 'NEAR_EXPIRY' || b.status === 'EXPIRED').length} Alerts
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Batch #</TableHead>
                      <TableHead className="text-[11px]">Item</TableHead>
                      <TableHead className="text-[11px]">Expiry Date</TableHead>
                      <TableHead className="text-[11px] text-right">Remaining</TableHead>
                      <TableHead className="text-[11px] text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches
                      .filter((b) => b.status === 'NEAR_EXPIRY' || b.status === 'EXPIRED')
                      .slice(0, 5)
                      .map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell className="py-2 font-mono text-xs font-bold text-slate-800">
                            {batch.batchNumber}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-slate-900">{batch.itemName}</TableCell>
                          <TableCell className="py-2 font-mono text-xs text-slate-600">
                            {batch.expiryDate || 'N/A'}
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono font-bold text-xs">
                            {batch.remainingQuantity}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {batch.status === 'EXPIRED' ? (
                              <Badge variant="destructive" className="text-[9px]">EXPIRED (Blocked)</Badge>
                            ) : (
                              <Badge variant="neutral" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                                NEAR EXPIRY
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    {batches.filter((b) => b.status === 'NEAR_EXPIRY' || b.status === 'EXPIRED').length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-6 text-xs text-slate-400">
                          No batches are expired or in near-expiry status.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* ITEMS & STOCK TAB */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="ITEMS" className="space-y-4 pt-2">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  placeholder="Search item by name, SKU, or barcode..."
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  className="pl-8 text-xs h-8 bg-slate-50 border-slate-200"
                />
              </div>

              <Select value={itemTypeFilter} onValueChange={(val) => setItemTypeFilter(val as any)}>
                <SelectTrigger className="w-[140px] text-xs h-8 bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Item Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">All Types</SelectItem>
                  <SelectItem value="RETAIL_PRODUCT" className="text-xs">Retail Product</SelectItem>
                  <SelectItem value="CONSUMABLE" className="text-xs">Consumable</SelectItem>
                  <SelectItem value="BOTH" className="text-xs">Both</SelectItem>
                </SelectContent>
              </Select>

              <Select value={itemCategoryFilter} onValueChange={(val) => setItemCategoryFilter(val)}>
                <SelectTrigger className="w-[140px] text-xs h-8 bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">All Categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={itemStatusFilter} onValueChange={(val) => setItemStatusFilter(val as any)}>
                <SelectTrigger className="w-[110px] text-xs h-8 bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE" className="text-xs">Active</SelectItem>
                  <SelectItem value="ARCHIVED" className="text-xs">Archived</SelectItem>
                  <SelectItem value="ALL" className="text-xs">All</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <Button size="sm" onClick={handleOpenCreateItem} className="text-xs h-8 gap-1.5 bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
                <Plus className="w-3.5 h-3.5" /> Add New Item
              </Button>
            )}
          </div>

          {/* Items Table */}
          <Card className="bg-white border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold text-slate-700">SKU / Code</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Item Name</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Category</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Type</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Default Cost</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Selling Price</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">On Hand</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-center">Status</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const stock = stockMap[item.id]?.currentStock || 0;
                    const isLow = stock <= item.minStockLevel && stock > 0;
                    const isOut = stock <= 0;

                    return (
                      <TableRow key={item.id} className="hover:bg-slate-50/60">
                        <TableCell className="font-mono text-xs font-semibold text-slate-800">
                          {item.sku}
                        </TableCell>
                        <TableCell>
                          <span className="font-bold text-xs text-slate-900 block">{item.name}</span>
                          {item.barcode && (
                            <span className="font-mono text-[10px] text-slate-400">Barcode: {item.barcode}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-[11px] font-medium">{item.category}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral" className="text-[10px]">
                            {item.itemType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-700">
                          {formatCurrency(item.defaultPurchaseCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {item.itemType === 'SALON_CONSUMABLE' || !item.sellingPrice ? (
                            <span className="text-slate-400 italic text-[11px]">N/A (In-House)</span>
                          ) : (
                            <span className="font-bold text-[#9D2558]">{formatCurrency(item.sellingPrice)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`font-mono font-bold text-xs ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                            {stock} {item.issueUnit}
                          </span>
                          {isOut ? (
                            <span className="block text-[9px] text-rose-500 font-semibold">Out of Stock</span>
                          ) : isLow ? (
                            <span className="block text-[9px] text-amber-500 font-semibold">Low Stock</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.isActive ? (
                            <Badge variant="neutral" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="neutral" className="text-[9px] bg-slate-100 text-slate-500">
                              Archived
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedItemForBatches(item);
                                setIsBatchDrawerOpen(true);
                              }}
                              className="h-7 text-xs px-2 gap-1 text-slate-600 hover:text-slate-900"
                              title="View Batches"
                            >
                              <Boxes className="w-3.5 h-3.5" />
                              Batches
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditItem(item)}
                                className="h-7 w-7 p-0 text-slate-600 hover:text-slate-900"
                                title="Edit Item"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-xs text-slate-400">
                        No inventory items matching your search or filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* PURCHASES & STOCK-IN TAB */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="PURCHASES" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">Historical Purchase Orders & Stock Inflows</h2>
            {isAdmin && (
              <Button size="sm" onClick={handleOpenCreatePurchase} className="text-xs h-8 gap-1.5 bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
                <Plus className="w-3.5 h-3.5" /> Record Stock-In Purchase
              </Button>
            )}
          </div>

          <Card className="bg-white border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold text-slate-700">PO / Reference #</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Date</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Supplier</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Lines</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Total Cost</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Paid</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Payable Balance</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-center">Payment Status</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-center">Payment Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((po) => (
                    <TableRow key={po.id} className="hover:bg-slate-50/60">
                      <TableCell className="font-mono text-xs font-bold text-slate-900">
                        {po.purchaseNumber || po.invoiceNumber}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">{po.purchaseDate}</TableCell>
                      <TableCell className="text-xs font-semibold text-slate-800">{po.supplierName}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {po.lines.length} items ({po.lines.reduce((s, l) => s + l.quantity, 0)} units)
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-xs text-slate-900">
                        {formatCurrency(po.totalCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-600 font-semibold">
                        {formatCurrency(po.paidAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-rose-600">
                        {formatCurrency(po.balanceAmount)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={po.paymentStatus === 'PAID' ? 'neutral' : po.paymentStatus === 'PARTIAL' ? 'neutral' : 'destructive'}
                          className={`text-[9px] ${
                            po.paymentStatus === 'PAID'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : po.paymentStatus === 'PARTIAL'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : ''
                          }`}
                        >
                          {po.paymentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs font-mono text-slate-600">
                        {po.paymentMethod}
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchases.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-xs text-slate-400">
                        No purchase orders recorded yet for this branch.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* SUPPLIERS & LEDGER TAB */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="SUPPLIERS" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Supplier Directory & Balance Tracking</h2>
              <p className="text-xs text-slate-500">
                Track running balances, debit notes, invoices, and payments per supplier.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleOpenSupplierReturn} className="text-xs h-8 gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5" /> Supplier Return
              </Button>
              <Button size="sm" onClick={handleOpenCreateSupplier} className="text-xs h-8 gap-1.5 bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
                <Plus className="w-3.5 h-3.5" /> New Supplier
              </Button>
            </div>
          </div>

          <Card className="bg-white border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold text-slate-700">Company / Supplier Name</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Contact Person</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Phone</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Email</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Current Balance</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-center">Status</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((sup) => {
                    const balance = sup.currentBalance || 0;
                    const isPayable = balance > 0;
                    const isAdvance = balance < 0;

                    return (
                      <TableRow key={sup.id} className="hover:bg-slate-50/60">
                        <TableCell>
                          <span className="font-bold text-xs text-slate-900 block">{sup.name}</span>
                          {sup.companyName && sup.companyName !== sup.name && (
                            <span className="text-[10px] text-slate-500">{sup.companyName}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">{sup.contactPerson || '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">{sup.phone || '—'}</TableCell>
                        <TableCell className="text-xs text-slate-500">{sup.email || '—'}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-mono font-bold text-xs ${isPayable ? 'text-rose-600' : isAdvance ? 'text-emerald-600' : 'text-slate-600'}`}>
                            {formatCurrency(Math.abs(balance))}
                          </span>
                          <span className="block text-[9px] font-semibold text-slate-400">
                            {isPayable ? 'Payable (Due)' : isAdvance ? 'Advance / Credit' : 'Settled (Zero)'}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="neutral" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                            Active
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenSupplierLedger(sup)}
                              className="h-7 text-xs px-2 gap-1 text-slate-700"
                            >
                              <FileText className="w-3 h-3" /> Ledger
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleOpenPaySupplier(sup)}
                              className="h-7 text-xs px-2.5 gap-1 bg-[#9D2558] hover:bg-[#1B3FC5] text-white"
                            >
                              <DollarSign className="w-3 h-3" /> Pay
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEditSupplier(sup)}
                              className="h-7 w-7 p-0 text-slate-500 hover:text-slate-800"
                              title="Edit Supplier"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {suppliers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-xs text-slate-400">
                        No suppliers added yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* STOCK MOVEMENTS TAB */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="MOVEMENTS" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Stock Movements & Consumption Audit Trail</h2>
              <p className="text-xs text-slate-500">
                Every quantity change is recorded as an immutable movement with unit cost snapshots.
              </p>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={handleOpenStockOutModal} className="text-xs h-8 gap-1.5 bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
                <ArrowUpRight className="w-3.5 h-3.5" /> Record Stock-Out
              </Button>
            )}
          </div>

          <Card className="bg-white border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold text-slate-700">Date & Time</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Item</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Movement Type</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-center">Direction</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Quantity</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Unit Cost Snapshot</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Total Impact</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Reference / Doc</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Recorded By</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockMovements.map((m) => {
                    const isIn = m.direction === 'IN';
                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50/60">
                        <TableCell className="font-mono text-xs text-slate-600">
                          {new Date(m.createdAt || m.timestamp || Date.now()).toLocaleDateString()} {new Date(m.createdAt || m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell>
                          <span className="font-bold text-xs text-slate-900 block">{m.itemName}</span>
                          <span className="font-mono text-[10px] text-slate-400">{m.itemSku}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral" className="text-[10px] bg-slate-100 text-slate-700">
                            {m.movementType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="neutral"
                            className={`text-[9px] font-bold ${
                              isIn ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {isIn ? '+ IN' : '- OUT'}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono font-bold text-xs ${isIn ? 'text-emerald-700' : 'text-slate-900'}`}>
                          {isIn ? `+${m.quantity}` : `-${m.quantity}`}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-600">
                          {formatCurrency(m.unitCostSnapshot || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-xs text-slate-900">
                          {formatCurrency(m.totalCostImpact || 0)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">
                          {m.referenceId || m.sourceReferenceId || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">{m.actorName || 'System'}</TableCell>
                        <TableCell className="text-right">
                          {m.direction === 'OUT' && (m.movementType === 'MANUAL_OUT' || m.movementType === 'SALON_CONSUMPTION' || m.movementType === 'INTERNAL_USE' || m.movementType === 'DAMAGE' || m.movementType === 'EXPIRED' || m.sourceReferenceType === 'MANUAL_OUT') && (
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleOpenReverseModal(m)}
                              className="text-[10px] h-6 px-2 text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                              title="Reverse this consumption / stock-out movement and restore inventory batch quantity"
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Reverse
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {stockMovements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-10 text-xs text-slate-400">
                        No stock movements logged yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* STOCK SETTLEMENT TAB */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="SETTLEMENT" className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Physical Stock Reconciliation Audits</h2>
              <p className="text-xs text-slate-500">
                Compare physical counted inventory against system records and post adjustment movements.
              </p>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={handleOpenSettlementModal} className="text-xs h-8 gap-1.5 bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
                <ArrowRightLeft className="w-3.5 h-3.5" /> Start Physical Count
              </Button>
            )}
          </div>

          <Card className="bg-white border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold text-slate-700">Audit Date</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Items Counted</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Discrepancies</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Net Cost Impact</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Audited By</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Notes</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.map((s) => {
                    const diffLines = s.lines.filter((l) => l.difference !== 0);
                    return (
                      <TableRow key={s.id} className="hover:bg-slate-50/60">
                        <TableCell className="font-mono text-xs font-bold text-slate-900">{s.countDate}</TableCell>
                        <TableCell className="text-xs text-slate-700">{s.lines.length} items</TableCell>
                        <TableCell className="text-xs">
                          {diffLines.length > 0 ? (
                            <Badge variant="neutral" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                              {diffLines.length} Discrepancies
                            </Badge>
                          ) : (
                            <Badge variant="neutral" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              Exact Match
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-xs text-slate-900">
                          {formatCurrency(s.totalCostVariance || 0)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">{s.conductedByName}</TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-xs truncate">{s.notes || '—'}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="neutral" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                            Reconciled
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {settlements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-xs text-slate-400">
                        No physical stock reconciliation audits recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------------------------------------------- */}
      {/* MODAL: ITEM MASTER (Create / Edit) */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isItemModalOpen} onOpenChange={setIsItemModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              {editingItem ? 'Edit Inventory Item' : 'New Inventory Item Master'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {editingItem
                ? 'Update item catalogue details. Editing costs here does not alter historical batches, purchases, or COGS.'
                : 'Define a new inventory product. Initial quantity starts at 0 and changes only via posted stock movements.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Item Name *</label>
              <Input
                placeholder="e.g. Loreal Absolut Repair Shampoo 500ml"
                value={itemFormData.name || ''}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="text-xs h-8"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">SKU / Code * (Auto-generated)</label>
              <Input
                placeholder="e.g. SKU-01"
                value={itemFormData.sku || ''}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, sku: e.target.value.toUpperCase(), code: e.target.value.toUpperCase() }))}
                className="text-xs h-8 font-mono uppercase"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Barcode</label>
              <Input
                placeholder="e.g. 890123456789"
                value={itemFormData.barcode || ''}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, barcode: e.target.value }))}
                className="text-xs h-8 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Category</label>
              <Input
                placeholder="e.g. Hair Care, Skin Care"
                value={itemFormData.category || ''}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, category: e.target.value }))}
                className="text-xs h-8"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Item Type *</label>
              <Select
                value={itemFormData.itemType || 'RETAIL_PRODUCT'}
                onValueChange={(val) =>
                  setItemFormData((prev) => ({
                    ...prev,
                    itemType: val as any,
                    sellingPrice: val === 'SALON_CONSUMABLE' ? 0 : prev.sellingPrice,
                  }))
                }
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETAIL_PRODUCT" className="text-xs">Retail Product (POS Sale)</SelectItem>
                  <SelectItem value="SALON_CONSUMABLE" className="text-xs">Consumable (Salon In-House Use)</SelectItem>
                  <SelectItem value="BOTH" className="text-xs">Both (Retail & Consumable)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Brand</label>
              <Input
                placeholder="e.g. Loreal, Wella, Kerastase"
                value={itemFormData.brand || ''}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, brand: e.target.value }))}
                className="text-xs h-8"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Default Purchase Cost (PKR) *</label>
              <Input
                type="number"
                placeholder="1000"
                value={itemFormData.defaultPurchaseCost || 0}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, defaultPurchaseCost: Number(e.target.value) }))}
                className="text-xs h-8 font-mono"
              />
            </div>

            {itemFormData.itemType === 'SALON_CONSUMABLE' ? (
              <div className="p-2.5 bg-amber-50/60 rounded-lg border border-amber-200">
                <span className="text-xs font-semibold text-amber-900 block mb-0.5">Selling Price (N/A)</span>
                <p className="text-[11px] text-amber-800">
                  <span className="font-semibold">In-House Consumable:</span> Selling price is not applicable because this item is for salon internal consumption only, not for POS retail sale.
                </p>
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Selling Price (POS Retail) *</label>
                <Input
                  type="number"
                  placeholder="1500"
                  value={itemFormData.sellingPrice || 0}
                  onChange={(e) => setItemFormData((prev) => ({ ...prev, sellingPrice: Number(e.target.value) }))}
                  className="text-xs h-8 font-mono font-bold text-[#9D2558]"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Purchase Unit</label>
              <Select
                value={itemFormData.purchaseUnit || 'PIECE'}
                onValueChange={(val) => setItemFormData((prev) => ({ ...prev, purchaseUnit: val as any }))}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PIECE" className="text-xs">PIECE</SelectItem>
                  <SelectItem value="BOX" className="text-xs">BOX</SelectItem>
                  <SelectItem value="BOTTLE" className="text-xs">BOTTLE</SelectItem>
                  <SelectItem value="TUBE" className="text-xs">TUBE</SelectItem>
                  <SelectItem value="JAR" className="text-xs">JAR</SelectItem>
                  <SelectItem value="SET" className="text-xs">SET</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Issue Unit</label>
              <Select
                value={itemFormData.issueUnit || 'PIECE'}
                onValueChange={(val) => setItemFormData((prev) => ({ ...prev, issueUnit: val as any }))}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PIECE" className="text-xs">PIECE</SelectItem>
                  <SelectItem value="BOTTLE" className="text-xs">BOTTLE</SelectItem>
                  <SelectItem value="TUBE" className="text-xs">TUBE</SelectItem>
                  <SelectItem value="GRAM" className="text-xs">GRAM</SelectItem>
                  <SelectItem value="ML" className="text-xs">ML</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Min Stock Reorder Level</label>
              <Input
                type="number"
                placeholder="5"
                value={itemFormData.minStockLevel ?? 5}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, minStockLevel: Number(e.target.value) }))}
                className="text-xs h-8 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Near Expiry Alert (Days)</label>
              <Input
                type="number"
                placeholder="60"
                value={itemFormData.nearExpiryAlertDays || 60}
                onChange={(e) => setItemFormData((prev) => ({ ...prev, nearExpiryAlertDays: Number(e.target.value) }))}
                className="text-xs h-8 font-mono"
              />
            </div>

            {!editingItem && (
              <div className="sm:col-span-2 p-3 bg-[#FDF2F5]/70 border border-[#F1DEE3] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#23151D]">Opening Stock on Hand</span>
                  <span className="text-[10px] text-[#851C47] bg-white px-2 py-0.5 rounded border border-[#F1DEE3]">
                    Initial Stock Count
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                      Available Stock Quantity ({itemFormData.purchaseUnit || 'Units'})
                    </label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={itemFormData.openingStock === 0 ? '' : itemFormData.openingStock}
                      onChange={(e) => setItemFormData((prev) => ({ ...prev, openingStock: Math.max(0, Number(e.target.value) || 0) }))}
                      className="text-xs h-8 font-mono bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                      Opening Cost (PKR)
                    </label>
                    <Input
                      type="number"
                      min="0"
                      placeholder={String(itemFormData.defaultPurchaseCost || 0)}
                      value={itemFormData.openingCost === 0 ? '' : itemFormData.openingCost}
                      onChange={(e) => setItemFormData((prev) => ({ ...prev, openingCost: Number(e.target.value) || 0 }))}
                      className="text-xs h-8 font-mono bg-white"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="sm:col-span-2 flex items-center gap-6 pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemFormData.trackBatch ?? true}
                  onChange={(e) => setItemFormData((prev) => ({ ...prev, trackBatch: e.target.checked }))}
                  className="rounded border-slate-300 text-[#9D2558]"
                />
                Track Batches (FEFO allocation)
              </label>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemFormData.trackExpiry ?? true}
                  onChange={(e) => setItemFormData((prev) => ({ ...prev, trackExpiry: e.target.checked }))}
                  className="rounded border-slate-300 text-[#9D2558]"
                />
                Track Expiry Date
              </label>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemFormData.isActive ?? true}
                  onChange={(e) => setItemFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                  className="rounded border-slate-300 text-[#9D2558]"
                />
                Item Active
              </label>
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsItemModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveItem} className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
              {editingItem ? 'Save Changes' : 'Create Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* DRAWER: BATCH DETAILS & QUARANTINE */}
      {/* ---------------------------------------------------- */}
      <Sheet open={isBatchDrawerOpen} onOpenChange={setIsBatchDrawerOpen}>
        <SheetContent className="w-[420px] sm:w-[540px] max-w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm font-bold text-slate-900">
              Batches: {selectedItemForBatches?.name}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              FEFO order ensures nearest-expiry valid batches are deducted first. Quarantined or expired batches are strictly blocked from sale.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {activeItemBatches.map((batch) => (
              <div key={batch.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-slate-900">{batch.batchNumber}</span>
                  <Badge
                    variant={
                      batch.status === 'VALID'
                        ? 'neutral'
                        : batch.status === 'NEAR_EXPIRY'
                        ? 'neutral'
                        : batch.status === 'EXPIRED'
                        ? 'destructive'
                        : 'neutral'
                    }
                    className={`text-[9px] ${
                      batch.status === 'VALID'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : batch.status === 'NEAR_EXPIRY'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : batch.status === 'QUARANTINED'
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : ''
                    }`}
                  >
                    {batch.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Received:</span>
                    <span className="font-mono">{batch.receivedDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Expiry Date:</span>
                    <span className="font-mono font-semibold">{batch.expiryDate || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Remaining Qty:</span>
                    <span className="font-mono font-bold text-slate-900">{batch.remainingQuantity} units</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Cost Snapshot:</span>
                    <span className="font-mono">{formatCurrency(batch.unitCostSnapshot || 0)}</span>
                    <span className="text-[10px] text-slate-400 block">Batch Sale Price:</span>
                    <span className="font-mono">{batch.sellingPrice == null ? 'Pending migration' : formatCurrency(batch.sellingPrice)}</span>
                  </div>
                </div>

                {isAdmin && batch.status !== 'EXHAUSTED' && (
                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleBatchQuarantine(batch.id, batch.status)}
                      className="text-xs h-7 text-purple-700 hover:text-purple-800 hover:bg-purple-50"
                    >
                      {batch.status === 'QUARANTINED' ? 'Release Quarantine' : 'Quarantine Batch'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {activeItemBatches.length === 0 && (
              <p className="text-center py-10 text-xs text-slate-400">
                No active batches exist for this item in this branch.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------------------------------------------------- */}
      {/* MODAL: STOCK-IN PURCHASE */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isPurchaseModalOpen} onOpenChange={setIsPurchaseModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Record Stock-In Purchase Order
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Purchases increase inventory, create traceable batches, snapshot authoritative unit costs, and update the supplier ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Header Details */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Supplier *</label>
                <Select value={purchaseSupplierId} onValueChange={(val) => setPurchaseSupplierId(val)}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name} ({s.currentBalance ? `Due: PKR ${s.currentBalance}` : 'Settled'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Invoice / PO Reference #</label>
                <Input
                  value={purchaseInvoiceNumber}
                  onChange={(e) => setPurchaseInvoiceNumber(e.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Method</label>
                <Select
                  value={purchasePaymentMethod}
                  onValueChange={(val) => {
                    const m = val as PurchasePaymentMethod;
                    setPurchasePaymentMethod(m);
                    if (m === 'CREDIT') {
                      setPurchasePaidAmount(0);
                    } else if (m === 'CASH' || m === 'ONLINE') {
                      setPurchasePaidAmount(purchaseCalculatedTotal);
                    }
                  }}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREDIT" className="text-xs">Credit (Increase Supplier Payable)</SelectItem>
                    <SelectItem value="CASH" className="text-xs">Cash (Deduct Active Drawer)</SelectItem>
                    <SelectItem value="ONLINE" className="text-xs">Online Account (Bank / Wallet)</SelectItem>
                    <SelectItem value="PARTIAL" className="text-xs">Partial (Split Paid vs Payable)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment Source Options */}
            {purchasePaymentMethod !== 'CREDIT' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Paid Amount (PKR)</label>
                  <Input
                    type="number"
                    value={purchasePaidAmount}
                    onChange={(e) => setPurchasePaidAmount(Number(e.target.value))}
                    className="text-xs h-8 font-mono font-bold"
                  />
                </div>

                {purchasePaymentMethod === 'ONLINE' ? (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Account</label>
                    <Select value={purchasePaymentAccountId} onValueChange={(val) => setPurchasePaymentAccountId(val)}>
                      <SelectTrigger className="text-xs h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id} className="text-xs">
                            {a.name} ({a.bankName || a.providerName || a.accountType})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Payer Cash Drawer</label>
                    <span className="text-xs font-mono font-medium text-slate-800 bg-white px-3 py-1.5 rounded border border-slate-200 block">
                      {activeDrawer ? `Drawer: ${activeDrawer.custodianName || activeDrawer.drawerName} (Bal: PKR ${activeDrawer.expectedInDrawer ?? activeDrawer.currentCashBalance})` : 'No open drawer in your custody'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Line Items Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Purchase Lines</span>
                <Button size="sm" variant="outline" onClick={handleAddPurchaseLine} className="text-xs h-7 gap-1">
                  <Plus className="w-3 h-3" /> Add Item Line
                </Button>
              </div>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {purchaseLines.map((line, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-12 gap-2 items-center text-xs">
                    <div className="col-span-4">
                      <label className="text-[10px] text-slate-500 block mb-0.5">Item</label>
                      <Select
                        value={line.itemId}
                        onValueChange={(val) => {
                          const item = inventoryItems.find((i) => i.id === val);
                          setPurchaseLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? { ...l, itemId: val, unitPurchaseCost: item?.defaultPurchaseCost || l.unitPurchaseCost }
                                : l
                            )
                          );
                        }}
                      >
                        <SelectTrigger className="text-xs h-7 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {inventoryItems.map((i) => (
                            <SelectItem key={i.id} value={i.id} className="text-xs">
                              {i.name} ({i.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block mb-0.5">Batch #</label>
                      <Input
                        value={line.batchNumber}
                        onChange={(e) =>
                          setPurchaseLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, batchNumber: e.target.value } : l))
                          )
                        }
                        className="text-xs h-7 font-mono bg-white"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block mb-0.5">Expiry Date</label>
                      <Input
                        type="date"
                        value={line.expiryDate || ''}
                        onChange={(e) =>
                          setPurchaseLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, expiryDate: e.target.value } : l))
                          )
                        }
                        className="text-xs h-7 font-mono bg-white"
                      />
                    </div>

                    <div className="col-span-1">
                      <label className="text-[10px] text-slate-500 block mb-0.5">Qty</label>
                      <Input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) =>
                          setPurchaseLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, quantity: Number(e.target.value) } : l))
                          )
                        }
                        className="text-xs h-7 font-mono bg-white text-right"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block mb-0.5">Unit Cost (PKR)</label>
                      <Input
                        type="number"
                        min="0"
                        value={line.unitPurchaseCost}
                        onChange={(e) =>
                          setPurchaseLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, unitPurchaseCost: Number(e.target.value) } : l))
                          )
                        }
                        className="text-xs h-7 font-mono bg-white text-right font-bold text-slate-800"
                      />
                    </div>

                    <div className="col-span-1 flex items-center justify-end pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemovePurchaseLine(idx)}
                        disabled={purchaseLines.length === 1}
                        className="h-6 w-6 p-0 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Total Summary Footer */}
            <div className="p-3 bg-[#FDF2F5]/80 rounded-xl border border-[#F1DEE3] flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-slate-900 block">Total Purchase Cost:</span>
                <span className="text-[11px] text-slate-500">
                  Paid: PKR {purchasePaidAmount.toLocaleString()} | Added to Payable: PKR{' '}
                  {Math.max(0, purchaseCalculatedTotal - purchasePaidAmount).toLocaleString()}
                </span>
              </div>
              <span className="font-mono font-bold text-base text-[#9D2558]">
                {formatCurrency(purchaseCalculatedTotal)}
              </span>
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsPurchaseModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSavePurchase} className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
              Confirm & Post Stock-In
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* DRAWER: DEDICATED SUPPLIER LEDGER */}
      {/* ---------------------------------------------------- */}
      <Sheet open={isLedgerDrawerOpen} onOpenChange={setIsLedgerDrawerOpen}>
        <SheetContent className="w-[500px] sm:w-[680px] max-w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm font-bold text-slate-900">
              Supplier Ledger: {selectedSupplierForLedger?.name}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              Complete chronological audit of bills, debit notes, returns, and cash/online disbursements.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Balance</span>
                <p className="font-mono font-bold text-lg text-slate-900">
                  {formatCurrency(selectedSupplierForLedger?.currentBalance || 0)}
                </p>
                <span className="text-[10px] text-slate-500">
                  {(selectedSupplierForLedger?.currentBalance || 0) > 0
                    ? 'Payable to supplier'
                    : (selectedSupplierForLedger?.currentBalance || 0) < 0
                    ? 'Advance / credit on account'
                    : 'Zero balance'}
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => selectedSupplierForLedger && handleOpenPaySupplier(selectedSupplierForLedger)}
                className="text-xs h-8 bg-[#9D2558] hover:bg-[#1B3FC5] text-white"
              >
                Pay Supplier
              </Button>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Reference</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs text-right">Debit</TableHead>
                    <TableHead className="text-xs text-right">Credit</TableHead>
                    <TableHead className="text-xs text-right">Running Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplierLedgerEntries.map((e) => (
                    <TableRow key={e.id} className="text-xs hover:bg-slate-50/60">
                      <TableCell className="font-mono text-slate-600">{e.date}</TableCell>
                      <TableCell className="font-mono font-semibold text-slate-800">{e.reference}</TableCell>
                      <TableCell>
                        <Badge variant="neutral" className="text-[9px]">
                          {e.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 font-semibold">
                        {e.debit ? formatCurrency(e.debit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-rose-600 font-semibold">
                        {e.credit ? formatCurrency(e.credit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-slate-900">
                        {formatCurrency(e.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {supplierLedgerEntries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-xs text-slate-400">
                        No ledger entries found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------------------------------------------------- */}
      {/* MODAL: PAY SUPPLIER */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isPaySupplierModalOpen} onOpenChange={setIsPaySupplierModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Pay Supplier: {paySupplierTarget?.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Disburse payment to reduce outstanding balance. Overpayments produce an advance credit on the supplier ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Amount (PKR) *</label>
              <Input
                type="number"
                min="1"
                value={paySupplierAmount}
                onChange={(e) => setPaySupplierAmount(Number(e.target.value))}
                className="text-xs h-8 font-mono font-bold text-[#9D2558]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Disbursement Method</label>
              <Select
                value={paySupplierMethod}
                onValueChange={(val) => setPaySupplierMethod(val as any)}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH" className="text-xs">Physical Cash (Deducts Custodian Drawer)</SelectItem>
                  <SelectItem value="ONLINE_ACCOUNT" className="text-xs">Online Account (Bank / Wallet)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paySupplierMethod === 'ONLINE_ACCOUNT' ? (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Account</label>
                <Select value={paySupplierAccountId} onValueChange={(val) => setPaySupplierAccountId(val)}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.name} ({a.bankName || a.providerName || a.accountType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Custodian Cash Drawer</label>
                <span className="text-xs font-mono font-medium text-slate-800 bg-slate-50 px-3 py-1.5 rounded border border-slate-200 block">
                  {activeDrawer ? `Drawer: ${activeDrawer.custodianName || activeDrawer.drawerName} (Bal: PKR ${activeDrawer.expectedInDrawer ?? activeDrawer.currentCashBalance})` : 'No open drawer in your custody'}
                </span>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Reference / Cheque # / Notes</label>
              <Input
                placeholder="e.g. Cheque # 12345 or Bank Transfer"
                value={paySupplierNotes}
                onChange={(e) => setPaySupplierNotes(e.target.value)}
                className="text-xs h-8"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsPaySupplierModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleExecutePaySupplier} className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
              Confirm Disbursement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT SUPPLIER */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isSupplierModalOpen} onOpenChange={setIsSupplierModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              {editingSupplier ? 'Edit Supplier' : 'New Supplier Profile'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Record supplier vendor details and optional opening balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Company / Supplier Name *</label>
              <Input
                placeholder="e.g. Loreal Professional Pakistan"
                value={supplierFormData.name || ''}
                onChange={(e) => setSupplierFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="text-xs h-8"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Contact Person</label>
              <Input
                placeholder="e.g. Tariq Mehmood"
                value={supplierFormData.contactPerson || ''}
                onChange={(e) => setSupplierFormData((prev) => ({ ...prev, contactPerson: e.target.value }))}
                className="text-xs h-8"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Phone</label>
                <Input
                  placeholder="0300-1234567"
                  value={supplierFormData.phone || ''}
                  onChange={(e) => setSupplierFormData((prev) => ({ ...prev, phone: e.target.value }))}
                  className="text-xs h-8 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Email</label>
                <Input
                  placeholder="vendor@mail.com"
                  value={supplierFormData.email || ''}
                  onChange={(e) => setSupplierFormData((prev) => ({ ...prev, email: e.target.value }))}
                  className="text-xs h-8"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Address</label>
              <Input
                placeholder="City, Commercial Area"
                value={supplierFormData.address || ''}
                onChange={(e) => setSupplierFormData((prev) => ({ ...prev, address: e.target.value }))}
                className="text-xs h-8"
              />
            </div>

            {!editingSupplier && (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Opening Payable Balance (PKR)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={supplierFormData.openingBalance || 0}
                  onChange={(e) => setSupplierFormData((prev) => ({ ...prev, openingBalance: Number(e.target.value) }))}
                  className="text-xs h-8 font-mono"
                />
              </div>
            )}
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsSupplierModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSupplier} className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
              Save Supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: RECORD STOCK-OUT / SALON CONSUMPTION */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isStockOutModalOpen} onOpenChange={setIsStockOutModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4 text-rose-600" />
              Record Stock Out / Consumption
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Deduct inventory units for in-house salon services, internal use, damage, or expiration using FIFO/FEFO cost layers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Item *</label>
              <Select value={stockOutItemId} onValueChange={(val) => setStockOutItemId(val)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((i) => (
                    <SelectItem key={i.id} value={i.id} className="text-xs">
                      {i.name} (Stock: {stockMap[i.id]?.currentStock || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Department / Use Type</label>
                <Select
                  value={stockOutDepartment}
                  onValueChange={(val) => {
                    setStockOutDepartment(val);
                    if (val === 'Damage') setStockOutReasonType('DAMAGE');
                    else if (val === 'Expired') setStockOutReasonType('EXPIRED');
                    else if (val === 'Internal Use') setStockOutReasonType('INTERNAL_USE');
                    else setStockOutReasonType('SALON_CONSUMPTION');
                  }}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Salon Service" className="text-xs">Salon Service</SelectItem>
                    <SelectItem value="Internal Use" className="text-xs">Internal Use / Cleaning</SelectItem>
                    <SelectItem value="Damage" className="text-xs">Damage / Broken</SelectItem>
                    <SelectItem value="Expired" className="text-xs">Expired Write-Off</SelectItem>
                    <SelectItem value="Staff Testing" className="text-xs">Staff Training / Testing</SelectItem>
                    <SelectItem value="Other" className="text-xs">Other Department</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Responsible Staff Member</label>
                <Select
                  value={stockOutStaffId}
                  onValueChange={(val) => setStockOutStaffId(val)}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Select staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="house" className="text-xs">House / General Salon</SelectItem>
                    {staffList.map((st) => (
                      <SelectItem key={st.id} value={st.id} className="text-xs">
                        {st.name} ({st.designation || st.role || 'Staff'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Reason Code</label>
                <Select
                  value={stockOutReasonType}
                  onValueChange={(val) => setStockOutReasonType(val as any)}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SALON_CONSUMPTION" className="text-xs">Salon Consumption</SelectItem>
                    <SelectItem value="INTERNAL_USE" className="text-xs">Internal Use</SelectItem>
                    <SelectItem value="DAMAGE" className="text-xs">Damage / Wastage</SelectItem>
                    <SelectItem value="EXPIRED" className="text-xs">Expired Stock</SelectItem>
                    <SelectItem value="OTHER" className="text-xs">Other Reason</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Quantity to Deduct *</label>
                <Input
                  type="number"
                  min="1"
                  value={stockOutQuantity}
                  onChange={(e) => setStockOutQuantity(Math.max(1, Number(e.target.value)))}
                  className="text-xs h-8 font-mono font-bold"
                />
              </div>
            </div>

            {/* LIVE FIFO / FEFO COST PREVIEW & BREAKDOWN CARD */}
            {isPreviewLoading ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-2 text-xs text-slate-500">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin inline-block" />
                <span>Calculating FIFO/FEFO cost layers...</span>
              </div>
            ) : stockOutPreview ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#9D2558]" />
                    Cost Layer Allocation (FIFO / FEFO)
                  </span>
                  <Badge
                    variant="neutral"
                    className={`text-[10px] font-bold ${
                      stockOutPreview.isFulfillable
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    {stockOutPreview.isFulfillable ? 'Stock Available' : 'Insufficient Stock'}
                  </Badge>
                </div>

                {!stockOutPreview.isFulfillable ? (
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] font-semibold">
                    Requested quantity ({stockOutQuantity}) exceeds available valid sellable stock ({stockOutPreview.availableStock} units).
                  </div>
                ) : (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>Available Valid Stock:</span>
                      <strong className="font-mono text-slate-900">{stockOutPreview.availableStock} Units</strong>
                    </div>
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>Total Cost Impact (FIFO):</span>
                      <strong className="font-mono text-slate-900 text-xs">{formatCurrency(stockOutPreview.totalCost)}</strong>
                    </div>

                    {stockOutPreview.costBreakdown && stockOutPreview.costBreakdown.length > 0 && (
                      <div className="mt-2 border-t border-slate-200/80 pt-1.5 space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Batches to Deduct ({stockOutPreview.costBreakdown.length})
                        </span>
                        {stockOutPreview.costBreakdown.map((layer, idx) => (
                          <div key={idx} className="flex items-center justify-between p-1.5 bg-white rounded-lg border border-slate-200 text-[11px]">
                            <div>
                              <span className="font-bold text-slate-800 font-mono">{layer.batchNumber}</span>
                              {layer.expiryDate && (
                                <span className="text-[10px] text-slate-400 ml-1.5">
                                  (Exp: {new Date(layer.expiryDate).toLocaleDateString()})
                                </span>
                              )}
                            </div>
                            <div className="text-right font-mono">
                              <span className="text-slate-600">{layer.quantity} × {formatCurrency(layer.unitCostSnapshot)} = </span>
                              <strong className="text-slate-900">{formatCurrency(layer.costImpact)}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Audit Notes / Treatment Details</label>
              <Input
                placeholder="e.g. Used for Hair Spa Treatment on Chair 3"
                value={stockOutNotes}
                onChange={(e) => setStockOutNotes(e.target.value)}
                className="text-xs h-8"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsStockOutModalOpen(false)} className="text-xs cursor-pointer">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isStockOutSubmitting || isPreviewLoading || (stockOutPreview ? !stockOutPreview.isFulfillable : false) || stockOutQuantity <= 0}
              onClick={handleExecuteStockOut}
              className="text-xs bg-[#9D2558] hover:bg-[#831e48] text-white cursor-pointer"
            >
              {isStockOutSubmitting ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block mr-1" />
              ) : null}
              Confirm Stock-Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: REVERSE STOCK MOVEMENT */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isReverseModalOpen} onOpenChange={setIsReverseModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-rose-600" />
              Reverse Stock Movement
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Restore stock quantity to its original batch with an audited compensating POSITIVE_ADJUSTMENT transaction.
            </DialogDescription>
          </DialogHeader>

          {movementToReverse && (
            <div className="space-y-3 py-2 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Movement #:</span>
                  <span className="font-mono font-bold text-slate-800">{movementToReverse.movementNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Item:</span>
                  <span className="font-bold text-slate-900">{movementToReverse.itemName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Quantity to Restore:</span>
                  <span className="font-mono font-bold text-emerald-700">+{movementToReverse.quantity} Units</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Unit Cost Snapshot:</span>
                  <span className="font-mono text-slate-700">{formatCurrency(movementToReverse.unitCostSnapshot || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Cost Impact to Reverse:</span>
                  <span className="font-mono font-bold text-slate-900">{formatCurrency(movementToReverse.totalCostImpact || 0)}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Reason for Reversal * <span className="text-[10px] text-slate-400 font-normal">(Min 3 characters)</span>
                </label>
                <Input
                  placeholder="e.g. Unused leftover product returned to shelf, or logged in error"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="text-xs h-8"
                  autoFocus
                />
              </div>

              <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] leading-snug">
                Note: This creates an immutable compensating <strong>POSITIVE_ADJUSTMENT</strong> movement and restores the batch remaining quantity. Original movement logs are preserved.
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsReverseModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isReversing || !reversalReason.trim() || reversalReason.trim().length < 3}
              onClick={handleExecuteReverseMovement}
              className="text-xs bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
            >
              {isReversing ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block mr-1" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
              )}
              Confirm Reversal & Restore Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: PHYSICAL STOCK SETTLEMENT AUDIT */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isSettlementModalOpen} onOpenChange={setIsSettlementModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Physical Stock Count Reconciliation
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Input physical counts. SalonOS compares physical numbers against recorded stock and generates audited adjustment movements for any variances.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Audit Notes / Count Scope</label>
              <Input
                placeholder="e.g. Monthly Physical Inventory Audit - End of Month"
                value={settlementNotes}
                onChange={(e) => setSettlementNotes(e.target.value)}
                className="text-xs h-8"
              />
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs text-right">System Qty</TableHead>
                    <TableHead className="text-xs text-right w-24">Counted Qty</TableHead>
                    <TableHead className="text-xs text-right">Variance</TableHead>
                    <TableHead className="text-xs w-44">Discrepancy Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlementLines.map((line, idx) => {
                    const diff = line.countedQuantity - line.systemQuantity;
                    return (
                      <TableRow key={line.itemId} className="text-xs">
                        <TableCell className="font-semibold text-slate-900">{line.itemName}</TableCell>
                        <TableCell className="text-right font-mono text-slate-600">{line.systemQuantity}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            value={line.countedQuantity}
                            onChange={(e) =>
                              handleUpdateSettlementLine(idx, Number(e.target.value), line.reason, line.notes)
                            }
                            className="text-xs h-7 font-mono font-bold text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold">
                          {diff === 0 ? (
                            <span className="text-slate-400">0</span>
                          ) : diff > 0 ? (
                            <span className="text-emerald-600">+{diff}</span>
                          ) : (
                            <span className="text-rose-600">{diff}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={line.reason}
                            onValueChange={(val) =>
                              handleUpdateSettlementLine(idx, line.countedQuantity, val as any, line.notes)
                            }
                            disabled={diff === 0}
                          >
                            <SelectTrigger className="text-xs h-7">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="COUNTING_CORRECTION" className="text-xs">Counting Correction</SelectItem>
                              <SelectItem value="DAMAGE" className="text-xs">Damaged Stock</SelectItem>
                              <SelectItem value="MISSING" className="text-xs">Missing / Loss</SelectItem>
                              <SelectItem value="UNRECORDED_CONSUMPTION" className="text-xs">Unrecorded Consumption</SelectItem>
                              <SelectItem value="EXPIRED" className="text-xs">Expired</SelectItem>
                              <SelectItem value="OTHER" className="text-xs">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsSettlementModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleExecuteSettlement} className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
              Confirm & Post Audit Adjustments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: SUPPLIER RETURN */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isReturnModalOpen} onOpenChange={setIsReturnModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Supplier / Purchase Return (Debit Note)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Return stock to supplier, deduct inventory units, and generate an audited debit note reducing supplier payable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Supplier *</label>
              <Select value={returnSupplierId} onValueChange={(val) => setReturnSupplierId(val)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Return Reason</label>
              <Select value={returnReason} onValueChange={(val) => setReturnReason(val)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAMAGED_DELIVERY" className="text-xs">Damaged on Delivery</SelectItem>
                  <SelectItem value="DEFECTIVE_PRODUCT" className="text-xs">Defective / Spoiled Product</SelectItem>
                  <SelectItem value="SHORT_EXPIRY" className="text-xs">Too Close to Expiry</SelectItem>
                  <SelectItem value="WRONG_ITEM_SHIPPED" className="text-xs">Wrong Item Shipped</SelectItem>
                  <SelectItem value="EXCESS_STOCK" className="text-xs">Excess Stock Return</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Item to Return</label>
              <Select
                value={returnLines[0]?.itemId || ''}
                onValueChange={(val) => {
                  const itm = inventoryItems.find((i) => i.id === val);
                  setReturnLines([
                    {
                      itemId: val,
                      quantity: 1,
                      unitCost: itm?.defaultPurchaseCost ?? 0,
                    },
                  ]);
                }}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((i) => (
                    <SelectItem key={i.id} value={i.id} className="text-xs">
                      {i.name} (Stock: {stockMap[i.id]?.currentStock || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Quantity</label>
                <Input
                  type="number"
                  min="1"
                  value={returnLines[0]?.quantity || 1}
                  onChange={(e) =>
                    setReturnLines((prev) => [
                      {
                        ...prev[0],
                        quantity: Number(e.target.value),
                      },
                    ])
                  }
                  className="text-xs h-8 font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Unit Cost (PKR)</label>
                <Input
                  type="number"
                  min="0"
                  value={returnLines[0]?.unitCost || 0}
                  onChange={(e) =>
                    setReturnLines((prev) => [
                      {
                        ...prev[0],
                        unitCost: Number(e.target.value),
                      },
                    ])
                  }
                  className="text-xs h-8 font-mono font-bold text-rose-600"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setIsReturnModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleExecuteSupplierReturn} className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white">
              Confirm Return & Debit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: SUPPLIER LEDGER STATEMENT */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isLedgerDrawerOpen} onOpenChange={setIsLedgerDrawerOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#FDF2F5] text-[#9D2558]">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Supplier Ledger: {selectedSupplierForLedger?.name}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 mt-0.5">
                    Itemized statement of bills, payments, returns, and running payable balance for{' '}
                    <span className="font-semibold text-slate-700">
                      {selectedSupplierForLedger?.companyName || selectedSupplierForLedger?.name}
                    </span>
                  </DialogDescription>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  if (selectedSupplierForLedger) {
                    handleOpenPaySupplier(selectedSupplierForLedger);
                  }
                }}
                className="h-8 text-xs px-3 gap-1.5 bg-[#9D2558] hover:bg-[#1B3FC5] text-white self-start sm:self-auto"
              >
                <DollarSign className="w-3.5 h-3.5" /> Pay Supplier
              </Button>
            </div>
          </DialogHeader>

          {/* Supplier Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 py-2">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Opening Balance
              </span>
              <span className="font-mono text-xs font-bold text-slate-800 mt-0.5 block">
                {formatCurrency(supplierLedgerSummary.openingPayable)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total Purchases
              </span>
              <span className="font-mono text-xs font-bold text-rose-600 mt-0.5 block">
                {formatCurrency(supplierLedgerSummary.totalPurchases)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total Payments
              </span>
              <span className="font-mono text-xs font-bold text-emerald-600 mt-0.5 block">
                {formatCurrency(supplierLedgerSummary.totalPayments)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total Returns
              </span>
              <span className="font-mono text-xs font-bold text-emerald-600 mt-0.5 block">
                {formatCurrency(supplierLedgerSummary.totalReturns)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FDF2F5]/70 border border-[#F1DEE3] col-span-2 sm:col-span-1">
              <span className="text-[10px] font-semibold text-[#851C47] uppercase tracking-wider block">
                Net Outstanding
              </span>
              <span
                className={`font-mono text-xs font-bold mt-0.5 block ${
                  supplierLedgerSummary.closingPayable > 0
                    ? 'text-rose-600'
                    : supplierLedgerSummary.closingPayable < 0
                    ? 'text-emerald-600'
                    : 'text-slate-700'
                }`}
              >
                {formatCurrency(Math.abs(supplierLedgerSummary.closingPayable))}
                <span className="text-[9px] font-normal text-slate-500 ml-1">
                  {supplierLedgerSummary.closingPayable > 0
                    ? '(Payable)'
                    : supplierLedgerSummary.closingPayable < 0
                    ? '(Advance)'
                    : '(Settled)'}
                </span>
              </span>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto mt-2">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="text-xs font-bold text-slate-700">Date</TableHead>
                  <TableHead className="text-xs font-bold text-slate-700">Type</TableHead>
                  <TableHead className="text-xs font-bold text-slate-700">Reference #</TableHead>
                  <TableHead className="text-xs font-bold text-slate-700">Description</TableHead>
                  <TableHead className="text-xs font-bold text-slate-700 text-right">Debit (Payment/Return)</TableHead>
                  <TableHead className="text-xs font-bold text-slate-700 text-right">Credit (Bill/Opening)</TableHead>
                  <TableHead className="text-xs font-bold text-slate-700 text-right">Running Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierLedgerEntries.map((e) => {
                  const isDebit = (e.debit || 0) > 0;
                  const isCredit = (e.credit || 0) > 0;
                  const typeLabel =
                    e.entryType === 'PURCHASE_BILL'
                      ? 'Purchase Bill'
                      : e.entryType === 'SUPPLIER_PAYMENT'
                      ? 'Payment'
                      : e.entryType === 'PURCHASE_RETURN'
                      ? 'Return'
                      : e.entryType === 'OPENING_BALANCE'
                      ? 'Opening'
                      : e.entryType === 'SUPPLIER_REFUND'
                      ? 'Refund Received'
                      : e.entryType;

                  const badgeColor =
                    e.entryType === 'PURCHASE_BILL'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : e.entryType === 'SUPPLIER_PAYMENT'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : e.entryType === 'PURCHASE_RETURN'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200';

                  return (
                    <TableRow key={e.id} className="hover:bg-slate-50/70 text-xs">
                      <TableCell className="font-mono text-slate-600 whitespace-nowrap">
                        {e.date}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
                          {typeLabel}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono font-medium text-slate-900 whitespace-nowrap">
                        {e.referenceNumber || e.reference || '—'}
                      </TableCell>
                      <TableCell className="text-slate-700 max-w-xs truncate" title={e.description}>
                        {e.description}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-emerald-600 whitespace-nowrap">
                        {isDebit ? formatCurrency(e.debit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-rose-600 whitespace-nowrap">
                        {isCredit ? formatCurrency(e.credit) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {formatCurrency(Math.abs(e.runningBalance))}
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          {e.runningBalance > 0 ? 'Dr' : e.runningBalance < 0 ? 'Cr' : ''}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {supplierLedgerEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-xs text-slate-400">
                      No ledger transactions recorded for this supplier.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsLedgerDrawerOpen(false)}
              className="text-xs"
            >
              Close Ledger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* MODAL: PAY SUPPLIER */}
      {/* ---------------------------------------------------- */}
      <Dialog open={isPaySupplierModalOpen} onOpenChange={setIsPaySupplierModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Record Supplier Payment
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Post an authorized payment to settle accounts payable for{' '}
              <span className="font-semibold text-slate-700">{paySupplierTarget?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          {/* Current balance card */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-600 font-medium">Outstanding Balance:</span>
            <span className="font-mono font-bold text-sm text-rose-600">
              {formatCurrency(paySupplierTarget?.currentBalance || 0)}
            </span>
          </div>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Payment Amount (PKR) *
              </label>
              <Input
                type="number"
                min="1"
                required
                value={paySupplierAmount}
                onChange={(e) => setPaySupplierAmount(Number(e.target.value))}
                className="text-xs h-8 font-mono font-bold"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Payment Method *
              </label>
              <Select
                value={paySupplierMethod}
                onValueChange={(val) => setPaySupplierMethod(val as any)}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH" className="text-xs">
                    Cash from Active Drawer
                  </SelectItem>
                  <SelectItem value="ONLINE_ACCOUNT" className="text-xs">
                    Bank / Online Account
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paySupplierMethod === 'CASH' && (
              <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                {activeDrawer ? (
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                      Drawer Custody: {activeDrawer.custodianName}
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      Balance: {formatCurrency(activeDrawer.expectedInDrawer ?? activeDrawer.currentCashBalance ?? 0)}
                    </span>
                  </div>
                ) : (
                  <div className="text-rose-600 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>No active open cash drawer found in your custody.</span>
                  </div>
                )}
              </div>
            )}

            {paySupplierMethod === 'ONLINE_ACCOUNT' && (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Select Bank / Payment Account *
                </label>
                <Select
                  value={paySupplierAccountId}
                  onValueChange={(val) => setPaySupplierAccountId(val)}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Select bank account" />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id} className="text-xs">
                        {acc.name} ({acc.bankName || acc.providerName || acc.accountHolder}) · Balance:{' '}
                        {formatCurrency(acc.currentBalance || 0)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Payment Reference / Notes
              </label>
              <Input
                placeholder="e.g. Cheque #49201 or Online Txn Ref"
                value={paySupplierNotes}
                onChange={(e) => setPaySupplierNotes(e.target.value)}
                className="text-xs h-8"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPaySupplierModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleExecutePaySupplier}
              className="text-xs bg-[#9D2558] hover:bg-[#1B3FC5] text-white"
            >
              Post Payment & Update Ledger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
