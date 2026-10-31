import React, { useState, useMemo } from 'react';
import { Booking } from '@/types/booking';
import { Branch } from '@/types/salon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  Copy,
  Check,
  ExternalLink,
  Calendar,
  Clock,
  Scissors,
  CheckCheck,
  Printer,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { toast } from '@/context/ToastContext';
import { formatCurrency, normalizePhoneDigits } from '@/lib/formatters';

interface BookingConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking | null;
  branch?: Branch | null;
  onPrintReceipt?: (booking: Booking) => void;
}

export const BookingConfirmationModal: React.FC<BookingConfirmationModalProps> = ({
  isOpen,
  onClose,
  booking,
  branch,
  onPrintReceipt,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const fullMessageText = useMemo(() => {
    if (!booking) return '';
    const bName = branch?.name || 'Meerub Salon';
    const bPhone = branch?.phone ? `\nBranch Contact: ${branch.phone}` : '';
    const servicesList = booking.items.map(i => i.name).filter(Boolean).join(', ') || 'Bridal/Groom Services';
    const advance = booking.advancePaid || (booking.payments && booking.payments.length > 0 ? booking.payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0) : 0);
    const remaining = booking.remainingBalance ?? Math.max(0, (booking.totalAmount || 0) - advance);

    let financeLines = `Total Amount: PKR ${Number(booking.totalAmount || 0).toLocaleString('en-PK')}`;
    if (advance > 0) {
      financeLines += `\nAdvance Paid: PKR ${Number(advance).toLocaleString('en-PK')}`;
      if (remaining > 0) {
        financeLines += `\nRemaining Balance: PKR ${Number(remaining).toLocaleString('en-PK')}`;
      } else {
        financeLines += `\nPayment Status: Fully Paid`;
      }
    }

    return `Dear ${booking.clientName},
Your ${booking.type === 'BRIDAL' ? 'Bridal' : 'Groom'} Reservation at ${bName} is confirmed!

Booking Ref: #${booking.bookingNumber}
Event Date: ${booking.eventDate}
Service Time: ${booking.serviceTime || '10:00 AM'}
Services: ${servicesList}
${financeLines}${bPhone}

We look forward to serving you!`;
  }, [booking, branch]);

  const handleCopy = () => {
    if (!booking) return;
    navigator.clipboard.writeText(fullMessageText);
    setCopied(true);
    toast.success('Confirmation message copied to clipboard!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenWhatsApp = () => {
    if (!booking) return;
    const digitsOnly = normalizePhoneDigits(booking.clientPhone);
    const cleanPhone = digitsOnly.startsWith('92')
      ? digitsOnly
      : digitsOnly.startsWith('0')
      ? `92${digitsOnly.slice(1)}`
      : `92${digitsOnly}`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(fullMessageText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!booking) return null;

  const advance = booking.advancePaid || (booking.payments && booking.payments.length > 0 ? booking.payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0) : 0);
  const remaining = booking.remainingBalance ?? Math.max(0, (booking.totalAmount || 0) - advance);
  const servicesDisplay = booking.items.map(i => i.name).filter(Boolean).join(', ') || 'Bridal/Groom Package';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-5 sm:p-6 font-sans">
        <DialogHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold shadow-xs">
                <MessageSquare className="w-4.5 h-4.5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900 tracking-tight">
                  Booking Confirmation
                </DialogTitle>
                <p className="text-xs text-slate-400">
                  Ready to send via WhatsApp or SMS
                </p>
              </div>
            </div>
            <Badge variant="neutral" className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border-emerald-200 py-0.5 px-2">
              WhatsApp Ready
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Client Summary Header */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-[#FCE8EC] text-[#9D2558] flex items-center justify-center font-bold text-xs shrink-0">
                {booking.clientName?.charAt(0) || 'C'}
              </div>
              <div className="truncate">
                <span className="font-bold text-slate-900 block text-xs truncate">{booking.clientName}</span>
                <span className="text-[10px] text-slate-500 font-mono block">{booking.clientPhone}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-mono">Ref</span>
              <span className="font-mono font-bold text-xs text-slate-800">{booking.bookingNumber}</span>
            </div>
          </div>

          {/* WhatsApp Styled Message Bubble Container */}
          <div className="p-3.5 rounded-2xl bg-[#EFEAE2]/60 border border-slate-200/70 space-y-2">
            <div className="text-center">
              <span className="text-[9px] font-semibold bg-white/90 text-slate-500 px-2.5 py-0.5 rounded-full shadow-2xs inline-flex items-center gap-1">
                {booking.type === 'BRIDAL' ? (
                  <>
                    <Sparkles className="w-2.5 h-2.5 text-[#9D2558]" />
                    Bridal Reservation
                  </>
                ) : (
                  <>
                    <UserCheck className="w-2.5 h-2.5 text-slate-600" />
                    Groom Reservation
                  </>
                )}
              </span>
            </div>

            {/* Chat Message Bubble */}
            <div className="bg-white p-3.5 rounded-2xl rounded-tl-xs shadow-xs border border-slate-200/50 space-y-2 text-xs">
              <div className="space-y-0.5">
                <p className="font-bold text-slate-900 text-xs">
                  Dear {booking.clientName},
                </p>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Your reservation at <strong className="text-slate-900">{branch?.name || 'Meerub Salon'}</strong> is confirmed!
                </p>
              </div>

              {/* Structured Details Box */}
              <div className="p-2.5 rounded-xl bg-slate-50/90 border border-slate-100 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#9D2558]" /> Event Date:
                  </span>
                  <span className="font-semibold text-slate-800 font-mono text-[11px]">{booking.eventDate}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" /> Start Time:
                  </span>
                  <span className="font-bold text-emerald-700 font-mono text-[11px]">{booking.serviceTime || '10:00 AM'}</span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-500 text-[11px] flex items-center gap-1.5 shrink-0">
                    <Scissors className="w-3.5 h-3.5 text-[#9D2558]" /> Services:
                  </span>
                  <span className="font-semibold text-slate-800 text-right truncate text-[11px] max-w-[200px]">
                    {servicesDisplay}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200/70">
                  <span className="text-slate-500 text-[11px]">Total Package:</span>
                  <span className="font-bold font-mono text-[#9D2558] text-xs">
                    {formatCurrency(booking.totalAmount)}
                  </span>
                </div>

                {advance > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-emerald-700">Advance Paid:</span>
                    <span className="font-semibold font-mono text-emerald-700">
                      {formatCurrency(advance)}
                    </span>
                  </div>
                )}

                {advance > 0 && remaining > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Remaining Balance:</span>
                    <span className="font-semibold font-mono text-slate-700">
                      {formatCurrency(remaining)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                <span>Contact: <strong className="font-mono text-slate-700">{branch?.phone || 'Salon Reception'}</strong></span>
                <div className="flex items-center gap-1 text-slate-400 font-mono">
                  <span>Just now</span>
                  <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            Close
          </Button>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
            {onPrintReceipt && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPrintReceipt(booking)}
                className="gap-1.5 text-xs text-slate-700 rounded-xl h-8.5"
              >
                <Printer className="w-3.5 h-3.5 text-slate-500" />
                Print Voucher
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-1.5 text-xs text-slate-700 rounded-xl h-8.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handleOpenWhatsApp}
              className="bg-[#25D366] hover:bg-[#1EBE5D] text-white gap-1.5 text-xs font-bold rounded-xl h-8.5 px-3.5 shadow-xs cursor-pointer transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open WhatsApp
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
