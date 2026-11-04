# Reporting Audit — Meerab Salon Management System

Audit date: 2026-11-04
Workspace: `D:\Isysware works\Meerab-Salon-Management-System`

## 1. Purpose and instructions for the next reviewer

The owner requested a deep, read-only engineering and accounting review of the application, especially reporting formulas. The application is already substantially built; the intention is to identify reporting bugs and decide subsequent tasks before changing application behavior.

The owner then requested this file so another ChatGPT session can analyze the findings and propose tasks. Creating this document is authorized. No application fixes, migrations, data corrections, dependency installations, or database writes were performed during this audit.

Please distinguish:

- **Reproduced:** demonstrated with isolated in-memory execution of existing calculation code or an extracted report function with mocked data.
- **Code-confirmed:** the problematic implementation and relevant upstream/downstream paths were inspected, but the scenario was not executed against a real database.
- **Design decision / further verification:** the implementation is ambiguous or needs business-policy confirmation or production-data reconciliation.

Do not treat this document as proof that every production record is wrong, that historical data has been reconciled, or that the whole application has been exhaustively tested. The audit concentrated on the reporting subsystem and the transaction paths feeding it. Actual affected records and amounts remain unmeasured.

All line references below refer to the working tree inspected during the audit and may move after edits.

## 2. Repository and working-tree context

Frontend: React 19, TypeScript, Vite. Backend: Express, JavaScript ES modules, Prisma 5.22.x, PostgreSQL schema, decimal.js. The Prisma schema uses Decimal columns for financial amounts and higher precision for stock quantities/cost layers.

Six files were already modified before the audit began:

1. `backend/src/modules/payroll/payroll.service.js`
2. `backend/src/modules/reports/reports.routes.js`
3. `backend/src/modules/reports/reports.service.js`
4. `frontend/src/features/payroll/PayrollPage.tsx`
5. `frontend/src/features/reports/COGSReportPage.tsx`
6. `frontend/src/types/salon.ts`

These pre-existing edits were left untouched. Findings describe the working tree at inspection time, including those edits, not necessarily HEAD or the deployed application. In particular, payroll/commission separation and the operating-profit collection view are areas with existing modifications.

**Concurrent-change notice:** At the final file verification, two additional modified files appeared: `backend/src/lib/calculations/collectionAllocation.js` and `frontend/src/lib/collectionAllocation.ts`. This audit agent did not edit either file. Their latest contents were not re-audited. Therefore F01–F03 and their reproduction outputs describe the allocator inspected earlier in this session; check the latest diff before treating them as still unresolved.

The supplied and on-disk AGENTS.md require defensive authorization, tenant isolation, Decimal arithmetic, append-only financial history, additive migrations, reconciliation before schema changes, and physically separate platform-admin and salon frontends. Any later implementation should follow those requirements without resetting data.

## 3. Files and flows examined

Main reporting implementation:

- `backend/src/modules/reports/reports.service.js` — appointment, performance, sales, income/expense, operating profit, accounts, drawers, detailed expenses, inventory, attendance, detailed income.
- `backend/src/modules/reports/reports.routes.js` — authorization and query validation.
- `backend/src/modules/reports/tax.report.js` — dated invoice/refund tax recognition.
- `backend/src/modules/reports/staffPay.report.js` — salary and commission reports.
- `backend/src/modules/dashboard/dashboard.service.js` — daily metrics and revenue trends.
- `backend/src/modules/ledger/ledger.service.js` — cash/bank movement ledger.

Transaction/calculation sources traced:

- `backend/src/modules/pos/pos.service.js` — invoice posting, payment collection, commission event creation.
- `backend/src/modules/pos/pos.refund.js` — refunds, voids, receivable cancellation, commission reversals, stock returns.
- `backend/src/lib/calculations/collectionAllocation.js` — payment allocation and collection commission.
- `backend/src/lib/money.js`, `dates.js`, `reportRange.js`, `scope.js`.
- Relevant payroll service/calculation and commission integration sections.
- Supplier creation/ledger and expense reversal sections.
- `backend/prisma/schema.prisma` and authentication middleware.
- Relevant frontend report formulas, totals, exports, and router imports.
- Reporting test definitions and test setup.

