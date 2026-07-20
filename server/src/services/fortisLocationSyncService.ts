import { prisma } from '../db.js';
import { fortis, type FortisLocation } from '../adapters/fortis/index.js';
import { logger } from '../logger.js';

const SYNCED_AT_KEY = 'fortis_locations_synced_at';

/** Local cache of Fortis Gateway locations (8,500+ in the sandbox), synced periodically so admin
 *  search is a fast local query instead of a live call on every keystroke. */
const BATCH_SIZE = 500;

export const fortisLocationSyncService = {
  async syncAll(): Promise<{ count: number }> {
    const locations = await fortis().listAllLocations();
    // This is a full replace, not an incremental upsert — Fortis has 8,500+ locations, and doing
    // one upsert per row (round-trip each) is what previously timed out SQLite. Delete-all +
    // batched createMany is a handful of statements total instead of thousands.
    await prisma.fortisLocationCache.deleteMany({});
    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
      const batch = locations.slice(i, i + BATCH_SIZE).map((loc) => ({
        id: loc.id,
        name: loc.name,
        accountNumber: loc.accountNumber,
        locationType: loc.locationType ?? null,
      }));
      await prisma.fortisLocationCache.createMany({ data: batch });
    }
    await prisma.setting.upsert({
      where: { key: SYNCED_AT_KEY },
      create: { key: SYNCED_AT_KEY, valueJson: JSON.stringify(new Date().toISOString()) },
      update: { valueJson: JSON.stringify(new Date().toISOString()) },
    });
    logger.info({ count: locations.length }, 'Fortis location cache synced');
    return { count: locations.length };
  },

  async search(query: string, limit = 25): Promise<FortisLocation[]> {
    const q = query.trim();
    if (!q) return [];
    const rows = await prisma.fortisLocationCache.findMany({
      where: { OR: [{ name: { contains: q } }, { accountNumber: { contains: q } }] },
      take: limit,
    });
    return rows.map((r) => ({ id: r.id, name: r.name, accountNumber: r.accountNumber, locationType: r.locationType ?? undefined }));
  },

  async status(): Promise<{ count: number; syncedAt: string | null }> {
    const [count, row] = await Promise.all([
      prisma.fortisLocationCache.count(),
      prisma.setting.findUnique({ where: { key: SYNCED_AT_KEY } }),
    ]);
    let syncedAt: string | null = null;
    if (row) {
      try { syncedAt = JSON.parse(row.valueJson); } catch { syncedAt = null; }
    }
    return { count, syncedAt };
  },
};
