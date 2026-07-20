import { Router } from 'express';
import { Permission } from '@de/shared';
import { posPortal } from '../../adapters/posportal/index.js';
import { fortis } from '../../adapters/fortis/index.js';
import { connectionStatusService } from '../../services/connectionStatusService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Admin System Status: last-known reachability of POS Portal + Fortis Gateway, backed by the
 *  background poller (see pollerService) so a page load never blocks on a live call. */
export const systemRouter = Router();

systemRouter.use(requirePermission(Permission.DEV_TOOLS));

systemRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [posp, fortisStatus] = await Promise.all([
      connectionStatusService.getPospStatus(),
      connectionStatusService.getFortisStatus(),
    ]);
    res.json({ posPortal: posp, fortis: fortisStatus });
  }),
);

systemRouter.post(
  '/status/check',
  asyncHandler(async (req, res) => {
    const [pospResult, fortisResult] = await Promise.all([
      posPortal().testConnection().catch((err) => ({ ok: false, detail: (err as Error).message })),
      fortis().testConnection().catch((err) => ({ ok: false, detail: (err as Error).message })),
    ]);
    const [posp, fortisStatus] = await Promise.all([
      connectionStatusService.recordPospCheck(pospResult),
      connectionStatusService.recordFortisCheck(fortisResult),
    ]);
    req.auditMeta = { targetType: 'system', action: 'system.status.check' };
    res.json({ posPortal: posp, fortis: fortisStatus });
  }),
);
