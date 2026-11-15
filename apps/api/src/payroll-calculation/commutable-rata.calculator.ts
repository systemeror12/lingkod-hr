import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AttendancePayrollFactType } from '../attendance-periods/attendance-periods.types';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import { ruleVersionsInEffectDuring } from '../payroll-periods/payroll-rule-snapshots';
import {
  commutableRataParameters,
  normalizedPositionTitle,
  type CommutableRataParameters,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type EmployeePayrollSources,
  type FrozenRuleVersion,
  type PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const REPRESENTATION_ALLOWANCE_COMPONENT_CODE = 'REPRESENTATION_ALLOWANCE';
export const TRANSPORTATION_ALLOWANCE_COMPONENT_CODE = 'TRANSPORTATION_ALLOWANCE';
export const OFFICIAL_VEHICLE_ASSIGNMENT_COMPONENT_CODE = 'OFFICIAL_VEHICLE_ASSIGNMENT';
export const COMMUTABLE_RATA_RULE_KIND = 'COMMUTABLE_RATA';

const DAY_MS = 86_400_000;

/** Facts that put the Employee at work on a Work Date, or away from it. */
const WORKED: readonly AttendancePayrollFactType[] = ['WORKED'];
const ON_DUTY_ELSEWHERE: readonly AttendancePayrollFactType[] = [
  'OFFICIAL_BUSINESS',
  'OFFICIAL_TRAVEL',
  'TRAINING',
];
const OFF_DUTY: readonly AttendancePayrollFactType[] = [
  'POSTED_LEAVE',
  'ABSENCE',
  'APPROVED_ABSENCE',
  'CTO',
];

type Rank = CommutableRataParameters['ranks'][number];
type UnsettledDay = { workDate: string; reason: string };

/**
 * Commutable RATA for an eligible incumbent (FY 2026 GAA sec. 71; DBM NBC No.
 * 593): the representation and the transportation allowance as separate
 * earnings of the month, neither subject to withholding tax (RR No. 11-2018
 * sec. 2.79(B)).
 *
 * The rule version decides eligibility and rate: an Employee is eligible when
 * the Plantilla Position they hold carries a title the version lists under a
 * rank, and is paid that rank's monthly rates. NBC 593's actual-work schedule
 * sets the share of each rate from the days of actual work in the month,
 * counted from the Attendance locked and published by the cutoff, posted
 * leave included. A day of actual work is a Work Date the Employee worked
 * with no leave, absence, or CTO on it; a Work Date wholly on leave, absent,
 * or on CTO is not. An official-vehicle assignment recorded for the whole
 * month as an Agency Payroll Applicability (#618) leaves the transportation
 * allowance out.
 *
 * Reimbursable RATA, for an officer-in-charge or another designee, is an
 * Authorized Payroll Component Input (#346): this calculator never reads one
 * and pays only the position's own incumbent. Every case no recorded rule
 * settles blocks and writes no line:
 *
 * - no version in effect on every date of the month, or one that changes in it;
 * - a rank that changes or ends inside the month;
 * - a part-time or casual pay basis;
 * - days whose count as actual work no recorded rule settles, when they could
 *   change the share: official business, travel, or training with no work
 *   that day, part of a day on leave, absent, or on CTO, and dates no locked
 *   Attendance covers yet;
 * - an official-vehicle assignment for only part of the month;
 * - an amount that is not whole centavos.
 */
@Injectable()
export class CommutableRataCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    _earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    if (basis.stretches.every((stretch) => stretch.personnel === null)) return none();

    const rule = ruleFor(context);
    if ('exceptionType' in rule) return refuse(rule.exceptionType, rule.message, rule.details);
    const { version, parameters } = rule;

    const positions = sources.positionTitles.map((stretch) => ({
      ...stretch,
      rank: rankOf(parameters, stretch.positionTitle),
    }));
    const eligible = positions.find((stretch) => stretch.rank !== null);
    if (!eligible?.rank) return none();
    const rank = eligible.rank;
    const change = positions.find((stretch) => stretch.rank?.rank !== rank.rank);
    if (change) {
      return refuse(
        'COMMUTABLE_RATA_RANK_CHANGE_IN_PERIOD',
        `The Employee holds a position of rank ${rank.rank} in ${context.periodFrom} to ${context.periodTo}, but from ${change.from} to ${change.to} holds ${change.positionTitle ?? 'no titled position'}${change.rank ? `, of rank ${change.rank.rank}` : ', which is not eligible'}. No recorded rule apportions RATA across a change inside the month.`,
        { positions: positions.map(positionSource) },
      );
    }

    const otherBasis = basis.stretches.find(
      (stretch) =>
        stretch.personnel?.payBasis !== null &&
        stretch.personnel?.payBasis !== undefined &&
        stretch.personnel.payBasis !== 'MONTHLY_FULL_TIME',
    );
    if (otherBasis?.personnel) {
      return refuse(
        'COMMUTABLE_RATA_PAY_BASIS_UNSETTLED',
        `From ${otherBasis.from} to ${otherBasis.to} the Employee is paid on a ${otherBasis.personnel.payBasis} basis, and no recorded rule sets RATA for it.`,
        { payBasis: otherBasis.personnel.payBasis },
      );
    }

    const servedDates = positions.flatMap((stretch) => datesFrom(stretch.from, stretch.to));
    const work = actualWorkDays(servedDates, sources.periodAttendance);
    const schedule = parameters.actualWorkSchedule;
    const least = bandFor(schedule, work.actualWorkDays);
    const most = bandFor(schedule, work.actualWorkDays + work.unsettled.length);
    if (least?.share !== most?.share) {
      return refuse(
        'COMMUTABLE_RATA_ACTUAL_WORK_UNSETTLED',
        `${work.actualWorkDays} days of actual work are counted in ${context.periodFrom} to ${context.periodTo}, and ${work.unsettled.length} more could change the share of RATA: ${work.unsettled.map((day) => `${day.workDate} (${day.reason})`).join(', ')}. No recorded rule settles whether those count as days of actual work under NBC 593.`,
        { actualWorkDays: work.actualWorkDays, unsettledDays: work.unsettled },
      );
    }
    // Under the first band's days, NBC 593's schedule grants no RATA for the month.
    if (!least) return none();

    const vehicle = vehicleCover(servedDates, sources.officialVehicleAssignments);
    if (vehicle.status === 'PART') {
      return refuse(
        'COMMUTABLE_RATA_VEHICLE_PART_OF_MONTH_UNSETTLED',
        `An official-vehicle assignment covers ${vehicle.coveredDates.length} of the Employee's ${servedDates.length} days of service in ${context.periodFrom} to ${context.periodTo}. No recorded rule apportions the transportation allowance across part of a month.`,
        {
          coveredDates: vehicle.coveredDates,
          agencyPayrollApplicabilityIds: vehicle.applicabilityIds,
        },
      );
    }

    const source = {
      rank: rank.rank,
      positions: positions.map(positionSource),
      actualWorkDays: work.actualWorkDays,
      actualWorkSchedule: schedule,
      band: least,
      ruleVersionCode: version.code,
      authority: 'FY 2026 GAA sec. 71; DBM NBC No. 593',
      taxTreatment: 'NON_TAXABLE' satisfies TaxTreatment,
      officialVehicleAssignment:
        vehicle.status === 'WHOLE'
          ? { agencyPayrollApplicabilityIds: vehicle.applicabilityIds }
          : null,
    };
    const allowances = [
      {
        componentCode: REPRESENTATION_ALLOWANCE_COMPONENT_CODE,
        monthlyRate: rank.representationAllowance,
      },
      ...(vehicle.status === 'WHOLE'
        ? []
        : [
            {
              componentCode: TRANSPORTATION_ALLOWANCE_COMPONENT_CODE,
              monthlyRate: rank.transportationAllowance,
            },
          ]),
    ];
    const lines: CalculatedLine[] = [];
    for (const { componentCode, monthlyRate } of allowances) {
      const rate = new Prisma.Decimal(monthlyRate);
      const amount = rate.mul(least.share);
      if (!amount.equals(amount.toDecimalPlaces(2))) {
        return refuse(
          'COMMUTABLE_RATA_ROUNDING_UNSETTLED',
          `${least.share} of the ${componentCode} rate ${monthlyRate} is ${amount.toString()}, not a whole number of centavos, and no recorded rule rounds it.`,
          { componentCode, monthlyRate, share: least.share },
        );
      }
      lines.push({
        componentCode,
        lineType: 'EARNING',
        ruleVersionId: version.id,
        quantity: new Prisma.Decimal(least.share).toFixed(4),
        rate: rate.toFixed(8),
        amount: amount.toFixed(4),
        source: { ...source, unit: 'SHARE_OF_MONTHLY_RATE' },
      });
    }
    return { lines, exceptions: [] };
  }
}

