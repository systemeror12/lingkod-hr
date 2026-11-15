import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
  ResolvedStretch,
} from '../compensation-basis/compensation-basis.service';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import { calculationHash, canonicalJson } from './calculation-hash';

const calculator = new BasicSalaryCalculator();
const context = {
  periodFrom: '2026-03-01',
  periodTo: '2026-03-31',
  snapshotRuleVersionIds: new Set(['schedule-a']),
};

function resolved(
  from: string,
  to: string,
  overrides: {
    payBasis?: PayBasis;
    employmentFraction?: string | null;
    salaryStep?: number;
    scheduleRate?: string;
    monthlyRate?: string | null;
    dailyRate?: string;
    ruleVersionId?: string;
  } = {},
): ResolvedStretch {
  const scheduleRate = overrides.scheduleRate ?? '31705';
  return {
    status: 'RESOLVED',
    from,
    to,
    personnel: {
      serviceSegmentId: `segment-${from}`,
      salaryGrade: 11,
      salaryStep: overrides.salaryStep ?? 1,
      payBasis: overrides.payBasis ?? 'MONTHLY_FULL_TIME',
      employmentFraction: overrides.employmentFraction ?? null,
    },
    salarySchedule: {
      ruleVersionId: overrides.ruleVersionId ?? 'schedule-a',
      ruleVersionCode: 'SSL-TEST',
      monthlyRate: scheduleRate,
    },
    rate: {
      monthlyRate: overrides.monthlyRate === undefined ? scheduleRate : overrides.monthlyRate,
      dailyRate: overrides.dailyRate ?? '1441.13636363636363636364',
      derivation: 'test derivation',
    },
  };
}

const basisOf = (...stretches: CompensationBasisStretch[]): CompensationBasis => ({
  employeeId: 'employee-1',
  from: context.periodFrom,
  to: context.periodTo,
  status: stretches.every((stretch) => stretch.status === 'RESOLVED')
    ? 'RESOLVED'
    : 'INDETERMINATE',
  stretches,
});

const exceptionTypes = (basis: CompensationBasis) =>
  calculator.calculate(basis, context).exceptions.map((exception) => exception.exceptionType);

