import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Order, OrderClassification, OrderStatus, Permission, type ReturnCase, ReturnType } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card, Loading, StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { SerialLink } from '../components/SerialLink';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { date, money, titleCase } from '../lib/format';
import { bundleBrandMap, orderBrands } from '../lib/brand';

const TABS = ['Overview', 'Orders', 'Returns', 'Swaps', 'Analytics'] as const;
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
const isSwap = (r: ReturnCase): boolean => r.items[0]?.returnType === ReturnType.REPLACEMENT;
const rstatus = (r: ReturnCase): string => titleCase(r.pospStatus ?? r.lifecycle);
const trackingOf = (o: Order): string => o.packages.map((p) => p.trackingNumber).filter(Boolean).join(', ');

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

/** A returns/swaps table (kind selects which). */
function CaseTable({ rows, loading, navigate }: { rows: ReturnCase[]; loading: boolean; navigate: (p: string) => void }) {
  const ctl = useTableControls(rows, {
    search: (r) => `#${r.id} ${r.pospReturnId ?? ''} ${r.notes ?? ''} ${r.items[0]?.reasonCode ?? ''}`,
    searchPlaceholder: 'Search reason, notes…',
    dateField: (r) => r.createdAt,
    dateLabel: 'Opened',
    facets: [{ key: 'status', label: 'Status', value: (r) => rstatus(r) }],
  });
  return (
    <>
      {ctl.toolbar}
      <DataTable
        keyOf={(r) => r.id}
        rows={ctl.rows}
        loading={loading}
        empty="Nothing here for this merchant."
        onRowClick={(r) => navigate(`/returns/${r.id}`)}
        columns={[
          { header: 'RMA / #', sort: (r) => r.pospReturnId ?? r.id, cell: (r) => <span className="mono rowlink">{r.pospReturnId ? `RMA ${r.pospReturnId}` : `#${r.id}`}</span> },
          { header: 'Reason', sort: (r) => r.items[0]?.reasonCode ?? '', cell: (r) => <span className="small">{titleCase(r.items[0]?.reasonCode ?? '—')}</span> },
          { header: 'Status', sort: (r) => rstatus(r), cell: (r) => <StatusBadge status={r.pospStatus ?? r.lifecycle} /> },
          { header: 'Items', sort: (r) => r.expectedItemCount, cell: (r) => `${r.receivedItemCount}/${r.expectedItemCount}` },
          { header: 'Opened', sort: (r) => r.createdAt, cell: (r) => <span className="small">{date(r.createdAt)}</span> },
        ]}
      />
    </>
  );
}

