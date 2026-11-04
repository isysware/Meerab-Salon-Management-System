import React, { useState, useEffect, useRef } from 'react';
import type { Client } from '@/types/salon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Users,
  UserCheck,
  Phone,
  Clock,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Receipt,
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { salonService } from '@/services';
import { useAuth } from '@/context/AuthContext';

interface ClientPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  onSelectClient: (client: Client) => void;
  onOpenRegisterModal: (query?: string) => void;
  selectedClientId?: string;
}

export const ClientPickerModal: React.FC<ClientPickerModalProps> = ({
  isOpen,
  onClose,
  branchId,
  onSelectClient,
  onOpenRegisterModal,
  selectedClientId,
}) => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch clients on open or when searchQuery changes
  useEffect(() => {
    if (!isOpen || !branchId) return;

    let isCancelled = false;
    const fetchClients = async () => {
      setLoading(true);
      try {
        const results = await salonService.searchClients(branchId, searchQuery, user);
        if (!isCancelled) {
          setClients(results || []);
        }
      } catch (err) {
        console.error('Failed to search clients:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    const timer = setTimeout(fetchClients, searchQuery ? 250 : 0);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, branchId, searchQuery, user]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleSelect = (client: Client) => {
    onSelectClient(client);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg w-full rounded-[28px] border border-white/90 bg-white/95 backdrop-blur-2xl shadow-[0_20px_60px_rgba(35,21,29,0.14)] p-5 sm:p-6 flex flex-col max-h-[88vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="shrink-0 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-rose-100/60 border border-rose-200/80 text-[#B82E69] flex items-center justify-center shadow-2xs shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-extrabold text-[#18191B] tracking-tight">
                  Select Existing Client
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-medium">
                  Link bill to customer profile and track ledger balance.
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Search Bar & Action */}
        <div className="mt-4 shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search by client name or phone number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 text-xs h-9.5 bg-slate-50/80 hover:bg-white focus:bg-white border-slate-200/80 rounded-2xl shadow-2xs font-medium placeholder:text-slate-400 focus:border-[#B82E69] transition-all"
            />
            {loading ? (
              <div className="w-4 h-4 rounded-full border-2 border-rose-200 border-t-[#B82E69] animate-spin absolute right-3 top-2.5" />
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => {
              onClose();
              onOpenRegisterModal(searchQuery);
            }}
            className="h-9.5 px-3.5 text-xs font-bold gap-1.5 bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02358] hover:to-[#851C47] text-white rounded-2xl shrink-0 shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Client</span>
          </Button>
        </div>

        {/* Results List */}
        <div className="mt-3 flex-1 min-h-[220px] max-h-[420px] overflow-y-auto space-y-2 pr-1 -mr-1">
          {loading && clients.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-[#B82E69] border-t-transparent rounded-full animate-spin mx-auto" />
              <p>Searching clients directory...</p>
            </div>
          ) : clients.length > 0 ? (
            clients.map((client) => {
              const isSelected = selectedClientId === client.id;
              const hasDue = (client.outstandingBalance || 0) > 0;

              return (
                <div
                  key={client.id}
                  onClick={() => handleSelect(client)}
                  className={`group p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#FDF2F5] border-[#B82E69]/40 shadow-xs ring-1 ring-[#B82E69]/20'
                      : 'bg-white/80 hover:bg-[#FDF2F5]/60 border-slate-100 hover:border-rose-100 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-2xl flex items-center justify-center font-bold text-xs shrink-0 transition-transform group-hover:scale-105 shadow-2xs ${
                        isSelected
                          ? 'bg-gradient-to-br from-[#B82E69] to-[#851C47] text-white'
                          : 'bg-rose-50 border border-rose-100 text-[#B82E69]'
                      }`}
                    >
                      {isSelected ? (
                        <UserCheck className="w-4 h-4" />
                      ) : (
                        <span>{client.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-[#18191B] text-xs truncate group-hover:text-[#B82E69] transition-colors">
                          {client.name}
                        </span>
                        {isSelected && (
                          <span className="text-[9px] font-extrabold uppercase bg-[#B82E69] text-white px-1.5 py-0.2 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#78616C]">
                        <span className="font-mono flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {client.phone}
                        </span>
                        {(client.totalVisits || 0) > 0 && (
                          <span className="text-slate-400 text-[10px]">
                            • {client.totalVisits} visit{client.totalVisits !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {hasDue ? (
                      <span className="text-[10px] font-extrabold text-amber-900 bg-amber-100/90 border border-amber-300 px-2 py-0.5 rounded-lg flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Due: {formatCurrency(client.outstandingBalance || 0)}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg">
                        Clear
                      </span>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant={isSelected ? 'default' : 'outline'}
                      className={`h-7 px-3 text-[11px] font-bold rounded-xl cursor-pointer ${
                        isSelected
                          ? 'bg-[#B82E69] hover:bg-[#A02358] text-white'
                          : 'border-rose-100 hover:border-[#B82E69] hover:text-[#B82E69]'
                      }`}
                    >
                      {isSelected ? 'Selected' : 'Select'}
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-10 text-center text-xs space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/60 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-[#18191B]">
                  {searchQuery ? `No client found matching "${searchQuery}"` : 'No registered clients in this branch'}
                </p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Would you like to register this customer now in your CRM?
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenRegisterModal(searchQuery);
                }}
                className="h-8 text-xs font-bold gap-1 bg-gradient-to-r from-[#B82E69] to-[#9D2558] hover:from-[#A02358] hover:to-[#851C47] text-white rounded-xl shadow-2xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Register "{searchQuery || 'New Client'}"
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="text-[11px]">
            {clients.length} client{clients.length !== 1 ? 's' : ''} available
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs font-semibold hover:bg-slate-100 rounded-xl"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
