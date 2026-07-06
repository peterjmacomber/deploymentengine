import { Router } from 'express';
import { Permission } from '@de/shared';
import { settingsService } from '../../services/settingsService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const settingsRouter = Router();

settingsRouter.get(
  '/shipping',
  requirePermission(Permission.SHIPPING_READ),
  asyncHandler(async (_req, res) => {
    res.json(await settingsService.getShipping());
  }),
);

settingsRouter.put(
  '/shipping',
  requirePermission(Permission.BUNDLE_WRITE), // admin pricing surface
  asyncHandler(async (req, res) => {
    const cfg = await settingsService.setShipping(req.body);
    req.auditMeta = { action: 'settings.shipping.update' };
    res.json(cfg);
  }),
);

settingsRouter.get(
  '/policy',
  requirePermission(Permission.RETURN_READ),
  asyncHandler(async (_req, res) => {
    res.json(await settingsService.getPolicy());
  }),
);

settingsRouter.put(
  '/policy',
  requirePermission(Permission.EXCEPTION_APPROVE), // managers own return/warranty/courtesy policy
  asyncHandler(async (req, res) => {
    const cfg = await settingsService.setPolicy(req.body);
    req.auditMeta = { action: 'settings.policy.update' };
    res.json(cfg);
  }),
);
