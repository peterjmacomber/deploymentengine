import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReportedIssue } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api } from '../api/client';
import { dateTime, serialTag } from '../lib/format';

const OUTCOME: Record<ReportedIssue['outcome'], { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' }> = {
  self_resolved: { label: 'Self-resolved', tone: 'green' },
  swap: { label: 'Swap created', tone: 'blue' },
  return: { label: 'Return created', tone: 'amber' },
  pending_review: { label: 'Pending review', tone: 'amber' },
};

export function ReportedIssues() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['reported-issues'], queryFn: api.reportedIssues.list });
  const rows = data?.issues ?? [];

  const ctl = useTableControls(rows, {
    search: (r) => `${r.merchantDba ?? ''} ${r.issueLabel} ${r.serialNumber ?? ''} ${r.deviceProduct ?? ''} ${r.notes ?? ''}`,
    searchPlaceholder: 'Search merchant, issue, device, serial…',
    dateField: (r) => r.createdAt,
    dateLabel: 'Reported',
    facets: [
      { key: 'outcome', label: 'Outcome', value: (r) => OUTCOME[r.outcome]?.label ?? r.outcome },
      { key: 'issue', label: 'Issue', value: (r) => r.issueLabel },
    ],
  });

  const selfResolved = rows.filter((r) => r.outcome === 'self_resolved').length;
  const swaps = rows.filter((r) => r.outcome === 'swap').length;
  const returns = rows.filter((r) => r.outcome === 'return').length;
  const pending = rows.filter((r) => r.outcome === 'pending_review').length;

  return (
    <AppShell title="Reported Issues">
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Card label="Total reported" value={rows.length} />
        <Card label="Self-resolved" value={selfResolved} />
        <Card label="Became swaps" value={swaps} />
        <Card label="Returns / pending" value={returns + pending} />
      </div>

      {ctl.toolbar}

      <DataTable
        keyOf={(r) => r.id}
        rows={ctl.rows}
        loading={isLoading}
        empty="No merchants have reported an issue yet."
        onRowClick={(r) => { if (r.returnCaseId) navigate(`/returns/${r.returnCaseId}`); }}
        columns={[
          { header: 'Reported', sort: (r) => r.createdAt, cell: (r) => <span className="small">{dateTime(r.createdAt)}</span> },
          { header: 'Merchant', sort: (r) => (r.merchantDba ?? '').toLowerCase(), cell: (r) => <Link className="rowlink" to={`/merchants/${r.merchantId}`} onClick={(e) => e.stopPropagation()}>{r.merchantDba ?? `Merchant #${r.merchantId}`}</Link> },
          { header: 'Device', sort: (r) => r.deviceProduct ?? '', cell: (r) => <div><div className="small">{r.deviceProduct ?? '—'}</div>{r.serialNumber && <div className="small muted mono">{serialTag(r.serialNumber)}</div>}</div> },
          { header: 'Issue', sort: (r) => r.issueLabel, cell: (r) => <div><div className="small">{r.issueLabel}</div>{r.notes && <div className="small muted">{r.notes}</div>}</div> },
          { header: 'Outcome', sort: (r) => r.outcome, cell: (r) => <Badge tone={OUTCOME[r.outcome]?.tone ?? 'gray'}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Badge> },
          {
            header: 'Result', cell: (r) => (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {r.returnCaseId && <Link className="rowlink mono small" to={`/returns/${r.returnCaseId}`} onClick={(e) => e.stopPropagation()}>Case #{r.returnCaseId}</Link>}
                {r.replacementOrderId && <Link className="rowlink mono small" to={`/orders/${r.replacementOrderId}`} onClick={(e) => e.stopPropagation()}>Swap order #{r.replacementOrderId}</Link>}
                {!r.returnCaseId && !r.replacementOrderId && <span className="muted small">—</span>}
              </div>
            ),
          },
        ]}
      />
    </AppShell>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="card"><div className="muted small">{label}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div></div>
  );
}
