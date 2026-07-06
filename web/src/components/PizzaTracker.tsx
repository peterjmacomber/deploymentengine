import { TRACKER_ORDER, TRACKER_STAGE_LABELS, trackerView, type OrderStatus, type Package } from '@de/shared';

/**
 * Pizza-tracker view of an order's fulfillment. Renders the canonical stages and highlights
 * the current one; exception states (cancelled / returned / delivery failed) show a banner.
 */
export function PizzaTracker({ status, packages = [] }: { status: OrderStatus; packages?: Package[] }) {
  const view = trackerView(status);
  const pkg = packages[0];

  if (view.isException) {
    return (
      <div>
        <div className="badge red" style={{ fontSize: 13, padding: '6px 12px' }}>{view.exceptionLabel}</div>
        {pkg?.trackingNumber && <div className="small muted" style={{ marginTop: 8 }}>Tracking: <span className="mono">{pkg.trackingNumber}</span></div>}
      </div>
    );
  }

  return (
    <div>
      <div className="tracker">
        {TRACKER_ORDER.map((stage, i) => {
          const state = i < view.index ? 'done' : i === view.index ? 'current' : '';
          const sub =
            stage === 'SHIPPED' && pkg?.trackingNumber ? pkg.trackingNumber :
            stage === 'DELIVERED' && pkg?.deliveredAt ? new Date(pkg.deliveredAt).toLocaleDateString() : '';
          return (
            <div key={stage} className={`stage ${state}`}>
              <span className="bullet">{i < view.index ? '✓' : i + 1}</span>
              <div className="label">{TRACKER_STAGE_LABELS[stage]}</div>
              {sub && <div className="sub mono">{sub}</div>}
            </div>
          );
        })}
      </div>
      {pkg && (
        <div className="row small muted" style={{ marginTop: 6, gap: 18 }}>
          {pkg.carrier && <span>Carrier: <strong>{pkg.carrier}</strong></span>}
          {pkg.trackingNumber && <span>Tracking: <span className="mono">{pkg.trackingNumber}</span></span>}
          {pkg.signedBy && <span>Signed by: {pkg.signedBy}</span>}
        </div>
      )}
    </div>
  );
}
