import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { requestDatabaseContext } from '../database-context';
import { overtimeAuthorityEffect } from './overtime-authority-approval';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import type {
  OvertimeAuthorityRejectInput,
  OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import {
  assertCommandAccess,
  assertStatus,
  lockAuthority,
  openApprovalRequestId,
  readAuthority,
} from './overtime-authority.records';

/** Reject a reviewed authority on the shared Approval Route, with a reason. */
@Injectable()
export class RejectOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(
    context: RequestContext,
    authorityId: string,
    input: OvertimeAuthorityRejectInput,
  ): Promise<OvertimeAuthoritySummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const current = await lockAuthority(transaction, context.agencyId, authorityId);
        await assertCommandAccess(
          transaction,
          context,
          'overtime.authorities.reject',
          current.employees.map((row) => row.employeeId),
        );
        assertStatus(current, 'FOR_REVIEW', 'rejected');
        const requestId = await openApprovalRequestId(transaction, context.agencyId, authorityId);
        await this.approvals.decideInTransaction(
          transaction,
          context,
          requestId,
          'REJECT',
          input.reason,
          undefined,
          overtimeAuthorityEffect,
        );
        await transaction.overtimeAuthority.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
          data: { status: 'REJECTED' },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'OVERTIME_AUTHORITY_REJECTED',
          entityType: 'OvertimeAuthority',
          entityId: authorityId,
          previousStatus: 'FOR_REVIEW',
          newStatus: 'REJECTED',
          reason: input.reason,
          requestId: context.requestId,
          metadata: { authorityNo: current.authorityNo, approvalRequestId: requestId },
        });
        return readAuthority(transaction, context.agencyId, authorityId);
      },
    );
  }
}
