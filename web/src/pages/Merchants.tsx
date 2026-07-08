import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Merchant, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge } from '../components/ui';
import { type Column, DataTable } from '../components/DataTable';
import { useVisibleColumns } from '../components/ColumnPicker';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { useAuth } from '../stores/authStore';
import { date } from '../lib/format';

const EMPTY_FORM = { dbaName: '', legalName: '', mid: '', email: '', phone: '', line1: '', city: '', region: '', postalCode: '' };

const MERCHANT_TABS: { key: string; label: string; sort: (a: Merchant, b: Merchant) => number }[] = [
  { key: 'all', label: 'All merchants', sort: (a, b) => (a.dbaName ?? '').localeCompare(b.dbaName ?? '') },
  { key: 'recent', label: 'Recently created', sort: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') },
  { key: 'orders', label: 'Most orders', sort: (a, b) => (b.orderCount ?? 0) - (a.orderCount ?? 0) },
];

export function Merchants() {
  const can = useAuth((s) => s.can);
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({ queryKey: ['merchants', search], queryFn: () => api.merchants.list(search || undefined) });
  const activeTab = MERCHANT_TABS.find((t) => t.key === tab) ?? MERCHANT_TABS[0];
  const rows = [...(data?.merchants ?? [])].sort(activeTab.sort);

  const yesNo = (v?: boolean) => (v == null ? '—' : v ? 'Yes' : 'No');
  const allColumns: Column<Merchant>[] = [
    { key: 'dba', label: 'DBA', header: 'DBA', sort: (m) => (m.dbaName ?? '').toLowerCase(), cell: (m) => <span className="rowlink">{m.dbaName ?? '—'}</span> },
    { key: 'mid', label: 'MID', header: 'MID', sort: (m) => m.mid ?? '', cell: (m) => <span className="mono small">{m.mid ?? '—'}</span> },
    { key: 'orders', label: 'Total orders', header: 'Orders', sort: (m) => m.orderCount ?? 0, cell: (m) => <strong>{m.orderCount ?? 0}</strong> },
    { key: 'contact', label: 'Primary contact', header: 'Contact', sort: (m) => (m.primaryContact ?? '').toLowerCase(), cell: (m) => m.primaryContact ?? '—' },
    { key: 'phone', label: 'Phone', header: 'Phone', sort: (m) => m.phone ?? '', cell: (m) => m.phone ?? '—' },
    { key: 'email', label: 'Email', header: 'Email', sort: (m) => (m.email ?? '').toLowerCase(), cell: (m) => m.email ?? '—' },
    { key: 'city', label: 'City', header: 'City', sort: (m) => (m.shippingAddress?.city ?? '').toLowerCase(), cell: (m) => m.shippingAddress?.city ?? '—' },
    { key: 'state', label: 'State', header: 'State', sort: (m) => m.shippingAddress?.region ?? '', cell: (m) => m.shippingAddress?.region ?? '—' },
    { key: 'type', label: 'Type', header: 'Type', sort: (m) => m.merchantType ?? '', cell: (m) => (m.merchantType ? <Badge tone="gray">{m.merchantType}</Badge> : '—') },
    { key: 'taxExempt', label: 'Tax exempt', header: 'Tax exempt', sort: (m) => (m.taxExempt ? 0 : 1), cell: (m) => yesNo(m.taxExempt) },
    { key: 'supplyClub', label: 'Supply club', header: 'Supply club', sort: (m) => (m.supplyClub ? 0 : 1), cell: (m) => yesNo(m.supplyClub) },
    { key: 'fortis', label: 'Fortis linked', header: 'Fortis', sort: (m) => (m.fortisLocationId ? 0 : 1), cell: (m) => (m.fortisLocationId ? <Badge tone="green">{m.fortisLocationName ?? 'Linked'}</Badge> : <span className="small muted">—</span>) },
    { key: 'created', label: 'Created', header: 'Created', sort: (m) => m.createdAt ?? '', cell: (m) => <span className="small">{date(m.createdAt)}</span> },
    { key: 'updated', label: 'Last updated (POS Portal)', header: 'Updated', sort: (m) => m.lastUpdatedAt ?? '', cell: (m) => <span className="small">{date(m.lastUpdatedAt)}</span> },
  ];
  const { columns, menu } = useVisibleColumns('merchants', allColumns, ['dba', 'mid', 'orders', 'contact', 'phone', 'email', 'created']);

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
        <div style={{ flex: 1 }} />
        {menu}
      </div>

      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {MERCHANT_TABS.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>
        ))}
      </div>

      <DataTable
        keyOf={(m) => m.id}
        rows={rows}
        loading={isLoading}
        empty="No merchants match."
        onRowClick={(m) => navigate(`/merchants/${m.id}`)}
        columns={columns}
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
