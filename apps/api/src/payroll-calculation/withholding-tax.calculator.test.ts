import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import {
  compensationWithholdingTaxParameters,
  nationalPayrollRuleVersionFileSchema,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import type {
  CalculatedLine,
  CalculationContext,
  EmployeePayrollSources,
  FrozenRuleVersion,
  TaxYearToDate,
} from './payroll-calculator';
import { WithholdingTaxCalculator, withholdingTaxDue } from './withholding-tax.calculator';

// Test fixtures only: the table follows Annex E's monthly table, effective
// January 1, 2023 (research register R24), the exclusion RR No. 11-2018 sec.
// 2.78.1(B)(11) (R26), and the ceilings RR No. 29-2025 (R25), but no real
// version is loaded until a reviewer loads its file.
const annexEMonthly = [
  { compensationLevel: '0', baseTax: '0', rateOverCompensationLevel: '0' },
  { compensationLevel: '20833', baseTax: '0', rateOverCompensationLevel: '0.15' },
  { compensationLevel: '33333', baseTax: '1875', rateOverCompensationLevel: '0.20' },
  { compensationLevel: '66667', baseTax: '8541.80', rateOverCompensationLevel: '0.25' },
  { compensationLevel: '166667', baseTax: '33541.80', rateOverCompensationLevel: '0.30' },
  { compensationLevel: '666667', baseTax: '183541.80', rateOverCompensationLevel: '0.35' },
];

const withholdingVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'tax-a',
  code: 'TAX-TEST-A',
  ruleKind: 'COMPENSATION_WITHHOLDING_TAX',
  effectiveFrom: '2023-01-01',
  effectiveTo: null,
  successorEffectiveFrom: null,
  parameters: { thirteenthMonthAndOtherBenefitsExclusion: '90000', monthlyTable: annexEMonthly },
  ...overrides,
});

const deMinimisVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'de-minimis-a',
  code: 'DE-MINIMIS-TEST-A',
  ruleKind: 'DE_MINIMIS_BENEFITS',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  successorEffectiveFrom: null,
  parameters: {
    benefits: [
      { benefit: 'MONETIZED_LEAVE_CREDITS', annualCeiling: null },
      { benefit: 'UNIFORM_AND_CLOTHING', annualCeiling: '8000' },
    ],
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

const noYearToDate: TaxYearToDate = {
  taxYear: 2026,
  payrollPeriodIds: [],
  taxableCompensation: '0.0000',
  nonTaxableCompensation: '0.0000',
  withholdingTax: '0.0000',
  deMinimisBenefits: {},
  thirteenthMonthAndOtherBenefits: '0.0000',
};

const sourcesWith = (taxYearToDate: TaxYearToDate = noYearToDate): EmployeePayrollSources => ({
  payrollInputs: [],
  absenceFacts: [],
  nightDutyFacts: [],
  nightShiftDifferentialRates: [],
  unchargedDeficitFacts: [],
  valuationBases: [],
  positionTitles: [],
  periodAttendance: { coveredDates: [], workDates: [] },
  officialVehicleAssignments: [],
  clothingAllowanceGrants: [],
  serviceSegmentAppointments: [],
  taxYearToDate,
});

const line = (
  componentCode: string,
  lineType: CalculatedLine['lineType'],
  amount: string,
  source: Record<string, unknown>,
): CalculatedLine => ({
  componentCode,
  lineType,
  ruleVersionId: null,
  quantity: null,
  rate: null,
  amount: new Prisma.Decimal(amount).toFixed(4),
  source,
});

const regular = { taxTreatment: 'REGULAR_COMPENSATION' };
const contribution = { taxTreatment: 'MANDATORY_CONTRIBUTION' };
const salary = (amount: string) => line('BASIC_SALARY', 'EARNING', amount, regular);
const overtime = (amount: string) =>
  line('OVERTIME_PAY', 'EARNING', amount, { taxTreatment: 'SUPPLEMENTARY_COMPENSATION' });
const bonus = (amount: string) =>
  line('YEAR_END_BONUS', 'EARNING', amount, {
    taxTreatment: 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS',
  });
const benefitsPaid = (amount: string) =>
  sourcesWith({ ...noYearToDate, thirteenthMonthAndOtherBenefits: amount });

const basis = { employeeId: 'employee-1', stretches: [] } as unknown as CompensationBasis;
const calculator = new WithholdingTaxCalculator();
const calculate = (
  lines: CalculatedLine[],
  context = contextWith(withholdingVersion(), deMinimisVersion()),
  sources = sourcesWith(),
) => calculator.calculate(basis, context, lines, sources);
const exceptionTypes = (outcome: ReturnType<typeof calculate>) =>
  outcome.exceptions.map((exception) => exception.exceptionType);

describe('withholdingTaxDue on Annex E monthly table', () => {
  const table = compensationWithholdingTaxParameters.parse(
    withholdingVersion().parameters,
  ).monthlyTable;
  const due = (amount: string) => withholdingTaxDue(new Prisma.Decimal(amount), table);

  it.each([
    ['0', '0', '0'],
    ['20832', '0', '0'],
    ['20833', '20833', '0'],
    ['20834', '20833', '0.15'],
    ['33332', '20833', '1874.85'],
    ['33333', '33333', '1875'],
    ['33334', '33333', '1875.2'],
    ['66666', '33333', '8541.6'],
    ['66667', '66667', '8541.8'],
    ['66668', '66667', '8542.05'],
    ['166666', '66667', '33541.55'],
    ['166667', '166667', '33541.8'],
    ['166668', '166667', '33542.1'],
    ['666666', '166667', '183541.5'],
    ['666667', '666667', '183541.8'],
    ['666668', '666667', '183542.15'],
  ])('taxes %s in the bracket from %s at %s', (amount, level, tax) => {
    const { bracket, tax: actual } = due(amount);
    expect([bracket.compensationLevel, actual.toString()]).toEqual([level, tax]);
  });

  it('taxes an amount below zero as zero', () => {
    expect(due('-500').tax.toString()).toBe('0');
  });
});

describe('the withholding tax and de minimis rule versions', () => {
  const file = (ruleKind: string, parameters: unknown) =>
    nationalPayrollRuleVersionFileSchema.safeParse({
      ruleKind,
      code: 'TEST',
      name: 'Test',
      issuingAuthority: 'BIR',
      issuanceReference: 'Test',
      sourceUrl: 'https://example.test/annex-e',
      researchRegister: 'docs/research/national-payroll-rule-versions-2027.md#r24',
      verifiedOn: '2026-11-16',
      verifiedBy: 'Test',
      effectiveFrom: '2023-01-01',
      effectiveTo: null,
      supersedesCode: null,
      parameters,
    }).success;

  it('loads Annex E monthly table and refuses one that is not continuous or starts above zero', () => {
    const exclusion = { thirteenthMonthAndOtherBenefitsExclusion: '90000' };
    const table = (monthlyTable: unknown) =>
      file('COMPENSATION_WITHHOLDING_TAX', { ...exclusion, monthlyTable });
    expect(table(annexEMonthly)).toBe(true);
    const gap = annexEMonthly.map((bracket, index) =>
      index === 3 ? { ...bracket, baseTax: '8541.00' } : bracket,
    );
    expect(table(gap)).toBe(false);
    expect(table(annexEMonthly.slice(1))).toBe(false);
  });

  it('requires the exclusion for 13th-month pay and other benefits, above zero', () => {
    expect(file('COMPENSATION_WITHHOLDING_TAX', { monthlyTable: annexEMonthly })).toBe(false);
    expect(
      file('COMPENSATION_WITHHOLDING_TAX', {
        thirteenthMonthAndOtherBenefitsExclusion: '0',
        monthlyTable: annexEMonthly,
      }),
    ).toBe(false);
  });

  it('loads de minimis ceilings, null where none is set, and refuses a benefit twice', () => {
    expect(file('DE_MINIMIS_BENEFITS', deMinimisVersion().parameters)).toBe(true);
    const twice = {
      benefits: [
        { benefit: 'CHRISTMAS_GIFT', annualCeiling: '6000' },
        { benefit: 'CHRISTMAS_GIFT', annualCeiling: '5000' },
      ],
    };
    expect(file('DE_MINIMIS_BENEFITS', twice)).toBe(false);
  });
});

describe('WithholdingTaxCalculator', () => {
  it('taxes regular compensation less mandatory contributions and leaves out non-taxable earnings', () => {
    // ₱44,000 salary less one day without pay (₱2,000) and the employee
    // shares (₱5,260) leaves ₱36,740: ₱1,875 + 20% of ₱3,407.
    const outcome = calculate([
      salary('44000'),
      line('DAYS_WITHOUT_PAY', 'DEDUCTION', '2000', regular),
      line('PERA', 'EARNING', '2000', { taxTreatment: 'NON_TAXABLE' }),
      line('LEAVE_MONETIZATION', 'EARNING', '5000', {
        taxTreatment: 'DE_MINIMIS',
        deMinimisBenefit: 'MONETIZED_LEAVE_CREDITS',
      }),
      line('GSIS_PERSONAL_SHARE', 'DEDUCTION', '3960', contribution),
      line('GSIS_GOVERNMENT_SHARE', 'EMPLOYER_SHARE', '5280', contribution),
      line('PHILHEALTH_EMPLOYEE_SHARE', 'DEDUCTION', '1100', contribution),
      line('PAGIBIG_EMPLOYEE_SHARE', 'DEDUCTION', '200', contribution),
    ]);
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      expect.objectContaining({
        componentCode: 'WITHHOLDING_TAX',
        lineType: 'DEDUCTION',
        ruleVersionId: 'tax-a',
        amount: '2556.4000',
        source: expect.objectContaining({
          taxableCompensation: '36740.0000',
          excludedContributions: '5260.0000',
          bracket: annexEMonthly[2],
        }),
      }),
    ]);
    // Non-taxable: PERA, the monetized leave, and the excluded shares, so the
    // two add up to the ₱49,000 the result pays before the tax.
    expect(outcome.tax).toEqual({
      taxableCompensation: '36740.0000',
      nonTaxableCompensation: '12260.0000',
      withholdingTax: '2556.4000',
      ruleVersionId: 'tax-a',
      yearToDateSnapshot: noYearToDate,
    });
  });

  it('writes a zero tax at or below the first taxed level and needs no de minimis version without a de minimis line', () => {
    const outcome = calculate(
      [salary('22000'), line('GSIS_PERSONAL_SHARE', 'DEDUCTION', '1167', contribution)],
      contextWith(withholdingVersion()),
    );
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines.map((taxLine) => taxLine.amount)).toEqual(['0.0000']);
    expect(outcome.tax?.taxableCompensation).toBe('20833.0000');
  });

  it('stores the year to date it read', () => {
    const yearToDate = {
      ...noYearToDate,
      payrollPeriodIds: ['january', 'february'],
      taxableCompensation: '60000.0000',
      withholdingTax: '1200.0000',
    };
    const outcome = calculate([salary('30000')], undefined, sourcesWith(yearToDate));
    expect(outcome.tax?.yearToDateSnapshot).toEqual(yearToDate);
  });

  it('blocks without a withholding tax version, or with one that changes in the month', () => {
    expect(exceptionTypes(calculate([salary('30000')], contextWith()))).toEqual([
      'WITHHOLDING_TAX_RULE_NOT_IN_EFFECT',
    ]);
    const changing = contextWith(
      withholdingVersion({ effectiveTo: '2026-03-15', successorEffectiveFrom: '2026-03-16' }),
      withholdingVersion({ id: 'tax-b', code: 'TAX-TEST-B', effectiveFrom: '2026-03-16' }),
    );
    const outcome = calculate([salary('30000')], changing);
    expect(exceptionTypes(outcome)).toEqual(['WITHHOLDING_TAX_RULE_CHANGE_IN_PERIOD']);
    expect(outcome).toMatchObject({ lines: [] });
    expect(outcome.tax).toBeUndefined();
  });

  it('blocks a de minimis line without a de minimis version, or one the version does not list', () => {
    const leave = line('LEAVE_MONETIZATION', 'EARNING', '5000', {
      taxTreatment: 'DE_MINIMIS',
      deMinimisBenefit: 'MONETIZED_LEAVE_CREDITS',
    });
    expect(
      exceptionTypes(calculate([salary('30000'), leave], contextWith(withholdingVersion()))),
    ).toEqual(['DE_MINIMIS_RULE_NOT_IN_EFFECT']);
    const gift = line('CASH_GIFT', 'EARNING', '5000', {
      taxTreatment: 'DE_MINIMIS',
      deMinimisBenefit: 'CHRISTMAS_GIFT',
    });
    expect(exceptionTypes(calculate([salary('30000'), gift]))).toEqual([
      'DE_MINIMIS_BENEFIT_NOT_IN_RULE',
    ]);
  });

  it('keeps a de minimis benefit non-taxable up to its annual ceiling, counting the year to date', () => {
    const clothing = line('CLOTHING_ALLOWANCE', 'EARNING', '7000', {
      taxTreatment: 'DE_MINIMIS',
      deMinimisBenefit: 'UNIFORM_AND_CLOTHING',
    });
    const paid = (amount: string) =>
      sourcesWith({ ...noYearToDate, deMinimisBenefits: { UNIFORM_AND_CLOTHING: amount } });
    const within = calculate([salary('30000'), clothing], undefined, paid('1000.0000'));
    expect(within.exceptions).toEqual([]);
    expect(within.tax?.nonTaxableCompensation).toBe('7000.0000');
    expect(
      exceptionTypes(calculate([salary('30000'), clothing], undefined, paid('1000.0100'))),
    ).toEqual(['DE_MINIMIS_CEILING_EXCEEDED']);
  });

  it('blocks a line with no tax treatment, or one its line type does not admit', () => {
    const untreated = line('LOAN', 'DEDUCTION', '500', {});
    const outcome = calculate([salary('30000'), untreated]);
    expect(exceptionTypes(outcome)).toEqual(['WITHHOLDING_TAX_TREATMENT_UNSETTLED']);
    expect(outcome.exceptions[0]?.details).toMatchObject({
      lines: [{ componentCode: 'LOAN', lineType: 'DEDUCTION', taxTreatment: null }],
    });
    const deducted = line('OVERTIME_PAY', 'DEDUCTION', '500', {
      taxTreatment: 'SUPPLEMENTARY_COMPENSATION',
    });
    expect(exceptionTypes(calculate([salary('30000'), deducted]))).toEqual([
      'WITHHOLDING_TAX_TREATMENT_UNSETTLED',
    ]);
  });

  it('blocks a tax that is not whole centavos', () => {
    // 15% of ₱0.01 over the first taxed level is ₱0.0015.
    expect(exceptionTypes(calculate([salary('20833.01')]))).toEqual([
      'WITHHOLDING_TAX_ROUNDING_UNSETTLED',
    ]);
  });

  it('writes nothing with no earning', () => {
    expect(calculate([])).toEqual({ lines: [], exceptions: [] });
  });

  it('needs no rule version in a special period that pays the Employee nothing', () => {
    const special: CalculationContext = {
      ...contextWith(),
      periodFrom: '2026-01-01',
      periodTo: '2026-10-31',
      componentCodes: new Set(['CLOTHING_ALLOWANCE']),
    };
    expect(calculate([], special)).toEqual({ lines: [], exceptions: [] });
  });
});

