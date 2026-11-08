import type { Prisma } from '@prisma/client';
import {
  OvertimeAuthorityServiceError,
  type EligibilitySnapshot,
  type OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import { formatDate, toDatabaseDate, type RecordedReview } from './overtime-authority.records';

/**
 * Build each covered Employee's eligibility snapshot at approval: the Service
 * Segments and Work Arrangement Versions over the Work Dates, plus the
 * reviewer's attestations. Keyed by Employee id.
 */
export async function eligibilitySnapshots(
  transaction: Prisma.TransactionClient,
  authority: OvertimeAuthoritySummary,
  review: RecordedReview,
  capturedAt: Date,
): Promise<Map<string, EligibilitySnapshot>> {
  const { agencyId } = authority;
  const employeeIds = authority.employees.map((row) => row.employeeId);
  const from = toDatabaseDate(authority.workDateFrom);
  const to = toDatabaseDate(authority.workDateTo);
  const overlapping = {
    effectiveFrom: { lte: to },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
  };
  const segments = await transaction.serviceSegment.findMany({
    where: { agencyId, employeeId: { in: employeeIds }, status: { not: 'VOIDED' }, ...overlapping },
    orderBy: { effectiveFrom: 'asc' },
    select: {
      id: true,
      employeeId: true,
      effectiveFrom: true,
      effectiveTo: true,
      appointmentStatus: true,
      salaryGrade: true,
      positionId: true,
      position: { select: { itemNumber: true } },
    },
  });
  const assignments = await transaction.scheduleAssignment.findMany({
    where: { agencyId, employeeId: { in: employeeIds }, ...overlapping },
    orderBy: { effectiveFrom: 'asc' },
    select: {
      employeeId: true,
      effectiveFrom: true,
      effectiveTo: true,
      workArrangementVersion: { select: { id: true, arrangementType: true, versionNo: true } },
    },
  });
  // A position keeps its earlier versions as SUPERSEDED once a successor is
  // activated; both still describe the position over their own dates.
  const positionIds = [
    ...new Set(segments.flatMap((row) => (row.positionId ? [row.positionId] : []))),
  ];
  const versions = await transaction.plantillaPositionVersion.findMany({
    where: {
      agencyId,
      positionId: { in: positionIds },
      status: { in: ['ACTIVE', 'SUPERSEDED'] },
      ...overlapping,
    },
    orderBy: { versionNo: 'desc' },
    select: {
      positionId: true,
      effectiveFrom: true,
      effectiveTo: true,
      positionTitle: true,
      employmentCategory: true,
    },
  });
  const attestations = new Map(review.attestations.map((row) => [row.employeeId, row]));

  const snapshots = new Map<string, EligibilitySnapshot>();
  for (const employeeId of employeeIds) {
    const attestation = attestations.get(employeeId);
    if (!attestation) {
      throw new OvertimeAuthorityServiceError(
        'The recorded review does not attest every covered Employee.',
        409,
        'OVERTIME_AUTHORITY_REVIEW_MISSING',
      );
    }
    const service = [];
    for (const segment of segments.filter((row) => row.employeeId === employeeId)) {
      // The position as it stood on the segment's first covered Work Date.
      const asOf = segment.effectiveFrom > from ? segment.effectiveFrom : from;
      const version = versions.find(
        (row) =>
          row.positionId === segment.positionId &&
          row.effectiveFrom <= asOf &&
          (row.effectiveTo === null || row.effectiveTo >= asOf),
      );
      service.push({
        serviceSegmentId: segment.id,
        effectiveFrom: formatDate(segment.effectiveFrom),
        effectiveTo: segment.effectiveTo ? formatDate(segment.effectiveTo) : null,
        appointmentStatus: segment.appointmentStatus,
        salaryGrade: segment.salaryGrade,
        positionId: segment.positionId,
        positionItemNumber: segment.position?.itemNumber ?? null,
        positionTitle: version?.positionTitle ?? null,
        personnelCategory: version?.employmentCategory ?? null,
      });
    }
    snapshots.set(employeeId, {
      capturedAt: capturedAt.toISOString(),
      workDateFrom: authority.workDateFrom,
      workDateTo: authority.workDateTo,
      service,
      workArrangements: assignments
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({
          workArrangementVersionId: row.workArrangementVersion.id,
          arrangementType: row.workArrangementVersion.arrangementType,
          versionNo: row.workArrangementVersion.versionNo,
          effectiveFrom: formatDate(row.effectiveFrom),
          effectiveTo: row.effectiveTo ? formatDate(row.effectiveTo) : null,
        })),
      attestation: {
        positionLevel: attestation.positionLevel,
        noOtherBeyondHoursAllowance: attestation.noOtherBeyondHoursAllowance,
        reviewedByMembershipId: review.reviewedByMembershipId,
        reviewedAt: review.reviewedAt.toISOString(),
      },
    });
  }
  return snapshots;
}
