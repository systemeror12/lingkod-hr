import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollVarianceReportsController } from './payroll-variance-reports.controller';
import { PayrollVarianceReportsService } from './payroll-variance-reports.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollVarianceReportsController],
  providers: [PayrollVarianceReportsService],
})
export class PayrollVarianceReportsModule {}
