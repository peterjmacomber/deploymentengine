import { useQuery } from '@tanstack/react-query';
import { Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Badge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useTableControls } from '../components/TableControls';
import { api } from '../api/client';
import { useAuth } from '../stores/authStore';
import { dateTime } from '../lib/format';

export function Audit() {
  const can = useAuth((s) => s.can);

  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.audit.list({ limit: 500 }),
    enabled: can(Permission.AUDIT_READ),
  });

  const { rows, toolbar } = useTableControls(data?.entries ?? [], {
    search: (a) => `${a.actor} ${a.action} ${a.method} ${a.path} ${a.targetType ?? ''} ${a.targetId ?? ''}`,
    searchPlaceholder: 'Search actor, action, endpoint…',
    dateField: (a) => a.createdAt,
    dateLabel: 'When',
    facets: [
      { key: 'role', label: 'Role', value: (a) => a.actorRole },
      { key: 'actor', label: 'Actor', value: (a) => a.actor },
      { key: 'method', label: 'Method', value: (a) => a.method },
      { key: 'result', label: 'Result', value: (a) => ((a.statusCode ?? 0) >= 400 ? 'Error' : 'OK') },
    ],
  });

  return (
    <AppShell title="Audit Log">
      {toolbar}
      <DataTable
        keyOf={(a) => a.id}
        rows={rows}
        loading={isLoading}
        empty="No audit entries match."
        columns={[
          { header: 'Time', sort: (a) => a.createdAt, cell: (a) => <span className="small">{dateTime(a.createdAt)}</span> },
          { header: 'Actor', sort: (a) => a.actor, cell: (a) => a.actor },
          { header: 'Role', sort: (a) => a.actorRole, cell: (a) => <Badge>{a.actorRole}</Badge> },
          { header: 'Action', sort: (a) => a.action, cell: (a) => a.action },
          { header: 'Endpoint', sort: (a) => a.path, cell: (a) => <span className="mono small">{a.method + ' ' + a.path}</span> },
          { header: 'Status', sort: (a) => a.statusCode ?? 0, cell: (a) => <Badge tone={(a.statusCode ?? 0) >= 400 ? 'red' : 'gray'}>{a.statusCode ?? '—'}</Badge> },
        ]}
      />
    </AppShell>
  );
}
