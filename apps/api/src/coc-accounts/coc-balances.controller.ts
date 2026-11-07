import { Controller, Get, HttpException, Inject, Param, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { CocServiceError, type CocBalance } from './coc-accounts.types';
import { CocBalancesService } from './coc-balances.service';
import { cocLedgerIdSchema } from './coc-ledger-corrections.schemas';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class CocBalancesController {
  constructor(@Inject(CocBalancesService) private readonly service: CocBalancesService) {}

  @Get(':agencyId/employees/:employeeId/coc-balance')
  @RequirePermission('overtime.coc.read')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CocBalance> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'COC_BALANCE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
    const employee = cocLedgerIdSchema.safeParse(employeeId);
    if (!employee.success) {
      throw new HttpException(
        {
          error: {
            code: 'COC_EMPLOYEE_NOT_FOUND',
            message: 'The Employee could not be found in this Agency.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
    try {
      return await this.service.read(context, employee.data);
    } catch (error: unknown) {
      if (error instanceof CocServiceError) {
        throw new HttpException(
          { error: { code: error.code, message: error.message, requestId: context.requestId } },
          error.statusCode,
        );
      }
      throw error;
    }
  }
}
