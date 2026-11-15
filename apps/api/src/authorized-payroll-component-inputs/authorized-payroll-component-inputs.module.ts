import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { ApproveAuthorizedPayrollComponentInputService } from './approve-authorized-payroll-component-input.service';
import { AuthorizedPayrollComponentInputsController } from './authorized-payroll-component-inputs.controller';
import { RecordAuthorizedPayrollComponentInputService } from './record-authorized-payroll-component-input.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AuthorizedPayrollComponentInputsController],
  providers: [
    RecordAuthorizedPayrollComponentInputService,
    ApproveAuthorizedPayrollComponentInputService,
  ],
})
export class AuthorizedPayrollComponentInputsModule {}
