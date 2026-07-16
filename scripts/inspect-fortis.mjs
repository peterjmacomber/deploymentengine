import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const fts = await prisma.fortisTerminal.findMany({ orderBy: { id: 'desc' }, take: 6 });
console.log('=== FortisTerminal records (newest) ===');
for (const t of fts) console.log(`order#${t.orderId} ${t.title} serial=${t.serialNumber} status=${t.status} termId=${t.terminalId}`);
const syncs = await prisma.fortisTerminalSync.findMany({ orderBy: { id: 'desc' }, take: 6 });
console.log('=== FortisTerminalSync (newest) ===');
for (const s of syncs) console.log(`order#${s.orderId} serial=${s.serialNumber} status=${s.status} termId=${s.terminalId}`);
await prisma.$disconnect();
