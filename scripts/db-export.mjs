// Export the SQLite database to a portable, self-contained backup file (data/backup.db).
// SQLite is a single file, so a copy IS a complete, restorable snapshot.
//   docker compose run --rm backup            (or)   npm run db:export
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = resolve(root, 'server/prisma/dev.db');
const backupDir = resolve(root, 'data');
const backup = resolve(backupDir, 'backup.db');

if (!existsSync(db)) {
  console.error('No database at server/prisma/dev.db — nothing to export.');
  process.exit(1);
}
mkdirSync(backupDir, { recursive: true });
copyFileSync(db, backup);
console.log('✓ Exported database → data/backup.db');
