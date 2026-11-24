import { describe, expect, it } from 'vitest';
import { authorizedDestinations, canReadPayrollReports } from './navigation';
import { jsonFileName, outputStatusDisplay } from './payroll-outputs';
import type { ActiveSession } from './session';

const session = (permissions: readonly string[]): ActiveSession => ({
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  agency: { id: '00000000-0000-4000-8000-000000000002', name: 'Test Agency', acronym: null },
  identity: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Test User',
    email: 'test@example.test',
  },
  effectiveRoles: [],
  permissions: permissions.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
});

describe('outputStatusDisplay', () => {
  it('reads Ready only once the API returned the record', () => {
    const labels = (
      [
        { state: 'reading' },
        { state: 'error', message: 'down' },
        { state: 'none', blocked: null },
        { state: 'generating' },
      ] as const
    ).map((output) => outputStatusDisplay(output).label);
    expect(labels).toEqual(['Reading…', 'Unavailable', 'Not generated', 'Generating…']);
    expect(outputStatusDisplay({ state: 'ready', record: {} })).toEqual({
      label: 'Ready',
      tone: 'info',
    });
    expect(outputStatusDisplay({ state: 'none', blocked: 'Does not reconcile.' })).toEqual({
      label: 'Blocked',
      tone: 'danger',
    });
  });
});

it('names a JSON output after its contract, period, and part', () => {
  const contract = { code: 'DEDUCTION_SUMMARIES', version: 1 };
  expect(jsonFileName(contract, 'PAY-2026-11', 'tax-summary')).toBe(
    'deduction-summaries-PAY-2026-11-tax-summary-v1.json',
  );
  expect(jsonFileName({ code: 'PAYROLL_VARIANCE_EXCEPTION_REPORT', version: 2 }, 'P')).toBe(
    'payroll-variance-exception-report-P-v2.json',
  );
});

it('opens Reports to a period reader who generates any one output', () => {
  const read = 'payroll.periods.read';
  for (const output of [
    'payroll.registers.generate',
    'payroll.accounting_exports.generate',
    'payroll.payment_exports.generate',
  ]) {
    const holder = session([read, output]);
    expect(canReadPayrollReports(holder)).toBe(true);
    expect(authorizedDestinations(holder).some(({ href }) => href === '/payroll-reports')).toBe(
      true,
    );
    expect(canReadPayrollReports(session([output]))).toBe(false);
  }
  expect(canReadPayrollReports(session([read, 'payroll.export_detail.read']))).toBe(false);
  expect(
    authorizedDestinations(session([read])).some(({ href }) => href === '/payroll-reports'),
  ).toBe(false);
});
