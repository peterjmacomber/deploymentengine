# Deployment Engine

FortisPay's internal **equipment deployment system**, built on the POS Portal (ScanSource) v2
API with a **Fortis Gateway (Zeamster)** integration. It handles the full lifecycle: merchant
management, equipment ordering & checkout, fulfillment tracking (pizza-tracker), returns/swaps/
repairs with manager approvals, deployed-equipment + Fortis terminal activation, consigned-
inventory forecasting, device pricing, tokenized checkout links, a **merchant self-service
portal**, and a **public checkout** flow — on a security-first foundation (JWT auth, fine-grained
RBAC, audit trail, rate limiting, Zod validation). The UI is styled on the **Fortis Design System**.

It talks to the **live POS Portal sandbox** today and flips to production by changing environment
variables (see [SECURITY.md](SECURITY.md)). New here? Read **[CLAUDE.md](CLAUDE.md)** first (agent
onboarding + current status). For the full build/reconstruction spec see [BUILD.md](BUILD.md); for
design rationale see [DESIGN.md](DESIGN.md).

> **Status (2026-07-09):** feature-complete on the sandbox; the Fortis Design System UI refactor is
> merged to `main`. `main` is committed **locally** and not yet pushed to GitHub. See the
> _Current status / where I left off_ section at the bottom, or CLAUDE.md.

```
DeploymentEngine/
├── shared/    @de/shared — enums, domain types, Zod DTOs, RBAC, pricing/brands, status map
├── server/    Node 20 + TypeScript + Express + Prisma (SQLite). Adapters: POS Portal / Fortis / Tax
├── web/        React 18 + Vite + TypeScript (TanStack Query, Zustand, React Router)
├── scripts/    DB export/import/auto-restore (portable SQLite backups)
├── data/       Portable DB backup target (data/backup.db) — git-ignored
├── docker-compose.yml   install · server · web · tools · backup
└── README.md · BUILD.md · SECURITY.md · DESIGN.md
```

## Run it (Docker — the only prerequisite is Docker Desktop)

```bash
docker compose up            # installs deps, restores-or-seeds the DB, runs API + web
```

- **App:** http://localhost:5175  (sign in with a demo account below)
- **API health:** http://localhost:8090/health
- **Public sanitized order tracker:** http://localhost:5175/t/<share-token>
- **Public checkout link:** http://localhost:5175/l/<token>

One-off commands run through the `tools` service:

```bash
docker compose run --rm tools npm run typecheck
docker compose run --rm backup                          # export DB → data/backup.db
docker compose run --rm tools node scripts/db-import.mjs # restore DB from data/backup.db
```

### Demo accounts (password `password123`)

| Email | Role | Scope |
|---|---|---|
| `admin@deployment.local` | admin | everything incl. pricing, users, API keys, audit, dev tools |
| `manager@deployment.local` | manager | approvals, checkout links, scoped user mgmt, forecast edits |
| `agent@deployment.local` | agent | merchants, orders, returns, deployed |
| `viewer@deployment.local` | readonly | view only |

## What's inside (navigation)

Admin console (internal employees):
- **Overview** — Dashboard; every KPI/row clicks through to its filtered view. Includes an
  "Orders by status" breakdown (with Swaps) and a Billing rollup (order $, returns value,
  warranty vs billed returns).
- **Operations** — Merchants (→ per-merchant detail: Overview / Orders / Returns & Swaps /
  Analytics, plus Portal Access + "View as merchant"), Orders (tab: Deployed Equipment; phase
  chips incl. **No Outbound** for internal transfers), **Returns & Swaps** (`/cases`, type + status
  tabs), **Inventory & Forecast** (Equipment / Non-Equipment / Forecast Alerts / Forecast Settings),
  Shipping Tools.
- **Management** — Approvals, **Reported Issues** (merchant self-service report log), **Checkout
  Links** (tokenized order/application links), Users (managers create users below their own level).
