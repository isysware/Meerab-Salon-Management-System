# MEERUB SALON MANAGEMENT SYSTEM
# FINANCIAL REPORTING — REQUIREMENTS & COMPLIANCE AUDIT

**Document Type:** Financial Reporting Requirements & Audit Reference  
**Source:** Salon Final PnL Collection Performance NET SALES  
**Purpose:** Existing application ko financial reporting requirements ke against analyze karna.

---

## 1. ACCOUNTING P&L (ACCRUAL)

Accounting P&L salon ki actual profitability show karega.

Service/package completion aur product delivery par discounted net revenue recognize hoga. Customer ki partial ya subsequent payment same sale ko dobara recognize nahi karegi.

Tax aur customer-funded staff tips P&L se bahar liabilities hain.

### 1.1 Operating Revenue

- Service Sales (net after discount)
- Package Sales (net after discount)
- Retail Product Sales (net after discount)
- Less: Valid Sales Refunds / Reversals (net of tax and tips)

**A = Total Net Revenue**

Formula:

A = Net Service Sales + Net Package Sales + Net Retail Product Sales − Valid Refunded/Reversed Net Sales

Discounts already net selling amounts mein included honge. Separate discount deduction dobara nahi hogi.

### 1.2 Cost of Sales (COGS)

- Retail Product Cost of Units Sold
- Salon Consumable Material Used
- Less: Valid Returned Product Cost Reversals

**B = Total Cost of Sales**

Formula:

B = Cost of Retail Units Sold + Direct Salon Materials Consumed − Valid Returned Product Cost Reversals

Retail COGS actual posted inventory cost se calculate hoga, selling price se nahi.

Salon consumables ki cost actual posted stock consumption aur recorded batch/unit cost se calculate hogi.

Resalable returns original COGS reverse karenge. Damaged returns ko separate policy ke mutabiq handle kiya jayega.

### 1.3 Gross Profit

Gross Profit = A − B

### 1.4 Operating Expenses

- Staff Salaries + Daily Wages (earned/incurred)
- Staff Commission Expense (earned on eligible collections)
- Rent & Utilities (incurred)
- Other Operating Expenses (including depreciation if applicable)
- Inventory Damage / Write-offs (only if not already counted in COGS)

**C = Total Operating Expenses**

### 1.5 Net Operating Profit

Net Operating Profit = A − B − C

Operating Profit Margin % = (Operating Profit / A) × 100

When A = 0, margin should display N/A.

### 1.6 Accounting Safeguards

- Salary/wage payable is recognized when incurred, not when paid.
- Commission is recognized when contractually earned on eligible collections.
- Later commission payment settles the liability; it must not create another P&L expense.
- Tax and voluntary staff tips are excluded from operating revenue and expense.
- The same salary or expense must not be counted twice through payroll and expense vouchers.
- Inventory write-offs must appear in only one P&L category.

---

## 2. COLLECTION-BASED PERFORMANCE

This is an operational management statement based on actual discounted net customer collections and operating expenses actually paid.

**It is NOT a second Accounting P&L and NOT the company's total cash/bank balance.**

### 2.1 Net Operating Collections

- Collected Service Revenue (net of discount, tax and tips)
- Collected Package Revenue (net of discount, tax and tips)
- Collected Retail Product Revenue (net of discount and tax)
- Less: Refunded Collected Net Revenue

**R = Total Net Operating Collections**

### 2.2 Tax & Staff Tips — Receipt Breakdown

- Sales Tax Collected (net of refunded tax)
- Staff Tips Collected (net of refunded tips)

Total Customer Receipts = R + Tax + Tips

Tax and tips are informational receipt components, not salon operating revenue.

### 2.3 Paid Operating Expenses

- Paid Daily Wages + Salaries
- Paid Staff Commissions
- Paid Rent & Utilities
- Other Paid Operating Expenses

**D = Total Paid Operating Expenses**

### 2.4 Collection-Based Surplus

Collection-Based Operating Surplus = R − D

Collection Surplus Ratio % = ((R − D) / R) × 100

When R = 0, ratio should display N/A.

