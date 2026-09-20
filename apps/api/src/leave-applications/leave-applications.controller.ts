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
  LeaveApplicationDetailDto,
  LeaveApplicationListResponseDto,
  LeaveEligibilityOutcomeDto,
} from './leave-applications.dto';
import {
  leaveApplicationCreateSchema,
  leaveApplicationDocumentSchema,
  leaveApplicationDraftSchema,
  leaveApplicationIdSchema,
  leaveApplicationIdempotencyKeySchema,
  leaveApplicationListSchema,
  leaveApplicationSubmitSchema,
  leaveApplicationWithdrawSchema,
} from './leave-applications.schemas';
import {
  LeaveApplicationServiceError,
  LeaveApplicationsService,
} from './leave-applications.service';

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
  if (error instanceof LeaveApplicationServiceError) {
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
export class LeaveApplicationsController {
  constructor(
    @Inject(LeaveApplicationsService) private readonly service: LeaveApplicationsService,
  ) {}

  @Get(':agencyId/leave-applications')
  @RequirePermission('leave.applications.create')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('leaveTypeId') leaveTypeId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsed = leaveApplicationListSchema.safeParse({
      employeeId,
      leaveTypeId,
      status,
      limit,
    });
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeaveApplicationListResponseDto(await this.service.list(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/leave-applications/:applicationId')
  @RequirePermission('leave.applications.create')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = leaveApplicationIdSchema.safeParse(applicationId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data);
      if (!detail) throw this.notFound(context);
      return new LeaveApplicationDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/leave-applications/:applicationId/eligibility')
  @RequirePermission('leave.applications.create')
  async preview(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveEligibilityOutcomeDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = leaveApplicationIdSchema.safeParse(applicationId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new LeaveEligibilityOutcomeDto(await this.service.preview(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-applications')
  @RequirePermission('leave.applications.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = leaveApplicationCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveApplicationDetailDto(
        await this.service.create(context, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/leave-applications/:applicationId')
  @RequirePermission('leave.applications.create')
  async update(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveApplicationIdSchema.safeParse(applicationId);
    const parsed = leaveApplicationDraftSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeaveApplicationDetailDto(
        await this.service.update(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-applications/:applicationId/submission')
  @RequirePermission('leave.applications.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveApplicationIdSchema.safeParse(applicationId);
    const parsed = leaveApplicationSubmitSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveApplicationDetailDto(
        await this.service.submit(context, parsedId.data, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-applications/:applicationId/withdrawal')
  @RequirePermission('leave.applications.withdraw')
  async withdraw(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveApplicationIdSchema.safeParse(applicationId);
    const parsed = leaveApplicationWithdrawSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveApplicationDetailDto(
        await this.service.withdraw(context, parsedId.data, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-applications/:applicationId/documents')
  @RequirePermission('leave.applications.create')
  async appendDocument(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveApplicationDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveApplicationIdSchema.safeParse(applicationId);
    const parsed = leaveApplicationDocumentSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new LeaveApplicationDetailDto(
        await this.service.appendDocument(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = leaveApplicationIdempotencyKeySchema.safeParse(value);
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
            code: 'LEAVE_APPLICATION_FORBIDDEN',
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
        message: 'Enter supported Leave Application values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'LEAVE_APPLICATION_NOT_FOUND',
          message: 'The Leave Application could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
