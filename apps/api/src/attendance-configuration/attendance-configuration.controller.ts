import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
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
  AttendanceResolutionDto,
  HolidayCalendarDetailDto,
  HolidayCalendarDto,
  HolidayCalendarListResponseDto,
  HolidayCalendarSuccessorDto,
  HolidayCalendarVersionDto,
  ScheduleAssignmentDto,
  ScheduleAssignmentListResponseDto,
  WorkArrangementDetailDto,
  WorkArrangementDto,
  WorkArrangementListResponseDto,
  WorkArrangementVersionDto,
  WorkScheduleDetailDto,
  WorkScheduleDto,
  WorkScheduleListResponseDto,
  WorkScheduleSuccessorDto,
  WorkScheduleVersionDto,
} from './attendance-configuration.dto';
import {
  attendanceConfigurationActivationSchema,
  attendanceConfigurationAsOfSchema,
  attendanceConfigurationIdSchema,
  attendanceConfigurationIdempotencyKeySchema,
  attendanceConfigurationWorkDateSchema,
  holidayCalendarCreateSchema,
  holidayCalendarDraftUpdateSchema,
  scheduleAssignmentCreateSchema,
  scheduleAssignmentEndSchema,
  workArrangementCreateSchema,
  workArrangementDraftUpdateSchema,
  workScheduleCreateSchema,
  workScheduleDraftUpdateSchema,
} from './attendance-configuration.schemas';
import {
  AttendanceConfigurationServiceError,
  AttendanceExceptionError,
  type ActivateAttendanceConfigurationInput,
} from './attendance-configuration.types';
import { HolidayCalendarsService } from './holiday-calendars.service';
import { ScheduleAssignmentsService } from './schedule-assignments.service';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

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
  if (error instanceof AttendanceConfigurationServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class AttendanceConfigurationController {
  constructor(
    @Inject(WorkSchedulesService) private readonly workSchedules: WorkSchedulesService,
    @Inject(WorkArrangementsService)
    private readonly workArrangements: WorkArrangementsService,
    @Inject(HolidayCalendarsService)
    private readonly holidayCalendars: HolidayCalendarsService,
    @Inject(ScheduleAssignmentsService)
    private readonly scheduleAssignments: ScheduleAssignmentsService,
  ) {}

  @Get(':agencyId/work-schedules')
  @RequirePermission('attendance.configuration.read')
  async listWorkSchedules(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkScheduleListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new WorkScheduleListResponseDto(await this.workSchedules.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/work-schedules/:workScheduleId')
  @RequirePermission('attendance.configuration.read')
  async findWorkSchedule(
    @Param('agencyId') agencyId: string,
    @Param('workScheduleId') workScheduleId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkScheduleDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(workScheduleId);
    const parsedAsOf = attendanceConfigurationAsOfSchema.safeParse(asOf);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      const detail = await this.workSchedules.findById(context, parsedId.data, parsedAsOf.data);
      if (!detail) throw this.notFound(context);
      return new WorkScheduleDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/work-schedules')
  @RequirePermission('attendance.configuration.manage')
  async createWorkSchedule(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkScheduleDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = workScheduleCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new WorkScheduleDto(await this.workSchedules.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/work-schedules/:workScheduleId/successor')
  @RequirePermission('attendance.configuration.manage')
  async createWorkScheduleSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('workScheduleId') workScheduleId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkScheduleSuccessorDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(workScheduleId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new WorkScheduleSuccessorDto(
        await this.workSchedules.createSuccessor(context, parsedId.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/work-schedules/:workScheduleId/drafts/:draftId')
  @RequirePermission('attendance.configuration.manage')
  async updateWorkScheduleDraft(
    @Param('agencyId') agencyId: string,
    @Param('workScheduleId') workScheduleId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkScheduleVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedScheduleId = attendanceConfigurationIdSchema.safeParse(workScheduleId);
    const parsedDraftId = attendanceConfigurationIdSchema.safeParse(draftId);
    const parsed = workScheduleDraftUpdateSchema.safeParse(body);
    if (!parsedScheduleId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new WorkScheduleVersionDto(
        await this.workSchedules.updateDraft(
          context,
          parsedScheduleId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/work-schedules/:workScheduleId/drafts/:draftId/activate')
  @RequirePermission('attendance.configuration.activate')
  async activateWorkSchedule(
    @Param('agencyId') agencyId: string,
    @Param('workScheduleId') workScheduleId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkScheduleDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedScheduleId = attendanceConfigurationIdSchema.safeParse(workScheduleId);
    const parsedDraftId = attendanceConfigurationIdSchema.safeParse(draftId);
    const parsed = attendanceConfigurationActivationSchema.safeParse(body);
    if (!parsedScheduleId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new WorkScheduleDto(
        await this.workSchedules.activate(
          context,
          parsedScheduleId.data,
          parsedDraftId.data,
          parsed.data as ActivateAttendanceConfigurationInput,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/work-arrangements')
  @RequirePermission('attendance.configuration.read')
  async listWorkArrangements(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkArrangementListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new WorkArrangementListResponseDto(await this.workArrangements.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/work-arrangements/:workArrangementId')
  @RequirePermission('attendance.configuration.read')
  async findWorkArrangement(
    @Param('agencyId') agencyId: string,
    @Param('workArrangementId') workArrangementId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkArrangementDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(workArrangementId);
    const parsedAsOf = attendanceConfigurationAsOfSchema.safeParse(asOf);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      const detail = await this.workArrangements.findById(context, parsedId.data, parsedAsOf.data);
      if (!detail) throw this.notFound(context);
      return new WorkArrangementDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/work-arrangements')
  @RequirePermission('attendance.configuration.manage')
  async createWorkArrangement(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkArrangementDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = workArrangementCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new WorkArrangementDto(await this.workArrangements.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/work-arrangements/:workArrangementId/successor')
  @RequirePermission('attendance.configuration.manage')
  async createWorkArrangementSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('workArrangementId') workArrangementId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkArrangementVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(workArrangementId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const successor = await this.workArrangements.createSuccessor(context, parsedId.data);
      return new WorkArrangementVersionDto(successor.draft);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/work-arrangements/:workArrangementId/drafts/:draftId')
  @RequirePermission('attendance.configuration.manage')
  async updateWorkArrangementDraft(
    @Param('agencyId') agencyId: string,
    @Param('workArrangementId') workArrangementId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkArrangementVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedArrangementId = attendanceConfigurationIdSchema.safeParse(workArrangementId);
    const parsedDraftId = attendanceConfigurationIdSchema.safeParse(draftId);
    const parsed = workArrangementDraftUpdateSchema.safeParse(body);
    if (!parsedArrangementId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new WorkArrangementVersionDto(
        await this.workArrangements.updateDraft(
          context,
          parsedArrangementId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/work-arrangements/:workArrangementId/drafts/:draftId/activate')
  @RequirePermission('attendance.configuration.activate')
  async activateWorkArrangement(
    @Param('agencyId') agencyId: string,
    @Param('workArrangementId') workArrangementId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<WorkArrangementDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedArrangementId = attendanceConfigurationIdSchema.safeParse(workArrangementId);
    const parsedDraftId = attendanceConfigurationIdSchema.safeParse(draftId);
    const parsed = attendanceConfigurationActivationSchema.safeParse(body);
    if (!parsedArrangementId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new WorkArrangementDto(
        await this.workArrangements.activate(
          context,
          parsedArrangementId.data,
          parsedDraftId.data,
          parsed.data as ActivateAttendanceConfigurationInput,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/holiday-calendars')
  @RequirePermission('attendance.configuration.read')
  async listHolidayCalendars(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<HolidayCalendarListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new HolidayCalendarListResponseDto(await this.holidayCalendars.list(context));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/holiday-calendars/:holidayCalendarId')
  @RequirePermission('attendance.configuration.read')
  async findHolidayCalendar(
    @Param('agencyId') agencyId: string,
    @Param('holidayCalendarId') holidayCalendarId: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<HolidayCalendarDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(holidayCalendarId);
    const parsedAsOf = attendanceConfigurationAsOfSchema.safeParse(asOf);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      const detail = await this.holidayCalendars.findById(context, parsedId.data, parsedAsOf.data);
      if (!detail) throw this.notFound(context);
      return new HolidayCalendarDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/holiday-calendars')
  @RequirePermission('attendance.configuration.manage')
  async createHolidayCalendar(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<HolidayCalendarDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = holidayCalendarCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new HolidayCalendarDto(await this.holidayCalendars.create(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/holiday-calendars/:holidayCalendarId/successor')
  @RequirePermission('attendance.configuration.manage')
  async createHolidayCalendarSuccessor(
    @Param('agencyId') agencyId: string,
    @Param('holidayCalendarId') holidayCalendarId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<HolidayCalendarSuccessorDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(holidayCalendarId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return new HolidayCalendarSuccessorDto(
        await this.holidayCalendars.createSuccessor(context, parsedId.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Patch(':agencyId/holiday-calendars/:holidayCalendarId/drafts/:draftId')
  @RequirePermission('attendance.configuration.manage')
  async updateHolidayCalendarDraft(
    @Param('agencyId') agencyId: string,
    @Param('holidayCalendarId') holidayCalendarId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<HolidayCalendarVersionDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedCalendarId = attendanceConfigurationIdSchema.safeParse(holidayCalendarId);
    const parsedDraftId = attendanceConfigurationIdSchema.safeParse(draftId);
    const parsed = holidayCalendarDraftUpdateSchema.safeParse(body);
    if (!parsedCalendarId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new HolidayCalendarVersionDto(
        await this.holidayCalendars.updateDraft(
          context,
          parsedCalendarId.data,
          parsedDraftId.data,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/holiday-calendars/:holidayCalendarId/drafts/:draftId/activate')
  @RequirePermission('attendance.configuration.activate')
  async activateHolidayCalendar(
    @Param('agencyId') agencyId: string,
    @Param('holidayCalendarId') holidayCalendarId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<HolidayCalendarDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedCalendarId = attendanceConfigurationIdSchema.safeParse(holidayCalendarId);
    const parsedDraftId = attendanceConfigurationIdSchema.safeParse(draftId);
    const parsed = attendanceConfigurationActivationSchema.safeParse(body);
    if (!parsedCalendarId.success || !parsedDraftId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new HolidayCalendarDto(
        await this.holidayCalendars.activate(
          context,
          parsedCalendarId.data,
          parsedDraftId.data,
          parsed.data as ActivateAttendanceConfigurationInput,
          parsedKey,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/schedule-assignments')
  @RequirePermission('attendance.configuration.read')
  async listScheduleAssignments(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('asOf') asOf: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<ScheduleAssignmentListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedEmployeeId =
      employeeId === undefined ? undefined : attendanceConfigurationIdSchema.safeParse(employeeId);
    const parsedAsOf = attendanceConfigurationAsOfSchema.safeParse(asOf);
    if (parsedEmployeeId && !parsedEmployeeId.success) throw this.notFound(context);
    if (!parsedAsOf.success) throw this.invalidInput(parsedAsOf.error.issues, context);
    try {
      return new ScheduleAssignmentListResponseDto(
        await this.scheduleAssignments.list(context, {
          employeeId: parsedEmployeeId?.data,
          asOf: parsedAsOf.data,
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/schedule-assignments/resolve')
  @RequirePermission('attendance.configuration.read')
  async resolveScheduleAssignment(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('workDate') workDate: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceResolutionDto> {
    this.assertReadAgency(agencyId, context);
    const parsedEmployeeId = attendanceConfigurationIdSchema.safeParse(employeeId);
    const parsedWorkDate = attendanceConfigurationWorkDateSchema.safeParse(workDate);
    if (!parsedEmployeeId.success) throw this.notFound(context);
    if (!parsedWorkDate.success) throw this.invalidInput(parsedWorkDate.error.issues, context);
    try {
      return new AttendanceResolutionDto(
        await this.scheduleAssignments.resolveForWorkDate(
          context,
          parsedEmployeeId.data,
          parsedWorkDate.data,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/schedule-assignments')
  @RequirePermission('attendance.assignments.manage')
  async createScheduleAssignment(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<ScheduleAssignmentDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = scheduleAssignmentCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new ScheduleAssignmentDto(
        await this.scheduleAssignments.create(context, parsed.data, parsedKey),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/schedule-assignments/:assignmentId/end')
  @RequirePermission('attendance.assignments.manage')
  async endScheduleAssignment(
    @Param('agencyId') agencyId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<ScheduleAssignmentDto> {
    this.assertWriteAgency(agencyId, context);
    const parsedId = attendanceConfigurationIdSchema.safeParse(assignmentId);
    const parsed = scheduleAssignmentEndSchema.safeParse(body);
    if (!parsedId.success) throw this.notFound(context);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new ScheduleAssignmentDto(
        await this.scheduleAssignments.end(context, parsedId.data, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = attendanceConfigurationIdempotencyKeySchema.safeParse(value);
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
            code: 'ATTENDANCE_CONFIGURATION_WRITE_FORBIDDEN',
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
        message: 'Enter supported Attendance configuration values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'ATTENDANCE_CONFIGURATION_NOT_FOUND',
          message: 'The requested Attendance configuration could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
