/**
 * Canonical domain model. These are the shapes the API returns and the UI consumes.
 * Adapters translate POS Portal / Fortis payloads into these.
 */
import type {
  AlertLevel,
  BundleApplication,
  CallTagStatus,
  DeployedStatus,
  EncryptionType,
  ExceptionStatus,
  ExceptionType,
  InventoryCondition,
  OrderClassification,
  OrderMethod,
  OrderStatus,
  PackageStatus,
  ProcessorPlatform,
  ReturnLifecycle,
  ReturnReasonCode,
  ReturnType,
  Role,
} from './enums.js';

export interface Address {
  merchantName?: string;
  line1: string;
  line2?: string;
  city: string;
  region: string; // state / province
  postalCode: string;
  country: string; // ISO-2, default US
}

export interface AddressValidationResult {
  valid: boolean;
  normalized?: Address;
  candidates?: Address[];
  messages: string[];
}

export interface Merchant {
  id: number;
  pospMerchantId?: number;
  mid?: string;
  dbaName?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  primaryContact?: string;
  merchantType?: string; // POS Portal "type" (e.g. CLIENT)
  taxExempt?: boolean;
  supplyClub?: boolean;
  lastUpdatedAt?: string; // POS Portal lastUpdatedDate
  shippingAddress?: Address;
  createdAt?: string;
}

export interface BundleItem {
  sku: string;
  name: string;
  quantity: number;
  kind: 'device' | 'accessory' | 'paper' | 'other';
}

/** A bundle = POS Portal bundle (device+accessories+paper) + local config overlay. */
export interface Bundle {
  pospBundleId: number;
  displayName: string;
  description?: string;
  active: boolean; // controls storefront/embed visibility
  items: BundleItem[];
  // Pre-configuration (the "closed gap" — app/encryption/processor per bundle)
  application?: BundleApplication;
  encryption?: EncryptionType;
  processorPlatform?: ProcessorPlatform;
  // Real POS Portal configuration (source of truth, matches their site)
  pospApplication?: string;
  pospEncryption?: string;
  pospOsBuild?: string;
  // Accounting overlay
  distributor: string;
  accountingDeviceModel?: string;
  accountingUnitPrice?: number;
  /** Device manufacturer/brand (e.g. Dejavoo, PAX, Ingenico). Explicit override or derived. */
  brand?: string;
  // Fortis Gateway device IDs used when creating a terminal for this device (overrides env fallback).
  fortisManufacturerId?: string;
  fortisApplicationId?: string;
  fortisCvmId?: string;
  fortisPaymentPriority?: string;
  updatedAt?: string;
}

export interface OrderLine {
  pospBundleId: number;
  name: string;
  quantity: number;
  unitPrice?: number; // may be overridden by a PRICE_EXCEPTION
  priceExceptionId?: number;
}

export interface ShippingMethod {
  id: number;
  name: string;
  rate: number;
  estimatedDays?: number;
  carrier?: string;
}

export interface Package {
  carrier?: string;
  trackingNumber?: string;
  status?: PackageStatus;
  shippedAt?: string;
  deliveredAt?: string;
  signedBy?: string;
}

