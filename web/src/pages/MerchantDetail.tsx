import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type Order, OrderClassification, OrderStatus } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Card, Loading, StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api } from '../api/client';
import { date, money, titleCase } from '../lib/format';
import { bundleBrandMap, orderBrands } from '../lib/brand';

const TABS = ['Overview', 'Orders', 'Shipments', 'Returns', 'Forecasting', 'Analytics'] as const;
type Tab = (typeof TABS)[number];

function phaseOf(o: Order): string {
  const s = o.status;
  if (([OrderStatus.DRAFT, OrderStatus.PLACED, OrderStatus.IN_PREP, OrderStatus.BACKORDERED] as OrderStatus[]).includes(s)) return 'Pending shipment';
  if (([OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RESHIPPED] as OrderStatus[]).includes(s)) return 'Shipped';
  if (s === OrderStatus.DELIVERED) return 'Delivered';
  if (([OrderStatus.RETURNED, OrderStatus.RETURNED_HOLDING] as OrderStatus[]).includes(s)) return 'Returned';
  if (s === OrderStatus.CANCELLED) return 'Cancelled';
  return titleCase(s);
}
const originOf = (o: Order): string => (o.originLinkName ? 'Deployment link' : titleCase(o.method));
const unitsOf = (o: Order): number => o.lines.reduce((n, l) => n + l.quantity, 0);
const valueOf = (o: Order): number => o.lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.quantity, 0);

