import { Router } from 'express';
import { Permission } from '@de/shared';
import { deployedEquipmentService } from '../../services/deployedEquipmentService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idParam, numQuery, strQuery } from '../requtil.js';

export const deployedRouter = Router();

deployedRouter.get(
  '/',
  requirePermission(Permission.DEPLOYED_READ),
  asyncHandler(async (req, res) => {
    res.json({
      equipment: await deployedEquipmentService.list({
        merchantId: numQuery(req, 'merchantId'),
        orderId: numQuery(req, 'orderId'),
        status: strQuery(req, 'status'),
        search: strQuery(req, 'search'),
      }),
    });
  }),
);

deployedRouter.get(
  '/:id',
  requirePermission(Permission.DEPLOYED_READ),
  asyncHandler(async (req, res) => {
    res.json({ equipment: await deployedEquipmentService.get(idParam(req)) });
  }),
);

deployedRouter.post(
  '/:id/status',
  requirePermission(Permission.DEPLOYED_WRITE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const status = String((req.body as { status?: string }).status ?? '');
    const equipment = await deployedEquipmentService.updateStatus(id, status);
    req.auditMeta = { targetType: 'deployed', targetId: String(id), action: 'deployed.status' };
    res.json({ equipment });
  }),
);
