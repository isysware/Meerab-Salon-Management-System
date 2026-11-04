# Income & Expense Ledger: targeted salary fix

## Before and after

| Item | Before | After |
| --- | --- | --- |
| Salary invoice-specific cells | Salary amount could appear as Total Bill; tip/dues cells showed zero or payroll liability | Service, tax, bill, tips and customer dues show an em dash for non-invoice rows |
| Salary cash row | Cumulative slip payments, first payment method/date; paid run status could infer a payment | One row per actual dated payroll payment, with its reference and method; status derives from recorded payments |
| Partial salary status | Partial in the example | Remains Partial; not forced to Paid |
| Customer invoice total | Included later dues rows as additional bill amounts | Each represented customer invoice counted once; salary, commission, loans and refunds are not new invoices |
| Expense recognition reference | Could reflect paid salary rather than accrued salary | Separate accrual reference using finalized salary snapshots, full contractual commission recognition, operating vouchers and inventory loss |
| Salary recognition date | Generation date OR finalization date could include a finalized salary in two periods | Finalization date; generation date is only a fallback when finalization date is absent |
| Later salary settlement | Could be missed outside the run's original date range or include cumulative payments | Only the actual payments in the selected period appear; no additional salary accrual |

The approved cash example is unchanged:

| Measure | Verified PKR |
| --- | ---: |
| Customer invoice total | 1,100 |
| Customer collections | 1,100 |
| Collected revenue | 1,000 |
| Collected tax | 100 |
| Salary actually paid / paid operating expenses | 1,000 |
| Collection-based operating surplus | 0 |
| Net cash movement | 100 |

In the regression fixture, finalized salary is 30,000 and only 1,000 has been paid. The accrual reference and Accounting P&L recognize 30,000 once; Staff Salary shows 29,000 outstanding. The 1,000 cash payment does not create another accrual. A later 29,000 payment clears salary without recognizing the obligation again.

Loan recovery uses the same existing recognition formula: finalized net payable plus loan recovery. Previous custom-payroll adjustments remain embedded in the stored finalized net amount and are not deducted a second time. Draft/cancelled payroll is excluded. No payroll generation, finalization, payout or financial-record writing workflow was changed.

The accrual reference is labeled as branch/period information, separate from the displayed cash rows. Existing operating voucher query filters are preserved. Cash row filters continue to apply to the customer invoice, collection and cash-movement totals.

## Exact files changed

1. `backend/src/modules/reports/reports.service.js` — dated salary rows, actual status, unique invoice totals, accrual reference and salary recognition date selection.
2. `backend/src/modules/reports/salaryRecognition.js` — shared existing salary snapshot recognition formula for ledger reference and Accounting P&L.
3. `frontend/src/features/reports/IncomeExpenseReportPage.tsx` — non-applicable cells, signed payment display, reference labels and Excel/CSV/PDF/Print consistency.
4. `frontend/src/features/reports/incomeExpenseDisplay.ts` — customer-invoice applicability, transaction labels and unique-invoice fallback total.
5. `frontend/src/types/salon.ts` — additive invoice identity and recognition total fields.
6. `backend/tests/salary-ledger-reconciliation.test.js` — isolated report, payroll-engine and actual export-handler regressions.
7. `backend/vitest.salary-ledger.config.js` — isolated test configuration without database setup.
8. `salary-ledger-fix-results.md` — this handoff.

## Verification

73 tests passed across the following isolated configurations:

- `vitest.salary-ledger.config.js`: 15.
- `vitest.staff-loan.config.js`: 17.
- `vitest.operating-profit.config.js`: 8.
- `vitest.full-commission.config.js`: 10.
- `vitest.ledger-tips.config.js`: 7.
- `vitest.step3.config.js`: 6.
- `vitest.reporting-labels.config.js`: 10.

Coverage includes the partial-payment example across Income & Expense, Detailed Expenses, Staff Salary, Accounting P&L, collection-based P&L and Cash Drawer; full salary settlement; later-period settlement; draft-generation versus finalization dates; loan recovery; repeated payroll preview with previous custom salary; unique customer invoices; and salary/commission/loan non-invoice applicability.

The actual Excel, CSV and PDF/Print export handlers were executed with the regression report. Headers, row lengths, em-dash cells, signed salary payment, Partial status, invoice totals, customer collections and accrual/cash metadata were checked.

Frontend `npm run build`: passed, 2077 modules (existing large-bundle warning).

Frontend `npm run lint`: fails with 23 diagnostics in unrelated client-ledger, POS, staff-directory and mock-service files. No diagnostics were reported in this batch's changed files.

`git diff --check`: passed. Persistence was mocked; no live-database or browser end-to-end test was performed. No database reset, migration, historical financial rewrite or GitHub push was performed.
