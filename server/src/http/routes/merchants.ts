import { Router } from 'express';
import { Permission, createMerchantSchema } from '@de/shared';
import { merchantService } from '../../services/merchantService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idParam, strQuery } from '../requtil.js';

export const merchantsRouter = Router();

merchantsRouter.get(
  '/',
  requirePermission(Permission.MERCHANT_READ),
  asyncHandler(async (req, res) => {
    res.json({ merchants: await merchantService.list(strQuery(req, 'search')) });
  }),
);

merchantsRouter.get(
  '/:id',
  requirePermission(Permission.MERCHANT_READ),
  asyncHandler(async (req, res) => {
    res.json({ merchant: await merchantService.get(idParam(req)) });
  }),
);

merchantsRouter.post(
  '/',
  requirePermission(Permission.MERCHANT_WRITE),
  validate(createMerchantSchema),
  asyncHandler(async (req, res) => {
    const merchant = await merchantService.create(req.body);
    req.auditMeta = { targetType: 'merchant', targetId: String(merchant.id), action: 'merchant.create' };
    res.status(201).json({ merchant });
  }),
);
