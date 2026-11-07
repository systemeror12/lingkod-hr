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
  decisionAlreadyRecorded,
  lockRequest,
  openApprovalRequest,
  readRequest,
} from './cto-request.records';
import {
  REJECT_PERMISSION,
  type CtoRequestRejectInput,
  type CtoRequestSummary,
} from './cto-requests.types';

/**
 * The Approving Official rejects a FOR_APPROVAL request with a reason. It closes the
 * request and writes nothing to the COC ledger or Attendance.
 */
@Injectable()
export class RejectCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(
    context: RequestContext,
    requestId: string,
    input: CtoRequestRejectInput,
    idempotencyKey?: string,
  ): Promise<CtoRequestSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const { agencyId } = context;
        const current = await lockRequest(transaction, agencyId, requestId);
        await assertEmployeeAccess(transaction, context, REJECT_PERMISSION, current.employeeId);
        await assertNotOwnRequest(transaction, context, current.employeeId);
        const replayed = await decisionAlreadyRecorded(transaction, context, {
          action: 'CTO_REQUEST_REJECTED',
          requestId,
          idempotencyKey,
          reason: input.reason,
        });
        if (replayed) return readRequest(transaction, agencyId, requestId);
        assertStatus(current, ['FOR_APPROVAL'], 'rejected');
        const open = await openApprovalRequest(transaction, agencyId, requestId, 'IN_PROGRESS');
        if (!open) throw approvalRequestMissing();
        await this.approvals.decideInTransaction(
          transaction,
          context,
          open.id,
          'REJECT',
          input.reason,
          undefined,
          undefined,
          current.employeeId,
        );
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'REJECTED' },
        });
        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_REJECTED',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: 'FOR_APPROVAL',
          newStatus: 'REJECTED',
          reason: input.reason,
          requestId: context.requestId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          metadata: { approvalRequestId: open.id },
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }
}
