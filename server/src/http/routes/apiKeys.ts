import { Router } from 'express';
import { Permission } from '@de/shared';
import { apiKeyService } from '../../services/apiKeyService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../../util/errors.js';
import { actor, idParam } from '../requtil.js';

/** Admin-only management of integration API keys (create / list / revoke / delete). */
export const apiKeysRouter = Router();

apiKeysRouter.use(requirePermission(Permission.APIKEY_MANAGE));

apiKeysRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ apiKeys: await apiKeyService.list() });
  }),
);

apiKeysRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String((req.body as { name?: string }).name ?? '').trim();
    if (!name) throw badRequest('A key name is required');
    const { apiKey, raw } = await apiKeyService.create(name, actor(req));
    req.auditMeta = { targetType: 'apikey', targetId: String(apiKey.id), action: 'apikey.create' };
    res.status(201).json({ apiKey, raw });
  }),
);

apiKeysRouter.post(
  '/:id/active',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const active = Boolean((req.body as { active?: boolean }).active);
    const apiKey = await apiKeyService.setActive(id, active);
    req.auditMeta = { targetType: 'apikey', targetId: String(id), action: active ? 'apikey.enable' : 'apikey.revoke' };
    res.json({ apiKey });
  }),
);

apiKeysRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await apiKeyService.remove(id);
    req.auditMeta = { targetType: 'apikey', targetId: String(id), action: 'apikey.delete' };
    res.status(204).end();
  }),
);
