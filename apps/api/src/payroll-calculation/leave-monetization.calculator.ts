import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import type { DeMinimisBenefit } from '../payroll-rule-versions/national-payroll-rule-versions';
import type {
  CalculatedLine,
  CalculationContext,
  CalculatorOutcome,
  EmployeePayrollSources,
  PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const LEAVE_MONETIZATION_COMPONENT_CODE = 'LEAVE_MONETIZATION';

const TAX_AUTHORITY =
  'BIR RR No. 29-2025, sec. 2.78.1(A)(3)(b): monetized vacation and sick leave credits paid to government officials and employees are non-taxable de minimis benefits (docs/research/native-payroll-component-authorities.md).';

/**
 * Pays each Monetization Earning Input the calculation takes as one
 * `EARNING` line of the amount Payroll froze when it accepted the input
 * (payroll-schema.md §4), linked to the input in `payroll_line_sources`. The
 * line's quantity is the monetized credits; it has no rate, since the rounded
 * amount is not credits × a rate, and no rule version, since the valuation
 * and its authority travel in the input's payload. The amount is a de minimis
 * benefit with no ceiling for government employees (RR No. 29-2025 sec.
 * 2.78.1(A)(3)(b)), which the `DE_MINIMIS_BENEFITS` rule version records.
 *
 * It runs in a regular period only: a special period pays only the components
 * it names, and none names this one. The input stays `PENDING`; finalization
 * marks it consumed (#335), so every calculation version until then pays it.
 */
export class LeaveMonetizationCalculator implements PayrollCalculator {
  calculate(
    _basis: CompensationBasis,
    _context: CalculationContext,
    _earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    const lines = sources.payrollInputs
      .filter((input) => input.inputKind === 'MONETIZATION_EARNING')
      .map((input): CalculatedLine => {
        // The inbox's CHECK and valuation give every monetization both.
        if (input.amount === null || input.quantity === null) {
          throw new Error(`Monetization Earning Input ${input.id} has no amount or quantity.`);
        }
        const payload = input.payloadSnapshot as { payrollValuation?: unknown } | null;
        return {
          componentCode: LEAVE_MONETIZATION_COMPONENT_CODE,
          lineType: 'EARNING',
          ruleVersionId: null,
          quantity: input.quantity,
          rate: null,
          amount: input.amount,
          source: {
            unit: 'LEAVE_CREDIT',
            payrollInputId: input.id,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            valuationDate: input.effectiveDate,
            valuation: payload?.payrollValuation ?? null,
            taxTreatment: 'DE_MINIMIS' satisfies TaxTreatment,
            deMinimisBenefit: 'MONETIZED_LEAVE_CREDITS' satisfies DeMinimisBenefit,
            taxAuthority: TAX_AUTHORITY,
          },
          sourceRecords: [{ payrollInputId: input.id }],
        };
      });
    return { lines, exceptions: [] };
  }
}
