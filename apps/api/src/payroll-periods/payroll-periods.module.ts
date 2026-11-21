import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PayrollApprovalService } from './payroll-approval.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollCheckpointReviewService } from './payroll-checkpoint-review.service';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollReviewExportService } from './payroll-review-export.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PayrollPeriodsController],
  providers: [
    PayrollPeriodsService,
    PayrollCertificationService,
    PayrollReviewExportService,
    PayrollCheckpointReviewService,
    PayrollApprovalService,
  ],
  exports: [PayrollPeriodsService],
})
export class PayrollPeriodsModule {}
