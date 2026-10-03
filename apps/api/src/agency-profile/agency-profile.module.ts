import { getConfig } from '@lingkod-hr/config';
import { S3DocumentStorage } from '../documents/documents.storage';
import { AgencySealController } from './agency-seal.controller';
import { AgencySealService, AGENCY_SEAL_STORAGE } from './agency-seal.service';
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
  controllers: [AgencyProfileController, AgencySealController],
  providers: [
    AgencyProfileService,
    AgencySealService,
    { provide: AGENCY_SEAL_STORAGE, useFactory: () => new S3DocumentStorage(getConfig()) },
    { provide: AGENCY_PROFILE_AUDIT_WRITER, useValue: agencyProfileAuditWriter },
  ],
  exports: [AgencyProfileService],
})
export class AgencyProfileModule {}
