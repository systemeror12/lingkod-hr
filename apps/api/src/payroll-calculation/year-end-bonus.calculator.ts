import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PersonnelFacts,
} from '../compensation-basis/compensation-basis.service';
import {
  isoDateOf,
  yearEndBonusAndCashGiftParameters,
  type YearEndBonusAndCashGiftParameters,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type PayrollCalculator,
  type SnapshotRuleVersion,
} from './payroll-calculator';

export const YEAR_END_BONUS_COMPONENT_CODE = 'YEAR_END_BONUS';
export const CASH_GIFT_COMPONENT_CODE = 'CASH_GIFT';
export const YEAR_END_BONUS_RULE_KIND = 'YEAR_END_BONUS_AND_CASH_GIFT';

/**
 * How the tax calculator (#351) treats a line, recorded in its source. The
 * bonus counts toward the yearly exclusion for 13th-month pay and other
 * benefits (RR No. 11-2018 sec. 2.78.1(B)(11); research register R26). The
 * cash gift is a de minimis benefit, as #344 decides (RR No. 29-2025 sec.
 * 2.78.1(A)(3)(i); register open question 8).
 */
export type TaxTreatment = 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS' | 'DE_MINIMIS';

type ServedStretch = CompensationBasisStretch & { personnel: PersonnelFacts };
type ServiceRun = { from: string; to: string };

/**
 * The year-end bonus and the cash gift, paid in a special Payroll Period that
 * names them and covers its rule version's service window, January 1 to
 * October 31 (ADR 0015). An Employee with at least the version's minimum
 * months of aggregate service in the window who is in service on its last
 * day gets one month's basic salary as of that day, and the cash gift
 * (RA No. 6686 sec. 1 as amended; FY 2026 GAA sec. 75(a)). Under the minimum,
 * there is no bonus. Every case no recorded rule settles blocks that
 * component and writes no line:
 *
 * - no rule version in the snapshot with the period's service window;
 * - service in separate stretches whose leftover days might add up to the
 *   minimum, or a count that turns on a month end;
 * - personnel who left before the last day after the minimum service, where
 *   the version grants that case: no recorded rule prorates the bonus, and
 *   the record does not show a separation from government service rather
 *   than a transfer;
 * - a reduced cash gift under the minimum (RA No. 8441 sec. 2): its bands
 *   are not in the rule version;
 * - a part-time cash gift: no recorded rule apportions it;
 * - a casual daily wage's month of basic salary;
 * - an `INDETERMINATE` basis on the last day, a salary schedule the snapshot
 *   did not freeze, or a bonus that is not whole centavos.
 */
