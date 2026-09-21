import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  AttendanceDayDetailDto,
  AttendanceDayListResponseDto,
  AttendancePeriodListResponseDto,
  CalculateAttendanceDaysResponseDto,
} from './attendance-days.dto';
import {
  attendanceDayDateSchema,
  attendanceDayEmployeeIdSchema,
  attendanceDayIdSchema,
  attendanceDayPeriodIdSchema,
  attendanceDayStatusSchema,
  calculateAttendanceDaysSchema,
} from './attendance-days.types';
import { AttendanceDaysService } from './attendance-days.service';
import { AttendanceDayServiceError } from './attendance-days.types';

function validationFields(
  issues: readonly { path: PropertyKey[]; message: string; keys?: string[] }[],
) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    for (const key of issue.keys ?? []) {
      if (fields[key] === undefined) fields[key] = issue.message;
    }
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof AttendanceDayServiceError) {
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.reasons.length > 0 ? { reasons: error.reasons } : {}),
          requestId,
        },
      },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AttendanceDaysController {
  constructor(@Inject(AttendanceDaysService) private readonly service: AttendanceDaysService) {}

  @Post(':agencyId/attendance-days/calculate')
  @RequirePermission('attendance.days.calculate')
  async calculate(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CalculateAttendanceDaysResponseDto> {
    this.assertAgency(agencyId, context);
    const parsed = calculateAttendanceDaysSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new CalculateAttendanceDaysResponseDto(
        await this.service.calculate(context, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-days')
  @RequirePermission('attendance.days.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('attendancePeriodId') attendancePeriodId: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('workDateFrom') workDateFrom: string | undefined,
    @Query('workDateTo') workDateTo: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceDayListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedPeriodId = attendanceDayPeriodIdSchema.safeParse(attendancePeriodId);
    const parsedEmployeeId = attendanceDayEmployeeIdSchema.safeParse(employeeId);
    const parsedStatus = attendanceDayStatusSchema.safeParse(status);
    const parsedFrom = attendanceDayDateSchema.safeParse(workDateFrom);
    const parsedTo = attendanceDayDateSchema.safeParse(workDateTo);
    const parsedLimit =
      limit === undefined
        ? { success: true as const, data: undefined }
        : /^\d{1,3}$/.test(limit)
          ? { success: true as const, data: Number(limit) }
          : { success: false as const };
    if (
      !parsedPeriodId.success ||
      !parsedEmployeeId.success ||
      !parsedStatus.success ||
      !parsedFrom.success ||
      !parsedTo.success ||
      !parsedLimit.success
    ) {
      throw this.invalidFilters(context);
    }
    try {
      return new AttendanceDayListResponseDto(
        await this.service.list(context, {
          attendancePeriodId: parsedPeriodId.data,
          employeeId: parsedEmployeeId.data,
          status: parsedStatus.data,
          workDateFrom: parsedFrom.data,
          workDateTo: parsedTo.data,
          limit: parsedLimit.data,
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-periods')
  @RequirePermission('attendance.days.read')
  async listPeriods(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodListResponseDto> {
    this.assertAgency(agencyId, context);
    try {
      return new AttendancePeriodListResponseDto(await this.service.listPeriods(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-days/:attendanceDayId')
  @RequirePermission('attendance.days.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('attendanceDayId') attendanceDayId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceDayDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceDayIdSchema.safeParse(attendanceDayId);
    if (!parsed.success) throw this.notFound(context);
    try {
      return new AttendanceDayDetailDto(await this.service.findById(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) throw this.notFound(context);
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string; keys?: string[] }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Attendance Day calculation values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private invalidFilters(context: RequestContext): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Attendance Day filters.',
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'ATTENDANCE_DAY_NOT_FOUND',
          message: 'The requested Attendance Day could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
