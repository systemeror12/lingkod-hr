import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodsService } from './payroll-periods.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollPeriodsController],
  providers: [PayrollPeriodsService, PayrollCertificationService],
  exports: [PayrollPeriodsService],
})
export class PayrollPeriodsModule {}
