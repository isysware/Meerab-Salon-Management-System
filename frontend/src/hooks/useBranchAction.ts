import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/context/ToastContext';

/** Use a stable module-level loader. Results from an old branch are never exposed. */
export function useBranchAction<T>(
  open: boolean,
  loader: (branchId: string) => Promise<T>,
  preferredBranchId?: string
) {
  const { user, allBranches } = useAuth();

  const getDefaultBranch = () => {
    if (user?.role !== 'SUPER_ADMIN') return user?.branchId || '';
    if (preferredBranchId && preferredBranchId !== 'ALL' && allBranches.some((b) => b.id === preferredBranchId)) {
      return preferredBranchId;
    }
    if (allBranches.length === 1) {
      return allBranches[0].id;
    }
    return '';
  };

  const [selection, setBranchId] = useState(getDefaultBranch);
  const branchId = user?.role === 'SUPER_ADMIN' ? (selection || getDefaultBranch()) : user?.branchId || '';
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  const key = `${user?.id}:${branchId}:${revision}`;
  const validBranch = !!branchId && branchId !== 'ALL' && allBranches.some((b) => b.id === branchId);

  useEffect(() => {
    if (open) {
      const def = getDefaultBranch();
      if (def && !selection) {
        setBranchId(def);
      }
    } else {
      setBranchId('');
      setResult({ key: '' });
    }
  }, [open, preferredBranchId, allBranches]);

  useEffect(() => {
    if (!open || !validBranch) return;
    let cancelled = false;
    loader(branchId).then((data) => {
      if (!cancelled) setResult({ key, data });
    }).catch((error) => {
      if (!cancelled) setResult({ key, error: error.message || 'Unable to load branch data.' });
    });
    return () => { cancelled = true; };
  }, [open, validBranch, branchId, key, loader]);

  const ready = open && validBranch && result.key === key && result.data !== undefined && !result.error;
  const error = result.key === key ? result.error : undefined;

  return {
    branchId, setBranchId, ready, error,
    data: ready ? result.data : undefined,
    refresh: () => setRevision((value) => value + 1),
    validate: () => {
      if (!ready) toast.error(error || (validBranch ? 'Please wait for branch data to load.' : 'Please select a branch for this action.'));
      return ready;
    },
  };
}
