import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollResultsController } from './payroll-results.controller';
import { PayrollResultsService } from './payroll-results.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollResultsController],
  providers: [PayrollResultsService],
})
export class PayrollResultsModule {}
