import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config.js';
import { unauthorized } from '../../util/errors.js';

/**
 * Verify inbound POS Portal webhook authenticity. The real scheme is negotiated with the
 * POS Portal Account Manager; we support all three documented options behind one env switch.
 * Uses timing-safe comparison. Requires the raw body (captured by express.json verify hook)
 * for HMAC verification.
 */
export function verifyWebhook(req: Request, _res: Response, next: NextFunction) {
  const scheme = config.WEBHOOK_AUTH_SCHEME;

  if (scheme === 'apikey') {
    const provided = (req.headers['x-api-key'] || req.headers['x-webhook-key']) as string | undefined;
    if (safeEqual(provided, config.WEBHOOK_API_KEY)) return next();
    return next(unauthorized('Invalid webhook api key'));
  }

  if (scheme === 'bearer') {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (safeEqual(token, config.WEBHOOK_API_KEY)) return next();
    return next(unauthorized('Invalid webhook bearer token'));
  }

  // hmac
  const sig = (req.headers['x-signature'] || req.headers['x-hub-signature-256']) as string | undefined;
  const secret = config.WEBHOOK_HMAC_SECRET;
  if (!sig || !secret || !req.rawBody) return next(unauthorized('Missing webhook signature'));
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const normalized = sig.replace(/^sha256=/, '');
  if (safeEqual(normalized, expected)) return next();
  return next(unauthorized('Invalid webhook signature'));
}

function safeEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
