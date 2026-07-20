import { Router } from 'express';
import { Permission, upsertTerminalModelSchema } from '@de/shared';
import { terminalModelService } from '../../services/terminalModelService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Catalog of physical terminal/device models — the Fortis Gateway linkage shared by every
 *  Bundle that includes a given device. Same write permission as bundle Fortis config today. */
export const terminalModelsRouter = Router();

terminalModelsRouter.get(
  '/',
  requirePermission(Permission.BUNDLE_READ),
  asyncHandler(async (_req, res) => {
    res.json({ terminalModels: await terminalModelService.list() });
  }),
);

terminalModelsRouter.put(
  '/',
  requirePermission(Permission.BUNDLE_WRITE),
  validate(upsertTerminalModelSchema),
  asyncHandler(async (req, res) => {
    const tm = await terminalModelService.upsert(req.body);
    req.auditMeta = { targetType: 'terminalModel', targetId: tm.name, action: 'terminalModel.upsert' };
    res.json({ terminalModel: tm });
  }),
);
