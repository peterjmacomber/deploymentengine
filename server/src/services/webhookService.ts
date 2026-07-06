import type { WebhookEventInput } from '@de/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { orderService } from './orderService.js';
import { returnService } from './returnService.js';

/**
 * Translate an inbound POS Portal webhook into a domain action. Events + payload keys follow
 * the confirmed webhook docs; unknown events are logged and acknowledged (we must return 200).
 */
export const webhookService = {
  async handle(evt: WebhookEventInput): Promise<{ handled: boolean; action?: string }> {
    const entity = (evt.entity || '').toLowerCase();
    const event = (evt.event || '').toLowerCase();
    const recordId = Number(evt.recordId);
    const raw = evt as Record<string, unknown>;

    try {
      if (entity === 'order') {
        const order = Number.isFinite(recordId) ? await prisma.order.findFirst({ where: { pospOrderId: recordId } }) : null;
        if (!order) return { handled: false, action: 'order-not-found' };

        if (event.includes('ship')) {
          const serials = (raw.serialNumbers as string[]) ?? [];
          await orderService.processShipment(order.id, {
            trackingNumber: String(raw.trackingNumber ?? `TRK-${recordId}`),
            carrier: String(raw.carrier ?? 'UPS'),
            serialNumbers: serials,
          });
          return { handled: true, action: 'shipment-applied' };
        }
        if (event.includes('deliver')) {
          await orderService.markDelivered(order.id, raw.signedBy as string | undefined);
          return { handled: true, action: 'delivered' };
        }
        if (event.includes('cancel')) {
          await orderService.cancel(order.id).catch(() => null);
          return { handled: true, action: 'cancelled' };
        }
      }

      if (entity === 'calltag') {
        const rc = Number.isFinite(recordId) ? await prisma.returnCase.findFirst({ where: { callTagId: recordId } }) : null;
        if (!rc) return { handled: false, action: 'calltag-not-found' };
        if (event.includes('received')) {
          const count = Number(raw.receivedItemCount ?? rc.expectedItemCount);
          await returnService.receiveItems(rc.id, count);
          return { handled: true, action: 'items-received' };
        }
        if (event.includes('delinquent')) {
          await prisma.returnCase.update({ where: { id: rc.id }, data: { delinquent: true } });
          return { handled: true, action: 'delinquent-flagged' };
        }
      }
    } catch (err) {
      logger.error({ err, entity, event }, 'webhook handling failed');
      return { handled: false, action: 'error' };
    }

    logger.info({ entity, event }, 'unhandled webhook event (acknowledged)');
    return { handled: false, action: 'ignored' };
  },
};
