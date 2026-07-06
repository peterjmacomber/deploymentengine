import { createHash } from 'node:crypto';
import type { ApiKey } from '@de/shared';
import { prisma } from '../db.js';
import { apiKeyRaw } from '../util/ids.js';
import { notFound } from '../util/errors.js';

/** High-entropy keys don't need slow hashing — a fast sha256 is preimage-resistant and O(1) to verify. */
function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function toApiKey(row: {
  id: number; name: string; prefix: string; active: boolean; createdBy: string | null; createdAt: Date; lastUsedAt: Date | null;
}): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    active: row.active,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString(),
  };
}

export const apiKeyService = {
  async list(): Promise<ApiKey[]> {
    const rows = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toApiKey);
  },

  /** Create a key; returns the sanitized record plus the raw secret (shown to the admin once). */
  async create(name: string, createdBy?: string): Promise<{ apiKey: ApiKey; raw: string }> {
    const raw = apiKeyRaw();
    const prefix = `${raw.slice(0, 12)}…`;
    const row = await prisma.apiKey.create({ data: { name, prefix, keyHash: hashKey(raw), createdBy } });
    return { apiKey: toApiKey(row), raw };
  },

  async setActive(id: number, active: boolean): Promise<ApiKey> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw notFound('API key not found');
    const row = await prisma.apiKey.update({ where: { id }, data: { active } });
    return toApiKey(row);
  },

  async remove(id: number): Promise<void> {
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw notFound('API key not found');
    await prisma.apiKey.delete({ where: { id } });
  },

  /** Verify a presented raw key. Returns the active record (and touches lastUsedAt) or null. */
  async verify(raw: string): Promise<{ id: number; name: string } | null> {
    if (!raw) return null;
    const row = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
    if (!row || !row.active) return null;
    // Best-effort usage stamp; never block the request on it.
    void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return { id: row.id, name: row.name };
  },
};
