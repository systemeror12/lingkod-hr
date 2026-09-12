import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  recruitmentIdSchema,
  recruitmentIdempotencyKeySchema,
  recruitmentReasonSchema,
} from './recruitment.schemas';
import {
  boardParticipationSchema,
  boardRecommendationSchema,
  candidateEvaluationReportSchema,
  conflictDeclarationSchema,
  sessionCommandSchema,
  sessionCompletionSchema,
  sessionCreateSchema,
  sessionListSchema,
} from './deliberations.schemas';
import { DeliberationsService } from './deliberations.service';
import { RecruitmentServiceError } from './recruitment.service';

function translateDeliberationError(error: unknown, requestId: string): never {
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
export class DeliberationsController {
  constructor(@Inject(DeliberationsService) private readonly service: DeliberationsService) {}

  @Get(':agencyId/recruitment/sessions')
  @RequirePermission('recruitment.deliberations.read')
  async listSessions(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = sessionListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      const page = await this.service.listSessions(context, parsed.data);
      return { sessions: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Get(':agencyId/recruitment/sessions/:sessionId')
  @RequirePermission('recruitment.deliberations.read')
  async findSession(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    try {
      const result = await this.service.findSession(context, id);
      if (!result) throw this.notFound(context, 'RECRUITMENT_NOT_FOUND');
      return result;
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions')
  @RequirePermission('recruitment.deliberations.submit')
  async createSession(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = sessionCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.createSession(context, parsed.data, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/participation')
  @RequirePermission('recruitment.deliberations.submit')
  async recordParticipation(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = boardParticipationSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordParticipation(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/conflicts')
  @RequirePermission('recruitment.deliberations.recommend')
  async declareConflict(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = conflictDeclarationSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.declareConflict(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/start')
  @RequirePermission('recruitment.deliberations.submit')
  async startSession(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = sessionCommandSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.startSession(context, id, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/recommendations')
  @RequirePermission('recruitment.deliberations.recommend')
  async recordRecommendation(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = boardRecommendationSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordRecommendation(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/reports')
  @RequirePermission('recruitment.deliberations.submit')
  async issueReport(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = candidateEvaluationReportSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.issueReport(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/complete')
  @RequirePermission('recruitment.deliberations.submit')
  async completeSession(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = sessionCompletionSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.completeSession(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/sessions/:sessionId/cancel')
  @RequirePermission('recruitment.deliberations.submit')
  async cancelSession(
    @Param('agencyId') agencyId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(sessionId, context);
    const parsed = recruitmentReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancelSession(context, id, parsed.data.reason, key);
    } catch (error: unknown) {
      translateDeliberationError(error, context.requestId);
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

  private assertReadAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId)
      throw this.notFound(context, 'RECRUITMENT_NOT_FOUND');
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