### 2.5 Other Cash Movements — Memo Only

Display separately:

- Supplier Inventory Payments / Supplier Advances
- Sales Tax Remitted / Staff Tips Paid
- Loans
- Internal Transfers
- Account Settlements
- Other non-operating cash movements

These must not be treated as customer revenue or operating expenses.

### 2.6 Information Only — Not Deducted

- COGS
- Unpaid Earned Commission
- Outstanding Customer Dues
- Supplier/Other Payables

---

## 3. PARTIAL PAYMENT ALLOCATION RULES

Actual payments are allocated to discounted revenue, sales tax and staff tips by payment date.

### 3.1 Invoice Components

S = Discounted Net Sale

T = Applicable Invoice Tax

G = Recorded Voluntary Tip

B = S + T + G

For partial payment P, without a specifically assigned allocation:

Collected Sale = P × S / B

Collected Tax = P × T / B

Collected Tip = P × G / B

### 3.2 Example — Partial Payment With Tax

Net Sale = PKR 1,000

Tax 10% = PKR 100

Total Bill = PKR 1,100

First Payment = PKR 500

- Collected Net Sale: 454.55
- Collected Tax: 45.45
- Commission at 10%: 45.46

Second Payment = PKR 600

- Collected Net Sale: 545.45
- Collected Tax: 54.55
- Commission at 10%: 54.54

Final totals:

- Net Sale: 1,000
- Tax: 100
- Commission: 100

The second payment must not recognize a second sale.

### 3.3 Example — Discount Before Tax

Original Sale: PKR 1,000

Discount: PKR 200

Net Sale: PKR 800

Tax 10%: PKR 80

Total Bill: PKR 880

First Payment 500:

- Net Sale Collection: 454.55
- Tax Collection: 45.45
- Commission: 45.46

Second Payment 380:

- Net Sale Collection: 345.45
- Tax Collection: 34.55
- Commission: 34.54

Final totals:

- Net Sale: 800
- Tax: 80
- Commission: 80

### 3.4 Example — Tip With Partial Payment

Discounted Sale = PKR 800

Tax = PKR 80

Voluntary Tip = PKR 120

Total Bill = PKR 1,000

First Payment 500:

- Sale Collection: 400
- Tax Collection: 40
- Tip Collection: 60
- Commission at 10%: 40

Second Payment 500:

- Sale Collection: 400
- Tax Collection: 40
- Tip Collection: 60
- Commission at 10%: 40

Final totals:

- Sale: 800
- Tax: 80
- Tip: 120
- Commission: 80

Tips must never be treated as salon revenue or commission-eligible sales.

### 3.5 Rounding Rules

Use cumulative invoice allocation and subtract previous allocations.

Residual rounding differences must be assigned to the final installment.

If payment is explicitly identified as a tip, allocate that part directly to tip instead of proportional allocation.

Use saved historical invoice rates and discount snapshots.

---

## 4. DISCOUNT POLICY

POS must store:

Net Sale = Original/List Selling Price − Valid Discount

The discount may be fixed or percentage-based.

The P&L must use final discounted net amounts directly.

Do not subtract discounts again from already discounted revenue.

For invoice-level discounts, allocate once to eligible invoice lines using the approved proportional or specifically attributable method.

Tax and commission must use their respective eligible discounted bases.

---

## 5. PACKAGE SALES & MULTIPLE STAFF

Package commission allocation must use configured component/staff weights, not simply the number of assigned staff.

Example:

Package List Price = PKR 1,200

Discount = PKR 200

Net Package Sale = PKR 1,000

Tax 10% = PKR 100

Invoice Total = PKR 1,100

Staff allocation:

- Staff A: 60%
- Staff B: 40%

On full collection:

- Staff A eligible sale: 600; commission at 10% = 60
- Staff B eligible sale: 400; commission at 10% = 40

On partial payment PKR 550:

- Collected net sale: 500
- Tax: 50
- Staff A allocated sale: 300; commission: 30
- Staff B allocated sale: 200; commission: 20

On the remaining PKR 550 collection, the remaining commission is earned.

Package revenue must be recognized only once.

---

