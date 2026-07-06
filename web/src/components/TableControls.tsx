import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Universal table controls: search, date-range, and faceted multi-select filters.
 * Every table in the app composes this so filtering behaves identically everywhere.
 *
 *   const { rows, toolbar } = useTableControls(data ?? [], {
 *     search: (o) => `${o.reference} ${o.merchant.dbaName}`,
 *     dateField: (o) => o.createdAt,
 *     facets: [
 *       { key: 'phase',  label: 'Phase',  value: (o) => phaseOf(o.status) },
 *       { key: 'brand',  label: 'Brand',  value: (o) => brandsOf(o) },   // may return string[]
 *       { key: 'origin', label: 'Origin', value: (o) => originOf(o) },
 *     ],
 *   });
 *   return <AppShell>{toolbar}<DataTable rows={rows} … /></AppShell>;
 */
export interface Facet<T> {
  key: string;
  label: string;
  /** One or more values for this row. null/undefined/'' are ignored. */
  value: (row: T) => string | string[] | undefined | null;
}

export interface TableControlsConfig<T> {
  search?: (row: T) => string;
  searchPlaceholder?: string;
  /** ISO date string per row; enables the date-range picker when provided. */
  dateField?: (row: T) => string | undefined | null;
  dateLabel?: string;
  facets?: Facet<T>[];
  /** Initial control state — e.g. from a deep-link query param. Applied once on mount. */
  initial?: { q?: string; from?: string; to?: string; facets?: Record<string, string[]> };
}

function toArray(v: string | string[] | undefined | null): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => !!x && x !== '—');
}

/** Compact multi-select dropdown for a single facet. */
function FacetSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (options.length === 0) return null;
  const count = selected.size;
  return (
    <div className="facet" ref={ref}>
      <button type="button" className={`facet-btn${count > 0 ? ' active' : ''}`} onClick={() => setOpen((o) => !o)}>
        {label}{count > 0 ? ` · ${count}` : ''} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="facet-menu">
          <div className="facet-menu-head">
            <span className="small muted">{label}</span>
            {count > 0 && <button type="button" className="linklike" onClick={onClear}>Clear</button>}
          </div>
          <div className="facet-menu-list">
            {options.map((o) => (
              <label key={o} className="facet-opt">
                <input type="checkbox" checked={selected.has(o)} onChange={() => onToggle(o)} />
                <span>{o}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function useTableControls<T>(rows: T[], config: TableControlsConfig<T>) {
  const [q, setQ] = useState(config.initial?.q ?? '');
  const [from, setFrom] = useState(config.initial?.from ?? '');
  const [to, setTo] = useState(config.initial?.to ?? '');
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const [k, vals] of Object.entries(config.initial?.facets ?? {})) init[k] = new Set(vals);
    return init;
  });

  const facets = config.facets ?? [];

  // Options are derived from all rows so the menu is stable regardless of the current filter.
  const facetOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const f of facets) {
      const set = new Set<string>();
      for (const r of rows) toArray(f.value(r)).forEach((x) => set.add(x));
      map[f.key] = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, facets.map((f) => f.key).join(',')]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromT = from ? new Date(from).getTime() : null;
    const toT = to ? new Date(to).getTime() + 86_399_999 : null; // inclusive end-of-day
    return rows.filter((r) => {
      if (ql && config.search && !config.search(r).toLowerCase().includes(ql)) return false;
      if ((fromT != null || toT != null) && config.dateField) {
        const d = config.dateField(r);
        const t = d ? new Date(d).getTime() : NaN;
        if (Number.isNaN(t)) return false;
        if (fromT != null && t < fromT) return false;
        if (toT != null && t > toT) return false;
      }
      for (const f of facets) {
        const sel = selected[f.key];
        if (!sel || sel.size === 0) continue;
        const vals = toArray(f.value(r));
        if (!vals.some((x) => sel.has(x))) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, from, to, selected, config]);

  const toggle = (key: string, val: string) =>
    setSelected((s) => {
      const cur = new Set(s[key] ?? []);
      if (cur.has(val)) cur.delete(val); else cur.add(val);
      return { ...s, [key]: cur };
    });
  const clearFacet = (key: string) => setSelected((s) => ({ ...s, [key]: new Set() }));
  const clearAll = () => { setQ(''); setFrom(''); setTo(''); setSelected({}); };

  const activeCount =
    facets.reduce((n, f) => n + (selected[f.key]?.size ?? 0), 0) + (q ? 1 : 0) + (from || to ? 1 : 0);

  const toolbar: ReactNode = (
    <div className="table-controls">
      {config.search && (
        <input
          className="tc-search"
          placeholder={config.searchPlaceholder ?? 'Search…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {facets.map((f) => (
        <FacetSelect
          key={f.key}
          label={f.label}
          options={facetOptions[f.key] ?? []}
          selected={selected[f.key] ?? new Set()}
          onToggle={(v) => toggle(f.key, v)}
          onClear={() => clearFacet(f.key)}
        />
      ))}
      {config.dateField && (
        <div className="tc-dates">
          <span className="small muted">{config.dateLabel ?? 'Date'}</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <span className="small muted">–</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      <div className="tc-spacer" />
      <span className="small muted tc-count">
        {filtered.length}{filtered.length !== rows.length ? ` / ${rows.length}` : ''}
      </span>
      {activeCount > 0 && (
        <button type="button" className="btn sm" onClick={clearAll}>Clear all</button>
      )}
    </div>
  );

  return { rows: filtered, toolbar, clearAll, activeCount };
}
