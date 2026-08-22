import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { StaffingAuthoritiesController } from './staffing-authorities.controller';
import {
  STAFFING_AUTHORITY_AUDIT_WRITER,
  staffingAuthorityAuditWriter,
  StaffingAuthorityService,
} from './staffing-authorities.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [StaffingAuthoritiesController],
  providers: [
    StaffingAuthorityService,
    { provide: STAFFING_AUTHORITY_AUDIT_WRITER, useValue: staffingAuthorityAuditWriter },
  ],
  exports: [StaffingAuthorityService],
})
export class StaffingAuthoritiesModule {}
