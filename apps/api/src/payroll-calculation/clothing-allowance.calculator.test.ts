import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
} from '../compensation-basis/compensation-basis.service';
import {
  CLOTHING_ALLOWANCE_COMPONENT_CODE,
  ClothingAllowanceCalculator,
} from './clothing-allowance.calculator';
import type {
  CalculationContext,
  ClothingAllowanceGrant,
  EmployeePayrollSources,
  FrozenRuleVersion,
} from './payroll-calculator';

// The FY 2026 amount (GAA sec. 64; BC No. 2024-1 item 6.1) and six months as
// 180 days (items 8.1 and 9.1; Annex A example 3), as the loaded version
// carries them; docs/research/clothing-allowance-authorities.md U1, U3, U7, U17.
const clothingVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'clothing-2026',
  code: 'CLOTHING-FY2026',
  ruleKind: 'CLOTHING_ALLOWANCE',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  successorEffectiveFrom: null,
  parameters: { annualAmount: '7000.00', minimumServiceDays: 180 },
  ...overrides,
});

const contextWith = (
  versions: FrozenRuleVersion[] = [clothingVersion()],
  overrides: Partial<CalculationContext> = {},
): CalculationContext => ({
  periodFrom: '2026-01-01',
  periodTo: '2026-12-31',
  snapshotRuleVersionIds: new Set(versions.map((version) => version.id)),
  snapshotRuleVersions: versions,
  componentCodes: new Set([CLOTHING_ALLOWANCE_COMPONENT_CODE]),
  ...overrides,
});

const served = (
  from: string,
  to: string,
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
  salarySchedule: { ruleVersionId: 'schedule-a', ruleVersionCode: 'SSL-TEST', monthlyRate: '0' },
  rate: { monthlyRate: '0', dailyRate: '0', derivation: 'test' },
});

const unserved = (from: string, to: string): CompensationBasisStretch => ({
  status: 'INDETERMINATE',
  from,
  to,
  personnel: null,
  salarySchedule: null,
  reasons: [{ code: 'NO_SERVICE_SEGMENT', message: 'No Service Segment.' }],
});

const basisOf = (...stretches: CompensationBasisStretch[]): CompensationBasis => ({
  employeeId: 'employee-1',
  from: '2026-01-01',
  to: '2026-12-31',
  status: stretches.every((stretch) => stretch.status === 'RESOLVED')
    ? 'RESOLVED'
    : 'INDETERMINATE',
  stretches,
});

const agencyGrant: ClothingAllowanceGrant = {
  agencyPayrollApplicabilityId: 'grant-agency',
  scope: 'AGENCY',
  authorityDocumentVersionId: 'guideline-1',
};

const sourcesOf = (overrides: Partial<EmployeePayrollSources> = {}): EmployeePayrollSources => ({
  payrollInputs: [],
  absenceFacts: [],
  nightDutyFacts: [],
  nightShiftDifferentialRates: [],
  unchargedDeficitFacts: [],
  valuationBases: [],
  positionTitles: [],
  periodAttendance: { coveredDates: [], workDates: [] },
  officialVehicleAssignments: [],
  clothingAllowanceGrants: [agencyGrant],
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
  ...overrides,
});

/** Service entered on `from` under an appointment of `nature`. */
const enteredUnder = (from: string, nature: string | null) => ({
  serviceSegmentAppointments: [
    { serviceSegmentId: `segment-${from}`, natureOfAppointment: nature },
  ],
});

const calculator = new ClothingAllowanceCalculator();
const run = (
  basis: CompensationBasis,
  sources: Partial<EmployeePayrollSources> = {},
  context = contextWith(),
) => calculator.calculate(basis, context, [], sourcesOf(sources));

const amounts = (outcome: ReturnType<typeof run>) =>
  outcome.lines.map((line) => [line.componentCode, line.quantity, line.amount]);
const exceptionTypes = (outcome: ReturnType<typeof run>) =>
  outcome.exceptions.map((exception) => exception.exceptionType);

const fullYear = basisOf(served('2026-01-01', '2026-12-31'));

