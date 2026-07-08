import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@de/shared';
import { useAuth } from '../stores/authStore';
import { api } from '../api/client';

interface NavDef { to: string; label: string; icon: string; perm?: Permission; badge?: 'approvals'; }

const GROUPS: { group: string; items: NavDef[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: '▤', perm: Permission.ORDER_READ }] },
  {
    group: 'Operations',
    items: [
      { to: '/merchants', label: 'Merchants', icon: '◱', perm: Permission.MERCHANT_READ },
      { to: '/orders', label: 'Orders', icon: '⬚', perm: Permission.ORDER_READ },
      { to: '/returns', label: 'Returns', icon: '↩', perm: Permission.RETURN_READ },
      { to: '/swaps', label: 'Swaps', icon: '↺', perm: Permission.RETURN_READ },
      { to: '/inventory', label: 'Inventory', icon: '▦', perm: Permission.INVENTORY_READ },
    ],
  },
  {
    group: 'Management',
    items: [
      { to: '/approvals', label: 'Approvals', icon: '✔', perm: Permission.EXCEPTION_APPROVE, badge: 'approvals' },
      { to: '/forecasting', label: 'Forecasting', icon: '▦', perm: Permission.EXCEPTION_APPROVE },
      { to: '/links', label: 'Checkout Generator', icon: '⊞', perm: Permission.LINK_WRITE },
      { to: '/users', label: 'Users', icon: '⚇', perm: Permission.USER_READ },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/policies', label: 'Policies', icon: '⚖', perm: Permission.BUNDLE_WRITE },
      { to: '/bundles', label: 'Bundles & Pricing', icon: '❏', perm: Permission.BUNDLE_WRITE },
      { to: '/api-keys', label: 'API Keys', icon: '⚿', perm: Permission.APIKEY_MANAGE },
      { to: '/fortis', label: 'Fortis Gateway', icon: '⇄', perm: Permission.DEV_TOOLS },
      { to: '/audit', label: 'Audit Log', icon: '☰', perm: Permission.AUDIT_READ },
    ],
  },
  {
    group: 'Tools',
    items: [
      { to: '/tools', label: 'Tools', icon: '⚙', perm: Permission.SHIPPING_READ },
    ],
  },
];

export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { principal, logout, can } = useAuth();
  const navigate = useNavigate();

  const pendingApprovals = useQuery({
    queryKey: ['approvals-count'],
    queryFn: () => api.exceptions.list({ status: 'PENDING' }),
    enabled: can(Permission.EXCEPTION_APPROVE),
    refetchInterval: 30_000,
  });

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="dot">◆</span> Deployment Engine</div>
        {GROUPS.map((g) => {
          const items = g.items.filter((it) => !it.perm || can(it.perm));
          if (items.length === 0) return null;
          return (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span aria-hidden>{it.icon}</span> {it.label}
                  {it.badge === 'approvals' && (pendingApprovals.data?.exceptions.length ?? 0) > 0 && (
                    <span className="badge-count">{pendingApprovals.data!.exceptions.length}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="spacer" />
        <div className="user">
          <div style={{ color: '#fff', fontWeight: 600 }}>{principal?.name}</div>
          <div>{principal?.email}</div>
          <div style={{ marginTop: 4, textTransform: 'capitalize' }}>{principal?.role}</div>
          <button className="btn ghost sm" style={{ color: 'var(--sidebar-text)', marginTop: 8, padding: 0 }} onClick={() => { logout(); navigate('/login'); }}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="title">{title}</div>
          <div className="grow" />
          {actions}
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
