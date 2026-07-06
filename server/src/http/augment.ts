import type { AuthenticatedPrincipal } from '@de/shared';

// Augment Express Request with our authenticated principal + audit hints.
declare module 'express-serve-static-core' {
  interface Request {
    principal?: AuthenticatedPrincipal;
    auditMeta?: { targetType?: string; targetId?: string; action?: string };
    rawBody?: Buffer;
  }
}

export {};
