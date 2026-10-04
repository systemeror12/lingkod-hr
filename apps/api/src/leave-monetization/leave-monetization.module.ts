import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { MandatoryLeaveAssessmentsModule } from '../mandatory-leave-assessments/mandatory-leave-assessments.module';
import { LeaveMonetizationController } from './leave-monetization.controller';
import { LeaveMonetizationService } from './leave-monetization.service';
import { FailClosedPayrollMonetizationProvider } from './payroll-monetization.fail-closed';
import { PAYROLL_MONETIZATION_PORT } from './payroll-monetization.port';

@Module({
  imports: [AuthModule, ApprovalModule, DocumentsModule, MandatoryLeaveAssessmentsModule],
  controllers: [LeaveMonetizationController],
  providers: [
    LeaveMonetizationService,
    { provide: PAYROLL_MONETIZATION_PORT, useClass: FailClosedPayrollMonetizationProvider },
  ],
  exports: [LeaveMonetizationService],
})
export class LeaveMonetizationModule {}
