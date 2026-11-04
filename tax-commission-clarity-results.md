# Tax and commission clarity — accounting policy pending

## Completed

- Existing tax cards now prominently distinguish Invoice Tax, Tax Collected from Customer, Uncollected Customer Tax and Statutory Tax Payable. Taxable turnover remains secondary information. Customer uncollected tax is explicitly not statutory tax payable. Tax calculation and recognition code was not changed.
- Staff Commission adds original invoice-eligible net sales, full-invoice snapshot commission reference and period-end invoice payment status. Existing collected sales, earned commission, actual paid commission and outstanding earned liability remain unchanged.
- Staff summary invoice amounts are deduplicated by invoice/line/staff/component across installments. Detail rows repeat their original invoice reference for explanation and are explicitly non-additive. References cover invoice lines represented by the selected period's commission events, not every invoice ever issued.
- CSV, Excel and Print/PDF data include the new reference amounts, payment status and calculation-basis explanation. The existing tables use secondary display values rather than a redesign.
- Full-invoice reference amounts are **not** treated as additional earned/payable commission. No posting, payout or commission-event generation was added.

## Before / after for the approved example

| Measure | Before | After |
| --- | --- | --- |
| Invoice tax | Available as secondary information | Prominent Invoice Tax card: 100 |
| Customer tax collected | 50 | Clearly labeled customer tax: 50 |
| Customer tax uncollected | Secondary information | Prominent end-date balance card: 50 |
| Statutory tax payable | Existing recognition: 100 | Separately labeled: 100; unchanged |
| Invoice eligible net sales | Not shown in commission report | Original snapshot reference: 1,000 |
| Eligible collected net sales | 500 | 500; unchanged |
| Collection-earned / paid / outstanding | 50 / 0 / 50 | 50 / 0 / 50; unchanged |
| Full-invoice commission | Not shown | Snapshot reference 100, explicitly not additional payable |
| Customer payment status | Not shown | PARTIAL as of the report end date |
| Accounting commission / profit in the supplied example | 50 / 950 | Not changed by this task; contractual-policy confirmation pending |

## Unresolved mandatory policy question

The current collection allocator and commission report recognize commission from actual customer collections. Repository searches did not locate a staff agreement or an explicit policy establishing an unconditional full commission obligation at service completion. Software behavior alone cannot prove the contractual terms.

The user explicitly required confirmation of that obligation before changing accounting recognition. An asynchronous question was sent asking whether commission is owed in full at completion or earned only on customer receipts. No confirmation was received during this implementation.

Therefore no additional 50 accrual expense/liability was created and Accounting P&L was not edited. If the actual agreement requires full commission at completion, the accounting-only change remains to be implemented and tested after confirmation; collected-earned commission and payouts must remain separate. If entitlement is receipts-only, the extra 50 must not be accrued as an unconditional obligation.

## Exact files changed by this task

1. `backend/src/modules/reports/staffPay.report.js` — additive original invoice references and period-end payment status; existing earned/payout balances retained.
2. `frontend/src/features/reports/StaffCommissionReportPage.tsx` — explanatory secondary values, labels and exports.
3. `frontend/src/features/reports/TaxReportPage.tsx` — prominent tax distinctions and null-safe summary rendering.
4. `frontend/src/types/salon.ts` — additive optional invoice-reference/payment-status fields.
5. `backend/tests/commission-explanation.test.js` — isolated reference, installment, historical-status and reversal cases.
6. `backend/vitest.commission-explanation.config.js` — isolated configuration, no database setup.
7. `tax-commission-clarity-results.md` — this handoff.

Antigravity's existing/in-progress changes in dates, dashboard, reporting routes/service, Detailed Income and Step 4 tests/configuration were not edited by this task. The collection allocator, commission posting/payout modules, schema and stored financial history were not modified.

## Verification

- `npx vitest run --config vitest.commission-explanation.config.js`: **4 passed**.
- `npx vitest run --config vitest.collections.config.js`: **27 passed**.
- `npx vitest run --config vitest.reporting-labels.config.js`: **10 passed**.
- Frontend `npm run build`: **passed**, existing bundle-size warning.
- `git diff --check`: **passed**.
- Full frontend type-check remains blocked by existing errors outside the changed report files; report nullability errors encountered during verification were corrected.

Tests use mocked Prisma. Live database reconciliation and interactive browser/export rendering were not performed. No database reset, historical financial rewrite or GitHub push was performed.
