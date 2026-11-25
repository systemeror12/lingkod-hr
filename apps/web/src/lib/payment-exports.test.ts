import { describe, expect, it } from 'vitest';
import {
  attemptsOf,
  instructionStatusDisplay,
  nextOutcomeSequence,
  paymentExportFilePath,
  type DisbursementOutcome,
  type PaymentExportRecord,
  type PaymentInstructionRecord,
} from './payment-exports';

const outcome = (sequence: number, kind: DisbursementOutcome['outcome']): DisbursementOutcome => ({
  id: `outcome-${sequence}`,
  paymentInstructionId: 'instruction-1',
  sequence,
  outcome: kind,
  externalReference: null,
  evidenceDocumentVersionId: null,
  reason: null,
  recordedByMembershipId: 'member-1',
  recordedAt: '2026-11-24T02:00:00.000Z',
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

const paymentExport = (
  id: string,
  instructions: PaymentInstructionRecord[],
): PaymentExportRecord => ({
  id,
  payrollPeriodId: 'period-1',
  supersedesPaymentExportId: null,
  calculationVersion: 1,
  contract: { code: 'PAYMENT_EXPORT', version: 1 },
  generatedAt: '2026-11-24T01:00:00.000Z',
  checksum: 'a'.repeat(64),
  controls: {
    sourceResultCount: instructions.length,
    sourceNetTotal: '1000.00',
    instructionCount: instructions.length,
    instructionTotal: '1000.00',
    excludedResultCount: 0,
    excludedResultTotal: '0.00',
  },
  instructions,
});

describe('instructionStatusDisplay', () => {
  it('never reads a handed-off instruction with no outcome as paid', () => {
    expect(instructionStatusDisplay(instruction())).toEqual({
      label: 'No outcome yet',
      tone: 'neutral',
    });
  });

  it('reads the latest outcome, and Superseded once the API names its retry', () => {
    const rejected = instruction({ outcomes: [outcome(1, 'SUBMITTED'), outcome(2, 'REJECTED')] });
    expect(instructionStatusDisplay(rejected).label).toBe('Rejected');
    expect(
      instructionStatusDisplay({ ...rejected, retriedByPaymentInstructionId: 'instruction-2' }),
    ).toEqual({ label: 'Superseded', tone: 'neutral' });
  });
});

describe('nextOutcomeSequence', () => {
  it('follows the latest outcome read', () => {
    expect(nextOutcomeSequence(instruction())).toBe(1);
    expect(nextOutcomeSequence(instruction({ outcomes: [outcome(1, 'SUBMITTED')] }))).toBe(2);
  });
});

describe('attemptsOf', () => {
  it('collects one payslip’s instructions across exports, oldest export first', () => {
    const first = instruction();
    const other = instruction({ id: 'instruction-9', payrollEmployeeId: 'result-9' });
    const retry = instruction({ id: 'instruction-2', priorPaymentInstructionId: 'instruction-1' });
    const attempts = attemptsOf(
      [paymentExport('export-1', [first, other]), paymentExport('export-2', [retry])],
      'result-1',
    );
    expect(
      attempts.map(({ paymentExport, instruction }) => [paymentExport.id, instruction.id]),
    ).toEqual([
      ['export-1', 'instruction-1'],
      ['export-2', 'instruction-2'],
    ]);
  });
});

describe('paymentExportFilePath', () => {
  it('is a relative API path', () => {
    expect(
      paymentExportFilePath('agency-1', { id: 'export-1', payrollPeriodId: 'period-1' }, 'csv'),
    ).toBe('/api/v1/agencies/agency-1/payroll-periods/period-1/payment-exports/export-1/csv');
  });
});
