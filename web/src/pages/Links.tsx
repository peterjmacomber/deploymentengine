import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Bundle, type DeploymentLink, type Merchant, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { Modal } from '../components/Modal';
import { api, ApiError, type ShippingConfig } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { date } from '../lib/format';

function linkUrl(l: DeploymentLink): string {
  const base = window.location.origin;
  return l.type === 'application' ? `${base}/apply?v=${l.token}` : `${base}/l/${l.token}`;
}
const rev = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

type FormState = {
  type: 'order' | 'application';
  name: string;
  merchantId: string;
  bundleIds: Set<number>;
  prices: Record<number, string>;
  shippingMethodId: string;
  customFeeName: string;
  customFeeAmount: string;
  password: string;
  maxUses: string;
  expiresAt: string;
};
const blank = (): FormState => ({ type: 'order', name: '', merchantId: '', bundleIds: new Set(), prices: {}, shippingMethodId: '', customFeeName: '', customFeeAmount: '', password: '', maxUses: '', expiresAt: '' });

/** Shared bundle-selection + config editor used by create and manage. */
function LinkFields({ form, setForm, bundles, merchants, shipping }: { form: FormState; setForm: (f: FormState) => void; bundles: Bundle[]; merchants: Merchant[]; shipping?: ShippingConfig }) {
  const toggleBundle = (id: number) => { const s = new Set(form.bundleIds); if (s.has(id)) s.delete(id); else s.add(id); setForm({ ...form, bundleIds: s }); };
  return (
    <>
      <div className="row" style={{ gap: 16, marginBottom: 10 }}>
        <label className="inline"><input type="radio" checked={form.type === 'order'} onChange={() => setForm({ ...form, type: 'order' })} /> Order page (tied to merchant)</label>
        <label className="inline"><input type="radio" checked={form.type === 'application'} onChange={() => setForm({ ...form, type: 'application' })} /> Application page (open to all)</label>
      </div>
      <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      {form.type === 'order' && (
        <div className="field">
          <label>Merchant *</label>
          <select value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })}>
            <option value="">Select merchant…</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.dbaName}{m.mid ? ` (${m.mid})` : ''}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label>Bundles &amp; pricing *</label>
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
          {bundles.map((b) => (
            <div key={b.pospBundleId} className="row between" style={{ padding: '4px 0' }}>
              <label className="inline"><input type="checkbox" checked={form.bundleIds.has(b.pospBundleId)} onChange={() => toggleBundle(b.pospBundleId)} /> {b.displayName} <span className="muted small">std ${b.accountingUnitPrice ?? '—'}</span></label>
              {form.bundleIds.has(b.pospBundleId) && <span className="row" style={{ gap: 4 }}>$<input value={form.prices[b.pospBundleId] ?? (b.accountingUnitPrice ?? '')} onChange={(e) => setForm({ ...form, prices: { ...form.prices, [b.pospBundleId]: e.target.value } })} style={{ width: 80, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></span>}
            </div>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Shipping method</label>
          <select value={form.shippingMethodId} onChange={(e) => setForm({ ...form, shippingMethodId: e.target.value })}>
            <option value="">Customer chooses</option>
            {shipping?.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>Custom fee name</label><input value={form.customFeeName} onChange={(e) => setForm({ ...form, customFeeName: e.target.value })} placeholder="e.g. Activation fee" /></div>
        <div className="field" style={{ flex: 1 }}><label>Custom fee $</label><input value={form.customFeeAmount} onChange={(e) => setForm({ ...form, customFeeAmount: e.target.value })} inputMode="decimal" /></div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>Max uses</label><input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="unlimited" inputMode="numeric" /></div>
        <div className="field" style={{ flex: 1 }}><label>Expires</label><input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
      </div>
    </>
  );
}

function buildPayload(form: FormState) {
  return {
    name: form.name,
    merchantId: form.type === 'order' && form.merchantId ? Number(form.merchantId) : undefined,
    bundlePospIds: [...form.bundleIds],
    pricingOverrides: Object.fromEntries([...form.bundleIds].map((id) => [String(id), Number(form.prices[id]) || 0])),
    shippingMethodId: form.shippingMethodId ? Number(form.shippingMethodId) : undefined,
    customFeeName: form.customFeeName || undefined,
    customFeeAmount: form.customFeeAmount ? Number(form.customFeeAmount) : undefined,
    maxUses: form.maxUses ? Number(form.maxUses) : undefined,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
  };
}

export function Links() {
  const canWrite = useAuth((s) => s.can)(Permission.LINK_WRITE);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blank());
  const [editing, setEditing] = useState<DeploymentLink | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['links'], queryFn: api.links.list });
  const bundlesQ = useQuery({ queryKey: ['bundles-active'], queryFn: api.bundles.listActive });
  const merchantsQ = useQuery({ queryKey: ['merchants', ''], queryFn: () => api.merchants.list() });
  const shippingQ = useQuery({ queryKey: ['settings-shipping'], queryFn: api.settings.getShipping });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['links'] });
  const onErr = (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Action failed', 'error');
  const bundleById = useMemo(() => new Map((bundlesQ.data?.bundles ?? []).map((b) => [b.pospBundleId, b])), [bundlesQ.data]);

  const create = useMutation({
    mutationFn: () => api.links.create({ type: form.type, ...buildPayload(form), password: form.password || undefined } as never),
    onSuccess: () => { toast.push('Link created', 'success'); invalidate(); setOpen(false); setForm(blank()); },
    onError: onErr,
  });
  const toggleActive = useMutation({ mutationFn: (l: DeploymentLink) => api.links.update(l.id, { active: !l.active }), onSuccess: invalidate, onError: onErr });
  const remove = useMutation({ mutationFn: (id: number) => api.links.remove(id), onSuccess: () => { toast.push('Link deleted', 'success'); invalidate(); }, onError: onErr });

  const links = data?.links ?? [];
  const agg = links.reduce((a, l) => ({ orders: a.orders + l.orders, revenue: a.revenue + l.revenue, units: a.units + l.unitsVolume, visits: a.visits + l.visits, active: a.active + (l.active ? 1 : 0) }), { orders: 0, revenue: 0, units: 0, visits: 0, active: 0 });
  const conv = agg.visits ? Math.round((agg.orders / agg.visits) * 100) : 0;
  const topByRevenue = [...links].filter((l) => l.revenue !== 0 || l.orders > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const maxRev = Math.max(1, ...topByRevenue.map((l) => Math.abs(l.revenue)));

  const ctl = useTableControls(links, {
    search: (l) => `${l.name} ${l.merchantDba ?? ''} ${l.merchantMid ?? ''} ${l.token}`,
    searchPlaceholder: 'Search name, merchant, token…',
    dateField: (l) => l.createdAt,
    dateLabel: 'Created',
    facets: [
      { key: 'type', label: 'Type', value: (l) => (l.type === 'application' ? 'Application' : 'Order') },
      { key: 'status', label: 'Status', value: (l) => (l.active ? 'Active' : 'Inactive') },
      { key: 'tied', label: 'Tied to', value: (l) => l.merchantDba ?? (l.type === 'application' ? 'Open to all' : 'Unassigned') },
    ],
  });

  return (
    <AppShell title="Checkout Generator" actions={canWrite && <button className="btn primary" onClick={() => { setForm(blank()); setOpen(true); }}>+ New link</button>}>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Card><div className="muted small">Links</div><div style={{ fontSize: 24, fontWeight: 700 }}>{links.length}</div><div className="small muted">{agg.active} active</div></Card>
        <Card><div className="muted small">Orders via links</div><div style={{ fontSize: 24, fontWeight: 700 }}>{agg.orders}</div><div className="small muted">{agg.units} units</div></Card>
        <Card><div className="muted small">Net revenue</div><div style={{ fontSize: 24, fontWeight: 700, color: agg.revenue < 0 ? 'var(--danger)' : undefined }}>{rev(agg.revenue)}</div></Card>
        <Card><div className="muted small">Visit → order</div><div style={{ fontSize: 24, fontWeight: 700 }}>{conv}%</div><div className="small muted">{agg.visits} visits</div></Card>
      </div>

      {topByRevenue.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <h3>Top links by net revenue</h3>
          <div className="grid" style={{ gap: 8 }}>
            {topByRevenue.map((l) => (
              <div key={l.id}>
                <div className="row between small"><span>{l.name}</span><span className="muted" style={{ color: l.revenue < 0 ? 'var(--danger)' : undefined }}>{rev(l.revenue)} · {l.orders} orders</span></div>
                <div style={{ background: '#eef0f2', borderRadius: 6, height: 10, marginTop: 3 }}>
                  <div style={{ width: `${Math.round((Math.abs(l.revenue) / maxRev) * 100)}%`, background: l.revenue < 0 ? 'var(--danger)' : 'var(--accent)', height: 10, borderRadius: 6 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {ctl.toolbar}

      <DataTable
        keyOf={(l) => l.id}
        rows={ctl.rows}
        loading={isLoading}
        empty="No deployment links match."
        renderExpanded={(l) => (
          <div className="grid cols-2" style={{ gap: 16 }}>
            <div>
              <div className="muted small">Tied to</div>
              <div>
                {l.type === 'application'
                  ? 'Open to all applicants (collects merchant)'
                  : l.merchantId
                    ? <Link className="rowlink" to={`/merchants/${l.merchantId}`}>{l.merchantDba ?? `Merchant #${l.merchantId}`}{l.merchantMid ? ` (${l.merchantMid})` : ''}</Link>
                    : '—'}
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>URL</div>
              <div className="mono small">{linkUrl(l)}</div>
              <div className="muted small" style={{ marginTop: 8 }}>Fees</div>
              <div className="small">{l.customFeeName ? `${l.customFeeName}: ${rev(l.customFeeAmount ?? 0)}` : 'No custom fee'} · shipping method #{l.shippingMethodId ?? '(customer choice)'}</div>
              <div className="muted small" style={{ marginTop: 8 }}>Limits</div>
              <div className="small">{l.usesCount} used{l.maxUses != null ? ` / ${l.maxUses}` : ''}{l.expiresAt ? ` · expires ${date(l.expiresAt)}` : ''}{l.hasPassword ? ' · password-protected' : ''}</div>
            </div>
            <div>
              <div className="muted small">Equipment &amp; configuration</div>
              {l.bundlePospIds.map((id) => {
                const b = bundleById.get(id);
                const price = l.pricingOverrides[String(id)];
                return (
                  <div key={id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="row between"><strong>{b?.displayName ?? `Bundle #${id}`}</strong><span>{price != null ? rev(price) : (b?.accountingUnitPrice != null ? `$${b.accountingUnitPrice}` : '—')}</span></div>
                    {b && <div className="small muted">{b.pospApplication ?? 'app —'} · {b.pospEncryption ?? 'enc —'} · {b.pospOsBuild ?? 'os —'}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        columns={[
          { header: 'Name', sort: (l) => l.name, cell: (l) => <div><div>{l.name}</div><div className="small muted">{l.type === 'application' ? 'Application page' : 'Order page'}{l.merchantDba ? ` · ${l.merchantDba}` : ''}</div></div> },
          { header: 'URL', cell: (l) => <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(linkUrl(l)); toast.push('URL copied', 'success'); }}>Copy</button> },
          { header: 'Uses', sort: (l) => l.usesCount, cell: (l) => `${l.usesCount}${l.maxUses != null ? ` / ${l.maxUses}` : ''}` },
          { header: 'Visits', sort: (l) => l.visits, cell: (l) => l.visits },
          { header: 'Orders', sort: (l) => l.orders, cell: (l) => l.orders },
          { header: 'Net revenue', sort: (l) => l.revenue, cell: (l) => <span style={{ color: l.revenue < 0 ? 'var(--danger)' : undefined }}>{rev(l.revenue)}</span> },
          { header: 'Expires', sort: (l) => l.expiresAt ?? '', cell: (l) => <span className="small">{l.expiresAt ? date(l.expiresAt) : '—'}</span> },
          { header: 'Status', sort: (l) => (l.active ? 1 : 0), cell: (l) => <Badge tone={l.active ? 'green' : 'gray'}>{l.active ? 'Active' : 'Off'}{l.hasPassword ? ' 🔒' : ''}</Badge> },
          ...(canWrite
            ? [{ header: '', cell: (l: DeploymentLink) => (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setEditing(l)}>Manage</button>
                  <button className="btn sm" onClick={() => toggleActive.mutate(l)}>{l.active ? 'Disable' : 'Enable'}</button>
                </div>
              ) }]
            : []),
        ]}
      />

      {open && (
        <Modal title="New deployment link" onClose={() => setOpen(false)} footer={<>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={create.isPending || !form.name || form.bundleIds.size === 0 || (form.type === 'order' && !form.merchantId)} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create link'}</button>
        </>}>
          <LinkFields form={form} setForm={setForm} bundles={bundlesQ.data?.bundles ?? []} merchants={merchantsQ.data?.merchants ?? []} shipping={shippingQ.data} />
          <div className="field"><label>Password (optional)</label><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </Modal>
      )}

      {editing && (
        <ManageLinkModal
          link={editing}
          bundles={bundlesQ.data?.bundles ?? []}
          merchants={merchantsQ.data?.merchants ?? []}
          shipping={shippingQ.data}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
          onDelete={() => { remove.mutate(editing.id); setEditing(null); }}
        />
      )}
    </AppShell>
  );
}

function ManageLinkModal({ link, bundles, merchants, shipping, onClose, onSaved, onDelete }: { link: DeploymentLink; bundles: Bundle[]; merchants: Merchant[]; shipping?: ShippingConfig; onClose: () => void; onSaved: () => void; onDelete: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>({
    type: link.type,
    name: link.name,
    merchantId: link.merchantId ? String(link.merchantId) : '',
    bundleIds: new Set(link.bundlePospIds),
    prices: Object.fromEntries(Object.entries(link.pricingOverrides).map(([k, v]) => [Number(k), String(v)])),
    shippingMethodId: link.shippingMethodId != null ? String(link.shippingMethodId) : '',
    customFeeName: link.customFeeName ?? '',
    customFeeAmount: link.customFeeAmount != null ? String(link.customFeeAmount) : '',
    password: '',
    maxUses: link.maxUses != null ? String(link.maxUses) : '',
    expiresAt: link.expiresAt ? link.expiresAt.slice(0, 10) : '',
  });
  const [clearPassword, setClearPassword] = useState(false);

  const save = useMutation({
    mutationFn: () => api.links.update(link.id, {
      ...buildPayload(form),
      merchantId: form.type === 'order' && form.merchantId ? Number(form.merchantId) : null,
      shippingMethodId: form.shippingMethodId ? Number(form.shippingMethodId) : null,
      customFeeName: form.customFeeName || null,
      customFeeAmount: form.customFeeAmount ? Number(form.customFeeAmount) : null,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      ...(clearPassword ? { clearPassword: true } : form.password ? { password: form.password } : {}),
    } as never),
    onSuccess: () => { toast.push('Link updated', 'success'); onSaved(); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Update failed', 'error'),
  });

  return (
    <Modal title={`Manage — ${link.name}`} onClose={onClose} footer={<>
      <button className="btn danger" onClick={() => { if (confirm('Delete this link?')) onDelete(); }}>Delete</button>
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={save.isPending || !form.name || form.bundleIds.size === 0} onClick={() => save.mutate()}>Save</button>
    </>}>
      <div className="small muted" style={{ marginBottom: 10 }}>{link.usesCount} uses · {link.visits} visits · {link.orders} orders · {rev(link.revenue)} net revenue</div>
      <LinkFields form={form} setForm={setForm} bundles={bundles} merchants={merchants} shipping={shipping} />
      <div className="field">
        <label>Password</label>
        <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={link.hasPassword ? '•••••• (unchanged)' : 'none'} disabled={clearPassword} />
        {link.hasPassword && <label className="inline" style={{ marginTop: 6 }}><input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} /> Remove password</label>}
      </div>
    </Modal>
  );
}
