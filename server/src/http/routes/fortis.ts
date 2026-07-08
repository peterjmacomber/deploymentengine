import { Router } from 'express';
import { Permission } from '@de/shared';
import { fortis } from '../../adapters/fortis/index.js';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { settingsService } from '../../services/settingsService.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest, notFound } from '../../util/errors.js';

/** Admin-only Fortis Gateway: connection test, account search + link, terminal creation. */
export const fortisRouter = Router();

fortisRouter.use(requirePermission(Permission.DEV_TOOLS));

fortisRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({
      configured: config.fortisConfigured,
      baseUrl: config.FORTIS_BASE_URL ?? null,
      merchantLoginUrl: config.FORTIS_MERCHANT_LOGIN_URL ?? null,
      linkField: config.FORTIS_LINK_FIELD,
      credentials: {
        developerId: !!config.FORTIS_DEVELOPER_ID,
        userId: !!config.FORTIS_USER_ID,
        userName: !!config.FORTIS_USER_NAME,
        userApiKey: !!config.FORTIS_USER_API_KEY,
        userHashKey: !!config.FORTIS_USER_HASH_KEY,
        ticketHashKey: !!config.FORTIS_TICKET_HASH_KEY,
        locationId: !!config.FORTIS_LOCATION_ID,
        terminalId: !!config.FORTIS_TERMINAL_ID,
      },
    });
  }),
);

fortisRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    req.auditMeta = { targetType: 'fortis', action: 'fortis.test-connection' };
    res.json(await fortis().testConnection());
  }),
);

fortisRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) throw badRequest('A search query is required');
    res.json({ locations: await fortis().searchLocations(q) });
  }),
);

// Link a Fortis account/location to a Deployment Engine merchant (MID-adjacent — the shared key).
fortisRouter.post(
  '/link',
  asyncHandler(async (req, res) => {
    const b = req.body as { merchantId?: number; fortisLocationId?: string; fortisLocationName?: string };
    if (!b.merchantId || !b.fortisLocationId) throw badRequest('merchantId and fortisLocationId are required');
    const existing = await prisma.merchant.findUnique({ where: { id: b.merchantId } });
    if (!existing) throw notFound('Merchant not found');
    const merchant = await prisma.merchant.update({
      where: { id: b.merchantId },
      data: { fortisLocationId: b.fortisLocationId, fortisLocationName: b.fortisLocationName ?? null },
    });
    req.auditMeta = { targetType: 'merchant', targetId: String(b.merchantId), action: 'fortis.link' };
    res.json({ merchantId: merchant.id, fortisLocationId: merchant.fortisLocationId, fortisLocationName: merchant.fortisLocationName });
  }),
);

// Reference lists for the terminal-default dropdowns (manufacturer / application / CVM).
fortisRouter.get(
  '/terminal-options',
  asyncHandler(async (_req, res) => {
    res.json(await fortis().listTerminalOptions());
  }),
);

// The persisted terminal defaults used when auto-creating equipment.
fortisRouter.get(
  '/terminal-defaults',
  asyncHandler(async (_req, res) => {
    res.json(await settingsService.getFortisTerminal());
  }),
);

fortisRouter.put(
  '/terminal-defaults',
  asyncHandler(async (req, res) => {
    const b = req.body as { manufacturerCode?: string; applicationId?: string; cvmId?: string };
    if (!b.manufacturerCode || !b.applicationId || !b.cvmId) throw badRequest('manufacturerCode, applicationId and cvmId are required');
    const cfg = await settingsService.setFortisTerminal({ manufacturerCode: b.manufacturerCode, applicationId: b.applicationId, cvmId: b.cvmId });
    req.auditMeta = { targetType: 'fortis', action: 'fortis.terminal-defaults.update' };
    res.json(cfg);
  }),
);

// Create a terminal (equipment) record. If merchantId is given, uses its linked Fortis location.
fortisRouter.post(
  '/activate',
  asyncHandler(async (req, res) => {
    const b = req.body as { serialNumber?: string; locationId?: string; merchantId?: number; title?: string };
    if (!b.serialNumber) throw badRequest('A serialNumber is required');
    let locationId = b.locationId;
    if (!locationId && b.merchantId) {
      const m = await prisma.merchant.findUnique({ where: { id: b.merchantId } });
      locationId = m?.fortisLocationId ?? undefined;
    }
    req.auditMeta = { targetType: 'fortis', targetId: b.serialNumber, action: 'fortis.activate-device' };
    res.json(await fortis().activateDevice({ serialNumber: b.serialNumber, locationId, title: b.title }));
  }),
);
