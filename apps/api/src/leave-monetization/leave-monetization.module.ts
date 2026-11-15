import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { MandatoryLeaveAssessmentsModule } from '../mandatory-leave-assessments/mandatory-leave-assessments.module';
import { PayrollInputsModule } from '../payroll-inputs/payroll-inputs.module';
import { LeaveMonetizationController } from './leave-monetization.controller';
import { LeaveMonetizationService } from './leave-monetization.service';
import { PayrollInboxMonetizationAdapter } from './payroll-monetization.adapter';
import { PAYROLL_MONETIZATION_PORT } from './payroll-monetization.port';

@Module({
  imports: [
    AuthModule,
    ApprovalModule,
    DocumentsModule,
    MandatoryLeaveAssessmentsModule,
    PayrollInputsModule,
  ],
  controllers: [LeaveMonetizationController],
  providers: [
    LeaveMonetizationService,
    { provide: PAYROLL_MONETIZATION_PORT, useClass: PayrollInboxMonetizationAdapter },
  ],
  exports: [LeaveMonetizationService],
})
export class LeaveMonetizationModule {}
