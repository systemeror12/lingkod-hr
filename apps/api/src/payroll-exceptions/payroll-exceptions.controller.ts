import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { PayrollPeriodsServiceError } from '../payroll-periods/payroll-periods.service';
import {
  type PayrollExceptionList,
  PayrollExceptionsService,
  type PayrollExceptionSummary,
} from './payroll-exceptions.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollExceptionsController {
  constructor(
    @Inject(PayrollExceptionsService) private readonly service: PayrollExceptionsService,
  ) {}

  @Get(':agencyId/payroll-periods/:periodId/exceptions')
  @RequirePermission('payroll.periods.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollExceptionList> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll Period');
    return translate(context, () => this.service.list(context, id, query));
  }

  @Post(':agencyId/payroll-periods/:periodId/exceptions/:exceptionId/acknowledge')
  @RequirePermission('payroll.periods.calculate')
  async acknowledge(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exceptionId') exceptionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ exception: PayrollExceptionSummary }> {
    const [period, exception] = parseTarget(agencyId, periodId, exceptionId, context);
    return {
      exception: await translate(context, () =>
        this.service.acknowledge(context, period, exception, body),
      ),
    };
  }

  @Post(':agencyId/payroll-periods/:periodId/exceptions/:exceptionId/resolve')
  @RequirePermission('payroll.periods.calculate')
  async resolve(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exceptionId') exceptionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ exception: PayrollExceptionSummary }> {
    const [period, exception] = parseTarget(agencyId, periodId, exceptionId, context);
    return {
      exception: await translate(context, () =>
        this.service.resolve(context, period, exception, body),
      ),
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

function parseTarget(
  agencyId: string,
  periodId: string,
  exceptionId: string,
  context: RequestContext,
): [string, string] {
  assertAgency(agencyId, context);
  return [
    parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll Period'),
    parseId(exceptionId, context, 'PAYROLL_EXCEPTION_NOT_FOUND', 'Payroll Exception'),
  ];
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
