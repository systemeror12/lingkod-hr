import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MyPayslips, type OwnPayslip } from './my-payslips';

const payslip: OwnPayslip = {
  id: 'payslip-1',
  payrollPeriodId: 'period-1',
  periodCode: 'P-2849-CLOTHING',
  runType: 'SPECIAL',
  periodFrom: '2849-01-01',
  periodTo: '2849-12-31',
  paymentDate: '2849-06-15',
  calculationVersion: 1,
  grossAmount: '1500.0000',
  totalDeductions: '0.0000',
  netAmount: '1500.0000',
  releasedAt: '2026-11-22T02:00:00.000Z',
};

describe('MyPayslips', () => {
  it('lists each released payslip by its Payroll Period with its amounts', () => {
    const html = renderToStaticMarkup(<MyPayslips agencyId="agency-1" payslips={[payslip]} />);
    expect(html).toContain('>My Payslips<');
    expect(html).toContain('P-2849-CLOTHING');
    expect(html).toContain('₱1,500.00');
    expect(html).not.toContain('No released payslips yet.');
  });

  it('says so when no payslip has been released', () => {
    const html = renderToStaticMarkup(<MyPayslips agencyId="agency-1" payslips={[]} />);
    expect(html).toContain('No released payslips yet.');
  });
});
