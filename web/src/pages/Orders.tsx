import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type Order, OrderClassification, OrderStatus, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { SectionNav } from '../components/SectionNav';
import { Badge, StatusBadge } from '../components/ui';
import { type Column, DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { useVisibleColumns } from '../components/ColumnPicker';
import { SerialLink } from '../components/SerialLink';
import { ReturnSwapModal } from '../components/ReturnSwapModal';
import { FortisActivateModal } from '../components/FortisActivateModal';
import { api } from '../api/client';
import { useAuth } from '../stores/authStore';
import { date, money, titleCase } from '../lib/format';

/**
 * Internal / no-outbound orders: transfers and consigned inventory movements. POS Portal flags
 * these with the "No Outbound Shipment" service level and a NON_CARRIER carrier (verified against
 * the sandbox Fortis-SELLOVER consignment orders) — no package ever ships to a merchant.
 */
export const isNoOutbound = (o: Order): boolean =>
  o.shippingCarrier?.toUpperCase() === 'NON_CARRIER' || /no outbound/i.test(o.shippingMethodLabel ?? '');

const PHASES: { key: string; label: string; match: (o: Order) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'pending', label: 'Pending shipment', match: (o) => !isNoOutbound(o) && ([OrderStatus.DRAFT, OrderStatus.PLACED, OrderStatus.IN_PREP, OrderStatus.BACKORDERED] as OrderStatus[]).includes(o.status) },
  { key: 'shipped', label: 'Shipped', match: (o) => !isNoOutbound(o) && ([OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RESHIPPED] as OrderStatus[]).includes(o.status) },
  { key: 'delivered', label: 'Delivered', match: (o) => !isNoOutbound(o) && o.status === OrderStatus.DELIVERED },
  { key: 'noOutbound', label: 'No Outbound', match: (o) => isNoOutbound(o) },
  { key: 'swaps', label: 'Swaps in progress', match: (o) => o.classification === OrderClassification.REPLACEMENT && !([OrderStatus.DELIVERED, OrderStatus.CANCELLED] as OrderStatus[]).includes(o.status) },
  { key: 'returned', label: 'Returned', match: (o) => ([OrderStatus.RETURNED, OrderStatus.RETURNED_HOLDING] as OrderStatus[]).includes(o.status) },
  { key: 'cancelled', label: 'Cancelled', match: (o) => o.status === OrderStatus.CANCELLED },
];

const units = (o: Order) => o.lines.reduce((s, l) => s + l.quantity, 0);

