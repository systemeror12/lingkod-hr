import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  ApplicabilityServiceError,
  assertManagePermission,
  dateOf,
  parseOrRefuse,
  readApplicability,
  type ApplicabilitySummary,
} from './agency-payroll-applicabilities.records';
import {
  endApplicabilitySchema,
  type EndApplicability,
} from './agency-payroll-applicabilities.schemas';

/**
 * End a record by bringing its `effectiveTo` forward. Nothing else about it
 * changes, and it never runs longer than it did.
 */
@Injectable()
export class EndAgencyPayrollApplicabilityService {
  async execute(
    context: RequestContext,
    applicabilityId: string,
    submission: EndApplicability,
  ): Promise<ApplicabilitySummary> {
    assertManagePermission(context);
    const input = parseOrRefuse(endApplicabilitySchema, submission);

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const locked = await transaction.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "agency_payroll_applicabilities" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "id" = CAST(${applicabilityId} AS uuid) FOR UPDATE`,
      );
      if (locked.length !== 1) {
        throw new ApplicabilityServiceError(
          'The Agency Payroll Applicability could not be found.',
          404,
          'APPLICABILITY_NOT_FOUND',
        );
      }
      const current = await readApplicability(transaction, context.agencyId, applicabilityId);
      if (input.effectiveTo < current.effectiveFrom) {
        throw new ApplicabilityServiceError(
          `A record cannot end before it takes effect on ${current.effectiveFrom}.`,
          422,
          'APPLICABILITY_END_INVALID',
        );
      }
      if (current.effectiveTo !== null && input.effectiveTo >= current.effectiveTo) {
        throw new ApplicabilityServiceError(
          `A record is ended only by bringing its end forward from ${current.effectiveTo}.`,
          422,
          'APPLICABILITY_END_INVALID',
        );
      }

      await transaction.agencyPayrollApplicability.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: applicabilityId } },
        data: { effectiveTo: dateOf(input.effectiveTo) },
      });
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'AGENCY_PAYROLL_APPLICABILITY_ENDED',
          entityType: 'AgencyPayrollApplicability',
          entityId: applicabilityId,
          requestId: context.requestId,
          reason: input.reason,
          metadata: { previousEffectiveTo: current.effectiveTo, effectiveTo: input.effectiveTo },
        },
      });
      return readApplicability(transaction, context.agencyId, applicabilityId);
    });
  }
}
