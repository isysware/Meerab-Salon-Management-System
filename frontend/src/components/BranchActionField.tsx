import React from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';

/** The action branch is deliberately independent of the page's read filter. */
export function BranchActionField({ value, onChange, disabled = false }: {
  value: string;
  onChange: (branchId: string) => void;
  disabled?: boolean;
}) {
  const { user, allBranches } = useAuth();
  const id = React.useId();
  if (user?.role !== 'SUPER_ADMIN' || allBranches.length <= 1) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-[#F1DEE3] bg-[#FDF2F5] p-3">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700">Branch <span className="text-rose-500">*</span></label>
      <Select required value={value || undefined} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full bg-white text-xs"><SelectValue placeholder="Select branch for this action" /></SelectTrigger>
        <SelectContent className="z-[100]">{allBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
