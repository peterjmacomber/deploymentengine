import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { fortisLinksValue } from '../../util/ids.js';

export interface FortisContext {
  serialNumber: string;
  merchantMid?: string;
  merchantName?: string;
  merchantEmail?: string;
}

export interface FortisSyncResult {
  serialNumber: string;
  linksValue: string; // last 8 alphanumerics of the serial
  accountId?: string; // the matched Fortis Gateway account/location
  terminalId?: string; // the device record created in Fortis
  activated: boolean;
  status: 'created' | 'failed' | 'skipped';
  error?: string;
}

export interface FortisAdapter {
  readonly mode: 'mock' | 'live';
  /**
   * Provision + activate a device in Fortis Gateway for a shipped serial:
   *  1. find the merchant's Fortis Gateway account (by MID, then email/name),
   *  2. insert the last-8 of the serial into the device section (the LINKS field),
   *  which instantly activates the terminal for use.
   */
  activateDevice(ctx: FortisContext): Promise<FortisSyncResult>;
}

/** Deterministic pseudo account id from a merchant identifier (mock only). */
function mockAccountId(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `FG-${(h % 900000) + 100000}`;
}

class MockFortisAdapter implements FortisAdapter {
  readonly mode = 'mock' as const;
  private seq = 800000;
  async activateDevice(ctx: FortisContext): Promise<FortisSyncResult> {
    const linksValue = fortisLinksValue(ctx.serialNumber);
    const key = ctx.merchantMid || ctx.merchantEmail || ctx.merchantName || 'unknown';
    const accountId = mockAccountId(key);
    logger.info({ serial: ctx.serialNumber, linksValue, accountId }, 'Fortis (mock) matched account + activated device');
    return { serialNumber: ctx.serialNumber, linksValue, accountId, terminalId: `FT-${this.seq++}`, activated: true, status: 'created' };
  }
}

class LiveFortisAdapter implements FortisAdapter {
  readonly mode = 'live' as const;

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.FORTIS_DEVELOPER_ID) h['developer-id'] = config.FORTIS_DEVELOPER_ID;
    if (config.FORTIS_USER_ID) h['user-id'] = config.FORTIS_USER_ID;
    if (config.FORTIS_USER_API_KEY) h['user-api-key'] = config.FORTIS_USER_API_KEY;
    return h;
  }

  /** Locate the merchant's Fortis Gateway account/location by MID, then email. */
  private async findAccount(ctx: FortisContext): Promise<string | null> {
    const base = config.FORTIS_BASE_URL!;
    const tries: Array<Record<string, string>> = [];
    if (ctx.merchantMid) tries.push({ 'filter[mid]': ctx.merchantMid });
    if (ctx.merchantEmail) tries.push({ 'filter[email]': ctx.merchantEmail });
    for (const params of tries) {
      try {
        const res = await axios.get(`${base}/v1/locations`, { headers: this.headers(), params, timeout: 20_000 });
        const loc = res.data?.list?.[0] ?? res.data?.data?.[0];
        if (loc?.id) return String(loc.id);
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'Fortis account lookup failed');
      }
    }
    return config.FORTIS_LOCATION_ID ?? null; // fall back to a configured default location
  }

  async activateDevice(ctx: FortisContext): Promise<FortisSyncResult> {
    const linksValue = fortisLinksValue(ctx.serialNumber);
    try {
      const accountId = await this.findAccount(ctx);
      if (!accountId) return { serialNumber: ctx.serialNumber, linksValue, activated: false, status: 'failed', error: 'No matching Fortis Gateway account' };
      const res = await axios.post(
        `${config.FORTIS_BASE_URL}/v1/terminals`,
        {
          location_id: accountId,
          terminal_application_id: config.FORTIS_TERMINAL_APPLICATION_ID,
          terminal_manufacturer_id: config.FORTIS_TERMINAL_MANUFACTURER_ID,
          title: `Terminal ${linksValue}`,
          [config.FORTIS_LINK_FIELD]: linksValue, // last-8 -> activates the device
        },
        { headers: this.headers(), timeout: 20_000 },
      );
      const terminalId = res.data?.data?.id ?? res.data?.id;
      return { serialNumber: ctx.serialNumber, linksValue, accountId, terminalId, activated: true, status: 'created' };
    } catch (err) {
      logger.error({ err: (err as Error).message, serial: ctx.serialNumber }, 'Fortis device activation failed');
      return { serialNumber: ctx.serialNumber, linksValue, activated: false, status: 'failed', error: (err as Error).message };
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
