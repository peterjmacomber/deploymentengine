import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../components/AppShell';
import { Badge, Card, Loading } from '../components/ui';
import { api, ApiError, type ConnectionStatus } from '../api/client';
import { useToast } from '../components/Toast';
import { dateTime } from '../lib/format';

function StatusCard({ title, s }: { title: string; s: ConnectionStatus }) {
  return (
    <Card>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <Badge tone={s.ok ? 'green' : 'amber'}>{s.ok ? 'Connected' : 'Not connected'}</Badge>
      </div>
      <div className="small muted">{s.detail}</div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Last checked: {s.lastCheckedAt ? dateTime(s.lastCheckedAt) : 'never'}
      </div>
      <div className="small muted">
        Last successful connection: {s.lastSuccessAt ? dateTime(s.lastSuccessAt) : 'never'}
      </div>
    </Card>
  );
}

export function SystemStatus() {
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['system-status'], queryFn: api.system.status });

  const check = useMutation({
    mutationFn: api.system.check,
    onSuccess: () => { toast.push('Checked both connections', 'success'); qc.invalidateQueries({ queryKey: ['system-status'] }); },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Check failed', 'error'),
  });

  return (
    <AppShell title="System Status">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 16 }}>
        Shows the last-known connection to each upstream sandbox, refreshed automatically in the
        background (no live call on page load) — use "Check now" to force an immediate check.
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn primary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {status.isLoading || !status.data ? (
        <Loading />
      ) : (
        <div className="grid cols-2">
          <StatusCard title="POS Portal (ScanSource) sandbox" s={status.data.posPortal} />
          <StatusCard title="Fortis Gateway (Zeamster) sandbox" s={status.data.fortis} />
        </div>
      )}
    </AppShell>
  );
}
