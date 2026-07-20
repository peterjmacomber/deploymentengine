import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { fortisLinksValue } from '../../util/ids.js';
import { settingsService } from '../../services/settingsService.js';

/**
 * Fortis Gateway (Zeamster) client.
 *
 * Two DIFFERENT hosts, confirmed live against the sandbox 2026-07-16 (both required — not a
 * config typo):
 *   - `FORTIS_BASE_URL` (https://api.sandbox.fortis.tech), `/v1` — merchant/location search +
 *     terminal-defaults dropdowns (admin Fortis Gateway page, D8). Confirmed: `/v1/locations`
 *     200; `/v2/terminals` 403 on this host.
 *   - `FORTIS_TERMINALS_BASE_URL` (https://api.sandbox.zeamster.com), `/v2` — terminal
 *     provisioning (create/list/update), per Andy Lam's 2026-07-11 spike (wrapped
 *     `{ terminal: {...} }` bodies, `serial_number` not `terminal_api_id`). Confirmed:
 *     `/v2/terminals` 200; `/v1/locations` 404 on this host.
 */

export interface FortisContext {
  serialNumber: string;
  locationId?: string; // the linked Fortis account/location; falls back to FORTIS_LOCATION_ID
  title?: string;
}

export interface FortisSyncResult {
  serialNumber: string;
  linksValue: string; // last-8 of the serial → terminal_api_id (legacy activateDevice path)
  accountId?: string; // Fortis location the terminal was created under
  terminalId?: string;
  activated: boolean;
  status: 'created' | 'failed';
  error?: string;
}

export interface FortisConnectionResult {
  ok: boolean;
  detail: string;
  status?: number;
}

export interface FortisLocation {
  id: string;
  name: string;
  accountNumber: string | null;
  locationType?: string;
}

/** A selectable option for the terminal manufacturer / application / CVM dropdowns. */
export interface FortisTerminalOption {
  id: string; // manufacturers use their numeric `code`; applications/CVMs use `id`
  label: string;
  manufacturerCode?: string; // present on CVMs — lets the UI cascade by manufacturer
}

export interface FortisTerminalOptions {
  manufacturers: FortisTerminalOption[];
  applications: FortisTerminalOption[];
  cvms: FortisTerminalOption[];
}

/** IDs that identify a device model in Fortis. Bundle-level values win; env values are the fallback. */
export interface FortisTerminalConfig {
  locationId?: string;
  manufacturerId?: string;
  applicationId?: string;
  cvmId?: string;
  paymentPriority?: string; // "Credit" | "Debit" -> terminal payment_type_priority
}

export interface FortisCreateContext extends FortisTerminalConfig {
  title: string; // full terminal title, e.g. "VP3300 #1"
  serialNumber: string; // real serial (or a PENDING placeholder in update-mode)
}

export interface FortisTerminalResult {
  terminalId?: string;
  title: string;
  serialNumber: string;
  locationId?: string;
  activated: boolean;
  status: 'created' | 'updated' | 'exists' | 'failed' | 'skipped';
  error?: string;
}

export interface FortisTerminalRecord {
  id: string;
  title?: string;
  serialNumber?: string;
}

export interface FortisAdapter {
  testConnection(): Promise<FortisConnectionResult>;
  /** Search Fortis accounts (locations) by name / account number — the shared key for linking. */
  searchLocations(query: string, limit?: number): Promise<FortisLocation[]>;
  /** Full paginated pull of every location — feeds the local FortisLocationCache sync job. */
  listAllLocations(): Promise<FortisLocation[]>;
  /** Fetch one location by id (e.g. to display its real name for a pre-linked account). */
  getLocation(id: string): Promise<FortisLocation | null>;
  /** Reference lists (manufacturer/application/CVM) for the terminal-defaults dropdowns. */
  listTerminalOptions(): Promise<FortisTerminalOptions>;
  /** Create a terminal (equipment) record: full serial → serial_number, last-8 → terminal_api_id. */
  activateDevice(ctx: FortisContext): Promise<FortisSyncResult>;

