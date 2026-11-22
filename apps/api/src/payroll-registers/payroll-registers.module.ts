import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PayrollRegistersController } from './payroll-registers.controller';
import { PayrollRegistersService } from './payroll-registers.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PayrollRegistersController],
  providers: [PayrollRegistersService],
})
export class PayrollRegistersModule {}
