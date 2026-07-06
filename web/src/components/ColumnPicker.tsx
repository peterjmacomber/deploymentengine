import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Column } from './DataTable';

const KEY_PREFIX = 'de.cols.';

/** Dropdown listing every toggleable column so the user can add/remove them. */
function ColumnsMenu({
  columns,
  visible,
  onToggle,
  onReset,
}: {
  columns: { key: string; label: string }[];
  visible: string[];
  onToggle: (k: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="facet" ref={ref}>
      <button type="button" className="facet-btn" onClick={() => setOpen((o) => !o)}>
        ⚙ Columns <span className="caret">▾</span>
      </button>
      {open && (
        <div className="facet-menu" style={{ right: 0, left: 'auto' }}>
          <div className="facet-menu-head">
            <span className="small muted">Show columns</span>
            <button type="button" className="linklike" onClick={onReset}>Reset</button>
          </div>
          <div className="facet-menu-list">
            {columns.map((c) => (
              <label key={c.key} className="facet-opt">
                <input type="checkbox" checked={visible.includes(c.key)} onChange={() => onToggle(c.key)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Column visibility with per-table persistence (localStorage). Columns with a `key` are
 * toggleable; keyless columns (checkboxes, actions) are always shown. Returns the filtered
 * columns to hand to <DataTable> plus a `menu` to render in the toolbar.
 */
export function useVisibleColumns<T>(storageKey: string, allColumns: Column<T>[], defaultVisibleKeys?: string[]) {
  const keyed = allColumns.filter((c): c is Column<T> & { key: string } => !!c.key);
  const allKeys = keyed.map((c) => c.key);
  const defaults = defaultVisibleKeys ?? allKeys;

  const [visible, setVisible] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) return arr.filter((k) => allKeys.includes(k));
      }
    } catch { /* ignore */ }
    return defaults;
  });
  useEffect(() => {
    try { localStorage.setItem(KEY_PREFIX + storageKey, JSON.stringify(visible)); } catch { /* ignore */ }
  }, [storageKey, visible]);

  const visibleSet = new Set(visible);
  const columns = allColumns.filter((c) => !c.key || visibleSet.has(c.key));

  const menu: ReactNode = (
    <ColumnsMenu
      columns={keyed.map((c) => ({ key: c.key, label: c.label ?? c.key }))}
      visible={visible}
      onToggle={(k) => setVisible((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))}
      onReset={() => setVisible(defaults)}
    />
  );

  return { columns, menu };
}
