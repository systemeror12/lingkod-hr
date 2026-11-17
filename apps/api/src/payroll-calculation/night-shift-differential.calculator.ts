import { Prisma } from '@prisma/client';
import type {
  CompensationBasis,
  ResolvedStretch,
} from '../compensation-basis/compensation-basis.service';
import {
  isInEffectOn,
  nightShiftDifferentialParameters,
  type NationalPayrollRuleKind,
  type NightShiftDifferentialParameters,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type EmployeePayrollSources,
  type FrozenRuleVersion,
  type NightShiftDifferentialRate,
  type PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE = 'NIGHT_SHIFT_DIFFERENTIAL';
export const NIGHT_SHIFT_DIFFERENTIAL_RULE_KIND: NationalPayrollRuleKind =
  'NIGHT_SHIFT_DIFFERENTIAL';

const AUTHORITY = 'RA No. 11701, sec. 1';

/** One NIGHT_DUTY fact's minutes as Payroll takes them: its delta, `corrected − prior`. */
interface NightMinutes {
  attendancePayrollFactId: string;
  workDate: string;
  minutes: number;
}

interface Group {
  rate: NightShiftDifferentialRate;
  version: FrozenRuleVersion;
  parameters: NightShiftDifferentialParameters;
  stretch: ResolvedStretch & { rate: { monthlyRate: string } };
  facts: NightMinutes[];
}

/**
 * Night-shift differential (RA No. 11701, sec. 1): the approved night hours
 * × the hourly basic rate × the agency head's rate. The hours are
 * Attendance's NIGHT_DUTY facts, worked scheduled-duty minutes between 18:00
 * and 06:00, overtime excluded (#328 decision 8), taken by cutoff (ADR 0014):
 * an original fact counts its minutes and an adjustment only its change. The
 * hourly basic rate is the monthly salary on the Work Date ÷ 22 ÷ 8, and the
 * rate is the approved Authorized Payroll Component Input in effect on the
 * Work Date, the Employee's own before the Agency's, both from the period's
 * rule snapshot. No default rate exists.
 *
 * One taxable `EARNING` line per rate input, rule version, and salary, resting
 * on its facts and its rate input. Every case the recorded rules do not settle
 * blocks and writes no line:
 *
 * - no rate in effect on the Work Date, or two of the same scope;
 * - no rule version in effect on the Work Date, or a rate above its ceiling;
 * - an `INDETERMINATE` basis, part-time service, or a casual daily wage, for
 *   which the statute defines no hourly basic rate;
 * - an amount that is not whole centavos, which no recorded rule rounds.
 *
 * An Employee with no night-duty fact gets no line and no exception.
 */
export class NightShiftDifferentialCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    _earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    const facts = sources.nightDutyFacts
      .map((fact) => ({
        attendancePayrollFactId: fact.id,
        workDate: fact.workDate,
        minutes: fact.correctedMinutes - (fact.priorMinutes ?? 0),
      }))
      .filter((fact) => fact.minutes !== 0);
    if (facts.length === 0) return { lines: [], exceptions: [] };

    const bases = [basis, ...sources.valuationBases];
    const unsettled = new Map<string, { message: string; facts: NightMinutes[] }>();
    const refuse = (exceptionType: string, message: string, fact: NightMinutes) => {
      const entry = unsettled.get(exceptionType) ?? { message, facts: [] };
      entry.facts.push(fact);
      unsettled.set(exceptionType, entry);
    };
    const groups = new Map<string, Group>();

    for (const fact of facts) {
      const { workDate } = fact;
      const inEffect = sources.nightShiftDifferentialRates.filter(
        (rate) =>
          rate.effectiveFrom <= workDate &&
          (rate.effectiveTo === null || workDate <= rate.effectiveTo),
      );
      const own = inEffect.filter((rate) => rate.scope === 'EMPLOYEE');
      const candidates = own.length > 0 ? own : inEffect;
      if (candidates.length === 0) {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_RATE_NOT_IN_EFFECT',
          `The period's rule snapshot holds no approved night-shift differential rate for the Employee or the Agency in effect on these Work Dates. ${AUTHORITY} leaves the rate to the agency head, and no default exists.`,
          fact,
        );
        continue;
      }
      if (candidates.length > 1) {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_RATE_AMBIGUOUS',
          `More than one approved ${candidates[0]!.scope} night-shift differential rate is in effect on these Work Dates, and no recorded rule chooses between them.`,
          fact,
        );
        continue;
      }
      const rate = candidates[0]!;

      const version = context.snapshotRuleVersions.find(
        (candidate) =>
          candidate.ruleKind === NIGHT_SHIFT_DIFFERENTIAL_RULE_KIND &&
          isInEffectOn(candidate, workDate),
      );
      if (!version) {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_RULE_NOT_IN_EFFECT',
          `The period's rule snapshot holds no ${NIGHT_SHIFT_DIFFERENTIAL_RULE_KIND} version in effect on these Work Dates, so their night duty is not paid.`,
          fact,
        );
        continue;
      }
      const parameters = nightShiftDifferentialParameters.parse(version.parameters);
      if (new Prisma.Decimal(rate.rate).greaterThan(parameters.rateCeiling)) {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_RATE_ABOVE_CEILING',
          `The approved rate ${rate.rate} exceeds the ${parameters.rateCeiling} of the hourly basic rate that ${AUTHORITY} allows on these Work Dates.`,
          fact,
        );
        continue;
      }

      const stretch = bases
        .flatMap((candidate) => candidate.stretches)
        .find(({ from, to }) => from <= workDate && workDate <= to);
      if (!stretch) throw new Error(`No compensation basis was resolved for ${workDate}.`);
      if (stretch.status === 'INDETERMINATE') {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_BASIS_INDETERMINATE',
          'The compensation basis is INDETERMINATE on these Work Dates, so no basic monthly rate values their night duty.',
          fact,
        );
        continue;
      }
      if (stretch.personnel.payBasis === 'PART_TIME_PROPORTIONAL') {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_PART_TIME_UNSETTLED',
          `The Employee serves part-time on these Work Dates. ${AUTHORITY} defines the hourly basic rate from the basic monthly rate ÷ 22 ÷ 8, and no recorded rule says which monthly rate a part-time Employee's is.`,
          fact,
        );
        continue;
      }
      const monthlyRate = stretch.rate.monthlyRate;
      if (monthlyRate === null) {
        refuse(
          'NIGHT_SHIFT_DIFFERENTIAL_CASUAL_DAILY_WAGE_UNSETTLED',
          `The Employee is paid a casual daily wage on these Work Dates. ${AUTHORITY} sets the hourly basic rate from a basic monthly rate, and no recorded rule sets it from a daily wage.`,
          fact,
        );
        continue;
      }

      const key = [
        rate.authorizedPayrollComponentInputId,
        version.id,
        stretch.personnel.serviceSegmentId,
        stretch.salarySchedule.ruleVersionId,
        monthlyRate,
      ].join('|');
      const group = groups.get(key) ?? {
        rate,
        version,
        parameters,
        stretch: { ...stretch, rate: { ...stretch.rate, monthlyRate } },
        facts: [],
      };
      group.facts.push(fact);
      groups.set(key, group);
    }

    const exceptions: CalculatedException[] = [...unsettled].map(([type, { message, facts }]) =>
      blocking(type, message, { workDates: [...new Set(facts.map((f) => f.workDate))], facts }),
    );
    const lines: CalculatedLine[] = [];
    for (const group of groups.values()) {
      const outcome = lineOf(group);
      if ('exception' in outcome) exceptions.push(outcome.exception);
      else if (outcome.line) lines.push(outcome.line);
    }
    return { lines, exceptions };
  }
}

