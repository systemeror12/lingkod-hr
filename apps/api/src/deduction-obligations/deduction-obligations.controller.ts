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
import type { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { employeeIdSchema } from '../employees/employees.schemas';
import {
  changeDeductionObligationSchema,
  deductionObligationIdSchema,
  endDeductionObligationSchema,
  recordDeductionObligationSchema,
} from './deduction-obligations.schemas';
import {
  DeductionObligationsService,
  DeductionObligationsServiceError,
  type DeductionObligationSummary,
} from './deduction-obligations.service';

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class DeductionObligationsController {
  constructor(
    @Inject(DeductionObligationsService) private readonly service: DeductionObligationsService,
  ) {}

  @Get(':agencyId/employees/:employeeId/deduction-obligations')
  @RequirePermission('payroll.deductions.manage')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<{ obligations: DeductionObligationSummary[] }> {
    this.assertAgency(agencyId, context);
    const employee = employeeIdSchema.safeParse(employeeId);
    if (!employee.success) {
      throw failure(context, 404, 'EMPLOYEE_NOT_FOUND', 'The Employee could not be found.');
    }
    try {
      return { obligations: await this.service.list(context, employee.data) };
    } catch (error: unknown) {
      if (error instanceof DeductionObligationsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  @Post(':agencyId/employees/:employeeId/deduction-obligations')
  @RequirePermission('payroll.deductions.manage')
  async record(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ obligation: DeductionObligationSummary }> {
    this.assertAgency(agencyId, context);
    const employee = employeeIdSchema.safeParse(employeeId);
    if (!employee.success) {
      throw failure(context, 404, 'EMPLOYEE_NOT_FOUND', 'The Employee could not be found.');
    }
    const input = parse(recordDeductionObligationSchema, body, context);
    return this.run(context, () => this.service.record(context, employee.data, input));
  }

  @Post(':agencyId/deduction-obligations/:obligationId/change')
  @RequirePermission('payroll.deductions.manage')
  async change(
    @Param('agencyId') agencyId: string,
    @Param('obligationId') obligationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ obligation: DeductionObligationSummary }> {
    this.assertAgency(agencyId, context);
    const id = this.obligationId(obligationId, context);
    const input = parse(changeDeductionObligationSchema, body, context);
    return this.run(context, () => this.service.change(context, id, input));
  }

  @Post(':agencyId/deduction-obligations/:obligationId/end')
  @RequirePermission('payroll.deductions.manage')
  async end(
    @Param('agencyId') agencyId: string,
    @Param('obligationId') obligationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<{ obligation: DeductionObligationSummary }> {
    this.assertAgency(agencyId, context);
    const id = this.obligationId(obligationId, context);
    const input = parse(endDeductionObligationSchema, body, context);
    return this.run(context, () => this.service.end(context, id, input));
  }

  private async run(
    context: RequestContext,
    work: () => Promise<DeductionObligationSummary>,
  ): Promise<{ obligation: DeductionObligationSummary }> {
    try {
      return { obligation: await work() };
    } catch (error: unknown) {
      if (error instanceof DeductionObligationsServiceError) {
        throw failure(context, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(context, 404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.');
    }
  }

  private obligationId(value: string, context: RequestContext): string {
    const id = deductionObligationIdSchema.safeParse(value);
    if (!id.success) {
      throw failure(
        context,
        404,
        'DEDUCTION_OBLIGATION_NOT_FOUND',
        'The Deduction Obligation could not be found.',
      );
    }
    return id.data;
  }
}

function parse<T extends z.ZodType>(schema: T, body: unknown, context: RequestContext): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.map(String).join('.') || 'form';
    fields[field] ??= issue.message;
  }
  throw new HttpException(
    {
      error: {
        code: 'INVALID_INPUT',
        message: 'Check the Deduction Obligation fields.',
        requestId: context.requestId,
        fields,
      },
    },
    400,
  );
}

function failure(
  context: RequestContext,
  status: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
