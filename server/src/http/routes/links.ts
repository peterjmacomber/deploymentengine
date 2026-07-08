import { Router } from 'express';
import { Permission, createLinkSchema, updateLinkSchema } from '@de/shared';
import { linkService } from '../../services/linkService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { actor, idParam } from '../requtil.js';

export const linksRouter = Router();

linksRouter.get(
  '/',
  requirePermission(Permission.LINK_READ),
  asyncHandler(async (_req, res) => {
    res.json({ links: await linkService.list() });
  }),
);

linksRouter.post(
  '/',
  requirePermission(Permission.LINK_WRITE),
  validate(createLinkSchema),
  asyncHandler(async (req, res) => {
    const link = await linkService.create(req.body, actor(req));
    req.auditMeta = { targetType: 'link', targetId: String(link.id), action: 'link.create' };
    res.status(201).json({ link });
  }),
);

linksRouter.get(
  '/:id',
  requirePermission(Permission.LINK_READ),
  asyncHandler(async (req, res) => {
    res.json({ link: await linkService.get(idParam(req)) });
  }),
);

linksRouter.patch(
  '/:id',
  requirePermission(Permission.LINK_WRITE),
  validate(updateLinkSchema),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const link = await linkService.update(id, req.body);
    req.auditMeta = { targetType: 'link', targetId: String(id), action: 'link.update' };
    res.json({ link });
  }),
);

linksRouter.delete(
  '/:id',
  requirePermission(Permission.LINK_DELETE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await linkService.remove(id);
    req.auditMeta = { targetType: 'link', targetId: String(id), action: 'link.remove' };
    res.status(204).end();
  }),
);