function ruleFor(
  context: CalculationContext,
):
  | { version: FrozenRuleVersion; parameters: CommutableRataParameters }
  | { exceptionType: string; message: string; details: Record<string, unknown> } {
  const versions = context.snapshotRuleVersions.filter(
    (version) => version.ruleKind === COMMUTABLE_RATA_RULE_KIND,
  );
  const coverage = ruleVersionsInEffectDuring(
    COMMUTABLE_RATA_RULE_KIND,
    versions,
    context.periodFrom,
    context.periodTo,
  );
  if (coverage.status === 'NOT_IN_EFFECT') {
    return {
      exceptionType: 'COMMUTABLE_RATA_RULE_NOT_IN_EFFECT',
      message: `${coverage.reason} Without it, no one's eligibility for RATA can be decided.`,
      details: { ruleKind: COMMUTABLE_RATA_RULE_KIND },
    };
  }
  if (coverage.ruleVersionIds.length > 1) {
    return {
      exceptionType: 'COMMUTABLE_RATA_RULE_CHANGE_IN_PERIOD',
      message: `The ${COMMUTABLE_RATA_RULE_KIND} version changes inside ${context.periodFrom} to ${context.periodTo}. No recorded rule apportions RATA across a change inside the month.`,
      details: { ruleVersionIds: coverage.ruleVersionIds },
    };
  }
  const version = versions.find((candidate) => candidate.id === coverage.ruleVersionIds[0]);
  if (!version) throw new Error('A covered rule kind names a frozen version.');
  return { version, parameters: commutableRataParameters.parse(version.parameters) };
}