  /** The Fortis Gateway location a terminal belongs to (single configured sandbox location for now). */
  resolveLocationId(hint?: { mid?: string; email?: string }): Promise<string | null>;
  /** Existing terminals in a location — used for title numbering and create-idempotency. */
  listTerminals(locationId: string): Promise<FortisTerminalRecord[]>;
  /** Create a terminal carrying the given serial (create-on-activate, and update-mode placeholders). */
  createTerminal(ctx: FortisCreateContext): Promise<FortisTerminalResult>;
  /** Update an existing terminal's serial. Requires the "update terminals" privilege (else 403). */
  updateTerminalSerial(terminalId: string, serialNumber: string): Promise<FortisTerminalResult>;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested): model/title derivation and per-location numbering
// ---------------------------------------------------------------------------

const VENDOR_PREFIXES = ['IDTECH', 'IDT', 'ID TECH', 'PAX', 'INGENICO', 'ING', 'DEJAVOO', 'DJV', 'EQUINOX', 'MAGTEK', 'VERIFONE', 'CLOVER'];

/**
 * Turn an accounting model / bundle name into the terminal title's model token.
 * "ID Tech VP3300 — Mobile Reader Bundle" -> "VP3300", "PAX A920 Pro" -> "A920",
 * "DJV QD4" -> "QD4". Prefers a device-model token (letters+digits); otherwise strips a
 * leading known vendor prefix; otherwise returns the original text.
 */
export function deriveTitleModel(name?: string): string {
  const raw = (name ?? '').trim();
  if (!raw) return 'Terminal';
  // A device-model token looks like letters followed by digits (VP3300, A920, A80, QD4).
  const token = raw.match(/\b([A-Za-z]{1,5}\d{1,4}[A-Za-z0-9]*)\b/);
  if (token) return token[1];
  const upper = raw.toUpperCase();
  for (const p of VENDOR_PREFIXES) {
    if (upper.startsWith(p + ' ')) {
      const rest = raw.slice(p.length).trim();
      if (rest) return rest;
    }
  }
  return raw;
}

