# SalonSys — Comprehensive SaaS Conversion Roadmap
**Version:** 1.0  
**Architect:** 20-Year Veteran Principal Software Engineer & SaaS Product Builder  
**Architecture:** Dual-Portal Decoupled SaaS (Platform Master Admin + Salon Client App + Unified Backend + PostgreSQL RLS)  
**Execution Standard:** Zero-Downtime, Zero-Data-Loss, Strict Multi-Tenant Isolation

---

## Roadmap Overview

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 1: BACKEND & DATABASE SAAS TRANSFORMATION                 │
│                      (Steps 1 to 10: Existing Software & Data Isolation)               │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 2: EXISTING SALON APP ADAPTATIONS                         │
│                    (Steps 11 to 14: Tenant Shell, Dynamic Branding & Billing)          │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 3: NEW PLATFORM MASTER ADMIN PORTAL                       │
│                   (Steps 15 to 21: Dedicated SaaS Control Console & Engine)            │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 4: INTEGRATION, HARDENING & DEPLOYMENT                    │
│                      (Steps 22 to 25: RLS, Automated Tests, Runbook & Pilot)           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏛️ PART 1: EXISTING SOFTWARE BACKEND & DATABASE (Steps 1 – 14)

### Phase 1: Database Foundation & Core Backend Engine

#### Step 1: Baseline Audit & Financial Control Checkpoint
* **Objective:** Capture pre-migration baseline metrics to ensure 100% financial and data accuracy.
* **Actions:**
  * Record exact row counts across all 73 existing Prisma models.
  * Snapshot control totals: Total Invoice Revenue, Pending Customer Dues, Total Cash Drawer Float & Current Balances, Total Supplier Payables, and Stock Valuation.
  * Export a complete physical SQL backup (`salonos_pre_saas_backup.sql`).
* **Exit Criteria:** Baseline verification report committed with zero discrepancies.

#### Step 2: Additive Prisma Schema Migration (Platform & SaaS Models)
* **Objective:** Introduce SaaS control plane entities without disrupting existing tables.
* **Actions:**
  * Add models: `Tenant`, `TenantMembership`, `Plan`, `PlanVersion`, `Subscription`, `SubscriptionPayment`, and `TenantAuditEvent`.
  * Add nullable `tenantId` field to existing business models (`Branch`, `User`, `Client`, `Invoice`, `Appointment`, `Booking`, `Staff`, `CashDrawer`, `InventoryItem`, etc.).
  * Run additive migration via `npx prisma migrate dev --name add_saas_platform_tables`.
* **Exit Criteria:** New tables created in PostgreSQL 18; existing application continues running with zero errors.

#### Step 3: Zero-Loss Data Backfill Script (Legacy Tenant Provisioning)
* **Objective:** Seamlessly adopt existing salon data into the new multi-tenant architecture.
* **Actions:**
  * Create `scripts/saas-backfill-legacy-tenant.js`.
  * Provision default Tenant: `"Meerab Salon Main"` with fixed UUID `00000000-0000-0000-0000-000000000001`.
  * Provision lifetime Enterprise `PlanVersion` and link an active `Subscription` to the legacy tenant.
  * Map existing Super Admin user to `TenantMembership` with role `TENANT_OWNER`.
  * Execute safe batch updates: set `tenantId = '00000000-...'` for all existing branches, users, and transactions where `tenantId IS NULL`.
* **Exit Criteria:** Every existing record has a valid `tenantId`; financial control totals match Step 1 to the penny.

#### Step 4: Schema Strictness Enforcement & Composite Constraints
* **Objective:** Lock down data integrity at the database layer.
* **Actions:**
  * Alter `tenantId` column to `NOT NULL` on all tenant-owned models.
  * Add composite unique keys: e.g., `Branch` unique `[tenantId, code]`, `Client` unique `[tenantId, phone]`, `Sequence` unique `[tenantId, branchCode, prefix, year]`.
  * Enforce composite foreign keys on transactional tables (`Invoice` references `[tenantId, branchId]`).
