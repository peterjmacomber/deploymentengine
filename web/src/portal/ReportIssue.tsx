import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DeployedEquipment } from '@de/shared';
import { api, ApiError, type PortalIssueDef, type PortalIssueResult } from '../api/client';
import { PortalLayout } from './PortalLayout';
import { Card, Loading } from '../components/ui';
import { serialTag } from '../lib/format';
import { deployedBrand } from '../lib/brand';

type Step = 'device' | 'issue' | 'help' | 'confirm' | 'done';

export function ReportIssue() {
  const opts = useQuery({ queryKey: ['portal-issue-options'], queryFn: api.portal.issueOptions });
  const [step, setStep] = useState<Step>('device');
  const [device, setDevice] = useState<DeployedEquipment | null>(null);
  const [issue, setIssue] = useState<PortalIssueDef | null>(null);
  const [wantsReplacement, setWantsReplacement] = useState(false);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<PortalIssueResult | null>(null);

  const submit = useMutation({
    mutationFn: () => api.portal.submitIssue({
      issueCode: issue!.code,
      deployedEquipmentId: device?.id,
      serialNumber: device?.serialNumber,
      wantsReplacement: issue!.remedy === 'RETURN' ? wantsReplacement : undefined,
      notes: notes || undefined,
    }),
    onSuccess: (r) => { setResult(r); setStep('done'); },
  });

  const devices = opts.data?.devices ?? [];
  const issues = opts.data?.issues ?? [];

  return (
    <PortalLayout title="Report an issue">
      <div className="portal-steps">
        {(['device', 'issue', 'help', 'confirm'] as Step[]).map((s, i) => (
          <div key={s} className={`portal-step${step === s ? ' active' : ''}${stepIndex(step) > i ? ' done' : ''}`}>
            <span className="portal-step-num">{i + 1}</span>
            <span className="small">{['Device', 'Problem', 'Quick fixes', 'Confirm'][i]}</span>
          </div>
        ))}
      </div>

      {opts.isLoading ? <Loading /> : (
        <>
          {step === 'device' && (
            <Card>
              <h3 style={{ marginTop: 0 }}>Which device is having trouble?</h3>
              {devices.length === 0 ? (
                <p className="small muted">We don’t see any active devices on your account. If you believe this is wrong, <Link to="/portal">go back home</Link> or contact support.</p>
              ) : (
                <div className="portal-choices">
                  {devices.map((d) => (
                    <button key={d.id} className={`portal-choice${device?.id === d.id ? ' selected' : ''}`} onClick={() => { setDevice(d); setStep('issue'); }}>
                      <strong>{d.productName ?? deployedBrand(d) ?? d.model ?? 'Device'}</strong>
                      <span className="small muted mono">Serial {serialTag(d.serialNumber)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}

          {step === 'issue' && (
            <Card>
              <button className="portal-back small" onClick={() => setStep('device')}>← Change device</button>
              <h3 style={{ marginTop: 8 }}>What’s going on?</h3>
              <div className="portal-choices">
                {issues.map((it) => (
                  <button key={it.code} className={`portal-choice${issue?.code === it.code ? ' selected' : ''}`} onClick={() => { setIssue(it); setWantsReplacement(false); setStep('help'); }}>
                    <strong>{it.label}</strong>
                    <span className="small muted">{it.summary}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {step === 'help' && issue && (
            <Card>
              <button className="portal-back small" onClick={() => setStep('issue')}>← Change problem</button>
              <h3 style={{ marginTop: 8 }}>Let’s try a few quick fixes first</h3>
              <ol className="portal-help">
                {issue.help.map((h, i) => <li key={i}>{h}</li>)}
              </ol>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <Link className="btn" to="/portal">That fixed it 🎉</Link>
                <button className="btn primary" onClick={() => setStep('confirm')}>Still not working →</button>
              </div>
            </Card>
          )}

          {step === 'confirm' && issue && (
            <Card>
              <button className="portal-back small" onClick={() => setStep('help')}>← Back</button>
              <h3 style={{ marginTop: 8 }}>Confirm your request</h3>
              <p className="small">
                Device: <strong>{device?.productName ?? device?.model ?? 'Selected device'}</strong> <span className="mono muted">({serialTag(device?.serialNumber)})</span><br />
                Issue: <strong>{issue.label}</strong>
              </p>
              <p className="small muted">
                {issue.remedy === 'REPLACEMENT'
                  ? 'We’ll ship a replacement and send a prepaid call tag to return the old device.'
                  : 'We’ll issue a prepaid call tag to return this device.'}
              </p>
              {issue.remedy === 'RETURN' && (
                <label className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <input type="checkbox" checked={wantsReplacement} onChange={(e) => setWantsReplacement(e.target.checked)} />
                  <span className="small">Actually, please send a replacement device too</span>
                </label>
              )}
              <div className="field"><label>Anything else we should know? (optional)</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              {submit.isError && <p className="small" style={{ color: 'var(--danger)' }}>{submit.error instanceof ApiError ? (submit.error.detail ?? submit.error.message) : 'Something went wrong. Please try again.'}</p>}
              <button className="btn primary" disabled={submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Submitting…' : 'Submit request'}</button>
            </Card>
          )}

          {step === 'done' && result && (
            <Card className="portal-done">
              <div className="portal-done-icon">{result.outcome === 'pending_review' ? '🕓' : '✅'}</div>
              <h3>{result.outcome === 'pending_review' ? 'Submitted for review' : 'All set!'}</h3>
              <p className="small">{result.message}</p>
              <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
                <Link className="btn" to="/portal">Back to home</Link>
                <Link className="btn" to={result.case && result.case.items[0]?.returnType === 'REPLACEMENT' ? '/portal/swaps' : '/portal/returns'}>View my {result.case && result.case.items[0]?.returnType === 'REPLACEMENT' ? 'swaps' : 'returns'}</Link>
              </div>
            </Card>
          )}
        </>
      )}
    </PortalLayout>
  );
}

function stepIndex(s: Step): number {
  return ['device', 'issue', 'help', 'confirm', 'done'].indexOf(s);
}
