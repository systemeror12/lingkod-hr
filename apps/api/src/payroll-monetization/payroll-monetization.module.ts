import { Module } from '@nestjs/common';
import { CompensationBasisModule } from '../compensation-basis/compensation-basis.module';
import {
  MONETIZATION_VALUATION_RULES,
  PayrollMonetizationCalculator,
  unresolvedMonetizationValuationRules,
} from './payroll-monetization.calculator';

@Module({
  imports: [CompensationBasisModule],
  providers: [
    PayrollMonetizationCalculator,
    // No authority settles the valuation date or centavo rounding yet (#614).
    { provide: MONETIZATION_VALUATION_RULES, useValue: unresolvedMonetizationValuationRules },
  ],
  exports: [PayrollMonetizationCalculator],
})
export class PayrollMonetizationModule {}
