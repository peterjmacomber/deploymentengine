import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus, Package } from '@de/shared';
import { publicTrack, ApiError } from '../../api/client';
import { PizzaTracker } from '../../components/PizzaTracker';
import { Loading } from '../../components/ui';
import { date } from '../../lib/format';

/**
 * Public, share-token tracking page. Shows fulfillment progress with NO sensitive details
 * (no MID, address, phone, or email) — safe to hand to a merchant or partner.
 */
export function TrackToken() {
  const { token } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-track', token],
    queryFn: () => publicTrack.get(token!),
    refetchInterval: 15_000,
    retry: false,
  });

  if (error) {
    const e = error as ApiError;
    return (
      <div className="public-shell">
        <div className="public-header"><span className="dot">◆</span><h1 style={{ margin: 0 }}>Tracking</h1></div>
        <div className="card">{e.detail ?? e.message ?? 'This tracking link is not available.'}</div>
      </div>
    );
  }

  return (
    <div className="public-shell">
      <div className="public-header">
        <span className="dot">◆</span>
        <div>
          <h1 style={{ margin: 0 }}>Order Tracking</h1>
          <div className="muted small">{data?.reference ? `Reference ${data.reference}` : 'Fulfillment status'}</div>
        </div>
      </div>
      <div className="card">
        {isLoading || !data ? (
          <Loading />
        ) : (
          <>
            <PizzaTracker status={data.status as OrderStatus} packages={data.packages as Package[]} />

            {data.items.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted small">Items</div>
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {data.items.map((it, i) => <span key={i} className="badge gray">{it.name} × {it.quantity}</span>)}
                </div>
              </div>
            )}

            {data.serials.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted small">Device IDs (last 8 of serial)</div>
                <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {data.serials.map((s) => <span key={s} className="badge gray mono">{s}</span>)}
                </div>
              </div>
            )}

            {data.packages.some((p) => p.trackingNumber) && (
              <div style={{ marginTop: 18 }}>
                <div className="muted small">Shipments</div>
                {data.packages.filter((p) => p.trackingNumber).map((p, i) => (
                  <div key={i} className="small" style={{ marginTop: 4 }}>
                    {p.carrier ?? 'Carrier'} · <span className="mono">{p.trackingNumber}</span>
                    {p.shippedAt ? ` · shipped ${date(p.shippedAt)}` : ''}{p.deliveredAt ? ` · delivered ${date(p.deliveredAt)}` : ''}
                  </div>
                ))}
              </div>
            )}

            <div className="muted small" style={{ marginTop: 18 }}>Placed {date(data.placedAt)}{data.shippingMethodLabel ? ` · ${data.shippingMethodLabel}` : ''}</div>
          </>
        )}
      </div>
      <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>This page refreshes automatically.</p>
    </div>
  );
}
