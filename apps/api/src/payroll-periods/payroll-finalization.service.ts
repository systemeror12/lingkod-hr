import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  claimFunction,
  lockPeriod,
  refuseOpenBlockingExceptions,
  requirePermission,
  requireStatus,
} from './payroll-certification.service';
import {
  auditEvent,
  parse,
  PayrollPeriodsServiceError,
  readCalculationHash,
  stale,
  summarySelect,
  toSummary,
  type PayrollPeriodSummary,
} from './payroll-periods.service';
import { payrollPeriodFinalizeSchema } from './payroll-periods.schemas';

/** The Audit Event action and the Outbox Event type of a finalization. */
export const PAYROLL_PERIOD_FINALIZED = 'PAYROLL_PERIOD_FINALIZED';

/**
 * The `PAYROLL_PERIOD_FINALIZED` Outbox Event's payload, one per period. Work
 * that must follow the commit, such as generating Payslips (#336), reads it
 * and then the period's FINALIZED results at `calculationVersion`.
 */
export interface PayrollPeriodFinalizedEvent {
  payrollPeriodId: string;
  calculationVersion: number;
  calculationHash: string;
  payrollCertificationId: string;
  finalizedAt: string;
}

/**
 * Finalize payroll (`APPROVED → FINALIZED`, hris-controls.md §5.20,
 * payroll-schema.md §11, #335) in one transaction. It locks the period and
 * refuses unless the period is APPROVED at the row version the approver read,
 * the version has no open blocking exception, its results still hash to the
 * certification in force, and every result's totals equal its line sums. It
 * then claims APPROVAL, marks the period and the version's results FINALIZED,
 * consumes the Payroll Inputs and Attendance Payroll Facts the version's lines
 * rest on, and appends the Audit Event and the Outbox Event. A source that is
 * no longer unconsumed refuses the whole transaction, so a refusal leaves the
 * period APPROVED with nothing finalized.
 *
 * A retry by the person who finalized, at the row version they sent, returns
 * the finalized period and writes nothing. Anyone else then finds the period
 * no longer APPROVED, so of two concurrent finalizations one is refused.
 */
@Injectable()
export class PayrollFinalizationService {
  async finalize(
    context: RequestContext,
    periodId: string,
    rawInput: unknown,
  ): Promise<PayrollPeriodSummary> {
    requirePermission(context, 'payroll.periods.finalize', 'Finalizing a Payroll Period');
    const input = parse(payrollPeriodFinalizeSchema, rawInput);
    return withDatabaseContext(
      requestDatabaseContext(context, 'payroll-transition'),
      async (transaction) => {
        const period = await lockPeriod(transaction, context, periodId);
        if (
          period.status === 'FINALIZED' &&
          period.rowVersion === input.rowVersion + 1 &&
          (await finalizedBy(transaction, context, periodId)) === context.membershipId
        ) {
          return readSummary(transaction, context, periodId);
        }
        requireStatus(period, 'APPROVED');
        if (period.rowVersion !== input.rowVersion) throw stale();
        const { calculationVersion } = period;
        await refuseOpenBlockingExceptions(
          transaction,
          context,
          periodId,
          calculationVersion,
          'Return the period before finalization',
        );
        const certification = await transaction.payrollCertification.findFirst({
          where: { agencyId: context.agencyId, payrollPeriodId: periodId, revokedAt: null },
          select: { id: true, calculationVersion: true, calculationHash: true },
        });
        if (!certification || certification.calculationVersion !== calculationVersion) {
          throw new Error(
            'An APPROVED Payroll Period has no certification of its current version.',
          );
        }
        const calculationHash = await readCalculationHash(
          transaction,
          context,
          periodId,
          calculationVersion,
        );
        if (calculationHash !== certification.calculationHash) {
          throw new PayrollPeriodsServiceError(
            'The calculation hash no longer matches the certified and approved results; nothing was finalized.',
            409,
            'PAYROLL_CALCULATION_HASH_CHANGED',
          );
        }
        await refuseUnreconciledTotals(transaction, context, periodId, calculationVersion);
        await claimFunction(transaction, context, periodId, 'APPROVAL');

        const finalizedAt = new Date();
        const row = await transaction.payrollPeriod.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
          data: { status: 'FINALIZED', finalizedAt, rowVersion: period.rowVersion + 1 },
          select: summarySelect,
        });
        const results = await transaction.payrollEmployee.updateMany({
          where: { agencyId: context.agencyId, payrollPeriodId: periodId, calculationVersion },
          data: { status: 'FINALIZED' },
        });
        const consumed = await consumeSources(transaction, context, periodId, calculationVersion);

        await transaction.auditEvent.create({
          data: {
            ...auditEvent(context, {
              action: PAYROLL_PERIOD_FINALIZED,
              entityId: periodId,
              previousStatus: 'APPROVED',
              newStatus: 'FINALIZED',
              reason: null,
              metadata: {
                payrollCertificationId: certification.id,
                calculationVersion,
                calculationHash,
                finalizedResultCount: results.count,
                consumedPayrollInputIds: consumed.payrollInputIds,
                consumedAttendancePayrollFactIds: consumed.attendancePayrollFactIds,
              },
            }),
            // One finalization per period: a second one is refused.
            idempotencyKey: 'finalized',
          },
        });
        const event: PayrollPeriodFinalizedEvent = {
          payrollPeriodId: periodId,
          calculationVersion,
          calculationHash,
          payrollCertificationId: certification.id,
          finalizedAt: finalizedAt.toISOString(),
        };
        await transaction.outboxEvent.create({
          data: {
            agencyId: context.agencyId,
            eventType: PAYROLL_PERIOD_FINALIZED,
            aggregateType: 'PayrollPeriod',
            aggregateId: periodId,
            idempotencyKey: `payroll-period-finalized:${periodId}`,
            payload: { ...event },
          },
        });
        return toSummary(row);
      },
    );
  }
}