This was not an exhaustive review of every screen, deployment configuration, integration, or all attendance/payroll business rules.

## 4. Accounting identities to preserve when planning fixes

These identities describe the intended distinctions needed to reconcile the application's own records. They are not jurisdiction-specific tax advice.

| Measure | Expected basis |
|---|---|
| Gross line amount | Quantity × unit price |
| Net sales before refunds | Gross amount − allocated discount |
| Invoice total | Net sales + tax + tip |
| Period recognized revenue | Original invoice recognition dated in period − revenue reversals dated in period |
| Net period tax | Tax recognized in period − tax reversed in period |
| Cash receipts/outflows | Actual dated payment/movement events, including dated reversals |
| Commission earned | Eligible collected net × snapshotted percentage, with exact allocation and dated reversals |
| Closing commission liability | Opening liability + earned − reversed − net payouts |
| Supplier closing payable | Opening ledger balance + period credits − period debits; opening entered once |
| Cash/account closing balance | Opening + inflows − outflows, including transfers |
| Operating profit | Recognized revenue − recognized cost of sales − recognized operating expenses |

An invoice-cohort report may legitimately show the current lifetime outcome of invoices posted in a selected period. That is different from a period event report. The UI, API metadata, exports, and reconciliation tests must say which one is being presented.

Similarly, a collection contribution calculation that deducts stock consumption is not automatically a cash-flow statement. Stock purchases, supplier settlements, deposits, loan recoveries, and other non-revenue movements require explicit treatment.

## 5. Critical and high-priority findings

### F01 — Prisma Decimal commission rates become zero

**Status: Reproduced. Priority: Critical.**

Location: `backend/src/lib/calculations/collectionAllocation.js:224` and `:270`; analogous assigned-staff handling near `:156`.

Component rates are accepted only when `typeof rate === 'number'`. The single-staff path accepts a number or `instanceof Decimal` from decimal.js. The installed Prisma Decimal object does not pass those checks in the reproduced environment. The fallback becomes zero.

POS posting loads a fresh invoice with raw Prisma line/component records and passes it to this allocator (`pos.service.js:546`). Dues collection also passes the loaded invoice (`:638`). Therefore this can affect stored commission EARN events, not just display totals.

Isolated results for a fully paid service/package with net 1,000:

| Rate input | Expected commission | Actual commission |
|---|---:|---:|
| JavaScript number `10` | 100 | 100 |
| `new Prisma.Decimal(10)` | 100 | 0 |

Both single-staff and component paths reproduced the failure. Existing records must be reconciled before any historical repair; changing the function alone will not recreate missing EARN events.

### F02 — 1% commission is interpreted as 100%

**Status: Reproduced. Priority: High.**

Location: `collectionAllocation.js:161`, `:229`, `:273`.

The allocator treats any positive rate <= 1 as a fractional rate and multiplies it by 100. The schema documents staff and invoice commission rates as percentages 0–100.

For numeric rate `1`, net 1,000, full payment: expected commission 10; actual 1,000. Rates below 1% are also ambiguous. This is a separate bug from F01 and may become much more visible after Decimal handling is corrected.

### F03 — Payment allocation does not conserve the payment across lines

**Status: Reproduced. Priority: High.**

Location: `collectionAllocation.js:109–118`.

Each line receives an independently rounded proportional payment; there is no remainder distribution across the lines. Cumulative-difference arithmetic reduces installment drift for each individual line but does not ensure that the line sums equal each payment.

Reproduction: three lines each net 1, zero tax, invoice net 3; receive payment 1. Allocator reports collected net 0.99 and tax 0. Expected allocated total is 1.00.

Any correction must preserve both per-payment conservation and full-invoice cumulative conservation, including mixed tax rates, partial payments, reversals, and small amounts.

### F04 — Sales report subtracts refund tax twice

