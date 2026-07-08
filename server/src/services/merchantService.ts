import type { CreateMerchantInput, Merchant } from '@de/shared';
import { prisma } from '../db.js';
import { posPortal } from '../adapters/posportal/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { toJson } from '../util/json.js';
import { notFound } from '../util/errors.js';
import { toMerchant } from './mappers.js';

export const merchantService = {
  async list(search?: string): Promise<Merchant[]> {
    const rows = await prisma.merchant.findMany({
      where: search
        ? {
            OR: [
              { dbaName: { contains: search } },
              { mid: { contains: search } },
              { legalName: { contains: search } },
              { email: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: { _count: { select: { orders: true } } },
    });
    return rows.map((r) => ({ ...toMerchant(r), orderCount: r._count.orders }));
  },

  async get(id: number): Promise<Merchant> {
    const row = await prisma.merchant.findUnique({ where: { id } });
    if (!row) throw notFound('Merchant not found');
    return toMerchant(row);
  },

  /**
   * Resolve a merchant for an order: look up by MID (local, then POS Portal), else create.
   * Mirrors the storefront mock's MID-lookup-then-create pattern, backed by the adapter.
   */
  async resolveOrCreate(input: CreateMerchantInput): Promise<Merchant> {
    if (input.mid) {
      const local = await prisma.merchant.findFirst({ where: { mid: input.mid } });
      if (local) return toMerchant(local);
      let remote = null;
      try {
        remote = await posPortal().searchMerchantByMid(input.mid);
      } catch (err) {
        logger.warn({ err: (err as Error).message, mid: input.mid }, 'POS Portal merchant lookup failed');
      }
      if (remote) {
        const row = await prisma.merchant.create({
          data: {
            pospMerchantId: remote.id,
            mid: remote.mid ?? input.mid,
            dbaName: remote.dbaName ?? input.dbaName,
            legalName: remote.legalName ?? input.legalName,
            email: remote.email ?? input.email,
            phone: remote.phone ?? input.phone,
            shippingAddressJson: input.shippingAddress ? toJson(input.shippingAddress) : null,
          },
        });
        return toMerchant(row);
      }
    }

    let created: { id?: number; mid?: string } = {};
    try {
      created = await posPortal().createMerchant({
        mid: input.mid,
        dbaName: input.dbaName,
        legalName: input.legalName,
        email: input.email,
        phone: input.phone,
        primaryContact: input.dbaName,
        shippingAddress: input.shippingAddress,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'live POS Portal merchant create failed; storing locally');
      if (config.POSP_STRICT_WRITES) throw err;
    }
    const row = await prisma.merchant.create({
      data: {
        pospMerchantId: created.id,
        mid: input.mid ?? created.mid,
        dbaName: input.dbaName,
        legalName: input.legalName,
        email: input.email,
        phone: input.phone,
        shippingAddressJson: input.shippingAddress ? toJson(input.shippingAddress) : null,
      },
    });
    return toMerchant(row);
  },

  async create(input: CreateMerchantInput): Promise<Merchant> {
    return this.resolveOrCreate(input);
  },
};
