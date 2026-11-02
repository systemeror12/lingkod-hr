import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { CocAccountsService } from './coc-accounts.service';
import { CocLedgerCorrectionsController } from './coc-ledger-corrections.controller';
import { CocLedgerCorrectionsService } from './coc-ledger-corrections.service';

/**
 * The COC module. Overtime imports its application service to award COC (#538);
 * an authorized user corrects the ledger through its controller.
 */
@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [CocLedgerCorrectionsController],
  providers: [CocAccountsService, CocLedgerCorrectionsService],
  exports: [CocAccountsService],
})
export class CocAccountsModule {}
