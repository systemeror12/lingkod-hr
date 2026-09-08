import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approvals/approval.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlantillaPositionsModule } from '../plantilla-positions/plantilla-positions.module';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

@Module({
  imports: [AuthModule, ApprovalModule, DocumentsModule, PlantillaPositionsModule],
  controllers: [RecruitmentController],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
