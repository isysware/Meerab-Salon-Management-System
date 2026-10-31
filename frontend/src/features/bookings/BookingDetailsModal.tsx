import React, { useState } from 'react';
import { Booking } from '@/types/booking';
import { Branch } from '@/types/salon';
import { formatCurrency } from '@/lib/formatters';
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
  Calendar,
  Clock,
  User,
  Phone,
  Scissors,
  Package,
  Receipt,
  MessageSquare,
  Edit,
  Building2,
  Sparkles,
  ShoppingCart,
  UserCheck,
  XCircle,
  UserX,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';

interface BookingDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking | null;
  branch?: Branch | null;
  onEdit: (booking: Booking) => void;
  onOpenConfirmationMessage: (booking: Booking) => void;
  onOpenInPOS: (booking: Booking) => void;
  onCancel?: (booking: Booking) => void;
  onRefund?: (booking: Booking) => void;
  onNoShow?: (booking: Booking) => void;
  onStartService?: (booking: Booking) => void;
}

export const BookingDetailsModal: React.FC<BookingDetailsModalProps> = ({
  isOpen,
  onClose,
  booking,
  branch,
  onEdit,
  onOpenConfirmationMessage,
  onOpenInPOS,
  onCancel,
  onRefund,
  onNoShow,
  onStartService,
}) => {
  if (!booking) return null;

  const isBilled = Boolean(booking.linkedInvoiceId || booking.linkedInvoiceNumber);
  const isOpenStatus = !isBilled && !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(booking.status);

  const advance =
    booking.advancePaid ||
    (booking.payments && booking.payments.length > 0
      ? booking.payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0)
      : 0);

  const remaining = booking.remainingBalance ?? Math.max(0, (booking.totalAmount || 0) - advance);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <Badge variant="primary" className="bg-[#9D2558] text-white font-medium">
            CONFIRMED
          </Badge>
        );
      case 'IN_PROGRESS':
        return (
          <Badge variant="warning" className="bg-amber-500 text-white font-medium">
            IN SERVICE
          </Badge>
        );
      case 'COMPLETED':
        return (
          <Badge variant="success" className="bg-emerald-600 text-white font-medium">
            COMPLETED
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge variant="destructive" className="bg-rose-600 text-white font-medium">
            CANCELLED
          </Badge>
        );
      case 'NO_SHOW':
        return (
          <Badge variant="destructive" className="bg-slate-700 text-white font-medium">
            NO SHOW
          </Badge>
        );
      case 'PENDING':
      default:
        return (
          <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 font-medium">
            PENDING
          </Badge>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 font-sans">
        {/* Header (Matching AppointmentDetailsModal) */}
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-mono block">
                {booking.bookingNumber}
              </span>
              <DialogTitle className="text-xl font-bold text-slate-900 mt-0.5 flex items-center gap-2">
                {booking.clientName}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2 pr-6">
              {getStatusBadge(booking.status)}
              <Badge
                variant="outline"
                className={`text-xs ${
                  isBilled
                    ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
                    : 'border-slate-300 text-slate-600 bg-slate-50'
                }`}
              >
                {isBilled ? 'BILLED' : 'UNBILLED'}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-5">
          {/* 1. Schedule & Customer Overview Box */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 text-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar className="w-4 h-4 text-[#9D2558]" />
                <span>
                  Date: <strong className="text-slate-900">{booking.eventDate}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <Clock className="w-4 h-4 text-[#9D2558]" />
                <span>
                  Start Time: <strong className="text-slate-900">{booking.serviceTime || '10:00 AM'}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <Building2 className="w-4 h-4 text-[#9D2558]" />
                <span>
                  Branch: <strong className="text-slate-900">{branch?.name || 'Meerub Salon'}</strong>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-600">
                <User className="w-4 h-4 text-[#9D2558]" />
                <span>
                  Customer: <strong className="text-slate-900">{booking.clientName}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <Phone className="w-4 h-4 text-[#9D2558]" />
                <span>
                  Phone: <strong className="text-slate-900">{booking.clientPhone}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                {booking.type === 'BRIDAL' ? (
                  <Sparkles className="w-4 h-4 text-[#9D2558]" />
                ) : (
                  <UserCheck className="w-4 h-4 text-slate-700" />
                )}
                <span>
                  Type:{' '}
                  <span className="font-bold text-[#9D2558]">
                    {booking.type === 'BRIDAL' ? 'Bridal Event' : 'Groom Event'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* 2. Selected Services & Staff Assignments */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Selected Services & Staff Assignments ({booking.items.length})
            </h4>

            {booking.items.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                {booking.items.map((it, idx) => (
                  <div key={idx} className="p-3.5 bg-white text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {it.type === 'PACKAGE' ? (
                          <Package className="w-4 h-4 text-[#9D2558]" />
                        ) : (
                          <Scissors className="w-4 h-4 text-[#9D2558]" />
                        )}
                        <strong className="text-slate-900">{it.name}</strong>
                        {it.quantity > 1 && (
                          <span className="text-slate-500 font-mono">× {it.quantity}</span>
                        )}
                        {it.type === 'PACKAGE' && (
                          <Badge variant="outline" className="text-[10px] bg-[#FDF2F5] text-[#9D2558]">
                            Package Bundle
                          </Badge>
                        )}
                      </div>
                      <span className="font-semibold text-slate-900 tabular-nums font-mono">
                        {formatCurrency(it.unitPrice * it.quantity)}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 pl-6 flex items-center gap-2">
                      <span>
                        Stylist: <strong className="text-slate-700">{it.staffName || booking.assignedStaffName || 'Unassigned'}</strong>
                      </span>
                      {it.durationMinutes && (
                        <span>• {it.durationMinutes} mins</span>
                      )}
                    </div>

                    {/* If package components */}
                    {it.type === 'PACKAGE' && it.components && it.components.length > 0 && (
                      <div className="mt-2 pl-6 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
                        {it.components.map((comp, cIdx) => (
                          <span
                            key={cIdx}
                            className="px-2 py-0.5 bg-slate-50 border border-slate-200 text-slate-700 rounded text-[11px]"
                          >
                            • {comp.serviceName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
                No items recorded for this booking.
              </div>
            )}
          </div>

          {/* 3. Total Quoted Price & Advance Payment Box */}
          <div className="p-4 rounded-xl bg-[#FDF2F5]/70 border border-[#F1DEE3] space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 block">Total Quoted Price</span>
                <span className="text-2xl font-extrabold text-[#9D2558] tabular-nums font-mono">
                  {formatCurrency(booking.totalAmount)}
                </span>
              </div>

              <div className="text-right space-y-1">
                <div className="flex items-center justify-end gap-2 text-xs">
                  <span className="text-slate-600">Advance Paid:</span>
                  <span className="font-bold text-emerald-700 font-mono text-sm bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                    {formatCurrency(advance)}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2 text-xs">
                  <span className="text-slate-600">Remaining Balance:</span>
                  <span className="font-bold text-[#9D2558] font-mono text-sm">
                    {formatCurrency(remaining)}
                  </span>
                </div>
              </div>
            </div>

            {booking.notes && (
              <div className="pt-2 border-t border-[#F1DEE3] text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Notes: </span>
                <span className="italic">{booking.notes}</span>
              </div>
            )}
            {booking.specialRequirements && (
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Special Requirements: </span>
                <span className="italic">{booking.specialRequirements}</span>
              </div>
            )}
          </div>

          {/* 4. Linked Final Invoice Banner if Billed */}
          {isBilled && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 text-emerald-800">
                <Receipt className="w-5 h-5 text-emerald-600" />
                <div>
                  <strong className="block">Billed under Invoice {booking.linkedInvoiceNumber}</strong>
                  <span className="text-[11px] text-emerald-700">
                    Booking finalized and recorded in POS sales ledger.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions (Matching AppointmentDetailsModal) */}
        <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenConfirmationMessage(booking)}
              className="text-xs gap-1.5 border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-semibold"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Confirmation Message
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onEdit(booking);
              }}
              className="text-xs gap-1.5"
            >
              <Edit className="w-3.5 h-3.5" />
              Edit
            </Button>

            {isOpenStatus && (onRefund || onCancel) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  if (onRefund) {
                    onRefund(booking);
                  } else if (onCancel) {
                    onCancel(booking);
                  }
                }}
                className="text-xs gap-1.5 text-rose-600 border-rose-200 hover:text-rose-700 hover:bg-rose-50 font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Refund
              </Button>
            )}


          </div>

          <div className="flex items-center gap-2">
            {isOpenStatus && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenInPOS(booking);
                }}
                className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                Open in POS
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
