import { describe, expect, it } from 'vitest';
import type { AttendancePayrollFactType } from '../attendance-periods/attendance-periods.types';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
} from '../compensation-basis/compensation-basis.service';
import { commutableRataParameters } from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  COMMUTABLE_RATA_RULE_KIND,
  CommutableRataCalculator,
  REPRESENTATION_ALLOWANCE_COMPONENT_CODE,
  TRANSPORTATION_ALLOWANCE_COMPONENT_CODE,
} from './commutable-rata.calculator';
import type {
  CalculationContext,
  EmployeePayrollSources,
  OfficialVehicleAssignment,
} from './payroll-calculator';

// Test fixtures only. The division-chief rate is the FY 2026 GAA sec. 71(g)
// figure the research register records; the band thresholds are illustrative,
// since the register records NBC 593's 25/50/75/100% shares but not its days.
const parameters = {
  ranks: [
    {
      rank: 'Chief of Division',
      positionTitles: ['Chief of Division', 'Chief Administrative Officer'],
      representationAllowance: '6000.00',
      transportationAllowance: '6000.00',
    },
    {
      rank: 'Director',
      positionTitles: ['Director IV'],
      representationAllowance: '10000.00',
      transportationAllowance: '10000.00',
    },
  ],
  actualWorkSchedule: [
    { minimumDays: 1, share: '0.25' },
    { minimumDays: 6, share: '0.5' },
    { minimumDays: 12, share: '0.75' },
    { minimumDays: 17, share: '1' },
  ],
};
const calculator = new CommutableRataCalculator();
const FROM = '2026-03-01';
const TO = '2026-03-31';

function contextWith(rule: Record<string, unknown> | null = parameters): CalculationContext {
  return {
    periodFrom: FROM,
    periodTo: TO,
    snapshotRuleVersionIds: new Set(rule ? ['rata-2026'] : []),
    snapshotRuleVersions: rule
      ? [
          {
            id: 'rata-2026',
            code: 'RATA-TEST-2026',
            ruleKind: COMMUTABLE_RATA_RULE_KIND,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-12-31',
            successorEffectiveFrom: null,
            parameters: rule,
          },
        ]
      : [],
    componentCodes: new Set(),
  };
}

function basisOf(payBasis: PayBasis = 'MONTHLY_FULL_TIME'): CompensationBasis {
  const stretch: CompensationBasisStretch = {
    status: 'RESOLVED',
    from: FROM,
    to: TO,
    personnel: {
      serviceSegmentId: 'segment-1',
      salaryGrade: 24,
      salaryStep: 1,
      payBasis,
      employmentFraction: payBasis === 'PART_TIME_PROPORTIONAL' ? '0.5' : null,
    },
    salarySchedule: { ruleVersionId: 'schedule-a', ruleVersionCode: 'SSL-TEST', monthlyRate: '1' },
    rate: { monthlyRate: '1', dailyRate: '1', derivation: 'test derivation' },
  };
  return { employeeId: 'employee-1', from: FROM, to: TO, status: 'RESOLVED', stretches: [stretch] };
}