@Injectable()
export class YearEndBonusCalculator implements PayrollCalculator {
  calculate(basis: CompensationBasis, context: CalculationContext): CalculatorOutcome {
    const pays = {
      bonus: context.componentCodes.has(YEAR_END_BONUS_COMPONENT_CODE),
      gift: context.componentCodes.has(CASH_GIFT_COMPONENT_CODE),
    };
    const outcome: CalculatorOutcome = { lines: [], exceptions: [] };
    if (!pays.bonus && !pays.gift) return outcome;
    const block = (component: 'bonus' | 'gift' | 'both', type: string, message: string) => {
      const codes = {
        bonus: [YEAR_END_BONUS_COMPONENT_CODE],
        gift: [CASH_GIFT_COMPONENT_CODE],
        both: [YEAR_END_BONUS_COMPONENT_CODE, CASH_GIFT_COMPONENT_CODE],
      }[component].filter((code) => context.componentCodes.has(code));
      if (codes.length > 0) outcome.exceptions.push(blocking(type, message, { components: codes }));
      return outcome;
    };

    const rule = ruleFor(context);
    if ('reason' in rule) return block('both', 'YEAR_END_BONUS_RULE_NOT_IN_SNAPSHOT', rule.reason);
    const { version, parameters } = rule;
    const { serviceFrom, asOf, minimumServiceMonths } = parameters;

    const served = basis.stretches.filter(
      (stretch): stretch is ServedStretch => stretch.personnel !== null,
    );
    const runs = serviceRuns(served);
    const service = serviceMonths(runs, minimumServiceMonths);
    if (service.status === 'UNSETTLED') {
      return block(
        'both',
        'YEAR_END_BONUS_SERVICE_MONTHS_UNSETTLED',
        `Service from ${serviceFrom} to ${asOf} is ${runs.map(spanLabel).join(', ')}. ${service.reason}`,
      );
    }
    const counted = `${service.wholeMonths} whole month${service.wholeMonths === 1 ? '' : 's'} of service from ${serviceFrom} to ${asOf}`;

    const onAsOf = basis.stretches.at(-1);
    if (!onAsOf || onAsOf.to !== asOf) throw new Error('A basis covers its period to the end.');
    if (onAsOf.personnel === null) {
      // RA No. 6686 requires service on the last day; only the GAA grants this case.
      if (service.status === 'NOT_MET' || !parameters.grantsSeparatedBeforeAsOf) return outcome;
      const left = `${counted}, and left the Agency's service on ${runs.at(-1)?.to}, before ${asOf}. ${version.code} grants personnel who retired or were separated from government service then`;
      const record =
        'the record does not show whether the Employee left government service or transferred within it';
      block(
        'bonus',
        'YEAR_END_BONUS_SEPARATED_UNSETTLED',
        `${left} a prorated year-end bonus, but no recorded rule prorates it, and ${record}.`,
      );
      return block(
        'gift',
        'CASH_GIFT_SEPARATED_UNSETTLED',
        `${left} the cash gift, but ${record}.`,
      );
    }
    if (service.status === 'NOT_MET') {
      // No year-end bonus under the minimum (RA No. 6686 sec. 1 as amended).
      return block(
        'gift',
        'CASH_GIFT_UNDER_MINIMUM_SERVICE_UNSETTLED',
        `${counted}, under ${minimumServiceMonths}. RA No. 8441 sec. 2 grants a reduced cash gift by length of service, but its bands are not in rule version ${version.code}.`,
      );
    }
    if (onAsOf.status === 'INDETERMINATE') {
      const reasons = [...new Set(onAsOf.reasons.map((reason) => reason.message))].join(' ');
      return block(
        'both',
        'COMPENSATION_BASIS_INDETERMINATE',
        `The compensation basis on ${asOf} is INDETERMINATE: ${reasons}`,
      );
    }

    const source = {
      serviceFrom,
      asOf,
      wholeMonthsOfService: service.wholeMonths,
      service: runs,
      serviceSegmentId: onAsOf.personnel.serviceSegmentId,
      payBasis: onAsOf.personnel.payBasis,
      employmentFraction: onAsOf.personnel.employmentFraction,
    };
    if (pays.bonus) {
      const bonus = bonusLine(onAsOf, parameters, version, context, source);
      if ('lines' in bonus) outcome.lines.push(...bonus.lines);
      else block('bonus', bonus.exceptionType, bonus.message);
    }
    if (pays.gift) {
      if (served.some((stretch) => stretch.personnel.payBasis === 'PART_TIME_PROPORTIONAL')) {
        block(
          'gift',
          'CASH_GIFT_PART_TIME_UNSETTLED',
          `Served part-time between ${serviceFrom} and ${asOf}, and no recorded rule apportions the cash gift for part-time service.`,
        );
      } else {
        const amount = new Prisma.Decimal(parameters.cashGiftAmount);
        outcome.lines.push({
          componentCode: CASH_GIFT_COMPONENT_CODE,
          lineType: 'EARNING',
          ruleVersionId: version.id,
          quantity: null,
          rate: null,
          amount: amount.toFixed(4),
          source: { ...source, taxTreatment: 'DE_MINIMIS' satisfies TaxTreatment },
        });
      }
    }
    return outcome;
  }
}

/** The one version in the snapshot whose service window is the period's dates. */
function ruleFor(
  context: CalculationContext,
):
  | { version: SnapshotRuleVersion; parameters: YearEndBonusAndCashGiftParameters }
  | { reason: string } {
  const versions = context.snapshotRuleVersions
    .filter((version) => version.ruleKind === YEAR_END_BONUS_RULE_KIND)
    .map((version) => ({
      version,
      parameters: yearEndBonusAndCashGiftParameters.parse(version.parameters),
    }));
  const match = versions.find(
    ({ parameters }) =>
      parameters.serviceFrom === context.periodFrom && parameters.asOf === context.periodTo,
  );
  if (match) return match;
  const others = versions.map(
    ({ version, parameters }) =>
      ` ${version.code} reckons it from ${parameters.serviceFrom} to ${parameters.asOf}.`,
  );
  return {
    reason: `No ${YEAR_END_BONUS_RULE_KIND} rule version in this calculation's rule snapshot reckons service from ${context.periodFrom} to ${context.periodTo}.${others.join('')} A special period that pays the year-end bonus or cash gift covers its rule version's service window.`,
  };
}

