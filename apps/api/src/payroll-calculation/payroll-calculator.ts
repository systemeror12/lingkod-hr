import type { UnchargedDeficitFact } from '../attendance-deficit-charges/attendance-deficit-charges.service';
import type {
  AttendanceAbsenceFact,
  AttendanceNightDutyFact,
  AttendanceWorkDatesByCutoff,
} from '../attendance-periods/attendance-periods.types';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import type {
  DeductionPayeeCategory,
  DeMinimisBenefit,
  NationalPayrollRuleKind,
  RuleVersionWithEffectivity,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import type { PositionTitleStretch } from '../personnel-salary-facts/position-titles';
import type { ServiceSegmentAppointment } from '../personnel-salary-facts/service-segment-appointments';

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
  /** Four decimal places; only a `MONETIZATION_EARNING` input carries one. */
  amount: string | null;
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
  /** NIGHT_DUTY facts published by the cutoff that no finalized payroll consumed. */
  nightDutyFacts: AttendanceNightDutyFact[];
  /** The snapshot's approved night-shift differential rates for this Employee or the whole Agency (#627). */
  nightShiftDifferentialRates: NightShiftDifferentialRate[];
  /** Leave's report of the Employee's deficit facts owed a charge (ADR 0012). */
  unchargedDeficitFacts: (UnchargedDeficitFact & { publicationId: string })[];
  valuationBases: CompensationBasis[];
  /** The titles of the Plantilla Positions the Employee holds in the period, from Personnel. */
  positionTitles: PositionTitleStretch[];
  /** The period's Work Dates in Attendance published by the cutoff, for this Employee. */
  periodAttendance: AttendanceWorkDatesByCutoff;
  /** The snapshot's official-vehicle assignments for this Employee or the whole Agency (#618). */
  officialVehicleAssignments: OfficialVehicleAssignment[];
  /** For a special period: the cash clothing allowance grants in effect on its payment date (#631). */
  clothingAllowanceGrants: ClothingAllowanceGrant[];
  /** For a special period: the appointment nature behind each of the Employee's Service Segments in it. */
  serviceSegmentAppointments: Omit<ServiceSegmentAppointment, 'employeeId'>[];
  /** The Employee's tax figures from the Agency's finalized payrolls of the tax year (#350). */
  taxYearToDate: TaxYearToDate;
  /** For a regular period: the Employee's Deduction Obligations in effect on its last day (#634). */
  deductionObligations: DeductionObligationDue[];
  /**
   * For a regular period: the Employee's `EFFECTIVE` Separation Case, effectuated
   * by the cutoff, whose last day of service falls in the period (#633). Absent
   * when there is none.
   */
  separation?: EmployeeSeparation;
}

/** A separation that makes a regular period the Employee's last payroll of the year. */
export interface EmployeeSeparation {
  separationCaseId: string;
  /** The first day out of service; the last day of service is the day before. */
  effectiveDate: string;
}

/**
 * The version of one Deduction Obligation in effect on a regular period's
 * last day: the issuer-validated terms the period deducts. Amounts are
 * four-place decimal strings.
 */
export interface DeductionObligationDue {
  id: string;
  payeeCategory: DeductionPayeeCategory;
  payeeName: string;
  issuerReference: string;
  incurredOn: string;
  outstandingBalance: string;
  scheduledAmount: string;
}

/**
 * What the Agency's `FINALIZED` Payroll Periods paid the Employee in the tax
 * year, the calendar year of this period's payment date, before this period:
 * the sums of their tax lines, the de minimis benefits their lines paid, and
 * the 13th-month pay and other benefits their lines paid, which count toward
 * the yearly exclusion (#351). Amounts are four-place decimal strings.
 */
export interface TaxYearToDate {
  taxYear: number;
  payrollPeriodIds: string[];
  taxableCompensation: string;
  nonTaxableCompensation: string;
  withholdingTax: string;
  deMinimisBenefits: Partial<Record<DeMinimisBenefit, string>>;
  thirteenthMonthAndOtherBenefits: string;
}

