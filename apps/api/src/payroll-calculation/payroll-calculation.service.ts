import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma, setDatabaseContext } from '@lingkod-hr/database';
import { log } from '@lingkod-hr/observability';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import {
  isoDateOf,
  type NationalPayrollRuleKind,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import { calculationHash } from './calculation-hash';
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
  PagIbigContributionCalculator,
  PhilHealthContributionCalculator,
} from './contribution.calculators';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { LeaveMonetizationCalculator } from './leave-monetization.calculator';
import { NightShiftDifferentialCalculator } from './night-shift-differential.calculator';
import { PeraCalculator } from './pera.calculator';
import type {
  CalculatedContribution,
  CalculatedException,
  CalculatedLine,
  CalculationContext,
  PayrollCalculator,
} from './payroll-calculator';
import { runPayrollChecks } from './payroll-checks';
import { PayrollSourcesReader } from './payroll-sources.reader';
import {
  CASH_GIFT_COMPONENT_CODE,
  YEAR_END_BONUS_COMPONENT_CODE,
  YearEndBonusCalculator,
} from './year-end-bonus.calculator';
import { CommutableRataCalculator } from './commutable-rata.calculator';
import { OvertimePayCalculator } from './overtime-pay.calculator';
import { RULE_VERSION_LOADED_AFTER_SNAPSHOT } from '../payroll-periods/payroll-rule-snapshots';
import {
  CLOTHING_ALLOWANCE_COMPONENT_CODE,
  ClothingAllowanceCalculator,
} from './clothing-allowance.calculator';

/** The components a special Payroll Period can name: each has a calculator here (ADR 0015). */
export const SPECIAL_PERIOD_COMPONENT_CODES: readonly string[] = [
  YEAR_END_BONUS_COMPONENT_CODE,
  CASH_GIFT_COMPONENT_CODE,
  CLOTHING_ALLOWANCE_COMPONENT_CODE,
];

/** One queued calculation: a CALCULATING period and the version it started. */
export interface CalculationJob {
  agencyId: string;
  payrollPeriodId: string;
  calculationVersion: number;
}

export type CalculationOutcome =
  | { outcome: 'FOR_REVIEW'; results: number }
  | { outcome: 'RETURNED'; results: number; blockingExceptions: number }
  | { outcome: 'FAILED'; reason: string }
  | { outcome: 'SKIPPED' };

/** A calculation runs in one transaction, so it may outlast Prisma's 5-second default. */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 10 * 60_000 };

interface LockedPeriod {
  status: string;
  calculation_version: number;
  run_type: string;
  period_from: string;
  period_to: string;
  payment_date: string;
}

/**
 * The calculation job of one Payroll Period version (hris-controls.md §5.20).
 * It resolves each Employee's compensation basis, runs every calculator of the
 * period's run type (a special period pays only the components it names), and
 * writes the Payroll Employee Results, their Payroll Lines, and the Payroll
 * Exceptions, then runs the checks over what it stored (`runPayrollChecks`),
 * in one transaction with the period's next status: `FOR_REVIEW` on a clean
 * run, `DRAFT` on any blocking exception. A warning alone does not return the
 * period. A failure rolls that back and returns the period to `DRAFT` with
 * the reason.
 *
 * A retry is safe: the run locks the period row and does nothing unless the
 * period is still `CALCULATING` at the job's version, so a second or
 * concurrent run of a finished job writes nothing, and a run that died
 * mid-way left nothing to repeat.
 */
@Injectable()
export class PayrollCalculationService {
  /** A regular period runs these. */
  private readonly calculators: readonly PayrollCalculator[];
  /** A special period runs these; each pays only the named components it covers. */
  private readonly specialCalculators: readonly PayrollCalculator[];

