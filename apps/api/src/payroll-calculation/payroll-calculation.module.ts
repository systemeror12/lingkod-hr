import { Module } from '@nestjs/common';
import { CompensationBasisModule } from '../compensation-basis/compensation-basis.module';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import { PayrollCalculationJob } from './payroll-calculation.job';
import { PayrollCalculationService } from './payroll-calculation.service';

@Module({
  imports: [CompensationBasisModule],
  providers: [BasicSalaryCalculator, PayrollCalculationService, PayrollCalculationJob],
})
export class PayrollCalculationModule {}
