import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Order, ReturnLifecycle, ReturnReasonCode, ReturnType } from '@de/shared';
import { Modal } from './Modal';
import { SerialLink } from './SerialLink';
import { api, ApiError } from '../api/client';
import { useToast } from './Toast';

/** Order-driven return/swap. Everything is prefilled from the order — the agent only picks
 *  swap vs return-only and (for a swap) the replacement device. */
export function ReturnSwapModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'swap' | 'return'>('swap');
  const [replacementBundleId, setReplacementBundleId] = useState<number | undefined>();
  const bundles = useQuery({ queryKey: ['bundles-active'], queryFn: api.bundles.listActive });

  const serials = order.serialNumbers.slice(0, 25);
  const create = useMutation({
    mutationFn: () => {
      const returnType = mode === 'swap' ? ReturnType.REPLACEMENT : ReturnType.RETURN;
      const reasonCode = mode === 'swap' ? ReturnReasonCode.WARRANTY_DEFECT : ReturnReasonCode.RETURN_UNWANTED;
      const items = serials.length
        ? serials.map((sn) => ({ returnType, reasonCode, expectedSerialNumber: sn }))
        : [{ returnType, reasonCode }];
      return api.returns.create({
        entityType: 'order',
        entityId: order.id,
        merchantId: order.merchant.id,
        items,
        replacementBundleId: mode === 'swap' ? replacementBundleId : undefined,
        notes: `${mode === 'swap' ? 'Swap' : 'Return'} initiated from order ${order.reference ?? order.id}`,
      });
    },
    onSuccess: (res) => {
      const parked = res.return.lifecycle === ReturnLifecycle.PENDING_APPROVAL;
      toast.push(parked ? 'Submitted — outside policy, sent to a manager for approval' : `${mode === 'swap' ? 'Swap' : 'Return'} created`, 'success');
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['approvals-count'] });
      onClose();
      navigate(`/returns/${res.return.id}`);
    },
    onError: (e) => toast.push(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to create', 'error'),
  });

  return (
    <Modal
      title={`Return / Swap — order ${order.reference ?? order.id}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={create.isPending || (mode === 'swap' && !replacementBundleId)} onClick={() => create.mutate()}>
            {create.isPending ? 'Submitting…' : mode === 'swap' ? 'Create swap' : 'Create return'}
          </button>
        </>
      }
    >
      <div className="small muted" style={{ marginBottom: 10 }}>{order.merchant.dbaName} · {serials.length} device(s) from this order</div>
      <div className="row" style={{ gap: 16, marginBottom: 12 }}>
        <label className="inline"><input type="radio" checked={mode === 'swap'} onChange={() => setMode('swap')} /> Swap (send replacement)</label>
        <label className="inline"><input type="radio" checked={mode === 'return'} onChange={() => setMode('return')} /> Return only</label>
      </div>

      {serials.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="muted small">Devices being returned</div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>{serials.map((s) => <SerialLink key={s} serial={s} orderId={order.id} />)}</div>
        </div>
      )}

      {mode === 'swap' && (
        <div className="field">
          <label>Replacement device</label>
          <select value={replacementBundleId ?? ''} onChange={(e) => setReplacementBundleId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Select a bundle…</option>
            {bundles.data?.bundles.map((b) => <option key={b.pospBundleId} value={b.pospBundleId}>{b.displayName}{b.accountingUnitPrice != null ? ` — $${b.accountingUnitPrice}` : ''}</option>)}
          </select>
        </div>
      )}
      <div className="small muted">No other details needed — reason defaults are applied and the merchant/serials come from the order. Swaps outside the 30-day return window or 365-day warranty are routed to a manager automatically.</div>
    </Modal>
  );
}
