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
import { AgencyProfileResponseDto, AgencyProfileVersionDto } from './agency-profile.dto';
import {
  agencyProfileActivationSchema,
  agencyProfileCorrectionSchema,
  agencyProfileDraftSchema,
  agencyProfileReadQuerySchema,
  agencyProfileVersionIdSchema,
} from './agency-profile.schemas';
import { AgencyProfileService, AgencyProfileServiceError } from './agency-profile.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof AgencyProfileServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AgencyProfileController {
  constructor(
    @Inject(AgencyProfileService) private readonly agencyProfileService: AgencyProfileService,
  ) {}

  @Get(':agencyId/agency-profile')
  @RequirePermission('organization.agency.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AgencyProfileResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedQuery = agencyProfileReadQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'The as-of date is invalid.',
          fields: validationFields(parsedQuery.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new AgencyProfileResponseDto(
        await this.agencyProfileService.list(context, parsedQuery.data.asOf),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/agency-profile/draft')
  @RequirePermission('organization.agency.update')
  async createDraft(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AgencyProfileVersionDto> {
    this.assertWriteAgency(agencyId, context);
    try {
      return new AgencyProfileVersionDto(await this.agencyProfileService.createDraft(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/agency-profile/draft/:draftId')
  @RequirePermission('organization.agency.update')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AgencyProfileVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = agencyProfileVersionIdSchema.safeParse(draftId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = agencyProfileDraftSchema.safeParse(body);
    if (!parsed.success) throw this.invalidDraftInput(parsed.error.issues, context);
    try {
      return new AgencyProfileVersionDto(
        await this.agencyProfileService.updateDraft(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/agency-profile/draft/:draftId/activate')
  @RequirePermission('organization.agency.update')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AgencyProfileVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = agencyProfileVersionIdSchema.safeParse(draftId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = agencyProfileActivationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter an effective date and a reason for activation.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new AgencyProfileVersionDto(
        await this.agencyProfileService.activate(
          context,
          parsedId.data,
          parsed.data.effectiveDate,
          parsed.data.reason,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/agency-profile/versions/:versionId/correct')
  @RequirePermission('organization.agency.update')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AgencyProfileVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = agencyProfileVersionIdSchema.safeParse(versionId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = agencyProfileCorrectionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter the corrected fields and a reason for correction.',
          fields: validationFields(parsed.error.issues),
          requestId: context.requestId,
        },
      });
    }
    try {
      return new AgencyProfileVersionDto(
        await this.agencyProfileService.correct(context, parsedId.data, parsed.data),
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
            code: 'AGENCY_PROFILE_UPDATE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private invalidDraftInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter all supported Agency Profile fields and an effective date.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'AGENCY_PROFILE_NOT_FOUND',
          message: 'The Agency Profile could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
