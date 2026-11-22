import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEDUCTION_SUMMARIES_STATEMENT,
  planDeductionSummaries,
  type DeductionSourceLine,
  type LoanDeductionSourceLine,
  type TaxSourceLine,
} from './deduction-summaries-contract';

const period = {
  id: 'period-1',
  code: 'PAY-2026-03',
  runType: 'REGULAR',
  periodFrom: '2026-03-01',
  periodTo: '2026-03-31',
  paymentDate: '2026-03-31',
  calculationVersion: 2,
  finalizedAt: '2026-03-30T08:00:00.000Z',
};

const employee = (number: string) => ({
  payrollEmployeeId: `result-${number}`,
  agencyEmployeeNumber: number,
  employeeName: `Name ${number}`,
});

const tax = (
  id: string,
  number: string,
  taxable: string,
  nonTaxable: string,
  withholdingTax: string,
  yearEndAdjustment: string | null = null,
): TaxSourceLine => ({
  taxLineId: id,
  ...employee(number),
  taxableCompensation: taxable,
  nonTaxableCompensation: nonTaxable,
  withholdingTax,
  yearEndAdjustment,
  ruleVersionId: 'rule-tax',
  ruleVersionCode: 'TAX-2026',
});

const loan = (
  id: string,
  number: string,
  payeeCategory: string,
  payeeName: string,
  amountDue: string,
  deductedAmount: string,
): LoanDeductionSourceLine => ({
  loanDeductionLineId: id,
  deductionObligationId: `obligation-${id}`,
  payeeCategory,
  payeeName,
  issuerReference: `REF-${id}`,
  ...employee(number),
  amountDue,
  deductedAmount,
  notDeductedAmount: (Number(amountDue) - Number(deductedAmount)).toFixed(2),
});

const deduction = (
  id: string,
  number: string,
  componentCode: string,
  amount: string,
): DeductionSourceLine => ({
  payrollLineId: id,
  ...employee(number),
  componentCode,
  componentName: `Component ${componentCode}`,
  amount,
  payrollAdjustmentId: null,
});

const taxLines = [
  tax('t-2', 'E-002', '20000', '2000', '1000.00'),
  tax('t-1', 'E-001', '30000.0000', '4000', '2500.50'),
  // A year-end refund is a negative withholding tax, and it still counts.
  tax('t-3', 'E-003', '10000', '0', '-300', 'YEAR_END'),
];

const loanLines = [
  loan('l-1', 'E-002', 'GSIS', 'GSIS', '1000', '1000'),
  loan('l-2', 'E-001', 'GSIS', 'GSIS', '500', '500'),
  loan('l-3', 'E-001', 'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION', 'Kapwa Coop', '800', '300'),
  loan('l-4', 'E-002', 'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION', 'KAPWA COOP', '200', '200'),
  // A recovery under a COA decision is one more payee, with no special case.
  loan('l-5', 'E-003', 'NATIONAL_GOVERNMENT_COA_DECISION', 'National Government', '750', '750'),
];

const deductionLines = [
  deduction('d-4', 'E-002', 'WITHHOLDING_TAX', '1000.00'),
  deduction('d-1', 'E-001', 'GSIS_PERSONAL_SHARE', '2700'),
  deduction('d-2', 'E-001', 'WITHHOLDING_TAX', '2500.50'),
  deduction('d-3', 'E-001', 'LOAN_DEDUCTION', '500'),
  deduction('d-5', 'E-001', 'LOAN_DEDUCTION', '300'),
];

const plan = (
  input: Partial<{
    taxLines: TaxSourceLine[];
    loanDeductionLines: LoanDeductionSourceLine[];
    deductionLines: DeductionSourceLine[];
  }> = {},
) =>
  planDeductionSummaries({
    agencyId: 'agency-1',
    summaryId: 'summary-1',
    generatedAt: '2026-03-31T00:00:00.000Z',
    period,
    taxLines,
    loanDeductionLines: loanLines,
    deductionLines,
    ...input,
  });

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

