# Reporting Step 2 — Sales, Tax & Payment Reconciliation

## Implemented scope

Updated Sales & Invoices, Tax, Payment Accounts, Cash Drawer, and Customer Outstanding/Dues reporting. Reused Step 1's `invoiceCollectionEvents`, `loadCollectionEvents`, `collectionTotals` and existing `allocatePaymentToInvoice` calculations. No new revenue/tax percentage formula was introduced.

`invoiceBalanceAsOf` captures the balance produced by the existing event replay, including non-cash credits that have no collection row. `collectionReceipts` recombines allocated invoice-line events into one receipt so multi-line invoices do not duplicate receipt counts or amounts.

## Audit findings addressed

| Finding | Correction |
| --- | --- |
| F04 | Sales tax charged and dated tax credits are accumulated separately. Net statutory output tax subtracts the credit once. |
| F05 | Refund method and account ID come from complete refund records. Cash refunds reduce cash; online refunds reduce the correct account, including negative refund-only periods. |
| F06 | Original receipts and dated payment reversals are separate signed events. Void refunds are included rather than skipped. Invoice totals remain unchanged. |
| F18 | Old invoices with current receipts, dues, refunds or reversals appear in Sales. Collections use event dates; original invoice/credit recognition and period-end receivables have separate stated bases. Tax collected is separate from statutory output tax. |
| F20 | Account balances and running balances use all scoped ledger movements. Direction/type/source/search filters select detail rows afterward. Separate filtered movement totals are returned. Transfers remain separate from operating receipts but are included in debit/credit reconciliation. |
| F21 | General Ledger timestamp ranges, opening cutoffs and displayed dates use the existing Karachi date helpers, matching Payment Accounts. |
| F22 | Drawer movement queries stop at period end. Prior movements produce carry-forward opening balance; period movements produce debits/credits. Expected closing = opening + period IN - period OUT. Later cash counts do not appear in historical periods. |

## Report behavior

- **Sales:** Original invoice row amounts are preserved. Period sales/tax totals use invoice/credit dates; paid/tender figures use actual dated collection events. Outstanding is calculated as of the selected end date for displayed invoices. The report includes older invoices when they have a period event. Current lifecycle filters are retained; payment status is derived from the period-end balance. Screen and export metadata explain the mixed bases.
- **Tax:** `totalTaxCollected` now means signed actual collected tax. The additive `totalTaxCharged` field retains original statutory output tax charged. Existing statutory rows, credit calculations and `netTaxLiability` remain on invoice/credit recognition. Collection event details are available separately in the response. This report does not newly calculate input-tax credits or tax remittances.
- **Payment Accounts:** True opening/running/closing balances remain ledger-based, including transfers and non-sales transactions. Customer revenue, tax and tips are a separate canonical collection breakdown, never added to ledger movements again. Summaries remain complete when details are filtered. Shared-account branch movement scoping and opening-balance ownership are preserved.
- **Cash Drawer:** Carries prior custody balance into the period and excludes future movements. Drawer opening float received inside the period stays in period debits, rather than being deducted twice by the frontend. Counts are shown only when their recorded timestamp is inside the period. Count variance is measured against custody balance at the count timestamp. Customer tender components use the same collection adapter as Sales.
- **Dues:** Customer directory balances and the client-outstanding read endpoint derive receivables from payment/refund/credit events instead of trusting cached `amountDue`/status. Applied booking advances settle receivables once. No invoice snapshot or payment posting logic is rewritten.

## Reconciliation results from isolated fixtures

| Case | Verified result |
| --- | --- |
| Invoice 1,000 + 100 tax; bill payment 550 | Collected revenue 500; collected tax 50; outstanding 550; original invoice 1,100; statutory output tax 100. Step 1's commission example remains 50 at 10%. |
| Fully paid 1,100; cash refund 220 comprising 200 net + 20 tax | Revenue 800; collected tax 80; statutory output tax 80; cash 880; online 0; outstanding 0. |
| Fully paid invoice then full void with cash returned | Net collections, tax liability and outstanding all 0; original invoice total remains 1,100. |
| January payment 550 reversed in February | January collections 550 and dues 550; February collections -550, revenue -500, collected tax -50 and dues 1,100. |
| Unpaid credit 220 after payment 550 | Dues fall from 550 to 330 without a fictitious cash refund. |
| January partial payment; February remaining payment 550 and refund 220 | January collected tax 50 and statutory tax 100; February collected tax 30 and statutory credit -20. |
| Account/drawer opening 100, receipt 550, expense 200 | Closing 450. Account customer revenue/tax remains 500/50, separately from the expense. |
| Account IN-only detail filter: opening 100, IN 550, OUT 200, IN 50 | Visible last receipt running balance and actual closing both 500; hidden OUT remains in the balance. |
| Bank transfer IN 50, OUT 30, opening 100 | Debit 50; credit 30; closing 120; operating money-in/out remain 0. |
| Drawer prior 100, period IN 550/OUT 200, future IN 9,999 and future count | Opening 100; period closing 450; future movement excluded; historical count/variance blank. |
| Karachi February 1 boundary | Starts January 31 at 19:00 UTC; February 28 ends at 18:59:59.999 UTC. |

