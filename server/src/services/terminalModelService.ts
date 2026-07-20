import type { TerminalModel, UpsertTerminalModelInput } from '@de/shared';
import { prisma } from '../db.js';
import { notFound } from '../util/errors.js';
import { toTerminalModel } from './mappers.js';

/** Catalog of physical terminal/device models — the Fortis Gateway linkage shared by every
 *  Bundle that includes a given device (see TerminalModel, shared/src/domain.ts). */
export const terminalModelService = {
  async list(): Promise<TerminalModel[]> {
    const rows = await prisma.terminalModel.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toTerminalModel);
  },

  async get(id: number): Promise<TerminalModel> {
    const row = await prisma.terminalModel.findUnique({ where: { id } });
    if (!row) throw notFound('Terminal model not found');
    return toTerminalModel(row);
  },

  async upsert(input: UpsertTerminalModelInput): Promise<TerminalModel> {
    const data = {
      name: input.name,
      manufacturer: input.manufacturer ?? null,
      active: input.active,
      fortisManufacturerId: input.fortisManufacturerId ?? null,
      fortisApplicationId: input.fortisApplicationId ?? null,
      fortisCvmId: input.fortisCvmId ?? null,
      fortisPaymentPriority: input.fortisPaymentPriority ?? null,
      fortisManufacturerIdProd: input.fortisManufacturerIdProd ?? null,
      fortisApplicationIdProd: input.fortisApplicationIdProd ?? null,
      fortisCvmIdProd: input.fortisCvmIdProd ?? null,
      fortisPaymentPriorityProd: input.fortisPaymentPriorityProd ?? null,
    };
    const row = await prisma.terminalModel.upsert({
      where: { name: input.name },
      create: data,
      update: data,
    });
    return toTerminalModel(row);
  },
};
