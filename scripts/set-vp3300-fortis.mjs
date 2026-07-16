// One-off: stamp the VP3300 bundle with its device model + Fortis Gateway IDs.
// Idempotent — safe to re-run. `docker compose run --rm tools node scripts/set-vp3300-fortis.mjs`
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const updated = await prisma.bundle.updateMany({
  where: { pospBundleId: 2006 },
  data: {
    accountingDeviceModel: 'VP3300',
    fortisManufacturerId: '4', // IDtech
    fortisApplicationId: '11eb1875895820ecab318375',
    fortisCvmId: '11eb17992c21d8f085973141',
    active: true,
  },
});
console.log('VP3300 bundle updated:', updated.count);
await prisma.$disconnect();
