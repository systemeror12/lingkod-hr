import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { requestDatabaseContext } from '../database-context';
import { resolveOvertimeAuthorityRoute } from './overtime-authority-approval';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import {
  OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE,
  OVERTIME_AUTHORITY_ROUTE_CODE,
  OvertimeAuthorityServiceError,
  type OvertimeAuthorityReviewInput,
  type OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import {
  assertCommandAccess,
  assertDraftValid,
  assertEligibleApprover,
  assertNotPreparer,
  assertStatus,
  lockAuthority,
  readAuthority,
} from './overtime-authority.records';

/**
 * Review a SUBMITTED authority: recheck eligibility, record the reviewer's
 * attestations for every covered Employee, and start the shared Approval
 * Route. The review Audit Event is the review result approval reads back.
 */
@Injectable()
export class ReviewOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(
    context: RequestContext,
    authorityId: string,
    review: OvertimeAuthorityReviewInput,
  ): Promise<OvertimeAuthoritySummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const current = await lockAuthority(transaction, context.agencyId, authorityId);
        await assertCommandAccess(
          transaction,
          context,
          'overtime.authorities.review',
          current.employees.map((row) => row.employeeId),
        );
        assertStatus(current, 'SUBMITTED', 'reviewed');
        await assertNotPreparer(transaction, context, authorityId);
        const covered = new Set(current.employees.map((row) => row.employeeId));
        if (
          review.attestations.length !== covered.size ||
          review.attestations.some((row) => !covered.has(row.employeeId))
        ) {
          throw new OvertimeAuthorityServiceError(
            'Attest every covered Employee, and only them.',
            422,
            'OVERTIME_AUTHORITY_ATTESTATIONS_MISMATCH',
          );
        }
        await assertDraftValid(transaction, context.agencyId, current);
        await assertEligibleApprover(transaction, context.agencyId, authorityId);

        const route = await resolveOvertimeAuthorityRoute(this.approvals, transaction, context);
        const request = await this.approvals.createRequestInTransaction(
          transaction,
          context,
          {
            routeCode: OVERTIME_AUTHORITY_ROUTE_CODE,
            subjectType: OVERTIME_AUTHORITY_APPROVAL_SUBJECT_TYPE,
            subjectId: authorityId,
          },
          undefined,
          route.id,
        );
        await this.approvals.submitInTransaction(transaction, context, request.id);
        await transaction.overtimeAuthority.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
          data: { status: 'FOR_REVIEW' },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'OVERTIME_AUTHORITY_REVIEWED',
          entityType: 'OvertimeAuthority',
          entityId: authorityId,
          previousStatus: 'SUBMITTED',
          newStatus: 'FOR_REVIEW',
          requestId: context.requestId,
          metadata: {
            authorityNo: current.authorityNo,
            approvalRequestId: request.id,
            attestations: review.attestations.map((row) => ({
              employeeId: row.employeeId,
              positionLevel: row.positionLevel,
              noOtherBeyondHoursAllowance: row.noOtherBeyondHoursAllowance,
            })),
          },
        });
        return readAuthority(transaction, context.agencyId, authorityId);
      },
    );
  }
}
