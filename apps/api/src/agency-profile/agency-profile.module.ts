import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgencyProfileController } from './agency-profile.controller';
import {
  AGENCY_PROFILE_AUDIT_WRITER,
  agencyProfileAuditWriter,
  AgencyProfileService,
} from './agency-profile.service';

@Module({
  imports: [AuthModule],
  controllers: [AgencyProfileController],
  providers: [
    AgencyProfileService,
    { provide: AGENCY_PROFILE_AUDIT_WRITER, useValue: agencyProfileAuditWriter },
  ],
  exports: [AgencyProfileService],
})
export class AgencyProfileModule {}
