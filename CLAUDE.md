# CLAUDE.md — start here (agent onboarding)

Read this first, then skim `README.md` (overview + run), `DESIGN.md` (rationale), `BUILD.md`
(full rebuild spec), `SECURITY.md` (prod hardening). This file is the fast path to being productive.

## What this is
**Deployment Engine** — FortisPay's internal tool for deploying payment equipment, built on the
**POS Portal (ScanSource) v2 API** with a **Fortis Gateway (Zeamster)** integration. Employees
create/track equipment orders, returns/swaps, deployed units + Fortis terminal activation,
consigned-inventory forecasting, device pricing, and tokenized checkout links. There's also a
**merchant self-service portal** (scoped logins) and a **public checkout** surface. Orders bill
**Fortis (the client)**, which bills merchants separately.

## Stack & layout
npm-workspaces monorepo, Node 20, TypeScript/ESM, run entirely via Docker Compose.
- `shared/` (`@de/shared`) — enums, domain types, Zod DTOs (`dto.ts`), RBAC (`rbac.ts`), pricing, brands, statusMap, policy.
- `server/` — Express 4 + Prisma (SQLite dev). `src/http` (app/routes/middleware), `src/services`, `src/adapters` (posportal/fortis/tax), `src/auth`, `src/config.ts` (Zod-validated env), `prisma/`.
- `web/` — React 18 + Vite + TS. `src/pages`, `src/portal` (merchant portal), `src/pages/public` (checkout/tracking), `src/components`, `src/api/client.ts`, `src/stores` (Zustand auth), `src/lib`.
- `scripts/` portable SQLite backup/restore; `data/` backup target (git-ignored).

## Run & verify (Docker only)
```bash
docker compose up                                   # install + restore/seed DB + API(:8090) + web(:5175)
docker compose run --rm tools npm run typecheck     # ALWAYS run after code changes (shared→server→web)
docker compose restart server                       # after server-side changes
docker compose run --rm backup                       # export DB → data/backup.db
```
- App http://localhost:5175 · API health http://localhost:8090/health
- Demo logins (`password123`): `admin@` / `manager@` / `agent@` / `viewer@deployment.local`
- The web dev server (Vite) hot-reloads; the server needs a `docker compose restart server`.
- Verifying a change without a browser: `docker compose run --rm tools npm run typecheck`, then request modules through Vite (`GET http://localhost:5175/src/pages/Foo.tsx` → 200 = compiled) and hit API endpoints with a Bearer token from `POST /api/v1/auth/login`.

## Conventions / gotchas (learned the hard way)
- **Never edit `server/.env`** with the Edit tool — targeted edits have clobbered real Fortis creds twice. Read it masked; use surgical PowerShell line-replaces for non-secret lines only. It's git-ignored.
- **Windows shell**: this repo runs on Windows; use the PowerShell tool for docker/git. For git commit messages use `git commit -F <file>` (heredoc/`@'...'@` here-strings get mangled). LF→CRLF warnings on commit are harmless.
- **POS Portal serials live on line-item `childItems`** (the device), NOT the top-level bundle line — always recurse `childItems`. (An earlier "sandbox has no serials" conclusion was wrong.)
- **Internal transfers / no-outbound orders**: POS Portal flags them `shippingMethodLabel="No Outbound Shipment"` / `carrier="NON_CARRIER"` (consigned inventory movements, e.g. the Fortis-SELLOVER merchant). `isNoOutbound()` in `Orders.tsx` drives the "No Outbound" tab + "Internal transfer" label.
- **Fortis = Zeamster.** Real API base `https://api.sandbox.fortis.tech` (headers `developer-id`/`user-id`/`user-api-key`). Location search uses server-side `filter[name]`+`filter[account_number]` (8,500+ locations, 18 pages — don't scan one page). Terminal `terminal_manufacturer_code` is a STRING: **2=Ingenico**, 1=PAX, 4=IDtech, 100=Virtual Device. Terminal manufacturer/app/CVM defaults are admin-configurable (persisted in `Setting`, audited). Fortis is **live-only** (no mock).
- **Merchant portal isolation**: the `MERCHANT` role holds only `PORTAL_USE`; every `/api/v1/portal/*` route forces `principal.merchantId` server-side, so a merchant can never see another's data. Impersonation mints a merchant-scoped token (audited).
- **All settings changes are audited** (audit middleware on every mutation; `req.auditMeta`).
- **UI** is the Fortis Design System (`web/src/styles.css` tokens; Bio Sans display self-hosted in `web/src/assets/fonts`, Inter body). Restyle came from a Claude Design handoff (`DESIGN_SPEC.md` if re-supplied).

## Current status — where things stand (2026-07-09)
The full app is built and the **Fortis Design System UI refactor is merged to `main`**. Everything
typechecks; DB is populated from the live POS Portal sandbox.

**Open items / next steps:**
1. **Push to remote.** `main` is ~16 commits ahead of `origin/main` (`https://github.com/peterjmacomber/deploymentengine`) — nothing has been pushed. `git push origin main` when ready.
2. **Optional portal detail views** — `/portal/orders/:id` and `/portal/cases/:id` were speced but not built; portal order rows currently expose a "Report an issue" action instead of a dedicated detail page.
3. **Dev-DB test artifacts to clean** (sandbox only): portal login `owner@bellm.test`/`portalpass123`; test return cases (#306, #507) + their sandbox replacement orders; ~3 test terminals created in the Fortis sandbox.
4. **Bio Sans**: only weights 400/600 are self-hosted; the full family (woff2) is available if more weights are needed.
5. **Production**: config-only switch — point `POSP_*` (and provide prod `FORTIS_*`) at production; see `SECURITY.md`.
