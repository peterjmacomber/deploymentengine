/**
 * Business policy: return window, warranty, reason catalog, and the rule mapping a swap's
 * age to the manager exception it requires. Windows are configurable via server env but the
 * defaults live here so UI and server agree.
 */
import {
  ExceptionType,
  ReturnReasonCategory,
  ReturnReasonCode,
  ReturnType,
  type ReasonMeta,
} from './enums.js';

export const RETURN_WINDOW_DAYS = 30;
export const WARRANTY_DAYS = 365;

export const REASON_CATALOG: ReasonMeta[] = [
  { code: ReturnReasonCode.WARRANTY_DEFECT, label: 'Warranty defect', category: ReturnReasonCategory.WARRANTY, appliesTo: [ReturnType.REPLACEMENT, ReturnType.REPAIR] },
  { code: ReturnReasonCode.DAMAGED, label: 'Damaged in field', category: ReturnReasonCategory.WARRANTY, appliesTo: [ReturnType.REPLACEMENT, ReturnType.REPAIR, ReturnType.RETURN] },
  { code: ReturnReasonCode.CONNECTIVITY, label: 'Connectivity failure', category: ReturnReasonCategory.WARRANTY, appliesTo: [ReturnType.REPLACEMENT, ReturnType.REPAIR] },
  { code: ReturnReasonCode.CONFIG_ENCRYPTION, label: 'Config — encryption/P2PE', category: ReturnReasonCategory.CONFIG, appliesTo: [ReturnType.REPLACEMENT] },
  { code: ReturnReasonCode.CONFIG_PROCESSOR, label: 'Config — processor', category: ReturnReasonCategory.CONFIG, appliesTo: [ReturnType.REPLACEMENT] },
  { code: ReturnReasonCode.CONFIG_APPLICATION, label: 'Config — application', category: ReturnReasonCategory.CONFIG, appliesTo: [ReturnType.REPLACEMENT] },
  { code: ReturnReasonCode.PLATFORM_UPGRADE, label: 'Platform upgrade', category: ReturnReasonCategory.CONFIG, appliesTo: [ReturnType.REPLACEMENT] },
  { code: ReturnReasonCode.SALES_WRONG_DEVICE, label: 'Wrong device (sales fit)', category: ReturnReasonCategory.SALES_FIT, appliesTo: [ReturnType.REPLACEMENT, ReturnType.RETURN] },
  { code: ReturnReasonCode.CONVERSION, label: 'Processor conversion', category: ReturnReasonCategory.CONVERSION, appliesTo: [ReturnType.REPLACEMENT, ReturnType.RETURN] },
  { code: ReturnReasonCode.COURTESY_SWAP, label: 'Courtesy swap (no charge)', category: ReturnReasonCategory.COURTESY, appliesTo: [ReturnType.REPLACEMENT] },
  { code: ReturnReasonCode.NO_CHARGE, label: 'No-charge goodwill', category: ReturnReasonCategory.COURTESY, appliesTo: [ReturnType.REPLACEMENT, ReturnType.RETURN] },
  { code: ReturnReasonCode.RETURN_UNWANTED, label: 'Unwanted / no longer needed', category: ReturnReasonCategory.RETURN_ONLY, appliesTo: [ReturnType.RETURN] },
  { code: ReturnReasonCode.DISCONTINUED, label: 'Merchant discontinued', category: ReturnReasonCategory.RETURN_ONLY, appliesTo: [ReturnType.RETURN] },
  { code: ReturnReasonCode.MERCHANT_ERROR, label: 'Merchant ordering error', category: ReturnReasonCategory.RETURN_ONLY, appliesTo: [ReturnType.RETURN] },
  { code: ReturnReasonCode.IN_WARRANTY_REPAIR, label: 'In-warranty repair', category: ReturnReasonCategory.REPAIR, appliesTo: [ReturnType.REPAIR] },
  { code: ReturnReasonCode.OUT_OF_WARRANTY_REPAIR, label: 'Out-of-warranty repair', category: ReturnReasonCategory.REPAIR, appliesTo: [ReturnType.REPAIR] },
  { code: ReturnReasonCode.CLEANING_SERVICE, label: 'Cleaning service', category: ReturnReasonCategory.REPAIR, appliesTo: [ReturnType.REPAIR] },
  { code: ReturnReasonCode.NEEDS_MANUAL_REVIEW, label: 'Needs manual review', category: ReturnReasonCategory.NEEDS_REVIEW, appliesTo: [ReturnType.RETURN, ReturnType.REPLACEMENT, ReturnType.REPAIR] },
];

export function reasonsForType(type: ReturnType): ReasonMeta[] {
  return REASON_CATALOG.filter((r) => r.appliesTo.includes(type));
}

export function reasonMeta(code: ReturnReasonCode): ReasonMeta | undefined {
  return REASON_CATALOG.find((r) => r.code === code);
}

/**
 * Given how many days a device has been deployed, determine which manager exception (if any)
 * a swap/replacement requires. Warranty breach is stronger than return-window breach.
 */
export function swapExceptionRequired(
  daysSinceDeployment: number,
  opts: { returnWindowDays?: number; warrantyDays?: number } = {},
): ExceptionType | null {
  const rw = opts.returnWindowDays ?? RETURN_WINDOW_DAYS;
  const wd = opts.warrantyDays ?? WARRANTY_DAYS;
  if (daysSinceDeployment > wd) return ExceptionType.SWAP_OUTSIDE_WARRANTY;
  if (daysSinceDeployment > rw) return ExceptionType.SWAP_OUTSIDE_RETURN_WINDOW;
  return null;
}

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  [ExceptionType.PRICE_EXCEPTION]: 'Price exception (free / discounted device)',
  [ExceptionType.SWAP_OUTSIDE_RETURN_WINDOW]: `Swap outside ${RETURN_WINDOW_DAYS}-day return window`,
  [ExceptionType.SWAP_OUTSIDE_WARRANTY]: `Swap outside ${WARRANTY_DAYS}-day warranty`,
  [ExceptionType.DELINQUENCY_WAIVER]: 'Delinquency waiver / account credit',
};
