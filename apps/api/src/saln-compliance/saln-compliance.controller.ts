import {
  BadRequestException,
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
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { employeeIdSchema } from '../employees/employees.schemas';
import { SalnComplianceDto, SalnComplianceListDto } from './saln-compliance.dto';
import {
  salnComplianceCorrectionSchema,
  salnComplianceCreateSchema,
  salnComplianceIdSchema,
  salnComplianceUpdateSchema,
} from './saln-compliance.schemas';
import { SalnComplianceService, SalnComplianceServiceError } from './saln-compliance.service';

function translate(error: unknown, requestId: string): never {
  if (error instanceof SalnComplianceServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class SalnComplianceController {
  constructor(@Inject(SalnComplianceService) private readonly service: SalnComplianceService) {}

  @Get(':agencyId/employees/me/saln-compliance')
  @RequirePermission('personnel.saln_compliance.read')
  async listOwn(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceListDto> {
    const agency = agencyIdSchema.safeParse(agencyId);
    if (!agency.success || agency.data !== context.agencyId) throw this.notFound(context);
    try {
      const employeeId = await this.service.findOwnEmployeeId(context);
      if (!employeeId) throw this.notFound(context);
      const records = await this.service.list(context, employeeId);
      if (!records) throw this.notFound(context);
      return new SalnComplianceListDto(records);
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId/saln-compliance')
  @RequirePermission('personnel.saln_compliance.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceListDto> {
    const employee = this.validatedRouteIds(agencyId, employeeId, undefined, context).employeeId;
    try {
      const records = await this.service.list(context, employee);
      if (!records) throw this.notFound(context);
      return new SalnComplianceListDto(records);
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId/saln-compliance/history')
  @RequirePermission('personnel.saln_compliance.read')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceListDto> {
    const employee = this.validatedRouteIds(agencyId, employeeId, undefined, context).employeeId;
    try {
      const records = await this.service.history(context, employee);
      if (!records) throw this.notFound(context);
      return new SalnComplianceListDto(records);
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId/saln-compliance/:recordId')
  @RequirePermission('personnel.saln_compliance.read')
  async detail(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('recordId') recordId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceDto> {
    const ids = this.validatedRouteIds(agencyId, employeeId, recordId, context);
    try {
      const record = await this.service.findById(context, ids.employeeId, ids.recordId!);
      if (!record) throw this.notFound(context);
      return new SalnComplianceDto(record);
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/saln-compliance')
  @RequirePermission('personnel.saln_compliance.update')
  async create(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceDto> {
    const employee = this.validatedRouteIds(agencyId, employeeId, undefined, context).employeeId;
    const input = salnComplianceCreateSchema.safeParse(body);
    if (!input.success) throw this.invalid(context);
    try {
      return new SalnComplianceDto(await this.service.create(context, employee, input.data));
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/saln-compliance/:recordId/update')
  @RequirePermission('personnel.saln_compliance.update')
  async update(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceDto> {
    const ids = this.validatedRouteIds(agencyId, employeeId, recordId, context);
    const input = salnComplianceUpdateSchema.safeParse(body);
    if (!input.success) throw this.invalid(context);
    try {
      return new SalnComplianceDto(
        await this.service.update(context, ids.employeeId, ids.recordId!, input.data),
      );
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/saln-compliance/:recordId/correct')
  @RequirePermission('personnel.saln_compliance.update')
  async correct(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<SalnComplianceDto> {
    const ids = this.validatedRouteIds(agencyId, employeeId, recordId, context);
    const input = salnComplianceCorrectionSchema.safeParse(body);
    if (!input.success) throw this.invalid(context);
    try {
      return new SalnComplianceDto(
        await this.service.correct(context, ids.employeeId, ids.recordId!, input.data),
      );
    } catch (error: unknown) {
      translate(error, context.requestId);
    }
  }

  private validatedRouteIds(
    agencyId: string,
    employeeId: string,
    recordId: string | undefined,
    context: RequestContext,
  ) {
    const agency = agencyIdSchema.safeParse(agencyId);
    const employee = employeeIdSchema.safeParse(employeeId);
    const record = recordId ? salnComplianceIdSchema.safeParse(recordId) : null;
    if (
      !agency.success ||
      agency.data !== context.agencyId ||
      !employee.success ||
      (record && !record.success)
    )
      throw this.notFound(context);
    return { employeeId: employee.data, recordId: record?.data };
  }

  private invalid(context: RequestContext) {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter valid SALN compliance metadata only.',
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext) {
    return new HttpException(
      {
        error: {
          code: 'SALN_COMPLIANCE_NOT_FOUND',
          message: 'The SALN compliance record could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
