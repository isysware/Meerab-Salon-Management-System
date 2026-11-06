import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../context/RouterContext';
import { salonService, StaffDashboardData } from '../../services';
import { formatCurrency, formatNumber } from '../../lib/formatters';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScissorLoader } from '@/components/ui/ScissorLoader';
import {
  Scissors,
  Banknote,
  Coins,
  TrendingUp,
  Clock,
  RefreshCw,
  Building2,
  Lock,
  Award,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const StaffDashboard: React.FC = () => {
  const { user, demoDate } = useAuth();
  const { navigate } = useRouter();
  const [data, setData] = useState<StaffDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = async () => {
    if (!user) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (!user.staffId) {
        throw new Error('No employee profile is linked to this user account. Please contact your Salon Administrator.');
      }
      if (!user.branchId || user.branchId === 'ALL') {
        throw new Error('Staff accounts must belong to a specific branch. Mismatched branch scope detected.');
      }
      const res = await salonService.getStaffDashboardData(user.staffId, user.branchId);
      setData(res);
    } catch (err: any) {
      console.error('Failed to load Staff dashboard:', err);
      setErrorMessage(err.message || 'Failed to load personal staff performance data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user, demoDate]);

  if (isLoading) {
    return (
      <div className="py-24 flex items-center justify-center font-sans">
        <ScissorLoader size="lg" />
      </div>
    );
  }

  if (errorMessage || !data) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4 font-sans">
        <div className="p-6 rounded-[24px] bg-rose-50/80 border border-rose-200/80 text-rose-800 space-y-3 shadow-sm backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-rose-600" />
            <h3 className="font-semibold text-sm">Staff Portal Scope Error</h3>
          </div>
          <p className="text-xs leading-relaxed text-rose-700">
            {errorMessage || 'Unable to load staff portal. Invalid profile or branch scope.'}
          </p>
          <Button variant="outline" size="sm" onClick={loadData} className="rounded-xl">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const workProgressPercent = data.attendanceSummary.scheduledHoursWeek > 0
    ? Math.min(100, Math.round((data.attendanceSummary.workedHoursWeek / data.attendanceSummary.scheduledHoursWeek) * 100))
    : 0;

  return (
    <div className="space-y-6 font-sans">
      {/* ── HEADER & SCOPE BAR ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-white/80 shadow-2xs">
              Staff Personal Portal
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#78616C]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Isolated Personal Scope
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#18191B] mt-1">
            Welcome, {data.staffMember.name}
          </h1>
          <p className="text-xs text-[#78616C] mt-1 flex items-center gap-2">
            <span className="font-semibold text-slate-800">{data.staffMember.roleTitle}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1 text-slate-700">
              <Building2 className="w-3.5 h-3.5 text-[#B82E69]" />
              {data.branch.name}
            </span>
            <span>·</span>
            <span className="font-medium text-[#B82E69]">
              {(data.staffMember.commissionRate * 100).toFixed(0)}% Service Commission Rate
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={loadData}
            className="rounded-xl border-white/80 bg-white/70 shadow-2xs hover:bg-[#FDF2F5] hover:text-[#B82E69] hover:border-[#B82E69]/30 transition-all cursor-pointer"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* ── ROW 1: 4 HERO VELVET STAT CARDS ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Services Completed */}
        <div className="relative overflow-hidden rounded-[24px] p-5 text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group bg-gradient-to-br from-[#9D2558] via-[#851C47] to-[#6A1237]">
          {/* Watermark SVG */}
          <div className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none group-hover:scale-110 transition-transform duration-500">
            <Scissors className="w-full h-full stroke-[1.2]" />
          </div>
          <div className="relative z-10 flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Scissors className="w-4 h-4 transform -rotate-45" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              This Month
            </span>
          </div>
          <div className="relative z-10 mt-4">
            <div className="text-3xl font-extrabold tracking-tight font-mono text-white">
              {formatNumber(data.monthlyServicesCompletedCount)}
            </div>
            <p className="text-xs text-white/80 font-medium mt-1">Completed Client Services</p>
          </div>
        </div>

        {/* Card 2: Service Sales Production */}
        <div className="relative overflow-hidden rounded-[24px] p-5 text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group bg-gradient-to-br from-[#B3396D] via-[#9B2A5A] to-[#801D48]">
          {/* Watermark SVG */}
          <div className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none group-hover:scale-110 transition-transform duration-500">
            <Banknote className="w-full h-full stroke-[1.2]" />
          </div>
          <div className="relative z-10 flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Banknote className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              Net Value
            </span>
          </div>
          <div className="relative z-10 mt-4">
            <div className="text-3xl font-extrabold tracking-tight font-mono text-white">
              {formatCurrency(data.monthlyServiceSalesTotal)}
            </div>
            <p className="text-xs text-white/80 font-medium mt-1">Service Production Value</p>
          </div>
        </div>

        {/* Card 3: Earned Commission */}
        <div className="relative overflow-hidden rounded-[24px] p-5 text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group bg-gradient-to-br from-[#7E1A47] via-[#6B133A] to-[#550C2C]">
          {/* Watermark SVG */}
          <div className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none group-hover:scale-110 transition-transform duration-500">
            <TrendingUp className="w-full h-full stroke-[1.2]" />
          </div>
          <div className="relative z-10 flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              Tier: {(data.staffMember.commissionRate * 100).toFixed(0)}%
            </span>
          </div>
          <div className="relative z-10 mt-4">
            <div className="text-3xl font-extrabold tracking-tight font-mono text-white">
              {formatCurrency(data.earnedCommissionTotal)}
            </div>
            <p className="text-xs text-white/80 font-medium mt-1">Earned Service Commission</p>
          </div>
        </div>

        {/* Card 4: Direct Tips Received */}
        <div className="relative overflow-hidden rounded-[24px] p-5 text-white border border-white/20 shadow-sm transition-all duration-300 hover:shadow-md group bg-gradient-to-br from-[#A84B68] via-[#8F3B54] to-[#752B41]">
          {/* Watermark SVG */}
          <div className="absolute -right-3 -bottom-3 w-32 h-32 opacity-15 pointer-events-none group-hover:scale-110 transition-transform duration-500">
            <Coins className="w-full h-full stroke-[1.2]" />
          </div>
          <div className="relative z-10 flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 shadow-2xs">
              <Coins className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full border border-white/20">
              100% Segregated
            </span>
          </div>
          <div className="relative z-10 mt-4">
            <div className="text-3xl font-extrabold tracking-tight font-mono text-white">
              {formatCurrency(data.personalTipsTotal)}
            </div>
            <p className="text-xs text-white/80 font-medium mt-1">Direct Client Gratuities</p>
          </div>
        </div>
      </div>

      {/* ── 7 DAYS UPCOMING BOOKINGS & APPOINTMENTS ALERTS ───────────────── */}
      {data.pendingActions && data.pendingActions.length > 0 && (
        <div className="rounded-[24px] border border-[#F8D2DC]/80 bg-gradient-to-r from-rose-50/70 via-white/80 to-[#FDF2F5]/90 backdrop-blur-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-rose-100/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#B82E69] to-[#9D2558] text-white flex items-center justify-center shadow-2xs">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#18191B] tracking-tight">
                  Upcoming Bookings & Appointments (Next 7 Days)
                </h3>
                <p className="text-[11px] text-[#78616C]">
                  Scheduled events and appointments for your salon preparation
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#B82E69] text-white shadow-2xs">
              {data.pendingActions.length} Upcoming
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.pendingActions.map((alert: any) => (
              <div
                key={alert.id}
                onClick={() => navigate(alert.href)}
                className="p-3.5 rounded-2xl bg-white/90 border border-rose-100/80 shadow-2xs hover:shadow-xs hover:border-[#B82E69]/40 transition-all cursor-pointer flex flex-col justify-between gap-2 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#B82E69] block">
                      {alert.bookingNumber || alert.type}
                    </span>
                    <span className="text-xs font-bold text-[#18191B] truncate block mt-0.5">
                      {alert.title}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${
                      alert.urgency === 'high'
                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {alert.daysRemaining === 0 ? 'Today' : alert.daysRemaining === 1 ? 'Tomorrow' : `in ${alert.daysRemaining}d`}
                  </span>
                </div>
                <p className="text-[11px] text-[#78616C] line-clamp-2 leading-relaxed">
                  {alert.description}
                </p>
                <div className="flex items-center justify-end text-[11px] font-bold text-[#B82E69] group-hover:underline pt-1">
                  <span>View Details →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ROW 2: COMPENSATION BREAKDOWN & SHIFT ATTENDANCE ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Monthly Earnings Breakdown Card */}
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-black/5">
            <div>
              <h3 className="text-base font-bold text-[#18191B] tracking-tight">
                Monthly Compensation & Payout Breakdown
              </h3>
              <p className="text-xs text-[#78616C] mt-0.5">
                Contract base salary, service commission, direct tips and approved overtime
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border border-white/80 shadow-2xs">
              Contract Verified
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            {/* Base Salary */}
            <div className="p-3.5 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] text-[#78616C] block">Monthly Base Salary</span>
                <span className="font-bold text-[#18191B] font-mono tabular-nums text-sm">
                  {formatCurrency(data.monthlyEarningsSummary.baseSalary)}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium px-2 py-0.5 rounded-full bg-slate-100">
                Fixed Contract
              </span>
            </div>

            {/* Service Commission */}
            <div className="p-3.5 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] text-[#78616C] block">
                  Service Commission ({(data.staffMember.commissionRate * 100).toFixed(0)}%)
                </span>
                <span className="font-bold text-emerald-700 font-mono tabular-nums text-sm">
                  +{formatCurrency(data.monthlyEarningsSummary.earnedCommission)}
                </span>
              </div>
              <span className="text-[11px] text-emerald-700 font-semibold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
                Performance Pay
              </span>
            </div>

            {/* Direct Tips */}
            <div className="p-3.5 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] text-[#78616C] block">Direct Client Tips (Segregated)</span>
                <span className="font-bold text-purple-700 font-mono tabular-nums text-sm">
                  +{formatCurrency(data.monthlyEarningsSummary.directTips)}
                </span>
              </div>
              <span className="text-[11px] text-purple-700 font-semibold px-2 py-0.5 rounded-full bg-purple-50 border border-purple-100">
                100% Personal
              </span>
            </div>

            {/* Approved Overtime */}
            <div className="p-3.5 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] text-[#78616C] block">
                  Approved Overtime Pay ({formatCurrency(data.staffMember.overtimeHourlyRate)}/hr)
                </span>
                <span className="font-bold text-amber-800 font-mono tabular-nums text-sm">
                  +{formatCurrency(data.monthlyEarningsSummary.approvedOvertimePay)}
                </span>
              </div>
              <span className="text-[11px] text-amber-800 font-semibold px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100">
                Admin Approved
              </span>
            </div>

            {/* Total Estimated Gross Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-[#FDF2F5] via-[#FFF5F7] to-[#FCE8EC] border border-[#F8D2DC]/60 flex items-center justify-between shadow-xs mt-3">
              <div>
                <span className="text-[11px] text-[#9D2558] font-bold block uppercase tracking-wider">
                  Estimated Combined Monthly Earnings
                </span>
                <span className="text-xl font-extrabold text-[#18191B] font-mono tabular-nums mt-0.5 block">
                  {formatCurrency(data.monthlyEarningsSummary.estimatedGrossPayout)}
                </span>
                <p className="text-[10px] text-[#78616C] mt-1">
                  Base salary, commissions, gratuities & overtime follow separate audited payment disbursements.
                </p>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-[#B82E69]/10 border border-[#B82E69]/20 flex items-center justify-center shrink-0">
                <Award className="w-5 h-5 text-[#B82E69]" />
              </div>
            </div>
          </div>
        </div>

        {/* Shift Attendance & Punches Card */}
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-black/5">
            <div>
              <h3 className="text-base font-bold text-[#18191B] tracking-tight">
                My Shift & Attendance Record
              </h3>
              <p className="text-xs text-[#78616C] mt-0.5">
                Biometric punch log and approved overtime minutes
              </p>
            </div>
            {data.attendanceSummary.status === 'Not recorded' ? (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                Not Recorded
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Punch Verified
              </span>
            )}
          </div>

          <div className="space-y-3 text-xs">
            {/* Clock In Tile */}
            <div className="p-3.5 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] text-[#78616C] block">Today's Clock In</span>
                <span className="font-bold text-[#18191B] text-sm">
                  {data.attendanceSummary.todayCheckIn}
                </span>
              </div>
              {data.attendanceSummary.status === 'ON_TIME' ? (
                <span className="text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  On Time
                </span>
              ) : data.attendanceSummary.status === 'LATE' ? (
                <span className="text-amber-700 font-semibold bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                  Late
                </span>
              ) : (
                <span className="text-slate-500 font-medium bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                  Not recorded
                </span>
              )}
            </div>

            {/* Weekly Worked Hours with Progress Meter */}
            <div className="p-3.5 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/80 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-[#78616C] block">Weekly Hours Worked</span>
                  <span className="font-bold text-[#18191B] font-mono tabular-nums text-sm">
                    {data.attendanceSummary.workedHoursWeek} / {data.attendanceSummary.scheduledHoursWeek} hrs
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-[#B82E69]">
                  {workProgressPercent}% Complete
                </span>
              </div>
              {/* Progress Bar */}
              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#9D2558] to-[#B82E69] transition-all duration-500"
                  style={{ width: `${workProgressPercent}%` }}
                />
              </div>
            </div>

            {/* Approved Overtime Tile */}
            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/70 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] text-amber-800 block font-medium">Approved Overtime</span>
                <span className="font-bold text-amber-900 font-mono tabular-nums text-sm">
                  {data.attendanceSummary.approvedOvertimeMinutesMonth} minutes
                </span>
              </div>
              <span className="text-xs text-amber-800 bg-white/90 px-2.5 py-0.5 rounded-full border border-amber-200 font-semibold">
                Rate: {formatCurrency(data.staffMember.overtimeHourlyRate)}/hr
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-black/5 flex items-center justify-between text-xs">
            <span className="text-[#78616C]">View full biometric punches & leaves?</span>
            <button
              onClick={() => navigate('/my-attendance')}
              className="font-semibold text-[#B82E69] hover:text-[#A02358] transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>View My Attendance</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── ROW 3: PERSONAL SERVICE & COMMISSION ARCHIVE ───────────────────── */}
      <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] overflow-hidden">
        <div className="p-5 border-b border-black/5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#18191B] tracking-tight">
              Personal Service & Commission Archive
            </h3>
            <p className="text-xs text-[#78616C] mt-0.5">
              Itemized log of completed client treatments, commissions, and direct tips
            </p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#FAF8F9] text-[#78616C] border border-white/80 shadow-2xs">
            {data.recentCompletedServices.length} Recent Services
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="report-records w-full text-xs text-left">
            <thead className="bg-[#FAF8F9]/80 text-[#78616C] font-semibold text-[11px] uppercase tracking-wider border-b border-black/5">
              <tr>
                <th className="py-3 px-5">Date</th>
                <th className="py-3 px-4">Service Performed</th>
                <th className="py-3 px-4">Client Name</th>
                <th className="py-3 px-4 text-right">Service Price</th>
                <th className="py-3 px-4 text-right">Commission ({(data.staffMember.commissionRate * 100).toFixed(0)}%)</th>
                <th className="py-3 px-5 text-right">Tip Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 text-[#18191B]">
              {data.recentCompletedServices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#78616C]">
                    <Scissors className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-700">No services completed this period</p>
                    <p className="text-xs text-slate-400 mt-0.5">Completed POS checkout services will display here automatically.</p>
                  </td>
                </tr>
              ) : (
                data.recentCompletedServices.map((row) => (
                  <tr key={row.id} className="hover:bg-white/60 transition-colors">
                    <td className="py-3.5 px-5 text-[#78616C] font-mono text-[11px]">{row.date}</td>
                    <td className="py-3.5 px-4 font-bold text-[#18191B]">{row.serviceName}</td>
                    <td className="py-3.5 px-4 text-[#78616C] font-medium">{row.clientName || 'Walk-in Client'}</td>
                    <td className="py-3.5 px-4 text-right font-semibold text-[#18191B] font-mono tabular-nums">
                      {formatCurrency(row.servicePrice)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-emerald-700 font-mono tabular-nums">
                      +{formatCurrency(row.commissionEarned)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-bold text-purple-700 font-mono tabular-nums">
                      {row.tipReceived > 0 ? `+${formatCurrency(row.tipReceived)}` : 'PKR 0.00'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
