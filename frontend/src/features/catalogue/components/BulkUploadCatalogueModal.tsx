import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BranchActionField } from '@/components/BranchActionField';
import { useBranchAction } from '@/hooks/useBranchAction';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { toast } from '@/context/ToastContext';
import { ServiceItem, PackageItem } from '@/types/salon';
import { formatCurrency } from '@/lib/formatters';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Upload,
  Download,
  Scissors,
  Package,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  FileText,
  Check,
  Sparkles,
} from 'lucide-react';

interface BulkUploadCatalogueModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: 'SERVICES' | 'PACKAGES';
  branchId: string;
  existingServices: ServiceItem[];
  existingPackages: PackageItem[];
  onSuccess: () => void;
}

interface ParsedServiceRow {
  rowNumber: number;
  name: string;
  category: string;
  price: number;
  isNewCategory: boolean;
  isValid: boolean;
  error?: string;
}

interface ParsedPackageComponent {
  serviceIdentifier: string;
  matchedService?: ServiceItem;
  quantity: number;
  allocationPercentage: number;
}

interface ParsedPackageRow {
  rowNumber: number;
  name: string;
  price: number;
  components: ParsedPackageComponent[];
  isValid: boolean;
  error?: string;
}

/**
 * Tokenize service string into individual services with optional multipliers:
 * Handles: "Hair Cut, Beard Grooming" or "2x Blowdry; 1x Hair Treatment" or "Hair Cut: 2, Shave: 1"
 */
