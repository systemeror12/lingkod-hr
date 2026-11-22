import { Controller, HttpException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { DocumentsServiceError } from '../documents/documents.service';
import {
  PayrollRegistersService,
  PayrollRegistersServiceError,
  type PayrollRegisterView,
} from './payroll-registers.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollRegistersController {
  constructor(@Inject(PayrollRegistersService) private readonly service: PayrollRegistersService) {}

  /** Generate the Payroll Register of a FINALIZED period; generating again returns the same one. */
  @Post(':agencyId/payroll-periods/:periodId/register')
  @RequirePermission('payroll.registers.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ register: PayrollRegisterView }> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(context, 404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.');
    }
    const period = idSchema.safeParse(periodId);
    if (!period.success) {
      throw failure(
        context,
        404,
        'PAYROLL_PERIOD_NOT_FOUND',
        'The Payroll Period could not be found.',
      );
    }
    try {
      return { register: await this.service.generate(context, period.data) };
    } catch (error: unknown) {
      if (error instanceof PayrollRegistersServiceError || error instanceof DocumentsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }
}

function failure(context: RequestContext, status: number, code: string, message: string) {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
