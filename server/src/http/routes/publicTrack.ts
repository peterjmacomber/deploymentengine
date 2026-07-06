import { Router } from 'express';
import { orderService } from '../../services/orderService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * Public, no-auth sanitized order tracking. The share token is the only credential. The payload
 * is deliberately free of merchant PII (no MID, DBA, address, phone, or email) — only fulfillment
 * status, tracking, and last-8 serials — so it is safe to hand to a merchant or partner.
 */
export const publicTrackRouter = Router();

publicTrackRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.json(await orderService.publicTrack(req.params.token));
  }),
);
