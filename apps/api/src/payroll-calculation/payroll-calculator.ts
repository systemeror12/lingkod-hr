import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import type {
  NationalPayrollRuleKind,
  RuleVersionWithEffectivity,
} from '../payroll-rule-versions/national-payroll-rule-versions';

/**
 * A National Payroll Rule Version as the snapshot froze it. Its successor
 * counts only when the snapshot froze the successor too.
 */
export interface FrozenRuleVersion extends RuleVersionWithEffectivity {
  ruleKind: NationalPayrollRuleKind;
  /** The kind's parameters as loaded; the calculator parses them. */
  parameters: unknown;
}

/** What every calculator reads besides the Employee's compensation basis. */
export interface CalculationContext {
  periodFrom: string;
  periodTo: string;
  /** The National Payroll Rule Versions the period's rule snapshot froze. */
  snapshotRuleVersionIds: ReadonlySet<string>;
  /** The same versions, with their kind, effectivity, and parameters. */
  snapshotRuleVersions: readonly FrozenRuleVersion[];
}

export type LineType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_SHARE' | 'INFORMATIONAL';

/**
 * One calculated Payroll Line (BRD PAY-007): its component, rule version,
 * quantity, rate, and amount, as canonical decimal strings, and the source
 * records it rests on.
 */
export interface CalculatedLine {
  componentCode: string;
  lineType: LineType;
  ruleVersionId: string | null;
  /** Four decimal places, as `payroll_lines.quantity` stores it. */
  quantity: string | null;
  /** Eight decimal places, as `payroll_lines.rate` stores it. */
  rate: string | null;
  /** Four decimal places, as `payroll_lines.amount` stores it. */
  amount: string;
  source: Record<string, unknown>;
}

export interface CalculatedException {
  exceptionType: string;
  severity: 'WARNING' | 'BLOCKING';
  details: { message: string } & Record<string, unknown>;
}

export type ContributionType = 'GSIS' | 'EMPLOYEES_COMPENSATION';

/** One Contribution Line (payroll-schema.md §9), as canonical decimal strings. */
export interface CalculatedContribution {
  contributionType: ContributionType;
  /** Four decimal places, as `contribution_lines` stores each amount. */
  employeeShare: string;
  employerShare: string;
  compensationBase: string;
  ruleVersionId: string;
}

export interface CalculatorOutcome {
  lines: CalculatedLine[];
  exceptions: CalculatedException[];
  contributions?: CalculatedContribution[];
}

/**
 * A calculator: one Native Payroll Component's deterministic rule. It reads
 * only what it is given, so the same basis and snapshot give the same lines.
 * A case the recorded rules do not settle is a blocking exception, never a
 * guessed line. Each calculator joins `PayrollCalculationService`'s list and
 * is given the lines of the calculators before it.
 */
export interface PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
  ): CalculatorOutcome;
}

export function blocking(
  exceptionType: string,
  message: string,
  details: Record<string, unknown> = {},
): CalculatedException {
  return { exceptionType, severity: 'BLOCKING', details: { message, ...details } };
}
