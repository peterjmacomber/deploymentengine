import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type DeployedEquipment, type Order, type ReturnCase, ReturnType } from '@de/shared';
import { api } from '../api/client';
import { PortalLayout } from './PortalLayout';
import { Badge, Card, Kpi, Loading, StatusBadge } from '../components/ui';
import { date, serialTag, titleCase } from '../lib/format';
import { deployedBrand } from '../lib/brand';

// --------------------------------------------------------------------------- Home
export function PortalHome() {
  const me = useQuery({ queryKey: ['portal-me'], queryFn: api.portal.me });
  const orders = useQuery({ queryKey: ['portal-orders'], queryFn: api.portal.orders });
  const devices = useQuery({ queryKey: ['portal-deployed'], queryFn: api.portal.deployed });
  const s = me.data?.summary;
  const recent = (orders.data?.orders ?? []).slice(0, 5);
  const active = (devices.data?.equipment ?? []).filter((d) => d.status === 'ACTIVE');

  return (
    <PortalLayout title="Welcome back">
      <div className="portal-kpis">
        <Kpi label="Orders" value={s?.orders ?? '—'} />
        <Kpi label="Active devices" value={s?.activeDevices ?? '—'} />
        <Kpi label="Open swaps" value={s?.openSwaps ?? '—'} />
        <Kpi label="Open returns" value={s?.openReturns ?? '—'} />
      </div>

      <Card className="portal-cta" style={{ marginTop: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Having trouble with a device?</h3>
          <p className="small muted" style={{ margin: 0 }}>Tell us what’s wrong — we’ll try a few quick fixes and, if needed, set up a swap or return automatically.</p>
        </div>
        <Link className="btn primary" to="/portal/report">Report an issue</Link>
      </Card>

      <div className="portal-grid" style={{ marginTop: 16 }}>
        <Card>
          <div className="row between"><h3 style={{ margin: 0 }}>Recent orders</h3><Link className="small" to="/portal/orders">View all →</Link></div>
          {orders.isLoading ? <Loading /> : recent.length === 0 ? <p className="small muted">No orders yet.</p> : (
            <table className="mini-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Order</th><th>Placed</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}><td className="mono small">{o.reference ?? `#${o.id}`}</td><td className="small">{date(o.createdAt)}</td><td><StatusBadge status={o.status} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <div className="row between"><h3 style={{ margin: 0 }}>Your devices</h3><span className="small muted">{active.length} active</span></div>
          {devices.isLoading ? <Loading /> : active.length === 0 ? <p className="small muted">No active devices.</p> : (
            <table className="mini-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Device</th><th>Serial</th></tr></thead>
              <tbody>
                {active.slice(0, 6).map((d) => (
                  <tr key={d.id}><td>{d.productName ?? deployedBrand(d) ?? d.model ?? 'Device'}</td><td className="mono small">{serialTag(d.serialNumber)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </PortalLayout>
  );
}

// --------------------------------------------------------------------------- Orders
export function PortalOrders() {
  const orders = useQuery({ queryKey: ['portal-orders'], queryFn: api.portal.orders });
  const rows = orders.data?.orders ?? [];
  return (
    <PortalLayout title="Orders">
      <Card>
        {orders.isLoading ? <Loading /> : rows.length === 0 ? <p className="small muted">No orders on your account yet.</p> : (
          <table className="mini-table">
            <thead><tr><th>Order</th><th>Placed</th><th>Items</th><th>Status</th><th>Tracking</th><th>Serials</th></tr></thead>
            <tbody>
              {rows.map((o) => <OrderRow key={o.id} o={o} />)}
            </tbody>
          </table>
        )}
      </Card>
    </PortalLayout>
  );
}

function OrderRow({ o }: { o: Order }) {
  const items = o.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ');
  const pkg = o.packages.find((p) => p.trackingNumber);
  return (
    <tr>
      <td className="mono small">{o.reference ?? `#${o.id}`}</td>
      <td className="small">{date(o.createdAt)}</td>
      <td className="small">{items || '—'}</td>
      <td><StatusBadge status={o.status} /></td>
      <td className="small">{pkg ? <span>{pkg.carrier ?? o.shippingCarrier ?? ''} <span className="mono">{pkg.trackingNumber}</span></span> : '—'}</td>
      <td className="small">{o.serialNumbers.length ? o.serialNumbers.map((sn) => <span key={sn} className="badge gray mono" style={{ marginRight: 4 }}>{serialTag(sn)}</span>) : '—'}</td>
    </tr>
  );
}

// --------------------------------------------------------------------------- Swaps / Returns
const isSwap = (r: ReturnCase) => r.items[0]?.returnType === ReturnType.REPLACEMENT;

export function PortalCases({ kind }: { kind: 'swap' | 'return' }) {
  const q = useQuery({ queryKey: ['portal-returns'], queryFn: api.portal.returns });
  const rows = (q.data?.returns ?? []).filter((r) => isSwap(r) === (kind === 'swap'));
  const title = kind === 'swap' ? 'Swaps' : 'Returns';
  return (
    <PortalLayout title={title}>
      <Card>
        {q.isLoading ? <Loading /> : rows.length === 0 ? (
          <p className="small muted">No {title.toLowerCase()} on your account. Need one? <Link to="/portal/report">Report an issue</Link>.</p>
        ) : (
          <table className="mini-table">
            <thead><tr><th>Case</th><th>Opened</th><th>Reason</th><th>Device</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{r.pospReturnId ? `RMA ${r.pospReturnId}` : `#${r.id}`}</td>
                  <td className="small">{date(r.createdAt)}</td>
                  <td className="small">{titleCase(r.items[0]?.reasonCode ?? '')}</td>
                  <td className="mono small">{r.items[0]?.expectedSerialNumber ? serialTag(r.items[0].expectedSerialNumber) : '—'}</td>
                  <td><Badge tone={caseTone(r)}>{titleCase(r.pospStatus ?? r.lifecycle)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalLayout>
  );
}

function caseTone(r: ReturnCase): 'red' | 'gray' | 'amber' | 'green' | 'blue' {
  const u = (r.pospStatus ?? r.lifecycle).toUpperCase();
  if (u.includes('CANCEL') || u.includes('DENIED')) return 'red';
  if (u.includes('CLOSED') || u.includes('RECEIV')) return 'green';
  if (u.includes('PENDING') || u.includes('APPROVAL')) return 'amber';
  return 'blue';
}

// --------------------------------------------------------------------------- Analytics
export function PortalAnalytics() {
  const orders = useQuery({ queryKey: ['portal-orders'], queryFn: api.portal.orders });
  const devices = useQuery({ queryKey: ['portal-deployed'], queryFn: api.portal.deployed });
  const cases = useQuery({ queryKey: ['portal-returns'], queryFn: api.portal.returns });

  const byMonth = useMemo(() => monthCounts(orders.data?.orders ?? []), [orders.data]);
  const byManufacturer = useMemo(() => manufacturerCounts(devices.data?.equipment ?? []), [devices.data]);
  const totalUnits = (devices.data?.equipment ?? []).length;
  const swaps = (cases.data?.returns ?? []).filter(isSwap).length;

  return (
    <PortalLayout title="Analytics">
      <div className="portal-kpis">
        <Kpi label="Total orders" value={orders.data?.orders.length ?? '—'} />
        <Kpi label="Devices deployed" value={totalUnits || '—'} />
        <Kpi label="Lifetime swaps" value={swaps} />
        <Kpi label="Active devices" value={(devices.data?.equipment ?? []).filter((d) => d.status === 'ACTIVE').length} />
      </div>
      <div className="portal-grid" style={{ marginTop: 16 }}>
        <Card>
          <h3 style={{ marginTop: 0 }}>Orders by month</h3>
          <BarList data={byMonth} />
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>Devices by manufacturer</h3>
          <BarList data={byManufacturer} />
        </Card>
      </div>
    </PortalLayout>
  );
}

function monthCounts(orders: Order[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const o of orders) { const k = (o.createdAt ?? '').slice(0, 7); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
}
function manufacturerCounts(devices: DeployedEquipment[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const d of devices) { const k = deployedBrand(d) ?? 'Other'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function BarList({ data }: { data: Array<[string, number]> }) {
  if (!data.length) return <p className="small muted">Not enough data yet.</p>;
  const max = Math.max(...data.map(([, v]) => v));
  return (
    <div className="portal-bars">
      {data.map(([label, v]) => (
        <div key={label} className="portal-bar-row">
          <span className="portal-bar-label small">{label}</span>
          <span className="portal-bar-track"><span className="portal-bar-fill" style={{ width: `${(v / max) * 100}%` }} /></span>
          <span className="small mono">{v}</span>
        </div>
      ))}
    </div>
  );
}
