import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  AuthorizedInputServiceError,
  REIMBURSABLE_RATA_COMPONENT_CODE,
  assertAdjustPermission,
  readAuthorizedInput,
  type AuthorizedInputSummary,
} from './authorized-payroll-component-inputs.records';
import {
  recordAuthorizedInputSchema,
  type RecordAuthorizedInput,
} from './authorized-payroll-component-inputs.schemas';

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Record an Authorized Payroll Component Input as `RECORDED`. It takes effect
 * only once someone other than its recorder approves it.
 */
@Injectable()
export class RecordAuthorizedPayrollComponentInputService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async execute(
    context: RequestContext,
    submission: RecordAuthorizedInput,
  ): Promise<AuthorizedInputSummary> {
    assertAdjustPermission(context);
    const parsed = recordAuthorizedInputSchema.safeParse(submission);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AuthorizedInputServiceError(
        `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
        422,
        'AUTHORIZED_INPUT_INVALID',
      );
    }
    const input = parsed.data;

    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const component = await transaction.payComponent.findUnique({
        where: { id: input.payComponentId },
        select: { code: true, acceptsAuthorizedInput: true },
      });
      if (!component) {
        throw new AuthorizedInputServiceError(
          'The pay component is not in the national catalogue.',
          422,
          'AUTHORIZED_INPUT_COMPONENT_NOT_FOUND',
        );
      }
      if (!component.acceptsAuthorizedInput) {
        throw new AuthorizedInputServiceError(
          `The ${component.code} pay component does not accept an Authorized Payroll Component Input.`,
          422,
          'AUTHORIZED_INPUT_COMPONENT_NOT_ACCEPTED',
        );
      }
      if (component.code.toUpperCase() === REIMBURSABLE_RATA_COMPONENT_CODE) {
        // Fail closed: an amount cannot be shown within a ceiling no rule carries.
        throw new AuthorizedInputServiceError(
          'No National Payroll Rule Version carries the RATA ceiling, so a reimbursable RATA amount cannot be checked against it.',
          409,
          'AUTHORIZED_INPUT_CEILING_RULE_MISSING',
        );
      }

      if (input.employeeId) {
        const employee = await transaction.employee.findFirst({
          where: { agencyId: context.agencyId, id: input.employeeId },
          select: { id: true },
        });
        if (!employee) {
          throw new AuthorizedInputServiceError(
            'The Employee is not in this Agency.',
            422,
            'AUTHORIZED_INPUT_EMPLOYEE_NOT_FOUND',
          );
        }
      }

      const authority = await this.documents.resolveFinalizedVersionInTransaction(
        transaction,
        context,
        input.authorityDocumentVersionId,
      );
      if (!authority) {
        throw new AuthorizedInputServiceError(
          'The authority must be a finalized Document Version of this Agency.',
          422,
          'AUTHORIZED_INPUT_AUTHORITY_INVALID',
        );
      }

      const created = await transaction.authorizedPayrollComponentInput.create({
        data: {
          agencyId: context.agencyId,
          payComponentId: input.payComponentId,
          scope: input.scope,
          employeeId: input.employeeId,
          valueKind: input.valueKind,
          value: input.value,
          paymentSchedule: input.paymentSchedule,
          authorityDocumentVersionId: authority.id,
          sourceReference: input.sourceReference,
          effectiveFrom: toDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          status: 'RECORDED',
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
          action: 'AUTHORIZED_PAYROLL_COMPONENT_INPUT_RECORDED',
          entityType: 'AuthorizedPayrollComponentInput',
          entityId: created.id,
          previousStatus: 'None',
          newStatus: 'RECORDED',
          requestId: context.requestId,
          metadata: { ...input, componentCode: component.code },
        },
      });
      return readAuthorizedInput(transaction, context.agencyId, created.id);
    });
  }
}
