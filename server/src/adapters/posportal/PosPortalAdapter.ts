import type { AddressValidationResult, ShippingMethod } from '@de/shared';

/**
 * The POS Portal boundary. All business logic depends on THIS interface, never on the
 * concrete HTTP client or the mock. Swap `MockPosPortalAdapter` for `LivePosPortalAdapter`
 * via POSP_MODE with zero changes upstream.
 *
 * Return shapes mirror what POS Portal gives us; services normalize into the canonical
 * domain model. Fields marked with the raw POS Portal names are inferred where the authed
 * Swagger schema was unavailable — see DESIGN.md §5.
 */

export interface PospMerchant {
  id: number;
  mid?: string;
  dbaName?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  primaryContact?: string;
  shippingAddress?: unknown;
}

export interface PospBundleHeader {
  id: number;
  name: string;
  enabled: boolean;
  modifiable?: boolean;
}

export interface PospBundleItem {
  sku: string;
  name: string;
  quantity: number;
}

export interface PospBundleDetail extends PospBundleHeader {
  description?: string;
  items: PospBundleItem[];
}

export interface PospOrderResult {
  id: number; // POS Portal order id
  reference?: string;
  status: string; // POS Portal status vocabulary
  cancellable: boolean;
}

export interface PospPackage {
  carrier?: string;
  trackingNumber?: string;
  status?: string;
  shippedAt?: string;
  deliveredAt?: string;
  signedBy?: string;
}

export interface PospDeployedItem {
  id: number;
  serialNumber: string;
  productName?: string;
  model?: string;
}

export interface PospReturnReason {
  id: number;
  description: string;
}

export interface PospReturnResult {
  callTagId?: number;
  status: string;
}

export interface RawConsignedItem {
  product: {
    id: string | number;
    modelNumber?: string;
    name?: string;
    category?: string;
    subcategory?: string;
  };
  totalOnHand?: number;
  totalP2peOnHand?: number;
  locations?: Array<{ category?: string; onHand?: number }>;
}

export interface CreateOrderPayload {
  merchantId: number;
  mid?: string;
  phone?: string;
  email?: string;
  merchantName?: string;
  shippingAddress: unknown;
  shippingMethodId?: number;
  classification?: string;
  lines: Array<{ pospBundleId: number; quantity: number }>;
  /** Bundles expanded into POS Portal product line items (real order items). */
  productLines?: Array<{ productId: number; quantity: number }>;
  reference?: string;
}

export interface PospConnectionResult {
  ok: boolean;
  detail: string;
  status?: number;
}

export interface PosPortalAdapter {
  readonly mode: 'mock' | 'live';

  /** Cheap live reachability check — feeds the admin System Status page. */
  testConnection(): Promise<PospConnectionResult>;

  // Merchants
  searchMerchantByMid(mid: string): Promise<PospMerchant | null>;
  createMerchant(input: Partial<PospMerchant>): Promise<PospMerchant>;

  // Bundles / products
  listBundles(params?: { tagId?: number }): Promise<PospBundleHeader[]>;
  getBundle(id: number): Promise<PospBundleDetail | null>;

  // Shipping & address
  validateAddress(address: unknown): Promise<AddressValidationResult>;
  getShippingQuote(input: { address: unknown; lines: Array<{ pospBundleId: number; quantity: number }> }): Promise<ShippingMethod[]>;

  // Orders
  createOrder(payload: CreateOrderPayload): Promise<PospOrderResult>;
  getOrder(pospOrderId: number): Promise<PospOrderResult | null>;
  patchOrderStatus(pospOrderId: number, status: string): Promise<PospOrderResult | null>;
  getOrderPackages(pospOrderId: number): Promise<PospPackage[]>;
  getOrderItems(pospOrderId: number): Promise<Array<{ product?: { id: number; name?: string; modelNumber?: string }; quantity: number; serialNumbers?: string[] }>>;
  getDeployedEquipmentByOrder(pospOrderId: number): Promise<PospDeployedItem[]>;

  // Returns
  getReturnReasons(type: string): Promise<PospReturnReason[]>;
  createReturn(entityType: 'order' | 'merchant', entityId: number, payload: unknown): Promise<PospReturnResult>;

  // Inventory
  getConsignedInventory(): Promise<RawConsignedItem[]>;

  /** Mock-only: simulate a shipment (assign tracking + serials). No-op/throws in live mode. */
  mockShip?(pospOrderId: number, serialNumbers?: string[]): Promise<{ trackingNumber: string; carrier: string; serialNumbers: string[] } | null>;
}
