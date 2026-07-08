import {
  type DeployedEquipment,
  type Merchant,
  type Order,
  type ReturnCase,
  ReturnLifecycle,
  ReturnReasonCode,
  ReturnType,
} from '@de/shared';
import { prisma } from '../db.js';
import { forbidden, notFound } from '../util/errors.js';
import { orderService } from './orderService.js';
import { returnService } from './returnService.js';
import { deployedEquipmentService } from './deployedEquipmentService.js';
import { merchantService } from './merchantService.js';

/**
 * A guided self-service issue (Amazon-style). Each maps to a canonical return reason + type and
 * carries troubleshooting steps shown BEFORE a case is opened, so simple problems self-resolve.
 */
export interface PortalIssue {
  code: string;
  label: string;
  summary: string;
  help: string[]; // self-service troubleshooting shown first
  remedy: ReturnType; // what happens if not resolved
  reasonCode: ReturnReasonCode;
}

export const PORTAL_ISSUES: PortalIssue[] = [
  {
    code: 'NOT_POWERING',
    label: "Device won't power on or is damaged",
    summary: 'The terminal is unresponsive, cracked, or physically damaged.',
    help: [
      'Confirm the power adapter is fully seated and plugged into a working outlet.',
      'Hold the power button for 10 seconds to force a restart.',
      'Try a different power cable or outlet if you have one available.',
    ],
    remedy: ReturnType.REPLACEMENT,
    reasonCode: ReturnReasonCode.DAMAGED,
  },
  {
    code: 'CONNECTIVITY',
    label: "Device won't connect / no signal",
    summary: 'The terminal cannot reach the network or is stuck connecting.',
    help: [
      'Reboot the terminal and your internet router/modem.',
      'For Wi‑Fi devices, re‑select your network and re‑enter the password.',
      'For Ethernet, reseat the network cable at both ends.',
    ],
    remedy: ReturnType.REPLACEMENT,
    reasonCode: ReturnReasonCode.CONNECTIVITY,
  },
  {
    code: 'DECLINES',
    label: 'Transactions are declining or erroring',
    summary: 'Cards are being declined or you see processing errors.',
    help: [
      'Settle/batch out the current day and retry a small test transaction.',
      'Reboot the terminal to refresh its connection to the processor.',
      'Verify the card is not expired and try a second card to isolate the issue.',
    ],
    remedy: ReturnType.REPLACEMENT,
    reasonCode: ReturnReasonCode.CONFIG_PROCESSOR,
  },
  {
    code: 'WRONG_DEVICE',
    label: "Wrong device — doesn't fit how I take payments",
    summary: 'The device type does not match your business needs.',
    help: [
      'Confirm the model you received matches what you expected.',
      'Some features (tip, contactless) may just need to be enabled — contact support first.',
    ],
    remedy: ReturnType.REPLACEMENT,
    reasonCode: ReturnReasonCode.SALES_WRONG_DEVICE,
  },
  {
    code: 'RETURN_UNWANTED',
    label: 'I no longer need this device',
    summary: 'You want to send the device back without a replacement.',
    help: [
      'Returns are accepted within the return window; a prepaid call tag will be issued.',
      'Please have the device and its power supply ready to ship back.',
    ],
    remedy: ReturnType.RETURN,
    reasonCode: ReturnReasonCode.RETURN_UNWANTED,
  },
  {
    code: 'OTHER',
    label: 'Something else',
    summary: 'Describe the problem and our team will review it.',
    help: ['Add as much detail as you can below so we can route it correctly.'],
    remedy: ReturnType.RETURN,
    reasonCode: ReturnReasonCode.NEEDS_MANUAL_REVIEW,
  },
];

function issueByCode(code: string): PortalIssue | undefined {
  return PORTAL_ISSUES.find((i) => i.code === code);
}

export interface PortalSummary {
  orders: number;
  activeDevices: number;
  openReturns: number;
  openSwaps: number;
}

const OPEN_LIFECYCLES = [
  ReturnLifecycle.INITIATED,
  ReturnLifecycle.PENDING_APPROVAL,
  ReturnLifecycle.APPROVED,
  ReturnLifecycle.CALLTAG_ISSUED,
  ReturnLifecycle.REPLACEMENT_SHIPPED,
  ReturnLifecycle.ITEMS_RECEIVED,
];