async function finalizedBy(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<string | null> {
  const event = await transaction.auditEvent.findFirst({
    where: { agencyId: context.agencyId, entityId: periodId, action: PAYROLL_PERIOD_FINALIZED },
    select: { actorMembershipId: true },
  });
  return event?.actorMembershipId ?? null;
}

async function readSummary(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<PayrollPeriodSummary> {
  return toSummary(
    await transaction.payrollPeriod.findUniqueOrThrow({
      where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
      select: summarySelect,
    }),
  );
}

/**
 * Refuse while any result of the version has totals other than its line
 * sums: gross is the EARNING lines, deductions the DEDUCTION lines, and net
 * their difference, as the calculation stores them.
 */
async function refuseUnreconciledTotals(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  calculationVersion: number,
): Promise<void> {
  const unreconciled = await transaction.$queryRaw<{ employee_id: string }[]>`
    SELECT e."employee_id"::text
    FROM "payroll_employees" e
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(l."amount") FILTER (WHERE l."line_type" = 'EARNING'), 0) AS "gross",
             COALESCE(sum(l."amount") FILTER (WHERE l."line_type" = 'DEDUCTION'), 0) AS "deductions"
      FROM "payroll_lines" l
      WHERE l."agency_id" = e."agency_id" AND l."payroll_employee_id" = e."id"
    ) sums
    WHERE e."agency_id" = CAST(${context.agencyId} AS uuid)
      AND e."payroll_period_id" = CAST(${periodId} AS uuid)
      AND e."calculation_version" = ${calculationVersion}
      AND (e."gross_amount" <> sums."gross"
           OR e."total_deductions" <> sums."deductions"
           OR e."net_amount" <> sums."gross" - sums."deductions")
    ORDER BY e."employee_id"
  `;
  if (unreconciled.length > 0) {
    throw new PayrollPeriodsServiceError(
      `The totals of ${unreconciled.length} Payroll Employee ${
        unreconciled.length === 1 ? 'Result do' : 'Results do'
      } not equal their line sums; nothing was finalized.`,
      409,
      'PAYROLL_TOTALS_UNRECONCILED',
    );
  }
}

/**
 * Consume every Payroll Input and Attendance Payroll Fact a line of the
 * version rests on (ADR 0014). Each must still be unconsumed: an input that
 * is no longer PENDING, or a fact another payroll consumed first, refuses the
 * finalization. Both writes wait for a concurrent finalization of another
 * period, then find the source taken.
 */
async function consumeSources(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
  calculationVersion: number,
) {
  const sources = await transaction.$queryRaw<
    { payroll_input_id: string | null; attendance_payroll_fact_id: string | null }[]
  >`
    SELECT DISTINCT s."payroll_input_id"::text, s."attendance_payroll_fact_id"::text
    FROM "payroll_line_sources" s
    JOIN "payroll_lines" l ON l."agency_id" = s."agency_id" AND l."id" = s."payroll_line_id"
    JOIN "payroll_employees" e
      ON e."agency_id" = l."agency_id" AND e."id" = l."payroll_employee_id"
    WHERE e."agency_id" = CAST(${context.agencyId} AS uuid)
      AND e."payroll_period_id" = CAST(${periodId} AS uuid)
      AND e."calculation_version" = ${calculationVersion}
  `;
  const payrollInputIds = distinct(sources.map((source) => source.payroll_input_id));
  const attendancePayrollFactIds = distinct(
    sources.map((source) => source.attendance_payroll_fact_id),
  );

  const inputs = await transaction.payrollInput.updateMany({
    where: { agencyId: context.agencyId, id: { in: payrollInputIds }, status: 'PENDING' },
    data: { status: 'CONSUMED', consumedByPayrollPeriodId: periodId },
  });
  if (inputs.count !== payrollInputIds.length) {
    throw sourceTaken(
      `${payrollInputIds.length - inputs.count} of its Payroll Inputs ${
        payrollInputIds.length - inputs.count === 1 ? 'is' : 'are'
      } no longer pending`,
    );
  }
  // The live UNIQUE index skips a fact another payroll consumed.
  const facts = await transaction.payrollConsumedAttendanceFact.createMany({
    data: attendancePayrollFactIds.map((attendancePayrollFactId) => ({
      agencyId: context.agencyId,
      attendancePayrollFactId,
      payrollPeriodId: periodId,
    })),
    skipDuplicates: true,
  });
  if (facts.count !== attendancePayrollFactIds.length) {
    throw sourceTaken(
      `${attendancePayrollFactIds.length - facts.count} of its Attendance Payroll Facts ${
        attendancePayrollFactIds.length - facts.count === 1 ? 'was' : 'were'
      } consumed by another payroll`,
    );
  }
  return { payrollInputIds, attendancePayrollFactIds };
}

const distinct = (ids: (string | null)[]) =>
  [...new Set(ids.filter((id): id is string => id !== null))].sort();

function sourceTaken(cause: string): PayrollPeriodsServiceError {
  return new PayrollPeriodsServiceError(
    `The approved version cannot be finalized: ${cause}. Return the period before finalization and recalculate it; nothing was finalized.`,
    409,
    'PAYROLL_SOURCE_CONSUMED',
  );
}
