import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { DisbursementOutcomesService } from './disbursement-outcomes.service';
import { PaymentExportsController } from './payment-exports.controller';
import { PaymentExportsService } from './payment-exports.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PaymentExportsController],
  providers: [PaymentExportsService, DisbursementOutcomesService],
})
export class PaymentExportsModule {}
