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
  assertDraftValid,
  lockAuthority,
  readAuthority,
} from './overtime-authority.records';

/**
 * Submit a DRAFT for review. Its unit and covered Employees are checked again,
 * since service or structure may have changed since the draft was saved.
 */
@Injectable()
export class SubmitOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
  ) {}

  async execute(context: RequestContext, authorityId: string): Promise<OvertimeAuthoritySummary> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const current = await lockAuthority(transaction, context.agencyId, authorityId);
      await assertCommandAccess(
        transaction,
        context,
        'overtime.authorities.submit',
        current.employees.map((row) => row.employeeId),
      );
      assertDraft(current);
      await assertDraftValid(transaction, context.agencyId, current);
      await transaction.overtimeAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
        data: { status: 'SUBMITTED' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'OVERTIME_AUTHORITY_SUBMITTED',
        entityType: 'OvertimeAuthority',
        entityId: authorityId,
        previousStatus: 'DRAFT',
        newStatus: 'SUBMITTED',
        requestId: context.requestId,
        metadata: { authorityNo: current.authorityNo },
      });
      return readAuthority(transaction, context.agencyId, authorityId);
    });
  }
}
