# BUILD — Deployment Engine reconstruction spec

This document is detailed enough to **rebuild the app from scratch** with a fresh AI prompt. It
describes the stack, structure, data model, API surface, RBAC, adapters, features, and the build
order. Pair it with [DESIGN.md](DESIGN.md) (rationale) and [SECURITY.md](SECURITY.md) (prod).

## 1. Purpose

An internal FortisPay tool for deploying payment equipment. Employees create equipment orders
against the POS Portal (ScanSource) v2 API on behalf of merchants; the system tracks fulfillment,
serials, returns/swaps, deployed units, Fortis Gateway activation, consigned inventory forecasting,
and pricing. Orders are billed to Fortis (the client), which bills merchants separately.

## 2. Stack & repo layout

npm-workspaces monorepo. Node 20, TypeScript everywhere, ESM.

- **`shared/` (`@de/shared`)** — the shared vocabulary imported by server AND web:
  - `enums.ts` — `Role`, `Permission`, `OrderStatus`, `OrderMethod`, `OrderClassification`,
    `PackageStatus`/`TrackerStage`, `ReturnType`/`ReturnLifecycle`/`ReturnReasonCode`/`CallTagStatus`,
    `ExceptionType`/`ExceptionStatus`, `DeployedStatus`, `BundleApplication`/`EncryptionType`/
    `ProcessorPlatform`, `InventoryCondition`, `AlertLevel`. All `as const` objects + union types.
  - `domain.ts` — canonical interfaces the API returns / UI consumes (Merchant, Bundle, Order,
    DeployedEquipment, ReturnCase, ExceptionRequest, InventoryItem, ForecastRow, DeploymentLink,
    User, ApiKey, AuditEntry, DevicePriceRow, MonthValue, AuthenticatedPrincipal, ProblemDetails…).
  - `dto.ts` — Zod request schemas (createOrder, createMerchant, upsertBundle, create/updateLink,
    createReturn, createUser/updateUser, exceptions, etc.).
  - `rbac.ts` — role→permission grant sets, `permissionsForRole`, `ROLE_RANK`, `canManageRole`,
    `assignableRoles`, `API_KEY_GRANTS`.
  - `pricing.ts` — shipping tiers + `DEVICE_PRICE_CATALOG` (UPL seed) + `matchDevicePrice`.
  - `brands.ts` — `DEVICE_BRANDS` regex rules + `brandFromText` (device manufacturer detection).
  - `statusMap.ts` — POS Portal status vocabulary → canonical `OrderStatus`.
  - `policy.ts` — return-window / warranty / restocking constants + tracker stage helpers.
- **`server/`** — Express 4 + Prisma. `src/http` (app, routes, middleware), `src/services`
  (business logic), `src/adapters` (posportal/fortis/tax), `src/auth` (jwt, password), `src/config.ts`
  (Zod-validated env), `prisma/schema.prisma` + `seed.ts`.
- **`web/`** — React 18 + Vite. `src/pages`, `src/components`, `src/api/client.ts`, `src/stores`
  (Zustand auth), `src/lib` (format, brand). TanStack Query for server state; React Router v6.

## 3. Data model (Prisma, SQLite dev → Postgres prod)

Models: **Merchant**, **Bundle** (pospBundleId unique; itemsJson; pospApplication/Encryption/OsBuild;
brand; accountingDeviceModel/UnitPrice), **Order** (status/method/classification; merchant denorm;
linesJson/packagesJson/serialNumbersJson; originLinkToken/Name; syncStatus; **shareToken** unique),
**DeployedEquipment** (serialNumber; merchant/order; DeployedStatus; fortisAccountId/fortisActivated),
**ReturnCase** (**pospReturnId** unique + **origin** engine|posportal; entityType/Id; lifecycle;
itemsJson; replacementOrderId; delinquent), **ExceptionRequest**, **FortisTerminalSync**, **User**
(role; passwordHash; active), **ApiKey** (name; prefix; keyHash sha256; active; lastUsedAt),
**DevicePrice** (keyword unique; model; price — the editable UPL), **ForecastEstimate**
(newPartId+month unique; qty), **Setting** (key/value JSON), **AuditLog** (actor; actorRole; action;
method; path; targetType/targetId; statusCode; metadataJson).

## 4. RBAC

Guards check **permissions**, not roles. Grant sets in `rbac.ts`:
- readonly: all `*_READ`.
- agent: + MERCHANT/ORDER/RETURN/DEPLOYED writes, ORDER_CANCEL, EXCEPTION_REQUEST.
- manager: + EXCEPTION_APPROVE, LINK_WRITE, USER_READ/WRITE (scoped — can only manage roles strictly
  below their own via `canManageRole`).
- admin: + BUNDLE_WRITE, AUDIT_READ, APIKEY_MANAGE, DEV_TOOLS.
- partner: embed-only (merchant/order write, bundle read).
- apikey (`API_KEY_GRANTS`): every operational permission **except** admin ones (no USER_*, BUNDLE_WRITE,
  AUDIT_READ, APIKEY_MANAGE, DEV_TOOLS, EXCEPTION_APPROVE).

