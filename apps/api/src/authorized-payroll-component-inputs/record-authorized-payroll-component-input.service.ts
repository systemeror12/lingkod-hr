import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE } from '../payroll-calculation/night-shift-differential.calculator';
import { nightShiftDifferentialParameters } from '../payroll-rule-versions/national-payroll-rule-versions';
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
 * A night-shift differential input is the agency head's rate: a share of the
 * hourly basic rate, such as `0.10` for 10%, applied to every night hour while
 * it is in effect. It may not exceed the ceiling of RA No. 11701, sec. 1 in
 * any National Payroll Rule Version in effect during its effective period, and
 * with no such version loaded it cannot be checked, so it is refused.
 */
async function assertNightShiftDifferentialRate(
  transaction: Prisma.TransactionClient,
  input: {
    valueKind: string;
    value: string;
    paymentSchedule: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  },
): Promise<void> {
  if (input.valueKind !== 'RATE' || input.paymentSchedule !== 'EACH_REGULAR_PERIOD') {
    throw new AuthorizedInputServiceError(
      'A night-shift differential is a RATE paid in EACH_REGULAR_PERIOD: a share of the hourly basic rate, such as 0.10 for 10%.',
      422,
      'AUTHORIZED_INPUT_NIGHT_SHIFT_RATE_INVALID',
    );
  }
  const versions = await transaction.nationalPayrollRuleVersion.findMany({
    where: {
      ruleKind: 'NIGHT_SHIFT_DIFFERENTIAL',
      ...(input.effectiveTo ? { effectiveFrom: { lte: toDate(input.effectiveTo) } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(input.effectiveFrom) } }],
    },
    orderBy: { effectiveFrom: 'asc' },
    select: { code: true, parameters: true },
  });
  if (versions.length === 0) {
    throw new AuthorizedInputServiceError(
      'No NIGHT_SHIFT_DIFFERENTIAL National Payroll Rule Version is in effect during the input, so its rate cannot be checked against the RA No. 11701 ceiling.',
      409,
      'AUTHORIZED_INPUT_CEILING_RULE_MISSING',
    );
  }
  for (const version of versions) {
    const { rateCeiling } = nightShiftDifferentialParameters.parse(version.parameters);
    if (new Prisma.Decimal(input.value).greaterThan(rateCeiling)) {
      throw new AuthorizedInputServiceError(
        `The rate ${input.value} exceeds the ${rateCeiling} of the hourly basic rate that RA No. 11701, sec. 1 allows (${version.code}).`,
        422,
        'AUTHORIZED_INPUT_ABOVE_CEILING',
      );
    }
  }
}

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
      if (component.code.toUpperCase() === NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE) {
        await assertNightShiftDifferentialRate(transaction, input);
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
