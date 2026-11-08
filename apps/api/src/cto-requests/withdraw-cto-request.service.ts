import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { ApprovalsService } from '../approvals/approval.service';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import {
  approvalRequestMissing,
  assertEmployeeAccess,
  assertStatus,
  lockRequest,
  openApprovalRequest,
  readRequest,
} from './cto-request.records';
import { WITHDRAW_PERMISSION, type CtoRequestSummary } from './cto-requests.types';

/** The Employee closes their own request before approval, cancelling its route work. */
@Injectable()
export class WithdrawCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(context: RequestContext, requestId: string): Promise<CtoRequestSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const { agencyId } = context;
        const current = await lockRequest(transaction, agencyId, requestId);
        await assertEmployeeAccess(transaction, context, WITHDRAW_PERMISSION, current.employeeId);
        assertStatus(current, ['SUBMITTED', 'FOR_APPROVAL'], 'withdrawn');
        const open = await openApprovalRequest(transaction, agencyId, requestId, 'IN_PROGRESS');
        if (!open) throw approvalRequestMissing();
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'CANCELLED' },
        });
        await this.approvals.cancelInTransaction(
          transaction,
          context,
          open.id,
          'The Employee withdrew the CTO Request.',
        );
        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_WITHDRAWN',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: current.status,
          newStatus: 'CANCELLED',
          requestId: context.requestId,
          metadata: { approvalRequestId: open.id },
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }
}