Auth middleware accepts a JWT (`Authorization: Bearer`) OR `X-API-Key` (DB-looked-up, sha256).
Principal = `{ kind: user|partner|apikey, role, permissions[] }`. Audit logs every mutation and
**every** API-key call, attributing the actor as `apikey:<name>`.

## 5. API surface (`/api/v1`, JWT/APIKey + RBAC)

merchants (list/get/create), orders (list/get/create/cancel + `/:id/activity` + `/:id/share-token`),
shipping (validate-address/quote), returns (list/get/create/receive + `/:id/activity` + reasons),
deployed-equipment (list/set-status), inventory (consigned, forecast, forecast/estimate),
bundles (CRUD, import, bulk-active, apply-pricing, device-prices GET + `/device-prices/:id`),
settings (shipping/policy), links (CRUD), exceptions (list/create/decide), users (list/create/update),
api-keys (list/create/active/delete — admin), audit, dev (ship/deliver/poll/import-sandbox — admin).
Public planes: `/api/public/v1/link/:token` (+ `/order`, `/tax`, `/order/:id`), `/api/public/v1/track/:token`
(sanitized, no PII). Envelope for errors: RFC-7807 problem+json.

## 6. Adapters (swappable by env)

- **POS Portal** (`POSP_MODE=mock|live`): OAuth2 client-credentials (Azure AD). Orders created as
  DRAFT then PATCHed to OPEN; `whoPaysPos/billTo=CLIENT`; bundles expanded to product line items.
  Endpoints: /merchants, /bundles, /orders(+/items,/packages), /deployedequipment, /returns,
  /shipping/address, /shipping/quote, /inventory/consigned.
- **Fortis** (`FORTIS_MODE=mock|live`): serial→terminal activation; inserts last-8 of serial as the
  LINKS value, matched by merchant MID/email. Live adapter wired, activates on match.
- **Tax** (`TAX_MODE=none|mock|avalara`): AvaTax skeleton for future billing.

`importService` (admin, `POST /dev/import-sandbox`) backfills the DB from the live sandbox:
merchants, bundles (with real app/encryption/OS config), orders + serials → deployed equipment,
**returns/RMAs** (`GET /returns` → ReturnCase, origin=posportal), then applies UPL pricing.

## 7. Feature behaviors (non-obvious)

- **Pricing is device-level.** `DevicePrice` (UPL) is the source of truth; editing a device price
  re-prices every bundle containing that device (`pricingService.applyToBundles`, most-specific
  keyword match). Bundles are sold as devices → one price per device.
- **Brand** = device manufacturer, derived via `brandFromText` (or explicit `bundle.brand`).
- **Checkout Generator** = tokenized deployment links (order or application type); public pages;
  net-revenue analytics = `(listed − standard) × qty + customFee` (discounts show negative);
  optional password/maxUses/expiry; custom named fee.
- **Forecast** split into Alerts (coverage/buy-plan) and Settings (per-part OH Consigned, Past-12
  forecast/demand, avg 3/6/12, and an editable forward 12-month estimate grid in ForecastEstimate).
- **Returns** show POS Portal RMAs (origin=posportal) alongside engine returns; units identified by
  last-8 serial, linking to the origin order.
- **Polling, not webhooks** — `pollerService` reconciles in-flight orders (serials, Fortis activation).
- **Order activity** + **share tracking link** (sanitized) on every order/return detail.

## 8. Config (`server/.env`, validated in `config.ts`)

`JWT_SECRET`, `DATABASE_URL`; `POSP_MODE/BASE_URL/TOKEN_URL/SCOPE/CLIENT_ID/CLIENT_SECRET`,
`POSP_ORDER_WHO_PAYS/BILL_TO=CLIENT`, `POSP_SUBMIT_ORDERS`; `FORTIS_*`; `TAX_*`; `POLL_ENABLED/INTERVAL`;
`WEBHOOKS_ENABLED=false`; `PUBLIC_API_KEYS`. Prod refuses to boot with weak JWT/default keys.

## 9. Docker & DB portability

`docker-compose.yml`: `install` (deps → auto-restore/seed DB → prisma generate/push), `server` (:8090),
`web` (:5175, Vite proxy → server), `tools` (ad-hoc), `backup` (export DB). `node_modules` is a named
volume; source is bind-mounted for hot reload. DB is SQLite (`server/prisma/dev.db`); `scripts/`
export/import to `data/backup.db`; install auto-restores from it when no DB exists.

## 10. Build order (for reconstruction)

1. Scaffold monorepo + `shared` (enums → domain → dto → rbac → pricing/brands → statusMap/policy).
2. Prisma schema + seed (4 login users). Config with Zod env validation.
3. POS Portal adapter interface + mock + live; Fortis + Tax adapters.
4. Services (merchant, bundle, order, return, deployed, inventory, forecast, pricing, link, exception,
   user, apiKey, audit, poller, import) → routes + middleware (auth, audit, validate, rate-limit).
5. Web shell + auth store + api client; pages per §2; universal table controls (search/sort/facets/
   date-range) + reusable DataTable; then feature pages.
6. Docker compose + DB portability scripts. Then live-sandbox import to populate real data.
