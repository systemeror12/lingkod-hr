import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollExceptionsController } from './payroll-exceptions.controller';
import { PayrollExceptionsService } from './payroll-exceptions.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollExceptionsController],
  providers: [PayrollExceptionsService],
})
export class PayrollExceptionsModule {}
