import { toDec } from '../../lib/money.js';

// Finalized net already includes custom-payroll reconciliation. Loan recovery settles
// a receivable, so add it back for earned salary recognition, never for cash payment.
export function recognizedSalaryExpense(payslip) {
  const snapshot = typeof payslip.snapshot === 'string' ? JSON.parse(payslip.snapshot) : payslip.snapshot || {};
  return toDec(payslip.netPayable ?? payslip.grossPayable ?? 0).plus(snapshot.advanceRecoveryAmount || 0);
}
