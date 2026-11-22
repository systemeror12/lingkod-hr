import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  DisbursementOutcomesService,
  type DisbursementOutcomeView,
} from './disbursement-outcomes.service';
import {
  PaymentExportsService,
  PaymentExportsServiceError,
  type PaymentExportArtifact,
  type PaymentExportView,
} from './payment-exports.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PaymentExportsController {
  constructor(
    @Inject(PaymentExportsService) private readonly service: PaymentExportsService,
    @Inject(DisbursementOutcomesService)
    private readonly outcomes: DisbursementOutcomesService,
  ) {}

  /** Generate the Payment Export of a FINALIZED period; generating again returns the same one. */
  @Post(':agencyId/payroll-periods/:periodId/payment-exports')
  @RequirePermission('payroll.payment_exports.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ export: PaymentExportView }> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period');
    return { export: await translate(context, () => this.service.generate(context, id)) };
  }

  /** Download the versioned UTF-8 CSV with full destination details; audited. */
  @Get(':agencyId/payroll-periods/:periodId/payment-exports/:exportId/csv')
  @RequirePermission('payroll.payment_exports.generate')
  @Header('Cache-Control', 'no-store')
  async downloadCsv(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<StreamableFile> {
    const [period, paymentExport] = this.parse(agencyId, periodId, exportId, context);
    return file(
      await translate(context, () => this.service.downloadCsv(context, period, paymentExport)),
    );
  }

  /** Download the reconciliation summary with masked account numbers; audited. */
  @Get(':agencyId/payroll-periods/:periodId/payment-exports/:exportId/summary')
  @RequirePermission('payroll.payment_exports.generate')
  @Header('Cache-Control', 'no-store')
  async downloadSummary(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<StreamableFile> {
    const [period, paymentExport] = this.parse(agencyId, periodId, exportId, context);
    return file(
      await translate(context, () => this.service.downloadSummary(context, period, paymentExport)),
    );
  }

  /**
   * Retry a REJECTED or RETURNED Payment Instruction to its Employee's corrected
   * destination: a superseding Payment Export with one linked new instruction.
   */
  @Post(
    ':agencyId/payroll-periods/:periodId/payment-exports/:exportId/instructions/:instructionId/retries',
  )
  @RequirePermission('payroll.payment_exports.generate')
  async retry(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @Param('instructionId') instructionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ export: PaymentExportView }> {
    const target = this.parseInstruction(agencyId, periodId, exportId, instructionId, context);
    return { export: await translate(context, () => this.service.retry(context, target, body)) };
  }

  /** Record a Payment Instruction's next Disbursement Outcome; claims DISBURSEMENT on the period. */
  @Post(
    ':agencyId/payroll-periods/:periodId/payment-exports/:exportId/instructions/:instructionId/disbursement-outcomes',
  )
  @RequirePermission('payroll.disbursement.update')
  async recordOutcome(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @Param('instructionId') instructionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ outcome: DisbursementOutcomeView }> {
    const target = this.parseInstruction(agencyId, periodId, exportId, instructionId, context);
    return {
      outcome: await translate(context, () => this.outcomes.record(context, target, body)),
    };
  }

  private parseInstruction(
    agencyId: string,
    periodId: string,
    exportId: string,
    instructionId: string,
    context: RequestContext,
  ) {
    const [period, paymentExport] = this.parse(agencyId, periodId, exportId, context);
    const instruction = parseId(
      instructionId,
      context,
      'PAYMENT_INSTRUCTION_NOT_FOUND',
      'The Payment Instruction',
    );
    return { periodId: period, exportId: paymentExport, instructionId: instruction };
  }

  private parse(
    agencyId: string,
    periodId: string,
    exportId: string,
    context: RequestContext,
  ): [string, string] {
    assertAgency(agencyId, context);
    return [
      parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period'),
      parseId(exportId, context, 'PAYMENT_EXPORT_NOT_FOUND', 'The Payment Export'),
    ];
  }
}

function file(artifact: PaymentExportArtifact): StreamableFile {
  return new StreamableFile(Buffer.from(artifact.content, 'utf8'), {
    type: artifact.contentType,
    disposition: `attachment; filename="${artifact.fileName}"`,
  });
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
    if (error instanceof PaymentExportsServiceError) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}