- **Admin** — Policies, **Bundles & Pricing** (tab: Device Pricing — device-level price list =
  source of truth), API Keys, **Fortis Gateway** (connection test, account↔merchant linking,
  terminal creation + configurable terminal defaults), Audit Log.

Merchant self-service portal (`/portal`, `MERCHANT` role or admin impersonation): Home,
Orders (with "Order equipment"), Returns & Swaps, Analytics, and a guided **Report an issue** flow
that auto-creates a swap/return per policy.

Every table is searchable, sortable, filterable (dropdown facets: phase / manufacturer / origin /
etc.) and date-range filterable where applicable. Serials show as their last-8 identifier and link
back to the order that shipped the unit.

## API planes

- **Internal** `/api/v1/*` — JWT (`Authorization: Bearer`) + RBAC + audited.
- **Integration keys** — the same `/api/v1/*` surface via `X-API-Key` (Admin → API Keys). Keys can
  do everything an operator can **except** admin functions; every key call is audited under the
  key's name.
- **Public checkout link** `/api/public/v1/link/:token` — tokenized, no login (order/application
  landing pages + tax quote).
- **Public tracking** `/api/public/v1/track/:token` — sanitized order status, **no merchant PII**.

The app is **polling-only** by design (no public ingress); an inbound webhook receiver exists but
is unmounted unless `WEBHOOKS_ENABLED=true`. See [SECURITY.md](SECURITY.md).

## Database portability

The dev database is a single SQLite file at `server/prisma/dev.db`, so it travels with the folder.
For explicit, portable backups:

- `docker compose run --rm backup` writes `data/backup.db` (a complete snapshot).
- On a fresh machine, `docker compose up` **auto-restores** from `data/backup.db` if present, else
  creates a fresh seeded DB. So: copy the folder (or just `data/backup.db`) → `docker compose up` → done.

## Sandbox → production

A config-only switch — same endpoints, same code. Point `POSP_BASE_URL` / `POSP_TOKEN_URL` /
`POSP_SCOPE` / `POSP_CLIENT_ID` / `POSP_CLIENT_SECRET` at production. See [SECURITY.md](SECURITY.md)
for the full production checklist (Postgres, TLS, secrets, hardening).

## Scripts

| Command | What |
|---|---|
| `docker compose up` | install + restore/seed DB + run API & web |
| `docker compose run --rm tools npm run typecheck` | typecheck all workspaces |
| `docker compose run --rm backup` | export DB → `data/backup.db` |
| `docker compose run --rm tools node scripts/db-import.mjs` | restore DB from backup |
| `docker compose run --rm tools npm run seed --workspace server` | reseed login users |

## Current status / where I left off

Feature-complete against the live POS Portal sandbox; the Fortis Design System UI refactor is
**merged to `main`** and the whole workspace typechecks. To continue exactly where this left off:

1. **Push to GitHub.** `main` is committed locally but **not pushed** (~16 commits ahead of
   `origin/main` at `https://github.com/peterjmacomber/deploymentengine`). Run `git push origin main`.
2. **Optional portal detail pages** — `/portal/orders/:id` and `/portal/cases/:id` are speced but
   not built; portal order rows currently link to "Report an issue" instead of a detail view.
3. **Clean sandbox test data** (safe to remove): portal login `owner@bellm.test` / `portalpass123`;
   test return cases #306 & #507 and their sandbox replacement orders; ~3 test terminals created in
   the Fortis sandbox.
4. **Bio Sans**: weights 400/600 are self-hosted (`web/src/assets/fonts`); more weights are
   available if needed.
5. **Go to production**: config-only — repoint `POSP_*` and supply prod `FORTIS_*` (see
   [SECURITY.md](SECURITY.md)).

Agents: `CLAUDE.md` is auto-loaded by Claude Code and carries the same status plus conventions and
gotchas — read it first.