describe('WithholdingTaxCalculator on supplementary compensation', () => {
  // RR No. 11-2018 sec. 2.79(B)(3), steps 3 and 4, and Illustration 9: the
  // bracket is the one taxable regular compensation reaches, and its rate
  // also taxes the supplementary compensation.
  it('taxes overtime at the rate of the bracket regular compensation reaches', () => {
    // ₱40,000 regular is in the ₱33,333 bracket: ₱1,875 + 20% of
    // (₱6,667 + ₱1,500 overtime).
    const outcome = calculate([salary('40000'), overtime('1500')]);
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines[0]).toMatchObject({
      amount: '3508.4000',
      source: expect.objectContaining({
        regularCompensation: '40000.0000',
        supplementaryCompensation: '1500.0000',
        taxableCompensation: '41500.0000',
        bracket: annexEMonthly[2],
      }),
    });
    expect(outcome.tax).toMatchObject({
      taxableCompensation: '41500.0000',
      nonTaxableCompensation: '0.0000',
      withholdingTax: '3508.4000',
    });
  });

  it('excludes benefits up to what the year leaves of the exclusion, and taxes only the excess', () => {
    // ₱70,000 already counted leaves ₱20,000 of ₱90,000: ₱20,000 of the
    // ₱30,000 bonus is excluded and ₱10,000 is supplementary. ₱100,000
    // regular is in the ₱66,667 bracket: ₱8,541.80 + 25% of (₱33,333 + ₱10,000).
    const outcome = calculate([salary('100000'), bonus('30000')], undefined, benefitsPaid('70000'));
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines[0]).toMatchObject({
      amount: '19375.0500',
      source: expect.objectContaining({
        supplementaryCompensation: '10000.0000',
        thirteenthMonthAndOtherBenefits: {
          paid: '30000.0000',
          yearToDate: '70000.0000',
          exclusion: '90000',
          excluded: '20000.0000',
          taxable: '10000.0000',
        },
      }),
    });
    expect(outcome.tax).toMatchObject({
      taxableCompensation: '110000.0000',
      nonTaxableCompensation: '20000.0000',
      withholdingTax: '19375.0500',
    });
  });

  it('taxes the whole benefit for an Employee already past the exclusion', () => {
    // ₱8,541.80 + 25% of (₱33,333 + ₱30,000).
    const outcome = calculate([salary('100000'), bonus('30000')], undefined, benefitsPaid('95000'));
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.tax).toMatchObject({
      taxableCompensation: '130000.0000',
      nonTaxableCompensation: '0.0000',
      withholdingTax: '24375.0500',
    });
  });

  it('excludes a benefit within the exclusion, and takes the exclusion from the rule version', () => {
    const within = calculate([salary('100000'), bonus('30000')], undefined, benefitsPaid('60000'));
    expect(within.tax).toMatchObject({
      taxableCompensation: '100000.0000',
      nonTaxableCompensation: '30000.0000',
      withholdingTax: '16875.0500',
    });
    const raised = withholdingVersion({
      parameters: {
        thirteenthMonthAndOtherBenefitsExclusion: '100000',
        monthlyTable: annexEMonthly,
      },
    });
    const outcome = calculate(
      [salary('100000'), bonus('30000')],
      contextWith(raised),
      benefitsPaid('70000'),
    );
    expect(outcome.tax).toMatchObject({
      nonTaxableCompensation: '30000.0000',
      withholdingTax: '16875.0500',
    });
  });

  it('writes a zero tax for benefits within the exclusion paid with no regular compensation', () => {
    // A special period pays the year-end bonus and the cash gift alone.
    const gift = line('CASH_GIFT', 'EARNING', '5000', {
      taxTreatment: 'DE_MINIMIS',
      deMinimisBenefit: 'CHRISTMAS_GIFT',
    });
    const withGift = deMinimisVersion({
      parameters: { benefits: [{ benefit: 'CHRISTMAS_GIFT', annualCeiling: '6000' }] },
    });
    const outcome = calculate(
      [bonus('40000'), gift],
      contextWith(withholdingVersion(), withGift),
      benefitsPaid('0.0000'),
    );
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines.map((taxLine) => taxLine.amount)).toEqual(['0.0000']);
    expect(outcome.tax).toMatchObject({
      taxableCompensation: '0.0000',
      nonTaxableCompensation: '45000.0000',
      withholdingTax: '0.0000',
    });
  });

  // RR No. 11-2018 sec. 2.79(B)(5)(a): the cumulative average method, which
  // this calculation does not apply.
  it.each([
    ['regular compensation the table does not tax', [salary('20000'), overtime('1500')], '0'],
    ['supplementary compensation equal to regular', [salary('30000'), overtime('30000')], '0'],
    ['a benefit over the exclusion with no regular compensation', [bonus('100000')], '0'],
  ])('blocks %s, where the cumulative average method applies', (_case, lines) => {
    const outcome = calculate(lines);
    expect(exceptionTypes(outcome)).toEqual(['WITHHOLDING_TAX_CUMULATIVE_AVERAGE_UNSETTLED']);
    expect(outcome.lines).toEqual([]);
    expect(outcome.tax).toBeUndefined();
  });

  it('withholds on regular compensation the table does not tax when nothing is supplementary', () => {
    const outcome = calculate([salary('20000'), bonus('20000')]);
    expect(outcome.exceptions).toEqual([]);
    expect(outcome.tax?.withholdingTax).toBe('0.0000');
  });
});
