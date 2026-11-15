import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { z } from 'zod';
import { requestDatabaseContext } from '../database-context';
import { claimPayrollFunction } from '../payroll-periods/payroll-period-actors';
import { PayrollPeriodsServiceError } from '../payroll-periods/payroll-periods.service';
import {
  PAYROLL_EXCEPTION_SEVERITIES,
  PAYROLL_EXCEPTION_STATUSES,
  payrollExceptionDecisionSchema,
  payrollExceptionListQuerySchema,
  type PayrollExceptionSeverity,
  type PayrollExceptionStatus,
} from './payroll-exceptions.schemas';

export interface PayrollExceptionSummary {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  employeeId: string | null;
  exceptionType: string;
  severity: PayrollExceptionSeverity;
  status: PayrollExceptionStatus;
  details: Prisma.JsonValue;
  reason: string | null;
  resolvedByMembershipId: string | null;
}

export interface PayrollExceptionList {
  calculationVersion: number;
  exceptions: PayrollExceptionSummary[];
}

type Decision = 'ACKNOWLEDGED' | 'RESOLVED';

const summarySelect = {
  id: true,
  payrollPeriodId: true,
  calculationVersion: true,
  employeeId: true,
  exceptionType: true,
  severity: true,
  status: true,
  details: true,
  reason: true,
  resolvedByMembershipId: true,
} satisfies Prisma.PayrollExceptionSelect;

type ExceptionRow = Prisma.PayrollExceptionGetPayload<{ select: typeof summarySelect }>;

/**
 * The Payroll Exceptions of a period (hris-controls.md §5.20): the list, and
 * the Payroll Preparer's two decisions on one exception of the current
 * calculation version, each with a reason, the actor, and an Audit Event.
 *
 * - Acknowledge accepts a warning while the period is `DRAFT` or `FOR_REVIEW`.
 *   A blocking exception is never acknowledged or waived (#328).
 * - Resolve records that the cause was fixed, while the period is `DRAFT`. It
 *   lifts nothing: the next calculation checks the cause again.
 *
 * A database trigger enforces the same rules (migration 0167).
 */
@Injectable()
export class PayrollExceptionsService {
  /** A period's exceptions, blocking first, then open before decided. */
  async list(
    context: RequestContext,
    periodId: string,
    rawQuery: unknown,
  ): Promise<PayrollExceptionList> {
    if (!holdsAgencyWide(context, 'payroll.periods.read')) {
      throw new PayrollPeriodsServiceError(
        'Reading Payroll Exceptions needs the payroll.periods.read permission for the whole Agency.',
        403,
        'PAYROLL_PERIOD_READ_FORBIDDEN',
      );
    }
    const query = parse(payrollExceptionListQuerySchema, rawQuery);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
        select: { calculationVersion: true },
      });
      if (!period) throw periodNotFound();
      const calculationVersion = query.calculationVersion ?? period.calculationVersion;
      const rows = await transaction.payrollException.findMany({
        where: {
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion,
          ...(query.severity ? { severity: query.severity } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ exceptionType: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
        select: summarySelect,
      });
      const rank = (row: (typeof rows)[number]) =>
        PAYROLL_EXCEPTION_SEVERITIES.indexOf(row.severity as PayrollExceptionSeverity) * 10 +
        PAYROLL_EXCEPTION_STATUSES.indexOf(row.status as PayrollExceptionStatus);
      // A stable sort keeps the type and Employee order within each rank.
      const exceptions = rows.sort((a, b) => rank(a) - rank(b)).map(toSummary);
      return { calculationVersion, exceptions };
    });
  }

  acknowledge(context: RequestContext, periodId: string, exceptionId: string, rawInput: unknown) {
    return this.decide(context, periodId, exceptionId, rawInput, 'ACKNOWLEDGED');
  }

  resolve(context: RequestContext, periodId: string, exceptionId: string, rawInput: unknown) {
    return this.decide(context, periodId, exceptionId, rawInput, 'RESOLVED');
  }

  private async decide(
    context: RequestContext,
    periodId: string,
    exceptionId: string,
    rawInput: unknown,
    decision: Decision,
  ): Promise<PayrollExceptionSummary> {
    if (!holdsAgencyWide(context, 'payroll.periods.calculate')) {
      throw new PayrollPeriodsServiceError(
        'Acknowledging or resolving a Payroll Exception needs the payroll.periods.calculate permission for the whole Agency.',
        403,
        'PAYROLL_EXCEPTION_DECIDE_FORBIDDEN',
      );
    }
    const { reason } = parse(payrollExceptionDecisionSchema, rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      // FOR SHARE: a concurrent start of calculation waits for this decision.
      const [period] = await transaction.$queryRaw<
        { status: string; calculation_version: number }[]
      >`
        SELECT "status", "calculation_version" FROM "payroll_periods"
        WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
          AND "id" = CAST(${periodId} AS uuid)
        FOR SHARE
      `;
      if (!period) throw periodNotFound();
      const exception = await transaction.payrollException.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: exceptionId } },
        select: summarySelect,
      });
      if (!exception || exception.payrollPeriodId !== periodId) {
        throw new PayrollPeriodsServiceError(
          'The Payroll Exception could not be found.',
          404,
          'PAYROLL_EXCEPTION_NOT_FOUND',
        );
      }
      refuseDecision(decision, exception, period);

      const claim = await claimPayrollFunction(transaction, {
        agencyId: context.agencyId,
        payrollPeriodId: periodId,
        membershipId: context.membershipId,
        payrollFunction: 'PREPARATION',
      });
      if (claim.outcome === 'REFUSED') {
        throw new PayrollPeriodsServiceError(
          `You act in ${claim.heldFunction} on this Payroll Period, so you cannot also prepare it.`,
          409,
          'PAYROLL_FUNCTION_CONFLICT',
        );
      }

      const { count } = await transaction.payrollException.updateMany({
        where: { agencyId: context.agencyId, id: exceptionId, status: 'OPEN' },
        data: { status: decision, reason, resolvedByMembershipId: context.membershipId },
      });
      if (count !== 1) throw alreadyDecided();
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: `PAYROLL_EXCEPTION_${decision}`,
          entityType: 'PayrollException',
          entityId: exceptionId,
          previousStatus: 'OPEN',
          newStatus: decision,
          reason,
          requestId: context.requestId,
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: exception.calculationVersion,
            employeeId: exception.employeeId,
            exceptionType: exception.exceptionType,
            severity: exception.severity,
          },
        },
      });
      return toSummary({
        ...exception,
        status: decision,
        reason,
        resolvedByMembershipId: context.membershipId,
      });
    });
  }
}

