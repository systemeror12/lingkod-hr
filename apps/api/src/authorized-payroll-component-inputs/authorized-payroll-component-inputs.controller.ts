import { Body, Controller, HttpException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { ApproveAuthorizedPayrollComponentInputService } from './approve-authorized-payroll-component-input.service';
import {
  ADJUST_PERMISSION,
  AuthorizedInputServiceError,
  type AuthorizedInputSummary,
} from './authorized-payroll-component-inputs.records';
import type { RecordAuthorizedInput } from './authorized-payroll-component-inputs.schemas';
import { RecordAuthorizedPayrollComponentInputService } from './record-authorized-payroll-component-input.service';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AuthorizedPayrollComponentInputsController {
  constructor(
    @Inject(RecordAuthorizedPayrollComponentInputService)
    private readonly recordService: RecordAuthorizedPayrollComponentInputService,
    @Inject(ApproveAuthorizedPayrollComponentInputService)
    private readonly approveService: ApproveAuthorizedPayrollComponentInputService,
  ) {}

  /** The service validates the body; a missing field is refused there. */
  @Post(':agencyId/authorized-payroll-component-inputs')
  @RequirePermission(ADJUST_PERMISSION)
  async record(
    @Param('agencyId') agencyId: string,
    @Body() body: RecordAuthorizedInput,
    @CurrentContext() context: RequestContext,
  ): Promise<AuthorizedInputSummary> {
    assertAgency(agencyId, context);
    return translate(() => this.recordService.execute(context, body), context);
  }

  @Post(':agencyId/authorized-payroll-component-inputs/:inputId/approve')
  @RequirePermission(ADJUST_PERMISSION)
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('inputId') inputId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AuthorizedInputSummary> {
    assertAgency(agencyId, context);
    if (!z.uuid().safeParse(inputId).success) {
      throw failure(
        new AuthorizedInputServiceError(
          'The Authorized Payroll Component Input could not be found.',
          404,
          'AUTHORIZED_INPUT_NOT_FOUND',
        ),
        context,
      );
    }
    return translate(() => this.approveService.execute(context, inputId), context);
  }
}

function assertAgency(agencyId: string, context: RequestContext): void {
  const agency = agencyIdSchema.safeParse(agencyId);
  if (!agency.success || agency.data !== context.agencyId) {
    throw failure(
      new AuthorizedInputServiceError('The Agency could not be found.', 404, 'AGENCY_NOT_FOUND'),
      context,
    );
  }
}

function failure(error: AuthorizedInputServiceError, context: RequestContext): HttpException {
  return new HttpException(
    { error: { code: error.code, message: error.message, requestId: context.requestId } },
    error.statusCode,
  );
}

async function translate<T>(run: () => Promise<T>, context: RequestContext): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof AuthorizedInputServiceError) throw failure(error, context);
    throw error;
  }
}
