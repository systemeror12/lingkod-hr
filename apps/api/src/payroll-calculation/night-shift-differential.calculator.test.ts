import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
} from '../compensation-basis/compensation-basis.service';
import { NightShiftDifferentialCalculator } from './night-shift-differential.calculator';
import type {
  CalculationContext,
  EmployeePayrollSources,
  FrozenRuleVersion,
  NightShiftDifferentialRate,
} from './payroll-calculator';

// RA No. 11701, sec. 1's values as the loaded version carries them. A 35,200
// monthly salary makes the hourly basic rate 200, so a 10% rate pays 20 an
// hour and a 15% rate 30.
const nightShiftVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'night-shift-2022',
  code: 'RA11701-NIGHT-SHIFT',
  ruleKind: 'NIGHT_SHIFT_DIFFERENTIAL',
  effectiveFrom: '2022-05-13',
  effectiveTo: null,
  successorEffectiveFrom: null,
  parameters: { rateCeiling: '0.20', workingDaysPerMonth: 22, workHoursPerDay: 8 },
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
): CompensationBasisStretch => ({
  status: 'RESOLVED',
  from,
  to,
  personnel: {
    serviceSegmentId: `segment-${from}`,
    salaryGrade: 11,
    salaryStep: 1,
    payBasis,
    employmentFraction: payBasis === 'PART_TIME_PROPORTIONAL' ? '0.5000' : null,
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

let facts = 0;
/** One NIGHT_DUTY fact; `prior` makes it an adjustment publication's. */
const night = (
  workDate: string,
  correctedMinutes: number,
  prior: number | null = null,
): EmployeePayrollSources['nightDutyFacts'][number] => {
  facts += 1;
  return {
    id: `fact-${facts}`,
    publicationId: prior === null ? 'publication-1' : 'publication-2',
    publicationType: prior === null ? 'ORIGINAL' : 'ADJUSTMENT',
    employeeId: 'employee-1',
    workDate,
    correctedMinutes,
    priorMinutes: prior,
  };
};

const rateOf = (
  id: string,
  rate: string,
  effectiveFrom: string,
  effectiveTo: string | null = null,
  scope: NightShiftDifferentialRate['scope'] = 'AGENCY',
): NightShiftDifferentialRate => ({
  authorizedPayrollComponentInputId: id,
  scope,
  rate,
  authorityDocumentVersionId: `authority-${id}`,
  effectiveFrom,
  effectiveTo,
});

const sourcesWith = (
  nightDutyFacts: EmployeePayrollSources['nightDutyFacts'],
  nightShiftDifferentialRates: NightShiftDifferentialRate[],
  valuationBases: CompensationBasis[] = [],
): EmployeePayrollSources => ({
  payrollInputs: [],
  absenceFacts: [],
  deductionObligations: [],
  nightDutyFacts,
  nightShiftDifferentialRates,
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
    thirteenthMonthAndOtherBenefits: '0.0000',
  },
});

const calculator = new NightShiftDifferentialCalculator();
const calculate = (
  nightDutyFacts: EmployeePayrollSources['nightDutyFacts'],
  rates: NightShiftDifferentialRate[],
  {
    basis = march,
    context = contextWith(nightShiftVersion()),
    valuationBases = [] as CompensationBasis[],
  } = {},
) => calculator.calculate(basis, context, [], sourcesWith(nightDutyFacts, rates, valuationBases));

const exceptionTypes = (outcome: ReturnType<typeof calculate>) =>
  outcome.exceptions.map((exception) => [exception.exceptionType, exception.severity]);

describe('NightShiftDifferentialCalculator', () => {
  it('pays night minutes × the hourly basic rate × the rate in effect on each Work Date, one line per rate', () => {
    // The agency head raises the rate from 10% to 15% on 16 March.
    const before = rateOf('rate-10', '0.1', '2026-01-01', '2026-03-15');
    const after = rateOf('rate-15', '0.15', '2026-03-16');
    const early = night('2026-03-10', 480);
    const short = night('2026-03-12', 240);
    const late = night('2026-03-20', 480);
    const outcome = calculate([early, short, late], [before, after]);

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      {
        componentCode: 'NIGHT_SHIFT_DIFFERENTIAL',
        lineType: 'EARNING',
        ruleVersionId: 'night-shift-2022',
        quantity: '720.0000',
        rate: '35200.00000000',
        // 720 minutes = 12 hours × 200 × 10%.
        amount: '240.0000',
        source: expect.objectContaining({
          unit: 'MINUTE',
          workDates: ['2026-03-10', '2026-03-12'],
          nightShiftRate: '0.1',
          authorizedPayrollComponentInputId: 'rate-10',
          rateScope: 'AGENCY',
          authorityDocumentVersionId: 'authority-rate-10',
          ruleVersionCode: 'RA11701-NIGHT-SHIFT',
          taxTreatment: 'SUPPLEMENTARY_COMPENSATION',
        }),
        sourceRecords: [
          { attendancePayrollFactId: early.id },
          { attendancePayrollFactId: short.id },
          { authorizedPayrollComponentInputId: 'rate-10' },
        ],
      },
      expect.objectContaining({
        quantity: '480.0000',
        // 8 hours × 200 × 15%.
        amount: '240.0000',
        source: expect.objectContaining({ workDates: ['2026-03-20'], nightShiftRate: '0.15' }),
        sourceRecords: [
          { attendancePayrollFactId: late.id },
          { authorizedPayrollComponentInputId: 'rate-15' },
        ],
      }),
    ]);
  });

  it("takes the Employee's own rate before the Agency's", () => {
    const outcome = calculate(
      [night('2026-03-10', 480)],
      [
        rateOf('agency', '0.1', '2026-01-01'),
        rateOf('own', '0.15', '2026-03-01', '2026-03-31', 'EMPLOYEE'),
      ],
    );
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toMatchObject([
      { amount: '240.0000', source: { authorizedPayrollComponentInputId: 'own' } },
    ]);
  });

  it('gives an Employee with no night-duty fact no line and no exception, with or without a rate', () => {
    expect(calculate([], [])).toEqual({ lines: [], exceptions: [] });
    expect(calculate([], [rateOf('rate', '0.1', '2026-01-01')])).toEqual({
      lines: [],
      exceptions: [],
    });
  });

  it('blocks night duty with no rate in effect on its Work Date and writes no line for it', () => {
    const unpaid = night('2026-03-20', 480);
    const outcome = calculate(
      [night('2026-03-10', 480), unpaid],
      [rateOf('rate', '0.1', '2026-01-01', '2026-03-15')],
    );
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0]!.source).toMatchObject({ workDates: ['2026-03-10'] });
    expect(exceptionTypes(outcome)).toEqual([
      ['NIGHT_SHIFT_DIFFERENTIAL_RATE_NOT_IN_EFFECT', 'BLOCKING'],
    ]);
    expect(outcome.exceptions[0]!.details).toMatchObject({
      workDates: ['2026-03-20'],
      facts: [{ attendancePayrollFactId: unpaid.id, workDate: '2026-03-20', minutes: 480 }],
    });
    // An Employee no rate covers at all gets the same exception and no line.
    expect(exceptionTypes(calculate([night('2026-03-10', 480)], []))).toEqual([
      ['NIGHT_SHIFT_DIFFERENTIAL_RATE_NOT_IN_EFFECT', 'BLOCKING'],
    ]);
  });

  it('blocks a rate above the ceiling of the rule version in effect on the Work Date', () => {
    const outcome = calculate([night('2026-03-10', 480)], [rateOf('rate', '0.25', '2026-01-01')]);
    expect(outcome.lines).toEqual([]);
    expect(exceptionTypes(outcome)).toEqual([
      ['NIGHT_SHIFT_DIFFERENTIAL_RATE_ABOVE_CEILING', 'BLOCKING'],
    ]);
    // The ceiling itself is paid: 8 hours × 200 × 20%.
    expect(
      calculate([night('2026-03-10', 480)], [rateOf('rate', '0.2', '2026-01-01')]).lines,
    ).toMatchObject([{ amount: '320.0000' }]);
  });

  it('takes an adjustment as its delta and nets it with the facts it corrects', () => {
    const rate = rateOf('rate', '0.1', '2026-01-01');
    // February paid 480 minutes; the adjustment corrects them to 240.
    const withdrawn = night('2026-02-10', 240, 480);
    const february = basisOf(served('2026-02-01', '2026-02-28'));
    expect(calculate([withdrawn], [rate], { valuationBases: [february] }).lines).toMatchObject([
      { quantity: '-240.0000', amount: '-80.0000' },
    ]);
    // An original and its adjustment both unconsumed net to the corrected minutes.
    expect(
      calculate([night('2026-03-10', 480), night('2026-03-10', 240, 480)], [rate]).lines,
    ).toMatchObject([{ quantity: '240.0000', amount: '80.0000' }]);
    // A fact whose delta is zero is not night duty to pay.
    expect(calculate([night('2026-03-10', 480, 480)], [])).toEqual({ lines: [], exceptions: [] });
  });

  it('blocks the cases the recorded rules do not settle', () => {
    const rate = rateOf('rate', '0.1', '2026-01-01');
    const at = (basis: CompensationBasis) =>
      exceptionTypes(calculate([night('2026-03-10', 480)], [rate], { basis }));

    expect(
      exceptionTypes(calculate([night('2026-03-10', 480)], [rate], { context: contextWith() })),
    ).toEqual([['NIGHT_SHIFT_DIFFERENTIAL_RULE_NOT_IN_EFFECT', 'BLOCKING']]);
    expect(
      exceptionTypes(
        calculate([night('2026-03-10', 480)], [rate, rateOf('other', '0.15', '2026-03-01')]),
      ),
    ).toEqual([['NIGHT_SHIFT_DIFFERENTIAL_RATE_AMBIGUOUS', 'BLOCKING']]);
    expect(
      at(basisOf(served('2026-03-01', '2026-03-31', '17600', 'PART_TIME_PROPORTIONAL'))),
    ).toEqual([['NIGHT_SHIFT_DIFFERENTIAL_PART_TIME_UNSETTLED', 'BLOCKING']]);
    expect(at(basisOf(served('2026-03-01', '2026-03-31', null, 'CASUAL_DAILY_WAGE')))).toEqual([
      ['NIGHT_SHIFT_DIFFERENTIAL_CASUAL_DAILY_WAGE_UNSETTLED', 'BLOCKING'],
    ]);
    expect(
      at(
        basisOf({
          status: 'INDETERMINATE',
          from: '2026-03-01',
          to: '2026-03-31',
          personnel: null,
          salarySchedule: null,
          reasons: [{ code: 'NO_SERVICE_SEGMENT', message: 'No segment.' }],
        }),
      ),
    ).toEqual([['NIGHT_SHIFT_DIFFERENTIAL_BASIS_INDETERMINATE', 'BLOCKING']]);
    // 7 minutes × 200 ÷ 60 × 10% is 2.3333…, and no recorded rule rounds it.
    const rounding = calculate([night('2026-03-10', 7)], [rate]);
    expect(rounding.lines).toEqual([]);
    expect(exceptionTypes(rounding)).toEqual([
      ['NIGHT_SHIFT_DIFFERENTIAL_ROUNDING_UNSETTLED', 'BLOCKING'],
    ]);
  });
});
