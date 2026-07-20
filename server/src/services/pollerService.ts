import { OrderStatus } from '@de/shared';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { orderService } from './orderService.js';
import { posPortal } from '../adapters/posportal/index.js';
import { fortis } from '../adapters/fortis/index.js';
import { connectionStatusService } from './connectionStatusService.js';
import { inventoryService } from './inventoryService.js';
import { fortisLocationSyncService } from './fortisLocationSyncService.js';

/**
 * Background reconciliation poller. POS Portal has no webhooks available to us, so we poll
 * in-flight orders on an interval: `orderService.get(refresh)` re-pulls each order's live
 * status/packages, and when POS Portal reports it shipped (serials assigned at pick/config
 * time), it runs the shipment pipeline — capturing the serials and activating the device in
 * Fortis Gateway — with no employee copy/paste. Live mode only.
 */
const IN_FLIGHT: string[] = [
  OrderStatus.PLACED,
  OrderStatus.IN_PREP,
  OrderStatus.BACKORDERED,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.RESHIPPED,
];

let timer: NodeJS.Timeout | null = null;
let running = false;
let statusTimer: NodeJS.Timeout | null = null;
let inventoryTimer: NodeJS.Timeout | null = null;
let fortisLocationTimer: NodeJS.Timeout | null = null;

/** Reachability of both upstream sandboxes, independent of order backlog — feeds the admin
 *  System Status page. Runs on its own interval so it reports even with zero in-flight orders. */
async function statusTick(): Promise<void> {
  const [posp, ftx] = await Promise.all([
    posPortal().testConnection().catch((err) => ({ ok: false, detail: (err as Error).message })),
    fortis().testConnection().catch((err) => ({ ok: false, detail: (err as Error).message })),
  ]);
  await Promise.all([
    connectionStatusService.recordPospCheck(posp),
    connectionStatusService.recordFortisCheck(ftx),
  ]);
}

async function inventoryTick(): Promise<void> {
  try {
    await inventoryService.refreshSnapshot();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'inventory snapshot refresh failed');
  }
}

async function fortisLocationTick(): Promise<void> {
  try {
    await fortisLocationSyncService.syncAll();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Fortis location sync failed');
  }
}

async function tick(): Promise<{ scanned: number; updated: number; shipmentsCaptured: number }> {
  if (running) return { scanned: 0, updated: 0, shipmentsCaptured: 0 }; // avoid overlap
  running = true;
  let updated = 0;
  let shipmentsCaptured = 0;
  try {
    const rows = await prisma.order.findMany({
      where: { pospOrderId: { not: null }, status: { in: IN_FLIGHT } },
      select: { id: true, status: true, serialNumbersJson: true },
      take: 500,
    });
    for (const r of rows) {
      try {
        const hadSerials = r.serialNumbersJson && r.serialNumbersJson !== '[]';
        const o = await orderService.get(r.id, { refresh: true });
        if (o.status !== r.status) updated += 1;
        if (!hadSerials && o.serialNumbers.length > 0) {
          shipmentsCaptured += 1;
          logger.info({ orderId: r.id, serials: o.serialNumbers.length }, 'poller captured shipment + activated Fortis');
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, orderId: r.id }, 'poller order refresh failed');
      }
    }
    if (rows.length) logger.info({ scanned: rows.length, updated, shipmentsCaptured }, 'order poll tick');
    return { scanned: rows.length, updated, shipmentsCaptured };
  } finally {
    running = false;
  }
}

function start(): void {
  if (config.POLL_ENABLED && config.POSP_MODE === 'live') {
    const seconds = Math.max(30, config.POLL_INTERVAL_SECONDS);
    timer = setInterval(() => { void tick(); }, seconds * 1000);
    logger.info({ intervalSeconds: seconds }, 'order poller started');
  } else {
    logger.info('order poller idle (disabled or not in live mode)');
  }

  // Connectivity, inventory, and Fortis-location-cache checks run independent of order polling
  // (and of POSP_MODE) so status/local-first data stays current even with zero in-flight orders.
  const statusSeconds = Math.max(30, config.STATUS_POLL_INTERVAL_SECONDS);
  statusTimer = setInterval(() => { void statusTick(); }, statusSeconds * 1000);
  void statusTick();

  const inventorySeconds = Math.max(30, config.INVENTORY_POLL_INTERVAL_SECONDS);
  inventoryTimer = setInterval(() => { void inventoryTick(); }, inventorySeconds * 1000);
  void inventoryTick();

  const fortisLocationSeconds = Math.max(300, config.FORTIS_LOCATION_SYNC_INTERVAL_SECONDS);
  fortisLocationTimer = setInterval(() => { void fortisLocationTick(); }, fortisLocationSeconds * 1000);
  // Only auto-sync at boot if the cache is empty — this is a heavy paginated pull (8,500+ rows),
  // not something to redo unconditionally on every restart.
  prisma.fortisLocationCache.count().then((n) => { if (n === 0) void fortisLocationTick(); });

  logger.info({ statusSeconds, inventorySeconds, fortisLocationSeconds }, 'status/inventory/location pollers started');
}

function stop(): void {
  if (timer) clearInterval(timer);
  if (statusTimer) clearInterval(statusTimer);
  if (inventoryTimer) clearInterval(inventoryTimer);
  if (fortisLocationTimer) clearInterval(fortisLocationTimer);
  timer = null;
  statusTimer = null;
  inventoryTimer = null;
  fortisLocationTimer = null;
}

export const pollerService = { start, stop, tick };
