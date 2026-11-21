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
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { PayrollApprovalService } from './payroll-approval.service';
import { PayrollCertificationService } from './payroll-certification.service';
import {
  PayrollCheckpointReviewService,
  type PayrollCheckpointReviewResult,
} from './payroll-checkpoint-review.service';
import {
  PayrollPeriodsService,
  PayrollPeriodsServiceError,
  type PayrollPeriodDetail,
  type PayrollPeriodSummary,
} from './payroll-periods.service';
import {
  PayrollReviewExportService,
  type CertifiedPayrollReviewExportView,
} from './payroll-review-export.service';

const periodIdSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollPeriodsController {
  constructor(
    @Inject(PayrollPeriodsService) private readonly service: PayrollPeriodsService,
    @Inject(PayrollCertificationService)
    private readonly certification: PayrollCertificationService,
    @Inject(PayrollReviewExportService)
    private readonly reviewExport: PayrollReviewExportService,
    @Inject(PayrollCheckpointReviewService)
    private readonly checkpointReview: PayrollCheckpointReviewService,
    @Inject(PayrollApprovalService) private readonly approval: PayrollApprovalService,
  ) {}

  @Get(':agencyId/payroll-periods/:periodId')
  @RequirePermission('payroll.periods.read')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodDetail }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return { period: await translate(context, () => this.service.read(context, id)) };
  }

  @Post(':agencyId/payroll-periods')
  @RequirePermission('payroll.periods.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    return { period: await translate(context, () => this.service.create(context, body)) };
  }

  @Post(':agencyId/payroll-periods/:periodId/cutoff')
  @RequirePermission('payroll.periods.create')
  async moveCutoff(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return { period: await translate(context, () => this.service.moveCutoff(context, id, body)) };
  }

  @Post(':agencyId/payroll-periods/:periodId/cancel')
  @RequirePermission('payroll.periods.create')
  async cancelDraft(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return { period: await translate(context, () => this.service.cancelDraft(context, id, body)) };
  }

  @Post(':agencyId/payroll-periods/:periodId/calculate')
  @RequirePermission('payroll.periods.calculate')
  async startCalculation(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return {
      period: await translate(context, () => this.service.startCalculation(context, id, body)),
    };
  }

  @Post(':agencyId/payroll-periods/:periodId/certify')
  @RequirePermission('payroll.periods.certify')
  async certify(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return {
      period: await translate(context, () => this.certification.certify(context, id, body)),
    };
  }

  @Post(':agencyId/payroll-periods/:periodId/revoke-certification')
  @RequirePermission('payroll.periods.revoke_certification')
  async revokeCertification(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return {
      period: await translate(context, () =>
        this.certification.revokeCertification(context, id, body),
      ),
    };
  }

  @Post(':agencyId/payroll-periods/:periodId/return')
  @RequirePermission('payroll.periods.return')
  async returnForCorrection(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return {
      period: await translate(context, () =>
        this.certification.returnForCorrection(context, id, body),
      ),
    };
  }

  @Post(':agencyId/payroll-periods/:periodId/approve')
  @RequirePermission('payroll.periods.approve')
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return { period: await translate(context, () => this.approval.approve(context, id, body)) };
  }

  @Post(':agencyId/payroll-periods/:periodId/return-approved')
  @RequirePermission('payroll.periods.return_approved')
  async returnBeforeFinalization(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ period: PayrollPeriodSummary }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    return {
      period: await translate(context, () =>
        this.approval.returnBeforeFinalization(context, id, body),
      ),
    };
  }

  /** Read a Certified Payroll Review Export; the period detail names the current one. */
  @Get(':agencyId/payroll-periods/:periodId/review-exports/:exportId')
  @RequirePermission('payroll.periods.read')
  async readReviewExport(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ export: CertifiedPayrollReviewExportView }> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    const parsedExportId = parseExportId(exportId, context);
    return {
      export: await translate(context, () => this.reviewExport.read(context, id, parsedExportId)),
    };
  }

  /** Confirm or return the Budget checkpoint review of the named, current export. */
  @Post(':agencyId/payroll-periods/:periodId/review-exports/:exportId/budget-review')
  @RequirePermission('payroll.periods.review_funding')
  async recordBudgetReview(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollCheckpointReviewResult> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    const parsedExportId = parseExportId(exportId, context);
    return translate(context, () =>
      this.checkpointReview.record(context, 'BUDGET', id, parsedExportId, body),
    );
  }

  /** Confirm or return the Accounting checkpoint review of the named, current export. */
  @Post(':agencyId/payroll-periods/:periodId/review-exports/:exportId/accounting-review')
  @RequirePermission('payroll.periods.review_accounting')
  async recordAccountingReview(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<PayrollCheckpointReviewResult> {
    assertAgency(agencyId, context);
    const id = parsePeriodId(periodId, context);
    const parsedExportId = parseExportId(exportId, context);
    return translate(context, () =>
      this.checkpointReview.record(context, 'ACCOUNTING', id, parsedExportId, body),
    );
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

function parsePeriodId(periodId: string, context: RequestContext): string {
  const id = periodIdSchema.safeParse(periodId);
  if (!id.success) {
    throw failure(
      context,
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
      'The Payroll Period could not be found.',
    );
  }
  return id.data;
}

function parseExportId(exportId: string, context: RequestContext): string {
  const id = periodIdSchema.safeParse(exportId);
  if (!id.success) {
    throw failure(
      context,
      404,
      'PAYROLL_REVIEW_EXPORT_NOT_FOUND',
      'The Certified Payroll Review Export could not be found.',
    );
  }
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
