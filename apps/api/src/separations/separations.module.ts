import { Module } from '@nestjs/common';
import {
  SEPARATION_AUDIT_WRITER,
  separationAuditWriter,
  SeparationsService,
} from './separations.service';

@Module({
  providers: [
    SeparationsService,
    { provide: SEPARATION_AUDIT_WRITER, useValue: separationAuditWriter },
  ],
  exports: [SeparationsService],
})
export class SeparationsModule {}
