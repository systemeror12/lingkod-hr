import {
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
    const id = parsePeriod(agencyId, periodId, context);
    return { varianceReport: await translate(context, () => this.service.generate(context, id)) };
  }

  /** The period's report, or null when none has been generated. */
  @Get(':agencyId/payroll-periods/:periodId/variance-report')
  @RequirePermission('payroll.registers.generate')
  @Header('Cache-Control', 'no-store')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ varianceReport: PayrollVarianceReportView | null }> {
    const id = parsePeriod(agencyId, periodId, context);
    return { varianceReport: await translate(context, () => this.service.read(context, id)) };
  }
}

function parsePeriod(agencyId: string, periodId: string, context: RequestContext): string {
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
  return period.data;
}

async function translate<T>(context: RequestContext, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof PayrollVarianceReportsServiceError) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}

function failure(context: RequestContext, status: number, code: string, message: string) {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
