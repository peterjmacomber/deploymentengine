import { type Bundle, type UpsertBundleInput, matchDevicePrice } from '@de/shared';
import { prisma } from '../db.js';
import { posPortal } from '../adapters/posportal/index.js';
import { toJson } from '../util/json.js';
import { notFound } from '../util/errors.js';
import { toBundle } from './mappers.js';

export const bundleService = {
  /** All bundle configs (admin view). */
  async listAll(): Promise<Bundle[]> {
    const rows = await prisma.bundle.findMany({ orderBy: { updatedAt: 'desc' } });
    return rows.map(toBundle);
  },

  /** Active bundles only (storefront / embed view). */
  async listActive(): Promise<Bundle[]> {
    const rows = await prisma.bundle.findMany({ where: { active: true }, orderBy: { displayName: 'asc' } });
    return rows.map(toBundle);
  },

  async get(pospBundleId: number): Promise<Bundle> {
    const row = await prisma.bundle.findUnique({ where: { pospBundleId } });
    if (!row) throw notFound('Bundle not found');
    return toBundle(row);
  },

  /** Create or update a bundle config overlay (admin). Refreshes the POS Portal snapshot. */
  async upsert(input: UpsertBundleInput): Promise<Bundle> {
    let items = input.items;
    let snapshot: unknown = null;
    // Pull the current POS Portal bundle to cache items/snapshot if the admin didn't supply them.
    const remote = await posPortal().getBundle(input.pospBundleId).catch(() => null);
    if (remote) {
      snapshot = remote;
      if (!items || items.length === 0) {
        items = remote.items.map((it) => ({ sku: it.sku, name: it.name, quantity: it.quantity, kind: 'other' as const }));
      }
    }
    const data = {
      displayName: input.displayName,
      description: input.description,
      active: input.active,
      itemsJson: toJson(items ?? []),
      application: input.application ?? null,
      encryption: input.encryption ?? null,
      processorPlatform: input.processorPlatform ?? null,
      distributor: input.distributor,
      accountingDeviceModel: input.accountingDeviceModel ?? null,
      accountingUnitPrice: input.accountingUnitPrice ?? null,
      brand: input.brand ?? null,
      pospSnapshotJson: snapshot ? toJson(snapshot) : undefined,
    };
    const row = await prisma.bundle.upsert({
      where: { pospBundleId: input.pospBundleId },
      create: { pospBundleId: input.pospBundleId, ...data, pospSnapshotJson: snapshot ? toJson(snapshot) : null },
      update: data,
    });
    return toBundle(row);
  },

  /** Inline price edit (admin pricing page). */
  async setPrice(pospBundleId: number, price: number | null): Promise<Bundle> {
    const existing = await prisma.bundle.findUnique({ where: { pospBundleId } });
    if (!existing) throw notFound('Bundle not found');
    const row = await prisma.bundle.update({ where: { pospBundleId }, data: { accountingUnitPrice: price } });
    return toBundle(row);
  },

  /** Auto-apply the wiki Equipment Pricing catalog to every bundle by matching the device in
   *  its name. Sets accountingUnitPrice + accountingDeviceModel where a device is recognized. */
  async applyCatalogPricing(): Promise<{ updated: number; unmatched: string[] }> {
    const rows = await prisma.bundle.findMany();
    let updated = 0;
    const unmatched: string[] = [];
    for (const b of rows) {
      const match = matchDevicePrice(b.displayName);
      if (!match) { unmatched.push(b.displayName); continue; }
      await prisma.bundle.update({
        where: { pospBundleId: b.pospBundleId },
        data: { accountingUnitPrice: match.price, accountingDeviceModel: match.model },
      });
      updated += 1;
    }
    return { updated, unmatched };
  },

  /** Mass show/hide bundles (checkbox multi-select on the admin page). */
  async bulkSetActive(pospBundleIds: number[], active: boolean): Promise<{ updated: number }> {
    const res = await prisma.bundle.updateMany({ where: { pospBundleId: { in: pospBundleIds } }, data: { active } });
    return { updated: res.count };
  },

  async setActive(pospBundleId: number, active: boolean): Promise<Bundle> {
    const existing = await prisma.bundle.findUnique({ where: { pospBundleId } });
    if (!existing) throw notFound('Bundle not found');
    const row = await prisma.bundle.update({ where: { pospBundleId }, data: { active } });
    return toBundle(row);
  },

  async remove(pospBundleId: number): Promise<void> {
    const existing = await prisma.bundle.findUnique({ where: { pospBundleId } });
    if (!existing) throw notFound('Bundle not found');
    await prisma.bundle.delete({ where: { pospBundleId } });
  },

  /** Import bundles from POS Portal (defaults to inactive), refreshing snapshots. */
  async importFromPosPortal(tagId?: number): Promise<{ imported: number }> {
    const headers = await posPortal().listBundles(tagId ? { tagId } : undefined);
    let imported = 0;
    for (const h of headers) {
      const detail = await posPortal().getBundle(h.id).catch(() => null);
      const items = (detail?.items ?? []).map((it) => ({ sku: it.sku, name: it.name, quantity: it.quantity, kind: 'other' as const }));
      await prisma.bundle.upsert({
        where: { pospBundleId: h.id },
        create: {
          pospBundleId: h.id,
          displayName: h.name,
          description: detail?.description,
          active: false,
          itemsJson: toJson(items),
          distributor: 'POS Portal',
          pospSnapshotJson: detail ? toJson(detail) : null,
        },
        update: { pospSnapshotJson: detail ? toJson(detail) : null, itemsJson: toJson(items) },
      });
      imported += 1;
    }
    return { imported };
  },
};
