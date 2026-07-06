import { Router } from 'express';
import { OrderMethod, Permission, createOrderSchema } from '@de/shared';
import { orderService } from '../../services/orderService.js';
import { auditService } from '../../services/auditService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { actor, idParam, numQuery, strQuery } from '../requtil.js';

export const ordersRouter = Router();

ordersRouter.get(
  '/',
  requirePermission(Permission.ORDER_READ),
  asyncHandler(async (req, res) => {
    const orders = await orderService.list({
      status: strQuery(req, 'status'),
      merchantId: numQuery(req, 'merchantId'),
      search: strQuery(req, 'search'),
    });
    res.json({ orders });
  }),
);

ordersRouter.post(
  '/',
  requirePermission(Permission.ORDER_WRITE),
  validate(createOrderSchema),
  asyncHandler(async (req, res) => {
    const order = await orderService.create(req.body, { createdBy: actor(req), method: OrderMethod.DEPLOYMENT_ENGINE });
    req.auditMeta = { targetType: 'order', targetId: String(order.id), action: 'order.create' };
    res.status(201).json({ order });
  }),
);

ordersRouter.get(
  '/:id',
  requirePermission(Permission.ORDER_READ),
  asyncHandler(async (req, res) => {
    const order = await orderService.get(idParam(req), { refresh: strQuery(req, 'refresh') === 'true' });
    res.json({ order });
  }),
);

ordersRouter.get(
  '/:id/activity',
  requirePermission(Permission.ORDER_READ),
  asyncHandler(async (req, res) => {
    const entries = await auditService.query({ targetType: 'order', targetId: String(idParam(req)), limit: 100 });
    res.json({ entries });
  }),
);

ordersRouter.post(
  '/:id/share-token',
  requirePermission(Permission.ORDER_READ),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const token = await orderService.ensureShareToken(id);
    req.auditMeta = { targetType: 'order', targetId: String(id), action: 'order.share-token' };
    res.json({ token });
  }),
);

ordersRouter.post(
  '/:id/cancel',
  requirePermission(Permission.ORDER_CANCEL),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const order = await orderService.cancel(id);
    req.auditMeta = { targetType: 'order', targetId: String(id), action: 'order.cancel' };
    res.json({ order });
  }),
);
