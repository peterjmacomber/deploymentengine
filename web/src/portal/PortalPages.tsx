import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddressInput, type DeployedEquipment, type Order, type ReturnCase, ReturnType } from '@de/shared';
import { api, ApiError } from '../api/client';
import { PortalLayout } from './PortalLayout';
import { Badge, Card, Kpi, Loading, StatusBadge } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { date, money, serialTag, titleCase } from '../lib/format';
import { deployedBrand } from '../lib/brand';

const BLANK_ADDR: AddressInput = { line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US' };

/** Button + modal for a merchant to place a new equipment order (shipping pre-filled). */
export function PortalOrderButton({ variant = 'primary' }: { variant?: 'primary' | 'plain' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [addr, setAddr] = useState<AddressInput | null>(null);
  const cat = useQuery({ queryKey: ['portal-catalog'], queryFn: api.portal.catalog, enabled: open });

  useEffect(() => {
    if (open && cat.data && addr === null) setAddr(cat.data.shippingAddress ?? { ...BLANK_ADDR });
  }, [open, cat.data, addr]);

  const bundles = cat.data?.bundles ?? [];
  const cart = Object.entries(qty).map(([id, q]) => ({ pospBundleId: Number(id), quantity: q })).filter((l) => l.quantity > 0);
  const total = cart.reduce((s, l) => { const b = bundles.find((x) => x.pospBundleId === l.pospBundleId); return s + (b?.accountingUnitPrice ?? 0) * l.quantity; }, 0);
  const addrOk = addr && addr.line1 && addr.city && addr.region && addr.postalCode;

  const place = useMutation({
    mutationFn: () => api.portal.createOrder({ cart, shippingAddress: addr ?? undefined }),
    onSuccess: () => {
      toast.push('Order placed — you can track it under Orders', 'success');
      qc.invalidateQueries({ queryKey: ['portal-orders'] });
      qc.invalidateQueries({ queryKey: ['portal-me'] });
      setOpen(false); setQty({}); setAddr(null);
    },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Could not place order', 'error'),
  });

  const setField = (k: keyof AddressInput, v: string) => setAddr((a) => ({ ...(a ?? BLANK_ADDR), [k]: v }));

  return (
    <>
      <button className={variant === 'primary' ? 'btn primary' : 'btn'} onClick={() => setOpen(true)}>Order equipment</button>
      {open && (
        <Modal
          title="Order equipment"
          onClose={() => setOpen(false)}
          footer={<>
            <div className="small muted" style={{ flex: 1 }}>{cart.length ? `${cart.reduce((s, l) => s + l.quantity, 0)} item(s) · ${money(total)}` : 'Select at least one item'}</div>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" disabled={!cart.length || !addrOk || place.isPending} onClick={() => place.mutate()}>{place.isPending ? 'Placing…' : 'Place order'}</button>
          </>}
        >
          {cat.isLoading ? <Loading /> : (
            <>
              <h4 style={{ margin: '0 0 8px' }}>Choose equipment</h4>
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {bundles.map((b) => (
                  <div key={b.pospBundleId} className="row between" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                    <div>
                      <div>{b.displayName}</div>
                      <div className="small muted">{b.pospApplication ?? b.application ?? ''}{b.accountingUnitPrice != null ? ` · ${money(b.accountingUnitPrice)}` : ''}</div>
                    </div>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <button className="btn sm" onClick={() => setQty((s) => ({ ...s, [b.pospBundleId]: Math.max(0, (s[b.pospBundleId] ?? 0) - 1) }))}>−</button>
                      <span className="mono" style={{ minWidth: 20, textAlign: 'center' }}>{qty[b.pospBundleId] ?? 0}</span>
                      <button className="btn sm" onClick={() => setQty((s) => ({ ...s, [b.pospBundleId]: (s[b.pospBundleId] ?? 0) + 1 }))}>+</button>
                    </div>
                  </div>
                ))}
                {bundles.length === 0 && <div className="small muted" style={{ padding: 10 }}>No equipment available to order right now.</div>}
              </div>

              <h4 style={{ margin: '16px 0 8px' }}>Ship to</h4>
              <p className="small muted" style={{ marginTop: 0 }}>Pre-filled from your account — edit if this order ships elsewhere.</p>
              <div className="field"><label>Street</label><input value={addr?.line1 ?? ''} onChange={(e) => setField('line1', e.target.value)} /></div>
              <div className="field"><label>Suite / unit (optional)</label><input value={addr?.line2 ?? ''} onChange={(e) => setField('line2', e.target.value)} /></div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 2 }}><label>City</label><input value={addr?.city ?? ''} onChange={(e) => setField('city', e.target.value)} /></div>
                <div className="field" style={{ flex: 1 }}><label>State</label><input value={addr?.region ?? ''} onChange={(e) => setField('region', e.target.value)} /></div>
                <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={addr?.postalCode ?? ''} onChange={(e) => setField('postalCode', e.target.value)} /></div>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

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
          <h3 style={{ margin: '0 0 4px' }}>Need more equipment or having trouble?</h3>
          <p className="small muted" style={{ margin: 0 }}>Order new devices shipped to your address, or tell us what’s wrong and we’ll help — with an automatic swap or return if needed.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <PortalOrderButton />
          <Link className="btn" to="/portal/report">Report an issue</Link>
        </div>
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
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="small muted">{rows.length} order(s)</span>
        <PortalOrderButton />
      </div>
      <Card>
        {orders.isLoading ? <Loading /> : rows.length === 0 ? <p className="small muted">No orders on your account yet. Use “Order equipment” to place your first order.</p> : (
          <table className="mini-table">
            <thead><tr><th>Order</th><th>Placed</th><th>Items</th><th>Status</th><th>Tracking</th><th>Serials</th><th></th></tr></thead>
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
      <td><Link className="btn sm" to={`/portal/report?order=${o.id}`}>Report an issue</Link></td>
    </tr>
  );
}

// --------------------------------------------------------------------------- Swaps / Returns
const isSwap = (r: ReturnCase) => r.items[0]?.returnType === ReturnType.REPLACEMENT;

const CASE_TYPES = [{ key: 'all', label: 'All' }, { key: 'swap', label: 'Swaps' }, { key: 'return', label: 'Returns' }] as const;

export function PortalCases() {
  const [sp, setSp] = useSearchParams();
  const type = (CASE_TYPES.some((t) => t.key === sp.get('type')) ? sp.get('type') : 'all') as 'all' | 'swap' | 'return';
  const setType = (t: 'all' | 'swap' | 'return') => { const next = new URLSearchParams(sp); if (t === 'all') next.delete('type'); else next.set('type', t); setSp(next, { replace: true }); };
  const q = useQuery({ queryKey: ['portal-returns'], queryFn: api.portal.returns });
  const all = q.data?.returns ?? [];
  const rows = all.filter((r) => type === 'all' || isSwap(r) === (type === 'swap'));
  const count = (t: 'all' | 'swap' | 'return') => all.filter((r) => t === 'all' || isSwap(r) === (t === 'swap')).length;
  return (
    <PortalLayout title="Returns & Swaps">
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {CASE_TYPES.map((t) => (
          <div key={t.key} className={`tab ${type === t.key ? 'active' : ''}`} onClick={() => setType(t.key)}>
            {t.label} <span className="badge gray" style={{ marginLeft: 4 }}>{count(t.key)}</span>
          </div>
        ))}
      </div>
      <Card>
        {q.isLoading ? <Loading /> : rows.length === 0 ? (
          <p className="small muted">Nothing here yet. Need a swap or return? <Link to="/portal/report">Report an issue</Link>.</p>
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
