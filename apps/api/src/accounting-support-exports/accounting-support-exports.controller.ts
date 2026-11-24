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
  AccountingSupportExportsService,
  AccountingSupportExportsServiceError,
  type AccountingSupportExportArtifact,
  type AccountingSupportExportView,
  type PayrollExportExternalOutcomeView,
} from './accounting-support-exports.service';

const idSchema = z.string().uuid();
const ROUTE = ':agencyId/payroll-periods/:periodId/accounting-support-exports';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AccountingSupportExportsController {
  constructor(
    @Inject(AccountingSupportExportsService)
    private readonly service: AccountingSupportExportsService,
  ) {}

  /** Generate the export of a FINALIZED period; generating again returns the same one. */
  @Post(ROUTE)
  @RequirePermission('payroll.accounting_exports.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ export: AccountingSupportExportView }> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period');
    return { export: await translate(context, () => this.service.generate(context, id)) };
  }

  /** The period's export with its outcomes, or null when none has been generated. */
  @Get(ROUTE)
  @RequirePermission('payroll.accounting_exports.generate')
  @Header('Cache-Control', 'no-store')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ export: AccountingSupportExportView | null }> {
    assertAgency(agencyId, context);
    const id = parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period');
    return { export: await translate(context, () => this.service.read(context, id)) };
  }

  /** Download the export as canonical JSON; audited, and not an outcome. */
  @Get(`${ROUTE}/:exportId/content`)
  @RequirePermission('payroll.accounting_exports.generate')
  @Header('Cache-Control', 'no-store')
  async downloadExport(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<StreamableFile> {
    const [period, id] = parse(agencyId, periodId, exportId, context);
    return file(await translate(context, () => this.service.downloadExport(context, period, id)));
  }

  /** Download the Employee Detail Companion, under its own permission; audited. */
  @Get(`${ROUTE}/:exportId/employee-detail`)
  @RequirePermission('payroll.export_detail.read')
  @Header('Cache-Control', 'no-store')
  async downloadEmployeeDetail(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<StreamableFile> {
    const [period, id] = parse(agencyId, periodId, exportId, context);
    return file(
      await translate(context, () => this.service.downloadEmployeeDetail(context, period, id)),
    );
  }

  /** Record a Payroll Export External Outcome against the export. */
  @Post(`${ROUTE}/:exportId/external-outcomes`)
  @RequirePermission('payroll.export_outcomes.record')
  async recordOutcome(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @Param('exportId') exportId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ outcome: PayrollExportExternalOutcomeView }> {
    const [period, id] = parse(agencyId, periodId, exportId, context);
    return {
      outcome: await translate(context, () =>
        this.service.recordOutcome(context, period, id, body),
      ),
    };
  }
}

function parse(
  agencyId: string,
  periodId: string,
  exportId: string,
  context: RequestContext,
): [string, string] {
  assertAgency(agencyId, context);
  return [
    parseId(periodId, context, 'PAYROLL_PERIOD_NOT_FOUND', 'The Payroll Period'),
    parseId(
      exportId,
      context,
      'PAYROLL_ACCOUNTING_EXPORT_NOT_FOUND',
      'The Finalized Payroll Accounting Support Export',
    ),
  ];
}

function file(artifact: AccountingSupportExportArtifact): StreamableFile {
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
    if (error instanceof AccountingSupportExportsServiceError) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}
