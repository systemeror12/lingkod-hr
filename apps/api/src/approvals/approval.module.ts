import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApprovalController } from './approval.controller';
import {
  APPROVAL_AUDIT_WRITER,
  APPROVAL_COMPLETION_HANDLER,
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from './approval.service';

@Module({
  imports: [AuthModule],
  controllers: [ApprovalController],
  providers: [
    ApprovalsService,
    ApprovalCompletionRegistry,
    { provide: APPROVAL_AUDIT_WRITER, useValue: approvalAuditWriter },
    { provide: APPROVAL_COMPLETION_HANDLER, useExisting: ApprovalCompletionRegistry },
  ],
  exports: [ApprovalsService, ApprovalCompletionRegistry],
})
export class ApprovalModule {}
