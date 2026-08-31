import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { EmployeeDetailDto, EmployeeDto, EmployeeListResponseDto } from './employees.dto';
import {
  employeeCreateSchema,
  employeeIdSchema,
  employeeMembershipLinkSchema,
} from './employees.schemas';
import { EmployeeServiceError, EmployeesService } from './employees.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof EmployeeServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class EmployeesController {
  constructor(
    @Inject(EmployeesService)
    private readonly service: EmployeesService,
  ) {}

  @Get(':agencyId/employees')
  @RequirePermission('personnel.employees.read')
  async list(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new EmployeeListResponseDto(await this.service.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees')
  @RequirePermission('personnel.employees.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = employeeCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new EmployeeDto(await this.service.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/employees/:employeeId')
  @RequirePermission('personnel.employees.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = employeeIdSchema.safeParse(employeeId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data);
      if (!detail) throw this.notFound(context);
      return new EmployeeDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/employees/:employeeId/membership-link')
  @RequirePermission('personnel.employees.update')
  async linkMembership(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = employeeIdSchema.safeParse(employeeId);
    const parsed = employeeMembershipLinkSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) {
      throw this.invalidInput(
        parsed.error.issues,
        context,
        'Select the Agency Membership that represents this Employee.',
      );
    }
    try {
      return new EmployeeDetailDto(
        await this.service.linkMembership(context, parsedId.data, parsed.data.membershipId),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Delete(':agencyId/employees/:employeeId/membership-link')
  @RequirePermission('personnel.employees.update')
  async unlinkMembership(
    @Param('agencyId') agencyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<EmployeeDetailDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = employeeIdSchema.safeParse(employeeId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new EmployeeDetailDto(await this.service.unlinkMembership(context, parsedId.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private assertReadAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) throw this.notFound(context);
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'EMPLOYEE_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
    message = 'Enter supported Employee identity values.',
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message,
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'EMPLOYEE_NOT_FOUND',
          message: 'The Employee could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
