import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, ReturnType } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card, Loading, StatusBadge } from '../components/ui';
import { ReturnTracker } from '../components/ReturnTracker';
import { SerialLink } from '../components/SerialLink';
import { ActivityCard } from '../components/ActivityCard';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { money, serialTag, titleCase } from '../lib/format';

export function ReturnDetail() {
  const { id } = useParams();
  const returnId = Number(id);
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['return', returnId],
    queryFn: () => api.returns.get(returnId),
  });

  const merchantId = data?.return.merchantId;
  const devicesQ = useQuery({
    queryKey: ['deployed', 'merchant', merchantId],
    queryFn: () => api.deployed.list({ merchantId }),
    enabled: merchantId != null,
  });
  // Resolve each returned unit back to the INTERNAL order that shipped it (via deployed equipment).
  // NB: never fall back to return.entityId — for POS-Portal-imported returns that is a POS Portal
  // order number, not an internal id, and linking to it produced a dead /orders/<pospId> page.
  const serialToOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devicesQ.data?.equipment ?? []) {
      if (d.orderId != null) { m.set(d.serialNumber, d.orderId); m.set(serialTag(d.serialNumber), d.orderId); }
    }
    return m;
  }, [devicesQ.data]);
  const orderFor = (serial?: string) => serialToOrder.get(serial ?? '') ?? serialToOrder.get(serialTag(serial));

  const receive = useMutation({
    mutationFn: () => api.returns.receive(returnId, data!.return.expectedItemCount),
    onSuccess: () => {
      toast.push('Items received', 'success');
      qc.invalidateQueries({ queryKey: ['return', returnId] });
    },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Action failed', 'error'),
  });

  if (isLoading || !data) return <AppShell title="Return"><Loading /></AppShell>;
  const r = data.return;
  const isSwap = r.items.some((it) => it.returnType === ReturnType.REPLACEMENT);

  return (
    <AppShell
      title={`${isSwap ? 'Swap' : 'Return'} #${r.id}`}
      actions={
        <div className="row">
          <button className="btn" onClick={() => navigate(isSwap ? '/swaps' : '/returns')}>← {isSwap ? 'Swaps' : 'Returns'}</button>
          {can(Permission.RETURN_WRITE) && (
            <button className="btn primary" onClick={() => receive.mutate()} disabled={receive.isPending}>Receive items</button>
          )}
        </div>
      }
    >
      <Card>
        <div className="row" style={{ gap: 10, marginBottom: 16 }}>
          <StatusBadge status={r.lifecycle} />
          {r.callTagStatus && <span className="muted small">Call tag: {titleCase(r.callTagStatus)}</span>}
          {r.callTagId != null && <span className="muted mono small">#{r.callTagId}</span>}
          {r.delinquent && <Badge tone="red">Delinquent</Badge>}
        </div>
        <ReturnTracker lifecycle={r.lifecycle} />
        {r.exceptionId != null && (
          <div className="small amber" style={{ marginTop: 10 }}>
            Blocked on manager approval #{r.exceptionId}{' '}
            <a onClick={() => navigate('/approvals')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>View approval</a>
          </div>
        )}
      </Card>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card>
          <h3>Case</h3>
          <div className="small muted">Entity: {titleCase(r.entityType)} #{r.entityId}</div>
          <div className="small muted">Merchant #{r.merchantId} <span className="mono">{r.mid ?? '—'}</span></div>
          <div className="small muted" style={{ marginTop: 6 }}>Expected {r.expectedItemCount} · Received {r.receivedItemCount}</div>
          {r.daysSinceDeployment != null && <div className="small muted">Days since deployment: {r.daysSinceDeployment}</div>}
          <div className="small muted" style={{ marginTop: 6 }}>Refund: {money(r.refundAmount)}</div>
          {r.replacementOrderId != null && (
            <div className="small muted" style={{ marginTop: 6 }}>
              Replacement order:{' '}
              <a onClick={() => navigate(`/orders/${r.replacementOrderId}`)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>#{r.replacementOrderId}</a>
            </div>
          )}
          {r.notes && <div className="small muted" style={{ marginTop: 6 }}>{r.notes}</div>}
        </Card>

        <Card>
          <h3>{isSwap ? 'What’s being swapped' : 'Items'} ({r.items.length})</h3>
          {r.items.map((it, i) => {
            const returnedOrder = orderFor(it.expectedSerialNumber);
            const isReplacementItem = it.returnType === ReturnType.REPLACEMENT;
            return (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <Badge tone={isReplacementItem ? 'blue' : 'gray'}>{titleCase(it.returnType)}</Badge>
                  <span className="small muted">{titleCase(it.reasonCode)}</span>
                </div>
                <div className="swap-flow">
                  {/* Device coming back */}
                  <div className="swap-node">
                    <div className="muted small">Returning</div>
                    <div>{it.expectedProduct ?? it.receivedProduct ?? 'Device'}</div>
                    {it.expectedSerialNumber
                      ? <div style={{ marginTop: 2 }}>{returnedOrder ? <SerialLink serial={it.expectedSerialNumber} orderId={returnedOrder} /> : <span className="badge gray mono" title={it.expectedSerialNumber}>{serialTag(it.expectedSerialNumber)}</span>}</div>
                      : <div className="small muted">serial pending</div>}
                    {returnedOrder && <div className="small muted" style={{ marginTop: 2 }}>from order #{returnedOrder}</div>}
                  </div>
                  {isReplacementItem && (
                    <>
                      <div className="swap-arrow">→</div>
                      {/* Replacement going out */}
                      <div className="swap-node">
                        <div className="muted small">Replacement</div>
                        {r.replacementOrderId
                          ? <div><Link className="rowlink mono" to={`/orders/${r.replacementOrderId}`}>New order #{r.replacementOrderId}</Link></div>
                          : <div className="small muted">Being prepared</div>}
                        {it.receivedSerialNumber && <div style={{ marginTop: 2 }}><SerialLink serial={it.receivedSerialNumber} orderId={orderFor(it.receivedSerialNumber)} /></div>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="small muted" style={{ marginTop: 8 }}>Units are identified by the last 8 of their serial — click one to open the order it shipped on.</div>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <ActivityCard type="return" id={r.id} />
      </div>
    </AppShell>
  );
}
