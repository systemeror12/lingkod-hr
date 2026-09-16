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
import {
  LeaveCatalogueResponseDto,
  LeavePolicyVersionDto,
  LeaveTypeDetailDto,
  LeaveTypeDto,
  LeaveTypeListResponseDto,
} from './leave-policies.dto';
import {
  leaveAuthorityIdSchema,
  leaveIdempotencyKeySchema,
  leavePolicyActivationSchema,
  leavePolicyAuthoritySchema,
  leavePolicyVersionCreateSchema,
  leavePolicyVersionIdSchema,
  leavePolicyVersionUpdateSchema,
  leaveTypeAsOfSchema,
  leaveTypeCreateSchema,
  leaveTypeIdSchema,
  leaveTypeUpdateSchema,
} from './leave-policies.schemas';
import { LeavePoliciesService, LeavePolicyServiceError } from './leave-policies.service';

function validationFields(
  issues: readonly { path: PropertyKey[]; message: string; keys?: string[] }[],
) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    for (const key of issue.keys ?? []) {
      if (fields[key] === undefined) fields[key] = issue.message;
    }
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof LeavePolicyServiceError) {
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.reasons.length > 0 ? { reasons: error.reasons } : {}),
          requestId,
        },
      },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class LeavePoliciesController {
  constructor(@Inject(LeavePoliciesService) private readonly service: LeavePoliciesService) {}

  @Get(':agencyId/leave-catalogue')
  @RequirePermission('leave.types.read')
  catalogue(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): LeaveCatalogueResponseDto {
    this.assertReadAgency(agencyId, context);
    try {
      return new LeaveCatalogueResponseDto(this.service.listCatalogue(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/leave-types')
  @RequirePermission('leave.types.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveTypeListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new LeaveTypeListResponseDto(await this.service.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/leave-types/:leaveTypeId')
  @RequirePermission('leave.types.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveTypeDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsedAsOf = leaveTypeAsOfSchema.safeParse(asOf);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      const detail = await this.service.findById(context, parsedId.data, parsedAsOf.data);
      if (!detail) throw this.notFound(context);
      return new LeaveTypeDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-types')
  @RequirePermission('leave.types.manage')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveTypeDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = leaveTypeCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeaveTypeDto(await this.service.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/leave-types/:leaveTypeId')
  @RequirePermission('leave.types.manage')
  async update(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveTypeDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsed = leaveTypeUpdateSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeaveTypeDto(await this.service.update(context, parsedId.data, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-types/:leaveTypeId/policy-versions')
  @RequirePermission('leave.types.manage')
  async createPolicyVersion(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeavePolicyVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsed = leavePolicyVersionCreateSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeavePolicyVersionDto(
        await this.service.createPolicyVersion(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/leave-types/:leaveTypeId/policy-versions/:versionId')
  @RequirePermission('leave.types.manage')
  async updatePolicyDraft(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeavePolicyVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedTypeId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsedVersionId = leavePolicyVersionIdSchema.safeParse(versionId);
    const parsed = leavePolicyVersionUpdateSchema.safeParse(body);
    if (!parsedTypeId.success || !parsedVersionId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeavePolicyVersionDto(
        await this.service.updatePolicyDraft(
          context,
          parsedTypeId.data,
          parsedVersionId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-types/:leaveTypeId/policy-versions/:versionId/authorities')
  @RequirePermission('leave.types.manage')
  async linkAuthority(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeavePolicyVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedTypeId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsedVersionId = leavePolicyVersionIdSchema.safeParse(versionId);
    const parsed = leavePolicyAuthoritySchema.safeParse(body);
    if (!parsedTypeId.success || !parsedVersionId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeavePolicyVersionDto(
        await this.service.linkAuthority(
          context,
          parsedTypeId.data,
          parsedVersionId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Delete(':agencyId/leave-types/:leaveTypeId/policy-versions/:versionId/authorities/:authorityId')
  @RequirePermission('leave.types.manage')
  async unlinkAuthority(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Param('versionId') versionId: string,
    @Param('authorityId') authorityId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<LeavePolicyVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedTypeId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsedVersionId = leavePolicyVersionIdSchema.safeParse(versionId);
    const parsedAuthorityId = leaveAuthorityIdSchema.safeParse(authorityId);
    if (!parsedTypeId.success || !parsedVersionId.success || !parsedAuthorityId.success) {
      throw this.notFound(context);
    }
    try {
      return new LeavePolicyVersionDto(
        await this.service.unlinkAuthority(
          context,
          parsedTypeId.data,
          parsedVersionId.data,
          parsedAuthorityId.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-types/:leaveTypeId/policy-versions/:versionId/activate')
  @RequirePermission('leave.types.manage')
  async activate(
    @Param('agencyId') agencyId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveTypeDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedTypeId = leaveTypeIdSchema.safeParse(leaveTypeId);
    const parsedVersionId = leavePolicyVersionIdSchema.safeParse(versionId);
    const parsed = leavePolicyActivationSchema.safeParse(body);
    if (!parsedTypeId.success || !parsedVersionId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveTypeDto(
        await this.service.activate(
          context,
          parsedTypeId.data,
          parsedVersionId.data,
          parsed.data.reason,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = leaveIdempotencyKeySchema.safeParse(value);
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
            code: 'LEAVE_TYPE_WRITE_FORBIDDEN',
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
        message: 'Enter supported Leave Type and Leave Policy values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'LEAVE_TYPE_NOT_FOUND',
          message: 'The Leave Type could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
