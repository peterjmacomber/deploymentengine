import { brandFromText, type Bundle, type Order, type DeployedEquipment } from '@de/shared';

/** pospBundleId → brand, from the bundle catalog (explicit brand or heuristic fallback). */
export function bundleBrandMap(bundles: Bundle[] | undefined): Map<number, string> {
  const m = new Map<number, string>();
  for (const b of bundles ?? []) {
    const brand = b.brand ?? brandFromText(b.accountingDeviceModel, b.displayName);
    if (brand) m.set(b.pospBundleId, brand);
  }
  return m;
}

/** Distinct device brands on an order, resolved via the bundle map then a text fallback. */
export function orderBrands(o: Order, map: Map<number, string>): string[] {
  const s = new Set<string>();
  for (const l of o.lines) {
    const brand = map.get(l.pospBundleId) ?? brandFromText(l.name);
    if (brand) s.add(brand);
  }
  return [...s];
}

/** Brand of a deployed unit — from its origin bundle if known, else from its product/model text. */
export function deployedBrand(d: DeployedEquipment): string | undefined {
  return brandFromText(d.productName, d.model);
}
