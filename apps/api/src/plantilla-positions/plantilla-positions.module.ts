import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsController } from './plantilla-positions.controller';
import {
  PLANTILLA_POSITION_AUDIT_WRITER,
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from './plantilla-positions.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [PlantillaPositionsController],
  providers: [
    PlantillaPositionsService,
    { provide: PLANTILLA_POSITION_AUDIT_WRITER, useValue: plantillaPositionAuditWriter },
  ],
  exports: [PlantillaPositionsService],
})
export class PlantillaPositionsModule {}
