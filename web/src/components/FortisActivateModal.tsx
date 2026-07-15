import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Order } from '@de/shared';
import { api, ApiError } from '../api/client';
import { useToast } from './Toast';

interface FortisModalProps {
  order: Order;
  onClose: () => void;
}

export function FortisActivateModal({ order, onClose }: FortisModalProps) {
  const toast = useToast();
  const [serial, setSerial] = useState<string>(order.serialNumbers[0] ?? '');

  const activateMutation = useMutation({
    mutationFn: () => api.orders.activateFortis(order.id, serial.trim()),
    onSuccess: (data) => {
      const r = data.result;
      if (r.activated) {
        const verb = r.status === 'exists' ? 'already in Fortis' : 'created in Fortis';
        toast.push(`${r.title} — serial ${r.serialNumber} ${verb}${r.terminalId ? ` (${r.terminalId})` : ''}`, 'success');
        onClose();
      } else {
        toast.push(r.error || 'Fortis activation failed', 'error');
      }
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? (e.detail || e.message) : 'Activation failed';
      toast.push(msg, 'error');
    },
  });

  const isDisabled = !serial.trim() || activateMutation.isPending;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 24,
          maxWidth: 420,
          width: '90%',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 4px 0' }}>Activate in Fortis Gateway</h3>
        <p style={{ color: '#666', marginBottom: 16, fontSize: 14 }}>
          Order <span style={{ fontWeight: 'bold' }}>{order.reference || `#${order.id}`}</span> — creates the
          terminal in Fortis Gateway carrying this serial.
        </p>

        <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
          Serial number:
          <input
            list={`serials-${order.id}`}
            style={{
              width: '100%',
              padding: '8px 12px',
              marginTop: 4,
              border: '1px solid #ccc',
              borderRadius: 4,
              fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
            placeholder="e.g. 90000001"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            autoFocus
          />
          <datalist id={`serials-${order.id}`}>
            {order.serialNumbers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        {order.serialNumbers.length === 0 && (
          <p style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
            No shipped serials on this order yet — enter the device serial to activate manually.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            className="btn"
            disabled={activateMutation.isPending}
            onClick={onClose}
            style={{ backgroundColor: '#f0f0f0', color: '#333' }}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={isDisabled} onClick={() => activateMutation.mutate()}>
            {activateMutation.isPending ? 'Activating…' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}
