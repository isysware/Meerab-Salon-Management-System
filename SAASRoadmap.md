# SalonSys — Enterprise Multi-Tenant SaaS Conversion Roadmap
**Version:** 2.0 (Audit-Gated & Principal Engineering Release)  
**Governing Standard:** `AGENTS.md` (Principal SaaS Engineering & Defensive Architecture Guidelines)  
**Architecture Pattern:** Decoupled Frontends (Platform Master Admin + Salon Client App) + Unified Express Backend + Shared PostgreSQL with Defense-in-Depth RLS  
**Non-Negotiable Invariants:** Zero Data Loss, Zero Balance Drift, Continuous Audit Gates, Shift-Left Automated Verification

---

## 🧭 Foundational Governance & Implementation Sequence

This roadmap replaces speculative implementation shortcuts with an **audit-gated, verification-first sequence**. No phase begins until the prior phase's acceptance gate is proven by automated tests and reconciled control totals.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 0: COMPREHENSIVE REPOSITORY & DATA AUDIT                  │
│                     (Gate 0: Full model classification & baseline snapshot)            │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 1: TENANT MAPPING & CONDITIONAL SCHEMA EXPANSION               │
│                    (Gate 1: Additive schema & audited backfill rehearsal)              │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 2: MEMBERSHIP, CONTEXT & SCOPED DATA ACCESS LAYER              │
│                (Gate 2: Active membership enforcement & negative security tests)       │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 3: POSTGRESQL ROW-LEVEL SECURITY (DEFENSE-IN-DEPTH)            │
│                     (Gate 3: Non-owner DB role & transaction-local RLS proof)          │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 4: PLANS, LIMITS & TRANSACTIONAL BILLING ENGINE                │
│                 (Gate 4: Server quota blocks & idempotent payment allocation)          │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 5: DUAL-FRONTEND DELIVERY (SALON UI + PLATFORM PORTAL)         │
│                 (Gate 5: Clean bundle seclusion & zero platform leakage in client)     │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 6: SCOPED WORKERS, ASSETS & RECOVERY CONTROLS                  │
│                   (Gate 6: Tenant-safe background jobs, private storage & PITR)        │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 7: HARDENING, REGRESSION & STAGED PILOT ONBOARDING             │
│                 (Gate 7: Synthetic second tenant trial & business reconciliation)      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 PHASE 0: COMPREHENSIVE REPOSITORY & DATA AUDIT

### Step 1: Runtime Environment & Dependency Verification
* **Objective:** Establish verified ground-truth facts of the runtime stack before touching code.
* **Actions:**
  * Execute version verification on the active server: Node.js runtime, installed Prisma version (from lockfile), PostgreSQL server version, and client build tools.
  * Check active database connection pool settings, available SSL configuration, and environment variable bindings.
* **Deliverable:** Environment verification log signed off against `package-lock.json` and PostgreSQL `version()`.
* **Acceptance Gate:** No package upgrades initiated; system pinned to verified installed versions (`Prisma 5.22.x`, `PostgreSQL 18.x`, `Node 24.x`).

### Step 2: Comprehensive Prisma Data Model Classification Inventory
* **Objective:** Classify every single model in the schema into an explicit ownership tier. No table left unclassified.
* **Actions:**
  * Audit all schema models and partition them into 5 strictly defined tiers:
    1. **Platform / SaaS Control Plane:** Models belonging solely to SaaS operations (`Plan`, `PlanVersion`, `Subscription`, `SubscriptionPayment`, `PlatformUser`, `PlatformAudit`).
    2. **Global / Shared Reference:** Global immutable references (`SystemSetting` - explicitly allowlisted).
    3. **Tenant-Scoped Entities:** Models belonging directly to a salon business (`Tenant`, `TenantMembership`, `Branch`, `ServiceCategory`, `Service`, `Package`, `Client`, `Supplier`, `PaymentAccount`).
    4. **Branch-Scoped Operational Entities:** Location-specific operational transactions (`CashDrawer`, `DrawerMovement`, `InventoryBatch`, `StockMovement`, `Appointment`, `Booking`, `Invoice`, `InvoiceLine`, `InvoicePayment`, `AttendanceRecord`, `PayrollRun`).
    5. **Derived / Ephemeral Entities:** Tokens, sequences, and idempotency records (`Sequence`, `IdempotencyKey`, `RefreshToken`).
