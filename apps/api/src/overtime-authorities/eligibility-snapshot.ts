import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { reviewerAttestationSchema } from './overtime-authorities.schemas';
import {
  OvertimeAuthorityServiceError,
  type EligibilitySnapshot,
  type OvertimeAuthoritySummary,
  type ReviewerAttestation,
} from './overtime-authorities.types';
import { formatDate, toDatabaseDate } from './overtime-authority.records';

export interface RecordedReview {
  reviewedByMembershipId: string;
  reviewedAt: Date;
  attestations: ReviewerAttestation[];
}

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
  const attestations = new Map(review.attestations.map((row) => [row.employeeId, row]));

  const snapshots = new Map<string, EligibilitySnapshot>();
  for (const employeeId of employeeIds) {
    const attestation = attestations.get(employeeId);
    if (!attestation) continue;
    const service = [];
    for (const segment of segments.filter((row) => row.employeeId === employeeId)) {
      // The position as it stood on the segment's first covered Work Date.
      const asOf = segment.effectiveFrom > from ? segment.effectiveFrom : from;
      const version = segment.positionId
        ? await transaction.plantillaPositionVersion.findFirst({
            where: {
              agencyId,
              positionId: segment.positionId,
              status: 'ACTIVE',
              effectiveFrom: { lte: asOf },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
            },
            orderBy: { versionNo: 'desc' },
            select: { positionTitle: true, employmentCategory: true },
          })
        : null;
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

/**
 * Read the review result: the attestations stored on the authority's
 * immutable review Audit Event. Approval copies them into each snapshot.
 */
export async function recordedReview(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  authorityId: string,
): Promise<RecordedReview> {
  const event = await transaction.auditEvent.findFirst({
    where: {
      agencyId,
      entityType: 'OvertimeAuthority',
      entityId: authorityId,
      action: 'OVERTIME_AUTHORITY_REVIEWED',
    },
    orderBy: { occurredAt: 'desc' },
    select: { actorMembershipId: true, occurredAt: true, metadata: true },
  });
  const parsed = reviewMetadataSchema.safeParse(event?.metadata);
  if (!event?.actorMembershipId || !parsed.success) {
    throw new OvertimeAuthorityServiceError(
      'The Overtime Authority has no recorded review to approve against.',
      409,
      'OVERTIME_AUTHORITY_REVIEW_MISSING',
    );
  }
  return {
    reviewedByMembershipId: event.actorMembershipId,
    reviewedAt: event.occurredAt,
    attestations: parsed.data.attestations,
  };
}

const reviewMetadataSchema = z.object({ attestations: z.array(reviewerAttestationSchema) });
