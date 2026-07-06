import { Router } from 'express';
import { Permission, upsertBundleSchema } from '@de/shared';
import { bundleService } from '../../services/bundleService.js';
import { pricingService } from '../../services/pricingService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { actor, idParam } from '../requtil.js';
import { badRequest } from '../../util/errors.js';

export const bundlesRouter = Router();

// ---- Device Unit Price List (UPL) — one price per device, shared by all bundles with it ----
bundlesRouter.get(
  '/device-prices',
  requirePermission(Permission.BUNDLE_READ),
  asyncHandler(async (_req, res) => {
    res.json({ devicePrices: await pricingService.list() });
  }),
);

bundlesRouter.post(
  '/device-prices/:id',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const price = Number((req.body as { price?: number }).price);
    if (!Number.isFinite(price) || price < 0) throw badRequest('A valid non-negative price is required');
    const result = await pricingService.setPrice(id, price, actor(req));
    req.auditMeta = { targetType: 'device-price', targetId: String(id), action: 'pricing.setDevicePrice' };
    res.json(result);
  }),
);

bundlesRouter.get(
  '/',
  requirePermission(Permission.BUNDLE_READ),
  asyncHandler(async (_req, res) => {
    res.json({ bundles: await bundleService.listAll() });
  }),
);

bundlesRouter.get(
  '/active',
  requirePermission(Permission.BUNDLE_READ),
  asyncHandler(async (_req, res) => {
    res.json({ bundles: await bundleService.listActive() });
  }),
);

bundlesRouter.post(
  '/',
  requirePermission(Permission.BUNDLE_WRITE),
  validate(upsertBundleSchema),
  asyncHandler(async (req, res) => {
    const bundle = await bundleService.upsert(req.body);
    req.auditMeta = { targetType: 'bundle', targetId: String(bundle.pospBundleId), action: 'bundle.upsert' };
    res.status(201).json({ bundle });
  }),
);

bundlesRouter.post(
  '/import',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const tagId = (req.body as { tagId?: number }).tagId;
    const result = await bundleService.importFromPosPortal(tagId);
    req.auditMeta = { targetType: 'bundle', action: 'bundle.import' };
    res.json(result);
  }),
);

bundlesRouter.post(
  '/bulk-active',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const { pospBundleIds, active } = req.body as { pospBundleIds?: number[]; active?: boolean };
    const result = await bundleService.bulkSetActive(Array.isArray(pospBundleIds) ? pospBundleIds : [], Boolean(active));
    req.auditMeta = { targetType: 'bundle', action: 'bundle.bulk-active' };
    res.json(result);
  }),
);

bundlesRouter.post(
  '/apply-pricing',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const updated = await pricingService.applyToBundles();
    req.auditMeta = { targetType: 'bundle', action: 'bundle.apply-pricing' };
    res.json({ updated, unmatched: [] });
  }),
);

bundlesRouter.post(
  '/:id/price',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const raw = (req.body as { price?: number | string | null }).price;
    const num = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    const bundle = await bundleService.setPrice(id, num !== null && Number.isFinite(num) ? num : null);
    req.auditMeta = { targetType: 'bundle', targetId: String(id), action: 'bundle.price' };
    res.json({ bundle });
  }),
);

bundlesRouter.post(
  '/:id/active',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const active = Boolean((req.body as { active?: boolean }).active);
    const bundle = await bundleService.setActive(id, active);
    req.auditMeta = { targetType: 'bundle', targetId: String(id), action: 'bundle.setActive' };
    res.json({ bundle });
  }),
);

bundlesRouter.delete(
  '/:id',
  requirePermission(Permission.BUNDLE_WRITE),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await bundleService.remove(id);
    req.auditMeta = { targetType: 'bundle', targetId: String(id), action: 'bundle.remove' };
    res.status(204).end();
  }),
);
