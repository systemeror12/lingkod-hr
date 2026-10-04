import { Injectable } from '@nestjs/common';
import {
  type MonetizationAdjustmentResult,
  type MonetizationEarningInputResult,
  type PayrollMonetizationPort,
} from './payroll-monetization.port';

/**
 * Production binding until the Payroll module owns monetization earning inputs.
 * No authoritative salary source, calculation authority, or rounding rule
 * exists in the Leave phase, so the port reports a blocking INDETERMINATE
 * result instead of converting cash with invented facts.
 */
@Injectable()
export class FailClosedPayrollMonetizationProvider implements PayrollMonetizationPort {
  async submitEarningInput(): Promise<MonetizationEarningInputResult> {
    return {
      kind: 'INDETERMINATE',
      code: 'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
      reason:
        'Payroll has not bound an authoritative salary source, calculation, and rounding contract for leave monetization.',
      missingFacts: [
        'AUTHORITATIVE_SALARY_SOURCE',
        'FIXED_CALCULATION_AUTHORITY',
        'ROUNDING_RULE',
        'VALUATION_DATE_RULE',
      ],
    };
  }

  async adjustEarningInput(): Promise<MonetizationAdjustmentResult> {
    return {
      kind: 'INDETERMINATE',
      code: 'PAYROLL_MONETIZATION_AUTHORITY_MISSING',
      reason: 'Payroll has not bound a linked-adjustment contract for monetization earning inputs.',
      missingFacts: ['LINKED_PAYROLL_ADJUSTMENT_CONTRACT'],
    };
  }
}
