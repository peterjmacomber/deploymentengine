import { type DeployedEquipment, DeployedStatus } from '@de/shared';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../util/errors.js';
import { toDeployed } from './mappers.js';

const VALID = new Set(Object.values(DeployedStatus));

export const deployedEquipmentService = {
  async list(filters: { merchantId?: number; orderId?: number; status?: string; search?: string } = {}): Promise<DeployedEquipment[]> {
    const rows = await prisma.deployedEquipment.findMany({
      where: {
        ...(filters.merchantId ? { merchantId: filters.merchantId } : {}),
        ...(filters.orderId ? { orderId: filters.orderId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search ? { OR: [{ serialNumber: { contains: filters.search } }, { productName: { contains: filters.search } }, { mid: { contains: filters.search } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(toDeployed);
  },

  async get(id: number): Promise<DeployedEquipment> {
    const row = await prisma.deployedEquipment.findUnique({ where: { id } });
    if (!row) throw notFound('Deployed equipment not found');
    return toDeployed(row);
  },

  async updateStatus(id: number, status: string): Promise<DeployedEquipment> {
    if (!VALID.has(status as DeployedStatus)) throw badRequest(`Invalid status ${status}`);
    const existing = await prisma.deployedEquipment.findUnique({ where: { id } });
    if (!existing) throw notFound('Deployed equipment not found');
    const row = await prisma.deployedEquipment.update({ where: { id }, data: { status } });
    return toDeployed(row);
  },
};
