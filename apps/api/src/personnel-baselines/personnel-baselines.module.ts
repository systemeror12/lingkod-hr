import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsModule } from '../plantilla-positions/plantilla-positions.module';
import { PersonnelBaselinesController } from './personnel-baselines.controller';
import {
  personnelBaselineAuditWriter,
  PERSONNEL_BASELINE_AUDIT_WRITER,
  PersonnelBaselinesService,
} from './personnel-baselines.service';

@Module({
  imports: [AuthModule, DocumentsModule, PlantillaPositionsModule],
  controllers: [PersonnelBaselinesController],
  providers: [
    PersonnelBaselinesService,
    { provide: PERSONNEL_BASELINE_AUDIT_WRITER, useValue: personnelBaselineAuditWriter },
  ],
  exports: [PersonnelBaselinesService],
})
export class PersonnelBaselinesModule {}
