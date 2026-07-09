import { Link } from 'react-router-dom';
import { serialTag } from '../lib/format';

/**
 * Renders a unit by its last-8 serial identifier. When the originating order is known it links
 * there ("loop back to the order that shipped this unit"); otherwise it's a plain tag. The full
 * serial is available on hover for support.
 */
export function SerialLink({ serial, orderId }: { serial?: string | null; orderId?: number }) {
  const tag = serialTag(serial);
  if (!tag) return <span className="muted">—</span>;
  const badge = <span className="serial-chip" title={serial ?? undefined}>{tag}</span>;
  if (!orderId) return badge;
  return (
    <Link to={`/orders/${orderId}`} onClick={(e) => e.stopPropagation()} className="serial-link" title={`${serial ?? tag} — open origin order`}>
      {badge}
    </Link>
  );
}
