import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsModule } from '../plantilla-positions/plantilla-positions.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

@Module({
  imports: [AuthModule, ApprovalModule, DocumentsModule, PlantillaPositionsModule],
  controllers: [RecruitmentController, ApplicationsController, EvaluationsController],
  providers: [RecruitmentService, ApplicationsService, EvaluationsService],
  exports: [RecruitmentService, ApplicationsService, EvaluationsService],
})
export class RecruitmentModule {}
