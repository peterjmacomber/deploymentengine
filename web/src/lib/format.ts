export function money(v: number | undefined | null): string {
  if (v == null) return '—';
  if (v === 0) return 'Free';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function date(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** How we identify a unit: the last 8 alphanumerics of its serial (matches the Fortis LINKS field). */
export function serialTag(serial: string | undefined | null): string {
  return (serial ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-8);
}
