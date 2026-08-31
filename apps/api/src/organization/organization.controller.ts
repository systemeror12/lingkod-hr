import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Patch,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import type { RequestContext } from '@lingkod-hr/auth';
import { agencyIdSchema } from '../auth/auth.schemas';
import {
  OrganizationHierarchyResponseDto,
  OrganizationUnitHistoryDto,
  OrganizationUnitDto,
  OrganizationUnitListResponseDto,
  OrganizationUnitSuccessorDto,
  OrganizationUnitVersionDto,
} from './organization.dto';
import {
  organizationIdempotencyKeySchema,
  organizationHierarchyQuerySchema,
  organizationHistoryQuerySchema,
  organizationUnitActivationSchema,
  organizationUnitCorrectionSchema,
  organizationUnitCreateSchema,
  organizationUnitDraftUpdateSchema,
  organizationUnitIdSchema,
  organizationUnitSuccessorActivationSchema,
  organizationUnitTransitionSchema,
} from './organization.schemas';
import { OrganizationService, OrganizationServiceError } from './organization.service';

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof OrganizationServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class OrganizationController {
  constructor(
    @Inject(OrganizationService) private readonly organizationService: OrganizationService,
  ) {}

  @Get(':agencyId/organization-units')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new OrganizationUnitListResponseDto(await this.organizationService.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/organization-units/hierarchy')
  async hierarchy(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationHierarchyResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsed = organizationHierarchyQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Choose a valid hierarchy date.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new OrganizationHierarchyResponseDto(
        await this.organizationService.hierarchy(
          context,
          parsed.data.asOf,
          parsed.data.parentForUnitId,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/organization-units/:unitId/history')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitHistoryDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    const parsed = organizationHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Choose a valid history date.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new OrganizationUnitHistoryDto(
        await this.organizationService.history(context, parsedUnitId.data, parsed.data.asOf),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/organization-units/:unitId')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    try {
      const unit = await this.organizationService.findById(context, parsedUnitId.data);
      if (!unit) throw this.notFound(context);
      return new OrganizationUnitDto(unit);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units')
  @RequirePermission('organization.units.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitDto> {
    this.assertCreateAgency(agencyId, context);
    const parsed = organizationUnitCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message:
            'Enter an official name, a unique code, a supported unit type, and an effective date.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new OrganizationUnitDto(await this.organizationService.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/successor')
  @RequirePermission('organization.units.update')
  async createSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitSuccessorDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    try {
      return new OrganizationUnitSuccessorDto(
        await this.organizationService.createSuccessor(context, parsedUnitId.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/organization-units/:unitId/draft/:draftId')
  @RequirePermission('organization.units.update')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitVersionDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    const parsedDraftId = organizationUnitIdSchema.safeParse(draftId);
    if (!parsedUnitId.success || !parsedDraftId.success) throw this.notFound(context);
    const parsed = organizationUnitDraftUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter the proposed Organization Unit values and effective date.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new OrganizationUnitVersionDto(
        await this.organizationService.updateDraft(
          context,
          parsedUnitId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/draft/:draftId/activate')
  @RequirePermission('organization.units.activate')
  async activateSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrganizationUnitDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    const parsedDraftId = organizationUnitIdSchema.safeParse(draftId);
    if (!parsedUnitId.success || !parsedDraftId.success) throw this.notFound(context);
    const parsed = organizationUnitSuccessorActivationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter a reason for the Organization Unit change.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new OrganizationUnitDto(
        await this.organizationService.activateSuccessor(
          context,
          parsedUnitId.data,
          parsedDraftId.data,
          {
            ...parsed.data,
            ...(parsedIdempotencyKey ? { idempotencyKey: parsedIdempotencyKey } : {}),
          },
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/versions/:versionId/correct')
  @RequirePermission('organization.units.update')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OrganizationUnitVersionDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    const parsedVersionId = organizationUnitIdSchema.safeParse(versionId);
    if (!parsedUnitId.success || !parsedVersionId.success) throw this.notFound(context);
    const parsed = organizationUnitCorrectionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter corrected values and a correction reason.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new OrganizationUnitVersionDto(
        await this.organizationService.correct(
          context,
          parsedUnitId.data,
          parsedVersionId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/activate')
  @RequirePermission('organization.units.activate')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrganizationUnitDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    const parsed = organizationUnitActivationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Choose an eligible parent and enter an activation reason.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    const parsedIdempotencyKey = idempotencyKey
      ? organizationIdempotencyKeySchema.safeParse(idempotencyKey)
      : null;
    if (parsedIdempotencyKey && !parsedIdempotencyKey.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Enter a valid Idempotency-Key.',
          requestId: context.requestId,
        },
      });
    }
    try {
      return new OrganizationUnitDto(
        await this.organizationService.activate(context, parsedUnitId.data, {
          ...parsed.data,
          ...(parsedIdempotencyKey ? { idempotencyKey: parsedIdempotencyKey.data } : {}),
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/inactivate')
  @RequirePermission('organization.units.inactivate')
  async inactivate(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrganizationUnitDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    try {
      return new OrganizationUnitDto(
        await this.organizationService.inactivate(
          context,
          parsedUnitId.data,
          this.parseTransitionBody(body, context.requestId, idempotencyKey),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/reactivate')
  @RequirePermission('organization.units.activate')
  async reactivate(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrganizationUnitDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    try {
      return new OrganizationUnitDto(
        await this.organizationService.reactivate(
          context,
          parsedUnitId.data,
          this.parseTransitionBody(body, context.requestId, idempotencyKey),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/organization-units/:unitId/abolish')
  @RequirePermission('organization.units.abolish')
  async abolish(
    @Param('agencyId') agencyId: string,
    @Param('unitId') unitId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrganizationUnitDto> {
    this.assertReadAgency(agencyId, context);
    const parsedUnitId = organizationUnitIdSchema.safeParse(unitId);
    if (!parsedUnitId.success) throw this.notFound(context);
    try {
      return new OrganizationUnitDto(
        await this.organizationService.abolish(
          context,
          parsedUnitId.data,
          this.parseTransitionBody(body, context.requestId, idempotencyKey),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseTransitionBody(body: unknown, requestId: string, idempotencyKey?: string) {
    const parsed = organizationUnitTransitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter an effective date and reason for the Organization Unit transition.',
          fields: validationFields(parsed.error.issues),
          requestId,
        },
      });
    }
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, requestId);
    return {
      ...parsed.data,
      ...(parsedIdempotencyKey ? { idempotencyKey: parsedIdempotencyKey } : {}),
    };
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = organizationIdempotencyKeySchema.safeParse(value);
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

  private assertCreateAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'ORGANIZATION_UNIT_CREATE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private notFound(context: RequestContext): NotFoundException {
    return new NotFoundException({
      error: {
        code: 'ORGANIZATION_UNIT_NOT_FOUND',
        message: 'The Organization Unit could not be found.',
        requestId: context.requestId,
      },
    });
  }
}
