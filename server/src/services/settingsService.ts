import { ADDITIONAL_DEVICE_FEE, SHIPPING_TIERS, type ShippingMethod, type ShippingTier } from '@de/shared';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { fromJson, toJson } from '../util/json.js';

const SHIPPING_KEY = 'shipping_tiers';
const POLICY_KEY = 'policies';
const FORTIS_TERMINAL_KEY = 'fortis_terminal_defaults';

export interface FortisTerminalConfig {
  /** Fortis terminal_manufacturer_code (e.g. "2" = Ingenico, "100" = Virtual Device). */
  manufacturerCode: string;
  /** terminal_application_id */
  applicationId: string;
  /** terminal_cvm_id */
  cvmId: string;
}

export interface PolicyConfig {
  returnWindowDays: number;
  warrantyDays: number;
  /** Courtesy / free (no-charge) swaps require a manager price-exception approval. */
  courtesyRequiresApproval: boolean;
}

export interface ShippingConfig {
  tiers: ShippingTier[];
  additionalDeviceFee: number;
}

const DEFAULT_SHIPPING: ShippingConfig = { tiers: SHIPPING_TIERS, additionalDeviceFee: ADDITIONAL_DEVICE_FEE };

export const settingsService = {
  async getShipping(): Promise<ShippingConfig> {
    const row = await prisma.setting.findUnique({ where: { key: SHIPPING_KEY } });
    if (!row) return DEFAULT_SHIPPING;
    const cfg = fromJson<ShippingConfig>(row.valueJson, DEFAULT_SHIPPING);
    return { tiers: cfg.tiers?.length ? cfg.tiers : DEFAULT_SHIPPING.tiers, additionalDeviceFee: cfg.additionalDeviceFee ?? DEFAULT_SHIPPING.additionalDeviceFee };
  },

  async setShipping(cfg: ShippingConfig): Promise<ShippingConfig> {
    const clean: ShippingConfig = {
      additionalDeviceFee: Number(cfg.additionalDeviceFee) || 0,
      tiers: (cfg.tiers ?? []).map((t, i) => ({ id: t.id ?? i + 1, name: String(t.name), base: Number(t.base) || 0, estimatedDays: Number(t.estimatedDays) || 0 })),
    };
    await prisma.setting.upsert({ where: { key: SHIPPING_KEY }, create: { key: SHIPPING_KEY, valueJson: toJson(clean) }, update: { valueJson: toJson(clean) } });
    return clean;
  },

  async getPolicy(): Promise<PolicyConfig> {
    const def: PolicyConfig = { returnWindowDays: config.RETURN_WINDOW_DAYS, warrantyDays: config.WARRANTY_DAYS, courtesyRequiresApproval: true };
    const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
    if (!row) return def;
    const cfg = fromJson<Partial<PolicyConfig>>(row.valueJson, {});
    return {
      returnWindowDays: Number(cfg.returnWindowDays) || def.returnWindowDays,
      warrantyDays: Number(cfg.warrantyDays) || def.warrantyDays,
      courtesyRequiresApproval: cfg.courtesyRequiresApproval ?? def.courtesyRequiresApproval,
    };
  },

  async setPolicy(cfg: PolicyConfig): Promise<PolicyConfig> {
    const clean: PolicyConfig = {
      returnWindowDays: Number(cfg.returnWindowDays) || 30,
      warrantyDays: Number(cfg.warrantyDays) || 365,
      courtesyRequiresApproval: Boolean(cfg.courtesyRequiresApproval),
    };
    await prisma.setting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, valueJson: toJson(clean) }, update: { valueJson: toJson(clean) } });
    return clean;
  },

  async getFortisTerminal(): Promise<FortisTerminalConfig> {
    // Default to the sandbox-verified Ingenico selection; env may seed initial values.
    const def: FortisTerminalConfig = {
      manufacturerCode: config.FORTIS_TERMINAL_MANUFACTURER_CODE || '2',
      applicationId: config.FORTIS_TERMINAL_APPLICATION_ID || '11eb970e79fdf07890ca5613', // Ingenico Link2500
      cvmId: config.FORTIS_TERMINAL_CVM_ID || '11e79d437fa5fa8400000005', // Telium Credit and Debit
    };
    const row = await prisma.setting.findUnique({ where: { key: FORTIS_TERMINAL_KEY } });
    if (!row) return def;
    const cfg = fromJson<Partial<FortisTerminalConfig>>(row.valueJson, {});
    return {
      manufacturerCode: cfg.manufacturerCode || def.manufacturerCode,
      applicationId: cfg.applicationId || def.applicationId,
      cvmId: cfg.cvmId || def.cvmId,
    };
  },

  async setFortisTerminal(cfg: FortisTerminalConfig): Promise<FortisTerminalConfig> {
    const clean: FortisTerminalConfig = {
      manufacturerCode: String(cfg.manufacturerCode || '').trim(),
      applicationId: String(cfg.applicationId || '').trim(),
      cvmId: String(cfg.cvmId || '').trim(),
    };
    await prisma.setting.upsert({ where: { key: FORTIS_TERMINAL_KEY }, create: { key: FORTIS_TERMINAL_KEY, valueJson: toJson(clean) }, update: { valueJson: toJson(clean) } });
    return clean;
  },

  /** Shipping options priced for a quantity, using the persisted (or default) tiers. */
  async methodsFor(totalQty: number): Promise<ShippingMethod[]> {
    const { tiers, additionalDeviceFee } = await this.getShipping();
    const extra = Math.max(0, (totalQty || 1) - 1) * additionalDeviceFee;
    return tiers.map((t) => ({ id: t.id, name: t.name, rate: t.base + extra, estimatedDays: t.estimatedDays }));
  },
};
