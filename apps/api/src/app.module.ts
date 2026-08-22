import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AgencyProfileModule } from './agency-profile/agency-profile.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { OrganizationModule } from './organization/organization.module';
import { DocumentsModule } from './documents/documents.module';
import { StaffingAuthoritiesModule } from './staffing-authorities/staffing-authorities.module';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    AgencyProfileModule,
    OrganizationModule,
    DocumentsModule,
    StaffingAuthoritiesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
