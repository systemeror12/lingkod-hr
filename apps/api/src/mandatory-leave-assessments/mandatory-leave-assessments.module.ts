import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MandatoryLeaveAssessmentsController } from './mandatory-leave-assessments.controller';
import {
  MANDATORY_LEAVE_ASSESSMENT_AUDIT_WRITER,
  MandatoryLeaveAssessmentsService,
  mandatoryLeaveAssessmentAuditWriter,
} from './mandatory-leave-assessments.service';

@Module({
  imports: [AuthModule],
  controllers: [MandatoryLeaveAssessmentsController],
  providers: [
    MandatoryLeaveAssessmentsService,
    {
      provide: MANDATORY_LEAVE_ASSESSMENT_AUDIT_WRITER,
      useValue: mandatoryLeaveAssessmentAuditWriter,
    },
  ],
  exports: [MandatoryLeaveAssessmentsService],
})
export class MandatoryLeaveAssessmentsModule {}
