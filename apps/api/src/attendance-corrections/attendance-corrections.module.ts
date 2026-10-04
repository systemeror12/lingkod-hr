import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AttendanceConfigurationModule } from '../attendance-configuration/attendance-configuration.module';
import { AttendanceDaysModule } from '../attendance-days/attendance-days.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { DtrsModule } from '../dtrs/dtrs.module';
import { AttendancePeriodsModule } from '../attendance-periods/attendance-periods.module';
import {
  ATTENDANCE_CORRECTION_AUDIT_WRITER,
  attendanceCorrectionAuditWriter,
} from './attendance-corrections.audit';
import { AttendanceCorrectionsController } from './attendance-corrections.controller';
import { AttendanceCorrectionsService } from './attendance-corrections.service';

@Module({
  imports: [
    AuthModule,
    ApprovalModule,
    AttendanceConfigurationModule,
    AttendanceModule,
    AttendanceDaysModule,
    DocumentsModule,
    DtrsModule,
    AttendancePeriodsModule,
  ],
  controllers: [AttendanceCorrectionsController],
  providers: [
    AttendanceCorrectionsService,
    {
      provide: ATTENDANCE_CORRECTION_AUDIT_WRITER,
      useValue: attendanceCorrectionAuditWriter,
    },
  ],
  exports: [AttendanceCorrectionsService],
})
export class AttendanceCorrectionsModule {}
