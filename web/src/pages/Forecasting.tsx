import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertLevel, type ForecastRow, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';

/** "2026-08" → "Aug '26" */
function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const name = new Date(Date.UTC(y, (mo ?? 1) - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${name} '${String(y).slice(-2)}`;
}

/** Editable 12-month estimate calendar for one part, plus the past-12 demand row for context. */
function EstimateGrid({ row, canEdit }: { row: ForecastRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edits, setEdits] = useState<Record<string, number>>({});
  const save = useMutation({
    mutationFn: ({ month, qty }: { month: string; qty: number }) => api.inventory.setEstimate(row.newPartId, month, qty),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-forecast'] }); },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Save failed', 'error'),
  });
  const estimates = row.monthlyEstimates ?? [];
  const history = row.demandHistory ?? [];
  const valOf = (month: string, fallback: number) => (edits[month] ?? fallback);
  const estTotal = estimates.reduce((s, e) => s + valOf(e.month, e.qty), 0);
  const histTotal = history.reduce((s, h) => s + h.qty, 0);

  return (
    <div className="fc-panel">
      <div className="fc-block">
        <div className="fc-block-head"><span>Past 12 months — actual demand</span><span className="muted">total {histTotal}</span></div>
        <div className="fc-scroll">
          <table className="fc-grid">
            <thead><tr>{history.map((h) => <th key={h.month}>{monthLabel(h.month)}</th>)}</tr></thead>
            <tbody><tr>{history.map((h) => <td key={h.month}>{h.qty}</td>)}</tr></tbody>
          </table>
        </div>
      </div>

      <div className="fc-block">
        <div className="fc-block-head">
          <span>Next 12 months — estimate {canEdit ? <span className="fc-editable-hint">editable</span> : <span className="muted">read-only</span>}</span>
          <span className="muted">total {estTotal}</span>
        </div>
        <div className="fc-scroll">
          <table className="fc-grid">
            <thead><tr>{estimates.map((e) => <th key={e.month}>{monthLabel(e.month)}</th>)}</tr></thead>
            <tbody>
              <tr className={canEdit ? 'fc-editrow' : ''}>
                {estimates.map((e) => (
                  <td key={e.month}>
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        value={valOf(e.month, e.qty)}
                        onChange={(ev) => setEdits((s) => ({ ...s, [e.month]: Math.max(0, Number(ev.target.value) || 0) }))}
                        onBlur={(ev) => { const qty = Math.max(0, Number(ev.target.value) || 0); if (qty !== e.qty) save.mutate({ month: e.month, qty }); }}
                        className="fc-input"
                      />
                    ) : e.qty}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {row.consignedOnHand === 0 && (
        <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>OH Consigned is 0 — this device is purchased directly from POS Portal inventory.</div>
      )}
    </div>
  );
}

type Tab = 'alerts' | 'settings';

export function Forecasting() {
  const [sp] = useSearchParams();
  const canEdit = useAuth((s) => s.can)(Permission.EXCEPTION_APPROVE);
  const [tab, setTab] = useState<Tab>(sp.get('tab') === 'settings' ? 'settings' : 'alerts');
  const forecast = useQuery({ queryKey: ['inventory-forecast'], queryFn: api.inventory.forecast });

  const settings = useTableControls(forecast.data?.rows ?? [], {
    search: (r) => `${r.partDesc} ${r.mfgPartId} ${r.newPartId} ${r.manufacturer}`,
    searchPlaceholder: 'Search part, model, manufacturer…',
    facets: [
      { key: 'mfg', label: 'Manufacturer', value: (r) => r.manufacturer },
      { key: 'stock', label: 'Stock', value: (r) => (r.consignedOnHand > 0 ? 'In consigned' : 'Buy from POS Portal') },
    ],
  });

  return (
    <AppShell title="Forecasting">
      <div className="tabs">
        <div className={`tab ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>Forecast Alerts</div>
        <div className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Forecast Settings</div>
      </div>

      {tab === 'alerts' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.data?.metrics.devices ?? 0}</div></Card>
            <Card><div className="muted small">At Risk</div><div style={{ fontSize: 24, fontWeight: 700, color: (forecast.data?.metrics.atRisk ?? 0) > 0 ? 'var(--danger)' : undefined }}>{forecast.data?.metrics.atRisk ?? 0}</div></Card>
            <Card><div className="muted small">Forecast (12 Mo)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.data?.metrics.totalForecast12Mo ?? 0}</div></Card>
            <Card><div className="muted small">Suggested Buy</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.data?.metrics.totalSuggestedBuy ?? 0}</div></Card>
          </div>

          {(forecast.data?.alerts.length ?? 0) > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <h3>Alerts</h3>
              <div className="grid" style={{ gap: 8 }}>
                {forecast.data?.alerts.map((a, idx) => (
                  <div key={idx} className="row" style={{ gap: 8, color: a.level === AlertLevel.MEDIUM ? 'var(--warn)' : 'var(--danger)' }}>
                    <span className="mono small">{a.code}</span>
                    <strong>{a.partDesc}</strong>
                    <span className="small">{a.message}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <h3>Suggested buy plan</h3>
            <DataTable
              keyOf={(r) => r.newPartId}
              rows={forecast.data?.buyPlan}
              loading={forecast.isLoading}
              empty="No suggested buys."
              columns={[
                { header: 'Part', sort: (r) => r.partDesc.toLowerCase(), cell: (r) => r.partDesc },
                { header: 'OH Consigned', sort: (r) => r.consignedOnHand, cell: (r) => r.consignedOnHand },
                { header: 'Forecast (12 Mo)', sort: (r) => r.forecast12MoTotal, cell: (r) => r.forecast12MoTotal },
                { header: 'Avg Velocity', sort: (r) => r.avgVelocity, cell: (r) => r.avgVelocity },
                { header: 'Coverage (Mo)', sort: (r) => r.coverageMonths, cell: (r) => r.coverageMonths },
                { header: 'Suggested Buy', sort: (r) => r.suggestedBuyQty, cell: (r) => <strong>{r.suggestedBuyQty}</strong> },
              ]}
            />
          </Card>
        </>
      )}

      {tab === 'settings' && (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            View and edit forecasting numbers per part. Expand a row to enter monthly estimates — e.g. if sales flags a 150-unit
            deal for a device next month, bump that month. <strong>OH Consigned = 0</strong> means we buy that part directly from POS Portal.
            {!canEdit && ' (You have read-only access — editing requires manager/admin.)'} All edits are recorded in the audit log.
          </p>
          {settings.toolbar}
          <DataTable
            keyOf={(r) => r.newPartId}
            rows={settings.rows}
            loading={forecast.isLoading}
            empty="No forecast parts."
            renderExpanded={(r) => <EstimateGrid row={r} canEdit={canEdit} />}
            columns={[
              { header: 'Part', sort: (r) => r.partDesc.toLowerCase(), cell: (r) => <div><div>{r.partDesc}</div><div className="small muted mono">{r.mfgPartId}</div></div> },
              { header: 'Manufacturer', sort: (r) => r.manufacturer, cell: (r) => <span className="small">{r.manufacturer}</span> },
              { header: 'OH Consigned', sort: (r) => r.consignedOnHand, cell: (r) => (r.consignedOnHand > 0 ? r.consignedOnHand : <Badge tone="amber">0 · POS Portal</Badge>) },
              { header: 'Past 12 FCST', sort: (r) => r.past12Forecast ?? 0, cell: (r) => r.past12Forecast ?? '—' },
              { header: 'Past 12 DMD', sort: (r) => r.past12Demand ?? 0, cell: (r) => <strong>{r.past12Demand ?? '—'}</strong> },
              { header: 'Avg/mo 3', sort: (r) => r.avgMonthly3 ?? 0, cell: (r) => r.avgMonthly3 ?? '—' },
              { header: 'Avg/mo 6', sort: (r) => r.avgMonthly6 ?? 0, cell: (r) => r.avgMonthly6 ?? '—' },
              { header: 'Avg/mo 12', sort: (r) => r.avgMonthly12 ?? 0, cell: (r) => r.avgMonthly12 ?? '—' },
            ]}
          />
        </>
      )}
    </AppShell>
  );
}