  constructor(
    @Inject(CompensationBasisService) private readonly compensationBasis: CompensationBasisService,
    @Inject(BasicSalaryCalculator) basicSalary: BasicSalaryCalculator,
    @Inject(PayrollSourcesReader) private readonly sources: PayrollSourcesReader,
    @Inject(DaysWithoutPayCalculator) daysWithoutPay: DaysWithoutPayCalculator,
    @Inject(GsisContributionCalculator) gsis: GsisContributionCalculator,
    @Inject(EmployeesCompensationCalculator) employeesCompensation: EmployeesCompensationCalculator,
    @Inject(YearEndBonusCalculator) yearEndBonus: YearEndBonusCalculator,
    @Inject(PeraCalculator) pera: PeraCalculator,
    @Inject(CommutableRataCalculator) commutableRata: CommutableRataCalculator,
    @Inject(OvertimePayCalculator) overtimePay: OvertimePayCalculator,
    @Inject(ClothingAllowanceCalculator) clothingAllowance: ClothingAllowanceCalculator,
    @Inject(PhilHealthContributionCalculator) philHealth: PhilHealthContributionCalculator,
    @Inject(PagIbigContributionCalculator) pagIbig: PagIbigContributionCalculator,
  ) {
    // Contributions read the earnings before them, so they stay last. PERA
    // reads basic salary and the days without pay.
    this.calculators = [
      basicSalary,
      daysWithoutPay,
      pera,
      commutableRata,
      overtimePay,
      // These need no collaborator, so they are no constructor parameter.
      new LeaveMonetizationCalculator(),
      new NightShiftDifferentialCalculator(),
      gsis,
      employeesCompensation,
      philHealth,
      pagIbig,
    ];
    this.specialCalculators = [yearEndBonus, clothingAllowance];
  }

