import { Body, Controller, HttpException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  ApplicabilityServiceError,
  MANAGE_PERMISSION,
  type ApplicabilitySummary,
} from './agency-payroll-applicabilities.records';
import type {
  EndApplicability,
  RecordApplicability,
} from './agency-payroll-applicabilities.schemas';
import { EndAgencyPayrollApplicabilityService } from './end-agency-payroll-applicability.service';
import { RecordAgencyPayrollApplicabilityService } from './record-agency-payroll-applicability.service';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AgencyPayrollApplicabilitiesController {
  constructor(
    @Inject(RecordAgencyPayrollApplicabilityService)
    private readonly recordService: RecordAgencyPayrollApplicabilityService,
    @Inject(EndAgencyPayrollApplicabilityService)
    private readonly endService: EndAgencyPayrollApplicabilityService,
  ) {}

  /** The services validate the body; a missing field is refused there. */
  @Post(':agencyId/agency-payroll-applicabilities')
  @RequirePermission(MANAGE_PERMISSION)
  async record(
    @Param('agencyId') agencyId: string,
    @Body() body: RecordApplicability,
    @CurrentContext() context: RequestContext,
  ): Promise<ApplicabilitySummary> {
    assertAgency(agencyId, context);
    return translate(() => this.recordService.execute(context, body), context);
  }

  @Post(':agencyId/agency-payroll-applicabilities/:applicabilityId/end')
  @RequirePermission(MANAGE_PERMISSION)
  async end(
    @Param('agencyId') agencyId: string,
    @Param('applicabilityId') applicabilityId: string,
    @Body() body: EndApplicability,
    @CurrentContext() context: RequestContext,
  ): Promise<ApplicabilitySummary> {
    assertAgency(agencyId, context);
    if (!z.uuid().safeParse(applicabilityId).success) {
      throw failure(
        new ApplicabilityServiceError(
          'The Agency Payroll Applicability could not be found.',
          404,
          'APPLICABILITY_NOT_FOUND',
        ),
        context,
      );
    }
    return translate(() => this.endService.execute(context, applicabilityId, body), context);
  }
}

function assertAgency(agencyId: string, context: RequestContext): void {
  const agency = agencyIdSchema.safeParse(agencyId);
  if (!agency.success || agency.data !== context.agencyId) {
    throw failure(
      new ApplicabilityServiceError('The Agency could not be found.', 404, 'AGENCY_NOT_FOUND'),
      context,
    );
  }
}

function failure(error: ApplicabilityServiceError, context: RequestContext): HttpException {
  return new HttpException(
    { error: { code: error.code, message: error.message, requestId: context.requestId } },
    error.statusCode,
  );
}

async function translate<T>(run: () => Promise<T>, context: RequestContext): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof ApplicabilityServiceError) throw failure(error, context);
    throw error;
  }
}
