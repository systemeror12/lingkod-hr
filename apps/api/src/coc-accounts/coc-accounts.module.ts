import { Module } from '@nestjs/common';
import { CocAccountsService } from './coc-accounts.service';

/** The COC module's application service. Overtime imports it to award COC (#538). */
@Module({
  providers: [CocAccountsService],
  exports: [CocAccountsService],
})
export class CocAccountsModule {}
