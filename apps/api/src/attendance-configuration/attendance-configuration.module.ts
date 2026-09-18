import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import {
  ATTENDANCE_CONFIGURATION_AUDIT_WRITER,
  attendanceConfigurationAuditWriter,
} from './attendance-configuration.audit';
import { AttendanceConfigurationController } from './attendance-configuration.controller';
import { HolidayCalendarsService } from './holiday-calendars.service';
import { ScheduleAssignmentsService } from './schedule-assignments.service';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AttendanceConfigurationController],
  providers: [
    WorkSchedulesService,
    WorkArrangementsService,
    HolidayCalendarsService,
    ScheduleAssignmentsService,
    {
      provide: ATTENDANCE_CONFIGURATION_AUDIT_WRITER,
      useValue: attendanceConfigurationAuditWriter,
    },
  ],
  exports: [
    WorkSchedulesService,
    WorkArrangementsService,
    HolidayCalendarsService,
    ScheduleAssignmentsService,
  ],
})
export class AttendanceConfigurationModule {}
