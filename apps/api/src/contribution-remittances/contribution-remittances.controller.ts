import { Controller, Get, HttpException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  ContributionRemittancesService,
  ContributionRemittancesServiceError,
  type ContributionRemittanceView,
} from './contribution-remittances.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class ContributionRemittancesController {
  constructor(
    @Inject(ContributionRemittancesService)
    private readonly service: ContributionRemittancesService,
  ) {}

  /**
   * Generate the Contribution Summary and Remittance Schedules of a FINALIZED
   * period; generating again returns the same ones.
   */
  @Post(':agencyId/payroll-periods/:periodId/contribution-remittances')
  @RequirePermission('payroll.registers.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ contributionRemittance: ContributionRemittanceView }> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period');
    return {
      contributionRemittance: await translate(context, () => this.service.generate(context, id)),
    };
  }

  /** Read a stored Contribution Summary and its Remittance Schedules. */
  @Get(':agencyId/payroll-periods/:periodId/contribution-remittances/:summaryId')
  @RequirePermission('payroll.registers.generate')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('summaryId') summaryId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ contributionRemittance: ContributionRemittanceView }> {
    assertAgency(agencyId, context);
    const period = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period');
    const summary = parseId(
      summaryId,
      context,
      'CONTRIBUTION_SUMMARY_NOT_FOUND',
      'The Contribution Summary',
    );
    return {
      contributionRemittance: await translate(context, () =>
        this.service.read(context, period, summary),
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

function parseId(value: string, context: RequestContext, code: string, noun: string): string {
  const id = idSchema.safeParse(value);
  if (!id.success) throw failure(context, 404, code, `${noun} could not be found.`);
  return id.data;
}

async function translate<T>(context: RequestContext, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof ContributionRemittancesServiceError) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}
