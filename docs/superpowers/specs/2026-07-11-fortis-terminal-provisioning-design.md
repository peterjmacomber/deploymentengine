# Fortis Gateway Terminal Provisioning & Activation — Design

**Date:** 2026-07-11
**Owner:** Andy Lam (FortisPay)
**Status:** Proposed — awaiting review

## 1. Goal

Make the **Fortis Activate** button (and the automatic shipment path) actually work against
the real Fortis Gateway (Zeamster) sandbox, using a **two-phase** model:

1. **Provision** — when an order is placed in Deployment Engine, auto-create a *placeholder*
   terminal in Fortis Gateway for each device unit (e.g. title `VP3300 #1`, serial `PENDING…`)
   with the correct manufacturer / application / CVM for that device.
2. **Activate** — when the real serial number is known (POS Portal ships it, or an operator
   clicks **Fortis Activate**), update that placeholder terminal's `serial_number` to the real
   value (e.g. `90000001`) via `PUT /v2/terminals/{id}`.

## 2. Ground truth discovered against the sandbox (2026-07-11)

These findings correct the assumptions baked into the current code:

| Item | Current code (wrong) | Reality (verified) |
|---|---|---|
| API host | `https://fortish4ts8b.sandbox.zeamster.com` (a static S3 portal SPA — every API call 403s) | `https://api.sandbox.zeamster.com` |
| Path prefix | `/v1/...` | `/v2/...` |
| Serial field | last-8 uppercased ("LINKS") into `terminal_api_id` | full serial in **`serial_number`** — no "LINKS" concept exists |
| Request body | flat JSON | wrapped: `{ "terminal": { … } }` |
| Create required fields | — | `location_id`, `terminal_manufacturer_id`, `terminal_application_id`, `serial_number` |
| Per-model IDs | env vars, empty/guessed | live IDs already exist on the sandbox terminal record |

**A placeholder already exists in the sandbox**, confirming the intended workflow:

```
id:                       11f17d3e16886840a39f1963
title:                    "VP3300 #1"
serial_number:            "TBD"
location_id:              11f1797b94d101ec9bf0c3d3   (the "deploymentengine" location)
terminal_manufacturer_id: 4                          (IDtech)
terminal_application_id:  11eb1875895820ecab318375
terminal_cvm_id:          11eb17992c21d8f085973141
active:                   1
```

**Manufacturer IDs (sandbox):** PAX=1, Ingenico=2, Equinox=3, IDtech=4, MagTek=5,
Virtual Device=100. Three older `DE …` terminals also exist — duplicates created by the
current always-`POST` code; not part of the target flow.

Auth headers (`developer-id`, `user-id`, `user-api-key`) are already correct and authenticate
(HTTP 200).

## 3. Decisions (confirmed with owner)

- **Model:** auto-create placeholder on order placement, update serial on activation.
- **Per-device Fortis IDs:** stored **on each Bundle** (admin-editable overlay), matching the
  existing pattern where bundles already carry `application`/`encryption`/`processorPlatform`.
  Seed the VP3300 bundle with the known-good trio (mfr `4`, app `11eb1875895820ecab318375`,
  cvm `11eb17992c21d8f085973141`). Fall back to env defaults when a bundle's fields are blank.
- **Title numbering:** `{model} #{N}`, **sequential per Fortis location** — query existing
  terminals in the location, find the max `N` for that model prefix, use `max+1`.

## 4. Architecture

### 4.1 Adapter (`server/src/adapters/fortis/index.ts`)

Replace the single `activateDevice()` with two explicit operations behind the `FortisAdapter`
interface (both `mock` and `live` implementations):

```
provisionTerminal(ctx): Promise<FortisTerminalResult>   // POST /v2/terminals (placeholder, serial=PENDING…)
activateTerminal(terminalId, serialNumber): Promise<FortisTerminalResult>   // PUT /v2/terminals/{id}
nextTitleIndex(locationId, model): Promise<number>       // GET /v2/terminals?... → max N + 1
resolveLocationId(ctx): Promise<string>                  // configured FORTIS_LOCATION_ID (MID/email match = future)
```

- **Live** targets `https://api.sandbox.zeamster.com/v2`, wraps bodies in `{ terminal: {…} }`,
  reads the id from the response.
- **Mock** returns deterministic fake ids so the app still demos with zero credentials.
- Delete `fortisLinksValue` / LINKS usage and the `FORTIS_LINK_FIELD` config.

