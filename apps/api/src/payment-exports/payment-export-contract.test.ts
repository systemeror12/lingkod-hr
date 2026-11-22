import { describe, expect, it } from 'vitest';
import {
  designatedDestination,
  planPaymentExport,
  planPaymentRetry,
  renderPaymentExportCsv,
  renderPaymentExportSummary,
  type PaymentExportDestinationCandidate,
  type PaymentExportSnapshot,
  type PaymentExportSourceResult,
} from './payment-export-contract';

const period = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'REG-2874-03',
  runType: 'REGULAR',
  periodFrom: '2874-03-01',
  periodTo: '2874-03-31',
  paymentDate: '2874-03-15',
  calculationVersion: 2,
};

function result(
  number: string,
  net: string,
  overrides: Partial<PaymentExportSourceResult> = {},
): PaymentExportSourceResult {
  return {
    payrollEmployeeId: `result-${number}`,
    employeeId: `employee-${number}`,
    agencyEmployeeNumber: number,
    payeeLegalName: `Payee ${number}`,
    grossAmount: net,
    totalDeductions: '0',
    netAmount: net,
    earningLineTotal: net,
    deductionLineTotal: '0',
    ...overrides,
  };
}

function account(
  number: string,
  overrides: Partial<PaymentExportDestinationCandidate> = {},
): PaymentExportDestinationCandidate {
  return {
    id: `account-${number}`,
    employeeId: `employee-${number}`,
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    bankCode: 'LBP',
    accountName: `Holder ${number}`,
    maskedAccountNumber: '******1234',
    ...overrides,
  };
}

const onDate = '2026-11-21';

describe('planPaymentExport', () => {
  it('pays each positive net and counts zero and negative net in the controls', () => {
    const plan = planPaymentExport({
      period,
      results: [
        result('E-002', '1500.5'),
        result('E-001', '20000.0000'),
        result('E-003', '0.0000'),
        result('E-004', '-10.00', {
          grossAmount: '0',
          totalDeductions: '10',
          deductionLineTotal: '10',
          earningLineTotal: '0',
        }),
      ],
      destinations: [account('E-001'), account('E-002')],
      onDate,
    });
    expect(
      plan.instructions.map((instruction) => [
        instruction.agencyEmployeeNumber,
        instruction.amount,
      ]),
    ).toEqual([
      ['E-001', '20000.00'],
      ['E-002', '1500.50'],
    ]);
    expect(plan.instructions[0]).toMatchObject({
      payrollBankAccountId: 'account-E-001',
      destinationType: 'BANK_ACCOUNT',
      institutionIdentifierScheme: 'AGENCY_BANK_CODE',
      institutionIdentifier: 'LBP',
      institutionName: 'LBP',
      accountHolderName: 'Holder E-001',
      paymentReference: 'REG-2874-03-E-001',
    });
    expect(
      plan.excluded.map((excluded) => [excluded.agencyEmployeeNumber, excluded.netAmount]),
    ).toEqual([
      ['E-003', '0.00'],
      ['E-004', '-10.00'],
    ]);
    expect(plan.controls).toEqual({
      sourceResultCount: 4,
      sourceNetTotal: '21490.50',
      instructionCount: 2,
      instructionTotal: '21500.50',
      excludedResultCount: 2,
      excludedResultTotal: '-10.00',
    });
  });

  it('needs no destination for a result it excludes', () => {
    const plan = planPaymentExport({
      period,
      results: [result('E-001', '0')],
      destinations: [],
      onDate,
    });
    expect(plan.instructions).toEqual([]);
    expect(plan.controls.excludedResultCount).toBe(1);
  });

  it('blocks the whole export and names every Employee without a usable destination', () => {
    expect(() =>
      planPaymentExport({
        period,
        results: [
          result('E-001', '100'),
          result('E-002', '100'),
          result('E-003', '100'),
          result('E-004', '100'),
        ],
        destinations: [
          account('E-002', { effectiveFrom: '2027-01-01' }),
          account('E-003', { status: 'PENDING_VERIFICATION' }),
          account('E-004'),
        ],
        onDate,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'PAYMENT_EXPORT_DESTINATION_BLOCKED',
        message:
          'The Payment Export is blocked: no Payroll Bank Account for E-001; no Payroll Bank Account effective today for E-002; an unverified Payroll Bank Account for E-003. Nothing was generated.',
      }),
    );
  });

  it('refuses a result whose totals differ from its lines', () => {
    expect(() =>
      planPaymentExport({
        period,
        results: [result('E-001', '100', { earningLineTotal: '99.99' })],
        destinations: [account('E-001')],
        onDate,
      }),
    ).toThrow(expect.objectContaining({ code: 'PAYMENT_EXPORT_RECONCILIATION_FAILED' }));
  });

  it('refuses a net that is not whole centavos rather than rounding it', () => {
    expect(() =>
      planPaymentExport({
        period,
        results: [result('E-001', '100.0050')],
        destinations: [account('E-001')],
        onDate,
      }),
    ).toThrow(/not whole centavos/);
  });
});

