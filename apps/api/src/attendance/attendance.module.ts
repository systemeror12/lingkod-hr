import { Module } from '@nestjs/common';
import { AttendanceConfigurationModule } from '../attendance-configuration/attendance-configuration.module';
import { AuthModule } from '../auth/auth.module';
import { ATTENDANCE_AUDIT_WRITER, attendanceAuditWriter } from './attendance.audit';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [AuthModule, AttendanceConfigurationModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    {
      provide: ATTENDANCE_AUDIT_WRITER,
      useValue: attendanceAuditWriter,
    },
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