## 6. INVENTORY, SUPPLIERS & COGS

### 6.1 Stock Purchase

Example:

10 bottles purchased at PKR 200 each.

Purchase Value = PKR 2,000

This is inventory asset value, not immediate P&L expense.

### 6.2 Retail Sale

2 bottles sold.

Retail COGS = 2 × 200 = PKR 400

### 6.3 Salon Consumption

3 bottles used in salon treatments.

Salon Consumable COGS = 3 × 200 = PKR 600

### 6.4 Remaining Inventory

Remaining stock = 5 bottles

Closing Stock Value = PKR 1,000

### 6.5 Supplier Payments

Supplier cash payments and payable settlements are cash/account movements, not additional COGS or operating expenses.

### 6.6 Returns

- Resalable returned products restore stock and reverse original COGS.
- Damaged returns follow approved write-off handling.
- Purchase returns and supplier refunds must not create customer revenue.
- Posted inventory costs and historical snapshots must remain unchanged.

---

## 7. BOOKING ADVANCE & POS INTEGRATION

**Additional requirement based on the current Booking Advance workflow. This section was not part of the original five-page blueprint.**

### 7.1 Advance Collection

When a customer pays an advance before service delivery:

- Record the actual cash/online receipt.
- Create a unique Booking Payment Receipt (BPR).
- Link the payment to the booking and customer.
- Preserve date, amount, method, account and collecting user.
- Track the customer advance as a liability until appropriately applied/earned.
- Do not recognize service revenue merely because an advance was received.
- Do not calculate additional tax solely from collecting an advance; preserve applicable tax rules.

### 7.2 Multiple Advance Installments

Example:

Booking Value: PKR 10,000

First Advance: PKR 3,000

Second Advance: PKR 2,000

Total Advance Received: PKR 5,000

Remaining Booking Balance: PKR 5,000

Each installment must have its own payment record and receipt.

The second receipt must show PKR 2,000 as the new payment, not PKR 5,000 cumulative.

### 7.3 Booking-to-POS Handoff

Example:

Final Invoice: PKR 10,000

Previously Received Advance: PKR 5,000

New POS Payment: PKR 5,000

Expected:

- Original Invoice Value: 10,000
- Advance Applied: 5,000
- Actual New POS Collection: 5,000
- Total Customer Collections: 10,000
- Remaining Dues: 0

The applied advance must not create a second cash receipt.

### 7.4 Income & Expense

Display each actual advance collection separately.

Example:

- BPR Receipt: +5,000
- POS Receipt: +5,000
- Total Customer Collections: 10,000

Invoice revenue remains 10,000.

Never report 15,000 collections for this example.

### 7.5 Detailed Income

Display individual Booking Advance collections and refunds, including:

- BPR receipt number
- Booking reference
- Customer
- Date/time
- Payment method/account
- Collected by
- Actual received/refunded amount

Distinguish customer deposit receipts from earned service revenue.

The report must not count the same advance again when it is applied to the final invoice.

### 7.6 P&L Advance Visibility

Booking Advances must be visible in a separate informational section:

**Customer Advances & Deposit Movements (Non-P&L)**

Include:

- Opening Advance Liability
- Advances Received
- Advance Refunds
- Advances Applied to Final Invoices
- Closing Advance Liability

Closing Advance Liability = Opening + Advances Received − Advance Refunds − Advances Applied

Include transaction-level debit/credit history where available.

Advance liability movements must not alter existing P&L revenue, COGS, tax, expenses or profit.

### 7.7 Booking Service Status vs Payment Status

Booking service completion and customer payment clearance must remain independent.

A completed service may still have outstanding customer dues.

Do not automatically equate payment clearance with service completion.

---

## 8. REPORTING FILTERS & EXPORTS

Existing reporting functionality should support the authorized combinations of:

- Branch
- Date range
- User/collecting staff
- Payment method/account
- Income source
- Payment status
- Transaction lifecycle

Exports:

- PDF
- Excel/CSV
- Print

Exports must reconcile with on-screen report figures and reflect applied filters.

Reports must use actual transaction dates appropriate to their purpose.

---

