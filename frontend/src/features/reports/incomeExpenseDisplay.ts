import type { IncomeExpenseReportRow } from '../../types/salon';
import Decimal from 'decimal.js';

export const isCustomerInvoiceEntry = (row: IncomeExpenseReportRow) =>
  row.type === 'INCOME' && ['POS Invoice', 'POS Dues Collection', 'Sales Refund'].includes(row.source);

export function incomeExpenseEntryType(row: IncomeExpenseReportRow): string {
  if (row.type === 'SALARY_EXPENSE') return 'Salary';
  if (row.type === 'COMMISSION_EXPENSE') return 'Commission';
  if (row.source === 'Staff Loan') return 'Staff Loan';
  if (row.source === 'Sales Refund') return 'Refund';
  if (row.type === 'SETTLEMENT') return 'Settlement';
  return row.type === 'INCOME' ? 'Income' : 'Expense';
}

/** One full bill per customer invoice; later dues and refunds are not new invoices. */
export function incomeExpenseInvoiceTotal(rows: IncomeExpenseReportRow[]): number {
  const bills = new Map<string, number>();
  for (const row of rows) {
    if (!['POS Invoice', 'POS Dues Collection'].includes(row.source) || row.type !== 'INCOME') continue;
    const key = row.invoiceId || row.invoiceNumber || row.reference;
    if (!bills.has(key) || row.source === 'POS Invoice') bills.set(key, row.invoiceBillTotal ?? row.totalBill ?? 0);
  }
  return [...bills.values()].reduce((sum, amount) => sum.plus(amount), new Decimal(0)).toDecimalPlaces(2).toNumber();
}

/** Collection summary of the displayed rows; unpaid accruals and COGS are reference information. */
export function incomeExpenseCollectionSummary(income: number, rows: IncomeExpenseReportRow[]) {
  const paid = rows.filter(row => ['OPERATING_EXPENSE', 'SALARY_EXPENSE', 'COMMISSION_EXPENSE'].includes(row.type))
    .reduce((sum, row) => sum.plus(row.status === 'ACCRUED' ? 0 : row.cashFlow !== undefined ? -row.cashFlow : row.paid ?? 0), new Decimal(0));
  return { paidOperatingExpenses: paid.toDecimalPlaces(2).toNumber(),
    surplus: new Decimal(income).minus(paid).toDecimalPlaces(2).toNumber() };
}

/** Signed money moved for this row; cumulative invoice receipts must not repeat dues collections. */
export function incomeExpenseCashFlow(row: IncomeExpenseReportRow): number {
  if (row.cashFlow !== undefined) return row.cashFlow;
  if (row.collectionAmount !== undefined) return row.collectionAmount;
  if (row.type === 'COMMISSION_EXPENSE' && (row.status === 'ACCRUED' || !row.paid)) return 0;
  const income = row.income > 0 || row.type === 'INCOME';
  const paid = row.paid ?? (income ? row.income : row.expense);
  return income ? paid : -paid;
}
export function incomeExpenseCashText(row: IncomeExpenseReportRow): string {
  const value = incomeExpenseCashFlow(row);
  return value === 0 ? '0.00' : `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
}