/** Simple horizontal bar chart for {label,value} rows. */
function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="small muted">No data.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="small" style={{ width: 130, textAlign: 'right', color: 'var(--muted)' }}>{r.label}</div>
          <div style={{ flex: 1, background: '#eef0f2', borderRadius: 5, height: 16 }}>
            <div style={{ width: `${(r.value / max) * 100}%`, background: 'var(--accent)', height: '100%', borderRadius: 5 }} />
          </div>
          <div className="small mono" style={{ width: 44 }}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export function MerchantDetail() {
  const { id } = useParams();
  const merchantId = Number(id);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('Overview');

  const mq = useQuery({ queryKey: ['merchant', merchantId], queryFn: () => api.merchants.get(merchantId), enabled: Number.isFinite(merchantId) });
  const oq = useQuery({ queryKey: ['orders', 'merchant', merchantId], queryFn: () => api.orders.list({ merchantId }) });
  const rq = useQuery({ queryKey: ['returns', 'merchant', merchantId], queryFn: () => api.returns.list({ merchantId }) });
  const dq = useQuery({ queryKey: ['deployed', 'merchant', merchantId], queryFn: () => api.deployed.list({ merchantId }) });
  const bq = useQuery({ queryKey: ['bundles'], queryFn: api.bundles.list });

  const merchant = mq.data?.merchant;
  const orders = useMemo(() => oq.data?.orders ?? [], [oq.data]);
  const returns = rq.data?.returns ?? [];
  const deployed = dq.data?.equipment ?? [];
  const brandMap = useMemo(() => bundleBrandMap(bq.data?.bundles), [bq.data]);

  // ---- derived stats ----
  const totalUnits = orders.reduce((s, o) => s + unitsOf(o), 0);
  const equipmentValue = orders.reduce((s, o) => s + valueOf(o), 0);
  const activeDevices = deployed.filter((d) => d.status === 'ACTIVE').length;
  const openReturns = returns.filter((r) => !['CLOSED', 'CANCELLED', 'DENIED'].includes(r.lifecycle)).length;
  const sortedByDate = useMemo(() => [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [orders]);
  const firstOrder = sortedByDate[0]?.createdAt;
  const lastOrder = sortedByDate[sortedByDate.length - 1]?.createdAt;

  // ---- forecasting (predicted from this merchant's own history) ----
  const forecast = useMemo(() => {
    const n = orders.length;
    const spanDays = firstOrder && lastOrder ? (new Date(lastOrder).getTime() - new Date(firstOrder).getTime()) / 86_400_000 : 0;
    const monthsSpan = Math.max(1, spanDays / 30);
    const unitsPerMonth = totalUnits / monthsSpan;
    const avgIntervalDays = n > 1 ? spanDays / (n - 1) : null;
    const nextEta = lastOrder && avgIntervalDays ? new Date(new Date(lastOrder).getTime() + avgIntervalDays * 86_400_000) : null;
    const avgUnitsPerOrder = n ? totalUnits / n : 0;
    return { n, unitsPerMonth, avgIntervalDays, nextEta: nextEta?.toISOString(), suggestedQty: Math.max(1, Math.round(avgUnitsPerOrder)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, firstOrder, lastOrder, totalUnits]);

  // ---- brand + monthly mixes ----
  const brandMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) for (const b of orderBrands(o, brandMap)) m.set(b, (m.get(b) ?? 0) + unitsOf(o));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [orders, brandMap]);
  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) { const k = o.createdAt.slice(0, 7); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([label, value]) => ({ label, value }));
  }, [orders]);

  // ---- shipments derived from order packages ----
  const shipments = useMemo(
    () => orders.flatMap((o) => (o.packages ?? []).map((p, i) => ({ ...p, order: o, key: `${o.id}-${i}` }))),
    [orders],
  );

  const orderCtl = useTableControls(orders, {
    search: (o) => `${o.reference ?? ''} ${o.lines.map((l) => l.name).join(' ')}`,
    searchPlaceholder: 'Search reference or item…',
    dateField: (o) => o.createdAt,
    dateLabel: 'Ordered',
    facets: [
      { key: 'phase', label: 'Phase', value: (o) => phaseOf(o) },
      { key: 'brand', label: 'Brand', value: (o) => orderBrands(o, brandMap) },
      { key: 'origin', label: 'Origin', value: (o) => originOf(o) },
      { key: 'class', label: 'Type', value: (o) => titleCase(o.classification) },
    ],
  });
  const shipCtl = useTableControls(shipments, {
    search: (s) => `${s.order.reference ?? ''} ${s.trackingNumber ?? ''} ${s.carrier ?? ''}`,
    searchPlaceholder: 'Search tracking or reference…',
    dateField: (s) => s.shippedAt,
    dateLabel: 'Shipped',
    facets: [{ key: 'status', label: 'Status', value: (s) => (s.status ? titleCase(s.status) : 'Unknown') }],
  });
  const returnCtl = useTableControls(returns, {
    search: (r) => `${r.mid ?? ''} #${r.id}`,
    searchPlaceholder: 'Search return…',
    dateField: (r) => r.createdAt,
    dateLabel: 'Opened',
    facets: [
      { key: 'lifecycle', label: 'Lifecycle', value: (r) => titleCase(r.lifecycle) },
      { key: 'delinquent', label: 'Delinquent', value: (r) => (r.delinquent ? 'Delinquent' : 'OK') },
    ],
  });

  if (mq.isLoading) return <AppShell title="Merchant"><Loading /></AppShell>;
  if (!merchant) return <AppShell title="Merchant"><Card>Merchant not found. <Link to="/merchants">Back to merchants</Link></Card></AppShell>;

  const title = merchant.dbaName ?? merchant.legalName ?? `Merchant #${merchant.id}`;

  return (
    <AppShell title={title} actions={<Link className="btn" to="/merchants">← All merchants</Link>}>
      {/* identity strip */}
      <div className="row" style={{ gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
        <div><div className="muted small">MID</div><span className="mono">{merchant.mid ?? '—'}</span></div>
        {merchant.legalName && <div><div className="muted small">Legal</div>{merchant.legalName}</div>}
        {merchant.email && <div><div className="muted small">Email</div>{merchant.email}</div>}
        {merchant.phone && <div><div className="muted small">Phone</div>{merchant.phone}</div>}
        {merchant.shippingAddress && (
          <div><div className="muted small">Ships to</div>{merchant.shippingAddress.city}, {merchant.shippingAddress.region}</div>
        )}
      </div>

      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Orders' && <span className="badge gray" style={{ marginLeft: 6 }}>{orders.length}</span>}
            {t === 'Returns' && openReturns > 0 && <span className="badge amber" style={{ marginLeft: 6 }}>{openReturns}</span>}
          </div>
        ))}
      </div>

      {tab === 'Overview' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{orders.length}</div></Card>
            <Card><div className="muted small">Units ordered</div><div style={{ fontSize: 24, fontWeight: 700 }}>{totalUnits}</div></Card>
            <Card><div className="muted small">Active devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{activeDevices}</div></Card>
            <Card><div className="muted small">Open returns</div><div style={{ fontSize: 24, fontWeight: 700 }}>{openReturns}</div></Card>
          </div>
          <Card>
            <div className="row between"><h3 style={{ margin: 0 }}>Recent orders</h3><button className="linklike" onClick={() => setTab('Orders')}>View all →</button></div>
            {orders.length === 0 ? <div className="small muted" style={{ marginTop: 8 }}>No orders yet.</div> : (
              <table className="mini-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Reference</th><th>Status</th><th>Items</th><th>Ordered</th></tr></thead>
                <tbody>
                  {sortedByDate.slice(-6).reverse().map((o) => (
                    <tr key={o.id}>
                      <td><Link className="rowlink mono" to={`/orders/${o.id}`}>{o.reference ?? `#${o.id}`}</Link></td>
                      <td><StatusBadge status={o.status} /></td>
                      <td>{unitsOf(o)}</td>
                      <td className="small">{date(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === 'Orders' && (
        <>
          {orderCtl.toolbar}
          <DataTable
            keyOf={(o) => o.id}
            rows={orderCtl.rows}
            loading={oq.isLoading}
            empty="No orders match."
            onRowClick={(o) => navigate(`/orders/${o.id}`)}
            columns={[
              { header: 'Reference', sort: (o) => o.reference ?? '', cell: (o) => <span className="mono rowlink">{o.reference ?? `#${o.id}`}</span> },
              { header: 'Phase', sort: (o) => phaseOf(o), cell: (o) => <StatusBadge status={o.status} /> },
              { header: 'Type', sort: (o) => o.classification, cell: (o) => <span className="small">{titleCase(o.classification)}</span> },
              { header: 'Brand', cell: (o) => <span className="small">{orderBrands(o, brandMap).join(', ') || '—'}</span> },
              { header: 'Items', sort: (o) => unitsOf(o), cell: (o) => unitsOf(o) },
              { header: 'Origin', sort: (o) => originOf(o), cell: (o) => <span className="small">{o.originLinkName ?? titleCase(o.method)}</span> },
              { header: 'Ordered', sort: (o) => o.createdAt, cell: (o) => <span className="small">{date(o.createdAt)}</span> },
            ]}
          />
        </>
      )}

      {tab === 'Shipments' && (
        <>
          {shipCtl.toolbar}
          <DataTable
            keyOf={(s) => s.key}
            rows={shipCtl.rows}
            loading={oq.isLoading}
            empty="No shipments yet."
            columns={[
              { header: 'Order', sort: (s) => s.order.reference ?? '', cell: (s) => <Link className="rowlink mono" to={`/orders/${s.order.id}`}>{s.order.reference ?? `#${s.order.id}`}</Link> },
              { header: 'Carrier', sort: (s) => s.carrier ?? '', cell: (s) => s.carrier ?? '—' },
              { header: 'Tracking', cell: (s) => <span className="mono small">{s.trackingNumber ?? '—'}</span> },
              { header: 'Status', sort: (s) => s.status ?? '', cell: (s) => (s.status ? <StatusBadge status={s.status} /> : '—') },
              { header: 'Shipped', sort: (s) => s.shippedAt ?? '', cell: (s) => <span className="small">{date(s.shippedAt)}</span> },
              { header: 'Delivered', sort: (s) => s.deliveredAt ?? '', cell: (s) => <span className="small">{date(s.deliveredAt)}</span> },
            ]}
          />
        </>
      )}

      {tab === 'Returns' && (
        <>
          {returnCtl.toolbar}
          <DataTable
            keyOf={(r) => r.id}
            rows={returnCtl.rows}
            loading={rq.isLoading}
            empty="No returns for this merchant."
            onRowClick={(r) => navigate(`/returns/${r.id}`)}
            columns={[
              { header: 'Case', sort: (r) => r.id, cell: (r) => <span className="mono rowlink">#{r.id}</span> },
              { header: 'Lifecycle', sort: (r) => r.lifecycle, cell: (r) => <StatusBadge status={r.lifecycle} /> },
              { header: 'Items', sort: (r) => r.expectedItemCount, cell: (r) => `${r.receivedItemCount}/${r.expectedItemCount}` },
              { header: 'Delinquent', sort: (r) => (r.delinquent ? 0 : 1), cell: (r) => (r.delinquent ? <span className="badge red">Delinquent</span> : <span className="small muted">—</span>) },
              { header: 'Opened', sort: (r) => r.createdAt, cell: (r) => <span className="small">{date(r.createdAt)}</span> },
            ]}
          />
        </>
      )}

      {tab === 'Forecasting' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Units / month</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.unitsPerMonth.toFixed(1)}</div></Card>
            <Card><div className="muted small">Reorder cadence</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.avgIntervalDays ? `${Math.round(forecast.avgIntervalDays)}d` : '—'}</div></Card>
            <Card><div className="muted small">Projected next order</div><div style={{ fontSize: 20, fontWeight: 700 }}>{forecast.nextEta ? date(forecast.nextEta) : '—'}</div></Card>
            <Card><div className="muted small">Suggested qty</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.n > 0 ? forecast.suggestedQty : '—'}</div></Card>
          </div>
          <Card>
            <h3 style={{ marginTop: 0 }}>How this is estimated</h3>
            <p className="small muted">
              Projections are derived from this merchant's own order history — {forecast.n} order(s)
              {firstOrder ? ` between ${date(firstOrder)} and ${date(lastOrder)}` : ''}. Units/month is total units over the active
              span; cadence is the average gap between orders; the projected next order applies that cadence to the last order date.
              {forecast.n < 2 && ' Not enough history yet for a confident cadence — this sharpens as more orders land.'}
            </p>
          </Card>
        </>
      )}

      {tab === 'Analytics' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Lifetime orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{orders.length}</div></Card>
            <Card><div className="muted small">Units ordered</div><div style={{ fontSize: 24, fontWeight: 700 }}>{totalUnits}</div></Card>
            <Card><div className="muted small">Equipment value</div><div style={{ fontSize: 24, fontWeight: 700 }}>{money(equipmentValue)}</div></Card>
            <Card><div className="muted small">Active devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{activeDevices}</div></Card>
          </div>
          <div className="grid cols-2">
            <Card><h3 style={{ marginTop: 0 }}>Orders by month</h3><Bars rows={monthly} /></Card>
            <Card><h3 style={{ marginTop: 0 }}>Units by brand</h3><Bars rows={brandMix} /></Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
