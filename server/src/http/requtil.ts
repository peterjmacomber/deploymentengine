import type { Request } from 'express';
import { badRequest } from '../util/errors.js';

/** A stable actor string for createdBy / audit fields. */
export function actor(req: Request): string {
  const p = req.principal;
  if (!p) return 'system';
  return p.kind === 'partner' ? `partner:${p.name ?? p.id}` : (p.email ?? String(p.id));
}

/** Parse a required numeric route param. */
export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}

/** Coerce an optional numeric query value. */
export function numQuery(req: Request, name: string): number | undefined {
  const v = req.query[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function strQuery(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === 'string' && v.length ? v : undefined;
}
