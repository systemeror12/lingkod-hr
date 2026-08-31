import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { QualificationStandardsController } from './qualification-standards.controller';
import {
  QUALIFICATION_STANDARD_AUDIT_WRITER,
  qualificationStandardAuditWriter,
  QualificationStandardsService,
} from './qualification-standards.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [QualificationStandardsController],
  providers: [
    QualificationStandardsService,
    { provide: QUALIFICATION_STANDARD_AUDIT_WRITER, useValue: qualificationStandardAuditWriter },
  ],
  exports: [QualificationStandardsService],
})
export class QualificationStandardsModule {}
