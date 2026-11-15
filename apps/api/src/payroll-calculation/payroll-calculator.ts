import type { UnchargedDeficitFact } from '../attendance-deficit-charges/attendance-deficit-charges.service';
import type {
  AttendanceAbsenceFact,
  AttendanceWorkDatesByCutoff,
} from '../attendance-periods/attendance-periods.types';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import type {
  NationalPayrollRuleKind,
  RuleVersionWithEffectivity,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import type { PositionTitleStretch } from '../personnel-salary-facts/position-titles';

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
  /** The pay component codes a special period names; empty for a regular period. */
  componentCodes: ReadonlySet<string>;
}

/** A `PENDING` Payroll Input accepted at or before the cutoff. */
export interface PendingPayrollInput {
  id: string;
  inputKind: string;
  sourceType: string;
  sourceId: string;
  effectiveDate: string;
  /** Four decimal places, as `payroll_inputs.quantity` stores it. */
  quantity: string | null;
  payloadSnapshot: unknown;
}

/**
 * The sources one Employee's calculation takes at the period's cutoff: every
 * Payroll Input and Attendance Payroll Fact no finalized payroll consumed,
 * whatever its Work Date (ADR 0014), and the compensation basis on each
 * source Work Date outside the period.
 */
export interface EmployeePayrollSources {
  payrollInputs: PendingPayrollInput[];
  absenceFacts: AttendanceAbsenceFact[];
  /** Leave's report of the Employee's deficit facts owed a charge (ADR 0012). */
  unchargedDeficitFacts: (UnchargedDeficitFact & { publicationId: string })[];
  valuationBases: CompensationBasis[];
  /** The titles of the Plantilla Positions the Employee holds in the period, from Personnel. */
  positionTitles: PositionTitleStretch[];
  /** The period's Work Dates in Attendance published by the cutoff, for this Employee. */
  periodAttendance: AttendanceWorkDatesByCutoff;
  /** The snapshot's official-vehicle assignments for this Employee or the whole Agency (#618). */
  officialVehicleAssignments: OfficialVehicleAssignment[];
}

/** An Agency Payroll Applicability of `OFFICIAL_VEHICLE_ASSIGNMENT` the rule snapshot froze. */
export interface OfficialVehicleAssignment {
  agencyPayrollApplicabilityId: string;
  scope: 'AGENCY' | 'EMPLOYEE';
  authorityDocumentVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type LineType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_SHARE' | 'INFORMATIONAL';

/** A record a Payroll Line rests on, written to `payroll_line_sources`. */
export type LineSourceRecord = { payrollInputId: string } | { attendancePayrollFactId: string };

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
  sourceRecords?: LineSourceRecord[];
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
 * is given the lines of the calculators before it and the Employee's sources.
 */
export interface PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome;
}

export function blocking(
  exceptionType: string,
  message: string,
  details: Record<string, unknown> = {},
): CalculatedException {
  return { exceptionType, severity: 'BLOCKING', details: { message, ...details } };
}
