import {
  DeployedStatus,
  OrderClassification,
  OrderMethod,
  OrderStatus,
  ReturnLifecycle,
  ReturnReasonCode,
  ReturnType,
  canonicalOrderStatus,
} from '@de/shared';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { toJson } from '../util/json.js';
import { pricingService } from './pricingService.js';
import { fortisLocationSyncService } from './fortisLocationSyncService.js';
import { inventoryService } from './inventoryService.js';

/**
 * Backfills the local database with REAL data from the POS Portal sandbox so the Deployment
 * Engine shows genuine merchants, bundles, orders, serials, and deployed equipment instead of
 * seeded placeholders. Uses its own OAuth client (bulk/admin concern, kept out of the runtime
 * adapter interface). Idempotent: re-running upserts.
 */

const BASE = config.POSP_BASE_URL.replace(/\/+$/, '');
const MAX_SERIALS_PER_ORDER = 20;

let tokenCache: { value: string; expiresAt: number } | null = null;
async function getToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.value;
  if (!config.POSP_CLIENT_ID || !config.POSP_CLIENT_SECRET) {
    throw new Error('Import requires POSP credentials (POSP_CLIENT_ID / POSP_CLIENT_SECRET).');
  }
  const body = new URLSearchParams({
    client_id: config.POSP_CLIENT_ID,
    client_secret: config.POSP_CLIENT_SECRET,
    scope: config.POSP_SCOPE || `api://${config.POSP_CLIENT_ID}/.default`,
    grant_type: 'client_credentials',
  });
  const res = await fetch(config.POSP_TOKEN_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error('POS Portal token request failed');
  tokenCache = { value: j.access_token, expiresAt: now + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function apiGet<T = any>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
const resultOf = <T = any>(payload: any): T[] => (Array.isArray(payload?.result) ? payload.result : []);

interface PospAddress {
  line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string; merchantName?: string;
}

const merchantCache = new Map<number, number>(); // pospMerchantId -> local id

async function ensureMerchant(pospId: number, mid?: string, dbaFallback?: string): Promise<number> {
  if (merchantCache.has(pospId)) return merchantCache.get(pospId)!;
  const existing = await prisma.merchant.findFirst({ where: { pospMerchantId: pospId } });
  if (existing) { merchantCache.set(pospId, existing.id); return existing.id; }

  let m: any = null;
  try { m = resultOf(await apiGet(`/merchants/${pospId}`))[0]; } catch { /* fall back to hints */ }
  const addr = m?.shippingAddress as PospAddress | undefined;
  const row = await prisma.merchant.create({
    data: {
      pospMerchantId: pospId,
      mid: mid ?? null,
      dbaName: m?.dbaName ?? dbaFallback ?? `Merchant ${pospId}`,
      legalName: null,
      email: m?.email || null,
      phone: m?.phone || null,
      primaryContact: m?.primaryContact || null,
      merchantType: m?.type || null,
      taxExempt: typeof m?.taxExempt === 'boolean' ? m.taxExempt : null,
      supplyClub: typeof m?.supplyClub === 'boolean' ? m.supplyClub : null,
      lastUpdatedAt: m?.lastUpdatedDate ? new Date(m.lastUpdatedDate) : null,
      shippingAddressJson: addr
        ? toJson({ line1: addr.line1, line2: addr.line2, city: addr.city, region: addr.region, postalCode: addr.postalCode, country: addr.country || 'US', merchantName: m?.dbaName })
        : null,
    },
  });
  merchantCache.set(pospId, row.id);
  return row.id;
}

function mapAddress(a?: PospAddress) {
  if (!a) return undefined;
  return { merchantName: a.merchantName, line1: a.line1 ?? '', line2: a.line2 || undefined, city: a.city ?? '', region: a.region ?? '', postalCode: a.postalCode ?? '', country: a.country || 'US' };
}

function itemKind(categoryName = ''): string {
  const c = categoryName.toLowerCase();
  if (c.includes('equipment')) return 'device';
  if (c.includes('accessor')) return 'accessory';
  if (c.includes('collateral')) return 'paper'; // POD inserts + QR stickers
  return 'other';
}
const configOption = (configs: any[], name: string): string | undefined =>
  (configs || []).find((c) => c?.name === name)?.options?.[0]?.name;

async function importBundles(): Promise<number> {
  const bundles = resultOf(await apiGet(`/bundles?limit=500`));
  let n = 0;
  for (const b of bundles) {
    // Pull item-level detail so we get the REAL configured application/encryption/OS build.
    let rawItems: any[] = [];
    try {
      rawItems = resultOf(await apiGet(`/bundles/${b.id}?select=items`))[0]?.items ?? [];
    } catch {
      rawItems = [];
    }
    const equip = rawItems.find((it) => Array.isArray(it?.configs) && it.configs.length);
    const items = rawItems.map((it) => ({
      sku: String(it?.product?.id ?? ''),
      name: it?.product?.name ?? 'Item',
      quantity: it?.quantity ?? 1,
      kind: itemKind(it?.product?.category?.name),
    }));
    const data = {
      displayName: b.name ?? `Bundle ${b.id}`,
      active: Boolean(b.enabled),
      itemsJson: toJson(items),
      pospApplication: equip ? configOption(equip.configs, 'Application') : undefined,
      pospEncryption: equip ? configOption(equip.configs, 'Encrypted for') : undefined,
      pospOsBuild: equip ? configOption(equip.configs, 'Operating System') : undefined,
      pospSnapshotJson: toJson({ tags: b.tags, modifiable: b.modifiable, createdBy: b.createdBy }),
    };
    await prisma.bundle.upsert({
      where: { pospBundleId: b.id },
      create: { pospBundleId: b.id, distributor: 'POS Portal', ...data },
      update: data,
    });
    n += 1;
  }
  return n;
}

async function importOrders(limit: number): Promise<{ orders: number; deployed: number; merchants: number }> {
  const data = await apiGet(`/orders?page=1&limit=${limit}`);
  const orders = resultOf(data);
  let orderCount = 0;
  let deployedCount = 0;

  for (const o of orders) {
    const localMerchantId = await ensureMerchant(o.merchantId, o.mid, o.shipping?.address?.merchantName);

    // Line items + serials. POS Portal bundle lines carry a generic name ("Bundle") and NO
    // serials at the top level — the real device (with its serial + model) sits in childItems.
    // So we recurse into childItems for serials and surface the device name on the line.
    let items: any[] = [];
    try { items = resultOf(await apiGet(`/orders/${o.id}/items`)); } catch { items = []; }
    const deviceChild = (it: any): any =>
      (it.childItems ?? []).find((c: any) => (c.serialNumbers?.length ?? 0) > 0 || (c.expectedSerialNumbers?.length ?? 0) > 0 || c.childType === 'DEVICE');
    const lines = items.map((it) => {
      const dev = deviceChild(it);
      const name = it.product?.name && it.product.name !== 'Bundle' ? it.product.name : dev?.product?.name ?? it.product?.name ?? 'Item';
      return {
        pospBundleId: it.product?.id ?? 0,
        name,
        quantity: it.quantity ?? 1,
        unitPrice: it.price != null ? Number(it.price) : undefined,
      };
    });
    const allSerials: Array<{ serial: string; item: any }> = [];
    const collectSerials = (node: any) => {
      for (const s of node.serialNumbers ?? []) if (s) allSerials.push({ serial: s, item: node });
      for (const c of node.childItems ?? []) collectSerials(c);
    };
    for (const it of items) collectSerials(it);

    const status = canonicalOrderStatus(o.status);
    const shipped = ([OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.RESHIPPED] as OrderStatus[]).includes(status);
    const packages = shipped && o.shipping?.carrier
      ? [{ carrier: o.shipping.carrier, status: status === OrderStatus.DELIVERED ? 'DELIVERED' : 'IN_TRANSIT', shippedAt: o.shipDate ?? undefined }]
      : [];

    const existing = await prisma.order.findFirst({ where: { pospOrderId: o.id } });
    const orderData = {
      pospOrderId: o.id,
      reference: o.reference || `POSP-${o.id}`,
      status,
      method: o.method === 'PORTAL_ACCESS' ? OrderMethod.PORTAL_ACCESS : OrderMethod.DEPLOYMENT_ENGINE,
      classification: o.classification || OrderClassification.EQUIPMENT_PURCHASE,
      cancellable: Boolean(o.cancellable),
      merchantId: localMerchantId,
      merchantMid: o.mid ?? null,
      merchantDba: o.shipping?.address?.merchantName ?? null,
      shippingAddressJson: toJson(mapAddress(o.shipping?.address)),
      linesJson: toJson(lines),
      shippingMethodLabel: o.shipping?.serviceLevelDescription ?? o.shipping?.serviceLevel ?? null,
      shippingCarrier: o.shipping?.carrier ?? null,
      total: o.totals?.grandTotal != null ? Number(o.totals.grandTotal) : null,
      shipDate: o.shipDate ? new Date(o.shipDate) : null,
      packagesJson: toJson(packages),
      serialNumbersJson: toJson(allSerials.map((s) => s.serial)),
      originalOrderId: o.relatedOrders?.originalOrderId ?? null,
      createdBy: o.userOverrideText || o.user?.fullName || 'POS Portal',
      createdAt: o.orderDate ? new Date(o.orderDate) : undefined,
    };
    const saved = existing
      ? await prisma.order.update({ where: { id: existing.id }, data: orderData })
      : await prisma.order.create({ data: orderData });
    orderCount += 1;

    // Deployed equipment from real serials (capped per order).
    const depStatus = status === OrderStatus.CANCELLED ? DeployedStatus.DECOMMISSIONED : DeployedStatus.ACTIVE;
    for (const { serial, item } of allSerials.slice(0, MAX_SERIALS_PER_ORDER)) {
      const dup = await prisma.deployedEquipment.findFirst({ where: { serialNumber: serial } });
      if (dup) continue;
      await prisma.deployedEquipment.create({
        data: {
          serialNumber: serial,
          productName: item.product?.name ?? null,
          model: item.product?.modelNumber ?? null,
          merchantId: localMerchantId,
          mid: o.mid ?? null,
          orderId: saved.id,
          status: depStatus,
          deployedAt: o.shipDate ? new Date(o.shipDate) : null,
        },
      });
      deployedCount += 1;
    }
  }

  return { orders: orderCount, deployed: deployedCount, merchants: merchantCache.size };
}

/** Map a POS Portal return status (OPEN, CLOSED_BY_RETURN, CLOSED_BY_BILLING,
 *  CLOSED_BY_RETURN_AFTER_BILLING, CANCELLED, …) to our lifecycle. The raw status is also stored
 *  verbatim (pospStatus) and is what the UI displays for imported returns. */
function mapReturnLifecycle(status: string): string {
  const s = (status || '').toUpperCase();
  if (s === 'CANCELLED') return ReturnLifecycle.CANCELLED;
  if (s.startsWith('CLOSED')) return ReturnLifecycle.CLOSED;
  if (s.includes('RECEIV')) return ReturnLifecycle.ITEMS_RECEIVED;
  if (s.includes('SHIP')) return ReturnLifecycle.REPLACEMENT_SHIPPED;
  if (s === 'OPEN') return ReturnLifecycle.CALLTAG_ISSUED;
  return ReturnLifecycle.INITIATED;
}
function mapReturnType(type: string): string {
  const t = (type || '').toUpperCase();
  if (t.includes('REPLACE')) return ReturnType.REPLACEMENT;
  if (t.includes('REPAIR')) return ReturnType.REPAIR;
  return ReturnType.RETURN;
}
/** Best-effort map of a free-text POS reason to our reason taxonomy. */
function mapReasonCode(desc = ''): string {
  const d = desc.toLowerCase();
  if (d.includes('upgrad')) return ReturnReasonCode.PLATFORM_UPGRADE;
  if (d.includes('swap') || d.includes('wrong') || d.includes('lanes for')) return ReturnReasonCode.SALES_WRONG_DEVICE;
  if (d.includes('not operating') || d.includes('defect') || d.includes('no card') || d.includes('no print') || d.includes('damage')) return ReturnReasonCode.WARRANTY_DEFECT;
  if (d.includes('connect')) return ReturnReasonCode.CONNECTIVITY;
  return ReturnReasonCode.NEEDS_MANUAL_REVIEW;
}

/** Import POS Portal returns/swaps (RMAs) into ReturnCase so they appear alongside engine returns. */
async function importReturns(limit: number): Promise<number> {
  let returns: any[] = [];
  try { returns = resultOf(await apiGet(`/returns?page=1&limit=${limit}`)); } catch { return 0; }
  let n = 0;
  for (const r of returns) {
    const localMerchantId = await ensureMerchant(r.merchantId, r.mid, r.address?.merchantName);
    const mrow = await prisma.merchant.findUnique({ where: { id: localMerchantId }, select: { dbaName: true } });
    const items = (r.items ?? []).map((it: any) => ({
      deployedEquipmentId: it.deployedEquipmentId ?? undefined,
      returnType: mapReturnType(it.type),
      reasonCode: mapReasonCode(it.reason?.description),
      expectedProduct: it.product?.name ?? undefined,
      expectedSerialNumber: it.serialNumber ?? undefined,
    }));
    const notes = (r.items ?? [])
      .map((it: any) => [it.reason?.description, it.problem].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('; ') || undefined;
    const lifecycle = mapReturnLifecycle(r.status);
    const replacementOrderId = r.items?.[0]?.replacementOrderId ?? undefined;
    const data = {
      pospReturnId: r.id,
      origin: 'posportal',
      pospStatus: r.status ?? null,
      entityType: 'order',
      entityId: r.orderId ?? r.items?.[0]?.expectedOrderId ?? 0,
      merchantId: localMerchantId,
      mid: r.mid ?? null,
      merchantDba: mrow?.dbaName ?? null,
      lifecycle,
      itemsJson: toJson(items),
      expectedItemCount: items.length,
      receivedItemCount: lifecycle === ReturnLifecycle.CLOSED || lifecycle === ReturnLifecycle.ITEMS_RECEIVED ? items.length : 0,
      replacementOrderId,
      notes,
      createdBy: 'POS Portal',
      createdAt: r.createDate ? new Date(r.createDate) : undefined,
    };
    await prisma.returnCase.upsert({ where: { pospReturnId: r.id }, create: data, update: data });
    n += 1;
  }
  return n;
}

/** Wipe every locally-stored table except Users (and their roles) — a clean-slate reset before
 *  re-pulling from the sandbox. FK-safe delete order (FortisTerminal references Order). Does NOT
 *  touch FortisLocationCache — that's Fortis reference data, refreshed by its own sync job
 *  rather than wiped as "demo data". AuditLog is also kept (security record, not demo data). */
async function clearBusinessData(): Promise<void> {
  await prisma.fortisTerminal.deleteMany({});
  await prisma.fortisTerminalSync.deleteMany({});
  await prisma.reportedIssue.deleteMany({});
  await prisma.deploymentLink.deleteMany({});
  await prisma.deployedEquipment.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.returnCase.deleteMany({});
  await prisma.exceptionRequest.deleteMany({});
  await prisma.bundle.deleteMany({});
  await prisma.merchant.deleteMany({});
  await prisma.setting.deleteMany({});
  await prisma.apiKey.deleteMany({});
  await prisma.forecastEstimate.deleteMany({});
  merchantCache.clear();
}

export const importService = {
  async run(opts: { orders?: number; fresh?: boolean } = {}): Promise<{ bundles: number; orders: number; deployed: number; merchants: number; returns: number; priced: number }> {
    const orderLimit = Math.min(Math.max(opts.orders ?? 60, 1), 200);
    logger.info({ orderLimit, fresh: opts.fresh ?? false }, 'sandbox import starting');
    if (opts.fresh) await clearBusinessData();
    const bundles = await importBundles();
    const { orders, deployed, merchants } = await importOrders(orderLimit);
    const returns = await importReturns(orderLimit);
    // Price imported bundles from the device UPL (our source of truth).
    const priced = await pricingService.applyToBundles();
    // Keep the Fortis location cache and consigned-inventory snapshot coherent with the reset,
    // not just the transactional tables — best-effort, doesn't block the import result.
    await Promise.all([
      fortisLocationSyncService.syncAll().catch((err) => logger.warn({ err: (err as Error).message }, 'post-import Fortis location sync failed')),
      inventoryService.refreshSnapshot().catch((err) => logger.warn({ err: (err as Error).message }, 'post-import inventory refresh failed')),
    ]);
    logger.info({ bundles, orders, deployed, merchants, returns, priced }, 'sandbox import complete');
    return { bundles, orders, deployed, merchants, returns, priced };
  },
};
