import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { recruitmentIdSchema, recruitmentIdempotencyKeySchema } from './recruitment.schemas';
import {
  assessmentResultCorrectionSchema,
  assessmentResultSchema,
  assessmentScheduleSchema,
  interviewFeedbackCorrectionSchema,
  interviewFeedbackSchema,
  interviewScheduleSchema,
  stageCancellationSchema,
  stageNoShowSchema,
} from './evaluations.schemas';
import { EvaluationsService } from './evaluations.service';
import { RecruitmentServiceError } from './recruitment.service';

function translateEvaluationError(error: unknown, requestId: string): never {
  if (error instanceof RecruitmentServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class EvaluationsController {
  constructor(@Inject(EvaluationsService) private readonly service: EvaluationsService) {}

  @Post(':agencyId/recruitment/applications/:applicationId/assessments')
  @RequirePermission('recruitment.assessments.manage')
  async scheduleAssessment(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = assessmentScheduleSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.scheduleAssessment(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/assessments/:assessmentId/complete')
  @RequirePermission('recruitment.assessments.manage')
  async completeAssessment(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('assessmentId') assessmentId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const assessment = this.parseId(assessmentId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.completeAssessment(context, id, assessment, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/assessments/:assessmentId/cancel')
  @RequirePermission('recruitment.assessments.manage')
  async cancelAssessment(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('assessmentId') assessmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const assessment = this.parseId(assessmentId, context);
    const parsed = stageCancellationSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancelAssessment(context, id, assessment, parsed.data.reason, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/assessments/:assessmentId/no-show')
  @RequirePermission('recruitment.assessments.manage')
  async recordAssessmentNoShow(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('assessmentId') assessmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const assessment = this.parseId(assessmentId, context);
    const parsed = stageNoShowSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordAssessmentNoShow(
        context,
        id,
        assessment,
        parsed.data.reason,
        key,
      );
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/assessments/:assessmentId/results')
  @RequirePermission('recruitment.assessments.manage')
  async recordAssessmentResult(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('assessmentId') assessmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const assessment = this.parseId(assessmentId, context);
    const parsed = assessmentResultSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordAssessmentResult(context, id, assessment, parsed.data, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(
    ':agencyId/recruitment/applications/:applicationId/assessments/:assessmentId/results/:resultId/correct',
  )
  @RequirePermission('recruitment.assessments.manage')
  async correctAssessmentResult(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('assessmentId') assessmentId: string,
    @Param('resultId') resultId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const assessment = this.parseId(assessmentId, context);
    const result = this.parseId(resultId, context);
    const parsed = assessmentResultCorrectionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.correctAssessmentResult(
        context,
        id,
        assessment,
        result,
        parsed.data,
        key,
      );
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/interviews')
  @RequirePermission('recruitment.interviews.manage')
  async scheduleInterview(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = interviewScheduleSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.scheduleInterview(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/interviews/:interviewId/complete')
  @RequirePermission('recruitment.interviews.manage')
  async completeInterview(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('interviewId') interviewId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const interview = this.parseId(interviewId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.completeInterview(context, id, interview, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/interviews/:interviewId/cancel')
  @RequirePermission('recruitment.interviews.manage')
  async cancelInterview(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('interviewId') interviewId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const interview = this.parseId(interviewId, context);
    const parsed = stageCancellationSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancelInterview(context, id, interview, parsed.data.reason, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/interviews/:interviewId/no-show')
  @RequirePermission('recruitment.interviews.manage')
  async recordInterviewNoShow(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('interviewId') interviewId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const interview = this.parseId(interviewId, context);
    const parsed = stageNoShowSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordInterviewNoShow(
        context,
        id,
        interview,
        parsed.data.reason,
        key,
      );
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/interviews/:interviewId/feedback')
  @RequirePermission('recruitment.interviews.manage')
  async recordInterviewFeedback(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('interviewId') interviewId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const interview = this.parseId(interviewId, context);
    const parsed = interviewFeedbackSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordInterviewFeedback(context, id, interview, parsed.data, key);
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  @Post(
    ':agencyId/recruitment/applications/:applicationId/interviews/:interviewId/feedback/:feedbackId/correct',
  )
  @RequirePermission('recruitment.interviews.manage')
  async correctInterviewFeedback(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('interviewId') interviewId: string,
    @Param('feedbackId') feedbackId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const interview = this.parseId(interviewId, context);
    const feedback = this.parseId(feedbackId, context);
    const parsed = interviewFeedbackCorrectionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.correctInterviewFeedback(
        context,
        id,
        interview,
        feedback,
        parsed.data,
        key,
      );
    } catch (error: unknown) {
      translateEvaluationError(error, context.requestId);
    }
  }

  private parseId(value: string, context: RequestContext): string {
    const parsed = recruitmentIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context, 'RECRUITMENT_NOT_FOUND');
    return parsed.data;
  }

  private parseIdempotencyKey(
    value: string | undefined,
    context: RequestContext,
  ): string | undefined {
    if (value === undefined) return undefined;
    const parsed = recruitmentIdempotencyKeySchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException({
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Enter a valid Idempotency-Key.',
          requestId: context.requestId,
        },
      });
    return parsed.data;
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId)
      throw new HttpException(
        {
          error: {
            code: 'RECRUITMENT_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    const fields: Record<string, string> = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
    }
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Recruitment values.',
        fields,
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext, code: string): HttpException {
    return new HttpException(
      {
        error: {
          code,
          message: 'The Recruitment record could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
