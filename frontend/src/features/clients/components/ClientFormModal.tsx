import React, { useState, useEffect } from 'react';
import { Branch, Client, CustomerSource } from '@/types/salon';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { formatPhoneNumber, normalizePhoneDigits } from '@/lib/formatters';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, User, Phone, Mail, Building2, Tag, FileText } from 'lucide-react';
import { toast } from '@/context/ToastContext';

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (client: Client) => void;
  clientToEdit?: Client | null;
  activeBranchId: string;
  branches: Branch[];
  initialName?: string;
  initialPhone?: string;
}

const CUSTOMER_SOURCES: { value: CustomerSource; label: string }[] = [
  { value: 'WALK_IN', label: 'Walk-In' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'GOOGLE', label: 'Google Search / Maps' },
  { value: 'WORD_OF_MOUTH', label: 'Word of Mouth' },
  { value: 'REFERRAL', label: 'Client Referral' },
  { value: 'INFLUENCER', label: 'Influencer Campaign' },
  { value: 'RETURNING', label: 'Returning Regular' },
  { value: 'OTHER', label: 'Other Channel' },
];

export const ClientFormModal: React.FC<ClientFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  clientToEdit,
  activeBranchId,
  branches,
  initialName = '',
  initialPhone = '',
}) => {
  const { user } = useAuth();

  const isEditing = Boolean(clientToEdit);

  // Form states
  const [branchId, setBranchId] = useState<string>(activeBranchId);
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [source, setSource] = useState<CustomerSource>('WALK_IN');
  const [sourceDetails, setSourceDetails] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Validation & Submission
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (clientToEdit) {
      setBranchId(clientToEdit.branchId);
      setName(clientToEdit.name);
      setPhone(clientToEdit.phone);
      setEmail(clientToEdit.email || '');
      setSource((clientToEdit.source as CustomerSource) || 'WALK_IN');
      setSourceDetails(clientToEdit.sourceDetails || '');
      setNotes(clientToEdit.notes || '');
    } else {
      setBranchId(activeBranchId || (branches.length > 0 ? branches[0].id : ''));
      setName(initialName);
      setPhone(initialPhone);
      setEmail('');
      setSource('WALK_IN');
      setSourceDetails('');
      setNotes('');
    }
    setFieldErrors({});
    setErrorMsg(null);
  }, [clientToEdit, activeBranchId, branches, isOpen, initialName, initialPhone]);

  const handlePhoneChange = (val: string) => {
    setPhone(val);
    if (fieldErrors.phone) {
      setFieldErrors((prev) => ({ ...prev, phone: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = 'Customer name is required';
    }

    const normPhone = normalizePhoneDigits(phone);
    if (!phone.trim()) {
      errors.phone = 'Phone number is required';
    } else if (normPhone.length < 10) {
      errors.phone = 'Please enter a valid phone number (at least 10 digits)';
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address';
    }

    if (!branchId || !branches.some((branch) => branch.id === branchId)) errors.branchId = 'Please select a branch for this client.';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstError = Object.values(errors)[0];
      toast.error(firstError);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && clientToEdit) {
        const updated = await salonService.updateClient(
          clientToEdit.id,
          {
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || undefined,
            source,
            sourceDetails: sourceDetails.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          user || undefined
        );
        toast.success(`Client "${updated.name}" updated successfully!`);
        onSuccess(updated);
      } else {
        const created = await salonService.createClient(
          {
            branchId,
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || undefined,
            source,
            sourceDetails: sourceDetails.trim() || undefined,
            loyaltyPoints: 0,
            notes: notes.trim() || undefined,
            isArchived: false,
          },
          user || undefined
        );
        toast.success(`Client "${created.name}" registered successfully!`);
        onSuccess(created);
      }
    } catch (err: any) {
      console.error('Failed to save client', err);
      const errMsg = err.message || 'Failed to save customer record. Please review inputs.';
      setErrorMsg(errMsg);
      toast.error(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <User className="w-5 h-5 text-[#9D2558]" />
              <span>{isEditing ? 'Edit Customer Profile' : 'Add New Customer'}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5">
            {/* Branch Selection (Super Admin only) */}
            {user?.role === 'SUPER_ADMIN' && !isEditing && (
              <div>
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  Branch <span className="text-rose-500">*</span>
                </Label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:ring-1 focus:ring-[#9D2558]/20"
                >
                  <option value="">Select branch for this client</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Name */}
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Customer Full Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder="e.g. Ayesha Malik"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: '' }));
                }}
                className={`h-9 text-xs ${fieldErrors.name ? 'border-rose-400 bg-rose-50/30' : ''}`}
              />
              {fieldErrors.name && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.name}</p>
              )}
            </div>

            {/* Phone */}
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                Mobile Phone Number <span className="text-rose-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder="e.g. +92 300 1234567"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                onBlur={() => {
                  if (phone.trim()) setPhone(formatPhoneNumber(phone));
                }}
                className={`h-9 text-xs ${fieldErrors.phone ? 'border-rose-400 bg-rose-50/30' : ''}`}
              />
              {fieldErrors.phone && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.phone}</p>
              )}
              <p className="text-[10px] text-slate-400 mt-0.5">
                Standardizes to canonical normalized phone format.
              </p>
            </div>

            {/* Email */}
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Email Address <span className="text-slate-400 font-normal">(Optional)</span>
              </Label>
              <Input
                type="email"
                placeholder="e.g. ayesha.malik@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
                }}
                className={`h-9 text-xs ${fieldErrors.email ? 'border-rose-400 bg-rose-50/30' : ''}`}
              />
              {fieldErrors.email && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.email}</p>
              )}
            </div>

            {/* Source & Source Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                  <Tag className="w-3.5 h-3.5 text-slate-400" />
                  Acquisition Source
                </Label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as CustomerSource)}
                  className="w-full h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:ring-1 focus:ring-[#9D2558]/20"
                >
                  {CUSTOMER_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                  Source Details
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. Summer Promo 2026, Referred by Sana"
                  value={sourceDetails}
                  onChange={(e) => setSourceDetails(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                Client Preferences & Notes
              </Label>
              <textarea
                rows={2}
                placeholder="Allergies, preferred stylist, hair/skin profile notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-[#9D2558]/20"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="bg-[#9D2558] hover:bg-[#851C47] text-white text-xs font-semibold gap-1"
            >
              {isSubmitting ? 'Saving...' : isEditing ? 'Update Client' : 'Save Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
