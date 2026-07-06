import {
  BundleApplication,
  EncryptionType,
  ProcessorPlatform,
} from '@de/shared';
import type { PospBundleItem, RawConsignedItem } from './PosPortalAdapter.js';

/**
 * The sandbox "snapshot" — realistic seed data derived from the forecasting prototype's
 * active device catalog. Powers the whole system in mock mode with zero credentials.
 */

export interface MockBundleSeed {
  pospBundleId: number;
  name: string;
  description: string;
  items: PospBundleItem[];
  active: boolean;
  // local config overlay (the app/encryption gap we close)
  application: BundleApplication;
  encryption: EncryptionType;
  processorPlatform: ProcessorPlatform;
  distributor: string;
  accountingDeviceModel: string;
  accountingUnitPrice: number;
}

export const MOCK_BUNDLES: MockBundleSeed[] = [
  {
    pospBundleId: 2001,
    name: 'PAX A920 Pro — Wireless Retail Bundle',
    description: 'PAX A920 Pro smart terminal, charging cradle, and receipt paper. Preconfigured for Fortis Retail on Fiserv Nashville.',
    items: [
      { sku: 'A920Pro-0AW-RE5-30EA', name: 'PAX A920 Pro Smart Terminal', quantity: 1 },
      { sku: 'A920-CRADLE', name: 'A920 Charging Cradle', quantity: 1 },
      { sku: 'PAPER-2.25-5PK', name: 'Receipt Paper 2.25" (5 pack)', quantity: 1 },
    ],
    active: true,
    application: BundleApplication.FORTIS_RETAIL,
    encryption: EncryptionType.AES_DUKPT,
    processorPlatform: ProcessorPlatform.FISERV_NASHVILLE,
    distributor: 'POS Portal',
    accountingDeviceModel: 'PAX A920 Pro',
    accountingUnitPrice: 299,
  },
  {
    pospBundleId: 2002,
    name: 'PAX A80 — Countertop Bundle',
    description: 'PAX A80 countertop terminal with power supply and paper. Fortis Retail, Fiserv Omaha.',
    items: [
      { sku: 'A80-0BA-RD6-00AA', name: 'PAX A80 Countertop Terminal', quantity: 1 },
      { sku: 'A80-PSU', name: 'A80 Power Supply', quantity: 1 },
      { sku: 'PAPER-2.25-5PK', name: 'Receipt Paper 2.25" (5 pack)', quantity: 1 },
    ],
    active: true,
    application: BundleApplication.FORTIS_RETAIL,
    encryption: EncryptionType.TDES_DUKPT,
    processorPlatform: ProcessorPlatform.FISERV_OMAHA,
    distributor: 'POS Portal',
    accountingDeviceModel: 'PAX A80',
    accountingUnitPrice: 189,
  },
  {
    pospBundleId: 2003,
    name: 'Ingenico Lane 7000 — Integrated Bundle',
    description: 'Ingenico Lane 7000 PIN pad for integrated POS. TSYS, Voltage P2PE.',
    items: [
      { sku: 'PRG30313542S', name: 'Ingenico Lane 7000 CL3', quantity: 1 },
      { sku: 'LANE-USB', name: 'USB Interface Cable', quantity: 1 },
    ],
    active: true,
    application: BundleApplication.GENERIC_EMV,
    encryption: EncryptionType.VOLTAGE_P2PE,
    processorPlatform: ProcessorPlatform.TSYS,
    distributor: 'POS Portal',
    accountingDeviceModel: 'ING Lane 7000',
    accountingUnitPrice: 245,
  },
  {
    pospBundleId: 2004,
    name: 'Dejavoo QD4 — WiFi Restaurant Bundle',
    description: 'Dejavoo QD4 with WiFi/Ethernet and paper. Fortis Restaurant, Elavon.',
    items: [
      { sku: 'QD4_REV3 000-003', name: 'Dejavoo QD4 Terminal', quantity: 1 },
      { sku: 'PAPER-3.125-5PK', name: 'Receipt Paper 3.125" (5 pack)', quantity: 2 },
    ],
    active: true,
    application: BundleApplication.FORTIS_RESTAURANT,
    encryption: EncryptionType.AES_DUKPT,
    processorPlatform: ProcessorPlatform.ELAVON,
    distributor: 'POS Portal',
    accountingDeviceModel: 'DJV QD4',
    accountingUnitPrice: 265,
  },
  {
    pospBundleId: 2005,
    name: 'PAX A35 — Mobile PIN Pad Bundle',
    description: 'PAX A35 wireless PIN pad for mobile/attended lanes. Fortis Mobile, Worldpay.',
    items: [
      { sku: 'A35-0BW-RD6-04AA', name: 'PAX A35 PIN Pad', quantity: 1 },
      { sku: 'A35-DOCK', name: 'A35 Dock', quantity: 1 },
    ],
    active: true,
    application: BundleApplication.FORTIS_MOBILE,
    encryption: EncryptionType.AES_DUKPT,
    processorPlatform: ProcessorPlatform.WORLDPAY,
    distributor: 'POS Portal',
    accountingDeviceModel: 'PAX A35',
    accountingUnitPrice: 129,
  },
  {
    pospBundleId: 2006,
    name: 'ID Tech VP3300 — Mobile Reader Bundle',
    description: 'ID Tech VP3300 Bluetooth secure card reader for SDK/mobile integrations. TDES DUKPT.',
    items: [
      { sku: 'IDMR-BT93133P2-F1-A', name: 'ID Tech VP3300 BT Reader', quantity: 1 },
      { sku: 'VP3300-USB', name: 'Charging Cable', quantity: 1 },
    ],
    active: false, // inactive by default to demo the admin activation flow
    application: BundleApplication.GENERIC_EMV,
    encryption: EncryptionType.TDES_DUKPT,
    processorPlatform: ProcessorPlatform.FISERV_NASHVILLE,
    distributor: 'POS Portal',
    accountingDeviceModel: 'IDT VP3300',
    accountingUnitPrice: 89,
  },
];

