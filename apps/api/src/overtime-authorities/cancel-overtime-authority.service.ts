import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import type { OvertimeAuthoritySummary } from './overtime-authorities.types';
import {
  assertCommandAccess,
  assertDraft,
  lockAuthority,
  readAuthority,
} from './overtime-authority.records';

/**
 * Cancel a DRAFT that was never submitted, or an APPROVED authority before
 * service. Only the Approving Official cancels an approved one (hris-controls
 * §5.16), so that also needs `overtime.authorities.approve`. Refusing it once
 * an Overtime Service Record exists is #320's.
 */
@Injectable()
export class CancelOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
  ) {}

  async execute(context: RequestContext, authorityId: string): Promise<OvertimeAuthoritySummary> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const current = await lockAuthority(transaction, context.agencyId, authorityId);
      const employeeIds = current.employees.map((row) => row.employeeId);
      await assertCommandAccess(transaction, context, 'overtime.authorities.cancel', employeeIds);
      if (current.status === 'APPROVED') {
        await assertCommandAccess(
          transaction,
          context,
          'overtime.authorities.approve',
          employeeIds,
        );
      } else {
        assertDraft(current);
      }
      await transaction.overtimeAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
        data: { status: 'CANCELLED' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'OVERTIME_AUTHORITY_CANCELLED',
        entityType: 'OvertimeAuthority',
        entityId: authorityId,
        previousStatus: current.status,
        newStatus: 'CANCELLED',
        requestId: context.requestId,
        metadata: { authorityNo: current.authorityNo },
      });
      return readAuthority(transaction, context.agencyId, authorityId);
    });
  }
}