* **Deliverable:** `artifacts/DATA_CLASSIFICATION_MATRIX.md` mapping every entity, foreign key, and access pattern.
* **Acceptance Gate:** 100% of Prisma models classified; zero ambiguous tables.

### Step 3: Financial Baseline & Control Total Checkpoint
* **Objective:** Capture pre-migration financial invariants to guarantee zero drift.
* **Actions:**
  * Build an automated read-only script `scripts/audit-control-totals.js` that calculates:
    * Total Invoices Count & Net Invoiced Volume (Gross - Discounts + Taxes).
    * Total Collections by Payment Method (Cash, Bank, Online Accounts).
    * Pending Client Receivables (Unpaid + Partial Invoices).
    * Active Bridal/Groom Booking Advance Liabilities (Held vs Applied vs Refunded).
    * Total Cash Drawer Balances across all branch drawers (`OPEN` and `SETTLED`).
    * Total Supplier Ledger Payables and Current Inventory Valuation.
  * Execute physical database backup and verify dump file integrity on disk.
* **Deliverable:** `artifacts/BASELINE_FINANCIAL_TOTALS.json` containing cryptographic hash and control totals.
* **Acceptance Gate:** Backup restorable on staging; control totals documented and verified before any DDL is executed.

---

## 🏛️ PHASE 1: TENANT MAPPING & CONDITIONAL SCHEMA EXPANSION

### Step 4: Business Ownership Audit & Legacy Tenant Mapping Strategy
* **Objective:** Verify whether the current database contains records of a single company or multiple businesses.
* **Actions:**
  * Query distinct branch identifiers, legal entities, tax registration numbers, and user distribution across branches.
  * **Conditional Branching:**
    * *Condition A (Single Company):* If all branches belong to the same existing business (e.g. Meerab Salon branches), map all existing branches to one legacy Tenant record with dynamically generated UUID (never hardcoded).
    * *Condition B (Multiple Independent Businesses):* If distinct branches represent legally separate salons, HALT automatic single-tenant backfill immediately. Construct an explicit mapping table (`branchId` ➔ `targetTenantId`) with business stakeholder sign-off before proceeding.
* **Deliverable:** Verified tenant mapping specification signed off before migration scripts are written.
* **Acceptance Gate:** Explicit proof that no distinct businesses are accidentally merged into a single tenant ID.

### Step 5: Additive Schema Migration (Expand Phase)
* **Objective:** Introduce multi-tenant structures without breaking running services or dropping columns.
* **Actions:**
  * Add core SaaS models:
    * `Tenant` (`id` UUID, `name`, `slug` unique, `status`, `currency`, `timezone`, `createdAt`).
    * `TenantMembership` (`tenantId`, `userId`, `role`, `status`, unique `[tenantId, userId]`).
    * `Plan`, `PlanVersion` (immutable versioning), `Subscription`, `SubscriptionPayment`, `TenantAuditEvent`.
  * Add `tenantId` (as **NULLABLE**) to all tenant-scoped and branch-scoped models identified in Step 2.
  * Add non-destructive composite indexes on critical lookups: e.g. `[tenantId, createdAt]`, `[tenantId, branchId]`.
  * Note: `User` table remains an authentication identity; company access is granted strictly through `TenantMembership`.
* **Deliverable:** Reversible Prisma migration file generated via `prisma migrate dev --create-only`.
* **Acceptance Gate:** Migration applies cleanly on a restored staging clone; existing application reads and writes succeed with zero downtime.

### Step 6: Verified Data Backfill & Rehearsal
* **Objective:** Backfill tenant ownership safely in restartable batches with checkpointing.
* **Actions:**
  * Create `scripts/saas-backfill-executor.js`:
    * Step A: Provision the audited legacy tenant record(s) and create `TenantMembership` for all existing users with appropriate roles (`TENANT_OWNER`, `TENANT_ADMIN`, `STAFF`).
    * Step B: Associate the legacy tenant with an audited initial `Subscription` and approved legacy plan version matching their existing capabilities.
    * Step C: Backfill `tenantId` in batches on parent tables (`Branch`, `Client`, `Supplier`, `ServiceCategory`, `Staff`).
    * Step D: Backfill child and transactional records using parent relationships to guarantee consistency.
  * Execute pre-enforcement reconciliation:
    * Query `COUNT(*)` where `tenantId IS NULL` across all audited tables (must be 0).
    * Re-run `scripts/audit-control-totals.js` and compare against Baseline (Step 3).
