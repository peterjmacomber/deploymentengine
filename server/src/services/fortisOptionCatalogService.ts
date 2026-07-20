import { prisma } from '../db.js';

export interface FortisTerminalOptionRow {
  id: number;
  environment: string;
  kind: string;
  fortisId: string;
  label: string;
  manufacturerCode: string | null;
  lineType: string | null;
  deprecated: boolean;
}

/** Read-only catalog of every manufacturer/application/CVM option discovered live from both
 *  Fortis environments (via the admin "Add Terminal" forms) — seeded once, not live-synced
 *  (production has no API credentials wired into this app). Feeds a future admin picker. */
export const fortisOptionCatalogService = {
  async list(filter: { environment?: string; kind?: string } = {}): Promise<FortisTerminalOptionRow[]> {
    return prisma.fortisTerminalOption.findMany({
      where: { environment: filter.environment, kind: filter.kind },
      orderBy: [{ environment: 'asc' }, { kind: 'asc' }, { label: 'asc' }],
    });
  },
};