**Status: Reproduced with extracted report function and mocked Prisma projection. Priority: High.**

Location: `reports.service.js:478` and `:558`.

The accumulator named `totalTaxCharged` already subtracts `refundedTax`. Later `netTaxLiability = totalTaxCharged - totalTaxReversed` subtracts it again.

Reproduction: invoice tax 100, refunded tax 20. Expected net tax 80; actual KPI net tax 60. Row-level net tax and aggregate net tax can disagree.

### F05 — Cash refunds are deducted from online totals in Sales report

**Status: Reproduced with extracted report function and mocked Prisma projection. Priority: High.**

Location: Sales invoice refund select near `reports.service.js:372`; tender calculations near `:430` and `:505`.

The refund query selects amounts but omits `method` and `accountId`. The calculation then tests `r.method === 'CASH'` and tries to match `r.accountId`. With those fields missing, cash refunds enter the online branch and cannot be assigned to an account.

Reproduction: original cash collection 1,100; cash refund 220. Expected cash 880, online 0. Actual cash 1,100, online -220; the invoice row still shows cash 1,100. Row-level clamping can also conceal the mismatch.

### F06 — Voided and reversed payments remain in Sales tender totals

**Status: Void case reproduced; reversal case code-confirmed. Priority: High.**

Location: `reports.service.js:360`, `:415–450`, `:499–515`.

All invoice payments are summed without filtering or representing payment reversals. Refund deduction is skipped for VOIDED invoices, although their original receipts were included. Main paid totals set voided invoices to zero, producing contradictory totals in one payload.

Reproduction: fully cash-paid 1,100 invoice, fully voided with cash returned. Actual cash-collected KPI remains 1,100 while totalPaid is zero. Expected net retained cash for this invoice is zero.

For historical period reports, simply filtering `reversedAt: null` is not sufficient: the original receipt and later reversal need their respective dates. Detailed Income also loads payment lists without reversal handling.

### F07 — Supplier opening payable is counted twice and supplier selection is unscoped

**Status: Code-confirmed. Priority: High.**

Locations: `inventory.service.js:317–322`; inventory supplier report in `reports.service.js:3550–3610`.

Supplier creation writes the opening amount both to `supplier.openingPayable` and as an OPENING_BALANCE credit in SupplierLedger. The report initializes balance with `supplier.openingPayable + prior ledger credits - prior ledger debits`; it then also processes any opening entry in the selected period.

Example: supplier opening 5,000 with its opening ledger entry, no other activity. The report can produce 10,000. The supplier-specific ledger service instead starts from zero and uses ledger entries, so the two paths disagree.

Additionally, the report fetches suppliers without branch restriction and sums every selected supplier's stored opening amount even when ledger entries are branch-filtered. This can inflate a selected branch's opening balance and expose unrelated supplier names/opening amounts. Shared/ALL suppliers need an explicit branch allocation policy.

### F08 — Commission expense can be counted twice and partial payouts mark whole runs paid

**Status: Code-confirmed. Priority: High.**

Location: `reports.service.js:1069–1175`.

Income/Expense determines that a commission run is paid when it has any completed payout (or certain linked payroll payments). Every event consumed by that run is then emitted as a paid expense for its full event amount. Standalone commission payments are also emitted separately as expenses.

Consequences:

- Earned commission 1,000 and standalone payout 1,000 in the same selected period can produce expense 2,000.
- A small partial payout can classify all events in the run as fully paid.
- Payment status is checked across time, while event rows retain their earn date; later payouts can change historical reports.
- Exceptions in commission queries are swallowed, potentially producing incomplete totals without indicating failure.

Recognition events and settlement events need separate treatment. A payout must not create a second recognized expense when its earning was already recognized.

### F09 — Accountant can receive standalone commission payout rows through Income/Expense

**Status: Code-confirmed authorization gap. Priority: High.**

Location: `reports.service.js:1132`.

Earlier payroll and commission-event queries intentionally return no HR data for ACCOUNTANT. The later standalone commission-payment query has no equivalent actor restriction. It filters branch but can emit staff names and commission payment amounts into a report available to accountants.

