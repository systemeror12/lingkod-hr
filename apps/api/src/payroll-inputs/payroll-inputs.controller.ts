import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { payrollInputListFiltersSchema } from './payroll-inputs.schemas';
import {
  PayrollInputsService,
  PayrollInputsServiceError,
  type PayrollInputSummary,
} from './payroll-inputs.service';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollInputsController {
  constructor(@Inject(PayrollInputsService) private readonly service: PayrollInputsService) {}

  @Get(':agencyId/payroll-inputs')
  @RequirePermission('payroll.inputs.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: Record<string, unknown>,
    @CurrentContext() context: RequestContext,
  ): Promise<{ inputs: PayrollInputSummary[] }> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'AGENCY_NOT_FOUND',
            message: 'The Agency could not be found.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
    const filters = payrollInputListFiltersSchema.safeParse(query);
    if (!filters.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_INPUT',
          message: 'Filter Payroll Inputs by a valid source module and status.',
          requestId: context.requestId,
        },
      });
    }
    try {
      return { inputs: await this.service.list(context, filters.data) };
    } catch (error: unknown) {
      if (error instanceof PayrollInputsServiceError) {
        throw new HttpException(
          { error: { code: error.code, message: error.message, requestId: context.requestId } },
          error.statusCode,
        );
      }
      throw error;
    }
  }
}
