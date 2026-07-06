import rateLimit from 'express-rate-limit';

/** Global limiter for the internal API. */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** Stricter limiter for the login endpoint (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { title: 'Too Many Requests', status: 429, detail: 'Too many login attempts; try again shortly.' },
});

/** Limiter for the public/embed plane (per API key + IP). */
export const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.headers['x-api-key'] ?? 'anon'}:${req.ip}`,
});
