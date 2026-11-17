import { describe, expect, it } from 'vitest';
import {
  LEAVE_MONETIZATION_COMPONENT_CODE,
  LeaveMonetizationCalculator,
} from './leave-monetization.calculator';
import type { EmployeePayrollSources, PendingPayrollInput } from './payroll-calculator';

const input = (overrides: Partial<PendingPayrollInput>): PendingPayrollInput => ({
  id: 'input-1',
  inputKind: 'MONETIZATION_EARNING',
  sourceType: 'MONETIZATION_POSTING',
  sourceId: 'version-1',
  effectiveDate: '2026-03-10',
  quantity: '12.5000',
  amount: '16265.3400',
  payloadSnapshot: { calculatorKind: 'MCL_FIXED_FACTOR_0_0481927', payrollValuation: { a: 1 } },
  ...overrides,
});

const run = (payrollInputs: PendingPayrollInput[]) =>
  new LeaveMonetizationCalculator().calculate({} as never, {} as never, [], {
    payrollInputs,
  } as EmployeePayrollSources);

describe('LeaveMonetizationCalculator', () => {
  it('pays each monetization input as one de minimis earning linked to it', () => {
    const outcome = run([
      input({}),
      input({ id: 'input-2', quantity: '5.0000', amount: '6506.1400' }),
      input({ id: 'lwop-1', inputKind: 'LEAVE_WITHOUT_PAY', amount: null }),
    ]);

    expect(outcome.exceptions).toEqual([]);
    expect(outcome.lines).toEqual([
      {
        componentCode: LEAVE_MONETIZATION_COMPONENT_CODE,
        lineType: 'EARNING',
        ruleVersionId: null,
        quantity: '12.5000',
        rate: null,
        amount: '16265.3400',
        source: expect.objectContaining({
          unit: 'LEAVE_CREDIT',
          payrollInputId: 'input-1',
          valuationDate: '2026-03-10',
          valuation: { a: 1 },
          taxTreatment: 'DE_MINIMIS',
          deMinimisBenefit: 'MONETIZED_LEAVE_CREDITS',
        }),
        sourceRecords: [{ payrollInputId: 'input-1' }],
      },
      expect.objectContaining({
        quantity: '5.0000',
        amount: '6506.1400',
        sourceRecords: [{ payrollInputId: 'input-2' }],
      }),
    ]);
  });

  it('writes nothing when the Employee has no monetization input', () => {
    expect(run([])).toEqual({ lines: [], exceptions: [] });
  });
});
