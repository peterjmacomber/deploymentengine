import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InventoryCondition, type InventoryItem } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge, Card } from '../components/ui';
import { type Column, DataTable } from '../components/DataTable';
import { api } from '../api/client';

const MANUFACTURERS = ['Ingenico', 'PAX', 'ID Tech', 'Dejavoo'];

const EQUIP_COLUMNS: Column<InventoryItem>[] = [
  { header: 'Part', sort: (i) => i.partDesc.toLowerCase(), cell: (i) => <div><div>{i.partDesc}</div><div className="small muted mono">{i.modelNumber}</div></div> },
  { header: 'Manufacturer', sort: (i) => i.manufacturer, cell: (i) => i.manufacturer },
  { header: 'FGI', sort: (i) => i.fgiQty, cell: (i) => i.fgiQty },
  { header: 'In-Repair', sort: (i) => i.inRepairQty, cell: (i) => i.inRepairQty },
  { header: 'Core', sort: (i) => i.coreQty, cell: (i) => i.coreQty },
  { header: 'Scrap', sort: (i) => i.scrapQty, cell: (i) => i.scrapQty },
  { header: 'Total', sort: (i) => i.totalQty, cell: (i) => <strong>{i.totalQty}</strong> },
];

type Tab = 'consigned' | 'nonequipment';

export function Inventory() {
  const [tab, setTab] = useState<Tab>('consigned');
  const [mfg, setMfg] = useState('');
  const [cond, setCond] = useState('');

  const consigned = useQuery({ queryKey: ['inventory-consigned'], queryFn: api.inventory.consigned });

  const equipment = (consigned.data?.items ?? []).filter((i) => !i.isNonSerialized);
  const nonEquipment = (consigned.data?.items ?? []).filter((i) => i.isNonSerialized);

  const eq = {
    total: equipment.reduce((s, i) => s + i.totalQty, 0),
    fgi: equipment.reduce((s, i) => s + i.fgiQty, 0),
    repair: equipment.reduce((s, i) => s + i.inRepairQty, 0),
  };
  const ne = { total: nonEquipment.reduce((s, i) => s + i.totalQty, 0), fgi: nonEquipment.reduce((s, i) => s + i.fgiQty, 0) };

  const filteredEquip = equipment.filter((i) => !mfg || i.manufacturer === mfg);
  const newRows = filteredEquip.filter((i) => i.condition !== InventoryCondition.REFURB);
  const refurbRows = filteredEquip.filter((i) => i.condition === InventoryCondition.REFURB);
  const units = (rows: InventoryItem[]) => rows.reduce((s, i) => s + i.totalQty, 0);

  return (
    <AppShell title="Inventory">
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        <div className={`tab ${tab === 'consigned' ? 'active' : ''}`} onClick={() => setTab('consigned')}>Equipment</div>
        <div className={`tab ${tab === 'nonequipment' ? 'active' : ''}`} onClick={() => setTab('nonequipment')}>Non-Equipment</div>
      </div>

      {tab === 'consigned' && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Equipment SKUs</div><div style={{ fontSize: 24, fontWeight: 700 }}>{equipment.length}</div></Card>
            <Card><div className="muted small">Total on hand</div><div style={{ fontSize: 24, fontWeight: 700 }}>{eq.total}</div></Card>
            <Card><div className="muted small">FGI</div><div style={{ fontSize: 24, fontWeight: 700 }}>{eq.fgi}</div></Card>
            <Card><div className="muted small">In-Repair</div><div style={{ fontSize: 24, fontWeight: 700 }}>{eq.repair}</div></Card>
          </div>
          <div className="row" style={{ marginBottom: 14, gap: 6, flexWrap: 'wrap' }}>
            <span className="muted small" style={{ alignSelf: 'center' }}>Manufacturer:</span>
            {['', ...MANUFACTURERS].map((mk) => (
              <button key={mk || 'all'} className={`btn sm ${mfg === mk ? 'primary' : ''}`} onClick={() => setMfg(mk)}>{mk || 'All'}</button>
            ))}
            <span className="muted small" style={{ alignSelf: 'center', marginLeft: 12 }}>Condition:</span>
            {([['', 'All'], [InventoryCondition.NEW, 'New'], [InventoryCondition.REFURB, 'Refurb']] as const).map(([ck, cl]) => (
              <button key={ck || 'all'} className={`btn sm ${cond === ck ? 'primary' : ''}`} onClick={() => setCond(ck)}>{cl}</button>
            ))}
          </div>

          {(cond === '' || cond === InventoryCondition.NEW) && (
            <Card style={{ marginBottom: 16 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>New Equipment</h3>
                <Badge tone="green">{newRows.length} SKUs · {units(newRows)} units</Badge>
              </div>
              <DataTable keyOf={(i) => i.productId} rows={newRows} loading={consigned.isLoading} empty="No new equipment for this filter." columns={EQUIP_COLUMNS} />
            </Card>
          )}

          {(cond === '' || cond === InventoryCondition.REFURB) && (
            <Card>
              <div className="row between" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Refurbished Equipment</h3>
                <Badge tone="amber">{refurbRows.length} SKUs · {units(refurbRows)} units</Badge>
              </div>
              <DataTable keyOf={(i) => i.productId} rows={refurbRows} loading={consigned.isLoading} empty="No refurbished equipment for this filter." columns={EQUIP_COLUMNS} />
            </Card>
          )}
        </>
      )}

      {tab === 'nonequipment' && (
        <>
          <div className="grid cols-3" style={{ marginBottom: 16 }}>
            <Card><div className="muted small">Non-Equipment SKUs</div><div style={{ fontSize: 24, fontWeight: 700 }}>{nonEquipment.length}</div></Card>
            <Card><div className="muted small">Total on hand</div><div style={{ fontSize: 24, fontWeight: 700 }}>{ne.total}</div></Card>
            <Card><div className="muted small">FGI</div><div style={{ fontSize: 24, fontWeight: 700 }}>{ne.fgi}</div></Card>
          </div>
          <DataTable
            keyOf={(i) => i.productId}
            rows={nonEquipment}
            loading={consigned.isLoading}
            empty="No non-equipment items."
            columns={[
              { header: 'Item', sort: (i) => i.partDesc.toLowerCase(), cell: (i) => <div>{i.partDesc}<Badge tone="gray">non-equipment</Badge></div> },
              { header: 'Manufacturer', sort: (i) => i.manufacturer, cell: (i) => i.manufacturer },
              { header: 'On hand', sort: (i) => i.totalQty, cell: (i) => <strong>{i.totalQty}</strong> },
            ]}
          />
        </>
      )}
    </AppShell>
  );
}