/** March 2026's 22 weekdays. */
const weekdays = Array.from(
  { length: 31 },
  (_, index) => `2026-03-${String(index + 1).padStart(2, '0')}`,
).filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00.000Z`).getUTCDay()));

type Day = Partial<Record<AttendancePayrollFactType, number>>;

/**
 * Locked Attendance for all of March: the first `worked` weekdays worked in
 * full, the rest on posted leave, and `special` Work Dates as given.
 */
function attendance(worked: number, special: Record<string, Day> = {}) {
  return {
    coveredDates: [{ from: FROM, to: TO }],
    workDates: weekdays.map((workDate, index) => ({
      employeeId: 'employee-1',
      workDate,
      minutes:
        special[workDate] ??
        (index < worked ? { EXPECTED: 480, WORKED: 480 } : { EXPECTED: 480, POSTED_LEAVE: 480 }),
    })),
  };
}

function sourcesOf(overrides: Partial<EmployeePayrollSources> = {}): EmployeePayrollSources {
  return {
    payrollInputs: [],
    absenceFacts: [],
    deductionObligations: [],
    nightDutyFacts: [],
    nightShiftDifferentialRates: [],
    unchargedDeficitFacts: [],
    valuationBases: [],
    positionTitles: [
      {
        employeeId: 'employee-1',
        from: FROM,
        to: TO,
        serviceSegmentId: 'segment-1',
        positionId: 'position-1',
        positionTitle: 'Chief of Division',
      },
    ],
    periodAttendance: attendance(22),
    officialVehicleAssignments: [],
    clothingAllowanceGrants: [],
    serviceSegmentAppointments: [],
    taxYearToDate: {
      taxYear: 2026,
      payrollPeriodIds: [],
      taxableCompensation: '0.0000',
      nonTaxableCompensation: '0.0000',
      withholdingTax: '0.0000',
      deMinimisBenefits: {},
    },
    ...overrides,
  };
}

const vehicle = (effectiveFrom: string, effectiveTo: string | null): OfficialVehicleAssignment => ({
  agencyPayrollApplicabilityId: 'vehicle-1',
  scope: 'EMPLOYEE',
  authorityDocumentVersionId: 'document-version-1',
  effectiveFrom,
  effectiveTo,
});

const run = (sources = sourcesOf(), context = contextWith(), basis = basisOf()) =>
  calculator.calculate(basis, context, [], sources);

const amounts = (outcome: ReturnType<typeof run>) =>
  outcome.lines.map((line) => [line.componentCode, line.quantity, line.amount]);

const exceptionTypes = (outcome: ReturnType<typeof run>) =>
  outcome.exceptions.map((exception) => exception.exceptionType);

describe('CommutableRataCalculator', () => {
  it.each([
    [0, null],
    [3, '0.2500'],
    [8, '0.5000'],
    [14, '0.7500'],
    [22, '1.0000'],
  ])('pays the schedule band of %i days of actual work', (worked, share) => {
    const outcome = run(sourcesOf({ periodAttendance: attendance(worked) }));
    expect(outcome.exceptions).toEqual([]);
    if (share === null) {
      expect(outcome.lines).toEqual([]);
      return;
    }
    const amount = (6000 * Number(share)).toFixed(4);
    expect(amounts(outcome)).toEqual([
      [REPRESENTATION_ALLOWANCE_COMPONENT_CODE, share, amount],
      [TRANSPORTATION_ALLOWANCE_COMPONENT_CODE, share, amount],
    ]);
  });

  it('writes two non-taxable earnings at the rank rate under the rule version', () => {
    const [representation, transportation] = run().lines;
    for (const line of [representation, transportation]) {
      expect(line).toMatchObject({
        lineType: 'EARNING',
        ruleVersionId: 'rata-2026',
        rate: '6000.00000000',
        source: {
          rank: 'Chief of Division',
          actualWorkDays: 22,
          band: { minimumDays: 17, share: '1' },
          taxTreatment: 'NON_TAXABLE',
          officialVehicleAssignment: null,
        },
      });
    }
  });

  it('matches a listed title with any case and spacing, and pays the higher rank its own rate', () => {
    const positionTitles = sourcesOf().positionTitles.map((stretch) => ({
      ...stretch,
      positionTitle: '  director   iv ',
    }));
    expect(amounts(run(sourcesOf({ positionTitles })))).toEqual([
      [REPRESENTATION_ALLOWANCE_COMPONENT_CODE, '1.0000', '10000.0000'],
      [TRANSPORTATION_ALLOWANCE_COMPONENT_CODE, '1.0000', '10000.0000'],
    ]);
  });

  it('leaves out the transportation allowance under an official vehicle for the whole month', () => {
    const outcome = run(sourcesOf({ officialVehicleAssignments: [vehicle('2026-01-15', null)] }));
    expect(amounts(outcome)).toEqual([
      [REPRESENTATION_ALLOWANCE_COMPONENT_CODE, '1.0000', '6000.0000'],
    ]);
    expect(outcome.lines[0]?.source).toMatchObject({
      officialVehicleAssignment: { agencyPayrollApplicabilityIds: ['vehicle-1'] },
    });
  });

  it('blocks an official vehicle for only part of the month', () => {
    const outcome = run(
      sourcesOf({ officialVehicleAssignments: [vehicle('2026-01-15', '2026-03-10')] }),
    );
    expect(outcome.lines).toEqual([]);
    expect(exceptionTypes(outcome)).toEqual(['COMMUTABLE_RATA_VEHICLE_PART_OF_MONTH_UNSETTLED']);
  });

  it('writes nothing for a position the rule does not list, such as an OIC paid reimbursable RATA', () => {
    const positionTitles = sourcesOf().positionTitles.map((stretch) => ({
      ...stretch,
      positionTitle: 'Administrative Officer V',
    }));
    expect(run(sourcesOf({ positionTitles }))).toEqual({ lines: [], exceptions: [] });
  });

  it('blocks when no rule version covers the month, or one changes inside it', () => {
    expect(exceptionTypes(run(sourcesOf(), contextWith(null)))).toEqual([
      'COMMUTABLE_RATA_RULE_NOT_IN_EFFECT',
    ]);
    const changing = contextWith();
    changing.snapshotRuleVersions = [
      { ...changing.snapshotRuleVersions[0]!, effectiveTo: '2026-03-15' },
      {
        ...changing.snapshotRuleVersions[0]!,
        id: 'rata-2026-b',
        code: 'RATA-TEST-2026-B',
        effectiveFrom: '2026-03-16',
      },
    ];
    expect(exceptionTypes(run(sourcesOf(), changing))).toEqual([
      'COMMUTABLE_RATA_RULE_CHANGE_IN_PERIOD',
    ]);
  });

  it('blocks a rank that changes or ends inside the month', () => {
    const [first] = sourcesOf().positionTitles;
    const positionTitles = [
      { ...first!, to: '2026-03-15' },
      { ...first!, from: '2026-03-16', positionTitle: 'Director IV' },
    ];
    expect(exceptionTypes(run(sourcesOf({ positionTitles })))).toEqual([
      'COMMUTABLE_RATA_RANK_CHANGE_IN_PERIOD',
    ]);
  });

  it('blocks a part-time pay basis', () => {
    expect(
      exceptionTypes(run(sourcesOf(), contextWith(), basisOf('PART_TIME_PROPORTIONAL'))),
    ).toEqual(['COMMUTABLE_RATA_PAY_BASIS_UNSETTLED']);
  });

  it('blocks only when days it cannot count could change the share', () => {
    const travel = { EXPECTED: 480, OFFICIAL_TRAVEL: 480 };
    const halfLeave = { EXPECTED: 480, WORKED: 240, POSTED_LEAVE: 240 };
    // 10 days worked, and a travel day and a half-day leave that could make it 12.
    const unsettled = run(
      sourcesOf({
        periodAttendance: attendance(10, { '2026-03-16': travel, '2026-03-17': halfLeave }),
      }),
    );
    expect(exceptionTypes(unsettled)).toEqual(['COMMUTABLE_RATA_ACTUAL_WORK_UNSETTLED']);
    expect(unsettled.exceptions[0]?.details).toMatchObject({
      actualWorkDays: 10,
      unsettledDays: [
        { workDate: '2026-03-16', reason: 'official business, travel, or training' },
        { workDate: '2026-03-17', reason: 'worked part of the day' },
      ],
    });
    // 8 days worked: two more still reach only 10, inside the same band.
    const settled = run(
      sourcesOf({
        periodAttendance: attendance(8, { '2026-03-16': travel, '2026-03-17': halfLeave }),
      }),
    );
    expect(amounts(settled).map(([, share]) => share)).toEqual(['0.5000', '0.5000']);
  });

  it('counts tardiness on a worked day, and blocks dates no locked Attendance covers', () => {
    const late = { EXPECTED: 480, WORKED: 450, TARDINESS: 30 };
    expect(
      run(sourcesOf({ periodAttendance: attendance(11, { '2026-03-17': late }) })).lines[0]
        ?.quantity,
    ).toBe('0.7500');

    const firstHalf = attendance(22);
    firstHalf.coveredDates = [{ from: FROM, to: '2026-03-15' }];
    firstHalf.workDates = firstHalf.workDates.filter((day) => day.workDate <= '2026-03-15');
    expect(exceptionTypes(run(sourcesOf({ periodAttendance: firstHalf })))).toEqual([
      'COMMUTABLE_RATA_ACTUAL_WORK_UNSETTLED',
    ]);
    // Already at the top band, the dates still to lock cannot change the share.
    const topBand = attendance(22);
    topBand.coveredDates = [{ from: FROM, to: '2026-03-27' }];
    expect(
      amounts(run(sourcesOf({ periodAttendance: topBand }))).map(([, share]) => share),
    ).toEqual(['1.0000', '1.0000']);
  });

  it('blocks an amount that is not whole centavos', () => {
    const rule = {
      ...parameters,
      ranks: [{ ...parameters.ranks[0]!, transportationAllowance: '6000.10' }],
    };
    expect(
      exceptionTypes(run(sourcesOf({ periodAttendance: attendance(3) }), contextWith(rule))),
    ).toEqual(['COMMUTABLE_RATA_ROUNDING_UNSETTLED']);
  });
});

describe('commutableRataParameters', () => {
  it('accepts rising bands that end at a share of 1', () => {
    expect(commutableRataParameters.safeParse(parameters).success).toBe(true);
  });

  it.each([
    ['bands that do not end at 1', [{ minimumDays: 1, share: '0.5' }]],
    [
      'bands out of order',
      [
        { minimumDays: 6, share: '0.5' },
        { minimumDays: 1, share: '1' },
      ],
    ],
    ['a share above 1', [{ minimumDays: 1, share: '1.5' }]],
  ])('refuses %s', (_label, actualWorkSchedule) => {
    expect(commutableRataParameters.safeParse({ ...parameters, actualWorkSchedule }).success).toBe(
      false,
    );
  });

  it('refuses a title listed under two ranks', () => {
    const ranks = [
      parameters.ranks[0]!,
      { ...parameters.ranks[1]!, positionTitles: ['chief of division'] },
    ];
    expect(commutableRataParameters.safeParse({ ...parameters, ranks }).success).toBe(false);
  });
});
