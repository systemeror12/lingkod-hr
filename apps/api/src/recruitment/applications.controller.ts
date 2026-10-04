import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  applicationCreateSchema,
  applicationDocumentLinkSchema,
  applicationListSchema,
  applicationScreeningCorrectionSchema,
  applicationScreeningSchema,
  applicationWithdrawalSchema,
} from './applications.schemas';
import { ApplicationsService } from './applications.service';
import { RecruitmentServiceError } from './recruitment.service';

function translateApplicationError(error: unknown, requestId: string): never {
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
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly service: ApplicationsService) {}

  @Get(':agencyId/recruitment/applications')
  @RequirePermission('recruitment.applications.read')
  async listApplications(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = applicationListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      const page = await this.service.listApplications(context, parsed.data);
      return { applications: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Get(':agencyId/recruitment/applications/:applicationId')
  @RequirePermission('recruitment.applications.read')
  async findApplication(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    try {
      const result = await this.service.findApplication(context, id);
      if (!result) throw this.notFound(context, 'RECRUITMENT_APPLICATION_NOT_FOUND');
      return result;
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications')
  @RequirePermission('recruitment.applications.create')
  async createApplication(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = applicationCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.createApplication(context, parsed.data, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/documents')
  @RequirePermission('recruitment.applications.update')
  async linkDocument(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = applicationDocumentLinkSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.linkDocument(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Delete(':agencyId/recruitment/applications/:applicationId/documents/:applicationDocumentId')
  @RequirePermission('recruitment.applications.update')
  async unlinkDocument(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('applicationDocumentId') applicationDocumentId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const documentId = this.parseId(applicationDocumentId, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.unlinkDocument(context, id, documentId, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/screen')
  @RequirePermission('recruitment.applications.screen')
  async screenApplication(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = applicationScreeningSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.screenApplication(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/screenings/:screeningId/correct')
  @RequirePermission('recruitment.applications.screen')
  async correctScreening(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Param('screeningId') screeningId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const screening = this.parseId(screeningId, context);
    const parsed = applicationScreeningCorrectionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.correctScreening(context, id, screening, parsed.data, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/reopen')
  @RequirePermission('recruitment.applications.update')
  async reopenApplication(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = recruitmentReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.reopenApplication(context, id, parsed.data.reason, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/withdraw')
  @RequirePermission('recruitment.applications.withdraw')
  async withdrawApplication(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = applicationWithdrawalSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.withdrawApplication(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
    }
  }

  @Post(':agencyId/recruitment/applications/:applicationId/close')
  @RequirePermission('recruitment.applications.close')
  async closeApplication(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = recruitmentReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.closeApplication(context, id, parsed.data.reason, key);
    } catch (error: unknown) {
      translateApplicationError(error, context.requestId);
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
