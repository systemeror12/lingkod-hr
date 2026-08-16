import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { OrganizationModule } from './organization/organization.module';

@Module({
  imports: [AuthModule, AuditModule, OrganizationModule],
  controllers: [HealthController],
})
export class AppModule {}
