import { prisma } from '../db.js';
import { fromJson, toJson } from '../util/json.js';

const POSP_KEY = 'posp_connection_status';
const FORTIS_KEY = 'fortis_connection_status';

export interface ConnectionStatus {
  ok: boolean;
  detail: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

const EMPTY: ConnectionStatus = { ok: false, detail: 'Not checked yet.', lastCheckedAt: null, lastSuccessAt: null };

async function get(key: string): Promise<ConnectionStatus> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return EMPTY;
  return fromJson<ConnectionStatus>(row.valueJson, EMPTY);
}

async function record(key: string, result: { ok: boolean; detail: string }): Promise<ConnectionStatus> {
  const now = new Date().toISOString();
  const prev = await get(key);
  const next: ConnectionStatus = {
    ok: result.ok,
    detail: result.detail,
    lastCheckedAt: now,
    lastSuccessAt: result.ok ? now : prev.lastSuccessAt,
  };
  await prisma.setting.upsert({ where: { key }, create: { key, valueJson: toJson(next) }, update: { valueJson: toJson(next) } });
  return next;
}

/** Persisted (Setting-backed) last-known reachability of the two upstream sandboxes, so the
 *  admin System Status page can show "last connected at X" without a live call on every load. */
export const connectionStatusService = {
  getPospStatus: () => get(POSP_KEY),
  recordPospCheck: (result: { ok: boolean; detail: string }) => record(POSP_KEY, result),
  getFortisStatus: () => get(FORTIS_KEY),
  recordFortisCheck: (result: { ok: boolean; detail: string }) => record(FORTIS_KEY, result),
};
