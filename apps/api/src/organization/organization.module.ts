import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationController } from './organization.controller';
import {
  ORGANIZATION_AUDIT_WRITER,
  OrganizationService,
  organizationAuditWriter,
} from './organization.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    { provide: ORGANIZATION_AUDIT_WRITER, useValue: organizationAuditWriter },
  ],
})
export class OrganizationModule {}
