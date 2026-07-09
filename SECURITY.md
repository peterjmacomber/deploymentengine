# Security posture & production hardening

Deployment Engine is an **internal employee tool** that holds POS Portal credentials and merchant
PII. This documents the controls built into the code and the concrete steps IT must take before
moving it to production.

## Built-in controls (in the code today)

**Authentication & sessions**
- JWT access tokens (HS256) with issuer/audience checks, 1-hour TTL. Passwords hashed with **bcrypt**
  (12 rounds). Login returns a generic error (no user enumeration) and is rate-limited (10/min/IP).

**Authorization (RBAC)** — guards check **permissions, not roles** (`requirePermission`):
- readonly < agent < manager < admin. Managers run Approvals, the **Checkout Generator**, and
  **scoped user management** (can only create/edit users *below their own level*, enforced server-side
  via `canManageRole`). Policies, Bundles & Pricing, Audit Log, API Keys, and dev tools are **admin-only**.
- The web hides nav by permission, but the **server is the source of truth** — hiding UI is never the control.

**Merchant self-service portal (tenant isolation)**
- The `MERCHANT` role holds a single permission (`PORTAL_USE`) and **no internal-route access**. Every
  `/api/v1/portal/*` route independently forces the request to the token's own `merchantId`, so a
  merchant can never read or act on another merchant's data regardless of any id in the URL.
- Merchant logins are provisioned only by admins/managers (Merchant → Portal Access). Admin/manager
  **impersonation** issues a short-lived merchant-scoped token that records the impersonating actor
  (`imp`) and is written to the audit log; `sub` stays the real internal user for traceability.

**Integration API keys** (Admin → API Keys)
- DB-backed, stored as **sha256 hashes** (raw shown once at creation); `active` flag for instant revocation.
- Authenticate via `X-API-Key` on `/api/v1/*` with the **non-admin** grant set (no user mgmt, pricing,
  audit, key mgmt, approvals, or dev tools). **Every** key call — reads included — is written to the
  audit log as `apikey:<name>`.

**Public planes (no JWT, by design)**
- **Checkout links** `/api/public/v1/link/:token` — the unguessable token is the credential, with
  optional per-link **password** (bcrypt), **max-uses**, and **expiry** enforced per request.
- **Sanitized tracking** `/api/public/v1/track/:token` — fulfillment status only; **no MID, DBA,
  address, phone, or email**. Verified free of merchant PII.

**Transport / app hardening**
- `helmet` headers, strict **CORS allowlist** (`CORS_ORIGIN`), `x-powered-by` off, `trust proxy` set.
- JSON body cap (1 MB); global + per-plane **rate limits**. All input validated with **Zod**; DB via
  **Prisma** (parameterized — no SQL injection). No `dangerouslySetInnerHTML`/`eval`/`child_process`.
- Errors as RFC-7807 problem+json with **stack/detail hidden in production**. Secrets read from env
  only, **never logged** (pino redaction). **Full audit trail** of every state-changing request.

**No public ingress (polling-only)**
- The app never needs inbound calls: `pollerService` reconciles order status/serials/Fortis activation
  by polling POS Portal. The inbound webhook receiver is **unmounted** unless `WEBHOOKS_ENABLED=true`.

**Production secret guard** — with `NODE_ENV=production` the server **refuses to boot** on a weak/default
`JWT_SECRET` or demo webhook/partner keys.

## Production checklist for IT

1. **Network isolation.** Host on an internal VM reachable only over the corporate network/VPN. Do
   **not** expose ports `8090`/`5175` publicly. There is no inbound integration requirement.
2. **TLS + reverse proxy.** Front with nginx/Caddy terminating TLS; add HSTS/CSP there. Forward to the
   API; serve the **built** web (`web/dist` from `npm run build`) — **do not run the Vite dev server or
   this dev `docker-compose.yml` in production** (it hot-reloads source and installs at runtime).
3. **Secrets management.** Move `JWT_SECRET`, `POSP_CLIENT_SECRET`, `FORTIS_*`, `WEBHOOK_*` out of a
   plaintext `.env` on disk into the org secret manager / VM secret store (or Docker secrets). Generate
   a 32+ char random `JWT_SECRET`. Files that must exist on disk: `chmod 600`, service-account-owned,
   never committed (they are git-ignored).
4. **Rotate demo users.** `admin@deployment.local` etc. use `password123`. Create real users via the
   Users page and **deactivate/delete the demo accounts** before go-live.
5. **API keys = least privilege + rotation.** Issue one key per integration with a recognizable name;
   store it in the consumer's secret manager; rotate on a schedule and revoke immediately if leaked
   (all key traffic is audited by name).
6. **Database.** SQLite is fine for a single VM — **schedule `data/backup.db` exports** (`docker compose
   run --rm backup`) to off-box storage and test `db:import`. For HA/multi-instance, switch the Prisma
   provider to **Postgres** (schema ports cleanly), use a managed DB with encryption at rest and PITR.
7. **CORS_ORIGIN** = the exact https web origin. No wildcards.
8. **Dev/simulation endpoints** (`/api/v1/dev/*`, admin-only): `ship`/`deliver` are local simulation —
   never run on live orders; real state comes from polling. `import-sandbox` refreshes from the API and
   is confirm-gated. Consider disabling `DEV_TOOLS` for admins in prod if simulation isn't needed.
9. **Patching.** Keep Node and dependencies current; run `npm audit` in CI; rebuild the base image for OS
   CVEs. Pin/scan container images.
10. **Backups & DR.** Off-box, encrypted backups of the DB and secrets; documented restore drill.

## Sandbox → production switch (POS Portal)

Config-only — identical endpoints and code. Change only: `POSP_BASE_URL` (→ prod), `POSP_TOKEN_URL`,
`POSP_SCOPE`, `POSP_CLIENT_ID`, `POSP_CLIENT_SECRET`. Keep `POSP_ORDER_WHO_PAYS/BILL_TO=CLIENT`
(orders bill Fortis). Do a read-only smoke test (merchants/bundles/orders) before enabling order writes;
consider `POSP_SUBMIT_ORDERS=false` for an initial dry run (creates DRAFT without finalizing).

## Fortis Gateway (Zeamster)

Fortis is a **live integration (no mock)**. Provide `FORTIS_BASE_URL` + credentials
(`FORTIS_DEVELOPER_ID`/`FORTIS_USER_ID`/`FORTIS_USER_API_KEY`, etc.) via the secret manager, not
plaintext. For production, repoint `FORTIS_BASE_URL` at the prod host and use prod credentials, verify
serial→terminal activation against a test merchant first, and confirm the terminal defaults
(manufacturer/application/CVM — set on the admin Fortis Gateway page, persisted in the DB `Setting`)
match the target Fortis account. `terminal_api_id` is the **last-8 of the serial**.

## Accepted trade-offs
- JWT in `localStorage` (standard for SPAs); mitigated by no XSS sinks + short TTL. Move to httpOnly
  cookies + CSRF if stricter isolation is required.
- If this repo lives in OneDrive, exclude the `.git` folder and `node_modules` from OneDrive sync to
  avoid corruption; prefer a proper Git remote for the source of truth.
