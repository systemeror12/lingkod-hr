import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeductionSummariesController } from './deduction-summaries.controller';
import { DeductionSummariesService } from './deduction-summaries.service';

@Module({
  imports: [AuthModule],
  controllers: [DeductionSummariesController],
  providers: [DeductionSummariesService],
})
export class DeductionSummariesModule {}
