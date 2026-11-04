import prisma from '../../config/prisma.js';
import { toDateString } from '../../lib/dates.js';
import { round2, toDec } from '../../lib/money.js';
import { advanceBalance } from '../payroll/payroll.extras.service.js';

/** Current receivable uses the same active payroll recoveries as Staff Loans. */
export async function currentStaffLoanReceivable(scope, db = prisma) {
  const loans = await db.salaryAdvance.findMany({ where: { ...scope, status: 'ACTIVE' }, include: { recoveries: true } });
  return round2(loans.reduce((sum, loan) => sum.plus(advanceBalance(loan)), toDec(0))).toNumber();
}

export const STAFF_LOAN_CATEGORY = 'Staff Loan Disbursement - Non-Operating Cash Outflow';
export const isStaffLoanMovement = m => m.sourceModule === 'PAYROLL' &&
  (m.type === 'SALARY_ADVANCE' || (m.type === 'REVERSAL' && (m.reference || m.sourceId || '').startsWith('ADV-')));

/** Read the posted money ledger, never synthesize another debit from the loan record. */
export async function loadStaffLoanMovements(scope, from, to, db = prisma) {
  const where = { ...scope, createdAt: { gte: from, lte: to }, sourceModule: 'PAYROLL',
    OR: [{ type: 'SALARY_ADVANCE' }, { type: 'REVERSAL', reference: { startsWith: 'ADV-' } }] };
  const [cash, online] = await Promise.all([
    db.drawerMovement.findMany({ where }),
    db.accountMovement.findMany({ where, include: { account: { select: { name: true } } } }),
  ]);
  return [['CASH_DRAWER', cash], ['ONLINE_ACCOUNT', online]].flatMap(([paymentSource, movements]) =>
    movements.filter(isStaffLoanMovement).map(m => ({ ...m, id: `loan-${paymentSource}-${m.id}`,
      date: toDateString(m.createdAt), paymentSource,
      signedOutflow: round2(toDec(m.amount).times(m.direction === 'OUT' ? 1 : -1)).toNumber() })));
}
