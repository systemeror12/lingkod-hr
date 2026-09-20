import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '@lingkod-hr/auth';
import { ApprovalServiceError } from '../approvals/approval.service';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  monetizationAdjustmentCreateSchema,
  monetizationAssessmentSchema,
  monetizationCertificationSchema,
  monetizationCreateSchema,
  monetizationDecisionSchema,
  monetizationFundingSchema,
  monetizationIdSchema,
  monetizationIdempotencyKeySchema,
  monetizationReturnSchema,
  monetizationSubmitSchema,
  type MonetizationAdjustmentCreateInput,
  type MonetizationAssessmentInput,
  type MonetizationCertificationInput,
  type MonetizationCreateInput,
  type MonetizationDecisionInput,
  type MonetizationFundingInput,
  type MonetizationReturnInput,
  type MonetizationSubmitInput,
} from './leave-monetization.schemas';
import { MONETIZATION_STATUSES } from './monetization-catalogue';
import {
  LeaveMonetizationService,
  type MonetizationAdjustmentApplyResult,
  type MonetizationAdjustmentSummary,
  type MonetizationDetail,
  type MonetizationPage,
  type MonetizationPostResult,
  type MonetizationRequestSummary,
} from './leave-monetization.service';
import { LeaveMonetizationServiceError } from './monetization-support';

