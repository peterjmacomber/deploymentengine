import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ExceptionRequest } from '@de/shared';
import { EXCEPTION_LABELS, ExceptionStatus, ExceptionType, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { Modal } from '../components/Modal';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { date, money, titleCase } from '../lib/format';

const SWAP_TYPES: ExceptionType[] = [ExceptionType.SWAP_OUTSIDE_RETURN_WINDOW, ExceptionType.SWAP_OUTSIDE_WARRANTY];

function Context({ e }: { e: ExceptionRequest }) {
  return (
    <div className="small">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {e.orderId != null && <span className="muted">Order #{e.orderId}</span>}
        {e.merchantId != null && <span className="muted">Merchant #{e.merchantId}</span>}
        {e.returnCaseId != null && <span className="muted">Return #{e.returnCaseId}</span>}
        {e.serialNumber && <span className="mono muted">{e.serialNumber}</span>}
      </div>
      {e.type === ExceptionType.PRICE_EXCEPTION && (e.originalPrice != null || e.requestedPrice != null) && (
        <div className="muted">{money(e.originalPrice)} → {money(e.requestedPrice)}</div>
      )}
      {SWAP_TYPES.includes(e.type) && e.daysSinceDeployment != null && (
        <div className="muted">{e.daysSinceDeployment} days</div>
      )}
    </div>
  );
}

export function Approvals() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();
  const [decideFor, setDecideFor] = useState<{ exception: ExceptionRequest; decision: 'APPROVED' | 'DENIED' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['exceptions'],
    queryFn: () => api.exceptions.list({}),
  });

  const [sp] = useSearchParams();
  const ctl = useTableControls(data?.exceptions ?? [], {
    search: (e) => `${e.requestedBy} ${e.reason} ${EXCEPTION_LABELS[e.type]} ${e.serialNumber ?? ''}`,
    searchPlaceholder: 'Search requester, reason, type…',
    dateField: (e) => e.requestedAt,
    dateLabel: 'Requested',
    initial: sp.get('status') ? { facets: { status: [sp.get('status')!] } } : undefined,
    facets: [
      { key: 'status', label: 'Status', value: (e) => titleCase(e.status) },
      { key: 'type', label: 'Type', value: (e) => EXCEPTION_LABELS[e.type] },
    ],
  });

  const canApprove = can(Permission.EXCEPTION_APPROVE);

  const openDecision = (exception: ExceptionRequest, decision: 'APPROVED' | 'DENIED') => {
    setDecisionNote('');
    setDecideFor({ exception, decision });
  };

  const decide = useMutation({
    mutationFn: () =>
      api.exceptions.decide(decideFor!.exception.id, {
        decision: decideFor!.decision,
        decisionNote: decisionNote || undefined,
      }),
    onSuccess: () => {
      const approving = decideFor!.decision === ExceptionStatus.APPROVED;
      toast.push(approving ? 'Exception approved — a parked return may resume' : 'Exception denied', 'success');
      qc.invalidateQueries({ queryKey: ['exceptions'] });
      qc.invalidateQueries({ queryKey: ['approvals-count'] });
      setDecideFor(null);
    },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Decision failed', 'error'),
  });

  return (
    <AppShell title="Approvals">
      {ctl.toolbar}

      <DataTable
        keyOf={(e) => e.id}
        rows={ctl.rows}
        loading={isLoading}
        empty="No exceptions match."
        columns={[
          { header: 'Type', sort: (e) => EXCEPTION_LABELS[e.type], cell: (e) => EXCEPTION_LABELS[e.type] },
          { header: 'Requested by', sort: (e) => e.requestedBy, cell: (e) => <span className="small">{e.requestedBy}</span> },
          { header: 'Reason', sort: (e) => e.reason, cell: (e) => <span className="small">{e.reason}</span> },
          { header: 'Context', cell: (e) => <Context e={e} /> },
          { header: 'Status', sort: (e) => e.status, cell: (e) => <StatusBadge status={e.status} /> },
          { header: 'Requested', sort: (e) => e.requestedAt, cell: (e) => <span className="small">{date(e.requestedAt)}</span> },
          {
            header: '',
            cell: (e) =>
              canApprove && e.status === ExceptionStatus.PENDING ? (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary sm" onClick={() => openDecision(e, ExceptionStatus.APPROVED)}>Approve</button>
                  <button className="btn danger sm" onClick={() => openDecision(e, ExceptionStatus.DENIED)}>Deny</button>
                </div>
              ) : null,
          },
        ]}
      />

      {decideFor && (
        <Modal
          title={`${decideFor.decision === ExceptionStatus.APPROVED ? 'Approve' : 'Deny'} exception`}
          onClose={() => setDecideFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDecideFor(null)}>Cancel</button>
              <button
                className={`btn ${decideFor.decision === ExceptionStatus.APPROVED ? 'primary' : 'danger'}`}
                onClick={() => decide.mutate()}
                disabled={decide.isPending}
              >
                {decideFor.decision === ExceptionStatus.APPROVED ? 'Approve' : 'Deny'}
              </button>
            </>
          }
        >
          <div className="small muted" style={{ marginBottom: 12 }}>
            {EXCEPTION_LABELS[decideFor.exception.type]} · requested by {decideFor.exception.requestedBy}
          </div>
          <div className="field">
            <label>Decision note (optional)</label>
            <textarea rows={3} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