* **Exit Criteria:** Prisma schema validated and deployed; foreign key cross-linking across tenants is physically rejected by the database.

#### Step 5: Express Request Context & Tenant Authentication Middleware
* **Objective:** Establish an immutable, tamper-proof tenant context for all API requests.
* **Actions:**
  * Refactor `backend/src/middleware/authenticate.js` to extract and verify `tenantId` from JWT.
  * Create `backend/src/middleware/tenantContext.js`:
    * Verifies active tenant membership and tenant lifecycle status (`ACTIVE`, `PAST_DUE`, `SUSPENDED`).
    * Resolves allowed branches for the user within that specific tenant.
    * Injects `req.tenantId`, `req.tenantRole`, and `req.allowedBranches` onto the Express request object.
  * Fail closed: Any request lacking a valid tenant context on protected routes receives HTTP 403 Forbidden.
* **Exit Criteria:** Unit tests verify that tampering with `tenantId` in request headers or body is ignored.

#### Step 6: Scoped Data Access Layer (Prisma Service Layer Scoping)
* **Objective:** Guarantee that all database queries automatically apply tenant isolation.
* **Actions:**
  * Create centralized query wrapper / Prisma extension in `backend/src/config/prisma.js`.
  * Enforce mandatory `{ where: { tenantId: req.tenantId } }` on all reads, updates, and deletes.
  * Audit and retrofit raw SQL queries and aggregate functions to include explicit `$tenantId` parameters.
* **Exit Criteria:** Zero queries executed across operational modules without explicit tenant scoping.

#### Step 7: PostgreSQL Row-Level Security (RLS) Implementation
* **Objective:** Defense-in-depth database-level isolation so even raw leaks are impossible.
* **Actions:**
  * Enable RLS on all tenant business tables: `ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;`
  * Add policies using transaction-local context:
    `CREATE POLICY tenant_isolation_policy ON "Invoice" USING ("tenantId" = current_setting('app.current_tenant_id', true)::uuid);`
  * Create a database transaction helper `withTenantContext(tenantId, async (tx) => { ... })` executing `SET LOCAL app.current_tenant_id = $1`.
* **Exit Criteria:** A query run under Tenant A's connection cannot read Tenant B's rows even with direct SELECT.

#### Step 8: Multi-Tenant Plan Quota & Feature Flag Evaluator Middleware
* **Objective:** Enforce SaaS subscription limits dynamically on backend actions.
* **Actions:**
  * Build `backend/src/middleware/requirePlanFeature.js` (e.g. `requirePlanFeature('hasBiometrics')`).
  * Build quota check interceptors:
    * Branch creation: compare current branch count against `planVersion.maxBranches`.
    * Staff creation: compare active staff count against `planVersion.maxStaff`.
  * Return structured errors with upgrade code (`PLAN_LIMIT_REACHED`) when quota is exceeded.
* **Exit Criteria:** Automated test confirms that exceeding plan quotas throws 403 with upgrade payload.

#### Step 9: Platform Control Plane APIs (`/api/v1/platform/*`)
* **Objective:** Expose secure management endpoints for the new Platform Master Admin Portal.
* **Actions:**
  * Create module `backend/src/modules/platform/`:
    * `platform.auth.js`: Dedicated credentials & JWT for Platform Super Admins.
    * `platform.tenants.controller.js`: Create new salon (atomic transaction: Tenant + Owner User + Default Branch + Subscription).
    * `platform.plans.controller.js`: Create/list/update SaaS plans and pricing tiers.
    * `platform.payments.controller.js`: List pending renewal slips and execute 1-click verification.
    * `platform.analytics.controller.js`: Compute MRR, active tenants count, churn rate, and expiring subscriptions.
* **Exit Criteria:** Protected with `requirePlatformAdmin` guard; salon users cannot reach these endpoints.

