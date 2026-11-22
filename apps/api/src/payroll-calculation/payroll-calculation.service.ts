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
  CalculatedLoanDeduction,
  CalculatedTax,
  CalculationContext,
  EmployeePayrollSources,
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
import { PAYROLL_INPUT_WITHDRAWN } from '../payroll-inputs/payroll-inputs.service';
import { RULE_VERSION_LOADED_AFTER_SNAPSHOT } from '../payroll-periods/payroll-rule-snapshots';
import {
  CLOTHING_ALLOWANCE_COMPONENT_CODE,
  ClothingAllowanceCalculator,
} from './clothing-allowance.calculator';
import { WithholdingTaxCalculator } from './withholding-tax.calculator';
import { AuthorizedDeductionsCalculator } from './authorized-deductions.calculator';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import type { AgencyPayrollSources } from './payroll-sources.reader';
import { adjustmentDifference, type PreviousLine } from './payroll-adjustment-difference';

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
  carries_adjustments: boolean;
}

/** The calculators of one run type: those before the withholding tax, and it and those after. */
interface CalculatorSet {
  beforeTax: readonly PayrollCalculator[];
  taxAndAfter: readonly PayrollCalculator[];
}

/** An OPEN Payroll Adjustment the version's snapshot names, and its original FINALIZED period. */
interface CarriedAdjustment {
  id: string;
  employeeId: string;
  original: {
    id: string;
    runType: string;
    periodFrom: string;
    periodTo: string;
    paymentDate: string;
    calculationVersion: number;
    componentCodes: string[];
  };
}

