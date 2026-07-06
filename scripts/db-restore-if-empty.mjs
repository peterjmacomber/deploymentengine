// Auto-restore on first boot: if there's no live DB yet but a portable backup exists, restore it.
// This is what makes "copy the project folder to a new machine + `docker compose up`" reimport
// your data automatically. If neither exists, the install step creates a fresh seeded DB.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = resolve(root, 'server/prisma/dev.db');
const backup = resolve(root, 'data/backup.db');

if (existsSync(db)) {
  console.log('DB present — skipping auto-restore.');
} else if (existsSync(backup)) {
  mkdirSync(dirname(db), { recursive: true });
  copyFileSync(backup, db);
  console.log('✓ Auto-restored database from data/backup.db');
} else {
  console.log('No DB and no backup — a fresh seeded DB will be created.');
}
