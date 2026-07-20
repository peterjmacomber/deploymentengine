import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Merchant } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card, Loading } from '../components/ui';
import { api, ApiError, type FortisTerminalConfig } from '../api/client';
import { useToast } from '../components/Toast';
import { serialTag } from '../lib/format';

const CRED_LABELS: Record<string, string> = {
  developerId: 'Developer ID', userId: 'User ID', userName: 'User name', userApiKey: 'User API key',
  userHashKey: 'User hash key', ticketHashKey: 'Ticket hash key', locationId: 'Location ID', terminalId: 'Terminal ID',
};

type FortisLoc = { id: string; name: string; accountNumber: string | null; locationType?: string };

export function FortisGateway() {
  const toast = useToast();
  const status = useQuery({ queryKey: ['fortis-status'], queryFn: api.fortis.status });

  // --- connection test ---
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const test = useMutation({
    mutationFn: () => api.fortis.test(),
    onSuccess: (r) => setTestResult(r),
    onError: (e) => setTestResult({ ok: false, detail: e instanceof ApiError ? (e.detail ?? e.message) : 'Test failed' }),
  });

  // --- search Fortis accounts (local cache — instant, type-ahead) + link to a merchant ---
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['fortis-search', q.trim()],
    queryFn: () => api.fortis.search(q.trim()),
    enabled: q.trim().length > 0,
  });
  const results = search.data?.locations ?? null;
  const syncStatus = useQuery({ queryKey: ['fortis-location-sync-status'], queryFn: api.fortis.locationSyncStatus });
  const qc = useQueryClient();
  const syncNow = useMutation({
    mutationFn: api.fortis.syncLocations,
    onSuccess: (r) => { toast.push(`Synced ${r.count} Fortis locations`, 'success'); qc.invalidateQueries({ queryKey: ['fortis-location-sync-status'] }); qc.invalidateQueries({ queryKey: ['fortis-search'] }); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Sync failed', 'error'),
  });
  const [picked, setPicked] = useState<FortisLoc | null>(null);

  const [merchantQ, setMerchantQ] = useState('');
  const merchants = useQuery({ queryKey: ['merchants', merchantQ], queryFn: () => api.merchants.list(merchantQ || undefined), enabled: merchantQ.length > 0 });
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const link = useMutation({
    mutationFn: () => api.fortis.link({ merchantId: merchant!.id, fortisLocationId: picked!.id, fortisLocationName: picked!.name }),
    onSuccess: () => toast.push(`Linked ${merchant!.dbaName ?? merchant!.mid} → ${picked!.name}`, 'success'),
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Link failed', 'error'),
  });

  // --- terminal defaults (manufacturer / application / CVM used when auto-creating equipment) ---
  const options = useQuery({ queryKey: ['fortis-terminal-options'], queryFn: api.fortis.terminalOptions });
  const defaults = useQuery({ queryKey: ['fortis-terminal-defaults'], queryFn: api.fortis.getTerminalDefaults });
  const [td, setTd] = useState<FortisTerminalConfig | null>(null);
  useEffect(() => { if (defaults.data && !td) setTd(defaults.data); }, [defaults.data, td]);
  const saveDefaults = useMutation({
    mutationFn: () => api.fortis.saveTerminalDefaults(td!),
    onSuccess: (r) => { setTd(r); toast.push('Terminal defaults saved (recorded in the audit log)', 'success'); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Save failed', 'error'),
  });
  // CVMs are manufacturer-specific; applications are not tagged by manufacturer in the API.
  const cvmsForManufacturer = (options.data?.cvms ?? []).filter((c) => !c.manufacturerCode || !td?.manufacturerCode || c.manufacturerCode === td.manufacturerCode);

  // --- create a terminal ---
  const [serial, setSerial] = useState('');
  const [termLoc, setTermLoc] = useState('');
  const [actResult, setActResult] = useState<Awaited<ReturnType<typeof api.fortis.activate>> | null>(null);
  const activate = useMutation({
    mutationFn: () => api.fortis.activate({ serialNumber: serial.trim(), locationId: termLoc.trim() || undefined }),
    onSuccess: (r) => setActResult(r),
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Create failed', 'error'),
  });

  const s = status.data;

  return (
    <AppShell title="Fortis Gateway">
      {status.isLoading || !s ? (
        <Loading />
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Connection</h3>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Badge tone={s.configured ? 'green' : 'amber'}>{s.configured ? 'Configured' : 'Not configured'}</Badge>
                <button className="btn primary sm" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Testing…' : 'Test connection'}</button>
              </div>
            </div>
            <div className="small muted">API base: <span className="mono">{s.baseUrl ?? '—'}</span></div>
            <div className="small muted">Device link field: <span className="mono">{s.linkField}</span></div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {Object.entries(s.credentials).map(([k, set]) => (
                <Badge key={k} tone={set ? 'green' : 'amber'}>{CRED_LABELS[k] ?? k}: {set ? 'set' : 'missing'}</Badge>
              ))}
            </div>
            {testResult && (
              <div className="small" style={{ marginTop: 12, color: testResult.ok ? 'var(--ok)' : 'var(--danger)' }}>{testResult.ok ? '✓ ' : '✕ '}{testResult.detail}</div>
            )}
          </Card>

          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Link a Fortis account to a merchant</h3>
            <p className="small muted" style={{ marginTop: 0 }}>Search by account name or number as you type — this searches a local cache of Fortis locations, not a live call. (Fortis has no MID field, so accounts are matched by name/account number.)</p>
            <div className="row between small muted" style={{ marginBottom: 8 }}>
              <span>
                {syncStatus.data ? `${syncStatus.data.count.toLocaleString()} locations cached` : 'Loading cache status…'}
                {syncStatus.data?.syncedAt ? ` · last synced ${new Date(syncStatus.data.syncedAt).toLocaleString()}` : ' · never synced'}
              </span>
              <button className="btn sm" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>{syncNow.isPending ? 'Syncing…' : 'Sync now'}</button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input placeholder="Search Fortis accounts (name or account #)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)' }} />
            </div>
            {q.trim() && (
              <div className="table-wrap" style={{ marginTop: 10, maxHeight: 240, overflow: 'auto' }}>
                <table className="mini-table">
                  <thead><tr><th>Account</th><th>Account #</th><th>Type</th><th></th></tr></thead>
                  <tbody>
                    {search.isLoading && <tr><td colSpan={4} className="small muted">Searching…</td></tr>}
                    {!search.isLoading && (!results || results.length === 0) && <tr><td colSpan={4} className="small muted">No matches in the cache.</td></tr>}
                    {(results ?? []).map((l) => (
                      <tr key={l.id} style={{ background: picked?.id === l.id ? 'var(--accent-soft)' : undefined }}>
                        <td>{l.name}</td>
                        <td className="mono small">{l.accountNumber ?? '—'}</td>
                        <td className="small muted">{l.locationType ?? '—'}</td>
                        <td><button className="btn sm" onClick={() => setPicked(l)}>{picked?.id === l.id ? 'Selected' : 'Select'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {picked && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div className="small">Selected Fortis account: <strong>{picked.name}</strong> <span className="mono muted">{picked.id}</span></div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <input placeholder="Search a Deployment Engine merchant (MID/DBA)…" value={merchantQ} onChange={(e) => { setMerchantQ(e.target.value); setMerchant(null); }} style={{ flex: 1, padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)' }} />
                </div>
                {merchantQ && merchants.data && (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {merchants.data.merchants.slice(0, 8).map((m) => (
                      <button key={m.id} className={`btn sm ${merchant?.id === m.id ? 'primary' : ''}`} onClick={() => setMerchant(m)}>{m.dbaName ?? m.mid ?? `#${m.id}`}</button>
                    ))}
                  </div>
                )}
                <button className="btn primary" style={{ marginTop: 10 }} disabled={!merchant || link.isPending} onClick={() => link.mutate()}>
                  {link.isPending ? 'Linking…' : merchant ? `Link ${picked.name} → ${merchant.dbaName ?? merchant.mid}` : 'Pick a merchant to link'}
                </button>
              </div>
            )}
          </Card>

          <Card style={{ marginBottom: 16 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Terminal defaults</h3>
              {options.isFetching && <span className="small muted">loading options…</span>}
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              These are applied to every terminal the engine auto-creates in Fortis (on shipment and via the button below).
              Pick the manufacturer, then its terminal line/application and CVM — mirrors the Fortis portal. Changes are recorded in the audit log.
            </p>
            {!td ? (
              <Loading />
            ) : (
              <>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
                    <label>Manufacturer</label>
                    <select value={td.manufacturerCode} onChange={(e) => setTd({ ...td, manufacturerCode: e.target.value })}>
                      {!options.data?.manufacturers.length && <option value={td.manufacturerCode}>Code {td.manufacturerCode}</option>}
                      {options.data?.manufacturers.map((m) => <option key={m.id} value={m.id}>{m.label} (code {m.id})</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
                    <label>Terminal CVM</label>
                    <select value={td.cvmId} onChange={(e) => setTd({ ...td, cvmId: e.target.value })}>
                      {!cvmsForManufacturer.length && <option value={td.cvmId}>{td.cvmId}</option>}
                      {cvmsForManufacturer.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
                    <label>Terminal application</label>
                    <select value={td.applicationId} onChange={(e) => setTd({ ...td, applicationId: e.target.value })}>
                      {!options.data?.applications.length && <option value={td.applicationId}>{td.applicationId}</option>}
                      {options.data?.applications.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <button className="btn primary" disabled={saveDefaults.isPending || !td.manufacturerCode || !td.applicationId || !td.cvmId} onClick={() => saveDefaults.mutate()}>
                    {saveDefaults.isPending ? 'Saving…' : 'Save terminal defaults'}
                  </button>
                  <span className="small muted mono">mfr {td.manufacturerCode} · cvm …{td.cvmId.slice(-6)} · app …{td.applicationId.slice(-6)}</span>
                </div>
              </>
            )}
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>Create a terminal (equipment)</h3>
            <p className="small muted" style={{ marginTop: 0 }}>Creates a Fortis terminal — full serial → <span className="mono">serial_number</span>, last-8 → <span className="mono">{s.linkField}</span>.</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 2, minWidth: 220, margin: 0 }}><label>Serial number (from POS Portal)</label><input value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
              <div className="field" style={{ flex: 2, minWidth: 220, margin: 0 }}><label>Fortis location id</label><input value={termLoc || picked?.id || ''} onChange={(e) => setTermLoc(e.target.value)} placeholder={picked ? picked.id : 'defaults to FORTIS_LOCATION_ID'} /></div>
            </div>
            {serial.trim() && <div className="small muted" style={{ marginTop: 8 }}>Terminal API Id → <span className="badge gray mono">{serialTag(serial)}</span></div>}
            <button className="btn primary" style={{ marginTop: 10 }} disabled={!serial.trim() || activate.isPending} onClick={() => { setTermLoc(termLoc || picked?.id || ''); activate.mutate(); }}>{activate.isPending ? 'Creating…' : 'Create terminal'}</button>
            {actResult && (
              <div className="small" style={{ marginTop: 12, color: actResult.activated ? 'var(--ok)' : 'var(--danger)' }}>
                {actResult.activated
                  ? <>✓ Terminal <span className="mono">{actResult.terminalId}</span> created on <span className="mono">{actResult.accountId}</span> — serial <span className="mono">{actResult.serialNumber}</span>, API id <span className="mono">{actResult.linksValue}</span></>
                  : <>✕ {actResult.error}</>}
              </div>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
