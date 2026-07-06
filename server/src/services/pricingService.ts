import { DEVICE_PRICE_CATALOG, type DevicePriceRow } from '@de/shared';
import { prisma } from '../db.js';
import { notFound } from '../util/errors.js';

/**
 * Device-level pricing (the wiki UPL). Price is keyed by DEVICE, not by bundle — so every bundle
 * that contains a given device (e.g. any "Link 2500" bundle) inherits that one device price.
 * The static DEVICE_PRICE_CATALOG seeds the editable table on first use; edits flow to all
 * matching bundles via `applyToBundles`.
 */
// Devices removed from the catalog (e.g. Fiserv/FD — not sold through POS Portal) are purged.
const RETIRED_KEYWORDS = ['fd 150', 'fd150', 'rp 10', 'rp10'];

async function ensureSeeded(): Promise<void> {
  await prisma.devicePrice.deleteMany({ where: { keyword: { in: RETIRED_KEYWORDS } } });
  const count = await prisma.devicePrice.count();
  if (count > 0) return;
  for (const d of DEVICE_PRICE_CATALOG) {
    await prisma.devicePrice.upsert({
      where: { keyword: d.kw },
      create: { keyword: d.kw, model: d.model, price: d.price },
      update: {},
    });
  }
}

/** Match a name to a device, most-specific (longest keyword) first. */
function resolve(name: string, devices: { keyword: string; model: string; price: number }[]): { model: string; price: number } | null {
  const n = (name || '').toLowerCase();
  const ordered = [...devices].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const d of ordered) if (n.includes(d.keyword)) return { model: d.model, price: d.price };
  return null;
}

export const pricingService = {
  /** Sync every bundle's stored sell price + matched model from the current UPL. Returns count updated. */
  async applyToBundles(): Promise<number> {
    await ensureSeeded();
    const devices = await prisma.devicePrice.findMany();
    const bundles = await prisma.bundle.findMany();
    let updated = 0;
    for (const b of bundles) {
      const match = resolve(b.displayName, devices);
      if (!match) continue;
      if (b.accountingUnitPrice !== match.price || b.accountingDeviceModel !== match.model) {
        await prisma.bundle.update({ where: { pospBundleId: b.pospBundleId }, data: { accountingUnitPrice: match.price, accountingDeviceModel: match.model } });
        updated += 1;
      }
    }
    return updated;
  },

  async list(): Promise<DevicePriceRow[]> {
    await ensureSeeded();
    const [devices, bundles] = await Promise.all([
      prisma.devicePrice.findMany({ orderBy: { model: 'asc' } }),
      prisma.bundle.findMany({ select: { displayName: true } }),
    ]);
    return devices.map((d) => {
      const kw = d.keyword.toLowerCase();
      const matches = bundles.filter((b) => b.displayName.toLowerCase().includes(kw));
      return {
        id: d.id,
        keyword: d.keyword,
        model: d.model,
        price: d.price,
        bundleCount: matches.length,
        examples: matches.slice(0, 3).map((b) => b.displayName),
        updatedAt: d.updatedAt.toISOString(),
      };
    });
  },

  /** Edit one device price, then re-apply the UPL so all matching bundles stay consistent. */
  async setPrice(id: number, price: number, updatedBy?: string): Promise<{ rows: DevicePriceRow[]; bundlesUpdated: number }> {
    const existing = await prisma.devicePrice.findUnique({ where: { id } });
    if (!existing) throw notFound('Device price not found');
    await prisma.devicePrice.update({ where: { id }, data: { price: Math.max(0, price), updatedBy } });
    const bundlesUpdated = await this.applyToBundles();
    return { rows: await this.list(), bundlesUpdated };
  },
};
