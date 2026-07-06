import type { CSSProperties, ReactNode } from 'react';
import { titleCase } from '../lib/format';

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`card ${className}`} style={style}>{children}</div>;
}

export function Kpi({ label, value, alert, onClick }: { label: string; value: ReactNode; alert?: boolean; onClick?: () => void }) {
  return (
    <div
      className={`kpi${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="label">{label}</div>
      <div className={`value ${alert ? 'alert' : ''}`}>{value}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 24, gap: 10, color: 'var(--muted)' }}>
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

type Tone = 'gray' | 'green' | 'teal' | 'blue' | 'amber' | 'red';

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  // orders
  DRAFT: 'gray', PLACED: 'blue', IN_PREP: 'amber', SHIPPED: 'teal', OUT_FOR_DELIVERY: 'teal',
  DELIVERED: 'green', BACKORDERED: 'amber', CANCELLED: 'red', RETURNED: 'red', RETURNED_HOLDING: 'amber',
  RESHIPPED: 'blue', DELIVERY_FAILED: 'red',
  // exceptions
  PENDING: 'amber', APPROVED: 'green', DENIED: 'red',
  // returns lifecycle
  INITIATED: 'blue', PENDING_APPROVAL: 'amber', CALLTAG_ISSUED: 'blue', REPLACEMENT_SHIPPED: 'teal',
  ITEMS_RECEIVED: 'teal', CLOSED: 'green',
  // deployed
  ACTIVE: 'green', IN_REPAIR: 'amber', RETURN_PENDING: 'amber',
  DECOMMISSIONED: 'gray',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'gray'}>{titleCase(status)}</Badge>;
}
