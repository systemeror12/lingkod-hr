import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollMonetizationModule } from '../payroll-monetization/payroll-monetization.module';
import { PayrollInputsController } from './payroll-inputs.controller';
import { PayrollInputsService } from './payroll-inputs.service';

@Module({
  imports: [AuthModule, PayrollMonetizationModule],
  controllers: [PayrollInputsController],
  providers: [PayrollInputsService],
  exports: [PayrollInputsService],
})
export class PayrollInputsModule {}
