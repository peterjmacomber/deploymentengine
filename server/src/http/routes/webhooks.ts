import { Router } from 'express';
import { webhookEventSchema } from '@de/shared';
import { webhookService } from '../../services/webhookService.js';
import { verifyWebhook } from '../middleware/webhookAuth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * POS Portal -> us webhook receiver. Auth scheme is env-configurable (apikey|hmac|bearer)
 * to match whatever the Account Manager provisions. Always returns 200 on receipt so POS
 * Portal does not retry-storm; the handled/action detail is informational.
 */
export const webhookRouter = Router();

webhookRouter.post(
  '/',
  verifyWebhook,
  validate(webhookEventSchema),
  asyncHandler(async (req, res) => {
    const result = await webhookService.handle(req.body);
    res.status(200).json({ received: true, ...result });
  }),
);
