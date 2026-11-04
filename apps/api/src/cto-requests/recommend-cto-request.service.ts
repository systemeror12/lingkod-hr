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
  RECOMMEND_PERMISSION,
  type CtoRequestRecommendInput,
  type CtoRequestSummary,
} from './cto-requests.types';

/**
 * The Supervisor recommends a SUBMITTED request, having weighed service needs,
 * which routes it to the Approving Official. The decision is the route's first
 * step, so only that step's assigned or delegated authority can make it.
 */
@Injectable()
export class RecommendCtoRequestService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async execute(
    context: RequestContext,
    requestId: string,
    input: CtoRequestRecommendInput,
  ): Promise<CtoRequestSummary> {
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const { agencyId } = context;
        const current = await lockRequest(transaction, agencyId, requestId);
        await assertEmployeeAccess(transaction, context, RECOMMEND_PERMISSION, current.employeeId);
        await assertNotOwnRequest(transaction, context, current.employeeId);
        assertStatus(current, ['SUBMITTED'], 'recommended');
        const open = await openApprovalRequest(transaction, agencyId, requestId, 'IN_PROGRESS');
        if (!open) throw approvalRequestMissing();
        await this.approvals.decideInTransaction(
          transaction,
          context,
          open.id,
          'APPROVE',
          input.comment,
          undefined,
          undefined,
          current.employeeId,
        );
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'FOR_APPROVAL' },
        });
        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_RECOMMENDED',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: 'SUBMITTED',
          newStatus: 'FOR_APPROVAL',
          ...(input.comment ? { reason: input.comment } : {}),
          requestId: context.requestId,
          metadata: { approvalRequestId: open.id },
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }
}