function bonusLine(
  onAsOf: Extract<CompensationBasisStretch, { status: 'RESOLVED' }>,
  parameters: YearEndBonusAndCashGiftParameters,
  version: SnapshotRuleVersion,
  context: CalculationContext,
  source: Record<string, unknown>,
): { lines: CalculatedLine[] } | { exceptionType: string; message: string } {
  const { salarySchedule, personnel, rate } = onAsOf;
  if (!context.snapshotRuleVersionIds.has(salarySchedule.ruleVersionId)) {
    return {
      exceptionType: 'SALARY_SCHEDULE_NOT_IN_SNAPSHOT',
      message: `Salary schedule ${salarySchedule.ruleVersionCode} is not in this calculation's rule snapshot; recalculate to take it.`,
    };
  }
  if (rate.monthlyRate === null) {
    return {
      exceptionType: 'YEAR_END_BONUS_CASUAL_UNSETTLED',
      message: `On ${parameters.asOf} the Employee is paid a ${personnel.payBasis} rate, and no recorded rule fixes one month's basic salary for it.`,
    };
  }
  // A part-time Employee's basic salary is already the proportional monthly rate.
  const monthlyRate = new Prisma.Decimal(rate.monthlyRate);
  const amount = monthlyRate.mul(parameters.bonusMonthsOfBasicSalary);
  if (!amount.equals(amount.toDecimalPlaces(2))) {
    return {
      exceptionType: 'YEAR_END_BONUS_ROUNDING_UNSETTLED',
      message: `The year-end bonus ${amount.toFixed()} is not a whole number of centavos, and no recorded rule rounds it.`,
    };
  }
  return {
    lines: [
      {
        componentCode: YEAR_END_BONUS_COMPONENT_CODE,
        lineType: 'EARNING',
        ruleVersionId: version.id,
        quantity: new Prisma.Decimal(parameters.bonusMonthsOfBasicSalary).toFixed(4),
        rate: monthlyRate.toFixed(8),
        amount: amount.toFixed(4),
        source: {
          ...source,
          unit: 'MONTH_OF_BASIC_SALARY',
          salaryGrade: personnel.salaryGrade,
          salaryStep: personnel.salaryStep,
          salarySchedule,
          derivation: rate.derivation,
          taxTreatment: 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS' satisfies TaxTreatment,
        },
      },
    ],
  };
}

/** Served stretches joined where one ends the day before the next starts. */
function serviceRuns(served: readonly ServedStretch[]): ServiceRun[] {
  const runs: ServiceRun[] = [];
  for (const { from, to } of served) {
    const last = runs.at(-1);
    if (last && addDays(last.to, 1) === from) last.to = to;
    else runs.push({ from, to });
  }
  return runs;
}

/**
 * Whether the runs add up to `minimum` whole months. Each run counts its
 * whole calendar months and whether days remain. Leftover days are under a
 * month apiece, so they settle the count unless they might reach it
 * together, which no recorded rule converts.
 */
export function serviceMonths(
  runs: readonly ServiceRun[],
  minimum: number,
): { status: 'MET' | 'NOT_MET'; wholeMonths: number } | { status: 'UNSETTLED'; reason: string } {
  const counts = runs.map((run) => wholeMonths(run.from, run.to));
  if (counts.some((count) => count === null)) {
    return {
      status: 'UNSETTLED',
      reason:
        'Counting its months turns on a month end, such as whether a month from 31 January ends on 27 or 28 February, and no recorded rule settles it.',
    };
  }
  const settled = counts.filter((count) => count !== null);
  const total = settled.reduce((sum, count) => sum + count.months, 0);
  const partial = settled.filter((count) => count.daysLeft).length;
  if (total >= minimum) return { status: 'MET', wholeMonths: total };
  if (total + partial <= minimum) return { status: 'NOT_MET', wholeMonths: total };
  return {
    status: 'UNSETTLED',
    reason: `Its ${total} whole months and the days left over in ${partial} separate stretches might reach ${minimum} months, and no recorded rule adds days into months.`,
  };
}

/**
 * Whole calendar months from `from` through `to`, each month ending the day
 * before the same date of the next, and whether days remain after them. Null
 * when the answer turns on a date a month lacks, such as 31 February.
 */
export function wholeMonths(
  from: string,
  to: string,
): { months: number; daysLeft: boolean } | null {
  const end = addDays(to, 1);
  let months = 0;
  for (;;) {
    const next = monthsAfter(from, months + 1);
    if (next.latest <= end) months += 1;
    else if (next.earliest > end) break;
    else return null;
  }
  const reached = monthsAfter(from, months);
  if (reached.latest < end) return { months, daysLeft: true };
  if (reached.earliest >= end) return { months, daysLeft: false };
  return null;
}

/**
 * The date `months` calendar months after `date`. When the target month lacks
 * the day, the month may end on its last day or the day after it, so both
 * are returned.
 */
function monthsAfter(date: string, months: number): { earliest: string; latest: string } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0));
  if (day <= lastDay.getUTCDate()) {
    const exact = isoDateOf(new Date(Date.UTC(year, month - 1 + months, day)));
    return { earliest: exact, latest: exact };
  }
  return { earliest: isoDateOf(lastDay), latest: addDays(isoDateOf(lastDay), 1) };
}

const addDays = (value: string, days: number) =>
  isoDateOf(new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000));

const spanLabel = ({ from, to }: ServiceRun) => (from === to ? from : `${from} to ${to}`);
