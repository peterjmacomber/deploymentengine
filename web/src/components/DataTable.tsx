import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { Empty, Loading } from './ui';

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string;
  /** Provide a comparable value to make this column sortable (click the header). */
  sort?: (row: T) => string | number;
  /** Stable id — makes the column toggleable in the column picker. Columns without a key
   *  (checkboxes, action buttons) are always shown. */
  key?: string;
  /** Plain-text label shown in the column picker (defaults to `key`). */
  label?: string;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  onRowClick,
  empty = 'Nothing to show.',
  keyOf,
  renderExpanded,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  keyOf: (row: T) => string | number;
  /** When provided, each row gets an expand caret that reveals this content below it. */
  renderExpanded?: (row: T) => ReactNode;
}) {
  const [sortIdx, setSortIdx] = useState<number | null>(null);
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());

  const sorted = useMemo(() => {
    if (!rows || sortIdx == null || !columns[sortIdx]?.sort) return rows ?? [];
    const get = columns[sortIdx].sort!;
    const mult = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }, [rows, sortIdx, dir, columns]);

  if (loading) return <Loading />;
  if (!rows || rows.length === 0) return <Empty>{empty}</Empty>;

  const clickHeader = (i: number) => {
    if (!columns[i].sort) return;
    if (sortIdx === i) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortIdx(i); setDir('asc'); }
  };
  const toggle = (k: string | number) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const colSpan = columns.length + (renderExpanded ? 1 : 0);

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {renderExpanded && <th style={{ width: 30 }} />}
            {columns.map((c, i) => (
              <th key={i} style={{ ...(c.width ? { width: c.width } : {}), cursor: c.sort ? 'pointer' : undefined, userSelect: 'none' }} onClick={() => clickHeader(i)}>
                {c.header}{c.sort && sortIdx === i ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const k = keyOf(row);
            const isOpen = expanded.has(k);
            return (
              <Fragment key={k}>
                <tr className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {renderExpanded && (
                    <td style={{ cursor: 'pointer', color: 'var(--muted)' }} onClick={(e) => { e.stopPropagation(); toggle(k); }}>{isOpen ? '▾' : '▸'}</td>
                  )}
                  {columns.map((c, i) => <td key={i}>{c.cell(row)}</td>)}
                </tr>
                {renderExpanded && isOpen && (
                  <tr><td colSpan={colSpan} style={{ background: '#fafbfc', padding: '14px 18px' }}>{renderExpanded(row)}</td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
