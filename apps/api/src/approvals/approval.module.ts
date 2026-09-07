import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApprovalController } from './approval.controller';
import {
  APPROVAL_AUDIT_WRITER,
  APPROVAL_COMPLETION_HANDLER,
  approvalAuditWriter,
  approvalCompletionHandler,
  ApprovalsService,
} from './approval.service';

@Module({
  imports: [AuthModule],
  controllers: [ApprovalController],
  providers: [
    ApprovalsService,
    { provide: APPROVAL_AUDIT_WRITER, useValue: approvalAuditWriter },
    { provide: APPROVAL_COMPLETION_HANDLER, useValue: approvalCompletionHandler },
  ],
  exports: [ApprovalsService],
})
export class ApprovalModule {}
