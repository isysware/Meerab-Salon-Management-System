import { conflict } from './AppError.js';

// Use the same branch lock as payroll, commission and POS refunds.
export const lockStaffPayBranch = (tx, branchId) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commission:${branchId}`}::text))`;

export const assertPayrollPeriodOpen = async (tx, staffId, startDate, endDate = startDate) => {
  const slips = await tx.payslip.findMany({ where: { staffId, run: { month: { gte: startDate.slice(0, 7), lte: endDate.slice(0, 7) }, status: { notIn: ['DRAFT', 'CANCELLED'] } } }, include: { run: true } });
  for (const slip of slips) {
    const { run, snapshot } = slip;
    const from = snapshot?.startDate || run.policySnapshot?.startDate || `${run.month}-01`;
    const [year, month] = run.month.split('-').map(Number);
    const to = snapshot?.endDate || run.policySnapshot?.endDate || `${run.month}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    if (from <= endDate && to >= startDate) throw conflict('PAYROLL_PERIOD_LOCKED', 'This period is included in finalized payroll. Reverse payments and cancel that payroll before changing its HR inputs.');
  }
};

// Persist the successful response in the money transaction, before an HTTP retry can arrive.
export const replayMoneyRequest = async (tx, actor, rawKey, route) => {
  if (!rawKey) return null;
  const key = `${actor.id}:${rawKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`request:${key}`}::text))`;
  const saved = await tx.idempotencyKey.findUnique({ where: { key } });
  if (saved && saved.route !== route) throw conflict('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different operation.');
  return saved ? JSON.parse(saved.responseJson).data : null;
};

export const saveMoneyResponse = async (tx, actor, rawKey, route, data) => {
  if (rawKey) await tx.idempotencyKey.create({ data: { key: `${actor.id}:${rawKey}`, userId: actor.id, route, statusCode: 201, responseJson: JSON.stringify({ data }) } });
  return data;
};
