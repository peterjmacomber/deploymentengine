import { Router } from 'express';
import { Permission } from '@de/shared';
import { reportedIssueService } from '../../services/reportedIssueService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Management view: the log of merchant self-service issue reports. Manager/admin (EXCEPTION_APPROVE). */
export const reportedIssuesRouter = Router();

reportedIssuesRouter.get(
  '/',
  requirePermission(Permission.EXCEPTION_APPROVE),
  asyncHandler(async (_req, res) => {
    res.json({ issues: await reportedIssueService.list() });
  }),
);
