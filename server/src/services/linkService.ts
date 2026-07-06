import {
  type CreateLinkInput,
  type DeploymentLink,
  type LinkOrderInput,
  OrderMethod,
  type PublicLinkConfig,
  type UpdateLinkInput,
} from '@de/shared';
import type { DeploymentLink as LinkRow } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { linkToken } from '../util/ids.js';
import { fromJson, toJson } from '../util/json.js';
import { AppError, badRequest, notFound } from '../util/errors.js';
import { tax } from '../adapters/tax/index.js';
import { toBundle } from './mappers.js';
import { orderService } from './orderService.js';

function toLink(row: LinkRow): DeploymentLink {
  return {
    id: row.id,
    token: row.token,
    type: row.type as 'order' | 'application',
    name: row.name,
    active: row.active,
    merchantId: row.merchantId ?? undefined,
    merchantMid: row.merchantMid ?? undefined,
    merchantDba: row.merchantDba ?? undefined,
    bundlePospIds: fromJson<number[]>(row.bundlePospIdsJson, []),
    pricingOverrides: fromJson<Record<string, number>>(row.pricingOverridesJson, {}),
    shippingMethodId: row.shippingMethodId ?? undefined,
    customFeeName: row.customFeeName ?? undefined,
    customFeeAmount: row.customFeeAmount ?? undefined,
    hasPassword: Boolean(row.passwordHash),
    maxUses: row.maxUses ?? undefined,
    usesCount: row.usesCount,
    expiresAt: row.expiresAt?.toISOString(),
    visits: row.visits,
    orders: row.orders,
    unitsVolume: row.unitsVolume,
    revenue: row.revenue,
    lastUsedAt: row.lastUsedAt?.toISOString(),
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Throws if the link cannot currently be used (inactive / expired / used up). */
function assertUsable(row: LinkRow): void {
  if (!row.active) throw new AppError(410, 'This link has been deactivated');
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new AppError(410, 'This link has expired');
  if (row.maxUses != null && row.usesCount >= row.maxUses) throw new AppError(410, 'This link has reached its usage limit');
}

export const linkService = {
  async list(): Promise<DeploymentLink[]> {
    const rows = await prisma.deploymentLink.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toLink);
  },

  async get(id: number): Promise<DeploymentLink> {
    const row = await prisma.deploymentLink.findUnique({ where: { id } });
    if (!row) throw notFound('Link not found');
    return toLink(row);
  },

  async create(input: CreateLinkInput, createdBy: string): Promise<DeploymentLink> {
    if (input.type === 'order' && !input.merchantId) throw badRequest('Order links require a merchant');
    let merchantMid: string | null = null;
    let merchantDba: string | null = null;
    if (input.merchantId) {
      const m = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
      if (!m) throw badRequest('Merchant not found');
      merchantMid = m.mid;
      merchantDba = m.dbaName;
    }
    const row = await prisma.deploymentLink.create({
      data: {
        token: linkToken(),
        type: input.type,
        name: input.name,
        merchantId: input.merchantId,
        merchantMid,
        merchantDba,
        bundlePospIdsJson: toJson(input.bundlePospIds),
        pricingOverridesJson: toJson(input.pricingOverrides ?? {}),
        shippingMethodId: input.shippingMethodId,
        customFeeName: input.customFeeName,
        customFeeAmount: input.customFeeAmount,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy,
      },
    });
    return toLink(row);
  },

  async update(id: number, patch: UpdateLinkInput): Promise<DeploymentLink> {
    const existing = await prisma.deploymentLink.findUnique({ where: { id } });
    if (!existing) throw notFound('Link not found');
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.merchantId !== undefined) {
      if (patch.merchantId) {
        const m = await prisma.merchant.findUnique({ where: { id: patch.merchantId } });
        if (!m) throw badRequest('Merchant not found');
        data.merchantId = patch.merchantId;
        data.merchantMid = m.mid;
        data.merchantDba = m.dbaName;
      } else {
        data.merchantId = null;
        data.merchantMid = null;
        data.merchantDba = null;
      }
    }
    if (patch.bundlePospIds !== undefined) data.bundlePospIdsJson = toJson(patch.bundlePospIds);
    if (patch.pricingOverrides !== undefined) data.pricingOverridesJson = toJson(patch.pricingOverrides);
    if (patch.shippingMethodId !== undefined) data.shippingMethodId = patch.shippingMethodId;
    if (patch.customFeeName !== undefined) data.customFeeName = patch.customFeeName;
    if (patch.customFeeAmount !== undefined) data.customFeeAmount = patch.customFeeAmount;
    if (patch.maxUses !== undefined) data.maxUses = patch.maxUses;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    if (patch.clearPassword) data.passwordHash = null;
    else if (patch.password) data.passwordHash = await hashPassword(patch.password);
    const row = await prisma.deploymentLink.update({ where: { id }, data });
    return toLink(row);
  },

  async remove(id: number): Promise<void> {
    await prisma.deploymentLink.delete({ where: { id } }).catch(() => { throw notFound('Link not found'); });
  },

  /** Resolve a link for public consumption (records a visit). Enforces auth/expiry/limits. */
  async resolvePublic(token: string, password?: string): Promise<PublicLinkConfig> {
    const row = await prisma.deploymentLink.findUnique({ where: { token } });
    if (!row) throw notFound('Link not found');
    assertUsable(row);
    if (row.passwordHash) {
      if (!password) throw new AppError(401, 'Password required', { type: 'link/password-required' });
      if (!(await verifyPassword(password, row.passwordHash))) throw new AppError(401, 'Incorrect password', { type: 'link/password-required' });
    }
    await prisma.deploymentLink.update({ where: { id: row.id }, data: { visits: { increment: 1 }, lastUsedAt: new Date() } });

    const bundleIds = fromJson<number[]>(row.bundlePospIdsJson, []);
    const overrides = fromJson<Record<string, number>>(row.pricingOverridesJson, {});
    const bundleRows = await prisma.bundle.findMany({ where: { pospBundleId: { in: bundleIds } } });
    const bundles = bundleRows.map((b) => {
      const canon = toBundle(b);
      return {
        pospBundleId: canon.pospBundleId,
        displayName: canon.displayName,
        description: canon.description,
        items: canon.items,
        application: canon.pospApplication ?? undefined,
        price: overrides[String(canon.pospBundleId)] ?? canon.accountingUnitPrice,
      };
    });
    return {
      token: row.token,
      type: row.type as 'order' | 'application',
      name: row.name,
      requiresApplicant: row.type === 'application',
      merchant: row.merchantId ? { dbaName: row.merchantDba ?? undefined, mid: row.merchantMid ?? undefined } : undefined,
      bundles,
      shippingMethodId: row.shippingMethodId ?? undefined,
      customFee: row.customFeeName && row.customFeeAmount != null ? { name: row.customFeeName, amount: row.customFeeAmount } : undefined,
    };
  },

  /** Public price + estimated-tax quote for a link's cart at a shipping address. */
  async taxQuote(token: string, input: { cart: Array<{ pospBundleId: number; quantity: number }>; address: import('../adapters/tax/index.js').TaxAddress }): Promise<{ subtotal: number; customFeeName?: string; customFee: number; tax: number; taxRate: number; taxProvider: string; taxNote?: string; total: number }> {
    const row = await prisma.deploymentLink.findUnique({ where: { token } });
    if (!row) throw notFound('Link not found');
    assertUsable(row);
    const overrides = fromJson<Record<string, number>>(row.pricingOverridesJson, {});
    const bundleRows = await prisma.bundle.findMany({ where: { pospBundleId: { in: (input.cart ?? []).map((c) => c.pospBundleId) } } });
    const nameById = new Map(bundleRows.map((b) => [b.pospBundleId, b.displayName]));
    const stdById = new Map(bundleRows.map((b) => [b.pospBundleId, b.accountingUnitPrice ?? 0]));
    const lines = (input.cart ?? []).map((c) => ({ amount: overrides[String(c.pospBundleId)] ?? stdById.get(c.pospBundleId) ?? 0, quantity: c.quantity, description: nameById.get(c.pospBundleId) }));
    const subtotal = lines.reduce((s, l) => s + l.amount * (l.quantity ?? 1), 0);
    const customFee = row.customFeeAmount ?? 0;
    const est = await tax().estimate({ toAddress: input.address ?? {}, lines: [...lines, ...(customFee ? [{ amount: customFee, description: row.customFeeName ?? 'Fee' }] : [])] });
    return { subtotal, customFeeName: row.customFeeName ?? undefined, customFee, tax: est.tax, taxRate: est.rate, taxProvider: est.provider, taxNote: est.note, total: subtotal + customFee + est.tax };
  },

  /** Public order tracking scoped to the link that created the order (no API key). */
  async publicOrderStatus(token: string, orderId: number): Promise<{ id: number; reference?: string; status: string; packages: import('@de/shared').Package[]; serialNumbers: string[] }> {
    const owns = await prisma.order.findFirst({ where: { id: orderId, originLinkToken: token }, select: { id: true } });
    if (!owns) throw notFound('Order not found for this link');
    const o = await orderService.get(orderId, { refresh: config.POSP_MODE === 'live' });
    return { id: o.id, reference: o.reference, status: o.status, packages: o.packages, serialNumbers: o.serialNumbers };
  },

  /** Place an order through a link. Enforces auth/limits, then reuses the order pipeline. */
  async placeOrder(token: string, input: LinkOrderInput): Promise<{ order: import('@de/shared').Order; redirectUrl?: string }> {
    const row = await prisma.deploymentLink.findUnique({ where: { token } });
    if (!row) throw notFound('Link not found');
    assertUsable(row);
    if (row.passwordHash) {
      if (!input.password || !(await verifyPassword(input.password, row.passwordHash))) throw new AppError(401, 'Password required', { type: 'link/password-required' });
    }

    const bundleIds = fromJson<number[]>(row.bundlePospIdsJson, []);
    const overrides = fromJson<Record<string, number>>(row.pricingOverridesJson, {});
    const cart = input.cart?.length ? input.cart : bundleIds.map((id) => ({ pospBundleId: id, quantity: 1 }));
    // Guard: only bundles configured on the link may be ordered.
    for (const c of cart) if (!bundleIds.includes(c.pospBundleId)) throw badRequest(`Bundle ${c.pospBundleId} is not offered by this link`);

    const merchantId = row.merchantId ?? undefined;
    const mid = row.merchantMid ?? undefined;

    const createInput: import('@de/shared').CreateOrderInput = {
      merchantId,
      mid: mid ?? input.applicant?.mid ?? '',
      cart,
      shippingAddress: input.shippingAddress,
      shippingMethodId: input.shippingMethodId ?? row.shippingMethodId ?? undefined,
    };
    if (!merchantId) {
      if (!input.applicant) throw badRequest('Applicant details are required for this link');
      createInput.merchant = {
        mid: input.applicant.mid,
        dbaName: input.applicant.dbaName,
        legalName: input.applicant.legalName,
        email: input.applicant.email,
        phone: input.applicant.phone,
        shippingAddress: input.shippingAddress,
      };
      createInput.mid = input.applicant.mid;
    }

    const order = await orderService.create(createInput, {
      createdBy: `link:${row.token}`,
      method: OrderMethod.EMBED_PARTNER,
      originLinkToken: row.token,
      originLinkName: row.name,
    });

    // Analytics: net revenue vs. standard price ((listed − standard) × qty), plus any custom
    // fee. A free/discounted device shows negative (the discount given).
    const units = cart.reduce((s, c) => s + c.quantity, 0);
    const bundleRows = await prisma.bundle.findMany({ where: { pospBundleId: { in: cart.map((c) => c.pospBundleId) } } });
    const stdPrice = new Map(bundleRows.map((b) => [b.pospBundleId, b.accountingUnitPrice ?? 0]));
    const revenue =
      cart.reduce((s, c) => {
        const std = stdPrice.get(c.pospBundleId) ?? 0;
        const listed = overrides[String(c.pospBundleId)] ?? std;
        return s + (listed - std) * c.quantity;
      }, 0) + (row.customFeeAmount ?? 0);
    await prisma.deploymentLink.update({
      where: { id: row.id },
      data: { orders: { increment: 1 }, usesCount: { increment: 1 }, unitsVolume: { increment: units }, revenue: { increment: revenue }, lastUsedAt: new Date() },
    });

    let redirectUrl: string | undefined;
    if (input.returnUrl) {
      const u = new URL(input.returnUrl);
      u.searchParams.set('orderId', String(order.id));
      if (order.reference) u.searchParams.set('reference', order.reference);
      redirectUrl = u.toString();
    }
    return { order, redirectUrl };
  },
};
