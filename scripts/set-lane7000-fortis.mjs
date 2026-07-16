// One-off: make the Ingenico Lane 7000 bundle orderable and stamp its Fortis Gateway config.
// Sandbox-resolved IDs (closest matches to the requested "Ingenico Tetra Lane / Tetra Credit Only"):
//   manufacturer=2 (Ingenico), application=Ingenico Lane 3000, cvm=Tetra Credit Only 2024, priority=Credit.
// Idempotent. `docker compose run --rm tools node scripts/set-lane7000-fortis.mjs`
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const updated = await prisma.bundle.updateMany({
  where: { pospBundleId: 2003 },
  data: {
    accountingDeviceModel: 'Lane 7000',
    fortisManufacturerId: '2', // Ingenico
    fortisApplicationId: '11ed2894a2ac99d4b5f547d4', // Ingenico Lane 3000 (Tetra Lane family)
    fortisCvmId: '11ef34cd9441717a871be8eb', // Tetra Credit Only 2024
    fortisPaymentPriority: 'Credit',
    active: true,
  },
});
console.log('Lane 7000 bundle updated:', updated.count);
await prisma.$disconnect();