## 9. FINANCIAL INTEGRITY RULES

1. Every posted transaction must be attributable to the actual logged-in user.
2. Financial reports must use canonical posted transactions.
3. Refunds and reversals must preserve original transaction history.
4. The same payment must never be counted twice.
5. Invoice revenue and actual cash collections must remain separate concepts.
6. Account Settlements are custody transfers, not revenue or expense.
7. Supplier payments are not operating expenses.
8. Staff commission payments must not duplicate previously accrued commission expense.
9. Tips are not salon revenue.
10. Tax collected is not salon revenue.
11. Inventory purchase value must not be treated as immediate COGS.
12. Historical financial snapshots must remain unchanged after master data updates.
13. Branch and user permissions must be enforced by the backend.
14. All reports must reconcile to their canonical transaction sources.

---

## 10. ACCEPTANCE TEST SCENARIOS

| ID | Scenario | Expected Result |
|---|---|---|
| FIN-01 | Service 1,000, discount 200 | P&L net sale 800 |
| FIN-02 | Net sale 1,000, tax 100, paid 500 + 600 | Revenue 1,000 once; tax 100 |
| FIN-03 | Discounted sale 800, tax 80, paid 500 + 380 | Net sale 800; tax 80 |
| FIN-04 | Sale 800, tax 80, tip 120 | Tip excluded from revenue/commission |
| FIN-05 | Package net 1,000, two staff 60/40 | Correct weighted commission allocation |
| FIN-06 | Purchase 10 bottles at 200 | Inventory asset 2,000; no immediate P&L expense |
| FIN-07 | Sell 2 bottles, consume 3 | Retail COGS 400; salon COGS 600 |
| FIN-08 | Supplier payment | No duplicate COGS/operating expense |
| FIN-09 | Account Settlement | No additional customer revenue |
| FIN-10 | Commission earned, then paid | No duplicate P&L commission expense |
| FIN-11 | Booking 10,000, advance 5,000, POS 5,000 | Total actual collections 10,000 |
| FIN-12 | Booking fully prepaid 10,000 | POS new collection 0 |
| FIN-13 | Booking advance refunded | Correct reversal and liability reduction |
| FIN-14 | Advance in one month, final invoice next month | Correct period-based collection and revenue reporting |
| FIN-15 | Completed service with unpaid dues | Service completed; payment status outstanding |
| FIN-16 | Refund of resalable product | Correct stock restoration and original COGS reversal |

---

## 11. AGENT IMPLEMENTATION AUDIT REQUIREMENTS

Antigravity must analyze the current complete application against every requirement in this document.

For each requirement, report:

- Requirement ID
- Expected behavior
- Current implementation
- PASS / PARTIAL / FAIL / NOT IMPLEMENTED / NOT VERIFIED
- Frontend file and function
- Backend file and function
- Database source/model
- Evidence from actual code
- Existing test coverage
- Financial risk
- Recommended minimal correction

### Required Audit Areas

1. Accounting P&L
2. Collection-Based Performance
3. Income & Expense
4. Detailed Income
5. Booking Advance integration
6. POS invoice and payment allocation
7. Tax and tips
8. Discounts
9. Staff commission and packages
10. Inventory and COGS
11. Supplier payments and refunds
12. Customer refunds and reversals
13. Cash custody and Account Settlements
14. Branch/user authorization
15. Date filters and exports

### Compliance Scoring

Calculate overall compliance using verified requirements.

Report:

- Fully compliant requirements
- Partially compliant requirements
- Failed requirements
- Missing requirements
- Unverified requirements
- Overall verified compliance percentage

Do not count unverified behavior as passed.

Identify critical financial risks separately from cosmetic UI issues.

---

## 12. STRICT AUDIT RESTRICTIONS

This is a READ-ONLY audit.

Antigravity must NOT:

- Modify existing code
- Change accounting formulas
- Rewrite report calculations
- Modify database records
- Reset or migrate the database
- Modify tests
- Refactor unrelated modules
- Push changes to GitHub

The agent must provide the complete evidence-based gap analysis first.

**No implementation or fixes without explicit approval.**