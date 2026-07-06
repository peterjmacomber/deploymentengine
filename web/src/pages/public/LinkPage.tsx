import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@de/shared';
import { publicLink, ApiError } from '../../api/client';
import { PizzaTracker } from '../../components/PizzaTracker';
import { money } from '../../lib/format';

function LinkTracker({ token, orderId }: { token: string; orderId: number }) {
  const q = useQuery({ queryKey: ['link-order', token, orderId], queryFn: () => publicLink.orderStatus(token, orderId), refetchInterval: 8000 });
  const o = q.data?.order;
  if (!o) return <p className="muted small">Loading tracking…</p>;
  return (
    <div style={{ marginTop: 16 }}>
      <PizzaTracker status={o.status as OrderStatus} packages={o.packages} />
      {o.serialNumbers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="muted small">Assigned serial numbers</div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>{o.serialNumbers.map((s) => <span key={s} className="badge gray mono">{s}</span>)}</div>
        </div>
      )}
    </div>
  );
}

const EMPTY_ADDR = { line1: '', city: '', region: '', postalCode: '', country: 'US' };
const EMPTY_APPLICANT = { dbaName: '', legalName: '', mid: '', contactName: '', email: '', phone: '' };

export function LinkPage({ token }: { token: string }) {
  const [submittedPw, setSubmittedPw] = useState('');
  const [pwInput, setPwInput] = useState('');

  const q = useQuery({ queryKey: ['link', token, submittedPw], queryFn: () => publicLink.resolve(token, submittedPw || undefined), retry: false });

  const [cart, setCart] = useState<Record<number, number>>({});
  const [applicant, setApplicant] = useState({ ...EMPTY_APPLICANT });
  const [addr, setAddr] = useState({ ...EMPTY_ADDR });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<{ id: number; reference?: string; redirectUrl?: string } | null>(null);

  const cfg = q.data;
  useEffect(() => {
    if (cfg) setCart(Object.fromEntries(cfg.bundles.map((b) => [b.pospBundleId, 1])));
  }, [cfg]);

  const total = useMemo(() => (cfg ? cfg.bundles.reduce((s, b) => s + (b.price ?? 0) * (cart[b.pospBundleId] ?? 0), 0) : 0), [cfg, cart]);

  const cartItems = useMemo(() => (cfg ? cfg.bundles.map((b) => ({ pospBundleId: b.pospBundleId, quantity: cart[b.pospBundleId] ?? 0 })).filter((c) => c.quantity > 0) : []), [cfg, cart]);
  const addrOk = !!(addr.line1 && addr.city && addr.region && addr.postalCode);
  const taxQ = useQuery({
    queryKey: ['link-tax', token, JSON.stringify(cartItems), addr.region, addr.postalCode],
    queryFn: () => publicLink.tax(token, { cart: cartItems, address: addr }),
    enabled: cartItems.length > 0 && addrOk,
  });

  if (q.isLoading) return <div className="public-shell"><p>Loading…</p></div>;

  if (q.error) {
    const e = q.error as ApiError;
    if (e.status === 401) {
      return (
        <div className="public-shell">
          <div className="public-header"><span className="dot">◆</span><h1 style={{ margin: 0 }}>Protected page</h1></div>
          <div className="card" style={{ maxWidth: 420 }}>
            <div className="field"><label>Password</label><input type="password" value={pwInput} onChange={(ev) => setPwInput(ev.target.value)} /></div>
            <button className="btn primary" onClick={() => setSubmittedPw(pwInput)}>Unlock</button>
            {submittedPw && <div className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>Incorrect password.</div>}
          </div>
        </div>
      );
    }
    return <div className="public-shell"><div className="card">{e.detail ?? e.message ?? 'This link is not available.'}</div></div>;
  }

  if (!cfg) return null;

  const place = async () => {
    setBusy(true); setError('');
    try {
      const items = cfg.bundles.map((b) => ({ pospBundleId: b.pospBundleId, quantity: cart[b.pospBundleId] ?? 0 })).filter((c) => c.quantity > 0);
      const res = await publicLink.order(token, {
        password: submittedPw || undefined,
        shippingAddress: addr,
        cart: items,
        applicant: cfg.requiresApplicant ? applicant : undefined,
      });
      setPlaced({ id: res.order.id, reference: res.order.reference, redirectUrl: res.redirectUrl });
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Could not place order');
    } finally { setBusy(false); }
  };

  if (placed) {
    return (
      <div className="public-shell">
        <div className="public-header"><span className="dot">◆</span><div><h1 style={{ margin: 0 }}>Order Confirmed</h1></div></div>
        <div className="card">
          <h2>✓ Thank you!</h2>
          <p>Order <strong className="mono">{placed.reference}</strong> has been submitted to FortisPay Deployment. Track its progress below — this page updates automatically.</p>
          <LinkTracker token={token} orderId={placed.id} />
          {placed.redirectUrl && <div className="row" style={{ marginTop: 12 }}><a className="btn" href={placed.redirectUrl}>Continue</a></div>}
        </div>
      </div>
    );
  }

  const addrValid = addr.line1 && addr.city && addr.region && addr.postalCode;
  const applicantValid = !cfg.requiresApplicant || (applicant.dbaName && applicant.mid && applicant.contactName && applicant.email && applicant.phone);
  const hasItems = Object.values(cart).some((q2) => q2 > 0);

  return (
    <div className="public-shell">
      <div className="public-header"><span className="dot">◆</span><div><h1 style={{ margin: 0 }}>{cfg.name}</h1><div className="muted small">{cfg.merchant?.dbaName ? `For ${cfg.merchant.dbaName}` : 'Equipment order'}</div></div></div>

      <div className="grid" style={{ gap: 12 }}>
        {cfg.bundles.map((b) => (
          <div key={b.pospBundleId} className="bundle-card">
            <div className="row between">
              <strong>{b.displayName}</strong>
              <span className="row" style={{ gap: 8 }}>
                {b.price != null && <span className="badge teal">{money(b.price)}</span>}
                <button className="btn sm" onClick={() => setCart({ ...cart, [b.pospBundleId]: Math.max(0, (cart[b.pospBundleId] ?? 0) - 1) })}>−</button>
                <span style={{ width: 20, textAlign: 'center' }}>{cart[b.pospBundleId] ?? 0}</span>
                <button className="btn sm" onClick={() => setCart({ ...cart, [b.pospBundleId]: (cart[b.pospBundleId] ?? 0) + 1 })}>+</button>
              </span>
            </div>
            {b.application && <div className="small muted" style={{ marginTop: 4 }}>{b.application}</div>}
            <div className="row" style={{ gap: 6, marginTop: 6 }}>{b.items.map((it) => <span key={it.sku} className="badge gray">{it.name}</span>)}</div>
          </div>
        ))}
      </div>

      {cfg.requiresApplicant && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Your business</h3>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>DBA name *</label><input value={applicant.dbaName} onChange={(e) => setApplicant({ ...applicant, dbaName: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>MID *</label><input value={applicant.mid} onChange={(e) => setApplicant({ ...applicant, mid: e.target.value })} /></div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>Contact *</label><input value={applicant.contactName} onChange={(e) => setApplicant({ ...applicant, contactName: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>Email *</label><input value={applicant.email} onChange={(e) => setApplicant({ ...applicant, email: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>Phone *</label><input value={applicant.phone} onChange={(e) => setApplicant({ ...applicant, phone: e.target.value })} /></div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Shipping address</h3>
        <div className="field"><label>Street *</label><input value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} /></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 2 }}><label>City *</label><input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>State *</label><input value={addr.region} onChange={(e) => setAddr({ ...addr, region: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>ZIP *</label><input value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} /></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between">
          <div>
            {taxQ.data ? (
              <div className="small">
                <div className="row" style={{ gap: 16 }}><span className="muted">Subtotal</span><span>{money(taxQ.data.subtotal)}</span></div>
                {taxQ.data.customFee > 0 && <div className="row" style={{ gap: 16 }}><span className="muted">{taxQ.data.customFeeName ?? 'Fee'}</span><span>{money(taxQ.data.customFee)}</span></div>}
                <div className="row" style={{ gap: 16 }}><span className="muted">Estimated tax{taxQ.data.taxProvider !== 'none' ? ` (${taxQ.data.taxProvider})` : ''}</span><span>{money(taxQ.data.tax)}</span></div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{money(taxQ.data.total)} <span className="muted small">+ shipping</span></div>
              </div>
            ) : (
              <><div className="muted small">Estimated total</div><strong style={{ fontSize: 22 }}>{money(total)}</strong><span className="muted small"> + shipping</span></>
            )}
          </div>
          <button className="btn primary" disabled={busy || !hasItems || !addrValid || !applicantValid} onClick={place}>{busy ? 'Placing…' : 'Place order'}</button>
        </div>
        {error && <div className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
