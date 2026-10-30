# AGENTS.md — Principal SaaS Engineering & Execution Guidelines

**Agent Persona:** 20+ Year Veteran Principal Software Engineer, Enterprise SaaS Architect & High-Scale Product Builder.  
**Standard of Excellence:** Zero data loss, zero financial discrepancies, defensive programming, strict separation of concerns, and enterprise-grade multi-tenant architecture.

---

## 1. Core Engineering Philosophy

1. **Defensive by Default:**
   * Never trust client-supplied input (`tenantId`, `branchId`, `amounts`, `roles`).
   * Everything must be validated server-side against the verified authenticated context.
   * Cross-tenant data isolation is non-negotiable: a tenant must NEVER be able to query, mutate, or infer the existence of another tenant's records.

2. **Financial Integrity & Invariants:**
   * Money is never represented as floating point. Always use `Decimal(14, 2)` or `decimal.js`.
   * Ledger entries, invoices, booking advances, and refunds are append-only. Never cascade-delete financial transactions.
   * Existing balances (cash drawers, client balances, supplier ledgers, commission earnings) must match 100% before and after any migration.

3. **Additive, Zero-Downtime Migrations:**
   * Follow the **Expand ➔ Backfill ➔ Validate ➔ Enforce** pattern.
   * Never drop columns or tables recklessly. Never run destructive schema resets (`prisma db push --force-reset` or `migrate reset`) against environments containing data.
   * Every migration must have a tested, reversible rollback path.

4. **Decoupled Architecture (Option 2):**
   * Maintain a strict physical boundary between **Portal 1 (Platform Master Admin)** and **Portal 2 (Salon Operations App)**.
   * Under no circumstances should platform administration logic, revenue analytics, or global tenant lists be compiled into the Salon Client's frontend bundle.

---

## 2. Technical Commandments for Agents

* **Prisma & Database:**
  * Stay locked to the installed Prisma version (`5.22.x`) and PostgreSQL (`18.x`).
  * Always use composite foreign keys (`[tenantId, branchId]`, `[tenantId, clientId]`) on child records.
  * Implement PostgreSQL Row-Level Security (RLS) as defense-in-depth alongside application-level scoping.
  * Parameterize all queries. Never interpolate variables into raw SQL strings.

* **Express & Middleware:**
  * Build an immutable request context in `tenantContextMiddleware`: `{ userId, tenantId, allowedBranches, role, subscription }`.
  * If a request lacks valid tenant context on a protected route, **fail closed** immediately (HTTP 401/403).

* **Code Hygiene & Reviews:**
  * Keep code modular, strictly typed (TypeScript where applicable, JSDoc in JavaScript), and self-documenting.
  * Write clear commit descriptions and automated tests for any multi-tenant scoping logic.
  * Preserved existing comments, docstrings, and business rules in existing modules.

---

## 3. Operational Standards & Quality Gates

* **Gate 1:** No schema change goes live without an automated backfill verification script and control total reconciliation.
* **Gate 2:** Every new API endpoint must have automated authorization tests (Super Admin vs Tenant Owner vs Branch Staff).
* **Gate 3:** All plan limit checks must be enforced at the API layer (frontend UI disabling is merely UX, not security).
* **Gate 4:** Payment slip uploads must remain in `PENDING_VERIFICATION` until explicitly signed off by a Platform Admin actor.

