import { Module } from '@nestjs/common';
import { CompensationBasisModule } from '../compensation-basis/compensation-basis.module';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import { PayrollCalculationJob } from './payroll-calculation.job';
import { PayrollCalculationService } from './payroll-calculation.service';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

@Module({
  imports: [CompensationBasisModule],
  providers: [
    BasicSalaryCalculator,
    YearEndBonusCalculator,
    PayrollCalculationService,
    PayrollCalculationJob,
  ],
})
export class PayrollCalculationModule {}
