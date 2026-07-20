import { Router } from 'express';
import { Permission } from '@de/shared';
import { inventoryService } from '../../services/inventoryService.js';
import { forecastService } from '../../services/forecastService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { actor } from '../requtil.js';
import { badRequest } from '../../util/errors.js';

export const inventoryRouter = Router();

inventoryRouter.get(
  '/consigned',
  requirePermission(Permission.INVENTORY_READ),
  asyncHandler(async (_req, res) => {
    res.json(await inventoryService.getCachedSnapshot());
  }),
);

// On-demand pull (the background poller also refreshes this on INVENTORY_POLL_INTERVAL_SECONDS).
inventoryRouter.post(
  '/consigned/refresh',
  requirePermission(Permission.INVENTORY_READ),
  asyncHandler(async (req, res) => {
    const snapshot = await inventoryService.refreshSnapshot();
    req.auditMeta = { action: 'inventory.refresh' };
    res.json(snapshot);
  }),
);

inventoryRouter.get(
  '/forecast',
  requirePermission(Permission.FORECAST_READ),
  asyncHandler(async (_req, res) => {
    res.json(await forecastService.build());
  }),
);

// Edit a forward monthly estimate. Planning action — manager/admin only.
inventoryRouter.post(
  '/forecast/estimate',
  requirePermission(Permission.EXCEPTION_APPROVE),
  asyncHandler(async (req, res) => {
    const { newPartId, month, qty } = req.body as { newPartId?: string; month?: string; qty?: number };
    if (!newPartId || !month || typeof qty !== 'number') throw badRequest('newPartId, month, and qty are required');
    await forecastService.setEstimate(newPartId, month, qty, actor(req));
    req.auditMeta = { targetType: 'forecast', targetId: newPartId, action: 'forecast.estimate' };
    res.json({ ok: true });
  }),
);