* **Deliverable:** Backfill execution log proving 100% assignment and zero financial variance.
* **Acceptance Gate:** Reconciled control totals match baseline to the penny; test executed twice on clean clones.

### Step 7: Schema Strictness Enforcement (Enforce Phase)
* **Objective:** Enforce non-nullable ownership and composite constraints at the engine level.
* **Actions:**
  * Create additive migration to alter `tenantId` to `NOT NULL` on all verified tenant business tables.
  * Implement composite unique constraints for scoped uniqueness:
    * `Branch`: unique `[tenantId, code]`.
    * `Client`: unique `[tenantId, phone]`.
    * `Sequence`: unique `[tenantId, branchCode, prefix, year]`.
  * Enforce composite foreign keys on critical parent-child relationships where cross-tenant linking must be physically impossible:
    * `Invoice`: foreign key `[tenantId, branchId]` references `Branch([tenantId, id])`.
    * `Booking`: foreign key `[tenantId, clientId]` references `Client([tenantId, id])`.
* **Deliverable:** Enforced schema migration deployed to staging.
* **Acceptance Gate:** Attempting to insert a child record with a mismatched parent `tenantId` is rejected with a foreign key violation.

---

## 🛡️ PHASE 2: MEMBERSHIP, CONTEXT & SCOPED DATA ACCESS LAYER

### Step 8: Multi-Company Membership & Dynamic Tenant Switcher Architecture
* **Objective:** Decouple global user authentication from tenant authorization.
* **Actions:**
  * Enhance authentication flow: A user logs in with email/password. Server returns verified identity + list of active `TenantMembership` entries.
  * In the single-tenant case, auto-select the active membership. In multi-tenant case, user provides desired `tenantId` in header (`x-tenant-id`).
  * Implement endpoint `POST /api/v1/auth/switch-tenant`:
    * Validates user has active membership in target tenant.
    * Issues a short-lived scoped session context containing active `tenantId`, verified role, and branch authorizations.
* **Deliverable:** Authentication service supporting multi-company memberships.
* **Acceptance Gate:** User cannot select or query a tenant where they do not possess an active `TenantMembership`.

### Step 9: Express Request Context & Fail-Closed Guard Middleware
* **Objective:** Build an immutable, validated request context on every protected API call.
* **Actions:**
  * Build `backend/src/middleware/tenantContextMiddleware.js`:
    1. Extract selected `tenantId` from client header/request.
    2. Query database/cache: Validate `userId` has active `TenantMembership` for that `tenantId`.
    3. Query tenant lifecycle status: If tenant status is `SUSPENDED`, block operational requests (HTTP 403).
    4. Validate branch access: If route is branch-scoped, verify `req.query.branchId` or `req.body.branchId` is within user's allowed branches for this tenant.
    5. Construct immutable context on `req.tenantContext = { userId, tenantId, role, allowedBranches, status }`.
  * **Fail-Closed Rule:** Any missing, mismatched, or inactive tenant context immediately aborts the request.
* **Deliverable:** Context middleware and unit tests covering tampered headers, expired memberships, and suspended tenants.
* **Acceptance Gate:** 100% of negative authorization unit tests pass; arbitrary client-supplied `tenantId` in request bodies is rejected.

### Step 10: Centralized Scoped Data Access Layer & Access Path Inventory
* **Objective:** Prevent accidental unscoped queries without relying blindly on blanket Prisma extensions.
* **Actions:**
  * Perform an exhaustive inventory of every repository, controller, service, raw SQL query, nested create/connect, and aggregation in `backend/src/modules/`.
  * Build a centralized, tenant-scoped repository helper:
    * All find, create, update, delete operations require `tenantContext`.
    * Prisma queries enforce `{ where: { tenantId: context.tenantId } }`.
    * Nested writes (`create`, `connect`, `upsert`) explicitly include `tenantId` on all levels.
    * Audit every raw query (`$queryRaw`, `$executeRaw`): rewrite with parameterized SQL binding `$tenantId`.
