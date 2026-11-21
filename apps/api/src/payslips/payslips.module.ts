import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PayslipGenerationJob } from './payslip-generation.job';
import { PayslipGenerationService } from './payslip-generation.service';

@Module({
  imports: [DocumentsModule],
  providers: [PayslipGenerationService, PayslipGenerationJob],
})
export class PayslipsModule {}
