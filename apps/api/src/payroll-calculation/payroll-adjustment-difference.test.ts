import { describe, expect, it } from 'vitest';
import { adjustmentDifference, PAYROLL_ADJUSTMENT_NEGATIVE } from './payroll-adjustment-difference';
import type { CalculatedLine } from './payroll-calculator';

const original = {
  payrollAdjustmentId: 'adjustment',
  originalPayrollPeriodId: 'march',
  periodFrom: '2863-03-01',
  periodTo: '2863-03-31',
};

const line = (
  componentCode: string,
  lineType: CalculatedLine['lineType'],
  amount: string,
  taxTreatment = 'REGULAR_COMPENSATION',
): CalculatedLine => ({
  componentCode,
  lineType,
  ruleVersionId: 'schedule',
  quantity: '1.0000',
  rate: null,
  amount,
  source: { taxTreatment },
});

describe('adjustmentDifference', () => {
  it('writes each component and line type that changed, with its tax treatment', () => {
    const { lines, exceptions } = adjustmentDifference(
      original,
      [
        line('BASIC_SALARY', 'EARNING', '46200.0000'),
        line('PERA', 'EARNING', '2000.0000', 'NON_TAXABLE'),
        line('GSIS_PERSONAL_SHARE', 'DEDUCTION', '4158.0000', 'MANDATORY_CONTRIBUTION'),
        line('WITHHOLDING_TAX', 'DEDUCTION', '9000.0000', 'WITHHOLDING_TAX'),
      ],
      [
        line('BASIC_SALARY', 'EARNING', '44000.0000'),
        line('PERA', 'EARNING', '2000.0000', 'NON_TAXABLE'),
        line('GSIS_PERSONAL_SHARE', 'DEDUCTION', '3960.0000', 'MANDATORY_CONTRIBUTION'),
        line('WITHHOLDING_TAX', 'DEDUCTION', '8000.0000', 'WITHHOLDING_TAX'),
      ],
    );
    expect(exceptions).toEqual([]);
    expect(
      lines.map(({ componentCode, lineType, amount, payrollAdjustmentId, source }) => ({
        componentCode,
        lineType,
        amount,
        payrollAdjustmentId,
        taxTreatment: source.taxTreatment,
        previousAmount: source.previousAmount,
      })),
    ).toEqual([
      {
        componentCode: 'BASIC_SALARY',
        lineType: 'EARNING',
        amount: '2200.0000',
        payrollAdjustmentId: 'adjustment',
        taxTreatment: 'REGULAR_COMPENSATION',
        previousAmount: '44000.0000',
      },
      {
        componentCode: 'GSIS_PERSONAL_SHARE',
        lineType: 'DEDUCTION',
        amount: '198.0000',
        payrollAdjustmentId: 'adjustment',
        taxTreatment: 'MANDATORY_CONTRIBUTION',
        previousAmount: '3960.0000',
      },
    ]);
  });

  it('counts what posted adjustments already paid, so a settled difference writes nothing', () => {
    expect(
      adjustmentDifference(
        original,
        [line('BASIC_SALARY', 'EARNING', '44000.0000')],
        [line('BASIC_SALARY', 'EARNING', '0.0000'), line('BASIC_SALARY', 'EARNING', '44000.0000')],
      ),
    ).toEqual({ lines: [], exceptions: [] });
  });

  it('pays an empty original in full', () => {
    const { lines } = adjustmentDifference(
      original,
      [line('BASIC_SALARY', 'EARNING', '44000.0000')],
      [],
    );
    expect(lines).toMatchObject([{ amount: '44000.0000', ruleVersionId: 'schedule' }]);
  });

  it('writes no line and a warning for a negative difference', () => {
    const { lines, exceptions } = adjustmentDifference(
      original,
      [line('BASIC_SALARY', 'EARNING', '44000.0000')],
      [line('BASIC_SALARY', 'EARNING', '46200.0000')],
    );
    expect(lines).toEqual([]);
    expect(exceptions).toEqual([
      {
        exceptionType: PAYROLL_ADJUSTMENT_NEGATIVE,
        severity: 'WARNING',
        details: expect.objectContaining({
          payrollAdjustmentId: 'adjustment',
          netDifference: '-2200.0000',
        }),
      },
    ]);
  });
});
