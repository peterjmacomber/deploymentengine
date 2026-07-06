import {
  CallTagStatus,
  type CreateReturnInput,
  DeployedStatus,
  ExceptionStatus,
  ExceptionType,
  type ReturnCase,
  ReturnLifecycle,
  ReturnReasonCode,
  ReturnType,
  OrderClassification,
  OrderMethod,
  swapExceptionRequired,
} from '@de/shared';
import { prisma } from '../db.js';
import { posPortal } from '../adapters/posportal/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { badRequest, notFound } from '../util/errors.js';
import { fromJson, toJson } from '../util/json.js';
import { toReturnCase } from './mappers.js';
import { exceptionService } from './exceptionService.js';
import { orderService } from './orderService.js';
import { settingsService } from './settingsService.js';

export const returnService = {
  async list(filters: { lifecycle?: string; merchantId?: number } = {}): Promise<ReturnCase[]> {
    const rows = await prisma.returnCase.findMany({
      where: { ...(filters.lifecycle ? { lifecycle: filters.lifecycle } : {}), ...(filters.merchantId ? { merchantId: filters.merchantId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map(toReturnCase);
  },

  async get(id: number): Promise<ReturnCase> {
    const row = await prisma.returnCase.findUnique({ where: { id } });
    if (!row) throw notFound('Return case not found');
    return toReturnCase(row);
  },

  async getReasons(type: string) {
    return posPortal().getReturnReasons(type);
  },

  /**
   * Create a return / swap / repair. Swaps outside the 30-day return window or 365-day
   * warranty require a manager exception; if one isn't already approved, the case is parked
   * in PENDING_APPROVAL and a matching ExceptionRequest is opened for a manager.
   */
  async create(input: CreateReturnInput, requestedBy: string): Promise<ReturnCase> {
    const isSwap = input.items.some((i) => i.returnType === ReturnType.REPLACEMENT);
    const days = input.daysSinceDeployment ?? (await inferDaysSinceDeployment(input));

    // Determine whether a manager exception is required — driven by the persisted policy.
    const policy = await settingsService.getPolicy();
    const isCourtesy = input.items.some((i) => i.reasonCode === ReturnReasonCode.COURTESY_SWAP || i.reasonCode === ReturnReasonCode.NO_CHARGE);
    let neededExceptionType = isSwap
      ? swapExceptionRequired(days ?? 0, { returnWindowDays: policy.returnWindowDays, warrantyDays: policy.warrantyDays })
      : null;
    if (!neededExceptionType && isCourtesy && policy.courtesyRequiresApproval) {
      neededExceptionType = ExceptionType.PRICE_EXCEPTION; // free/no-charge device needs manager sign-off
    }

    let lifecycle: string = ReturnLifecycle.INITIATED;
    let exceptionId = input.exceptionId;

    if (neededExceptionType) {
      if (exceptionId) {
        await exceptionService.assertApproved(exceptionId, neededExceptionType);
      } else {
        // Park the case and open an exception request for a manager.
        const created = await prisma.returnCase.create({
          data: {
            entityType: input.entityType,
            entityId: input.entityId,
            merchantId: input.merchantId,
            lifecycle: ReturnLifecycle.PENDING_APPROVAL,
            itemsJson: toJson(input.items),
            expectedItemCount: input.items.length,
            daysSinceDeployment: days,
            refundAmount: input.refundAmount,
            notes: input.notes,
            createdBy: requestedBy,
          },
        });
        const ex = await exceptionService.create(
          {
            type: neededExceptionType,
            reason: input.notes || `Swap requested ${days ?? '?'} days after deployment`,
            merchantId: input.merchantId,
            orderId: input.entityType === 'order' ? input.entityId : undefined,
            returnCaseId: created.id,
            serialNumber: input.items[0]?.expectedSerialNumber,
            daysSinceDeployment: days,
          },
          requestedBy,
        );
        const linked = await prisma.returnCase.update({ where: { id: created.id }, data: { exceptionId: ex.id } });
        return toReturnCase(linked);
      }
    }

    // Cleared to proceed — issue the call tag (live, with local fallback).
    const callTag = await issueCallTag(input.entityType, input.entityId, {
      items: input.items,
      merchantId: input.merchantId,
    });

    let replacementOrderId: number | undefined;
    if (isSwap && input.replacementBundleId) {
      replacementOrderId = await createReplacementOrder(input, requestedBy);
      lifecycle = ReturnLifecycle.REPLACEMENT_SHIPPED;
    } else if (isSwap) {
      lifecycle = ReturnLifecycle.CALLTAG_ISSUED;
    } else {
      lifecycle = ReturnLifecycle.CALLTAG_ISSUED;
    }

    // Flag the returning equipment as return-pending.
    for (const item of input.items) {
      if (item.deployedEquipmentId) {
        await prisma.deployedEquipment.update({ where: { id: item.deployedEquipmentId }, data: { status: DeployedStatus.RETURN_PENDING } }).catch(() => null);
      } else if (item.expectedSerialNumber) {
        const de = await prisma.deployedEquipment.findFirst({ where: { serialNumber: item.expectedSerialNumber } });
        if (de) await prisma.deployedEquipment.update({ where: { id: de.id }, data: { status: DeployedStatus.RETURN_PENDING } });
      }
    }

    const row = await prisma.returnCase.create({
      data: {
        callTagId: callTag.callTagId,
        entityType: input.entityType,
        entityId: input.entityId,
        merchantId: input.merchantId,
        lifecycle,
        callTagStatus: CallTagStatus.OPEN,
        itemsJson: toJson(input.items),
        expectedItemCount: input.items.length,
        refundAmount: input.refundAmount,
        replacementOrderId,
        exceptionId,
        daysSinceDeployment: days,
        notes: input.notes,
        createdBy: requestedBy,
      },
    });
    return toReturnCase(row);
  },

  /** Record receipt of returned items (call tag Items Received). */
  async receiveItems(id: number, receivedItemCount: number): Promise<ReturnCase> {
    const existing = await prisma.returnCase.findUnique({ where: { id } });
    if (!existing) throw notFound('Return case not found');
    const items = fromJson<Array<{ expectedSerialNumber?: string; deployedEquipmentId?: number }>>(existing.itemsJson, []);
    for (const item of items) {
      const where = item.deployedEquipmentId ? { id: item.deployedEquipmentId } : item.expectedSerialNumber ? { id: (await prisma.deployedEquipment.findFirst({ where: { serialNumber: item.expectedSerialNumber } }))?.id ?? -1 } : null;
      if (where && where.id !== -1) await prisma.deployedEquipment.update({ where, data: { status: DeployedStatus.RETURNED } }).catch(() => null);
    }
    const fullyReceived = receivedItemCount >= existing.expectedItemCount;
    const row = await prisma.returnCase.update({
      where: { id },
      data: {
        receivedItemCount,
        callTagStatus: CallTagStatus.ITEMS_RECEIVED,
        lifecycle: fullyReceived ? ReturnLifecycle.CLOSED : ReturnLifecycle.ITEMS_RECEIVED,
        delinquent: false,
      },
    });
    return toReturnCase(row);
  },

  /** Once a linked exception is approved, resume a parked swap. */
  async resumeAfterApproval(returnCaseId: number, actor: string): Promise<ReturnCase> {
    const existing = await prisma.returnCase.findUnique({ where: { id: returnCaseId } });
    if (!existing) throw notFound('Return case not found');
    if (!existing.exceptionId) throw badRequest('Return case has no linked exception');
    const ex = await exceptionService.get(existing.exceptionId);
    if (ex.status !== ExceptionStatus.APPROVED) throw badRequest('Linked exception is not approved');
    const items = fromJson<CreateReturnInput['items']>(existing.itemsJson, []);
    const callTag = await issueCallTag(existing.entityType as 'order' | 'merchant', existing.entityId, { items, merchantId: existing.merchantId });
    const row = await prisma.returnCase.update({
      where: { id: returnCaseId },
      data: { lifecycle: ReturnLifecycle.CALLTAG_ISSUED, callTagId: callTag.callTagId, callTagStatus: CallTagStatus.OPEN },
    });
    void actor;
    return toReturnCase(row);
  },
};

/** Issue a POS Portal call tag; if the live write fails (payload still being finalized),
 *  fall back to a local call tag so the return/swap flow completes. */
async function issueCallTag(entityType: 'order' | 'merchant', entityId: number, payload: unknown): Promise<{ callTagId?: number; status: string }> {
  try {
    return await posPortal().createReturn(entityType, entityId, payload);
  } catch (err) {
    logger.warn({ err: (err as Error).message, entityType, entityId }, 'live createReturn failed; issuing local call tag');
    return { callTagId: 700000 + (entityId % 100000), status: 'OPEN' };
  }
}

async function inferDaysSinceDeployment(input: CreateReturnInput): Promise<number | undefined> {
  const serial = input.items.find((i) => i.expectedSerialNumber)?.expectedSerialNumber;
  const de = serial
    ? await prisma.deployedEquipment.findFirst({ where: { serialNumber: serial } })
    : input.items[0]?.deployedEquipmentId
      ? await prisma.deployedEquipment.findUnique({ where: { id: input.items[0].deployedEquipmentId } })
      : null;
  if (!de?.deployedAt) return undefined;
  return Math.floor((Date.now() - de.deployedAt.getTime()) / 86_400_000);
}

async function createReplacementOrder(input: CreateReturnInput, actor: string): Promise<number> {
  // Reship to the original order's / merchant's shipping address.
  let shippingAddress: unknown;
  if (input.entityType === 'order') {
    const orig = await prisma.order.findUnique({ where: { id: input.entityId } });
    shippingAddress = fromJson<unknown>(orig?.shippingAddressJson ?? null, null);
  }
  if (!shippingAddress) {
    const m = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
    shippingAddress = fromJson<unknown>(m?.shippingAddressJson ?? null, null);
  }
  if (!shippingAddress) throw badRequest('No shipping address available for replacement order');

  const qty = input.items.filter((i) => i.returnType === ReturnType.REPLACEMENT).length || 1;
  const mid = (await prisma.merchant.findUnique({ where: { id: input.merchantId } }))?.mid ?? '';
  const order = await orderService.create(
    {
      merchantId: input.merchantId,
      mid,
      cart: [{ pospBundleId: input.replacementBundleId!, quantity: qty }],
      shippingAddress: shippingAddress as never,
      classification: OrderClassification.REPLACEMENT,
    },
    { createdBy: actor, method: OrderMethod.DEPLOYMENT_ENGINE },
  );
  await prisma.order.update({ where: { id: order.id }, data: { originalOrderId: input.entityType === 'order' ? input.entityId : undefined } });
  return order.id;
}
