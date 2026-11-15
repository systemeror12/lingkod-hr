import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  ResolvedStretch,
} from '../compensation-basis/compensation-basis.service';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import type { EmployeePayrollSources, PendingPayrollInput } from './payroll-calculator';

// Test fixtures only: the rates are not from any issuance. 44,000 and 46,200
// divide by 22 into whole pesos, so their day amounts are whole centavos.
const calculator = new DaysWithoutPayCalculator();
const context = {
  periodFrom: '2026-03-01',
  periodTo: '2026-03-31',
  snapshotRuleVersionIds: new Set(['schedule-a']),
  snapshotRuleVersions: [],
};

function resolved(
  from: string,
  to: string,
  monthlyRate: string | null = '44000',
  ruleVersionId = 'schedule-a',
): ResolvedStretch {
  return {
    status: 'RESOLVED',
    from,
    to,
    personnel: {
      serviceSegmentId: `segment-${from}`,
      salaryGrade: 11,
      salaryStep: 1,
      payBasis: monthlyRate === null ? 'CASUAL_DAILY_WAGE' : 'MONTHLY_FULL_TIME',
      employmentFraction: null,
    },
    salarySchedule: { ruleVersionId, ruleVersionCode: 'SSL-TEST', monthlyRate: '44000' },
    rate: { monthlyRate, dailyRate: '2000', derivation: 'test derivation' },
  };
}

const basisOf = (from: string, to: string, ...stretches: CompensationBasisStretch[]) =>
  ({
    employeeId: 'employee-1',
    from,
    to,
    status: stretches.every((stretch) => stretch.status === 'RESOLVED')
      ? 'RESOLVED'
      : 'INDETERMINATE',
    stretches,
  }) satisfies CompensationBasis as CompensationBasis;

const march = basisOf('2026-03-01', '2026-03-31', resolved('2026-03-01', '2026-03-31'));

function lwop(id: string, dates: string[], unitCode = 'WORKING_DAY'): PendingPayrollInput {
  return {
    id,
    inputKind: 'LEAVE_WITHOUT_PAY',
    sourceType: 'LeavePosting',
    sourceId: `posting-${id}`,
    effectiveDate: dates[0]!,
    quantity: `${dates.length}.0000`,
    payloadSnapshot: {
      unitCode,
      workDates: dates.map((workDate) => ({ workDate, quantity: '1.0000' })),
    },
  };
}

function absence(
  id: string,
  workDate: string,
  minutes: number,
  options: { prior?: number; publicationId?: string; expected?: number } = {},
): EmployeePayrollSources['absenceFacts'][number] {
  return {
    id,
    publicationId: options.publicationId ?? 'publication-original',
    publicationType: options.prior === undefined ? 'ORIGINAL' : 'ADJUSTMENT',
    employeeId: 'employee-1',
    workDate,
    correctedMinutes: minutes,
    priorMinutes: options.prior ?? null,
    expectedMinutes: options.expected ?? 480,
  };
}

const sourcesOf = (overrides: Partial<EmployeePayrollSources> = {}): EmployeePayrollSources => ({
  payrollInputs: [],
  absenceFacts: [],
  unchargedDeficitFacts: [],
  valuationBases: [],
  ...overrides,
});

const run = (sources: EmployeePayrollSources, basis = march) =>
  calculator.calculate(basis, context, [], sources);

const exceptionTypes = (sources: EmployeePayrollSources, basis = march) =>
  run(sources, basis).exceptions.map((exception) => exception.exceptionType);

