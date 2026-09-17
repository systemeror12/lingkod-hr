import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import {
  ATTENDANCE_CONFIGURATION_AUDIT_WRITER,
  attendanceConfigurationAuditWriter,
} from './attendance-configuration.audit';
import { AttendanceConfigurationController } from './attendance-configuration.controller';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AttendanceConfigurationController],
  providers: [
    WorkSchedulesService,
    WorkArrangementsService,
    {
      provide: ATTENDANCE_CONFIGURATION_AUDIT_WRITER,
      useValue: attendanceConfigurationAuditWriter,
    },
  ],
  exports: [WorkSchedulesService, WorkArrangementsService],
})
export class AttendanceConfigurationModule {}
