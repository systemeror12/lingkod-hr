import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
} from '../compensation-basis/compensation-basis.service';
import { nationalPayrollRuleVersionFileSchema } from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
} from './contribution.calculators';
import type { CalculatedLine, CalculationContext, FrozenRuleVersion } from './payroll-calculator';

// Test fixtures only: these rates, limits, and ceilings are not from any
// issuance. The real values are loaded from a cited rule version.
const gsisVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'gsis-a',
  code: 'GSIS-TEST-A',
  ruleKind: 'GSIS_CONTRIBUTION',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  successorEffectiveFrom: null,
  parameters: { employeeRate: '0.09', employerRate: '0.12', monthlyCompensationLimit: '100000' },
  ...overrides,
});

const ecVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'ec-a',
  code: 'EC-TEST-A',
  ruleKind: 'EMPLOYEES_COMPENSATION',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  successorEffectiveFrom: null,
  parameters: { employerRate: '0.01', monthlySalaryCreditCeiling: '20000' },
  ...overrides,
});

const contextWith = (...versions: FrozenRuleVersion[]): CalculationContext => ({
  periodFrom: '2026-03-01',
  periodTo: '2026-03-31',
  snapshotRuleVersionIds: new Set(versions.map((version) => version.id)),
  snapshotRuleVersions: versions,
  componentCodes: new Set<string>(),
});

const served = (from: string, to: string): CompensationBasisStretch => ({
  status: 'RESOLVED',
  from,
  to,
  personnel: {
    serviceSegmentId: `segment-${from}`,
    salaryGrade: 11,
    salaryStep: 1,
    payBasis: 'MONTHLY_FULL_TIME',
    employmentFraction: null,
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
  from: '2026-03-01',
  to: '2026-03-31',
  status: stretches.every((stretch) => stretch.status === 'RESOLVED')
    ? 'RESOLVED'
    : 'INDETERMINATE',
  stretches,
});

const fullMonth = basisOf(served('2026-03-01', '2026-03-31'));

const basicSalary = (amount: string): CalculatedLine[] => [
  {
    componentCode: 'BASIC_SALARY',
    lineType: 'EARNING',
    ruleVersionId: 'schedule-a',
    quantity: '1.0000',
    rate: `${amount}.00000000`,
    amount: `${amount}.0000`,
    source: {},
  },
];

const gsis = new GsisContributionCalculator();
const ec = new EmployeesCompensationCalculator();
const types = (outcome: { exceptions: { exceptionType: string }[] }) =>
  outcome.exceptions.map((exception) => exception.exceptionType);

describe('GsisContributionCalculator', () => {
  it("takes the version's shares of the month's basic salary as a deduction and an employer share", () => {
    const outcome = gsis.calculate(fullMonth, contextWith(gsisVersion()), basicSalary('31705'));

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: 'GSIS_PERSONAL_SHARE',
        lineType: 'DEDUCTION',
        ruleVersionId: 'gsis-a',
        quantity: '31705.0000',
        rate: '0.09000000',
        amount: '2853.4500',
      }),
      expect.objectContaining({
        componentCode: 'GSIS_GOVERNMENT_SHARE',
        lineType: 'EMPLOYER_SHARE',
        ruleVersionId: 'gsis-a',
        rate: '0.12000000',
        amount: '3804.6000',
      }),
    ]);
    expect(outcome.contributions).toEqual([
      {
        contributionType: 'GSIS',
        employeeShare: '2853.4500',
        employerShare: '3804.6000',
        compensationBase: '31705.0000',
        ruleVersionId: 'gsis-a',
      },
    ]);
  });

  it('blocks with no version, naming one that expired before the month ended', () => {
    expect(types(gsis.calculate(fullMonth, contextWith(), basicSalary('31705')))).toEqual([
      'GSIS_RULE_NOT_IN_EFFECT',
    ]);
    const expired = gsis.calculate(
      fullMonth,
      contextWith(gsisVersion({ effectiveTo: '2026-03-15' })),
      basicSalary('31705'),
    );
    expect(expired.lines).toEqual([]);
    expect(expired.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'GSIS_RULE_NOT_IN_EFFECT',
        severity: 'BLOCKING',
        details: expect.objectContaining({
          message: expect.stringContaining('GSIS-TEST-A ended on 2026-03-15'),
        }),
      }),
    ]);
    // A version of another kind is no GSIS version.
    expect(
      types(gsis.calculate(fullMonth, contextWith(ecVersion()), basicSalary('31705'))),
    ).toEqual(['GSIS_RULE_NOT_IN_EFFECT']);
  });

  it('blocks a version that changes inside the month', () => {
    const context = contextWith(
      gsisVersion({ successorEffectiveFrom: '2026-03-16' }),
      gsisVersion({ id: 'gsis-b', code: 'GSIS-TEST-B', effectiveFrom: '2026-03-16' }),
    );
    expect(types(gsis.calculate(fullMonth, context, basicSalary('31705')))).toEqual([
      'GSIS_RULE_CHANGE_IN_PERIOD',
    ]);
  });

  it('blocks a partial month even when a basic salary line exists', () => {
    const partial = basisOf(
      unserved('2026-03-01', '2026-03-15'),
      served('2026-03-16', '2026-03-31'),
    );
    const outcome = gsis.calculate(partial, contextWith(gsisVersion()), basicSalary('31705'));
    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions).toEqual([
      expect.objectContaining({
        exceptionType: 'GSIS_PARTIAL_MONTH',
        details: expect.objectContaining({
          unservedDates: [{ from: '2026-03-01', to: '2026-03-15' }],
        }),
      }),
    ]);
  });

  it('writes nothing without a basic salary line, which blocks on its own', () => {
    expect(gsis.calculate(fullMonth, contextWith(gsisVersion()), [])).toEqual({
      lines: [],
      exceptions: [],
    });
  });

  it('blocks a salary above the AMC limit and takes the whole salary when the version sets none', () => {
    const limited = gsisVersion({
      parameters: { employeeRate: '0.09', employerRate: '0.12', monthlyCompensationLimit: '30000' },
    });
    expect(types(gsis.calculate(fullMonth, contextWith(limited), basicSalary('31705')))).toEqual([
      'GSIS_ABOVE_AMC_LIMIT',
    ]);
    expect(
      gsis.calculate(fullMonth, contextWith(limited), basicSalary('30000')).exceptions,
    ).toEqual([]);
    const unlimited = gsisVersion({
      parameters: { employeeRate: '0.09', employerRate: '0.12', monthlyCompensationLimit: null },
    });
    expect(
      gsis.calculate(fullMonth, contextWith(unlimited), basicSalary('31705')).contributions,
    ).toEqual([expect.objectContaining({ compensationBase: '31705.0000' })]);
  });

  it('blocks a share that is not whole centavos', () => {
    // 9% of 15,852.50 is 1,426.725.
    const line = basicSalary('15852')[0]!;
    const half = [{ ...line, amount: '15852.5000' }];
    expect(types(gsis.calculate(fullMonth, contextWith(gsisVersion()), half))).toEqual([
      'GSIS_ROUNDING_UNSETTLED',
    ]);
  });
});

