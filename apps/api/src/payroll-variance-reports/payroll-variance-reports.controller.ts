import { Controller, HttpException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  PayrollVarianceReportsService,
  PayrollVarianceReportsServiceError,
  type PayrollVarianceReportView,
} from './payroll-variance-reports.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollVarianceReportsController {
  constructor(
    @Inject(PayrollVarianceReportsService)
    private readonly service: PayrollVarianceReportsService,
  ) {}

  /**
   * Generate the Payroll Variance and Exception Report of a FINALIZED period;
   * generating again returns the same one.
   */
  @Post(':agencyId/payroll-periods/:periodId/variance-report')
  @RequirePermission('payroll.registers.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ varianceReport: PayrollVarianceReportView }> {
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
      return { varianceReport: await this.service.generate(context, period.data) };
    } catch (error: unknown) {
      if (error instanceof PayrollVarianceReportsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }
}

function failure(context: RequestContext, status: number, code: string, message: string) {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
