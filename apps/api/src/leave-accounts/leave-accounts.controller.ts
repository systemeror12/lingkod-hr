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
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  LeaveAccountDetailDto,
  LeaveAccountDto,
  LeaveAccountListResponseDto,
} from './leave-accounts.dto';
import {
  leaveAccountAdjustmentSchema,
  leaveAccountCloseSchema,
  leaveAccountDateSchema,
  leaveAccountFreezeSchema,
  leaveAccountIdSchema,
  leaveAccountIdempotencyKeySchema,
  leaveAccountInstantSchema,
  leaveAccountLedgerEntryIdSchema,
  leaveAccountOpenSchema,
  leaveAccountReversalSchema,
  leaveAccountStatusSchema,
} from './leave-accounts.schemas';
import { LeaveAccountsService, LeaveAccountServiceError } from './leave-accounts.service';

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
  if (error instanceof LeaveAccountServiceError) {
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
export class LeaveAccountsController {
  constructor(@Inject(LeaveAccountsService) private readonly service: LeaveAccountsService) {}

  @Get(':agencyId/leave-accounts')
  @RequirePermission('leave.accounts.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('leaveTypeId') leaveTypeId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('asOf') asOf: string | undefined,
    @Query('recordedThrough') recordedThrough: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsed = this.parseFilters(
      { employeeId, leaveTypeId, status, asOf, recordedThrough },
      context,
    );
    try {
      return new LeaveAccountListResponseDto(await this.service.list(context, parsed));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/leave-accounts/:accountId')
  @RequirePermission('leave.accounts.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Query('asOf') asOf: string | undefined,
    @Query('recordedThrough') recordedThrough: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = leaveAccountIdSchema.safeParse(accountId);
    const window = this.parseWindow({ asOf, recordedThrough }, context);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data, window);
      if (!detail) throw this.notFound(context);
      return new LeaveAccountDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-accounts')
  @RequirePermission('leave.credits.adjust')
  async open(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = leaveAccountOpenSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveAccountDto(await this.service.open(context, parsed.data, parsedKey));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-accounts/:accountId/freeze')
  @RequirePermission('leave.credits.adjust')
  async freeze(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveAccountIdSchema.safeParse(accountId);
    const parsed = leaveAccountFreezeSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveAccountDto(
        await this.service.freeze(context, parsedId.data, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-accounts/:accountId/unfreeze')
  @RequirePermission('leave.credits.adjust')
  async unfreeze(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveAccountIdSchema.safeParse(accountId);
    const parsed = leaveAccountFreezeSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveAccountDto(
        await this.service.unfreeze(context, parsedId.data, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-accounts/:accountId/close')
  @RequirePermission('leave.credits.adjust')
  async close(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveAccountIdSchema.safeParse(accountId);
    const parsed = leaveAccountCloseSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveAccountDto(
        await this.service.close(context, parsedId.data, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-accounts/:accountId/adjustments')
  @RequirePermission('leave.credits.adjust')
  async recordAdjustment(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveAccountIdSchema.safeParse(accountId);
    const parsed = leaveAccountAdjustmentSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveAccountDto(
        await this.service.recordAdjustment(context, parsedId.data, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/leave-accounts/:accountId/ledger-entries/:entryId/reversal')
  @RequirePermission('leave.credits.adjust')
  async reverseEntry(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<LeaveAccountDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = leaveAccountIdSchema.safeParse(accountId);
    const parsedEntryId = leaveAccountLedgerEntryIdSchema.safeParse(entryId);
    const parsed = leaveAccountReversalSchema.safeParse(body);
    if (!parsedId.success || !parsedEntryId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new LeaveAccountDto(
        await this.service.reverseEntry(
          context,
          parsedId.data,
          parsedEntryId.data,
          parsed.data,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseFilters(
    filters: {
      employeeId: string | undefined;
      leaveTypeId: string | undefined;
      status: string | undefined;
      asOf: string | undefined;
      recordedThrough: string | undefined;
    },
    context: RequestContext,
  ) {
    const parsed: {
      employeeId?: string;
      leaveTypeId?: string;
      status?: 'ACTIVE' | 'FROZEN' | 'CLOSED';
      asOf?: string;
      recordedThrough?: string;
    } = {};
    const employeeId = leaveAccountIdSchema.safeParse(filters.employeeId);
    if (filters.employeeId !== undefined && !employeeId.success) {
      throw this.invalidInput(employeeId.error.issues, context);
    }
    if (employeeId.success) parsed.employeeId = employeeId.data;
    const leaveTypeId = leaveAccountIdSchema.safeParse(filters.leaveTypeId);
    if (filters.leaveTypeId !== undefined && !leaveTypeId.success) {
      throw this.invalidInput(leaveTypeId.error.issues, context);
    }
    if (leaveTypeId.success) parsed.leaveTypeId = leaveTypeId.data;
    const status = leaveAccountStatusSchema.safeParse(filters.status);
    if (filters.status !== undefined && !status.success) {
      throw this.invalidInput(status.error.issues, context);
    }
    if (status.success) parsed.status = status.data;
    return { ...parsed, ...this.parseWindow(filters, context) };
  }

  private parseWindow(
    window: { asOf: string | undefined; recordedThrough: string | undefined },
    context: RequestContext,
  ): { asOf?: string; recordedThrough?: string } {
    const parsed: { asOf?: string; recordedThrough?: string } = {};
    const asOf = leaveAccountDateSchema.safeParse(window.asOf);
    if (window.asOf !== undefined && !asOf.success) {
      throw this.invalidInput(asOf.error.issues, context);
    }
    if (asOf.success) parsed.asOf = asOf.data;
    const recordedThrough = leaveAccountInstantSchema.safeParse(window.recordedThrough);
    if (window.recordedThrough !== undefined && !recordedThrough.success) {
      throw this.invalidInput(recordedThrough.error.issues, context);
    }
    if (recordedThrough.success) parsed.recordedThrough = recordedThrough.data;
    return parsed;
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = leaveAccountIdempotencyKeySchema.safeParse(value);
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
            code: 'LEAVE_CREDIT_ADJUST_FORBIDDEN',
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
        message: 'Enter supported Leave Account values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'LEAVE_ACCOUNT_NOT_FOUND',
          message: 'The Leave Account could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
