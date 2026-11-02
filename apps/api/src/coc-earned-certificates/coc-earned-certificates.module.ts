import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { ApprovalCompletionRegistry } from '../approvals/approval.service';
import { AuthModule } from '../auth/auth.module';
import {
  OVERTIME_AUTHORITY_AUDIT_WRITER,
  overtimeAuthorityAuditWriter,
} from '../overtime-authorities/overtime-authorities.audit';
import { registerCocEarnedCertificateApproval } from './coc-earned-certificate-approval';
import { CocEarnedCertificatesController } from './coc-earned-certificates.controller';
import { CocEarnedCertificatesService } from './coc-earned-certificates.service';

/** Certificates of COC Earned, part of the Overtime module (ADR 0008). */
@Module({
  imports: [AuthModule, ApprovalModule],
  controllers: [CocEarnedCertificatesController],
  providers: [
    CocEarnedCertificatesService,
    { provide: OVERTIME_AUTHORITY_AUDIT_WRITER, useValue: overtimeAuthorityAuditWriter },
  ],
})
export class CocEarnedCertificatesModule implements OnModuleInit {
  constructor(
    @Inject(ApprovalCompletionRegistry) private readonly registry: ApprovalCompletionRegistry,
  ) {}

  onModuleInit(): void {
    registerCocEarnedCertificateApproval(this.registry);
  }
}
