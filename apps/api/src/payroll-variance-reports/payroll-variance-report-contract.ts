import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../payroll-calculation/calculation-hash';

/** The contract version this code renders; migration 0199 defines it. */
export const PAYROLL_VARIANCE_REPORT_CONTRACT = {
  code: 'PAYROLL_VARIANCE_EXCEPTION_REPORT',
  version: 1,
} as const;

/** Contract version 1's statement, verbatim (#617). */
export const PAYROLL_VARIANCE_REPORT_STATEMENT =
  "This Structured Export is HRIS payroll data from one finalized payroll, for review. It compares the payroll with its prior comparable period and lists the period's payroll exceptions; it changes, acknowledges, or resolves nothing, and follows no external form.";

/** A FINALIZED Payroll Period as the report states it. */
export interface VarianceReportPeriod {
  id: string;
  code: string;
  runType: string;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  calculationVersion: number;
  finalizedAt: string;
}

/** One FINALIZED Payroll Employee Result with its Payroll Lines. */
export interface VarianceSourceResult {
  employeeId: string;
  agencyEmployeeNumber: string;
  employeeName: string;
  netAmount: string;
  lines: readonly {
    payComponentId: string;
    componentCode: string;
    componentName: string;
    lineType: string;
    amount: string;
  }[];
}

/** One Payroll Exception of the period, of any calculation version. */
export interface VarianceSourceException {
  id: string;
  calculationVersion: number;
  exceptionType: string;
  severity: string;
  status: string;
  details: unknown;
  reason: string | null;
  resolvedByMembershipId: string | null;
  employee: { id: string; agencyEmployeeNumber: string; employeeName: string } | null;
  holds: readonly {
    id: string;
    reason: string;
    placedByMembershipId: string;
    placedAt: string;
    liftedByMembershipId: string | null;
    liftedAt: string | null;
  }[];
}

export interface PayrollVarianceReportPlan {
  content: string;
  checksum: string;
}

/**
 * Render the Payroll Variance and Exception Report of a finalized payroll
 * (PAY-009, #645).
 *
 * The prior comparable period is the Agency's last FINALIZED regular Payroll
 * Period before this one, the period the net pay variance check compares
 * against (#623). A SPECIAL period has none, and nor has the first regular
 * one: the report then says so and why, and lists no difference, rather than
 * reporting zero variance.
 *
 * With a prior period, it lists each Employee whose net pay or any component
 * differs, and each differing component with both values. A value is `null`
 * where the Employee had no result, or the result no line of that component,
 * so a new Employee and a removed component read as absent, not as zero.
 * Every exception of the period is listed, of every calculation version, with
 * its decision and any Payroll Hold placed on it.
 */
export function planPayrollVarianceReport(input: {
  agencyId: string;
  reportId: string;
  generatedAt: string;
  period: VarianceReportPeriod;
  results: readonly VarianceSourceResult[];
  prior: { period: VarianceReportPeriod; results: readonly VarianceSourceResult[] } | null;
  exceptions: readonly VarianceSourceException[];
}): PayrollVarianceReportPlan {
  const content = canonicalJson({
    artifact: 'PAYROLL_VARIANCE_EXCEPTION_REPORT',
    contract: PAYROLL_VARIANCE_REPORT_CONTRACT,
    statement: PAYROLL_VARIANCE_REPORT_STATEMENT,
    agencyId: input.agencyId,
    payrollVarianceReportId: input.reportId,
    generatedAt: input.generatedAt,
    payrollPeriod: input.period,
    variance: input.prior
      ? {
          status: 'COMPARED',
          priorComparablePeriod: input.prior.period,
          employees: compare(input.prior.results, input.results),
        }
      : { status: 'NO_PRIOR_COMPARABLE_PERIOD', reason: noPriorReason(input.period) },
    exceptions: [...input.exceptions].sort(byException).map((exception) => ({
      payrollExceptionId: exception.id,
      calculationVersion: exception.calculationVersion,
      exceptionType: exception.exceptionType,
      severity: exception.severity,
      status: exception.status,
      details: exception.details,
      employee: exception.employee,
      decision:
        exception.status === 'OPEN'
          ? null
          : { reason: exception.reason, decidedByMembershipId: exception.resolvedByMembershipId },
      holds: [...exception.holds].sort((left, right) => compareText(left.placedAt, right.placedAt)),
    })),
  });
  return { content, checksum: sha256(content) };
}

