// Restore the SQLite database from data/backup.db (overwrites the current dev.db).
//   docker compose run --rm tools node scripts/db-import.mjs   (or)   npm run db:import
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = resolve(root, 'server/prisma/dev.db');
const backup = resolve(root, 'data/backup.db');

if (!existsSync(backup)) {
  console.error('No backup at data/backup.db — nothing to import.');
  process.exit(1);
}
mkdirSync(dirname(db), { recursive: true });
copyFileSync(backup, db);
console.log('✓ Imported database from data/backup.db → server/prisma/dev.db');