describe('EmployeesCompensationCalculator', () => {
  it('caps the base at the salary credit ceiling and writes only an employer share', () => {
    const outcome = ec.calculate(fullMonth, contextWith(ecVersion()), basicSalary('31705'));

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: 'EMPLOYEES_COMPENSATION',
        lineType: 'EMPLOYER_SHARE',
        ruleVersionId: 'ec-a',
        quantity: '20000.0000',
        rate: '0.01000000',
        amount: '200.0000',
        source: expect.objectContaining({ ceilingApplied: true }),
      }),
    ]);
    expect(outcome.contributions).toEqual([
      {
        contributionType: 'EMPLOYEES_COMPENSATION',
        employeeShare: '0.0000',
        employerShare: '200.0000',
        compensationBase: '20000.0000',
        ruleVersionId: 'ec-a',
      },
    ]);
  });

  it('takes the whole salary below the ceiling and never a deduction', () => {
    const outcome = ec.calculate(fullMonth, contextWith(ecVersion()), basicSalary('16007'));
    expect(outcome.contributions).toEqual([
      expect.objectContaining({ compensationBase: '16007.0000', employerShare: '160.0700' }),
    ]);
    expect(outcome.lines.map((line) => line.lineType)).toEqual(['EMPLOYER_SHARE']);
  });

  it('blocks with no version, in a partial month, and on an unrounded share', () => {
    expect(types(ec.calculate(fullMonth, contextWith(), basicSalary('16007')))).toEqual([
      'EMPLOYEES_COMPENSATION_RULE_NOT_IN_EFFECT',
    ]);
    const partial = basisOf(
      served('2026-03-01', '2026-03-20'),
      unserved('2026-03-21', '2026-03-31'),
    );
    expect(types(ec.calculate(partial, contextWith(ecVersion()), basicSalary('16007')))).toEqual([
      'EMPLOYEES_COMPENSATION_PARTIAL_MONTH',
    ]);
    // 1% of 16,007.50 is 160.075.
    const line = basicSalary('16007')[0]!;
    expect(
      types(ec.calculate(fullMonth, contextWith(ecVersion()), [{ ...line, amount: '16007.5000' }])),
    ).toEqual(['EMPLOYEES_COMPENSATION_ROUNDING_UNSETTLED']);
  });
});

describe('contribution rule version files', () => {
  const file = (ruleKind: string, parameters: unknown) => ({
    ruleKind,
    code: 'TEST-348-RULE',
    name: 'Test contribution rule',
    issuingAuthority: 'Test authority',
    issuanceReference: 'Test fixture, not an issuance',
    sourceUrl: 'https://example.test/contribution',
    researchRegister: 'docs/research/national-payroll-rule-versions-2027.md#R17',
    verifiedOn: '2026-11-15',
    verifiedBy: 'LingkodHR test fixture',
    effectiveFrom: '2881-01-01',
    effectiveTo: null,
    supersedesCode: null,
    parameters,
  });
  const parses = (ruleKind: string, parameters: unknown) =>
    nationalPayrollRuleVersionFileSchema.safeParse(file(ruleKind, parameters)).success;

  it('requires every GSIS value, stating the AMC limit even when it is none', () => {
    expect(
      parses('GSIS_CONTRIBUTION', {
        employeeRate: '0.09',
        employerRate: '0.12',
        monthlyCompensationLimit: null,
      }),
    ).toBe(true);
    expect(parses('GSIS_CONTRIBUTION', { employeeRate: '0.09', employerRate: '0.12' })).toBe(false);
    expect(
      parses('GSIS_CONTRIBUTION', {
        employeeRate: '9',
        employerRate: '0.12',
        monthlyCompensationLimit: null,
      }),
    ).toBe(false);
  });

  it('gives Employees Compensation no employee rate and requires its ceiling', () => {
    expect(
      parses('EMPLOYEES_COMPENSATION', { employerRate: '0.01', monthlySalaryCreditCeiling: '1' }),
    ).toBe(true);
    expect(
      parses('EMPLOYEES_COMPENSATION', {
        employeeRate: '0.01',
        employerRate: '0.01',
        monthlySalaryCreditCeiling: '1',
      }),
    ).toBe(false);
    expect(parses('EMPLOYEES_COMPENSATION', { employerRate: '0.01' })).toBe(false);
  });
});
