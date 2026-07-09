import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@de/shared';
import { publicApi } from '../../api/client';
import { PizzaTracker } from '../../components/PizzaTracker';
import { Loading } from '../../components/ui';
import { PublicBand } from './PublicBand';

export function TrackPublic() {
  const { id } = useParams();
  const orderId = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ['public-order', orderId],
    queryFn: () => publicApi.getOrder(orderId),
    refetchInterval: 8_000,
  });

  return (
    <><PublicBand title="Order Tracking" meta={`Order #${orderId}`} />
    <div className="public-shell">
      <div className="card">
        {isLoading || !data ? (
          <Loading />
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 16 }}>
              <div><div className="muted small">Reference</div><strong className="mono">{data.order.reference}</strong></div>
            </div>
            <PizzaTracker status={data.order.status as OrderStatus} packages={data.order.packages} />
            {data.order.serialNumbers.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted small">Assigned serial numbers</div>
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  {data.order.serialNumbers.map((sn) => <span key={sn} className="badge gray mono">{sn}</span>)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>This page refreshes automatically.</p>
    </div></>
  );
}
