import { ExceptionStatus } from '@de/shared';
import { prisma } from '../db.js';
import { toOrder } from './mappers.js';
import { forecastService } from './forecastService.js';

export const dashboardService = {
  async summary() {
    const [orders, ordersByStatusRaw, pendingExceptions, openReturns, delinquent, deployedActive, merchants, recentRows, swaps, orderTotals, allOrders, allReturns] =
      await Promise.all([
        prisma.order.count(),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.exceptionRequest.count({ where: { status: ExceptionStatus.PENDING } }),
        prisma.returnCase.count({ where: { NOT: { lifecycle: 'CLOSED' } } }),
        prisma.returnCase.count({ where: { delinquent: true } }),
        prisma.deployedEquipment.count({ where: { status: 'ACTIVE' } }),
        prisma.merchant.count(),
        prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
        // A swap = a REPLACEMENT-type return case (itemsJson records the returnType).
        prisma.returnCase.count({ where: { itemsJson: { contains: 'REPLACEMENT' } } }),
        prisma.order.aggregate({ _sum: { total: true } }),
        prisma.order.findMany({ select: { id: true, pospOrderId: true, total: true } }),
        prisma.returnCase.findMany({ select: { entityType: true, entityId: true, origin: true, pospStatus: true, lifecycle: true } }),
      ]);

    const ordersByStatus: Record<string, number> = {};
    for (const g of ordersByStatusRaw) ordersByStatus[g.status] = g._count._all;

    // --- Billing rollup ---
    // Value of returns = the order total of the equipment each return is against. Imported returns
    // key on the POS Portal order id (entityId); engine returns key on the internal order id.
    const byPosp = new Map<number, number>();
    const byId = new Map<number, number>();
    for (const o of allOrders) { if (o.pospOrderId) byPosp.set(o.pospOrderId, o.total ?? 0); byId.set(o.id, o.total ?? 0); }
    let returnsValue = 0;
    let warrantyReturns = 0; // Closed by Return — no charge (inferred warranty)
    let billedReturns = 0;   // Closed by Return after Billing — a charge was involved
    for (const r of allReturns) {
      const status = (r.pospStatus ?? r.lifecycle).toUpperCase();
      if (status === 'CLOSED_BY_RETURN') warrantyReturns += 1;
      else if (status === 'CLOSED_BY_RETURN_AFTER_BILLING' || status === 'CLOSED_BY_BILLING') billedReturns += 1;
      if (r.entityType === 'order') returnsValue += (r.origin === 'posportal' ? byPosp.get(r.entityId) : byId.get(r.entityId)) ?? 0;
    }

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
      swaps,
      billing: {
        totalOrderValue: orderTotals._sum.total ?? 0,
        returnsValue,
        warrantyReturns,
        billedReturns,
      },
      recentOrders: recentRows.map(toOrder),
    };
  },
};
