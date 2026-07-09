import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@de/shared';
import { AppShell } from '../components/AppShell';
import { Card, Kpi, Loading, StatusBadge } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { api } from '../api/client';
import { useAuth } from '../stores/authStore';
import { date, money, titleCase } from '../lib/format';

export function Dashboard() {
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard.get });

  return (
    <AppShell
      title="Dashboard"
      actions={can(Permission.ORDER_WRITE) && <button className="btn primary" onClick={() => navigate('/orders/new')}>+ New Order</button>}
    >
      {isLoading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))' }}>
            <Kpi label="Orders" value={data.kpis.orders} onClick={() => navigate('/orders')} />
            <Kpi label="Active Deployed" value={data.kpis.deployedActive} onClick={() => navigate('/deployed?status=Active')} />
            <Kpi label="Open Returns" value={data.kpis.openReturns} onClick={() => navigate('/cases')} />
            <Kpi label="Pending Approvals" value={data.kpis.pendingExceptions} alert={data.kpis.pendingExceptions > 0} onClick={() => navigate('/approvals?status=Pending')} />
            <Kpi label="Merchants" value={data.kpis.merchants} onClick={() => navigate('/merchants')} />
            <Kpi label="Delinquent Returns" value={data.kpis.delinquent} alert={data.kpis.delinquent > 0} onClick={() => navigate('/cases?delinquent=Delinquent')} />
            <Kpi label="Inventory Alerts" value={data.kpis.inventoryAlerts} alert={data.kpis.inventoryAlerts > 0} onClick={() => navigate('/inventory?tab=alerts')} />
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
            <Card>
              <h3>Orders by status</h3>
              {Object.keys(data.ordersByStatus).length === 0 ? (
                <div className="muted small">No orders yet.</div>
              ) : (
                <div className="grid" style={{ gap: 8 }}>
                  {Object.entries(data.ordersByStatus).map(([status, count]) => (
                    <div key={status} className="row between clickable-row" onClick={() => navigate(`/orders?status=${status}`)} style={{ cursor: 'pointer' }}>
                      <StatusBadge status={status} />
                      <strong>{count}</strong>
                    </div>
                  ))}
                  <div className="row between clickable-row" onClick={() => navigate('/cases?type=swap')} style={{ cursor: 'pointer' }}>
                    <StatusBadge status="SWAPS" />
                    <strong>{data.swaps}</strong>
                  </div>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 10px' }} />
              <h3 style={{ marginBottom: 8 }}>Billing</h3>
              <div className="grid" style={{ gap: 8 }}>
                <div className="row between clickable-row" onClick={() => navigate('/orders')} style={{ cursor: 'pointer' }}>
                  <span className="muted small">Total orders</span><strong>{money(data.billing.totalOrderValue)}</strong>
                </div>
                <div className="row between clickable-row" onClick={() => navigate('/cases')} style={{ cursor: 'pointer' }}>
                  <span className="muted small">Returns (equipment value)</span><strong>{money(data.billing.returnsValue)}</strong>
                </div>
                <div className="row between clickable-row" onClick={() => navigate('/cases?tab=closed_return')} style={{ cursor: 'pointer' }}>
                  <span className="muted small">Warranty returns <span className="muted" title="Closed by Return — no charge">ⓘ</span></span><strong>{data.billing.warrantyReturns}</strong>
                </div>
                <div className="row between clickable-row" onClick={() => navigate('/cases?tab=closed_billing')} style={{ cursor: 'pointer' }}>
                  <span className="muted small">Billed returns <span className="muted" title="Closed by Return after Billing — a charge was involved (out-of-warranty, damage, repair, etc.)">ⓘ</span></span><strong>{data.billing.billedReturns}</strong>
                </div>
              </div>
            </Card>

            <Card>
              <h3>Recent orders</h3>
              <DataTable
                keyOf={(o) => o.id}
                rows={data.recentOrders}
                onRowClick={(o) => navigate(`/orders/${o.id}`)}
                columns={[
                  { header: 'Ref', cell: (o) => <span className="mono">{o.reference}</span> },
                  { header: 'Merchant', cell: (o) => o.merchant.dbaName ?? '—' },
                  { header: 'Method', cell: (o) => <span className="small muted">{titleCase(o.method)}</span> },
                  { header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
                  { header: 'Placed', cell: (o) => <span className="small">{date(o.createdAt)}</span> },
                ]}
              />
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
