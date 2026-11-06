import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/context/RouterContext';
import { salonService } from '@/services';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import {
  Menu,
  ChevronDown,
  Building2,
  Lock,
  LogOut,
  User,
  PanelLeftClose,
  PanelLeft,
  Calendar,
  RotateCcw,
  Clock,
  Bell,
  X,
} from 'lucide-react';
import { ResetDataModal } from '@/components/modals/ResetDataModal';

interface HeaderProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileDrawer: () => void;
  breadcrumbs: Array<{ label: string; href?: string }>;
}

export const Header: React.FC<HeaderProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileDrawer,
  breadcrumbs,
}) => {
  const { user, activeBranchId, allBranches, logout, demoDate, setDemoDate, isDateOverridden, resetDemoDate } = useAuth();
  const { navigate } = useRouter();

  const canManageDate = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [liveTime, setLiveTime] = useState<string>(() =>
    new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveTime(
        new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [notifications, setNotifications] = useState<Array<{
    id: string;
    title: string;
    description: string;
    count?: number;
    urgency: 'high' | 'medium' | 'low';
    href: string;
    isBookingAlert?: boolean;
    daysRemaining?: number;
    bookingNumber?: string;
  }>>([]);

  const [, setClearedIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('salonos_cleared_notifications');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const fetchNotifications = useCallback(() => {
    if (!user) return;
    const branchToFetch = (user.role === 'SUPER_ADMIN' && activeBranchId === 'ALL')
      ? (allBranches[0]?.id || '')
      : (user.branchId || activeBranchId || '');
    if (!branchToFetch) return;

    if (user.role === 'STAFF') {
      salonService.getStaffDashboardData(user.staffId || '', branchToFetch)
        .then((data: any) => {
          let storedCleared: string[] = [];
          try {
            storedCleared = JSON.parse(localStorage.getItem('salonos_cleared_notifications') || '[]');
          } catch {}
          const actions = (data?.pendingActions || []).filter((item: any) => !storedCleared.includes(item.id));
          setNotifications(actions);
        })
        .catch((err) => {
          console.error('Failed to load staff header notifications:', err);
        });
      return;
    }

    salonService.getAdminDashboardData(branchToFetch)
      .then((data) => {
        let storedCleared: string[] = [];
        try {
          storedCleared = JSON.parse(localStorage.getItem('salonos_cleared_notifications') || '[]');
        } catch {}
        const actions = (data?.pendingActions || []).filter((item: any) => !storedCleared.includes(item.id));
        setNotifications(actions);
      })
      .catch((err) => {
        console.error('Failed to load header notifications:', err);
      });
  }, [user, activeBranchId, allBranches]);

  const handleClearNotification = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const stored: string[] = JSON.parse(localStorage.getItem('salonos_cleared_notifications') || '[]');
      const updated = Array.from(new Set([...stored, id]));
      localStorage.setItem('salonos_cleared_notifications', JSON.stringify(updated));
      setClearedIds(updated);
    } catch {}
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const handleClearAll = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const stored: string[] = JSON.parse(localStorage.getItem('salonos_cleared_notifications') || '[]');
      const updated = Array.from(new Set([...stored, ...notifications.map((n) => n.id)]));
      localStorage.setItem('salonos_cleared_notifications', JSON.stringify(updated));
      setClearedIds(updated);
    } catch {}
    setNotifications([]);
  };

  useEffect(() => {
    fetchNotifications();

    const handleRefresh = () => fetchNotifications();
    window.addEventListener('refresh-notifications', handleRefresh);
    window.addEventListener('refresh-invoices', handleRefresh);
    window.addEventListener('invoice-settled', handleRefresh);
    window.addEventListener('focus', handleRefresh);

    const interval = setInterval(fetchNotifications, 15000);

    return () => {
      window.removeEventListener('refresh-notifications', handleRefresh);
      window.removeEventListener('refresh-invoices', handleRefresh);
      window.removeEventListener('invoice-settled', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
      clearInterval(interval);
    };
  }, [fetchNotifications, demoDate]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };


  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const roleMeta: Record<string, { label: string; variant: 'primary' | 'secondary' | 'success' | 'warning' | 'default' }> = {
    SUPER_ADMIN: { label: 'Super Admin', variant: 'primary' },
    ADMIN: { label: 'Branch Admin', variant: 'default' },
    ACCOUNTANT: { label: 'Sales & Billing', variant: 'success' },
    STAFF: { label: 'Staff / Stylist', variant: 'warning' },
  };

  const userRole = user ? roleMeta[user.role] : { label: 'User', variant: 'secondary' as const };

  return (
    <header className="sticky top-0 z-30 min-h-16 bg-white/75 backdrop-blur-2xl border-0 px-4 sm:px-6 py-3 sm:py-0 flex flex-wrap sm:flex-nowrap items-center justify-between gap-y-2 shadow-[0_4px_24px_rgba(35,21,29,0.02)] font-sans">
      {/* LEFT ZONE: Toggle button + Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto sm:flex-1">
        {/* Mobile Hamburger */}
        <button
          onClick={onOpenMobileDrawer}
          className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Desktop Sidebar Toggle */}
        <button
          onClick={onToggleSidebar}
          className="hidden lg:flex p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition-colors"
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? (
            <PanelLeft className="w-4 h-4 text-slate-600" />
          ) : (
            <PanelLeftClose className="w-4 h-4 text-slate-600" />
          )}
        </button>

        {/* Breadcrumb Trail */}
        <nav className="flex min-w-0 items-center text-xs font-medium text-slate-500" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.label}>
                {idx > 0 && <span className="mx-2 text-slate-300">/</span>}
                {isLast ? (
                  <span className="text-slate-900 font-semibold truncate max-w-[200px] sm:max-w-none">
                    {crumb.label}
                  </span>
                ) : (
                  <button
                    onClick={() => crumb.href && navigate(crumb.href)}
                    className="hover:text-slate-900 hover:underline transition-colors truncate max-w-[140px] cursor-pointer"
                  >
                    {crumb.label}
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      </div>

      {/* RIGHT ZONE: Branch Selector + Demo Date + User Profile Menu */}
      <div className="flex flex-wrap sm:flex-nowrap w-full sm:w-auto shrink-0 items-center justify-between gap-2 sm:gap-2.5">
        {/* SHARED OPERATIONAL DATE & LIVE CLOCK (SHADCN MORPHISM PILL) */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border-0 bg-white/80 backdrop-blur-xl shadow-2xs hover:bg-white transition-all text-xs group">
          <div className="w-6 h-6 rounded-lg bg-[#FDF2F5] text-[#B82E69] flex items-center justify-center border-0 shadow-2xs shrink-0 group-hover:bg-[#B82E69] group-hover:text-white transition-colors">
            <Calendar className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-[#78616C]">Date:</span>
          {canManageDate ? (
            <input
              type="date"
              value={demoDate}
              onChange={(e) => {
                if (e.target.value) {
                  setDemoDate(e.target.value);
                }
              }}
              className="text-xs font-mono font-bold text-[#18191B] bg-transparent border-none p-0 focus:outline-none focus:ring-0 cursor-pointer w-[115px]"
              title="Operational System Date (changes trigger immediate dashboard and financial reconciliation)"
            />
          ) : (
            <span className="text-xs font-mono font-bold text-[#18191B]">{demoDate}</span>
          )}

          {/* Live Karachi Time Clock */}
          <div className="flex items-center gap-1 pl-2 border-l border-slate-200/80 text-[11px] font-mono font-semibold text-slate-600" title="Live Karachi Time">
            <Clock className="w-3 h-3 text-[#B82E69]" />
            <span>{liveTime}</span>
          </div>

          {/* Simulated / Date Overridden Indicator & Reset to Today Button */}
          {isDateOverridden && (
            <div className="flex items-center gap-1.5 pl-1.5 border-l border-amber-200/80">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse border border-amber-300">
                Simulated
              </span>
              <button
                type="button"
                onClick={() => resetDemoDate()}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                title="Reset operational system date to actual today"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset
              </button>
            </div>
          )}
        </div>

        {/* QUICK RESET DATA BUTTON (VISIBLE IN FRONT FOR TESTING) */}
        {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && (
          <button
            type="button"
            onClick={() => setIsResetModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-0 bg-rose-50/80 backdrop-blur-xl hover:bg-rose-100/90 text-rose-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            title="Reset operational & test data (Wipe bills, bookings, cash registers to 0)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span className="hidden md:inline">Reset Data</span>
          </button>
        )}

        {!isSuperAdmin && (
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-0 bg-white/80 backdrop-blur-xl text-xs font-medium text-slate-700 shadow-2xs"
            title="Your assigned branch is fixed by your role permissions."
          >
            <Building2 className="w-3.5 h-3.5 text-[#B82E69]" />
            <span className="hidden sm:inline font-semibold">
              {allBranches?.find((b) => b.id === user?.branchId)?.name || user?.branchName || 'Assigned Branch'}
            </span>
            <span className="sm:hidden font-semibold">
              {allBranches?.find((b) => b.id === user?.branchId)?.code || 'Branch'}
            </span>
            <Lock className="w-3 h-3 text-slate-400 ml-0.5" />
          </div>
        )}

        {/* NOTIFICATIONS BELL DROPDOWN (SHADCN MORPHISM WITH BLINKING ALERT) */}
        {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT') && (() => {
          const hasBookingAlert = notifications.some((n) => n.isBookingAlert || n.id.startsWith('booking-') || n.id.startsWith('appointment-'));

          return (
            <DropdownMenu modal={false} onOpenChange={(open) => { if (open) fetchNotifications(); }}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`w-9 h-9 rounded-xl border-0 bg-white/80 backdrop-blur-xl shadow-2xs flex items-center justify-center transition-all cursor-pointer relative outline-none ${
                    hasBookingAlert
                      ? 'ring-2 ring-[#B82E69]/70 shadow-[0_0_14px_rgba(184,46,105,0.4)] animate-pulse hover:ring-[#B82E69]'
                      : notifications.length > 0
                      ? 'hover:bg-white text-[#18191B]'
                      : 'text-[#78616C] hover:text-[#18191B] hover:bg-white'
                  }`}
                  title="Notifications & Operational Alerts"
                >
                  <Bell className={`w-4 h-4 transition-colors ${hasBookingAlert ? 'text-[#B82E69] animate-bounce' : 'text-slate-600'}`} />
                  {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 pointer-events-none">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B82E69] opacity-75" />
                      <span className="relative inline-flex rounded-full h-4 w-4 bg-gradient-to-r from-[#B82E69] to-[#9D2558] text-[9px] font-black text-white items-center justify-center ring-2 ring-white shadow-xs">
                        {notifications.length}
                      </span>
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(e) => e.preventDefault()}
                className="w-88 p-0 border-0 bg-white/95 backdrop-blur-2xl shadow-[0_20px_50px_rgba(35,21,29,0.12)] rounded-2xl"
              >
                <div className="flex items-center justify-between p-3.5 border-b border-[#F1DEE3]/40 bg-white/60 backdrop-blur-md rounded-t-2xl">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#FDF2F5] text-[#B82E69] flex items-center justify-center border-0 shadow-2xs">
                      <Bell className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-[#18191B]">Notifications & Alerts</span>
                  </div>
                  {notifications.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69] border-0">
                        {notifications.length} Pending
                      </span>
                      <button
                        type="button"
                        onClick={handleClearAll}
                        className="text-[10px] text-[#A38D98] hover:text-[#B82E69] font-bold px-1.5 py-0.5 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Clear All Notifications"
                      >
                        Clear All
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-[#A38D98] font-medium">All caught up</span>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-[#F1DEE3]/30 p-1.5">
                  {notifications.length === 0 ? (
                    <div className="py-8 px-4 text-center">
                      <p className="text-xs font-bold text-[#18191B]">No active alerts</p>
                      <p className="text-[11px] text-[#78616C] mt-0.5">
                        All daily collections, invoices and upcoming bookings are up to date.
                      </p>
                    </div>
                  ) : (
                    notifications.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl transition-all space-y-2 mb-1 ${
                          item.isBookingAlert
                            ? 'bg-gradient-to-br from-rose-50/70 via-white/80 to-[#FDF2F5]/90 border border-rose-200/80 shadow-2xs'
                            : 'hover:bg-[#FDF2F5]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {item.isBookingAlert && (
                              <span className="w-2 h-2 rounded-full bg-[#B82E69] animate-ping shrink-0" />
                            )}
                            <span className="text-xs font-bold text-[#18191B] truncate">{item.title}</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                              item.isBookingAlert
                                ? 'bg-rose-100 text-rose-700 font-extrabold'
                                : item.urgency === 'high'
                                ? 'bg-rose-50 text-rose-600'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {item.isBookingAlert ? `${item.daysRemaining}d Left` : item.urgency === 'high' ? 'High' : 'Action'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#78616C] leading-relaxed">{item.description}</p>
                        <div className="pt-1 flex items-center justify-between gap-2 border-t border-rose-100/40">
                          <button
                            type="button"
                            onClick={(e) => handleClearNotification(item.id, e)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                            title="Clear this notification"
                          >
                            <X className="w-3 h-3" />
                            Clear
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(item.href)}
                            className="px-3 py-1 rounded-lg text-[11px] font-bold bg-[#B82E69] hover:bg-[#9D2558] text-white shadow-2xs transition-colors cursor-pointer"
                          >
                            {item.isBookingAlert ? 'View Booking' : 'Resolve'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}

        {/* USER PROFILE MENU (SHADCN MORPHISM PILL & MENU) */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border-0 bg-white/80 backdrop-blur-xl shadow-2xs hover:bg-white transition-all cursor-pointer outline-none"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#C43872] via-[#B82E69] to-[#9D2558] text-white font-bold text-xs flex items-center justify-center shadow-xs shrink-0">
                {user?.name
                  ? user.name
                    .split(' ')
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0].toUpperCase())
                    .join('')
                  : 'U'}
              </div>

              <div className="hidden md:block text-left">
                <p className="text-xs font-bold text-[#18191B] leading-tight truncate max-w-[130px]">
                  {user?.name || 'Staff User'}
                </p>
                <p className="text-[11px] text-[#78616C] font-medium leading-tight truncate max-w-[130px]">
                  {user?.title || userRole.label}
                </p>
              </div>

              <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block ml-0.5" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="w-76 p-1.5 border-0 bg-white/85 backdrop-blur-2xl shadow-[0_20px_50px_rgba(35,21,29,0.08)]"
          >
            {/* Profile Card Header */}
            <div className="p-3 border-b border-[#F1DEE3]/40 mb-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#C43872] via-[#B82E69] to-[#9D2558] text-white font-bold text-sm flex items-center justify-center shadow-xs shrink-0">
                  {user?.name
                    ? user.name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((n) => n[0].toUpperCase())
                      .join('')
                    : 'U'}
                </div>
                <div className="overflow-hidden min-w-0">
                  <p className="text-sm font-bold text-[#18191B] truncate">{user?.name}</p>
                  <p className="text-xs text-[#78616C] truncate mt-0.5">{user?.email}</p>
                  <div className="mt-1.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDF2F5] text-[#B82E69]">
                      {userRole.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Clear Operational Data */}
            {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && (
              <>
                <DropdownMenuItem
                  onClick={() => setIsResetModalOpen(true)}
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <RotateCcw className="w-4 h-4 text-rose-500" />
                  <span>Clear Operational Data & Ledgers</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#F1DEE3]/40" />
              </>
            )}

            {/* Logout Button */}
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut className="w-4 h-4 text-rose-500" />
              <span>Log out of SalonOS</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>


      {/* GLOBAL RESET DATA MODAL */}
      <ResetDataModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
      />
    </header>
  );
};
