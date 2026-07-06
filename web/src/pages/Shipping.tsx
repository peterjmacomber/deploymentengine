import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AddressValidationResult, ShippingMethod } from '@de/shared';
import { Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Card, Empty, Loading } from '../components/ui';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { useAuth } from '../stores/authStore';
import { money } from '../lib/format';

const EMPTY_ADDR = { line1: '', city: '', region: '', postalCode: '', country: 'US' };

export function Shipping() {
  const toast = useToast();
  const can = useAuth((s) => s.can);

  const bundles = useQuery({ queryKey: ['bundles-active'], queryFn: api.bundles.listActive });

  const [valAddr, setValAddr] = useState({ ...EMPTY_ADDR });
  const [validation, setValidation] = useState<AddressValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const [quoteAddr, setQuoteAddr] = useState({ ...EMPTY_ADDR });
  const [bundleId, setBundleId] = useState<number | undefined>();
  const [quantity, setQuantity] = useState(1);
  const [methods, setMethods] = useState<ShippingMethod[] | null>(null);
  const [quoting, setQuoting] = useState(false);

  if (!can(Permission.SHIPPING_READ)) {
    return (
      <AppShell title="Tools">
        <Empty>You don't have access to shipping tools.</Empty>
      </AppShell>
    );
  }

  const validate = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const res = await api.shipping.validateAddress(valAddr);
      setValidation(res);
      if (res.valid && res.normalized) setValAddr((a) => ({ ...a, ...res.normalized }));
    } catch (e) {
      toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Validation failed', 'error');
    } finally {
      setValidating(false);
    }
  };

  const quote = async () => {
    if (!bundleId) return;
    setQuoting(true);
    setMethods(null);
    try {
      const res = await api.shipping.quote({ address: quoteAddr, cart: [{ pospBundleId: bundleId, quantity }] });
      setMethods(res.methods);
    } catch (e) {
      toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Quote failed', 'error');
    } finally {
      setQuoting(false);
    }
  };

  return (
    <AppShell title="Tools">
      <div className="grid cols-2">
        <Card>
          <h3>Address Validator</h3>
          <div className="field"><label>Street</label><input value={valAddr.line1} onChange={(e) => setValAddr({ ...valAddr, line1: e.target.value })} /></div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 2 }}><label>City</label><input value={valAddr.city} onChange={(e) => setValAddr({ ...valAddr, city: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>State</label><input value={valAddr.region} onChange={(e) => setValAddr({ ...valAddr, region: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={valAddr.postalCode} onChange={(e) => setValAddr({ ...valAddr, postalCode: e.target.value })} /></div>
          </div>
          <button className="btn primary" disabled={validating} onClick={validate}>{validating ? 'Validating…' : 'Validate'}</button>
          {validation && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, color: validation.valid ? 'var(--ok)' : 'var(--danger)' }}>{validation.valid ? 'Valid address' : 'Invalid address'}</div>
              {validation.messages.length > 0 && (
                <div className="small muted" style={{ marginTop: 4 }}>{validation.messages.join(' ')}</div>
              )}
              {validation.normalized && (
                <div className="small" style={{ marginTop: 8 }}>
                  <div className="muted">Normalized</div>
                  <div>{validation.normalized.line1}</div>
                  <div>{validation.normalized.city}, {validation.normalized.region} {validation.normalized.postalCode}</div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card>
          <h3>Rate Quote</h3>
          <div className="field"><label>Street</label><input value={quoteAddr.line1} onChange={(e) => setQuoteAddr({ ...quoteAddr, line1: e.target.value })} /></div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 2 }}><label>City</label><input value={quoteAddr.city} onChange={(e) => setQuoteAddr({ ...quoteAddr, city: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>State</label><input value={quoteAddr.region} onChange={(e) => setQuoteAddr({ ...quoteAddr, region: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={quoteAddr.postalCode} onChange={(e) => setQuoteAddr({ ...quoteAddr, postalCode: e.target.value })} /></div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Bundle</label>
              <select value={bundleId ?? ''} onChange={(e) => setBundleId(e.target.value ? Number(e.target.value) : undefined)} style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)' }}>
                <option value="">Select a bundle…</option>
                {bundles.data?.bundles.map((b) => <option key={b.pospBundleId} value={b.pospBundleId}>{b.displayName}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}><label>Quantity</label><input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} /></div>
          </div>
          <button className="btn primary" disabled={!bundleId || quoting} onClick={quote}>{quoting ? 'Quoting…' : 'Quote'}</button>
          {methods && (
            methods.length === 0 ? (
              <div className="muted small" style={{ marginTop: 12 }}>No shipping methods available.</div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {methods.map((m) => (
                  <div key={m.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>{m.name} {m.carrier ? <span className="muted small">· {m.carrier}</span> : null}</div>
                    <div className="row" style={{ gap: 8 }}>
                      {m.estimatedDays ? <span className="muted small">{m.estimatedDays}d</span> : null}
                      <strong>{money(m.rate)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
          {bundles.isLoading && <Loading />}
        </Card>
      </div>
    </AppShell>
  );
}