The dedicated salary/commission endpoints deny accountant access. This indirect path contradicts that confidentiality rule and needs an authorization regression test.

### F10 — Salary expenses and salary payments use inconsistent dates

**Status: Code-confirmed. Priority: High.**

Locations: `reports.service.js:750–765`, `:1013–1065`, `:1570–1595`, `:1765–1778`.

Payroll runs are selected if either generatedAt or finalizedAt is in the period. Income/Expense then sums their payments without limiting paidAt to the requested period. Operating Profit filters some payments by date, but if none match and the run is currently PAID it falls back to the full net payable.

Examples:

- Run generated in January, finalized in February can be selected in both periods.
- Run finalized in January, paid in February can appear as paid expense in January and be omitted from February because the parent run is outside February.
- Operating Profit's PAID fallback can manufacture an in-period payment amount despite no payment in that period.

Payroll period, recognition/finalization date, and payment date must be treated separately.

### F11 — Operating Profit uses net salary after loan recovery as salary expense

**Status: Code-confirmed formula mismatch requiring business treatment confirmation. Priority: High.**

Locations: `reports.service.js:1769`; `payrollCalculations.js:426–429`.

Salary expense is taken from `netPayable`, but that value subtracts advance/loan recovery. Recovery reduces cash payable and a staff receivable; it does not by itself reduce the wage earned for the period.

Illustration: salary earned 30,000, advance recovery 5,000, net payout 25,000. The accrual report uses 25,000 as salary expense, raising profit by 5,000 compared with expense before loan recovery. Other deduction categories need classification rather than blindly replacing net with gross.

### F12 — Collection income subtracts full revenue cancellations even when no cash is refunded

**Status: Code-confirmed. Priority: High.**

Locations: Income/Expense refund rows near `reports.service.js:945–985`; Operating Profit near `:1690–1702`; actual refund calculation in `pos.refund.js:185–221`.

Refund posting correctly distinguishes net/tax reversed, actual cashOut, and receivableCancelled. Collection reports nevertheless subtract full `netReversed` from collected revenue and full tax reversal from collected tax.

Example with no tax: invoice net 1,000, received 500, then cancel/refund 300 of the unpaid portion. The posting logic can leave cashOut zero and reduce due to 200. Collection income nevertheless drops from 500 to 200. Accrual revenue should reduce; retained cash collections should not decrease by an unpaid cancellation.

The collection allocation of a refund must be derived from its actual cash and liability effects, including tips, not automatically copied from its accrual reversal.

### F13 — Voids and negative periods distort Operating Profit and dashboard revenue

**Status: Code-confirmed. Priority: High.**

Locations: `reports.service.js:1447`, `:1696`, `:1725–1727`, `:1787`; `dashboard.service.js:31–35`, `:74–75`.

Operating Profit and dashboard exclude original invoices whose current lifecycle is VOIDED but also subtract dated void/refund reversals. This removes the original recognition and subtracts its reversal again.

Both also clamp some period totals to zero. A return-only period can legitimately have negative net sales or a net COGS reversal; clamping hides the actual period movement. Commission reversals are also clamped in Operating Profit.

Example: another active sale is 2,000, plus a same-period 1,000 sale that is voided. Excluding the voided sale leaves 2,000; subtracting its 1,000 reversal reports 1,000 instead of 2,000.

The dedicated tax report provides a better existing pattern: retain original dated recognition, subtract its dated reversal once.

## 6. Other confirmed reporting issues

### F14 — Staff performance discounts package allocations again

**Status: Code-confirmed.**

Locations: `reports.service.js:186–193`; `pos.service.js:418–424`, `:479`, `:495`.

POS component `allocatedAmount` is already based on net discounted sales. Performance multiplies it again by `line.netSales / lineGross`.

Example: gross package 1,000, discount 100, stored allocation 900. Performance reports 810 and estimates commission on 810. Some default package posting paths also deserve separate review: a fallback allocation initialized with `d.net` is then multiplied by a discount ratio again (`pos.service.js:444–460`).