export function Orders() {
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const [phase, setPhase] = useState('all');
  const [swapOrder, setSwapOrder] = useState<Order | null>(null);
  const [fortisOrder, setFortisOrder] = useState<Order | null>(null);

  // One fetch; phases + controls filter client-side. Auto-refreshes so poller updates surface.
  const { data, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders.list({}),
    refetchInterval: 30_000,
  });

  const orders = data?.orders ?? [];
  const ctl = useTableControls(orders, {
    search: (o) => `${o.reference ?? ''} ${o.merchant.dbaName ?? ''} ${o.merchant.mid ?? ''} ${o.lines.map((l) => l.name).join(' ')} ${o.serialNumbers.join(' ')}`,
    searchPlaceholder: 'Search reference, merchant, item, serial…',
    dateField: (o) => o.createdAt,
    dateLabel: 'Placed',
    facets: [
      { key: 'origin', label: 'Origin', value: (o) => (o.originLinkName ? 'Deployment link' : titleCase(o.method)) },
      { key: 'type', label: 'Type', value: (o) => titleCase(o.classification) },
      { key: 'carrier', label: 'Carrier', value: (o) => o.shippingCarrier ?? '—' },
    ],
  });
  const [sp, setSp] = useSearchParams();
  const statusParam = sp.get('status') ?? '';
  const active = PHASES.find((p) => p.key === phase) ?? PHASES[0];
  const rows = ctl.rows.filter(active.match).filter((o) => !statusParam || o.status === statusParam);
  const countOf = (p: (typeof PHASES)[number]) => ctl.rows.filter(p.match).length;

  const allColumns: Column<Order>[] = [
    { key: 'reference', label: 'Reference', header: 'Reference', sort: (o) => o.reference ?? '', cell: (o) => <span className="mono">{o.reference}</span> },
    {
      key: 'merchant', label: 'Merchant', header: 'Merchant',
      sort: (o) => (o.merchant.dbaName ?? o.merchant.mid ?? '').toLowerCase(),
      cell: (o) => (
        <div>
          <Link className="rowlink" to={`/merchants/${o.merchant.id}`} onClick={(e) => e.stopPropagation()}>{o.merchant.dbaName ?? '—'}</Link>
          <div className="small muted mono">{o.merchant.mid}</div>
        </div>
      ),
    },
    { key: 'type', label: 'Type', header: 'Type', sort: (o) => o.classification, cell: (o) => (isNoOutbound(o) ? <Badge tone="gray">Internal transfer</Badge> : <span className="small">{titleCase(o.classification)}</span>) },
    { key: 'items', label: 'Items', header: 'Items', sort: (o) => units(o), cell: (o) => units(o) },
    {
      key: 'serials', label: 'Serials', header: 'Serials',
      sort: (o) => o.serialNumbers.length,
      cell: (o) => (o.serialNumbers.length
        ? <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {o.serialNumbers.slice(0, 6).map((s) => <SerialLink key={s} serial={s} />)}
            {o.serialNumbers.length > 6 && <span className="small muted">+{o.serialNumbers.length - 6}</span>}
          </div>
        : o.status === OrderStatus.CANCELLED
          ? <span className="muted">—</span>
          : isNoOutbound(o)
            ? <Badge tone="gray">Internal transfer</Badge>
            : <Badge tone="amber">Pending</Badge>),
    },
    { key: 'origin', label: 'Origin', header: 'Origin', sort: (o) => (o.originLinkName ? `link ${o.originLinkName}` : titleCase(o.method)), cell: (o) => (o.originLinkName ? <span className="small"><span className="badge teal">link</span> {o.originLinkName}</span> : <span className="small muted">{titleCase(o.method)}</span>) },
    { key: 'shipping', label: 'Shipping method', header: 'Shipping', sort: (o) => o.shippingMethodLabel ?? '', cell: (o) => <span className="small">{o.shippingMethodLabel ?? '—'}</span> },
    { key: 'carrier', label: 'Carrier', header: 'Carrier', sort: (o) => o.shippingCarrier ?? '', cell: (o) => <span className="small">{o.shippingCarrier ?? '—'}</span> },
    { key: 'total', label: 'Order total', header: 'Total', sort: (o) => o.total ?? -1, cell: (o) => (o.total != null ? money(o.total) : '—') },
    { key: 'status', label: 'Status', header: 'Status', sort: (o) => o.status, cell: (o) => <StatusBadge status={o.status} /> },
    { key: 'placed', label: 'Placed', header: 'Placed', sort: (o) => o.createdAt, cell: (o) => <span className="small">{date(o.createdAt)}</span> },
    { key: 'shipDate', label: 'Ship date', header: 'Shipped', sort: (o) => o.shipDate ?? '', cell: (o) => <span className="small">{date(o.shipDate)}</span> },
    ...(can(Permission.ORDER_WRITE)
      ? [{
          header: '',
          cell: (o: Order) => (
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); setFortisOrder(o); }} style={{ backgroundColor: '#2563eb', color: 'white' }}>
                Fortis Activate
              </button>
            </div>
          ),
        }]
      : []),
    ...(can(Permission.RETURN_WRITE)
      ? [{ header: '', cell: (o: Order) => <button className="btn sm" onClick={(e) => { e.stopPropagation(); setSwapOrder(o); }}>Return/Swap</button> }]
      : []),
  ];
  const { columns, menu } = useVisibleColumns('orders', allColumns, ['reference', 'merchant', 'items', 'serials', 'origin', 'status', 'placed']);

  return (
    <AppShell
      title="Orders"
      actions={can(Permission.ORDER_WRITE) && <button className="btn primary" onClick={() => navigate('/orders/new')}>+ New Order</button>}
    >
      <SectionNav tabs={[{ to: '/orders', label: 'Orders', end: true }, { to: '/deployed', label: 'Deployed Equipment' }]} />

      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>{ctl.toolbar}</div>
        {menu}
      </div>
      {statusParam && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="badge teal">Status: {titleCase(statusParam)}
            <button className="linklike" style={{ marginLeft: 8 }} onClick={() => setSp({}, { replace: true })}>✕</button>
          </span>
        </div>
      )}

      <div className="chips">
        {PHASES.map((p) => (
          <button key={p.key} type="button" className={`chip ${phase === p.key ? 'active' : ''}`} onClick={() => setPhase(p.key)}>
            {p.label} <span className="chip-count">{countOf(p)}</span>
          </button>
        ))}
      </div>

      <DataTable
        keyOf={(o) => o.id}
        rows={rows}
        loading={isLoading}
        onRowClick={(o) => navigate(`/orders/${o.id}`)}
        empty="No orders match."
        columns={columns}
      />
      {swapOrder && <ReturnSwapModal order={swapOrder} onClose={() => setSwapOrder(null)} />}
      {fortisOrder && <FortisActivateModal order={fortisOrder} onClose={() => setFortisOrder(null)} />}
    </AppShell>
  );
}
