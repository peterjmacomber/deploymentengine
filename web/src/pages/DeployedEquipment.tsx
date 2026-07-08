import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DeployedStatus, type DeployedEquipment as DeployedRow, Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { SectionNav } from '../components/SectionNav';
import { StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api, ApiError } from '../api/client';
import { useAuth } from '../stores/authStore';
import { useToast } from '../components/Toast';
import { date, titleCase } from '../lib/format';
import { deployedBrand } from '../lib/brand';

export function DeployedEquipment() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['deployed', 'all'],
    queryFn: () => api.deployed.list({}),
  });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.deployed.setStatus(id, status),
    onSuccess: () => { toast.push('Status updated', 'success'); qc.invalidateQueries({ queryKey: ['deployed'] }); },
    onError: (e: unknown) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Update failed', 'error'),
  });

  const canWrite = can(Permission.DEPLOYED_WRITE);

  const [sp] = useSearchParams();
  const { rows, toolbar } = useTableControls(data?.equipment ?? [], {
    search: (e) => `${e.serialNumber} ${e.productName ?? ''} ${e.model ?? ''} ${e.mid ?? ''} ${e.fortisTerminalId ?? ''}`,
    searchPlaceholder: 'Search serial, product, terminal, MID…',
    dateField: (e) => e.deployedAt,
    dateLabel: 'Deployed',
    initial: sp.get('status') ? { facets: { status: [sp.get('status')!] } } : undefined,
    facets: [
      { key: 'status', label: 'Status', value: (e) => titleCase(e.status) },
      { key: 'brand', label: 'Manufacturer', value: (e) => deployedBrand(e) },
      { key: 'fortis', label: 'Fortis', value: (e) => (e.fortisActivated ? 'Activated' : e.fortisTerminalId ? 'Linked' : 'Not linked') },
    ],
  });

  return (
    <AppShell title="Orders">
      <SectionNav tabs={[{ to: '/orders', label: 'Orders', end: true }, { to: '/deployed', label: 'Deployed Equipment' }]} />
      {toolbar}
      <DataTable
        keyOf={(e) => e.id}
        rows={rows}
        loading={isLoading}
        empty="No deployed equipment match."
        columns={[
          { header: 'Serial', sort: (e) => e.serialNumber, cell: (e) => <span className="mono">{e.serialNumber}</span> },
          { header: 'Product', sort: (e) => e.productName ?? '', cell: (e) => <div><div>{e.productName ?? '—'}</div><div className="small muted">{e.model ?? '—'}</div></div> },
          { header: 'Manufacturer', sort: (e) => deployedBrand(e) ?? '', cell: (e) => deployedBrand(e) ?? '—' },
          { header: 'Merchant', sort: (e) => e.mid ?? '', cell: (e) => <Link className="rowlink mono small" to={`/merchants/${e.merchantId}`}>{e.mid ?? `#${e.merchantId}`}</Link> },
          { header: 'Status', sort: (e) => e.status, cell: (e) => <StatusBadge status={e.status} /> },
          { header: 'Deployed', sort: (e) => e.deployedAt ?? '', cell: (e) => <span className="small">{date(e.deployedAt)}</span> },
          { header: 'Fortis Terminal', sort: (e) => e.fortisTerminalId ?? '', cell: (e) => <span className="mono">{e.fortisTerminalId ?? '—'}</span> },
          { header: 'App/Encryption', cell: (e) => <span className="small muted">{e.application ? titleCase(e.application) : '—'} / {e.encryption ? titleCase(e.encryption) : '—'}</span> },
          ...(canWrite ? [{
            header: 'Set status',
            cell: (e: DeployedRow) => (
              <select
                className="field"
                style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)' }}
                value={e.status}
                disabled={setStatusMutation.isPending}
                onChange={(ev) => setStatusMutation.mutate({ id: e.id, status: ev.target.value })}
              >
                {Object.values(DeployedStatus).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            ),
          }] : []),
        ]}
      />
    </AppShell>
  );
}