For shared SERVICE lines, performance follows the line's primary staff and does not distribute service components as the commission allocator does. The primary staff can receive full performance attribution while other assigned staff receive none. Refunded non-void lines remain included at original amounts; estimated commission and actual collected commission also have different bases.

### F15 — Detailed Expenses removes original historical expense after later reversal

**Status: Code-confirmed.**

Locations: `reports.service.js:3052–3061`; `expenses.service.js:230–241`.

Expense reversal changes the original voucher status to REVERSED and creates a separate dated reversal voucher, also REVERSED. Detailed Expenses only adds POSTED records to totals. Thus a later reversal removes the original from its historical period totals and the reversal period does not receive a signed negative expense.

Income/Expense uses `isReversalRecord` for signed events, so the two reports can disagree. Search filtering also happens after detailed-expense totals are accumulated; visible rows and summary can differ.

### F16 — Inventory expiry calculations receive Invalid Date

**Status: Reproduced underlying date conversion; report paths code-confirmed.**

Locations: `reports.service.js:3238`, `:3798`; `dates.js` dateOnly helper.

`dateOnly` expects a YYYY-MM-DD string and appends `T00:00:00.000Z`. These paths pass the Prisma expiry Date object instead. The resulting date is invalid; daysRemaining becomes NaN and comparisons fail. Expired batches can remain marked VALID and expiry values can serialize as null.

An in-memory JavaScript check confirmed that the current conversion with a Date object produces an invalid date.

### F17 — Inventory valuation is current stock despite AS_OF metadata

**Status: Code-confirmed.**

Location: `reports.service.js:3171–3332`.

Valuation is labeled AS_OF, but reads current remainingQuantity without reconstructing stock at the selected end date. Historical date ranges therefore do not produce historical valuation. Expiry uses current business date too.

Search filters rows after value totals are calculated. Quantities and unit costs are rendered using the same two-decimal helper used for money, despite four-decimal storage; visible quantity × visible unit cost may not reproduce row value.

### F18 — Period reports disagree because they mix invoice lifetime and dated events

**Status: Code-confirmed; naming/basis decision required.**

Locations: Sales invoice query near `reports.service.js:283`; Detailed Income `:4099`; tax report and Income/Expense refund queries.

Sales and Detailed Income select invoices by invoice date, then load all linked refunds/payments regardless of those event dates. They use current lifecycle and balances. Income/Expense and Tax select refund events by refund date.

Example: January invoice refunded in February. Rerunning January Sales/Detailed Income subtracts the February refund, while January's event-based Tax/Income recognition retains the original event. February Detailed Income may not show the reversal because its original invoice is outside the selected month.

These reports cannot reliably pass unconditional cross-report equality checks until they share a basis or explicitly document different purposes.

### F19 — Detailed Income footer mixes net revenue after refunds with original tax

**Status: Code-confirmed frontend formula.**

Location: `frontend/src/features/reports/DetailedIncomeReportPage.tsx:790–796`.

Footer total is `totals.recognizedNet + totals.tax`. Recognized net already subtracts refunded revenue, while tax is original charged tax. Backend provides `totals.netTax`, but the footer does not use it.

Related filter issues: staff filters do not include package component staff; SERVICE filtering excludes CUSTOM_SERVICE; totalPaid/tips are accumulated at full invoice level before selected line filters. A product-only/staff-only report can therefore show invoice-wide payment KPIs.

### F20 — Payment Account running/closing balances depend on movement filters

**Status: Code-confirmed; display semantics need clarification.**

Location: `reports.service.js:2438–2549`.

Opening includes all prior movements, but current-period movements are filtered by direction, transactionType, and sourceModule before running balances and closing balances are calculated. Choosing IN-only removes outflows from the computed closing balance.

If displayed as actual account closing balance, this is wrong. If intended as a filtered movement subtotal, it must be labeled accordingly and separated from true balances. Search is applied later than other filters, creating another inconsistency in summary behavior.

### F21 — General Ledger date boundaries differ from Karachi reporting boundaries

