import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { DeductionObligationsController } from './deduction-obligations.controller';
import { DeductionObligationsService } from './deduction-obligations.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [DeductionObligationsController],
  providers: [DeductionObligationsService],
})
export class DeductionObligationsModule {}
