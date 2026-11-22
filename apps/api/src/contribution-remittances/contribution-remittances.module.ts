import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContributionRemittancesController } from './contribution-remittances.controller';
import { ContributionRemittancesService } from './contribution-remittances.service';

@Module({
  imports: [AuthModule],
  controllers: [ContributionRemittancesController],
  providers: [ContributionRemittancesService],
})
export class ContributionRemittancesModule {}
