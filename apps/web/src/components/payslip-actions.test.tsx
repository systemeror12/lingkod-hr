import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PeriodPayslipEntry } from '../lib/payroll-periods';
import { PayslipActions } from './payslip-actions';

const entry = (status: string, withheld = false): PeriodPayslipEntry => ({
  payrollEmployeeId: 'result-1',
  employee: { id: 'employee-1', employeeNumber: 'E-1', legalName: 'Ana Employee' },
  payslip: {
    id: 'payslip-1',
    payrollPeriodId: 'period-1',
    payrollEmployeeId: 'result-1',
    status,
    releasedAt: null,
    releasedByMembershipId: null,
    withheldAt: withheld ? '2026-11-22T02:00:00.000Z' : null,
    withheldByMembershipId: withheld ? 'member-1' : null,
    withholdReason: withheld ? 'Under review by the HRMO' : null,
  },
});

const render = (value: PeriodPayslipEntry | undefined) =>
  renderToStaticMarkup(
    <PayslipActions
      canRelease
      canWithhold
      entry={value}
      onDone={async () => undefined}
      request={async () => null}
    />,
  );

describe('PayslipActions', () => {
  it('offers withholding a Ready payslip, and releasing only a Withheld one', () => {
    const ready = render(entry('READY'));
    expect(ready).toContain('>Ready<');
    expect(ready).toContain('Withhold payslip');
    expect(ready).not.toContain('Release withheld payslip');

    const withheld = render(entry('WITHHELD', true));
    expect(withheld).toContain('Release withheld payslip');
    expect(withheld).toContain('Under review by the HRMO');
    expect(withheld).not.toContain('Withhold payslip');
  });

  it('offers nothing on a generating payslip and never reads it as Ready', () => {
    const generating = render(entry('GENERATING'));
    expect(generating).toContain('Generating…');
    expect(generating).not.toContain('>Ready<');
    expect(generating).not.toContain('<button');
    expect(render(undefined)).toContain('Reading the payslip’s status…');
  });
});
