import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CompensationBasis,
  type ResolvedStretch,
  WORKING_DAYS_PER_MONTH,
} from '../compensation-basis/compensation-basis.service';
import { ruleVersionsInEffectDuring } from '../payroll-periods/payroll-rule-snapshots';
import {
  type NationalPayrollRuleKind,
  peraParameters,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import { BASIC_SALARY_COMPONENT_CODE } from './basic-salary.calculator';
import { DAYS_WITHOUT_PAY_COMPONENT_CODE } from './days-without-pay.calculator';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type FrozenRuleVersion,
  type LineSourceRecord,
  type PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const PERA_COMPONENT_CODE = 'PERA';
const PERA_RULE_KIND: NationalPayrollRuleKind = 'PERA';

const UNCOVERED_CASE =
  'BC No. 2009-3 item 10.0 sends cases its rules do not cover to the DBM for resolution, so no PERA is calculated.';

/**
 * The Personnel Economic Relief Allowance of a regular Payroll Period (FY 2026
 * GAA sec. 63; DBM BC No. 2009-3 as amended by BC No. 2011-2;
 * docs/research/pera-authorities.md). It runs after basic salary and salary
 * for days without pay, and pays one `EARNING` line from the PERA version's
 * amounts:
 *
 * - the monthly amount for a full month of full-time service (item 5.2);
 * - the daily amount for each day with basic pay, `22 − days without pay`,
 *   when the month has days without pay (item 5.4, CSC MC No. 8, s. 2014);
 * - the monthly amount in proportion to a part-time employment fraction
 *   (item 5.6).
 *
 * PERA is paid only with basic pay (item 5.1): with no basic salary line, or
 * no day with basic pay, it writes nothing, and basic salary's own exception
 * explains why. A detailed Employee is paid by their own Agency (item 5.7),
 * which is the Agency whose payroll this is. The line is not subject to income
 * tax (RR No. 11-2018 sec. 2.79(B)). Every case the rules do not settle
 * blocks and writes no line:
 *
 * - no PERA version in effect on every date of the month, or one that changes
 *   inside it;
 * - service for only part of the month, which item 5.2 does not grant and no
 *   item prorates;
 * - days without pay in another month, which change PERA an earlier payroll
 *   paid on a day count this calculation does not read;
 * - part-time service with days without pay, which no item combines;
 * - a casual daily wage, whose paid days no recorded rule fixes (item 5.5);
 * - an amount that is not whole centavos, which no recorded rule rounds.
 */
@Injectable()
export class PeraCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
  ): CalculatorOutcome {
    const exceptions: CalculatedException[] = [];
    const unserved = basis.stretches.filter((stretch) => stretch.personnel === null);
    if (unserved.length > 0) {
      exceptions.push(
        blocking(
          'PERA_PARTIAL_MONTH',
          `Served only part of ${context.periodFrom} to ${context.periodTo}. BC No. 2009-3 item 5.2 grants the monthly PERA for full-time service of 22 working days a month, and its items 5.4 to 5.6 reduce it only for days without pay, casual daily pay, and part-time service. ${UNCOVERED_CASE}`,
          { unservedDates: unserved.map(({ from, to }) => ({ from, to })) },
        ),
      );
    }
    const version = versionFor(context, exceptions);
    if (exceptions.length > 0 || !version) return { lines: [], exceptions };

    const [basicSalary, ...more] = earlierLines.filter(
      (line) => line.componentCode === BASIC_SALARY_COMPONENT_CODE,
    );
    if (!basicSalary) return { lines: [], exceptions: [] };
    if (more.length > 0) throw new Error('Basic salary writes at most one line a month.');
    // A basic salary line means every stretch is resolved on one rate.
    const stretch = basis.stretches[0] as ResolvedStretch;
    const parameters = peraParameters.parse(version.parameters);
    const days = daysWithoutPay(earlierLines, context.periodFrom.slice(0, 7));

    if (days.otherMonths.length > 0) {
      return refuse(
        'PERA_OTHER_MONTH_DAYS_WITHOUT_PAY_UNSETTLED',
        `Days without pay dated in ${days.otherMonths.join(', ')} change the PERA of that month. BC No. 2009-3 item 5.4 computes a month's PERA from all of its days with basic pay, and this calculation does not read the days an earlier payroll counted for that month, so the difference is not calculated.`,
        { months: days.otherMonths },
      );
    }
    const source = {
      ruleVersionCode: version.code,
      parameters,
      basedOn: { componentCode: basicSalary.componentCode, amount: basicSalary.amount },
      payBasis: stretch.personnel.payBasis,
      employmentFraction: stretch.personnel.employmentFraction,
      taxTreatment: 'NON_TAXABLE' satisfies TaxTreatment,
    };

    switch (stretch.personnel.payBasis) {
      case 'CASUAL_DAILY_WAGE':
        return refuse(
          'PERA_CASUAL_DAYS_UNSETTLED',
          `BC No. 2009-3 item 5.5 sets the PERA of casual personnel paid daily at ${parameters.dailyAmount} a day, but no recorded rule fixes how many days a casual daily wage pays in a month.`,
        );
      case 'PART_TIME_PROPORTIONAL': {
        if (!days.inMonth.isZero()) {
          return refuse(
            'PERA_PART_TIME_DAYS_WITHOUT_PAY_UNSETTLED',
            `${days.inMonth.toString()} days without pay in a month of part-time service. BC No. 2009-3 items 5.4 and 5.6 each set PERA for one case, and neither says how to combine them. ${UNCOVERED_CASE}`,
            { daysWithoutPay: days.inMonth.toFixed(4) },
          );
        }
        const fraction = stretch.personnel.employmentFraction;
        if (fraction === null)
          throw new Error('A part-time basis carries its employment fraction.');
        return lineOf(version, new Prisma.Decimal(fraction), parameters.monthlyAmount, {
          ...source,
          unit: 'EMPLOYMENT_FRACTION',
          formula: 'employment fraction × monthly PERA (BC No. 2009-3 item 5.6)',
        });
      }
      case 'MONTHLY_FULL_TIME': {
        if (days.inMonth.isZero()) {
          return lineOf(version, new Prisma.Decimal(1), parameters.monthlyAmount, {
            ...source,
            unit: 'MONTH',
            formula: 'monthly PERA for full-time service (BC No. 2009-3 item 5.2)',
          });
        }
        if (days.inMonth.isNegative()) {
          return refuse(
            'PERA_OTHER_MONTH_DAYS_WITHOUT_PAY_UNSETTLED',
            `The days without pay in ${context.periodFrom.slice(0, 7)} net to ${days.inMonth.toString()}, which withdraws days an earlier payroll counted. This calculation does not read that payroll's count, so the PERA difference is not calculated.`,
            { daysWithoutPay: days.inMonth.toFixed(4) },
          );
        }
        const daysWithBasicPay = new Prisma.Decimal(WORKING_DAYS_PER_MONTH).sub(days.inMonth);
        if (daysWithBasicPay.lte(0)) return { lines: [], exceptions: [] };
        return lineOf(
          version,
          daysWithBasicPay,
          parameters.dailyAmount,
          {
            ...source,
            unit: 'DAY',
            daysWithoutPay: days.inMonth.toFixed(4),
            formula: '(22 − days without pay) × daily PERA (BC No. 2009-3 item 5.4)',
          },
          days.sourceRecords,
        );
      }
    }
  }
}