describe('planPaymentRetry', () => {
  const prior = {
    payrollEmployeeId: 'result-E-001',
    payrollBankAccountId: 'account-E-001',
    agencyEmployeeNumber: 'E-001',
    payeeLegalName: 'Payee E-001',
    amount: '1500.50',
    paymentReference: 'REG-2874-03-E-001',
  };
  const corrected = account('E-001', {
    id: 'account-E-001-corrected',
    accountName: 'Corrected Holder',
    maskedAccountNumber: '******9999',
  });

  it('resends the prior payee and amount to the corrected destination, alone in its controls', () => {
    const plan = planPaymentRetry({
      prior,
      employeeId: 'employee-E-001',
      destinations: [account('E-001', { status: 'CORRECTED' }), corrected],
      onDate,
    });
    expect(plan.instructions).toEqual([
      {
        payrollEmployeeId: 'result-E-001',
        payrollBankAccountId: 'account-E-001-corrected',
        agencyEmployeeNumber: 'E-001',
        payeeLegalName: 'Payee E-001',
        destinationType: 'BANK_ACCOUNT',
        institutionIdentifierScheme: 'AGENCY_BANK_CODE',
        institutionIdentifier: 'LBP',
        institutionName: 'LBP',
        maskedAccountIdentifier: '******9999',
        accountHolderName: 'Corrected Holder',
        amount: '1500.50',
        paymentReference: 'REG-2874-03-E-001',
      },
    ]);
    expect(plan.excluded).toEqual([]);
    expect(plan.controls).toEqual({
      sourceResultCount: 1,
      sourceNetTotal: '1500.50',
      instructionCount: 1,
      instructionTotal: '1500.50',
      excludedResultCount: 0,
      excludedResultTotal: '0.00',
    });
  });

  it('refuses to resend to the destination of the prior attempt', () => {
    expect(() =>
      planPaymentRetry({
        prior,
        employeeId: 'employee-E-001',
        destinations: [account('E-001')],
        onDate,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'PAYMENT_RETRY_DESTINATION_UNCHANGED',
        message:
          'The retry of E-001 would resend to the Payroll Bank Account of its prior attempt. Correct the destination first; nothing was generated.',
      }),
    );
  });

  it('refuses a missing, ineffective, or unverified destination', () => {
    expect(() =>
      planPaymentRetry({
        prior,
        employeeId: 'employee-E-001',
        destinations: [account('E-001', { status: 'PENDING_VERIFICATION', id: 'new' })],
        onDate,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'PAYMENT_EXPORT_DESTINATION_BLOCKED',
        message:
          'The retry is blocked: an unverified Payroll Bank Account for E-001. Nothing was generated.',
      }),
    );
  });
});

