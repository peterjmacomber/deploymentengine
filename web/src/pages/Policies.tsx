import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Card, Loading } from '../components/ui';
import { api, ApiError, type PolicyConfig } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';

export function Policies() {
  const can = useAuth((s) => s.can);
  const canEdit = can(Permission.EXCEPTION_APPROVE);
  const isAdmin = can(Permission.DEV_TOOLS);
  const qc = useQueryClient();
  const toast = useToast();

  const { data } = useQuery({ queryKey: ['settings-policy'], queryFn: api.settings.getPolicy });
  const [form, setForm] = useState<PolicyConfig | null>(null);
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  const save = useMutation({
    mutationFn: () => api.settings.setPolicy(form!),
    onSuccess: () => { toast.push('Policies saved', 'success'); qc.invalidateQueries({ queryKey: ['settings-policy'] }); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : 'Save failed', 'error'),
  });

  const reimport = useMutation({
    mutationFn: () => api.dev2.importSandbox(true, 60),
    onSuccess: (r) => { toast.push(`Reset to live data: ${r.bundles} bundles, ${r.merchants} merchants, ${r.orders} orders`, 'success'); qc.invalidateQueries(); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Re-import failed', 'error'),
  });

  return (
    <AppShell title="Policies & Settings">
      {!form ? <Loading /> : (
        <div className="grid cols-2">
          <Card>
            <div className="row between" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Return, Warranty &amp; Courtesy</h3>
              {canEdit && <button className="btn sm primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>}
            </div>
            <div className="field">
              <label>Return window (days)</label>
              <input value={form.returnWindowDays} disabled={!canEdit} inputMode="numeric" onChange={(e) => setForm({ ...form, returnWindowDays: Number(e.target.value) || 0 })} />
              <div className="hint">Swaps after this many days from deployment require a manager exception.</div>
            </div>
            <div className="field">
              <label>Warranty window (days)</label>
              <input value={form.warrantyDays} disabled={!canEdit} inputMode="numeric" onChange={(e) => setForm({ ...form, warrantyDays: Number(e.target.value) || 0 })} />
              <div className="hint">Swaps beyond this are out-of-warranty and require manager approval.</div>
            </div>
            <label className="inline" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={form.courtesyRequiresApproval} disabled={!canEdit} onChange={(e) => setForm({ ...form, courtesyRequiresApproval: e.target.checked })} />
              Courtesy / free (no-charge) devices require a manager price-exception approval
            </label>
          </Card>

          <Card>
            <h3>Data source</h3>
            <p className="small muted">This deployment engine runs on the live POS Portal sandbox. Use this to clear any leftover demo data and pull a fresh snapshot of merchants, bundles, and orders from the API.</p>
            {isAdmin ? (
              <button className="btn danger" disabled={reimport.isPending} onClick={() => { if (confirm('Clear local demo/business data and re-import from POS Portal?')) reimport.mutate(); }}>
                {reimport.isPending ? 'Re-importing…' : 'Reset to 100% live data'}
              </button>
            ) : <div className="small muted">Admin only.</div>}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
