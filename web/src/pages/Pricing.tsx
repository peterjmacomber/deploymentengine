import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DevicePriceRow, Permission, RESTOCKING_FEE_PCT } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { SectionNav } from '../components/SectionNav';
import { Badge, Card, Loading } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api, ApiError, type ShippingConfig } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { money } from '../lib/format';

const numInput: React.CSSProperties = { width: 90, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6 };

function ShippingRatesCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['settings-shipping'], queryFn: api.settings.getShipping });
  const [draft, setDraft] = useState<ShippingConfig | null>(null);
  const cfg = draft ?? data ?? null;
  const save = useMutation({
    mutationFn: () => api.settings.setShipping(cfg!),
    onSuccess: () => { toast.push('Shipping rates saved', 'success'); qc.invalidateQueries({ queryKey: ['settings-shipping'] }); setDraft(null); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : 'Save failed', 'error'),
  });
  if (!cfg) return <Card><h3>Shipping rates</h3><Loading /></Card>;
  const setTier = (i: number, key: 'name' | 'base' | 'estimatedDays', val: string) =>
    setDraft({ ...cfg, tiers: cfg.tiers.map((t, idx) => (idx === i ? { ...t, [key]: key === 'name' ? val : Number(val) || 0 } : t)) });
  return (
    <Card>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Shipping rates</h3>
        {canEdit && <button className="btn sm primary" disabled={!draft || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>}
      </div>
      <table className="data" style={{ width: '100%' }}>
        <thead><tr><th>Tier</th><th>1st device ($)</th><th>Est. days</th></tr></thead>
        <tbody>
          {cfg.tiers.map((t, i) => (
            <tr key={t.id}>
              <td>{canEdit ? <input value={t.name} onChange={(e) => setTier(i, 'name', e.target.value)} style={{ ...numInput, width: '100%' }} /> : t.name}</td>
              <td>{canEdit ? <input value={t.base} onChange={(e) => setTier(i, 'base', e.target.value)} style={numInput} inputMode="decimal" /> : money(t.base)}</td>
              <td>{canEdit ? <input value={t.estimatedDays} onChange={(e) => setTier(i, 'estimatedDays', e.target.value)} style={{ ...numInput, width: 60 }} inputMode="numeric" /> : t.estimatedDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10, gap: 8, alignItems: 'center' }}>
        <span className="small muted">Each additional device (+$)</span>
        {canEdit
          ? <input value={cfg.additionalDeviceFee} onChange={(e) => setDraft({ ...cfg, additionalDeviceFee: Number(e.target.value) || 0 })} style={{ ...numInput, width: 70 }} inputMode="decimal" />
          : <strong>{money(cfg.additionalDeviceFee)}</strong>}
      </div>
    </Card>
  );
}

/** Inline editor for a single device's UPL price; on commit it re-prices every bundle with that device. */
function DevicePriceCell({ row, canEdit }: { row: DevicePriceRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(String(row.price));
  const save = useMutation({
    mutationFn: (price: number) => api.bundles.setDevicePrice(row.id, price),
    onSuccess: (res) => {
      toast.push(`Updated ${row.model} — re-priced ${res.bundlesUpdated} bundle(s)`, 'success');
      qc.invalidateQueries({ queryKey: ['device-prices'] });
      qc.invalidateQueries({ queryKey: ['bundles'] });
      qc.invalidateQueries({ queryKey: ['bundles-active'] });
    },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Update failed', 'error'),
  });
  if (!canEdit) return <strong>{money(row.price)}</strong>;
  const commit = () => {
    const next = Number(value.trim());
    if (!Number.isFinite(next) || next < 0 || next === row.price) { setValue(String(row.price)); return; }
    save.mutate(next);
  };
  return (
    <div className="row" style={{ gap: 4, alignItems: 'center' }}>
      <span className="muted">$</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} inputMode="decimal" style={{ width: 90, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6 }} />
    </div>
  );
}

export function Pricing() {
  const canEdit = useAuth((s) => s.can)(Permission.BUNDLE_WRITE);
  const qc = useQueryClient();
  const toast = useToast();

  const upl = useQuery({ queryKey: ['device-prices'], queryFn: api.bundles.devicePrices });
  const bundlesQ = useQuery({ queryKey: ['bundles'], queryFn: api.bundles.list });

  const priced = (bundlesQ.data?.bundles ?? []).filter((b) => b.accountingUnitPrice != null).length;

  const resync = useMutation({
    mutationFn: () => api.bundles.applyPricing(),
    onSuccess: (r) => { toast.push(`Synced prices to ${r.updated} bundle(s)`, 'success'); qc.invalidateQueries({ queryKey: ['bundles'] }); qc.invalidateQueries({ queryKey: ['bundles-active'] }); qc.invalidateQueries({ queryKey: ['device-prices'] }); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : 'Sync failed', 'error'),
  });

  const uplCtl = useTableControls(upl.data?.devicePrices ?? [], {
    search: (d) => `${d.model} ${d.keyword}`,
    searchPlaceholder: 'Search device…',
  });

  return (
    <AppShell
      title="Bundles & Pricing"
      actions={canEdit && <button className="btn" disabled={resync.isPending} onClick={() => resync.mutate()}>{resync.isPending ? 'Syncing…' : 'Re-sync bundle prices'}</button>}
    >
      <SectionNav tabs={[{ to: '/bundles', label: 'Bundles', end: true }, { to: '/pricing', label: 'Pricing' }]} />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Card><div className="muted small">Priced devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{upl.data?.devicePrices.length ?? 0}</div></Card>
        <Card><div className="muted small">Bundles priced</div><div style={{ fontSize: 24, fontWeight: 700 }}>{priced} / {bundlesQ.data?.bundles.length ?? 0}</div></Card>
        <Card><div className="muted small">Restocking fee (returns)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round(RESTOCKING_FEE_PCT * 100)}%</div></Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Device Price List</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          The single source of truth for device pricing — one Fortis Gateway price per device. Since devices are sold via bundles,
          every bundle containing a device inherits this price (e.g. all Link 2500 bundles share the Link 2500 price).
          {canEdit ? ' Editing a price instantly re-prices every bundle that uses that device.' : ' Editing requires admin.'}
        </p>
        {uplCtl.toolbar}
        <DataTable
          keyOf={(d) => d.id}
          rows={uplCtl.rows}
          loading={upl.isLoading}
          empty="No device prices."
          columns={[
            { header: 'Device', sort: (d) => d.model.toLowerCase(), cell: (d) => <div><div>{d.model}</div><div className="small muted mono">match: “{d.keyword}”</div></div> },
            { header: 'Fortis Gateway price', sort: (d) => d.price, width: '170px', cell: (d) => <DevicePriceCell row={d} canEdit={canEdit} /> },
            { header: 'Bundles', sort: (d) => d.bundleCount, cell: (d) => <Badge tone={d.bundleCount > 0 ? 'teal' : 'gray'}>{d.bundleCount}</Badge> },
            { header: 'Used by', cell: (d) => <span className="small muted">{d.examples.join(', ') || '—'}{d.bundleCount > d.examples.length ? ` +${d.bundleCount - d.examples.length}` : ''}</span> },
          ]}
        />
      </Card>

      <ShippingRatesCard canEdit={canEdit} />
    </AppShell>
  );
}