function lineOf(
  group: Group,
): { line: CalculatedLine | null } | { exception: CalculatedException } {
  const { rate, version, parameters, stretch, facts } = group;
  const minutes = facts.reduce((sum, fact) => sum + fact.minutes, 0);
  // An adjustment that withdraws exactly what an earlier one added nets to nothing.
  if (minutes === 0) return { line: null };
  const monthlyRate = stretch.rate.monthlyRate;
  const minutesPerMonth = parameters.workingDaysPerMonth * parameters.workHoursPerDay * 60;
  const amount = new Prisma.Decimal(minutes).mul(monthlyRate).mul(rate.rate).div(minutesPerMonth);
  const workDates = [...new Set(facts.map((fact) => fact.workDate))].sort();
  if (!amount.equals(amount.toDecimalPlaces(2))) {
    return {
      exception: blocking(
        'NIGHT_SHIFT_DIFFERENTIAL_ROUNDING_UNSETTLED',
        `${minutes} night minutes at ${monthlyRate} ÷ ${parameters.workingDaysPerMonth} ÷ ${parameters.workHoursPerDay} an hour × ${rate.rate} is ${amount.toString()}, not a whole number of centavos, and no recorded rule rounds the night-shift differential.`,
        {
          workDates,
          facts,
          minutes,
          monthlyRate,
          rate: rate.rate,
          authorizedPayrollComponentInputId: rate.authorizedPayrollComponentInputId,
        },
      ),
    };
  }
  return {
    line: {
      componentCode: NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE,
      lineType: 'EARNING',
      ruleVersionId: version.id,
      quantity: new Prisma.Decimal(minutes).toFixed(4),
      rate: new Prisma.Decimal(monthlyRate).toFixed(8),
      amount: amount.toFixed(4),
      source: {
        unit: 'MINUTE',
        workDates,
        facts,
        nightShiftRate: rate.rate,
        authorizedPayrollComponentInputId: rate.authorizedPayrollComponentInputId,
        rateScope: rate.scope,
        authorityDocumentVersionId: rate.authorityDocumentVersionId,
        monthlyRate,
        salarySchedule: stretch.salarySchedule,
        serviceSegmentId: stretch.personnel.serviceSegmentId,
        ruleVersionCode: version.code,
        parameters,
        formula: `minutes ÷ 60 × monthly salary ÷ ${parameters.workingDaysPerMonth} ÷ ${parameters.workHoursPerDay} × night-shift rate (${AUTHORITY})`,
        taxTreatment: 'SUPPLEMENTARY_COMPENSATION' satisfies TaxTreatment,
      },
      sourceRecords: [
        ...facts.map((fact) => ({ attendancePayrollFactId: fact.attendancePayrollFactId })),
        { authorizedPayrollComponentInputId: rate.authorizedPayrollComponentInputId },
      ],
    },
  };
}
