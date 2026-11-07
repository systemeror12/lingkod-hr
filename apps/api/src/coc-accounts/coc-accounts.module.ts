import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { CocAccountsService } from './coc-accounts.service';
import { CocBalancesController } from './coc-balances.controller';
import { CocBalancesService } from './coc-balances.service';
import { CocLedgerCorrectionsController } from './coc-ledger-corrections.controller';
import { CocLedgerCorrectionsService } from './coc-ledger-corrections.service';

/**
 * The COC module. Overtime imports its application service to award COC (#538);
 * an authorized user reads a balance and corrects the ledger through its controllers.
 */
@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [CocBalancesController, CocLedgerCorrectionsController],
  providers: [CocAccountsService, CocBalancesService, CocLedgerCorrectionsService],
  exports: [CocAccountsService],
})
export class CocAccountsModule {}
