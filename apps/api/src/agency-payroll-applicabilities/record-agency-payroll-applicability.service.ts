import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  ApplicabilityServiceError,
  assertManagePermission,
  dateOf,
  parseOrRefuse,
  readApplicability,
  type ApplicabilitySummary,
} from './agency-payroll-applicabilities.records';
import {
  gaaFiscalYearEnd,
  recordApplicabilitySchema,
  type RecordApplicability,
} from './agency-payroll-applicabilities.schemas';

/**
 * Record that a conditional component applies, from its effective date, to the
 * whole Agency or to one named Employee. It needs the Agency's finalized
 * authority and a funding reference, and may not overlap another record for
 * the same component and scope target.
 */
@Injectable()
export class RecordAgencyPayrollApplicabilityService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async execute(
    context: RequestContext,
    submission: RecordApplicability,
  ): Promise<ApplicabilitySummary> {
    assertManagePermission(context);
    const input = parseOrRefuse(recordApplicabilitySchema, submission);

    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        const component = await transaction.payComponent.findUnique({
          where: { id: input.payComponentId },
          select: { code: true, isConditional: true, isGaaRevalidated: true },
        });
        if (!component) {
          throw new ApplicabilityServiceError(
            'The pay component is not in the national catalogue.',
            422,
            'APPLICABILITY_COMPONENT_NOT_FOUND',
          );
        }
        if (!component.isConditional) {
          throw new ApplicabilityServiceError(
            `The ${component.code} pay component is unconditional: its National Payroll Rule Version applies by its effectivity with no Agency record.`,
            422,
            'APPLICABILITY_COMPONENT_UNCONDITIONAL',
          );
        }
        const fiscalYearEnd = gaaFiscalYearEnd(input.effectiveFrom);
        if (
          component.isGaaRevalidated &&
          (input.effectiveTo === null || input.effectiveTo > fiscalYearEnd)
        ) {
          throw new ApplicabilityServiceError(
            `The ${component.code} pay component is revalidated against each year's GAA, so its record ends no later than ${fiscalYearEnd}. Renew it with a new record.`,
            422,
            'APPLICABILITY_GAA_PERIOD_INVALID',
          );
        }

        if (input.employeeId) {
          const employee = await transaction.employee.findFirst({
            where: { agencyId: context.agencyId, id: input.employeeId },
            select: { id: true },
          });
          if (!employee) {
            throw new ApplicabilityServiceError(
              'The Employee is not in this Agency.',
              422,
              'APPLICABILITY_EMPLOYEE_NOT_FOUND',
            );
          }
        }

        const authority = await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.authorityDocumentVersionId,
        );
        if (!authority) {
          throw new ApplicabilityServiceError(
            'The authority must be a finalized Document Version of this Agency.',
            422,
            'APPLICABILITY_AUTHORITY_INVALID',
          );
        }

        const created = await transaction.agencyPayrollApplicability.create({
          data: {
            agencyId: context.agencyId,
            payComponentId: input.payComponentId,
            scope: input.scope,
            employeeId: input.employeeId,
            authorityDocumentVersionId: authority.id,
            fundingReference: input.fundingReference,
            effectiveFrom: dateOf(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? dateOf(input.effectiveTo) : null,
            recordedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        await transaction.auditEvent.create({
          data: {
            agencyId: context.agencyId,
            actorUserId: context.userId,
            actorMembershipId: context.membershipId,
            actorType: 'USER',
            action: 'AGENCY_PAYROLL_APPLICABILITY_RECORDED',
            entityType: 'AgencyPayrollApplicability',
            entityId: created.id,
            requestId: context.requestId,
            metadata: { ...input, componentCode: component.code },
          },
        });
        return readApplicability(transaction, context.agencyId, created.id);
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('agency_payroll_applicabilities_no_overlap')
      ) {
        throw new ApplicabilityServiceError(
          'Another record for this component and scope already covers part of this period.',
          409,
          'APPLICABILITY_OVERLAP',
        );
      }
      throw error;
    }
  }
}
