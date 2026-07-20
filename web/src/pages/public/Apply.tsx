import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicApi, ApiError } from '../../api/client';
import { PublicBand } from './PublicBand';

/**
 * Merchant application sign-up (simulates the step an external e-sign application would
 * embed). Submitting really creates the POS Portal merchant and links it to a Fortis Gateway
 * account (see merchantService.createForApply), then hands off to the equipment order page. A
 * `returnUrl` query param is preserved so the partner flow can resume after the order is placed.
 */
export interface ApplyPayload {
  merchantId: number;
  applicant: { dbaName: string; legalName: string; contactName: string; email: string; phone: string; mid: string };
  shippingAddress: { line1: string; line2?: string; city: string; region: string; postalCode: string; country: string };
  returnUrl?: string;
}

export function Apply() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnUrl = params.get('returnUrl') ?? undefined;

  const [f, setF] = useState({ dbaName: '', legalName: '', mid: '', contactName: '', email: '', phone: '', line1: '', city: '', region: '', postalCode: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const ready = f.dbaName && f.mid && f.contactName && f.email && f.phone && f.line1 && f.city && f.region && f.postalCode;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const applicant = { dbaName: f.dbaName, legalName: f.legalName || f.dbaName, mid: f.mid, contactName: f.contactName, email: f.email, phone: f.phone };
    const shippingAddress = { line1: f.line1, city: f.city, region: f.region, postalCode: f.postalCode, country: 'US' };
    try {
      const res = await publicApi.applyCreateAccount({ applicant, shippingAddress });
      const payload: ApplyPayload = { merchantId: res.merchantId, applicant, shippingAddress, returnUrl };
      sessionStorage.setItem('de_apply', JSON.stringify(payload));
      navigate('/order');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Could not set up your account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <><PublicBand title="Equipment Application" meta="Powered by FortisPay Deployment Engine" />
    <div className="public-shell">
      <div className="steps"><div className="step active">1 · Your business</div><div className="step">2 · Choose equipment</div><div className="step">3 · Confirmation</div></div>

      <form onSubmit={submit} className="card">
        <h3>Business details</h3>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>DBA name *</label><input value={f.dbaName} onChange={set('dbaName')} /></div>
          <div className="field" style={{ flex: 1 }}><label>Legal name</label><input value={f.legalName} onChange={set('legalName')} /></div>
          <div className="field" style={{ flex: 1 }}><label>Merchant ID (MID) *</label><input value={f.mid} onChange={set('mid')} /></div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>Contact name *</label><input value={f.contactName} onChange={set('contactName')} /></div>
          <div className="field" style={{ flex: 1 }}><label>Email *</label><input type="email" value={f.email} onChange={set('email')} /></div>
          <div className="field" style={{ flex: 1 }}><label>Phone *</label><input value={f.phone} onChange={set('phone')} /></div>
        </div>

        <h3 style={{ marginTop: 8 }}>Shipping address</h3>
        <div className="field"><label>Street *</label><input value={f.line1} onChange={set('line1')} /></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 2 }}><label>City *</label><input value={f.city} onChange={set('city')} /></div>
          <div className="field" style={{ flex: 1 }}><label>State *</label><input value={f.region} onChange={set('region')} /></div>
          <div className="field" style={{ flex: 1 }}><label>ZIP *</label><input value={f.postalCode} onChange={set('postalCode')} /></div>
        </div>

        <button className="btn primary" disabled={!ready || busy}>{busy ? 'Setting up your account…' : 'Continue to equipment →'}</button>
        {error && <div className="err small" style={{ marginTop: 10, color: 'var(--danger)' }}>{error}</div>}
      </form>
    </div></>
  );
}
