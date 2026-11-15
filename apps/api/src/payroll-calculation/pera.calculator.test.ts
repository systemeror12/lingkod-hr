import { describe, expect, it } from 'vitest';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PayBasis,
} from '../compensation-basis/compensation-basis.service';
import type { CalculatedLine, CalculationContext, FrozenRuleVersion } from './payroll-calculator';
import { PeraCalculator } from './pera.calculator';

// The FY 2026 amounts (GAA sec. 63; BC No. 2009-3 items 5.2 and 5.4), as the
// loaded version carries them; docs/research/pera-authorities.md P1, P4, P5.
const peraVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'pera-2026',
  code: 'PERA-FY2026',
  ruleKind: 'PERA',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  successorEffectiveFrom: null,
  parameters: { monthlyAmount: '2000.00', dailyAmount: '90.91' },
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
  from: '2026-03-01',
  to: '2026-03-31',
  status: stretches.every((stretch) => stretch.status === 'RESOLVED')
    ? 'RESOLVED'
    : 'INDETERMINATE',
  stretches,
});

const fullTime = basisOf(served('2026-03-01', '2026-03-31'));
const partTime = basisOf(served('2026-03-01', '2026-03-31', 'PART_TIME_PROPORTIONAL', '0.5'));

const basicSalary: CalculatedLine = {
  componentCode: 'BASIC_SALARY',
  lineType: 'EARNING',
  ruleVersionId: 'schedule-a',
  quantity: '1.0000',
  rate: '31705.00000000',
  amount: '31705.0000',
  source: {},
};

const daysWithoutPay = (month: string, days: string): CalculatedLine => ({
  componentCode: 'DAYS_WITHOUT_PAY',
  lineType: 'DEDUCTION',
  ruleVersionId: 'schedule-a',
  quantity: days,
  rate: '31705.00000000',
  amount: '0.0000',
  source: { month },
  sourceRecords: [{ payrollInputId: `lwop-${month}` }, { attendancePayrollFactId: 'absence-1' }],
});

const calculate = (
  basis: CompensationBasis,
  earlier: CalculatedLine[] = [basicSalary],
  context = contextWith(peraVersion()),
) => new PeraCalculator().calculate(basis, context, earlier);

const typesOf = (outcome: ReturnType<typeof calculate>) =>
  outcome.exceptions.map((exception) => exception.exceptionType);

