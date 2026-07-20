import { InventoryCondition, type InventoryItem } from '@de/shared';
import { posPortal } from '../adapters/posportal/index.js';
import type { RawConsignedItem } from '../adapters/posportal/PosPortalAdapter.js';
import { prisma } from '../db.js';
import { fromJson, toJson } from '../util/json.js';

const SNAPSHOT_KEY = 'inventory_snapshot';

interface InventorySnapshot {
  items: InventoryItem[];
  totals: Record<string, number>;
  fetchedAt: string | null;
}

const EMPTY_SNAPSHOT: InventorySnapshot = { items: [], totals: {}, fetchedAt: null };

const ACTIVE_MODEL_PREFIXES = ['A920PRO', 'A80', 'A35', 'A920', 'PRG', 'QD4', 'QD2', 'IDMR'];

function clean(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function inferManufacturer(name: string, model: string): string {
  const d = name.toUpperCase();
  const m = model.toUpperCase();
  if (d.startsWith('ING') || d.includes('INGENICO') || m.startsWith('PR') || m.startsWith('PM')) return 'Ingenico';
  if (d.startsWith('DJV') || d.includes('DEJAVOO') || m.startsWith('QD')) return 'Dejavoo';
  if (d.startsWith('IDT') || d.includes('ID TECH') || m.startsWith('IDMR')) return 'ID Tech';
  if (d.startsWith('PAX') || m.startsWith('A') || m.startsWith('Q')) return 'PAX';
  return 'Other';
}
function inferCondition(name: string): InventoryCondition {
  const d = name.toLowerCase();
  if (d.includes('refurb')) return InventoryCondition.REFURB;
  if (/\bnew\b/.test(d)) return InventoryCondition.NEW;
  return InventoryCondition.OTHER;
}
const NON_EQUIPMENT_KEYWORDS = [
  'sim card',
  'print on demand',
  'sticker',
  'paper',
  'material',
  'supplies',
  'insert',
  'label',
  'pod',
];

function isNonSerialized(subcat: string, model: string, name: string): boolean {
  const s = subcat.toLowerCase();
  if (s.includes('non-serialized') || s.includes('non serialized')) return true;
  const d = name.toLowerCase();
  if (NON_EQUIPMENT_KEYWORDS.some((k) => d.includes(k))) return true;
  // Missing manufacturer part number: treat as a consumable/non-equipment line.
  if (!model) return true;
  return false;
}
function isActiveCatalog(model: string): boolean {
  const m = model.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ACTIVE_MODEL_PREFIXES.some((p) => m.startsWith(p));
}

/** Aggregate raw consigned payload into canonical InventoryItem rows (ported from the
 *  forecasting prototype's category-bucket logic). */
export function aggregateConsigned(raw: RawConsignedItem[]): InventoryItem[] {
  return raw
    .map((item) => {
      const product = item.product ?? ({} as RawConsignedItem['product']);
      const name = clean(product.name);
      const model = clean(product.modelNumber);
      const buckets = { FGI: 0, IN_REPAIR: 0, CORE: 0, SCRAP: 0 } as Record<string, number>;
      for (const loc of item.locations ?? []) {
        const cat = clean(loc.category).toUpperCase();
        if (cat in buckets) buckets[cat] += num(loc.onHand);
      }
      const locationTotal = Object.values(buckets).reduce((a, b) => a + b, 0);
      const totalQty = item.totalOnHand !== undefined ? num(item.totalOnHand) : locationTotal;
      return {
        productId: clean(product.id),
        modelNumber: model,
        partDesc: name,
        manufacturer: inferManufacturer(name, model),
        condition: inferCondition(name),
        isActiveCatalogItem: isActiveCatalog(model),
        isNonSerialized: isNonSerialized(clean(product.subcategory || product.category), model, name),
        fgiQty: buckets.FGI,
        inRepairQty: buckets.IN_REPAIR,
        coreQty: buckets.CORE,
        scrapQty: buckets.SCRAP,
        totalQty,
      };
    })
    .filter((r) => r.productId || r.partDesc)
    .sort((a, b) => b.totalQty - a.totalQty || a.partDesc.localeCompare(b.partDesc));
}

export const inventoryService = {
  /** Local-first read: the Inventory & Forecast page reads this cache, not a live POS Portal
   *  call — refreshed on a timer (pollerService) and on demand ("Refresh now"). */
  async getCachedSnapshot(): Promise<InventorySnapshot> {
    const row = await prisma.setting.findUnique({ where: { key: SNAPSHOT_KEY } });
    if (!row) return EMPTY_SNAPSHOT;
    return fromJson<InventorySnapshot>(row.valueJson, EMPTY_SNAPSHOT);
  },

  /** Live pull + aggregate + persist. Called by the poller on an interval and by the admin
   *  "Refresh now" action / the full sandbox reset. */
  async refreshSnapshot(): Promise<InventorySnapshot> {
    const raw = await posPortal().getConsignedInventory();
    const items = aggregateConsigned(raw);
    const serialized = items.filter((i) => !i.isNonSerialized);
    const totals = {
      products: items.length,
      totalQty: items.reduce((s, i) => s + i.totalQty, 0),
      fgi: items.reduce((s, i) => s + i.fgiQty, 0),
      inRepair: items.reduce((s, i) => s + i.inRepairQty, 0),
      core: items.reduce((s, i) => s + i.coreQty, 0),
      scrap: items.reduce((s, i) => s + i.scrapQty, 0),
      activeCatalogQty: serialized.filter((i) => i.isActiveCatalogItem).reduce((s, i) => s + i.totalQty, 0),
    };
    const snapshot: InventorySnapshot = { items, totals, fetchedAt: new Date().toISOString() };
    await prisma.setting.upsert({
      where: { key: SNAPSHOT_KEY },
      create: { key: SNAPSHOT_KEY, valueJson: toJson(snapshot) },
      update: { valueJson: toJson(snapshot) },
    });
    return snapshot;
  },
};
