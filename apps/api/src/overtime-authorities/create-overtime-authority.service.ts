import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  type OvertimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import type {
  OvertimeAuthorityDraftInput,
  OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import {
  assertCommandAccess,
  assertDraftValid,
  auditDraft,
  authorityNoConflict,
  draftData,
  isAuthorityNoConflict,
  readAuthority,
} from './overtime-authority.records';

/** Create a DRAFT Overtime Authority with its covered Employees. */
@Injectable()
export class CreateOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
  ) {}

  async execute(
    context: RequestContext,
    draft: OvertimeAuthorityDraftInput,
  ): Promise<OvertimeAuthoritySummary> {
    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        await assertCommandAccess(
          transaction,
          context,
          'overtime.authorities.create',
          draft.employees.map((row) => row.employeeId),
        );
        await assertDraftValid(transaction, context.agencyId, draft);
        const authority = await transaction.overtimeAuthority.create({
          data: { agencyId: context.agencyId, status: 'DRAFT', ...draftData(draft) },
          select: { id: true },
        });
        await transaction.overtimeAuthorityEmployee.createMany({
          data: draft.employees.map((row) => ({
            agencyId: context.agencyId,
            overtimeAuthorityId: authority.id,
            employeeId: row.employeeId,
            authorizedHours: row.authorizedHours,
            taskDescription: row.taskDescription ?? null,
          })),
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'OVERTIME_AUTHORITY_CREATED',
          entityType: 'OvertimeAuthority',
          entityId: authority.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: auditDraft(draft),
        });
        return readAuthority(transaction, context.agencyId, authority.id);
      });
    } catch (error: unknown) {
      if (isAuthorityNoConflict(error)) throw authorityNoConflict();
      throw error;
    }
  }
}
