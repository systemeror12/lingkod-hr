import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { ApprovalCompletionRegistry } from '../approvals/approval.service';
import { AttendanceCtoInputsModule } from '../attendance-cto-inputs/attendance-cto-inputs.module';
import { AttendanceDaysModule } from '../attendance-days/attendance-days.module';
import { AuthModule } from '../auth/auth.module';
import { CocAccountsModule } from '../coc-accounts/coc-accounts.module';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  overtimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import { ApproveCtoRequestService } from './approve-cto-request.service';
import { CancelCtoRequestService } from './cancel-cto-request.service';
import { CreateCtoRequestService } from './create-cto-request.service';
import { registerCtoRequestApproval } from './cto-request-approval';
import { CtoRequestsController } from './cto-requests.controller';
import { DiscardCtoRequestService } from './discard-cto-request.service';
import { RecommendCtoRequestService } from './recommend-cto-request.service';
import { RejectCtoRequestService } from './reject-cto-request.service';
import { ReturnCtoRequestService } from './return-cto-request.service';
import { SubmitCtoRequestService } from './submit-cto-request.service';
import { WithdrawCtoRequestService } from './withdraw-cto-request.service';

/** CTO Requests against an Employee's COC Account (hris-controls §5.19, ADR 0009). */
@Module({
  imports: [
    AuthModule,
    ApprovalModule,
    AttendanceDaysModule,
    AttendanceCtoInputsModule,
    CocAccountsModule,
  ],
  controllers: [CtoRequestsController],
  providers: [
    CreateCtoRequestService,
    DiscardCtoRequestService,
    SubmitCtoRequestService,
    WithdrawCtoRequestService,
    RecommendCtoRequestService,
    ReturnCtoRequestService,
    ApproveCtoRequestService,
    RejectCtoRequestService,
    CancelCtoRequestService,
    { provide: OVERTIME_AUTHORITY_AUDIT_WRITER, useValue: overtimeAuthorityAuditWriter },
  ],
})
export class CtoRequestsModule implements OnModuleInit {
  constructor(
    @Inject(ApprovalCompletionRegistry) private readonly registry: ApprovalCompletionRegistry,
  ) {}

  onModuleInit(): void {
    registerCtoRequestApproval(this.registry);
  }
}
