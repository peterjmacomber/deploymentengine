import type { NextFunction, Request, Response } from 'express';
import { auditService } from '../../services/auditService.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every state-changing request to the audit trail once the response finishes.
 * Captures actor, role, action, target, status, IP, and a scrubbed body snapshot.
 * Read requests are not audited (volume) — extend MUTATING if read-audit is required.
 */
export function auditLogger(req: Request, res: Response, next: NextFunction) {
  // Audit all state changes, and EVERY call made with an integration API key (incl. reads),
  // so the audit log captures any interaction with these keys.
  const isApiKey = req.principal?.kind === 'apikey';
  if (!MUTATING.has(req.method) && !isApiKey) return next();

  // Snapshot body now (handlers may mutate/consume it).
  const bodySnapshot = req.body && typeof req.body === 'object' ? { ...req.body } : undefined;

  res.on('finish', () => {
    const actor =
      req.principal?.kind === 'apikey'
        ? `apikey:${req.principal.name ?? req.principal.id}`
        : req.principal?.kind === 'partner'
          ? `partner:${req.principal.name ?? req.principal.id}`
          : req.principal?.email ?? 'anonymous';
    void auditService.record({
      actor,
      actorRole: req.principal?.role ?? 'anonymous',
      action: req.auditMeta?.action ?? `${req.method} ${req.baseUrl}${req.path}`,
      method: req.method,
      path: `${req.baseUrl}${req.path}`,
      targetType: req.auditMeta?.targetType,
      targetId: req.auditMeta?.targetId,
      ip: req.ip,
      statusCode: res.statusCode,
      metadata: bodySnapshot,
    });
  });

  next();
}
