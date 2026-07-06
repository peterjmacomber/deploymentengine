import { Router } from 'express';
import { linkOrderSchema } from '@de/shared';
import { linkService } from '../../services/linkService.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * Public, token-gated deployment-link pages. No API key — the unguessable token (plus an
 * optional password) is the credential. Active/expiry/use-limit are enforced per request.
 */
export const publicLinksRouter = Router();

publicLinksRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const password = (req.headers['x-link-password'] as string | undefined) ?? (typeof req.query.password === 'string' ? req.query.password : undefined);
    res.json(await linkService.resolvePublic(req.params.token, password));
  }),
);

publicLinksRouter.post(
  '/:token/tax',
  asyncHandler(async (req, res) => {
    const body = req.body as { cart?: Array<{ pospBundleId: number; quantity: number }>; address?: Record<string, string> };
    res.json(await linkService.taxQuote(req.params.token, { cart: body.cart ?? [], address: body.address ?? {} }));
  }),
);

publicLinksRouter.get(
  '/:token/order/:orderId',
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.orderId);
    res.json({ order: await linkService.publicOrderStatus(req.params.token, orderId) });
  }),
);

publicLinksRouter.post(
  '/:token/order',
  validate(linkOrderSchema),
  asyncHandler(async (req, res) => {
    const result = await linkService.placeOrder(req.params.token, req.body);
    res.status(201).json({
      order: { id: result.order.id, reference: result.order.reference, status: result.order.status },
      redirectUrl: result.redirectUrl,
    });
  }),
);
