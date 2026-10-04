import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { AttendanceContextsController } from './attendance-contexts.controller';
import {
  ATTENDANCE_CONTEXT_AUDIT_WRITER,
  attendanceContextAuditWriter,
} from './attendance-contexts.audit';
import { AttendanceContextsService } from './attendance-contexts.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AttendanceContextsController],
  providers: [
    AttendanceContextsService,
    { provide: ATTENDANCE_CONTEXT_AUDIT_WRITER, useValue: attendanceContextAuditWriter },
  ],
  exports: [AttendanceContextsService],
})
export class AttendanceContextsModule {}
