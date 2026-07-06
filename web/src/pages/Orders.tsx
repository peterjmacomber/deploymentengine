import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type Order, OrderClassification, OrderStatus, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { SectionNav } from '../components/SectionNav';
import { StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { ReturnSwapModal } from '../components/ReturnSwapModal';
import { api } from '../api/client';
import { useAuth } from '../stores/authStore';
import { date, titleCase } from '../lib/format';
import { bundleBrandMap, orderBrands } from '../lib/brand';

const PHASES: { key: string; label: string; match: (o: Order) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'pending', label: 'Pending shipment', match: (o) => ([OrderStatus.DRAFT, OrderStatus.PLACED, OrderStatus.IN_PREP, OrderStatus.BACKORDERED] as OrderStatus[]).includes(o.status) },
  { key: 'shipped', label: 'Shipped', match: (o) => ([OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RESHIPPED] as OrderStatus[]).includes(o.status) },
  { key: 'delivered', label: 'Delivered', match: (o) => o.status === OrderStatus.DELIVERED },
  { key: 'swaps', label: 'Swaps in progress', match: (o) => o.classification === OrderClassification.REPLACEMENT && !([OrderStatus.DELIVERED, OrderStatus.CANCELLED] as OrderStatus[]).includes(o.status) },
  { key: 'returned', label: 'Returned', match: (o) => ([OrderStatus.RETURNED, OrderStatus.RETURNED_HOLDING] as OrderStatus[]).includes(o.status) },
  { key: 'cancelled', label: 'Cancelled', match: (o) => o.status === OrderStatus.CANCELLED },
];

export function Orders() {
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const [phase, setPhase] = useState('all');
  const [swapOrder, setSwapOrder] = useState<Order | null>(null);

  // One fetch; phases + controls filter client-side. Auto-refreshes so poller updates surface.
  const { data, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders.list({}),
    refetchInterval: 30_000,
  });
  const bq = useQuery({ queryKey: ['bundles'], queryFn: api.bundles.list });
  const brandMap = useMemo(() => bundleBrandMap(bq.data?.bundles), [bq.data]);

  const orders = data?.orders ?? [];
  const ctl = useTableControls(orders, {
    search: (o) => `${o.reference ?? ''} ${o.merchant.dbaName ?? ''} ${o.merchant.mid ?? ''} ${o.lines.map((l) => l.name).join(' ')} ${o.serialNumbers.join(' ')}`,
    searchPlaceholder: 'Search reference, merchant, item, serial…',
    dateField: (o) => o.createdAt,
    dateLabel: 'Placed',
    facets: [
      { key: 'brand', label: 'Brand', value: (o) => orderBrands(o, brandMap) },
      { key: 'origin', label: 'Origin', value: (o) => (o.originLinkName ? 'Deployment link' : titleCase(o.method)) },
      { key: 'type', label: 'Type', value: (o) => titleCase(o.classification) },
    ],
  });
  const [sp, setSp] = useSearchParams();
  const statusParam = sp.get('status') ?? '';
  const active = PHASES.find((p) => p.key === phase) ?? PHASES[0];
  const rows = ctl.rows.filter(active.match).filter((o) => !statusParam || o.status === statusParam);
  const countOf = (p: (typeof PHASES)[number]) => ctl.rows.filter(p.match).length;

  return (
    <AppShell
      title="Orders"
      actions={can(Permission.ORDER_WRITE) && <button className="btn primary" onClick={() => navigate('/orders/new')}>+ New Order</button>}
    >
      <SectionNav tabs={[{ to: '/orders', label: 'Orders', end: true }, { to: '/deployed', label: 'Deployed Equipment' }]} />
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {PHASES.map((p) => (
          <div key={p.key} className={`tab ${phase === p.key ? 'active' : ''}`} onClick={() => setPhase(p.key)}>
            {p.label} <span className="badge gray" style={{ marginLeft: 4 }}>{countOf(p)}</span>
          </div>
        ))}
      </div>

      {ctl.toolbar}
      {statusParam && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="badge teal">Status: {titleCase(statusParam)}
            <button className="linklike" style={{ marginLeft: 8 }} onClick={() => setSp({}, { replace: true })}>✕</button>
          </span>
        </div>
      )}

      <DataTable
        keyOf={(o) => o.id}
        rows={rows}
        loading={isLoading}
        onRowClick={(o) => navigate(`/orders/${o.id}`)}
        empty="No orders match."
        columns={[
          { header: 'Reference', sort: (o) => o.reference ?? '', cell: (o) => <span className="mono">{o.reference}</span> },
          {
            header: 'Merchant',
            sort: (o) => (o.merchant.dbaName ?? o.merchant.mid ?? '').toLowerCase(),
            cell: (o) => (
              <div>
                <Link className="rowlink" to={`/merchants/${o.merchant.id}`} onClick={(e) => e.stopPropagation()}>{o.merchant.dbaName ?? '—'}</Link>
                <div className="small muted mono">{o.merchant.mid}</div>
              </div>
            ),
          },
          { header: 'Brand', sort: (o) => orderBrands(o, brandMap).join(','), cell: (o) => <span className="small">{orderBrands(o, brandMap).join(', ') || '—'}</span> },
          { header: 'Items', sort: (o) => o.lines.reduce((s, l) => s + l.quantity, 0), cell: (o) => o.lines.reduce((s, l) => s + l.quantity, 0) },
          { header: 'Serials', sort: (o) => o.serialNumbers.length, cell: (o) => (o.serialNumbers.length ? o.serialNumbers.length : '—') },
          { header: 'Origin', sort: (o) => (o.originLinkName ? `link ${o.originLinkName}` : titleCase(o.method)), cell: (o) => (o.originLinkName ? <span className="small"><span className="badge teal">link</span> {o.originLinkName}</span> : <span className="small muted">{titleCase(o.method)}</span>) },
          { header: 'Status', sort: (o) => o.status, cell: (o) => <StatusBadge status={o.status} /> },
          { header: 'Placed', sort: (o) => o.createdAt, cell: (o) => <span className="small">{date(o.createdAt)}</span> },
          ...(can(Permission.RETURN_WRITE)
            ? [{ header: '', cell: (o: Order) => <button className="btn sm" onClick={(e) => { e.stopPropagation(); setSwapOrder(o); }}>Return/Swap</button> }]
            : []),
        ]}
      />
      {swapOrder && <ReturnSwapModal order={swapOrder} onClose={() => setSwapOrder(null)} />}
    </AppShell>
  );
}