### 4.2 Data model (Prisma)

- **Bundle** — add `fortisManufacturerId String?`, `fortisApplicationId String?`,
  `fortisCvmId String?`.
- **New `FortisTerminal`** (provisioning state — one row per placeholder):
  `id, orderId, model, title, unitIndex, terminalId (Fortis id), locationId,
   serialNumber String? (null until activated), status (placeholder|activated|failed),
   error String?, createdAt, updatedAt`.
  This is the mapping that makes activation a precise `PUT` by id (no fuzzy title matching).
- **FortisTerminalSync** stays as the append-only event log; `linksValue` becomes optional and
  is no longer populated (kept for backward-compatible reads).

### 4.3 Phase 1 — Provision (in `orderService.create()`)

All order-creation paths funnel through `orderService.create()`, so provisioning lives there,
after the order row is written. Best-effort, **never blocks order creation**:

1. For each order line that is a **device** (bundle has `accountingDeviceModel` and/or Fortis
   IDs), for each unit `1..quantity`:
   - `model = bundle.accountingDeviceModel` (fallback: parse `displayName`).
   - `N = nextTitleIndex(locationId, model)`; `title = "{model} #{N}"`.
   - IDs = bundle Fortis fields (fallback env defaults).
   - `serial_number = "PENDING-{orderRef}-{N}"` (unique placeholder; validated in spike).
   - `provisionTerminal(...)` → persist a `FortisTerminal` row with the returned id.
2. Wrap in `try/catch`; on failure record `status=failed` + error, continue. Only runs in
   Fortis **live** mode (mock in dev). Skipped for orders ingested by `importService`
   (they may already be shipped) — the button still covers those.

### 4.4 Phase 2 — Activate (shipment + manual button)

`orderService.activateFortisSerial(orderId, serialNumber)` and the auto path in
`processShipment()`:

1. Map the serial to its device line/model (existing index logic in `activateFortisSerial`).
2. Find the matching **unactivated** `FortisTerminal` placeholder for that order+model.
3. `activateTerminal(terminalId, serialNumber)` → `PUT` the real serial.
4. Update `FortisTerminal` (serialNumber, status=activated), `DeployedEquipment`
   (`fortisTerminalId`, `fortisActivated=true`), and append a `FortisTerminalSync` log row.
5. **Fallback:** if no placeholder exists (legacy/imported order), `provisionTerminal` with the
   real serial directly (create-with-serial), so the button always succeeds.

### 4.5 Frontend

Keep `FortisActivateModal`. Update the success toast to show the terminal title, e.g.
`VP3300 #1 → serial 90000001 activated`. No structural UI change.

### 4.6 Config / env

- `FORTIS_BASE_URL=https://api.sandbox.zeamster.com` (code appends `/v2`).
- Add `FORTIS_TERMINAL_CVM_ID` to the config schema (already in `.env`, currently ignored).
- Remove `FORTIS_LINK_FIELD`. Env defaults act as fallback when a bundle has no Fortis IDs.

## 5. Error handling

- Provisioning failure → logged, `FortisTerminal.status=failed`, order still created; retryable.
- Activation failure → surfaced to the operator via the existing toast; `status=failed` logged.
- Live writes only when `FORTIS_MODE=live` and required config present; otherwise mock.

## 6. Testing

- **TDD unit tests:** title-index parsing (`VP3300 #1` → next `2`), model extraction,
  serial→unit/model mapping, adapter payload shape (mock), idempotent provisioning.
- **Live sandbox spike (first implementation step):** create → update → delete one throwaway
  terminal against `api.sandbox.zeamster.com` to confirm the `{terminal:{…}}` wrap, the
  `serial_number` update contract, and placeholder-serial acceptance (IDtech `idtype=mac`).
  Any surprise feeds back into the adapter before wider wiring.

## 7. Open technical risks (validated during the spike, not blocking design)

1. Whether `PUT /v2/terminals/{id}` accepts a partial `{terminal:{serial_number}}` body.
2. Whether a non-MAC placeholder serial is accepted for IDtech (`idtype=mac`) — the existing
   `TBD` placeholder suggests yes.
3. Terminal `serial_number` uniqueness per location (drives the `PENDING-…` scheme).

## 8. Out of scope (YAGNI)

- MID/email→location matching (single configured sandbox location is sufficient now).
- Retro-provisioning imported/polled POS Portal orders.
- Production Fortis credentials/host (config-only switch later).
