import { Router } from 'express';
import { Permission } from '@de/shared';
import { orderService } from '../../services/orderService.js';
import { importService } from '../../services/importService.js';
import { pollerService } from '../../services/pollerService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idParam } from '../requtil.js';

/**
 * Developer/simulation tools (admin-only). In mock mode these drive the full fulfillment
 * path — shipment → serials → deployed equipment → Fortis sync → pizza-tracker — without
 * real POS Portal webhooks. In live mode, real events arrive via /webhooks instead.
 */
export const devRouter = Router();

devRouter.post(
  '/orders/:id/ship',
  requirePermission(Permission.DEV_TOOLS),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const serials = (req.body as { serialNumbers?: string[] }).serialNumbers;
    const order = await orderService.simulateShip(id, serials);
    req.auditMeta = { targetType: 'order', targetId: String(id), action: 'dev.ship' };
    res.json({ order });
  }),
);

devRouter.post(
  '/poll',
  requirePermission(Permission.DEV_TOOLS),
  asyncHandler(async (req, res) => {
    const result = await pollerService.tick();
    req.auditMeta = { action: 'dev.poll' };
    res.json(result);
  }),
);

devRouter.post(
  '/import-sandbox',
  requirePermission(Permission.DEV_TOOLS),
  asyncHandler(async (req, res) => {
    const body = req.body as { orders?: number; fresh?: boolean };
    const orders = Number(body.orders) || 60;
    const result = await importService.run({ orders, fresh: Boolean(body.fresh) });
    req.auditMeta = { action: body.fresh ? 'dev.import-sandbox.fresh' : 'dev.import-sandbox' };
    res.json(result);
  }),
);

devRouter.post(
  '/orders/:id/deliver',
  requirePermission(Permission.DEV_TOOLS),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const signedBy = (req.body as { signedBy?: string }).signedBy;
    const order = await orderService.markDelivered(id, signedBy);
    req.auditMeta = { targetType: 'order', targetId: String(id), action: 'dev.deliver' };
    res.json({ order });
  }),
);
