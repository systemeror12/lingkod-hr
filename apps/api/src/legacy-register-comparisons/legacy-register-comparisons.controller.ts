import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  LegacyRegisterComparisonsService,
  LegacyRegisterComparisonsServiceError,
  type LegacyRegisterComparisonSummary,
  type LegacyRegisterComparisonView,
} from './legacy-register-comparisons.service';

/** A legacy register larger than this is refused before it is read. */
export const LEGACY_REGISTER_MAX_BYTES = 5 * 1024 * 1024;

const idSchema = z.uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class LegacyRegisterComparisonsController {
  constructor(
    @Inject(LegacyRegisterComparisonsService)
    private readonly service: LegacyRegisterComparisonsService,
  ) {}

  /**
   * Compare the uploaded legacy register CSV, multipart field `file`, with a
   * FINALIZED period. A rejected file answers 400 with every reason by line.
   */
  @Post(':agencyId/payroll-periods/:periodId/legacy-register-comparisons')
  @RequirePermission('payroll.legacy_registers.compare')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: LEGACY_REGISTER_MAX_BYTES, files: 1 },
    }),
  )
  async compare(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<{ comparison: LegacyRegisterComparisonView }> {
    const period = this.periodOf(agencyId, periodId, context);
    if (!file) {
      throw failure(context, 400, 'INVALID_INPUT', 'Attach the legacy register as the file field.');
    }
    return this.run(context, async () => ({
      comparison: await this.service.compare(context, period, file.buffer),
    }));
  }

  /** The Agency's comparisons of every period, newest first, without their differences. */
  @Get(':agencyId/legacy-register-comparisons')
  @RequirePermission('payroll.legacy_registers.compare')
  async listForAgency(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ comparisons: LegacyRegisterComparisonSummary[] }> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(context, 404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.');
    }
    return this.run(context, async () => ({
      comparisons: await this.service.listForAgency(context),
    }));
  }

  @Get(':agencyId/payroll-periods/:periodId/legacy-register-comparisons')
  @RequirePermission('payroll.legacy_registers.compare')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ comparisons: LegacyRegisterComparisonSummary[] }> {
    const period = this.periodOf(agencyId, periodId, context);
    return this.run(context, async () => ({
      comparisons: await this.service.list(context, period),
    }));
  }

  @Get(':agencyId/payroll-periods/:periodId/legacy-register-comparisons/:comparisonId')
  @RequirePermission('payroll.legacy_registers.compare')
  async get(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('comparisonId') comparisonId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ comparison: LegacyRegisterComparisonView }> {
    const period = this.periodOf(agencyId, periodId, context);
    const comparison = idSchema.safeParse(comparisonId);
    if (!comparison.success) {
      throw failure(
        context,
        404,
        'LEGACY_REGISTER_COMPARISON_NOT_FOUND',
        'The Legacy Register Comparison could not be found.',
      );
    }
    return this.run(context, async () => ({
      comparison: await this.service.get(context, period, comparison.data),
    }));
  }

  private periodOf(agencyId: string, periodId: string, context: RequestContext): string {
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

  private async run<T>(context: RequestContext, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof LegacyRegisterComparisonsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message, error.issues);
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
  issues?: unknown[],
): HttpException {
  return new HttpException(
    { error: { code, message, requestId: context.requestId, ...(issues ? { issues } : {}) } },
    status,
  );
}