describe('PeraCalculator', () => {
  it('pays the monthly amount for a full month of full-time service, as a non-taxable earning', () => {
    const { lines, exceptions } = calculate(fullTime);
    expect(exceptions).toEqual([]);
    expect(lines).toEqual([
      expect.objectContaining({
        componentCode: 'PERA',
        lineType: 'EARNING',
        ruleVersionId: 'pera-2026',
        quantity: '1.0000',
        rate: '2000.00000000',
        amount: '2000.0000',
        source: expect.objectContaining({
          unit: 'MONTH',
          ruleVersionCode: 'PERA-FY2026',
          payBasis: 'MONTHLY_FULL_TIME',
          taxTreatment: 'NON_TAXABLE',
          basedOn: { componentCode: 'BASIC_SALARY', amount: '31705.0000' },
        }),
      }),
    ]);
    expect(lines[0]?.sourceRecords).toBeUndefined();
  });

  it('takes its amounts from the rule version, not from code', () => {
    const { lines } = calculate(
      fullTime,
      [basicSalary],
      contextWith(peraVersion({ parameters: { monthlyAmount: '2500.00', dailyAmount: '113.64' } })),
    );
    expect(lines.map((line) => line.amount)).toEqual(['2500.0000']);
    const withDays = calculate(
      fullTime,
      [basicSalary, daysWithoutPay('2026-03', '2.0000')],
      contextWith(peraVersion({ parameters: { monthlyAmount: '2500.00', dailyAmount: '113.64' } })),
    );
    expect(withDays.lines.map((line) => line.amount)).toEqual(['2272.8000']);
  });

  it('pays part-time service in direct proportion to the monthly amount', () => {
    const { lines, exceptions } = calculate(partTime);
    expect(exceptions).toEqual([]);
    expect(lines).toEqual([
      expect.objectContaining({
        componentCode: 'PERA',
        quantity: '0.5000',
        rate: '2000.00000000',
        amount: '1000.0000',
        source: expect.objectContaining({
          unit: 'EMPLOYMENT_FRACTION',
          payBasis: 'PART_TIME_PROPORTIONAL',
          employmentFraction: '0.5',
          taxTreatment: 'NON_TAXABLE',
        }),
      }),
    ]);
  });

  it('pays the daily amount for each day with basic pay in a month with leave without pay', () => {
    const { lines, exceptions } = calculate(fullTime, [
      basicSalary,
      daysWithoutPay('2026-03', '3.0000'),
    ]);
    expect(exceptions).toEqual([]);
    // 22 − 3 = 19 days with basic pay, at ₱90.91 a day.
    expect(lines).toEqual([
      expect.objectContaining({
        componentCode: 'PERA',
        quantity: '19.0000',
        rate: '90.91000000',
        amount: '1727.2900',
        source: expect.objectContaining({ unit: 'DAY', daysWithoutPay: '3.0000' }),
        sourceRecords: [
          { payrollInputId: 'lwop-2026-03' },
          { attendancePayrollFactId: 'absence-1' },
        ],
      }),
    ]);
  });

  it('pays nothing when the month has no day with basic pay, or no basic salary line', () => {
    expect(calculate(fullTime, [basicSalary, daysWithoutPay('2026-03', '22.0000')])).toEqual({
      lines: [],
      exceptions: [],
    });
    // Basic salary's own exception explains why it wrote no line.
    expect(calculate(fullTime, [])).toEqual({ lines: [], exceptions: [] });
  });

  it('blocks a partial month, which no item of the circular prorates', () => {
    const outcome = calculate(
      basisOf(unserved('2026-03-01', '2026-03-15'), served('2026-03-16', '2026-03-31')),
    );
    expect(outcome.lines).toEqual([]);
    expect(typesOf(outcome)).toEqual(['PERA_PARTIAL_MONTH']);
    expect(outcome.exceptions[0]).toMatchObject({
      severity: 'BLOCKING',
      details: { unservedDates: [{ from: '2026-03-01', to: '2026-03-15' }] },
    });
  });

  it('blocks a missing, expired, or changing PERA version', () => {
    expect(typesOf(calculate(fullTime, [basicSalary], contextWith()))).toEqual([
      'PERA_RULE_NOT_IN_EFFECT',
    ]);
    const expired = calculate(
      fullTime,
      [basicSalary],
      contextWith(peraVersion({ effectiveTo: '2026-02-28' })),
    );
    expect(typesOf(expired)).toEqual(['PERA_RULE_NOT_IN_EFFECT']);
    expect(expired.exceptions[0]?.details.message).toContain('ended on 2026-02-28');
    const changing = calculate(
      fullTime,
      [basicSalary],
      contextWith(
        peraVersion({ effectiveTo: '2026-03-15' }),
        peraVersion({ id: 'pera-b', code: 'PERA-B', effectiveFrom: '2026-03-16' }),
      ),
    );
    expect(typesOf(changing)).toEqual(['PERA_RULE_CHANGE_IN_PERIOD']);
  });

  it('blocks days without pay dated in another month, and part-time with days without pay', () => {
    const late = calculate(fullTime, [basicSalary, daysWithoutPay('2026-02', '1.0000')]);
    expect(late.lines).toEqual([]);
    expect(typesOf(late)).toEqual(['PERA_OTHER_MONTH_DAYS_WITHOUT_PAY_UNSETTLED']);
    expect(late.exceptions[0]?.details).toMatchObject({ months: ['2026-02'] });

    const partTimeAbsent = calculate(partTime, [basicSalary, daysWithoutPay('2026-03', '1.0000')]);
    expect(typesOf(partTimeAbsent)).toEqual(['PERA_PART_TIME_DAYS_WITHOUT_PAY_UNSETTLED']);
  });

  it('blocks a casual daily wage and an amount that is not whole centavos', () => {
    const casual = calculate(basisOf(served('2026-03-01', '2026-03-31', 'CASUAL_DAILY_WAGE')));
    expect(typesOf(casual)).toEqual(['PERA_CASUAL_DAYS_UNSETTLED']);

    const third = calculate(
      basisOf(served('2026-03-01', '2026-03-31', 'PART_TIME_PROPORTIONAL', '0.333333')),
    );
    expect(third.lines).toEqual([]);
    expect(typesOf(third)).toEqual(['PERA_ROUNDING_UNSETTLED']);
  });
});
