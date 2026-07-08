import type { ReportedIssue } from '@de/shared';
import { prisma } from '../db.js';

type Row = {
  id: number; merchantId: number; merchantDba: string | null; serialNumber: string | null; deviceProduct: string | null;
  issueCode: string; issueLabel: string; notes: string | null; outcome: string; returnCaseId: number | null;
  replacementOrderId: number | null; createdBy: string | null; createdAt: Date;
};

function toReportedIssue(r: Row): ReportedIssue {
  return {
    id: r.id,
    merchantId: r.merchantId,
    merchantDba: r.merchantDba ?? undefined,
    serialNumber: r.serialNumber ?? undefined,
    deviceProduct: r.deviceProduct ?? undefined,
    issueCode: r.issueCode,
    issueLabel: r.issueLabel,
    notes: r.notes ?? undefined,
    outcome: r.outcome as ReportedIssue['outcome'],
    returnCaseId: r.returnCaseId ?? undefined,
    replacementOrderId: r.replacementOrderId ?? undefined,
    createdBy: r.createdBy ?? undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

export const reportedIssueService = {
  async list(): Promise<ReportedIssue[]> {
    const rows = await prisma.reportedIssue.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map(toReportedIssue);
  },
};
