# Targeted reporting corrections

## Changes

- Income & Expense uses one shared presentation summary for its KPI, bottom collection summary and exports: collected revenue minus actual paid operating rows. Unpaid salary/commission, COGS, inventory write-offs and settlement transfers are excluded from that operating cash summary. The label is **Collection-Based Operating Surplus**. Recognized accrual revenue, reported expense recognition and COGS remain separately disclosed; underlying historical/API accounting values are unchanged.
- Detailed Income now shows **Collected Net Revenue (Excl. Tax)** and **Gross Customer Collection** separately, using the existing `recognizedNetRevenue` and `totalPaid` values. Existing pre-discount allocation columns are explicitly labeled as tax-exclusive allocations. Export metadata includes gross customer collections. Collection transactions and allocation formulas are unchanged.
- Tax shows **Invoice Tax**, **Tax Collected**, and **Uncollected Customer Tax** separately. Uncollected tax is the balance as of the selected end date, including earlier unpaid invoices. It uses the existing canonical invoice replay/allocation, with an additive per-line outstanding-tax snapshot. It is not calculated as period invoice tax minus period collections. Existing statutory recognition, credits and payable calculation are unchanged.
- Staff Commission was verified only. No commission allocator, report or payout formula was edited.

## Verified example

| Value | Result |
| --- | ---: |
| Invoice net service amount | 1,000 |
| Invoice tax / existing statutory output tax | 100 |
| Gross customer receipt | 550 |
| Collected net revenue | 500 |
| Collected tax | 50 |
| Uncollected customer tax | 50 |
| Paid operating expenses | 0 |
| Collection-based operating surplus | 500 |
| Eligible collected commission sales | 500 |
| Earned / paid / outstanding commission | 50 / 0 / 50 |

Additional tests cover unpaid costs, signed expense reversals, later dues, future-dated receipt reversals, unpaid tax credits, invoices without receipts, linked commission payouts, payout reversals and reversal of earned commission. Existing Step 1 and Step 2 regressions remain passing.

## Exact files changed in this task

1. `backend/src/modules/reports/collectionEvents.js` — additive outstanding-tax snapshot; allocation math unchanged.
2. `backend/src/modules/reports/tax.report.js` — scoped end-date customer tax receivable disclosure.
3. `frontend/src/features/reports/IncomeExpenseReportPage.tsx` — collection/accrual separation, labels and export summary.
4. `frontend/src/features/reports/incomeExpenseDisplay.ts` — shared Decimal-based presentation summary of paid operating rows.
5. `frontend/src/features/reports/DetailedIncomeReportPage.tsx` — net/gross collection labels and export metadata.
6. `frontend/src/features/reports/TaxReportPage.tsx` — separate invoice/collected/uncollected/statutory disclosures.
7. `frontend/src/types/salon.ts` — additive optional `uncollectedCustomerTax` KPI field; pre-existing edits preserved.
8. `backend/tests/reporting-label-corrections.test.js` — 10 isolated regression cases.
9. `backend/vitest.reporting-labels.config.js` — isolated test configuration without database setup/reset.
10. `reporting-label-corrections-results.md` — this handoff.

The existing uncommitted salary/payroll, `reports.service.js`, operating-profit test and Step 3 changes were present at task start and were not edited by this task. They are not included in the changed-file list above.

## Verification

| Check | Result |
| --- | --- |
| `npx vitest run --config vitest.reporting-labels.config.js` | 10 passed |
| `npx vitest run --config vitest.collections.config.js` | 27 passed |
| `npx vitest run --config vitest.step2.config.js` | 20 passed |
| `npx vitest run --config vitest.tax.config.js` | 11 passed |
| Frontend `npm run build` | Passed; existing bundle-size warning |
| `git diff --check` | Passed |
| Frontend `npm run lint` | Existing unrelated errors remain in client/POS/COGS/staff/payroll/mock files; no errors reported in this task's edited files. |

No database reset, schema change, historical financial write or GitHub push was performed. Verification used isolated mocked-database tests and a frontend production build; live database reconciliation and browser/export rendering were not performed.
