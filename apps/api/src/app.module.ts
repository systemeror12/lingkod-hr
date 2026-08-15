import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { OrganizationModule } from './organization/organization.module';

@Module({
  imports: [AuthModule, OrganizationModule],
  controllers: [HealthController],
})
export class AppModule {}