function noPriorReason(period: VarianceReportPeriod): string {
  return period.runType === 'REGULAR'
    ? 'The Agency has no FINALIZED regular Payroll Period before this one, so nothing is compared.'
    : `Payroll Period ${period.code} is a ${period.runType} run, and only a regular run has a prior comparable period, so nothing is compared.`;
}

function compare(
  priorResults: readonly VarianceSourceResult[],
  currentResults: readonly VarianceSourceResult[],
) {
  const prior = new Map(priorResults.map((result) => [result.employeeId, result]));
  const current = new Map(currentResults.map((result) => [result.employeeId, result]));
  const employeeIds = [...new Set([...prior.keys(), ...current.keys()])];

  return employeeIds
    .map((employeeId) => {
      const before = prior.get(employeeId);
      const after = current.get(employeeId);
      const named = (after ?? before)!;
      const priorAmounts = amountsByComponent(before);
      const currentAmounts = amountsByComponent(after);
      const components = [...new Set([...priorAmounts.keys(), ...currentAmounts.keys()])]
        .map((key) => {
          const priorLine = priorAmounts.get(key);
          const currentLine = currentAmounts.get(key);
          const component = (currentLine ?? priorLine)!;
          return {
            payComponentId: component.payComponentId,
            componentCode: component.componentCode,
            componentName: component.componentName,
            lineType: component.lineType,
            ...values(priorLine?.amount, currentLine?.amount),
          };
        })
        .filter((component) => component.priorAmount !== component.currentAmount)
        .sort(
          (left, right) =>
            compareText(left.componentCode, right.componentCode) ||
            compareText(left.lineType, right.lineType),
        );
      const net = values(before && amount(before.netAmount), after && amount(after.netAmount));
      return {
        employeeId,
        agencyEmployeeNumber: named.agencyEmployeeNumber,
        employeeName: named.employeeName,
        inPriorPeriod: before !== undefined,
        inThisPeriod: after !== undefined,
        priorNetAmount: net.priorAmount,
        netAmount: net.currentAmount,
        netDifference: net.difference,
        components,
      };
    })
    .filter(
      (employee) =>
        employee.priorNetAmount !== employee.netAmount || employee.components.length > 0,
    )
    .sort(
      (left, right) =>
        compareText(left.agencyEmployeeNumber, right.agencyEmployeeNumber) ||
        compareText(left.employeeId, right.employeeId),
    );
}

/** A result's lines summed by component and line type, as four-place strings. */
function amountsByComponent(result: VarianceSourceResult | undefined) {
  const sums = new Map<string, VarianceSourceResult['lines'][number]>();
  for (const line of result?.lines ?? []) {
    const key = `${line.payComponentId}:${line.lineType}`;
    const sum = sums.get(key);
    sums.set(key, {
      ...line,
      amount: amount(
        sum ? new Prisma.Decimal(sum.amount).add(line.amount).toString() : line.amount,
      ),
    });
  }
  return sums;
}

/** Both values, absent as `null`, and their difference counting absent as zero. */
function values(priorAmount: string | undefined, currentAmount: string | undefined) {
  return {
    priorAmount: priorAmount ?? null,
    currentAmount: currentAmount ?? null,
    difference: new Prisma.Decimal(currentAmount ?? 0).sub(priorAmount ?? 0).toFixed(4),
  };
}

function byException(left: VarianceSourceException, right: VarianceSourceException): number {
  return (
    left.calculationVersion - right.calculationVersion ||
    compareText(
      left.employee?.agencyEmployeeNumber ?? '',
      right.employee?.agencyEmployeeNumber ?? '',
    ) ||
    compareText(left.exceptionType, right.exceptionType) ||
    compareText(left.id, right.id)
  );
}

/** Code-unit order, so the report never depends on a locale. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Four places, as Payroll Lines store amounts. */
function amount(value: string): string {
  return new Prisma.Decimal(value).toFixed(4);
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
