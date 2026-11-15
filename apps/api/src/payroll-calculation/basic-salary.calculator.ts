import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CompensationBasis,
  IndeterminateStretch,
  ResolvedStretch,
} from '../compensation-basis/compensation-basis.service';
import {
  blocking,
  type CalculatedException,
  type CalculationContext,
  type CalculatorOutcome,
  type PayrollCalculator,
} from './payroll-calculator';

export const BASIC_SALARY_COMPONENT_CODE = 'BASIC_SALARY';

/**
 * Basic salary for one full month of service (BRD PAY-002, PAY-003). The
 * monthly full-time and proportional part-time bases pay the monthly rate the
 * compensation basis derived, as one line of one month. Every case no recorded
 * rule settles blocks and writes no line:
 *
 * - an `INDETERMINATE` basis;
 * - service for only part of the month (PAY-002; #622 replaces this);
 * - a casual daily wage, whose paid days in a month no recorded rule fixes;
 * - a rate, pay basis, or salary schedule that changes inside the month, such
 *   as a step increment, which no recorded rule apportions;
 * - an amount that is not whole centavos, which no recorded rule rounds;
 * - a salary schedule the rule snapshot did not freeze.
 */
@Injectable()
export class BasicSalaryCalculator implements PayrollCalculator {
  calculate(basis: CompensationBasis, context: CalculationContext): CalculatorOutcome {
    const exceptions = basisExceptions(basis, context);
    if (exceptions.length > 0) return { lines: [], exceptions };
    const stretches = basis.stretches as ResolvedStretch[];
    const [first] = stretches;
    if (!first) throw new Error('A compensation basis covers at least one date.');

    const unfrozen = stretches.filter(
      (stretch) => !context.snapshotRuleVersionIds.has(stretch.salarySchedule.ruleVersionId),
    );
    if (unfrozen.length > 0) {
      const codes = [...new Set(unfrozen.map((stretch) => stretch.salarySchedule.ruleVersionCode))];
      return refuse(
        'SALARY_SCHEDULE_NOT_IN_SNAPSHOT',
        `Salary schedule ${codes.join(', ')} is not in this calculation's rule snapshot; recalculate to take it.`,
        { ruleVersionIds: [...new Set(unfrozen.map((s) => s.salarySchedule.ruleVersionId))] },
      );
    }
    if (stretches.some((stretch) => stretch.personnel.payBasis === 'CASUAL_DAILY_WAGE')) {
      return refuse(
        'BASIC_SALARY_CASUAL_DAYS_UNSETTLED',
        'No recorded rule fixes how many days a casual daily wage pays in a month, so no basic salary line is written.',
      );
    }
    const change = stretches.find((stretch) => rateKey(stretch) !== rateKey(first));
    if (change) {
      return refuse(
        'BASIC_SALARY_RATE_CHANGE_IN_PERIOD',
        `The monthly rate, pay basis, or salary schedule changes on ${change.from}. No recorded rule apportions basic salary across a change inside the month.`,
        { changesOn: change.from },
      );
    }

    const monthlyRate = first.rate.monthlyRate;
    if (monthlyRate === null) throw new Error('A monthly pay basis derives a monthly rate.');
    const amount = new Prisma.Decimal(monthlyRate);
    if (!amount.equals(amount.toDecimalPlaces(2))) {
      return refuse(
        'BASIC_SALARY_ROUNDING_UNSETTLED',
        `The monthly rate ${monthlyRate} is not a whole number of centavos, and no recorded rule rounds it.`,
        { monthlyRate },
      );
    }
    return {
      lines: [
        {
          componentCode: BASIC_SALARY_COMPONENT_CODE,
          lineType: 'EARNING',
          ruleVersionId: first.salarySchedule.ruleVersionId,
          quantity: new Prisma.Decimal(1).toFixed(4),
          rate: amount.toFixed(8),
          amount: amount.toFixed(4),
          source: {
            unit: 'MONTH',
            payBasis: first.personnel.payBasis,
            employmentFraction: first.personnel.employmentFraction,
            salaryGrade: first.personnel.salaryGrade,
            salaryStep: first.personnel.salaryStep,
            serviceSegments: stretches.map((stretch) => ({
              serviceSegmentId: stretch.personnel.serviceSegmentId,
              from: stretch.from,
              to: stretch.to,
            })),
            salarySchedule: {
              ruleVersionId: first.salarySchedule.ruleVersionId,
              ruleVersionCode: first.salarySchedule.ruleVersionCode,
              monthlyRate: first.salarySchedule.monthlyRate,
            },
            derivation: first.rate.derivation,
          },
        },
      ],
      exceptions: [],
    };
  }
}

/** An unserved date blocks as a partial month; any other unresolved stretch as INDETERMINATE. */
function basisExceptions(
  basis: CompensationBasis,
  context: CalculationContext,
): CalculatedException[] {
  const indeterminate = basis.stretches.filter(
    (stretch): stretch is IndeterminateStretch => stretch.status === 'INDETERMINATE',
  );
  const unserved = indeterminate.filter((stretch) => stretch.personnel === null);
  const unresolved = indeterminate.filter((stretch) => stretch.personnel !== null);
  const exceptions: CalculatedException[] = [];
  if (unserved.length > 0) {
    const dates = unserved.map(({ from, to }) => ({ from, to }));
    exceptions.push(
      blocking(
        'BASIC_SALARY_PARTIAL_MONTH',
        `Served only part of ${context.periodFrom} to ${context.periodTo}: no Service Segment covers ${dates
          .map(({ from, to }) => (from === to ? from : `${from} to ${to}`))
          .join(', ')}. No recorded rule prorates basic salary for a partial month (BRD PAY-002).`,
        { unservedDates: dates },
      ),
    );
  }
  if (unresolved.length > 0) {
    const reasons = unresolved.flatMap((stretch) => stretch.reasons);
    exceptions.push(
      blocking(
        'COMPENSATION_BASIS_INDETERMINATE',
        `The compensation basis is INDETERMINATE: ${[...new Set(reasons.map((reason) => reason.message))].join(' ')}`,
        {
          stretches: unresolved.map(({ from, to, reasons }) => ({ from, to, reasons })),
        },
      ),
    );
  }
  return exceptions;
}

const rateKey = (stretch: ResolvedStretch) =>
  [
    stretch.personnel.payBasis,
    stretch.personnel.employmentFraction,
    stretch.salarySchedule.ruleVersionId,
    stretch.rate.monthlyRate,
  ].join('|');

const refuse = (exceptionType: string, message: string, details?: Record<string, unknown>) => ({
  lines: [],
  exceptions: [blocking(exceptionType, message, details)],
});
