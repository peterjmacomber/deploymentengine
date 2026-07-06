import { RETURN_STAGES, RETURN_STAGE_LABELS, returnTrackerView } from '@de/shared';

/** Pizza-tracker for a return/swap case lifecycle. */
export function ReturnTracker({ lifecycle }: { lifecycle: string }) {
  const view = returnTrackerView(lifecycle);
  if (view.isException) {
    return <div className="badge red" style={{ fontSize: 13, padding: '6px 12px' }}>{view.exceptionLabel}</div>;
  }
  return (
    <div className="tracker">
      {RETURN_STAGES.map((stage, i) => {
        const state = i < view.index ? 'done' : i === view.index ? 'current' : '';
        return (
          <div key={stage} className={`stage ${state}`}>
            <span className="bullet">{i < view.index ? '✓' : i + 1}</span>
            <div className="label">{RETURN_STAGE_LABELS[stage]}</div>
          </div>
        );
      })}
    </div>
  );
}