export function MerchantDetail() {
  const { id } = useParams();
  const merchantId = Number(id);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('Overview');
  const can = useAuth((s) => s.can);
  const impersonate = useAuth((s) => s.impersonate);
  const toast = useToast();
  const qc = useQueryClient();
  const canManagePortal = can(Permission.USER_WRITE);
  const canImpersonate = can(Permission.MERCHANT_IMPERSONATE);

  const mq = useQuery({ queryKey: ['merchant', merchantId], queryFn: () => api.merchants.get(merchantId), enabled: Number.isFinite(merchantId) });
  const oq = useQuery({ queryKey: ['orders', 'merchant', merchantId], queryFn: () => api.orders.list({ merchantId }) });
  const rq = useQuery({ queryKey: ['returns', 'merchant', merchantId], queryFn: () => api.returns.list({ merchantId }) });
  const dq = useQuery({ queryKey: ['deployed', 'merchant', merchantId], queryFn: () => api.deployed.list({ merchantId }) });
  const bq = useQuery({ queryKey: ['bundles'], queryFn: api.bundles.list });
  const puq = useQuery({ queryKey: ['portal-users', merchantId], queryFn: () => api.merchants.portalUsers(merchantId), enabled: canManagePortal && Number.isFinite(merchantId) });

  const [pu, setPu] = useState({ name: '', email: '', password: '' });
  const [showAddPortal, setShowAddPortal] = useState(false);
  const createPortalUser = useMutation({
    mutationFn: () => api.merchants.createPortalUser(merchantId, pu),
    onSuccess: () => { toast.push('Portal login created', 'success'); setPu({ name: '', email: '', password: '' }); setShowAddPortal(false); qc.invalidateQueries({ queryKey: ['portal-users', merchantId] }); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Could not create login', 'error'),
  });
  const enterAsMerchant = async () => {
    try { await impersonate(merchantId); navigate('/portal'); }
    catch (e) { toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Could not start impersonation', 'error'); }
  };

  const merchant = mq.data?.merchant;
  const orders = useMemo(() => oq.data?.orders ?? [], [oq.data]);
  const cases = rq.data?.returns ?? [];
  const returnsList = cases.filter((r) => !isSwap(r));
  const swapsList = cases.filter(isSwap);
  const deployed = dq.data?.equipment ?? [];
  const brandMap = useMemo(() => bundleBrandMap(bq.data?.bundles), [bq.data]);

  const totalUnits = orders.reduce((s, o) => s + unitsOf(o), 0);
  const equipmentValue = orders.reduce((s, o) => s + valueOf(o), 0);
  const activeDevices = deployed.filter((d) => d.status === 'ACTIVE').length;
  const openCases = cases.filter((r) => !['CLOSED', 'CANCELLED', 'DENIED'].includes(r.lifecycle)).length;
  const sortedByDate = useMemo(() => [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [orders]);
  const firstOrder = sortedByDate[0]?.createdAt;
  const lastOrder = sortedByDate[sortedByDate.length - 1]?.createdAt;

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

  const mfrMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) for (const b of orderBrands(o, brandMap)) m.set(b, (m.get(b) ?? 0) + unitsOf(o));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [orders, brandMap]);
  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) { const k = o.createdAt.slice(0, 7); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([label, value]) => ({ label, value }));
  }, [orders]);

  const orderCtl = useTableControls(orders, {
    search: (o) => `${o.reference ?? ''} ${o.lines.map((l) => l.name).join(' ')} ${trackingOf(o)}`,
    searchPlaceholder: 'Search reference, item, tracking…',
    dateField: (o) => o.createdAt,
    dateLabel: 'Ordered',
    facets: [
      { key: 'phase', label: 'Phase', value: (o) => phaseOf(o) },
      { key: 'origin', label: 'Origin', value: (o) => originOf(o) },
      { key: 'class', label: 'Type', value: (o) => titleCase(o.classification) },
    ],
  });

  if (mq.isLoading) return <AppShell title="Merchant"><Loading /></AppShell>;
  if (!merchant) return <AppShell title="Merchant"><Card>Merchant not found. <Link to="/merchants">Back to merchants</Link></Card></AppShell>;

  const title = merchant.dbaName ?? `Merchant #${merchant.id}`;

  return (
    <AppShell
      title={title}
      crumb={{ parent: 'Merchants', to: '/merchants' }}
      actions={
        <div className="row" style={{ gap: 8 }}>
          {canImpersonate && <button className="btn" onClick={enterAsMerchant}>View as merchant</button>}
        </div>
      }
    >
      <div className="meta-strip">
        <div className="meta-item"><div className="meta-label">MID</div><div className="meta-value mono">{merchant.mid ?? '—'}</div></div>
        {merchant.primaryContact && <div className="meta-item"><div className="meta-label">Contact</div><div className="meta-value">{merchant.primaryContact}</div></div>}
        {merchant.email && <div className="meta-item"><div className="meta-label">Email</div><div className="meta-value mono">{merchant.email}</div></div>}
        {merchant.phone && <div className="meta-item"><div className="meta-label">Phone</div><div className="meta-value">{merchant.phone}</div></div>}
        {merchant.shippingAddress && (
          <div className="meta-item"><div className="meta-label">Ships to</div><div className="meta-value">{merchant.shippingAddress.city}, {merchant.shippingAddress.region}</div></div>
        )}
        <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          {merchant.fortisLocationId
            ? <Badge tone="green">Fortis Gateway · {merchant.fortisLocationName ?? 'Linked'}</Badge>
            : <span className="small muted">Fortis Gateway · Not linked · <Link className="rowlink" to="/fortis">link</Link></span>}
        </div>
      </div>

      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Orders' && <span className="badge gray" style={{ marginLeft: 6 }}>{orders.length}</span>}
            {t === 'Returns' && returnsList.length > 0 && <span className="badge gray" style={{ marginLeft: 6 }}>{returnsList.length}</span>}
            {t === 'Swaps' && swapsList.length > 0 && <span className="badge gray" style={{ marginLeft: 6 }}>{swapsList.length}</span>}
          </div>
        ))}
      </div>

      {tab === 'Overview' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{orders.length}</div></Card>
            <Card><div className="muted small">Units ordered</div><div style={{ fontSize: 24, fontWeight: 700 }}>{totalUnits}</div></Card>
            <Card><div className="muted small">Active devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{activeDevices}</div></Card>
            <Card><div className="muted small">Open returns/swaps</div><div style={{ fontSize: 24, fontWeight: 700 }}>{openCases}</div></Card>
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

          {canManagePortal && (
            <Card style={{ marginTop: 16 }}>
              <div className="row between">
                <div>
                  <h3 style={{ margin: 0 }}>Portal access</h3>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>Self-service logins for this merchant. They only see this account’s orders, swaps, returns and analytics.</p>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {canImpersonate && <button className="btn sm" onClick={enterAsMerchant}>👁 View as merchant</button>}
                  <button className="btn primary sm" onClick={() => setShowAddPortal((v) => !v)}>{showAddPortal ? 'Cancel' : '+ Add login'}</button>
                </div>
              </div>

              {showAddPortal && (
                <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1, minWidth: 150, margin: 0 }}><label>Name</label><input value={pu.name} onChange={(e) => setPu({ ...pu, name: e.target.value })} /></div>
                  <div className="field" style={{ flex: 1, minWidth: 180, margin: 0 }}><label>Email</label><input value={pu.email} onChange={(e) => setPu({ ...pu, email: e.target.value })} /></div>
                  <div className="field" style={{ flex: 1, minWidth: 150, margin: 0 }}><label>Temp password</label><input value={pu.password} onChange={(e) => setPu({ ...pu, password: e.target.value })} placeholder="min 10 chars" /></div>
                  <button className="btn primary" disabled={createPortalUser.isPending || !pu.name || !pu.email || pu.password.length < 10} onClick={() => createPortalUser.mutate()}>{createPortalUser.isPending ? 'Creating…' : 'Create'}</button>
                </div>
              )}

              <table className="mini-table" style={{ marginTop: 12 }}>
                <thead><tr><th>Name</th><th>Email</th><th>Last sign-in</th></tr></thead>
                <tbody>
                  {(puq.data?.users ?? []).length === 0 && <tr><td colSpan={3} className="small muted">No portal logins yet.</td></tr>}
                  {(puq.data?.users ?? []).map((u) => (
                    <tr key={u.id}><td>{u.name}</td><td className="small mono">{u.email}</td><td className="small">{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
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
              { header: 'Items', sort: (o) => unitsOf(o), cell: (o) => unitsOf(o) },
              { header: 'Serials', sort: (o) => o.serialNumbers.length, cell: (o) => (o.serialNumbers.length ? <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{o.serialNumbers.slice(0, 4).map((s) => <SerialLink key={s} serial={s} />)}{o.serialNumbers.length > 4 && <span className="small muted">+{o.serialNumbers.length - 4}</span>}</div> : <span className="muted">—</span>) },
              { header: 'Tracking', sort: (o) => trackingOf(o), cell: (o) => (o.packages[0]?.trackingNumber ? <span className="small">{o.shippingCarrier ?? o.packages[0].carrier ?? ''} <span className="mono">{o.packages[0].trackingNumber}</span></span> : <span className="muted small">—</span>) },
              { header: 'Origin', sort: (o) => originOf(o), cell: (o) => <span className="small">{o.originLinkName ?? titleCase(o.method)}</span> },
              { header: 'Ordered', sort: (o) => o.createdAt, cell: (o) => <span className="small">{date(o.createdAt)}</span> },
            ]}
          />
        </>
      )}

      {tab === 'Returns' && <CaseTable rows={returnsList} loading={rq.isLoading} navigate={navigate} />}
      {tab === 'Swaps' && <CaseTable rows={swapsList} loading={rq.isLoading} navigate={navigate} />}

      {tab === 'Analytics' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Lifetime orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{orders.length}</div></Card>
            <Card><div className="muted small">Units ordered</div><div style={{ fontSize: 24, fontWeight: 700 }}>{totalUnits}</div></Card>
            <Card><div className="muted small">Equipment value</div><div style={{ fontSize: 24, fontWeight: 700 }}>{money(equipmentValue)}</div></Card>
            <Card><div className="muted small">Active devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{activeDevices}</div></Card>
          </div>

          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Forecast (from this merchant's history)</h3>
            <div className="grid cols-4">
              <div><div className="muted small">Units / month</div><div style={{ fontSize: 20, fontWeight: 700 }}>{forecast.unitsPerMonth.toFixed(1)}</div></div>
              <div><div className="muted small">Reorder cadence</div><div style={{ fontSize: 20, fontWeight: 700 }}>{forecast.avgIntervalDays ? `${Math.round(forecast.avgIntervalDays)}d` : '—'}</div></div>
              <div><div className="muted small">Projected next order</div><div style={{ fontSize: 16, fontWeight: 700 }}>{forecast.nextEta ? date(forecast.nextEta) : '—'}</div></div>
              <div><div className="muted small">Suggested qty</div><div style={{ fontSize: 20, fontWeight: 700 }}>{forecast.n > 0 ? forecast.suggestedQty : '—'}</div></div>
            </div>
          </Card>

          <div className="grid cols-2">
            <Card><h3 style={{ marginTop: 0 }}>Orders by month</h3><Bars rows={monthly} /></Card>
            <Card><h3 style={{ marginTop: 0 }}>Units by manufacturer</h3><Bars rows={mfrMix} /></Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
