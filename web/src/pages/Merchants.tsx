import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { useAuth } from '../stores/authStore';
import { date } from '../lib/format';

const EMPTY_FORM = { dbaName: '', legalName: '', mid: '', email: '', phone: '', line1: '', city: '', region: '', postalCode: '' };

export function Merchants() {
  const can = useAuth((s) => s.can);
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({ queryKey: ['merchants', search], queryFn: () => api.merchants.list(search || undefined) });

  const create = useMutation({
    mutationFn: () =>
      api.merchants.create({
        dbaName: form.dbaName,
        legalName: form.legalName || undefined,
        mid: form.mid || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        shippingAddress: { line1: form.line1, city: form.city, region: form.region, postalCode: form.postalCode, country: 'US' },
      }),
    onSuccess: () => { toast.push('Merchant created', 'success'); qc.invalidateQueries({ queryKey: ['merchants'] }); setOpen(false); setForm({ ...EMPTY_FORM }); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Create failed', 'error'),
  });

  return (
    <AppShell title="Merchants" actions={can(Permission.MERCHANT_WRITE) && <button className="btn primary" onClick={() => setOpen(true)}>+ New merchant</button>}>
      <div className="row" style={{ marginBottom: 14, gap: 10 }}>
        <input placeholder="Search MID, phone, email, or DBA…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 320 }} />
        {search && <button className="btn sm" onClick={() => setSearch('')}>Clear</button>}
        {data?.merchants && <span className="muted small" style={{ alignSelf: 'center' }}>{data.merchants.length} result(s)</span>}
      </div>

      <DataTable
        keyOf={(m) => m.id}
        rows={data?.merchants}
        loading={isLoading}
        empty="No merchants match."
        onRowClick={(m) => navigate(`/merchants/${m.id}`)}
        columns={[
          { header: 'DBA', sort: (m) => (m.dbaName ?? '').toLowerCase(), cell: (m) => <span className="rowlink">{m.dbaName ?? '—'}</span> },
          { header: 'MID', sort: (m) => m.mid ?? '', cell: (m) => <span className="mono small">{m.mid ?? '—'}</span> },
          { header: 'Legal name', sort: (m) => (m.legalName ?? '').toLowerCase(), cell: (m) => m.legalName ?? '—' },
          { header: 'Email', sort: (m) => (m.email ?? '').toLowerCase(), cell: (m) => m.email ?? '—' },
          { header: 'Phone', sort: (m) => m.phone ?? '', cell: (m) => m.phone ?? '—' },
          { header: 'Created', sort: (m) => m.createdAt ?? '', cell: (m) => <span className="small">{date(m.createdAt)}</span> },
        ]}
      />

      {open && (
        <Modal
          title="New merchant"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={!form.dbaName || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Saving…' : 'Create merchant'}
              </button>
            </>
          }
        >
          <div className="field"><label>DBA name</label><input value={form.dbaName} onChange={(e) => setForm({ ...form, dbaName: e.target.value })} /></div>
          <div className="field"><label>Legal name</label><input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>MID</label><input value={form.mid} onChange={(e) => setForm({ ...form, mid: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Street</label><input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 2 }}><label>City</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>State</label><input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