describe('planDeductionSummaries', () => {
  it('totals the Tax Summary exactly from its Tax Lines, in employee order', () => {
    const { taxSummary } = plan();
    expect(taxSummary.totals).toEqual({
      lineCount: 3,
      taxableCompensationTotal: '60000.0000',
      nonTaxableCompensationTotal: '6000.0000',
      withholdingTaxTotal: '3200.5000',
    });
    const content = JSON.parse(taxSummary.content) as {
      artifact: string;
      lines: { taxLineId: string; withholdingTax: string; yearEndAdjustment: string | null }[];
      totals: unknown;
    };
    expect(content.artifact).toBe('TAX_SUMMARY');
    expect(
      content.lines.map((line) => [line.taxLineId, line.withholdingTax, line.yearEndAdjustment]),
    ).toEqual([
      ['t-1', '2500.5000', null],
      ['t-2', '1000.0000', null],
      ['t-3', '-300.0000', 'YEAR_END'],
    ]);
    expect(content.totals).toEqual(taxSummary.totals);
    expect(taxSummary.checksum).toBe(sha256(taxSummary.content));
  });

  it('groups loan deductions by payee, each payee totalling its own lines', () => {
    const { loanRemittanceSummary } = plan();
    const content = JSON.parse(loanRemittanceSummary.content) as {
      artifact: string;
      payees: {
        payeeCategory: string;
        payeeName: string;
        lines: { loanDeductionLineId: string }[];
        totals: unknown;
      }[];
      totals: unknown;
    };
    expect(content.artifact).toBe('LOAN_REMITTANCE_SUMMARY');
    expect(
      content.payees.map((payee) => [
        payee.payeeCategory,
        payee.payeeName,
        payee.lines.map((line) => line.loanDeductionLineId),
        payee.totals,
      ]),
    ).toEqual([
      [
        'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
        // One payee whatever the case, as the obligation's citext name compares.
        'KAPWA COOP',
        ['l-3', 'l-4'],
        {
          lineCount: 2,
          amountDueTotal: '1000.0000',
          deductedTotal: '500.0000',
          notDeductedTotal: '500.0000',
        },
      ],
      [
        'GSIS',
        'GSIS',
        ['l-2', 'l-1'],
        {
          lineCount: 2,
          amountDueTotal: '1500.0000',
          deductedTotal: '1500.0000',
          notDeductedTotal: '0.0000',
        },
      ],
      [
        'NATIONAL_GOVERNMENT_COA_DECISION',
        'National Government',
        ['l-5'],
        {
          lineCount: 1,
          amountDueTotal: '750.0000',
          deductedTotal: '750.0000',
          notDeductedTotal: '0.0000',
        },
      ],
    ]);
    expect(loanRemittanceSummary.totals).toEqual({
      payeeCount: 3,
      lineCount: 5,
      amountDueTotal: '3250.0000',
      deductedTotal: '2750.0000',
      notDeductedTotal: '500.0000',
    });
    expect(content.totals).toEqual(loanRemittanceSummary.totals);
  });

  it('registers each Employee’s deduction lines and each component’s total', () => {
    const { deductionRegister } = plan();
    const content = JSON.parse(deductionRegister.content) as {
      artifact: string;
      employees: {
        agencyEmployeeNumber: string;
        lines: { payrollLineId: string; amount: string }[];
        totals: unknown;
      }[];
      components: unknown[];
      totals: unknown;
    };
    expect(content.artifact).toBe('DEDUCTION_REGISTER');
    expect(
      content.employees.map((entry) => [
        entry.agencyEmployeeNumber,
        entry.lines.map((line) => line.payrollLineId),
        entry.totals,
      ]),
    ).toEqual([
      ['E-001', ['d-1', 'd-3', 'd-5', 'd-2'], { lineCount: 4, amountTotal: '6000.5000' }],
      ['E-002', ['d-4'], { lineCount: 1, amountTotal: '1000.0000' }],
    ]);
    expect(content.components).toEqual([
      {
        componentCode: 'GSIS_PERSONAL_SHARE',
        componentName: 'Component GSIS_PERSONAL_SHARE',
        lineCount: 1,
        amountTotal: '2700.0000',
      },
      {
        componentCode: 'LOAN_DEDUCTION',
        componentName: 'Component LOAN_DEDUCTION',
        lineCount: 2,
        amountTotal: '800.0000',
      },
      {
        componentCode: 'WITHHOLDING_TAX',
        componentName: 'Component WITHHOLDING_TAX',
        lineCount: 2,
        amountTotal: '3500.5000',
      },
    ]);
    expect(deductionRegister.totals).toEqual({
      employeeCount: 2,
      lineCount: 5,
      amountTotal: '7000.5000',
    });
    expect(content.totals).toEqual(deductionRegister.totals);
  });

  it('gives a payroll with no line of a kind that artifact with zero totals', () => {
    const result = plan({ taxLines: [], loanDeductionLines: [], deductionLines: [] });
    expect(result.taxSummary.totals).toEqual({
      lineCount: 0,
      taxableCompensationTotal: '0.0000',
      nonTaxableCompensationTotal: '0.0000',
      withholdingTaxTotal: '0.0000',
    });
    expect(result.loanRemittanceSummary.totals).toMatchObject({ payeeCount: 0, lineCount: 0 });
    expect(result.deductionRegister.totals).toEqual({
      employeeCount: 0,
      lineCount: 0,
      amountTotal: '0.0000',
    });
  });

  it('states on every artifact that it is no BIR form, filing, or remittance', () => {
    const result = plan();
    for (const { content } of [
      result.taxSummary,
      result.loanRemittanceSummary,
      result.deductionRegister,
    ]) {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(parsed.statement).toBe(DEDUCTION_SUMMARIES_STATEMENT);
      expect(parsed.contract).toEqual({ code: 'DEDUCTION_SUMMARIES', version: 1 });
      expect(Object.keys(parsed)).not.toContain('form');
      // No BIR form number, such as 1601-C, 2316, or 1604-C, appears anywhere.
      expect(content).not.toMatch(/\b(?:1601|1604|2316|2307)\b|alphalist/i);
    }
  });

  it('renders the same bytes for the same lines in any order', () => {
    const reversed = plan({
      taxLines: [...taxLines].reverse(),
      loanDeductionLines: [...loanLines].reverse(),
      deductionLines: [...deductionLines].reverse(),
    });
    expect(reversed).toEqual(plan());
  });
});
