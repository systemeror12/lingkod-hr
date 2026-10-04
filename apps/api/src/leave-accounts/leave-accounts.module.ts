import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { MandatoryLeaveAssessmentsModule } from '../mandatory-leave-assessments/mandatory-leave-assessments.module';
import { LeaveAccountsController } from './leave-accounts.controller';
import {
  LEAVE_ACCOUNT_AUDIT_WRITER,
  LeaveAccountsService,
  leaveAccountAuditWriter,
} from './leave-accounts.service';

@Module({
  imports: [AuthModule, DocumentsModule, MandatoryLeaveAssessmentsModule],
  controllers: [LeaveAccountsController],
  providers: [
    LeaveAccountsService,
    { provide: LEAVE_ACCOUNT_AUDIT_WRITER, useValue: leaveAccountAuditWriter },
  ],
  exports: [LeaveAccountsService],
})
export class LeaveAccountsModule {}