function parseServiceTokens(servicesText: string): { serviceIdentifier: string; quantity: number }[] {
  if (!servicesText || !servicesText.trim()) return [];
  const rawTokens = servicesText
    .split(/[,;\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return rawTokens.map((raw) => {
    let name = raw.trim();
    let qty = 1;
    const prefixMatch = name.match(/^(\d+)\s*[xX*]\s*(.+)$/);
    if (prefixMatch) {
      qty = parseInt(prefixMatch[1], 10) || 1;
      name = prefixMatch[2].trim();
    } else {
      const suffixMatch = name.match(/^(.+?)\s*(?:[xX*:]|\()\s*(\d+)\s*\)?$/);
      if (suffixMatch) {
        name = suffixMatch[1].trim();
        qty = parseInt(suffixMatch[2], 10) || 1;
      }
    }
    return { serviceIdentifier: name, quantity: qty > 0 ? qty : 1 };
  });
}

/**
 * Dynamically computes equal allocations summing to exactly 100%
 */
function computeEqualAllocations(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((100 / count) * 100) / 100;
  const allocations: number[] = [];
  let sum = 0;
  for (let i = 0; i < count - 1; i++) {
    allocations.push(base);
    sum += base;
  }
  allocations.push(Math.round((100 - sum) * 100) / 100);
  return allocations;
}

/**
 * Robust CSV/TSV tokenizer respecting quotes and delimiters
 */
function tokenizeGrid(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // Check if content is Tab-Separated (e.g. copied directly from Excel)
  const isTSV = lines.some((l) => l.includes('\t'));

  if (isTSV) {
    return lines.map((line) => line.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  }

  return lines.map((line) => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  });
}

const loadImportBranch = async (branchId: string) => {
  const [services, packages] = await Promise.all([
    salonService.getServices(branchId),
    salonService.getPackages(branchId),
  ]);
  return { services, packages };
};

export const BulkUploadCatalogueModal: React.FC<BulkUploadCatalogueModalProps> = ({
  isOpen,
  onClose,
  initialType = 'SERVICES',
  branchId: _readBranchId,
  existingServices: _readServices,
  existingPackages: _readPackages,
  onSuccess,
}) => {
  const { user } = useAuth();
  const actionScope = useBranchAction(isOpen, loadImportBranch);
  const branchId = actionScope.branchId;
  const existingServices = actionScope.data?.services || [];
  const existingPackages = actionScope.data?.packages || [];

  const [activeTab, setActiveTab] = useState<'SERVICES' | 'PACKAGES'>(initialType);
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parsed rows
  const [parsedServices, setParsedServices] = useState<ParsedServiceRow[]>([]);
  const [parsedPackages, setParsedPackages] = useState<ParsedPackageRow[]>([]);

  const handleTabChange = (val: string) => {
    const nextTab = val as 'SERVICES' | 'PACKAGES';
    setActiveTab(nextTab);
    setRawText('');
    setFileName(null);
    setParsedServices([]);
    setParsedPackages([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Template Generation & Download (Excel & CSV) ─────────────────────────

  const downloadServicesTemplateExcel = () => {
    const headers = ['Name', 'Price', 'Category'];
    const rows = [
      ['Hair Cut & Styling', 1500, 'Hair Services'],
      ['Beard Grooming & Shape', 800, 'Men Grooming'],
      ['Hydra Facial Glow', 4500, 'Facials & Skin'],
      ['Classic Manicure', 1200, 'Nail Care'],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Services');
    XLSX.writeFile(wb, 'services_bulk_import_template.xlsx');
  };

  const downloadServicesTemplateCsv = () => {
    const headers = ['Name', 'Price', 'Category'];
    const rows = [
      ['Hair Cut & Styling', '1500', 'Hair Services'],
      ['Beard Grooming & Shape', '800', 'Men Grooming'],
      ['Hydra Facial Glow', '4500', 'Facials & Skin'],
      ['Classic Manicure', '1200', 'Nail Care'],
    ];

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))].join(
        '\n'
      );

    downloadBlob(csvContent, 'services_bulk_import_template.csv', 'text/csv;charset=utf-8;');
  };

  const downloadPackagesTemplateExcel = () => {
    const headers = ['Name', 'Services', 'Price'];
    const branchActiveServices = existingServices.filter((s) => s.branchId === branchId && s.isActive);
    let sampleServicesStr1 = 'Hydra Facial Glow, Classic Manicure';
    let sampleServicesStr2 = 'Hair Cut & Styling, Beard Grooming & Shape';

    if (branchActiveServices.length >= 2) {
      sampleServicesStr1 = `${branchActiveServices[0].name}, ${branchActiveServices[1].name}`;
    }
    if (branchActiveServices.length >= 4) {
      sampleServicesStr2 = `${branchActiveServices[2].name}, ${branchActiveServices[3].name}`;
    }

    const rows = [
      ['Bridal Pamper Glow', sampleServicesStr1, 12000],
      ['Groom Complete Styling', sampleServicesStr2, 3500],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 30 }, { wch: 50 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Packages');
    XLSX.writeFile(wb, 'packages_bulk_import_template.xlsx');
  };

  const downloadPackagesTemplateCsv = () => {
    const headers = ['Name', 'Services', 'Price'];
    const branchActiveServices = existingServices.filter((s) => s.branchId === branchId && s.isActive);
    let sampleServicesStr1 = 'Hydra Facial Glow, Classic Manicure';
    let sampleServicesStr2 = 'Hair Cut & Styling, Beard Grooming & Shape';

    if (branchActiveServices.length >= 2) {
      sampleServicesStr1 = `${branchActiveServices[0].name}, ${branchActiveServices[1].name}`;
    }
    if (branchActiveServices.length >= 4) {
      sampleServicesStr2 = `${branchActiveServices[2].name}, ${branchActiveServices[3].name}`;
    }

    const rows = [
      ['Bridal Pamper Glow', sampleServicesStr1, '12000'],
      ['Groom Complete Styling', sampleServicesStr2, '3500'],
    ];

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))].join(
        '\n'
      );

    downloadBlob(csvContent, 'packages_bulk_import_template.csv', 'text/csv;charset=utf-8;');
  };

  const downloadBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── File Upload Handler (.xlsx, .xls, .csv, .tsv) ─────────────────────────

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const buffer = event.target?.result as ArrayBuffer;
          const workbook = XLSX.read(buffer, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const grid: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
          processGrid(grid, activeTab);
          setRawText(`[Uploaded Excel file: ${file.name} with ${grid.length} rows]`);
        } catch (err: any) {
          toast.error(`Failed to read Excel file: ${err.message || 'Corrupted file'}`);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = (event.target?.result as string) || '';
        setRawText(text);
        const grid = tokenizeGrid(text);
        processGrid(grid, activeTab);
      };
      reader.readAsText(file);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setRawText(text);
    setFileName(null);
    const grid = tokenizeGrid(text);
    processGrid(grid, activeTab);
  };

  // ── Grid Processing & Schema Validation ───────────────────────────────────

  const processGrid = (rawGrid: any[][], type: 'SERVICES' | 'PACKAGES') => {
    if (!rawGrid || rawGrid.length < 2) {
      if (type === 'SERVICES') setParsedServices([]);
      else setParsedPackages([]);
      return;
    }

    // Clean empty rows
    const grid = rawGrid.filter((row) => row && row.some((cell) => String(cell).trim().length > 0));
    if (grid.length < 2) {
      if (type === 'SERVICES') setParsedServices([]);
      else setParsedPackages([]);
      return;
    }

    const header = grid[0].map((h) =>
      String(h || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    );
    const dataRows = grid.slice(1);

    if (type === 'SERVICES') {
      // Columns: name, price, category
      let nameIdx = header.findIndex((h) => h.includes('name') || h === 'service');
      let priceIdx = header.findIndex(
        (h) => h.includes('price') || h.includes('rate') || h.includes('cost') || h.includes('amount')
      );
      let catIdx = header.findIndex((h) => h.includes('cat') || h.includes('group'));

      // If headers not named as expected, fallback to column order
      if (nameIdx === -1 && priceIdx === -1 && catIdx === -1) {
        nameIdx = 0;
        priceIdx = 1;
        catIdx = 2;
      } else {
        if (nameIdx === -1) nameIdx = 0;
        if (priceIdx === -1) priceIdx = 1;
        if (catIdx === -1) catIdx = 2;
      }

      const branchCategories = new Set(
        existingServices
          .filter((s) => !branchId || s.branchId === branchId)
          .map((s) => (s.category || '').trim().toLowerCase())
      );

      const parsed: ParsedServiceRow[] = dataRows.map((cols, idx) => {
        const rowNumber = idx + 2;
        const rawName = String(cols[nameIdx] !== undefined ? cols[nameIdx] : '').trim();
        const rawPrice = cols[priceIdx] !== undefined ? cols[priceIdx] : '';
        const priceNum = Number(String(rawPrice).replace(/[^0-9.-]/g, ''));
        const rawCat = String(cols[catIdx] !== undefined && cols[catIdx] !== '' ? cols[catIdx] : 'General').trim();

        let isValid = true;
        let error: string | undefined;

        if (!rawName) {
          isValid = false;
          error = 'Service name is required.';
        } else if (isNaN(priceNum) || priceNum < 0) {
          isValid = false;
          error = 'Valid price is required (non-negative number).';
        }

        const isNewCategory = rawCat ? !branchCategories.has(rawCat.toLowerCase()) : false;

        return {
          rowNumber,
          name: rawName,
          price: isNaN(priceNum) ? 0 : priceNum,
          category: rawCat || 'General',
          isNewCategory,
          isValid,
          error,
        };
      });

      setParsedServices(parsed);
    } else {
      // PACKAGES
      // Columns: name, services, price
      let nameIdx = header.findIndex((h) => h.includes('name') || h === 'package');
      let servicesIdx = header.findIndex(
        (h) => h.includes('service') || h.includes('comp') || h.includes('item')
      );
      let priceIdx = header.findIndex(
        (h) => h.includes('price') || h.includes('rate') || h.includes('cost') || h.includes('amount')
      );

      if (nameIdx === -1 && servicesIdx === -1 && priceIdx === -1) {
        nameIdx = 0;
        servicesIdx = 1;
        priceIdx = 2;
      } else {
        if (nameIdx === -1) nameIdx = 0;
        if (servicesIdx === -1) servicesIdx = 1;
        if (priceIdx === -1) priceIdx = 2;
      }

      const branchServices = existingServices.filter((s) => !branchId || s.branchId === branchId);

      const parsed: ParsedPackageRow[] = dataRows.map((cols, idx) => {
        const rowNumber = idx + 2;
        const rawName = String(cols[nameIdx] !== undefined ? cols[nameIdx] : '').trim();
        const rawServices = String(cols[servicesIdx] !== undefined ? cols[servicesIdx] : '').trim();
        const rawPrice = cols[priceIdx] !== undefined ? cols[priceIdx] : '';
        const priceNum = Number(String(rawPrice).replace(/[^0-9.-]/g, ''));

        let isValid = true;
        let error: string | undefined;

        if (!rawName) {
          isValid = false;
          error = 'Package name is required.';
        } else if (isNaN(priceNum) || priceNum < 0) {
          isValid = false;
          error = 'Valid price is required (non-negative number).';
        } else if (!rawServices) {
          isValid = false;
          error = 'At least one service must be specified in the Services column.';
        }

        // Tokenize services
        const tokens = parseServiceTokens(rawServices);
        const allocations = computeEqualAllocations(tokens.length);

        if (tokens.length === 0 && isValid) {
          isValid = false;
          error = 'No services found in Services column.';
        }

        const components: ParsedPackageComponent[] = [];

        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          const query = t.serviceIdentifier.trim();
          const targetName = query.toLowerCase();
          const targetCode = query.toUpperCase();

          const matched = branchServices.find(
            (s) =>
              s.code.toUpperCase() === targetCode ||
              s.name.trim().toLowerCase() === targetName ||
              s.id === query ||
              s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === targetName.replace(/[^a-z0-9]/g, '')
          );

          if (!query && isValid) {
            isValid = false;
            error = 'Service name cannot be empty.';
          }

          components.push({
            serviceIdentifier: query,
            matchedService: matched,
            quantity: t.quantity,
            allocationPercentage: allocations[i] || 0,
          });
        }

        return {
          rowNumber,
          name: rawName,
          price: isNaN(priceNum) ? 0 : priceNum,
          components,
          isValid,
          error,
        };
      });

      setParsedPackages(parsed);
    }
  };

  // ── Import Submission ─────────────────────────────────────────────────────

  const handleConfirmImport = async () => {
    if (!actionScope.validate()) return;

    if (activeTab === 'SERVICES') {
      const validRows = parsedServices.filter((s) => s.isValid);
      if (validRows.length === 0) {
        toast.error('No valid service rows to import.');
        return;
      }

      setIsSubmitting(true);
      try {
        const payload = validRows.map((r) => ({
          name: r.name,
          category: r.category,
          price: r.price,
          durationMinutes: 30,
          isActive: true,
        }));

        const result = await salonService.bulkImportServices(branchId, payload, user || undefined);
        toast.success(
          `Services Bulk Import Complete: ${result.acceptedRows} accepted, ${result.duplicateRows} skipped, ${result.rejectedRows} rejected.`
        );
        onSuccess();
        onClose();
      } catch (err: any) {
        toast.error(err.message || 'Failed to bulk import services.');
      } finally {
        setIsSubmitting(false);
      }
    } else {
      const validRows = parsedPackages.filter((p) => p.isValid);
      if (validRows.length === 0) {
        toast.error('No valid package rows to import.');
        return;
      }

      setIsSubmitting(true);
      try {
        const payload = validRows.map((r) => ({
          name: r.name,
          price: r.price,
          isActive: true,
          services: r.components.map((c) => c.matchedService?.name || c.serviceIdentifier).join(', '),
          components: r.components.map((c) => ({
            serviceId: c.matchedService?.id,
            serviceCode: c.matchedService?.code || c.serviceIdentifier,
            serviceName: c.matchedService?.name || c.serviceIdentifier,
            quantity: c.quantity,
            allocationPercentage: c.allocationPercentage,
          })),
        }));

        const result = await salonService.bulkImportPackages(branchId, payload, user || undefined);
        toast.success(
          `Packages Bulk Import Complete: ${result.acceptedRows} accepted, ${result.duplicateRows} skipped, ${result.rejectedRows} rejected.`
        );
        onSuccess();
        onClose();
      } catch (err: any) {
        toast.error(err.message || 'Failed to bulk import packages.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const currentParsedCount = activeTab === 'SERVICES' ? parsedServices.length : parsedPackages.length;
  const currentValidCount =
    activeTab === 'SERVICES'
      ? parsedServices.filter((s) => s.isValid).length
      : parsedPackages.filter((p) => p.isValid).length;
  const currentInvalidCount = currentParsedCount - currentValidCount;


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[96vw] max-w-3xl max-h-[88vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-w-0 flex flex-col gap-3.5">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#FDF2F5] text-[#9D2558] flex items-center justify-center shadow-xs shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 truncate">
                Bulk Upload Catalogue (Excel & CSV)
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 line-clamp-1">
                Import services with (Name, Price, Category) or packages with (Name, Services, Price).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Branch Selector */}
        <div className="shrink-0">
          <BranchActionField
            value={branchId}
            disabled={isSubmitting}
            onChange={(id) => {
              actionScope.setBranchId(id);
              handleTabChange(activeTab);
            }}
          />
        </div>
        {actionScope.error && (
          <p role="alert" className="text-xs text-rose-600 font-medium shrink-0">
            {actionScope.error}
          </p>
        )}

        <fieldset disabled={!actionScope.ready} className="space-y-3.5 min-w-0 flex-1">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-1 min-w-0">
            {/* TAB SELECTOR & TEMPLATE DOWNLOADS */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <TabsList className="!bg-transparent !border-0 !p-0 gap-2.5 h-auto inline-flex items-center w-fit shrink-0">
                <TabsTrigger
                  value="SERVICES"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 data-[state=active]:!bg-white data-[state=active]:!border-[#B82E69] data-[state=active]:!text-[#B82E69] data-[state=active]:font-semibold data-[state=active]:!shadow-xs transition-all cursor-pointer"
                >
                  <Scissors className="w-4 h-4 text-[#B82E69]" />
                  <span>Services</span>
                </TabsTrigger>
                <TabsTrigger
                  value="PACKAGES"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 data-[state=active]:!bg-white data-[state=active]:!border-[#B82E69] data-[state=active]:!text-[#B82E69] data-[state=active]:font-semibold data-[state=active]:!shadow-xs transition-all cursor-pointer"
                >
                  <Package className="w-4 h-4 text-[#B82E69]" />
                  <span>Packages</span>
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Download className="w-3.5 h-3.5 text-emerald-600" />}
                  onClick={activeTab === 'SERVICES' ? downloadServicesTemplateExcel : downloadPackagesTemplateExcel}
                  className="text-xs h-7 px-2 font-semibold border-emerald-200 hover:bg-emerald-50 text-emerald-800"
                  title="Download clean Excel .XLSX template"
                >
                  Download Excel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Download className="w-3.5 h-3.5 text-slate-500" />}
                  onClick={activeTab === 'SERVICES' ? downloadServicesTemplateCsv : downloadPackagesTemplateCsv}
                  className="text-xs h-7 px-2 text-slate-600"
                  title="Download CSV template"
                >
                  Download CSV
                </Button>
              </div>
            </div>

            {/* INPUT ACTIONS */}
            <div className="space-y-4 pt-3">
              {/* FILE UPLOAD / DRAG AREA */}
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="catalogue-file-input"
                />
                <label
                  htmlFor="catalogue-file-input"
                  className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-[#9D2558]/30 hover:border-[#9D2558] bg-[#FDF2F5]/30 hover:bg-[#FDF2F5]/60 rounded-xl text-xs font-semibold text-[#9D2558] cursor-pointer transition-all shadow-2xs"
                >
                  <Upload className="w-4 h-4 text-[#9D2558]" />
                  <span>Choose Excel (.xlsx) or CSV File</span>
                </label>

                {fileName && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 font-medium">
                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{fileName}</span>
                  </div>
                )}

                {rawText && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRawText('');
                      setFileName(null);
                      setParsedServices([]);
                      setParsedPackages([]);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-xs text-slate-500 hover:text-rose-600 ml-auto h-8 gap-1 font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                )}
              </div>

              {/* RAW PASTE TEXTAREA */}
              <div className="min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    Or Copy & Paste Directly from Excel / CSV:
                  </span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {activeTab === 'SERVICES'
                      ? 'Format: Name, Price, Category'
                      : 'Format: Name, Services, Price'}
                  </span>
                </div>
                <textarea
                  value={rawText}
                  onChange={handleTextChange}
                  placeholder={
                    activeTab === 'SERVICES'
                      ? `Name,Price,Category\nHair Cut & Style,1500,Hair Services\nBeard Grooming,800,Men Grooming\nHydra Facial,4500,Facials`
                      : `Name,Services,Price\n"Bridal Glow","Hydra Facial, Classic Manicure",12000\n"Men Pamper","Hair Cut & Style, Beard Grooming",2200`
                  }
                  rows={3}
                  className="w-full max-w-full font-mono text-xs p-2.5 sm:p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#9D2558]/20 focus:border-[#9D2558] transition-all bg-slate-50/70 box-border resize-y min-h-[80px] max-h-[160px]"
                />
              </div>

              {/* STATS BADGES */}
              {currentParsedCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-800">Preview:</span>
                  <Badge variant="neutral" className="text-xs font-semibold">
                    Total Rows: {currentParsedCount}
                  </Badge>
                  <Badge
                    variant="primary"
                    className="text-xs bg-emerald-50 text-emerald-800 border-emerald-200 font-semibold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    Ready to Import: {currentValidCount}
                  </Badge>
                  {currentInvalidCount > 0 && (
                    <Badge variant="destructive" className="text-xs font-semibold">
                      <AlertCircle className="w-3.5 h-3.5 mr-1" />
                      Errors: {currentInvalidCount}
                    </Badge>
                  )}
                  {currentInvalidCount > 0 && (
                    <span className="text-[11px] text-rose-500 font-medium ml-1">
                      (Rows with errors will be skipped)
                    </span>
                  )}
                </div>
              )}

              {/* LIVE PREVIEW TABLE */}
              {currentParsedCount > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto shadow-2xs">
                  <Table>
                    <TableHeader className="bg-slate-100/80 sticky top-0 z-10 backdrop-blur-xs">
                      <TableRow className="text-xs">
                        <TableHead className="w-12 text-center">#</TableHead>
                        <TableHead>{activeTab === 'SERVICES' ? 'Service Name' : 'Package Name'}</TableHead>
                        {activeTab === 'SERVICES' ? (
                          <TableHead>Category</TableHead>
                        ) : (
                          <TableHead>Included Services</TableHead>
                        )}
                        <TableHead>Price</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeTab === 'SERVICES'
                        ? parsedServices.map((row) => (
                          <TableRow
                            key={row.rowNumber}
                            className={`text-xs ${!row.isValid ? 'bg-rose-50/60' : 'hover:bg-slate-50/60'}`}
                          >
                            <TableCell className="font-mono text-slate-400 text-center">
                              {row.rowNumber}
                            </TableCell>
                            <TableCell className="font-semibold text-slate-900">
                              {row.name || <span className="text-rose-400 italic">Missing Name</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Badge variant="neutral" className="text-[11px] font-medium bg-slate-100">
                                  {row.category}
                                </Badge>
                                {row.isNewCategory && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                                    <Sparkles className="w-2.5 h-2.5" />
                                    New
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-bold text-slate-900 font-mono">
                              {formatCurrency(row.price)}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.isValid ? (
                                <Badge
                                  variant="primary"
                                  className="text-[11px] bg-emerald-50 text-emerald-800 border-emerald-200 inline-flex items-center gap-1 font-semibold"
                                >
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  Valid
                                </Badge>
                              ) : (
                                <span className="text-xs text-rose-600 font-semibold inline-flex items-center justify-end gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  {row.error}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                        : parsedPackages.map((row) => (
                          <TableRow
                            key={row.rowNumber}
                            className={`text-xs ${!row.isValid ? 'bg-rose-50/60' : 'hover:bg-slate-50/60'}`}
                          >
                            <TableCell className="font-mono text-slate-400 text-center">
                              {row.rowNumber}
                            </TableCell>
                            <TableCell className="font-semibold text-slate-900">
                              {row.name || <span className="text-rose-400 italic">Missing Name</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1 max-w-sm">
                                {row.components.map((c, i) => (
                                  <Badge
                                    key={i}
                                    variant="neutral"
                                    className="text-[10px] font-normal bg-slate-100 text-slate-800 border-slate-200"
                                  >
                                    <Check className="w-2.5 h-2.5 mr-0.5 text-emerald-600 inline" />
                                    <span>{c.matchedService?.name || c.serviceIdentifier}</span>
                                    {c.quantity > 1 ? ` (x${c.quantity})` : ''}
                                    {c.allocationPercentage > 0 ? ` · ${c.allocationPercentage}%` : ''}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="font-bold text-slate-900 font-mono">
                              {formatCurrency(row.price)}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.isValid ? (
                                <Badge
                                  variant="primary"
                                  className="text-[11px] bg-emerald-50 text-emerald-800 border-emerald-200 inline-flex items-center gap-1 font-semibold"
                                >
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  Valid
                                </Badge>
                              ) : (
                                <span className="text-xs text-rose-600 font-semibold inline-flex items-center justify-end gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  {row.error}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Tabs>
        </fieldset>

        <DialogFooter className="mt-3 pt-3 border-t border-slate-200 flex flex-row items-center justify-end gap-2 w-full shrink-0 flex-wrap">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting} className="text-xs h-8 px-3">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirmImport}
            disabled={isSubmitting || !actionScope.ready || currentValidCount === 0}
            className="text-xs font-semibold bg-[#9D2558] hover:bg-[#851F4A] text-white shadow-xs h-8 px-3 whitespace-nowrap shrink-0"
            leftIcon={
              isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )
            }
          >
            {isSubmitting
              ? 'Importing...'
              : `Import ${currentValidCount} ${activeTab === 'SERVICES' ? 'Services' : 'Packages'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
