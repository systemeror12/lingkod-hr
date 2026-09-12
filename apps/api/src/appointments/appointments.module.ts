import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsModule } from '../plantilla-positions/plantilla-positions.module';
import { QualificationStandardsModule } from '../qualification-standards/qualification-standards.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [
    AuthModule,
    DocumentsModule,
    PlantillaPositionsModule,
    QualificationStandardsModule,
    RecruitmentModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
