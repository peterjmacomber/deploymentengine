import axios from 'axios';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * Tax boundary (prototype structure). Mirrors the POS Portal / Fortis adapter pattern so we
 * can later switch on Avalara AvaTax for real tax calculation and, eventually, bill merchants
 * directly instead of through Fortis. All callers depend on this interface only.
 */
export interface TaxLine {
  amount: number;
  quantity?: number;
  taxCode?: string; // Avalara tax code (e.g. P0000000 tangible goods)
  description?: string;
}

export interface TaxAddress {
  line1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface TaxEstimate {
  provider: 'none' | 'mock' | 'avalara';
  taxable: number;
  rate: number; // effective rate 0..1
  tax: number;
  note?: string;
}

export interface TaxAdapter {
  readonly mode: 'none' | 'mock' | 'avalara';
  estimate(input: { toAddress: TaxAddress; lines: TaxLine[]; shipping?: number }): Promise<TaxEstimate>;
}

const taxableOf = (input: { lines: TaxLine[]; shipping?: number }) =>
  input.lines.reduce((s, l) => s + l.amount * (l.quantity ?? 1), 0) + (input.shipping ?? 0);

class NoTaxAdapter implements TaxAdapter {
  readonly mode = 'none' as const;
  async estimate(input: { toAddress: TaxAddress; lines: TaxLine[]; shipping?: number }): Promise<TaxEstimate> {
    return { provider: 'none', taxable: taxableOf(input), rate: 0, tax: 0, note: 'Tax calculation disabled' };
  }
}

class MockTaxAdapter implements TaxAdapter {
  readonly mode = 'mock' as const;
  async estimate(input: { toAddress: TaxAddress; lines: TaxLine[]; shipping?: number }): Promise<TaxEstimate> {
    const taxable = taxableOf(input);
    const rate = config.TAX_RATE;
    return { provider: 'mock', taxable, rate, tax: Math.round(taxable * rate * 100) / 100, note: `Flat ${(rate * 100).toFixed(2)}% (mock)` };
  }
}

/**
 * Avalara AvaTax skeleton. Wired to the AvaTax /transactions/create shape; only calls out when
 * credentials are present, otherwise returns a zeroed estimate so the app stays functional.
 */
class AvalaraTaxAdapter implements TaxAdapter {
  readonly mode = 'avalara' as const;
  async estimate(input: { toAddress: TaxAddress; lines: TaxLine[]; shipping?: number }): Promise<TaxEstimate> {
    const taxable = taxableOf(input);
    if (!config.AVALARA_ACCOUNT_ID || !config.AVALARA_LICENSE_KEY || !config.AVALARA_COMPANY_CODE) {
      return { provider: 'avalara', taxable, rate: 0, tax: 0, note: 'Avalara not configured' };
    }
    try {
      const auth = Buffer.from(`${config.AVALARA_ACCOUNT_ID}:${config.AVALARA_LICENSE_KEY}`).toString('base64');
      const body = {
        type: 'SalesOrder', // estimate (not committed)
        companyCode: config.AVALARA_COMPANY_CODE,
        date: new Date().toISOString().slice(0, 10),
        customerCode: 'DEPLOYMENT-ENGINE',
        addresses: { shipTo: { line1: input.toAddress.line1, city: input.toAddress.city, region: input.toAddress.region, postalCode: input.toAddress.postalCode, country: input.toAddress.country ?? 'US' } },
        lines: input.lines.map((l, i) => ({ number: String(i + 1), quantity: l.quantity ?? 1, amount: l.amount * (l.quantity ?? 1), taxCode: l.taxCode ?? 'P0000000', description: l.description })),
      };
      const res = await axios.post(`${config.AVALARA_BASE_URL}/api/v2/transactions/create`, body, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20_000 });
      const tax = Number(res.data?.totalTax ?? 0);
      return { provider: 'avalara', taxable, rate: taxable ? tax / taxable : 0, tax };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Avalara estimate failed');
      return { provider: 'avalara', taxable, rate: 0, tax: 0, note: 'Avalara request failed' };
    }
  }
}

let instance: TaxAdapter | null = null;
export function tax(): TaxAdapter {
  if (!instance) {
    instance = config.TAX_MODE === 'avalara' ? new AvalaraTaxAdapter() : config.TAX_MODE === 'mock' ? new MockTaxAdapter() : new NoTaxAdapter();
    logger.info({ mode: instance.mode }, 'Tax adapter initialized');
  }
  return instance;
}