/** What one Employee's calculators decided. */
interface CalculatedOutcome {
  lines: CalculatedLine[];
  exceptions: CalculatedException[];
  contributions: CalculatedContribution[];
  tax?: CalculatedTax;
  loanDeductions: CalculatedLoanDeduction[];
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
 *
 * An Employee under an active Payroll Hold on the period gets no result. The
 * version carries each OPEN Payroll Adjustment its snapshot names (#356,
 * ADR 0016): the Employee's result for the original period is recalculated
 * from the snapshot's rules for its dates and the sources its lines rest on,
 * and the difference from what was paid becomes Payroll Lines linked to the
 * adjustment, written before the withholding tax so it taxes them with the
 * period's other pay. An Employee with no service in the period but a carried
 * adjustment gets a result of the adjustment lines and their withholding tax.
 */
@Injectable()
export class PayrollCalculationService {
  /** A regular period runs these. */
  private readonly calculators: CalculatorSet;
  /** A special period runs these; each pays only the named components it covers. */
  private readonly specialCalculators: CalculatorSet;
  /** The withholding tax alone, for a result that holds only adjustment lines. */
  private readonly withholdingTax: PayrollCalculator;

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
    @Inject(WithholdingTaxCalculator) withholdingTax: WithholdingTaxCalculator,
  ) {
    // Contributions read the earnings before them, and the withholding tax
    // reads every line, so they stay last, in a special period too. PERA
    // reads basic salary and the days without pay.
    this.calculators = {
      beforeTax: [
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
      ],
      taxAndAfter: [
        withholdingTax,
        // Deduction Obligations come after every tax and contribution (#634).
        new AuthorizedDeductionsCalculator(),
      ],
    };
    this.specialCalculators = {
      beforeTax: [yearEndBonus, clothingAllowance],
      taxAndAfter: [withholdingTax],
    };
    this.withholdingTax = withholdingTax;
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
        (componentCodes.size === 0 && !period.carries_adjustments) ||
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
            payrollAdjustmentId: true,
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
    const scope = {
      agencyPayrollApplicabilityIds: snapshot.items.flatMap(
        (item) => item.agencyPayrollApplicabilityId ?? [],
      ),
      authorizedPayrollComponentInputIds: snapshot.items.flatMap(
        (item) => item.authorizedPayrollComponentInputId ?? [],
      ),
    };
    const sources = await this.sources.readInTransaction(
      transaction,
      job.agencyId,
      snapshot.cutoffAt,
      {
        ...scope,
        runType: period.run_type,
        periodFrom: context.periodFrom,
        periodTo: context.periodTo,
        paymentDate: period.payment_date,
      },
    );
    const carried = await carriedAdjustmentsInTransaction(
      transaction,
      job.agencyId,
      snapshot.items.flatMap((item) => item.payrollAdjustmentId ?? []),
    );
    // Each original period's sources, read once for all of its Employees.
    const originalSources = new Map<string, Promise<AgencyPayrollSources>>();
    const sourcesOf = (original: CarriedAdjustment['original']) => {
      let read = originalSources.get(original.id);
      if (!read) {
        read = this.sources.readInTransaction(transaction, job.agencyId, snapshot.cutoffAt, {
          ...scope,
          runType: original.runType,
          periodFrom: original.periodFrom,
          periodTo: original.periodTo,
          paymentDate: original.paymentDate,
          original: {
            payrollPeriodId: original.id,
            calculationVersion: original.calculationVersion,
          },
        });
        originalSources.set(original.id, read);
      }
      return read;
    };
    const held = new Set(
      (
        await transaction.payrollHold.findMany({
          where: { agencyId: job.agencyId, payrollPeriodId: job.payrollPeriodId, liftedAt: null },
          select: { employeeId: true },
        })
      ).map((hold) => hold.employeeId),
    );

    const employees = await transaction.employee.findMany({
      where: { agencyId: job.agencyId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    let results = 0;
    let blockingExceptions = 0;
    for (const { id: employeeId } of employees) {
      // A held Employee is left out of the period, with no result (§7).
      if (held.has(employeeId)) continue;
      const basis = await this.compensationBasis.resolveInTransaction(
        transaction,
        job.agencyId,
        employeeId,
        context.periodFrom,
        context.periodTo,
      );
      const adjustments = carried.filter((adjustment) => adjustment.employeeId === employeeId);
      // A supplemental payroll that names no component pays only adjustments.
      const inService =
        (period.run_type === 'REGULAR' || componentCodes.size > 0) &&
        basis.stretches.some((stretch) => stretch.personnel !== null);
      // An Employee with no Service Segment on any date of the period, and no
      // adjustment to carry, is not in scope.
      if (!inService && adjustments.length === 0) continue;

      const differences: CalculatedLine[] = [];
      const adjustmentExceptions: CalculatedException[] = [];
      for (const adjustment of adjustments) {
        const difference = await this.adjustmentDifferenceInTransaction(
          transaction,
          job.agencyId,
          context,
          adjustment,
          await sourcesOf(adjustment.original),
        );
        differences.push(...difference.lines);
        adjustmentExceptions.push(...difference.exceptions);
      }
      // A special period carries only positive differences, so an Employee it
      // pays nothing else gets no result, and the adjustment stays OPEN for the
      // next regular period.
      if (!inService && period.run_type === 'SPECIAL' && differences.length === 0) continue;

      const employeeSources = sources.forEmployee(employeeId);
      const valuationBases = await this.sources.valuationBasesInTransaction(
        transaction,
        job.agencyId,
        employeeId,
        { from: context.periodFrom, to: context.periodTo },
        employeeSources,
      );
      const own = runCalculators(
        inService ? calculators.beforeTax : [],
        inService ? calculators.taxAndAfter : [this.withholdingTax],
        basis,
        context,
        { ...employeeSources, valuationBases },
        differences,
      );
      const exceptions = [...adjustmentExceptions, ...own.exceptions];
      const calculated = own.lines;
      const blocked = exceptions.filter((exception) => exception.severity === 'BLOCKING');
      // A blocked result has zero totals and no line (payroll-schema.md §7).
      const lines = blocked.length > 0 ? [] : calculated;
      const contributions = blocked.length > 0 ? [] : own.contributions;
      const tax = blocked.length > 0 ? undefined : own.tax;
      const loanDeductions = blocked.length > 0 ? [] : own.loanDeductions;
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
            tax,
            // Absent when empty, so a result with no obligation keeps its hash.
            ...(loanDeductions.length > 0 ? { loanDeductions } : {}),
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
            payrollAdjustmentId: line.payrollAdjustmentId ?? null,
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
      if (tax) {
        const { yearToDateSnapshot, yearEndAdjustment, ...figures } = tax;
        await transaction.taxLine.create({
          data: {
            agencyId: job.agencyId,
            payrollEmployeeId: result.id,
            ...figures,
            yearToDateSnapshot: toJson(yearToDateSnapshot),
            ...(yearEndAdjustment ? { yearEndAdjustment: toJson(yearEndAdjustment) } : {}),
          },
        });
      }
      await transaction.loanDeductionLine.createMany({
        data: loanDeductions.map((loanDeduction) => ({
          agencyId: job.agencyId,
          payrollEmployeeId: result.id,
          ...loanDeduction,
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
    // A rule version loaded (#624), or a source withdrew an input it uses
    // (#649), while this version was queued: either marked it.
    blockingExceptions += await transaction.payrollException.count({
      where: {
        ...job,
        exceptionType: { in: [RULE_VERSION_LOADED_AFTER_SNAPSHOT, PAYROLL_INPUT_WITHDRAWN] },
      },
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

  /**
   * One carried adjustment's difference lines (ADR 0016): the Employee's
   * result for the original period, recalculated by the calculators before
   * the withholding tax from the snapshot's rules for the original dates and
   * the sources its lines rest on, less the original result's lines and every
   * posted adjustment's for the same Employee and period. A recalculation
   * that blocks names the adjustment and writes no line.
   */
  private async adjustmentDifferenceInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    carrying: CalculationContext,
    adjustment: CarriedAdjustment,
    sources: AgencyPayrollSources,
  ): Promise<{ lines: CalculatedLine[]; exceptions: CalculatedException[] }> {
    const { original } = adjustment;
    const named = {
      payrollAdjustmentId: adjustment.id,
      originalPayrollPeriodId: original.id,
      periodFrom: original.periodFrom,
      periodTo: original.periodTo,
    };
    const context: CalculationContext = {
      ...carrying,
      periodFrom: original.periodFrom,
      periodTo: original.periodTo,
      componentCodes: new Set(original.componentCodes),
    };
    const basis = await this.compensationBasis.resolveInTransaction(
      transaction,
      agencyId,
      adjustment.employeeId,
      original.periodFrom,
      original.periodTo,
    );
    const employeeSources = sources.forEmployee(adjustment.employeeId);
    const valuationBases = await this.sources.valuationBasesInTransaction(
      transaction,
      agencyId,
      adjustment.employeeId,
      { from: original.periodFrom, to: original.periodTo },
      employeeSources,
    );
    // An Employee with no service in the original dates is owed nothing for them.
    const recalculated = basis.stretches.some((stretch) => stretch.personnel !== null)
      ? runCalculators(
          (original.runType === 'SPECIAL' ? this.specialCalculators : this.calculators).beforeTax,
          [],
          basis,
          context,
          { ...employeeSources, valuationBases },
          [],
        )
      : { lines: [], exceptions: [] };
    const exceptions = recalculated.exceptions.map((exception) => ({
      ...exception,
      details: { ...exception.details, ...named },
    }));
    if (exceptions.some((exception) => exception.severity === 'BLOCKING')) {
      return { lines: [], exceptions };
    }
    const previous = await previousLinesInTransaction(transaction, agencyId, adjustment);
    const difference = adjustmentDifference(named, recalculated.lines, previous);
    return { lines: difference.lines, exceptions: [...exceptions, ...difference.exceptions] };
  }
}

/**
 * Run the calculators before the withholding tax, add the adjustment
 * difference lines, then run the tax and the calculators after it, so the
 * contributions never read a difference and the tax reads every line.
 */
function runCalculators(
  beforeTax: readonly PayrollCalculator[],
  taxAndAfter: readonly PayrollCalculator[],
  basis: CompensationBasis,
  context: CalculationContext,
  sources: EmployeePayrollSources,
  differences: readonly CalculatedLine[],
): CalculatedOutcome {
  const outcome: CalculatedOutcome = {
    lines: [],
    exceptions: [],
    contributions: [],
    loanDeductions: [],
  };
  const run = (calculator: PayrollCalculator) => {
    const calculated = calculator.calculate(basis, context, outcome.lines, sources);
    outcome.lines.push(...calculated.lines);
    outcome.exceptions.push(...calculated.exceptions);
    outcome.contributions.push(...(calculated.contributions ?? []));
    outcome.loanDeductions.push(...(calculated.loanDeductions ?? []));
    if (calculated.tax) {
      if (outcome.tax) throw new Error('A result has at most one Tax Line.');
      outcome.tax = calculated.tax;
    }
  };
  beforeTax.forEach(run);
  outcome.lines.push(...differences);
  taxAndAfter.forEach(run);
  return outcome;
}

/** The snapshot's adjustments that are still OPEN, with their original FINALIZED period. */
async function carriedAdjustmentsInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  payrollAdjustmentIds: string[],
): Promise<CarriedAdjustment[]> {
  if (payrollAdjustmentIds.length === 0) return [];
  const rows = await transaction.$queryRaw<
    {
      id: string;
      employee_id: string;
      original_id: string;
      run_type: string;
      period_from: string;
      period_to: string;
      payment_date: string;
      calculation_version: number;
      component_codes: string[];
    }[]
  >`
    SELECT a."id"::text, a."employee_id"::text, p."id"::text AS "original_id", p."run_type",
           p."period_from"::text AS "period_from", p."period_to"::text AS "period_to",
           p."payment_date"::text AS "payment_date", p."calculation_version",
           ARRAY(
             SELECT c."code"::text
             FROM "payroll_period_components" pc
             JOIN "pay_components" c ON c."id" = pc."pay_component_id"
             WHERE pc."agency_id" = p."agency_id" AND pc."payroll_period_id" = p."id"
             ORDER BY c."code"
           ) AS "component_codes"
    FROM "payroll_adjustments" a
    JOIN "payroll_periods" p
      ON p."agency_id" = a."agency_id" AND p."id" = a."original_payroll_period_id"
    WHERE a."agency_id" = CAST(${agencyId} AS uuid)
      AND a."id" = ANY(CAST(${payrollAdjustmentIds} AS uuid[]))
      AND a."status" = 'OPEN'
      AND p."status" = 'FINALIZED'
    ORDER BY p."period_from", p."id", a."employee_id"
  `;
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    original: {
      id: row.original_id,
      runType: row.run_type,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      paymentDate: row.payment_date,
      calculationVersion: row.calculation_version,
      componentCodes: row.component_codes,
    },
  }));
}

/**
 * What the original period already paid the Employee: its final version's
 * own lines, and the lines of every POSTED adjustment for the same Employee
 * and period in the finalized result that carried it.
 */
async function previousLinesInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  adjustment: CarriedAdjustment,
): Promise<PreviousLine[]> {
  const rows = await transaction.$queryRaw<
    { code: string; line_type: string; amount: Prisma.Decimal; source_snapshot: unknown }[]
  >`
    SELECT c."code"::text, l."line_type", l."amount", l."source_snapshot"
    FROM "payroll_lines" l
    JOIN "payroll_employees" e
      ON e."agency_id" = l."agency_id" AND e."id" = l."payroll_employee_id"
    JOIN "pay_components" c ON c."id" = l."pay_component_id"
    WHERE l."agency_id" = CAST(${agencyId} AS uuid)
      AND e."employee_id" = CAST(${adjustment.employeeId} AS uuid)
      AND (
        (e."payroll_period_id" = CAST(${adjustment.original.id} AS uuid)
         AND e."calculation_version" = ${adjustment.original.calculationVersion}
         AND l."payroll_adjustment_id" IS NULL)
        OR (e."status" = 'FINALIZED' AND l."payroll_adjustment_id" IN (
          SELECT a."id" FROM "payroll_adjustments" a
          WHERE a."agency_id" = l."agency_id"
            AND a."original_payroll_period_id" = CAST(${adjustment.original.id} AS uuid)
            AND a."employee_id" = e."employee_id"
            AND a."status" = 'POSTED'
        ))
      )
    ORDER BY l."created_at", l."id"
  `;
  return rows.map((row) => ({
    componentCode: row.code,
    lineType: row.line_type as PreviousLine['lineType'],
    amount: new Prisma.Decimal(row.amount).toFixed(4),
    source: (row.source_snapshot ?? {}) as Record<string, unknown>,
  }));
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
           "payment_date"::text AS "payment_date", "carries_adjustments"
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
