import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LegacyRegisterComparisonsController } from './legacy-register-comparisons.controller';
import { LegacyRegisterComparisonsService } from './legacy-register-comparisons.service';

@Module({
  imports: [AuthModule],
  controllers: [LegacyRegisterComparisonsController],
  providers: [LegacyRegisterComparisonsService],
})
export class LegacyRegisterComparisonsModule {}
