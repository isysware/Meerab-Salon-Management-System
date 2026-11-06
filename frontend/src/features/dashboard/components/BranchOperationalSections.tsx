import React, { useState, useMemo, useEffect } from 'react';
import { BranchFinancialMetrics } from '../../../services/salonService';
import { salonService } from '../../../services';
import { Appointment, Invoice, OnlineAccount, CashDrawer } from '../../../types/salon';
import { Booking } from '../../../types/booking';
import { formatCurrency, formatNumber } from '../../../lib/formatters';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Users,
  Calendar,
  Scissors,
  Sparkles,
  ArrowRight,
  Wallet,
  Landmark,
  Receipt,
  Plus,
} from 'lucide-react';

interface BranchOperationalSectionsProps {
  branchId?: string;
  metrics: BranchFinancialMetrics;
  onlineAccounts: OnlineAccount[];
  todayAppointments: Appointment[];
  recentInvoices: Invoice[];
  cashDrawers: CashDrawer[];
  totalClientsCount?: number;
  totalServicesCount?: number;
  totalAppointmentsCount?: number;
  staffList?: Array<{ id: string; name: string; roleTitle: string }>;
  revenueTrend?: Array<{ label: string; revenue: number; expenses: number; collections: number }>;
  categoryBreakdown?: Array<{ type: string; count: number; revenue: number }>;
  onNavigateAppointments?: () => void;
  onNavigateBookings?: () => void;
  onNavigateInvoices?: () => void;
  onNavigateAccounts?: () => void;
  onNavigateSettlement?: () => void;
}

