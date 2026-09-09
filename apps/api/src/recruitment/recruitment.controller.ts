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
  requestToFillRebaselineSchema,
  requestToFillCreateSchema,
  requestToFillListSchema,
  recruitmentDecisionSchema,
  vacancyPublicationCancelSchema,
  vacancyPublicationCloseSchema,
  vacancyPublicationCreateSchema,
  vacancyPublicationCorrectionSchema,
  vacancyPublicationListSchema,
  vacancyPublicationRepublishSchema,
} from './recruitment.schemas';
import { RecruitmentService, RecruitmentServiceError } from './recruitment.service';

function translateRecruitmentError(error: unknown, requestId: string): never {
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
export class RecruitmentController {
  constructor(@Inject(RecruitmentService) private readonly service: RecruitmentService) {}

  @Get(':agencyId/recruitment/requests-to-fill')
  @RequirePermission('recruitment.requests.read')
  async listRequests(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = requestToFillListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      const page = await this.service.listRequests(context, parsed.data);
      return { requests: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Get(':agencyId/recruitment/requests-to-fill/:requestId')
  @RequirePermission('recruitment.requests.read')
  async findRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    try {
      const result = await this.service.findRequest(context, id);
      if (!result) throw this.notFound(context, 'RECRUITMENT_REQUEST_NOT_FOUND');
      return result;
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill')
  @RequirePermission('recruitment.requests.create')
  async createRequest(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = requestToFillCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.createRequest(context, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/submit')
  @RequirePermission('recruitment.requests.submit')
  async submitRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.submitRequest(context, id, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/review')
  @RequirePermission('recruitment.requests.review')
  async reviewRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.reviewRequest(context, id, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/approve')
  @RequirePermission('recruitment.requests.approve')
  async approveRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const parsed = recruitmentDecisionSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.approveRequest(context, id, parsed.data.comments, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/rebaseline')
  @RequirePermission('recruitment.requests.rebaseline')
  async rebaselineRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const parsed = requestToFillRebaselineSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.rebaselineRequest(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/return')
  @RequirePermission('recruitment.requests.review')
  async returnRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const parsed = recruitmentDecisionSchema.safeParse(body ?? {});
    if (!parsed.success || !parsed.data.comments)
      throw this.invalidInput(parsed.success ? [] : parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.returnRequest(context, id, parsed.data.comments, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/reject')
  @RequirePermission('recruitment.requests.reject')
  async rejectRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const parsed = recruitmentDecisionSchema.safeParse(body ?? {});
    if (!parsed.success || !parsed.data.comments)
      throw this.invalidInput(parsed.success ? [] : parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.rejectRequest(context, id, parsed.data.comments, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/cancel')
  @RequirePermission('recruitment.requests.cancel')
  async cancelRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const parsed = recruitmentReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancelRequest(context, id, parsed.data.reason, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/requests-to-fill/:requestId/close')
  @RequirePermission('recruitment.requests.close')
  async closeRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(requestId, context);
    const parsed = recruitmentReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.closeRequest(context, id, parsed.data.reason, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Get(':agencyId/recruitment/vacancy-publications')
  @RequirePermission('recruitment.vacancies.read')
  async listPublications(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = vacancyPublicationListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      const page = await this.service.listPublications(context, parsed.data);
      return { publications: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Get(':agencyId/recruitment/vacancy-publications/:publicationId')
  @RequirePermission('recruitment.vacancies.read')
  async findPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    try {
      const result = await this.service.findPublication(context, id);
      if (!result) throw this.notFound(context, 'RECRUITMENT_PUBLICATION_NOT_FOUND');
      return result;
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications')
  @RequirePermission('recruitment.vacancies.create')
  async createPublication(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = vacancyPublicationCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.createPublication(context, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/submit')
  @RequirePermission('recruitment.vacancies.submit')
  async submitPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.submitPublication(context, id, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/publish')
  @RequirePermission('recruitment.vacancies.publish')
  async publishPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const parsed = recruitmentDecisionSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.publishPublication(context, id, parsed.data.comments, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/return')
  @RequirePermission('recruitment.vacancies.return')
  async returnPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const parsed = recruitmentDecisionSchema.safeParse(body ?? {});
    if (!parsed.success || !parsed.data.comments)
      throw this.invalidInput(parsed.success ? [] : parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.returnPublication(context, id, parsed.data.comments, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/close')
  @RequirePermission('recruitment.vacancies.close')
  async closePublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const parsed = vacancyPublicationCloseSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.closePublication(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/cancel')
  @RequirePermission('recruitment.vacancies.cancel')
  async cancelPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const parsed = vacancyPublicationCancelSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancelPublication(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/republish')
  @RequirePermission('recruitment.vacancies.republish')
  async republishPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const parsed = vacancyPublicationRepublishSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.republishPublication(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/vacancy-publications/:publicationId/correct')
  @RequirePermission('recruitment.vacancies.create')
  async correctPublication(
    @Param('agencyId') agencyId: string,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(publicationId, context);
    const parsed = vacancyPublicationCorrectionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.correctPublication(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateRecruitmentError(error, context.requestId);
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
