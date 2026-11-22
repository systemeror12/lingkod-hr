import {
  Body,
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
import { DocumentsServiceError } from '../documents/documents.service';
import { PayrollPeriodsServiceError } from '../payroll-periods/payroll-periods.service';
import {
  PayslipReadService,
  type OwnPayslipDetail,
  type OwnPayslipView,
} from './payslip-read.service';
import { PayslipReleaseService, type PeriodPayslipRelease } from './payslip-release.service';
import { PayslipWithholdService } from './payslip-withhold.service';
import { PayslipsServiceError, type PayslipView } from './payslips.shared';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayslipsController {
  constructor(
    @Inject(PayslipReleaseService) private readonly release: PayslipReleaseService,
    @Inject(PayslipWithholdService) private readonly withholding: PayslipWithholdService,
    @Inject(PayslipReadService) private readonly reading: PayslipReadService,
  ) {}

  /** Release every READY Payslip of a FINALIZED period. */
  @Post(':agencyId/payroll-periods/:periodId/payslips/release')
  @RequirePermission('payroll.payslips.release')
  async releasePeriod(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ release: PeriodPayslipRelease }> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period');
    return { release: await translate(context, () => this.release.releasePeriod(context, id)) };
  }

  /** Release one WITHHELD Payslip, with a reason. */
  @Post(':agencyId/payslips/:payslipId/release')
  @RequirePermission('payroll.payslips.release')
  async releaseWithheld(
    @Param('agencyId') agencyId: string,
    @Param('payslipId') payslipId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ payslip: PayslipView }> {
    const id = this.parsePayslip(agencyId, payslipId, context);
    return {
      payslip: await translate(context, () => this.release.releaseWithheld(context, id, body)),
    };
  }

  /** Withhold one READY Payslip from its Employee, with a reason. */
  @Post(':agencyId/payslips/:payslipId/withhold')
  @RequirePermission('payroll.payslips.withhold')
  async withhold(
    @Param('agencyId') agencyId: string,
    @Param('payslipId') payslipId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ payslip: PayslipView }> {
    const id = this.parsePayslip(agencyId, payslipId, context);
    return {
      payslip: await translate(context, () => this.withholding.withhold(context, id, body)),
    };
  }

  /** The caller's own RELEASED Payslips. */
  @Get(':agencyId/payslips')
  @RequirePermission('payroll.payslips.read')
  @Header('Cache-Control', 'no-store')
  async listOwn(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ payslips: OwnPayslipView[] }> {
    assertAgency(agencyId, context);
    return { payslips: await translate(context, () => this.reading.listOwn(context)) };
  }

  /** One of the caller's own RELEASED Payslips, with a link to its PDF. */
  @Get(':agencyId/payslips/:payslipId')
  @RequirePermission('payroll.payslips.read')
  @Header('Cache-Control', 'no-store')
  async readOwn(
    @Param('agencyId') agencyId: string,
    @Param('payslipId') payslipId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OwnPayslipDetail> {
    const id = this.parsePayslip(agencyId, payslipId, context);
    return translate(context, () => this.reading.readOwn(context, id));
  }

  private parsePayslip(agencyId: string, payslipId: string, context: RequestContext): string {
    assertAgency(agencyId, context);
    return parseId(payslipId, context, 'PAYSLIP_NOT_FOUND', 'The Payslip');
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
    if (
      error instanceof PayslipsServiceError ||
      error instanceof PayrollPeriodsServiceError ||
      error instanceof DocumentsServiceError
    ) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}