* **Deliverable:** `artifacts/DATA_ACCESS_AUDIT_REPORT.md` verifying every data route has explicit tenant scoping.
* **Acceptance Gate:** Automated grep and AST inspection confirm zero unscoped Prisma or raw queries in operational services.

### Step 11: Shift-Left Tenant Isolation Integration Test Suite
* **Objective:** Prove cross-tenant isolation before touching RLS or UI.
* **Actions:**
  * Create `backend/tests/tenant-isolation.test.js` using synthetic tenants (`Tenant A` and `Tenant B`):
    * Test 1: User of Tenant A attempts to fetch Tenant B's invoice by ID ➔ 404 Not Found.
    * Test 2: User of Tenant A attempts to mutate Tenant B's client profile ➔ 404 / 403.
    * Test 3: User of Tenant A attempts to book appointment using Tenant B's staff ID ➔ Rejected with validation error.
    * Test 4: Tenant A and Tenant B create invoice `INV-0001` simultaneously ➔ Both succeed independently without collision.
* **Deliverable:** Automated isolation test suite integrated into CI/pre-commit pipeline.
* **Acceptance Gate:** All negative isolation test cases pass with 100% green status.

---

## 🔒 PHASE 3: POSTGRESQL ROW-LEVEL SECURITY (DEFENSE-IN-DEPTH)

### Step 12: Production DB Runtime Role & RLS Environment Configuration
* **Objective:** Establish proper database privileges so RLS policies cannot be bypassed by application connections.
* **Actions:**
  * Create dedicated PostgreSQL runtime role: `salonos_app_user` (NON-SUPERUSER, NO-BYPASSRLS, NOT OWNER of the tables).
  * Separate migration role: `salonos_migrator` (used solely for DDL migrations, never used by the web application pool).
  * Enable RLS on all tenant business tables:
    `ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;`
    `ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;`
* **Deliverable:** Database configuration script establishing least-privilege runtime roles.
* **Acceptance Gate:** Verified that runtime role does not possess table ownership or BYPASSRLS privilege.

### Step 13: PostgreSQL RLS Policies & Transaction-Local Context Helper
* **Objective:** Enforce policies for both reads (`USING`) and writes (`WITH CHECK`) tied strictly to transaction lifetime.
* **Actions:**
  * Add RLS policies for tenant tables:
    ```sql
    CREATE POLICY tenant_isolation_policy ON "Invoice"
      AS RESTRICTIVE
      FOR ALL
      USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    ```
  * Build transactional helper `backend/src/lib/withTenantTx.js`:
    * Executes `SET LOCAL app.current_tenant_id = $1` on the specific transaction connection.
    * Guarantees context is destroyed on commit, rollback, error, or connection pool return.
  * Add bypass policies only for explicitly authorized platform management queries using audited session context.
* **Deliverable:** RLS policy migrations and transaction wrapper.
* **Acceptance Gate:** Raw SQL query executed under `salonos_app_user` with foreign `tenantId` returns 0 rows; missing context denies write with RLS error.

---

## 💳 PHASE 4: PLANS, LIMITS & TRANSACTIONAL BILLING ENGINE

### Step 14: Plan Versioning, Limits & Feature Entitlements Schema
* **Objective:** Model pricing tiers, branch quotas, and feature flags with complete historical immutability.
* **Actions:**
  * Implement immutable `PlanVersion` pattern: Editing a plan creates a new version; active subscriptions remain pinned to their contracted version until explicitly renewed or migrated.
  * Define canonical limit keys: `maxBranches`, `maxStaff`, `maxDevices`.
  * Define canonical feature keys: `hasBiometrics`, `hasAdvancedPayroll`, `hasCustomSms`, `hasInventoryTransfers`.
  * Implement entitlement resolver: Short-lived server-side cache (keyed by `tenantId:version`) with immediate invalidation on plan or payment changes.
