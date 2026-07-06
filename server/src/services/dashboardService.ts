import { ExceptionStatus } from '@de/shared';
import { prisma } from '../db.js';
import { toOrder } from './mappers.js';
import { forecastService } from './forecastService.js';

export const dashboardService = {
  async summary() {
    const [orders, ordersByStatusRaw, pendingExceptions, openReturns, delinquent, deployedActive, merchants, recentRows] =
      await Promise.all([
        prisma.order.count(),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.exceptionRequest.count({ where: { status: ExceptionStatus.PENDING } }),
        prisma.returnCase.count({ where: { NOT: { lifecycle: 'CLOSED' } } }),
        prisma.returnCase.count({ where: { delinquent: true } }),
        prisma.deployedEquipment.count({ where: { status: 'ACTIVE' } }),
        prisma.merchant.count(),
        prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      ]);

    const ordersByStatus: Record<string, number> = {};
    for (const g of ordersByStatusRaw) ordersByStatus[g.status] = g._count._all;

    let inventoryAlerts = 0;
    try {
      const fc = await forecastService.build();
      inventoryAlerts = fc.metrics.atRisk;
    } catch {
      inventoryAlerts = 0;
    }

    return {
      kpis: {
        orders,
        pendingExceptions,
        openReturns,
        delinquent,
        deployedActive,
        merchants,
        inventoryAlerts,
      },
      ordersByStatus,
      recentOrders: recentRows.map(toOrder),
    };
  },
};
