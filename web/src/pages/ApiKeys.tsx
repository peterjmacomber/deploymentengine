import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApiKey, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { dateTime } from '../lib/format';

export function ApiKeys() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can(Permission.APIKEY_MANAGE);

  const { data, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: () => api.apiKeys.list() });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ name: string; raw: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['api-keys'] });
  const onErr = (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Action failed', 'error');

  const create = useMutation({
    mutationFn: () => api.apiKeys.create(name.trim()),
    onSuccess: (res) => { setIssued({ name: res.apiKey.name, raw: res.raw }); setCreating(false); setName(''); invalidate(); },
    onError: onErr,
  });
  const toggle = useMutation({ mutationFn: (k: ApiKey) => api.apiKeys.setActive(k.id, !k.active), onSuccess: invalidate, onError: onErr });
  const remove = useMutation({ mutationFn: (id: number) => api.apiKeys.remove(id), onSuccess: () => { toast.push('Key deleted', 'success'); invalidate(); }, onError: onErr });

  const copy = async (raw: string) => {
    try { await navigator.clipboard.writeText(raw); toast.push('Key copied', 'success'); } catch { /* clipboard blocked; visible in modal */ }
  };

  return (
    <AppShell title="API Keys" actions={canManage && <button className="btn primary" onClick={() => { setName(''); setCreating(true); }}>+ New API key</button>}>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Integration keys</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Keys authenticate to the API with the <span className="mono">X-API-Key</span> header and can perform every operational
          function (merchants, orders, returns, deployed equipment, checkout links) — but <strong>not</strong> admin functions
          (users, pricing/catalog, audit, approvals, or key management). Every call made with a key is recorded in the audit log
          under the key's name.
        </p>
      </Card>

      <DataTable
        keyOf={(k) => k.id}
        rows={data?.apiKeys}
        loading={isLoading}
        empty="No API keys yet."
        columns={[
          { header: 'Name', sort: (k) => k.name.toLowerCase(), cell: (k) => k.name },
          { header: 'Key', cell: (k) => <span className="mono small">{k.prefix}</span> },
          { header: 'Status', sort: (k) => (k.active ? 0 : 1), cell: (k) => <Badge tone={k.active ? 'green' : 'gray'}>{k.active ? 'Active' : 'Revoked'}</Badge> },
          { header: 'Created', sort: (k) => k.createdAt, cell: (k) => <span className="small">{dateTime(k.createdAt)}{k.createdBy ? ` · ${k.createdBy}` : ''}</span> },
          { header: 'Last used', sort: (k) => k.lastUsedAt ?? '', cell: (k) => <span className="small">{k.lastUsedAt ? dateTime(k.lastUsedAt) : 'Never'}</span> },
          ...(canManage ? [{
            header: '',
            cell: (k: ApiKey) => (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => toggle.mutate(k)}>{k.active ? 'Revoke' : 'Enable'}</button>
                <button className="btn sm danger" onClick={() => { if (confirm(`Delete key "${k.name}"? Any integration using it will stop working.`)) remove.mutate(k.id); }}>Delete</button>
              </div>
            ),
          }] : []),
        ]}
      />

      {creating && (
        <Modal
          title="New API key"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Generating…' : 'Generate key'}
              </button>
            </>
          }
        >
          <div className="field">
            <label>Key name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salesforce integration" />
            <div className="small muted">A recognizable name — this is what shows in the audit log for every call.</div>
          </div>
        </Modal>
      )}

      {issued && (
        <Modal
          title="Copy your API key now"
          onClose={() => setIssued(null)}
          footer={<button className="btn primary" onClick={() => setIssued(null)}>Done</button>}
        >
          <p className="small">This is the only time the full key for <strong>{issued.name}</strong> is shown. Store it securely — it can't be retrieved again.</p>
          <div className="field">
            <label>API key</label>
            <div className="row" style={{ gap: 8 }}>
              <input readOnly value={issued.raw} className="mono" style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => copy(issued.raw)}>Copy</button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
