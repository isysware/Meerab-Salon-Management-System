import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import { Booking, BookingCollection, BookingInput, BookingItemInput, BookingLedger, BookingPaymentInput } from '@/types/booking';
import { Branch, Client, PackageItem, PaymentAccount, ServiceItem, StaffMember } from '@/types/salon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/formatters';
import { printBookingDocument } from './bookingPrint';
import { toast } from '@/context/ToastContext';
import {
  Sparkles,
  Calendar,
  Clock,
  User,
  UserCheck,
  Phone,
  Scissors,
  Trash2,
  ChevronLeft,
  ChevronRight,
  List,
  Search,
  Plus,
  Receipt,
  FileText,
  AlertCircle,
  Eye,
  CheckCircle2,
  X,
  ExternalLink,
  MessageSquare,
  ChevronDown,
} from 'lucide-react';
import { BookingConfirmationModal } from './BookingConfirmationModal';
import { BookingDetailsModal } from './BookingDetailsModal';
import { MaterialTimePickerModal } from '@/components/ui/MaterialTimePickerModal';
import { ReceiptModal } from '@/features/pos/ReceiptModal';
import { bookingToInvoice } from './bookingToInvoice';

const selectClass = 'w-full rounded-xl border border-[#F1DEE3] bg-white px-3 py-2 text-sm text-[#23151D] focus:outline-none focus:ring-2 focus:ring-[#9D2558]/20 focus:border-[#9D2558]';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Unable to complete this action.';
const isOpen = (b: Booking) => !b.linkedInvoiceId && !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(b.status);
const newKey = () => crypto.randomUUID();
const asInput = (b: Booking): BookingInput => ({
  branchId: b.branchId, clientId: b.clientId, clientName: b.clientName, clientPhone: b.clientPhone,
  type: b.type, eventDate: b.eventDate, serviceTime: b.serviceTime, assignedStaffId: b.assignedStaffId,
  notes: b.notes, specialRequirements: b.specialRequirements, discountType: b.discountType,
  discountValue: b.discountValue, revision: b.revision,
  items: b.items.map(i => ({ ...i, packageComponents: i.components.map(c => ({ serviceId: c.serviceId, staffId: c.staffId })) })),
});
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="grid gap-1 text-sm font-medium text-slate-700">{label}{children}</label>;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_SLOTS = [
  { hour: 8, label: '8 AM' },
  { hour: 9, label: '9 AM' },
  { hour: 10, label: '10 AM' },
  { hour: 11, label: '11 AM' },
  { hour: 12, label: '12 PM' },
  { hour: 13, label: '1 PM' },
  { hour: 14, label: '2 PM' },
  { hour: 15, label: '3 PM' },
  { hour: 16, label: '4 PM' },
  { hour: 17, label: '5 PM' },
  { hour: 18, label: '6 PM' },
  { hour: 19, label: '7 PM' },
  { hour: 20, label: '8 PM' },
  { hour: 21, label: '9 PM' },
  { hour: 22, label: '10 PM' },
];

function parseBookingHour(timeStr?: string): number {
  if (!timeStr) return 10;
  const clean = timeStr.trim().toUpperCase();
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/);
  if (!match) return 10;
  let h = parseInt(match[1], 10);
  const isPM = match[3] === 'PM';
  const isAM = match[3] === 'AM';
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h;
}



