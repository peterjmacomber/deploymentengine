import { customAlphabet } from 'nanoid';

const ref = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/** Human-readable order reference, e.g. DE-7F3K9QX2. */
export function orderReference(): string {
  return `DE-${ref()}`;
}

const linkAlpha = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 14);

/** URL-safe token for a deployment link. */
export function linkToken(): string {
  return linkAlpha();
}

/** Deterministic-ish readable serial for mock shipments. */
export function mockSerial(orderId: number, i: number, now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `SN-${y}${m}-${orderId}-${String(i + 1).padStart(2, '0')}`;
}

const keyAlpha = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 40);

/** Raw integration API key, e.g. dek_live_<40 chars>. Shown once; only its hash is stored. */
export function apiKeyRaw(): string {
  return `dek_${keyAlpha()}`;
}

/** Fortis LINKS value = last 8 alphanumerics of the serial, uppercased. */
export function fortisLinksValue(serial: string): string {
  const alnum = (serial || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return alnum.slice(-8);
}