#### Step 10: Tenant Billing & Proof Submission APIs (`/api/v1/tenant/billing/*`)
* **Objective:** Enable salon owners to view their subscription status and upload renewal payment receipts.
* **Actions:**
  * Create module `backend/src/modules/billing/`:
    * `GET /api/v1/tenant/billing/status`: Returns active plan, renewal date, and branch/staff quota usage meters.
    * `POST /api/v1/tenant/billing/submit-payment`: Accepts amount, transaction reference, and uploaded screenshot slip; creates `SubscriptionPayment` in `PENDING_VERIFICATION` state.
    * `GET /api/v1/tenant/billing/invoices`: Returns historical billing receipts.
* **Exit Criteria:** Salon owner can query billing status and submit payment slips securely.

---

### Phase 2: Existing Salon App (`frontend`) SaaS Adaptations

#### Step 11: Dynamic Tenant Identity & Header Branding
* **Objective:** Ensure the salon app dynamically displays the authenticated salon's business identity.
* **Actions:**
  * Update `frontend/src/context/AuthContext.tsx` to store `tenant: { id, name, logoUrl }` alongside user info.
  * Update `AppHeader.tsx` to render the salon's name and logo, with the multi-branch dropdown scoped strictly to the current tenant's branches.
* **Exit Criteria:** Logging in as different salons immediately reflects their respective brand identity in the header.

#### Step 12: Salon Owner Subscription & Quota Usage Dashboard (`/settings/billing`)
* **Objective:** Provide salon owners with full transparency into their subscription.
* **Actions:**
  * Create `frontend/src/features/billing/SalonBillingPage.tsx`.
  * Render Plan Details card: Active Plan Name, Billing Cycle (Monthly/Annual), and Next Renewal Date.
  * Render Usage Meters: Branch usage progress bar (e.g. `2 / 3 Branches`), Staff usage progress bar (e.g. `14 / 20 Staff`).
* **Exit Criteria:** Screen displays live metrics from `/api/v1/tenant/billing/status` with polished Frosted Glass UI.

#### Step 13: Manual Payment Slip Upload Flow (Pakistan Localized)
* **Objective:** Frictionless renewal payments via Bank Transfer, JazzCash, or EasyPaisa.
* **Actions:**
  * Add payment instructions modal with SaaS official bank IBAN, Account Title, and JazzCash/EasyPaisa Till details.
  * File upload component with instant image preview for payment receipt screenshots.
  * Status badge: Displays `Pending Verification` with submission timestamp and transaction reference ID.
* **Exit Criteria:** Uploading a slip posts to `/api/v1/tenant/billing/submit-payment` and switches UI state to awaiting review.

#### Step 14: Grace Period Warning Banners & Suspension Lock Modal
* **Objective:** Graceful handling of expired subscriptions without sudden data lockouts.
* **Actions:**
  * Amber Banner: Displays when subscription is in grace period (`"Your subscription renewed on [Date]. Please renew before [Grace End Date] to avoid interruption."`).
  * Hard Lock Modal: If `status === 'SUSPENDED'` or past grace period, overlay a non-dismissible modal: *"Account Suspended — Please contact billing"*, leaving historical reports accessible in read-only mode while disabling POS/Booking buttons.
* **Exit Criteria:** Inactive/expired tenant cannot post new invoices or appointments.

---

## 🌐 PART 2: NEW SOFTWARE — PLATFORM MASTER ADMIN PORTAL (Steps 15 – 21)

### Phase 3: Dedicated SaaS Control Console (`platform-portal`)

#### Step 15: Scaffold Dedicated React 19 + Vite Platform Application
* **Objective:** Create the physically decoupled Master Admin Frontend.
* **Actions:**
  * Scaffold `platform-portal/` at workspace root: React 19 + TypeScript + Vite 8 + Tailwind CSS + Lucide Icons.
  * Configure separate dev port: `3002` (leaving salon app on `3001` and backend on `5000`).
  * Setup modern administrative UI layout: Collapsible dark-mode ready sidebar, top status bar, metrics grid, and dense data tables.
