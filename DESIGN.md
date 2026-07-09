# Deployment Engine — Production Design & Decisions

**Status:** Built and running on the **live POS Portal sandbox** with a **live Fortis Gateway**
integration; architected for production promotion (config-only switch). UI restyled onto the Fortis
Design System.
**Owner:** Peter Macomber (FortisPay)
**Upstream API:** POS Portal / ScanSource v2 (`https://api.posportal.com`, sandbox `https://sandbox-wapi.posportal.com/v2`); Fortis Gateway / Zeamster (`https://api.sandbox.fortis.tech`)

> This document records the **original** consolidation rationale (D1–D6). Decisions added since
> (merchant portal, live Fortis, UI refactor) are D7–D9 below. For the current running state and
> open items, see **CLAUDE.md** / README "Current status".

This document records the design decisions for consolidating the existing prototypes
(`Deployment Forecasting File`, `posp-storefront-mock`, `Deployment Swap Insights`) into a
single **Deployment Engine**: an internal employee tool for equipment deployment that also
exposes an **externally-embeddable ordering API** for a third-party e-sign application flow.

---

## 1. Scope (what this system does)

Six operational sections + admin/manager surfaces:

| Section | Capability |
|---|---|
| **Merchants** | Look up / create merchants (POS Portal), attach shipping addresses |
| **Orders** | Automated + manual equipment ordering, full checkout, DRAFT→OPEN lifecycle |
| **Shipping** | Address validation (required), shipping quotes, pizza-tracker status |
| **Returns** | Swaps, refunds, repairs, call-tags, delinquency, 30-day/365-day policy |
| **Deployed Equipment** | Serial-tracked deployed devices, status, Fortis terminal sync |
| **Inventory & Forecast** | Consigned inventory, coverage/velocity, buy-plan (ported from prototype) |
| **Admin: Bundles** | Add/remove bundles (device + accessories + paper + **app/encryption config**) |
| **Manager: Approvals** | Approve price exceptions (free device), out-of-return-window swaps, out-of-warranty swaps |
| **Public/Embed** | Lightweight merchant sign-up → equipment order form, consumable by external systems |

---

## 2. Key architectural decisions

### D1 — Mock-first adapter behind an interface (de-risks the unknowns)
The POS Portal OpenAPI/Swagger JSON is **auth-locked (401)** and several capabilities
(returns reason codes, webhook subscriptions/credentials) are **gated behind a POS Portal
Account Manager**. Rather than block, we define a **canonical internal domain model** and a
`PosPortalAdapter` **interface** with two implementations:

- `MockPosPortalAdapter` (default) — a rich in-process mock seeded with a merchant/inventory
  snapshot, so the entire system runs and demos end-to-end today with zero credentials.
- `LivePosPortalAdapter` — real OAuth2 client-credentials (Azure AD) client wired to the
  confirmed v2 endpoints, ready to switch on via `POSP_MODE=live` when sandbox creds land.

All business logic and UI depend only on the interface + canonical model. Swapping to live
is a config change, not a rewrite. Same pattern for `FortisAdapter`.

### D2 — Canonical status model + mapping table
POS Portal order states (`Submitted / Processing / ReadyForQA / Shipped / Cancelled /
Returned / ReturnedHolding / Reshipped / BackOrderCreated`) and the old mock's ad-hoc
`DRAFT/OPEN/SHIPPED` set are both mapped to **one canonical enum** in `shared/statusMap`.
The pizza-tracker renders from canonical stages: `PLACED → IN_PREP → SHIPPED →
OUT_FOR_DELIVERY → DELIVERED` with exception branches (`DELIVERY_FAILED`, `BACKORDERED`,
`CANCELLED`, `RETURNED`).

### D3 — Security from the ground up (closes the mock's biggest gap)
The storefront mock had only a single shared `x-admin-key` and **no RBAC, no audit**. We add:
- **AuthN:** JWT access tokens, bcrypt password hashing, login rate-limiting. MFA-ready
  (interim-token seam present, TOTP deferred).
- **AuthZ (RBAC + permissions):** roles `admin`, `manager`, `agent`, `readonly`, plus an
  external `partner` principal (API key). Route guards check **permissions**, not just roles,
  so manager-only exception approvals are enforced centrally.
- **Audit log:** every state-changing request (POST/PATCH/PUT/DELETE) is recorded
  (actor, role, action, target, before/after metadata, IP, timestamp) — payments-grade trail.
- **Transport/app hardening:** `helmet`, strict CORS allowlist, per-scope rate limits,
  JSON body-size caps, Zod validation on every input, RFC-7807 problem+json errors,
  secrets only via env (never persisted), no secrets in logs.

### D4 — Two API planes
- **Internal API** `/api/v1/*` — employee tool, JWT + RBAC.
- **Public/Embed API** `/api/public/v1/*` — API-key auth, tightly scoped to
  `validate-address → quote → create-merchant → create-order → track`. This is what an
  external e-sign application embeds as its "order equipment" step. Supports a
  `returnUrl` handoff so the partner flow resumes after order placement.

