/**
 * Device-brand (manufacturer) detection. There is no brand field upstream, so we recognize
 * the manufacturer from a device/model/bundle string. Bundles may also carry an explicit
 * `brand` override (set by an admin); this heuristic is the fallback and the importer default.
 *
 * Note: "Lane 3000/5000" are Ingenico Lane terminals, "Z-line/QD" are Dejavoo, etc. Patterns
 * are intentionally conservative to avoid false positives on generic words.
 */
export interface BrandRule {
  brand: string;
  patterns: RegExp[];
}

export const DEVICE_BRANDS: BrandRule[] = [
  { brand: 'Dejavoo', patterns: [/\bdejavoo\b/i, /\bz\d{1,2}\b/i, /\bqd[-\s]?\d/i, /\bp[13]\b/i] },
  { brand: 'PAX', patterns: [/\bpax\b/i, /\ba9\d0\b/i, /\ba80\b/i, /\ba35\b/i, /\ba60\b/i, /\bs80\b/i, /\bs90\b/i, /\baries\b/i, /\bim\d0\b/i] },
  { brand: 'Ingenico', patterns: [/\bingenico\b/i, /\blane[\s/]?\d{3,4}/i, /\bmove[\s/]?\d{3,4}/i, /\bdesk[\s/]?\d{3,4}/i, /\blink[\s/]?\d{3,4}/i, /\bict\d{2,3}\b/i, /\biwl\d{2,3}\b/i, /\bipp\d{3}\b/i, /\bself[\s/]?\d{3,4}/i] },
  { brand: 'ID Tech', patterns: [/\bid\s?tech\b/i, /\bvp\d{4}\b/i, /\baugusta\b/i, /\bshuttle\b/i] },
  { brand: 'Verifone', patterns: [/\bverifone\b/i, /\bvx[\s-]?\d{3}\b/i, /\bengage\b/i, /\bcarbon\b/i, /\bp\d{3}\b/i, /\be2[0-9]5\b/i, /\bt650\b/i, /\bm400\b/i] },
  { brand: 'Valor', patterns: [/\bvalor\b/i, /\bvl\d{3}\b/i, /\bvp\d{3}\b/i] },
  { brand: 'Clover', patterns: [/\bclover\b/i] },
  { brand: 'Poynt', patterns: [/\bpoynt\b/i] },
  { brand: 'Castles', patterns: [/\bcastles\b/i, /\bsaturn\b/i, /\bvega\d{3}\b/i, /\bs1[fe]\d\b/i] },
  { brand: 'BBPOS', patterns: [/\bbbpos\b/i, /\bchipper\b/i, /\bwisepad\b/i] },
  { brand: 'Newland', patterns: [/\bnewland\b/i, /\bn910\b/i] },
  { brand: 'Equinox', patterns: [/\bequinox\b/i, /\bluxe\b/i] },
  { brand: 'SwipeSimple', patterns: [/\bswipesimple\b/i, /\bb\d{3}\b/i] },
  { brand: 'Sunmi', patterns: [/\bsunmi\b/i] },
];

/** Best-effort device brand from one or more descriptive strings (model, name, etc.). */
export function brandFromText(...parts: Array<string | undefined | null>): string | undefined {
  const text = parts.filter(Boolean).join(' ').trim();
  if (!text) return undefined;
  for (const rule of DEVICE_BRANDS) {
    if (rule.patterns.some((p) => p.test(text))) return rule.brand;
  }
  return undefined;
}

/** All brand names, for populating filter option lists. */
export const ALL_BRANDS: string[] = DEVICE_BRANDS.map((b) => b.brand);
