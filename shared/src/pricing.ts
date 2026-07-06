/**
 * Fortis equipment pricing + shipping tiers, sourced from the internal Equipment Pricing
 * (UPL) wiki. Device sell prices INCLUDE download/injection/handling; they exclude shipping
 * and tax. Shipping is a fixed tier table (Fortis deployment fees), not a carrier quote.
 */
import type { ShippingMethod } from './domain.js';

export const ADDITIONAL_DEVICE_FEE = 25; // per device after the first
export const RESTOCKING_FEE_PCT = 0.2; // 20% on returns

export interface ShippingTier {
  id: number;
  name: string;
  base: number;
  estimatedDays: number;
}

export const SHIPPING_TIERS: ShippingTier[] = [
  { id: 1, name: 'Ground', base: 35, estimatedDays: 5 },
  { id: 2, name: 'Priority (2-3 business days)', base: 45, estimatedDays: 3 },
  { id: 3, name: 'Rush (1-2 business days)', base: 85, estimatedDays: 2 },
  { id: 4, name: 'Rush Overnight', base: 95, estimatedDays: 1 },
];

/** Shipping options priced for a given total device quantity (+$25 per additional device). */
export function shippingMethodsFor(totalQty: number): ShippingMethod[] {
  const extra = Math.max(0, (totalQty || 1) - 1) * ADDITIONAL_DEVICE_FEE;
  return SHIPPING_TIERS.map((t) => ({ id: t.id, name: t.name, rate: t.base + extra, estimatedDays: t.estimatedDays }));
}

export interface DevicePrice {
  kw: string; // lowercased keyword matched against a bundle/product name (most specific first)
  price: number;
  model: string;
}

/** US Product Pricing List. Ordered most-specific-first so matching is unambiguous. */
export const DEVICE_PRICE_CATALOG: DevicePrice[] = [
  { kw: 'link 2500', price: 443, model: 'Ingenico Link 2500' },
  { kw: 'lane 3600 deluxe', price: 559, model: 'Ingenico Lane 3600 Deluxe' },
  { kw: 'lane 3600', price: 469, model: 'Ingenico Lane 3600 Standard' },
  { kw: 'lane 3000', price: 469, model: 'Ingenico Lane 3000' },
  { kw: 'lane 7000', price: 689, model: 'Ingenico Lane 7000' },
  { kw: 'move 5000', price: 749, model: 'Ingenico Move 5000' },
  { kw: 'vp3300', price: 119, model: 'IDTech VP3300' },
  { kw: 'aries', price: 418, model: 'PAX Aries8' },
  { kw: 'a920', price: 379, model: 'PAX A920 Pro' },
  { kw: 'a80', price: 249, model: 'PAX A80' },
  { kw: 'a35', price: 269, model: 'PAX A35' },
  { kw: 'q25', price: 159, model: 'PAX Q25' },
  { kw: 'qd2', price: 509, model: 'Dejavoo QD2' },
  { kw: 'qd4', price: 329, model: 'Dejavoo QD4' },
  { kw: 'qd5', price: 309, model: 'Dejavoo QD5' },
  { kw: 'z11', price: 299, model: 'Dejavoo Z11' },
  { kw: 'z8', price: 229, model: 'Dejavoo Z8' },
  { kw: 'b250', price: 129, model: 'SwipeSimple B250' },
];

/** Match a bundle/product name to a catalog device price. Returns null if no device matches. */
export function matchDevicePrice(name: string): DevicePrice | null {
  const n = (name || '').toLowerCase();
  for (const d of DEVICE_PRICE_CATALOG) {
    if (n.includes(d.kw)) return d;
  }
  return null;
}