### D5 — Manager exceptions as first-class approval objects
Price exception (free/discounted device), out-of-return-window swap (>30 days), and
out-of-warranty swap (>365 days) each create an `ExceptionRequest` that blocks the
underlying action until a `manager` approves/denies. Full audit + reason capture.

### D6 — Bundles carry app/encryption config (design gap closed)
A bundle = POS Portal bundle (device + accessories + paper) + a **local overlay** adding
`application`, `encryption`, `processorPlatform`, plus visibility (`active`), display, and
accounting fields. Admin CRUD manages the overlay; POS Portal snapshot is cached.

### D7 — Merchant self-service portal with hard tenant isolation
A third API plane `/api/v1/portal/*` for a new `MERCHANT` login role that holds only `PORTAL_USE`
(no internal-route reach). Every portal route forces the token's own `merchantId` server-side, so a
merchant sees only their own orders/cases/analytics. Admins/managers can **impersonate** a merchant
(scoped token, audited) to see the portal as them. Includes self-service ordering (shipping
pre-filled) and a guided **Report an issue** flow that reuses `returnService` (auto-proceed in-window,
park out-of-window for approval); every report is logged to `ReportedIssue` for a Management view.

### D8 — Fortis Gateway is a live integration (no mock)
Confirmed the real Zeamster API (`api.sandbox.fortis.tech`; `developer-id`/`user-id`/`user-api-key`
headers). Merchants = "locations" (searched server-side by name/account number — the account # is the
MID, often blank in sandbox). Terminal create maps full serial→`serial_number`, last-8→`terminal_api_id`,
with manufacturer/application/CVM **defaults configured in-app** (persisted in `Setting`, audited;
`terminal_manufacturer_code` 2=Ingenico). Prod is a `FORTIS_BASE_URL`/creds swap.

### D9 — UI on the Fortis Design System
Restyled from a Claude Design handoff onto Fortis tokens (Network Blue / Celestial / Power Orange),
Bio Sans (self-hosted) + Inter, a fixed 3-zone sidebar, and shared components. Navigation consolidated
(Returns+Swaps → `/cases`; Forecasting → Inventory tabs; Pricing → a Bundles tab). Visual-only —
no API/data/permission changes.

---

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React 18 + Vite + TypeScript** | "Fast, React-like"; matches both existing prototypes; Vite HMR/build |
| Routing/state | React Router v6, **TanStack Query** (server state), **Zustand** (auth/UI) | Proven in Merchant Ops Hub |
| Forms | React Hook Form + Zod | Replaces the mock's raw-JSON textareas |
| Backend | **Node 20 + TypeScript + Express 4** | Maximum reuse of the storefront mock's working code |
| Data | **Prisma + SQLite (dev) → Postgres (prod)** | Zero-infra prototype, real schema/migrations, one-line prod swap |
| Shared | `shared/` workspace package | Single source of truth for enums/DTOs across server + web |
| Integrations | POS Portal adapter, Fortis adapter (both mock/live) | D1 |

Monorepo via npm workspaces: `shared/`, `server/`, `web/`.

---

## 4. Run modes

- `POSP_MODE=live` (current): real OAuth2 client-credentials against the POS Portal sandbox
  (`POSP_CLIENT_ID / POSP_CLIENT_SECRET / POSP_TOKEN_URL / POSP_SCOPE / POSP_BASE_URL`). `POSP_MODE=mock`
  still exists (seeded data + `POST /api/v1/dev/orders/:id/ship` to simulate shipment) for offline dev.
- **Fortis is live-only** (no mock) — configured via `FORTIS_BASE_URL` + credentials.

---

## 5. Open items requiring POS Portal Account Manager (tracked, non-blocking)

1. Authed Swagger export for Orders / Bundles / Returns / Merchant-search / Shipping schemas.
2. Return `reason` code table (map to our internal reason enums).
3. Webhook subscription list + auth scheme (OAuth Bearer vs HMAC vs Api-Key) + per-event paths.
4. Confirmation of the Fortis `/v2/terminals` create contract + LINKS field name.

Each is isolated to the adapter/config layer by design (D1), so the app is buildable now.

---

## 6. Build map / checklist

- [x] Design decisions (this doc)
- [x] Monorepo scaffold + shared enums/DTOs/status map
- [x] Server foundation: config, Prisma schema, security, auth/RBAC, audit, error handling
- [x] POS Portal + Fortis adapters (mock + live skeleton) + seed snapshot
- [x] Services + internal API routes for all 6 sections + bundles + approvals
- [x] Public/embed API + webhook receiver
- [x] Web: auth, app shell, dashboards, section pages, pizza tracker
- [x] Public: merchant sign-up → equipment order flow
- [x] Seed data + README run instructions
- [x] Typecheck/build/runtime verification — runs via Docker; `docker compose run --rm tools npm run
      typecheck` is green across all workspaces and the app runs against the live sandbox.
- [x] Merchant portal (D7), live Fortis Gateway (D8), Fortis Design System UI refactor (D9) — merged to `main`.
