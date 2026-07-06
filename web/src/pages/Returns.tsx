import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  RETURN_WINDOW_DAYS,
  ReturnLifecycle,
  ReturnReasonCode,
  ReturnType,
  WARRANTY_DAYS,
  reasonsForType,
} from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { date, titleCase } from '../lib/format';

const BLANK = {
  entityType: 'order' as 'order' | 'merchant',
  entityId: '',
  merchantId: '',
  returnType: ReturnType.REPLACEMENT as ReturnType,
  reasonCode: (reasonsForType(ReturnType.REPLACEMENT)[0]?.code ?? ReturnReasonCode.NEEDS_MANUAL_REVIEW) as ReturnReasonCode,
  expectedSerialNumber: '',
  daysSinceDeployment: '',
  replacementBundleId: '',
  notes: '',
};

export function Returns() {
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });

  const { data, isLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.returns.list({}),
  });

  const [sp] = useSearchParams();
  const ctl = useTableControls(data?.returns ?? [], {
    search: (r) => `#${r.id} ${r.mid ?? ''} ${r.notes ?? ''} ${r.items[0]?.reasonCode ?? ''}`,
    searchPlaceholder: 'Search #, MID, reason, notes…',
    dateField: (r) => r.createdAt,
    dateLabel: 'Opened',
    initial: sp.get('delinquent') ? { facets: { delinquent: [sp.get('delinquent')!] } } : undefined,
    facets: [
      { key: 'origin', label: 'Source', value: (r) => (r.origin === 'posportal' ? 'POS Portal' : 'Engine') },
      { key: 'lifecycle', label: 'Lifecycle', value: (r) => titleCase(r.lifecycle) },
      { key: 'type', label: 'Type', value: (r) => titleCase(r.items[0]?.returnType ?? '') },
      { key: 'delinquent', label: 'Delinquent', value: (r) => (r.delinquent ? 'Delinquent' : 'OK') },
    ],
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      api.returns.create({
        entityType: form.entityType,
        entityId: Number(form.entityId),
        merchantId: Number(form.merchantId),
        items: [
          {
            returnType: form.returnType,
            reasonCode: form.reasonCode,
            expectedSerialNumber: form.expectedSerialNumber || undefined,
          },
        ],
        replacementBundleId: form.returnType === ReturnType.REPLACEMENT && form.replacementBundleId ? Number(form.replacementBundleId) : undefined,
        daysSinceDeployment: form.daysSinceDeployment ? Number(form.daysSinceDeployment) : undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: (res) => {
      const parked = res.return.lifecycle === ReturnLifecycle.PENDING_APPROVAL;
      toast.push(parked ? 'Return created — parked for manager approval' : 'Return / call tag created', 'success');
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['approvals-count'] });
      setOpen(false);
      setForm({ ...BLANK });
    },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to create return', 'error'),
  });

  const reasons = reasonsForType(form.returnType);

  return (
    <AppShell
      title="Returns & Swaps"
      actions={can(Permission.RETURN_WRITE) && <button className="btn primary" onClick={() => setOpen(true)}>+ New return / swap</button>}
    >
      {ctl.toolbar}

      <DataTable
        keyOf={(r) => r.id}
        rows={ctl.rows}
        loading={isLoading}
        onRowClick={(r) => navigate(`/returns/${r.id}`)}
        empty="No return cases match."
        columns={[
          { header: '#', sort: (r) => r.pospReturnId ?? r.id, cell: (r) => <span className="mono small">{r.pospReturnId ? `RMA ${r.pospReturnId}` : `#${r.id}`}</span> },
          { header: 'Source', sort: (r) => r.origin ?? 'engine', cell: (r) => <Badge tone={r.origin === 'posportal' ? 'blue' : 'gray'}>{r.origin === 'posportal' ? 'POS Portal' : 'Engine'}</Badge> },
          { header: 'Merchant', sort: (r) => r.mid ?? '', cell: (r) => <Link className="rowlink mono small" to={`/merchants/${r.merchantId}`} onClick={(e) => e.stopPropagation()}>{r.mid ?? `#${r.merchantId}`}</Link> },
          { header: 'Type · Reason', sort: (r) => r.items[0]?.returnType ?? '', cell: (r) => <span>{titleCase(r.items[0]?.returnType ?? '')} · <span className="muted small">{titleCase(r.items[0]?.reasonCode ?? '')}</span></span> },
          { header: 'Lifecycle', sort: (r) => r.lifecycle, cell: (r) => <StatusBadge status={r.lifecycle} /> },
          { header: 'Call tag', sort: (r) => r.callTagStatus ?? '', cell: (r) => (r.callTagStatus ? <StatusBadge status={r.callTagStatus} /> : '—') },
          { header: 'Recv/Exp', sort: (r) => r.receivedItemCount, cell: (r) => `${r.receivedItemCount}/${r.expectedItemCount}` },
          { header: 'Delinquent', sort: (r) => (r.delinquent ? 0 : 1), cell: (r) => (r.delinquent ? <Badge tone="red">Delinquent</Badge> : '—') },
          { header: 'Created', sort: (r) => r.createdAt, cell: (r) => <span className="small">{date(r.createdAt)}</span> },
        ]}
      />

      {open && (
        <Modal
          title="New return / swap"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={create.isPending || !form.entityId || !form.merchantId} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </>
          }
        >
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Entity</label>
              <select value={form.entityType} onChange={(e) => set('entityType', e.target.value as 'order' | 'merchant')}>
                <option value="order">Order</option>
                <option value="merchant">Merchant</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}><label>{form.entityType === 'order' ? 'Order ID' : 'Merchant ID (entity)'}</label><input value={form.entityId} onChange={(e) => set('entityId', e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>Merchant ID</label><input value={form.merchantId} onChange={(e) => set('merchantId', e.target.value)} /></div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Type</label>
              <select value={form.returnType} onChange={(e) => { const rt = e.target.value as ReturnType; set('returnType', rt); set('reasonCode', (reasonsForType(rt)[0]?.code ?? ReturnReasonCode.NEEDS_MANUAL_REVIEW)); }}>
                {Object.values(ReturnType).map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Reason</label>
              <select value={form.reasonCode} onChange={(e) => set('reasonCode', e.target.value as ReturnReasonCode)}>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 2 }}><label>Serial number (expected)</label><input value={form.expectedSerialNumber} onChange={(e) => set('expectedSerialNumber', e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>Days since deployment</label><input value={form.daysSinceDeployment} onChange={(e) => set('daysSinceDeployment', e.target.value)} /></div>
          </div>
          {form.returnType === ReturnType.REPLACEMENT && (
            <div className="field"><label>Replacement bundle ID (POS Portal)</label><input value={form.replacementBundleId} onChange={(e) => set('replacementBundleId', e.target.value)} /></div>
          )}
          <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          <div className="small muted">Swaps beyond the {RETURN_WINDOW_DAYS}-day return window or {WARRANTY_DAYS}-day warranty are automatically parked for manager approval.</div>
        </Modal>
      )}
    </AppShell>
  );
}
