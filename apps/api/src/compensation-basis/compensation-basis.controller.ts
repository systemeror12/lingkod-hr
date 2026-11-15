import { Controller, Get, HttpException, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { z } from 'zod';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { PersonnelSalaryFactsError } from '../personnel-salary-facts/personnel-salary-facts.types';
import {
  CompensationBasisError,
  CompensationBasisService,
  READ_PERMISSION,
  type CompensationBasis,
} from './compensation-basis.service';

const rangeSchema = z.object({ from: z.string(), to: z.string() });

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class CompensationBasisController {
  constructor(
    @Inject(CompensationBasisService) private readonly service: CompensationBasisService,
  ) {}

  /** `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both inclusive. */
  @Get(':agencyId/employees/:employeeId/compensation-basis')
  @RequirePermission(READ_PERMISSION)
  async read(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Query() query: Record<string, unknown>,
    @CurrentContext() context: RequestContext,
  ): Promise<CompensationBasis> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) {
      throw failure(404, 'AGENCY_NOT_FOUND', 'The Agency could not be found.', context);
    }
    if (!z.uuid().safeParse(employeeId).success) {
      throw failure(
        404,
        'PERSONNEL_SALARY_FACTS_EMPLOYEE_NOT_FOUND',
        'The Employee does not belong to this Agency.',
        context,
      );
    }
    const range = rangeSchema.safeParse(query);
    if (!range.success) {
      throw failure(
        400,
        'INVALID_INPUT',
        'Give the compensation basis range as from and to dates.',
        context,
      );
    }
    try {
      return await this.service.read(context, employeeId, range.data.from, range.data.to);
    } catch (error: unknown) {
      if (error instanceof CompensationBasisError || error instanceof PersonnelSalaryFactsError) {
        throw failure(error.statusCode, error.code, error.message, context);
      }
      throw error;
    }
  }
}

function failure(
  status: number,
  code: string,
  message: string,
  context: RequestContext,
): HttpException {
  return new HttpException({ error: { code, message, requestId: context.requestId } }, status);
}
