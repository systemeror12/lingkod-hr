import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AttendanceConfigurationModule } from '../attendance-configuration/attendance-configuration.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { LeaveApplicationsController } from './leave-applications.controller';
import {
  LEAVE_APPLICATION_AUDIT_WRITER,
  LeaveApplicationsService,
  leaveApplicationAuditWriter,
} from './leave-applications.service';

@Module({
  imports: [AuthModule, DocumentsModule, ApprovalModule, AttendanceConfigurationModule],
  controllers: [LeaveApplicationsController],
  providers: [
    LeaveApplicationsService,
    { provide: LEAVE_APPLICATION_AUDIT_WRITER, useValue: leaveApplicationAuditWriter },
  ],
  exports: [LeaveApplicationsService],
})
export class LeaveApplicationsModule {}