describe('ClothingAllowanceCalculator', () => {
  it('pays the annual amount for a year of full-time service as a de minimis earning', () => {
    const outcome = run(fullYear);
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: CLOTHING_ALLOWANCE_COMPONENT_CODE,
        lineType: 'EARNING',
        ruleVersionId: 'clothing-2026',
        quantity: '1.0000',
        rate: '7000.00000000',
        amount: '7000.0000',
      }),
    ]);
    expect(outcome.lines[0]?.source).toMatchObject({
      fiscalYear: '2026',
      serviceDays: 365,
      minimumServiceDays: 180,
      unit: 'FULL_TIME_ANNUAL_AMOUNT',
      agencyPayrollApplicability: agencyGrant,
      taxTreatment: 'DE_MINIMIS',
    });
  });

  it('writes nothing without a recorded cash grant, whatever else is missing', () => {
    expect(run(fullYear, { clothingAllowanceGrants: [] }, contextWith([]))).toEqual({
      lines: [],
      exceptions: [],
    });
  });

  it('writes nothing in a period that does not name the clothing allowance', () => {
    const context = contextWith(undefined, { componentCodes: new Set(['CASH_GIFT']) });
    expect(run(fullYear, {}, context)).toEqual({ lines: [], exceptions: [] });
  });

  it("prefers the Employee's own grant over the Agency-wide one", () => {
    const own: ClothingAllowanceGrant = {
      agencyPayrollApplicabilityId: 'grant-own',
      scope: 'EMPLOYEE',
      authorityDocumentVersionId: 'guideline-2',
    };
    const outcome = run(fullYear, { clothingAllowanceGrants: [agencyGrant, own] });
    expect(outcome.lines[0]?.source).toMatchObject({ agencyPayrollApplicability: own });
  });

  it('pays at exactly 180 days of service in the year and not at 179 (items 8.1 and 9.1)', () => {
    // 1 January to 29 June 2026 is 180 days; the Employee leaves after it.
    const atMinimum = basisOf(
      served('2026-01-01', '2026-06-29'),
      unserved('2026-06-30', '2026-12-31'),
    );
    expect(amounts(run(atMinimum))).toEqual([
      [CLOTHING_ALLOWANCE_COMPONENT_CODE, '1.0000', '7000.0000'],
    ]);
    expect(run(atMinimum).lines[0]?.source).toMatchObject({ serviceDays: 180 });

    const underMinimum = basisOf(
      served('2026-01-01', '2026-06-28'),
      unserved('2026-06-29', '2026-12-31'),
    );
    expect(run(underMinimum)).toEqual({ lines: [], exceptions: [] });
  });

  it('counts the days a new hire is still to serve in the year, as Annex A example 3 does', () => {
    // Assumption on 1 April: 275 days to 31 December.
    const april = basisOf(unserved('2026-01-01', '2026-03-31'), served('2026-04-01', '2026-12-31'));
    const outcome = run(april, enteredUnder('2026-04-01', 'ORIGINAL'));
    expect(amounts(outcome)).toEqual([[CLOTHING_ALLOWANCE_COMPONENT_CODE, '1.0000', '7000.0000']]);
    expect(outcome.lines[0]?.source).toMatchObject({ serviceDays: 275 });

    // 5 July to 31 December is 180 days; 6 July is 179 (item 9.1).
    const july5 = basisOf(unserved('2026-01-01', '2026-07-04'), served('2026-07-05', '2026-12-31'));
    expect(amounts(run(july5, enteredUnder('2026-07-05', 'ORIGINAL')))).toHaveLength(1);
    const july6 = basisOf(unserved('2026-01-01', '2026-07-05'), served('2026-07-06', '2026-12-31'));
    expect(run(july6, enteredUnder('2026-07-06', 'ORIGINAL'))).toEqual({
      lines: [],
      exceptions: [],
    });
  });

  it('counts service across a promotion inside the year as one stretch, with no new entry', () => {
    const promoted = basisOf(
      served('2026-01-01', '2026-05-31'),
      served('2026-06-01', '2026-12-31'),
    );
    expect(amounts(run(promoted, enteredUnder('2026-06-01', 'PROMOTION')))).toEqual([
      [CLOTHING_ALLOWANCE_COMPONENT_CODE, '1.0000', '7000.0000'],
    ]);
  });

  it('pays a part-time Employee in proportion to the employment fraction (item 6.2)', () => {
    const partTime = basisOf(served('2026-01-01', '2026-12-31', 'PART_TIME_PROPORTIONAL', '0.5'));
    const outcome = run(partTime);
    expect(amounts(outcome)).toEqual([[CLOTHING_ALLOWANCE_COMPONENT_CODE, '0.5000', '3500.0000']]);
    expect(outcome.lines[0]?.source).toMatchObject({
      unit: 'EMPLOYMENT_FRACTION',
      employmentFraction: '0.5',
      taxTreatment: 'DE_MINIMIS',
    });
  });

  it('pays a part-time Employee nothing under 180 days of service', () => {
    const partTime = basisOf(
      served('2026-01-01', '2026-06-28', 'PART_TIME_PROPORTIONAL', '0.5'),
      unserved('2026-06-29', '2026-12-31'),
    );
    expect(run(partTime)).toEqual({ lines: [], exceptions: [] });
  });

  it('blocks a transfer into the Agency inside the year, at any length of service (item 9.3)', () => {
    for (const [before, from] of [
      ['2026-02-28', '2026-03-01'],
      ['2026-09-30', '2026-10-01'],
    ] as const) {
      const transferred = basisOf(unserved('2026-01-01', before), served(from, '2026-12-31'));
      const outcome = run(transferred, enteredUnder(from, 'TRANSFER'));
      expect(outcome.lines).toEqual([]);
      expect(exceptionTypes(outcome)).toEqual(['CLOTHING_ALLOWANCE_TRANSFER_UNSETTLED']);
    }
  });

  it('blocks an entry inside the year under another appointment or none (items 8.1, 13.0)', () => {
    const entered = basisOf(
      unserved('2026-01-01', '2026-02-28'),
      served('2026-03-01', '2026-12-31'),
    );
    expect(exceptionTypes(run(entered, enteredUnder('2026-03-01', null)))).toEqual([
      'CLOTHING_ALLOWANCE_ENTRY_UNSETTLED',
    ]);
    // Service from 1 January, a gap, and reemployment later in the year.
    const reemployed = basisOf(
      served('2026-01-01', '2026-03-31'),
      unserved('2026-04-01', '2026-04-30'),
      served('2026-05-01', '2026-12-31'),
    );
    expect(exceptionTypes(run(reemployed, enteredUnder('2026-05-01', 'REEMPLOYMENT')))).toEqual([
      'CLOTHING_ALLOWANCE_ENTRY_UNSETTLED',
    ]);
  });

  it('blocks a casual daily wage, a change of basis in the year, and a missing basis', () => {
    expect(
      exceptionTypes(run(basisOf(served('2026-01-01', '2026-12-31', 'CASUAL_DAILY_WAGE')))),
    ).toEqual(['CLOTHING_ALLOWANCE_CASUAL_UNSETTLED']);
    expect(
      exceptionTypes(
        run(
          basisOf(
            served('2026-01-01', '2026-06-30', 'PART_TIME_PROPORTIONAL', '0.5'),
            served('2026-07-01', '2026-12-31'),
          ),
        ),
      ),
    ).toEqual(['CLOTHING_ALLOWANCE_PAY_BASIS_CHANGE_UNSETTLED']);
    const noBasis = basisOf({
      status: 'INDETERMINATE',
      from: '2026-01-01',
      to: '2026-12-31',
      personnel: {
        serviceSegmentId: 'segment-2026-01-01',
        salaryGrade: 11,
        salaryStep: 1,
        payBasis: null,
        employmentFraction: null,
      },
      salarySchedule: null,
      reasons: [{ code: 'MISSING_PAY_BASIS', message: 'No pay basis.' }],
    });
    expect(exceptionTypes(run(noBasis))).toEqual(['CLOTHING_ALLOWANCE_PAY_BASIS_UNSETTLED']);
  });

  it('blocks a period that is not one fiscal year, and a missing or changing rule version', () => {
    const partYear = contextWith(undefined, { periodFrom: '2026-01-01', periodTo: '2026-10-31' });
    expect(exceptionTypes(run(fullYear, {}, partYear))).toEqual([
      'CLOTHING_ALLOWANCE_PERIOD_NOT_FISCAL_YEAR',
    ]);
    expect(exceptionTypes(run(fullYear, {}, contextWith([])))).toEqual([
      'CLOTHING_ALLOWANCE_RULE_NOT_IN_EFFECT',
    ]);
    const split = [
      clothingVersion({ effectiveTo: '2026-06-30' }),
      clothingVersion({ id: 'clothing-2026-b', effectiveFrom: '2026-07-01' }),
    ];
    expect(exceptionTypes(run(fullYear, {}, contextWith(split)))).toEqual([
      'CLOTHING_ALLOWANCE_RULE_CHANGE_IN_PERIOD',
    ]);
  });

  it('blocks an amount that is not whole centavos', () => {
    const third = basisOf(served('2026-01-01', '2026-12-31', 'PART_TIME_PROPORTIONAL', '0.333333'));
    expect(exceptionTypes(run(third))).toEqual(['CLOTHING_ALLOWANCE_ROUNDING_UNSETTLED']);
  });
});
