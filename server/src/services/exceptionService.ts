import {
  type CreateExceptionInput,
  type ExceptionRequest,
  ExceptionStatus,
  type ExceptionType,
} from '@de/shared';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../util/errors.js';
import { toException } from './mappers.js';

export const exceptionService = {
  async list(status?: string, type?: string): Promise<ExceptionRequest[]> {
    const rows = await prisma.exceptionRequest.findMany({
      where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: 300,
    });
    return rows.map(toException);
  },

  async get(id: number): Promise<ExceptionRequest> {
    const row = await prisma.exceptionRequest.findUnique({ where: { id } });
    if (!row) throw notFound('Exception request not found');
    return toException(row);
  },

  async create(input: CreateExceptionInput, requestedBy: string): Promise<ExceptionRequest> {
    const row = await prisma.exceptionRequest.create({
      data: {
        type: input.type,
        status: ExceptionStatus.PENDING,
        requestedBy,
        reason: input.reason,
        merchantId: input.merchantId,
        orderId: input.orderId,
        returnCaseId: input.returnCaseId,
        bundlePospId: input.bundlePospId,
        originalPrice: input.originalPrice,
        requestedPrice: input.requestedPrice,
        serialNumber: input.serialNumber,
        daysSinceDeployment: input.daysSinceDeployment,
      },
    });
    return toException(row);
  },

  async decide(id: number, decision: 'APPROVED' | 'DENIED', decidedBy: string, note?: string): Promise<ExceptionRequest> {
    const existing = await prisma.exceptionRequest.findUnique({ where: { id } });
    if (!existing) throw notFound('Exception request not found');
    if (existing.status !== ExceptionStatus.PENDING) {
      throw badRequest(`Exception is already ${existing.status}`);
    }
    const row = await prisma.exceptionRequest.update({
      where: { id },
      data: { status: decision, decidedBy, decidedAt: new Date(), decisionNote: note },
    });
    return toException(row);
  },

  /**
   * Assert a given exception id exists, is APPROVED, and (optionally) matches an expected
   * type. Used by order/return services to gate the underlying privileged action.
   */
  async assertApproved(id: number, expectedType?: ExceptionType): Promise<ExceptionRequest> {
    const ex = await this.get(id);
    if (ex.status !== ExceptionStatus.APPROVED) {
      throw forbidden('Referenced exception has not been approved by a manager');
    }
    if (expectedType && ex.type !== expectedType) {
      throw badRequest(`Exception ${id} is a ${ex.type}, expected ${expectedType}`);
    }
    return ex;
  },
};
