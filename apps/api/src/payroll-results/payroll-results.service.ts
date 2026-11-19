import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { z } from 'zod';
import { requestDatabaseContext } from '../database-context';
import {
  parse,
  PayrollPeriodsServiceError,
  summarySelect,
  toSummary,
  type PayrollPeriodSummary,
} from '../payroll-periods/payroll-periods.service';

/** The totals of a period's current calculation version, as stored on its results. */
export interface PayrollPeriodTotals {
  resultCount: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

/**
 * A period on the Payroll workspace list. `totals` is null before the first
 * calculation and while one runs, so a running calculation never shows the
 * previous version's totals as its own.
 */
export interface PayrollPeriodListItem extends PayrollPeriodSummary {
  totals: PayrollPeriodTotals | null;
}

export interface PayComponentOption {
  id: string;
  code: string;
  name: string;
}

export interface PayrollPeriodList {
  periods: PayrollPeriodListItem[];
  /** The pay component catalogue, which a special period names components from. */
  payComponents: PayComponentOption[];
}

/** One Payroll Employee Result: the Employee's payslip in one calculation version. */
export interface PayrollResultSummary {
  id: string;
  employeeId: string;
  calculationVersion: number;
  status: string;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

export interface PayrollResultList {
  calculationVersion: number;
  results: PayrollResultSummary[];
}

export type PayrollLineSourceKind =
  'PAYROLL_INPUT' | 'ATTENDANCE_PAYROLL_FACT' | 'AUTHORIZED_PAYROLL_COMPONENT_INPUT';

/** A Payroll Line with its provenance: rule version, source records, and source snapshot. */
export interface PayrollLineView {
  id: string;
  payComponent: PayComponentOption;
  lineType: string;
  quantity: string | null;
  rate: string | null;
  amount: string;
  ruleVersion: { id: string; code: string; name: string } | null;
  sources: { kind: PayrollLineSourceKind; id: string }[];
  sourceSnapshot: Prisma.JsonValue;
}

type RuleVersionRef = { id: string; code: string; name: string };

/** One statutory contribution of a result, with the compensation base it was figured on. */
export interface ContributionLineView {
  id: string;
  contributionType: string;
  employeeShare: string;
  employerShare: string;
  compensationBase: string;
  ruleVersion: RuleVersionRef;
}

/**
 * The withholding tax of a result. `yearToDateSnapshot` is stored as the
 * calculation read it: what the Agency's finalized periods paid in the tax
 * year before this one.
 */
export interface TaxLineView {
  id: string;
  taxableCompensation: string;
  nonTaxableCompensation: string;
  withholdingTax: string;
  ruleVersion: RuleVersionRef;
  yearToDateSnapshot: Prisma.JsonValue;
}

/**
 * What one Deduction Obligation was due in the period, what was deducted, and
 * what the net-take-home floor stopped, in the order the obligations were taken.
 */
export interface LoanDeductionLineView {
  id: string;
  deductionObligationId: string;
  payeeCategory: string;
  payeeName: string;
  issuerReference: string;
  priority: number;
  amountDue: string;
  deductedAmount: string;
  notDeductedAmount: string;
  ruleVersion: RuleVersionRef;
}

export interface PayrollResultDetail extends PayrollResultSummary {
  calculationHash: string;
  lines: PayrollLineView[];
  contributions: ContributionLineView[];
  taxLine: TaxLineView | null;
  loanDeductions: LoanDeductionLineView[];
}

const resultListQuerySchema = z
  .object({ calculationVersion: z.coerce.number().int().positive().optional() })
  .strict();

const resultSelect = {
  id: true,
  employeeId: true,
  calculationVersion: true,
  status: true,
  grossAmount: true,
  totalDeductions: true,
  netAmount: true,
} satisfies Prisma.PayrollEmployeeSelect;

const LINE_TYPE_ORDER = ['EARNING', 'DEDUCTION', 'EMPLOYER_SHARE', 'INFORMATIONAL'];
const CONTRIBUTION_ORDER = ['GSIS', 'EMPLOYEES_COMPENSATION', 'PHILHEALTH', 'PAGIBIG'];

/**
 * The Payroll workspace's reads (#625): periods with the totals of their
 * current calculation version, a version's Payroll Employee Results, and one
 * result's Payroll Lines with their provenance, and its Contribution Lines,
 * Tax Line, and Loan Deduction Lines (#635). Read-only, with
 * `payroll.periods.read` for the whole Agency.
 */
@Injectable()
export class PayrollResultsService {
  /** Every period of the Agency, newest first, with its current totals. */
  async listPeriods(context: RequestContext): Promise<PayrollPeriodList> {
    requireRead(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.payrollPeriod.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ periodFrom: 'desc' }, { code: 'asc' }],
        select: summarySelect,
      });
      const sums = await transaction.payrollEmployee.groupBy({
        by: ['payrollPeriodId', 'calculationVersion'],
        where: { agencyId: context.agencyId },
        _count: { _all: true },
        _sum: { grossAmount: true, totalDeductions: true, netAmount: true },
      });
      const sumOf = new Map(
        sums.map((sum) => [`${sum.payrollPeriodId}:${sum.calculationVersion}`, sum]),
      );
      const payComponents = await transaction.payComponent.findMany({
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      });
      const periods = rows.map((row) => {
        const summary = toSummary(row);
        const calculated = summary.calculationVersion > 0 && summary.status !== 'CALCULATING';
        const sum = sumOf.get(`${summary.id}:${summary.calculationVersion}`);
        const totals: PayrollPeriodTotals | null = calculated
          ? {
              resultCount: sum?._count._all ?? 0,
              grossAmount: amount(sum?._sum.grossAmount),
              totalDeductions: amount(sum?._sum.totalDeductions),
              netAmount: amount(sum?._sum.netAmount),
            }
          : null;
        return { ...summary, totals };
      });
      return { periods, payComponents };
    });
  }

  /** The results of one calculation version, the current one by default. */
  async listResults(
    context: RequestContext,
    periodId: string,
    rawQuery: unknown,
  ): Promise<PayrollResultList> {
    requireRead(context);
    const query = parse(resultListQuerySchema, rawQuery ?? {});
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
        select: { calculationVersion: true },
      });
      if (!period) throw periodNotFound();
      const calculationVersion = query.calculationVersion ?? period.calculationVersion;
      const rows = await transaction.payrollEmployee.findMany({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId, calculationVersion },
        orderBy: { employeeId: 'asc' },
        select: resultSelect,
      });
      return { calculationVersion, results: rows.map(toResult) };
    });
  }

  /** One result with its lines, each with its rule version and source records. */
  async readResult(
    context: RequestContext,
    periodId: string,
    resultId: string,
  ): Promise<PayrollResultDetail> {
    requireRead(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const result = await transaction.payrollEmployee.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: resultId } },
        select: { ...resultSelect, payrollPeriodId: true, calculationHash: true },
      });
      if (!result || result.payrollPeriodId !== periodId) {
        throw new PayrollPeriodsServiceError(
          'The Payroll Employee Result could not be found.',
          404,
          'PAYROLL_RESULT_NOT_FOUND',
        );
      }
      const lines = await transaction.payrollLine.findMany({
        where: { agencyId: context.agencyId, payrollEmployeeId: resultId },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          payComponentId: true,
          ruleVersionId: true,
          lineType: true,
          quantity: true,
          rate: true,
          amount: true,
          sourceSnapshot: true,
        },
      });
      const lineIds = lines.map((line) => line.id);
      const owned = { agencyId: context.agencyId, payrollEmployeeId: resultId };
      const [contributions, taxLine, loanDeductions] = await Promise.all([
        transaction.contributionLine.findMany({ where: owned }),
        transaction.taxLine.findFirst({ where: owned }),
        transaction.loanDeductionLine.findMany({ where: owned, orderBy: { priority: 'asc' } }),
      ]);
      const ruleVersionIds = new Set([
        ...lines.flatMap((line) => line.ruleVersionId ?? []),
        ...contributions.map((line) => line.ruleVersionId),
        ...(taxLine ? [taxLine.ruleVersionId] : []),
        ...loanDeductions.map((line) => line.ruleVersionId),
      ]);
      const [components, ruleVersions, sources, obligations] = await Promise.all([
        transaction.payComponent.findMany({
          where: { id: { in: [...new Set(lines.map((line) => line.payComponentId))] } },
          select: { id: true, code: true, name: true },
        }),
        transaction.nationalPayrollRuleVersion.findMany({
          where: { id: { in: [...ruleVersionIds] } },
          select: { id: true, code: true, name: true },
        }),
        transaction.payrollLineSource.findMany({
          where: { agencyId: context.agencyId, payrollLineId: { in: lineIds } },
          orderBy: { id: 'asc' },
        }),
        transaction.deductionObligation.findMany({
          where: {
            agencyId: context.agencyId,
            id: { in: loanDeductions.map((line) => line.deductionObligationId) },
          },
          select: { id: true, payeeCategory: true, payeeName: true, issuerReference: true },
        }),
      ]);
      const componentById = new Map(components.map((component) => [component.id, component]));
      const ruleVersionById = new Map(ruleVersions.map((version) => [version.id, version]));
      const ruleVersionOf = (id: string): RuleVersionRef => {
        const version = ruleVersionById.get(id);
        if (!version) throw new Error(`Rule version ${id} of a result line was not found.`);
        return version;
      };
      const obligationById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
      const views = lines.map((line): PayrollLineView => {
        const payComponent = componentById.get(line.payComponentId);
        if (!payComponent) throw new Error('A Payroll Line names a pay component not found.');
        return {
          id: line.id,
          payComponent,
          lineType: line.lineType,
          quantity: line.quantity?.toFixed(4) ?? null,
          rate: line.rate?.toFixed(8) ?? null,
          amount: line.amount.toFixed(4),
          ruleVersion: (line.ruleVersionId && ruleVersionById.get(line.ruleVersionId)) || null,
          sources: sources.filter((source) => source.payrollLineId === line.id).map(sourceOf),
          sourceSnapshot: line.sourceSnapshot,
        };
      });
      views.sort(
        (a, b) =>
          LINE_TYPE_ORDER.indexOf(a.lineType) - LINE_TYPE_ORDER.indexOf(b.lineType) ||
          a.payComponent.code.localeCompare(b.payComponent.code),
      );
      return {
        ...toResult(result),
        calculationHash: result.calculationHash,
        lines: views,
        contributions: contributions
          .map((line) => ({
            id: line.id,
            contributionType: line.contributionType,
            employeeShare: line.employeeShare.toFixed(4),
            employerShare: line.employerShare.toFixed(4),
            compensationBase: line.compensationBase.toFixed(4),
            ruleVersion: ruleVersionOf(line.ruleVersionId),
          }))
          .sort(
            (a, b) =>
              CONTRIBUTION_ORDER.indexOf(a.contributionType) -
              CONTRIBUTION_ORDER.indexOf(b.contributionType),
          ),
        taxLine: taxLine
          ? {
              id: taxLine.id,
              taxableCompensation: taxLine.taxableCompensation.toFixed(4),
              nonTaxableCompensation: taxLine.nonTaxableCompensation.toFixed(4),
              withholdingTax: taxLine.withholdingTax.toFixed(4),
              ruleVersion: ruleVersionOf(taxLine.ruleVersionId),
              yearToDateSnapshot: taxLine.yearToDateSnapshot,
            }
          : null,
        loanDeductions: loanDeductions.map((line) => {
          const obligation = obligationById.get(line.deductionObligationId);
          if (!obligation) throw new Error('A Loan Deduction Line names an obligation not found.');
          return {
            id: line.id,
            deductionObligationId: line.deductionObligationId,
            payeeCategory: obligation.payeeCategory,
            payeeName: obligation.payeeName,
            issuerReference: obligation.issuerReference,
            priority: line.priority,
            amountDue: line.amountDue.toFixed(4),
            deductedAmount: line.deductedAmount.toFixed(4),
            notDeductedAmount: line.notDeductedAmount.toFixed(4),
            ruleVersion: ruleVersionOf(line.ruleVersionId),
          };
        }),
      };
    });
  }
}

