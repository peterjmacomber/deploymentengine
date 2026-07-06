/**
 * Status reconciliation. POS Portal (and the legacy mock) speak different status
 * vocabularies; everything is normalized to the canonical OrderStatus here, in one place.
 */
import { OrderStatus, TrackerStage, TRACKER_ORDER } from './enums.js';

/** POS Portal order status string -> canonical. Superset covers both the documented POSP
 *  enum (Submitted/Processing/ReadyForQA/Shipped/...) and the old mock strings. */
const POSP_TO_CANONICAL: Record<string, OrderStatus> = {
  // POS Portal documented
  Submitted: OrderStatus.PLACED,
  Processing: OrderStatus.IN_PREP,
  ReadyForQA: OrderStatus.IN_PREP,
  Shipped: OrderStatus.SHIPPED,
  Delivered: OrderStatus.DELIVERED,
  Cancelled: OrderStatus.CANCELLED,
  Returned: OrderStatus.RETURNED,
  ReturnedHolding: OrderStatus.RETURNED_HOLDING,
  Reshipped: OrderStatus.RESHIPPED,
  BackOrderCreated: OrderStatus.BACKORDERED,
  // real POS Portal sandbox values are UPPERCASE
  SUBMITTED: OrderStatus.PLACED,
  READY_FOR_QA: OrderStatus.IN_PREP,
  READYFORQA: OrderStatus.IN_PREP,
  DELIVERED: OrderStatus.DELIVERED,
  RECEIVED: OrderStatus.DELIVERED,
  BACKORDERED: OrderStatus.BACKORDERED,
  BACK_ORDER_CREATED: OrderStatus.BACKORDERED,
  BACKORDER_CREATED: OrderStatus.BACKORDERED,
  RESHIPPED: OrderStatus.RESHIPPED,
  RETURNED_HOLDING: OrderStatus.RETURNED_HOLDING,
  // legacy mock strings
  DRAFT: OrderStatus.DRAFT,
  OPEN: OrderStatus.PLACED,
  PROCESSING: OrderStatus.IN_PREP,
  SHIPPED: OrderStatus.SHIPPED,
  CANCELLED: OrderStatus.CANCELLED,
  RETURNED: OrderStatus.RETURNED,
};

export function canonicalOrderStatus(raw: string | undefined | null): OrderStatus {
  if (!raw) return OrderStatus.DRAFT;
  return POSP_TO_CANONICAL[raw] ?? POSP_TO_CANONICAL[String(raw).trim()] ?? OrderStatus.PLACED;
}

/** Map a canonical order status onto the pizza-tracker. Returns the current stage, whether
 *  it's an exception, and progress 0..1 for the progress bar. */
export interface TrackerView {
  stage: TrackerStage | null;
  index: number; // -1 if exception/not started
  total: number;
  progress: number; // 0..1
  isException: boolean;
  exceptionLabel?: string;
  delivered: boolean;
}

const STATUS_TO_STAGE: Partial<Record<OrderStatus, TrackerStage>> = {
  [OrderStatus.DRAFT]: TrackerStage.PLACED,
  [OrderStatus.PLACED]: TrackerStage.PLACED,
  [OrderStatus.IN_PREP]: TrackerStage.IN_PREP,
  [OrderStatus.BACKORDERED]: TrackerStage.IN_PREP,
  [OrderStatus.SHIPPED]: TrackerStage.SHIPPED,
  [OrderStatus.RESHIPPED]: TrackerStage.SHIPPED,
  [OrderStatus.OUT_FOR_DELIVERY]: TrackerStage.OUT_FOR_DELIVERY,
  [OrderStatus.DELIVERED]: TrackerStage.DELIVERED,
};

const EXCEPTION_LABELS: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.CANCELLED]: 'Order cancelled',
  [OrderStatus.DELIVERY_FAILED]: 'Delivery failed',
  [OrderStatus.RETURNED]: 'Returned',
  [OrderStatus.RETURNED_HOLDING]: 'Returned — awaiting reshipment',
};

export function trackerView(status: OrderStatus): TrackerView {
  const total = TRACKER_ORDER.length;
  const exceptionLabel = EXCEPTION_LABELS[status];
  if (exceptionLabel) {
    return {
      stage: null,
      index: -1,
      total,
      progress: status === OrderStatus.RETURNED ? 1 : 0.5,
      isException: true,
      exceptionLabel,
      delivered: false,
    };
  }
  const stage = STATUS_TO_STAGE[status] ?? TrackerStage.PLACED;
  const index = TRACKER_ORDER.indexOf(stage);
  const delivered = stage === TrackerStage.DELIVERED;
  return {
    stage,
    index,
    total,
    progress: total > 1 ? index / (total - 1) : 0,
    isException: false,
    delivered,
  };
}

// ---------------------------------------------------------------------------
// Return / swap tracker
// ---------------------------------------------------------------------------
export const RETURN_STAGES = ['INITIATED', 'CALLTAG_ISSUED', 'REPLACEMENT_SHIPPED', 'ITEMS_RECEIVED', 'CLOSED'] as const;
export type ReturnStage = (typeof RETURN_STAGES)[number];

export const RETURN_STAGE_LABELS: Record<ReturnStage, string> = {
  INITIATED: 'Requested',
  CALLTAG_ISSUED: 'Call Tag Issued',
  REPLACEMENT_SHIPPED: 'Replacement Shipped',
  ITEMS_RECEIVED: 'Items Received',
  CLOSED: 'Closed',
};

const RETURN_LIFECYCLE_INDEX: Record<string, number> = {
  INITIATED: 0,
  APPROVED: 0,
  CALLTAG_ISSUED: 1,
  REPLACEMENT_SHIPPED: 2,
  ITEMS_RECEIVED: 3,
  CLOSED: 4,
};

const RETURN_EXCEPTIONS: Record<string, string> = {
  PENDING_APPROVAL: 'Pending manager approval',
  DENIED: 'Denied',
  CANCELLED: 'Cancelled',
};

export interface ReturnTrackerView {
  index: number;
  total: number;
  progress: number;
  isException: boolean;
  exceptionLabel?: string;
}

export function returnTrackerView(lifecycle: string): ReturnTrackerView {
  const total = RETURN_STAGES.length;
  const exceptionLabel = RETURN_EXCEPTIONS[lifecycle];
  if (exceptionLabel) return { index: -1, total, progress: 0.3, isException: true, exceptionLabel };
  const index = RETURN_LIFECYCLE_INDEX[lifecycle] ?? 0;
  return { index, total, progress: total > 1 ? index / (total - 1) : 0, isException: false };
}

export const TRACKER_STAGE_LABELS: Record<TrackerStage, string> = {
  [TrackerStage.PLACED]: 'Order Placed',
  [TrackerStage.IN_PREP]: 'In Preparation',
  [TrackerStage.SHIPPED]: 'Shipped',
  [TrackerStage.OUT_FOR_DELIVERY]: 'Out for Delivery',
  [TrackerStage.DELIVERED]: 'Delivered',
};
