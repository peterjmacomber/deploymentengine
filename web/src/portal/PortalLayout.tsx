import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../stores/authStore';
import logoBlue from '../assets/fortis-logo-blue.png';

const NAV = [
  { to: '/portal', label: 'Home', end: true },
  { to: '/portal/orders', label: 'Orders' },
  { to: '/portal/cases', label: 'Returns & Swaps' },
  { to: '/portal/analytics', label: 'Analytics' },
];

export function PortalLayout({ title, children }: { title?: string; children: ReactNode }) {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const isImpersonating = useAuth((s) => s.isImpersonating());
  const exitImpersonation = useAuth((s) => s.exitImpersonation);
  const me = useQuery({ queryKey: ['portal-me'], queryFn: api.portal.me });
  const merchant = me.data?.merchant;
  const merchantName = merchant?.dbaName || merchant?.mid || 'My account';

  return (
    <div className="portal">
      {isImpersonating && (
        <div className="portal-imp-banner">
          <span>
            👁 Viewing <strong>{merchantName}</strong> as {me.data?.impersonatedBy}. Changes you make here act as the merchant.
          </span>
          <button
            className="btn sm"
            onClick={async () => { await exitImpersonation(); navigate(merchant ? `/merchants/${merchant.id}` : '/'); }}
          >
            Exit impersonation
          </button>
        </div>
      )}

      <header className="portal-header">
        <div className="portal-brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/portal')}>
          <img src={logoBlue} alt="Fortis" style={{ height: 26, display: 'block' }} />
          <div style={{ width: 1, height: 26, background: 'var(--border)' }} />
          <div>
            <div className="portal-title" style={{ fontSize: 14 }}>{merchantName}</div>
            <div className="small muted" style={{ fontSize: 11 }}>Equipment Portal</div>
          </div>
        </div>
        <nav className="portal-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `portal-navlink${isActive ? ' active' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary sm" onClick={() => navigate('/portal/report')}>Report an issue</button>
          {!isImpersonating && <button className="btn sm" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>}
        </div>
      </header>

      <main className="portal-main">
        {title && <h1 className="portal-h1">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
