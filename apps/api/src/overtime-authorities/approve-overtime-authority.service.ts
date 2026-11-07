import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { requestDatabaseContext } from '../database-context';
import { eligibilitySnapshots } from './eligibility-snapshot';
import { overtimeAuthorityEffect } from './overtime-authority-approval';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import {
  OVERTIME_PAY_UNAVAILABLE_REASON,
  OvertimeAuthorityServiceError,
  type OvertimeAuthorityApproveInput,
  type OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import {
  assertCommandAccess,
  assertDraftValid,
  assertNotPreparer,
  assertStatus,
  lockAuthority,
  readAuthority,
  recordedReview,
} from './overtime-authority.records';

/**
 * Record the Approving Official's decision on the one-step shared Approval
 * Route the review opened, then fix the compensation method, store each
 * covered Employee's eligibility snapshot, and freeze the authority as APPROVED.
 */
@Injectable()
export class ApproveOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(
    context: RequestContext,
    authorityId: string,
    input: OvertimeAuthorityApproveInput,
  ): Promise<OvertimeAuthoritySummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const current = await lockAuthority(transaction, context.agencyId, authorityId);
        await assertCommandAccess(
          transaction,
          context,
          'overtime.authorities.approve',
          current.employees.map((row) => row.employeeId),
        );
        assertStatus(current, 'FOR_REVIEW', 'approved');
        await assertNotPreparer(transaction, context, authorityId);
        if (input.compensationMethod === 'OVERTIME_PAY') {
          throw new OvertimeAuthorityServiceError(
            `${OVERTIME_PAY_UNAVAILABLE_REASON} Approve it as COC or reject it.`,
            409,
            'OVERTIME_AUTHORITY_OVERTIME_PAY_BLOCKED_BY_PAYROLL',
          );
        }
        await assertDraftValid(transaction, context.agencyId, current);
        const review = await recordedReview(transaction, context.agencyId, authorityId);
        const requestId = review.approvalRequestId;
        await this.approvals.decideInTransaction(
          transaction,
          context,
          requestId,
          'APPROVE',
          input.comments,
          undefined,
          overtimeAuthorityEffect,
        );
        const approvedAt = new Date();
        const snapshots = await eligibilitySnapshots(transaction, current, review, approvedAt);
        for (const row of current.employees) {
          await transaction.overtimeAuthorityEmployee.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: row.id } },
            data: {
              eligibilitySnapshot: snapshots.get(
                row.employeeId,
              ) as unknown as Prisma.InputJsonValue,
            },
          });
        }
        await transaction.overtimeAuthority.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
          data: {
            status: 'APPROVED',
            compensationMethod: input.compensationMethod,
            approvedByMembershipId: context.membershipId,
            approvedAt,
          },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'OVERTIME_AUTHORITY_APPROVED',
          entityType: 'OvertimeAuthority',
          entityId: authorityId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'APPROVED',
          requestId: context.requestId,
          metadata: {
            authorityNo: current.authorityNo,
            approvalRequestId: requestId,
            compensationMethod: input.compensationMethod,
          },
        });
        return readAuthority(transaction, context.agencyId, authorityId);
      },
    );
  }
}