export const portalService = {
  async profile(merchantId: number): Promise<Merchant> {
    return merchantService.get(merchantId);
  },

  async summary(merchantId: number): Promise<PortalSummary> {
    const [orders, activeDevices, openCases] = await Promise.all([
      prisma.order.count({ where: { merchantId } }),
      prisma.deployedEquipment.count({ where: { merchantId, status: 'ACTIVE' } }),
      prisma.returnCase.findMany({ where: { merchantId, lifecycle: { in: OPEN_LIFECYCLES } }, select: { itemsJson: true } }),
    ]);
    let openSwaps = 0;
    let openReturns = 0;
    for (const c of openCases) {
      (c.itemsJson.includes(ReturnType.REPLACEMENT) ? openSwaps++ : openReturns++);
    }
    return { orders, activeDevices, openReturns, openSwaps };
  },

  async orders(merchantId: number): Promise<Order[]> {
    return orderService.list({ merchantId });
  },

  async order(merchantId: number, id: number): Promise<Order> {
    const order = await orderService.get(id);
    if (order.merchant.id !== merchantId) throw forbidden('This order is not on your account');
    return order;
  },

  async returns(merchantId: number): Promise<ReturnCase[]> {
    return returnService.list({ merchantId });
  },

  async return(merchantId: number, id: number): Promise<ReturnCase> {
    const rc = await returnService.get(id);
    if (rc.merchantId !== merchantId) throw forbidden('This case is not on your account');
    return rc;
  },

  async deployed(merchantId: number): Promise<DeployedEquipment[]> {
    return deployedEquipmentService.list({ merchantId });
  },

  /** Devices + the issue catalog the report-an-issue wizard renders. */
  async issueOptions(merchantId: number) {
    const devices = await deployedEquipmentService.list({ merchantId });
    return {
      devices: devices.filter((d) => d.status === 'ACTIVE' || d.status === 'IN_REPAIR'),
      issues: PORTAL_ISSUES,
    };
  },

  /**
   * Submit a self-service issue. Resolves the device, maps the issue to a canonical
   * reason/type, and hands off to returnService — which applies the protocol automatically:
   * in-window/in-warranty cases proceed (call tag issued); out-of-window swaps and no-charge
   * cases are parked for manager approval. The merchant is told which happened.
   */
  async submitIssue(
    merchantId: number,
    input: { issueCode: string; deployedEquipmentId?: number; serialNumber?: string; notes?: string; wantsReplacement?: boolean },
    requestedBy: string,
  ): Promise<{ case: ReturnCase; outcome: 'submitted' | 'pending_review'; message: string }> {
    const issue = issueByCode(input.issueCode);
    if (!issue) throw notFound('Unknown issue type');

    // Resolve the device and confirm it belongs to this merchant.
    let device: DeployedEquipment | null = null;
    if (input.deployedEquipmentId) device = await deployedEquipmentService.get(input.deployedEquipmentId).catch(() => null);
    else if (input.serialNumber) {
      const row = await prisma.deployedEquipment.findFirst({ where: { serialNumber: input.serialNumber, merchantId } });
      if (row) device = await deployedEquipmentService.get(row.id);
    }
    if (device && device.merchantId !== merchantId) throw forbidden('That device is not on your account');

    // A RETURN_UNWANTED with wantsReplacement flips to a swap; otherwise use the issue's remedy.
    const remedy = input.wantsReplacement ? ReturnType.REPLACEMENT : issue.remedy;
    const entityType = device?.orderId ? 'order' : 'merchant';
    const entityId = device?.orderId ?? merchantId;
    const note = `[Self-service] ${issue.label}${input.notes ? ` — ${input.notes}` : ''}`;

    const rc = await returnService.create(
      {
        entityType,
        entityId,
        merchantId,
        items: [
          {
            returnType: remedy,
            reasonCode: issue.reasonCode,
            expectedSerialNumber: device?.serialNumber,
            deployedEquipmentId: device?.id,
          },
        ],
        notes: note,
      },
      requestedBy,
    );

    const pending = rc.lifecycle === ReturnLifecycle.PENDING_APPROVAL;
    // Log the reported issue so Management can see it (self-resolved vs swap/return + links).
    await prisma.reportedIssue.create({
      data: {
        merchantId,
        merchantDba: (await prisma.merchant.findUnique({ where: { id: merchantId }, select: { dbaName: true } }))?.dbaName ?? null,
        serialNumber: device?.serialNumber ?? input.serialNumber ?? null,
        deviceProduct: device?.productName ?? device?.model ?? null,
        issueCode: issue.code,
        issueLabel: issue.label,
        notes: input.notes ?? null,
        outcome: pending ? 'pending_review' : remedy === ReturnType.REPLACEMENT ? 'swap' : 'return',
        returnCaseId: rc.id,
        replacementOrderId: rc.replacementOrderId ?? null,
        createdBy: requestedBy,
      },
    });
    return {
      case: rc,
      outcome: pending ? 'pending_review' : 'submitted',
      message: pending
        ? 'Your request needs a quick review by our team and has been submitted. We’ll follow up shortly.'
        : remedy === ReturnType.REPLACEMENT
          ? 'A replacement has been started and a prepaid call tag issued for the old device. You’ll receive tracking soon.'
          : 'A prepaid call tag has been issued to return your device. You’ll receive the shipping details soon.',
    };
  },

  /** Record that a merchant resolved an issue via self-service (no case opened). */
  async recordSelfResolved(
    merchantId: number,
    input: { issueCode: string; deployedEquipmentId?: number; serialNumber?: string; notes?: string },
    requestedBy: string,
  ): Promise<void> {
    const issue = issueByCode(input.issueCode);
    let device: DeployedEquipment | null = null;
    if (input.deployedEquipmentId) device = await deployedEquipmentService.get(input.deployedEquipmentId).catch(() => null);
    else if (input.serialNumber) {
      const row = await prisma.deployedEquipment.findFirst({ where: { serialNumber: input.serialNumber, merchantId } });
      if (row) device = await deployedEquipmentService.get(row.id);
    }
    if (device && device.merchantId !== merchantId) return; // ignore cross-merchant
    await prisma.reportedIssue.create({
      data: {
        merchantId,
        merchantDba: (await prisma.merchant.findUnique({ where: { id: merchantId }, select: { dbaName: true } }))?.dbaName ?? null,
        serialNumber: device?.serialNumber ?? input.serialNumber ?? null,
        deviceProduct: device?.productName ?? device?.model ?? null,
        issueCode: issue?.code ?? input.issueCode,
        issueLabel: issue?.label ?? input.issueCode,
        notes: input.notes ?? null,
        outcome: 'self_resolved',
        createdBy: requestedBy,
      },
    });
  },
};
