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
import { DocumentsServiceError } from '../documents/documents.service';
import {
  PlantillaPositionEvidenceAccessDto,
  PlantillaPositionEvidenceDto,
  PlantillaPositionEvidenceListResponseDto,
  PlantillaPositionEvidenceRemovalDto,
  PlantillaPositionDetailDto,
  PlantillaPositionDto,
  PlantillaPositionListResponseDto,
  PlantillaPositionSuccessorDto,
  PlantillaPositionVersionDto,
} from './plantilla-positions.dto';
import {
  plantillaPositionActivationSchema,
  plantillaPositionAsOfSchema,
  plantillaPositionCorrectionSchema,
  plantillaPositionCreateSchema,
  plantillaPositionDraftUpdateSchema,
  plantillaPositionEvidenceIdSchema,
  plantillaPositionEvidenceLinkSchema,
  plantillaPositionEvidenceRemovalSchema,
  plantillaPositionIdSchema,
  plantillaPositionIdempotencyKeySchema,
  plantillaPositionTransitionSchema,
  plantillaPositionVersionIdSchema,
} from './plantilla-positions.schemas';
import {
  PlantillaPositionServiceError,
  PlantillaPositionsService,
} from './plantilla-positions.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof PlantillaPositionServiceError || error instanceof DocumentsServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PlantillaPositionsController {
  constructor(
    @Inject(PlantillaPositionsService)
    private readonly service: PlantillaPositionsService,
  ) {}

  @Get(':agencyId/plantilla-positions')
  @RequirePermission('positions.items.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedAsOf = plantillaPositionAsOfSchema.safeParse(asOf);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      return new PlantillaPositionListResponseDto(
        await this.service.list(context, parsedAsOf.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/plantilla-positions/:positionId')
  @RequirePermission('positions.history.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = plantillaPositionIdSchema.safeParse(positionId);
    const parsedAsOf = plantillaPositionAsOfSchema.safeParse(asOf);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      const detail = await this.service.findById(context, parsedId.data, parsedAsOf.data);
      if (!detail) throw this.notFound(context);
      return new PlantillaPositionDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/plantilla-positions/:positionId/evidence')
  @RequirePermission('positions.items.read')
  async listEvidence(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionEvidenceListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    try {
      const evidence = await this.service.listEvidence(context, parsedPositionId.data);
      if (!evidence) throw this.notFound(context);
      return new PlantillaPositionEvidenceListResponseDto(evidence);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/evidence')
  @RequirePermission('positions.items.update')
  async linkEvidence(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionEvidenceDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    const parsed = plantillaPositionEvidenceLinkSchema.safeParse(body);
    if (!parsedPositionId.success) throw this.notFound(context);
    if (!parsed.success) {
      throw this.invalidInput(
        parsed.error.issues,
        context,
        'Enter an External Evidence Document, controlled purpose, and optional effective date.',
      );
    }
    try {
      return new PlantillaPositionEvidenceDto(
        await this.service.linkEvidence(context, parsedPositionId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Delete(':agencyId/plantilla-positions/:positionId/evidence/:evidenceId')
  @RequirePermission('positions.items.update')
  async removeEvidence(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionEvidenceRemovalDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    const parsedEvidenceId = plantillaPositionEvidenceIdSchema.safeParse(evidenceId);
    const parsed = plantillaPositionEvidenceRemovalSchema.safeParse(body);
    if (!parsedPositionId.success || !parsedEvidenceId.success) throw this.notFound(context);
    if (!parsed.success) {
      throw this.invalidInput(
        parsed.error.issues,
        context,
        'Enter a reason for removing this link.',
      );
    }
    try {
      await this.service.removeEvidence(
        context,
        parsedPositionId.data,
        parsedEvidenceId.data,
        parsed.data.reason,
      );
      return new PlantillaPositionEvidenceRemovalDto();
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/plantilla-positions/:positionId/evidence/:evidenceId/access')
  @RequirePermission('positions.items.read')
  async accessEvidence(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionEvidenceAccessDto> {
    this.assertReadAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    const parsedEvidenceId = plantillaPositionEvidenceIdSchema.safeParse(evidenceId);
    if (!parsedPositionId.success || !parsedEvidenceId.success) throw this.notFound(context);
    try {
      const evidence = await this.service.accessEvidence(
        context,
        parsedPositionId.data,
        parsedEvidenceId.data,
      );
      if (!evidence) throw this.notFound(context);
      return new PlantillaPositionEvidenceAccessDto(evidence);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions')
  @RequirePermission('positions.items.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = plantillaPositionCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PlantillaPositionDto(await this.service.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/successor')
  @RequirePermission('positions.items.update')
  async createSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionSuccessorDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new PlantillaPositionSuccessorDto(
        await this.service.createSuccessor(context, parsedId.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/plantilla-positions/:positionId/draft/:draftId')
  @RequirePermission('positions.items.update')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    const parsedDraftId = plantillaPositionVersionIdSchema.safeParse(draftId);
    const parsed = plantillaPositionDraftUpdateSchema.safeParse(body);
    if (!parsedPositionId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PlantillaPositionVersionDto(
        await this.service.updateDraft(
          context,
          parsedPositionId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/draft/:draftId/activate')
  @RequirePermission('positions.items.update')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    const parsedDraftId = plantillaPositionVersionIdSchema.safeParse(draftId);
    const parsed = plantillaPositionActivationSchema.safeParse(body);
    if (!parsedPositionId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PlantillaPositionDto(
        await this.service.activate(
          context,
          parsedPositionId.data,
          parsedDraftId.data,
          parsed.data.reason,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/versions/:versionId/correct')
  @RequirePermission('positions.items.update')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PlantillaPositionVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    const parsedVersionId = plantillaPositionVersionIdSchema.safeParse(versionId);
    const parsed = plantillaPositionCorrectionSchema.safeParse(body);
    if (!parsedPositionId.success || !parsedVersionId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new PlantillaPositionVersionDto(
        await this.service.correct(
          context,
          parsedPositionId.data,
          parsedVersionId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/authorize')
  @RequirePermission('positions.items.authorize')
  async authorize(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    const parsed = this.parseTransitionBody(body, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new PlantillaPositionDto(
        await this.service.authorize(context, parsedPositionId.data, parsed, parsedIdempotencyKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/declare-vacant')
  @RequirePermission('positions.items.declare_vacant')
  async declareVacant(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    const parsed = this.parseTransitionBody(body, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new PlantillaPositionDto(
        await this.service.declareVacant(
          context,
          parsedPositionId.data,
          parsed,
          parsedIdempotencyKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/freeze')
  @RequirePermission('positions.items.freeze')
  async freeze(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    const parsed = this.parseTransitionBody(body, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new PlantillaPositionDto(
        await this.service.freeze(context, parsedPositionId.data, parsed, parsedIdempotencyKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/unfreeze')
  @RequirePermission('positions.items.unfreeze')
  async unfreeze(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    const parsed = this.parseTransitionBody(body, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new PlantillaPositionDto(
        await this.service.unfreeze(context, parsedPositionId.data, parsed, parsedIdempotencyKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/cancel')
  @RequirePermission('positions.items.cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    const parsed = this.parseTransitionBody(body, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new PlantillaPositionDto(
        await this.service.cancel(context, parsedPositionId.data, parsed, parsedIdempotencyKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/plantilla-positions/:positionId/abolish')
  @RequirePermission('positions.items.abolish')
  async abolish(
    @Param('agencyId') agencyId: string,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PlantillaPositionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedPositionId = plantillaPositionIdSchema.safeParse(positionId);
    if (!parsedPositionId.success) throw this.notFound(context);
    const parsed = this.parseTransitionBody(body, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new PlantillaPositionDto(
        await this.service.abolish(context, parsedPositionId.data, parsed, parsedIdempotencyKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
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
            code: 'PLANTILLA_POSITION_WRITE_FORBIDDEN',
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
    message = 'Enter supported Plantilla Position values.',
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message,
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private parseTransitionBody(body: unknown, context: RequestContext) {
    const parsed = plantillaPositionTransitionSchema.safeParse(body);
    if (!parsed.success) {
      throw this.invalidInput(
        parsed.error.issues,
        context,
        'Enter an effective date and reason for the Plantilla Position transition.',
      );
    }
    return parsed.data;
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = plantillaPositionIdempotencyKeySchema.safeParse(value);
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

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'PLANTILLA_POSITION_NOT_FOUND',
          message: 'The Plantilla Position could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