* **Deliverable:** Plan engine service and entitlement cache manager.
* **Acceptance Gate:** Changing a published plan does not mutate contracted limits of existing active subscriptions.

### Step 15: Server-Side Quota Enforcement Interceptors
* **Objective:** Prevent resource creation beyond subscribed limits at the API layer.
* **Actions:**
  * Create reusable limit check middlewares and transactional guards:
    * `ensureBranchQuota(tenantId, tx)`: Counts active branches within transaction; rejects if `count >= maxBranches`.
    * `ensureStaffQuota(tenantId, tx)`: Counts active staff members; rejects if `count >= maxStaff`.
    * `requirePlanFeature(featureKey)`: Intercepts module access (e.g. biometrics device sync) and rejects unauthorized tiers.
  * Return structured payload: `{ code: 'QUOTA_EXCEEDED', limitKey, current, max, upgradeUrl }`.
* **Deliverable:** Limit interceptor middlewares and concurrent quota test.
* **Acceptance Gate:** Two concurrent branch-creation requests hitting the last available seat allow only one to succeed; the second fails gracefully.

### Step 16: Transactional Payment Verification & Subscription Activation Flow
* **Objective:** Eliminate "1-click naive activation" in favor of an audited, idempotent financial verification workflow.
* **Actions:**
  * Model `BillingInvoice`, `SubscriptionPayment`, and `PaymentAllocation`.
  * When salon owner submits renewal slip:
    * Accepts amount, currency, declared payment method, transaction reference, and slip image URL.
    * Creates `SubscriptionPayment` in `PENDING_VERIFICATION` state.
  * When Platform Admin verifies payment:
    * **Pre-Verification Checks:** Verify transaction reference uniqueness (reject duplicate bank references), verify invoice match, and confirm currency and amount.
    * **Atomic Transaction Execution:**
      1. Record verification actor ID, timestamp, and audit notes.
      2. Mark `SubscriptionPayment` as `VERIFIED`.
      3. Create immutable `PaymentAllocation` linking payment to `BillingInvoice`.
      4. Advance `Subscription.currentPeriodEnd` by contracted duration (e.g. +30 days / +365 days).
      5. Set `Subscription.status = ACTIVE` and clear any grace period flags.
      6. Invalidate tenant entitlement cache.
* **Deliverable:** Payment verification service and idempotent state transition handler.
* **Acceptance Gate:** Duplicate payment slip submissions rejected; approval executes atomically with full audit trail.

---

## 🖥️ PHASE 5: DUAL-FRONTEND DELIVERY (SALON UI + PLATFORM PORTAL)

### Step 17: Salon Client App (`frontend`) SaaS Scoping & Dynamic Branding
* **Objective:** Adapt the existing salon application to dynamically reflect authenticated tenant context.
* **Actions:**
  * Update `AuthContext`: Store verified tenant profile (`id`, `name`, `logoUrl`, `currency`) along with user permissions.
  * Update `AppHeader` and navigation: Display active salon brand, and restrict branch switcher dropdown to authorized branches of the current tenant.
  * Ensure query cache keys include `tenantId` and `branchId` to prevent cross-tenant UI cache leakage on tenant switch.
* **Deliverable:** Scoped client UI shell and cache invalidator.
* **Acceptance Gate:** Switching tenant clears all local query caches, form drafts, and branch states immediately.

### Step 18: Salon Owner Billing & Self-Service Subscription Dashboard (`/settings/billing`)
* **Objective:** Provide salon owners with full visibility into their plan, usage, and renewal workflows.
* **Actions:**
  * Build `SalonBillingPage.tsx` using existing luxury Frosted Glassmorphism design tokens:
    * Active Plan Card: Current plan name, renewal date, and billing cycle.
    * Quota Usage Meters: Visual progress bars for branches used (`2 / 3`) and staff used (`14 / 20`).
    * Bank Details Card: Official SaaS payment bank IBAN, Account Title, and JazzCash/EasyPaisa merchant instructions.
    * Payment Slip Uploader: Secure screenshot upload component with transaction reference input and pending verification banner.
    * Historical Invoices Table: Downloadable receipts of verified payments.
* **Deliverable:** Polished salon billing page with live API integration.
* **Acceptance Gate:** Salon owner can submit payment slips and view verified invoice history cleanly.

