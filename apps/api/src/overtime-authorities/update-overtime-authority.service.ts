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
  assertDraft,
  assertDraftValid,
  auditDraft,
  authorityNoConflict,
  draftData,
  isAuthorityNoConflict,
  lockAuthority,
  readAuthority,
} from './overtime-authority.records';

/**
 * Replace a DRAFT's details and covered Employees. A kept Employee keeps its
 * coverage row; a dropped one is removed. The caller's scope must reach both
 * the current and the new covered Employees.
 */
@Injectable()
export class UpdateOvertimeAuthorityService {
  constructor(
    @Inject(OVERTIME_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: OvertimeAuthorityAuditWriter,
  ) {}

  async execute(
    context: RequestContext,
    authorityId: string,
    draft: OvertimeAuthorityDraftInput,
  ): Promise<OvertimeAuthoritySummary> {
    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        const current = await lockAuthority(transaction, context.agencyId, authorityId);
        const employeeIds = draft.employees.map((row) => row.employeeId);
        await assertCommandAccess(transaction, context, 'overtime.authorities.create', [
          ...current.employees.map((row) => row.employeeId),
          ...employeeIds,
        ]);
        assertDraft(current);
        await assertDraftValid(transaction, context.agencyId, draft);
        await transaction.overtimeAuthority.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
          data: draftData(draft),
        });
        await transaction.overtimeAuthorityEmployee.deleteMany({
          where: {
            agencyId: context.agencyId,
            overtimeAuthorityId: authorityId,
            employeeId: { notIn: employeeIds },
          },
        });
        for (const row of draft.employees) {
          const values = {
            authorizedHours: row.authorizedHours,
            taskDescription: row.taskDescription ?? null,
          };
          await transaction.overtimeAuthorityEmployee.upsert({
            where: {
              overtimeAuthorityId_employeeId: {
                overtimeAuthorityId: authorityId,
                employeeId: row.employeeId,
              },
            },
            create: {
              agencyId: context.agencyId,
              overtimeAuthorityId: authorityId,
              employeeId: row.employeeId,
              ...values,
            },
            update: values,
          });
        }
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'OVERTIME_AUTHORITY_UPDATED',
          entityType: 'OvertimeAuthority',
          entityId: authorityId,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: auditDraft(draft),
        });
        return readAuthority(transaction, context.agencyId, authorityId);
      });
    } catch (error: unknown) {
      if (isAuthorityNoConflict(error)) throw authorityNoConflict();
      throw error;
    }
  }
}
