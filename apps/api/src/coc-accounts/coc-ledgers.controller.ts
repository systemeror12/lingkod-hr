import { Controller, Get, HttpException, Inject, Param, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { CocServiceError, type CocAccountSummary, type CocLedger } from './coc-accounts.types';
import { cocLedgerIdSchema } from './coc-ledger-corrections.schemas';
import { CocLedgersService } from './coc-ledgers.service';

function failure(code: string, message: string, status: number, requestId: string): HttpException {
  return new HttpException({ error: { code, message, requestId } }, status);
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class CocLedgersController {
  constructor(@Inject(CocLedgersService) private readonly service: CocLedgersService) {}

  @Get(':agencyId/coc-accounts')
  @RequirePermission('overtime.coc.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ accounts: CocAccountSummary[] }> {
    this.assertAgency(agencyId, context);
    return this.translate(() => this.service.list(context), context);
  }

  @Get(':agencyId/coc-accounts/:accountId/entries')
  @RequirePermission('overtime.coc.read')
  async ledger(
    @Param('agencyId') agencyId: string,
    @Param('accountId') accountId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CocLedger> {
    this.assertAgency(agencyId, context);
    const account = cocLedgerIdSchema.safeParse(accountId);
    if (!account.success) {
      throw failure(
        'COC_ACCOUNT_NOT_FOUND',
        'The COC Account could not be found.',
        404,
        context.requestId,
      );
    }
    return this.translate(() => this.service.ledger(context, account.data), context);
  }

  private async translate<T>(read: () => Promise<T>, context: RequestContext): Promise<T> {
    try {
      return await read();
    } catch (error: unknown) {
      if (error instanceof CocServiceError) {
        throw failure(error.code, error.message, error.statusCode, context.requestId);
      }
      throw error;
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(
        'COC_BALANCE_FORBIDDEN',
        'The requested Agency is outside the active context.',
        403,
        context.requestId,
      );
    }
  }
}
