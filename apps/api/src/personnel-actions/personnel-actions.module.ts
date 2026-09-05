import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PersonnelActionsController } from './personnel-actions.controller';
import {
  personnelActionAuditWriter,
  PERSONNEL_ACTION_AUDIT_WRITER,
  PersonnelActionsService,
} from './personnel-actions.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PersonnelActionsController],
  providers: [
    PersonnelActionsService,
    { provide: PERSONNEL_ACTION_AUDIT_WRITER, useValue: personnelActionAuditWriter },
  ],
  exports: [PersonnelActionsService],
})
export class PersonnelActionsModule {}
