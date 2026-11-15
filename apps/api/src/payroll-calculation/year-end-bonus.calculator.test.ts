import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
} from '../compensation-basis/compensation-basis.service';
import type { CalculationContext } from './payroll-calculator';
import {
  CASH_GIFT_COMPONENT_CODE,
  serviceMonths,
  wholeMonths,
  YEAR_END_BONUS_COMPONENT_CODE,
  YEAR_END_BONUS_RULE_KIND,
  YearEndBonusCalculator,
} from './year-end-bonus.calculator';

// Test fixtures only: the parameters mirror the FY 2026 GAA sec. 75 figures
// the research register records (R9 to R11), and the rate is SG-11 step 1.
const parameters = {
  serviceFrom: '2026-01-01',
  asOf: '2026-10-31',
  minimumServiceMonths: 4,
  bonusMonthsOfBasicSalary: 1,
  cashGiftAmount: '5000.00',
  grantsSeparatedBeforeAsOf: true,
};
const calculator = new YearEndBonusCalculator();
const openEnded = { effectiveFrom: '2026-01-01', effectiveTo: null, successorEffectiveFrom: null };

function contextWith(
  overrides: Partial<CalculationContext> & { rule?: Record<string, unknown> } = {},
): CalculationContext {
  const { rule, ...rest } = overrides;
  return {
    periodFrom: '2026-01-01',
    periodTo: '2026-10-31',
    snapshotRuleVersionIds: new Set(['schedule-a', 'yeb-2026']),
    snapshotRuleVersions: [
      {
        id: 'schedule-a',
        code: 'SSL-TEST',
        ruleKind: 'SALARY_SCHEDULE',
        ...openEnded,
        parameters: {},
      },
      {
        id: 'yeb-2026',
        code: 'YEB-TEST-2026',
        ruleKind: YEAR_END_BONUS_RULE_KIND,
        ...openEnded,
        parameters: { ...parameters, ...rule },
      },
    ],
    componentCodes: new Set([YEAR_END_BONUS_COMPONENT_CODE, CASH_GIFT_COMPONENT_CODE]),
    ...rest,
  };
}

type Served = [from: string, to: string, payBasis?: PayBasis, fraction?: string];

/** A basis from 1 January to 31 October: the served stretches given, unserved between. */
function basisOf(...served: Served[]): CompensationBasis {
  const stretches: CompensationBasisStretch[] = [];
  let next = '2026-01-01';
  const unserved = (from: string, to: string): CompensationBasisStretch => ({
    status: 'INDETERMINATE',
    from,
    to,
    personnel: null,
    salarySchedule: null,
    reasons: [
      { code: 'NO_SERVICE_SEGMENT', message: `No Service Segment covers ${from} to ${to}.` },
    ],
  });
  for (const [from, to, payBasis = 'MONTHLY_FULL_TIME', fraction] of served) {
    if (from > next) stretches.push(unserved(next, dayBefore(from)));
    const monthlyRate =
      payBasis === 'CASUAL_DAILY_WAGE'
        ? null
        : payBasis === 'PART_TIME_PROPORTIONAL'
          ? String(31705 * Number(fraction))
          : '31705';
    stretches.push({
      status: 'RESOLVED',
      from,
      to,
      personnel: {
        serviceSegmentId: `segment-${from}`,
        salaryGrade: 11,
        salaryStep: 1,
        payBasis,
        employmentFraction: fraction ?? null,
      },
      salarySchedule: {
        ruleVersionId: 'schedule-a',
        ruleVersionCode: 'SSL-TEST',
        monthlyRate: '31705',
      },
      rate: { monthlyRate, dailyRate: '1441.13636363636363636364', derivation: 'test derivation' },
    });
    next = dayAfter(to);
  }
  if (next <= '2026-10-31') stretches.push(unserved(next, '2026-10-31'));
  return {
    employeeId: 'employee-1',
    from: '2026-01-01',
    to: '2026-10-31',
    status: stretches.every((stretch) => stretch.status === 'RESOLVED')
      ? 'RESOLVED'
      : 'INDETERMINATE',
    stretches,
  };
}

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayBefore = (date: string) => shift(date, -1);
const dayAfter = (date: string) => shift(date, 1);

const calculate = (basis: CompensationBasis, context = contextWith()) =>
  calculator.calculate(basis, context);
const amounts = (basis: CompensationBasis, context?: CalculationContext) =>
  calculate(basis, context).lines.map((line) => [line.componentCode, line.amount]);
const exceptionTypes = (basis: CompensationBasis, context?: CalculationContext) =>
  calculate(basis, context).exceptions.map((exception) => exception.exceptionType);