export interface MockMerchantSeed {
  id: number;
  mid: string;
  dbaName: string;
  legalName: string;
  email: string;
  phone: string;
  address: { line1: string; city: string; region: string; postalCode: string; country: string };
}

export const MOCK_MERCHANTS: MockMerchantSeed[] = [
  { id: 10001, mid: '445001230001', dbaName: 'Blue Ridge Coffee', legalName: 'Blue Ridge Coffee LLC', email: 'owner@blueridgecoffee.com', phone: '828-555-0142', address: { line1: '18 Biltmore Ave', city: 'Asheville', region: 'NC', postalCode: '28801', country: 'US' } },
  { id: 10002, mid: '445001230002', dbaName: 'Sunset Tacos', legalName: 'Sunset Tacos Inc', email: 'hola@sunsettacos.com', phone: '512-555-0198', address: { line1: '900 S Congress Ave', city: 'Austin', region: 'TX', postalCode: '78704', country: 'US' } },
  { id: 10003, mid: '445001230003', dbaName: 'Harbor Hardware', legalName: 'Harbor Hardware Co', email: 'sales@harborhardware.com', phone: '207-555-0176', address: { line1: '5 Commercial St', city: 'Portland', region: 'ME', postalCode: '04101', country: 'US' } },
  { id: 10004, mid: '445001230004', dbaName: 'Cactus Auto Wash', legalName: 'Cactus Auto Wash LLC', email: 'ops@cactuswash.com', phone: '480-555-0110', address: { line1: '2201 E University Dr', city: 'Tempe', region: 'AZ', postalCode: '85281', country: 'US' } },
];

/** Consigned inventory snapshot — serialized devices + non-serialized paper + a refurb. */
export const MOCK_CONSIGNED: RawConsignedItem[] = [
  { product: { id: '136803', modelNumber: 'A920Pro-0AW-RE5-30EA', name: 'PAX, A920Pro High Memory, PCI.5, New', category: 'Terminal', subcategory: 'Serialized' }, totalOnHand: 142, totalP2peOnHand: 12, locations: [{ category: 'FGI', onHand: 120 }, { category: 'IN_REPAIR', onHand: 8 }, { category: 'CORE', onHand: 10 }, { category: 'SCRAP', onHand: 4 }] },
  { product: { id: '136865', modelNumber: 'A80-0BA-RD6-00AA', name: 'PAX, A80, PCI.6, Android 10, New', category: 'Terminal', subcategory: 'Serialized' }, totalOnHand: 64, locations: [{ category: 'FGI', onHand: 58 }, { category: 'IN_REPAIR', onHand: 3 }, { category: 'CORE', onHand: 3 }] },
  { product: { id: '138982', modelNumber: 'PRG30313542S', name: 'ING, Lane 7000 CL3, PCI.6, New', category: 'PIN Pad', subcategory: 'Serialized' }, totalOnHand: 21, locations: [{ category: 'FGI', onHand: 18 }, { category: 'IN_REPAIR', onHand: 3 }] },
  { product: { id: '142975', modelNumber: 'QD4_REV3 000-003', name: 'DJV, QD4, PCI 6, Wifi/Ethernet, New', category: 'Terminal', subcategory: 'Serialized' }, totalOnHand: 9, locations: [{ category: 'FGI', onHand: 7 }, { category: 'IN_REPAIR', onHand: 2 }] },
  { product: { id: '140723', modelNumber: 'A35-0BW-RD6-04AA', name: 'PAX, A35, PCI.6, Wireless PIN Pad, New', category: 'PIN Pad', subcategory: 'Serialized' }, totalOnHand: 3, locations: [{ category: 'FGI', onHand: 3 }] },
  { product: { id: '139074', modelNumber: 'IDMR-BT93133P2-F1-A', name: 'IDT, VP3300, BT, Secure Card Reader, New', category: 'Card Reader', subcategory: 'Serialized' }, totalOnHand: 0, locations: [] },
  { product: { id: '136803R', modelNumber: 'A920Pro-REFURB', name: 'PAX, A920Pro, Refurbished', category: 'Terminal', subcategory: 'Serialized' }, totalOnHand: 27, locations: [{ category: 'FGI', onHand: 27 }] },
  { product: { id: '900101', modelNumber: '', name: 'Receipt Paper 2.25in, POD', category: 'Supplies', subcategory: 'Non-Serialized' }, totalOnHand: 5400, locations: [{ category: 'FGI', onHand: 5400 }] },
];

export const MOCK_SHIPPING_METHODS = [
  { id: 1, name: 'Ground', rate: 0, estimatedDays: 5, carrier: 'UPS' },
  { id: 2, name: '2-Day Air', rate: 25, estimatedDays: 2, carrier: 'UPS' },
  { id: 3, name: 'Overnight', rate: 60, estimatedDays: 1, carrier: 'UPS' },
];