* **Exit Criteria:** `npm run dev` in `platform-portal` boots independently on `http://localhost:3002`.

#### Step 16: Platform Admin Authentication & Session Management
* **Objective:** Secure access exclusively for SaaS Platform Owners and Operations staff.
* **Actions:**
  * Create `platform-portal/src/features/auth/PlatformLoginPage.tsx`.
  * Implement auth store with dedicated Platform JWT management, automatic token refresh, and idle session timeouts.
  * Route Guards: Redirect any non-platform-admin access attempts with immediate session revocation.
* **Exit Criteria:** Only users with `PLATFORM_ADMIN` credentials can log in to Portal 1.

#### Step 17: Platform Executive Dashboard (MRR & Health Overview)
* **Objective:** Central command center for the SaaS business owner.
* **Actions:**
  * KPI Cards: Total Active Salons, Monthly Recurring Revenue (MRR in PKR), Total Branches across all salons, and Subscriptions Expiring in 7 Days.
  * Attention Center: Badge counter showing pending manual payment slips requiring review.
  * Quick Actions: "Onboard New Salon", "Create Custom Plan", "Broadcast Maintenance Notice".
* **Exit Criteria:** Dashboard live-loads key metrics from `/api/v1/platform/analytics`.

#### Step 18: Tenant Management & 1-Click Client Onboarding Wizard
* **Objective:** Rapidly onboard new paying salon clients with custom plans.
* **Actions:**
  * Onboarding Wizard Form:
    * Step 1: Salon Details (Business Name, City, Primary Contact, Logo).
    * Step 2: Owner User Account (Name, Email, Initial Password / Send Activation Email).
    * Step 3: Branch Setup (Name of first branch, City, Currency default PKR).
    * Step 4: Plan Assignment (Dropdown of published plans: Starter, Growth, Enterprise).
  * Tenant List Table: Filter by status (`ACTIVE`, `TRIAL`, `PAST_DUE`, `SUSPENDED`), search by name/city, and instant toggle to suspend/reactivate a salon.
* **Exit Criteria:** Submitting wizard successfully provisions the tenant and generates owner credentials immediately.

#### Step 19: SaaS Plans & Feature Limit Configuration Engine
* **Objective:** Visually create and update subscription plans without touching database code.
* **Actions:**
  * Create `platform-portal/src/features/plans/PlansManagerPage.tsx`.
  * Plan Editor Drawer:
    * Plan Name & Code (e.g. `STARTER`, `GROWTH`, `ENTERPRISE`).
    * Pricing inputs: Monthly Price (PKR), Annual Price (PKR).
    * Quota sliders: Max Branches, Max Staff, Max Devices.
    * Feature Toggles: Biometric Attendance, Advanced Payroll/Commission, WhatsApp Notifications, Custom Tax Rules.
  * Versioning logic: Updating a plan creates an immutable `PlanVersion` so existing subscribed salons remain unaffected until explicitly migrated.
* **Exit Criteria:** Creating a plan in Portal 1 makes it instantly selectable during salon onboarding.

#### Step 20: Manual Payment Verification Inbox & Slip Inspector
* **Objective:** Frictionless verification of Pakistani local payment slips (JazzCash / EasyPaisa / Bank Transfer).
* **Actions:**
  * Create `platform-portal/src/features/payments/PaymentVerificationPage.tsx`.
  * Table of pending payments: Salon Name, Amount, Claimed Transaction Reference, Submission Date.
  * Slip Review Modal:
    * High-resolution image zoom for payment receipt screenshot.
    * Form inputs: Verifying Admin Notes, Bank Account Reconciled.
    * Action Buttons: **Approve & Activate** (immediately sets subscription to `ACTIVE` and pushes expiry by 1 month/year), or **Reject** (with mandatory reason sent to salon owner).
