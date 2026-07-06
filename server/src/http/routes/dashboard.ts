import { Router } from 'express';
import { Permission } from '@de/shared';
import { dashboardService } from '../../services/dashboardService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  requirePermission(Permission.ORDER_READ),
  asyncHandler(async (_req, res) => {
    res.json(await dashboardService.summary());
  }),
);
