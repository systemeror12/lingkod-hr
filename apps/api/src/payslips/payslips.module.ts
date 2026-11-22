import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PayslipGenerationJob } from './payslip-generation.job';
import { PayslipGenerationService } from './payslip-generation.service';
import { PayslipReadService } from './payslip-read.service';
import { PayslipReleaseService } from './payslip-release.service';
import { PayslipWithholdService } from './payslip-withhold.service';
import { PayslipsController } from './payslips.controller';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PayslipsController],
  providers: [
    PayslipGenerationService,
    PayslipGenerationJob,
    PayslipReleaseService,
    PayslipWithholdService,
    PayslipReadService,
  ],
})
export class PayslipsModule {}
