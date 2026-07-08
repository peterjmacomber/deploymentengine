import {
  type CreateOrderInput,
  DeployedStatus,
  ExceptionType,
  type Order,
  OrderClassification,
  type OrderMethod,
  OrderStatus,
  PackageStatus,
  canonicalOrderStatus,
  shippingMethodsFor,
} from '@de/shared';
import { prisma } from '../db.js';
import { posPortal } from '../adapters/posportal/index.js';
import { fortis } from '../adapters/fortis/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { badRequest, notFound, unprocessable } from '../util/errors.js';
import { fortisLinksValue, linkToken, orderReference } from '../util/ids.js';
import { fromJson, toJson } from '../util/json.js';
import { toOrder } from './mappers.js';
import { merchantService } from './merchantService.js';
import { exceptionService } from './exceptionService.js';
import { settingsService } from './settingsService.js';

interface CreateContext {
  createdBy: string;
  method: OrderMethod;
  originLinkToken?: string;
  originLinkName?: string;
}

export const orderService = {
  async list(filters: { status?: string; merchantId?: number; search?: string } = {}): Promise<Order[]> {
    const rows = await prisma.order.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.merchantId ? { merchantId: filters.merchantId } : {}),
        ...(filters.search
          ? { OR: [{ reference: { contains: filters.search } }, { merchantDba: { contains: filters.search } }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return rows.map(toOrder);
  },

  async get(id: number, opts: { refresh?: boolean } = {}): Promise<Order> {
    const row = await prisma.order.findUnique({ where: { id } });
    if (!row) throw notFound('Order not found');
    // In live mode, reconcile status/packages/serials from POS Portal (polling — works
    // without webhooks). When POS Portal has shipped and assigned serials, this also runs the
    // shipment pipeline (deployed equipment + Fortis Gateway activation).
    if (opts.refresh && config.POSP_MODE === 'live' && row.pospOrderId) {
      const remote = await posPortal().getOrder(row.pospOrderId).catch(() => null);
      if (remote) {
        const canonical = canonicalOrderStatus(remote.status);
        const localSerials = fromJson<string[]>(row.serialNumbersJson, []);
        const shipped = ([OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.RESHIPPED] as string[]).includes(canonical);
        const packages = await posPortal().getOrderPackages(row.pospOrderId).catch(() => []);
        if (shipped && localSerials.length === 0) {
          const items = await posPortal().getOrderItems(row.pospOrderId).catch(() => []);
          const serials = items.flatMap((i) => i.serialNumbers ?? []).filter(Boolean) as string[];
          if (serials.length) {
            const pkg = packages[0];
            return this.processShipment(id, {
              trackingNumber: String(pkg?.trackingNumber ?? `POSP-${row.pospOrderId}`),
              carrier: String(pkg?.carrier ?? 'UPS'),
              serialNumbers: serials,
            });
          }
        }
        const updated = await prisma.order.update({
          where: { id },
          data: { status: canonical, cancellable: remote.cancellable, packagesJson: packages.length ? toJson(packages) : row.packagesJson },
        });
        return toOrder(updated);
      }
    }
    return toOrder(row);
  },

  /** Get-or-create a stable, unguessable public tracking token for an order. */
  async ensureShareToken(id: number): Promise<string> {
    const row = await prisma.order.findUnique({ where: { id } });
    if (!row) throw notFound('Order not found');
    if (row.shareToken) return row.shareToken;
    const token = linkToken();
    await prisma.order.update({ where: { id }, data: { shareToken: token } });
    return token;
  },

  /**
   * Sanitized order summary for a public tracking link. Deliberately excludes ALL sensitive
   * merchant data (MID, DBA, address, phone, email) — only fulfillment progress is exposed.
   */
  async publicTrack(token: string): Promise<{
    reference?: string;
    status: string;
    placedAt: string;
    shippingMethodLabel?: string;
    items: Array<{ name: string; quantity: number }>;
    serials: string[];
    packages: Array<{ carrier?: string; trackingNumber?: string; status?: string; shippedAt?: string; deliveredAt?: string }>;
  }> {
    const row = await prisma.order.findUnique({ where: { shareToken: token } });
    if (!row) throw notFound('Tracking link not found');
    const lines = fromJson<Array<{ name: string; quantity: number }>>(row.linesJson, []);
    const serials = fromJson<string[]>(row.serialNumbersJson, []);
    const packages = fromJson<Array<{ carrier?: string; trackingNumber?: string; status?: string; shippedAt?: string; deliveredAt?: string }>>(row.packagesJson, []);
    return {
      reference: row.reference ?? undefined,
      status: row.status,
      placedAt: row.createdAt.toISOString(),
      shippingMethodLabel: row.shippingMethodLabel ?? undefined,
      items: lines.map((l) => ({ name: l.name, quantity: l.quantity })),
      serials: serials.map((s) => fortisLinksValue(s)),
      packages: packages.map((p) => ({ carrier: p.carrier, trackingNumber: p.trackingNumber, status: p.status, shippedAt: p.shippedAt, deliveredAt: p.deliveredAt })),
    };
  },

  async create(input: CreateOrderInput, ctx: CreateContext): Promise<Order> {
    // 1. Validate the shipping address (required).
    const validation = await posPortal().validateAddress(input.shippingAddress);
    if (!validation.valid) {
      throw unprocessable('Shipping address failed validation', { shippingAddress: validation.messages });
    }
    const shippingAddress = validation.normalized ?? input.shippingAddress;

    // 2. Resolve the merchant.
    const merchant = input.merchantId
      ? await merchantService.get(input.merchantId)
      : await merchantService.resolveOrCreate(input.merchant!);

    // 3. Build order lines from the cart against known bundles.
    const bundleRows = await prisma.bundle.findMany({
      where: { pospBundleId: { in: input.cart.map((c) => c.pospBundleId) } },
    });
    const byId = new Map(bundleRows.map((b) => [b.pospBundleId, b]));
    const lines = input.cart.map((c) => {
      const b = byId.get(c.pospBundleId);
      if (!b) throw badRequest(`Unknown bundle ${c.pospBundleId}`);
      return {
        pospBundleId: c.pospBundleId,
        name: b.displayName,
        quantity: c.quantity,
        unitPrice: b.accountingUnitPrice ?? undefined,
        priceExceptionId: undefined as number | undefined,
      };
    });

    // 3b. Expand each bundle into its POS Portal component products (real order line items).
    const productLines: Array<{ productId: number; quantity: number }> = [];
    for (const c of input.cart) {
      const b = byId.get(c.pospBundleId);
      const bundleItems = fromJson<Array<{ sku?: string; quantity?: number }>>(b?.itemsJson ?? '[]', []);
      for (const it of bundleItems) {
        const pid = Number(it.sku);
        if (Number.isFinite(pid) && pid > 0) productLines.push({ productId: pid, quantity: (it.quantity || 1) * c.quantity });
      }
    }

    // 4. Apply an approved price exception (free/discounted device) if attached.
    if (input.priceExceptionId) {
      const ex = await exceptionService.assertApproved(input.priceExceptionId, ExceptionType.PRICE_EXCEPTION);
      const target = ex.bundlePospId ? lines.find((l) => l.pospBundleId === ex.bundlePospId) : lines[0];
      if (target) {
        target.unitPrice = ex.requestedPrice ?? 0;
        target.priceExceptionId = ex.id;
      }
    }

    // 5. Resolve shipping method label from a quote.
    let shippingMethodLabel: string | undefined;
    if (input.shippingMethodId) {
      const totalQty = input.cart.reduce((s, l) => s + (l.quantity || 0), 0);
      const m = (await settingsService.methodsFor(totalQty)).find((q) => q.id === input.shippingMethodId);
      shippingMethodLabel = m ? `${m.name} ($${m.rate})` : undefined;
    }

    // 6. Create the order in POS Portal (DRAFT -> submitted), then persist locally.
    const reference = orderReference();
    // Attempt to submit to POS Portal. The exact create-order payload schema is still being
    // finalized against the authed spec (DESIGN.md §5); if the live call fails we persist the
    // order locally so the flow completes, and flag it for later reconciliation.
    let posp: { id?: number; reference?: string; status: string; cancellable: boolean };
    let syncStatus = 'synced';
    let syncError: string | undefined;
    try {
      posp = await posPortal().createOrder({
        merchantId: merchant.pospMerchantId ?? merchant.id,
        mid: input.mid,
        phone: merchant.phone,
        email: merchant.email,
        merchantName: merchant.dbaName,
        shippingAddress,
        shippingMethodId: input.shippingMethodId,
        classification: input.classification ?? OrderClassification.EQUIPMENT_PURCHASE,
        lines: input.cart,
        productLines,
        reference,
      });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { informationMessages?: Array<{ message?: string }> } } }).response?.data?.informationMessages?.[0]?.message ??
        (err as Error).message;
      logger.warn({ err: msg }, 'live POS Portal order create failed');
      if (config.POSP_STRICT_WRITES) throw err;
      posp = { id: undefined, reference, status: 'DRAFT', cancellable: true };
      syncStatus = 'local';
      syncError = msg;
    }

    const row = await prisma.order.create({
      data: {
        pospOrderId: posp.id,
        reference: posp.reference ?? reference,
        status: canonicalOrderStatus(posp.status),
        method: ctx.method,
        classification: (input.classification as string) ?? OrderClassification.EQUIPMENT_PURCHASE,
        cancellable: posp.cancellable,
        merchantId: merchant.id,
        merchantMid: input.mid,
        merchantDba: merchant.dbaName,
        shippingAddressJson: toJson(shippingAddress),
        linesJson: toJson(lines),
        shippingMethodLabel,
        createdBy: ctx.createdBy,
        originLinkToken: ctx.originLinkToken,
        originLinkName: ctx.originLinkName,
        syncStatus,
        syncError,
      },
    });
    return toOrder(row);
  },

  async cancel(id: number): Promise<Order> {
    const row = await prisma.order.findUnique({ where: { id } });
    if (!row) throw notFound('Order not found');
    if (!row.cancellable) throw badRequest('Order is no longer cancellable');
    if (row.pospOrderId) await posPortal().patchOrderStatus(row.pospOrderId, 'Cancelled').catch(() => null);
    const updated = await prisma.order.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED, cancellable: false },
    });
    return toOrder(updated);
  },

  /**
   * Shared fulfillment: attach tracking + serials, create deployed-equipment records, and
   * sync each serial to a Fortis terminal. Called by the dev mock-ship tool and by the
   * POS Portal shipment webhook.
   */
  async processShipment(
    orderId: number,
    shipment: { trackingNumber: string; carrier: string; serialNumbers: string[]; status?: string },
  ): Promise<Order> {
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    if (!row) throw notFound('Order not found');

    const firstLine = fromJson<Array<{ pospBundleId: number }>>(row.linesJson, [])[0];
    const bundle = firstLine
      ? await prisma.bundle.findUnique({ where: { pospBundleId: firstLine.pospBundleId } })
      : null;

    const pkg = {
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      status: PackageStatus.IN_TRANSIT,
      shippedAt: new Date().toISOString(),
    };

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        cancellable: false,
        packagesJson: toJson([pkg]),
        serialNumbersJson: toJson(shipment.serialNumbers),
      },
    });

    // Look up the merchant once for Fortis Gateway account matching.
    const merchant = await prisma.merchant.findUnique({ where: { id: row.merchantId } });

    // Create deployed-equipment + activate in Fortis Gateway per serial (idempotent by serial).
    for (const serial of shipment.serialNumbers) {
      const already = await prisma.deployedEquipment.findFirst({ where: { serialNumber: serial } });
      if (already) continue;
      // Use the merchant's linked Fortis location (set via Admin → Fortis Gateway), else the
      // configured default location. Fortis has no MID field, so the link is explicit.
      const sync = await fortis().activateDevice({
        serialNumber: serial,
        locationId: merchant?.fortisLocationId ?? undefined,
        title: `${row.merchantDba ?? merchant?.dbaName ?? 'Merchant'} ${fortisLinksValue(serial)}`,
      });
      await prisma.deployedEquipment.create({
        data: {
          serialNumber: serial,
          productName: bundle?.displayName,
          model: bundle?.accountingDeviceModel,
          merchantId: row.merchantId,
          mid: row.merchantMid,
          orderId,
          status: DeployedStatus.ACTIVE,
          deployedAt: new Date(),
          fortisTerminalId: sync.terminalId,
          fortisAccountId: sync.accountId,
          fortisActivated: sync.activated,
          application: bundle?.application,
          encryption: bundle?.encryption,
        },
      });
      await prisma.fortisTerminalSync.create({
        data: {
          orderId,
          serialNumber: serial,
          linksValue: sync.linksValue,
          terminalId: sync.terminalId,
          accountId: sync.accountId,
          activated: sync.activated,
          status: sync.status,
          error: sync.error,
        },
      });
    }

    return this.get(orderId);
  },

  /** Dev/mock only: simulate a shipment for an order. */
  async simulateShip(id: number, serialNumbers?: string[]): Promise<Order> {
    const row = await prisma.order.findUnique({ where: { id } });
    if (!row) throw notFound('Order not found');
    const adapter = posPortal();
    let shipment: { trackingNumber: string; carrier: string; serialNumbers: string[] } | null = null;
    if (adapter.mockShip && row.pospOrderId) {
      shipment = await adapter.mockShip(row.pospOrderId, serialNumbers);
    }
    if (!shipment) {
      // Fallback: fabricate a shipment even without an adapter round-trip.
      const qty = fromJson<Array<{ quantity: number }>>(row.linesJson, []).reduce((s, l) => s + (l.quantity || 0), 0) || 1;
      const now = new Date();
      shipment = {
        trackingNumber: `1ZDE${row.pospOrderId ?? id}`,
        carrier: 'UPS',
        serialNumbers: (serialNumbers?.length ? serialNumbers : Array.from({ length: qty }, (_, i) => `SN-${now.getFullYear()}-${id}-${i + 1}`)),
      };
    }
    return this.processShipment(id, shipment);
  },

  /** Advance a shipped order to delivered (dev tool + webhook Delivery Confirmed). */
  async markDelivered(id: number, signedBy?: string): Promise<Order> {
    const row = await prisma.order.findUnique({ where: { id } });
    if (!row) throw notFound('Order not found');
    const packages = fromJson<Array<Record<string, unknown>>>(row.packagesJson, []);
    const updatedPackages = packages.length
      ? packages.map((p) => ({ ...p, status: PackageStatus.DELIVERED, deliveredAt: new Date().toISOString(), signedBy }))
      : [{ status: PackageStatus.DELIVERED, deliveredAt: new Date().toISOString(), signedBy }];
    const updated = await prisma.order.update({
      where: { id },
      data: { status: OrderStatus.DELIVERED, packagesJson: toJson(updatedPackages) },
    });
    return toOrder(updated);
  },
};