**Status: Code-confirmed.**

Location: `ledger.service.js:67`, `:120–133`.

The ledger filters timestamp `createdAt` using UTC-midnight `dateOnly`. Payment Accounts uses Karachi start/end instants. For Pakistan local dates, the first five hours of the date can be assigned to opening/prior-day balances in the general ledger while included in the selected period elsewhere.

### F22 — Cash Drawer historical report uses lifetime drawer movements

**Status: Code-confirmed; report basis decision required.**

Locations: `reports.service.js:2626–2655`, `:2833–2859`.

Drawers are selected when their date or some movement is in range, but included movements are unrestricted. Row cash totals/expected balance then use all movements, including those after the selected period. The separate transaction list does filter timestamps.

This may be valid for a current full-drawer custody view, but is not a historical period closing balance. Metadata and UI need to make the distinction explicit.

### F23 — Attendance/OT report can omit standalone overtime and include unapproved hours

**Status: Code-confirmed.**

Location: `reports.service.js:3992–4064`.

With no attendance row, the first overtime record for a staff/date adds the key to recordKeys; subsequent records for the same key are skipped instead of aggregated. That can omit additional approved overtime.

The standalone branch assigns requested minutes to non-approved rows, and authorizedOtHours then sums all rows. Pending/rejected standalone OT can appear in authorized hours. KPIs are also calculated from all rows while footer totals use filtered rows.

### F24 — Commission liability report loses historical payout reversals and mixes filter scopes

**Status: Code-confirmed.**

Location: `backend/src/modules/reports/staffPay.report.js:85–166`.

Payments/opening payouts are selected only with current status COMPLETED. A later reversal can remove a prior payout from historical opening/period calculations rather than showing a dated reversal.

Source/invoice filters narrow earned/reversed rows, but opening liabilities and payouts remain broadly staff-scoped. The resulting outstanding value mixes selected-source earnings with all-source settlements and should not be presented as a reconciled filtered liability without a defined allocation policy.

### F25 — Income/Expense optional flags are not accepted by its route schema

**Status: Code-confirmed.**

Locations: `reports.routes.js` incomeExpenseQuery; `reports.service.js:1029`, `:1098`, `:1180`.

The service reads includeUnpaid, includeCommission, and includeInventoryLoss. They are absent from the declared query schema. Zod object parsing normally strips undeclared fields, so these options are not part of the validated API contract. Verify middleware behavior before designing UI around them.

## 7. Architectural observations

The inspected implementation is branch-scoped, not the tenant architecture required by AGENTS.md:

- `authenticate.js` builds req.user with id, name, email, role, branchId, staffId.
- `scope.js` locks non-super users to a branch and allows SUPER_ADMIN to query all branches.
- No tenantId/tenantContext implementation or RLS policy definitions were found in the searched backend source and migration files.
- `frontend/src/app/AppRouter.tsx:8` directly imports SuperAdminDashboard into the same frontend project.

This does not prove a deployed cross-tenant leak or establish whether the existing SUPER_ADMIN represents a platform operator versus a salon owner. It does mean tenant isolation and the required physical portal separation were not demonstrated by the inspected implementation. Do not assume that a multi-branch application is already a multi-tenant SaaS application.

Positive foundations observed: Decimal database amounts, shared money helpers, transaction-based POS posting, row locking during dues collection, snapshotted invoice/staff rates, distinct bill/tip allocations, refund cashOut versus receivable cancellation, and dated refund/commission events. The dedicated tax report preserves original recognition plus dated reversals, which is a useful existing reconciliation pattern. This is not a certification of that report's complete correctness.

## 8. Verification actually performed

Read-only repository searches and source inspection were used throughout. Git status initially showed six modified application files; the final check additionally showed the two allocator files listed in the concurrent-change notice above. This audit document is the only file intentionally created or edited by this audit agent.

In-memory Node checks used the installed backend decimal.js and Prisma Decimal types. No connection to the database was made for these checks.

Observed output:

