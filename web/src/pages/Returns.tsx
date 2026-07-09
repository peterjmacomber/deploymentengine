import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  RETURN_WINDOW_DAYS,
  type ReturnCase,
  ReturnLifecycle,
  ReturnReasonCode,
  ReturnType,
  WARRANTY_DAYS,
  reasonsForType,
} from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge } from '../components/ui';
import { type Column, DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { useVisibleColumns } from '../components/ColumnPicker';
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

// Status tabs mirror the POS Portal RMA statuses (falling back to our lifecycle for engine cases).
const STATUS_TABS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'open', label: 'Open', match: (s) => !s.startsWith('CLOSED') && !s.includes('CANCEL') && !s.includes('DENIED') },
  { key: 'cancelled', label: 'Cancelled', match: (s) => s.includes('CANCEL') || s.includes('DENIED') },
  { key: 'closed_return', label: 'Closed by Return', match: (s) => s === 'CLOSED_BY_RETURN' || s === 'CLOSED' },
  { key: 'closed_billing', label: 'Closed by Return after Billing', match: (s) => s === 'CLOSED_BY_RETURN_AFTER_BILLING' || s === 'CLOSED_BY_BILLING' },
];

const TYPE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'swap', label: 'Swaps' },
  { key: 'return', label: 'Returns' },
] as const;
type CaseType = (typeof TYPE_TABS)[number]['key'];
const isSwapCase = (r: ReturnCase) => r.items[0]?.returnType === ReturnType.REPLACEMENT;

