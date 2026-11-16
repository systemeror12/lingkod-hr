import { Module } from '@nestjs/common';
import { AttendanceDeficitChargesModule } from '../attendance-deficit-charges/attendance-deficit-charges.module';
import { AttendancePeriodsModule } from '../attendance-periods/attendance-periods.module';
import { CompensationBasisModule } from '../compensation-basis/compensation-basis.module';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
} from './contribution.calculators';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { PayrollCalculationJob } from './payroll-calculation.job';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollSourcesReader } from './payroll-sources.reader';
import { PeraCalculator } from './pera.calculator';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';
import { CommutableRataCalculator } from './commutable-rata.calculator';
import { OvertimePayCalculator } from './overtime-pay.calculator';

@Module({
  imports: [CompensationBasisModule, AttendancePeriodsModule, AttendanceDeficitChargesModule],
  providers: [
    BasicSalaryCalculator,
    DaysWithoutPayCalculator,
    GsisContributionCalculator,
    EmployeesCompensationCalculator,
    YearEndBonusCalculator,
    PeraCalculator,
    CommutableRataCalculator,
    OvertimePayCalculator,
    PayrollSourcesReader,
    PayrollCalculationService,
    PayrollCalculationJob,
  ],
})
export class PayrollCalculationModule {}
