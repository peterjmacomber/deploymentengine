import type { AddressValidationResult, ShippingMethod } from '@de/shared';
import { posPortal } from '../adapters/posportal/index.js';
import { settingsService } from './settingsService.js';

export const shippingService = {
  /** Address validation is a real POS Portal call (POST /v2/shipping/address). */
  async validateAddress(address: unknown): Promise<AddressValidationResult> {
    return posPortal().validateAddress(address);
  },
  /** Shipping quotes come from the (admin-editable) Fortis deployment tier table. */
  async quote(input: { address: unknown; cart: Array<{ pospBundleId: number; quantity: number }> }): Promise<ShippingMethod[]> {
    const totalQty = input.cart.reduce((s, l) => s + (l.quantity || 0), 0);
    return settingsService.methodsFor(totalQty);
  },
};
