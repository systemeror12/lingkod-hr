import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PaymentExportRecord, PaymentInstructionRecord } from '../lib/payment-exports';
import type { PeriodPayslipEntry } from '../lib/payroll-periods';
import { PaymentActions, PayslipActions } from './payslip-actions';

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

const instruction = (
  overrides: Partial<PaymentInstructionRecord> = {},
): PaymentInstructionRecord => ({
  id: 'instruction-1',
  payrollEmployeeId: 'result-1',
  priorPaymentInstructionId: null,
  retryReason: null,
  agencyEmployeeNumber: 'E-1',
  payeeLegalName: 'Ana Employee',
  institutionName: 'LBP',
  maskedAccountIdentifier: '******4567',
  accountHolderName: 'Ana Employee',
  amount: '1000.00',
  paymentReference: 'P-1-E-1',
  outcomes: [],
  retriedByPaymentInstructionId: null,
  retryable: false,
  ...overrides,
});

const paymentExport = {
  id: 'export-1',
  payrollPeriodId: 'period-1',
  supersedesPaymentExportId: null,
  calculationVersion: 1,
  contract: { code: 'PAYMENT_EXPORT', version: 1 },
  generatedAt: '2026-11-24T01:00:00.000Z',
  checksum: 'a'.repeat(64),
  controls: {
    sourceResultCount: 1,
    sourceNetTotal: '1000.00',
    instructionCount: 1,
    instructionTotal: '1000.00',
    excludedResultCount: 0,
    excludedResultTotal: '0.00',
  },
  instructions: [],
} satisfies PaymentExportRecord;

const renderPayment = (attempts: PaymentInstructionRecord[] | undefined) =>
  renderToStaticMarkup(
    <PaymentActions
      attempts={attempts?.map((value) => ({ paymentExport, instruction: value }))}
      canRecordOutcome
      canSupersede
      onDone={async () => undefined}
      request={async () => null}
    />,
  );

const recorded = (sequence: number, outcome: 'SUBMITTED' | 'REJECTED', reason: string | null) => ({
  id: `outcome-${sequence}`,
  paymentInstructionId: 'instruction-1',
  sequence,
  outcome,
  externalReference: null,
  evidenceDocumentVersionId: null,
  reason,
  recordedByMembershipId: 'member-1',
  recordedAt: '2026-11-24T02:00:00.000Z',
});

describe('PaymentActions', () => {
  it('shows a handed-off instruction with no outcome as not paid, and offers no supersede', () => {
    const html = renderPayment([instruction()]);
    expect(html).toContain('No outcome yet');
    expect(html).toContain('marks no one paid');
    expect(html).not.toMatch(/>Paid</);
    expect(html).toContain('Record outcome');
    expect(html).not.toContain('Supersede instruction');
  });

  it('lists outcomes in the API’s order and offers supersede only where the API says retryable', () => {
    const html = renderPayment([
      instruction({
        outcomes: [recorded(1, 'SUBMITTED', null), recorded(2, 'REJECTED', 'Account closed')],
        retryable: true,
      }),
    ]);
    expect(html.indexOf('>Submitted<')).toBeLessThan(html.indexOf('Account closed'));
    expect(html).toContain('Supersede instruction');
  });

  it('says it is reading, and says when there is no instruction', () => {
    expect(renderPayment(undefined)).toContain('Reading the Payment Instructions…');
    expect(renderPayment([])).toContain('No Payment Instruction yet.');
  });
});
