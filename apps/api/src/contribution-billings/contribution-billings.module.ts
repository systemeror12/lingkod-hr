import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { ContributionBillingsController } from './contribution-billings.controller';
import { ContributionBillingsService } from './contribution-billings.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [ContributionBillingsController],
  providers: [ContributionBillingsService],
})
export class ContributionBillingsModule {}
