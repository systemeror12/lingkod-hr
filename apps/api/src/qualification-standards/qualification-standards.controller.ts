import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
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
  QualificationStandardDetailDto,
  QualificationStandardDto,
  QualificationStandardListResponseDto,
  QualificationStandardSuccessorDto,
  QualificationStandardVersionDto,
} from './qualification-standards.dto';
import {
  qualificationStandardActivationSchema,
  qualificationStandardAsOfSchema,
  qualificationStandardCorrectionSchema,
  qualificationStandardCreateSchema,
  qualificationStandardDraftUpdateSchema,
  qualificationStandardEvidenceSchema,
  qualificationStandardIdSchema,
  qualificationStandardIdempotencyKeySchema,
  qualificationStandardVersionIdSchema,
} from './qualification-standards.schemas';
import {
  QualificationStandardServiceError,
  QualificationStandardsService,
} from './qualification-standards.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof QualificationStandardServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class QualificationStandardsController {
  constructor(
    @Inject(QualificationStandardsService)
    private readonly service: QualificationStandardsService,
  ) {}

  @Get(':agencyId/qualification-standards')
  @RequirePermission('qualification.standards.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new QualificationStandardListResponseDto(await this.service.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/qualification-standards/:standardId')
  @RequirePermission('qualification.standards.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = qualificationStandardIdSchema.safeParse(standardId);
    const parsedAsOf = qualificationStandardAsOfSchema.safeParse(asOf);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      const detail = await this.service.findById(context, parsedId.data, parsedAsOf.data);
      if (!detail) throw this.notFound(context);
      return new QualificationStandardDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/qualification-standards')
  @RequirePermission('qualification.standards.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = qualificationStandardCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new QualificationStandardDto(await this.service.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/qualification-standards/:standardId/successor')
  @RequirePermission('qualification.standards.update')
  async createSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardSuccessorDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = qualificationStandardIdSchema.safeParse(standardId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new QualificationStandardSuccessorDto(
        await this.service.createSuccessor(context, parsedId.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/qualification-standards/:standardId/draft/:draftId')
  @RequirePermission('qualification.standards.update')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedStandardId = qualificationStandardIdSchema.safeParse(standardId);
    const parsedDraftId = qualificationStandardVersionIdSchema.safeParse(draftId);
    const parsed = qualificationStandardDraftUpdateSchema.safeParse(body);
    if (!parsedStandardId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new QualificationStandardVersionDto(
        await this.service.updateDraft(
          context,
          parsedStandardId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/qualification-standards/:standardId/draft/:draftId/evidence')
  @RequirePermission('qualification.standards.evidence.validate')
  async linkEvidence(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardVersionDto> {
    return this.linkEvidenceForDraft(agencyId, standardId, draftId, body, context);
  }

  @Post(':agencyId/qualification-standards/:standardId/versions/:versionId/evidence')
  @RequirePermission('qualification.standards.evidence.validate')
  async linkEvidenceToVersion(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardVersionDto> {
    return this.linkEvidenceForDraft(agencyId, standardId, versionId, body, context);
  }

  @Post(':agencyId/qualification-standards/:standardId/draft/:draftId/activate')
  @RequirePermission('qualification.standards.activate')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedStandardId = qualificationStandardIdSchema.safeParse(standardId);
    const parsedDraftId = qualificationStandardVersionIdSchema.safeParse(draftId);
    const parsed = qualificationStandardActivationSchema.safeParse(body);
    if (!parsedStandardId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new QualificationStandardDto(
        await this.service.activate(
          context,
          parsedStandardId.data,
          parsedDraftId.data,
          parsed.data.reason,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/qualification-standards/:standardId/versions/:versionId/correct')
  @RequirePermission('qualification.standards.update')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('standardId') standardId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<QualificationStandardVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedStandardId = qualificationStandardIdSchema.safeParse(standardId);
    const parsedVersionId = qualificationStandardVersionIdSchema.safeParse(versionId);
    const parsed = qualificationStandardCorrectionSchema.safeParse(body);
    if (!parsedStandardId.success || !parsedVersionId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new QualificationStandardVersionDto(
        await this.service.correct(
          context,
          parsedStandardId.data,
          parsedVersionId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private async linkEvidenceForDraft(
    agencyId: string,
    standardId: string,
    draftId: string,
    body: unknown,
    context: RequestContext,
  ): Promise<QualificationStandardVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedStandardId = qualificationStandardIdSchema.safeParse(standardId);
    const parsedDraftId = qualificationStandardVersionIdSchema.safeParse(draftId);
    const parsed = qualificationStandardEvidenceSchema.safeParse(body);
    if (!parsedStandardId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new QualificationStandardVersionDto(
        await this.service.linkEvidence(
          context,
          parsedStandardId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = qualificationStandardIdempotencyKeySchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Enter a valid Idempotency-Key.',
          requestId,
        },
      });
    }
    return parsed.data;
  }

  private assertReadAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) throw this.notFound(context);
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'QUALIFICATION_STANDARD_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Qualification Standard values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'QUALIFICATION_STANDARD_NOT_FOUND',
          message: 'The Qualification Standard could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