export function Returns() {
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const type: CaseType = (TYPE_TABS.some((t) => t.key === sp.get('type')) ? sp.get('type') : 'all') as CaseType;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK, returnType: (type === 'swap' ? ReturnType.REPLACEMENT : ReturnType.RETURN) as ReturnType });
  const [statusTab, setStatusTab] = useState(() => (STATUS_TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab')! : 'all'));
  const isSwaps = type === 'swap';
  const noun = isSwaps ? 'swap' : 'return';

  const { data, isLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.returns.list({}),
  });
  const allCases = data?.returns ?? [];
  // Type tab: all cases, only swaps (REPLACEMENT), or only returns (RETURN / REPAIR).
  const kindRows = allCases.filter((r) => type === 'all' || isSwapCase(r) === (type === 'swap'));
  const typeCount = (t: CaseType) => allCases.filter((r) => t === 'all' || isSwapCase(r) === (t === 'swap')).length;
  const setType = (t: CaseType) => { const next = new URLSearchParams(sp); if (t === 'all') next.delete('type'); else next.set('type', t); setSp(next, { replace: true }); };

  // Real status: for imported POS Portal returns show their RMA status; else our lifecycle.
  const rstatusRaw = (r: ReturnCase) => r.pospStatus ?? r.lifecycle;
  const rstatus = (r: ReturnCase) => titleCase(rstatusRaw(r));
  const statusTone = (r: ReturnCase): 'red' | 'gray' | 'amber' | 'green' | 'blue' => {
    const u = rstatusRaw(r).toUpperCase();
    if (u.includes('CANCEL') || u.includes('DENIED')) return 'red';
    if (u.includes('CLOSED')) return 'gray';
    if (u.includes('RECEIV')) return 'green';
    if (u.includes('OPEN') || u.includes('CALLTAG') || u.includes('SHIP') || u.includes('INITI')) return 'amber';
    return 'blue';
  };

  const ctl = useTableControls(kindRows, {
    search: (r) => `#${r.id} ${r.pospReturnId ?? ''} ${r.mid ?? ''} ${r.merchantDba ?? ''} ${r.notes ?? ''} ${r.items[0]?.reasonCode ?? ''}`,
    searchPlaceholder: 'Search RMA #, MID, DBA, reason…',
    dateField: (r) => r.createdAt,
    dateLabel: 'Opened',
    initial: sp.get('delinquent') ? { facets: { delinquent: [sp.get('delinquent')!] } } : undefined,
    facets: [
      { key: 'reason', label: 'Reason', value: (r) => titleCase(r.items[0]?.reasonCode ?? '') },
      { key: 'delinquent', label: 'Delinquent', value: (r) => (r.delinquent ? 'Delinquent' : 'OK') },
    ],
  });
  // Status tabs sit between the search/filters and the table (like the Orders page).
  const activeTab = STATUS_TABS.find((t) => t.key === statusTab) ?? STATUS_TABS[0];
  const tabbedRows = ctl.rows.filter((r) => activeTab.match(rstatusRaw(r).toUpperCase()));
  const tabCount = (t: (typeof STATUS_TABS)[number]) => ctl.rows.filter((r) => t.match(rstatusRaw(r).toUpperCase())).length;

  const allColumns: Column<ReturnCase>[] = [
    { key: 'rma', label: 'RMA / #', header: 'RMA / #', sort: (r) => r.pospReturnId ?? r.id, cell: (r) => <span className="mono small">{r.pospReturnId ? `RMA ${r.pospReturnId}` : `#${r.id}`}</span> },
    { key: 'dba', label: 'DBA', header: 'DBA', sort: (r) => (r.merchantDba ?? '').toLowerCase(), cell: (r) => <Link className="rowlink" to={`/merchants/${r.merchantId}`} onClick={(e) => e.stopPropagation()}>{r.merchantDba ?? `Merchant #${r.merchantId}`}</Link> },
    { key: 'mid', label: 'MID', header: 'MID', sort: (r) => r.mid ?? '', cell: (r) => <span className="mono small">{r.mid ?? '—'}</span> },
    { key: 'typeReason', label: 'Type · Reason', header: 'Type · Reason', sort: (r) => r.items[0]?.returnType ?? '', cell: (r) => <span>{titleCase(r.items[0]?.returnType ?? '')} · <span className="muted small">{titleCase(r.items[0]?.reasonCode ?? '')}</span></span> },
    { key: 'status', label: 'Status', header: 'Status', sort: (r) => rstatusRaw(r), cell: (r) => <Badge tone={statusTone(r)}>{rstatus(r)}</Badge> },
    { key: 'recvExp', label: 'Received / expected', header: 'Recv/Exp', sort: (r) => r.receivedItemCount, cell: (r) => `${r.receivedItemCount}/${r.expectedItemCount}` },
    { key: 'replacement', label: 'Replacement order', header: 'Replacement', sort: (r) => r.replacementOrderId ?? 0, cell: (r) => (r.replacementOrderId ? <Link className="rowlink mono small" to={`/orders/${r.replacementOrderId}`} onClick={(e) => e.stopPropagation()}>#{r.replacementOrderId}</Link> : '—') },
    { key: 'callTag', label: 'Call tag', header: 'Call tag', sort: (r) => r.callTagStatus ?? '', cell: (r) => (r.callTagStatus ? titleCase(r.callTagStatus) : '—') },
    { key: 'delinquent', label: 'Delinquent', header: 'Delinquent', sort: (r) => (r.delinquent ? 0 : 1), cell: (r) => (r.delinquent ? <Badge tone="red">Delinquent</Badge> : '—') },
    { key: 'created', label: 'Opened', header: 'Opened', sort: (r) => r.createdAt, cell: (r) => <span className="small">{date(r.createdAt)}</span> },
  ];
  const { columns, menu } = useVisibleColumns('cases', allColumns, ['rma', 'dba', 'mid', 'typeReason', 'status', 'recvExp', 'created']);

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
      actions={can(Permission.RETURN_WRITE) && <button className="btn primary" onClick={() => setOpen(true)}>+ New {noun}</button>}
    >
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {TYPE_TABS.map((t) => (
          <div key={t.key} className={`tab ${type === t.key ? 'active' : ''}`} onClick={() => setType(t.key)}>
            {t.label} <span className="badge gray" style={{ marginLeft: 4 }}>{typeCount(t.key)}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>{ctl.toolbar}</div>
        {menu}
      </div>

      <div className="chips">
        {STATUS_TABS.map((t) => (
          <button key={t.key} type="button" className={`chip ${statusTab === t.key ? 'active' : ''}`} onClick={() => setStatusTab(t.key)}>
            {t.label} <span className="chip-count">{tabCount(t)}</span>
          </button>
        ))}
      </div>

      <DataTable
        keyOf={(r) => r.id}
        rows={tabbedRows}
        loading={isLoading}
        onRowClick={(r) => navigate(`/returns/${r.id}`)}
        empty="No return cases match."
        columns={columns}
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
