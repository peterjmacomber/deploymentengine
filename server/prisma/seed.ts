import {
  ExceptionType,
  OrderMethod,
  ReturnReasonCode,
  ReturnType,
  Role,
} from '@de/shared';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/password.js';
import { toJson } from '../src/util/json.js';
import { MOCK_BUNDLES, MOCK_MERCHANTS } from '../src/adapters/posportal/mockData.js';
import { orderService } from '../src/services/orderService.js';
import { returnService } from '../src/services/returnService.js';
import { exceptionService } from '../src/services/exceptionService.js';
import { logger } from '../src/logger.js';

const DEV_PASSWORD = 'password123';

const SEED_USERS = [
  { email: 'admin@deployment.local', name: 'Ada Admin', role: Role.ADMIN },
  { email: 'manager@deployment.local', name: 'Morgan Manager', role: Role.MANAGER },
  { email: 'agent@deployment.local', name: 'Alex Agent', role: Role.AGENT },
  { email: 'viewer@deployment.local', name: 'Riley Readonly', role: Role.READONLY },
];

async function seedUsers() {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const u of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash },
      update: { name: u.name, role: u.role },
    });
  }
  logger.info(`seeded ${SEED_USERS.length} users (password: ${DEV_PASSWORD})`);
}

async function seedBundles() {
  for (const b of MOCK_BUNDLES) {
    await prisma.bundle.upsert({
      where: { pospBundleId: b.pospBundleId },
      create: {
        pospBundleId: b.pospBundleId,
        displayName: b.name,
        description: b.description,
        active: b.active,
        itemsJson: toJson(b.items.map((it) => ({ sku: it.sku, name: it.name, quantity: it.quantity, kind: 'other' }))),
        application: b.application,
        encryption: b.encryption,
        processorPlatform: b.processorPlatform,
        distributor: b.distributor,
        accountingDeviceModel: b.accountingDeviceModel,
        accountingUnitPrice: b.accountingUnitPrice,
      },
      update: { displayName: b.name, active: b.active },
    });
  }
  logger.info(`seeded ${MOCK_BUNDLES.length} bundles`);
}

async function seedMerchants() {
  const ids: number[] = [];
  for (const m of MOCK_MERCHANTS) {
    const row = await prisma.merchant.upsert({
      where: { id: m.id }, // stable ids so re-seed is idempotent
      create: {
        id: m.id,
        pospMerchantId: m.id,
        mid: m.mid,
        dbaName: m.dbaName,
        legalName: m.legalName,
        email: m.email,
        phone: m.phone,
        shippingAddressJson: toJson({ merchantName: m.dbaName, ...m.address }),
      },
      update: { dbaName: m.dbaName },
    });
    ids.push(row.id);
  }
  logger.info(`seeded ${MOCK_MERCHANTS.length} merchants`);
  return ids;
}

async function seedActivity(merchantIds: number[]) {
  const existing = await prisma.order.count();
  if (existing > 0) {
    logger.info('orders already present — skipping sample activity');
    return;
  }
  const actor = 'seed@deployment.local';
  const addrFor = async (merchantId: number) => {
    const m = await prisma.merchant.findUnique({ where: { id: merchantId } });
    return JSON.parse(m!.shippingAddressJson!);
  };

  // Order 1: shipped + delivered (drives deployed equipment + Fortis + tracker).
  const o1 = await orderService.create(
    { merchantId: merchantIds[0], mid: MOCK_MERCHANTS[0].mid, cart: [{ pospBundleId: 2001, quantity: 2 }], shippingAddress: await addrFor(merchantIds[0]), shippingMethodId: 2 },
    { createdBy: actor, method: OrderMethod.DEPLOYMENT_ENGINE },
  );
  await orderService.simulateShip(o1.id);
  await orderService.markDelivered(o1.id, 'J. DOE');

  // Order 2: shipped, in transit.
  const o2 = await orderService.create(
    { merchantId: merchantIds[1], mid: MOCK_MERCHANTS[1].mid, cart: [{ pospBundleId: 2004, quantity: 1 }], shippingAddress: await addrFor(merchantIds[1]), shippingMethodId: 1 },
    { createdBy: actor, method: OrderMethod.DEPLOYMENT_ENGINE },
  );
  await orderService.simulateShip(o2.id);

  // Order 3: freshly placed.
  await orderService.create(
    { merchantId: merchantIds[2], mid: MOCK_MERCHANTS[2].mid, cart: [{ pospBundleId: 2002, quantity: 3 }], shippingAddress: await addrFor(merchantIds[2]), shippingMethodId: 1 },
    { createdBy: actor, method: OrderMethod.DEPLOYMENT_ENGINE },
  );

  // A within-window swap on delivered order 1 (issues a call tag immediately).
  const de1 = await prisma.deployedEquipment.findFirst({ where: { orderId: o1.id } });
  if (de1) {
    await returnService.create(
      {
        entityType: 'order',
        entityId: o1.id,
        merchantId: merchantIds[0],
        items: [{ deployedEquipmentId: de1.id, returnType: ReturnType.REPLACEMENT, reasonCode: ReturnReasonCode.WARRANTY_DEFECT, expectedSerialNumber: de1.serialNumber }],
        replacementBundleId: 2001,
        daysSinceDeployment: 5,
        notes: 'Terminal fails to boot; warranty swap.',
      },
      actor,
    );
  }

  // An out-of-warranty swap → parks and opens a manager exception (appears in Approvals).
  const de2 = await prisma.deployedEquipment.findFirst({ where: { orderId: o2.id } });
  if (de2) {
    await returnService.create(
      {
        entityType: 'order',
        entityId: o2.id,
        merchantId: merchantIds[1],
        items: [{ deployedEquipmentId: de2.id, returnType: ReturnType.REPLACEMENT, reasonCode: ReturnReasonCode.CONNECTIVITY, expectedSerialNumber: de2.serialNumber }],
        daysSinceDeployment: 400,
        notes: 'Merchant requests swap 400 days out — outside warranty.',
      },
      actor,
    );
  }

  // A standalone pending price exception (free device) for the Approvals demo.
  await exceptionService.create(
    {
      type: ExceptionType.PRICE_EXCEPTION,
      reason: 'Retention offer — comp one A920 Pro for at-risk merchant.',
      merchantId: merchantIds[3],
      bundlePospId: 2001,
      originalPrice: 299,
      requestedPrice: 0,
    },
    'agent@deployment.local',
  );

  logger.info('seeded sample orders, returns, and exceptions');
}

async function main() {
  // 100% API mode: seed only the login users. All business data (merchants, bundles, orders,
  // deployed equipment) comes from POS Portal via `npm run import` / the dev import endpoint.
  await seedUsers();
  logger.info('✅ seed complete (users only — run the sandbox import for live data)');
}
// Legacy mock seeders kept for reference / offline demos; no longer invoked by main().
void seedBundles; void seedMerchants; void seedActivity;

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
