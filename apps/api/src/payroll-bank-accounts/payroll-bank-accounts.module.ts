import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PayrollBankAccountsController } from './payroll-bank-accounts.controller';
import {
  PAYROLL_BANK_ACCOUNT_AUDIT_WRITER,
  payrollBankAccountAuditWriter,
  PayrollBankAccountsService,
} from './payroll-bank-accounts.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PayrollBankAccountsController],
  providers: [
    PayrollBankAccountsService,
    { provide: PAYROLL_BANK_ACCOUNT_AUDIT_WRITER, useValue: payrollBankAccountAuditWriter },
  ],
})
export class PayrollBankAccountsModule {}
