# Targeted accounting commission correction

## Policy and scope

The owner's latest instruction confirms full completed-service commission recognition in Accounting P&L. Invoice posting remains the existing service revenue recognition boundary. Collection-based payable and cash expenses remain separate. This change is reporting-only: it creates no commission earnings, payout entitlements, ledger entries, migrations, or historical updates.

Full commission is derived from stored invoice line/component staff attribution and rates using the existing collection allocation calculator at full invoice value. It does not substitute today's staff rates for historical snapshots. Dated invoice credits reduce the full obligation; later receipts and payout events do not recognize that expense again.

## Reconciliation

| Measure | Partial payment | Later dues, subsequent period |
| --- | ---: | ---: |
| Recognized service revenue | 1,000 | 0 |
| Accounting commission expense | 100 | 0 |
| Accounting operating profit, no other expenses | 900 | 0 |
| Collected service revenue | 500 | 500 |
| Collected tax | 50 | 50 |
| Period collection-based commission earned | 50 | 50 |
| Commission paid | 0 | 0 |
| Cash operating surplus | 500 | 500 |
| Full invoice commission | 100 | 100 |
| Cumulative collection-based payable before payouts | 50 | 100 |
| Remaining not-yet-payable | 50 | 0 |

Previously Accounting P&L used collection commission events, yielding only 50 expense and 950 profit on the partial-payment example. It now recognizes the full 100 once. Customer dues and tax remain separate from recognized service revenue.

Commission payouts include standalone and payroll-linked payments once, with dated reversals. Cash surplus deducts actual paid operating expenses; COGS and inventory write-offs remain separate noncash information. Accrual COGS, salary and inventory-loss recognition are preserved.

Staff summary disclosures also cover new unpaid invoices (full 100, collection payable 0, not-yet-payable 100). Transaction detail rows remain actual collection events. Outstanding earned commission continues to subtract payouts; the cumulative collection-based payable explanation is before payouts. CSV, Excel and Print/Save-as-PDF explanations use these distinctions.

## Exact files changed in this batch

1. `backend/src/modules/reports/fullCommissionAccrual.js` — new historical full-service commission recognition helper.
2. `backend/src/modules/reports/reports.service.js` — accounting recognition, actual commission payout cash expenses, noncash presentation and labels.
3. `backend/src/modules/reports/staffPay.report.js` — full/collected/not-yet-payable explanation without new earning events.
4. `frontend/src/types/salon.ts` — additive explanation fields.
5. `frontend/src/features/reports/StaffCommissionReportPage.tsx` — secondary values and related exports.
6. `frontend/src/features/reports/COGSReportPage.tsx` — accounting and cash basis explanatory labels.
7. `backend/tests/full-commission-accrual.test.js` — isolated financial regression coverage.
8. `backend/vitest.full-commission.config.js` — isolated test configuration.
9. `backend/tests/operating-profit-regression.test.js` — fixture now supplies historical service commission snapshots; existing assertions preserved.
10. `accounting-commission-fix-results.md` — this handoff.

Preexisting Codex/Antigravity changes in these and other files were preserved. This manifest is the current batch, not every modified file in the shared working tree.

## Verification

Isolated Vitest configurations, all passing (90 tests total):

- `vitest.full-commission.config.js`: 10.
- Collection reporting configuration: 27.
- `vitest.commission-explanation.config.js`: 4.
- Reporting labels configuration: 10.
- Step 2 configuration: 20.
- Tax configuration: 11.
- `vitest.operating-profit.config.js`: 8. Initially two fixtures failed because they supplied only collection events, with no historical invoice commission snapshot. Updated only the fixture and date-query matching; all eight assertions now pass.

Coverage includes full/partial/unpaid invoices, later dues without additional accounting expense, dated credits, collection reversals, commission payouts and payout reversals, package historical rates, and separate COGS/write-off presentation.

Frontend `npm run build`: passed (2077 modules; bundle-size warning).

Frontend `npm run lint` (TypeScript): still fails with 41 existing diagnostics, including existing COGS report typing issues and client ledger/POS/staff/payroll/mock issues. This batch does not repair unrelated type errors. Production bundling passing does not imply TypeScript validation passes.

`git diff --check`: passed. No live database or browser end-to-end verification performed. No database reset, schema change, historical financial rewrite, or GitHub push performed.
