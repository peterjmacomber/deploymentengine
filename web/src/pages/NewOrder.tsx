import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AddressValidationResult, ShippingMethod } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Card, Loading } from '../components/ui';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { money } from '../lib/format';

const EMPTY_ADDR = { merchantName: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US' };

export function NewOrder() {
  const navigate = useNavigate();
  const toast = useToast();

  const bundles = useQuery({ queryKey: ['bundles-active'], queryFn: api.bundles.listActive });
  const [merchantMode, setMerchantMode] = useState<'existing' | 'new'>('existing');
  const [merchantSearch, setMerchantSearch] = useState('');
  const [merchantId, setMerchantId] = useState<number | undefined>();
  const [newMerchant, setNewMerchant] = useState({ dbaName: '', legalName: '', mid: '', email: '', phone: '' });
  const [mid, setMid] = useState('');
  const merchants = useQuery({ queryKey: ['merchants', merchantSearch], queryFn: () => api.merchants.list(merchantSearch || undefined) });

  const [cart, setCart] = useState<Record<number, number>>({});
  const [addr, setAddr] = useState({ ...EMPTY_ADDR });
  const [validation, setValidation] = useState<AddressValidationResult | null>(null);
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [methodId, setMethodId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  const cartLines = useMemo(() => Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ pospBundleId: Number(id), quantity: q })), [cart]);
  const selectedMerchant = merchants.data?.merchants.find((m) => m.id === merchantId);

  const setQty = (id: number, q: number) => setCart((c) => ({ ...c, [id]: Math.max(0, q) }));

  const prefillFromMerchant = (id: number) => {
    setMerchantId(id);
    const m = merchants.data?.merchants.find((x) => x.id === id);
    setMid(m?.mid ?? '');
    if (m?.shippingAddress) setAddr({ ...EMPTY_ADDR, ...m.shippingAddress, merchantName: m.dbaName ?? '' });
  };

  const validateAddress = async () => {
    setValidation(null);
    try {
      const res = await api.shipping.validateAddress(addr);
      setValidation(res);
      if (res.valid && res.normalized) setAddr((a) => ({ ...a, ...res.normalized }));
      if (res.valid && cartLines.length) {
        const q = await api.shipping.quote({ address: res.normalized ?? addr, cart: cartLines });
        setMethods(q.methods);
        setMethodId(q.methods[0]?.id);
      }
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : 'Validation failed', 'error');
    }
  };

  const canPlace = cartLines.length > 0 && validation?.valid && !!mid.trim() && (merchantMode === 'existing' ? !!merchantId : !!newMerchant.dbaName);

  const placeOrder = async () => {
    setBusy(true);
    try {
      const { order } = await api.orders.create({
        merchantId: merchantMode === 'existing' ? merchantId : undefined,
        merchant: merchantMode === 'new' ? { ...newMerchant, mid, shippingAddress: addr } : undefined,
        mid,
        cart: cartLines,
        shippingAddress: addr,
        shippingMethodId: methodId,
      });
      toast.push(`Order ${order.reference} created`, 'success');
      navigate(`/orders/${order.id}`);
    } catch (e) {
      toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Order failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="New Order" actions={<button className="btn" onClick={() => navigate('/orders')}>← Orders</button>}>
      <div className="grid cols-2">
        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Card>
            <h3>1 · Merchant</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <label className="inline"><input type="radio" checked={merchantMode === 'existing'} onChange={() => setMerchantMode('existing')} /> Existing</label>
              <label className="inline"><input type="radio" checked={merchantMode === 'new'} onChange={() => setMerchantMode('new')} /> New merchant</label>
            </div>
            <div className="field">
              <label>MID *</label>
              <input value={mid} onChange={(e) => setMid(e.target.value)} placeholder="Merchant ID — links this order across systems" />
              <div className="hint">Required. This is the cross-system linking identifier.</div>
            </div>
            {merchantMode === 'existing' ? (
              <>
                <input placeholder="Search DBA or MID…" value={merchantSearch} onChange={(e) => setMerchantSearch(e.target.value)} style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }} />
                <div style={{ maxHeight: 180, overflow: 'auto' }}>
                  {merchants.data?.merchants.map((m) => (
                    <label key={m.id} className="row" style={{ padding: '6px 4px', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" checked={merchantId === m.id} onChange={() => prefillFromMerchant(m.id)} />
                      <span>{m.dbaName} <span className="muted mono small">{m.mid}</span></span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <div>
                {(['dbaName', 'legalName', 'email', 'phone'] as const).map((f) => (
                  <div className="field" key={f}>
                    <label style={{ textTransform: 'capitalize' }}>{f === 'dbaName' ? 'DBA name' : f}</label>
                    <input value={newMerchant[f]} onChange={(e) => setNewMerchant({ ...newMerchant, [f]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3>2 · Shipping address</h3>
            {(['line1', 'line2'] as const).map((f) => (
              <div className="field" key={f}><label>{f === 'line1' ? 'Street' : 'Suite / Unit'}</label><input value={addr[f]} onChange={(e) => setAddr({ ...addr, [f]: e.target.value })} /></div>
            ))}
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 2 }}><label>City</label><input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label>State</label><input value={addr.region} onChange={(e) => setAddr({ ...addr, region: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} /></div>
            </div>
            <button className="btn" onClick={validateAddress}>Validate address</button>
            {validation && (
              <div className="small" style={{ marginTop: 10, color: validation.valid ? 'var(--ok)' : 'var(--danger)' }}>
                {validation.messages.join(' ')}
              </div>
            )}
          </Card>
        </div>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Card>
            <h3>3 · Bundles</h3>
            {bundles.isLoading ? <Loading /> : bundles.data?.bundles.map((b) => (
              <div key={b.pospBundleId} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div>{b.displayName}</div>
                  <div className="small muted">{b.application?.replace(/_/g, ' ')} · {money(b.accountingUnitPrice)}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setQty(b.pospBundleId, (cart[b.pospBundleId] ?? 0) - 1)}>−</button>
                  <span style={{ width: 22, textAlign: 'center' }}>{cart[b.pospBundleId] ?? 0}</span>
                  <button className="btn sm" onClick={() => setQty(b.pospBundleId, (cart[b.pospBundleId] ?? 0) + 1)}>+</button>
                </div>
              </div>
            ))}
          </Card>

          <Card>
            <h3>4 · Shipping method</h3>
            {methods.length === 0 ? (
              <div className="muted small">Validate a US address with items in the cart to load rates.</div>
            ) : (
              methods.map((m) => (
                <label key={m.id} className="row" style={{ gap: 8, padding: '5px 0' }}>
                  <input type="radio" checked={methodId === m.id} onChange={() => setMethodId(m.id)} />
                  {m.name} — {money(m.rate)} {m.estimatedDays ? <span className="muted small">({m.estimatedDays}d)</span> : null}
                </label>
              ))
            )}
          </Card>

          <Card>
            <div className="row between">
              <div><div className="muted small">Total units</div><strong style={{ fontSize: 20 }}>{cartLines.reduce((s, l) => s + l.quantity, 0)}</strong></div>
              <button className="btn primary" disabled={!canPlace || busy} onClick={placeOrder}>{busy ? 'Placing…' : 'Place order'}</button>
            </div>
            {selectedMerchant && <div className="small muted" style={{ marginTop: 8 }}>Ordering for {selectedMerchant.dbaName}</div>}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
