import type { CashDrawerReportRow } from '@/types/salon';

// Period reports carry openingBalance separately; all in-period receipts remain debits.
// Retain compatibility with older full-session payloads.
export const drawerDebits = (row: Pick<CashDrawerReportRow, 'totalCashIn' | 'openingFloat' | 'openingBalance'>) =>
  row.openingBalance !== undefined ? row.totalCashIn : Math.round((row.totalCashIn - row.openingFloat) * 100) / 100;

export const drawerMoney = (amount: number | null | undefined, signed = false) => {
  if (amount == null) return '\u2014';
  const rounded = Math.round(amount * 100) / 100 || 0;
  const value = Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (rounded < 0 ? '-' : signed && rounded > 0 ? '+' : '') + value;
};
