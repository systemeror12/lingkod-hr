import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OutputState, PayrollRegisterRecord } from '../lib/payroll-outputs';
import type { PayrollPeriod } from '../lib/payroll-periods';
import { OutputRow } from './payroll-output-rows';
import { PayrollReports } from './payroll-reports';

const period: PayrollPeriod = {
  id: 'period-1',
  code: 'PAY-2026-11',
  runType: 'REGULAR',
  periodFrom: '2026-11-01',
  periodTo: '2026-11-30',
  cutoffAt: '2026-11-25T00:00:00.000Z',
  paymentDate: '2026-11-30',
  status: 'FINALIZED',
  calculationVersion: 2,
  payComponentIds: [],
  rowVersion: 9,
  totals: null,
};

const register: PayrollRegisterRecord = {
  id: 'register-1',
  payrollPeriodId: period.id,
  calculationVersion: 2,
  generatedAt: '2026-11-24T02:00:00.000Z',
  documentId: 'document-1',
  resultCount: 2,
  grossAmount: '78000.2500',
  totalDeductions: '6660.5000',
  netAmount: '71339.7500',
};

const row = (output: OutputState<PayrollRegisterRecord>) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <OutputRow
          about="A PDF of the finalized results."
          details={(record) => <span>{record.resultCount} results</span>}
          files={() => <a href="/register.pdf">Open register PDF</a>}
          generateLabel="Generate register"
          onGenerate={() => undefined}
          output={output}
          period={period}
          title="Payroll Register"
        />
      </tbody>
    </table>,
  );

describe('OutputRow', () => {
  it('never reads as Ready, or offers a file, while generating or reading', () => {
    for (const output of [{ state: 'generating' }, { state: 'reading' }] as const) {
      const html = row(output);
      expect(html).not.toContain('>Ready<');
      expect(html).not.toContain('Open register PDF');
      expect(html).not.toContain('Generated ');
    }
    const generating = row({ state: 'generating' });
    expect(generating).toContain('role="status"');
    expect(generating).toContain('Generating…');
    expect(generating).toMatch(/<button[^>]*disabled/);
  });

  it('shows when a ready output was generated and from which payroll, with its files', () => {
    const html = row({ state: 'ready', record: register });
    expect(html).toContain('>Ready<');
    expect(html).toContain('2 results');
    expect(html).toMatch(/Generated .*2026.* from PAY-2026-11, calculation version (<!-- -->)?2/);
    expect(html).toContain('Open register PDF');
    expect(html).not.toContain('Generate register');
  });

  it('offers generating one not yet generated, and shows the API’s reason when refused', () => {
    expect(row({ state: 'none', blocked: null })).toContain('Generate register');
    const blocked = row({ state: 'none', blocked: 'The register does not reconcile.' });
    expect(blocked).toContain('>Blocked<');
    expect(blocked).toContain('The register does not reconcile.');
  });
});

describe('PayrollReports', () => {
  const page = (grants: { registers?: boolean; accounting?: boolean; payment?: boolean }) =>
    renderToStaticMarkup(
      <PayrollReports
        agencyId="agency-1"
        canGenerateAccountingExport={grants.accounting ?? false}
        canGeneratePaymentExport={grants.payment ?? false}
        canGenerateRegisters={grants.registers ?? false}
        canReadEmployeeDetail={false}
        periods={[period]}
      />,
    );

  it('shows each output only to those its own permission names', () => {
    const registers = page({ registers: true });
    for (const title of [
      'Payroll Register',
      'Variance and Exception Report',
      'Tax, loan remittance, and deduction schedules',
    ]) {
      expect(registers).toContain(title);
    }
    expect(registers).not.toContain('Accounting Support Export');
    expect(registers).not.toContain('>Payment Export<');

    const accounting = page({ accounting: true });
    expect(accounting).toContain('Accounting Support Export');
    expect(accounting).not.toContain('Payroll Register');

    const payment = page({ payment: true });
    expect(payment).toContain('Payment Export');
    expect(payment).not.toContain('Payroll Register');
    expect(payment).not.toContain('Accounting Support Export');
  });
});
