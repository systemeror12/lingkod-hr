import { Prisma } from '@prisma/client';
import { LOAN_DEDUCTION_COMPONENT_CODE } from './authorized-deductions.calculator';
import type { CalculatedException, CalculatedLine, LineType } from './payroll-calculator';
import { WITHHOLDING_TAX_COMPONENT_CODE } from './withholding-tax.calculator';

/**
 * The warning a carrying period writes for an adjustment whose difference is
 * negative: it stays OPEN, and no period carries it, until the COA decision
 * that recovers it is recorded as a Deduction Obligation (#648, ADR 0017).
 * That obligation's balance is this warning's negated `netDifference`.
 */
export const PAYROLL_ADJUSTMENT_NEGATIVE = 'PAYROLL_ADJUSTMENT_NEGATIVE';

/**
 * Components a recalculation leaves out on both sides. The withholding tax
 * and Deduction Obligations belong to the period that pays the difference:
 * its own withholding tax taxes the difference lines with its other pay, and
 * its own deductions apply after it (payroll-schema.md §10, a reading).
 */
export const ADJUSTMENT_EXCLUDED_COMPONENT_CODES: readonly string[] = [
  WITHHOLDING_TAX_COMPONENT_CODE,
  LOAN_DEDUCTION_COMPONENT_CODE,
];

/** A line already paid for the original period: its own, or a posted adjustment's. */
export interface PreviousLine {
  componentCode: string;
  lineType: LineType;
  amount: string;
  source: Record<string, unknown>;
}

export interface AdjustmentOriginal {
  payrollAdjustmentId: string;
  originalPayrollPeriodId: string;
  periodFrom: string;
  periodTo: string;
}

/**
 * The line-by-line difference of one Payroll Adjustment (ADR 0016): for each
 * component and line type, what the recalculation of the original period
 * gives less what the original result and every posted adjustment already
 * paid. A difference of zero writes no line. Each line keeps the
 * recalculated lines it rests on and their tax treatment, so the carrying
 * period's withholding tax reads it like any other line.
 *
 * A negative net difference (earnings less deductions) writes no line and a
 * `PAYROLL_ADJUSTMENT_NEGATIVE` warning: the adjustment stays OPEN until its
 * COA recovery is recorded (ADR 0017).
 */
export function adjustmentDifference(
  original: AdjustmentOriginal,
  recalculated: readonly CalculatedLine[],
  previous: readonly PreviousLine[],
): { lines: CalculatedLine[]; exceptions: CalculatedException[] } {
  const zero = new Prisma.Decimal(0);
  const groups = new Map<
    string,
    {
      componentCode: string;
      lineType: LineType;
      recalculated: CalculatedLine[];
      previousAmount: Prisma.Decimal;
      previousSource: Record<string, unknown> | null;
    }
  >();
  const groupOf = (componentCode: string, lineType: LineType) => {
    const key = `${componentCode}|${lineType}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        componentCode,
        lineType,
        recalculated: [],
        previousAmount: zero,
        previousSource: null,
      };
      groups.set(key, group);
    }
    return group;
  };
  const counted = (componentCode: string) =>
    !ADJUSTMENT_EXCLUDED_COMPONENT_CODES.includes(componentCode);
  for (const line of recalculated) {
    if (counted(line.componentCode))
      groupOf(line.componentCode, line.lineType).recalculated.push(line);
  }
  for (const line of previous) {
    if (!counted(line.componentCode)) continue;
    const group = groupOf(line.componentCode, line.lineType);
    group.previousAmount = group.previousAmount.add(line.amount);
    group.previousSource ??= line.source;
  }

  const lines: CalculatedLine[] = [];
  let net = zero;
  for (const group of groups.values()) {
    const recalculatedAmount = group.recalculated.reduce(
      (total, line) => total.add(line.amount),
      zero,
    );
    const difference = recalculatedAmount.sub(group.previousAmount);
    if (difference.isZero()) continue;
    if (group.lineType === 'EARNING') net = net.add(difference);
    if (group.lineType === 'DEDUCTION') net = net.sub(difference);
    const ruleVersionIds = [
      ...new Set(group.recalculated.flatMap((line) => line.ruleVersionId ?? [])),
    ];
    const treatment = group.recalculated[0]?.source ?? group.previousSource ?? {};
    lines.push({
      componentCode: group.componentCode,
      lineType: group.lineType,
      ruleVersionId: ruleVersionIds.length === 1 ? ruleVersionIds[0]! : null,
      quantity: null,
      rate: null,
      amount: difference.toFixed(4),
      source: {
        payrollAdjustment: original,
        recalculatedAmount: recalculatedAmount.toFixed(4),
        previousAmount: group.previousAmount.toFixed(4),
        recalculated: group.recalculated.map((line) => ({
          ruleVersionId: line.ruleVersionId,
          quantity: line.quantity,
          rate: line.rate,
          amount: line.amount,
          source: line.source,
        })),
        ...('taxTreatment' in treatment ? { taxTreatment: treatment.taxTreatment } : {}),
        ...('deMinimisBenefit' in treatment
          ? { deMinimisBenefit: treatment.deMinimisBenefit }
          : {}),
      },
      payrollAdjustmentId: original.payrollAdjustmentId,
    });
  }
  if (net.isNegative()) {
    return {
      lines: [],
      exceptions: [
        {
          exceptionType: PAYROLL_ADJUSTMENT_NEGATIVE,
          severity: 'WARNING',
          details: {
            message: `Recalculating ${original.periodFrom} to ${original.periodTo} gives ${net.toFixed(2)} less than was paid. The Payroll Adjustment stays open until a final and executory COA decision is recorded as its recovery.`,
            ...original,
            netDifference: net.toFixed(4),
            lines: lines.map(({ componentCode, lineType, amount }) => ({
              componentCode,
              lineType,
              amount,
            })),
          },
        },
      ],
    };
  }
  return { lines, exceptions: [] };
}
