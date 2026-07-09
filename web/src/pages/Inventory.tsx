import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertLevel, type ForecastRow, InventoryCondition, type InventoryItem, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card } from '../components/ui';
import { type Column, DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';

const MANUFACTURERS = ['Ingenico', 'PAX', 'ID Tech', 'Dejavoo'];

function ConditionBadge({ c }: { c?: string }) {
  if (c === InventoryCondition.REFURB) return <Badge tone="amber">Refurb</Badge>;
  if (c === InventoryCondition.NEW) return <Badge tone="green">New</Badge>;
  return <Badge tone="gray">{c ? c.toLowerCase() : 'other'}</Badge>;
}

const EQUIP_COLUMNS: Column<InventoryItem>[] = [
  { header: 'Part', sort: (i) => i.partDesc.toLowerCase(), cell: (i) => <div><div>{i.partDesc}</div><div className="small muted mono">{i.modelNumber}</div></div> },
  { header: 'Manufacturer', sort: (i) => i.manufacturer, cell: (i) => i.manufacturer },
  { header: 'Condition', sort: (i) => i.condition ?? '', cell: (i) => <ConditionBadge c={i.condition} /> },
  { header: 'FGI', sort: (i) => i.fgiQty, cell: (i) => i.fgiQty },
  { header: 'In-Repair', sort: (i) => i.inRepairQty, cell: (i) => i.inRepairQty },
  { header: 'Core', sort: (i) => i.coreQty, cell: (i) => i.coreQty },
  { header: 'Scrap', sort: (i) => i.scrapQty, cell: (i) => i.scrapQty },
  { header: 'Total', sort: (i) => i.totalQty, cell: (i) => <strong>{i.totalQty}</strong> },
];

const TABS = [
  { key: 'equipment', label: 'Equipment' },
  { key: 'nonequipment', label: 'Non-Equipment' },
  { key: 'alerts', label: 'Forecast Alerts' },
  { key: 'settings', label: 'Forecast Settings' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function Inventory() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'equipment') as Tab;
  const setTab = (t: Tab) => { const next = new URLSearchParams(sp); if (t === 'equipment') next.delete('tab'); else next.set('tab', t); setSp(next, { replace: true }); };
  const [mfg, setMfg] = useState('');
  const [cond, setCond] = useState('');
  const canEdit = useAuth((s) => s.can)(Permission.EXCEPTION_APPROVE);

  const consigned = useQuery({ queryKey: ['inventory-consigned'], queryFn: api.inventory.consigned });
  const forecast = useQuery({ queryKey: ['inventory-forecast'], queryFn: api.inventory.forecast, enabled: tab === 'alerts' || tab === 'settings' });

  const equipment = (consigned.data?.items ?? []).filter((i) => !i.isNonSerialized);
  const nonEquipment = (consigned.data?.items ?? []).filter((i) => i.isNonSerialized);

  const eq = {
    total: equipment.reduce((s, i) => s + i.totalQty, 0),
    fgi: equipment.reduce((s, i) => s + i.fgiQty, 0),
    repair: equipment.reduce((s, i) => s + i.inRepairQty, 0),
  };
  const ne = { total: nonEquipment.reduce((s, i) => s + i.totalQty, 0), fgi: nonEquipment.reduce((s, i) => s + i.fgiQty, 0) };

  const filteredEquip = equipment.filter((i) =>
    (!mfg || i.manufacturer === mfg) &&
    (!cond || (cond === InventoryCondition.REFURB ? i.condition === InventoryCondition.REFURB : i.condition !== InventoryCondition.REFURB)));

  const settings = useTableControls(forecast.data?.rows ?? [], {
    search: (r) => `${r.partDesc} ${r.mfgPartId} ${r.newPartId} ${r.manufacturer}`,
    searchPlaceholder: 'Search part, model, manufacturer…',
    facets: [
      { key: 'mfg', label: 'Manufacturer', value: (r) => r.manufacturer },
      { key: 'stock', label: 'Stock', value: (r) => (r.consignedOnHand > 0 ? 'In consigned' : 'Buy from POS Portal') },
    ],
  });

  return (
    <AppShell title="Inventory & Forecast">
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {tab === 'equipment' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Equipment SKUs</div><div style={{ fontSize: 24, fontWeight: 700 }}>{equipment.length}</div></Card>
            <Card><div className="muted small">Total on hand</div><div style={{ fontSize: 24, fontWeight: 700 }}>{eq.total}</div></Card>
            <Card><div className="muted small">FGI</div><div style={{ fontSize: 24, fontWeight: 700 }}>{eq.fgi}</div></Card>
            <Card><div className="muted small">In-Repair</div><div style={{ fontSize: 24, fontWeight: 700 }}>{eq.repair}</div></Card>
          </div>
          <div className="chips">
            {['', ...MANUFACTURERS].map((mk) => (
              <button key={mk || 'all'} type="button" className={`chip ${mfg === mk ? 'active' : ''}`} onClick={() => setMfg(mk)}>{mk || 'All manufacturers'}</button>
            ))}
          </div>
          <div className="chips">
            {([['', 'All conditions'], [InventoryCondition.NEW, 'New'], [InventoryCondition.REFURB, 'Refurb']] as const).map(([ck, cl]) => (
              <button key={ck || 'all'} type="button" className={`chip ${cond === ck ? 'active' : ''}`} onClick={() => setCond(ck)}>{cl}</button>
            ))}
          </div>
          <Card>
            <DataTable keyOf={(i) => i.productId} rows={filteredEquip} loading={consigned.isLoading} empty="No equipment for this filter." columns={EQUIP_COLUMNS} />
          </Card>
        </>
      )}

      {tab === 'nonequipment' && (
        <>
          <div className="grid cols-3" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Non-Equipment SKUs</div><div style={{ fontSize: 24, fontWeight: 700 }}>{nonEquipment.length}</div></Card>
            <Card><div className="muted small">Total on hand</div><div style={{ fontSize: 24, fontWeight: 700 }}>{ne.total}</div></Card>
            <Card><div className="muted small">FGI</div><div style={{ fontSize: 24, fontWeight: 700 }}>{ne.fgi}</div></Card>
          </div>
          <Card>
            <DataTable
              keyOf={(i) => i.productId}
              rows={nonEquipment}
              loading={consigned.isLoading}
              empty="No non-equipment items."
              columns={[
                { header: 'Item', sort: (i) => i.partDesc.toLowerCase(), cell: (i) => <div className="row" style={{ gap: 8 }}>{i.partDesc}<Badge tone="gray">non-equipment</Badge></div> },
                { header: 'Manufacturer', sort: (i) => i.manufacturer, cell: (i) => i.manufacturer },
                { header: 'On hand', sort: (i) => i.totalQty, cell: (i) => <strong>{i.totalQty}</strong> },
              ]}
            />
          </Card>
        </>
      )}

      {tab === 'alerts' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Devices</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.data?.metrics.devices ?? 0}</div></Card>
            <Card><div className="muted small">At Risk</div><div style={{ fontSize: 24, fontWeight: 700, color: (forecast.data?.metrics.atRisk ?? 0) > 0 ? 'var(--danger-text)' : undefined }}>{forecast.data?.metrics.atRisk ?? 0}</div></Card>
            <Card><div className="muted small">Forecast (12 Mo)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.data?.metrics.totalForecast12Mo ?? 0}</div></Card>
            <Card><div className="muted small">Suggested Buy</div><div style={{ fontSize: 24, fontWeight: 700 }}>{forecast.data?.metrics.totalSuggestedBuy ?? 0}</div></Card>
          </div>

          {(forecast.data?.alerts.length ?? 0) > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <h3>Alerts</h3>
              <div className="grid" style={{ gap: 8 }}>
                {forecast.data?.alerts.map((a, idx) => (
                  <div key={idx} className="row" style={{ gap: 8, color: a.level === AlertLevel.MEDIUM ? 'var(--warn-text)' : 'var(--danger-text)' }}>
                    <span className="serial-chip">{a.code}</span>
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
                { header: 'Suggested Buy', sort: (r) => r.suggestedBuyQty, cell: (r) => (r.suggestedBuyQty > 0 ? <Badge tone="red">Buy {r.suggestedBuyQty}</Badge> : <Badge tone="green">OK</Badge>) },
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
        <div className="small" style={{ color: 'var(--warn-text)', marginTop: 4 }}>OH Consigned is 0 — this device is purchased directly from POS Portal inventory.</div>
      )}
    </div>
  );
}
