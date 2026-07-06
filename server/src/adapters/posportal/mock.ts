import type { AddressValidationResult, ShippingMethod } from '@de/shared';
import { mockSerial } from '../../util/ids.js';
import {
  MOCK_BUNDLES,
  MOCK_CONSIGNED,
  MOCK_MERCHANTS,
  MOCK_SHIPPING_METHODS,
} from './mockData.js';
import type {
  CreateOrderPayload,
  PosPortalAdapter,
  PospBundleDetail,
  PospBundleHeader,
  PospDeployedItem,
  PospMerchant,
  PospOrderResult,
  PospPackage,
  PospReturnReason,
  PospReturnResult,
  RawConsignedItem,
} from './PosPortalAdapter.js';

interface StoredOrder {
  id: number;
  reference?: string;
  status: string;
  cancellable: boolean;
  payload: CreateOrderPayload;
  packages: PospPackage[];
  deployed: PospDeployedItem[];
}

/**
 * In-process POS Portal simulator. Deterministic enough to demo end-to-end. Data resets on
 * restart (fine for a prototype; production uses the DB + live adapter).
 */
export class MockPosPortalAdapter implements PosPortalAdapter {
  readonly mode = 'mock' as const;

  private merchants = new Map<string, PospMerchant>();
  private orders = new Map<number, StoredOrder>();
  private nextMerchantId = 20000;
  private nextOrderId = 900000;
  private nextDeployedId = 500000;

  constructor() {
    for (const m of MOCK_MERCHANTS) {
      if (m.mid) this.merchants.set(m.mid, { id: m.id, mid: m.mid, dbaName: m.dbaName, legalName: m.legalName, email: m.email, phone: m.phone });
    }
  }

  async searchMerchantByMid(mid: string): Promise<PospMerchant | null> {
    return this.merchants.get(mid) ?? null;
  }

  async createMerchant(input: Partial<PospMerchant>): Promise<PospMerchant> {
    if (input.mid && this.merchants.has(input.mid)) return this.merchants.get(input.mid)!;
    const merchant: PospMerchant = {
      id: this.nextMerchantId++,
      mid: input.mid,
      dbaName: input.dbaName,
      legalName: input.legalName,
      email: input.email,
      phone: input.phone,
    };
    if (input.mid) this.merchants.set(input.mid, merchant);
    return merchant;
  }

  async listBundles(): Promise<PospBundleHeader[]> {
    return MOCK_BUNDLES.map((b) => ({ id: b.pospBundleId, name: b.name, enabled: b.active, modifiable: false }));
  }

  async getBundle(id: number): Promise<PospBundleDetail | null> {
    const b = MOCK_BUNDLES.find((x) => x.pospBundleId === id);
    if (!b) return null;
    return { id: b.pospBundleId, name: b.name, enabled: b.active, modifiable: false, description: b.description, items: b.items };
  }

  async validateAddress(addressRaw: unknown): Promise<AddressValidationResult> {
    const a = (addressRaw ?? {}) as Record<string, string>;
    const messages: string[] = [];
    const region = (a.region ?? '').toUpperCase().trim();
    const postal = (a.postalCode ?? '').trim();
    const country = (a.country ?? 'US').toUpperCase();

    if (!a.line1) messages.push('Missing street address (line1).');
    if (!a.city) messages.push('Missing city.');
    if (!region) messages.push('Missing state/region.');
    const usZip = /^\d{5}(-\d{4})?$/.test(postal);
    if (country === 'US' && !usZip) messages.push('Postal code is not a valid US ZIP.');

    const valid = messages.length === 0;
    const normalized = {
      merchantName: a.merchantName,
      line1: (a.line1 ?? '').trim(),
      line2: a.line2?.trim(),
      city: (a.city ?? '').trim(),
      region,
      postalCode: postal,
      country,
    };
    return {
      valid,
      normalized: valid ? normalized : undefined,
      candidates: valid ? undefined : [normalized],
      messages: valid ? ['Address validated.'] : messages,
    };
  }

  async getShippingQuote(): Promise<ShippingMethod[]> {
    return MOCK_SHIPPING_METHODS.map((m) => ({ ...m }));
  }

  async createOrder(payload: CreateOrderPayload): Promise<PospOrderResult> {
    const id = this.nextOrderId++;
    const stored: StoredOrder = {
      id,
      reference: payload.reference ?? `MOCK-${id}`,
      status: 'Submitted',
      cancellable: true,
      payload,
      packages: [],
      deployed: [],
    };
    this.orders.set(id, stored);
    return { id, reference: stored.reference, status: stored.status, cancellable: stored.cancellable };
  }

  async getOrder(pospOrderId: number): Promise<PospOrderResult | null> {
    const o = this.orders.get(pospOrderId);
    return o ? { id: o.id, reference: o.reference, status: o.status, cancellable: o.cancellable } : null;
  }

  async patchOrderStatus(pospOrderId: number, status: string): Promise<PospOrderResult | null> {
    const o = this.orders.get(pospOrderId);
    if (!o) return null;
    o.status = status;
    o.cancellable = status === 'Submitted' || status === 'Processing';
    return { id: o.id, reference: o.reference, status: o.status, cancellable: o.cancellable };
  }

  async getOrderPackages(pospOrderId: number): Promise<PospPackage[]> {
    return this.orders.get(pospOrderId)?.packages ?? [];
  }

  async getOrderItems() {
    return [] as Array<{ product?: { id: number; name?: string; modelNumber?: string }; quantity: number; serialNumbers?: string[] }>;
  }

  async getDeployedEquipmentByOrder(pospOrderId: number): Promise<PospDeployedItem[]> {
    return this.orders.get(pospOrderId)?.deployed ?? [];
  }

  async getReturnReasons(_type: string): Promise<PospReturnReason[]> {
    // POS Portal's reason table is AM-gated; expose a representative set for the demo.
    return [
      { id: 1, description: 'Defective / warranty' },
      { id: 2, description: 'Configuration issue' },
      { id: 3, description: 'Wrong device' },
      { id: 4, description: 'Merchant no longer needs' },
      { id: 5, description: 'Courtesy / no charge' },
    ];
  }

  async createReturn(_entityType: 'order' | 'merchant', entityId: number): Promise<PospReturnResult> {
    return { callTagId: 700000 + (entityId % 100000), status: 'OPEN' };
  }

  async getConsignedInventory(): Promise<RawConsignedItem[]> {
    return MOCK_CONSIGNED.map((x) => ({ ...x, product: { ...x.product }, locations: x.locations?.map((l) => ({ ...l })) }));
  }

  async mockShip(pospOrderId: number, serialNumbers?: string[]) {
    const o = this.orders.get(pospOrderId);
    if (!o) return null;
    const qty = o.payload.lines.reduce((s, l) => s + (l.quantity || 0), 0) || 1;
    const now = new Date();
    const serials = serialNumbers?.length ? serialNumbers : Array.from({ length: qty }, (_, i) => mockSerial(pospOrderId, i, now));
    o.status = 'Shipped';
    o.cancellable = false;
    const trackingNumber = `1ZDE${pospOrderId}`;
    o.packages = [{ carrier: 'UPS', trackingNumber, status: 'IN_TRANSIT', shippedAt: now.toISOString() }];
    o.deployed = serials.map((sn) => ({ id: this.nextDeployedId++, serialNumber: sn }));
    return { trackingNumber, carrier: 'UPS', serialNumbers: serials };
  }
}
