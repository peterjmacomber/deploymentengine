import { Router } from 'express';
import { Permission } from '@de/shared';
import { auditService } from '../../services/auditService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { numQuery, strQuery } from '../requtil.js';

export const auditRouter = Router();

auditRouter.get(
  '/',
  requirePermission(Permission.AUDIT_READ),
  asyncHandler(async (req, res) => {
    res.json({
      entries: await auditService.query({
        limit: numQuery(req, 'limit'),
        actor: strQuery(req, 'actor'),
        action: strQuery(req, 'action'),
      }),
    });
  }),
);