/** Next "#N" for a model given existing terminal titles in the location (sequential per location). */
export function nextIndexForModel(titles: Array<string | undefined>, model: string): number {
  const re = new RegExp(`^${escapeRegExp(model)}\\s*#(\\d+)$`, 'i');
  let max = 0;
  for (const t of titles) {
    const m = (t ?? '').trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize serials for equality checks (Fortis may store/trim differently). */
function sameSerial(a?: string, b?: string): boolean {
  return (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();
}

class LiveFortisAdapter implements FortisAdapter {
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.FORTIS_DEVELOPER_ID) h['developer-id'] = config.FORTIS_DEVELOPER_ID;
    if (config.FORTIS_USER_ID) h['user-id'] = config.FORTIS_USER_ID;
    if (config.FORTIS_USER_API_KEY) h['user-api-key'] = config.FORTIS_USER_API_KEY;
    return h;
  }

  /** Base + version prefix for terminal-provisioning calls — a different host than FORTIS_BASE_URL. */
  private baseV2(): string {
    return `${config.FORTIS_TERMINALS_BASE_URL.replace(/\/+$/, '')}/v2`;
  }

  private unwrap(data: unknown): Record<string, unknown> {
    const d = data as { terminal?: unknown; data?: unknown };
    return (d?.terminal ?? d?.data ?? d ?? {}) as Record<string, unknown>;
  }

  // -- Merchant linking / terminal-defaults dropdowns (D8, /v1) ------------------------------

  async testConnection(): Promise<FortisConnectionResult> {
    const base = config.FORTIS_BASE_URL;
    if (!base) return { ok: false, detail: 'FORTIS_BASE_URL is not set.' };
    if (!config.FORTIS_USER_ID || !config.FORTIS_USER_API_KEY) return { ok: false, detail: 'FORTIS_USER_ID / FORTIS_USER_API_KEY are not set.' };
    try {
      const res = await axios.get(`${base}/v1/locations`, { headers: this.headers(), params: { 'page[size]': 1 }, timeout: 20_000, validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) return { ok: true, detail: `Connected to Fortis Gateway (${base}).`, status: res.status };
      if (res.status === 401 || res.status === 403) return { ok: false, detail: `Authentication rejected (HTTP ${res.status}) — check developer-id / user-id / user-api-key.`, status: res.status };
      if (res.status === 404) return { ok: false, detail: `Not found (HTTP 404) at ${base}/v1/locations — FORTIS_BASE_URL may be wrong.`, status: res.status };
      return { ok: false, detail: `Fortis Gateway returned HTTP ${res.status}.`, status: res.status };
    } catch (err) {
      return { ok: false, detail: `Could not reach Fortis Gateway: ${(err as Error).message}` };
    }
  }

  async searchLocations(query: string, limit = 25): Promise<FortisLocation[]> {
    const base = config.FORTIS_BASE_URL;
    if (!base || !config.FORTIS_USER_ID) return [];
    const q = query.trim();
    if (!q) return [];
    // The sandbox has 8,500+ locations across many pages, so a single-page client-side scan
    // misses most accounts. Fortis supports server-side filters — query name AND account number
    // and merge. (Each filtered call is scoped server-side, so it searches the whole dataset.)
    const fetchWith = async (params: Record<string, unknown>): Promise<any[]> => {
      const res = await axios.get(`${base}/v1/locations`, { headers: this.headers(), params: { ...params, 'page[size]': 100 }, timeout: 30_000, validateStatus: () => true });
      return res.status >= 200 && res.status < 300 ? res.data?.list ?? res.data?.data ?? [] : [];
    };
    try {
      const [byName, byAccount] = await Promise.all([
        fetchWith({ 'filter[name]': q }),
        fetchWith({ 'filter[account_number]': q }),
      ]);
      const merged = new Map<string, any>();
      for (const l of [...byName, ...byAccount]) merged.set(String(l.id), l);
      return [...merged.values()]
        .slice(0, limit)
        .map((l) => ({ id: String(l.id), name: l.name ?? '', accountNumber: l.account_number ?? null, locationType: l.location_type ?? undefined }));
    } catch (err) {
      logger.warn({ err: (err as Error).message, query }, 'Fortis location search failed');
      return [];
    }
  }

  async getLocation(id: string): Promise<FortisLocation | null> {
    const base = config.FORTIS_BASE_URL;
    if (!base || !config.FORTIS_USER_ID) return null;
    try {
      const res = await axios.get(`${base}/v1/locations/${id}`, { headers: this.headers(), timeout: 20_000, validateStatus: () => true });
      if (res.status < 200 || res.status >= 300) return null;
      const l = res.data?.data ?? res.data;
      if (!l?.id) return null;
      return { id: String(l.id), name: l.name ?? '', accountNumber: l.account_number ?? null, locationType: l.location_type ?? undefined };
    } catch (err) {
      logger.warn({ err: (err as Error).message, id }, 'Fortis getLocation failed');
      return null;
    }
  }

  async listAllLocations(): Promise<FortisLocation[]> {
    const base = config.FORTIS_BASE_URL;
    if (!base || !config.FORTIS_USER_ID) return [];
    const out: FortisLocation[] = [];
    const pageSize = 200;
    let page = 1;
    // Hard cap so a runaway pagination bug can't loop forever against the live sandbox.
    for (; page <= 100; page += 1) {
      let rows: any[] = [];
      try {
        const res = await axios.get(`${base}/v1/locations`, {
          headers: this.headers(),
          params: { 'page[number]': page, 'page[size]': pageSize },
          timeout: 30_000,
          validateStatus: () => true,
        });
        if (res.status < 200 || res.status >= 300) break;
        rows = res.data?.list ?? res.data?.data ?? [];
      } catch (err) {
        logger.warn({ err: (err as Error).message, page }, 'Fortis listAllLocations page failed');
        break;
      }
      if (!rows.length) break;
      for (const l of rows) out.push({ id: String(l.id), name: l.name ?? '', accountNumber: l.account_number ?? null, locationType: l.location_type ?? undefined });
      if (rows.length < pageSize) break;
    }
    logger.info({ count: out.length, pages: page }, 'Fortis listAllLocations complete');
    return out;
  }

  async listTerminalOptions(): Promise<FortisTerminalOptions> {
    const base = config.FORTIS_BASE_URL;
    const empty: FortisTerminalOptions = { manufacturers: [], applications: [], cvms: [] };
    if (!base || !config.FORTIS_USER_ID) return empty;
    const fetchList = async (path: string): Promise<any[]> => {
      const res = await axios.get(`${base}${path}`, { headers: this.headers(), params: { 'page[size]': 200 }, timeout: 30_000, validateStatus: () => true });
      if (res.status < 200 || res.status >= 300) return [];
      return res.data?.list ?? res.data?.data ?? [];
    };
    try {
      const [mans, apps, cvms] = await Promise.all([
        fetchList('/v1/terminal-manufacturers'),
        fetchList('/v1/terminal-applications'),
        fetchList('/v1/terminal-cvms'),
      ]);
      return {
        manufacturers: mans
          .map((m) => ({ id: String(m.code), label: m.title ?? `Code ${m.code}` }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        applications: apps
          .map((a) => ({ id: String(a.id), label: a.title ? String(a.title) : `(untitled ${String(a.id).slice(-6)})` }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        cvms: cvms
          .map((c) => ({ id: String(c.id), label: c.title ? String(c.title) : `(untitled ${String(c.id).slice(-6)})`, manufacturerCode: c.terminal_manufacturer_code != null ? String(c.terminal_manufacturer_code) : undefined }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Fortis terminal options fetch failed');
      return empty;
    }
  }

  async activateDevice(ctx: FortisContext): Promise<FortisSyncResult> {
    const linksValue = fortisLinksValue(ctx.serialNumber);
    const locationId = ctx.locationId || config.FORTIS_LOCATION_ID;
    if (!locationId) {
      return { serialNumber: ctx.serialNumber, linksValue, activated: false, status: 'failed', error: 'No Fortis location — link the merchant to a Fortis account first (or set FORTIS_LOCATION_ID).' };
    }
    // Terminal manufacturer / application / CVM come from the admin-configured defaults
    // (persisted + audited), falling back to env then the sandbox-verified Ingenico values.
    const td = await settingsService.getFortisTerminal();
    const body: Record<string, unknown> = {
      location_id: locationId,
      title: ctx.title || `Terminal ${linksValue}`,
      serial_number: ctx.serialNumber,
      [config.FORTIS_LINK_FIELD]: linksValue, // terminal_api_id = last-8
      terminal_application_id: td.applicationId,
      terminal_cvm_id: td.cvmId,
      terminal_manufacturer_code: td.manufacturerCode,
      debit: false, emv: false, cashback_enable: false, print_enable: false, sig_capture_enable: false,
    };
    try {
      const res = await axios.post(`${config.FORTIS_BASE_URL}/v1/terminals`, body, { headers: this.headers(), timeout: 25_000, validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        const t = res.data?.data ?? res.data?.list?.[0] ?? res.data;
        return { serialNumber: ctx.serialNumber, linksValue, accountId: locationId, terminalId: t?.id ? String(t.id) : undefined, activated: true, status: 'created' };
      }
      const detail = res.data?.detail ?? res.data?.title ?? `HTTP ${res.status}`;
      logger.error({ status: res.status, detail, serial: ctx.serialNumber }, 'Fortis terminal create failed');
      return { serialNumber: ctx.serialNumber, linksValue, accountId: locationId, activated: false, status: 'failed', error: String(detail) };
    } catch (err) {
      logger.error({ err: (err as Error).message, serial: ctx.serialNumber }, 'Fortis terminal create errored');
      return { serialNumber: ctx.serialNumber, linksValue, accountId: locationId, activated: false, status: 'failed', error: (err as Error).message };
    }
  }

  // -- Terminal provisioning (Andy, /v2 create-on-activate) ----------------------------------

  async resolveLocationId(): Promise<string | null> {
    // Single configured sandbox location. MID/email→location matching is a future enhancement.
    return config.FORTIS_LOCATION_ID ?? null;
  }

  async listTerminals(locationId: string): Promise<FortisTerminalRecord[]> {
    try {
      const res = await axios.get(`${this.baseV2()}/terminals`, {
        headers: this.headers(),
        params: { location_id: locationId, 'page[size]': 200 },
        timeout: 20_000,
      });
      const rows = (res.data?.terminals ?? res.data?.list ?? res.data?.data ?? []) as Array<Record<string, unknown>>;
      return rows
        .filter((r) => !locationId || String(r.location_id ?? '') === locationId)
        .map((r) => ({ id: String(r.id), title: r.title as string | undefined, serialNumber: r.serial_number as string | undefined }));
    } catch (err) {
      logger.warn({ err: (err as Error).message, locationId }, 'Fortis listTerminals failed');
      return [];
    }
  }

  async createTerminal(ctx: FortisCreateContext): Promise<FortisTerminalResult> {
    const locationId = ctx.locationId ?? (await this.resolveLocationId());
    if (!locationId) {
      return { terminalId: undefined, title: ctx.title, serialNumber: ctx.serialNumber, activated: false, status: 'failed', error: 'No Fortis location configured' };
    }
    const manufacturerId = ctx.manufacturerId ?? config.FORTIS_TERMINAL_MANUFACTURER_ID;
    const applicationId = ctx.applicationId ?? config.FORTIS_TERMINAL_APPLICATION_ID;
    const cvmId = ctx.cvmId ?? config.FORTIS_TERMINAL_CVM_ID;
    if (!manufacturerId || !applicationId) {
      return {
        terminalId: undefined, title: ctx.title, serialNumber: ctx.serialNumber, locationId, activated: false, status: 'failed',
        error: 'Missing Fortis manufacturer/application id for this device (set them on its TerminalModel or via FORTIS_TERMINAL_* env)',
      };
    }

    // Idempotency: if a terminal with this serial already exists in the location, reuse it.
    const existing = (await this.listTerminals(locationId)).find((t) => sameSerial(t.serialNumber, ctx.serialNumber));
    if (existing) {
      logger.info({ id: existing.id, serial: ctx.serialNumber }, 'Fortis terminal for serial already exists — reusing');
      return { terminalId: existing.id, title: existing.title ?? ctx.title, serialNumber: ctx.serialNumber, locationId, activated: true, status: 'exists' };
    }

    const terminal: Record<string, unknown> = {
      location_id: locationId,
      terminal_manufacturer_id: manufacturerId,
      terminal_application_id: applicationId,
      title: ctx.title,
      serial_number: ctx.serialNumber,
    };
    if (cvmId) terminal.terminal_cvm_id = cvmId;
    if (ctx.paymentPriority) terminal.payment_type_priority = ctx.paymentPriority;

    try {
      const res = await axios.post(`${this.baseV2()}/terminals`, { terminal }, { headers: this.headers(), timeout: 20_000 });
      const body = this.unwrap(res.data);
      const terminalId = body.id ? String(body.id) : undefined;
      logger.info({ terminalId, title: ctx.title, serial: ctx.serialNumber, locationId }, 'Fortis terminal created');
      return { terminalId, title: ctx.title, serialNumber: ctx.serialNumber, locationId, activated: true, status: 'created' };
    } catch (err) {
      const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : (err as Error).message;
      logger.error({ err: detail, title: ctx.title, serial: ctx.serialNumber }, 'Fortis terminal create failed');
      return { terminalId: undefined, title: ctx.title, serialNumber: ctx.serialNumber, locationId, activated: false, status: 'failed', error: detail };
    }
  }

  async updateTerminalSerial(terminalId: string, serialNumber: string): Promise<FortisTerminalResult> {
    try {
      const res = await axios.put(`${this.baseV2()}/terminals/${terminalId}`, { terminal: { serial_number: serialNumber } }, { headers: this.headers(), timeout: 20_000 });
      const body = this.unwrap(res.data);
      return { terminalId, title: (body.title as string) ?? '', serialNumber, activated: true, status: 'updated' };
    } catch (err) {
      const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : (err as Error).message;
      logger.error({ err: detail, terminalId, serial: serialNumber }, 'Fortis terminal update failed');
      return { terminalId, title: '', serialNumber, activated: false, status: 'failed', error: detail };
    }
  }
}

let instance: FortisAdapter | null = null;
export function fortis(): FortisAdapter {
  if (!instance) {
    instance = new LiveFortisAdapter();
    logger.info({ configured: config.fortisConfigured, baseUrl: config.FORTIS_BASE_URL }, 'Fortis adapter initialized (live)');
  }
  return instance;
}
