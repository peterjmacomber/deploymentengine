import { Router } from 'express';
import { Permission, addressSchema, shippingQuoteSchema } from '@de/shared';
import { shippingService } from '../../services/shippingService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const shippingRouter = Router();

shippingRouter.post(
  '/validate-address',
  requirePermission(Permission.SHIPPING_READ),
  validate(addressSchema),
  asyncHandler(async (req, res) => {
    res.json(await shippingService.validateAddress(req.body));
  }),
);

shippingRouter.post(
  '/quote',
  requirePermission(Permission.SHIPPING_READ),
  validate(shippingQuoteSchema),
  asyncHandler(async (req, res) => {
    res.json({ methods: await shippingService.quote(req.body) });
  }),
);