/** The rules of migration 0167's trigger, refused with a code the client can show. */
function refuseDecision(
  decision: Decision,
  exception: { status: string; severity: string; calculationVersion: number },
  period: { status: string; calculation_version: number },
): void {
  if (exception.calculationVersion !== period.calculation_version) {
    throw new PayrollPeriodsServiceError(
      `The exception belongs to calculation version ${exception.calculationVersion}; the period is at version ${period.calculation_version}. Decide the current version's exceptions.`,
      409,
      'PAYROLL_EXCEPTION_SUPERSEDED',
    );
  }
  if (exception.status !== 'OPEN') throw alreadyDecided();
  if (decision === 'ACKNOWLEDGED') {
    if (exception.severity !== 'WARNING') {
      throw new PayrollPeriodsServiceError(
        'A blocking exception cannot be acknowledged or waived. Fix its cause and calculate again, or hold the Employee out of the period.',
        409,
        'PAYROLL_EXCEPTION_BLOCKING',
      );
    }
    if (period.status !== 'DRAFT' && period.status !== 'FOR_REVIEW') {
      throw new PayrollPeriodsServiceError(
        `The Payroll Period is ${period.status}; a warning is acknowledged only while it is DRAFT or FOR_REVIEW.`,
        409,
        'PAYROLL_PERIOD_NOT_IN_PREPARATION',
      );
    }
  } else if (period.status !== 'DRAFT') {
    throw new PayrollPeriodsServiceError(
      `The Payroll Period is ${period.status}; an exception is resolved only while it is DRAFT, before the next calculation checks it again.`,
      409,
      'PAYROLL_PERIOD_NOT_DRAFT',
    );
  }
}

function alreadyDecided(): PayrollPeriodsServiceError {
  return new PayrollPeriodsServiceError(
    'The Payroll Exception was already acknowledged or resolved.',
    409,
    'PAYROLL_EXCEPTION_DECIDED',
  );
}

function periodNotFound(): PayrollPeriodsServiceError {
  return new PayrollPeriodsServiceError(
    'The Payroll Period could not be found.',
    404,
    'PAYROLL_PERIOD_NOT_FOUND',
  );
}

function parse<Schema extends z.ZodType>(schema: Schema, rawInput: unknown): z.output<Schema> {
  const parsed = schema.safeParse(rawInput ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new PayrollPeriodsServiceError(
    `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
    400,
    'INVALID_INPUT',
  );
}

function toSummary(row: ExceptionRow): PayrollExceptionSummary {
  return {
    ...row,
    severity: row.severity as PayrollExceptionSeverity,
    status: row.status as PayrollExceptionStatus,
  };
}
