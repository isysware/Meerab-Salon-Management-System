# Reporting Step 1 — implementation and verification

## Scope and calculation basis

Implemented the five requested operational reporting changes. The existing `allocatePaymentToInvoice` allocator remains the shared calculation engine. A read-only event adapter replays payments, later dues, refunds and dated reversals and derives incremental net revenue, tax and earned commission from cumulative allocations. It does not rewrite invoices, payments or commission ledgers.

For a 1,000 net invoice plus 100 tax, a 550 bill payment produces 500 collected revenue, 50 collected tax, 50 earned commission at 10%, and 550 outstanding. Tips are separate. Commission rates are stored percentages: 1 means 1%, and explicit zero remains zero. Decimal arithmetic and cumulative allocation prevent installment rounding from duplicating revenue or commission.

## Fixed behavior

- Detailed Income uses actual receipt dates and tax-exclusive collections; later dues appear on their receipt dates. Payment amounts are allocated once across lines. Staff filters use the same component attribution as commission calculations. Refunds and payment reversals carry signed amounts.
- Detailed Expenses uses actual paid vouchers, payroll salary payments and commission payouts, including separately dated reversals. A linked payroll commission payout is counted once, rather than adding the payroll summary commission again. Draft/unpaid expenses do not become cash outflows. Salary and commission liabilities are shown separately.
- Staff Commission derives earned commission from eligible collected net sales, with opening balance, period earnings/reversals, actual payouts and closing liability. Existing commission-run metadata remains visible where matching recorded events exist; derived rows otherwise show `CALCULATED`.
- Staff Performance distinguishes invoiced sales and collected sales, uses stored net staff/component allocations without discounting them again, and aligns earned commission with receipt events. Collected sales include staff sales with a zero commission rate.
- Dashboard collected-revenue cards and trends use tax/tip-exclusive collections. Cash operating surplus subtracts paid operating expenses, salary payments and commission payouts. COGS is not deducted again from cash surplus.
- Relevant screen/export labels and negative amount formatting were updated. Existing export handlers and page layouts remain in place.

## Preserved behavior and boundaries

- `incomeExpenseReport`, `computePeriodMetrics` and `operatingProfitReport` function bodies were compared with HEAD and are unchanged. Accounting P&L remains the accrual view. Shared allocator rounding/rate fixes also apply to its existing consumers.
- No schema changes, migrations, database reset, historical backfill, posting, deployment or GitHub push was performed.
- Branch/role restrictions remain enforced. Regression cases cover restricted branch access, staff access rejection and accountant exclusion from HR payout/liability data.
- Commission source/invoice filters select detail rows. Staff balances include all sources because payouts have no invoice-level allocation; the screen/export basis explains this.
- Expense liabilities are branch-wide as of the end date, independently of expense-table filters.
- Legacy applied advances without an original receipt seed the allocation balance but are not fabricated as new dated cash receipts. Their missing receipt history still requires separate data investigation.

## Changed files

| File | Purpose |
| --- | --- |
| `backend/src/lib/calculations/collectionAllocation.js` | Existing allocator: Decimal conversion, percentage snapshots, exact cumulative line/component/commission allocation |
| `backend/src/modules/reports/collectionEvents.js` | New shared read-only receipt, refund and reversal adapter; staff attribution and signed payout events |
| `backend/src/modules/reports/detailedCollections.report.js` | Detailed Income implementation using the shared allocator |
| `backend/src/modules/reports/paidExpenses.report.js` | Actual paid expenses and separately disclosed liabilities |
| `backend/src/modules/reports/reports.service.js` | Wire detailed reports and align staff performance |
| `backend/src/modules/reports/staffPay.report.js` | Collection-earned commission and payout reconciliation |
| `backend/src/modules/dashboard/dashboard.service.js` | Collected revenue, trends, staff commission and paid cash outflows |
| `frontend/src/features/dashboard/components/BranchOperationalSections.tsx` | Collected revenue card and label |
| `frontend/src/features/reports/DetailedIncomeReportPage.tsx` | Collection labels and totals |
| `frontend/src/features/reports/DetailedExpensesReportPage.tsx` | Paid labels, liabilities and signed reversals |
| `frontend/src/features/reports/StaffCommissionReportPage.tsx` | Collection basis, calculated status, exports and signed balances |
| `frontend/src/features/reports/StaffPerformancePage.tsx` | Invoiced/collected distinction in screen and exports |
| `frontend/src/services/salonService.ts` | Additive dashboard response fields |
| `frontend/src/types/salon.ts` | Additive report fields and calculated commission status |
| `backend/tests/collection-reporting.test.js` | Isolated calculation, report, dashboard and scope regressions |
| `backend/vitest.collections.config.js` | Isolated test configuration without database global setup/reset |
| `reporting-step1-results.md` | This implementation handoff |

## Verification

| Check | Result |
| --- | --- |
| `cd backend; npx vitest run --config vitest.collections.config.js` | **27 passed** |
| `cd backend; npx vitest run --config vitest.tax.config.js` | **11 passed** |
| `cd frontend; npm run build` | **Passed**, existing large-bundle warning |
| `git diff --check` | **Passed** |
| Existing operating-profit regression suite | 3 passed, 5 failed: missing `prisma.invoicePayment` in existing test mocks. Same five failures reproduced against original HEAD service code. |
| `cd frontend; npm run lint` (`tsc --noEmit`) | Blocked by existing type errors in unrelated client/POS/COGS/staff/payroll/mock files. No errors reported in Step 1 changed files on the final run. Baseline source type-checking also reproduced the unrelated errors. |

Regression coverage includes the approved partial-payment example; 0%, fractional and 1% rates; tiny installment rounding; later dues; tax/tips separation; mixed services/products and payment methods; multi-staff packages; unpaid credit versus paid cash refund; full refunds/voids; historical payment/expense/payout reversals; applied booking receipt dates; linked payroll commission deduplication; unpaid liabilities; report filter totals; staff attribution; dashboard surplus; and branch/role boundaries.

These are isolated tests with mocked Prisma and a frontend production build. Live database control-total reconciliation and interactive browser/PDF/Excel verification were not performed. No claim of a fully passing repository-wide suite is made.
