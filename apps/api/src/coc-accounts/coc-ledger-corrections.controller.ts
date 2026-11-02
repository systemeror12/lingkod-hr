import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  CocServiceError,
  type CocCorrectionEntry,
  type CocReversalResult,
} from './coc-accounts.types';
import {
  cocAdjustmentSchema,
  cocIdempotencyKeySchema,
  cocLedgerIdSchema,
  cocReversalSchema,
} from './coc-ledger-corrections.schemas';
import { CocLedgerCorrectionsService } from './coc-ledger-corrections.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof CocServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class CocLedgerCorrectionsController {
  constructor(
    @Inject(CocLedgerCorrectionsService)
    private readonly service: CocLedgerCorrectionsService,
  ) {}

  @Post(':agencyId/coc-accounts/:accountId/adjustments')
  @RequirePermission('overtime.coc.adjust')
  async adjust(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<CocCorrectionEntry> {
    this.assertWriteAgency(agencyId, context);
    const account = this.parseId(accountId, 'COC_ACCOUNT_NOT_FOUND', context);
    const parsed = cocAdjustmentSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.adjust(context, account, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/coc-accounts/:accountId/entries/:entryId/reversal')
  @RequirePermission('overtime.coc.reverse')
  async reverse(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CocReversalResult> {
    this.assertWriteAgency(agencyId, context);
    const account = this.parseId(accountId, 'COC_ACCOUNT_NOT_FOUND', context);
    const entry = this.parseId(entryId, 'COC_ENTRY_NOT_FOUND', context);
    const parsed = cocReversalSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.reverse(context, account, entry, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseId(value: string, code: string, context: RequestContext): string {
    const parsed = cocLedgerIdSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new HttpException(
      {
        error: {
          code,
          message: 'The COC record could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }

  private parseIdempotencyKey(
    value: string | undefined,
    context: RequestContext,
  ): string | undefined {
    if (value === undefined) return undefined;
    const parsed = cocIdempotencyKeySchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Enter a valid Idempotency-Key.',
        requestId: context.requestId,
      },
    });
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported COC correction values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'COC_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }
}