const listStatusSchema = z.enum(MONETIZATION_STATUSES);
const listLimitSchema = z.coerce.number().int().min(1).max(100);
const listOffsetSchema = z.coerce.number().int().min(0);

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
  if (error instanceof LeaveMonetizationServiceError) {
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
  if (error instanceof ApprovalServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class LeaveMonetizationController {
  constructor(
    @Inject(LeaveMonetizationService) private readonly service: LeaveMonetizationService,
  ) {}

  @Get(':agencyId/leave-monetization')
  @RequirePermission('leave.accounts.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('status') status: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationPage> {
    this.assertReadAgency(agencyId, context);
    const filters = this.parseFilters({ status, employeeId, limit, offset }, context);
    try {
      return await this.service.list(context, filters);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/leave-monetization/:requestId')
  @RequirePermission('leave.accounts.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertReadAgency(agencyId, context);
    const parsedId = monetizationIdSchema.safeParse(requestId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data);
      if (!detail) throw this.notFound(context);
      return detail;
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization')
  @RequirePermission('leave.monetization.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationRequestSummary> {
    this.assertWriteAgency(agencyId, context);
    const input = this.parseBody<MonetizationCreateInput>(monetizationCreateSchema, body, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.create(context, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/submit')
  @RequirePermission('leave.monetization.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationSubmitInput>(monetizationSubmitSchema, body, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.submit(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/assessment')
  @RequirePermission('leave.monetization.certify')
  async assess(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationAssessmentInput>(
      monetizationAssessmentSchema,
      body,
      context,
    );
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.assess(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/certification')
  @RequirePermission('leave.monetization.certify')
  async certify(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationCertificationInput>(
      monetizationCertificationSchema,
      body,
      context,
    );
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.certify(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/return')
  @RequirePermission('leave.monetization.return')
  async returnRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationReturnInput>(monetizationReturnSchema, body, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.returnRequest(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/funding')
  @RequirePermission('leave.monetization.review_funding')
  async determineFunding(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationFundingInput>(
      monetizationFundingSchema,
      body,
      context,
    );
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.determineFunding(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/decision')
  @RequirePermission('leave.monetization.approve')
  async decide(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationDecisionInput>(
      monetizationDecisionSchema,
      body,
      context,
    );
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.decide(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/withdraw')
  @RequirePermission('leave.monetization.withdraw')
  async withdraw(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationReturnInput>(monetizationReturnSchema, body, context);
    try {
      return await this.service.withdraw(context, parsedId, input);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/cancel')
  @RequirePermission('leave.monetization.cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationDetail> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const input = this.parseBody<MonetizationReturnInput>(monetizationReturnSchema, body, context);
    try {
      return await this.service.cancel(context, parsedId, input);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/:requestId/post')
  @RequirePermission('leave.monetization.post')
  async post(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationPostResult> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(requestId, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.post(context, parsedId, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/postings/:postingId/adjustments')
  @RequirePermission('leave.monetization.adjust')
  async createAdjustment(
    @Param('agencyId') agencyId: string,
    @Param('postingId') postingId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationAdjustmentSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(postingId, context);
    const input = this.parseBody<MonetizationAdjustmentCreateInput>(
      monetizationAdjustmentCreateSchema,
      body,
      context,
    );
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.createAdjustment(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/adjustments/:adjustmentId/submit')
  @RequirePermission('leave.monetization.adjust')
  async submitAdjustment(
    @Param('agencyId') agencyId: string,
    @Param('adjustmentId') adjustmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationAdjustmentSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(adjustmentId, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.submitAdjustment(context, parsedId, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/adjustments/:adjustmentId/decision')
  @RequirePermission('leave.monetization.approve')
  async decideAdjustment(
    @Param('agencyId') agencyId: string,
    @Param('adjustmentId') adjustmentId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationAdjustmentApplyResult> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(adjustmentId, context);
    const input = this.parseBody<MonetizationDecisionInput>(
      monetizationDecisionSchema,
      body,
      context,
    );
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.decideAdjustment(context, parsedId, input, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-monetization/adjustments/:adjustmentId/apply')
  @RequirePermission('leave.monetization.adjust')
  async applyAdjustment(
    @Param('agencyId') agencyId: string,
    @Param('adjustmentId') adjustmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MonetizationAdjustmentApplyResult> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseId(adjustmentId, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return await this.service.apply(context, parsedId, parsedKey);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseFilters(
    filters: {
      status: string | undefined;
      employeeId: string | undefined;
      limit: string | undefined;
      offset: string | undefined;
    },
    context: RequestContext,
  ): {
    status?: (typeof MONETIZATION_STATUSES)[number];
    employeeId?: string;
    limit?: number;
    offset?: number;
  } {
    const parsed: {
      status?: (typeof MONETIZATION_STATUSES)[number];
      employeeId?: string;
      limit?: number;
      offset?: number;
    } = {};
    const status = listStatusSchema.safeParse(filters.status);
    if (filters.status !== undefined && !status.success) {
      throw this.invalidInput(status.error.issues, context);
    }
    if (status.success) parsed.status = status.data;
    const employeeId = monetizationIdSchema.safeParse(filters.employeeId);
    if (filters.employeeId !== undefined && !employeeId.success) {
      throw this.invalidInput(employeeId.error.issues, context);
    }
    if (employeeId.success) parsed.employeeId = employeeId.data;
    const limit = listLimitSchema.safeParse(filters.limit);
    if (filters.limit !== undefined && !limit.success) {
      throw this.invalidInput(limit.error.issues, context);
    }
    if (limit.success) parsed.limit = limit.data;
    const offset = listOffsetSchema.safeParse(filters.offset);
    if (filters.offset !== undefined && !offset.success) {
      throw this.invalidInput(offset.error.issues, context);
    }
    if (offset.success) parsed.offset = offset.data;
    return parsed;
  }

  private parseId(value: string, context: RequestContext): string {
    const parsed = monetizationIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context);
    return parsed.data;
  }

  private parseBody<T>(
    schema: {
      safeParse: (value: unknown) =>
        | { success: true; data: T }
        | {
            success: false;
            error: { issues: readonly { path: PropertyKey[]; message: string; keys?: string[] }[] };
          };
    },
    body: unknown,
    context: RequestContext,
  ): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    return parsed.data;
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = monetizationIdempotencyKeySchema.safeParse(value);
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
            code: 'LEAVE_MONETIZATION_FORBIDDEN',
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
        message: 'Enter supported Leave Monetization values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'MONETIZATION_REQUEST_NOT_FOUND',
          message: 'The Leave Monetization Request could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
