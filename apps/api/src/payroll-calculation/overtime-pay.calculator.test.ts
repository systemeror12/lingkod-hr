import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
} from '../compensation-basis/compensation-basis.service';
import { OvertimePayCalculator } from './overtime-pay.calculator';
import type {
  CalculationContext,
  EmployeePayrollSources,
  FrozenRuleVersion,
  PendingPayrollInput,
} from './payroll-calculator';

// JC 2, s. 2015's values (items 9.3–9.4, 10.5–10.7) as the loaded version
// carries them. A 35,200 monthly salary makes the hourly rate 200, so 125% is
// 250 an hour and 150% is 300.
const overtimeVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'overtime-2015',
  code: 'JC2-2015-OVERTIME-PAY',
  ruleKind: 'OVERTIME_PAY',
  effectiveFrom: '2015-11-25',
  effectiveTo: null,
  successorEffectiveFrom: null,
  parameters: {
    workingDaysPerMonth: 22,
    workHoursPerDay: 8,
    workdayPremium: '1.25',
    nonWorkdayPremium: '1.50',
    nonWorkdayPaidHoursLimit: 12,
    employeeAnnualCapShare: '0.50',
    agencyAnnualCapShare: '0.05',
  },
  ...overrides,
});

const contextWith = (...versions: FrozenRuleVersion[]): CalculationContext => ({
  periodFrom: '2026-03-01',
  periodTo: '2026-03-31',
  snapshotRuleVersionIds: new Set(versions.map((version) => version.id)),
  snapshotRuleVersions: versions,
  componentCodes: new Set<string>(),
});

const served = (
  from: string,
  to: string,
  monthlyRate: string | null = '35200',
  payBasis: PayBasis = 'MONTHLY_FULL_TIME',
  employmentFraction: string | null = null,
): CompensationBasisStretch => ({
  status: 'RESOLVED',
  from,
  to,
  personnel: {
    serviceSegmentId: `segment-${from}`,
    salaryGrade: 11,
    salaryStep: 1,
    payBasis,
    employmentFraction,
  },
  salarySchedule: {
    ruleVersionId: 'schedule-a',
    ruleVersionCode: 'SSL-TEST',
    monthlyRate: '35200',
  },
  rate: { monthlyRate, dailyRate: '1600', derivation: 'test' },
});

const basisOf = (...stretches: CompensationBasisStretch[]): CompensationBasis => ({
  employeeId: 'employee-1',
  from: stretches[0]!.from,
  to: stretches.at(-1)!.to,
  status: stretches.every((stretch) => stretch.status === 'RESOLVED')
    ? 'RESOLVED'
    : 'INDETERMINATE',
  stretches,
});

const march = basisOf(served('2026-03-01', '2026-03-31'));

let inputs = 0;
/** One `OVERTIME_HOURS` input, as Overtime posts it on certification (#347). */
const overtime = (
  workDate: string,
  certifiedMinutes: number,
  dayClassification: string | null,
): PendingPayrollInput => {
  inputs += 1;
  return {
    id: `input-${inputs}`,
    inputKind: 'OVERTIME_HOURS',
    sourceType: 'OvertimeServiceRecord',
    sourceId: `record-${inputs}`,
    effectiveDate: workDate,
    quantity: `${certifiedMinutes}.0000`,
    amount: null,
    payloadSnapshot: {
      quantityUnit: 'MINUTE',
      certifiedMinutes,
      dayClassification,
      workDate,
      overtimeAuthorityId: 'authority-1',
      authorityNo: 'OT-2026-001',
      sourceAttendanceDayId: 'day-1',
      attendancePeriodVersionId: 'attendance-version-1',
    },
  };
};

const sourcesWith = (
  payrollInputs: PendingPayrollInput[],
  valuationBases: CompensationBasis[] = [],
): EmployeePayrollSources => ({
  payrollInputs,
  absenceFacts: [],
  deductionObligations: [],
  nightDutyFacts: [],
  nightShiftDifferentialRates: [],
  unchargedDeficitFacts: [],
  valuationBases,
  positionTitles: [],
  periodAttendance: { coveredDates: [], workDates: [] },
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
});

