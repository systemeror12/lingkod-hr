import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { SalnComplianceController } from './saln-compliance.controller';
import {
  SALN_COMPLIANCE_AUDIT_WRITER,
  salnComplianceAuditWriter,
  SalnComplianceService,
} from './saln-compliance.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [SalnComplianceController],
  providers: [
    SalnComplianceService,
    { provide: SALN_COMPLIANCE_AUDIT_WRITER, useValue: salnComplianceAuditWriter },
  ],
})
export class SalnComplianceModule {}
