import { Module } from '@nestjs/common';
import { AttendanceDaysModule } from '../attendance-days/attendance-days.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import {
  ATTENDANCE_SUBMISSION_AUDIT_WRITER,
  attendanceSubmissionAuditWriter,
} from './attendance-submissions.audit';
import { AttendanceSubmissionsController } from './attendance-submissions.controller';
import { AttendanceSubmissionsService } from './attendance-submissions.service';

@Module({
  imports: [AuthModule, AttendanceDaysModule, DocumentsModule],
  controllers: [AttendanceSubmissionsController],
  providers: [
    AttendanceSubmissionsService,
    { provide: ATTENDANCE_SUBMISSION_AUDIT_WRITER, useValue: attendanceSubmissionAuditWriter },
  ],
  exports: [AttendanceSubmissionsService],
})
export class AttendanceSubmissionsModule {}
