import type { NextFunction, Request, Response } from 'express';
import { Role, permissionsForRole } from '@de/shared';
import { config } from '../../config.js';
import { unauthorized } from '../../util/errors.js';

/**
 * Authenticate an external partner (embed plane) by API key. Keys + labels come from
 * PUBLIC_API_KEYS env. The principal is scoped to the PARTNER role's narrow grants.
 */
export function authenticatePartner(req: Request, _res: Response, next: NextFunction) {
  const key = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (!key) return next(unauthorized('Missing X-API-Key'));
  const label = config.publicApiKeys.get(key);
  if (!label) return next(unauthorized('Invalid API key'));
  req.principal = {
    kind: 'partner',
    id: key.slice(0, 6) + '…', // never echo the full key
    name: label,
    role: Role.PARTNER,
    permissions: permissionsForRole(Role.PARTNER),
  };
  next();
}