/** An Agency Payroll Applicability of `OFFICIAL_VEHICLE_ASSIGNMENT` the rule snapshot froze. */
export interface OfficialVehicleAssignment {
  agencyPayrollApplicabilityId: string;
  scope: 'AGENCY' | 'EMPLOYEE';
  authorityDocumentVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * An Agency Payroll Applicability of `CLOTHING_ALLOWANCE` the rule snapshot
 * froze, for this Employee or the whole Agency: the Agency's record of a cash
 * grant, whose authority is its internal guideline (DBM BC No. 2024-1 item 12.1).
 */
export interface ClothingAllowanceGrant {
  agencyPayrollApplicabilityId: string;
  scope: 'AGENCY' | 'EMPLOYEE';
  authorityDocumentVersionId: string;
}

/**
 * An approved Authorized Payroll Component Input of the
 * `NIGHT_SHIFT_DIFFERENTIAL` component the rule snapshot froze: the agency
 * head's percentage of the hourly basic rate (RA No. 11701, sec. 1).
 */
export interface NightShiftDifferentialRate {
  authorizedPayrollComponentInputId: string;
  scope: 'AGENCY' | 'EMPLOYEE';
  /** A fraction with eight decimal places: `0.10000000` is 10%. */
  rate: string;
  authorityDocumentVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type LineType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_SHARE' | 'INFORMATIONAL';

/** A record a Payroll Line rests on, written to `payroll_line_sources`. */
export type LineSourceRecord =
  | { payrollInputId: string }
  | { attendancePayrollFactId: string }
  | { authorizedPayrollComponentInputId: string };

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

export type ContributionType = 'GSIS' | 'EMPLOYEES_COMPENSATION' | 'PHILHEALTH' | 'PAGIBIG';

/** One Contribution Line (payroll-schema.md §9), as canonical decimal strings. */
export interface CalculatedContribution {
  contributionType: ContributionType;
  /** Four decimal places, as `contribution_lines` stores each amount. */
  employeeShare: string;
  employerShare: string;
  compensationBase: string;
  ruleVersionId: string;
}

/** One Tax Line (payroll-schema.md §9), as canonical decimal strings. */
export interface CalculatedTax {
  /** Four decimal places, as `tax_lines` stores each amount. */
  taxableCompensation: string;
  nonTaxableCompensation: string;
  withholdingTax: string;
  ruleVersionId: string;
  yearToDateSnapshot: TaxYearToDate;
  /** Present only when the period makes the year-end adjustment (#633). */
  yearEndAdjustment?: YearEndAdjustment;
}

/**
 * The basis of a year-end adjustment (BIR RR No. 11-2018 sec. 2.79(B)(5)(b)),
 * stored on the Tax Line: the year's taxable compensation, the finalized year
 * to date plus this period, the annual table's tax on it, and the difference
 * from the tax the year's finalized payrolls withheld. The difference is the
 * period's withholding tax, negative when it is refunded. Amounts are
 * four-place decimal strings.
 */
export interface YearEndAdjustment {
  authority: 'BIR RR No. 11-2018 sec. 2.79(B)(5)(b)';
  /** `SEPARATION` when the Employee's service ends in the period, else `YEAR_END`. */
  reason: 'YEAR_END' | 'SEPARATION';
  separation: EmployeeSeparation | null;
  taxYear: number;
  yearToDateTaxableCompensation: string;
  periodTaxableCompensation: string;
  annualTaxableCompensation: string;
  bracket: { compensationLevel: string; baseTax: string; rateOverCompensationLevel: string };
  annualTaxDue: string;
  yearToDateWithholdingTax: string;
  withholdingTax: string;
}

/**
 * One Loan Deduction Line (payroll-schema.md §9): what one Deduction
 * Obligation was due in the period, what was deducted, and what the
 * net-take-home floor stopped, as four-place decimal strings.
 */
export interface CalculatedLoanDeduction {
  deductionObligationId: string;
  /** 1 for the obligation satisfied first. */
  priority: number;
  amountDue: string;
  deductedAmount: string;
  notDeductedAmount: string;
  ruleVersionId: string;
}

export interface CalculatorOutcome {
  lines: CalculatedLine[];
  exceptions: CalculatedException[];
  contributions?: CalculatedContribution[];
  tax?: CalculatedTax;
  loanDeductions?: CalculatedLoanDeduction[];
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