function StaffSelect({ staff, value, onChange }: { staff: StaffMember[]; value?: string | null; onChange: (v: string | null) => void }) {
  return (
    <Select
      value={value || 'unassigned'}
      onValueChange={(val) => onChange(val === 'unassigned' ? null : val)}
    >
      <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
        <SelectValue placeholder="Unassigned (optional)" />
      </SelectTrigger>
      <SelectContent className="z-[70]">
        <SelectItem value="unassigned" className="text-slate-500 font-medium">
          Unassigned (optional)
        </SelectItem>
        {staff.filter((s) => s.isActive).map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name} ({s.roleTitle || 'Stylist'})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BookingForm({ branchId, initialDate, existing, onSaved, onClose }: { branchId: string; initialDate?: string; existing?: Booking; onSaved: (b: Booking) => void; onClose: () => void }) {
  const { demoDate, user, allBranches } = useAuth();
  const [form, setForm] = useState<BookingInput>(() => existing ? asInput(existing) : ({ branchId: user?.role === 'SUPER_ADMIN' ? '' : user?.branchId || (branchId === 'ALL' ? '' : branchId), clientName: '', clientPhone: '', type: 'BRIDAL', eventDate: initialDate || demoDate || today(), serviceTime: '10:00', assignedStaffId: null, discountType: 'FIXED', discountValue: 0, items: [] }));
  const selectedBranchId = form.branchId;
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [paymentAccountsError, setPaymentAccountsError] = useState('');
  const [taxRates, setTaxRates] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isTimePickerOpen, setIsTimePickerOpen] = useState(false);
  const [isCatalogMenuOpen, setIsCatalogMenuOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogTab, setCatalogTab] = useState<'ALL' | 'SERVICES' | 'PACKAGES'>('ALL');
  const catalogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (catalogRef.current && !catalogRef.current.contains(e.target as Node)) {
        setIsCatalogMenuOpen(false);
      }
    };
    if (isCatalogMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCatalogMenuOpen]);

  const filteredServices = useMemo(() => {
    return services
      .filter(s => s.isActive)
      .filter(s => !catalogSearch.trim() || s.name.toLowerCase().includes(catalogSearch.toLowerCase().trim()));
  }, [services, catalogSearch]);

  const filteredPackages = useMemo(() => {
    return packages
      .filter(p => p.isActive)
      .filter(p => !catalogSearch.trim() || p.name.toLowerCase().includes(catalogSearch.toLowerCase().trim()));
  }, [packages, catalogSearch]);

  const key = useRef(newKey());
  useEffect(() => {
    setClients([]); setServices([]); setPackages([]); setStaff([]); setTaxRates({}); setError('');
    if (!selectedBranchId || selectedBranchId === 'ALL') {
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    Promise.all([salonService.getClients(selectedBranchId), salonService.getServices(selectedBranchId), salonService.getPackages(selectedBranchId), salonService.getStaff(selectedBranchId), salonService.getBranch(selectedBranchId), salonService.getTaxRules(selectedBranchId)]).then(([c, s, p, st, branch, rules]) => {
      if (active) {
        setClients(c); setServices(s); setPackages(p); setStaff(st);
        const defaultRate = branch?.taxEnabled ? branch.taxRate : 0;
        const rates: Record<string, number> = { custom: defaultRate };
        for (const item of [...s, ...p]) rates[item.id] = item.taxTreatment === 'EXEMPT' ? 0 : item.taxTreatment === 'SPECIFIC_RULE' ? rules.find(r => r.id === item.specificTaxRuleId)?.rate || 0 : defaultRate;
        setTaxRates(rates);
      }
    }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedBranchId]);
  useEffect(() => {
    setPaymentAccounts([]); setPaymentAccountsError('');
    if (existing || !selectedBranchId || selectedBranchId === 'ALL') return;
    let active = true;
    salonService.getPaymentAccounts(selectedBranchId)
      .then(accounts => { if (active) setPaymentAccounts(accounts); })
      .catch(e => { if (active) setPaymentAccountsError(errorText(e)); });
    return () => { active = false; };
  }, [selectedBranchId, existing]);
  const change = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) => { key.current = newKey(); setForm(f => ({ ...f, [k]: v })); };
  const changeBranch = (id: string) => {
    key.current = newKey();
    setForm(f => ({
      ...f, branchId: id, clientId: undefined,
      clientName: f.clientId ? '' : f.clientName, clientPhone: f.clientId ? '' : f.clientPhone,
      assignedStaffId: null, items: [], discountType: 'FIXED', discountValue: 0,
      advancePayment: undefined,
    }));
  };
  const changeAdvance = (patch: Partial<BookingPaymentInput>) => {
    key.current = newKey();
    setForm(f => ({ ...f, advancePayment: { amount: 0, date: demoDate || today(), method: 'CASH', ...f.advancePayment, ...patch } }));
  };
  const lineChange = (index: number, patch: Partial<BookingItemInput>) => change('items', form.items.map((i, n) => n === index ? { ...i, ...patch } : i));
  const subtotal = form.items.reduce((sum, i) => sum + (i.unitPrice || 0) * i.quantity, 0);
  const discount = form.discountType === 'PERCENTAGE' ? subtotal * form.discountValue / 100 : form.discountValue;
  const estimatedTax = form.items.reduce((sum, i) => {
    const gross = (i.unitPrice || 0) * i.quantity;
    const rate = existing?.items.find(old => old.lineInstanceId === i.lineInstanceId)?.taxRate ?? taxRates[i.itemId || 'custom'] ?? 0;
    return sum + Math.round((gross - (subtotal ? discount * gross / subtotal : 0)) * rate * 100) / 100;
  }, 0);
  const estimatedTotal = Math.round((subtotal - discount + estimatedTax) * 100) / 100;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId || selectedBranchId === 'ALL') {
      toast.error('Please select a branch for this booking');
      return;
    }
    if (!form.clientName?.trim()) {
      toast.error('Please enter client name');
      return;
    }
    if (!form.clientPhone?.trim()) {
      toast.error('Please enter mobile number');
      return;
    }
    if (!form.eventDate) {
      toast.error('Please select event date');
      return;
    }
    if (!form.serviceTime?.trim()) {
      toast.error('Please enter service time');
      return;
    }
    if (form.items.length === 0) {
      toast.error('Please add at least one service or package');
      return;
    }
    for (const item of form.items) {
      if (item.type === 'CUSTOM_SERVICE' && !item.name?.trim()) {
        toast.error('Please enter name for custom service');
        return;
      }
    }
    if (existing && (!form.reason || form.reason.trim().length < 3)) {
      toast.error('Please provide a reason for changes (min 3 characters)');
      return;
    }
    if (!existing && form.advancePayment) {
      const advance = form.advancePayment;
      if (!Number.isFinite(advance.amount) || advance.amount <= 0) {
        toast.error('Advance amount must be greater than 0');
        return;
      }
      if (advance.amount > estimatedTotal) {
        toast.error('Advance cannot exceed the booking total');
        return;
      }
      if (!advance.date || advance.date !== (demoDate || today())) {
        toast.error('Initial advance must use the current business date');
        return;
      }
      if (advance.method === 'ONLINE_ACCOUNT' && !paymentAccounts.some(a => a.id === advance.paymentAccountId && a.isActive)) {
        toast.error('Please select an active online/bank account');
        return;
      }
    }

    setBusy(true);
    try {
      const result = existing
        ? await salonService.updateBooking(existing.id, form)
        : await salonService.createBooking(form, key.current);
      toast.success(existing ? 'Booking updated successfully' : 'New booking created successfully');
      onSaved(result);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 w-[95vw] sm:w-full">
        <DialogHeader className="border-b border-[#F1DEE3] pb-3 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#FCE8EC] text-[#9D2558] flex items-center justify-center font-bold">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-[#23151D]">
                {existing ? 'Edit Reservation' : 'New Bridal / Groom Reservation'}
              </DialogTitle>
              <p className="text-xs text-slate-500">
                {existing ? `Updating booking ${existing.bookingNumber}` : 'Create client event booking, schedule time & add services'}
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={save} noValidate className="space-y-5">
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {/* Section 1: Client & Event Schedule */}
          <div className="rounded-2xl border border-[#F1DEE3] p-4 bg-white space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-[#9D2558] uppercase tracking-wider border-b border-[#F1DEE3] pb-2">
              <User className="w-3.5 h-3.5" />
              <span>Client & Schedule Details</span>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Booking Branch">
                  <Select
                    disabled={busy || !!existing || user?.role !== 'SUPER_ADMIN'}
                    value={selectedBranchId || ''}
                    onValueChange={(val) => changeBranch(val)}
                  >
                    <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent className="z-[70]">
                      {allBranches.filter(b => b.isActive || b.id === existing?.branchId).map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {!existing && user?.role === 'SUPER_ADMIN' && <p className="mt-1 text-xs text-slate-500">Select a branch to load its clients, services, staff and payment accounts.</p>}
              </div>
              <Field label="Reservation Type">
                <Select
                  value={form.type}
                  onValueChange={(val) => change('type', val as BookingInput['type'])}
                >
                  <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    <SelectItem value="BRIDAL">Bridal Event</SelectItem>
                    <SelectItem value="GROOM">Groom Event</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Client Profile">
                <Select
                  disabled={!!existing}
                  value={form.clientId || 'new'}
                  onValueChange={(val) => {
                    if (val === 'new') {
                      key.current = newKey();
                      setForm(f => ({
                        ...f,
                        clientId: undefined,
                        clientName: '',
                        clientPhone: '',
                      }));
                    } else {
                      const c = clients.find(c => c.id === val);
                      key.current = newKey();
                      setForm(f => ({
                        ...f,
                        clientId: c?.id,
                        clientName: c?.name || '',
                        clientPhone: c?.phone || '',
                      }));
                    }
                  }}
                >
                  <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                    <SelectValue placeholder="+ New Client Profile" />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    <SelectItem value="new" className="font-semibold text-[#9D2558]">
                      + New Client Profile
                    </SelectItem>
                    {clients.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {c.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Client Full Name">
                <Input
                  disabled={!!existing || !!form.clientId}
                  placeholder="e.g. Ayesha Khan"
                  value={form.clientName}
                  onChange={e => change('clientName', e.target.value)}
                />
              </Field>

              <Field label="Mobile Number">
                <Input
                  disabled={!!existing || !!form.clientId}
                  placeholder="03001234567"
                  value={form.clientPhone}
                  onChange={e => change('clientPhone', e.target.value)}
                />
              </Field>

              <Field label="Event / Booking Date">
                <Input
                  type="date"
                  value={form.eventDate}
                  onChange={e => change('eventDate', e.target.value)}
                />
              </Field>

              <Field label="Service Start Time">
                <button
                  type="button"
                  onClick={() => setIsTimePickerOpen(true)}
                  className="w-full h-10 flex items-center justify-between rounded-xl border border-[#F1DEE3] bg-white px-3 py-2 text-sm text-[#23151D] hover:border-[#9D2558] focus:border-[#9D2558] focus:ring-2 focus:ring-[#9D2558]/20 transition-all cursor-pointer text-left shadow-2xs"
                >
                  <span className="font-semibold text-slate-800">
                    {form.serviceTime || '10:00 AM'}
                  </span>
                  <Clock className="w-4 h-4 text-[#9D2558]" />
                </button>
              </Field>

              <div className="sm:col-span-2">
                <Field label="Lead Stylist / Staff (Optional)">
                  <StaffSelect
                    staff={staff}
                    value={form.assignedStaffId}
                    onChange={v => {
                      key.current = newKey();
                      setForm(f => ({
                        ...f,
                        assignedStaffId: v,
                        items: f.items.map(i => !i.staffId || i.staffId === f.assignedStaffId ? { ...i, staffId: v } : i)
                      }));
                    }}
                  />
                </Field>
              </div>

            </div>
          </div>

          {/* Section 2: Services & Packages */}
          <div className="rounded-2xl border border-[#F1DEE3] p-4 bg-white space-y-4">
            <div className="flex items-center justify-between border-b border-[#F1DEE3] pb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#9D2558] uppercase tracking-wider">
                <Scissors className="w-3.5 h-3.5" />
                <span>Services & Packages ({form.items.length})</span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Custom Luxury Dropdown Popover */}
              <div className="relative" ref={catalogRef}>
                <button
                  type="button"
                  onClick={() => {
                    if (!loading && selectedBranchId) {
                      setIsCatalogMenuOpen(v => !v);
                    }
                  }}
                  disabled={loading || !selectedBranchId}
                  className="w-full flex items-center justify-between rounded-xl border border-[#F1DEE3] bg-white px-3.5 py-2.5 text-sm text-[#23151D] hover:border-[#9D2558] focus:border-[#9D2558] focus:ring-2 focus:ring-[#9D2558]/20 transition-all cursor-pointer shadow-2xs group"
                >
                  <div className="flex items-center gap-2 text-slate-700 group-hover:text-[#9D2558]">
                    <Plus className="w-4 h-4 text-[#9D2558]" />
                    <span className="font-semibold text-xs sm:text-sm">Click to Select Catalog Service / Package</span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 group-hover:text-[#9D2558] transition-transform duration-200 ${
                      isCatalogMenuOpen ? 'rotate-180 text-[#9D2558]' : ''
                    }`}
                  />
                </button>

                {isCatalogMenuOpen && (
                  <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white rounded-2xl shadow-2xl border border-[#F1DEE3] p-3 space-y-2.5 animate-in fade-in-0 zoom-in-95 duration-150">
                    {/* Search & Tabs */}
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search catalog service or package..."
                          value={catalogSearch}
                          onChange={e => setCatalogSearch(e.target.value)}
                          className="w-full pl-8.5 pr-8 py-1.5 text-xs rounded-xl border border-[#F1DEE3] bg-[#FDF2F5]/40 text-[#23151D] placeholder:text-slate-400 focus:outline-none focus:border-[#9D2558] focus:ring-1 focus:ring-[#9D2558]"
                          autoFocus
                        />
                        {catalogSearch && (
                          <button
                            type="button"
                            onClick={() => setCatalogSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Filter Tabs */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCatalogTab('ALL')}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                            catalogTab === 'ALL'
                              ? 'bg-[#9D2558] text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          All ({filteredServices.length + filteredPackages.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCatalogTab('SERVICES')}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                            catalogTab === 'SERVICES'
                              ? 'bg-[#9D2558] text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          Services ({filteredServices.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCatalogTab('PACKAGES')}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                            catalogTab === 'PACKAGES'
                              ? 'bg-[#9D2558] text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          Packages ({filteredPackages.length})
                        </button>
                      </div>
                    </div>

                    {/* Scrollable Items List */}
                    <div className="max-h-64 overflow-y-auto space-y-3 pr-1 divide-y divide-slate-100">
                      {(catalogTab === 'ALL' || catalogTab === 'SERVICES') && filteredServices.length > 0 && (
                        <div className="space-y-1 pt-1 first:pt-0">
                          <div className="text-[10px] font-bold tracking-wider uppercase text-slate-400 px-1">
                            Services ({filteredServices.length})
                          </div>
                          {filteredServices.map(s => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                change('items', [
                                  ...form.items,
                                  {
                                    lineInstanceId: newKey(),
                                    type: 'SERVICE',
                                    itemId: s.id,
                                    name: s.name,
                                    quantity: 1,
                                    unitPrice: s.price,
                                    durationMinutes: s.durationMinutes,
                                    staffId: form.assignedStaffId
                                  }
                                ]);
                                setIsCatalogMenuOpen(false);
                                setCatalogSearch('');
                                toast.success(`Added ${s.name}`);
                              }}
                              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#FDF2F5] border border-transparent hover:border-[#F1DEE3] transition-all text-left group cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-lg bg-[#FCE8EC] text-[#9D2558] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                  <Scissors className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-slate-800 group-hover:text-[#9D2558] transition-colors">
                                    {s.name}
                                  </div>
                                  {s.durationMinutes && (
                                    <div className="text-[10px] text-slate-400">
                                      {s.durationMinutes} mins
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs font-bold text-[#9D2558] bg-[#FCE8EC]/60 px-2 py-0.5 rounded-lg">
                                {formatCurrency(s.price)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {(catalogTab === 'ALL' || catalogTab === 'PACKAGES') && filteredPackages.length > 0 && (
                        <div className="space-y-1 pt-2 first:pt-0">
                          <div className="text-[10px] font-bold tracking-wider uppercase text-slate-400 px-1">
                            Packages ({filteredPackages.length})
                          </div>
                          {filteredPackages.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                change('items', [
                                  ...form.items,
                                  {
                                    lineInstanceId: newKey(),
                                    type: 'PACKAGE',
                                    itemId: p.id,
                                    name: p.name,
                                    quantity: 1,
                                    unitPrice: p.price,
                                    durationMinutes: undefined,
                                    staffId: form.assignedStaffId
                                  }
                                ]);
                                setIsCatalogMenuOpen(false);
                                setCatalogSearch('');
                                toast.success(`Added ${p.name}`);
                              }}
                              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#FDF2F5] border border-transparent hover:border-[#F1DEE3] transition-all text-left group cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                  <Sparkles className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-slate-800 group-hover:text-[#9D2558] transition-colors">
                                    {p.name}
                                  </div>
                                  <div className="text-[10px] text-amber-600 font-medium">
                                    Package Deal
                                  </div>
                                </div>
                              </div>
                              <div className="text-xs font-bold text-[#9D2558] bg-[#FCE8EC]/60 px-2 py-0.5 rounded-lg">
                                {formatCurrency(p.price)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {filteredServices.length === 0 && filteredPackages.length === 0 && (
                        <div className="py-6 text-center text-xs text-slate-400">
                          No matching services or packages found.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {form.items.length === 0 ? (
                <div className="py-6 text-center rounded-xl border border-dashed border-[#F1DEE3] bg-[#FDF2F5]/50 text-xs text-slate-500">
                  No services added yet. Select from the catalog above or click &ldquo;Add Custom Service&rdquo;.
                </div>
              ) : (
                form.items.map((i, index) => (
                  <div className="rounded-xl border border-[#F1DEE3] bg-[#FDF2F5]/50 p-3.5 space-y-3" key={i.lineInstanceId || index}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FCE8EC] text-[#9D2558]">
                        {i.type.replace('_', ' ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => change('items', form.items.filter((_, n) => n !== index))}
                        className="text-xs text-rose-600 hover:text-rose-800 flex items-center gap-1 font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Service / Item Name">
                        <Input
                          disabled={i.type !== 'CUSTOM_SERVICE'}
                          value={i.name || ''}
                          onChange={e => lineChange(index, { name: e.target.value })}
                        />
                      </Field>
                      <Field label="Unit Price (PKR)">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={i.unitPrice ?? ''}
                          onChange={e => lineChange(index, { unitPrice: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="Quantity">
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          value={i.quantity}
                          onChange={e => lineChange(index, { quantity: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="Stylist / Staff">
                        <StaffSelect
                          staff={staff}
                          value={i.staffId}
                          onChange={v => lineChange(index, { staffId: v })}
                        />
                      </Field>

                      {i.type === 'CUSTOM_SERVICE' && (
                        <>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <Field label="Custom Service Description">
                              <Input
                                placeholder="Specific instructions / hair length / makeup details"
                                value={i.description || ''}
                                onChange={e => lineChange(index, { description: e.target.value })}
                              />
                            </Field>
                          </div>
                          <Field label="Duration (Minutes)">
                            <Input
                              type="number"
                              min="1"
                              value={i.durationMinutes || 60}
                              onChange={e => lineChange(index, { durationMinutes: Number(e.target.value) })}
                            />
                          </Field>
                        </>
                      )}
                    </div>

                    {i.type === 'PACKAGE' && (existing?.items.find(old => old.lineInstanceId === i.lineInstanceId)?.components || packages.find(p => p.id === i.itemId)?.components || []).map(c => (
                      <div className="grid gap-2 sm:grid-cols-2 text-xs pt-1 border-t border-[#F1DEE3]" key={c.serviceId}>
                        <span className="font-semibold text-slate-700">{c.serviceName}</span>
                        <StaffSelect
                          staff={staff}
                          value={i.packageComponents?.find(p => p.serviceId === c.serviceId)?.staffId ?? i.staffId}
                          onChange={v => lineChange(index, {
                            packageComponents: [
                              ...(i.packageComponents || []).filter(p => p.serviceId !== c.serviceId),
                              { serviceId: c.serviceId, staffId: v }
                            ]
                          })}
                        />
                      </div>
                    ))}
                  </div>
                ))
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => change('items', [
                  ...form.items,
                  {
                    lineInstanceId: newKey(),
                    type: 'CUSTOM_SERVICE',
                    name: '',
                    unitPrice: 0,
                    quantity: 1,
                    durationMinutes: 60,
                    staffId: form.assignedStaffId
                  }
                ])}
                className="w-full text-xs border-dashed border-[#9D2558]/40 text-[#9D2558] hover:bg-[#FDF2F5]"
              >
                + Add Custom / Unlisted Service
              </Button>
            </div>
          </div>

          {/* Section 3: Discounts & Requirements */}
          <div className="rounded-2xl border border-[#F1DEE3] p-4 bg-white space-y-4">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Discount Type">
                <Select
                  value={form.discountType}
                  onValueChange={(val) => change('discountType', val as BookingInput['discountType'])}
                >
                  <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    <SelectItem value="FIXED">Fixed Amount (PKR)</SelectItem>
                    <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Discount Value">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discountValue}
                  onChange={e => change('discountValue', Number(e.target.value))}
                />
              </Field>
              <Field label="Reservation Notes">
                <Input
                  placeholder="Client preferences, timings, contact person"
                  value={form.notes || ''}
                  onChange={e => change('notes', e.target.value)}
                />
              </Field>
              <Field label="Special Requirements">
                <Input
                  placeholder="e.g. Bridal jewelry setting, dupatta pinning"
                  value={form.specialRequirements || ''}
                  onChange={e => change('specialRequirements', e.target.value)}
                />
              </Field>
            </div>

            {existing && (
              <Field label="Audit Reason for Changes">
                <Input
                  placeholder="State reason for editing confirmed reservation"
                  value={form.reason || ''}
                  onChange={e => change('reason', e.target.value)}
                />
              </Field>
            )}

            {/* Financial Summary Pill */}
            <div className="rounded-xl bg-[#FDF2F5] border border-[#F8D2DC] p-4 text-xs sm:text-sm text-[#23151D] flex flex-wrap items-center justify-between gap-3 font-semibold">
              <div>Subtotal: <span className="font-mono">{formatCurrency(subtotal)}</span></div>
              <div>Discount: <span className="font-mono text-[#9D2558]">-{formatCurrency(discount)}</span></div>
              <div>Est. Tax: <span className="font-mono">{formatCurrency(estimatedTax)}</span></div>
              <div className="text-base font-bold text-[#9D2558]">
                Total: <span className="font-mono">{formatCurrency(subtotal - discount + estimatedTax)}</span>
              </div>
            </div>
          </div>

          {!existing && (
            <section className="rounded-2xl border border-[#F1DEE3] p-4 bg-white space-y-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="collect-booking-advance"
                  checked={!!form.advancePayment}
                  disabled={busy}
                  onCheckedChange={checked => change('advancePayment', checked === true
                    ? { amount: 0, date: demoDate || today(), method: 'CASH' }
                    : undefined)}
                />
                <label htmlFor="collect-booking-advance" className="cursor-pointer text-sm font-bold text-[#9D2558]">
                  Collect advance now (optional)
                </label>
              </div>
              <p className="text-xs text-slate-500">
                Save without advance, or collect a partial/full payment with this booking.
              </p>
              {form.advancePayment && (
                <div className="space-y-4">
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label="Advance Amount">
                      <Input type="number" min="0.01" max={Math.max(0, estimatedTotal)} step="0.01"
                        value={form.advancePayment.amount}
                        onChange={e => changeAdvance({ amount: Number(e.target.value) })} />
                    </Field>
                    <Field label="Payment Date">
                      <Input type="date" min={demoDate || today()} max={demoDate || today()}
                        value={form.advancePayment.date || ''}
                        onChange={e => changeAdvance({ date: e.target.value })} />
                    </Field>
                    <Field label="Payment Method">
                      <Select
                        value={form.advancePayment.method}
                        onValueChange={(val) => changeAdvance({ method: val as BookingPaymentInput['method'], paymentAccountId: undefined })}
                      >
                        <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[70]">
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="ONLINE_ACCOUNT">Online / Bank Account</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {form.advancePayment.method === 'ONLINE_ACCOUNT' && (
                      <Field label="Payment Account">
                        <Select
                          value={form.advancePayment.paymentAccountId || ''}
                          onValueChange={(val) => changeAdvance({ paymentAccountId: val })}
                        >
                          <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                            <SelectValue placeholder="Select branch payment account" />
                          </SelectTrigger>
                          <SelectContent className="z-[70]">
                            {paymentAccounts.filter(a => a.isActive).map(a => (
                              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                    <Field label="Payment Reference">
                      <Input maxLength={200} placeholder="Transfer / receipt reference (optional)"
                        value={form.advancePayment.reference || ''} onChange={e => changeAdvance({ reference: e.target.value })} />
                    </Field>
                    <Field label="Payment Notes">
                      <Input maxLength={2000} placeholder="Optional payment notes"
                        value={form.advancePayment.notes || ''} onChange={e => changeAdvance({ notes: e.target.value })} />
                    </Field>
                  </div>
                  {form.advancePayment.method === 'ONLINE_ACCOUNT' && paymentAccountsError && <p role="alert" className="text-xs text-red-700">{paymentAccountsError}</p>}
                  <div className="rounded-xl bg-[#FDF2F5] border border-[#F8D2DC] p-3 text-sm font-semibold flex flex-wrap justify-between gap-2">
                    <span>Advance: {formatCurrency(form.advancePayment.amount || 0)}</span>
                    <span>Remaining: {formatCurrency(estimatedTotal - (form.advancePayment.amount || 0))}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {form.advancePayment.method === 'CASH' ? 'Cash is recorded in your eligible drawer.' : 'Online payment is recorded in the selected branch account.'} A receipt is generated when the booking is saved.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button disabled={busy || loading || !selectedBranchId || form.items.length === 0} className="w-full sm:w-auto px-6 font-bold bg-[#9D2558] hover:bg-[#851C47] text-white">
              {busy ? 'Saving...' : existing ? 'Update Booking' : form.advancePayment ? 'Save Booking & Collect Advance' : 'Confirm & Save Booking'}
            </Button>
          </div>
        </form>

        <MaterialTimePickerModal
          isOpen={isTimePickerOpen}
          onClose={() => setIsTimePickerOpen(false)}
          value={form.serviceTime || '10:00 AM'}
          onSelect={selectedTime => change('serviceTime', selectedTime)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ booking, mode, onSaved, onClose }: { booking: Booking; mode: 'payment' | 'refund' | 'cancel' | 'no-show'; onSaved: (b: Booking) => void; onClose: () => void }) {
  const { demoDate } = useAuth();
  const [payment, setPayment] = useState<BookingPaymentInput>({ amount: mode === 'payment' ? booking.remainingBalance : booking.advancePaid, date: demoDate, method: 'CASH' });
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState(0);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  useEffect(() => {
    let active = true;
    salonService.getPaymentAccounts(booking.branchId)
      .then(a => { if (active) setAccounts(a); })
      .catch(e => { if (active) toast.error(errorText(e)); });
    return () => { active = false; };
  }, [booking.branchId]);

  const cancellation = mode === 'cancel' || mode === 'no-show';
  const change = (p: Partial<BookingPaymentInput>) => { key.current = newKey(); setPayment(v => ({ ...v, ...p })); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellation && (payment.amount <= 0 || isNaN(payment.amount))) {
      toast.error('Payment amount must be greater than 0');
      return;
    }
    if (payment.method === 'ONLINE_ACCOUNT' && !payment.paymentAccountId) {
      toast.error('Please select an online/bank account');
      return;
    }
    if (mode !== 'payment' && (!reason || reason.trim().length < 3)) {
      toast.error('Please enter a valid reason (min 3 characters)');
      return;
    }

    setBusy(true);
    try {
      const result = cancellation
        ? await salonService.cancelBooking(booking.id, {
            status: mode === 'no-show' ? 'NO_SHOW' : 'CANCELLED',
            revision: booking.revision,
            reason,
            cancellationCharge: fee,
            refundPayment: payment.amount > 0 ? payment : undefined
          }, key.current)
        : mode === 'refund'
        ? await salonService.refundBookingPayment(booking.id, { payment, reason }, key.current)
        : await salonService.recordBookingPayment(booking.id, payment, key.current);

      toast.success(
        cancellation
          ? 'Booking closure confirmed'
          : mode === 'refund'
          ? 'Advance refunded successfully'
          : 'Installment recorded successfully'
      );
      onSaved(result);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4 sm:p-6 w-[95vw] sm:w-full">
        <DialogHeader className="border-b border-[#F1DEE3] pb-3 mb-2">
          <DialogTitle className="text-base font-bold text-[#23151D]">
            {cancellation ? 'Close / Cancel Booking' : mode === 'refund' ? 'Refund Advance Deposit' : 'Record Installment Payment'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="rounded-xl bg-[#FDF2F5] border border-[#F8D2DC] p-3 text-xs text-[#23151D] space-y-1 font-mono font-medium">
            <div className="flex justify-between">
              <span>Booking:</span> <span className="font-bold">{booking.bookingNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Advance Paid:</span> <span className="text-emerald-700 font-bold">{formatCurrency(booking.advancePaid)}</span>
            </div>
            <div className="flex justify-between">
              <span>Remaining Balance:</span> <span className="text-[#9D2558] font-bold">{formatCurrency(booking.remainingBalance)}</span>
            </div>
          </div>

          {cancellation && (
            <Field label="Approved Cancellation Charge">
              <Input
                type="number"
                min="0"
                max={booking.advancePaid}
                step="0.01"
                value={fee}
                onChange={e => {
                  const f = Number(e.target.value);
                  setFee(f);
                  change({ amount: Math.max(0, Math.round((booking.advancePaid - f) * 100) / 100) });
                }}
              />
            </Field>
          )}

          <Field label={mode === 'payment' ? 'Payment Amount (PKR)' : 'Refund Amount (PKR)'}>
            <Input
              type="number"
              min={cancellation ? '0' : '0.01'}
              max={mode === 'payment' ? booking.remainingBalance : booking.advancePaid}
              step="0.01"
              value={payment.amount}
              disabled={cancellation}
              onChange={e => change({ amount: Number(e.target.value) })}
            />
          </Field>

          <Field label="Payment Date">
            <Input
              type="date"
              value={payment.date}
              onChange={e => change({ date: e.target.value })}
            />
          </Field>

          <Field label="Payment Method">
            <Select
              value={payment.method}
              onValueChange={(val) => change({ method: val as BookingPaymentInput['method'] })}
            >
              <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="CASH">Cash (Registers into Open Drawer)</SelectItem>
                <SelectItem value="ONLINE_ACCOUNT">Online Bank / Digital Account</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {payment.method === 'ONLINE_ACCOUNT' && (
            <Field label="Online Deposit Account">
              <Select
                value={payment.paymentAccountId || ''}
                onValueChange={(val) => change({ paymentAccountId: val })}
              >
                <SelectTrigger className="w-full h-10 rounded-xl border-[#F1DEE3] bg-white">
                  <SelectValue placeholder="Select Account" />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  {accounts.filter(a => a.isActive).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Reference / Transaction ID">
            <Input
              placeholder="e.g. Bank Ref / Cheque / Note"
              value={payment.reference || ''}
              onChange={e => change({ reference: e.target.value })}
            />
          </Field>

          {mode !== 'payment' && (
            <Field label="Audit Reason">
              <Input
                placeholder="Reason for refund or cancellation"
                value={reason}
                onChange={e => {
                  key.current = newKey();
                  setReason(e.target.value);
                }}
              />
            </Field>
          )}

          <Button className="w-full font-bold" disabled={busy}>
            {busy ? 'Processing...' : cancellation ? 'Confirm Closure' : 'Record & Generate Receipt'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BookingsPage() {
  const { user } = useAuth();
  const { navigate, currentRoute } = useRouter();
  const queryClientId = new URLSearchParams(currentRoute.split('?')[1] || '').get('clientId') || undefined;
  const queryBookingId = new URLSearchParams(currentRoute.split('?')[1] || '').get('bookingId');

  const [view, setView] = useState<'calendar' | 'bookings'>('calendar');
  const requestVersion = useRef(0);

  // Calendar State (CareDoc Views: day | week | month)
  const todayDate = useMemo(() => new Date(), []);
  const [activeDate, setActiveDate] = useState<Date>(() => new Date());
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('week');
  const [previewBooking, setPreviewBooking] = useState<Booking | null>(null);

  const currentYear = activeDate.getFullYear();
  const currentMonth = activeDate.getMonth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(user?.branchId || '');
  const [rows, setRows] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking>();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editing, setEditing] = useState<'new' | Booking>();
  const [bookingInitialDate, setBookingInitialDate] = useState<string | undefined>();
  const [selectedDayForBookings, setSelectedDayForBookings] = useState<string | null>(null);
  const [mode, setMode] = useState<'payment' | 'refund' | 'cancel' | 'no-show'>();
  const [ledger, setLedger] = useState<BookingLedger>();
  const [printReceipt, setPrintReceipt] = useState<Booking>();
  const [invoiceBooking, setInvoiceBooking] = useState<Booking | null>(null);
  const [confirmationBooking, setConfirmationBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const admin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    let active = true;
    salonService.getBranches().then(b => {
      if (active) {
        setBranches(b);
        setBranchId(v => v || b.find(x => x.isActive)?.id || '');
      }
    }).catch(e => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, []);

  const padZero = (n: number) => n < 10 ? `0${n}` : `${n}`;
  const todayStr = `${todayDate.getFullYear()}-${padZero(todayDate.getMonth() + 1)}-${padZero(todayDate.getDate())}`;

  const refresh = useCallback(async () => {
    if (!branchId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');

    const query = {
      branchId,
      clientId: queryClientId,
      type: type || undefined,
      status: status || undefined,
      search: search || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    };

    try {
      const result = await salonService.getBookings(query);
      if (version === requestVersion.current) setRows(result);
    } catch (e) {
      if (version === requestVersion.current) setError(errorText(e));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [branchId, queryClientId, type, status, search, startDate, endDate, view, currentYear, currentMonth]);

  useEffect(() => {
    let active = true;
    if (queryBookingId) {
      salonService.getBooking(queryBookingId).then(b => {
        if (active) { setSelected(b); setBranchId(b.branchId); }
      }).catch(e => { if (active) setError(errorText(e)); });
    }
    return () => { active = false; };
  }, [queryBookingId]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { if (active) void refresh(); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);

  const saved = (b: Booking) => {
    setSelected(b);
    setEditing(undefined);
    setBookingInitialDate(undefined);
    setMode(undefined);
    if (branchId !== b.branchId) setBranchId(b.branchId);
    else void refresh();
  };

  const action = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errorText(e)); }
  };

  const getStartOfWeek = useCallback((d: Date) => {
    const copy = new Date(d);
    const day = copy.getDay();
    // Monday as first day: day 1 -> diff 0, day 0 (Sun) -> diff -6, day 2 (Tue) -> diff -1
    const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
    copy.setDate(diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }, []);

  const weekDays = useMemo(() => {
    const monday = getStartOfWeek(activeDate);
    const days = [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      const y = cur.getFullYear();
      const m = padZero(cur.getMonth() + 1);
      const d = padZero(cur.getDate());
      const dateString = `${y}-${m}-${d}`;
      days.push({
        date: cur,
        dateString,
        dayNumber: cur.getDate(),
        dayName: dayNames[i],
        isToday: dateString === todayStr,
      });
    }
    return days;
  }, [activeDate, getStartOfWeek, todayStr]);

  const calendarTitle = useMemo(() => {
    if (calendarMode === 'day') {
      return activeDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
    if (calendarMode === 'week') {
      if (weekDays.length === 0) return '';
      const first = weekDays[0].date;
      const last = weekDays[6].date;
      if (first.getMonth() === last.getMonth()) {
        return `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`;
      }
      return `${MONTH_NAMES[first.getMonth()].slice(0, 3)} - ${MONTH_NAMES[last.getMonth()].slice(0, 3)} ${last.getFullYear()}`;
    }
    return `${MONTH_NAMES[activeDate.getMonth()]} ${activeDate.getFullYear()}`;
  }, [calendarMode, activeDate, weekDays]);

  const handlePrev = () => {
    setActiveDate(prev => {
      const d = new Date(prev);
      if (calendarMode === 'day') {
        d.setDate(d.getDate() - 1);
      } else if (calendarMode === 'week') {
        d.setDate(d.getDate() - 7);
      } else {
        d.setMonth(d.getMonth() - 1);
      }
      return d;
    });
  };

  const handleNext = () => {
    setActiveDate(prev => {
      const d = new Date(prev);
      if (calendarMode === 'day') {
        d.setDate(d.getDate() + 1);
      } else if (calendarMode === 'week') {
        d.setDate(d.getDate() + 7);
      } else {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    });
  };

  const handleGoToday = () => {
    setActiveDate(new Date());
  };

  const handlePrevMonth = () => {
    setActiveDate(d => {
      const n = new Date(d);
      n.setMonth(n.getMonth() - 1);
      return n;
    });
  };

  const handleNextMonth = () => {
    setActiveDate(d => {
      const n = new Date(d);
      n.setMonth(n.getMonth() + 1);
      return n;
    });
  };

  const handleToday = () => {
    setActiveDate(new Date());
  };

  // Calendar days generation
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const dayOfWeekFirst = firstDayOfMonth.getDay();
    const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    const days: {
      dateString: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
    }[] = [];

    // Preceding padding
    for (let i = dayOfWeekFirst - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const m = currentMonth === 0 ? 12 : currentMonth;
      const y = currentMonth === 0 ? currentYear - 1 : currentYear;
      const dateString = `${y}-${padZero(m)}-${padZero(dayNum)}`;
      days.push({ dateString, dayNumber: dayNum, isCurrentMonth: false, isToday: dateString === todayStr });
    }

    // Current month days
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      const dateString = `${currentYear}-${padZero(currentMonth + 1)}-${padZero(i)}`;
      days.push({ dateString, dayNumber: i, isCurrentMonth: true, isToday: dateString === todayStr });
    }

    // Succeeding padding
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const m = currentMonth === 11 ? 1 : currentMonth + 2;
        const y = currentMonth === 11 ? currentYear + 1 : currentYear;
        const dateString = `${y}-${padZero(m)}-${padZero(i)}`;
        days.push({ dateString, dayNumber: i, isCurrentMonth: false, isToday: dateString === todayStr });
      }
    }

    return days;
  }, [currentYear, currentMonth, todayStr]);

  // Group bookings by date
  const bookingsByDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of rows) {
      if (!b.eventDate) continue;
      const key = b.eventDate.split('T')[0];
      const list = map.get(key) || [];
      list.push(b);
      map.set(key, list);
    }
    return map;
  }, [rows]);

  const exportCsv = () => {
    const lines = [['Booking', 'Type', 'Event date', 'Client', 'Total', 'Received', 'Remaining', 'Status'], ...rows.map(b => [b.bookingNumber, b.type, b.eventDate, b.clientName, b.totalAmount, b.receivedAmount, b.remainingBalance, b.status])];
    const csv = lines.map(row => row.map(v => `"${String(v).replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'bookings.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const active = rows.filter(isOpen);

  // Summary KPIs for Bridal/Groom Bookings
  const bookingSummaryKPIs = useMemo(() => {
    const totalCount = rows.length;
    const confirmedCount = rows.filter(b => b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS').length;
    const totalAdvance = rows.reduce((sum, b) => sum + (b.receivedAmount || 0), 0);
    const totalDue = rows.reduce((sum, b) => sum + (b.remainingBalance || 0), 0);
    return { totalCount, confirmedCount, totalAdvance, totalDue };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] flex items-center gap-2 tracking-tight">
                <span>Bridal & Groom Bookings</span>
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Event schedule calendar, reservation management, installment collections & final settlement
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={exportCsv}
            className="h-9 px-3.5 text-xs font-semibold rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 shadow-2xs transition-all"
          >
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3.5 text-xs font-semibold rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 shadow-2xs transition-all"
            onClick={() => printBookingDocument(
              'Bridal / Groom bookings',
              branches.find(b => b.id === branchId)?.name || '',
              ['Booking', 'Type', 'Event', 'Client', 'Total', 'Received', 'Remaining'],
              rows.map(b => [b.bookingNumber, b.type, b.eventDate, b.clientName, b.totalAmount, b.receivedAmount, b.remainingBalance])
            )}
          >
            Print Report
          </Button>
          {admin && (
            <Button
              disabled={!branchId && user?.role !== 'SUPER_ADMIN'}
              onClick={() => { setBookingInitialDate(undefined); setEditing('new'); }}
              className="h-9 font-semibold gap-1.5 shadow-xs text-xs sm:text-sm bg-[#B82E69] hover:bg-[#A02358] text-white rounded-xl transition-all"
            >
              <Plus className="w-4 h-4" />
              New Booking
            </Button>
          )}
        </div>
      </div>

      {error && <p role="alert" className="rounded-2xl bg-rose-50/90 p-4 text-rose-700 text-sm font-medium border border-rose-200 shadow-2xs backdrop-blur-md">{error}</p>}

      {/* KPI Cards Row - Pure White Frosted Glass */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Bookings */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Events
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {bookingSummaryKPIs.totalCount}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Total scheduled reservations
            </span>
          </div>
        </div>

        {/* Confirmed / Active */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="bg-emerald-50 text-emerald-700 shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Active
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {bookingSummaryKPIs.confirmedCount}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Confirmed & in progress
            </span>
          </div>
        </div>

        {/* Received Collections */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <Receipt className="w-4 h-4" />
            </div>
            <span className="bg-[#FAF8F9] text-[#78616C] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Advances
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {formatCurrency(bookingSummaryKPIs.totalAdvance)}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Total received installments
            </span>
          </div>
        </div>

        {/* Outstanding Receivables */}
        <div className="p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
          <div className="flex items-center justify-between relative z-10">
            <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs border border-white/80 flex items-center justify-center text-[#B82E69]">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
              Pending
            </span>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight block">
              {formatCurrency(bookingSummaryKPIs.totalDue)}
            </span>
            <span className="text-xs text-[#78616C] font-medium mt-1 block">
              Unsettled event balance
            </span>
          </div>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="inline-flex rounded-2xl border border-white/60 bg-[#FDF2F5] p-1 shadow-inner overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-4 py-2 text-xs font-bold transition-all whitespace-nowrap ${
              view === 'calendar'
                ? 'bg-white text-[#B82E69] shadow-xs'
                : 'text-[#78616C] hover:text-[#B82E69]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Calendar View
          </button>
          <button
            type="button"
            onClick={() => setView('bookings')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-4 py-2 text-xs font-bold transition-all whitespace-nowrap ${
              view === 'bookings'
                ? 'bg-white text-[#B82E69] shadow-xs'
                : 'text-[#78616C] hover:text-[#B82E69]'
            }`}
          >
            <List className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Bookings Table
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="p-4 sm:p-5 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Field label="Branch">
            <Select
              value={branchId || 'ALL'}
              disabled={user?.role !== 'SUPER_ADMIN'}
              onValueChange={(val) => {
                setSelected(undefined);
                setBranchId(val === 'ALL' ? '' : val);
              }}
            >
              <SelectTrigger className="w-full h-10 rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Branches</SelectItem>
                {branches.filter(b => b.isActive).map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Booking Type">
            <Select
              value={type || 'ALL'}
              onValueChange={(val) => setType(val === 'ALL' ? '' : val)}
            >
              <SelectTrigger className="w-full h-10 rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="BRIDAL">Bridal Event</SelectItem>
                <SelectItem value="GROOM">Groom Event</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Status">
            <Select
              value={status || 'ALL'}
              onValueChange={(val) => setStatus(val === 'ALL' ? '' : val)}
            >
              <SelectTrigger className="w-full h-10 rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="ALL">All Statuses</SelectItem>
                {['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {view !== 'calendar' && (
            <>
              <Field label="From Event Date">
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs h-10" />
              </Field>
              <Field label="To Event Date">
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs h-10" />
              </Field>
            </>
          )}

          <div className={view === 'calendar' ? 'sm:col-span-2 md:col-span-3 lg:col-span-3' : 'sm:col-span-2 md:col-span-1 lg:col-span-1'}>
            <Field label="Search Query">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl border border-white/80 bg-white/80 backdrop-blur-md shadow-2xs"
                  placeholder="Client name / mobile / booking #"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </Field>
          </div>
        </div>
      </div>

      {/* Main View Area: Calendar View (CareDoc UI) */}
      {view === 'calendar' && (
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
          {/* CareDoc Calendar Control Bar */}
          <div className="p-4 sm:p-5 border-b border-white/60 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white/50 backdrop-blur-md">
            {/* Title & Legend Dots */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-6">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[#23151D] tracking-tight">
                  {calendarTitle}
                </h2>
                <p className="text-[11px] text-slate-500 font-medium">
                  {rows.length} All Bookings
                </p>
              </div>

              {/* Legend dots matching CareDoc */}
              <div className="flex items-center gap-3 text-xs font-semibold pl-3 border-l border-[#F1DEE3]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#9D2558]" />
                  <span className="text-slate-700">Bridal Event</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#23151D]" />
                  <span className="text-slate-700">Groom Event</span>
                </div>
              </div>
            </div>

            {/* Navigation & CareDoc View Switcher: Day | Week | Month */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 self-end md:self-auto">
              <div className="flex items-center border border-[#F1DEE3] rounded-xl overflow-hidden bg-white shadow-xs">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  className="h-8 px-2 sm:px-2.5 hover:bg-[#FDF2F5] text-slate-700 rounded-none"
                  title="Previous"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleGoToday}
                  className="h-8 px-2.5 sm:px-3 text-xs font-bold hover:bg-[#FDF2F5] text-[#9D2558] rounded-none border-x border-[#F1DEE3]"
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleNext}
                  className="h-8 px-2 sm:px-2.5 hover:bg-[#FDF2F5] text-slate-700 rounded-none"
                  title="Next"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center bg-[#FDF2F5] p-0.5 rounded-xl border border-[#F1DEE3]">
                {(['day', 'week', 'month'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCalendarMode(m)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg capitalize transition-all ${
                      calendarMode === m
                        ? 'bg-[#9D2558] text-white shadow-xs'
                        : 'text-slate-600 hover:text-[#9D2558]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Week View (CareDoc Reference Time-Grid) */}
          {calendarMode === 'week' && (
            <div className="overflow-x-auto">
              <div className="min-w-[1550px] w-full">
                {/* 7 Column Headers starting Monday */}
                <div className="flex border-b border-[#F1DEE3] bg-[#FDF2F5]">
                  <div className="w-16 sm:w-20 shrink-0 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400 border-r border-[#F1DEE3]">
                    Time
                  </div>
                  <div className="grid grid-cols-7 flex-1 divide-x divide-[#F1DEE3]">
                    {weekDays.map(day => (
                      <div
                        key={day.dateString}
                        className={`py-2.5 px-2 text-center transition-colors ${
                          day.isToday ? 'bg-[#FCE8EC]/60' : ''
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            {day.dayName}
                          </span>
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black ${
                              day.isToday
                                ? 'bg-[#9D2558] text-white shadow-xs'
                                : 'text-[#23151D]'
                            }`}
                          >
                            {day.dayNumber < 10 ? `0${day.dayNumber}` : day.dayNumber}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Hourly Slots (8 AM to 10 PM) */}
                <div className="divide-y divide-[#F1DEE3]">
                  {TIME_SLOTS.map(slot => (
                    <div key={slot.hour} className="flex min-h-[140px]">
                      {/* Left Time label */}
                      <div className="w-16 sm:w-20 shrink-0 p-3 text-right pr-3.5 text-xs font-bold text-slate-400 border-r border-[#F1DEE3] bg-slate-50/20 select-none">
                        {slot.label}
                      </div>

                      {/* 7 Day cells */}
                      <div className="grid grid-cols-7 flex-1 divide-x divide-[#F1DEE3]">
                        {weekDays.map(day => {
                          const dayBookings = bookingsByDate.get(day.dateString) || [];
                          const slotBookings = dayBookings.filter(b => {
                            const h = parseBookingHour(b.serviceTime);
                            return Math.max(8, Math.min(22, h)) === slot.hour;
                          });

                          return (
                            <div
                              key={day.dateString}
                              className={`p-2 relative group flex flex-col gap-2 transition-colors ${
                                day.isToday ? 'bg-[#FDF2F5]/25' : 'bg-white hover:bg-slate-50/40'
                              }`}
                            >
                              {slotBookings.map(b => (
                                <div
                                  key={b.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelected(b);
                                  }}
                                  className={`group/card relative overflow-hidden p-3 rounded-2xl border text-left cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-l-[4px] shadow-2xs ${
                                    b.type === 'BRIDAL'
                                      ? 'bg-gradient-to-br from-white via-[#FDF2F5] to-[#FCE8EC]/50 border-[#F1DEE3] border-l-[#9D2558] hover:border-[#9D2558]'
                                      : 'bg-gradient-to-br from-white via-slate-50/90 to-[#23151D]/5 border-slate-200 border-l-[#23151D] hover:border-[#23151D]'
                                  }`}
                                >
                                  {/* Header: Avatar, Name & Type Badge */}
                                  <div className="flex items-start justify-between gap-1.5 mb-2">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <div
                                        className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-white shrink-0 shadow-xs ${
                                          b.type === 'BRIDAL'
                                            ? 'bg-gradient-to-br from-[#9D2558] to-[#B82F69]'
                                            : 'bg-gradient-to-br from-[#23151D] to-[#452738]'
                                        }`}
                                      >
                                        {b.clientName ? b.clientName.charAt(0).toUpperCase() : 'B'}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <span className="text-xs font-bold text-[#23151D] group-hover/card:text-[#9D2558] transition-colors truncate block leading-tight">
                                          {b.clientName}
                                        </span>
                                        <span className="text-[10px] text-slate-500 font-mono block truncate mt-0.5">
                                          {b.clientPhone || b.bookingNumber}
                                        </span>
                                      </div>
                                    </div>

                                    <span
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 border ${
                                        b.type === 'BRIDAL'
                                          ? 'bg-[#FCE8EC] text-[#9D2558] border-[#F1DEE3]'
                                          : 'bg-slate-900 text-white border-slate-800'
                                      }`}
                                    >
                                      {b.type === 'BRIDAL' ? (
                                        <>
                                          <Sparkles className="w-2.5 h-2.5 text-[#9D2558]" />
                                          <span>Bridal</span>
                                        </>
                                      ) : (
                                        <>
                                          <UserCheck className="w-2.5 h-2.5 text-slate-300" />
                                          <span>Groom</span>
                                        </>
                                      )}
                                    </span>
                                  </div>

                                  {/* Time & Service Info Row */}
                                  <div className="flex items-center justify-between text-[10.5px] text-slate-700 font-medium py-1 px-2 rounded-xl bg-white/95 border border-[#F1DEE3]/70 mb-1.5 shadow-2xs">
                                    <span className="flex items-center gap-1 font-mono font-bold text-slate-800">
                                      <Clock className="w-3 h-3 text-[#9D2558]" />
                                      <span>{b.serviceTime || slot.label}</span>
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-medium truncate max-w-[100px]" title={b.items?.map(i => i.name).join(', ')}>
                                      {b.items?.length === 1 ? b.items[0].name : b.items?.length ? `${b.items.length} items` : 'Booking'}
                                    </span>
                                  </div>

                                  {/* Assigned Staff (if any) */}
                                  {b.assignedStaffName && (
                                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium px-1 mb-1.5 truncate">
                                      <Scissors className="w-3 h-3 text-[#9D2558] shrink-0" />
                                      <span className="truncate">{b.assignedStaffName}</span>
                                    </div>
                                  )}

                                  {/* Financial Due / Paid Footer */}
                                  <div className="flex items-center justify-between pt-1.5 border-t border-[#F1DEE3]/70 text-[10px] font-mono">
                                    <span className="text-slate-400 font-medium text-[9.5px]">
                                      Total: {formatCurrency(b.totalAmount)}
                                    </span>
                                    {b.remainingBalance > 0 ? (
                                      <span className="font-black text-[#9D2558] bg-[#FDF2F5] px-1.5 py-0.5 rounded-md border border-[#F1DEE3]">
                                        Due: {formatCurrency(b.remainingBalance)}
                                      </span>
                                    ) : (
                                      <span className="font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/70 inline-flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Paid
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}

                              {/* Quick Add on cell hover */}
                              {admin && slotBookings.length === 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBookingInitialDate(day.dateString);
                                    setEditing('new');
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity w-full h-full min-h-[40px] flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-[#9D2558] hover:bg-[#FCE8EC]/40 rounded-xl border border-dashed border-transparent hover:border-[#9D2558]/30"
                                  title={`Book at ${slot.label} on ${day.dateString}`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline text-[10px]">Book</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Day View (Single Day Hourly Schedule) */}
          {calendarMode === 'day' && (
            <div className="divide-y divide-[#F1DEE3]">
              {TIME_SLOTS.map(slot => {
                const dayStr = `${activeDate.getFullYear()}-${padZero(activeDate.getMonth() + 1)}-${padZero(activeDate.getDate())}`;
                const dayBookings = bookingsByDate.get(dayStr) || [];
                const slotBookings = dayBookings.filter(b => {
                  const h = parseBookingHour(b.serviceTime);
                  return Math.max(8, Math.min(22, h)) === slot.hour;
                });

                return (
                  <div key={slot.hour} className="flex min-h-[110px]">
                    <div className="w-20 sm:w-24 shrink-0 p-3 text-right pr-4 text-xs font-bold text-slate-400 border-r border-[#F1DEE3] bg-slate-50/20 select-none">
                      {slot.label}
                    </div>
                    <div className="flex-1 p-2.5 sm:p-3 relative group flex flex-wrap gap-3 items-center">
                      {slotBookings.map(b => (
                        <div
                          key={b.id}
                          onClick={() => setSelected(b)}
                          className={`flex-1 min-w-[340px] max-w-[480px] p-3.5 rounded-2xl border text-left cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-l-[4px] shadow-2xs ${
                            b.type === 'BRIDAL'
                              ? 'bg-gradient-to-br from-white via-[#FDF2F5] to-[#FCE8EC]/50 border-[#F1DEE3] border-l-[#9D2558] hover:border-[#9D2558]'
                              : 'bg-gradient-to-br from-white via-slate-50/90 to-[#23151D]/5 border-slate-200 border-l-[#23151D] hover:border-[#23151D]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center text-xs font-black text-white shrink-0 shadow-xs ${
                                  b.type === 'BRIDAL' ? 'bg-gradient-to-br from-[#9D2558] to-[#B82F69]' : 'bg-gradient-to-br from-[#23151D] to-[#452738]'
                                }`}
                              >
                                {b.clientName ? b.clientName.charAt(0).toUpperCase() : 'B'}
                              </div>
                              <div>
                                <h4 className="text-xs sm:text-sm font-bold text-[#23151D] leading-tight">{b.clientName}</h4>
                                <p className="text-[11px] text-slate-500 font-mono mt-0.5">{b.clientPhone || b.bookingNumber}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-mono font-bold text-slate-700 bg-white/95 px-2 py-0.5 rounded-lg border border-[#F1DEE3] shadow-2xs">
                                <Clock className="w-3 h-3 text-[#9D2558]" />
                                {b.serviceTime || slot.label}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-black uppercase tracking-wider border inline-flex items-center gap-1 ${
                                b.type === 'BRIDAL' ? 'bg-[#FCE8EC] text-[#9D2558] border-[#F1DEE3]' : 'bg-slate-900 text-white border-slate-800'
                              }`}>
                                {b.type === 'BRIDAL' ? (
                                  <>
                                    <Sparkles className="w-2.5 h-2.5 text-[#9D2558]" />
                                    Bridal
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="w-2.5 h-2.5 text-slate-300" />
                                    Groom
                                  </>
                                )}
                              </span>
                            </div>
                          </div>

                          {b.assignedStaffName && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium mt-2 px-1">
                              <Scissors className="w-3.5 h-3.5 text-[#9D2558] shrink-0" />
                              <span>Stylist: <strong className="text-slate-800">{b.assignedStaffName}</strong></span>
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[#F1DEE3]/70 text-xs font-mono">
                            <span className="text-slate-500 font-medium">Total: {formatCurrency(b.totalAmount)}</span>
                            {b.remainingBalance > 0 ? (
                              <span className="font-black text-[#9D2558] bg-[#FDF2F5] px-2 py-0.5 rounded-md border border-[#F1DEE3]">
                                Due: {formatCurrency(b.remainingBalance)}
                              </span>
                            ) : (
                              <span className="font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/80 inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Paid
                              </span>
                            )}
                          </div>
                        </div>
                      ))}

                      {admin && slotBookings.length === 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setBookingInitialDate(dayStr);
                            setEditing('new');
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-[#9D2558] p-2 rounded-xl border border-dashed border-slate-200 hover:border-[#9D2558]/30 hover:bg-[#FDF2F5]/50"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Book at {slot.label}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Month View (CareDoc 35-Day Grid) */}
          {calendarMode === 'month' && (
            <div className="overflow-x-auto">
              <div className="min-w-[1150px] w-full">
                {/* Weekday headers */}
                <div className="grid grid-cols-7 border-b border-[#F1DEE3] bg-[#FDF2F5]">
                  {WEEKDAY_NAMES.map((w, idx) => (
                    <div
                      key={w}
                      className={`py-2.5 sm:py-3 text-center text-[11px] sm:text-xs font-bold uppercase tracking-wider ${
                        idx === 0 || idx === 6 ? 'text-[#9D2558]' : 'text-[#23151D]'
                      }`}
                    >
                      {w}
                    </div>
                  ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#F1DEE3] min-h-[580px] sm:min-h-[660px]">
                  {calendarDays.map(cell => {
                    const dayBookings = bookingsByDate.get(cell.dateString) || [];
                    const hasOverflow = dayBookings.length > 3;
                    const displayBookings = hasOverflow ? dayBookings.slice(0, 3) : dayBookings;
                    const overflowCount = dayBookings.length - 3;

                    return (
                      <div
                        key={cell.dateString}
                        className={`min-h-[132px] p-2 flex flex-col justify-between transition-colors group relative ${
                          cell.isCurrentMonth ? 'bg-white' : 'bg-slate-50/50 text-slate-400'
                        } ${cell.isToday ? 'bg-[#FDF2F5]/50 ring-1 ring-inset ring-[#9D2558]/20' : ''}`}
                      >
                        {/* Top Bar of cell */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={`text-xs font-bold inline-flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                              cell.isToday
                                ? 'bg-[#9D2558] text-white shadow-xs scale-105'
                                : cell.isCurrentMonth
                                ? 'text-[#23151D] hover:bg-slate-100'
                                : 'text-slate-400'
                            }`}
                          >
                            {cell.dayNumber}
                          </span>

                          {admin && (
                            <button
                              type="button"
                              onClick={() => {
                                setBookingInitialDate(cell.dateString);
                                setEditing('new');
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-[#9D2558] hover:bg-[#FCE8EC] rounded-lg"
                              title={`Book reservation on ${cell.dateString}`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Bookings list */}
                        <div className="space-y-1.5 flex-1 overflow-hidden">
                          {displayBookings.map(b => (
                            <div
                              key={b.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(b);
                              }}
                              className={`p-2.5 rounded-xl border border-[#F1DEE3] text-left cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md bg-gradient-to-br from-white to-[#FDF2F5]/70 border-l-[3.5px] shadow-2xs ${
                                b.type === 'BRIDAL' ? 'border-l-[#9D2558]' : 'border-l-[#23151D]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 text-[10px] font-semibold">
                                <span className="flex items-center gap-1 font-mono font-bold text-slate-700 text-[10px]">
                                  <Clock className="w-3 h-3 text-[#9D2558]" />
                                  {b.serviceTime || '10:00'}
                                </span>
                                <span
                                  className={`px-1.5 py-0.2 rounded-full text-[8.5px] font-black uppercase tracking-wider border inline-flex items-center gap-0.5 ${
                                    b.type === 'BRIDAL'
                                      ? 'bg-[#FCE8EC] text-[#9D2558] border-[#F1DEE3]'
                                      : 'bg-slate-900 text-white border-slate-800'
                                  }`}
                                >
                                  {b.type === 'BRIDAL' ? (
                                    <>
                                      <Sparkles className="w-2 h-2 text-[#9D2558]" />
                                      Bridal
                                    </>
                                  ) : (
                                    <>
                                      <UserCheck className="w-2 h-2 text-slate-300" />
                                      Groom
                                    </>
                                  )}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 mt-1.5">
                                <div
                                  className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black text-white shrink-0 ${
                                    b.type === 'BRIDAL' ? 'bg-[#9D2558]' : 'bg-[#23151D]'
                                  }`}
                                >
                                  {b.clientName ? b.clientName.charAt(0).toUpperCase() : 'B'}
                                </div>
                                <div className="text-xs font-bold text-[#23151D] truncate leading-tight flex-1">
                                  {b.clientName}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-1 mt-2 pt-1.5 border-t border-[#F1DEE3]/70 text-[10px] font-mono">
                                <span className="text-slate-400 font-medium text-[9px]">
                                  Adv: {formatCurrency(b.advancePaid)}
                                </span>
                                {b.remainingBalance > 0 ? (
                                  <span className="font-bold text-[#9D2558] bg-[#FDF2F5] px-1 rounded">
                                    Due: {formatCurrency(b.remainingBalance)}
                                  </span>
                                ) : (
                                  <span className="text-emerald-700 font-extrabold bg-emerald-50 px-1 rounded">Paid</span>
                                )}
                              </div>
                            </div>
                          ))}

                          {hasOverflow && (
                            <button
                              type="button"
                              onClick={() => setSelectedDayForBookings(cell.dateString)}
                              className="w-full text-center py-1 text-[11px] font-semibold text-[#9D2558] hover:text-[#851C47] hover:bg-[#FCE8EC]/50 rounded-lg transition-colors"
                            >
                              +{overflowCount} more...
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bookings Table View */}
      {view === 'bookings' && (
        <div className="overflow-x-auto rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
          <table className="w-full text-sm">
            <thead className="bg-[#FAF8F9]/80 backdrop-blur-md text-[#78616C] font-semibold text-left border-b border-white/60 text-xs uppercase tracking-wider">
              <tr>
                {['Booking / Type', 'Client', 'Event Schedule', 'Assigned Staff', 'Total', 'Received', 'Remaining', 'Status', 'Actions'].map((v, n) => (
                  <th key={n} className="py-3.5 px-4">{v}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/50">
              {rows.map(b => (
                <tr key={b.id} className="hover:bg-white/80 transition-colors group">
                  <td className="py-3.5 px-4 font-medium">
                    <span className="font-bold text-[#18191B]">{b.bookingNumber}</span>
                    <p className="text-xs text-[#B82E69] font-semibold mt-0.5">{b.type}</p>
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-[#18191B]">
                    {b.clientName}
                    <p className="text-xs text-[#78616C] font-normal font-mono">{b.clientPhone}</p>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="text-[#18191B] font-medium">{b.eventDate}</span>
                    <p className="text-xs text-[#78616C]">{b.serviceTime}</p>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/80 text-slate-700 border border-white/80 shadow-2xs">
                      {b.assignedStaffName || 'Unassigned'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono tabular-nums text-slate-900">{formatCurrency(b.totalAmount)}</td>
                  <td className="py-3.5 px-4 font-mono tabular-nums text-emerald-700 font-medium">{formatCurrency(b.receivedAmount)}</td>
                  <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-[#B82E69]">{formatCurrency(b.remainingBalance)}</td>
                  <td className="py-3.5 px-4 text-xs">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#FDF2F5] text-[#B82E69] font-bold text-[10px] border border-white/60 shadow-2xs inline-block">{b.status}</span>
                    <p className="mt-1 text-[#78616C] text-[11px] font-medium">{b.paymentStatus}</p>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void action(async () => setSelected(await salonService.getBooking(b.id)))}
                        className="h-8 px-3 rounded-xl border border-white/80 bg-white/80 hover:bg-white text-slate-700 shadow-2xs text-xs"
                      >
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Send WhatsApp Confirmation"
                        onClick={() => setConfirmationBooking(b)}
                        className="h-8 px-2.5 rounded-xl border border-emerald-200/80 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 shadow-2xs"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-12 text-center text-[#78616C] font-medium">{loading ? 'Loading bookings from database…' : 'No bookings found matching criteria.'}</p>
          )}
        </div>
      )}


      

      {/* Day Bookings Overflow Modal */}
      {selectedDayForBookings && (
        <Dialog open onOpenChange={o => { if (!o) setSelectedDayForBookings(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-4 sm:p-6 w-[95vw] sm:w-full">
            <DialogHeader className="border-b border-[#F1DEE3] pb-3 mb-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <DialogTitle className="text-base font-bold text-[#23151D]">
                    Reservations on {selectedDayForBookings}
                  </DialogTitle>
                  <p className="text-xs text-slate-500">
                    {(bookingsByDate.get(selectedDayForBookings) || []).length} bookings scheduled for this date
                  </p>
                </div>
                {admin && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setBookingInitialDate(selectedDayForBookings);
                      setSelectedDayForBookings(null);
                      setEditing('new');
                    }}
                    className="font-semibold text-xs h-8 gap-1 self-start sm:self-auto bg-[#9D2558] hover:bg-[#851C47] text-white"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Booking
                  </Button>
                )}
              </div>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              {(bookingsByDate.get(selectedDayForBookings) || []).map(b => (
                <div
                  key={b.id}
                  className="rounded-xl border border-[#F1DEE3] p-3 sm:p-4 bg-white hover:bg-[#FDF2F5]/30 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[#23151D] text-sm">{b.clientName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        b.type === 'BRIDAL' ? 'bg-[#FCE8EC] text-[#9D2558]' : 'bg-slate-100 text-slate-800'
                      }`}>
                        {b.type}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">({b.bookingNumber})</span>
                    </div>
                    <p className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                      <span><Clock className="w-3 h-3 inline mr-1 text-slate-400" />{b.serviceTime}</span>
                      <span>•</span>
                      <span>{b.clientPhone}</span>
                      <span>•</span>
                      <span>Staff: {b.assignedStaffName || 'Unassigned'}</span>
                    </p>
                    <p className="text-xs font-mono font-medium text-slate-700">
                      Total: {formatCurrency(b.totalAmount)} · Adv: <span className="text-emerald-700 font-bold">{formatCurrency(b.advancePaid)}</span> · Rem: <span className="text-[#9D2558] font-bold">{formatCurrency(b.remainingBalance)}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={() => {
                        setSelectedDayForBookings(null);
                        void action(async () => setSelected(await salonService.getBooking(b.id)));
                      }}
                    >
                      View Details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 text-[#9D2558] border-[#F1DEE3] hover:bg-[#FDF2F5] gap-1 font-semibold"
                      onClick={() => {
                        setSelectedDayForBookings(null);
                        setInvoiceBooking(b);
                      }}
                      title="View & Print Booking Advance Invoice"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      Invoice
                    </Button>
                    {isOpen(b) && (
                      <Button
                        size="sm"
                        className="text-xs h-8 bg-[#9D2558] hover:bg-[#851C47] text-white"
                        onClick={() => navigate(`/pos?bookingId=${b.id}`)}
                      >
                        Open POS
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Booking Details Dialog */}
      <BookingDetailsModal
        isOpen={Boolean(selected && !editing && !mode && !ledger && !printReceipt && !invoiceBooking)}
        onClose={() => setSelected(undefined)}
        booking={selected || null}
        branch={branches.find(b => b.id === selected?.branchId) || null}
        onEdit={b => setEditing(b)}
        onOpenInvoice={b => setInvoiceBooking(b)}
        onOpenConfirmationMessage={b => setConfirmationBooking(b)}
        onOpenInPOS={b => navigate(`/pos?bookingId=${b.id}`)}
        onRefund={b => { setSelected(b); setMode('refund'); }}
        onCancel={b => setMode('cancel')}
        onNoShow={b => setMode('no-show')}
        onStartService={b => void action(async () => saved(await salonService.startBooking(b.id, b.revision)))}
      />

      {/* Editing or New Booking Form */}
      {editing && (
        <BookingForm
          branchId={branchId}
          initialDate={bookingInitialDate}
          existing={editing === 'new' ? undefined : editing}
          onSaved={b => {
            saved(b);
            setSelected(b);
          }}
          onClose={() => { setEditing(undefined); setBookingInitialDate(undefined); }}
        />
      )}

      {/* Payment / Refund / Cancel Dialog */}
      {mode && selected && (
        <PaymentDialog
          booking={selected}
          mode={mode}
          onSaved={b => { saved(b); setInvoiceBooking(b); }}
          onClose={() => setMode(undefined)}
        />
      )}

      {/* Ledger Dialog */}
      {ledger && (
        <Dialog open onOpenChange={o => { if (!o) setLedger(undefined); }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 w-[95vw] sm:w-full">
            <DialogHeader>
              <DialogTitle>{ledger.booking.bookingNumber} · Booking ledger</DialogTitle>
            </DialogHeader>
            <p className="text-sm font-semibold">{ledger.booking.clientName} · {ledger.booking.clientPhone}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[500px]">
                <thead>
                  <tr className="border-b">
                    {['Date / Reference', 'Description', 'Charges', 'Payments', 'Balance'].map(v => (
                      <th className="p-2 text-left" key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{new Date(r.date).toLocaleDateString()}<p className="text-slate-500">{r.reference}</p></td>
                      <td className="p-2">{r.description}<p className="text-slate-500">{r.byName} · {r.notes}</p></td>
                      <td className="p-2 font-mono">{formatCurrency(r.debit)}</td>
                      <td className="p-2 font-mono">{formatCurrency(r.credit)}</td>
                      <td className="p-2 font-mono font-bold">{formatCurrency(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ledger.invoiceReference && (
              <p className="text-sm">Transferred to invoice {ledger.invoiceReference}; current invoice due: {formatCurrency(ledger.booking.remainingBalance)}</p>
            )}
            <Button onClick={() => printBookingDocument(ledger.booking.bookingNumber + ' - Booking ledger', ledger.booking.clientName, ['Date', 'Reference', 'Description', 'Charges', 'Payments', 'Balance'], ledger.rows.map(r => [new Date(r.date).toLocaleDateString(), r.reference, r.description, r.debit, r.credit, r.balance]))}>
              Print ledger
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {/* Booking POS Invoice / Advance Receipt Modal */}
      <ReceiptModal
        isOpen={Boolean(invoiceBooking || printReceipt)}
        onClose={() => {
          setInvoiceBooking(null);
          setPrintReceipt(undefined);
        }}
        invoice={
          (invoiceBooking || printReceipt)
            ? bookingToInvoice(
                (invoiceBooking || printReceipt)!,
                branches.find(b => b.id === (invoiceBooking || printReceipt)?.branchId) || null
              )
            : null
        }
        branch={branches.find(b => b.id === (invoiceBooking || printReceipt)?.branchId) || null}
      />

      {/* Booking Confirmation / WhatsApp Modal */}
      <BookingConfirmationModal
        isOpen={Boolean(confirmationBooking)}
        onClose={() => setConfirmationBooking(null)}
        booking={confirmationBooking}
        branch={branches.find(b => b.id === confirmationBooking?.branchId) || null}
        onPrintReceipt={b => {
          setInvoiceBooking(b);
        }}
      />
    </div>
  );
}

