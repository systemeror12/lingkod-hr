import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import {
  AuthorizedDeductionsCalculator,
  inDeductionOrder,
} from './authorized-deductions.calculator';
import type {
  CalculatedLine,
  CalculationContext,
  DeductionObligationDue,
  EmployeePayrollSources,
  FrozenRuleVersion,
} from './payroll-calculator';

// Test fixtures only: the floor and order follow FY 2026 GAA sec. 62
// (salary-overpayment-recovery-authorities.md R6), but no real version is
// loaded until a reviewer loads its file.
const deductionsVersion = (overrides: Partial<FrozenRuleVersion> = {}): FrozenRuleVersion => ({
  id: 'deductions-a',
  code: 'DEDUCTIONS-TEST-A',
  ruleKind: 'AUTHORIZED_DEDUCTIONS',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  successorEffectiveFrom: null,
  parameters: {
    allowedPayeeCategories: [
      'BIR',
      'GSIS',
      'HDMF',
      'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
      'LICENSED_INSURER',
    ],
    priorityPayeeCategories: ['BIR', 'GSIS', 'HDMF'],
    monthlyNetTakeHomeFloor: '5000.00',
  },
  ...overrides,
});

const contextWith = (...versions: FrozenRuleVersion[]): CalculationContext => ({
  periodFrom: '2026-08-01',
  periodTo: '2026-08-31',
  snapshotRuleVersionIds: new Set(versions.map((version) => version.id)),
  snapshotRuleVersions: versions,
  componentCodes: new Set<string>(),
});

const obligation = (
  id: string,
  overrides: Partial<DeductionObligationDue> = {},
): DeductionObligationDue => ({
  id,
  payeeCategory: 'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
  payeeName: 'Agency Employees Cooperative',
  issuerReference: `REF-${id}`,
  incurredOn: '2024-05-01',
  outstandingBalance: '100000.0000',
  scheduledAmount: '1000.0000',
  ...overrides,
});

const sourcesWith = (deductionObligations: DeductionObligationDue[]) =>
  ({ deductionObligations }) as unknown as EmployeePayrollSources;

const line = (
  componentCode: string,
  lineType: CalculatedLine['lineType'],
  amount: string,
): CalculatedLine => ({
  componentCode,
  lineType,
  ruleVersionId: null,
  quantity: null,
  rate: null,
  amount: new Prisma.Decimal(amount).toFixed(4),
  source: {},
});

/** Gross pay, and the tax and contributions an earlier calculator took. */
const pay = (gross: string, statutory: string) => [
  line('BASIC_SALARY', 'EARNING', gross),
  line('GSIS_PERSONAL_SHARE', 'DEDUCTION', statutory),
  line('GSIS_GOVERNMENT_SHARE', 'EMPLOYER_SHARE', '9999'),
];

const basis = { employeeId: 'employee-1', stretches: [] } as unknown as CompensationBasis;
const calculator = new AuthorizedDeductionsCalculator();
const calculate = (
  lines: CalculatedLine[],
  obligations: DeductionObligationDue[],
  context = contextWith(deductionsVersion()),
) => calculator.calculate(basis, context, lines, sourcesWith(obligations));
const deducted = (outcome: ReturnType<typeof calculate>) =>
  outcome.loanDeductions?.map((row) => [
    row.deductionObligationId,
    row.priority,
    row.deductedAmount,
    row.notDeductedAmount,
  ]);

