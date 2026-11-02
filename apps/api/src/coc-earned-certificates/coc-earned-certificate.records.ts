import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import {
  CocEarnedCertificateServiceError,
  type CocEarnedCertificateStatus,
  type CocEarnedCertificateSummary,
} from './coc-earned-certificates.types';

const certificateSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  earnedMonth: true,
  status: true,
  preparedByMembershipId: true,
  approvedByMembershipId: true,
  approvedAt: true,
  createdAt: true,
  lines: {
    orderBy: { serviceRecord: { workDate: 'asc' as const } },
    select: {
      id: true,
      overtimeServiceRecordId: true,
      certifiedMinutes: true,
      creditedMinutes: true,
      excessMinutes: true,
      releasedAt: true,
      serviceRecord: { select: { workDate: true, dayClassification: true } },
    },
  },
} as const;

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The first day of a `YYYY-MM` month and of the month after it, as database dates. */
export function monthBounds(earnedMonth: string): { from: Date; to: Date } {
  const from = new Date(`${earnedMonth}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

export async function readCertificate(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  certificateId: string,
): Promise<CocEarnedCertificateSummary> {
  const record = await transaction.cocEarnedCertificate.findFirst({
    where: { agencyId, id: certificateId },
    select: certificateSelect,
  });
  if (!record) throw certificateNotFound();
  return {
    id: record.id,
    agencyId: record.agencyId,
    employeeId: record.employeeId,
    earnedMonth: formatDate(record.earnedMonth),
    status: record.status as CocEarnedCertificateStatus,
    preparedByMembershipId: record.preparedByMembershipId,
    approvedByMembershipId: record.approvedByMembershipId,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    lines: record.lines.map((line) => ({
      id: line.id,
      overtimeServiceRecordId: line.overtimeServiceRecordId,
      workDate: formatDate(line.serviceRecord.workDate),
      dayClassification: line.serviceRecord.dayClassification,
      certifiedMinutes: line.certifiedMinutes,
      creditedMinutes: line.creditedMinutes?.toFixed(1) ?? null,
      excessMinutes: line.excessMinutes?.toFixed(1) ?? null,
      releasedAt: line.releasedAt?.toISOString() ?? null,
    })),
  };
}

/** Lock one certificate for a command and return it. */
export async function lockCertificate(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  certificateId: string,
): Promise<CocEarnedCertificateSummary> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "coc_earned_certificates" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${certificateId} AS uuid) FOR UPDATE`,
  );
  if (rows.length !== 1) throw certificateNotFound();
  return readCertificate(transaction, agencyId, certificateId);
}

/**
 * Require an Agency-wide grant of `permission`. hris-controls §6.9 gives the
 * certificate permissions only `A` and `C` cells, both Agency-wide.
 */
export function assertAgencyGrant(context: RequestContext, permission: string): void {
  if (
    !context.agencyId ||
    !context.userId ||
    !context.membershipId ||
    !hasPermission(context, permission, { agencyId: context.agencyId })
  ) {
    throw new CocEarnedCertificateServiceError(
      'The current Agency Membership cannot act on Certificates of COC Earned.',
      403,
      'COC_EARNED_CERTIFICATE_FORBIDDEN',
    );
  }
}

export function assertStatus(
  certificate: CocEarnedCertificateSummary,
  expected: CocEarnedCertificateStatus,
  action: string,
): void {
  if (certificate.status !== expected) {
    throw new CocEarnedCertificateServiceError(
      `Only a ${expected} Certificate of COC Earned can be ${action}; this one is ${certificate.status}.`,
      409,
      `COC_EARNED_CERTIFICATE_NOT_${expected}`,
    );
  }
}

export function certificateNotFound(): CocEarnedCertificateServiceError {
  return new CocEarnedCertificateServiceError(
    'The Certificate of COC Earned could not be found.',
    404,
    'COC_EARNED_CERTIFICATE_NOT_FOUND',
  );
}
