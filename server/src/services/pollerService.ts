import { OrderStatus } from '@de/shared';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { orderService } from './orderService.js';

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
  if (!config.POLL_ENABLED) { logger.info('order poller disabled (POLL_ENABLED=false)'); return; }
  if (config.POSP_MODE !== 'live') { logger.info('order poller idle (mock mode — nothing to poll)'); return; }
  const seconds = Math.max(30, config.POLL_INTERVAL_SECONDS);
  timer = setInterval(() => { void tick(); }, seconds * 1000);
  logger.info({ intervalSeconds: seconds }, 'order poller started');
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export const pollerService = { start, stop, tick };