describe('AuthorizedDeductionsCalculator', () => {
  it('writes nothing for an Employee with no obligation, with or without a version', () => {
    expect(calculate(pay('30000', '4800'), [], contextWith())).toEqual({
      lines: [],
      exceptions: [],
    });
  });

  it('satisfies the priority categories in their order, then the rest in the order incurred', () => {
    const insurer = obligation('insurer', {
      payeeCategory: 'LICENSED_INSURER',
      payeeName: 'Insurer',
      incurredOn: '2023-01-10',
    });
    const coopLater = obligation('coop-later', { incurredOn: '2025-02-01' });
    const coopEarlier = obligation('coop-earlier', { incurredOn: '2024-02-01' });
    const hdmf = obligation('hdmf', { payeeCategory: 'HDMF', incurredOn: '2020-01-01' });
    const gsis = obligation('gsis', { payeeCategory: 'GSIS', incurredOn: '2026-01-01' });
    const bir = obligation('bir', { payeeCategory: 'BIR', incurredOn: '2026-06-01' });

    const outcome = calculate(pay('30000', '4800'), [
      insurer,
      coopLater,
      hdmf,
      coopEarlier,
      gsis,
      bir,
    ]);
    expect(outcome.exceptions).toEqual([]);
    expect(deducted(outcome)).toEqual([
      ['bir', 1, '1000.0000', '0.0000'],
      ['gsis', 2, '1000.0000', '0.0000'],
      ['hdmf', 3, '1000.0000', '0.0000'],
      ['insurer', 4, '1000.0000', '0.0000'],
      ['coop-earlier', 5, '1000.0000', '0.0000'],
      ['coop-later', 6, '1000.0000', '0.0000'],
    ]);
    expect(outcome.lines.map((row) => [row.componentCode, row.lineType, row.amount])).toEqual(
      Array.from({ length: 6 }, () => ['LOAN_DEDUCTION', 'DEDUCTION', '1000.0000']),
    );
    expect(outcome.lines[0]!.ruleVersionId).toBe('deductions-a');
    expect(outcome.lines[0]!.source).toMatchObject({
      ruleVersionCode: 'DEDUCTIONS-TEST-A',
      deductionObligationId: 'bir',
      payeeCategory: 'BIR',
      priority: 1,
      amountDue: '1000.0000',
      notDeductedAmount: '0.0000',
      monthlyNetTakeHomeFloor: '5000.0000',
    });
  });

  it('orders obligations incurred the same day by payee and issuer reference', () => {
    const ordered = inDeductionOrder(
      [
        obligation('b2', { payeeName: 'B', issuerReference: '2' }),
        obligation('a', { payeeName: 'A', issuerReference: '9' }),
        obligation('b1', { payeeName: 'B', issuerReference: '1' }),
      ],
      [],
    );
    expect(ordered.map((row) => row.id)).toEqual(['a', 'b1', 'b2']);
  });

  it('stops what would take net pay below the floor and reports the amount not taken', () => {
    // The worked example of the authorities' R6: 30,000 gross, 4,800 statutory,
    // an 18,600 loan incurred first, then 2,000 due of which 1,600 fits.
    const loan = obligation('loan', { scheduledAmount: '18600.0000', incurredOn: '2024-01-15' });
    const later = obligation('later', {
      payeeCategory: 'LICENSED_INSURER',
      scheduledAmount: '2000.0000',
      incurredOn: '2026-05-01',
    });
    const last = obligation('last', { scheduledAmount: '300.0000', incurredOn: '2026-06-01' });

    const outcome = calculate(pay('30000', '4800'), [last, later, loan]);
    expect(deducted(outcome)).toEqual([
      ['loan', 1, '18600.0000', '0.0000'],
      ['later', 2, '1600.0000', '400.0000'],
      ['last', 3, '0.0000', '300.0000'],
    ]);
    // A fully stopped obligation has no Payroll Line; its Loan Deduction Line reports it.
    expect(outcome.lines.map((row) => row.amount)).toEqual(['18600.0000', '1600.0000']);
    expect(outcome.exceptions).toHaveLength(1);
    expect(outcome.exceptions[0]).toMatchObject({
      exceptionType: 'NET_PAY_FLOOR_STOPPED_DEDUCTION',
      severity: 'WARNING',
      details: {
        monthlyNetTakeHomeFloor: '5000.0000',
        netBeforeObligations: '25200.0000',
        notDeductedAmount: '700.0000',
        obligations: [
          {
            deductionObligationId: 'later',
            amountDue: '2000.0000',
            deductedAmount: '1600.0000',
            notDeductedAmount: '400.0000',
          },
          {
            deductionObligationId: 'last',
            amountDue: '300.0000',
            deductedAmount: '0.0000',
            notDeductedAmount: '300.0000',
          },
        ],
      },
    });
  });

  it('deducts in full an obligation that leaves net pay exactly at the floor', () => {
    const outcome = calculate(pay('8000', '1000'), [
      obligation('exact', { scheduledAmount: '2000.0000' }),
    ]);
    expect(deducted(outcome)).toEqual([['exact', 1, '2000.0000', '0.0000']]);
    expect(outcome.exceptions).toEqual([]);
  });

  it('deducts nothing when net pay before obligations is exactly at the floor', () => {
    const outcome = calculate(pay('6000', '1000'), [obligation('none')]);
    expect(deducted(outcome)).toEqual([['none', 1, '0.0000', '1000.0000']]);
    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions.map((exception) => exception.exceptionType)).toEqual([
      'NET_PAY_FLOOR_STOPPED_DEDUCTION',
    ]);
  });

  it('deducts nothing, never a negative amount, when net pay is already below the floor', () => {
    const outcome = calculate(pay('5500', '1000'), [obligation('below')]);
    expect(deducted(outcome)).toEqual([['below', 1, '0.0000', '1000.0000']]);
    expect(outcome.exceptions[0]!.details).toMatchObject({ netBeforeObligations: '4500.0000' });
  });

  it('counts every earlier deduction, such as more than one tax line, before the floor', () => {
    const lines = [
      ...pay('10000', '1000'),
      line('WITHHOLDING_TAX', 'DEDUCTION', '1500'),
      line('SUPPLEMENTARY_WITHHOLDING_TAX', 'DEDUCTION', '500'),
    ];
    const outcome = calculate(lines, [obligation('loan', { scheduledAmount: '3000.0000' })]);
    expect(deducted(outcome)).toEqual([['loan', 1, '2000.0000', '1000.0000']]);
  });

  it('takes no more than the outstanding balance', () => {
    const outcome = calculate(pay('30000', '4800'), [
      obligation('closing', { scheduledAmount: '1000.0000', outstandingBalance: '250.5000' }),
    ]);
    expect(outcome.loanDeductions?.[0]).toMatchObject({
      amountDue: '250.5000',
      deductedAmount: '250.5000',
      notDeductedAmount: '0.0000',
    });
  });

  it('blocks with no version in effect on every date, or one that changes in the month', () => {
    const ended = deductionsVersion({ effectiveTo: '2026-08-15' });
    expect(
      calculate(pay('30000', '4800'), [obligation('a')], contextWith(ended)).exceptions,
    ).toMatchObject([
      { exceptionType: 'AUTHORIZED_DEDUCTIONS_RULE_NOT_IN_EFFECT', severity: 'BLOCKING' },
    ]);
    const successor = deductionsVersion({
      id: 'deductions-b',
      code: 'DEDUCTIONS-TEST-B',
      effectiveFrom: '2026-08-16',
    });
    const changing = calculate(
      pay('30000', '4800'),
      [obligation('a')],
      contextWith(ended, successor),
    );
    expect(changing.exceptions).toMatchObject([
      { exceptionType: 'AUTHORIZED_DEDUCTIONS_RULE_CHANGE_IN_PERIOD', severity: 'BLOCKING' },
    ]);
    expect(changing.lines).toEqual([]);
  });

  it("blocks an obligation whose payee category the period's version does not allow", () => {
    const outcome = calculate(pay('30000', '4800'), [
      obligation('allowed'),
      obligation('bank', { payeeCategory: 'THRIFT_OR_RURAL_BANK' }),
    ]);
    expect(outcome.lines).toEqual([]);
    expect(outcome.exceptions).toMatchObject([
      {
        exceptionType: 'DEDUCTION_PAYEE_NOT_ALLOWED',
        severity: 'BLOCKING',
        details: { deductionObligationId: 'bank', payeeCategory: 'THRIFT_OR_RURAL_BANK' },
      },
    ]);
  });
});
