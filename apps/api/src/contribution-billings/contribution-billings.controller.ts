import {
  Body,
  Controller,
  Get,
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
  payrollPeriodIdSchema,
  recordContributionBillingSchema,
} from './contribution-billings.schemas';
import {
  ContributionBillingsService,
  ContributionBillingsServiceError,
  type ContributionBillingView,
  type RecordedContributionBilling,
} from './contribution-billings.service';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class ContributionBillingsController {
  constructor(
    @Inject(ContributionBillingsService) private readonly service: ContributionBillingsService,
  ) {}

  @Get(':agencyId/payroll-periods/:periodId/contribution-billings')
  @RequirePermission('payroll.periods.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ billings: ContributionBillingView[] }> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(context, 404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.');
    }
    const period = payrollPeriodIdSchema.safeParse(periodId);
    if (!period.success) {
      throw failure(
        context,
        404,
        'PAYROLL_PERIOD_NOT_FOUND',
        'The Payroll Period could not be found.',
      );
    }
    try {
      return { billings: await this.service.list(context, period.data) };
    } catch (error: unknown) {
      if (error instanceof ContributionBillingsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  @Post(':agencyId/payroll-periods/:periodId/contribution-billings')
  @RequirePermission('payroll.deductions.manage')
  async record(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ billing: RecordedContributionBilling }> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(context, 404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.');
    }
    const period = payrollPeriodIdSchema.safeParse(periodId);
    if (!period.success) {
      throw failure(
        context,
        404,
        'PAYROLL_PERIOD_NOT_FOUND',
        'The Payroll Period could not be found.',
      );
    }
    const parsed = recordContributionBillingSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fields[issue.path.map(String).join('.') || 'form'] ??= issue.message;
      }
      throw new HttpException(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Check the contribution billing fields.',
            requestId: context.requestId,
            fields,
          },
        },
        400,
      );
    }
    try {
      return { billing: await this.service.record(context, period.data, parsed.data) };
    } catch (error: unknown) {
      if (error instanceof ContributionBillingsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }
}

function failure(
  context: RequestContext,
  status: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
