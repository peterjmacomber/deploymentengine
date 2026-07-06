/**
 * Canonical enums for the Deployment Engine.
 *
 * These are the system's OWN vocabulary. POS Portal / Fortis / the legacy storefront mock
 * each have their own strings; adapters map those onto these canonical values so business
 * logic and UI never depend on an upstream vocabulary that may change or is AM-gated.
 *
 * Declared as `as const` objects + derived union types so the same value works at runtime
 * (dropdowns, validation, seed data) and as a compile-time type.
 */

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------
export const Role = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  AGENT: 'agent',
  READONLY: 'readonly',
  /** External principal authenticated by API key (embed/partner plane). Not a login user. */
  PARTNER: 'partner',
  /** Internal integration key authenticated by X-API-Key on the main API. Not a login user. */
  APIKEY: 'apikey',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/**
 * Fine-grained permissions. Guards check permissions, not raw roles, so that (e.g.) only
 * managers can approve exceptions regardless of how roles evolve.
 */
export const Permission = {
  MERCHANT_READ: 'merchant:read',
  MERCHANT_WRITE: 'merchant:write',
  ORDER_READ: 'order:read',
  ORDER_WRITE: 'order:write',
  ORDER_CANCEL: 'order:cancel',
  SHIPPING_READ: 'shipping:read',
  RETURN_READ: 'return:read',
  RETURN_WRITE: 'return:write',
  DEPLOYED_READ: 'deployed:read',
  DEPLOYED_WRITE: 'deployed:write',
  INVENTORY_READ: 'inventory:read',
  FORECAST_READ: 'forecast:read',
  BUNDLE_READ: 'bundle:read',
  BUNDLE_WRITE: 'bundle:write', // admin: add/remove/edit bundles
  LINK_READ: 'link:read',
  LINK_WRITE: 'link:write', // create/manage deployment links (order + application landing pages)
  EXCEPTION_READ: 'exception:read',
  EXCEPTION_REQUEST: 'exception:request', // any agent may request
  EXCEPTION_APPROVE: 'exception:approve', // manager only
  USER_READ: 'user:read',
  USER_WRITE: 'user:write', // admin only
  AUDIT_READ: 'audit:read',
  APIKEY_MANAGE: 'apikey:manage', // admin only — create/revoke integration API keys
  DEV_TOOLS: 'dev:tools', // mock-ship etc.
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

// ---------------------------------------------------------------------------
// Orders & fulfillment
// ---------------------------------------------------------------------------
export const OrderStatus = {
  DRAFT: 'DRAFT', // being assembled, not yet submitted to POS Portal
  PLACED: 'PLACED', // submitted (POS Portal: Submitted)
  IN_PREP: 'IN_PREP', // POS Portal: Processing / ReadyForQA
  SHIPPED: 'SHIPPED', // POS Portal: Shipped (tracking assigned)
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED', // package Delivery Confirmed
  BACKORDERED: 'BACKORDERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
  RETURNED_HOLDING: 'RETURNED_HOLDING', // return pending reshipment
  RESHIPPED: 'RESHIPPED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** The ordered pizza-tracker stages (happy path). Exceptions render as a break in the track. */
export const TrackerStage = {
  PLACED: 'PLACED',
  IN_PREP: 'IN_PREP',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
} as const;
export type TrackerStage = (typeof TrackerStage)[keyof typeof TrackerStage];

export const TRACKER_ORDER: TrackerStage[] = [
  TrackerStage.PLACED,
  TrackerStage.IN_PREP,
  TrackerStage.SHIPPED,
  TrackerStage.OUT_FOR_DELIVERY,
  TrackerStage.DELIVERED,
];

export const PackageStatus = {
  LABEL_CREATED: 'LABEL_CREATED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  EXCEPTION: 'EXCEPTION',
  RETURN_TO_SENDER: 'RETURN_TO_SENDER',
} as const;
export type PackageStatus = (typeof PackageStatus)[keyof typeof PackageStatus];

export const OrderMethod = {
  DEPLOYMENT_ENGINE: 'DEPLOYMENT_ENGINE',
  PORTAL_ACCESS: 'PORTAL_ACCESS',
  EMBED_PARTNER: 'EMBED_PARTNER',
} as const;
export type OrderMethod = (typeof OrderMethod)[keyof typeof OrderMethod];

export const OrderClassification = {
  EQUIPMENT_PURCHASE: 'EQUIPMENT_PURCHASE',
  EQUIPMENT_CONSIGNED: 'EQUIPMENT_CONSIGNED',
  REPLACEMENT: 'REPLACEMENT',
  REPAIR: 'REPAIR',
  CALLTAG_ONLY: 'CALLTAG_ONLY',
} as const;
export type OrderClassification = (typeof OrderClassification)[keyof typeof OrderClassification];

// ---------------------------------------------------------------------------
// Returns / swaps / repairs
// ---------------------------------------------------------------------------
export const ReturnType = {
  RETURN: 'RETURN', // no replacement (refund / recover only)
  REPLACEMENT: 'REPLACEMENT', // swap: return + new unit shipped
  REPAIR: 'REPAIR', // unit repaired and returned (not a new unit)
} as const;
export type ReturnType = (typeof ReturnType)[keyof typeof ReturnType];

/** Business reason categories (operational taxonomy from Swap Insights). */
export const ReturnReasonCategory = {
  WARRANTY: 'WARRANTY',
  CONFIG: 'CONFIG', // encryption / processor / application / platform
  SALES_FIT: 'SALES_FIT', // wrong device (physical model differs)
  CONVERSION: 'CONVERSION', // merchant changed processors
  COURTESY: 'COURTESY', // no-charge goodwill
  RETURN_ONLY: 'RETURN_ONLY', // unwanted / discontinued / merchant error
  REPAIR: 'REPAIR',
  NEEDS_REVIEW: 'NEEDS_REVIEW', // root cause unknown -> manual review
} as const;
export type ReturnReasonCategory = (typeof ReturnReasonCategory)[keyof typeof ReturnReasonCategory];

export const ReturnReasonCode = {
  WARRANTY_DEFECT: 'WARRANTY_DEFECT',
  DAMAGED: 'DAMAGED',
  CONNECTIVITY: 'CONNECTIVITY',
  CONFIG_ENCRYPTION: 'CONFIG_ENCRYPTION',
  CONFIG_PROCESSOR: 'CONFIG_PROCESSOR',
  CONFIG_APPLICATION: 'CONFIG_APPLICATION',
  PLATFORM_UPGRADE: 'PLATFORM_UPGRADE',
  SALES_WRONG_DEVICE: 'SALES_WRONG_DEVICE',
  CONVERSION: 'CONVERSION',
  COURTESY_SWAP: 'COURTESY_SWAP',
  NO_CHARGE: 'NO_CHARGE',
  RETURN_UNWANTED: 'RETURN_UNWANTED',
  DISCONTINUED: 'DISCONTINUED',
  MERCHANT_ERROR: 'MERCHANT_ERROR',
  IN_WARRANTY_REPAIR: 'IN_WARRANTY_REPAIR',
  OUT_OF_WARRANTY_REPAIR: 'OUT_OF_WARRANTY_REPAIR',
  CLEANING_SERVICE: 'CLEANING_SERVICE',
  NEEDS_MANUAL_REVIEW: 'NEEDS_MANUAL_REVIEW',
} as const;
export type ReturnReasonCode = (typeof ReturnReasonCode)[keyof typeof ReturnReasonCode];

/** Metadata linking each reason code to its category + which return types it applies to. */
export interface ReasonMeta {
  code: ReturnReasonCode;
  label: string;
  category: ReturnReasonCategory;
  appliesTo: ReturnType[];
}

export const CallTagStatus = {
  OPEN: 'OPEN',
  ITEMS_RECEIVED: 'ITEMS_RECEIVED',
  CLOSED_BY_BILLING: 'CLOSED_BY_BILLING',
  DELINQUENT: 'DELINQUENT',
  CANCELLED: 'CANCELLED',
} as const;
export type CallTagStatus = (typeof CallTagStatus)[keyof typeof CallTagStatus];

/** Lifecycle of a swap/return case within the Deployment Engine. */
export const ReturnLifecycle = {
  INITIATED: 'INITIATED',
  PENDING_APPROVAL: 'PENDING_APPROVAL', // blocked on a manager exception
  APPROVED: 'APPROVED',
  CALLTAG_ISSUED: 'CALLTAG_ISSUED',
  REPLACEMENT_SHIPPED: 'REPLACEMENT_SHIPPED',
  ITEMS_RECEIVED: 'ITEMS_RECEIVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  DENIED: 'DENIED',
} as const;
export type ReturnLifecycle = (typeof ReturnLifecycle)[keyof typeof ReturnLifecycle];

// ---------------------------------------------------------------------------
// Manager exceptions
// ---------------------------------------------------------------------------
export const ExceptionType = {
  PRICE_EXCEPTION: 'PRICE_EXCEPTION', // free / discounted device
  SWAP_OUTSIDE_RETURN_WINDOW: 'SWAP_OUTSIDE_RETURN_WINDOW', // > 30 days
  SWAP_OUTSIDE_WARRANTY: 'SWAP_OUTSIDE_WARRANTY', // > 365 days
  DELINQUENCY_WAIVER: 'DELINQUENCY_WAIVER',
} as const;
export type ExceptionType = (typeof ExceptionType)[keyof typeof ExceptionType];

export const ExceptionStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
} as const;
export type ExceptionStatus = (typeof ExceptionStatus)[keyof typeof ExceptionStatus];

// ---------------------------------------------------------------------------
// Deployed equipment
// ---------------------------------------------------------------------------
export const DeployedStatus = {
  ACTIVE: 'ACTIVE',
  IN_REPAIR: 'IN_REPAIR',
  RETURN_PENDING: 'RETURN_PENDING',
  RETURNED: 'RETURNED',
  DECOMMISSIONED: 'DECOMMISSIONED',
} as const;
export type DeployedStatus = (typeof DeployedStatus)[keyof typeof DeployedStatus];

// ---------------------------------------------------------------------------
// Bundle configuration (device + accessories + paper + app/encryption)
// ---------------------------------------------------------------------------
export const BundleApplication = {
  FORTIS_RETAIL: 'FORTIS_RETAIL',
  FORTIS_RESTAURANT: 'FORTIS_RESTAURANT',
  FORTIS_MOBILE: 'FORTIS_MOBILE',
  GENERIC_EMV: 'GENERIC_EMV',
} as const;
export type BundleApplication = (typeof BundleApplication)[keyof typeof BundleApplication];

export const EncryptionType = {
  TDES_DUKPT: 'TDES_DUKPT',
  AES_DUKPT: 'AES_DUKPT',
  VOLTAGE_P2PE: 'VOLTAGE_P2PE',
  RSA: 'RSA',
  NONE: 'NONE',
} as const;
export type EncryptionType = (typeof EncryptionType)[keyof typeof EncryptionType];

export const ProcessorPlatform = {
  FISERV_NASHVILLE: 'FISERV_NASHVILLE',
  FISERV_OMAHA: 'FISERV_OMAHA',
  TSYS: 'TSYS',
  ELAVON: 'ELAVON',
  WORLDPAY: 'WORLDPAY',
} as const;
export type ProcessorPlatform = (typeof ProcessorPlatform)[keyof typeof ProcessorPlatform];

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
export const InventoryCondition = {
  NEW: 'NEW',
  REFURB: 'REFURB',
  OTHER: 'OTHER',
} as const;
export type InventoryCondition = (typeof InventoryCondition)[keyof typeof InventoryCondition];

export const AlertLevel = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;
export type AlertLevel = (typeof AlertLevel)[keyof typeof AlertLevel];
