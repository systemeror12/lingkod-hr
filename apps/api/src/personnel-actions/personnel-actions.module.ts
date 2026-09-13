import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsModule } from '../plantilla-positions/plantilla-positions.module';
import { SeparationsModule } from '../separations/separations.module';
import { PersonnelActionsController } from './personnel-actions.controller';
import {
  personnelActionAuditWriter,
  PERSONNEL_ACTION_AUDIT_WRITER,
  PersonnelActionsService,
} from './personnel-actions.service';

@Module({
  imports: [
    AppointmentsModule,
    AuthModule,
    DocumentsModule,
    PlantillaPositionsModule,
    SeparationsModule,
  ],
  controllers: [PersonnelActionsController],
  providers: [
    PersonnelActionsService,
    { provide: PERSONNEL_ACTION_AUDIT_WRITER, useValue: personnelActionAuditWriter },
  ],
  exports: [PersonnelActionsService],
})
export class PersonnelActionsModule {}
