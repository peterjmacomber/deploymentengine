import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALL_BRANDS,
  BundleApplication,
  type Bundle,
  EncryptionType,
  Permission,
  ProcessorPlatform,
  type UpsertBundleInput,
} from '@de/shared';
import { AppShell } from '../components/AppShell';
import { SectionNav } from '../components/SectionNav';
import { Badge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { money, titleCase } from '../lib/format';

interface FormState {
  pospBundleId: string;
  displayName: string;
  description: string;
  active: boolean;
  application: string;
  encryption: string;
  processorPlatform: string;
  distributor: string;
  accountingDeviceModel: string;
  accountingUnitPrice: string;
  brand: string;
  itemsText: string;
}

const BLANK: FormState = {
  pospBundleId: '', displayName: '', description: '', active: false,
  application: '', encryption: '', processorPlatform: '', distributor: 'POS Portal',
  accountingDeviceModel: '', accountingUnitPrice: '', brand: '', itemsText: '',
};

function toForm(b: Bundle): FormState {
  return {
    pospBundleId: String(b.pospBundleId),
    displayName: b.displayName,
    description: b.description ?? '',
    active: b.active,
    application: b.application ?? '',
    encryption: b.encryption ?? '',
    processorPlatform: b.processorPlatform ?? '',
    distributor: b.distributor,
    accountingDeviceModel: b.accountingDeviceModel ?? '',
    accountingUnitPrice: b.accountingUnitPrice != null ? String(b.accountingUnitPrice) : '',
    brand: b.brand ?? '',
    itemsText: b.items.map((i) => `${i.sku}|${i.name}|${i.quantity}`).join('\n'),
  };
}

export function Bundles() {
  const canWrite = useAuth((s) => s.can)(Permission.BUNDLE_WRITE);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...BLANK });
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['bundles'], queryFn: api.bundles.list });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['bundles'] }); qc.invalidateQueries({ queryKey: ['bundles-active'] }); };
  const onErr = (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Action failed', 'error');

  const [tab, setTab] = useState<'active' | 'inactive' | 'all'>('active');
  const [q, setQ] = useState('');
  const [fApp, setFApp] = useState('');
  const [fEnc, setFEnc] = useState('');
  const [fOs, setFOs] = useState('');
  const [fBrand, setFBrand] = useState('');
  const allBundles = data?.bundles ?? [];
  const activeCount = allBundles.filter((b) => b.active).length;
  // Distinct in-use values populate the filter dropdowns, so you can see every app/version at a glance.
  const distinct = (get: (b: Bundle) => string | undefined) =>
    [...new Set(allBundles.map(get).filter((v): v is string => !!v))].sort((a, z) => a.localeCompare(z, undefined, { numeric: true }));
  const brandOptions = distinct((b) => b.brand);
  const appOptions = distinct((b) => b.pospApplication);
  const encOptions = distinct((b) => b.pospEncryption);
  const osOptions = distinct((b) => b.pospOsBuild);
  const filtered = allBundles.filter((b) =>
    (tab === 'all' || (tab === 'active' ? b.active : !b.active)) &&
    (!q || `${b.displayName} #${b.pospBundleId} ${b.accountingDeviceModel ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
    (!fApp || b.pospApplication === fApp) &&
    (!fEnc || b.pospEncryption === fEnc) &&
    (!fOs || b.pospOsBuild === fOs) &&
    (!fBrand || b.brand === fBrand),
  );

  const toggle = useMutation({
    mutationFn: (b: Bundle) => api.bundles.setActive(b.pospBundleId, !b.active),
    onSuccess: () => invalidate(),
    onError: onErr,
  });
  const importBundles = useMutation({
    mutationFn: () => api.bundles.import(),
    onSuccess: (r) => { toast.push(`Imported ${r.imported} bundle(s)`, 'success'); invalidate(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.bundles.remove(id),
    onSuccess: () => { toast.push('Bundle removed', 'success'); invalidate(); },
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: () => {
      const items = form.itemsText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [sku, name, qty] = l.split('|').map((x) => x.trim());
          return { sku, name: name || sku, quantity: Number(qty) || 1, kind: 'other' as const };
        });
      const payload: UpsertBundleInput = {
        pospBundleId: Number(form.pospBundleId),
        displayName: form.displayName,
        description: form.description || undefined,
        active: form.active,
        items,
        application: (form.application || undefined) as UpsertBundleInput['application'],
        encryption: (form.encryption || undefined) as UpsertBundleInput['encryption'],
        processorPlatform: (form.processorPlatform || undefined) as UpsertBundleInput['processorPlatform'],
        distributor: form.distributor || 'POS Portal',
        accountingDeviceModel: form.accountingDeviceModel || undefined,
        accountingUnitPrice: form.accountingUnitPrice ? Number(form.accountingUnitPrice) : undefined,
        brand: form.brand || undefined,
      };
      return api.bundles.upsert(payload);
    },
    onSuccess: () => { toast.push('Bundle saved', 'success'); invalidate(); setOpen(false); },
    onError: onErr,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSel = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allIds = filtered.map((b) => b.pospBundleId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const bulk = useMutation({
    mutationFn: (active: boolean) => api.bundles.bulkSetActive([...selected], active),
    onSuccess: (r) => { toast.push(`Updated ${r.updated} bundle(s)`, 'success'); invalidate(); setSelected(new Set()); },
    onError: onErr,
  });

  const openNew = () => { setForm({ ...BLANK }); setEditing(false); setOpen(true); };
  const openEdit = (b: Bundle) => { setForm(toForm(b)); setEditing(true); setOpen(true); };

  return (
    <AppShell
      title="Bundles & Pricing"
      actions={canWrite && (
        <div className="row">
          {selected.size > 0 && (
            <>
              <button className="btn sm primary" disabled={bulk.isPending} onClick={() => bulk.mutate(true)}>Show {selected.size}</button>
              <button className="btn sm" disabled={bulk.isPending} onClick={() => bulk.mutate(false)}>Hide {selected.size}</button>
            </>
          )}
          <button className="btn" disabled={importBundles.isPending} onClick={() => importBundles.mutate()}>Import from POS Portal</button>
          <button className="btn primary" onClick={openNew}>+ Add bundle</button>
        </div>
      )}
    >
      <SectionNav tabs={[{ to: '/bundles', label: 'Bundles', end: true }, { to: '/pricing', label: 'Pricing' }]} />
      <div className="tabs" style={{ marginBottom: 12 }}>
        {([
          ['active', `Active (${activeCount})`],
          ['inactive', `Inactive (${allBundles.length - activeCount})`],
          ['all', `All (${allBundles.length})`],
        ] as const).map(([key, label]) => (
          <div key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => { setTab(key); setSelected(new Set()); }}>{label}</div>
        ))}
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, minWidth: 200 }}><label className="small muted">Search</label><input placeholder="Name, id, model…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field" style={{ margin: 0, minWidth: 150 }}>
          <label className="small muted">Brand</label>
          <select value={fBrand} onChange={(e) => setFBrand(e.target.value)}><option value="">All brands ({brandOptions.length})</option>{brandOptions.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 200 }}>
          <label className="small muted">Application</label>
          <select value={fApp} onChange={(e) => setFApp(e.target.value)}><option value="">All apps ({appOptions.length})</option>{appOptions.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label className="small muted">Encryption</label>
          <select value={fEnc} onChange={(e) => setFEnc(e.target.value)}><option value="">All encryption ({encOptions.length})</option>{encOptions.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 170 }}>
          <label className="small muted">OS build</label>
          <select value={fOs} onChange={(e) => setFOs(e.target.value)}><option value="">All OS builds ({osOptions.length})</option>{osOptions.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        {(q || fApp || fEnc || fOs || fBrand) && <button className="btn sm" onClick={() => { setQ(''); setFApp(''); setFEnc(''); setFOs(''); setFBrand(''); }}>Clear</button>}
      </div>

      <DataTable
        keyOf={(b) => b.pospBundleId}
        rows={filtered}
        loading={isLoading}
        empty="No bundles match."
        renderExpanded={(b) => (
          <div style={{ padding: '4px 8px' }}>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap', marginBottom: 10 }}>
              <div><div className="small muted">Brand</div><div>{b.brand ?? '—'}</div></div>
              <div><div className="small muted">Application</div><div>{b.pospApplication ?? '—'}</div></div>
              <div><div className="small muted">Encryption</div><div>{b.pospEncryption ?? '—'}</div></div>
              <div><div className="small muted">OS build</div><div className="mono">{b.pospOsBuild ?? '—'}</div></div>
              <div><div className="small muted">Unit price</div><div>{money(b.accountingUnitPrice)}</div></div>
            </div>
            <div className="small muted" style={{ marginBottom: 6 }}>Contents ({b.items.length})</div>
            {b.items.length === 0 ? (
              <div className="small muted">No items in this bundle.</div>
            ) : (
              <table className="mini-table">
                <thead><tr><th>Item</th><th>SKU</th><th style={{ textAlign: 'right' }}>Qty</th></tr></thead>
                <tbody>
                  {b.items.map((it) => (
                    <tr key={it.sku}><td>{it.name}</td><td className="mono small">{it.sku}</td><td style={{ textAlign: 'right' }}>{it.quantity ?? 1}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        columns={[
          {
            header: <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))} aria-label="Select all" />,
            width: '34px',
            cell: (b) => <input type="checkbox" checked={selected.has(b.pospBundleId)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(b.pospBundleId)} />,
          },
          { header: 'Bundle', sort: (b) => b.displayName.toLowerCase(), cell: (b) => <div><div>{b.displayName}</div><div className="small muted mono">#{b.pospBundleId}</div></div> },
          { header: 'Brand', sort: (b) => b.brand ?? '', cell: (b) => <span className="small">{b.brand ?? '—'}</span> },
          {
            header: 'Active',
            sort: (b) => (b.active ? 0 : 1),
            cell: (b) => (
              <span onClick={(e) => { e.stopPropagation(); if (canWrite) toggle.mutate(b); }} style={{ cursor: canWrite ? 'pointer' : 'default' }}>
                <Badge tone={b.active ? 'green' : 'gray'}>{b.active ? 'Active' : 'Hidden'}</Badge>
              </span>
            ),
          },
          { header: 'Application (POS Portal)', sort: (b) => (b.pospApplication ?? '').toLowerCase(), cell: (b) => <span className="small">{b.pospApplication ?? '—'}</span> },
          { header: 'Encryption (POS Portal)', sort: (b) => (b.pospEncryption ?? '').toLowerCase(), cell: (b) => <span className="small">{b.pospEncryption ?? '—'}</span> },
          { header: 'OS build', sort: (b) => (b.pospOsBuild ?? '').toLowerCase(), cell: (b) => <span className="small mono">{b.pospOsBuild ?? '—'}</span> },
          { header: 'Price', sort: (b) => b.accountingUnitPrice ?? 0, cell: (b) => money(b.accountingUnitPrice) },
          { header: 'Items', sort: (b) => b.items.length, cell: (b) => b.items.length },
          ...(canWrite
            ? [{
                header: '',
                cell: (b: Bundle) => (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm" onClick={() => openEdit(b)}>Edit</button>
                    <button className="btn sm danger" onClick={() => { if (confirm(`Remove ${b.displayName}?`)) remove.mutate(b.pospBundleId); }}>Delete</button>
                  </div>
                ),
              }]
            : []),
        ]}
      />

      {open && (
        <Modal
          title={editing ? 'Edit bundle' : 'Add bundle'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={save.isPending || !form.pospBundleId || !form.displayName} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save bundle'}
              </button>
            </>
          }
        >
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>POS Portal bundle ID *</label><input value={form.pospBundleId} disabled={editing} onChange={(e) => set('pospBundleId', e.target.value)} /></div>
            <div className="field" style={{ flex: 2 }}><label>Display name *</label><input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} /></div>
          </div>
          <div className="field"><label>Description</label><textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Application</label>
              <select value={form.application} onChange={(e) => set('application', e.target.value)}>
                <option value="">—</option>
                {Object.values(BundleApplication).map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Encryption</label>
              <select value={form.encryption} onChange={(e) => set('encryption', e.target.value)}>
                <option value="">—</option>
                {Object.values(EncryptionType).map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Processor</label>
              <select value={form.processorPlatform} onChange={(e) => set('processorPlatform', e.target.value)}>
                <option value="">—</option>
                {Object.values(ProcessorPlatform).map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}><label>Distributor</label><input value={form.distributor} onChange={(e) => set('distributor', e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>Accounting model</label><input value={form.accountingDeviceModel} onChange={(e) => set('accountingDeviceModel', e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>Unit price</label><input value={form.accountingUnitPrice} onChange={(e) => set('accountingUnitPrice', e.target.value)} /></div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Brand (device manufacturer)</label>
              <input list="brand-options" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Auto-detected if blank" />
              <datalist id="brand-options">{ALL_BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
              <div className="hint">Leave blank to auto-detect from the model/name.</div>
            </div>
          </div>
          <label className="inline" style={{ marginBottom: 12 }}><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active (visible in storefront & embed)</label>
          <div className="field">
            <label>Items — one per line as <span className="mono">sku|name|qty</span></label>
            <textarea rows={3} value={form.itemsText} onChange={(e) => set('itemsText', e.target.value)} placeholder="A920Pro-...|PAX A920 Pro|1" />
            <div className="hint">Leave blank to pull items from the POS Portal bundle snapshot on save.</div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
