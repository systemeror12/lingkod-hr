import { Injectable } from '@nestjs/common';
import type { ContributionSummary, Prisma, RemittanceSchedule } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { randomUUID } from 'node:crypto';
import { requestDatabaseContext } from '../database-context';
import {
  CONTRIBUTION_REMITTANCE_CONTRACT,
  CONTRIBUTION_TYPES,
  planContributionRemittance,
  type ContributionRemittancePeriod,
  type ContributionType,
} from './contribution-remittance-contract';

export const CONTRIBUTION_REMITTANCE_GENERATED = 'CONTRIBUTION_REMITTANCE_GENERATED';

const PERMISSION = 'payroll.registers.generate';

export class ContributionRemittancesServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ContributionRemittancesServiceError';
  }
}

export interface RemittanceScheduleView {
  id: string;
  contributionType: string;
  lineCount: number;
  employeeShareTotal: string;
  employerShareTotal: string;
  totalAmount: string;
  /** The exact artifact bytes, as canonical JSON. */
  content: string;
  /** SHA-256 hex of `content`. */
  checksum: string;
}

export interface ContributionRemittanceView {
  /** The Contribution Summary's id. */
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  contract: { code: string; version: number };
  generatedAt: string;
  generatedByMembershipId: string;
  /** The summary's exact bytes, as canonical JSON. */
  content: string;
  /** SHA-256 hex of `content`. */
  checksum: string;
  /** One per contribution type, in the summary's order. */
  schedules: RemittanceScheduleView[];
}

/**
 * Generates and reads the Contribution Summary and Remittance Schedules of a
 * FINALIZED payroll (PAY-009, #354): Structured Exports for review that file
 * and remit nothing (PAY-010). Both need `payroll.registers.generate` held
 * Agency-wide. Generating claims no payroll function (hris-controls.md §5.20).
 */
@Injectable()
export class ContributionRemittancesService {
  /**
   * Generate the period's summary and its four schedules in one transaction,
   * with one Audit Event, or return the ones already generated unchanged and
   * write nothing.
   */
  async generate(context: RequestContext, periodId: string): Promise<ContributionRemittanceView> {
    requirePermission(context, 'Generating contribution remittance schedules');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await lockFinalizedPeriod(transaction, context, periodId);
      const stored = await transaction.contributionSummary.findUnique({
        where: { payrollPeriodId: periodId },
      });
      if (stored) return toView(stored, await readSchedules(transaction, stored));

      const id = randomUUID();
      const generatedAt = new Date();
      const plan = planContributionRemittance({
        agencyId: context.agencyId,
        summaryId: id,
        scheduleIds: Object.fromEntries(
          CONTRIBUTION_TYPES.map((type) => [type, randomUUID()]),
        ) as Record<ContributionType, string>,
        generatedAt: generatedAt.toISOString(),
        period,
        lines: await readContributionLines(transaction, context, period),
      });
      const contract = await transaction.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: CONTRIBUTION_REMITTANCE_CONTRACT },
        select: { id: true },
      });
      const created = await transaction.contributionSummary.create({
        data: {
          id,
          agencyId: context.agencyId,
          payrollPeriodId: periodId,
          calculationVersion: period.calculationVersion,
          payrollExportContractVersionId: contract.id,
          generatedByMembershipId: context.membershipId,
          generatedAt,
          content: plan.content,
          checksum: plan.checksum,
        },
      });
      await transaction.remittanceSchedule.createMany({
        data: plan.schedules.map((schedule) => ({
          ...schedule,
          agencyId: context.agencyId,
          contributionSummaryId: id,
        })),
      });
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          entityType: 'ContributionSummary',
          entityId: id,
          action: CONTRIBUTION_REMITTANCE_GENERATED,
          newStatus: 'GENERATED',
          requestId: context.requestId,
          metadata: {
            payrollPeriodId: periodId,
            calculationVersion: period.calculationVersion,
            contract: CONTRIBUTION_REMITTANCE_CONTRACT,
            checksum: plan.checksum,
            schedules: plan.schedules.map((schedule) => ({
              id: schedule.id,
              contributionType: schedule.contributionType,
              checksum: schedule.checksum,
              lineCount: schedule.lineCount,
              employeeShareTotal: schedule.employeeShareTotal,
              employerShareTotal: schedule.employerShareTotal,
              totalAmount: schedule.totalAmount,
            })),
          },
          // One summary per period: generating again returns it.
          idempotencyKey: 'generated',
        },
      });
      return toView(created, await readSchedules(transaction, created));
    });
  }

  /** Read a stored summary and its schedules. */
  async read(
    context: RequestContext,
    periodId: string,
    summaryId: string,
  ): Promise<ContributionRemittanceView> {
    requirePermission(context, 'Reading contribution remittance schedules');
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await transaction.contributionSummary.findFirst({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, id: summaryId },
      });
      if (!stored) {
        throw new ContributionRemittancesServiceError(
          'The Contribution Summary could not be found.',
          404,
          'CONTRIBUTION_SUMMARY_NOT_FOUND',
        );
      }
      return toView(stored, await readSchedules(transaction, stored));
    });
  }
}

