import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@de/shared';
import { publicLink, ApiError } from '../../api/client';
import { PizzaTracker } from '../../components/PizzaTracker';
import { money } from '../../lib/format';
import logoWhite from '../../assets/fortis-logo-white.png';

/** Dark Fortis brand band shared by every checkout state. */
function CheckoutShell({ expires, children }: { expires?: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="co-band">
        <div className="co-band-inner">
          <img src={logoWhite} alt="Fortis" />
          <div className="co-band-div" />
          <div className="co-band-title">Equipment Checkout</div>
          <div className="co-band-meta">{expires ? `Secure link · expires ${expires}` : 'Secure link'}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

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

  if (q.isLoading) return <CheckoutShell><main className="co-main"><p className="muted">Loading…</p></main></CheckoutShell>;

  if (q.error) {
    const e = q.error as ApiError;
    if (e.status === 401) {
      return (
        <CheckoutShell>
          <main className="co-main" style={{ maxWidth: 460 }}>
            <div className="co-eyebrow">Protected</div>
            <div className="co-title" style={{ marginBottom: 16 }}>Enter password to continue</div>
            <div className="card">
              <div className="field"><label>Password</label><input type="password" value={pwInput} onChange={(ev) => setPwInput(ev.target.value)} /></div>
              <button className="btn primary" onClick={() => setSubmittedPw(pwInput)}>Unlock</button>
              {submittedPw && <div className="small" style={{ color: 'var(--danger-text)', marginTop: 8 }}>Incorrect password.</div>}
            </div>
          </main>
        </CheckoutShell>
      );
    }
    return <CheckoutShell><main className="co-main"><div className="card">{e.detail ?? e.message ?? 'This link is not available.'}</div></main></CheckoutShell>;
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
      <CheckoutShell>
        <main className="co-main" style={{ maxWidth: 760 }}>
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--ok-bg)', color: 'var(--ok-text)', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 700, margin: '0 auto 14px' }}>✓</div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Order confirmed — thank you!</h1>
            <p className="muted">Order <strong className="mono" style={{ color: 'var(--celestial-dark)' }}>{placed.reference}</strong> has been submitted to FortisPay Deployment. This page updates automatically as it ships.</p>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Order status</h3>
            <LinkTracker token={token} orderId={placed.id} />
          </div>
          {placed.redirectUrl && <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}><a className="btn" href={placed.redirectUrl}>Continue</a></div>}
        </main>
      </CheckoutShell>
    );
  }

  const addrValid = addr.line1 && addr.city && addr.region && addr.postalCode;
  const applicantValid = !cfg.requiresApplicant || (applicant.dbaName && applicant.mid && applicant.contactName && applicant.email && applicant.phone);
  const hasItems = Object.values(cart).some((q2) => q2 > 0);
  const shipStepNo = cfg.requiresApplicant ? 3 : 2;
  const canPlace = hasItems && !!addrValid && !!applicantValid;

  return (
    <CheckoutShell>
      <main className="co-main">
        <div className="co-eyebrow">{cfg.merchant?.dbaName ?? 'Equipment order'}</div>
        <div className="co-title">{cfg.name}</div>
        <div className="muted" style={{ marginTop: 6 }}>Choose your equipment, confirm where it ships, and we’ll handle the rest.</div>

        <div className="co-grid">
          {/* Left: numbered step cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="co-step-head"><span className="co-stepnum">1</span><span className="co-step-title">Equipment</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cfg.bundles.map((b) => (
                  <div key={b.pospBundleId} className={`bundle-card${(cart[b.pospBundleId] ?? 0) > 0 ? ' selected' : ''}`}>
                    <div className="row between">
                      <div><strong>{b.displayName}</strong>{b.application && <div className="small muted" style={{ marginTop: 2 }}>{b.application}</div>}</div>
                      <span className="row" style={{ gap: 12, alignItems: 'center' }}>
                        {b.price != null && <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--heading)' }}>{money(b.price)}</span>}
                        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <button className="co-qtybtn" onClick={() => setCart({ ...cart, [b.pospBundleId]: Math.max(0, (cart[b.pospBundleId] ?? 0) - 1) })}>−</button>
                          <span className="mono" style={{ minWidth: 20, textAlign: 'center' }}>{cart[b.pospBundleId] ?? 0}</span>
                          <button className="co-qtybtn" onClick={() => setCart({ ...cart, [b.pospBundleId]: (cart[b.pospBundleId] ?? 0) + 1 })}>+</button>
                        </span>
                      </span>
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>{b.items.map((it) => <span key={it.sku} className="badge gray">{it.name}</span>)}</div>
                  </div>
                ))}
              </div>
            </div>

            {cfg.requiresApplicant && (
              <div className="card">
                <div className="co-step-head"><span className="co-stepnum">2</span><span className="co-step-title">Your business</span></div>
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

            <div className="card">
              <div className="co-step-head"><span className="co-stepnum">{shipStepNo}</span><span className="co-step-title">Shipping address</span></div>
              <div className="field"><label>Street *</label><input value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} /></div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 2 }}><label>City *</label><input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></div>
                <div className="field" style={{ flex: 1 }}><label>State *</label><input value={addr.region} onChange={(e) => setAddr({ ...addr, region: e.target.value })} /></div>
                <div className="field" style={{ flex: 1 }}><label>ZIP *</label><input value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} /></div>
              </div>
            </div>
          </div>

          {/* Right: sticky order summary */}
          <div className="card co-summary">
            <h3 style={{ marginTop: 0 }}>Order summary</h3>
            {taxQ.data ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div className="row between small"><span className="muted">Subtotal</span><span>{money(taxQ.data.subtotal)}</span></div>
                {taxQ.data.customFee > 0 && <div className="row between small"><span className="muted">{taxQ.data.customFeeName ?? 'Fee'}</span><span>{money(taxQ.data.customFee)}</span></div>}
                <div className="row between small"><span className="muted">Estimated tax{taxQ.data.taxProvider !== 'none' ? ` (${taxQ.data.taxProvider})` : ''}</span><span>{money(taxQ.data.tax)}</span></div>
                <div className="row between" style={{ borderTop: '1px solid var(--divider)', marginTop: 6, paddingTop: 10, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, color: 'var(--heading)' }}>Total</span>
                  <span><span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--heading)' }}>{money(taxQ.data.total)}</span> <span className="muted small">+ shipping</span></span>
                </div>
              </div>
            ) : (
              <div className="row between" style={{ alignItems: 'baseline' }}>
                <span className="muted small">{hasItems ? 'Estimated total' : 'No equipment selected yet'}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--heading)' }}>{money(total)}</span>
              </div>
            )}
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} disabled={busy || !canPlace} onClick={place}>{busy ? 'Placing…' : 'Place order'}</button>
            <div className="small muted" style={{ textAlign: 'center', marginTop: 10 }}>{canPlace ? 'Shipping is billed separately at cost.' : 'Pick at least one item and fill the starred fields.'}</div>
            {error && <div className="small" style={{ color: 'var(--danger-text)', marginTop: 8 }}>{error}</div>}
          </div>
        </div>
      </main>
    </CheckoutShell>
  );
}