describe('DaysWithoutPayCalculator', () => {
  it('deducts days × monthly salary ÷ 22, so paid salary is (22 − days) / 22 of it', () => {
    const outcome = run(
      sourcesOf({
        payrollInputs: [lwop('input-1', ['2026-03-02', '2026-03-03'])],
        absenceFacts: [absence('fact-1', '2026-03-05', 480)],
      }),
    );

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: 'DAYS_WITHOUT_PAY',
        lineType: 'DEDUCTION',
        ruleVersionId: 'schedule-a',
        quantity: '3.0000',
        rate: '44000.00000000',
        amount: '6000.0000',
        sourceRecords: [{ payrollInputId: 'input-1' }, { attendancePayrollFactId: 'fact-1' }],
      }),
    ]);
    // 44,000 − 6,000 = 38,000 = (22 − 3) / 22 × 44,000.
    expect(outcome.lines[0]?.source).toMatchObject({
      unit: 'DAY',
      month: '2026-03',
      days: [
        { workDate: '2026-03-02', kind: 'LEAVE_WITHOUT_PAY' },
        { workDate: '2026-03-03', kind: 'LEAVE_WITHOUT_PAY' },
        { workDate: '2026-03-05', kind: 'ABSENCE' },
      ],
    });
  });

  it('values leave spanning two months at the salary in effect on each Work Date', () => {
    // A salary increase on 1 March, after the February days and before the deduction.
    const february = basisOf(
      '2026-02-26',
      '2026-02-27',
      resolved('2026-02-26', '2026-02-27', '44000', 'schedule-old'),
    );
    const raised = basisOf(
      '2026-03-01',
      '2026-03-31',
      resolved('2026-03-01', '2026-03-31', '46200'),
    );
    const outcome = run(
      sourcesOf({
        payrollInputs: [lwop('input-1', ['2026-02-26', '2026-02-27', '2026-03-02'])],
        valuationBases: [february],
      }),
      raised,
    );

    expect(outcome.exceptions).toEqual([]);
    expect(
      outcome.lines.map((line) => [
        line.source.month,
        line.ruleVersionId,
        line.quantity,
        line.rate,
        line.amount,
        line.sourceRecords,
      ]),
    ).toEqual([
      [
        '2026-02',
        'schedule-old',
        '2.0000',
        '44000.00000000',
        '4000.0000',
        [{ payrollInputId: 'input-1' }],
      ],
      [
        '2026-03',
        'schedule-a',
        '1.0000',
        '46200.00000000',
        '2100.0000',
        [{ payrollInputId: 'input-1' }],
      ],
    ]);
  });

  it('takes an adjustment publication as its delta, exactly once', () => {
    const withdrawn = absence('fact-2', '2026-02-10', 0, {
      prior: 480,
      publicationId: 'publication-adjustment',
    });
    const february = basisOf('2026-02-10', '2026-02-10', resolved('2026-02-10', '2026-02-10'));

    // The original is unconsumed too: the day and its withdrawal net to no line.
    expect(
      run(
        sourcesOf({
          absenceFacts: [absence('fact-1', '2026-02-10', 480), withdrawn],
          valuationBases: [february],
        }),
      ),
    ).toEqual({ lines: [], exceptions: [] });

    // A finalized payroll consumed the original: the withdrawal gives the day back.
    const [line] = run(sourcesOf({ absenceFacts: [withdrawn], valuationBases: [february] })).lines;
    expect([line?.quantity, line?.amount, line?.sourceRecords]).toEqual([
      '-1.0000',
      '-2000.0000',
      [{ attendancePayrollFactId: 'fact-2' }],
    ]);
  });

  it('fails closed on an Unpaid Deficit Remainder, naming the missing authority', () => {
    const outcome = run(
      sourcesOf({
        payrollInputs: [
          {
            id: 'remainder-1',
            inputKind: 'UNPAID_DEFICIT_REMAINDER',
            sourceType: 'AttendanceDeficitCharge',
            sourceId: 'charge-1',
            effectiveDate: '2026-03-05',
            quantity: '0.0640',
            payloadSnapshot: {},
          },
        ],
      }),
    );

    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'UNPAID_DEFICIT_REMAINDER_SALARY_RULE_UNSETTLED',
        severity: 'BLOCKING',
        details: expect.objectContaining({
          missingFacts: ['FRACTIONAL_DAY_SALARY_RULE'],
          payrollInputs: [
            { payrollInputId: 'remainder-1', workDate: '2026-03-05', quantity: '0.0640' },
          ],
        }),
      }),
    ]);
  });

  it('blocks an Employee with a deficit fact Leave has not charged', () => {
    const outcome = run(
      sourcesOf({
        unchargedDeficitFacts: [
          {
            publicationId: 'publication-original',
            attendancePayrollFactId: 'fact-late',
            workDate: '2026-03-04',
            deficitType: 'TARDINESS',
            minutes: 20,
            expectedMinutes: 600,
            reason: {
              code: 'COMPRESSED_WORKWEEK_DAY',
              message: 'No divisor for a 600-minute day.',
            },
          },
        ],
      }),
    );
    expect(outcome.exceptions.map((exception) => exception.exceptionType)).toEqual([
      'ATTENDANCE_DEFICIT_UNCHARGED',
    ]);
    expect(outcome.exceptions[0]?.details.message).toContain('No divisor for a 600-minute day.');
  });

  it('blocks every case no recorded rule settles', () => {
    expect(
      exceptionTypes(sourcesOf({ absenceFacts: [absence('fact-1', '2026-03-05', 240)] })),
    ).toEqual(['ABSENCE_PARTIAL_DAY_SALARY_RULE_UNSETTLED']);
    expect(
      exceptionTypes(
        sourcesOf({ payrollInputs: [lwop('input-1', ['2026-03-07'], 'CALENDAR_DAY')] }),
      ),
    ).toEqual(['LEAVE_WITHOUT_PAY_CALENDAR_DAYS_UNSETTLED']);
    expect(
      exceptionTypes(
        sourcesOf({
          payrollInputs: [
            { ...lwop('input-1', ['2026-03-02']), payloadSnapshot: { unitCode: 'WORKING_DAY' } },
          ],
        }),
      ),
    ).toEqual(['LEAVE_WITHOUT_PAY_INPUT_UNREADABLE']);
    // 1 × 31,705 ÷ 22 is 1,441.136…: not whole centavos, and nothing rounds it.
    const odd = basisOf('2026-03-01', '2026-03-31', resolved('2026-03-01', '2026-03-31', '31705'));
    expect(
      exceptionTypes(sourcesOf({ payrollInputs: [lwop('input-1', ['2026-03-02'])] }), odd),
    ).toEqual(['DAYS_WITHOUT_PAY_ROUNDING_UNSETTLED']);
    const casual = basisOf('2026-03-01', '2026-03-31', resolved('2026-03-01', '2026-03-31', null));
    expect(
      exceptionTypes(sourcesOf({ payrollInputs: [lwop('input-1', ['2026-03-02'])] }), casual),
    ).toEqual(['DAYS_WITHOUT_PAY_CASUAL_UNSETTLED']);
    const unserved = basisOf('2026-03-01', '2026-03-31', {
      status: 'INDETERMINATE',
      from: '2026-03-01',
      to: '2026-03-31',
      personnel: null,
      salarySchedule: null,
      reasons: [{ code: 'NO_SERVICE_SEGMENT', message: 'No Service Segment.' }],
    });
    expect(
      exceptionTypes(sourcesOf({ payrollInputs: [lwop('input-1', ['2026-03-02'])] }), unserved),
    ).toEqual(['DAYS_WITHOUT_PAY_BASIS_INDETERMINATE']);
    // All 22 weekdays of March 2026 on leave without pay and one more absent day: 23 days would be negative pay.
    const weekdays = Array.from(
      { length: 31 },
      (_, day) => `2026-03-${String(day + 1).padStart(2, '0')}`,
    ).filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
    expect(weekdays).toHaveLength(22);
    expect(
      exceptionTypes(
        sourcesOf({
          payrollInputs: [lwop('input-1', weekdays)],
          absenceFacts: [absence('fact-1', '2026-03-02', 480)],
        }),
      ),
    ).toEqual(['DAYS_WITHOUT_PAY_EXCEED_MONTH']);
  });
});