function requirePermission(context: RequestContext, command: string): void {
  if (!holdsAgencyWide(context, PERMISSION)) {
    throw new ContributionRemittancesServiceError(
      `${command} needs the ${PERMISSION} permission for the whole Agency.`,
      403,
      'CONTRIBUTION_REMITTANCE_FORBIDDEN',
    );
  }
}

/** The period, locked until the command commits, so concurrent generations serialize. */
async function lockFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<ContributionRemittancePeriod> {
  const [row] = await transaction.$queryRaw<
    {
      code: string;
      run_type: string;
      period_from: string;
      period_to: string;
      payment_date: string;
      status: string;
      calculation_version: number;
      finalized_at: Date | null;
    }[]
  >`
    SELECT "code"::text, "run_type", "period_from"::text, "period_to"::text,
           "payment_date"::text, "status", "calculation_version", "finalized_at"
    FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
      AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  if (!row) {
    throw new ContributionRemittancesServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  if (row.status !== 'FINALIZED' || !row.finalized_at) {
    throw new ContributionRemittancesServiceError(
      `The Payroll Period is ${row.status}; only a FINALIZED payroll produces contribution remittance schedules.`,
      409,
      'CONTRIBUTION_REMITTANCE_PAYROLL_NOT_FINALIZED',
    );
  }
  return {
    id: periodId,
    code: row.code,
    runType: row.run_type,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    paymentDate: row.payment_date,
    calculationVersion: row.calculation_version,
    finalizedAt: row.finalized_at.toISOString(),
  };
}

/** Every Contribution Line of the FINALIZED results of the finalized version. */
async function readContributionLines(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  period: ContributionRemittancePeriod,
) {
  const rows = await transaction.$queryRaw<
    {
      contribution_line_id: string;
      payroll_employee_id: string;
      employee_number: string;
      legal_name: string;
      contribution_type: string;
      compensation_base: string;
      employee_share: string;
      employer_share: string;
      rule_version_id: string;
      rule_version_code: string;
    }[]
  >`
    SELECT c."id"::text AS "contribution_line_id", r."id"::text AS "payroll_employee_id",
           e."employee_number"::text, e."legal_name"::text, c."contribution_type",
           c."compensation_base"::text, c."employee_share"::text, c."employer_share"::text,
           v."id"::text AS "rule_version_id", v."code"::text AS "rule_version_code"
    FROM "payroll_employees" r
    JOIN "employees" e ON e."agency_id" = r."agency_id" AND e."id" = r."employee_id"
    JOIN "contribution_lines" c
      ON c."agency_id" = r."agency_id" AND c."payroll_employee_id" = r."id"
    JOIN "national_payroll_rule_versions" v ON v."id" = c."rule_version_id"
    WHERE r."agency_id" = CAST(${context.agencyId} AS uuid)
      AND r."payroll_period_id" = CAST(${period.id} AS uuid)
      AND r."calculation_version" = ${period.calculationVersion}
      AND r."status" = 'FINALIZED'
  `;
  return rows.map((row) => ({
    contributionLineId: row.contribution_line_id,
    payrollEmployeeId: row.payroll_employee_id,
    agencyEmployeeNumber: row.employee_number,
    employeeName: row.legal_name,
    contributionType: row.contribution_type,
    compensationBase: row.compensation_base,
    employeeShare: row.employee_share,
    employerShare: row.employer_share,
    ruleVersionId: row.rule_version_id,
    ruleVersionCode: row.rule_version_code,
  }));
}

async function readSchedules(
  transaction: Prisma.TransactionClient,
  summary: ContributionSummary,
): Promise<RemittanceSchedule[]> {
  const rows = await transaction.remittanceSchedule.findMany({
    where: { agencyId: summary.agencyId, contributionSummaryId: summary.id },
  });
  const order = (row: RemittanceSchedule) =>
    (CONTRIBUTION_TYPES as readonly string[]).indexOf(row.contributionType);
  return rows.sort((left, right) => order(left) - order(right));
}

function toView(
  summary: ContributionSummary,
  schedules: RemittanceSchedule[],
): ContributionRemittanceView {
  return {
    id: summary.id,
    payrollPeriodId: summary.payrollPeriodId,
    calculationVersion: summary.calculationVersion,
    contract: CONTRIBUTION_REMITTANCE_CONTRACT,
    generatedAt: summary.generatedAt.toISOString(),
    generatedByMembershipId: summary.generatedByMembershipId,
    content: summary.content,
    checksum: summary.checksum,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      contributionType: schedule.contributionType,
      lineCount: schedule.lineCount,
      employeeShareTotal: schedule.employeeShareTotal.toFixed(4),
      employerShareTotal: schedule.employerShareTotal.toFixed(4),
      totalAmount: schedule.totalAmount.toFixed(4),
      content: schedule.content,
      checksum: schedule.checksum,
    })),
  };
}
