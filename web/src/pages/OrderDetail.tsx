import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderStatus, Permission, ReturnLifecycle, ReturnReasonCode, ReturnType } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card, Loading, StatusBadge } from '../components/ui';
import { PizzaTracker } from '../components/PizzaTracker';
import { ReturnSwapModal } from '../components/ReturnSwapModal';
import { SerialLink } from '../components/SerialLink';
import { ActivityCard } from '../components/ActivityCard';
import { ShareTrackingButton } from '../components/ShareTrackingButton';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { dateTime, money, serialTag } from '../lib/format';

const CAN_SHIP: string[] = [OrderStatus.DRAFT, OrderStatus.PLACED, OrderStatus.IN_PREP, OrderStatus.BACKORDERED];
const CAN_DELIVER: string[] = [OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY];

export function OrderDetail() {
  const { id } = useParams();
  const orderId = Number(id);
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();
  const [returnOpen, setReturnOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['order', orderId], queryFn: () => api.orders.get(orderId, true), refetchInterval: 15_000 });
  const devices = useQuery({ queryKey: ['deployed', 'order', orderId], queryFn: () => api.deployed.list({ orderId }) });

  const mutation = (fn: () => Promise<unknown>, ok: string) => ({
    mutationFn: fn,
    onSuccess: () => { toast.push(ok, 'success'); qc.invalidateQueries({ queryKey: ['order', orderId] }); qc.invalidateQueries({ queryKey: ['deployed', 'order', orderId] }); },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Action failed', 'error'),
  });
  const cancel = useMutation(mutation(() => api.orders.cancel(orderId), 'Order cancelled'));
  const ship = useMutation(mutation(() => api.dev.ship(orderId), 'Shipment simulated — serials assigned & devices activated in Fortis Gateway'));
  const deliver = useMutation(mutation(() => api.dev.deliver(orderId, 'J. DOE'), 'Marked delivered'));

  if (isLoading || !data) return <AppShell title="Order"><Loading /></AppShell>;
  const o = data.order;
  const canSimulate = can(Permission.DEV_TOOLS) && CAN_SHIP.includes(o.status);
  const canMarkDelivered = can(Permission.DEV_TOOLS) && CAN_DELIVER.includes(o.status);
  const deviceRows = devices.data?.equipment ?? [];

  return (
    <AppShell
      title={`Order ${o.reference ?? o.id}`}
      actions={
        <div className="row">
          <button className="btn" onClick={() => navigate('/orders')}>← Orders</button>
          <ShareTrackingButton orderId={orderId} />
          {can(Permission.RETURN_WRITE) && <button className="btn" onClick={() => setReturnOpen(true)}>Return / Swap</button>}
          {can(Permission.ORDER_CANCEL) && o.cancellable && <button className="btn danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</button>}
        </div>
      }
    >
      <Card>
        <div className="row between" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 10 }}>
            <StatusBadge status={o.status} />
            <span className="muted small">{o.classification.replace(/_/g, ' ')}</span>
            {o.syncStatus === 'synced' && <Badge tone="green">Synced to POS Portal</Badge>}
            {o.syncStatus === 'local' && <Badge tone="amber"><span title={o.syncError}>Not synced — {o.syncError ?? 'sandbox rejected'}</span></Badge>}
          </div>
          {can(Permission.DEV_TOOLS) && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => ship.mutate()} disabled={!canSimulate || ship.isPending} title={canSimulate ? '' : 'Only available before the order ships'}>Simulate shipment</button>
              <button className="btn sm" onClick={() => deliver.mutate()} disabled={!canMarkDelivered || deliver.isPending} title={canMarkDelivered ? '' : 'Only available once shipped'}>Mark delivered</button>
            </div>
          )}
        </div>
        <PizzaTracker status={o.status} packages={o.packages} />
      </Card>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card>
          <h3>Merchant &amp; shipping</h3>
          <div><strong>{o.merchant.dbaName}</strong> <span className="muted mono small">{o.merchant.mid}</span></div>
          {o.merchant.shippingAddress && (
            <div className="small muted" style={{ marginTop: 6 }}>
              {o.merchant.shippingAddress.line1}<br />
              {o.merchant.shippingAddress.city}, {o.merchant.shippingAddress.region} {o.merchant.shippingAddress.postalCode}
            </div>
          )}
          <div className="small muted" style={{ marginTop: 10 }}>Shipping: {o.shippingMethodLabel ?? '—'}</div>
          <div className="small muted">Created {dateTime(o.createdAt)} by {o.createdBy ?? '—'}</div>
        </Card>

        <Card>
          <h3>Line items</h3>
          {o.lines.map((l, i) => (
            <div key={i} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div>{l.name} <span className="muted small">× {l.quantity}</span></div>
              <strong>{money(l.unitPrice)}</strong>
            </div>
          ))}
          {o.lines.length === 0 && <div className="muted small">No line items.</div>}
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <h3>Deployed devices &amp; Fortis Gateway activation</h3>
        {deviceRows.length === 0 ? (
          <div className="muted small">
            {o.serialNumbers.length === 0
              ? 'No serials assigned yet — serials + Fortis activation happen at shipment.'
              : <span className="row" style={{ gap: 6 }}>{o.serialNumbers.map((s) => <SerialLink key={s} serial={s} />)}</span>}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Serial (last 8)</th><th>Product</th><th>Fortis Account</th><th>Gateway</th></tr></thead>
              <tbody>
                {deviceRows.map((d) => (
                  <tr key={d.id}>
                    <td className="mono" title={d.serialNumber}>{serialTag(d.serialNumber)}</td>
                    <td className="small">{d.productName ?? d.model ?? '—'}</td>
                    <td className="mono small">{d.fortisAccountId ?? '—'}</td>
                    <td>{d.fortisActivated ? <Badge tone="green">Activated</Badge> : <Badge tone="amber">Pending</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <ActivityCard type="order" id={orderId} />
      </div>

      {returnOpen && <ReturnSwapModal order={o} onClose={() => setReturnOpen(false)} />}
    </AppShell>
  );
}
