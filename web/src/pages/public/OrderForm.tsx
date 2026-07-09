import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ShippingMethod } from '@de/shared';
import { publicApi, ApiError } from '../../api/client';
import { money } from '../../lib/format';
import type { ApplyPayload } from './Apply';
import { PublicBand } from './PublicBand';

export function OrderForm() {
  const navigate = useNavigate();
  const apply = useMemo<ApplyPayload | null>(() => {
    const raw = sessionStorage.getItem('de_apply');
    return raw ? (JSON.parse(raw) as ApplyPayload) : null;
  }, []);

  const bundles = useQuery({ queryKey: ['public-bundles'], queryFn: publicApi.bundles });
  const [selected, setSelected] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [methodId, setMethodId] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ id: number; reference?: string; redirectUrl?: string } | null>(null);

  useEffect(() => { if (!apply) navigate('/apply'); }, [apply, navigate]);

  useEffect(() => {
    if (!apply || selected == null) return;
    publicApi
      .quote({ address: apply.shippingAddress, cart: [{ pospBundleId: selected, quantity: qty }] })
      .then((r) => { setMethods(r.methods); setMethodId(r.methods[0]?.id); })
      .catch(() => setMethods([]));
  }, [apply, selected, qty]);

  if (!apply) return null;

  const place = async () => {
    if (selected == null) return;
    setBusy(true);
    setError('');
    try {
      const res = await publicApi.createOrder({
        applicant: apply.applicant,
        shippingAddress: apply.shippingAddress,
        cart: [{ pospBundleId: selected, quantity: qty }],
        shippingMethodId: methodId,
        returnUrl: apply.returnUrl,
      });
      setPlaced({ id: res.order.id, reference: res.order.reference, redirectUrl: res.redirectUrl });
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Could not place order');
    } finally {
      setBusy(false);
    }
  };

  if (placed) {
    return (
      <><PublicBand title="Order Confirmed" />
      <div className="public-shell">
        <div className="steps"><div className="step">1 · Your business</div><div className="step">2 · Choose equipment</div><div className="step active">3 · Confirmation</div></div>
        <div className="card">
          <h2>✓ Thank you, {apply.applicant.dbaName}!</h2>
          <p>Your equipment order <strong className="mono">{placed.reference}</strong> has been submitted and is visible to the FortisPay deployment team.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => navigate(`/track/${placed.id}`)}>Track my order →</button>
            {placed.redirectUrl && <a className="btn" href={placed.redirectUrl}>Return to application</a>}
          </div>
        </div>
      </div></>
    );
  }

  return (
    <><PublicBand title="Choose Your Equipment" meta={apply.applicant.dbaName} />
    <div className="public-shell">
      <div className="steps"><div className="step">1 · Your business</div><div className="step active">2 · Choose equipment</div><div className="step">3 · Confirmation</div></div>

      <div className="grid" style={{ gap: 12 }}>
        {bundles.data?.bundles.map((b) => (
          <div key={b.pospBundleId} className={`bundle-card ${selected === b.pospBundleId ? 'selected' : ''}`} onClick={() => setSelected(b.pospBundleId)}>
            <div className="row between">
              <strong>{b.displayName}</strong>
              <span className="badge teal">{money(b.price)}</span>
            </div>
            <div className="small muted" style={{ margin: '6px 0' }}>{b.description}</div>
            <div className="row" style={{ gap: 6 }}>{b.items.map((it) => <span key={it.sku} className="badge gray">{it.name}</span>)}</div>
          </div>
        ))}
      </div>

      {selected != null && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="muted small">Qty</span>
              <button className="btn sm" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span style={{ width: 22, textAlign: 'center' }}>{qty}</span>
              <button className="btn sm" onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            {methods.length > 0 && (
              <select value={methodId} onChange={(e) => setMethodId(Number(e.target.value))} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name} — {money(m.rate)}</option>)}
              </select>
            )}
            <div className="grow" style={{ flex: 1 }} />
            <button className="btn primary" disabled={busy} onClick={place}>{busy ? 'Placing…' : 'Place order'}</button>
          </div>
          {error && <div className="err small" style={{ marginTop: 10, color: 'var(--danger)' }}>{error}</div>}
        </div>
      )}
    </div></>
  );
}
