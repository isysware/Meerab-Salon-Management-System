import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../context/RouterContext';
import { salonService } from '../../services';
import { AttendancePolicyConfig, Branch } from '../../types/salon';
import { AccessDeniedView } from '../scaffold/AccessDeniedView';
import { toast } from '../../context/ToastContext';
import {
  Clock,
  ClockAlert,
  Save,
  CheckCircle2,
  AlertCircle,
  Building2,
  Sliders,
  Sparkles,
  Info,
  CalendarCheck,
  ShieldCheck,
  ArrowRight,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';

const THRESHOLD_PRESETS = [
  { value: 30, label: '30 Mins (Half Hour)' },
  { value: 45, label: '45 Mins' },
  { value: 60, label: '60 Mins (1 Hour - Recommended)' },
  { value: 90, label: '90 Mins (1.5 Hours)' },
  { value: 120, label: '120 Mins (2 Hours)' },
];

export const AttendanceSettingsPage: React.FC = () => {
  const { user, activeBranchId, allBranches } = useAuth();
  const { navigate } = useRouter();

  // Role guard: Only Super Admin and Admin
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return <AccessDeniedView attemptedPath="/admin/attendance-settings" />;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  // Branch Selection
  const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
    if (isSuperAdmin) {
      return '';
    }
    return user.branchId || '';
  });

  const effectiveBranchId = isSuperAdmin ? selectedBranchId : (user.branchId || activeBranchId);
  const currentBranch = allBranches.find((b) => b.id === effectiveBranchId) || allBranches[0];

  // Loading & Saving states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Policy Form State
  const [autoMarkAbsentEnabled, setAutoMarkAbsentEnabled] = useState<boolean>(true);
  const [thresholdMinutes, setThresholdMinutes] = useState<number>(60);
  const [defaultStartTime, setDefaultStartTime] = useState<string>('09:00');
  const [defaultEndTime, setDefaultEndTime] = useState<string>('18:00');
  const [lateGraceMinutes, setLateGraceMinutes] = useState<number>(15);
  const [earlyGraceMinutes, setEarlyGraceMinutes] = useState<number>(15);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Load Policy
  const loadPolicy = async (bId: string) => {
    if (!bId) return;
    try {
      setIsLoading(true);
      const policy = await salonService.getAttendancePolicy(bId);
      setAutoMarkAbsentEnabled(policy.autoMarkAbsentEnabled ?? true);
      setThresholdMinutes(policy.autoAbsentThresholdMinutes ?? 60);
      setDefaultStartTime(policy.defaultStartTime || '09:00');
      setDefaultEndTime(policy.defaultEndTime || '18:00');
      setLateGraceMinutes(policy.lateGraceMinutes ?? 15);
      setEarlyGraceMinutes(policy.earlyGraceMinutes ?? 15);
      setLastUpdated(policy.updatedAt || null);
    } catch (err: any) {
      console.error('Failed to load attendance policy:', err);
      toast.error(err.message || 'Failed to load attendance policy.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveBranchId) {
      loadPolicy(effectiveBranchId);
    }
  }, [effectiveBranchId]);

  // Save Policy
  const handleSavePolicy = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!effectiveBranchId) return;

    try {
      setIsSaving(true);
      const payload: Partial<AttendancePolicyConfig> = {
        branchId: effectiveBranchId,
        autoMarkAbsentEnabled,
        autoAbsentThresholdMinutes: Number(thresholdMinutes) || 60,
        defaultStartTime,
        defaultEndTime,
        lateGraceMinutes: Number(lateGraceMinutes) || 15,
        earlyGraceMinutes: Number(earlyGraceMinutes) || 15,
      };

      const res = await salonService.updateAttendancePolicy(effectiveBranchId, payload, user);
      toast.success('Attendance and shift settings saved successfully!');
      setLastUpdated(res.updatedAt || new Date().toISOString());
    } catch (err: any) {
      console.error('Failed to update attendance policy:', err);
      toast.error(err.message || 'Failed to save attendance policy.');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate cutoff preview time
  const calculatedCutoffTime = useMemo(() => {
    const [hStr, mStr] = defaultStartTime.split(':');
    const startMins = (parseInt(hStr, 10) || 9) * 60 + (parseInt(mStr, 10) || 0);
    const cutoffMins = startMins + (Number(thresholdMinutes) || 60);
    const cutH = Math.floor(cutoffMins / 60) % 24;
    const cutM = cutoffMins % 60;
    const period = cutH >= 12 ? 'PM' : 'AM';
    const displayH = cutH % 12 === 0 ? 12 : cutH % 12;
    return `${String(displayH).padStart(2, '0')}:${String(cutM).padStart(2, '0')} ${period}`;
  }, [defaultStartTime, thresholdMinutes]);

  const displayStartFormatted = useMemo(() => {
    const [hStr, mStr] = defaultStartTime.split(':');
    const h = parseInt(hStr, 10) || 9;
    const m = parseInt(mStr, 10) || 0;
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }, [defaultStartTime]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 font-sans">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FDF2F5] to-white border border-white/80 shadow-2xs flex items-center justify-center text-[#B82E69] shrink-0">
              <ClockAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[#18191B] tracking-tight truncate">
                Attendance Settings
              </h1>
              <p className="text-xs text-[#78616C] font-medium mt-0.5 line-clamp-1 xl:line-clamp-none">
                Configure shift start cutoffs, auto-marking absent thresholds, and grace periods for staff attendance.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          {isSuperAdmin && (
            <div className="flex items-center gap-2 bg-white/70 px-3 py-1.5 rounded-xl border border-white/80 shadow-2xs">
              <Building2 className="w-4 h-4 text-[#B82E69]" />
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="text-xs font-semibold text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer"
              >
                <option value="">Select branch to configure</option>
                {allBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/operations/attendance')}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
          >
            <CalendarCheck className="w-3.5 h-3.5 text-[#B82E69]" />
            <span>Daily Attendance Sheet</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/branch-settings')}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 hover:bg-white text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Branch Settings</span>
          </button>
        </div>
      </div>

      {/* Overview Information Box */}
      <div className="bg-[#FDF2F5]/80 p-5 rounded-2xl border border-[#B82E69]/15 flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="p-2.5 bg-[#B82E69] text-white rounded-xl shrink-0 mt-0.5 shadow-xs">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="space-y-1.5 text-xs">
          <h3 className="font-bold text-[#18191B] text-sm">
            Auto-Mark Absent Rule (By-Default Absent on Lateness)
          </h3>
          <p className="text-[#78616C] leading-relaxed">
            If a staff member does not check in within the configured threshold after shift start,
            the system automatically designates their attendance as <strong className="text-[#18191B]">'ABSENT'</strong>.
          </p>
          <p className="text-[#A38D98] italic">
            * Note: Administrators can manually adjust check-in times and statuses anytime on the attendance sheet.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-16 text-center space-y-3 shadow-xs">
          <div className="w-10 h-10 border-3 border-[#B82E69] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#78616C] font-medium">Loading attendance policy...</p>
        </div>
      ) : (
        <form onSubmit={handleSavePolicy} className="space-y-6">
          {/* Card 1: Auto-Mark Absent Rule */}
          <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-6 sm:p-7 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-black/5">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-[#18191B] flex items-center gap-2">
                  <span>Shift Cutoff & Auto-Absent Setting</span>
                  <span
                    className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${
                      autoMarkAbsentEnabled
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {autoMarkAbsentEnabled ? 'Rule Active' : 'Rule Inactive'}
                  </span>
                </h2>
                <p className="text-xs text-[#78616C]">
                  Automatically mark staff as Absent if they do not punch in within threshold minutes after shift start.
                </p>
              </div>

              {/* Toggle Switch */}
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoMarkAbsentEnabled}
                  onChange={(e) => setAutoMarkAbsentEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#B82E69]" />
                <span className="ml-3 text-xs font-semibold text-[#18191B]">
                  {autoMarkAbsentEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            {/* Threshold Selector */}
            <div className={`space-y-4 transition-opacity ${autoMarkAbsentEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="block text-xs font-semibold text-[#18191B] mb-1.5">
                  Grace / Cutoff Threshold Before Auto-Absent <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {THRESHOLD_PRESETS.map((p) => {
                    const isSelected = thresholdMinutes === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setThresholdMinutes(p.value)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#B82E69] text-white shadow-[0_4px_16px_rgba(184,46,105,0.22)]'
                            : 'bg-white/70 hover:bg-white text-[#78616C] border border-white/80'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 max-w-xs">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min={10}
                      max={360}
                      value={thresholdMinutes}
                      onChange={(e) => setThresholdMinutes(Math.max(10, parseInt(e.target.value, 10) || 60))}
                      className="w-full text-xs pr-16 pl-3 py-2 bg-white/70 border border-white/80 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#B82E69]/20 font-semibold text-[#18191B]"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-xs text-[#78616C] font-medium">
                      Minutes
                    </div>
                  </div>
                  <span className="text-xs text-[#78616C]">
                    ({(thresholdMinutes / 60).toFixed(1)} hrs)
                  </span>
                </div>
              </div>

              {/* Dynamic Live Demonstration Box */}
              <div className="bg-[#FAF8F9]/80 p-4 rounded-2xl border border-white/80 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#18191B]">
                  <Info className="w-4 h-4 text-[#B82E69]" />
                  <span>Rule in Action (Example Preview):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                  <div className="bg-white/90 p-3 rounded-xl border border-white/80">
                    <span className="text-[11px] text-[#78616C] block">Shift Start Time:</span>
                    <span className="font-bold text-[#18191B] text-sm">{displayStartFormatted}</span>
                  </div>
                  <div className="bg-white/90 p-3 rounded-xl border border-white/80">
                    <span className="text-[11px] text-[#78616C] block">Threshold:</span>
                    <span className="font-bold text-[#B82E69] text-sm">+{thresholdMinutes} Minutes</span>
                  </div>
                  <div className="bg-white/90 p-3 rounded-xl border border-white/80">
                    <span className="text-[11px] text-[#78616C] block">Auto-Absent Cutoff:</span>
                    <span className="font-bold text-rose-700 text-sm">{calculatedCutoffTime}</span>
                  </div>
                </div>
                <p className="text-[11px] text-[#78616C] pt-1">
                  Agar staff <strong>{calculatedCutoffTime}</strong> tak check-in nahi karta, toh attendance sheet par uska status automatically <strong className="text-rose-700">'ABSENT'</strong> select ho jayega.
                </p>
              </div>
            </div>
          </div>

          {/* Card 2: Shift Default Timings & Lateness Grace */}
          <div className="rounded-[24px] border border-white/90 bg-white/75 backdrop-blur-2xl p-6 sm:p-7 shadow-[0_10px_35px_rgba(35,21,29,0.035),inset_0_1.5px_2px_rgba(255,255,255,1)] space-y-4">
            <h2 className="text-base font-bold text-[#18191B] pb-2 border-b border-black/5">
              Shift Timings & Grace Periods (Branch Standards)
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-1">
              {/* Default Start */}
              <div>
                <label className="block text-xs font-semibold text-[#18191B] mb-1.5">
                  Default Shift Start
                </label>
                <div className="relative">
                  <input
                    type="time"
                    value={defaultStartTime}
                    onChange={(e) => setDefaultStartTime(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white/70 border border-white/80 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#B82E69]/20 font-semibold text-[#18191B]"
                  />
                </div>
                <span className="text-[10px] text-[#78616C] mt-1 block">Standard shift start time</span>
              </div>

              {/* Default End */}
              <div>
                <label className="block text-xs font-semibold text-[#18191B] mb-1.5">
                  Default Shift End
                </label>
                <div className="relative">
                  <input
                    type="time"
                    value={defaultEndTime}
                    onChange={(e) => setDefaultEndTime(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white/70 border border-white/80 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#B82E69]/20 font-semibold text-[#18191B]"
                  />
                </div>
                <span className="text-[10px] text-[#78616C] mt-1 block">Standard shift end time</span>
              </div>

              {/* Late Grace */}
              <div>
                <label className="block text-xs font-semibold text-[#18191B] mb-1.5">
                  Late In Grace Time
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={lateGraceMinutes}
                    onChange={(e) => setLateGraceMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full text-xs pr-12 pl-3 py-2 bg-white/70 border border-white/80 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#B82E69]/20 font-semibold text-[#18191B]"
                  />
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-xs text-[#78616C] font-medium">
                    Mins
                  </span>
                </div>
                <span className="text-[10px] text-[#78616C] mt-1 block">Grace before marking Late</span>
              </div>

              {/* Early Grace */}
              <div>
                <label className="block text-xs font-semibold text-[#18191B] mb-1.5">
                  Early Exit Grace Time
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={earlyGraceMinutes}
                    onChange={(e) => setEarlyGraceMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full text-xs pr-12 pl-3 py-2 bg-white/70 border border-white/80 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#B82E69]/20 font-semibold text-[#18191B]"
                  />
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-xs text-[#78616C] font-medium">
                    Mins
                  </span>
                </div>
                <span className="text-[10px] text-[#78616C] mt-1 block">Grace before marking Early Exit</span>
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <div className="text-xs text-[#78616C]">
              {lastUpdated ? (
                <span>Last updated on: {new Date(lastUpdated).toLocaleString()}</span>
              ) : (
                <span>Ready to apply across {currentBranch?.name || 'current branch'}</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => loadPolicy(effectiveBranchId)}
                className="px-4 py-2 bg-white/80 hover:bg-white border border-white/80 text-[#78616C] rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Reset Form
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#B82E69] hover:bg-[#A02358] disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-[0_4px_16px_rgba(184,46,105,0.22)] transition-colors cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Attendance Settings</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};
