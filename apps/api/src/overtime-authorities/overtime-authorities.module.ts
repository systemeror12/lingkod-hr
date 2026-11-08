import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { ApprovalCompletionRegistry } from '../approvals/approval.service';
import { AuthModule } from '../auth/auth.module';
import { ApproveOvertimeAuthorityService } from './approve-overtime-authority.service';
import { CancelOvertimeAuthorityService } from './cancel-overtime-authority.service';
import { CreateOvertimeAuthorityService } from './create-overtime-authority.service';
import { registerOvertimeAuthorityApproval } from './overtime-authority-approval';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  overtimeAuthorityAuditWriter,
} from './overtime-authorities.audit';
import { OvertimeAuthoritiesController } from './overtime-authorities.controller';
import { ReadOvertimeAuthoritiesService } from './read-overtime-authorities.service';
import { RejectOvertimeAuthorityService } from './reject-overtime-authority.service';
import { ReviewOvertimeAuthorityService } from './review-overtime-authority.service';
import { SubmitOvertimeAuthorityService } from './submit-overtime-authority.service';
import { UpdateOvertimeAuthorityService } from './update-overtime-authority.service';

@Module({
  imports: [AuthModule, ApprovalModule],
  controllers: [OvertimeAuthoritiesController],
  providers: [
    CreateOvertimeAuthorityService,
    UpdateOvertimeAuthorityService,
    SubmitOvertimeAuthorityService,
    CancelOvertimeAuthorityService,
    ReviewOvertimeAuthorityService,
    ApproveOvertimeAuthorityService,
    RejectOvertimeAuthorityService,
    ReadOvertimeAuthoritiesService,
    { provide: OVERTIME_AUTHORITY_AUDIT_WRITER, useValue: overtimeAuthorityAuditWriter },
  ],
})
export class OvertimeAuthoritiesModule implements OnModuleInit {
  constructor(
    @Inject(ApprovalCompletionRegistry) private readonly registry: ApprovalCompletionRegistry,
  ) {}

  onModuleInit(): void {
    registerOvertimeAuthorityApproval(this.registry);
  }
}
