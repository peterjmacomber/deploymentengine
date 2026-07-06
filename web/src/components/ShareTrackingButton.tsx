import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useToast } from './Toast';

/** Generates (or reuses) a sanitized public tracking link for an order and copies it to clipboard. */
export function ShareTrackingButton({ orderId }: { orderId: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const { token } = await api.orders.shareToken(orderId);
      const url = `${window.location.origin}/t/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.push('Tracking link copied to clipboard', 'success');
      } catch {
        // Clipboard may be blocked (non-HTTPS/permissions) — surface the URL so it can be copied manually.
        toast.push(`Tracking link: ${url}`, 'success');
      }
    } catch (e) {
      toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Could not create tracking link', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn" disabled={busy} onClick={share} title="Copy a public tracking link with no sensitive details">
      {busy ? 'Generating…' : 'Share tracking link'}
    </button>
  );
}
