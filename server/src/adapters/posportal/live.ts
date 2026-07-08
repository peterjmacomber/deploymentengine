import axios, { type AxiosInstance } from 'axios';
import type { AddressValidationResult, ShippingMethod } from '@de/shared';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
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

/** Unwrap POS Portal's varying envelope shapes into an array. */
function unwrapList<T = unknown>(payload: unknown): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as T[];
  const p = payload as Record<string, unknown>;
  for (const key of ['result', 'items', 'data']) {
    if (Array.isArray(p[key])) return p[key] as T[];
  }
  return [payload as T];
}
function unwrapOne<T = unknown>(payload: unknown): T | null {
  const list = unwrapList<T>(payload);
  return list[0] ?? null;
}

/**
 * Real POS Portal client. OAuth2 client-credentials via Azure AD, tokens cached until
 * expiry. Endpoint paths reflect the confirmed v2 surface; a few are marked inferred in
 * DESIGN.md §5 and will be finalized against the authed Swagger. Response normalization is
 * defensive so envelope variations don't break callers.
 */
export class LivePosPortalAdapter implements PosPortalAdapter {
  readonly mode = 'live' as const;
  private http: AxiosInstance;
  private token: { value: string; expiresAt: number } | null = null;

  constructor() {
    this.http = axios.create({ baseURL: config.POSP_BASE_URL, timeout: 30_000 });
    this.http.interceptors.request.use(async (req) => {
      const token = await this.getToken();
      req.headers.Authorization = `Bearer ${token}`;
      return req;
    });
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) return this.token.value;
    const form = new URLSearchParams();
    form.set('client_id', config.POSP_CLIENT_ID!);
    form.set('client_secret', config.POSP_CLIENT_SECRET!);
    form.set('scope', config.POSP_SCOPE!);
    form.set('grant_type', 'client_credentials');
    const res = await axios.post(config.POSP_TOKEN_URL!, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20_000,
    });
    const { access_token, expires_in } = res.data;
    if (!access_token) throw new Error('POS Portal token response missing access_token');
    this.token = { value: access_token, expiresAt: now + (expires_in ?? 3600) * 1000 };
    return access_token;
  }

  async searchMerchantByMid(mid: string): Promise<PospMerchant | null> {
    const res = await this.http.get('/merchants', { params: { mid } });
    return unwrapOne<PospMerchant>(res.data);
  }

  async createMerchant(input: Partial<PospMerchant>): Promise<PospMerchant> {
    // Proven payload: dbaName + primaryContact + phone + email + shippingAddress.
    const body = {
      dbaName: input.dbaName,
      primaryContact: input.primaryContact || input.dbaName,
      phone: input.phone,
      email: input.email || '',
      shippingAddress: input.shippingAddress,
    };
    const res = await this.http.post('/merchants', body);
    return unwrapOne<PospMerchant>(res.data) ?? (res.data as PospMerchant);
  }

  async listBundles(params: { tagId?: number } = {}): Promise<PospBundleHeader[]> {
    const res = await this.http.get('/bundles', { params });
    return unwrapList<PospBundleHeader>(res.data);
  }

  async getBundle(id: number): Promise<PospBundleDetail | null> {
    const res = await this.http.get(`/bundles/${id}`, { params: { select: 'items,#bundleAdditional' } });
    return unwrapOne<PospBundleDetail>(res.data);
  }

  async validateAddress(address: unknown): Promise<AddressValidationResult> {
    // Real shape: { result: [ { line1, city, region, postalCode, country, valid, suggested: [ {...} ] } ] }
    const res = await this.http.post('/shipping/address', address);
    const row = unwrapOne<Record<string, unknown>>(res.data) ?? {};
    const valid = Boolean(row.valid);
    const suggested = (row.suggested as AddressValidationResult['candidates']) ?? undefined;
    const normalized = valid ? (suggested?.[0] ?? (row as unknown as AddressValidationResult['normalized'])) : undefined;
    return {
      valid,
      normalized,
      candidates: suggested,
      messages: valid ? ['Address validated.'] : ['Address could not be validated; check the fields.'],
    };
  }

  async getShippingQuote(input: { address: unknown; lines: Array<{ pospBundleId: number; quantity: number }> }): Promise<ShippingMethod[]> {
    const res = await this.http.post('/shipping/quote', input);
    return unwrapList<Record<string, unknown>>(res.data).map((m, i) => ({
      id: Number(m.shipping_method_id ?? m.id ?? i + 1),
      name: String(m.name ?? 'Shipping'),
      rate: Number(m.rate ?? m.cost ?? 0),
      estimatedDays: m.estimatedDays ? Number(m.estimatedDays) : undefined,
      carrier: m.carrier ? String(m.carrier) : undefined,
    }));
  }

  async createOrder(payload: CreateOrderPayload): Promise<PospOrderResult> {
    // Proven POS Portal order shape (reverse-engineered from the sandbox). Payment is sent
    // only when configured; otherwise POS Portal uses the merchant's billing terms.
    const addr = (payload.shippingAddress ?? {}) as Record<string, unknown>;
    const body: Record<string, unknown> = {
      merchantId: payload.merchantId,
      classification: payload.classification ?? 'EQUIPMENT_PURCHASE',
      status: 'DRAFT',
      shipping: {
        carrier: config.POSP_DEFAULT_CARRIER,
        serviceLevel: 'GROUND',
        shipMethId: config.POSP_DEFAULT_SHIP_METHOD_ID,
        address: {
          line1: addr.line1 ?? '',
          line2: addr.line2 ?? '',
          city: addr.city ?? '',
          region: addr.region ?? '',
          postalCode: addr.postalCode ?? '',
          country: addr.country ?? 'US',
          careOf: '',
          merchantName: addr.merchantName ?? payload.merchantName ?? payload.mid ?? 'Merchant',
          phone: payload.phone || (addr.phone as string) || '0000000000',
          email: payload.email || (addr.email as string) || '',
        },
      },
      // Bill the client (Fortis) — Fortis bills the merchant separately. Uses Fortis's
      // contract terms, so no per-merchant payment method is required.
      whoPaysPos: config.POSP_ORDER_WHO_PAYS,
      billTo: config.POSP_ORDER_BILL_TO,
      items: (payload.productLines?.length ? payload.productLines : payload.lines.map((l) => ({ productId: l.pospBundleId, quantity: l.quantity }))).map(
        (l) => ({ product: { id: l.productId }, quantity: l.quantity }),
      ),
    };
    // Only attach a payment method if explicitly configured; otherwise rely on client terms.
    if (config.POSP_ORDER_PAYMENT_TYPE) {
      body.payment = { type: config.POSP_ORDER_PAYMENT_TYPE, ...(config.POSP_ORDER_PAYMENT_ID ? { id: config.POSP_ORDER_PAYMENT_ID } : {}) };
    }
    const res = await this.http.post('/orders', body);
    let o = unwrapOne<PospOrderResult>(res.data) ?? (res.data as PospOrderResult);

    // Finalize the DRAFT into an OPEN (submitted) order so it enters fulfillment.
    if (config.POSP_SUBMIT_ORDERS && o?.id) {
      const patched = await this.http.patch(`/orders/${o.id}`, { status: 'OPEN' }).catch(() => null);
      const p = patched ? unwrapOne<PospOrderResult>(patched.data) : null;
      if (p) o = p;
    }
    return { id: Number(o.id), reference: o.reference, status: String(o.status ?? 'OPEN'), cancellable: Boolean(o.cancellable ?? true) };
  }

  async getOrder(pospOrderId: number): Promise<PospOrderResult | null> {
    const res = await this.http.get(`/orders/${pospOrderId}`);
    const o = unwrapOne<PospOrderResult>(res.data);
    return o ? { id: Number(o.id), reference: o.reference, status: String(o.status), cancellable: Boolean(o.cancellable) } : null;
  }

  async patchOrderStatus(pospOrderId: number, status: string): Promise<PospOrderResult | null> {
    const res = await this.http.patch(`/orders/${pospOrderId}`, { status });
    return unwrapOne<PospOrderResult>(res.data);
  }

  async getOrderPackages(pospOrderId: number): Promise<PospPackage[]> {
    const res = await this.http.get(`/orders/${pospOrderId}/packages`).catch(() => ({ data: [] }));
    return unwrapList<PospPackage>(res.data);
  }

  async getOrderItems(pospOrderId: number) {
    const res = await this.http.get(`/orders/${pospOrderId}/items`).catch(() => ({ data: [] }));
    const raw = unwrapList<{ product?: { id: number; name?: string; modelNumber?: string }; quantity: number; serialNumbers?: string[]; childItems?: unknown[] }>(res.data);
    // Serials on bundle lines live on their childItems (the actual devices) — flatten them up so
    // callers (order refresh, shipment poller) see the serials at the line level.
    const flatten = (node: { serialNumbers?: string[]; childItems?: unknown[] }): string[] => [
      ...((node.serialNumbers ?? []) as string[]),
      ...(((node.childItems ?? []) as Array<{ serialNumbers?: string[]; childItems?: unknown[] }>).flatMap(flatten)),
    ].filter(Boolean);
    return raw.map((it) => ({ product: it.product, quantity: it.quantity, serialNumbers: flatten(it) }));
  }

  async getDeployedEquipmentByOrder(pospOrderId: number): Promise<PospDeployedItem[]> {
    const res = await this.http.get('/deployedequipment', { params: { orderId: pospOrderId } }).catch(() => ({ data: [] }));
    return unwrapList<PospDeployedItem>(res.data);
  }

  async getReturnReasons(type: string): Promise<PospReturnReason[]> {
    const res = await this.http.get(`/returns/reasons/${type}`).catch(() => ({ data: [] }));
    return unwrapList<PospReturnReason>(res.data);
  }

  async createReturn(entityType: 'order' | 'merchant', entityId: number, payload: unknown): Promise<PospReturnResult> {
    const body = { issuedBy: config.POSP_RETURN_ISSUED_BY, ...(payload as Record<string, unknown>) };
    const res = await this.http.post(`/returns/${entityType}/${entityId}`, body);
    const r = unwrapOne<PospReturnResult>(res.data) ?? (res.data as PospReturnResult);
    return { callTagId: r.callTagId, status: String(r.status ?? 'OPEN') };
  }

  async getConsignedInventory(): Promise<RawConsignedItem[]> {
    const res = await this.http.get('/inventory/consigned');
    return unwrapList<RawConsignedItem>(res.data);
  }

  async mockShip(): Promise<null> {
    logger.warn('mockShip called in live mode — real shipments arrive via webhook');
    return null;
  }
}