describe('year-end bonus and cash gift', () => {
  it('pays one month of basic salary as of 31 October and the cash gift, from the rule version', () => {
    const outcome = calculate(basisOf(['2026-01-01', '2026-10-31']));
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      {
        componentCode: 'YEAR_END_BONUS',
        lineType: 'EARNING',
        ruleVersionId: 'yeb-2026',
        quantity: '1.0000',
        rate: '31705.00000000',
        amount: '31705.0000',
        source: expect.objectContaining({
          asOf: '2026-10-31',
          wholeMonthsOfService: 10,
          salarySchedule: expect.objectContaining({ ruleVersionId: 'schedule-a' }),
          taxTreatment: 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS',
        }),
      },
      {
        componentCode: 'CASH_GIFT',
        lineType: 'EARNING',
        ruleVersionId: 'yeb-2026',
        quantity: null,
        rate: null,
        amount: '5000.0000',
        source: expect.objectContaining({ taxTreatment: 'DE_MINIMIS' }),
      },
    ]);
    // The amounts are the version's, not constants.
    expect(
      amounts(
        basisOf(['2026-01-01', '2026-10-31']),
        contextWith({ rule: { cashGiftAmount: '6000', bonusMonthsOfBasicSalary: 2 } }),
      ),
    ).toEqual([
      ['YEAR_END_BONUS', '63410.0000'],
      ['CASH_GIFT', '6000.0000'],
    ]);
  });

  it('counts four months to the day: from 1 July qualifies, from 2 July does not', () => {
    expect(amounts(basisOf(['2026-07-01', '2026-10-31']))).toEqual([
      ['YEAR_END_BONUS', '31705.0000'],
      ['CASH_GIFT', '5000.0000'],
    ]);
    // No bonus under four months; the statute's reduced cash gift has no bands on record.
    const late = calculate(basisOf(['2026-07-02', '2026-10-31']));
    expect(late.lines).toEqual([]);
    expect(late.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'CASH_GIFT_UNDER_MINIMUM_SERVICE_UNSETTLED',
        severity: 'BLOCKING',
        details: expect.objectContaining({ components: ['CASH_GIFT'] }),
      }),
    ]);
    // The threshold is the version's.
    expect(
      amounts(
        basisOf(['2026-07-02', '2026-10-31']),
        contextWith({ rule: { minimumServiceMonths: 3 } }),
      ),
    ).toHaveLength(2);
  });

  it('adds separate stretches of service, and blocks when leftover days might reach the minimum', () => {
    // Two whole months in each stretch.
    expect(
      amounts(basisOf(['2026-01-01', '2026-02-28'], ['2026-09-01', '2026-10-31'])),
    ).toHaveLength(2);
    // Under a month plus three: short of four whichever way the days are counted.
    expect(
      exceptionTypes(basisOf(['2026-01-15', '2026-02-10'], ['2026-08-01', '2026-10-31'])),
    ).toEqual(['CASH_GIFT_UNDER_MINIMUM_SERVICE_UNSETTLED']);
    // One month and days, plus two months and days: perhaps four.
    expect(
      exceptionTypes(basisOf(['2026-01-15', '2026-02-28'], ['2026-08-20', '2026-10-31'])),
    ).toEqual(['YEAR_END_BONUS_SERVICE_MONTHS_UNSETTLED']);
  });

  it('pays a part-time Employee one month of their proportional salary, and blocks the cash gift', () => {
    const outcome = calculate(
      basisOf(['2026-01-01', '2026-10-31', 'PART_TIME_PROPORTIONAL', '0.5']),
    );
    expect(outcome.lines.map((line) => [line.componentCode, line.amount])).toEqual([
      ['YEAR_END_BONUS', '15852.5000'],
    ]);
    expect(outcome.lines[0]?.source).toMatchObject({
      payBasis: 'PART_TIME_PROPORTIONAL',
      employmentFraction: '0.5',
    });
    expect(outcome.exceptions.map((exception) => exception.exceptionType)).toEqual([
      'CASH_GIFT_PART_TIME_UNSETTLED',
    ]);
    // Part-time service earlier in the year leaves the cash gift unsettled too.
    expect(
      exceptionTypes(
        basisOf(
          ['2026-01-01', '2026-05-31', 'PART_TIME_PROPORTIONAL', '0.5'],
          ['2026-06-01', '2026-10-31'],
        ),
      ),
    ).toEqual(['CASH_GIFT_PART_TIME_UNSETTLED']);
  });

  it('blocks a separated Employee with four months, and pays nothing without them', () => {
    const separated = calculate(basisOf(['2026-01-01', '2026-05-31']));
    expect(separated.lines).toEqual([]);
    expect(separated.exceptions.map((exception) => exception.exceptionType)).toEqual([
      'YEAR_END_BONUS_SEPARATED_UNSETTLED',
      'CASH_GIFT_SEPARATED_UNSETTLED',
    ]);
    expect(separated.exceptions[0]?.details.message).toContain(
      "left the Agency's service on 2026-05-31",
    );
    // A version without the GAA's separated case grants nothing after the Employee leaves.
    expect(
      calculate(
        basisOf(['2026-01-01', '2026-05-31']),
        contextWith({ rule: { grantsSeparatedBeforeAsOf: false } }),
      ),
    ).toEqual({ lines: [], exceptions: [] });
    expect(calculate(basisOf(['2026-01-01', '2026-03-31']))).toEqual({ lines: [], exceptions: [] });
  });

  it('pays only the components the special period names', () => {
    const giftOnly = contextWith({ componentCodes: new Set([CASH_GIFT_COMPONENT_CODE]) });
    expect(amounts(basisOf(['2026-01-01', '2026-10-31']), giftOnly)).toEqual([
      ['CASH_GIFT', '5000.0000'],
    ]);
    expect(
      calculate(basisOf(['2026-01-01', '2026-10-31']), contextWith({ componentCodes: new Set() })),
    ).toEqual({ lines: [], exceptions: [] });
    expect(
      calculate(basisOf(['2026-01-01', '2026-05-31']), giftOnly).exceptions.map(
        (exception) => exception.details.components,
      ),
    ).toEqual([['CASH_GIFT']]);
  });

  it('blocks a casual daily wage bonus, an unfrozen schedule, and a period off the service window', () => {
    const casual = calculate(basisOf(['2026-01-01', '2026-10-31', 'CASUAL_DAILY_WAGE']));
    expect(casual.lines.map((line) => line.componentCode)).toEqual(['CASH_GIFT']);
    expect(casual.exceptions.map((exception) => exception.exceptionType)).toEqual([
      'YEAR_END_BONUS_CASUAL_UNSETTLED',
    ]);
    expect(
      exceptionTypes(
        basisOf(['2026-01-01', '2026-10-31']),
        contextWith({ snapshotRuleVersionIds: new Set(['yeb-2026']) }),
      ),
    ).toEqual(['SALARY_SCHEDULE_NOT_IN_SNAPSHOT']);

    const offWindow = calculate(
      { ...basisOf(['2026-01-01', '2026-10-31']), to: '2026-11-30' },
      contextWith({ periodFrom: '2026-11-01', periodTo: '2026-11-30' }),
    );
    expect(offWindow.lines).toEqual([]);
    expect(offWindow.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'YEAR_END_BONUS_RULE_NOT_IN_SNAPSHOT',
        details: expect.objectContaining({
          message: expect.stringContaining(
            'YEB-TEST-2026 reckons it from 2026-01-01 to 2026-10-31',
          ),
          components: ['YEAR_END_BONUS', 'CASH_GIFT'],
        }),
      }),
    ]);
    expect(
      exceptionTypes(
        basisOf(['2026-01-01', '2026-10-31']),
        contextWith({ snapshotRuleVersions: [] }),
      ),
    ).toEqual(['YEAR_END_BONUS_RULE_NOT_IN_SNAPSHOT']);
  });

  it('blocks an INDETERMINATE basis on 31 October', () => {
    const basis = basisOf(['2026-01-01', '2026-10-31']);
    basis.stretches = [
      {
        status: 'INDETERMINATE',
        from: '2026-01-01',
        to: '2026-10-31',
        personnel: {
          serviceSegmentId: 'segment-a',
          salaryGrade: 11,
          salaryStep: 1,
          payBasis: null,
          employmentFraction: null,
        },
        salarySchedule: null,
        reasons: [{ code: 'MISSING_PAY_BASIS', message: 'Personnel records no pay basis.' }],
      },
    ];
    expect(exceptionTypes(basis)).toEqual(['COMPENSATION_BASIS_INDETERMINATE']);
  });
});

describe('months of service', () => {
  it('counts whole calendar months and the days left', () => {
    expect(wholeMonths('2026-07-01', '2026-10-31')).toEqual({ months: 4, daysLeft: false });
    expect(wholeMonths('2026-07-02', '2026-10-31')).toEqual({ months: 3, daysLeft: true });
    expect(wholeMonths('2026-01-31', '2026-10-31')).toEqual({ months: 9, daysLeft: true });
    expect(wholeMonths('2026-10-31', '2026-10-31')).toEqual({ months: 0, daysLeft: true });
  });

  it('refuses a count that turns on a missing month end', () => {
    // A month from 31 January ends on 27 or 28 February by convention, which no rule sets.
    expect(wholeMonths('2026-01-31', '2026-02-27')).toBeNull();
    expect(wholeMonths('2026-01-31', '2026-02-28')).toBeNull();
    expect(wholeMonths('2026-01-31', '2026-03-30')).toEqual({ months: 2, daysLeft: false });
    expect(serviceMonths([{ from: '2026-05-31', to: '2026-09-29' }], 4)).toMatchObject({
      status: 'UNSETTLED',
    });
  });
});
