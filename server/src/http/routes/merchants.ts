import { Router } from 'express';
import { Permission, createMerchantSchema, createMerchantUserSchema } from '@de/shared';
import { merchantService } from '../../services/merchantService.js';
import { userService } from '../../services/userService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../../util/errors.js';
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

// --- Portal access: merchant self-service logins ---
merchantsRouter.get(
  '/:id/portal-users',
  requirePermission(Permission.USER_READ),
  asyncHandler(async (req, res) => {
    res.json({ users: await userService.listForMerchant(idParam(req)) });
  }),
);

merchantsRouter.post(
  '/:id/portal-users',
  requirePermission(Permission.USER_WRITE),
  validate(createMerchantUserSchema),
  asyncHandler(async (req, res) => {
    const merchantId = idParam(req);
    const user = await userService.createMerchantUser(merchantId, req.body, req.principal!.role);
    req.auditMeta = { targetType: 'merchant', targetId: String(merchantId), action: 'merchant.portal-user.create' };
    res.status(201).json({ user });
  }),
);

// --- Impersonation: view the portal as this merchant ---
merchantsRouter.post(
  '/:id/impersonate',
  requirePermission(Permission.MERCHANT_IMPERSONATE),
  asyncHandler(async (req, res) => {
    const merchantId = idParam(req);
    const p = req.principal!;
    if (typeof p.id !== 'number' || !p.email) throw badRequest('Only internal users can impersonate');
    const result = await userService.impersonateMerchant(merchantId, { id: p.id, email: p.email });
    req.auditMeta = { targetType: 'merchant', targetId: String(merchantId), action: 'merchant.impersonate' };
    res.json(result);
  }),
);
