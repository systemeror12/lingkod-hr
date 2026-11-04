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
  assertEmployeeAccess,
  assertStatus,
  lockRequest,
  openApprovalRequest,
  readRequest,
} from './cto-request.records';
import { CREATE_PERMISSION, type CtoRequestSummary } from './cto-requests.types';

/** Close a DRAFT, along with the Approval Request it was returned on, if any. */
@Injectable()
export class DiscardCtoRequestService {
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
        await assertEmployeeAccess(transaction, context, CREATE_PERMISSION, current.employeeId);
        assertStatus(current, ['DRAFT'], 'discarded');
        await transaction.ctoRequest.update({
          where: { agencyId_id: { agencyId, id: requestId } },
          data: { status: 'CANCELLED' },
        });
        const returned = await openApprovalRequest(transaction, agencyId, requestId, 'RETURNED');
        if (returned) {
          await this.approvals.cancelInTransaction(
            transaction,
            context,
            returned.id,
            'The CTO Request was discarded.',
          );
        }
        await this.auditWriter.write(transaction, {
          agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'CTO_REQUEST_DISCARDED',
          entityType: 'CtoRequest',
          entityId: requestId,
          previousStatus: 'DRAFT',
          newStatus: 'CANCELLED',
          requestId: context.requestId,
          metadata: returned ? { approvalRequestId: returned.id } : {},
        });
        return readRequest(transaction, agencyId, requestId);
      },
    );
  }
}
