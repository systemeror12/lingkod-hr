import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';

/** A National Payroll Rule Version the period's rule snapshot froze, with its parameters. */
export interface SnapshotRuleVersion {
  id: string;
  code: string;
  ruleKind: string;
  /** As loaded; the calculator of the kind parses them with the kind's schema. */
  parameters: unknown;
}

/** What every calculator reads besides the Employee's compensation basis. */
export interface CalculationContext {
  periodFrom: string;
  periodTo: string;
  /** The National Payroll Rule Versions the period's rule snapshot froze. */
  snapshotRuleVersionIds: ReadonlySet<string>;
  /** The same versions with their kinds and parameters. */
  snapshotRuleVersions: readonly SnapshotRuleVersion[];
  /** The pay component codes a special period names; empty for a regular period. */
  componentCodes: ReadonlySet<string>;
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

export interface CalculatorOutcome {
  lines: CalculatedLine[];
  exceptions: CalculatedException[];
}

/**
 * A calculator: one Native Payroll Component's deterministic rule. It reads
 * only what it is given, so the same basis and snapshot give the same lines.
 * A case the recorded rules do not settle is a blocking exception, never a
 * guessed line. Each calculator joins `PayrollCalculationService`'s list.
 */
export interface PayrollCalculator {
  calculate(basis: CompensationBasis, context: CalculationContext): CalculatorOutcome;
}

export function blocking(
  exceptionType: string,
  message: string,
  details: Record<string, unknown> = {},
): CalculatedException {
  return { exceptionType, severity: 'BLOCKING', details: { message, ...details } };
}
