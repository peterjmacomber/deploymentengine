import type { AuditEntry } from '@de/shared';
import { prisma } from '../db.js';
import { fromJson, toJson } from '../util/json.js';
import { logger } from '../logger.js';

export interface AuditInput {
  actor: string;
  actorRole: string;
  action: string;
  method: string;
  path: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  statusCode?: number;
  metadata?: unknown;
}

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'clientSecret', 'token', 'access_token', 'secret']);

/** Strip secrets from any metadata before it is persisted to the audit trail. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : scrub(v);
    }
    return out;
  }
  return value;
}

export const auditService = {
  async record(input: AuditInput): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actor: input.actor,
          actorRole: input.actorRole,
          action: input.action,
          method: input.method,
          path: input.path,
          targetType: input.targetType,
          targetId: input.targetId,
          ip: input.ip,
          statusCode: input.statusCode,
          metadataJson: input.metadata === undefined ? null : toJson(scrub(input.metadata)),
        },
      });
    } catch (err) {
      // Never let audit failure break a request, but do surface it.
      logger.error({ err }, 'audit write failed');
    }
  },

  async query(opts: { limit?: number; actor?: string; action?: string; targetType?: string; targetId?: string } = {}): Promise<AuditEntry[]> {
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(opts.actor ? { actor: opts.actor } : {}),
        ...(opts.action ? { action: { contains: opts.action } } : {}),
        ...(opts.targetType ? { targetType: opts.targetType } : {}),
        ...(opts.targetId ? { targetId: opts.targetId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 200, 1000),
    });
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      actorRole: r.actorRole,
      action: r.action,
      method: r.method,
      path: r.path,
      targetType: r.targetType ?? undefined,
      targetId: r.targetId ?? undefined,
      ip: r.ip ?? undefined,
      statusCode: r.statusCode ?? undefined,
      metadata: fromJson<unknown>(r.metadataJson, null),
      createdAt: r.createdAt.toISOString(),
    }));
  },
};
