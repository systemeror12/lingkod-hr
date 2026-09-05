import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeeDocumentsController } from './employee-documents.controller';
import {
  EMPLOYEE_DOCUMENT_AUDIT_WRITER,
  employeeDocumentAuditWriter,
  EmployeeDocumentsService,
} from './employee-documents.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [EmployeeDocumentsController],
  providers: [
    EmployeeDocumentsService,
    { provide: EMPLOYEE_DOCUMENT_AUDIT_WRITER, useValue: employeeDocumentAuditWriter },
  ],
  exports: [EmployeeDocumentsService],
})
export class EmployeeDocumentsModule {}
