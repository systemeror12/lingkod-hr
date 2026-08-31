import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  StaffingAuthorityDetailDto,
  StaffingAuthorityDto,
  StaffingAuthorityListResponseDto,
} from './staffing-authorities.dto';
import {
  staffingAuthorityActivationSchema,
  staffingAuthorityDraftSchema,
  staffingAuthorityDraftUpdateSchema,
  staffingAuthorityEvidenceSchema,
  staffingAuthorityIdSchema,
  staffingAuthorityIdempotencyKeySchema,
  staffingAuthorityRevocationSchema,
  staffingAuthoritySupersessionSchema,
} from './staffing-authorities.schemas';
import {
  StaffingAuthorityService,
  StaffingAuthorityServiceError,
} from './staffing-authorities.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof StaffingAuthorityServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class StaffingAuthoritiesController {
  constructor(
    @Inject(StaffingAuthorityService) private readonly service: StaffingAuthorityService,
  ) {}

  @Get(':agencyId/staffing-authorities')
  @RequirePermission('staffing.authorities.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<StaffingAuthorityListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new StaffingAuthorityListResponseDto(await this.service.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/staffing-authorities/:authorityId')
  @RequirePermission('staffing.authorities.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<StaffingAuthorityDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = staffingAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data);
      if (!detail) throw this.notFound(context);
      return new StaffingAuthorityDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/staffing-authorities')
  @RequirePermission('staffing.authorities.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<StaffingAuthorityDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = staffingAuthorityDraftSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new StaffingAuthorityDto(await this.service.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/staffing-authorities/:authorityId')
  @RequirePermission('staffing.authorities.update')
  async updateDraft(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<StaffingAuthorityDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = staffingAuthorityIdSchema.safeParse(authorityId);
    const parsed = staffingAuthorityDraftUpdateSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new StaffingAuthorityDto(
        await this.service.updateDraft(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/staffing-authorities/:authorityId/evidence')
  @RequirePermission('staffing.authorities.evidence.validate')
  async validateEvidence(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<StaffingAuthorityDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = staffingAuthorityIdSchema.safeParse(authorityId);
    const parsed = staffingAuthorityEvidenceSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new StaffingAuthorityDto(
        await this.service.validateEvidence(
          context,
          parsedId.data,
          parsed.data,
          parsedIdempotencyKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/staffing-authorities/:authorityId/activate')
  @RequirePermission('staffing.authorities.activate')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<StaffingAuthorityDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = staffingAuthorityIdSchema.safeParse(authorityId);
    const parsed = staffingAuthorityActivationSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new StaffingAuthorityDto(
        await this.service.activate(
          context,
          parsedId.data,
          parsed.data.reason,
          parsedIdempotencyKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/staffing-authorities/:authorityId/supersede')
  @RequirePermission('staffing.authorities.supersede')
  async supersede(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<StaffingAuthorityDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = staffingAuthorityIdSchema.safeParse(authorityId);
    const parsed = staffingAuthoritySupersessionSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new StaffingAuthorityDto(
        await this.service.supersede(
          context,
          parsedId.data,
          parsed.data.successorId,
          parsed.data.reason,
          parsedIdempotencyKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/staffing-authorities/:authorityId/revoke')
  @RequirePermission('staffing.authorities.revoke')
  async revoke(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<StaffingAuthorityDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = staffingAuthorityIdSchema.safeParse(authorityId);
    const parsed = staffingAuthorityRevocationSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new StaffingAuthorityDto(
        await this.service.revoke(
          context,
          parsedId.data,
          parsed.data.effectiveDate,
          parsed.data.reason,
          parsed.data.documentId,
          parsedIdempotencyKey,
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
            code: 'STAFFING_AUTHORITY_WRITE_FORBIDDEN',
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
        message: 'Enter supported Staffing Authority values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = staffingAuthorityIdempotencyKeySchema.safeParse(value);
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
          code: 'STAFFING_AUTHORITY_NOT_FOUND',
          message: 'The Staffing Authority could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
