import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE,
  type OvertimeAuthorityDetail,
  type OvertimeAuthorityPendingAction,
  type OvertimeAuthorityRecord,
  type OvertimeAuthorityStatus,
  type OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import {
  accessScope,
  assertCommandAccess,
  findAuthorities,
  readAuthority,
  reviewMetadataSchema,
} from './overtime-authority.records';

const READ = 'overtime.authorities.read';
const ENTITY_TYPE = 'OvertimeAuthority';

/**
 * Read Overtime Authorities. An Agency grant reads them all; a Supervisor's
 * DIRECT_REPORTS grant reads only authorities whose every covered Employee is
 * a direct report, the same reach the commands require.
 */
@Injectable()
export class ReadOvertimeAuthoritiesService {
  async list(
    context: RequestContext,
    filter: { status?: OvertimeAuthorityStatus | undefined },
  ): Promise<OvertimeAuthorityRecord[]> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await accessScope(transaction, context, READ);
      const authorities = await findAuthorities(transaction, context.agencyId, {
        ...(filter.status ? { status: filter.status } : {}),
        ...(scope.kind === 'SCOPED'
          ? { employees: { every: { employeeId: { in: scope.employeeIds } } } }
          : {}),
      });
      return registerRecords(transaction, context.agencyId, authorities);
    });
  }

  async detail(context: RequestContext, authorityId: string): Promise<OvertimeAuthorityDetail> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await accessScope(transaction, context, READ);
      const authority = await readAuthority(transaction, context.agencyId, authorityId);
      await assertCommandAccess(
        transaction,
        context,
        READ,
        authority.employees.map((row) => row.employeeId),
      );
      const [record] = await registerRecords(transaction, context.agencyId, [authority]);
      if (!record) throw new Error('The Overtime Authority record was not built.');
      const events = await transaction.auditEvent.findMany({
        where: { agencyId: context.agencyId, entityType: ENTITY_TYPE, entityId: authorityId },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          reason: true,
          occurredAt: true,
          metadata: true,
          actorUser: { select: { displayName: true } },
        },
      });
      const reviewEvent = events
        .filter((event) => event.action === 'OVERTIME_AUTHORITY_REVIEWED')
        .at(-1);
      const reviewMetadata = reviewMetadataSchema.safeParse(reviewEvent?.metadata);
      const decision =
        reviewMetadata.success && ['APPROVED', 'REJECTED'].includes(authority.status)
          ? await transaction.approvalDecision.findFirst({
              where: {
                agencyId: context.agencyId,
                approvalStep: { approvalRequestId: reviewMetadata.data.approvalRequestId },
              },
              orderBy: { decidedAt: 'desc' },
              select: {
                decision: true,
                comments: true,
                decidedAt: true,
                decidedBy: { select: { user: { select: { displayName: true } } } },
              },
            })
          : null;
      return {
        ...record,
        review:
          reviewEvent && reviewMetadata.success
            ? {
                reviewedByName: reviewEvent.actorUser?.displayName ?? null,
                reviewedAt: reviewEvent.occurredAt.toISOString(),
                attestations: reviewMetadata.data.attestations,
              }
            : null,
        decision: decision
          ? {
              decision: decision.decision,
              comments: decision.comments,
              decidedByName: decision.decidedBy.user.displayName,
              decidedAt: decision.decidedAt.toISOString(),
            }
          : null,
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          reason: event.reason,
          actorName: event.actorUser?.displayName ?? null,
          occurredAt: event.occurredAt.toISOString(),
        })),
      };
    });
  }
}

/** Add the unit name, last change, and pending action the register shows. */
async function registerRecords(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  authorities: OvertimeAuthoritySummary[],
): Promise<OvertimeAuthorityRecord[]> {
  if (authorities.length === 0) return [];
  const ids = authorities.map((authority) => authority.id);
  const [units, changes, requests] = await Promise.all([
    transaction.organizationUnit.findMany({
      where: { agencyId, id: { in: [...new Set(authorities.map((row) => row.requestingUnitId))] } },
      select: { id: true, code: true, currentVersion: { select: { name: true } } },
    }),
    transaction.auditEvent.groupBy({
      by: ['entityId'],
      where: { agencyId, entityType: ENTITY_TYPE, entityId: { in: ids } },
      _max: { occurredAt: true },
    }),
    transaction.approvalRequest.findMany({
      where: {
        agencyId,
        subjectType: OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE,
        subjectId: {
          in: authorities.filter((row) => row.status === 'FOR_REVIEW').map((row) => row.id),
        },
        status: 'IN_PROGRESS',
      },
      select: {
        subjectId: true,
        currentStepNo: true,
        steps: {
          select: {
            stepNo: true,
            assignedMembership: { select: { user: { select: { displayName: true } } } },
          },
        },
      },
    }),
  ]);
  const unitNames = new Map(units.map((unit) => [unit.id, unit.currentVersion?.name ?? unit.code]));
  const changedAt = new Map(changes.map((change) => [change.entityId, change._max.occurredAt]));
  const assignees = new Map(
    requests.map((request) => [
      request.subjectId,
      request.steps.find((step) => step.stepNo === request.currentStepNo)?.assignedMembership?.user
        .displayName ?? null,
    ]),
  );
  return authorities.map((authority) => ({
    ...authority,
    requestingUnitName: unitNames.get(authority.requestingUnitId) ?? authority.requestingUnitId,
    updatedAt: (changedAt.get(authority.id) ?? new Date(authority.createdAt)).toISOString(),
    pendingAction: pendingAction(authority.status, assignees.get(authority.id) ?? null),
  }));
}

function pendingAction(
  status: OvertimeAuthorityStatus,
  assigneeName: string | null,
): OvertimeAuthorityPendingAction | null {
  if (status === 'DRAFT') return { role: 'PREPARER', assigneeName: null };
  if (status === 'SUBMITTED') return { role: 'REVIEWER', assigneeName: null };
  if (status === 'FOR_REVIEW') return { role: 'APPROVING_OFFICIAL', assigneeName };
  return null;
}
