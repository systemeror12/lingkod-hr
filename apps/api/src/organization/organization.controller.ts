import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import type { RequestContext } from '@lingkod-hr/auth';
import { agencyIdSchema } from '../auth/auth.schemas';
import { OrganizationUnitDto, OrganizationUnitListResponseDto } from './organization.dto';
import { organizationUnitCreateSchema, organizationUnitIdSchema } from './organization.schemas';
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
