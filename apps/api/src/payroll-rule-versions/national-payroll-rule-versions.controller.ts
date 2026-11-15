import { Controller, Get, HttpException, Inject, Param, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  notFound,
  READ_PERMISSION,
  ReadNationalPayrollRuleVersionsService,
  RuleVersionReadError,
  type RuleVersionDetail,
  type RuleVersionSummary,
} from './read-national-payroll-rule-versions.service';

/**
 * Read-only routes for the platform-wide rule versions. They sit under the
 * acting Agency because the permission that reads them is an Agency grant.
 */
@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class NationalPayrollRuleVersionsController {
  constructor(
    @Inject(ReadNationalPayrollRuleVersionsService)
    private readonly service: ReadNationalPayrollRuleVersionsService,
  ) {}

  @Get(':agencyId/national-payroll-rule-versions')
  @RequirePermission(READ_PERMISSION)
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ versions: RuleVersionSummary[] }> {
    assertAgency(agencyId, context);
    return translate(() => this.service.list(context), context);
  }

  @Get(':agencyId/national-payroll-rule-versions/:ruleVersionId')
  @RequirePermission(READ_PERMISSION)
  async get(
    @Param('agencyId') agencyId: string,
    @Param('ruleVersionId') ruleVersionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<RuleVersionDetail> {
    assertAgency(agencyId, context);
    if (!z.uuid().safeParse(ruleVersionId).success) throw failure(notFound(), context);
    return translate(() => this.service.get(context, ruleVersionId), context);
  }
}

function assertAgency(agencyId: string, context: RequestContext): void {
  const agency = agencyIdSchema.safeParse(agencyId);
  if (!agency.success || agency.data !== context.agencyId) {
    throw failure(
      new RuleVersionReadError('The Agency could not be found.', 404, 'AGENCY_NOT_FOUND'),
      context,
    );
  }
}

function failure(error: RuleVersionReadError, context: RequestContext): HttpException {
  return new HttpException(
    { error: { code: error.code, message: error.message, requestId: context.requestId } },
    error.statusCode,
  );
}

async function translate<T>(run: () => Promise<T>, context: RequestContext): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof RuleVersionReadError) throw failure(error, context);
    throw error;
  }
}
