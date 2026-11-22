import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../payroll-calculation/calculation-hash';

/** The contract version this code renders; migration 0188 defines it. */
export const CONTRIBUTION_REMITTANCE_CONTRACT = {
  code: 'CONTRIBUTION_REMITTANCE',
  version: 1,
} as const;

/**
 * Contract version 1's statement, verbatim: the artifacts claim no filing, no
 * remittance, and no issuer's format (PAY-010, #617).
 */
export const CONTRIBUTION_REMITTANCE_STATEMENT =
  'This Structured Export is HRIS payroll data from one finalized payroll, for review. It is not a filing or a remittance, does not claim that any contribution was filed, remitted, or received, and does not follow the format of GSIS, PhilHealth, Pag-IBIG, or any other issuer.';

/** Every schedule a summary has, in the order the summary lists them. */
export const CONTRIBUTION_TYPES = [
  'GSIS',
  'PHILHEALTH',
  'PAGIBIG',
  'EMPLOYEES_COMPENSATION',
] as const;

export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

/** The FINALIZED period the artifacts state. */
export interface ContributionRemittancePeriod {
  id: string;
  code: string;
  runType: string;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  calculationVersion: number;
  finalizedAt: string;
}

/** One Contribution Line of a FINALIZED result, with its Employee and rule version. */
export interface ContributionSourceLine {
  contributionLineId: string;
  payrollEmployeeId: string;
  agencyEmployeeNumber: string;
  employeeName: string;
  contributionType: string;
  compensationBase: string;
  employeeShare: string;
  employerShare: string;
  ruleVersionId: string;
  ruleVersionCode: string;
}

export interface ContributionTotals {
  lineCount: number;
  employeeShareTotal: string;
  employerShareTotal: string;
  totalAmount: string;
}

export interface PlannedRemittanceSchedule extends ContributionTotals {
  id: string;
  contributionType: ContributionType;
  content: string;
  checksum: string;
}

export interface ContributionRemittancePlan {
  content: string;
  checksum: string;
  schedules: PlannedRemittanceSchedule[];
}

/**
 * Render the Contribution Summary and one Remittance Schedule per contribution
 * type from a finalized payroll's Contribution Lines. Each schedule lists
 * every line of its type and totals exactly those lines; the summary totals
 * the schedules and names each one's checksum, so the five artifacts are
 * tied. A type with no line still gets a schedule, with zero totals.
 */
export function planContributionRemittance(input: {
  agencyId: string;
  summaryId: string;
  scheduleIds: Record<ContributionType, string>;
  generatedAt: string;
  period: ContributionRemittancePeriod;
  lines: readonly ContributionSourceLine[];
}): ContributionRemittancePlan {
  const unknown = input.lines.filter((line) => !isContributionType(line.contributionType));
  if (unknown.length > 0) {
    throw new Error(
      `Contribution type ${unknown[0]!.contributionType} has no Remittance Schedule in contract version 1.`,
    );
  }
  const header = {
    contract: CONTRIBUTION_REMITTANCE_CONTRACT,
    statement: CONTRIBUTION_REMITTANCE_STATEMENT,
    agencyId: input.agencyId,
    contributionSummaryId: input.summaryId,
    generatedAt: input.generatedAt,
    payrollPeriod: input.period,
  };

  const schedules = CONTRIBUTION_TYPES.map((contributionType): PlannedRemittanceSchedule => {
    const lines = input.lines
      .filter((line) => line.contributionType === contributionType)
      .sort(byEmployee)
      .map((line) => ({
        contributionLineId: line.contributionLineId,
        payrollEmployeeId: line.payrollEmployeeId,
        agencyEmployeeNumber: line.agencyEmployeeNumber,
        employeeName: line.employeeName,
        compensationBase: amount(line.compensationBase),
        employeeShare: amount(line.employeeShare),
        employerShare: amount(line.employerShare),
        totalShare: sum([line.employeeShare, line.employerShare]),
        ruleVersion: { id: line.ruleVersionId, code: line.ruleVersionCode },
      }));
    const totals = totalsOf(lines);
    const id = input.scheduleIds[contributionType];
    const content = canonicalJson({
      ...header,
      artifact: 'REMITTANCE_SCHEDULE',
      remittanceScheduleId: id,
      contributionType,
      lines,
      totals,
    });
    return { id, contributionType, ...totals, content, checksum: sha256(content) };
  });

  const content = canonicalJson({
    ...header,
    artifact: 'CONTRIBUTION_SUMMARY',
    contributions: schedules.map((schedule) => ({
      contributionType: schedule.contributionType,
      remittanceScheduleId: schedule.id,
      scheduleChecksum: schedule.checksum,
      lineCount: schedule.lineCount,
      employeeShareTotal: schedule.employeeShareTotal,
      employerShareTotal: schedule.employerShareTotal,
      totalAmount: schedule.totalAmount,
    })),
    totals: {
      lineCount: schedules.reduce((count, schedule) => count + schedule.lineCount, 0),
      employeeShareTotal: sum(schedules.map((schedule) => schedule.employeeShareTotal)),
      employerShareTotal: sum(schedules.map((schedule) => schedule.employerShareTotal)),
      totalAmount: sum(schedules.map((schedule) => schedule.totalAmount)),
    },
  });
  return { content, checksum: sha256(content), schedules };
}

function totalsOf(
  lines: readonly { employeeShare: string; employerShare: string }[],
): ContributionTotals {
  const employeeShareTotal = sum(lines.map((line) => line.employeeShare));
  const employerShareTotal = sum(lines.map((line) => line.employerShare));
  return {
    lineCount: lines.length,
    employeeShareTotal,
    employerShareTotal,
    totalAmount: sum([employeeShareTotal, employerShareTotal]),
  };
}

function isContributionType(value: string): value is ContributionType {
  return (CONTRIBUTION_TYPES as readonly string[]).includes(value);
}

function byEmployee(
  left: { agencyEmployeeNumber: string; payrollEmployeeId: string },
  right: { agencyEmployeeNumber: string; payrollEmployeeId: string },
): number {
  return (
    compare(left.agencyEmployeeNumber, right.agencyEmployeeNumber) ||
    compare(left.payrollEmployeeId, right.payrollEmployeeId)
  );
}

/** Code-unit order, so the line order never depends on a locale. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Four places, as Contribution Lines store amounts. */
function amount(value: string): string {
  return new Prisma.Decimal(value).toFixed(4);
}

function sum(amounts: readonly string[]): string {
  return amounts.reduce((total, value) => total.add(value), new Prisma.Decimal(0)).toFixed(4);
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
