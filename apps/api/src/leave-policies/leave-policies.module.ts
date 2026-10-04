import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { MandatoryLeaveAssessmentsModule } from '../mandatory-leave-assessments/mandatory-leave-assessments.module';
import { LeavePoliciesController } from './leave-policies.controller';
import {
  LEAVE_POLICY_AUDIT_WRITER,
  LeavePoliciesService,
  leavePolicyAuditWriter,
} from './leave-policies.service';

@Module({
  imports: [AuthModule, DocumentsModule, MandatoryLeaveAssessmentsModule],
  controllers: [LeavePoliciesController],
  providers: [
    LeavePoliciesService,
    { provide: LEAVE_POLICY_AUDIT_WRITER, useValue: leavePolicyAuditWriter },
  ],
  exports: [LeavePoliciesService],
})
export class LeavePoliciesModule {}
