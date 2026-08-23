import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
  plantillaPositionIdSchema,
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
  if (error instanceof PlantillaPositionServiceError) {
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
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Plantilla Position values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
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