### Step 19: Grace Period Warning Banners & Suspension Enforcers in Salon UI
* **Objective:** Guide owners through subscription expiration without jarring operational disruption.
* **Actions:**
  * Dynamic Alert Banner:
    * 7 days before renewal: Blue informational banner.
    * In Grace Period (Past Due): Amber urgent banner with days remaining countdown.
  * Hard Lock Modal:
    * When `Subscription.status === 'SUSPENDED'`, overlay non-dismissible modal: *"Subscription Suspended — Please contact billing"*.
    * Historical reports and client records remain accessible in read-only mode; POS checkout, new appointments, and new bookings are disabled.
* **Deliverable:** Grace period banner and suspension modal components.
* **Acceptance Gate:** Suspended tenant cannot create new financial transactions; reports remain viewable.

### Step 20: Scaffold Dedicated Platform Master Admin Portal (`platform-portal`)
* **Objective:** Build the completely decoupled, secure Master Admin Web Application.
* **Actions:**
  * Scaffold independent project `platform-portal/` at root: React 19 + TypeScript + Vite + Tailwind CSS.
  * Configure independent port: `3002` (leaving salon app on `3001` and backend on `5000`).
  * Layout: Modern executive dashboard with dark-mode support, dense data grids, KPI cards, and modal dialogs.
  * **Strict Seclusion Rule:** Ensure zero platform code, routes, or API endpoints exist in Portal 2's build bundle.
* **Deliverable:** Standalone admin web application running independently.
* **Acceptance Gate:** `platform-portal` builds and launches with dedicated bundle and separate bundle hash.

### Step 21: Platform Admin Auth, Dashboard & Client Onboarding Console
* **Objective:** Empower SaaS operations to manage salons, plans, and approvals centrally.
* **Actions:**
  * Implement `PlatformLoginPage.tsx` with dedicated platform credentials and JWT refresh rotation.
  * **Executive Overview:** Real-time KPI cards (Active Salons, Total Branches, Monthly Recurring Revenue, Subscriptions Expiring within 7 Days).
  * **Tenant Management Console:**
    * Searchable tenant table with status badges (`ACTIVE`, `TRIAL`, `PAST_DUE`, `SUSPENDED`).
    * **Onboarding Wizard:** Form to enter Salon Business Name, City, Owner Contact, select Plan Version, configure initial branch, and provision credentials atomically.
    * Emergency Actions: Instant toggle to suspend tenant or trigger password reset.
  * **Plans & Limits Engine:** Form to create and publish new `PlanVersion` definitions.
  * **Manual Payment Verification Inbox:** Table of pending slips, receipt image zoom viewer, duplicate check indicator, and **Approve** / **Reject with Reason** action dialogs.
* **Deliverable:** Complete Platform Admin Portal with live backend integration.
* **Acceptance Gate:** Platform Admin can onboard a new salon client and approve renewal slips from Portal 1.

---

## ⚙️ PHASE 6: SCOPED WORKERS, ASSETS & RECOVERY CONTROLS

### Step 22: Tenant-Scoped Background Jobs & Deduplicated Schedulers
* **Objective:** Ensure background tasks (subscription checks, reminder SMS, attendance sync) respect multi-tenancy.
* **Actions:**
  * Audit cron jobs and workers: Ensure every job payload carries an explicit `tenantId`.
  * Background job executor must establish verified tenant context before executing any database mutations.
  * Implement distributed locking / deduplication on subscription expiry cron so running multiple backend instances does not fire duplicate reminder emails or billing state changes.
* **Deliverable:** Tenant-safe background job scheduler with execution logs.
* **Acceptance Gate:** Background job executing for Tenant A has zero access to Tenant B records.

### Step 23: Tenant-Isolated File Storage & Signed URL Protection
* **Objective:** Guarantee customer files (payment slips, client attachments, logos) are never leaked across tenants.
* **Actions:**
  * Structure file storage paths: `uploads/tenants/:tenantId/:category/:fileId`.
  * File download routes must verify requester has active membership in the target `tenantId`.
  * Upload validation: Enforce MIME-type allowlists, file size limits (e.g. 5MB for payment slips), and strip EXIF metadata.
