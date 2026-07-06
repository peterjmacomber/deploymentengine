import type { NextFunction, Request, Response } from 'express';
import { type Permission, Role, permissionsForRole } from '@de/shared';
import { verifyAccessToken } from '../../auth/jwt.js';
import { apiKeyService } from '../../services/apiKeyService.js';
import { forbidden, unauthorized } from '../../util/errors.js';

/**
 * Require a valid credential and populate req.principal + derived permissions. Accepts either an
 * internal JWT (Bearer) or an integration API key (X-API-Key). API keys get the non-admin grant
 * set and are recorded in the audit trail by their key name.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const apiKeyHeader = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (apiKeyHeader) {
    try {
      const key = await apiKeyService.verify(apiKeyHeader);
      if (!key) return next(unauthorized('Invalid or revoked API key'));
      req.principal = {
        kind: 'apikey',
        id: key.id,
        name: key.name,
        role: Role.APIKEY,
        permissions: permissionsForRole(Role.APIKEY),
      };
      return next();
    } catch {
      return next(unauthorized('API key verification failed'));
    }
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Missing bearer token'));
  const token = header.slice('Bearer '.length).trim();
  try {
    const claims = verifyAccessToken(token);
    req.principal = {
      kind: 'user',
      id: claims.sub,
      email: claims.email,
      name: claims.name,
      role: claims.role,
      permissions: permissionsForRole(claims.role),
    };
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

/** Guard requiring one of the given permissions. Works for both user and partner principals. */
export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.principal) return next(unauthorized());
    const held = new Set(req.principal.permissions);
    if (perms.some((p) => held.has(p))) return next();
    next(forbidden(`Requires one of: ${perms.join(', ')}`));
  };
}
