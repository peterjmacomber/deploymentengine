// Headless sandbox import: docker compose run --rm tools npm run import --workspace server [count]
import { importService } from '../src/services/importService.js';
import { prisma } from '../src/db.js';
import { logger } from '../src/logger.js';

const count = Number(process.argv[2]) || 60;
importService
  .run({ orders: count, fresh: true })
  .then((r) => logger.info(r, 'sandbox import finished'))
  .catch((e) => {
    logger.error({ err: e }, 'sandbox import failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
