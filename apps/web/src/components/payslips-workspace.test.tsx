import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PayrollLine, PayrollResultDetail } from '../lib/payroll-periods';
import { SalaryComputation, sourceSummary, StageBar } from './payslips-workspace';

const line: PayrollLine = {
  id: 'line-1',
  payComponent: { id: 'component-1', code: 'OVERTIME_PAY', name: 'Overtime pay' },
  lineType: 'EARNING',
  quantity: '90.0000',
  rate: '3.12500000',
  amount: '281.2500',
  ruleVersion: { id: 'rule-1', code: 'SCHEDULE-2026', name: 'Salary schedule' },
  sources: [
    { kind: 'PAYROLL_INPUT', id: '11111111-1111-4111-8111-111111111111' },
    { kind: 'PAYROLL_INPUT', id: '22222222-2222-4222-8222-222222222222' },
  ],
  sourceSnapshot: { unit: 'MINUTE' },
};

const result: PayrollResultDetail = {
  id: 'result-1',
  employeeId: 'employee-1',
  calculationVersion: 2,
  status: 'CALCULATED',
  grossAmount: '281.2500',
  totalDeductions: '0.0000',
  netAmount: '281.2500',
  calculationHash: 'a'.repeat(64),
  lines: [line],
  contributions: [],
  taxLine: null,
  loanDeductions: [],
};

describe('SalaryComputation', () => {
  it('shows each line with its source record, quantity, rate, amount, and rule version', () => {
    const html = renderToStaticMarkup(<SalaryComputation result={result} />);
    expect(html).toContain('Overtime pay');
    expect(html).toContain('Payroll Input and 1 more');
    expect(html).toContain('>90<');
    expect(html).toContain('>3.125<');
    expect(html).toContain('₱281.25');
    expect(html).toContain('SCHEDULE-2026');
    expect(html).toContain('Net pay');
  });

  it('says a blocked payslip has no lines rather than showing it as calculated', () => {
    const html = renderToStaticMarkup(
      <SalaryComputation result={{ ...result, status: 'EXCEPTION', lines: [] }} />,
    );
    expect(html).toContain('a blocking exception stopped this payslip');
  });

  it('names the calculation snapshot when a line rests on no source record', () => {
    expect(sourceSummary({ ...line, sources: [] })).toBe('Calculation snapshot');
  });
});

describe('StageBar', () => {
  it('reads Computing… as the current stage while the period calculates', () => {
    const html = renderToStaticMarkup(
      <StageBar
        period={{
          id: 'period-1',
          code: 'P-1',
          runType: 'REGULAR',
          periodFrom: '2026-01-01',
          periodTo: '2026-01-31',
          cutoffAt: '2026-01-25T00:00:00.000Z',
          paymentDate: '2026-01-31',
          status: 'CALCULATING',
          calculationVersion: 1,
          carriesAdjustments: false,
          payComponentIds: [],
          finalizedAt: null,
          voidRequestedAt: null,
          voidDocumentVersionId: null,
          voidReason: null,
          voidedAt: null,
          rowVersion: 2,
          totals: null,
        }}
      />,
    );
    expect(html).toMatch(/aria-current="step"[^>]*>Computing…</);
  });
});