export interface Order {
  id: number; // internal id
  pospOrderId?: number;
  reference?: string;
  status: OrderStatus;
  method: OrderMethod;
  classification: OrderClassification;
  cancellable: boolean;
  merchant: Pick<Merchant, 'id' | 'mid' | 'dbaName'> & { shippingAddress?: Address };
  lines: OrderLine[];
  shippingMethodLabel?: string;
  shippingCarrier?: string;
  total?: number; // POS Portal totals.grandTotal
  shipDate?: string;
  packages: Package[];
  serialNumbers: string[];
  originalOrderId?: number; // links swaps/reships
  createdBy?: string;
  originLinkToken?: string; // deployment link this order came from
  originLinkName?: string;
  syncStatus?: string; // synced | local (sandbox submission state)
  syncError?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DeployedEquipment {
  id: number;
  serialNumber: string;
  productName?: string;
  model?: string;
  merchantId: number;
  mid?: string;
  orderId?: number;
  status: DeployedStatus;
  deployedAt?: string;
  fortisTerminalId?: string;
  fortisAccountId?: string;
  fortisActivated?: boolean;
  application?: BundleApplication;
  encryption?: EncryptionType;
}

export interface ReturnItem {
  deployedEquipmentId?: number;
  returnType: ReturnType;
  reasonCode: ReturnReasonCode;
  expectedProduct?: string;
  expectedSerialNumber?: string;
  receivedProduct?: string;
  receivedSerialNumber?: string;
  receivedAt?: string;
}

export interface ReturnCase {
  id: number;
  pospReturnId?: number; // POS Portal RMA id (imported returns)
  origin?: 'engine' | 'posportal';
  pospStatus?: string; // raw POS Portal RMA status (imported returns)
  callTagId?: number;
  entityType: 'order' | 'merchant';
  entityId: number;
  merchantId: number;
  mid?: string;
  merchantDba?: string;
  lifecycle: ReturnLifecycle;
  callTagStatus?: CallTagStatus;
  items: ReturnItem[];
  expectedItemCount: number;
  receivedItemCount: number;
  delinquent: boolean;
  replacementOrderId?: number;
  refundAmount?: number;
  exceptionId?: number; // if it needed a manager exception
  daysSinceDeployment?: number;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ExceptionRequest {
  id: number;
  type: ExceptionType;
  status: ExceptionStatus;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  // context
  merchantId?: number;
  orderId?: number;
  returnCaseId?: number;
  // price exception specifics
  bundlePospId?: number;
  originalPrice?: number;
  requestedPrice?: number;
  // swap specifics
  serialNumber?: string;
  daysSinceDeployment?: number;
  // resolution
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface InventoryItem {
  productId: string;
  modelNumber: string;
  partDesc: string;
  manufacturer: string;
  condition: InventoryCondition;
  isActiveCatalogItem: boolean;
  isNonSerialized: boolean;
  fgiQty: number;
  inRepairQty: number;
  coreQty: number;
  scrapQty: number;
  totalQty: number;
}

export interface MonthValue {
  month: string; // YYYY-MM
  qty: number;
}

/** A row in the editable device Unit Price List (UPL). One price per device model. */
export interface DevicePriceRow {
  id: number;
  keyword: string;
  model: string;
  price: number;
  bundleCount: number; // how many bundles map to this device
  examples: string[]; // a few bundle names using it
  updatedAt?: string;
}

export interface ForecastRow {
  partDesc: string;
  newPartId: string;
  mfgPartId: string;
  manufacturer: string;
  consignedOnHand: number; // OH Consigned — 0 means we buy direct from POS Portal inventory
  forecast12MoTotal: number;
  avgVelocity: number;
  coverageMonths: number;
  suggestedBuyQty: number;
  apiInventoryMatched: boolean;
  // Forecast Settings context + editable estimates (mirrors the POS Portal forecast workbook)
  past12Forecast?: number;
  past12Demand?: number; // actual sold over the past 12 months
  avgMonthly3?: number;
  avgMonthly6?: number;
  avgMonthly12?: number;
  demandHistory?: MonthValue[]; // past 12 months actual
  monthlyEstimates?: MonthValue[]; // forward 12 months (editable)
}

export interface InventoryAlert {
  level: AlertLevel;
  code: string;
  partDesc: string;
  message: string;
}

export interface DeploymentLink {
  id: number;
  token: string;
  type: 'order' | 'application';
  name: string;
  active: boolean;
  merchantId?: number;
  merchantMid?: string;
  merchantDba?: string;
  bundlePospIds: number[];
  pricingOverrides: Record<string, number>;
  shippingMethodId?: number;
  customFeeName?: string;
  customFeeAmount?: number;
  hasPassword: boolean;
  maxUses?: number;
  usesCount: number;
  expiresAt?: string;
  // analytics
  visits: number;
  orders: number;
  unitsVolume: number;
  revenue: number;
  lastUsedAt?: string;
  createdBy?: string;
  createdAt: string;
}

/** What a public visitor gets after resolving a link (no secrets). */
export interface PublicLinkConfig {
  token: string;
  type: 'order' | 'application';
  name: string;
  requiresApplicant: boolean; // application-type links collect merchant details
  merchant?: { dbaName?: string; mid?: string };
  bundles: Array<{
    pospBundleId: number;
    displayName: string;
    description?: string;
    items: BundleItem[];
    application?: string;
    price?: number;
  }>;
  shippingMethodId?: number;
  customFee?: { name: string; amount: number };
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string; // shown for identification; the full secret is only returned once at creation
  active: boolean;
  createdBy?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AuthenticatedPrincipal {
  kind: 'user' | 'partner' | 'apikey';
  id: number | string;
  email?: string;
  name?: string;
  role: Role;
  permissions: string[];
}

export interface AuditEntry {
  id: number;
  actor: string;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  method: string;
  path: string;
  ip?: string;
  statusCode?: number;
  metadata?: unknown;
  createdAt: string;
}

/** RFC-7807 problem+json error body. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}
