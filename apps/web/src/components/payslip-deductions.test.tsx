import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContributionBilling, PayrollResultDetail } from '../lib/payroll-periods';
import { ContributionBillingTable } from './contribution-billings';
import { ContributionsTaxDeductions } from './payslip-deductions';

const rule = (code: string) => ({ id: `rule-${code}`, code, name: `${code} name` });

const result: PayrollResultDetail = {
  id: 'result-1',
  employeeId: 'employee-1',
  calculationVersion: 1,
  status: 'CALCULATED',
  grossAmount: '31705.0000',
  totalDeductions: '3527.1250',
  netAmount: '28177.8750',
  calculationHash: 'a'.repeat(64),
  lines: [],
  contributions: [
    {
      id: 'contribution-1',
      contributionType: 'PHILHEALTH',
      employeeShare: '792.6250',
      employerShare: '792.6250',
      compensationBase: '31705.0000',
      ruleVersion: rule('PHILHEALTH-2026'),
    },
  ],
  taxLine: {
    id: 'tax-1',
    taxableCompensation: '30912.3750',
    nonTaxableCompensation: '792.6250',
    withholdingTax: '1234.5000',
    ruleVersion: rule('WITHHOLDING-2026'),
    yearToDateSnapshot: {
      taxYear: 2026,
      payrollPeriodIds: ['period-1', 'period-2'],
      taxableCompensation: '61824.7500',
      nonTaxableCompensation: '1585.2500',
      withholdingTax: '2469.0000',
      deMinimisBenefits: { RICE_SUBSIDY: '2000.0000' },
      thirteenthMonthAndOtherBenefits: '0.0000',
    },
  },
  loanDeductions: [
    {
      id: 'loan-1',
      deductionObligationId: 'obligation-1',
      payeeCategory: 'GSIS',
      payeeName: 'Government Service Insurance System',
      issuerReference: 'GSIS-LOAN-1',
      priority: 1,
      amountDue: '2000.0000',
      deductedAmount: '1500.0000',
      notDeductedAmount: '500.0000',
      ruleVersion: rule('DEDUCTIONS-2026'),
    },
  ],
};

describe('ContributionsTaxDeductions', () => {
  it('shows each contribution share, the tax line with its year to date, and each deduction, with rule versions', () => {
    const html = renderToStaticMarkup(<ContributionsTaxDeductions result={result} />);
    expect(html).toContain('PhilHealth');
    expect(html).toContain('₱792.625');
    expect(html).toContain('₱31,705.00');
    expect(html).toContain('PHILHEALTH-2026');
    expect(html).toContain('₱1,234.50');
    expect(html).toContain('WITHHOLDING-2026');
    expect(html).toContain('Year to date before this period');
    expect(html).toContain('2 periods');
    expect(html).toContain('₱61,824.75');
    expect(html).toContain('De minimis: Rice subsidy');
    expect(html).toContain('Government Service Insurance System');
    expect(html).toContain('GSIS-LOAN-1');
    expect(html).toContain('₱1,500.00');
    expect(html).toContain('₱500.00');
    expect(html).toContain('DEDUCTIONS-2026');
  });

  it('says what a calculated payslip lacks, and shows nothing for a blocked one', () => {
    const empty = { ...result, contributions: [], taxLine: null, loanDeductions: [] };
    const html = renderToStaticMarkup(<ContributionsTaxDeductions result={empty} />);
    expect(html).toContain('This payslip has no Contribution Lines.');
    expect(html).toContain('This payslip has no Tax Line.');
    expect(html).toContain('No Deduction Obligation was due in this period.');
    expect(
      renderToStaticMarkup(
        <ContributionsTaxDeductions result={{ ...empty, status: 'EXCEPTION' }} />,
      ),
    ).toBe('');
  });
});

describe('ContributionBillingTable', () => {
  const billing: ContributionBilling = {
    id: 'billing-1',
    employeeId: 'employee-1',
    contributionType: 'PHILHEALTH',
    employeeShare: '800.00',
    employerShare: '800.00',
    evidenceDocumentVersionId: 'version-1',
    supersedesContributionBillingId: null,
    recordedAt: '2026-11-19T00:00:00.000Z',
    current: false,
  };

  it('marks a superseded billing as such and the correction as current', () => {
    const html = renderToStaticMarkup(
      <ContributionBillingTable
        billings={[
          billing,
          { ...billing, id: 'billing-2', employeeShare: '750.00', current: true },
        ]}
        employeeLabel={() => 'Alex Rivera'}
        evidenceLabel={() => 'E2E-BILLING · v1'}
      />,
    );
    expect(html).toContain('Superseded');
    expect(html).toContain('Current');
    expect(html).toContain('₱800.00');
    expect(html).toContain('₱750.00');
    expect(html).toContain('E2E-BILLING · v1');
  });
});
