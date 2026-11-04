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
  assertNotOwnRequest,
  assertStatus,
  lockRequest,
  openApprovalRequest,
  readRequest,
} from './cto-request.records';
import {
  RETURN_PERMISSION,
  type CtoRequestReturnInput,
  type CtoRequestSummary,
} from './cto-requests.types';

/**
 * Return a request to DRAFT with a comment. The active route step decides who may:
 * the Supervisor from SUBMITTED, the Approving Official from FOR_APPROVAL.
 */
@Injectable()
export class ReturnCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(
    context: RequestContext,
    requestId: string,
    input: CtoRequestReturnInput,
  ): Promise<CtoRequestSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const { agencyId } = context;
        const current = await lockRequest(transaction, agencyId, requestId);
        await assertEmployeeAccess(transaction, context, RETURN_PERMISSION, current.employeeId);
        await assertNotOwnRequest(transaction, context, current.employeeId);
        assertStatus(current, ['SUBMITTED', 'FOR_APPROVAL'], 'returned');
        const open = await openApprovalRequest(transaction, agencyId, requestId, 'IN_PROGRESS');
        if (!open) throw approvalRequestMissing();
        await this.approvals.decideInTransaction(
          transaction,
          context,
          open.id,
          'RETURN',
          input.comment,
          undefined,
          undefined,
          current.employeeId,
        );
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'DRAFT' },
        });
        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_RETURNED',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: current.status,
          newStatus: 'DRAFT',
          reason: input.comment,
          requestId: context.requestId,
          metadata: { approvalRequestId: open.id },
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }
}