function rankOf(parameters: CommutableRataParameters, title: string | null): Rank | null {
  if (title === null) return null;
  const wanted = normalizedPositionTitle(title);
  return (
    parameters.ranks.find((rank) =>
      rank.positionTitles.some((listed) => normalizedPositionTitle(listed) === wanted),
    ) ?? null
  );
}

/**
 * The served dates' days of actual work, and the dates whose count no
 * recorded rule settles. A date no published Attendance Period covers is
 * unsettled; a covered date with no expected duty is not a Work Date.
 */
function actualWorkDays(
  servedDates: readonly string[],
  attendance: EmployeePayrollSources['periodAttendance'],
): { actualWorkDays: number; unsettled: UnsettledDay[] } {
  const byDate = new Map(attendance.workDates.map((day) => [day.workDate, day.minutes]));
  const minutesOf = (
    minutes: Partial<Record<AttendancePayrollFactType, number>>,
    types: readonly AttendancePayrollFactType[],
  ) => types.reduce((sum, type) => sum + (minutes[type] ?? 0), 0);
  let count = 0;
  const unsettled: UnsettledDay[] = [];
  for (const workDate of servedDates) {
    if (!attendance.coveredDates.some(({ from, to }) => from <= workDate && workDate <= to)) {
      unsettled.push({ workDate, reason: 'no locked Attendance yet' });
      continue;
    }
    const minutes = byDate.get(workDate);
    if (!minutes || (minutes.EXPECTED ?? 0) === 0) continue;
    const worked = minutesOf(minutes, WORKED) > 0;
    const elsewhere = minutesOf(minutes, ON_DUTY_ELSEWHERE) > 0;
    const off = minutesOf(minutes, OFF_DUTY) > 0;
    if (worked && !off) count += 1;
    else if (!worked && !elsewhere) continue;
    else if (worked) unsettled.push({ workDate, reason: 'worked part of the day' });
    else unsettled.push({ workDate, reason: 'official business, travel, or training' });
  }
  return { actualWorkDays: count, unsettled };
}

/** The highest band whose minimum the days reach, or null under the first. */
function bandFor(schedule: CommutableRataParameters['actualWorkSchedule'], days: number) {
  return schedule.filter((band) => band.minimumDays <= days).at(-1) ?? null;
}

function vehicleCover(
  servedDates: readonly string[],
  assignments: EmployeePayrollSources['officialVehicleAssignments'],
):
  | { status: 'NONE' }
  | { status: 'WHOLE' | 'PART'; coveredDates: string[]; applicabilityIds: string[] } {
  const covering = (date: string) =>
    assignments.filter(
      (row) => row.effectiveFrom <= date && (row.effectiveTo === null || date <= row.effectiveTo),
    );
  const coveredDates = servedDates.filter((date) => covering(date).length > 0);
  if (coveredDates.length === 0) return { status: 'NONE' };
  const applicabilityIds = [
    ...new Set(
      coveredDates.flatMap((date) => covering(date).map((row) => row.agencyPayrollApplicabilityId)),
    ),
  ];
  return {
    status: coveredDates.length === servedDates.length ? 'WHOLE' : 'PART',
    coveredDates,
    applicabilityIds,
  };
}

const positionSource = (stretch: EmployeePayrollSources['positionTitles'][number]) => ({
  from: stretch.from,
  to: stretch.to,
  serviceSegmentId: stretch.serviceSegmentId,
  positionId: stretch.positionId,
  positionTitle: stretch.positionTitle,
});

function datesFrom(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let time = Date.parse(`${from}T00:00:00.000Z`);
    time <= Date.parse(`${to}T00:00:00.000Z`);
    time += DAY_MS
  ) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

const none = (): CalculatorOutcome => ({ lines: [], exceptions: [] });

const refuse = (
  exceptionType: string,
  message: string,
  details: Record<string, unknown>,
): CalculatorOutcome => ({ lines: [], exceptions: [blocking(exceptionType, message, details)] });
