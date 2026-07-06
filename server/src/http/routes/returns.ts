import { Router } from 'express';
import { Permission, createReturnSchema } from '@de/shared';
import { returnService } from '../../services/returnService.js';
import { auditService } from '../../services/auditService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { actor, idParam, numQuery, strQuery } from '../requtil.js';

export const returnsRouter = Router();

returnsRouter.get(
  '/',
  requirePermission(Permission.RETURN_READ),
  asyncHandler(async (req, res) => {
    res.json({ returns: await returnService.list({ lifecycle: strQuery(req, 'lifecycle'), merchantId: numQuery(req, 'merchantId') }) });
  }),
);

returnsRouter.get(
  '/reasons/:type',
  requirePermission(Permission.RETURN_READ),
  asyncHandler(async (req, res) => {
    res.json({ reasons: await returnService.getReasons(req.params.type) });
  }),
);

returnsRouter.post(
  '/',
  requirePermission(Permission.RETURN_WRITE),
  validate(createReturnSchema),
  asyncHandler(async (req, res) => {
    const rc = await returnService.create(req.body, actor(req));
    req.auditMeta = { targetType: 'return', targetId: String(rc.id), action: 'return.create' };
    res.status(201).json({ return: rc });
  }),
);

returnsRouter.get(
  '/:id',
  requirePermission(Permission.RETURN_READ),
  asyncHandler(async (req, res) => {
    res.json({ return: await returnService.get(idParam(req)) });
  }),
);

returnsRouter.get(
  '/:id/activity',
  requirePermission(Permission.RETURN_READ),
  asyncHandler(async (req, res) => {
    const entries = await auditService.query({ targetType: 'return', targetId: String(idParam(req)), limit: 100 });
    res.json({ entries });
  }),
);

returnsRouter.post(
  '/:id/receive',
  requirePermission(Permission.RETURN_WRITE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const received = Number((req.body as { receivedItemCount?: number }).receivedItemCount ?? 0);
    const rc = await returnService.receiveItems(id, received);
    req.auditMeta = { targetType: 'return', targetId: String(id), action: 'return.receive' };
    res.json({ return: rc });
  }),
);
