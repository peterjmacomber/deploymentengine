import { type Request, Router } from 'express';
import { Permission, submitIssueSchema } from '@de/shared';
import { portalService } from '../../services/portalService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../../util/errors.js';
import { actor, idParam } from '../requtil.js';

/**
 * Merchant self-service portal. Every route requires PORTAL_USE (held only by the MERCHANT role
 * and by impersonation tokens) AND is scoped to the principal's own merchantId — so a merchant
 * can never read another merchant's data, regardless of the id in the URL.
 */
export const portalRouter = Router();

portalRouter.use(requirePermission(Permission.PORTAL_USE));

/** The scoped merchant id from the token — the ONLY merchant this session may touch. */
function scopedMerchantId(req: Request): number {
  const id = req.principal?.merchantId;
  if (!id) throw badRequest('This login is not linked to a merchant');
  return id;
}

portalRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const merchantId = scopedMerchantId(req);
    const [merchant, summary] = await Promise.all([portalService.profile(merchantId), portalService.summary(merchantId)]);
    res.json({ merchant, summary, impersonatedBy: req.principal?.impersonatedBy ?? null });
  }),
);

portalRouter.get('/orders', asyncHandler(async (req, res) => {
  res.json({ orders: await portalService.orders(scopedMerchantId(req)) });
}));

portalRouter.get('/orders/:id', asyncHandler(async (req, res) => {
  res.json({ order: await portalService.order(scopedMerchantId(req), idParam(req)) });
}));

portalRouter.get('/returns', asyncHandler(async (req, res) => {
  res.json({ returns: await portalService.returns(scopedMerchantId(req)) });
}));

portalRouter.get('/returns/:id', asyncHandler(async (req, res) => {
  res.json({ return: await portalService.return(scopedMerchantId(req), idParam(req)) });
}));

portalRouter.get('/deployed', asyncHandler(async (req, res) => {
  res.json({ equipment: await portalService.deployed(scopedMerchantId(req)) });
}));

portalRouter.get('/issues/options', asyncHandler(async (req, res) => {
  res.json(await portalService.issueOptions(scopedMerchantId(req)));
}));

portalRouter.post(
  '/issues',
  validate(submitIssueSchema),
  asyncHandler(async (req, res) => {
    const merchantId = scopedMerchantId(req);
    const result = await portalService.submitIssue(merchantId, req.body, actor(req));
    req.auditMeta = { targetType: 'return', targetId: String(result.case.id), action: 'portal.issue.submit' };
    res.status(201).json(result);
  }),
);
