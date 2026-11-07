import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Session, PortalType } from '../types/auth';
import { Branch } from '../types/salon';
import { authService, salonService, LoginParams, USE_MOCK } from '../services';
import { mockStorage, DEFAULT_DEMO_DATE } from '../services/mock/mockStorage';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  activeBranchId: string | 'ALL';
  allBranches: Branch[];
  currentBranch: Branch | null;
  demoDate: string;
  isDateOverridden: boolean;
  setDemoDate: (date: string) => void;
  resetDemoDate: () => Promise<void>;
  isLoading: boolean;
  login: (params: LoginParams) => Promise<Session>;
  logout: () => Promise<void>;
  refreshBranches: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(() => authService.getCurrentSession());
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [demoDate, setDemoDateState] = useState<string>(() => (USE_MOCK ? mockStorage.getSystemDate() : new Date().toISOString().slice(0, 10)));
  const [isDateOverridden, setIsDateOverridden] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load branches (Super Admin receives all; branch managers/staff only their assigned branch)
  const refreshBranches = useCallback(async () => {
    try {
      const branches = await salonService.getBranches();
      const branchList = Array.isArray(branches) ? branches : [];
      const current = authService.getCurrentSession();
      if (current && current.user.role !== 'SUPER_ADMIN') {
        const myBranch = branchList.filter((b) => b.id === current.user.branchId);
        setAllBranches(myBranch.length > 0 ? myBranch : branchList);
      } else {
        setAllBranches(branchList);
      }
    } catch (err) {
      console.error('Failed to load branches:', err);
      setAllBranches([]);
    }
  }, []);

  // Business (operating) date: from the API in live mode, from the demo store offline.
  const refreshBusinessDate = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' &&
        (window.location.pathname.startsWith('/receipt') ||
         window.location.pathname.startsWith('/r/') ||
         window.location.pathname.startsWith('/public/receipt'))) {
        return;
      }
      if (salonService.getSystemDateInfo) {
        const info = await salonService.getSystemDateInfo();
        setDemoDateState(info.date);
        setIsDateOverridden(Boolean(info.isOverridden));
      } else {
        const d = await salonService.getSystemDate();
        setDemoDateState(d);
        const today = new Date().toLocaleDateString('en-CA');
        setIsDateOverridden(d !== today);
      }
    } catch (err) {
      if (authService.getCurrentSession()) {
        console.error('Failed to load the business date:', err);
      }
    }
  }, []);

  // Periodic 60s check to ensure midnight rollover occurs automatically
  useEffect(() => {
    const isPublic = typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/receipt') ||
       window.location.pathname.startsWith('/r/') ||
       window.location.pathname.startsWith('/public/receipt'));
    if (isPublic) return;

    const interval = setInterval(() => {
      refreshBusinessDate();
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshBusinessDate]);

  useEffect(() => {
    const isPublicReceipt = typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/receipt') ||
       window.location.pathname.startsWith('/r/') ||
       window.location.pathname.startsWith('/public/receipt'));

    const init = async () => {
      if (isPublicReceipt) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      // API mode: rebuild the session from the httpOnly refresh cookie before anything else.
      const current = authService.restoreSession
        ? await authService.restoreSession()
        : authService.getCurrentSession();
      setSession(current);
      if (current || USE_MOCK) {
        await refreshBranches();
        await refreshBusinessDate();
      }
      setIsLoading(false);
    };
    init();

    if (!USE_MOCK) return undefined;
    // Offline demo only: follow the in-browser mock store (cross-tab sync).
    const unsubscribe = mockStorage.subscribe((store) => {
      const current = authService.getCurrentSession();
      if (current && current.user.role !== 'SUPER_ADMIN') {
        setAllBranches(store.branches.filter((b) => b.id === current.user.branchId));
      } else {
        setAllBranches([...store.branches]);
      }
      setSession(current ? { ...current } : null);
      setDemoDateState(store.systemDate || DEFAULT_DEMO_DATE);
    });

    return () => unsubscribe();
  }, [refreshBranches, refreshBusinessDate]);

  const setDemoDate = (newDate: string) => {
    const previous = demoDate;
    setDemoDateState(newDate);
    const today = new Date().toLocaleDateString('en-CA');
    setIsDateOverridden(newDate !== today);
    salonService.setSystemDate(newDate)
      .then(() => refreshBusinessDate())
      .catch((err) => {
        console.error('Failed to change the business date:', err);
        setDemoDateState(previous);
        setIsDateOverridden(previous !== today);
      });
  };

  const resetDemoDate = async (): Promise<void> => {
    try {
      if (salonService.resetSystemDate) {
        await salonService.resetSystemDate();
      } else {
        const today = new Date().toLocaleDateString('en-CA');
        await salonService.setSystemDate(today);
      }
      await refreshBusinessDate();
    } catch (err) {
      console.error('Failed to reset the business date:', err);
    }
  };

  const login = async (params: LoginParams): Promise<Session> => {
    setIsLoading(true);
    try {
      const newSession = await authService.login(params);
      setSession(newSession);
      await refreshBranches();
      await refreshBusinessDate();
      return newSession;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await authService.logout();
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  const user = session ? session.user : null;
  const activeBranchId = (session && session.user.role === 'SUPER_ADMIN')
    ? 'ALL'
    : (session?.user?.branchId || '');
  const currentBranch =
    activeBranchId === 'ALL'
      ? null
      : allBranches.find((b) => b.id === activeBranchId) || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        activeBranchId,
        allBranches,
        currentBranch,
        demoDate,
        isDateOverridden,
        setDemoDate,
        resetDemoDate,
        isLoading,
        login,
        logout,
        refreshBranches,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
