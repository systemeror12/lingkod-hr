import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { DTR_AUDIT_WRITER, dtrAuditWriter } from './dtrs.audit';
import { DtrsController } from './dtrs.controller';
import { DtrsService } from './dtrs.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [DtrsController],
  providers: [DtrsService, { provide: DTR_AUDIT_WRITER, useValue: dtrAuditWriter }],
  exports: [DtrsService],
})
export class DtrsModule {}
