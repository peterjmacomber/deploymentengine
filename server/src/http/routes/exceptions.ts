import { Router } from 'express';
import { Permission, createExceptionSchema, decideExceptionSchema } from '@de/shared';
import { exceptionService } from '../../services/exceptionService.js';
import { returnService } from '../../services/returnService.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logger } from '../../logger.js';
import { actor, idParam, strQuery } from '../requtil.js';

export const exceptionsRouter = Router();

exceptionsRouter.get(
  '/',
  requirePermission(Permission.EXCEPTION_READ),
  asyncHandler(async (req, res) => {
    res.json({ exceptions: await exceptionService.list(strQuery(req, 'status'), strQuery(req, 'type')) });
  }),
);

exceptionsRouter.get(
  '/:id',
  requirePermission(Permission.EXCEPTION_READ),
  asyncHandler(async (req, res) => {
    res.json({ exception: await exceptionService.get(idParam(req)) });
  }),
);

exceptionsRouter.post(
  '/',
  requirePermission(Permission.EXCEPTION_REQUEST),
  validate(createExceptionSchema),
  asyncHandler(async (req, res) => {
    const exception = await exceptionService.create(req.body, actor(req));
    req.auditMeta = { targetType: 'exception', targetId: String(exception.id), action: 'exception.request' };
    res.status(201).json({ exception });
  }),
);

exceptionsRouter.post(
  '/:id/decide',
  requirePermission(Permission.EXCEPTION_APPROVE),
  validate(decideExceptionSchema),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { decision, decisionNote } = req.body as { decision: 'APPROVED' | 'DENIED'; decisionNote?: string };
    const exception = await exceptionService.decide(id, decision, actor(req), decisionNote);
    req.auditMeta = { targetType: 'exception', targetId: String(id), action: `exception.${decision.toLowerCase()}` };

    // If an approved exception unblocks a parked return case, resume it.
    if (decision === 'APPROVED' && exception.returnCaseId) {
      await returnService.resumeAfterApproval(exception.returnCaseId, actor(req)).catch((err) => {
        logger.error({ err, returnCaseId: exception.returnCaseId }, 'failed to resume return after approval');
      });
    }
    res.json({ exception });
  }),
);
