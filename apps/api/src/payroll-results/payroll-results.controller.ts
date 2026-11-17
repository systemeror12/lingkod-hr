import { Controller, Get, HttpException, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { PayrollPeriodsServiceError } from '../payroll-periods/payroll-periods.service';
import {
  PayrollResultsService,
  type PayrollPeriodList,
  type PayrollResultDetail,
  type PayrollResultList,
} from './payroll-results.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollResultsController {
  constructor(@Inject(PayrollResultsService) private readonly service: PayrollResultsService) {}

  @Get(':agencyId/payroll-periods')
  @RequirePermission('payroll.periods.read')
  async listPeriods(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollPeriodList> {
    assertAgency(agencyId, context);
    return translate(context, () => this.service.listPeriods(context));
  }

  @Get(':agencyId/payroll-periods/:periodId/results')
  @RequirePermission('payroll.periods.read')
  async listResults(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollResultList> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll Period');
    return translate(context, () => this.service.listResults(context, id, query));
  }

  @Get(':agencyId/payroll-periods/:periodId/results/:resultId')
  @RequirePermission('payroll.periods.read')
  async readResult(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('resultId') resultId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ result: PayrollResultDetail }> {
    assertAgency(agencyId, context);
    const period = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll Period');
    const result = parseId(
      resultId,
      context,
      'PAYROLL_RESULT_NOT_FOUND',
      'Payroll Employee Result',
    );
    return {
      result: await translate(context, () => this.service.readResult(context, period, result)),
    };
  }
}

function failure(context: RequestContext, status: number, code: string, message: string) {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}

function assertAgency(agencyId: string, context: RequestContext): void {
  const agency = agencyIdSchema.safeParse(agencyId);
  if (!agency.success || agency.data !== context.agencyId) {
    throw failure(context, 404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.');
  }
}

function parseId(value: string, context: RequestContext, code: string, name: string): string {
  const id = idSchema.safeParse(value);
  if (!id.success) throw failure(context, 404, code, `The ${name} could not be found.`);
  return id.data;
}

async function translate<T>(context: RequestContext, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof PayrollPeriodsServiceError) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}
