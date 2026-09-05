import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { ServiceRecordsController } from './service-records.controller';
import {
  serviceRecordAuditWriter,
  SERVICE_RECORD_AUDIT_WRITER,
  ServiceRecordsService,
} from './service-records.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [ServiceRecordsController],
  providers: [
    ServiceRecordsService,
    { provide: SERVICE_RECORD_AUDIT_WRITER, useValue: serviceRecordAuditWriter },
  ],
  exports: [ServiceRecordsService],
})
export class ServiceRecordsModule {}
