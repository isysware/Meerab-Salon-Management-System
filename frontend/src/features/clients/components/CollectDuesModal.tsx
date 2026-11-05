import React, { useState, useEffect } from 'react';
import { Invoice, PaymentAccount } from '@/types/salon';
import { useAuth } from '@/context/AuthContext';
import { salonService } from '@/services';
import { formatCurrency } from '@/lib/formatters';
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
import { toast } from '@/context/ToastContext';
import { AlertCircle, CreditCard, Banknote, Landmark, CheckCircle2 } from 'lucide-react';

interface CollectDuesModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onSuccess: (updatedInvoice: Invoice) => void;
}

export const CollectDuesModal: React.FC<CollectDuesModalProps> = ({
  isOpen,
  onClose,
  invoice,
  onSuccess,
}) => {
  const { user } = useAuth();

  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ONLINE_ACCOUNT'>('CASH');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [isPartialMode, setIsPartialMode] = useState<boolean>(false);
  const [selectedOnlineAccountId, setSelectedOnlineAccountId] = useState<string>('');
  const [onlineAccounts, setOnlineAccounts] = useState<PaymentAccount[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const paymentKey = React.useRef('');
  const paymentBusy = React.useRef(false);

  useEffect(() => {
    if (invoice && isOpen) {
      paymentKey.current = crypto.randomUUID();
      setPaymentAmount(invoice.amountDue);
      setIsPartialMode(false);
      setPaymentMethod('CASH');

      // Fetch online accounts for the branch
      salonService.getPaymentAccounts(invoice.branchId).then((accs) => {
        const active = accs.filter((a) => a.isActive);
        setOnlineAccounts(active);
        if (active.length > 0) {
          setSelectedOnlineAccountId(active[0].id);
        }
      });
    }
  }, [invoice, isOpen]);

  if (!invoice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentBusy.current || isSubmitting) return;

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      toast.error('Payment amount must be greater than zero.');
      return;
    }

    if (paymentAmount > invoice.amountDue) {
      toast.error(`Payment amount cannot exceed outstanding balance of ${formatCurrency(invoice.amountDue)}.`);
      return;
    }

    if (paymentMethod === 'ONLINE_ACCOUNT' && !selectedOnlineAccountId) {
      toast.error('Please select a valid online bank account.');
      return;
    }

    paymentBusy.current = true;
    setIsSubmitting(true);
    try {
      const payments = [];
      if (paymentMethod === 'CASH') {
        payments.push({
          method: 'CASH' as const,
          amount: paymentAmount,
          billAllocation: paymentAmount,
          tipAllocation: 0,
          cashTendered: paymentAmount,
          changeReturned: 0,
        });
      } else {
        const acc = onlineAccounts.find((a) => a.id === selectedOnlineAccountId);
        payments.push({
          method: 'ONLINE_ACCOUNT' as const,
          paymentAccountId: acc?.id,
          paymentAccountName: acc?.name,
          amount: paymentAmount,
          billAllocation: paymentAmount,
          tipAllocation: 0,
        });
      }

      const idempotencyKey = paymentKey.current;

      const updated = await salonService.collectInvoicePayment(
        {
          invoiceId: invoice.id,
          payments,
          idempotencyKey,
          notes: `Dues collection for invoice ${invoice.invoiceNumber}`,
        },
        user || undefined
      );

      toast.success(`Payment of ${formatCurrency(paymentAmount)} recorded successfully.`);
      onSuccess(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('refresh-notifications'));
      }
    } catch (err: any) {
      console.error('Failed to collect dues payment', err);
      toast.error(err.message || 'Payment collection failed.');
    } finally {
      paymentBusy.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md font-sans p-5 space-y-4 rounded-2xl bg-white shadow-xl border border-slate-200">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader className="pb-2 border-b border-slate-100">
            <div className="flex items-center justify-between pr-4">
              <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-600" />
                <span>Collect Outstanding Receivable</span>
              </DialogTitle>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-[#FDF2F5] text-[#9D2558] border border-[#F1DEE3]">
                {invoice.invoiceNumber}
              </span>
            </div>
          </DialogHeader>

          {/* Customer & Outstanding Balance Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-rose-50/70 via-white to-rose-50/30 border border-rose-100 flex items-center justify-between shadow-2xs text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Customer</span>
              <div className="font-bold text-slate-900 text-sm mt-0.5">
                {invoice.clientName}
              </div>
              {invoice.clientPhone && (
                <span className="text-xs text-slate-500 font-mono block mt-0.5">
                  {invoice.clientPhone}
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">Remaining Balance</span>
              <span className="font-mono font-extrabold text-rose-700 text-lg block mt-0.5">
                {formatCurrency(invoice.amountDue)}
              </span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">Payment Method</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`h-9 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  paymentMethod === 'CASH'
                    ? 'bg-emerald-50/80 border-emerald-500 text-emerald-800 shadow-2xs ring-1 ring-emerald-500/20'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-600" />
                Cash
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('ONLINE_ACCOUNT')}
                className={`h-9 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  paymentMethod === 'ONLINE_ACCOUNT'
                    ? 'bg-emerald-50/80 border-emerald-500 text-emerald-800 shadow-2xs ring-1 ring-emerald-500/20'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Landmark className="w-4 h-4 text-emerald-600" />
                Online Account
              </button>
            </div>
          </div>

          {/* Named Bank Account Selector (When Online is chosen) */}
          {paymentMethod === 'ONLINE_ACCOUNT' && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="text-xs font-bold text-slate-700 block">Deposit To Payment Account</label>
              <select
                value={selectedOnlineAccountId}
                onChange={(e) => setSelectedOnlineAccountId(e.target.value)}
                className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {onlineAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.providerName} - {a.accountIdentifier})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Partial Payment Toggle & Input */}
          {!isPartialMode ? (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-500">
                Collecting full balance: <strong className="font-mono text-slate-800">{formatCurrency(invoice.amountDue)}</strong>
              </span>
              <button
                type="button"
                onClick={() => setIsPartialMode(true)}
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
                    setPaymentAmount(invoice.amountDue);
                  }}
                  className="text-[11px] font-semibold text-[#9D2558] hover:underline cursor-pointer"
                >
                  Collect Full Balance ({formatCurrency(invoice.amountDue)})
                </button>
              </div>
              <Input
                type="number"
                min={1}
                max={invoice.amountDue}
                step="any"
                autoFocus
                value={paymentAmount || ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setPaymentAmount(Math.min(invoice.amountDue, Math.max(0, val)));
                }}
                placeholder={`Enter amount (max ${formatCurrency(invoice.amountDue)})`}
                className="font-mono font-bold text-sm h-9 bg-white rounded-lg border-slate-300"
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>Collecting: {formatCurrency(paymentAmount)}</span>
                <span className="text-rose-600 font-semibold">
                  Remaining Due: {formatCurrency(Math.max(0, invoice.amountDue - paymentAmount))}
                </span>
              </div>
            </div>
          )}

          {/* Single Clear Action Button */}
          <div className="pt-2">
            <Button
              type="submit"
              disabled={isSubmitting || paymentAmount <= 0 || paymentAmount > invoice.amountDue}
              className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block" />
                  <span>Recording Collection...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Accept Payment — {formatCurrency(paymentAmount)}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
