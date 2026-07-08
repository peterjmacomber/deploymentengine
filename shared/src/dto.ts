/**
 * Zod request schemas — the validation contract. Server validates inbound requests against
 * these; web forms infer types from the same schemas so client and server never drift.
 */
import { z } from 'zod';
import {
  BundleApplication,
  EncryptionType,
  ExceptionType,
  ProcessorPlatform,
  ReturnReasonCode,
  ReturnType,
  Role,
} from './enums.js';

export const addressSchema = z.object({
  merchantName: z.string().max(120).optional(),
  line1: z.string().min(1, 'Street address required').max(120),
  line2: z.string().max(120).optional(),
  city: z.string().min(1, 'City required').max(80),
  region: z.string().min(2, 'State/region required').max(40),
  postalCode: z.string().min(3, 'Postal code required').max(12),
  country: z.string().min(2).max(2).default('US'),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createMerchantSchema = z.object({
  mid: z.string().max(40).optional(),
  dbaName: z.string().min(1).max(160),
  legalName: z.string().max(160).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  shippingAddress: addressSchema.optional(),
});
export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;

export const cartLineSchema = z.object({
  pospBundleId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(500),
});

export const shippingQuoteSchema = z.object({
  address: addressSchema,
  cart: z.array(cartLineSchema).min(1),
});
export type ShippingQuoteInput = z.infer<typeof shippingQuoteSchema>;

export const createOrderSchema = z.object({
  merchantId: z.number().int().positive().optional(),
  merchant: createMerchantSchema.optional(),
  // MID is the cross-system linking identifier — required on every order.
  mid: z.string().min(1, 'MID is required'),
  cart: z.array(cartLineSchema).min(1, 'At least one bundle is required'),
  shippingAddress: addressSchema,
  shippingMethodId: z.number().int().optional(),
  classification: z.string().optional(),
  notes: z.string().max(2000).optional(),
  // an approved PRICE_EXCEPTION id can be attached to make a line free/discounted
  priceExceptionId: z.number().int().positive().optional(),
}).refine((v) => v.merchantId || v.merchant, {
  message: 'Provide merchantId or merchant details',
  path: ['merchantId'],
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Public/embed order creation — a merchant application + a single bundle choice. */
export const embedCreateOrderSchema = z.object({
  applicant: z.object({
    dbaName: z.string().min(1).max(160),
    legalName: z.string().max(160).optional(),
    contactName: z.string().min(1).max(120),
    email: z.string().email(),
    phone: z.string().min(7).max(40),
    mid: z.string().min(1, 'MID is required').max(40),
  }),
  shippingAddress: addressSchema,
  cart: z.array(cartLineSchema).min(1),
  shippingMethodId: z.number().int().optional(),
  returnUrl: z.string().url().optional(),
});
export type EmbedCreateOrderInput = z.infer<typeof embedCreateOrderSchema>;

export const bundleItemSchema = z.object({
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(160),
  quantity: z.number().int().min(1).max(50),
  kind: z.enum(['device', 'accessory', 'paper', 'other']),
});

export const upsertBundleSchema = z.object({
  pospBundleId: z.number().int().positive(),
  displayName: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  active: z.boolean().default(false),
  items: z.array(bundleItemSchema).default([]),
  application: z.nativeEnum(BundleApplication).optional(),
  encryption: z.nativeEnum(EncryptionType).optional(),
  processorPlatform: z.nativeEnum(ProcessorPlatform).optional(),
  distributor: z.string().max(80).default('POS Portal'),
  accountingDeviceModel: z.string().max(120).optional(),
  accountingUnitPrice: z.number().nonnegative().optional(),
  brand: z.string().max(60).optional(),
});
export type UpsertBundleInput = z.infer<typeof upsertBundleSchema>;

export const returnItemSchema = z.object({
  deployedEquipmentId: z.number().int().optional(),
  returnType: z.nativeEnum(ReturnType),
  reasonCode: z.nativeEnum(ReturnReasonCode),
  expectedSerialNumber: z.string().max(60).optional(),
  expectedProduct: z.string().max(160).optional(),
});

export const createReturnSchema = z.object({
  entityType: z.enum(['order', 'merchant']),
  entityId: z.number().int().positive(),
  merchantId: z.number().int().positive(),
  items: z.array(returnItemSchema).min(1),
  replacementBundleId: z.number().int().positive().optional(), // for swaps
  refundAmount: z.number().nonnegative().optional(),
  daysSinceDeployment: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
  // if a required exception has already been approved, attach it
  exceptionId: z.number().int().positive().optional(),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const createExceptionSchema = z.object({
  type: z.nativeEnum(ExceptionType),
  reason: z.string().min(3).max(1000),
  merchantId: z.number().int().positive().optional(),
  orderId: z.number().int().positive().optional(),
  returnCaseId: z.number().int().positive().optional(),
  bundlePospId: z.number().int().positive().optional(),
  originalPrice: z.number().nonnegative().optional(),
  requestedPrice: z.number().nonnegative().optional(),
  serialNumber: z.string().max(60).optional(),
  daysSinceDeployment: z.number().int().nonnegative().optional(),
});
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;

export const decideExceptionSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  decisionNote: z.string().max(1000).optional(),
});
export type DecideExceptionInput = z.infer<typeof decideExceptionSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.nativeEnum(Role).refine((r) => r !== Role.PARTNER, 'PARTNER is not a login role'),
  password: z.string().min(10).max(200),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Create a merchant self-service (portal) login, scoped to a merchant. */
export const createMerchantUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(200),
});
export type CreateMerchantUserInput = z.infer<typeof createMerchantUserSchema>;

/** A self-service issue submitted from the merchant portal. */
export const submitIssueSchema = z.object({
  issueCode: z.string().min(1).max(40),
  deployedEquipmentId: z.number().int().positive().optional(),
  serialNumber: z.string().max(60).optional(),
  wantsReplacement: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});
export type SubmitIssueInput = z.infer<typeof submitIssueSchema>;

/** Logged when a merchant resolves an issue via the self-service tips (no case opened). */
export const resolvedIssueSchema = z.object({
  issueCode: z.string().min(1).max(40),
  deployedEquipmentId: z.number().int().positive().optional(),
  serialNumber: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
});
export type ResolvedIssueInput = z.infer<typeof resolvedIssueSchema>;

// ---------------------------------------------------------------------------
// Deployment links (custom order / application landing pages)
// ---------------------------------------------------------------------------
export const createLinkSchema = z.object({
  type: z.enum(['order', 'application']),
  name: z.string().min(1).max(120),
  merchantId: z.number().int().positive().optional(),
  bundlePospIds: z.array(z.number().int().positive()).min(1, 'Select at least one bundle'),
  pricingOverrides: z.record(z.coerce.number().nonnegative()).optional(),
  shippingMethodId: z.number().int().optional(),
  customFeeName: z.string().max(80).optional(),
  customFeeAmount: z.coerce.number().optional(),
  password: z.string().min(1).max(100).optional(),
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().optional(),
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

export const updateLinkSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
  merchantId: z.number().int().positive().nullable().optional(),
  bundlePospIds: z.array(z.number().int().positive()).optional(),
  pricingOverrides: z.record(z.coerce.number().nonnegative()).optional(),
  shippingMethodId: z.number().int().nullable().optional(),
  customFeeName: z.string().max(80).nullable().optional(),
  customFeeAmount: z.coerce.number().nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  password: z.string().min(1).max(100).optional(),
  clearPassword: z.boolean().optional(),
});
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;

/** Public order placement through a deployment link. */
export const linkOrderSchema = z.object({
  password: z.string().optional(),
  shippingAddress: addressSchema,
  cart: z.array(cartLineSchema).optional(),
  shippingMethodId: z.number().int().optional(),
  returnUrl: z.string().url().optional(),
  applicant: z
    .object({
      dbaName: z.string().min(1).max(160),
      legalName: z.string().max(160).optional(),
      contactName: z.string().min(1).max(120),
      email: z.string().email(),
      phone: z.string().min(7).max(40),
      mid: z.string().min(1, 'MID is required').max(40),
    })
    .optional(),
});
export type LinkOrderInput = z.infer<typeof linkOrderSchema>;

/** Loose webhook envelope — POS Portal event delivery. */
export const webhookEventSchema = z.object({
  entity: z.string().optional(),
  event: z.string().optional(),
  eventTime: z.string().optional(),
  recordId: z.union([z.number(), z.string()]).optional(),
  client: z.object({ id: z.union([z.number(), z.string()]).optional(), name: z.string().optional() }).partial().optional(),
}).passthrough();
export type WebhookEventInput = z.infer<typeof webhookEventSchema>;
