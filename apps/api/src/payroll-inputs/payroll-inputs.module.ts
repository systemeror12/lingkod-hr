import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollInputsController } from './payroll-inputs.controller';
import { PayrollInputsService } from './payroll-inputs.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollInputsController],
  providers: [PayrollInputsService],
  exports: [PayrollInputsService],
})
export class PayrollInputsModule {}
