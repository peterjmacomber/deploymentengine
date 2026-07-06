import { Router } from 'express';
import {
  OrderMethod,
  Permission,
  addressSchema,
  embedCreateOrderSchema,
  shippingQuoteSchema,
} from '@de/shared';
import { bundleService } from '../../services/bundleService.js';
import { shippingService } from '../../services/shippingService.js';
import { orderService } from '../../services/orderService.js';
import { authenticatePartner } from '../middleware/publicAuth.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../../config.js';
import { actor, idParam } from '../requtil.js';
import { badRequest } from '../../util/errors.js';

/**
 * External embed plane. Authenticated by API key (X-API-Key). Scoped to exactly the steps a
 * partner's online application flow needs: browse active bundles, validate address, quote,
 * place an order, and check status. Supports a `returnUrl` handoff back to the partner flow.
 */
export const publicRouter = Router();

publicRouter.use(authenticatePartner);

publicRouter.get(
  '/bundles',
  requirePermission(Permission.BUNDLE_READ),
  asyncHandler(async (_req, res) => {
    // Only expose customer-safe fields to external partners.
    const bundles = await bundleService.listActive();
    res.json({
      bundles: bundles.map((b) => ({
        pospBundleId: b.pospBundleId,
        displayName: b.displayName,
        description: b.description,
        items: b.items,
        application: b.application,
        price: b.accountingUnitPrice,
      })),
    });
  }),
);

publicRouter.post(
  '/validate-address',
  requirePermission(Permission.SHIPPING_READ),
  validate(addressSchema),
  asyncHandler(async (req, res) => {
    res.json(await shippingService.validateAddress(req.body));
  }),
);

publicRouter.post(
  '/quote',
  requirePermission(Permission.SHIPPING_READ),
  validate(shippingQuoteSchema),
  asyncHandler(async (req, res) => {
    res.json({ methods: await shippingService.quote(req.body) });
  }),
);

publicRouter.post(
  '/orders',
  requirePermission(Permission.ORDER_WRITE),
  validate(embedCreateOrderSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('@de/shared').EmbedCreateOrderInput;

    let redirectUrl: string | undefined;
    if (body.returnUrl) {
      const host = safeHost(body.returnUrl);
      if (!host || !config.publicAllowedReturnHosts.includes(host)) {
        throw badRequest(`returnUrl host not allowed: ${host ?? 'invalid URL'}`);
      }
    }

    const order = await orderService.create(
      {
        merchant: {
          mid: body.applicant.mid,
          dbaName: body.applicant.dbaName,
          legalName: body.applicant.legalName,
          email: body.applicant.email,
          phone: body.applicant.phone,
          shippingAddress: body.shippingAddress,
        },
        mid: body.applicant.mid ?? '',
        cart: body.cart,
        shippingAddress: body.shippingAddress,
        shippingMethodId: body.shippingMethodId,
      },
      { createdBy: actor(req), method: OrderMethod.EMBED_PARTNER },
    );

    if (body.returnUrl) {
      const u = new URL(body.returnUrl);
      u.searchParams.set('orderId', String(order.id));
      if (order.reference) u.searchParams.set('reference', order.reference);
      u.searchParams.set('status', order.status);
      redirectUrl = u.toString();
    }

    req.auditMeta = { targetType: 'order', targetId: String(order.id), action: 'embed.order.create' };
    res.status(201).json({
      order: { id: order.id, reference: order.reference, status: order.status },
      redirectUrl,
    });
  }),
);

publicRouter.get(
  '/orders/:id',
  requirePermission(Permission.ORDER_READ),
  asyncHandler(async (req, res) => {
    const order = await orderService.get(idParam(req), { refresh: true });
    res.json({
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        packages: order.packages,
        serialNumbers: order.serialNumbers,
      },
    });
  }),
);

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
