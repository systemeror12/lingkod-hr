import { Module } from '@nestjs/common';
import { CocExpiryScheduler } from './coc-expiry.scheduler';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [CocExpiryScheduler],
})
export class AppModule {}