## Exact files changed during Step 2

Step 1 was already present as uncommitted work when this batch started. Its unrelated changed files were left in place; the following list is specifically Step 2.

| File | Change |
| --- | --- |
| `backend/src/modules/reports/collectionEvents.js` | Add optional as-of replay capture, shared invoice balance snapshot and receipt regrouping. Existing allocation math retained. |
| `backend/src/modules/reports/salesCollections.report.js` | New module for the existing Sales report endpoint using canonical dated events. |
| `backend/src/modules/reports/reports.service.js` | Wire Sales; correct Payment Accounts and Cash Drawer reconciliation. |
| `backend/src/modules/reports/tax.report.js` | Separate collected tax from statutory tax charged/credited. |
| `backend/src/modules/pos/pos.service.js` | Read-only client outstanding query and derived balances. |
| `backend/src/modules/clients/clients.service.js` | Derived customer directory dues. |
| `backend/src/modules/ledger/ledger.service.js` | F21 Karachi timestamp cutoffs and displayed dates. |
| `frontend/src/features/invoices/SalesInvoicesPage.tsx` | Collection labels, basis notes, exports and signed values. |
| `frontend/src/features/reports/TaxReportPage.tsx` | Collected/statutory tax distinction in screen and exports. |
| `frontend/src/features/reports/DebitCreditStatementPage.tsx` | True debit/credit figures including transfers, carry-forward opening, collection disclosures and export metadata. |
| `frontend/src/features/reports/cashDrawerUtils.ts` | Period debits include in-period opening float once; legacy payload compatibility retained. |
| `frontend/src/types/salon.ts` | Additive report fields for collection breakdowns, statutory tax charged, opening balance and debits/credits. |
| `backend/tests/reporting-step2.test.js` | 20 isolated financial/date/filter/scope/display regressions. |
| `backend/vitest.step2.config.js` | Isolated configuration with mocked Prisma and no database global setup. |
| `backend/tests/tax-report-regression.test.js` | Existing statutory assertions now target `totalTaxCharged`; collection query handled separately by fixtures. Statutory expectations remain unchanged. |
| `reporting-step2-results.md` | This handoff. |

## Verification and remaining failures

| Command | Result |
| --- | --- |
| Backend: `npx vitest run --config vitest.step2.config.js` | **20 passed** |
| Backend: `npx vitest run --config vitest.collections.config.js` | **27 passed** |
| Backend: `npx vitest run --config vitest.tax.config.js` | **11 passed** |
| Frontend: `npm run build` | **Passed**, existing large-bundle warning |
| `git diff --check` | **Passed** |
| Backend: `npx vitest run --config vitest.operating-profit.config.js` | **3 passed / 5 failed**; same baseline missing `prisma.invoicePayment.findMany` mock recorded and reproduced against HEAD during Step 1. |
| Frontend: `npm run lint` (`tsc --noEmit`) | 41 existing diagnostics remain in client ledger, POS, client picker, COGS report, staff directory, payroll calculations and mock service. No errors reported in Step 2 changed files. |

The existing `incomeExpenseReport`, `computePeriodMetrics` and `operatingProfitReport` bodies were compared with HEAD and remain unchanged. Accounting P&L, inventory COGS, salary accounting, invoice totals and historical transactions were not migrated or rewritten. No database reset or GitHub push was performed.

## Verification limits and date semantics

- These are isolated mocked-database regressions and production build verification. Live database control-total reconciliation and interactive browser/export rendering were not run. Integration configurations with database global setup were not invoked.
- Customer collections use recorded business payment/refund dates. Ledger custody uses posting timestamps. Backdated transactions can legitimately land in different periods; the report disclosures distinguish those bases instead of forcing false equality.
- The database stores the latest drawer count, not a complete immutable count history. If that count happened after the selected period, the historical count/variance is unavailable and displayed blank. Drawer lifecycle/status and lifecycle filters retain current-record semantics where historical status is not reconstructible.
- Derived dues do not repair cached historical invoice balances or change posting authorization/validation. If old stored balances differ from the derived report, data repair requires a separately scoped reconciliation/backfill.
- Legacy applied booking advances without original receipt history retain Step 1 behavior: apply the liability credit to dues without fabricating a dated receipt.
