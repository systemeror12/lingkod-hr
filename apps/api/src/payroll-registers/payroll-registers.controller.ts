import {
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
import {
  PayrollRegistersService,
  PayrollRegistersServiceError,
  type PayrollRegisterFile,
  type PayrollRegisterView,
} from './payroll-registers.service';

const idSchema = z.string().uuid();

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class PayrollRegistersController {
  constructor(@Inject(PayrollRegistersService) private readonly service: PayrollRegistersService) {}

  /** Generate the Payroll Register of a FINALIZED period; generating again returns the same one. */
  @Post(':agencyId/payroll-periods/:periodId/register')
  @RequirePermission('payroll.registers.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ register: PayrollRegisterView }> {
    const id = parsePeriod(agencyId, periodId, context);
    return { register: await translate(context, () => this.service.generate(context, id)) };
  }

  /** The period's Payroll Register, or null when none has been generated. */
  @Get(':agencyId/payroll-periods/:periodId/register')
  @RequirePermission('payroll.registers.generate')
  @Header('Cache-Control', 'no-store')
  async read(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ register: PayrollRegisterView | null }> {
    const id = parsePeriod(agencyId, periodId, context);
    return { register: await translate(context, () => this.service.read(context, id)) };
  }

  /** A short-lived signed link to the register's PDF; issuing it is audited. */
  @Get(':agencyId/payroll-periods/:periodId/register/file')
  @RequirePermission('payroll.registers.generate')
  @Header('Cache-Control', 'no-store')
  async file(
    @Param('agencyId') agencyId: string,
    @Param('periodId') periodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ file: PayrollRegisterFile }> {
    const id = parsePeriod(agencyId, periodId, context);
    return { file: await translate(context, () => this.service.file(context, id)) };
  }
}

function parsePeriod(agencyId: string, periodId: string, context: RequestContext): string {
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

async function translate<T>(context: RequestContext, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof PayrollRegistersServiceError || error instanceof DocumentsServiceError) {
      throw failure(context, error.statusCode, error.code, error.message);
    }
    throw error;
  }
}

function failure(context: RequestContext, status: number, code: string, message: string) {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