function requireRead(context: RequestContext): void {
  if (!holdsAgencyWide(context, 'payroll.periods.read')) {
    throw new PayrollPeriodsServiceError(
      'Reading Payroll Periods and their results needs the payroll.periods.read permission for the whole Agency.',
      403,
      'PAYROLL_PERIOD_READ_FORBIDDEN',
    );
  }
}

function periodNotFound(): PayrollPeriodsServiceError {
  return new PayrollPeriodsServiceError(
    'The Payroll Period could not be found.',
    404,
    'PAYROLL_PERIOD_NOT_FOUND',
  );
}

const amount = (value: Prisma.Decimal | null | undefined) =>
  (value ?? new Prisma.Decimal(0)).toFixed(4);

function toResult(
  row: Prisma.PayrollEmployeeGetPayload<{ select: typeof resultSelect }>,
): PayrollResultSummary {
  return {
    ...row,
    grossAmount: row.grossAmount.toFixed(4),
    totalDeductions: row.totalDeductions.toFixed(4),
    netAmount: row.netAmount.toFixed(4),
  };
}

function sourceOf(source: {
  id: string;
  payrollInputId: string | null;
  attendancePayrollFactId: string | null;
  authorizedPayrollComponentInputId: string | null;
}): { kind: PayrollLineSourceKind; id: string } {
  if (source.payrollInputId) return { kind: 'PAYROLL_INPUT', id: source.payrollInputId };
  if (source.attendancePayrollFactId) {
    return { kind: 'ATTENDANCE_PAYROLL_FACT', id: source.attendancePayrollFactId };
  }
  if (source.authorizedPayrollComponentInputId) {
    return {
      kind: 'AUTHORIZED_PAYROLL_COMPONENT_INPUT',
      id: source.authorizedPayrollComponentInputId,
    };
  }
  // migration 0164 checks that each row names exactly one source.
  throw new Error(`Payroll Line Source ${source.id} names no source.`);
}