  async run(job: CalculationJob): Promise<CalculationOutcome> {
    try {
      return await inAgencyTransaction(job.agencyId, (transaction) =>
        this.calculateInTransaction(transaction, job),
      );
    } catch (error: unknown) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      log('error', 'api.payroll_calculation_failed', { ...job, error: reason });
      return inAgencyTransaction(job.agencyId, (transaction) =>
        returnOnFailure(transaction, job, reason),
      );
    }
  }

  /** The calculation in the caller's transaction; a test aborts one to stand in for a crash. */
  async calculateInTransaction(
    transaction: Prisma.TransactionClient,
    job: CalculationJob,
  ): Promise<CalculationOutcome> {
    const period = await lockCalculatingPeriod(transaction, job, 'SKIP LOCKED');
    if (!period) return { outcome: 'SKIPPED' };
    const componentIds = new Map(
      (await transaction.payComponent.findMany({ select: { id: true, code: true } })).map(
        (component) => [component.code, component.id],
      ),
    );
    const componentCodes = new Set<string>();
    if (period.run_type === 'SPECIAL') {
      const named = new Set(
        (
          await transaction.payrollPeriodComponent.findMany({
            where: { agencyId: job.agencyId, payrollPeriodId: job.payrollPeriodId },
            select: { payComponentId: true },
          })
        ).map((component) => component.payComponentId),
      );
      for (const [code, id] of componentIds) if (named.has(id)) componentCodes.add(code);
      if (
        componentCodes.size === 0 ||
        [...componentCodes].some((code) => !SPECIAL_PERIOD_COMPONENT_CODES.includes(code))
      ) {
        // Start refuses such a period; reaching this means the row was written around it.
        throw new Error('The special Payroll Period names a component with no calculator.');
      }
    }

    const snapshot = await transaction.payrollRuleSnapshot.findUnique({
      where: {
        payrollPeriodId_calculationVersion: {
          payrollPeriodId: job.payrollPeriodId,
          calculationVersion: job.calculationVersion,
        },
      },
      select: {
        cutoffAt: true,
        items: {
          select: {
            nationalPayrollRuleVersionId: true,
            agencyPayrollApplicabilityId: true,
            authorizedPayrollComponentInputId: true,
          },
        },
      },
    });
    if (!snapshot) throw new Error('The calculation version has no rule snapshot.');
    const snapshotRuleVersionIds = new Set(
      snapshot.items.flatMap((item) => item.nationalPayrollRuleVersionId ?? []),
    );
    const frozen = await transaction.nationalPayrollRuleVersion.findMany({
      where: { id: { in: [...snapshotRuleVersionIds] } },
      orderBy: { effectiveFrom: 'asc' },
      select: {
        id: true,
        code: true,
        ruleKind: true,
        effectiveFrom: true,
        effectiveTo: true,
        parameters: true,
        supersededBy: { select: { id: true, effectiveFrom: true } },
      },
    });
    const context: CalculationContext = {
      periodFrom: period.period_from,
      periodTo: period.period_to,
      snapshotRuleVersionIds,
      // A successor loaded after the snapshot froze does not end its predecessor here.
      snapshotRuleVersions: frozen.map((version) => ({
        id: version.id,
        code: version.code,
        ruleKind: version.ruleKind as NationalPayrollRuleKind,
        effectiveFrom: isoDateOf(version.effectiveFrom),
        effectiveTo: version.effectiveTo ? isoDateOf(version.effectiveTo) : null,
        successorEffectiveFrom:
          version.supersededBy && snapshotRuleVersionIds.has(version.supersededBy.id)
            ? isoDateOf(version.supersededBy.effectiveFrom)
            : null,
        parameters: version.parameters,
      })),
      componentCodes,
    };
    const calculators = period.run_type === 'SPECIAL' ? this.specialCalculators : this.calculators;

    // The snapshot's cutoff fixes the input set, so a recalculation takes the same sources.
    const sources = await this.sources.readInTransaction(
      transaction,
      job.agencyId,
      snapshot.cutoffAt,
      {
        runType: period.run_type,
        periodFrom: context.periodFrom,
        periodTo: context.periodTo,
        agencyPayrollApplicabilityIds: snapshot.items.flatMap(
          (item) => item.agencyPayrollApplicabilityId ?? [],
        ),
        authorizedPayrollComponentInputIds: snapshot.items.flatMap(
          (item) => item.authorizedPayrollComponentInputId ?? [],
        ),
        paymentDate: period.payment_date,
      },
    );

    const employees = await transaction.employee.findMany({
      where: { agencyId: job.agencyId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    let results = 0;
    let blockingExceptions = 0;
    for (const { id: employeeId } of employees) {
      const basis = await this.compensationBasis.resolveInTransaction(
        transaction,
        job.agencyId,
        employeeId,
        context.periodFrom,
        context.periodTo,
      );
      // An Employee with no Service Segment on any date of the period is not in scope.
      if (basis.stretches.every((stretch) => stretch.personnel === null)) continue;

      const employeeSources = sources.forEmployee(employeeId);
      const valuationBases = await this.sources.valuationBasesInTransaction(
        transaction,
        job.agencyId,
        employeeId,
        { from: context.periodFrom, to: context.periodTo },
        employeeSources,
      );
      const calculated: CalculatedLine[] = [];
      const exceptions: CalculatedException[] = [];
      const calculatedContributions: CalculatedContribution[] = [];
      for (const calculator of calculators) {
        const outcome = calculator.calculate(basis, context, calculated, {
          ...employeeSources,
          valuationBases,
        });
        calculated.push(...outcome.lines);
        exceptions.push(...outcome.exceptions);
        calculatedContributions.push(...(outcome.contributions ?? []));
      }
      const blocked = exceptions.filter((exception) => exception.severity === 'BLOCKING');
      // A blocked result has zero totals and no line (payroll-schema.md §7).
      const lines = blocked.length > 0 ? [] : calculated;
      const contributions = blocked.length > 0 ? [] : calculatedContributions;
      const totals = totalsOf(lines);
      const result = await transaction.payrollEmployee.create({
        data: {
          agencyId: job.agencyId,
          payrollPeriodId: job.payrollPeriodId,
          calculationVersion: job.calculationVersion,
          employeeId,
          compensationBasisSnapshot: toJson(basis),
          status: blocked.length > 0 ? 'EXCEPTION' : 'CALCULATED',
          ...totals,
          calculationHash: calculationHash({
            employeeId,
            periodFrom: context.periodFrom,
            periodTo: context.periodTo,
            compensationBasis: basis,
            lines,
            exceptions,
            contributions,
            totals,
          }),
        },
        select: { id: true },
      });
      const written = lines.map((line) => ({ id: randomUUID(), line }));
      await transaction.payrollLine.createMany({
        data: written.map(({ id, line }) => {
          const payComponentId = componentIds.get(line.componentCode);
          if (!payComponentId) {
            throw new Error(`Pay component ${line.componentCode} is not in the catalogue.`);
          }
          return {
            id,
            agencyId: job.agencyId,
            payrollEmployeeId: result.id,
            payComponentId,
            ruleVersionId: line.ruleVersionId,
            lineType: line.lineType,
            quantity: line.quantity,
            rate: line.rate,
            amount: line.amount,
            sourceSnapshot: toJson(line.source),
          };
        }),
      });
      await transaction.payrollLineSource.createMany({
        data: written.flatMap(({ id, line }) =>
          (line.sourceRecords ?? []).map((record) => ({
            agencyId: job.agencyId,
            payrollLineId: id,
            ...record,
          })),
        ),
      });
      await transaction.contributionLine.createMany({
        data: contributions.map((contribution) => ({
          agencyId: job.agencyId,
          payrollEmployeeId: result.id,
          ...contribution,
        })),
      });
      await transaction.payrollException.createMany({
        data: exceptions.map((exception) => ({
          agencyId: job.agencyId,
          payrollPeriodId: job.payrollPeriodId,
          calculationVersion: job.calculationVersion,
          employeeId,
          exceptionType: exception.exceptionType,
          severity: exception.severity,
          status: 'OPEN',
          details: toJson(exception.details),
        })),
      });
      results += 1;
      blockingExceptions += blocked.length;
    }
    blockingExceptions += (
      await runPayrollChecks(transaction, {
        ...job,
        runType: period.run_type,
        periodFrom: context.periodFrom,
      })
    ).blocking;
    // A rule version loaded while this version was queued marked it (#624).
    blockingExceptions += await transaction.payrollException.count({
      where: { ...job, exceptionType: RULE_VERSION_LOADED_AFTER_SNAPSHOT },
    });

    if (blockingExceptions > 0) {
      const reason = `${blockingExceptions} blocking exception${blockingExceptions === 1 ? '' : 's'} in calculation version ${job.calculationVersion}; correct the source or hold the Employee, then calculate again.`;
      await finish(transaction, job, 'DRAFT', 'PAYROLL_PERIOD_CALCULATION_RETURNED', reason, {
        results,
        blockingExceptions,
      });
      return { outcome: 'RETURNED', results, blockingExceptions };
    }
    await finish(transaction, job, 'FOR_REVIEW', 'PAYROLL_PERIOD_CALCULATION_COMPLETED', null, {
      results,
    });
    return { outcome: 'FOR_REVIEW', results };
  }
}

/** The period row, locked, when it is still CALCULATING at the job's version. */
async function lockCalculatingPeriod(
  transaction: Prisma.TransactionClient,
  job: CalculationJob,
  wait: 'SKIP LOCKED' | 'WAIT',
): Promise<LockedPeriod | null> {
  const lockClause =
    wait === 'SKIP LOCKED' ? Prisma.sql`FOR UPDATE SKIP LOCKED` : Prisma.sql`FOR UPDATE`;
  const [period] = await transaction.$queryRaw<LockedPeriod[]>`
    SELECT "status", "calculation_version", "run_type",
           "period_from"::text AS "period_from", "period_to"::text AS "period_to",
           "payment_date"::text AS "payment_date"
    FROM "payroll_periods"
    WHERE "agency_id" = CAST(${job.agencyId} AS uuid)
      AND "id" = CAST(${job.payrollPeriodId} AS uuid)
    ${lockClause}
  `;
  return period?.status === 'CALCULATING' && period.calculation_version === job.calculationVersion
    ? period
    : null;
}

/** Return on failure (§5.20): the period goes back to DRAFT with the reason, if still running. */
async function returnOnFailure(
  transaction: Prisma.TransactionClient,
  job: CalculationJob,
  reason: string,
): Promise<CalculationOutcome> {
  if (!(await lockCalculatingPeriod(transaction, job, 'WAIT'))) return { outcome: 'SKIPPED' };
  await finish(transaction, job, 'DRAFT', 'PAYROLL_PERIOD_CALCULATION_FAILED', reason, {});
  return { outcome: 'FAILED', reason };
}

async function finish(
  transaction: Prisma.TransactionClient,
  job: CalculationJob,
  status: 'FOR_REVIEW' | 'DRAFT',
  action: string,
  reason: string | null,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  const { count } = await transaction.payrollPeriod.updateMany({
    where: {
      agencyId: job.agencyId,
      id: job.payrollPeriodId,
      status: 'CALCULATING',
      calculationVersion: job.calculationVersion,
    },
    data: { status, rowVersion: { increment: 1 } },
  });
  if (count !== 1) throw new Error('The Payroll Period left CALCULATING during its calculation.');
  await transaction.auditEvent.create({
    data: {
      agencyId: job.agencyId,
      actorType: 'SYSTEM',
      action,
      entityType: 'PayrollPeriod',
      entityId: job.payrollPeriodId,
      previousStatus: 'CALCULATING',
      newStatus: status,
      reason,
      requestId: `payroll-calculation:${job.payrollPeriodId}:${job.calculationVersion}`,
      // One outcome per version: a second one for the same version is refused.
      idempotencyKey: `calculation-version-${job.calculationVersion}`,
      metadata: { calculationVersion: job.calculationVersion, ...metadata },
    },
  });
}

function totalsOf(lines: readonly CalculatedLine[]) {
  const sum = (lineType: CalculatedLine['lineType']) =>
    lines
      .filter((line) => line.lineType === lineType)
      .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
  const gross = sum('EARNING');
  const deductions = sum('DEDUCTION');
  return {
    grossAmount: gross.toFixed(4),
    totalDeductions: deductions.toFixed(4),
    netAmount: gross.sub(deductions).toFixed(4),
  };
}

const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function inAgencyTransaction<T>(
  agencyId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await setDatabaseContext(transaction, { agencyId });
    return work(transaction);
  }, TRANSACTION_OPTIONS);
}
