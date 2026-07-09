import { type ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@de/shared';
import { useAuth } from '../stores/authStore';
import { api } from '../api/client';
import logoWhite from '../assets/fortis-logo-white.png';

interface NavDef { to: string; label: string; perm?: Permission; badge?: 'approvals'; }

const GROUPS: { group: string; items: NavDef[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', perm: Permission.ORDER_READ }] },
  {
    group: 'Operations',
    items: [
      { to: '/merchants', label: 'Merchants', perm: Permission.MERCHANT_READ },
      { to: '/orders', label: 'Orders', perm: Permission.ORDER_READ },
      { to: '/cases', label: 'Returns & Swaps', perm: Permission.RETURN_READ },
      { to: '/inventory', label: 'Inventory & Forecast', perm: Permission.INVENTORY_READ },
      { to: '/tools', label: 'Shipping Tools', perm: Permission.SHIPPING_READ },
    ],
  },
  {
    group: 'Management',
    items: [
      { to: '/approvals', label: 'Approvals', perm: Permission.EXCEPTION_APPROVE, badge: 'approvals' },
      { to: '/reported-issues', label: 'Reported Issues', perm: Permission.EXCEPTION_APPROVE },
      { to: '/links', label: 'Checkout Links', perm: Permission.LINK_WRITE },
      { to: '/users', label: 'Users', perm: Permission.USER_READ },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/policies', label: 'Policies', perm: Permission.BUNDLE_WRITE },
      { to: '/bundles', label: 'Bundles & Pricing', perm: Permission.BUNDLE_WRITE },
      { to: '/api-keys', label: 'API Keys', perm: Permission.APIKEY_MANAGE },
      { to: '/fortis', label: 'Fortis Gateway', perm: Permission.DEV_TOOLS },
      { to: '/audit', label: 'Audit Log', perm: Permission.AUDIT_READ },
    ],
  },
];

const COLLAPSE_KEY = 'de:nav-collapsed';
function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }
}

function initials(name?: string): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

export interface Crumb { parent: string; to: string; }

export function AppShell({ title, actions, crumb, children }: { title: string; actions?: ReactNode; crumb?: Crumb; children: ReactNode }) {
  const { principal, logout, can } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  const toggleGroup = (g: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [g]: !prev[g] };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const pendingApprovals = useQuery({
    queryKey: ['approvals-count'],
    queryFn: () => api.exceptions.list({ status: 'PENDING' }),
    enabled: can(Permission.EXCEPTION_APPROVE),
    refetchInterval: 30_000,
  });

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logoWhite} alt="Fortis" />
          <div className="brand-div" />
          <div className="wordmark">Deployment<br />Engine</div>
        </div>
        <nav className="nav-scroll">
          {GROUPS.map((g) => {
            const items = g.items.filter((it) => !it.perm || can(it.perm));
            if (items.length === 0) return null;
            const isCollapsed = collapsed[g.group];
            return (
              <div key={g.group}>
                <button type="button" className="nav-group" onClick={() => toggleGroup(g.group)} aria-expanded={!isCollapsed}>
                  <span>{g.group}</span><span className="chev" aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                </button>
                {!isCollapsed && items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    {it.label}
                    {it.badge === 'approvals' && (pendingApprovals.data?.exceptions.length ?? 0) > 0 && (
                      <span className="badge-count">{pendingApprovals.data!.exceptions.length}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="user">
          <div className="avatar">{initials(principal?.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="uname">{principal?.name}</div>
            <div className="urole" style={{ textTransform: 'capitalize' }}>
              {principal?.role} · <button className="signout" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          {crumb && <><button className="crumb" onClick={() => navigate(crumb.to)}>{crumb.parent}</button><span className="crumb-sep">/</span></>}
          <div className="title">{title}</div>
          <div className="grow" />
          {actions}
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
