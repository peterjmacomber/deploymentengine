import type {
  Bundle as BundleRow,
  DeployedEquipment as DeployedRow,
  ExceptionRequest as ExceptionRow,
  Merchant as MerchantRow,
  Order as OrderRow,
  ReturnCase as ReturnRow,
  TerminalModel as TerminalModelRow,
} from '@prisma/client';
import type {
  Address,
  Bundle,
  BundleItem,
  DeployedEquipment,
  ExceptionRequest,
  Merchant,
  Order,
  OrderLine,
  Package,
  ReturnCase,
  ReturnItem,
  TerminalModel,
} from '@de/shared';
import { brandFromText } from '@de/shared';
import { fromJson } from '../util/json.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

export function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    pospMerchantId: row.pospMerchantId ?? undefined,
    mid: row.mid ?? undefined,
    dbaName: row.dbaName,
    legalName: row.legalName ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    primaryContact: row.primaryContact ?? undefined,
    merchantType: row.merchantType ?? undefined,
    taxExempt: row.taxExempt ?? undefined,
    supplyClub: row.supplyClub ?? undefined,
    lastUpdatedAt: iso(row.lastUpdatedAt),
    fortisLocationId: row.fortisLocationId ?? undefined,
    fortisLocationName: row.fortisLocationName ?? undefined,
    shippingAddress: fromJson<Address | undefined>(row.shippingAddressJson, undefined),
    createdAt: iso(row.createdAt),
  };
}

export function toBundle(row: BundleRow & { terminalModel?: TerminalModelRow | null }): Bundle {
  return {
    pospBundleId: row.pospBundleId,
    displayName: row.displayName,
    description: row.description ?? undefined,
    active: row.active,
    items: fromJson<BundleItem[]>(row.itemsJson, []),
    application: (row.application as Bundle['application']) ?? undefined,
    encryption: (row.encryption as Bundle['encryption']) ?? undefined,
    processorPlatform: (row.processorPlatform as Bundle['processorPlatform']) ?? undefined,
    pospApplication: row.pospApplication ?? undefined,
    pospEncryption: row.pospEncryption ?? undefined,
    pospOsBuild: row.pospOsBuild ?? undefined,
    distributor: row.distributor,
    accountingDeviceModel: row.accountingDeviceModel ?? undefined,
    accountingUnitPrice: row.accountingUnitPrice ?? undefined,
    brand: row.brand ?? brandFromText(row.accountingDeviceModel, row.displayName),
    terminalModelId: row.terminalModelId ?? undefined,
    terminalModel: row.terminalModel ? toTerminalModel(row.terminalModel) : undefined,
    updatedAt: iso(row.updatedAt),
  };
}

export function toTerminalModel(row: TerminalModelRow): TerminalModel {
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer ?? undefined,
    active: row.active,
    fortisManufacturerId: row.fortisManufacturerId ?? undefined,
    fortisApplicationId: row.fortisApplicationId ?? undefined,
    fortisCvmId: row.fortisCvmId ?? undefined,
    fortisPaymentPriority: row.fortisPaymentPriority ?? undefined,
    fortisManufacturerIdProd: row.fortisManufacturerIdProd ?? undefined,
    fortisApplicationIdProd: row.fortisApplicationIdProd ?? undefined,
    fortisCvmIdProd: row.fortisCvmIdProd ?? undefined,
    fortisPaymentPriorityProd: row.fortisPaymentPriorityProd ?? undefined,
    updatedAt: iso(row.updatedAt),
  };
}

export function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    pospOrderId: row.pospOrderId ?? undefined,
    reference: row.reference ?? undefined,
    status: row.status as Order['status'],
    method: row.method as Order['method'],
    classification: row.classification as Order['classification'],
    cancellable: row.cancellable,
    merchant: {
      id: row.merchantId,
      mid: row.merchantMid ?? undefined,
      dbaName: row.merchantDba ?? undefined,
      shippingAddress: fromJson<Address | undefined>(row.shippingAddressJson, undefined),
    },
    lines: fromJson<OrderLine[]>(row.linesJson, []),
    shippingMethodLabel: row.shippingMethodLabel ?? undefined,
    shippingCarrier: row.shippingCarrier ?? undefined,
    total: row.total ?? undefined,
    shipDate: iso(row.shipDate),
    packages: fromJson<Package[]>(row.packagesJson, []),
    serialNumbers: fromJson<string[]>(row.serialNumbersJson, []),
    originalOrderId: row.originalOrderId ?? undefined,
    createdBy: row.createdBy ?? undefined,
    originLinkToken: row.originLinkToken ?? undefined,
    originLinkName: row.originLinkName ?? undefined,
    syncStatus: row.syncStatus ?? undefined,
    syncError: row.syncError ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: iso(row.updatedAt),
  };
}

export function toDeployed(row: DeployedRow): DeployedEquipment {
  return {
    id: row.id,
    serialNumber: row.serialNumber,
    productName: row.productName ?? undefined,
    model: row.model ?? undefined,
    merchantId: row.merchantId,
    mid: row.mid ?? undefined,
    orderId: row.orderId ?? undefined,
    status: row.status as DeployedEquipment['status'],
    deployedAt: iso(row.deployedAt),
    fortisTerminalId: row.fortisTerminalId ?? undefined,
    fortisAccountId: row.fortisAccountId ?? undefined,
    fortisActivated: row.fortisActivated,
    application: (row.application as DeployedEquipment['application']) ?? undefined,
    encryption: (row.encryption as DeployedEquipment['encryption']) ?? undefined,
  };
}

export function toReturnCase(row: ReturnRow): ReturnCase {
  return {
    id: row.id,
    pospReturnId: row.pospReturnId ?? undefined,
    origin: (row.origin as ReturnCase['origin']) ?? 'engine',
    pospStatus: row.pospStatus ?? undefined,
    callTagId: row.callTagId ?? undefined,
    entityType: row.entityType as ReturnCase['entityType'],
    entityId: row.entityId,
    merchantId: row.merchantId,
    mid: row.mid ?? undefined,
    merchantDba: row.merchantDba ?? undefined,
    lifecycle: row.lifecycle as ReturnCase['lifecycle'],
    callTagStatus: (row.callTagStatus as ReturnCase['callTagStatus']) ?? undefined,
    items: fromJson<ReturnItem[]>(row.itemsJson, []),
    expectedItemCount: row.expectedItemCount,
    receivedItemCount: row.receivedItemCount,
    delinquent: row.delinquent,
    replacementOrderId: row.replacementOrderId ?? undefined,
    refundAmount: row.refundAmount ?? undefined,
    exceptionId: row.exceptionId ?? undefined,
    daysSinceDeployment: row.daysSinceDeployment ?? undefined,
    notes: row.notes ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: iso(row.updatedAt),
  };
}

export function toException(row: ExceptionRow): ExceptionRequest {
  return {
    id: row.id,
    type: row.type as ExceptionRequest['type'],
    status: row.status as ExceptionRequest['status'],
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    reason: row.reason,
    merchantId: row.merchantId ?? undefined,
    orderId: row.orderId ?? undefined,
    returnCaseId: row.returnCaseId ?? undefined,
    bundlePospId: row.bundlePospId ?? undefined,
    originalPrice: row.originalPrice ?? undefined,
    requestedPrice: row.requestedPrice ?? undefined,
    serialNumber: row.serialNumber ?? undefined,
    daysSinceDeployment: row.daysSinceDeployment ?? undefined,
    decidedBy: row.decidedBy ?? undefined,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote ?? undefined,
  };
}
