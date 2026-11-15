import { Module } from '@nestjs/common';
import { CompensationBasisModule } from '../compensation-basis/compensation-basis.module';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
} from './contribution.calculators';
import { PayrollCalculationJob } from './payroll-calculation.job';
import { PayrollCalculationService } from './payroll-calculation.service';

@Module({
  imports: [CompensationBasisModule],
  providers: [
    BasicSalaryCalculator,
    GsisContributionCalculator,
    EmployeesCompensationCalculator,
    PayrollCalculationService,
    PayrollCalculationJob,
  ],
})
export class PayrollCalculationModule {}