describe('BasicSalaryCalculator', () => {
  it('pays a full month on the monthly full-time basis as one line of one month', () => {
    const outcome = calculator.calculate(basisOf(resolved('2026-03-01', '2026-03-31')), context);

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: 'BASIC_SALARY',
        lineType: 'EARNING',
        ruleVersionId: 'schedule-a',
        quantity: '1.0000',
        rate: '31705.00000000',
        amount: '31705.0000',
        source: expect.objectContaining({
          unit: 'MONTH',
          payBasis: 'MONTHLY_FULL_TIME',
          serviceSegments: [
            { serviceSegmentId: 'segment-2026-03-01', from: '2026-03-01', to: '2026-03-31' },
          ],
          salarySchedule: {
            ruleVersionId: 'schedule-a',
            ruleVersionCode: 'SSL-TEST',
            monthlyRate: '31705',
          },
        }),
      }),
    ]);
  });

  it('pays the proportional part-time monthly rate the basis derived', () => {
    const outcome = calculator.calculate(
      basisOf(
        resolved('2026-03-01', '2026-03-31', {
          payBasis: 'PART_TIME_PROPORTIONAL',
          employmentFraction: '0.5',
          monthlyRate: '15852.5',
        }),
      ),
      context,
    );

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines[0]).toMatchObject({ rate: '15852.50000000', amount: '15852.5000' });
  });

  it('keeps one line across Service Segments that change no rate', () => {
    const outcome = calculator.calculate(
      basisOf(resolved('2026-03-01', '2026-03-14'), resolved('2026-03-15', '2026-03-31')),
      context,
    );

    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0]?.source.serviceSegments).toHaveLength(2);
  });

  it('blocks a casual daily wage, whose paid days no recorded rule fixes', () => {
    const basis = basisOf(
      resolved('2026-03-01', '2026-03-31', { payBasis: 'CASUAL_DAILY_WAGE', monthlyRate: null }),
    );

    expect(calculator.calculate(basis, context).lines).toEqual([]);
    expect(exceptionTypes(basis)).toEqual(['BASIC_SALARY_CASUAL_DAYS_UNSETTLED']);
  });

  it('blocks a step increment inside the month and writes no line', () => {
    const basis = basisOf(
      resolved('2026-03-01', '2026-03-09'),
      resolved('2026-03-10', '2026-03-31', { salaryStep: 2, scheduleRate: '32014' }),
    );
    const outcome = calculator.calculate(basis, context);

    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions).toEqual([
      {
        exceptionType: 'BASIC_SALARY_RATE_CHANGE_IN_PERIOD',
        severity: 'BLOCKING',
        details: expect.objectContaining({
          changesOn: '2026-03-10',
          message: expect.stringContaining('changes on 2026-03-10'),
        }),
      },
    ]);
  });

  it('blocks a part of the month no Service Segment covers, naming the dates', () => {
    const outcome = calculator.calculate(
      basisOf(
        {
          status: 'INDETERMINATE',
          from: '2026-03-01',
          to: '2026-03-15',
          personnel: null,
          salarySchedule: null,
          reasons: [{ code: 'NO_SERVICE_SEGMENT', message: 'No Service Segment covers it.' }],
        },
        resolved('2026-03-16', '2026-03-31'),
      ),
      context,
    );

    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'BASIC_SALARY_PARTIAL_MONTH',
        severity: 'BLOCKING',
        details: expect.objectContaining({
          unservedDates: [{ from: '2026-03-01', to: '2026-03-15' }],
          message: expect.stringContaining('2026-03-01 to 2026-03-15'),
        }),
      }),
    ]);
  });

  it('blocks an INDETERMINATE basis with its reasons', () => {
    const outcome = calculator.calculate(
      basisOf({
        status: 'INDETERMINATE',
        from: '2026-03-01',
        to: '2026-03-31',
        personnel: {
          serviceSegmentId: 'segment-1',
          salaryGrade: 11,
          salaryStep: 1,
          payBasis: null,
          employmentFraction: null,
        },
        salarySchedule: null,
        reasons: [
          {
            code: 'MISSING_PAY_BASIS',
            message: 'Personnel records no pay basis for the Service Segment.',
          },
        ],
      }),
      context,
    );

    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'COMPENSATION_BASIS_INDETERMINATE',
        details: expect.objectContaining({
          message: expect.stringContaining('records no pay basis'),
          stretches: [
            expect.objectContaining({
              reasons: [expect.objectContaining({ code: 'MISSING_PAY_BASIS' })],
            }),
          ],
        }),
      }),
    ]);
  });

  it('blocks a salary schedule the rule snapshot did not freeze', () => {
    const basis = basisOf(resolved('2026-03-01', '2026-03-31', { ruleVersionId: 'schedule-b' }));

    expect(exceptionTypes(basis)).toEqual(['SALARY_SCHEDULE_NOT_IN_SNAPSHOT']);
  });

  it('blocks a monthly rate that is not whole centavos rather than round it', () => {
    const basis = basisOf(
      resolved('2026-03-01', '2026-03-31', {
        payBasis: 'PART_TIME_PROPORTIONAL',
        employmentFraction: '0.625',
        monthlyRate: '19815.625',
      }),
    );

    expect(exceptionTypes(basis)).toEqual(['BASIC_SALARY_ROUNDING_UNSETTLED']);
  });
});

describe('calculationHash', () => {
  it('depends on values, not key order', () => {
    expect(canonicalJson({ b: [{ y: 1, x: 2 }], a: null })).toBe('{"a":null,"b":[{"x":2,"y":1}]}');
    expect(calculationHash({ a: 1, b: { c: '2' } })).toBe(calculationHash({ b: { c: '2' }, a: 1 }));
    expect(calculationHash({ a: 1 })).not.toBe(calculationHash({ a: 2 }));
    expect(calculationHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
