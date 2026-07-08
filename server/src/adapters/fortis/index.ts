import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { fortisLinksValue } from '../../util/ids.js';
import { settingsService } from '../../services/settingsService.js';

/**
 * Real Fortis Gateway (Zeamster) client — verified against the sandbox:
 *   base    : FORTIS_BASE_URL (e.g. https://api.sandbox.fortis.tech)
 *   auth    : headers developer-id / user-id / user-api-key
 *   accounts: GET /v1/locations   (merchant = "location"; keyed by name + account_number, NOT MID)
 *   devices : POST /v1/terminals  (serial_number = full serial, terminal_api_id = last-8 "LINKS")
 * There is intentionally NO mock — behavior always reflects the live API.
 */

export interface FortisContext {
  serialNumber: string;
  locationId?: string; // the linked Fortis account/location; falls back to FORTIS_LOCATION_ID
  title?: string;
}

export interface FortisSyncResult {
  serialNumber: string;
  linksValue: string; // last-8 of the serial → terminal_api_id
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

export interface FortisAdapter {
  testConnection(): Promise<FortisConnectionResult>;
  /** Search Fortis accounts (locations) by name / account number — the shared key for linking. */
  searchLocations(query: string, limit?: number): Promise<FortisLocation[]>;
  /** Reference lists (manufacturer/application/CVM) for the terminal-defaults dropdowns. */
  listTerminalOptions(): Promise<FortisTerminalOptions>;
  /** Create a terminal (equipment) record: full serial → serial_number, last-8 → terminal_api_id. */
  activateDevice(ctx: FortisContext): Promise<FortisSyncResult>;
}

class LiveFortisAdapter implements FortisAdapter {
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.FORTIS_DEVELOPER_ID) h['developer-id'] = config.FORTIS_DEVELOPER_ID;
    if (config.FORTIS_USER_ID) h['user-id'] = config.FORTIS_USER_ID;
    if (config.FORTIS_USER_API_KEY) h['user-api-key'] = config.FORTIS_USER_API_KEY;
    return h;
  }

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
}

let instance: FortisAdapter | null = null;
export function fortis(): FortisAdapter {
  if (!instance) {
    instance = new LiveFortisAdapter();
    logger.info({ configured: config.fortisConfigured, baseUrl: config.FORTIS_BASE_URL }, 'Fortis adapter initialized (live)');
  }
  return instance;
}
