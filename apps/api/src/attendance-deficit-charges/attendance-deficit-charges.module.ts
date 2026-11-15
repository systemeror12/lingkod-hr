import { Module } from '@nestjs/common';
import { AttendancePeriodsModule } from '../attendance-periods/attendance-periods.module';
import { AuthModule } from '../auth/auth.module';
import { MandatoryLeaveAssessmentsModule } from '../mandatory-leave-assessments/mandatory-leave-assessments.module';
import { PayrollInputsModule } from '../payroll-inputs/payroll-inputs.module';
import { AttendanceDeficitChargeConsumer } from './attendance-deficit-charges.consumer';
import { AttendanceDeficitChargesController } from './attendance-deficit-charges.controller';
import { AttendanceDeficitChargesService } from './attendance-deficit-charges.service';

@Module({
  imports: [
    AuthModule,
    AttendancePeriodsModule,
    PayrollInputsModule,
    MandatoryLeaveAssessmentsModule,
  ],
  controllers: [AttendanceDeficitChargesController],
  providers: [AttendanceDeficitChargesService, AttendanceDeficitChargeConsumer],
  exports: [AttendanceDeficitChargesService],
})
export class AttendanceDeficitChargesModule {}
