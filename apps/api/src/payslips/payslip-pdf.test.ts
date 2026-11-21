import { describe, expect, it } from 'vitest';
import { money, payslipText, renderTextPdf, type PayslipStatement } from './payslip-pdf';

// Test fixture only: the amounts and the rule are not from any issuance.
const statement: PayslipStatement = {
  agencyName: 'Test Agency',
  period: {
    code: 'REG-2874-03',
    runType: 'REGULAR',
    periodFrom: '2874-03-01',
    periodTo: '2874-03-31',
    paymentDate: '2874-03-15',
    finalizedAt: '2874-03-14T02:00:00.000Z',
  },
  employee: { employeeNumber: 'E-1', legalName: 'Dela Cruz, María (Ana)' },
  result: {
    id: 'result-1',
    calculationVersion: 2,
    calculationHash: 'a'.repeat(64),
    grossAmount: '44000.0000',
    totalDeductions: '2000.0000',
    netAmount: '42000.0000',
  },
  lines: [
    {
      componentCode: 'DAYS_WITHOUT_PAY',
      componentName: 'Salary for days without pay',
      lineType: 'DEDUCTION',
      quantity: '1.0000',
      rate: '44000.00000000',
      amount: '2000.0000',
      unit: 'DAY',
      formula: 'quantity × monthly salary ÷ 22',
      authority: 'Test authority',
      ruleVersion: {
        code: 'TEST-SCHEDULE',
        name: 'Test schedule',
        issuanceReference: 'Test fixture',
      },
    },
    {
      componentCode: 'BASIC_SALARY',
      componentName: 'Basic salary',
      lineType: 'EARNING',
      quantity: '1.0000',
      rate: '44000.00000000',
      amount: '44000.0000',
      unit: 'MONTH',
      formula: null,
      authority: null,
      ruleVersion: {
        code: 'TEST-SCHEDULE',
        name: 'Test schedule',
        issuanceReference: 'Test fixture',
      },
    },
  ],
};

describe('payslipText', () => {
  it('states each line with its amount and how it was reached, earnings first', () => {
    const text = payslipText(statement);
    expect(text.slice(text.indexOf('EARNINGS'))).toEqual([
      'EARNINGS',
      'Basic salary (BASIC_SALARY): PHP 44,000.00',
      '    quantity 1 MONTH x rate 44000',
      '    Rule: Test schedule (TEST-SCHEDULE), Test fixture',
      '',
      'DEDUCTIONS',
      'Salary for days without pay (DAYS_WITHOUT_PAY): PHP 2,000.00',
      '    quantity 1 DAY x rate 44000',
      '    Formula: quantity × monthly salary ÷ 22',
      '    Authority: Test authority',
      '    Rule: Test schedule (TEST-SCHEDULE), Test fixture',
      '',
      'Gross earnings: PHP 44,000.00',
      'Total deductions: PHP 2,000.00',
      'Net pay: PHP 42,000.00',
    ]);
    expect(text.join('\n')).toContain('It is not proof of payment');
    expect(text.join('\n')).not.toMatch(/\bform no\b|\bBIR form\b|\bCOA form\b/i);
  });

  it('keeps four places only where the amount needs them, and the sign', () => {
    expect(money('1234567.8900')).toBe('1,234,567.89');
    expect(money('-480.1250')).toBe('-480.1250');
    expect(money('0.0000')).toBe('0.00');
  });
});

describe('renderTextPdf', () => {
  it('gives the same bytes for the same text, as a PDF with a valid cross-reference', () => {
    const lines = payslipText(statement);
    const pdf = renderTextPdf(lines);
    expect(renderTextPdf(lines).equals(pdf)).toBe(true);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('(Employee: Dela Cruz, Mar\xeda \\(Ana\\) \\(E-1\\)) Tj');
    expect(text).toContain('(    Formula: quantity \xd7 monthly salary \xf7 22) Tj');
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref).startsWith('xref\n')).toBe(true);
    const offsets = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((match) =>
      Number(match[1]),
    );
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(text.startsWith(`${index + 1} 0 obj\n`, offset)).toBe(true);
    });
  });

  it('starts a new page after a page of lines', () => {
    const pdf = renderTextPdf(Array.from({ length: 130 }, (_, index) => `line ${index}`));
    expect(pdf.toString('latin1')).toContain('/Count 3');
  });
});
