import { Router } from 'express';
import { Permission, createUserSchema, updateUserSchema } from '@de/shared';
import { userService } from '../../services/userService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idParam } from '../requtil.js';

export const usersRouter = Router();

usersRouter.get(
  '/',
  requirePermission(Permission.USER_READ),
  asyncHandler(async (_req, res) => {
    res.json({ users: await userService.list() });
  }),
);

usersRouter.post(
  '/',
  requirePermission(Permission.USER_WRITE),
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const user = await userService.create(req.body, req.principal!.role);
    req.auditMeta = { targetType: 'user', targetId: String(user.id), action: 'user.create' };
    res.status(201).json({ user });
  }),
);

usersRouter.patch(
  '/:id',
  requirePermission(Permission.USER_WRITE),
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const user = await userService.update(id, req.body, req.principal!.role);
    req.auditMeta = { targetType: 'user', targetId: String(id), action: 'user.update' };
    res.json({ user });
  }),
);
