import './augment.js';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config.js';
import { authenticate } from './middleware/auth.js';
import { auditLogger } from './middleware/audit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter, publicLimiter } from './middleware/rateLimit.js';

import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { merchantsRouter } from './routes/merchants.js';
import { ordersRouter } from './routes/orders.js';
import { shippingRouter } from './routes/shipping.js';
import { returnsRouter } from './routes/returns.js';
import { deployedRouter } from './routes/deployedEquipment.js';
import { inventoryRouter } from './routes/inventory.js';
import { bundlesRouter } from './routes/bundles.js';
import { settingsRouter } from './routes/settings.js';
import { linksRouter } from './routes/links.js';
import { publicLinksRouter } from './routes/publicLinks.js';
import { publicTrackRouter } from './routes/publicTrack.js';
import { exceptionsRouter } from './routes/exceptions.js';
import { usersRouter } from './routes/users.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { auditRouter } from './routes/audit.js';
import { devRouter } from './routes/dev.js';
import { fortisRouter } from './routes/fortis.js';
import { portalRouter } from './routes/portal.js';
import { publicRouter } from './routes/public.js';
import { webhookRouter } from './routes/webhooks.js';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf; // for webhook HMAC verification
      },
    }),
  );

  app.get('/health', (_req, res) =>
    res.json({ ok: true, service: 'deployment-engine', pospMode: config.POSP_MODE, fortisConfigured: config.fortisConfigured }),
  );

  // ---- Internal API (JWT + RBAC + audit) ----
  const v1 = Router();
  v1.use('/auth', authRouter); // /login is public; /me self-guards
  v1.use(authenticate, auditLogger); // everything below requires a valid token
  v1.use('/dashboard', dashboardRouter);
  v1.use('/merchants', merchantsRouter);
  v1.use('/orders', ordersRouter);
  v1.use('/shipping', shippingRouter);
  v1.use('/returns', returnsRouter);
  v1.use('/deployed-equipment', deployedRouter);
  v1.use('/inventory', inventoryRouter);
  v1.use('/bundles', bundlesRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/links', linksRouter);
  v1.use('/exceptions', exceptionsRouter);
  v1.use('/users', usersRouter);
  v1.use('/api-keys', apiKeysRouter);
  v1.use('/audit', auditRouter);
  v1.use('/fortis', fortisRouter);
  v1.use('/portal', portalRouter); // merchant self-service (PORTAL_USE + own-merchant scope)
  v1.use('/dev', devRouter);
  app.use('/api/v1', globalLimiter, v1);

  // ---- Public deployment-link pages (token-gated, no API key) ----
  // Registered before the API-key partner router so /link/* isn't caught by it.
  app.use('/api/public/v1/link', publicLimiter, publicLinksRouter);

  // ---- Public sanitized order tracking (share-token gated, no API key, no PII) ----
  app.use('/api/public/v1/track', publicLimiter, publicTrackRouter);

  // ---- Public / embed API (API key) ----
  app.use('/api/public/v1', publicLimiter, publicRouter);

  // ---- Webhooks (POS Portal -> us) ----
  // Intentionally polling-only by default: no public ingress. Mounted only when explicitly
  // enabled (WEBHOOKS_ENABLED=true) after an AM provisions webhooks and the endpoint is
  // safely exposed. Otherwise the receiver does not exist as an attack surface.
  if (config.WEBHOOKS_ENABLED) {
    app.use('/webhooks', webhookRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
