import { NavLink } from 'react-router-dom';

/** Sub-tab navigation for a merged section (e.g. Orders ↔ Deployed, Bundles ↔ Pricing). */
export function SectionNav({ tabs }: { tabs: { to: string; label: string; end?: boolean }[] }) {
  return (
    <div className="tabs section-tabs">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
