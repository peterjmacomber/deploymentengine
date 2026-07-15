import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * Fortis Gateway (Zeamster) terminal integration.
 *
 * Verified sandbox contract (2026-07-11):
 *   - Base:    https://api.sandbox.zeamster.com/v2   (NOT the fortish4ts8b.* portal host)
 *   - Auth:    developer-id / user-id / user-api-key headers
 *   - Create:  POST /v2/terminals   body wrapped as { "terminal": { ... } }
 *              required: location_id, terminal_manufacturer_id, terminal_application_id, serial_number
 *   - Read:    GET  /v2/terminals
 *   - Update:  PUT  /v2/terminals/{id}   ← the sandbox API user currently lacks this privilege (403).
 *   - There is NO "LINKS/last-8" field; the full serial goes in `serial_number`.
 *
 * Because the API user can create + read but not update, the default flow is
 * CREATE-ON-ACTIVATE: the terminal is created once, at the moment the real serial is known.
 * When the "update terminals" privilege is granted, set FORTIS_UPDATE_MODE=true to switch to
 * the placeholder-then-update flow (updateTerminalSerial below is ready for it).
 */

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
  readonly mode: 'mock' | 'live';
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

// ---------------------------------------------------------------------------
// Mock adapter — deterministic, no credentials, keeps an in-memory location book
// so numbering/idempotency behave like the real API during dev/demo.
// ---------------------------------------------------------------------------

class MockFortisAdapter implements FortisAdapter {
  readonly mode = 'mock' as const;
  private seq = 900000;
  private byLocation = new Map<string, FortisTerminalRecord[]>();

  async resolveLocationId(): Promise<string | null> {
    return config.FORTIS_LOCATION_ID ?? 'MOCK-LOC';
  }

  async listTerminals(locationId: string): Promise<FortisTerminalRecord[]> {
    return this.byLocation.get(locationId) ?? [];
  }

  async createTerminal(ctx: FortisCreateContext): Promise<FortisTerminalResult> {
    const locationId = ctx.locationId ?? (await this.resolveLocationId()) ?? 'MOCK-LOC';
    const list = this.byLocation.get(locationId) ?? [];
    const existing = list.find((t) => sameSerial(t.serialNumber, ctx.serialNumber));
    if (existing) {
      return { terminalId: existing.id, title: existing.title ?? ctx.title, serialNumber: ctx.serialNumber, locationId, activated: true, status: 'exists' };
    }
    const id = `FT-${this.seq++}`;
    list.push({ id, title: ctx.title, serialNumber: ctx.serialNumber });
    this.byLocation.set(locationId, list);
    logger.info({ id, title: ctx.title, serial: ctx.serialNumber, locationId }, 'Fortis (mock) created terminal');
    return { terminalId: id, title: ctx.title, serialNumber: ctx.serialNumber, locationId, activated: true, status: 'created' };
  }

  async updateTerminalSerial(terminalId: string, serialNumber: string): Promise<FortisTerminalResult> {
    for (const list of this.byLocation.values()) {
      const t = list.find((x) => x.id === terminalId);
      if (t) {
        t.serialNumber = serialNumber;
        return { terminalId, title: t.title ?? '', serialNumber, activated: true, status: 'updated' };
      }
    }
    return { terminalId, title: '', serialNumber, activated: false, status: 'failed', error: 'terminal not found (mock)' };
  }
}

// ---------------------------------------------------------------------------
// Live adapter — real Fortis Gateway (Zeamster) Commerce API v2
// ---------------------------------------------------------------------------

class LiveFortisAdapter implements FortisAdapter {
  readonly mode = 'live' as const;

  private base(): string {
    // FORTIS_BASE_URL is the host; the API version prefix is appended here.
    return `${config.FORTIS_BASE_URL!.replace(/\/+$/, '')}/v2`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.FORTIS_DEVELOPER_ID) h['developer-id'] = config.FORTIS_DEVELOPER_ID;
    if (config.FORTIS_USER_ID) h['user-id'] = config.FORTIS_USER_ID;
    if (config.FORTIS_USER_API_KEY) h['user-api-key'] = config.FORTIS_USER_API_KEY;
    return h;
  }

  private unwrap(data: unknown): Record<string, unknown> {
    const d = data as { terminal?: unknown; data?: unknown };
    return (d?.terminal ?? d?.data ?? d ?? {}) as Record<string, unknown>;
  }

  async resolveLocationId(): Promise<string | null> {
    // Single configured sandbox location. MID/email→location matching is a future enhancement.
    return config.FORTIS_LOCATION_ID ?? null;
  }

  async listTerminals(locationId: string): Promise<FortisTerminalRecord[]> {
    try {
      const res = await axios.get(`${this.base()}/terminals`, {
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
        error: 'Missing Fortis manufacturer/application id for this device (set them on the bundle or via FORTIS_TERMINAL_* env)',
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
      const res = await axios.post(`${this.base()}/terminals`, { terminal }, { headers: this.headers(), timeout: 20_000 });
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
      const res = await axios.put(`${this.base()}/terminals/${terminalId}`, { terminal: { serial_number: serialNumber } }, { headers: this.headers(), timeout: 20_000 });
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
    instance = config.FORTIS_MODE === 'live' ? new LiveFortisAdapter() : new MockFortisAdapter();
    logger.info({ mode: instance.mode }, 'Fortis adapter initialized');
  }
  return instance;
}