/** The one PERA version in effect on every date of the period, or the exception that stops it. */
function versionFor(
  context: CalculationContext,
  exceptions: CalculatedException[],
): FrozenRuleVersion | undefined {
  const versions = context.snapshotRuleVersions.filter(
    (version) => version.ruleKind === PERA_RULE_KIND,
  );
  const coverage = ruleVersionsInEffectDuring(
    PERA_RULE_KIND,
    versions,
    context.periodFrom,
    context.periodTo,
  );
  if (coverage.status === 'NOT_IN_EFFECT') {
    exceptions.push(
      blocking('PERA_RULE_NOT_IN_EFFECT', `${coverage.reason} PERA is not calculated without it.`, {
        ruleKind: PERA_RULE_KIND,
      }),
    );
    return undefined;
  }
  if (coverage.ruleVersionIds.length > 1) {
    exceptions.push(
      blocking(
        'PERA_RULE_CHANGE_IN_PERIOD',
        `The PERA version changes inside ${context.periodFrom} to ${context.periodTo}. No recorded rule apportions PERA across a change inside the month.`,
        { ruleVersionIds: coverage.ruleVersionIds },
      ),
    );
    return undefined;
  }
  return versions.find((version) => version.id === coverage.ruleVersionIds[0]);
}

/**
 * The days without pay that salary for days without pay deducted: their net
 * in the period's month with the sources behind them, and the other months
 * it deducted days in.
 */
function daysWithoutPay(earlierLines: readonly CalculatedLine[], periodMonth: string) {
  let inMonth = new Prisma.Decimal(0);
  const otherMonths = new Set<string>();
  const sourceRecords: LineSourceRecord[] = [];
  for (const line of earlierLines) {
    if (line.componentCode !== DAYS_WITHOUT_PAY_COMPONENT_CODE) continue;
    const { month } = line.source;
    if (typeof month !== 'string' || line.quantity === null) {
      throw new Error('A days-without-pay line records its month and days.');
    }
    if (month !== periodMonth) {
      otherMonths.add(month);
      continue;
    }
    inMonth = inMonth.add(line.quantity);
    sourceRecords.push(...(line.sourceRecords ?? []));
  }
  return { inMonth, otherMonths: [...otherMonths].sort(), sourceRecords };
}

function lineOf(
  version: FrozenRuleVersion,
  quantity: Prisma.Decimal,
  rate: string,
  source: Record<string, unknown>,
  sourceRecords: LineSourceRecord[] = [],
): CalculatorOutcome {
  const amount = quantity.mul(rate);
  if (!amount.equals(amount.toDecimalPlaces(2))) {
    return refuse(
      'PERA_ROUNDING_UNSETTLED',
      `${quantity.toString()} × ${rate} is not a whole number of centavos, and no recorded rule rounds PERA.`,
      { quantity: quantity.toFixed(4), rate },
    );
  }
  return {
    lines: [
      {
        componentCode: PERA_COMPONENT_CODE,
        lineType: 'EARNING',
        ruleVersionId: version.id,
        quantity: quantity.toFixed(4),
        rate: new Prisma.Decimal(rate).toFixed(8),
        amount: amount.toFixed(4),
        source,
        ...(sourceRecords.length > 0 ? { sourceRecords } : {}),
      },
    ],
    exceptions: [],
  };
}

const refuse = (
  exceptionType: string,
  message: string,
  details: Record<string, unknown> = {},
): CalculatorOutcome => ({ lines: [], exceptions: [blocking(exceptionType, message, details)] });
