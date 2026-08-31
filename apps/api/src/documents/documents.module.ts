import { Module } from '@nestjs/common';
import { getConfig } from '@lingkod-hr/config';
import { AuthModule } from '../auth/auth.module';
import { DocumentsController } from './documents.controller';
import {
  DOCUMENT_AUDIT_WRITER,
  DOCUMENT_STORAGE,
  documentAuditWriter,
  DocumentsService,
} from './documents.service';
import { S3DocumentStorage } from './documents.storage';

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    { provide: DOCUMENT_AUDIT_WRITER, useValue: documentAuditWriter },
    { provide: DOCUMENT_STORAGE, useFactory: () => new S3DocumentStorage(getConfig()) },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
