import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
  AttendanceClockStateDto,
  AttendanceEventCaptureResultDto,
  AttendanceEventListResponseDto,
  AttendanceWebClockStatusDto,
  AttendanceWorkDateContextDto,
} from './attendance.dto';
import {
  attendanceEventListQuerySchema,
  attendanceIdempotencyKeySchema,
  attendanceIdSchema,
  attendanceWebClockAsOfQuerySchema,
  attendanceWorkDateSchema,
  clockAttendanceEventSchema,
  manualAttendanceEventSchema,
  webClockEnablementSchema,
} from './attendance.schemas';
import { AttendanceService } from './attendance.service';
import { AttendanceServiceError, type CreateManualAttendanceEventInput } from './attendance.types';
import { AttendanceExceptionError } from '../attendance-configuration/attendance-configuration.types';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof AttendanceExceptionError) {
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          exceptionType: error.exceptionType,
          details: error.details,
        },
      },
      error.statusCode,
    );
  }
  if (error instanceof AttendanceServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  @Get(':agencyId/attendance/web-clock')
  @RequirePermission('attendance.configuration.read')
  async getWebClockStatus(
    @Param('agencyId') agencyId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceWebClockStatusDto> {
    this.assertReadAgency(agencyId, context);
    const parsedAsOf = attendanceWebClockAsOfQuerySchema.safeParse(asOf);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      return new AttendanceWebClockStatusDto(
        await this.attendance.getWebClockStatus(context, parsedAsOf.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance/web-clock/versions')
  @RequirePermission('attendance.configuration.activate')
  async setWebClockEnablement(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceWebClockStatusDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = webClockEnablementSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new AttendanceWebClockStatusDto(
        await this.attendance.setWebClockEnablement(context, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance/events')
  @RequirePermission('attendance.events.read')
  async listEvents(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceEventListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsed = attendanceEventListQuerySchema.safeParse(query);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceEventListResponseDto(
        await this.attendance.listEvents(context, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance/events/context')
  @RequirePermission('attendance.events.read')
  async getEventContext(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('workDate') workDate: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceWorkDateContextDto> {
    this.assertReadAgency(agencyId, context);
    const parsedEmployeeId = attendanceIdSchema.safeParse(employeeId);
    const parsedWorkDate = attendanceWorkDateSchema.safeParse(workDate);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (!parsedWorkDate.success) throw this.invalidInput(parsedWorkDate.error.issues, context);
    try {
      return new AttendanceWorkDateContextDto(
        await this.attendance.getEventContext(context, parsedEmployeeId.data, parsedWorkDate.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance/events')
  @RequirePermission('attendance.events.create_manual')
  async createManualEvent(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceEventCaptureResultDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = manualAttendanceEventSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new AttendanceEventCaptureResultDto(
        await this.attendance.captureManual(
          context,
          parsed.data as CreateManualAttendanceEventInput,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance/clock')
  @RequirePermission('attendance.events.clock')
  async getClockState(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceClockStateDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new AttendanceClockStateDto(await this.attendance.getClockState(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance/clock')
  @RequirePermission('attendance.events.clock')
  async clock(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceEventCaptureResultDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = clockAttendanceEventSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new AttendanceEventCaptureResultDto(
        await this.attendance.clock(context, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = attendanceIdempotencyKeySchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Enter a valid Idempotency-Key.',
          requestId,
        },
      });
    }
    return parsed.data;
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
            code: 'ATTENDANCE_WRITE_FORBIDDEN',
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
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Attendance values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'ATTENDANCE_NOT_FOUND',
          message: 'The requested Attendance record could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
