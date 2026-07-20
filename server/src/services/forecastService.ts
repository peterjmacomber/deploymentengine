import { AlertLevel, type ForecastRow, type InventoryAlert, type MonthValue } from '@de/shared';
import { prisma } from '../db.js';
import { inventoryService } from './inventoryService.js';

/**
 * Forecasting engine. Structured to mirror the "POS Portal Forecast File": per part we track
 * past-12-month demand (actuals), rolling averages (3/6/12 mo), OH Consigned, and a forward
 * 12-month editable estimate calendar. Coverage/alerts/buy-plan drive the Alerts view.
 *
 * Demand history is derived deterministically from a per-model velocity (the app is live/self-
 * contained; a workbook-import path can later replace `velocityFor`/`monthDemand` with real
 * actuals). Forward monthly estimates are persisted in ForecastEstimate and fully editable.
 */
function velocityFor(item: { modelNumber: string; totalQty: number; fgiQty: number }): number {
  let seed = 0;
  for (const ch of item.modelNumber) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  const base = 2 + (seed % 18); // 2..19 units/mo
  const scale = Math.max(0.4, Math.min(2.5, item.totalQty / 40));
  return Math.round(base * scale * 10) / 10;
}

/** Deterministic monthly demand around the velocity, so history is stable across reloads. */
function monthDemand(partId: string, month: string, velocity: number): number {
  let seed = 0;
  const s = `${partId}|${month}`;
  for (const ch of s) seed = (seed * 31 + ch.charCodeAt(0)) % 10_007;
  const factor = 0.5 + (seed % 100) / 100; // 0.5x .. 1.5x
  return Math.max(0, Math.round(velocity * factor));
}

/** YYYY-MM for `offset` months from the first of the current month (negative = past). */
function monthKey(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function pastMonths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => monthKey(-(n - i))); // oldest → newest
}
function forwardMonths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => monthKey(i + 1)); // next n months
}
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);

export const forecastService = {
  async build(): Promise<{ rows: ForecastRow[]; alerts: InventoryAlert[]; buyPlan: ForecastRow[]; metrics: Record<string, number> }> {
    const { items } = await inventoryService.getCachedSnapshot();
    const devices = items.filter((i) => !i.isNonSerialized && i.condition === 'NEW');

    const past = pastMonths(12);
    const fwd = forwardMonths(12);
    const estimateRows = await prisma.forecastEstimate.findMany();
    const estimateBy = new Map(estimateRows.map((e) => [`${e.newPartId}|${e.month}`, e.qty]));

    const rows: ForecastRow[] = devices.map((i) => {
      const velocity = velocityFor(i);
      const onHand = i.fgiQty || i.totalQty;
      const coverageMonths = velocity > 0 ? Math.round((onHand / velocity) * 100) / 100 : 0;
      const forecast12MoTotal = Math.round(velocity * 12);
      const targetQty = Math.ceil(velocity * 4); // 4-month coverage target
      const suggestedBuyQty = Math.max(0, targetQty - onHand);

      const demandHistory: MonthValue[] = past.map((m) => ({ month: m, qty: monthDemand(i.productId, m, velocity) }));
      const hist = demandHistory.map((d) => d.qty);
      const monthlyEstimates: MonthValue[] = fwd.map((m) => ({
        month: m,
        qty: estimateBy.get(`${i.productId}|${m}`) ?? Math.round(velocity),
      }));

      return {
        partDesc: i.partDesc,
        newPartId: i.productId,
        mfgPartId: i.modelNumber,
        manufacturer: i.manufacturer,
        consignedOnHand: onHand,
        forecast12MoTotal,
        avgVelocity: velocity,
        coverageMonths,
        suggestedBuyQty,
        apiInventoryMatched: true,
        past12Forecast: forecast12MoTotal,
        past12Demand: hist.reduce((s, x) => s + x, 0),
        avgMonthly3: avg(hist.slice(-3)),
        avgMonthly6: avg(hist.slice(-6)),
        avgMonthly12: avg(hist),
        demandHistory,
        monthlyEstimates,
      };
    });

    const alerts: InventoryAlert[] = [];
    for (const r of rows) {
      if (r.forecast12MoTotal > 0 && r.consignedOnHand <= 0) {
        alerts.push({ level: AlertLevel.CRITICAL, code: 'NO_STOCK_WITH_FORECAST', partDesc: r.partDesc, message: 'Forecast demand exists but on-hand is zero (buy direct from POS Portal).' });
      } else if (r.coverageMonths > 0 && r.coverageMonths < 1.5) {
        alerts.push({ level: AlertLevel.HIGH, code: 'LOW_COVERAGE', partDesc: r.partDesc, message: `Coverage low at ${r.coverageMonths} months.` });
      } else if (r.coverageMonths >= 12) {
        alerts.push({ level: AlertLevel.MEDIUM, code: 'HIGH_COVERAGE', partDesc: r.partDesc, message: `Coverage high at ${r.coverageMonths} months.` });
      }
    }

    const buyPlan = [...rows]
      .filter((r) => r.suggestedBuyQty > 0)
      .sort((a, b) => b.forecast12MoTotal - a.forecast12MoTotal)
      .slice(0, 6);

    const metrics = {
      devices: rows.length,
      atRisk: alerts.filter((a) => a.level === AlertLevel.CRITICAL || a.level === AlertLevel.HIGH).length,
      totalOnHand: rows.reduce((s, r) => s + r.consignedOnHand, 0),
      totalForecast12Mo: rows.reduce((s, r) => s + r.forecast12MoTotal, 0),
      totalSuggestedBuy: buyPlan.reduce((s, r) => s + r.suggestedBuyQty, 0),
    };

    return { rows, alerts, buyPlan, metrics };
  },

  /** Set (or clear, when qty is null) a forward monthly estimate for a part. */
  async setEstimate(newPartId: string, month: string, qty: number, updatedBy?: string): Promise<void> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
    const clean = Math.max(0, Math.round(qty));
    await prisma.forecastEstimate.upsert({
      where: { newPartId_month: { newPartId, month } },
      create: { newPartId, month, qty: clean, updatedBy },
      update: { qty: clean, updatedBy },
    });
  },
};