```text
Three equal lines; payment 1.00: collected net 0.99, collected tax 0
Single staff; numeric 10%: commission 100 on net 1000
Component; numeric 10%: commission 100 on net 1000
Single staff; Prisma.Decimal(10): commission 0 on net 1000
Component; Prisma.Decimal(10): commission 0 on net 1000
Single staff; numeric 1%: commission 1000 on net 1000
Component; numeric 1%: commission 1000 on net 1000
dateOnly-style conversion of Date object: invalid
```

The existing Sales report function was also extracted in memory and executed with mocked read methods that projected fields according to the Prisma select. This was not an API/database integration test.

```text
Invoice tax 100, refunded tax 20:
  expected net tax 80; actual 60
Cash collected 1100, cash refund 220:
  expected cash 880 / online 0
  actual cash 1100 / online -220; row cash 1100
Fully voided cash invoice 1100:
  expected net cash 0
  actual cash 1100; totalPaid 0
```

The first Node attempt from the repository root could not resolve @prisma/client. Repeating from the backend directory used the installed dependencies successfully; nothing was installed or changed.

## 9. Tests inspected and why the standard suite was not run

Relevant existing tests include:

- `backend/tests/25-cash-drawer-report.test.js`
- `backend/tests/26-detailed-expenses-report.test.js`
- `backend/tests/27-inventory-report.test.js`
- `backend/tests/28-attendance-overtime-report.test.js`
- `backend/tests/29-reporting-reconciliation-gate.test.js`
- `backend/tests/30-financial-reports-suite.test.js`
- `backend/tests/tax-report-regression.test.js`
- `backend/tests/booking-report-display.test.js`

The standard Vitest config uses `tests/globalSetup.js`. That setup executes `npx prisma migrate reset --force --skip-generate` against a test-designated database. It was deliberately not run under the owner's no-change instruction. No existing test suite pass/fail claim is being made.

Inspected suite sections emphasize access control, response shapes, and cross-report parity for selected dates. They are not sufficient evidence against the demonstrated edge cases. Later regression coverage should use real Prisma Decimal values, not only numeric mocks, and deliberately exercise cross-period events and non-empty datasets.

## 10. Suggested task planning — not implementation authorization

Recommended order for the owner and next reviewer:

1. Correct the collection allocator contract: Decimal types, percentage units, exact remainder allocation. Reconcile existing commission events separately before considering any repair.
2. Correct Sales tax/tender calculations and reversal/void handling with focused fixtures.
3. Fix supplier opening double counting and branch scoping; reconcile supplier balances against the canonical ledger.
4. Remove the accountant commission-data exposure and separate commission recognition from payouts.
5. Define report bases explicitly: invoice cohort, recognition events, cash movements, payroll period, historical as-of balances.
6. Correct payroll dates, loan recovery classification, refund collection treatment, and negative-period handling.
7. Align staff performance, expense reversal history, inventory dates, ledger timezone, and frontend totals.
8. Run controlled reconciliation against a disposable database populated with representative scenarios; only then plan any additive historical-data repair.

Business questions that remain open:

- Is each report intended to be an invoice register, a period P&L, or a cash movement report?
- Should report totals follow visible filters, or should some global KPIs remain explicitly unfiltered?
- Is commission always earned on collection, and how should collected money be reallocated after partial line refunds?
- How should advances applied to invoices be displayed without implying a second cash receipt?
- How are shared supplier opening balances assigned across branches?
- Is historical stock valuation required, or should this be clearly labeled current stock?
- Are legacy payroll-linked commissions still present, and what compatibility behavior must be preserved?

Minimum regression scenarios should include partial payments, split tenders, small rounding amounts, 1% and fractional commission rates, multi-staff services, discounted packages, full/partial refunds, unpaid receivable cancellations, same-day and later-period voids, payment reversals, payroll paid in a later period, partial commission payouts, supplier opening entries, return-only periods, early-morning Karachi transactions, filtered summaries, and cross-role/branch access.

No proposed fix in this document has been applied. The next step belongs to the owner: obtain further analysis and select specific implementation tasks.
