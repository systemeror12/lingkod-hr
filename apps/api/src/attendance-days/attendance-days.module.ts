import { Module } from '@nestjs/common';
import { AttendanceConfigurationModule } from '../attendance-configuration/attendance-configuration.module';
import { AttendanceContextsModule } from '../attendance-contexts/attendance-contexts.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AuthModule } from '../auth/auth.module';
import { LeaveAccountsModule } from '../leave-accounts/leave-accounts.module';
import { ATTENDANCE_DAY_AUDIT_WRITER, attendanceDayAuditWriter } from './attendance-days.audit';
import { AttendanceDaysController } from './attendance-days.controller';
import { AttendanceDaysService } from './attendance-days.service';

@Module({
  imports: [
    AuthModule,
    AttendanceConfigurationModule,
    AttendanceModule,
    AttendanceContextsModule,
    LeaveAccountsModule,
  ],
  controllers: [AttendanceDaysController],
  providers: [
    AttendanceDaysService,
    { provide: ATTENDANCE_DAY_AUDIT_WRITER, useValue: attendanceDayAuditWriter },
  ],
  exports: [AttendanceDaysService],
})
export class AttendanceDaysModule {}