* **Deliverable:** Tenant-isolated storage adapter and secured download endpoints.
* **Acceptance Gate:** User from Tenant A attempting to download Tenant B's payment slip is denied (HTTP 403).

### Step 24: Backup, Disaster Recovery & PITR Target Alignment
* **Objective:** Align operational backup procedures with PRD recovery targets (RPO ≤ 15 min, RTO ≤ 4 hrs).
* **Actions:**
  * Configure PostgreSQL continuous WAL archiving and daily base backups with off-server replication.
  * Create `scripts/dr-restore-rehearsal.js`: Script to restore backup into an isolated database, verify table counts, and confirm zero corruption.
  * Document tenant-specific export/extract procedure: Extracting a single tenant's data must not dump or expose any other tenant's rows.
* **Deliverable:** Disaster recovery runbook and verified backup rehearsal test log.
* **Acceptance Gate:** Staging restore rehearsal completes within 4 hours; restored database passes control total verification.

---

## 🚀 PHASE 7: HARDENING, REGRESSION & STAGED PILOT ONBOARDING

### Step 25: Full Accounting Regression & Invariant Verification Suite
* **Objective:** Re-verify that 100% of existing complex salon business logic remains exact and uncorrupted.
* **Actions:**
  * Execute automated end-to-end regression tests across all core business modules:
    * **POS Billing:** Service + Package + Retail Product + Split Payment + Line Tax.
    * **Bridal/Groom Bookings:** Event advance commitment, installments, liability recognition, POS checkout transfer.
    * **Cash Drawers:** Cashier shift open, float, cash movements, variance calculation, end-of-day settlement.
    * **Payroll & Commissions:** Attendance deductions, commission earning, refund reversals, advance deductions.
    * **Inventory:** Batch tracking, FIFO stock deductions, salon consumption vs retail sales.
* **Deliverable:** Full regression test report comparing outputs with Step 3 Baseline Totals.
* **Acceptance Gate:** 100% test pass rate with zero discrepancies in calculations or balances.

### Step 26: Staged Pilot Onboarding & Rollout Runbook
* **Objective:** Controlled transition to multi-tenant production operation.
* **Actions:**
  * **Stage A (Legacy Re-Verification):** Verify existing Meerab Salon operates normally on the multi-tenant engine.
  * **Stage B (Synthetic Staging Pilot):** Create a synthetic second salon company in staging, simulate full operational days (appointments, POS, payroll), and prove complete data isolation.
  * **Stage C (Controlled Live Pilot):** Onboard first real second salon company on production with daily monitoring and reconciled accounts.
  * Document emergency rollback procedure: Define safe operational checkpoints before and after multi-tenant writes.
* **Deliverable:** Production Deployment Runbook (`RUNBOOK_SAAS_DEPLOYMENT.md`) and Pilot Acceptance Sign-off.
* **Acceptance Gate:** First multi-tenant pilot operating in production with verified zero isolation leaks and reconciled accounts.

---

## 📊 Summary Acceptance Checklist (Definition of Done)

| Phase | Milestone | Critical Acceptance Criteria |
| :--- | :--- | :--- |
| **Phase 0** | **Baseline Audit** | All models classified; financial baseline totals recorded and restorable. |
| **Phase 1** | **Schema & Backfill** | Additive migration deployed; legacy tenant backfilled; composite constraints enforced. |
| **Phase 2** | **Membership & Context** | User identity decoupled from tenant; `tenantContextMiddleware` fail-closed; negative tests green. |
| **Phase 3** | **PostgreSQL RLS** | Non-owner runtime role active; transaction-local context helper enforces read/write isolation. |
| **Phase 4** | **Plans & Billing** | Server-side quota guards enforced; manual payment slips verified idempotently with full audit. |
| **Phase 5** | **Dual Frontends** | Platform Admin Portal (`platform-portal`) completely decoupled; Salon billing UI live. |
| **Phase 6** | **Workers & DR** | Background jobs scoped; file paths isolated; WAL backup & restore rehearsal proven. |
| **Phase 7** | **Pilot Rollout** | Full financial regression passed; synthetic tenant verified; pilot salon live without issue. |
