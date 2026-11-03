import React from 'react';
import { LuxurySelect } from './ui/LuxurySelect';
import { useAuth } from '@/context/AuthContext';

/** The action branch is deliberately independent of the page's read filter. */
export function BranchActionField({ value, onChange, disabled = false }: {
  value: string;
  onChange: (branchId: string) => void;
  disabled?: boolean;
}) {
  const { user, allBranches } = useAuth();
  if (user?.role !== 'SUPER_ADMIN') return null;

  const options = [
    ...(allBranches.length > 1 ? [{ value: '', label: '-- Select Branch --' }] : []),
    ...allBranches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <div className="space-y-1.5 rounded-xl border border-[#F1DEE3] bg-[#FDF2F5] p-3">
      <LuxurySelect
        label="Branch *"
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={options}
        placeholder="Select branch for this action"
        contentClassName="z-[100]"
      />
    </div>
  );
}