export const BranchOperationalSections: React.FC<BranchOperationalSectionsProps> = ({
  branchId,
  metrics,
  onlineAccounts,
  todayAppointments,
  totalClientsCount = 0,
  totalServicesCount = 0,
  totalAppointmentsCount = 0,
  staffList = [],
  onNavigateAppointments,
  onNavigateBookings,
  onNavigateInvoices,
  onNavigateAccounts,
  onNavigateSettlement,
}) => {
  // Day Schedule filter staff
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');

  // Schedule Widget (Bookings vs Appointments)
  const [scheduleMode, setScheduleMode] = useState<'BOOKINGS' | 'APPOINTMENTS'>('BOOKINGS');
  const [selectedDateIdx, setSelectedDateIdx] = useState<number>(0);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>(todayAppointments || []);

  const fiveDays = useMemo(() => {
    const list = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;
      const dayName = d.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();
      const dayNum = String(d.getDate()).padStart(2, '0');
      list.push({ date: d, dateStr, dayName, dayNum, isToday: i === 0 });
    }
    return list;
  }, []);

  const selectedDay = fiveDays[selectedDateIdx] || fiveDays[0];

  useEffect(() => {
    let active = true;
    const startDate = fiveDays[0].dateStr;
    const endDate = fiveDays[fiveDays.length - 1].dateStr;
    const effectiveBranchId = branchId && branchId !== 'ALL' ? branchId : undefined;

    Promise.all([
      salonService
        .getBookings({
          branchId: effectiveBranchId,
          startDate,
          endDate,
        })
        .catch(() => []),
      salonService
        .getAppointments(effectiveBranchId || 'ALL', { startDate, endDate })
        .catch(() => todayAppointments || []),
    ])
      .then(([bookingsData, appointmentsData]) => {
        if (active) {
          setAllBookings(Array.isArray(bookingsData) ? bookingsData : []);
          if (Array.isArray(appointmentsData) && appointmentsData.length > 0) {
            setAllAppointments(appointmentsData);
          } else {
            setAllAppointments(todayAppointments || []);
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [branchId, fiveDays, todayAppointments]);

  const displayedBookings = useMemo(() => {
    return allBookings.filter((b) => b.eventDate?.split('T')[0] === selectedDay.dateStr);
  }, [allBookings, selectedDay.dateStr]);

  const displayedAppointments = useMemo(() => {
    return allAppointments.filter((a) => a.date?.split('T')[0] === selectedDay.dateStr);
  }, [allAppointments, selectedDay.dateStr]);

  // Timeline slots for Day Schedule
  const timeSlots = [
    '09:00 AM',
    '10:00 AM',
    '11:00 AM',
    '12:00 PM',
    '01:00 PM',
    '02:00 PM',
    '03:00 PM',
    '04:00 PM',
    '05:00 PM',
  ];

  // Stylists for Day Schedule columns
  const activeStylists = useMemo(() => {
    if (staffList.length > 0) return staffList.slice(0, 6);
    const staffNames = Array.from(new Set(todayAppointments.map((a) => a.staffName).filter(Boolean)));
    if (staffNames.length > 0) {
      return staffNames.map((name, i) => ({ id: `s-${i}`, name: name as string, roleTitle: 'Stylist' }));
    }
    return [];
  }, [staffList, todayAppointments]);

  // Filtered appointments for timeline
  const filteredAppointments = useMemo(() => {
    if (selectedStaffId === 'ALL') return todayAppointments;
    return todayAppointments.filter((a) => a.staffId === selectedStaffId || a.staffName === selectedStaffId);
  }, [todayAppointments, selectedStaffId]);

  return (
    <div className="space-y-6 font-sans">
      {/* ── 1. TOP OVERVIEW: 4 VIBRANT HIGH-IMPACT GRADIENT METRIC CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Clients (Deep Berry Velvet Gradient) */}
        <div className="relative overflow-hidden rounded-[24px] p-5 bg-gradient-to-br from-[#9D2558] via-[#851C47] to-[#6A1237] text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group">
          {/* Stylized Clients / Users Silhouette Watermark */}
          <svg
            className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none transition-transform duration-500 group-hover:scale-110"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>

          <div className="relative z-10 flex items-start justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Users className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              Clients
            </span>
          </div>

          <div className="relative z-10 mt-4">
            <h3 className="text-3xl font-extrabold tracking-tight font-mono">
              {formatNumber(totalClientsCount ?? 0)}
            </h3>
            <p className="text-xs text-white/80 font-medium mt-1">Total Registered Clients</p>
          </div>
        </div>

        {/* Card 2: Total Appointments (Rose Plum Gradient) */}
        <div className="relative overflow-hidden rounded-[24px] p-5 bg-gradient-to-br from-[#B3396D] via-[#9B2A5A] to-[#801D48] text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group">
          {/* Stylized Calendar / Appointments Schedule Watermark */}
          <svg
            className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none -rotate-6 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="4" rx="3" />
            <line x1="16" x2="16" y1="2" y2="6" strokeWidth="2" />
            <line x1="8" x2="8" y1="2" y2="6" strokeWidth="2" />
            <line x1="3" x2="21" y1="10" y2="10" strokeWidth="1.5" />
            <path d="m9 16 2 2 4-4" strokeWidth="2" />
          </svg>

          <div className="relative z-10 flex items-start justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Calendar className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              Bookings
            </span>
          </div>

          <div className="relative z-10 mt-4">
            <h3 className="text-3xl font-extrabold tracking-tight font-mono">
              {formatNumber(totalAppointmentsCount ?? (todayAppointments ? todayAppointments.length : 0))}
            </h3>
            <p className="text-xs text-white/80 font-medium mt-1">Total Appointments</p>
          </div>
        </div>

        {/* Card 3: Total Services (Rich Burgundy Velvet Gradient) */}
        <div className="relative overflow-hidden rounded-[24px] p-5 bg-gradient-to-br from-[#7E1A47] via-[#6B133A] to-[#550C2C] text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group">
          {/* Stylized Salon Scissors Watermark */}
          <svg
            className="absolute -right-2 -bottom-2 w-36 h-36 opacity-20 pointer-events-none rotate-45 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="6" cy="6" r="3.2" />
            <circle cx="6" cy="18" r="3.2" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" strokeWidth="2" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" strokeWidth="2" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" strokeWidth="2" />
          </svg>

          <div className="relative z-10 flex items-start justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Scissors className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              Services
            </span>
          </div>

          <div className="relative z-10 mt-4">
            <h3 className="text-3xl font-extrabold tracking-tight font-mono">
              {formatNumber(totalServicesCount ?? 0)}
            </h3>
            <p className="text-xs text-white/80 font-medium mt-1">Active Catalogue Services</p>
          </div>
        </div>

        {/* Card 4: Collections & Revenue (Blush Wine Gradient) */}
        <div className="relative overflow-hidden rounded-[24px] p-5 bg-gradient-to-br from-[#A84B68] via-[#8F3B54] to-[#752B41] text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group">
          {/* Stylized Cash Banknote / Collections Watermark */}
          <svg
            className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none -rotate-12 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="20" height="12" x="2" y="6" rx="2" />
            <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
            <path d="M6 12h.01M18 12h.01" strokeWidth="2.5" />
          </svg>

          <div className="relative z-10 flex items-start justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              Collections
            </span>
          </div>

          <div className="relative z-10 mt-4">
            <h3 className="text-2xl lg:text-3xl font-extrabold tracking-tight font-mono">
              {formatCurrency(metrics.collectedRevenue ?? 0)}
            </h3>
            <p className="text-xs text-white/80 font-medium mt-1">Collected Revenue Today (excl. tax & tips)</p>
          </div>
        </div>
      </div>

      {/* ── 2. MIDDLE ROW: DAY SCHEDULE TIMELINE (8 COLS) + BOOKINGS/APPOINTMENTS (4 COLS) (MATCHING SCREENSHOT 2) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Day Schedule Timeline Matrix (8 cols) */}
        <div className="lg:col-span-12 xl:col-span-8">
          <Card variant="glass" padding="none" className="p-6 overflow-hidden relative group rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white">
            <div className="absolute -top-12 -right-12 w-64 h-64 bg-gradient-to-br from-[#B82E69]/10 via-[#FCE8EC]/20 to-transparent rounded-full blur-3xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />

            {/* Header */}
            <div className="relative z-10 flex items-center justify-between flex-wrap gap-2 pb-3 border-0">
              <div>
                <h3 className="text-base font-semibold text-[#18191B] tracking-tight">Day Schedule Timeline</h3>
                <p className="text-xs text-slate-400 mt-0.5">Live appointments and assigned stylist booking lane</p>
              </div>

              {onNavigateAppointments && (
                <button
                  type="button"
                  onClick={onNavigateAppointments}
                  className="text-xs font-semibold text-[#B82E69] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  Full Agenda
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Stylist Filter Selector Pills */}
            <div className="py-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none border-0">
              <span className="text-[11px] font-semibold text-[#78616C] uppercase tracking-wider mr-1 shrink-0">
                Stylist:
              </span>
              <button
                type="button"
                onClick={() => setSelectedStaffId('ALL')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer border-0 ${
                  selectedStaffId === 'ALL'
                    ? 'bg-[#B82E69] text-white shadow-2xs font-bold'
                    : 'bg-white/70 text-[#78616C] shadow-2xs hover:bg-[#FDF2F5]'
                }`}
              >
                All Staff
              </button>
              {activeStylists.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStaffId(st.name)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-0 ${
                    selectedStaffId === st.name
                      ? 'bg-[#B82E69] text-white shadow-2xs font-bold'
                      : 'bg-white/70 text-[#78616C] shadow-2xs hover:bg-[#FDF2F5]'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                  <span>{st.name}</span>
                </button>
              ))}
            </div>

            {/* Timeline Matrix */}
            <div className="pt-2 max-h-[440px] overflow-y-auto space-y-2.5 divide-y-0 pr-1">
              {timeSlots.map((time) => {
                const matchedApts = filteredAppointments.filter((a) => {
                  if (!a.startTime) return false;
                  return a.startTime.includes(time.slice(0, 2)) || a.time?.includes(time.slice(0, 2));
                });

                return (
                  <div key={time} className="pt-1.5 first:pt-0 flex items-start gap-4">
                    <div className="w-16 shrink-0 text-xs font-mono font-semibold text-[#78616C] pt-1">
                      {time}
                    </div>

                    <div className="flex-1 min-w-0">
                      {matchedApts.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {matchedApts.map((apt) => (
                            <div
                              key={apt.id}
                              onClick={onNavigateAppointments}
                              className="p-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 hover:bg-white shadow-[0_2px_12px_rgba(35,21,29,0.025)] hover:shadow-[0_4px_18px_rgba(184,46,105,0.08)] transition-all cursor-pointer group space-y-1"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-semibold text-xs text-[#18191B] group-hover:text-[#B82E69] truncate">
                                  {apt.serviceName || apt.items?.[0]?.name || 'Salon Service'}
                                </span>
                                <span className="text-[11px] font-mono font-bold text-[#B82E69]">
                                  {formatCurrency(apt.price || 0)}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-[#78616C]">
                                <span className="truncate">{apt.clientName || 'Walk-in'}</span>
                                <span className="text-[#A38D98] font-mono text-[10px]">
                                  {apt.staffName ? `• ${apt.staffName}` : ''}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-8 rounded-xl border border-white/60 flex items-center justify-between px-3 text-[11px] text-[#A38D98] bg-white/50 backdrop-blur-sm shadow-2xs">
                          <span>Available slot</span>
                          <span className="text-[10px] text-[#CBB5BD]">Open</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* 5-Day Booking Calendar Strip & Queue (4 cols) (Exact match to Screenshot 2) */}
        <div className="lg:col-span-12 xl:col-span-4">
          <Card variant="glass" padding="none" className="p-6 space-y-4 relative overflow-hidden group rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white">
            <div className="absolute -top-10 -right-10 w-52 h-52 bg-gradient-to-br from-[#B82E69]/10 via-[#FCE8EC]/20 to-transparent rounded-full blur-3xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />
            <div className="relative z-10 flex items-center justify-between border-0 pb-1">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#FDF2F5] border-0 shadow-inner">
                <button
                  type="button"
                  onClick={() => setScheduleMode('BOOKINGS')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border-0 ${
                    scheduleMode === 'BOOKINGS'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-[#78616C] hover:text-[#B82E69]'
                  }`}
                >
                  Bookings
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode('APPOINTMENTS')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border-0 ${
                    scheduleMode === 'APPOINTMENTS'
                      ? 'bg-white text-[#B82E69] shadow-2xs'
                      : 'text-[#78616C] hover:text-[#B82E69]'
                  }`}
                >
                  Appointments
                </button>
              </div>

              <span className="text-xs font-semibold text-[#78616C]">
                {selectedDay.dayName}, {selectedDay.dayNum}
              </span>
            </div>

            {/* 5-day picker */}
            <div className="p-1.5 rounded-2xl bg-[#FDF2F5] border-0 shadow-inner grid grid-cols-5 gap-1 text-center">
              {fiveDays.map((item, i) => {
                const isSelected = selectedDateIdx === i;
                const bCount = allBookings.filter((b) => b.eventDate?.split('T')[0] === item.dateStr).length;
                const aCount = allAppointments.filter((a) => a.date?.split('T')[0] === item.dateStr).length;
                const count = scheduleMode === 'BOOKINGS' ? bCount : aCount;

                return (
                  <button
                    key={item.dateStr}
                    type="button"
                    onClick={() => setSelectedDateIdx(i)}
                    className={`py-2 px-1 rounded-xl transition-all cursor-pointer flex flex-col items-center justify-center border-0 ${
                      isSelected
                        ? 'bg-white text-[#B82E69] shadow-xs font-bold'
                        : 'text-[#78616C] hover:text-[#B82E69]'
                    }`}
                  >
                    <span className="text-[10px] block uppercase font-bold leading-tight">
                      {item.dayName}
                    </span>
                    <span className="text-xs font-mono font-bold leading-tight mt-0.5">
                      {item.dayNum}
                    </span>
                    {count > 0 && (
                      <span className={`w-1.5 h-1.5 rounded-full mt-1 ${isSelected ? 'bg-[#B82E69]' : 'bg-[#D44A85]'}`} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* List for Selected Day (Matches Screenshot 2) */}
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-0.5">
              {scheduleMode === 'BOOKINGS' ? (
                displayedBookings.length === 0 ? (
                  <div className="py-8 text-center space-y-2 bg-white/50 backdrop-blur-sm rounded-2xl border border-white/60 p-4 shadow-2xs">
                    <Sparkles className="w-6 h-6 text-[#B82E69]/40 mx-auto" />
                    <p className="text-xs font-semibold text-[#23151D]">No bookings on this date</p>
                    {onNavigateBookings && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onNavigateBookings}
                        className="text-xs h-7 rounded-xl mt-1 border-0 bg-white/80 hover:bg-white text-[#B82E69] shadow-2xs"
                      >
                        <Plus className="w-3 h-3" /> New Booking
                      </Button>
                    )}
                  </div>
                ) : (
                  displayedBookings.slice(0, 5).map((b) => {
                    const isCompleted = b.status === 'COMPLETED' && (!b.remainingBalance || b.remainingBalance <= 0);
                    const isInService = b.status === 'IN_PROGRESS' || (Boolean(b.linkedInvoiceId) && Boolean(b.remainingBalance && b.remainingBalance > 0));
                    const statusLabel = isCompleted
                      ? 'COMPLETED'
                      : isInService
                      ? 'IN SERVICE'
                      : b.status === 'CANCELLED'
                      ? 'CANCELLED'
                      : b.status === 'NO_SHOW'
                      ? 'NO SHOW'
                      : 'CONFIRMED';
                    const statusColor = isCompleted
                      ? 'text-emerald-600'
                      : isInService
                      ? 'text-amber-600'
                      : b.status === 'CANCELLED'
                      ? 'text-rose-600'
                      : b.status === 'NO_SHOW'
                      ? 'text-slate-600'
                      : 'text-[#B82E69]';

                    return (
                      <div
                        key={b.id}
                        onClick={onNavigateBookings}
                        className="p-3.5 rounded-2xl border border-white/80 bg-white/80 backdrop-blur-xl hover:bg-white transition-all flex items-center justify-between gap-2 cursor-pointer shadow-[0_2px_10px_rgba(35,21,29,0.025)] hover:shadow-[0_4px_16px_rgba(184,46,105,0.08)]"
                      >
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-[#18191B] truncate">{b.clientName}</h4>
                          <p className="text-[10px] text-[#78616C] truncate">
                            {b.serviceTime || '01:00 PM'} • {b.assignedStaffName || 'Stylist'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-bold text-slate-900 block">
                            {formatCurrency(b.totalAmount || 0)}
                          </span>
                          <span className={`text-[9px] font-semibold uppercase ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                displayedAppointments.length === 0 ? (
                  <div className="py-8 text-center space-y-2 bg-white/50 backdrop-blur-sm rounded-2xl border border-white/60 p-4 shadow-2xs">
                    <Calendar className="w-6 h-6 text-[#B82E69]/40 mx-auto" />
                    <p className="text-xs font-semibold text-[#23151D]">No scheduled appointments</p>
                  </div>
                ) : (
                  displayedAppointments.slice(0, 5).map((apt) => (
                    <div
                      key={apt.id}
                      onClick={onNavigateAppointments}
                      className="p-3.5 rounded-2xl border border-white/80 bg-white/80 backdrop-blur-xl hover:bg-white transition-all flex items-center justify-between gap-2 cursor-pointer shadow-[0_2px_10px_rgba(35,21,29,0.025)] hover:shadow-[0_4px_16px_rgba(184,46,105,0.08)]"
                    >
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-[#18191B] truncate">{apt.clientName || 'Walk-in'}</h4>
                        <p className="text-[10px] text-[#78616C] truncate">
                          {apt.startTime || '01:00 PM'} • {apt.staffName || 'Stylist'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-bold text-slate-900 block">
                          {formatCurrency(apt.price || 0)}
                        </span>
                        <span className={`text-[9px] font-semibold uppercase ${
                          apt.status === 'COMPLETED'
                            ? 'text-emerald-600'
                            : apt.status === 'IN_PROGRESS'
                            ? 'text-amber-600'
                            : apt.status === 'CANCELLED'
                            ? 'text-rose-600'
                            : apt.status === 'NO_SHOW'
                            ? 'text-slate-600'
                            : 'text-[#B82E69]'
                        }`}>
                          {apt.status === 'IN_PROGRESS' ? 'IN SERVICE' : (apt.status || 'CONFIRMED')}
                        </span>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── 3. BOTTOM SECTION: FINANCIAL CUSTODY & DRAWER TILLS (CLEAN WHITE FROSTED BLUR KPI CARDS) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-1">
        {/* Physical Cash Drawer */}
        <Card variant="glass" padding="none" className="p-5 sm:p-6 space-y-2 relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 group rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white">
          <div className="relative z-10 flex items-center justify-between">
            <span className="text-xs font-bold text-[#18191B] flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs text-[#18191B] flex items-center justify-center border border-white/80">
                <Wallet className="w-4 h-4 text-[#B82E69]" />
              </div>
              Counter Cash Drawer
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60">
              Active Till
            </span>
          </div>
          <div className="relative z-10 pt-1">
            <p className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight">
              {formatCurrency(metrics.cashInCustody)}
            </p>
          </div>
          <div className="relative z-10 flex items-center justify-between text-xs text-[#78616C] pt-2 border-0">
            <span>Collected today:</span>
            <span className="font-semibold text-slate-800 font-mono">{formatCurrency(metrics.cashCollected)}</span>
          </div>
          {onNavigateSettlement && (
            <button
              type="button"
              onClick={onNavigateSettlement}
              className="relative z-10 text-xs font-semibold text-[#B82E69] hover:underline flex items-center gap-1 pt-1 cursor-pointer"
            >
              Transfer & Settle Cash <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </Card>

        {/* Online Bank Accounts */}
        <Card variant="glass" padding="none" className="p-5 sm:p-6 space-y-2 relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 group rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white">
          <div className="relative z-10 flex items-center justify-between">
            <span className="text-xs font-bold text-[#18191B] flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs text-[#18191B] flex items-center justify-center border border-white/80">
                <Landmark className="w-4 h-4 text-[#B82E69]" />
              </div>
              Bank & Digital Accounts
            </span>
            <span className="text-[11px] text-[#78616C] font-semibold px-2 py-0.5 rounded-full bg-[#FAF8F9] shadow-2xs border border-white/60">
              {onlineAccounts.length} account{onlineAccounts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="relative z-10 pt-1">
            <p className="text-2xl sm:text-3xl font-extrabold text-[#18191B] font-mono tabular-nums tracking-tight">
              {formatCurrency(metrics.onlineBalancesTotal)}
            </p>
          </div>
          <div className="relative z-10 flex items-center justify-between text-xs text-[#78616C] pt-2 border-0">
            <span>Digital received today:</span>
            <span className="font-semibold text-slate-800 font-mono">{formatCurrency(metrics.onlineCollected)}</span>
          </div>
          {onNavigateAccounts && (
            <button
              type="button"
              onClick={onNavigateAccounts}
              className="relative z-10 text-xs font-semibold text-[#B82E69] hover:underline flex items-center gap-1 pt-1 cursor-pointer"
            >
              Account Statements <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </Card>

        {/* Outstanding Receivables */}
        <Card variant="glass" padding="none" className="p-5 sm:p-6 space-y-2 relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 group rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] hover:border-white">

          <div className="relative z-10 flex items-center justify-between">
            <span className="text-xs font-bold text-[#18191B] flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white/90 shadow-2xs text-[#18191B] flex items-center justify-center border border-white/80">
                <Receipt className="w-4 h-4 text-[#B82E69]" />
              </div>
              Outstanding Receivables
            </span>
            {metrics.outstandingReceivables > 0 && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] shadow-2xs border border-white/60">
                Pending
              </span>
            )}
          </div>
          <div className="relative z-10 pt-1">
            <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight text-[#18191B]">
              {formatCurrency(metrics.outstandingReceivables)}
            </p>
          </div>
          <div className="relative z-10 flex items-center justify-between text-xs text-[#78616C] pt-2 border-0">
            <span>Total discounts granted:</span>
            <span className="font-semibold text-slate-800 font-mono">{formatCurrency(metrics.totalDiscounts)}</span>
          </div>
          {onNavigateInvoices && (
            <button
              type="button"
              onClick={onNavigateInvoices}
              className="relative z-10 text-xs font-semibold text-[#B82E69] hover:underline flex items-center gap-1 pt-1 cursor-pointer"
            >
              Inspect Invoices & Inflows <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </Card>
      </div>
    </div>
  );
};
