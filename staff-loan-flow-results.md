# Staff loan disbursement and salary recovery

## Result

The existing loan issuance path already posts one `SALARY_ADVANCE` OUT movement and creates the salary-advance receivable in the same database transaction. Its persisted idempotency response prevents a retry with the same request key from posting again. Existing cash-holder/account validation and balance checks are preserved.

The missing report entries now read those existing movements. No second debit or operating expense voucher is created. Existing historical movements become visible without rewriting financial history.

| Event | Cash/bank change | Loan receivable | Accounting salary expense |
| --- | ---: | ---: | ---: |
| Loan issue | -10,000 | 10,000 | 0 |
| Payroll finalization: earned 30,000, installment 2,000 | 0 | 8,000 | 30,000 |
| Net salary payment | -28,000 | 8,000 | No additional recognition |

The existing recovery policy records the installment at payroll finalization, not a second time at salary payment. Preview is non-posting. The engine caps recovery at the configured monthly allowance, remaining principal and available salary; previous recoveries in the same month consume that allowance. Payroll cancellation releases its active recovery. These working calculations were preserved and tested.

## Changes

- Income & Expense Ledger: loan disbursement/reversal settlement rows and a separate non-operating subtotal. Actual cash flow includes the loan; operating expenses and operating profit do not.
- Detailed Expenses: loan rows under `Staff Loan Disbursement - Non-Operating Cash Outflow`, separate operating and loan subtotals, and total cash outflow. Reversals use their actual movement date and reverse the non-operating subtotal. Account/category/search filters apply to these rows.
- Cash Balance Sheet: loan disbursements and reversals have distinct transaction types and subtotals instead of being classified as operating expenses. Debit/credit and running balances remain movement-derived.
- Cash Drawer Logs and Payment Accounts already include these ledger movements. Regression tests verify the single credit and account closing balance; no duplicate posting path was added.
- CSV/Excel and Print/Save-as-PDF output includes the related classification/subtotals. Existing UI layout and payroll confidentiality are preserved: accountant reports do not gain access to staff loan detail.

## Exact files changed by this batch

1. `backend/src/modules/reports/staffLoanMovements.js` — new read-only movement adapter and loan classification.
2. `backend/src/modules/reports/paidExpenses.report.js` — non-operating loan rows and subtotals.
3. `backend/src/modules/reports/reports.service.js` — Income & Expense loan settlement rows/subtotal.
4. `backend/src/modules/settlements/settlements.service.js` — cash custody loan classification.
5. `frontend/src/features/reports/IncomeExpenseReportPage.tsx` — subtotal and export metadata.
6. `frontend/src/features/reports/DetailedExpensesReportPage.tsx` — operating/loan labels, subtotal and export metadata.
7. `frontend/src/features/custody/MyBalanceSheetPage.tsx` — loan outflow/reversal display and exports.
8. `frontend/src/types/salon.ts` — additive report and custody fields.
9. `backend/tests/staff-loan-reporting.test.js` — isolated regression tests.
10. `backend/vitest.staff-loan.config.js` — isolated configuration without database setup.
11. `staff-loan-flow-results.md` — this handoff.

Other concurrent/preexisting modifications, including POS, payroll calculation and reporting changes, were preserved. This manifest does not claim ownership of all dirty files in the workspace.

## Verification

62 isolated tests passed:

- `npx vitest run --config vitest.staff-loan.config.js`: 15 passed.
- `npx vitest run --config vitest.collections.config.js`: 27 passed.
- `npx vitest run --config vitest.reporting-labels.config.js`: 10 passed.
- `npx vitest run --config vitest.full-commission.config.js`: 10 passed.

Loan coverage: cash/bank issue, same-key replay, insufficient funds, foreign-branch staff/account rejection, period-dated reversal, account filtering, accountant confidentiality, report/profit separation, cash custody, payment-account and cash-drawer credit entries, salary accrual versus payment, preview, configured recovery, monthly cap, final installment and cancellation release.

Frontend `npm run build`: passed (2077 modules; large bundle warning).

Frontend `npm run lint`: failed with 23 TypeScript diagnostics in client ledger, POS, staff directory and mock service files outside this batch. No diagnostics were reported in this batch's changed files.

Tests use mocked persistence and the real calculation/service functions. No live PostgreSQL concurrency or browser end-to-end test was performed. The database-backed payroll suite was not run because its setup provisions/seeds a database. No database reset, migration, financial-history rewrite or GitHub push was performed.
