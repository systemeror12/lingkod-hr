import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsModule } from '../plantilla-positions/plantilla-positions.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { DeliberationsController } from './deliberations.controller';
import { DeliberationsService } from './deliberations.service';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

@Module({
  imports: [AuthModule, ApprovalModule, DocumentsModule, PlantillaPositionsModule],
  controllers: [
    RecruitmentController,
    ApplicationsController,
    EvaluationsController,
    DeliberationsController,
    SelectionController,
  ],
  providers: [
    RecruitmentService,
    ApplicationsService,
    EvaluationsService,
    DeliberationsService,
    SelectionService,
  ],
  exports: [
    RecruitmentService,
    ApplicationsService,
    EvaluationsService,
    DeliberationsService,
    SelectionService,
  ],
})
export class RecruitmentModule {}
