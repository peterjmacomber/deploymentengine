import { Router } from 'express';
import {
  OrderMethod,
  Permission,
  addressSchema,
  applyCreateAccountSchema,
  applyCreateOrderSchema,
  embedCreateOrderSchema,
  shippingQuoteSchema,
} from '@de/shared';
import { bundleService } from '../../services/bundleService.js';
import { shippingService } from '../../services/shippingService.js';
import { orderService } from '../../services/orderService.js';
import { merchantService } from '../../services/merchantService.js';
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

/** Validate a partner returnUrl host and build the redirect URL back to it with order status
 *  params. Shared by /orders and /apply/order. */
function buildRedirectUrl(returnUrl: string | undefined, order: { id: number; reference?: string; status: string }): string | undefined {
  if (!returnUrl) return undefined;
  const host = safeHost(returnUrl);
  if (!host || !config.publicAllowedReturnHosts.includes(host)) {
    throw badRequest(`returnUrl host not allowed: ${host ?? 'invalid URL'}`);
  }
  const u = new URL(returnUrl);
  u.searchParams.set('orderId', String(order.id));
  if (order.reference) u.searchParams.set('reference', order.reference);
  u.searchParams.set('status', order.status);
  return u.toString();
}

publicRouter.post(
  '/orders',
  requirePermission(Permission.ORDER_WRITE),
  validate(embedCreateOrderSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('@de/shared').EmbedCreateOrderInput;

    // Validate the returnUrl host up front (before placing the order) so a bad returnUrl fails
    // fast, same as before.
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

    req.auditMeta = { targetType: 'order', targetId: String(order.id), action: 'embed.order.create' };
    res.status(201).json({
      order: { id: order.id, reference: order.reference, status: order.status },
      redirectUrl: buildRedirectUrl(body.returnUrl, order),
    });
  }),
);

/** Apply flow step 1: really creates the POS Portal merchant and links it to a Fortis account
 *  (see merchantService.createForApply). Separate from the generic embed contract above. */
publicRouter.post(
  '/apply',
  requirePermission(Permission.MERCHANT_WRITE),
  validate(applyCreateAccountSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('@de/shared').ApplyCreateAccountInput;
    const merchant = await merchantService.createForApply({
      mid: body.applicant.mid,
      dbaName: body.applicant.dbaName,
      legalName: body.applicant.legalName,
      email: body.applicant.email,
      phone: body.applicant.phone,
      shippingAddress: body.shippingAddress,
    });
    req.auditMeta = { targetType: 'merchant', targetId: String(merchant.id), action: 'apply.merchant.create' };
    res.status(201).json({ merchantId: merchant.id });
  }),
);

/** Apply flow step 2: places the real order, then immediately fakes the shipment (mock
 *  serial/tracking) and does a real Fortis terminal-creation call — the sandbox never actually
 *  ships, so this is the only way to demo the full pipeline end-to-end. */
publicRouter.post(
  '/apply/order',
  requirePermission(Permission.ORDER_WRITE),
  validate(applyCreateOrderSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('@de/shared').ApplyCreateOrderInput;

    if (body.returnUrl) {
      const host = safeHost(body.returnUrl);
      if (!host || !config.publicAllowedReturnHosts.includes(host)) {
        throw badRequest(`returnUrl host not allowed: ${host ?? 'invalid URL'}`);
      }
    }

    let order = await orderService.create(
      {
        merchantId: body.merchantId,
        mid: body.mid,
        cart: body.cart,
        shippingAddress: body.shippingAddress,
        shippingMethodId: body.shippingMethodId,
      },
      { createdBy: actor(req), method: OrderMethod.EMBED_PARTNER },
    );
    order = await orderService.simulateShip(order.id);

    req.auditMeta = { targetType: 'order', targetId: String(order.id), action: 'apply.order.create' };
    res.status(201).json({
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        packages: order.packages,
        serialNumbers: order.serialNumbers,
      },
      redirectUrl: buildRedirectUrl(body.returnUrl, order),
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