* **Exit Criteria:** Approving a slip immediately reflects in Portal 2 as active with no delay.

#### Step 21: Audited Support Impersonation & Tenant Lifecycle Controls
* **Objective:** Enable customer support to assist salons while maintaining rigorous security audits.
* **Actions:**
  * "Enter Support Mode": Generates a short-lived (15 min) audited session token allowing read-only access to a specific salon's dashboard.
  * Audit Log: Logs every impersonation with Admin User ID, Target Tenant ID, Reason, and IP address.
  * Emergency Controls: "Lock All Branches", "Force Password Reset for Salon Owner".
* **Exit Criteria:** Every support action is logged in `TenantAuditEvent` with complete actor traceability.

---

## 🔒 PART 3: INTEGRATION, TESTING & DEPLOYMENT (Steps 22 – 25)

### Phase 4: Hardening, Automated Testing & Production Pilot

#### Step 22: Dual-Portal Cross-Origin & Routing Integration
* **Objective:** Seamless local development and staging orchestration.
* **Actions:**
  * Update root `package.json` with unified scripts:
    * `npm run dev:backend` (Port 5000)
    * `npm run dev:salon` (Port 3001)
    * `npm run dev:platform` (Port 3002)
    * `npm run dev:all` (Concurrently launches all 3 services).
  * Configure Express CORS policy to permit origins: `localhost:3001` (Salon App) and `localhost:3002` (Platform Portal).
* **Exit Criteria:** All three applications run simultaneously in local dev without port or CORS conflicts.

#### Step 23: Multi-Tenant Isolation & Anti-Spoofing Automated Test Suite
* **Objective:** Mathematically prove that no tenant can access another tenant's data.
* **Actions:**
  * Create integration test suite `backend/tests/saas-isolation.test.js`.
  * Test Case 1: Tenant A authenticates and attempts to read Tenant B's invoices using direct IDs ➔ Expect 404 / 403.
  * Test Case 2: Injected spoofed `tenantId` in request body/query is strictly ignored by middleware.
  * Test Case 3: Same invoice number (`INV-0001`) generated concurrently for Tenant A and Tenant B ➔ Both succeed without collision.
  * Test Case 4: Salon staff attempts to access Platform Admin APIs ➔ Expect 403 Forbidden.
* **Exit Criteria:** 100% of isolation and authorization test cases pass.

#### Step 24: Financial Invariant & POS Regression Verification
* **Objective:** Guarantee that existing complex salon logic remains 100% intact.
* **Actions:**
  * Run end-to-end POS invoice test: Custom Service + Package Component + Split Payment (Cash + Bank) + Line Discount.
  * Run Bridal Booking advance commitment & refund test: Advance liability recognized, net dues reconciled upon POS checkout.
  * Run Cash Custody test: Cashier drawer float, drawer transfer, and end-of-shift cash settlement.
  * Run Payroll Run test: Monthly salary + commissions + tip payout minus advance recovery.
* **Exit Criteria:** All calculations match existing production numbers with zero precision loss.

#### Step 25: Production VPS Deployment Runbook & Pilot Staging
* **Objective:** Deploy production-ready architecture to Linux VPS (Nginx + PostgreSQL 18 + Node).
* **Actions:**
  * Nginx configuration:
    * `admin.salonos.com` ➔ Proxies to Portal 1 (`platform-portal` build).
    * `app.salonos.com` ➔ Proxies to Portal 2 (`frontend` build).
    * `api.salonos.com` ➔ Proxies to Node.js backend.
  * Automated off-server PostgreSQL backup script with daily retention.
  * Onboard first pilot salon alongside legacy Meerab Salon to verify dual-tenant live operation.
* **Exit Criteria:** Pilot salon operating live in production with 100% data isolation and zero regressions.