const calculator = new OvertimePayCalculator();
const calculate = (
  payrollInputs: PendingPayrollInput[],
  basis = march,
  context = contextWith(overtimeVersion()),
  valuationBases: CompensationBasis[] = [],
) => calculator.calculate(basis, context, [], sourcesWith(payrollInputs, valuationBases));

const blockingTypes = (outcome: ReturnType<typeof calculate>) =>
  outcome.exceptions
    .filter((exception) => exception.severity === 'BLOCKING')
    .map((exception) => exception.exceptionType);

describe('overtime pay', () => {
  it('writes nothing without an overtime input', () => {
    expect(calculate([])).toEqual({ lines: [], exceptions: [] });
  });

  it('pays a scheduled workday at 125% of monthly salary ÷ 22 ÷ 8, resting on its input', () => {
    const input = overtime('2026-03-04', 120, 'WORKDAY');
    const outcome = calculate([input]);
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: 'OVERTIME_PAY',
        lineType: 'EARNING',
        ruleVersionId: 'overtime-2015',
        quantity: '120.0000',
        rate: '35200.00000000',
        amount: '500.0000',
        sourceRecords: [{ payrollInputId: input.id }],
      }),
    ]);
    expect(outcome.lines[0]!.source).toMatchObject({
      unit: 'MINUTE',
      workDate: '2026-03-04',
      dayClassification: 'WORKDAY',
      premium: '1.25',
      overtimeAuthorityId: 'authority-1',
      taxTreatment: 'SUPPLEMENTARY_COMPENSATION',
    });
  });

  it.each([
    ['a special working day, as a scheduled workday', 'SPECIAL_WORKING', '500.0000'],
    ['a Day Rule rest day, a CWW non-working day among them', 'REST_DAY', '600.0000'],
    ['a regular holiday', 'REGULAR_HOLIDAY', '600.0000'],
    ['a special non-working day', 'SPECIAL_NON_WORKING', '600.0000'],
    ['a local holiday', 'LOCAL_HOLIDAY', '600.0000'],
  ])('pays two hours on %s', (_label, dayClassification, amount) => {
    const outcome = calculate([overtime('2026-03-07', 120, dayClassification)]);
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines.map((line) => line.amount)).toEqual([amount]);
  });

  it('pays one line per input, each resting on its own input', () => {
    const first = overtime('2026-03-04', 120, 'WORKDAY');
    const second = overtime('2026-03-07', 120, 'REST_DAY');
    const outcome = calculate([first, second]);
    expect(outcome.lines.map((line) => [line.amount, line.sourceRecords])).toEqual([
      ['500.0000', [{ payrollInputId: first.id }]],
      ['600.0000', [{ payrollInputId: second.id }]],
    ]);
  });

  it('pays at most 12 hours on a non-workday and warns that the rest is for CTO', () => {
    const outcome = calculate([overtime('2026-03-07', 780, 'REST_DAY')]);
    expect(outcome.lines.map((line) => [line.quantity, line.amount])).toEqual([
      ['720.0000', '3600.0000'],
    ]);
    expect(outcome.lines[0]!.source).toMatchObject({ certifiedMinutes: 780, paidMinutes: 720 });
    expect(outcome.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'OVERTIME_PAY_NON_WORKDAY_HOURS_EXCEEDED',
        severity: 'WARNING',
        details: expect.objectContaining({ certifiedMinutes: 780, paidMinutes: 720 }),
      }),
    ]);
  });

  it('pays every certified hour on a workday, where the 12-hour limit does not apply', () => {
    const outcome = calculate([overtime('2026-03-04', 780, 'WORKDAY')]);
    expect(outcome.lines.map((line) => line.amount)).toEqual(['3250.0000']);
    expect(outcome.exceptions).toEqual([]);
  });

  it('values a Work Date outside the period at the salary in effect on it', () => {
    const february = basisOf(served('2026-02-26', '2026-02-26', '26400'));
    const outcome = calculate(
      [overtime('2026-02-26', 120, 'WORKDAY')],
      march,
      contextWith(overtimeVersion()),
      [february],
    );
    // 26,400 ÷ 22 ÷ 8 = 150 an hour; × 1.25 × 2 hours.
    expect(outcome.lines.map((line) => [line.rate, line.amount])).toEqual([
      ['26400.00000000', '375.0000'],
    ]);
  });

  it('blocks a whole-day work suspension, which no source prices', () => {
    expect(blockingTypes(calculate([overtime('2026-03-09', 120, 'WORK_SUSPENSION')]))).toEqual([
      'OVERTIME_PAY_WORK_SUSPENSION_UNSETTLED',
    ]);
  });

  it.each([[null], ['PARTIAL_DAY_WORK_SUSPENSION']])(
    'blocks a %s day classification it cannot map',
    (dayClassification) => {
      expect(blockingTypes(calculate([overtime('2026-03-09', 120, dayClassification)]))).toEqual([
        'OVERTIME_PAY_DAY_CLASSIFICATION_UNSETTLED',
      ]);
    },
  );

  it('blocks a payload that disagrees with its input', () => {
    const input = overtime('2026-03-04', 120, 'WORKDAY');
    expect(blockingTypes(calculate([{ ...input, quantity: '90.0000' }]))).toEqual([
      'OVERTIME_PAY_INPUT_UNREADABLE',
    ]);
    expect(blockingTypes(calculate([{ ...input, effectiveDate: '2026-03-05' }]))).toEqual([
      'OVERTIME_PAY_INPUT_UNREADABLE',
    ]);
    expect(
      blockingTypes(
        calculate([
          {
            ...input,
            payloadSnapshot: { ...(input.payloadSnapshot as object), quantityUnit: 'HOUR' },
          },
        ]),
      ),
    ).toEqual(['OVERTIME_PAY_INPUT_UNREADABLE']);
  });

  it('blocks when no rule version is in effect on the Work Date', () => {
    const later = overtimeVersion({ effectiveFrom: '2026-03-05' });
    expect(
      blockingTypes(calculate([overtime('2026-03-04', 120, 'WORKDAY')], march, contextWith())),
    ).toEqual(['OVERTIME_PAY_RULE_NOT_IN_EFFECT']);
    expect(
      blockingTypes(calculate([overtime('2026-03-04', 120, 'WORKDAY')], march, contextWith(later))),
    ).toEqual(['OVERTIME_PAY_RULE_NOT_IN_EFFECT']);
  });

  it('blocks part-time service, a casual daily wage, and an indeterminate basis', () => {
    const input = overtime('2026-03-04', 120, 'WORKDAY');
    const partTime = basisOf(
      served('2026-03-01', '2026-03-31', '17600', 'PART_TIME_PROPORTIONAL', '0.5'),
    );
    const casual = basisOf(served('2026-03-01', '2026-03-31', null, 'CASUAL_DAILY_WAGE'));
    const indeterminate = basisOf({
      status: 'INDETERMINATE',
      from: '2026-03-01',
      to: '2026-03-31',
      personnel: null,
      salarySchedule: null,
      reasons: [{ code: 'NO_SERVICE_SEGMENT', message: 'No Service Segment.' }],
    });
    expect(blockingTypes(calculate([input], partTime))).toEqual([
      'OVERTIME_PAY_PART_TIME_UNSETTLED',
    ]);
    expect(blockingTypes(calculate([input], casual))).toEqual([
      'OVERTIME_PAY_CASUAL_DAILY_WAGE_UNSETTLED',
    ]);
    expect(blockingTypes(calculate([input], indeterminate))).toEqual([
      'OVERTIME_PAY_BASIS_INDETERMINATE',
    ]);
  });

  it('blocks an amount that is not whole centavos', () => {
    // 35,200 × 1.25 ÷ 10,560 is 4.1666… a minute, so 125 minutes is 520.83….
    const outcome = calculate([overtime('2026-03-04', 125, 'WORKDAY')]);
    expect(outcome.lines).toEqual([]);
    expect(blockingTypes(outcome)).toEqual(['OVERTIME_PAY_ROUNDING_UNSETTLED']);
  });

  it('ignores every other input kind', () => {
    const leave: PendingPayrollInput = {
      ...overtime('2026-03-04', 120, 'WORKDAY'),
      inputKind: 'LEAVE_WITHOUT_PAY',
    };
    expect(calculate([leave])).toEqual({ lines: [], exceptions: [] });
  });
});
