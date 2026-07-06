import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { PosPortalAdapter } from './PosPortalAdapter.js';
import { MockPosPortalAdapter } from './mock.js';
import { LivePosPortalAdapter } from './live.js';

let instance: PosPortalAdapter | null = null;

/** Singleton POS Portal adapter selected by POSP_MODE. */
export function posPortal(): PosPortalAdapter {
  if (!instance) {
    instance = config.POSP_MODE === 'live' ? new LivePosPortalAdapter() : new MockPosPortalAdapter();
    logger.info({ mode: instance.mode }, 'POS Portal adapter initialized');
  }
  return instance;
}

export type { PosPortalAdapter } from './PosPortalAdapter.js';