describe('designatedDestination', () => {
  it('takes the ACTIVE account effective on the date', () => {
    const current = account('E-001', { id: 'current', effectiveFrom: '2026-06-01' });
    const ended = account('E-001', { id: 'ended', status: 'INACTIVE', effectiveTo: '2026-05-31' });
    expect(designatedDestination([ended, current], onDate)).toBe(current);
  });

  it('treats an account that ended, or starts later, as ineffective', () => {
    expect(designatedDestination([account('E-001', { effectiveTo: '2026-11-20' })], onDate)).toBe(
      'INEFFECTIVE',
    );
    expect(designatedDestination([account('E-001', { status: 'INACTIVE' })], onDate)).toBe(
      'INEFFECTIVE',
    );
  });

  it('ignores replaced and corrected history', () => {
    expect(designatedDestination([account('E-001', { status: 'REPLACED' })], onDate)).toBe(
      'MISSING',
    );
  });
});

describe('renderers', () => {
  const snapshot: PaymentExportSnapshot = {
    id: 'export-1',
    agencyId: 'agency-1',
    generatedAt: '2026-11-21T01:02:03.456Z',
    currency: 'PHP',
    period,
    controls: {
      sourceResultCount: 2,
      sourceNetTotal: '100.00',
      instructionCount: 1,
      instructionTotal: '100.00',
      excludedResultCount: 1,
      excludedResultTotal: '0.00',
    },
    instructions: [
      {
        id: 'instruction-1',
        payrollEmployeeId: 'result-1',
        agencyEmployeeNumber: '000123',
        payeeLegalName: 'Dela Cruz, Juan "Jun"',
        destinationType: 'BANK_ACCOUNT',
        institutionIdentifierScheme: 'AGENCY_BANK_CODE',
        institutionIdentifier: 'LBP',
        institutionName: 'LBP',
        accountIdentifier: '0012345678',
        maskedAccountIdentifier: '******5678',
        accountHolderName: 'Juan Dela Cruz',
        amount: '100.00',
        paymentReference: 'REG-2874-03-000123',
      },
    ],
  };

  it('renders a quoted CRLF CSV that keeps leading zeros and the full account', () => {
    const csv = renderPaymentExportCsv(snapshot);
    const [header, row, end] = csv.split('\r\n');
    expect(header).toMatch(/^"contract_code","contract_version","payment_export_id",/);
    expect(row).toContain('"PAYMENT_EXPORT","1","export-1"');
    expect(row).toContain('"000123","Dela Cruz, Juan ""Jun""","BANK_ACCOUNT"');
    expect(row).toContain('"0012345678","Juan Dela Cruz","100.00","REG-2874-03-000123"');
    expect(end).toBe('');
    expect(renderPaymentExportCsv(snapshot)).toBe(csv);
  });

  it('renders a summary that masks the account and lists the excluded results', () => {
    const summary = renderPaymentExportSummary(
      snapshot,
      [
        {
          payrollEmployeeId: 'result-2',
          agencyEmployeeNumber: '000200',
          payeeLegalName: 'Zero Pay',
          netAmount: '0.00',
        },
      ],
      'a'.repeat(64),
    );
    expect(summary).not.toContain('0012345678');
    expect(summary).toContain('******5678');
    expect(summary).toContain(`CSV SHA-256: ${'a'.repeat(64)}`);
    expect(summary).toContain('Excluded zero or negative net pay: 1, total 0.00');
    expect(summary).toContain('000200 | Zero Pay | 0.00');
    expect(summary).toContain('marks no one paid');
    expect(summary).not.toContain('Supersedes');
  });

  it("names the superseded export, the prior attempt, and the reason in a retry's summary", () => {
    const summary = renderPaymentExportSummary(
      {
        ...snapshot,
        retry: {
          supersedesPaymentExportId: 'export-0',
          priorPaymentInstructionId: 'instruction-0',
          reason: 'Account closed; corrected',
        },
      },
      [],
      'a'.repeat(64),
    );
    expect(summary).toContain(
      'Generated at: 2026-11-21T01:02:03.456Z\nSupersedes Payment Export: export-0\nRetry of Payment Instruction: instruction-0\nRetry reason: Account closed; corrected\nCSV SHA-256:',
    );
  });
});
