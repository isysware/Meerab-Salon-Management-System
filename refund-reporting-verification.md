# Refund reporting presentation verification

## Implemented

- Income & Expense now renders one display row per invoice, combining selected-period sales, dues receipts and refunds. Original bill, dated signed events, refund history, net collections, period-end outstanding and refund status remain available in the row and exports.
- Detailed Income groups by invoice ID plus actual service-line ID. Repeated services with identical codes/names remain separate real lines; installments and refunds no longer multiply visible quantities.
- Raw backend event rows and financial totals remain intact. Grouped rows are an additive `displayRows` response field, used by the tables and existing exports.
- Sales & Invoices already grouped invoices correctly. Its lifecycle status/filter now uses refunds through period end, so a later refund cannot label an earlier period as refunded.
- Tax already aggregates by invoice/service line. Staff Performance aggregates by staff. Staff Commission retains explicitly identified earnings/reversals/payout events. No duplicate invoice calculation was found in these views; their financial engines were not modified.

## Reconciliation

| Scenario | Verified result |
| --- | --- |
| Three PKR 1,000 invoices; one full refund | Three invoice rows; original bills 3,000; refund 1,000; net collections/revenue 2,000 |
| Commission 300 already paid | Cash expense stays 300; operating surplus 1,700 |
| Earned commission 300 less reversal 100, paid 300 | Outstanding balance -100 identifies recovery/adjustment; historical cash payouts remain 300 |
| Partial refund 400 against invoice 1,000 | Original bill 1,000; refund 400; net collection 600; Partially Refunded |
| November sale refunded in December | November receipts remain 3,000 with no future refund status; December collection is -1,000; original November invoice date is reference information |
| Two real service lines share code/name | Two display lines; actual quantities retained; refunds do not add sale units |

Original invoice values on refund-only period rows are reference amounts, not new sales in that period. Dated financial totals continue to use the existing selected-period events.

## Exact files changed for this task

Production:

1. `backend/src/modules/reports/invoicePresentation.js` (new): historical invoice context and display grouping.
2. `backend/src/modules/reports/reports.service.js`: attach invoice IDs and grouped ledger rows.
3. `backend/src/modules/reports/detailedCollections.report.js`: grouped service rows, historical status, true line-ID quantity counting.
4. `backend/src/modules/reports/salesCollections.report.js`: historical lifecycle filter/status.
5. `frontend/src/features/reports/IncomeExpenseReportPage.tsx`: grouped table and Excel/CSV/PDF/Print rows with refund details.
6. `frontend/src/features/reports/DetailedIncomeReportPage.tsx`: grouped table and existing CSV/PDF/Print exports, original amounts and dated refund details.
7. `frontend/src/features/reports/incomeExpenseDisplay.ts`: dated event/refund export description.
8. `frontend/src/types/salon.ts`: typed optional grouped-row and refund-detail fields.

Tests:

9. `backend/tests/salary-ledger-reconciliation.test.js`: same/later-month and partial refunds, cash reconciliation, export execution; updated formatter injection.
10. `backend/tests/collection-reporting.test.js`: service grouping, historical lifecycle, export execution and paid excess commission.
11. `backend/tests/ledger-tips.test.js`: complete payment-date fixtures for historical replay; existing assertions unchanged.
12. `backend/tests/operating-profit-regression.test.js`: complete tax/date/payment-ID and tip-receipt fixtures; existing assertions unchanged.
13. `refund-reporting-verification.md`: this verification record.

Concurrent edits to dates/settings were not made by this task and were not overwritten.

## Verification results

Executed isolated mocked-data Vitest suites with `npx vitest run --config vitest.<name>.config.js`:

| Suite | Passing tests |
| --- | ---: |
| salary-ledger | 21 |
| collections | 33 |
| step2 | 20 |
| tax | 11 |
| full-commission | 10 |
| commission-explanation | 4 |
| ledger-tips | 7 |
| staff-loan | 17 |
| operating-profit | 8 |
| reporting-labels | 10 |
| step3 | 6 |
| step4 | 13 |
| Total | 160 |

All final suite runs passed. Initial failures from incomplete test fixtures/export contexts were corrected without weakening financial assertions.

Frontend `npm run build`: passed, 2,077 modules. Existing large-bundle warning remains.

Frontend `npm run lint` (`tsc --noEmit`): 23 unrelated errors remain in clientLedger, POSBillingPage, ClientPickerModal, StaffDirectoryPage and mockSalonService. No remaining diagnostics in changed reporting files. No live database or browser-session verification was performed.

No database resets, transaction/history writes, commission payout changes, schema changes or GitHub push were performed. The latest request ended at “Commission: Reverse”; verification uses the preceding explicit requirement to preserve paid cash and track excess paid commission as recovery/adjustment. No new recovery workflow was inferred from the missing text.
