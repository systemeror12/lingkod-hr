import { Module } from '@nestjs/common';
import { AttendancePostedLeaveInputsModule } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.module';
import { ApprovalModule } from '../approvals/approval.module';
import { AttendanceConfigurationModule } from '../attendance-configuration/attendance-configuration.module';
import { AttendanceCorrectionsModule } from '../attendance-corrections/attendance-corrections.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { LeaveApplicationsController } from './leave-applications.controller';
import {
  LEAVE_APPLICATION_AUDIT_WRITER,
  LeaveApplicationsService,
  leaveApplicationAuditWriter,
} from './leave-applications.service';

@Module({
  imports: [
    AuthModule,
    DocumentsModule,
    ApprovalModule,
    AttendanceConfigurationModule,
    AttendancePostedLeaveInputsModule,
    AttendanceCorrectionsModule,
  ],
  controllers: [LeaveApplicationsController],
  providers: [
    LeaveApplicationsService,
    { provide: LEAVE_APPLICATION_AUDIT_WRITER, useValue: leaveApplicationAuditWriter },
  ],
  exports: [LeaveApplicationsService],
})
export class LeaveApplicationsModule {}
