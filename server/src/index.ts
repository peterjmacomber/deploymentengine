import { config } from './config.js';
import { logger } from './logger.js';
import { connectDb, prisma } from './db.js';
import { buildApp } from './http/app.js';
// Initialize adapters early so their mode is logged at boot.
import { posPortal } from './adapters/posportal/index.js';
import { fortis } from './adapters/fortis/index.js';
import { pollerService } from './services/pollerService.js';

async function main() {
  await connectDb();
  posPortal();
  fortis();
  pollerService.start();

  const app = buildApp();
  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, pospMode: config.POSP_MODE, fortisConfigured: config.fortisConfigured, env: config.NODE_ENV },
      `Deployment Engine API listening on http://localhost:${config.PORT}`,
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
