import { useQuery } from '@tanstack/react-query';
import type { AuditEntry } from '@de/shared';
import { Card } from './ui';
import { api } from '../api/client';
import { dateTime, titleCase } from '../lib/format';

/** Human label for an audit action code (e.g. "order.ship" → "Shipped"). */
const ACTION_LABELS: Record<string, string> = {
  'order.create': 'Order created',
  'order.cancel': 'Order cancelled',
  'dev.ship': 'Shipment recorded — serials assigned',
  'dev.deliver': 'Marked delivered',
  'return.create': 'Return / swap opened',
  'return.receive': 'Items received',
};
function actionLabel(a: AuditEntry): string {
  return ACTION_LABELS[a.action] ?? titleCase(a.action.replace(/[.:]/g, ' '));
}

/**
 * Audit trail for a single entity (order/return). Shows who did what, when — the "last people
 * who performed actions." Gated server-side by the entity's read permission.
 */
export function ActivityCard({ type, id }: { type: 'order' | 'return'; id: number }) {
  const q = useQuery({
    queryKey: [type, 'activity', id],
    queryFn: () => (type === 'order' ? api.orders.activity(id) : api.returns.activity(id)),
  });
  const entries = q.data?.entries ?? [];

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Activity</h3>
      {q.isLoading ? (
        <div className="small muted">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="small muted">No recorded actions yet.</div>
      ) : (
        <div className="timeline">
          {entries.map((a) => (
            <div key={a.id} className="timeline-item">
              <span className="timeline-dot" aria-hidden />
              <div className="timeline-body">
                <div className="row between" style={{ gap: 8 }}>
                  <strong className="small">{actionLabel(a)}</strong>
                  <span className="small muted">{dateTime(a.createdAt)}</span>
                </div>
                <div className="small muted">
                  {a.actor}{a.actorRole && a.actorRole !== 'anonymous' ? ` · ${titleCase(a.actorRole)}` : ''}
                  {typeof a.statusCode === 'number' && a.statusCode >= 400 ? ` · failed (${a.statusCode})` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
