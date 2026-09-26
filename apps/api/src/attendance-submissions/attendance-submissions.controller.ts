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
  AttendanceSubmissionDetailDto,
  AttendanceSubmissionListResponseDto,
} from './attendance-submissions.dto';
import { AttendanceSubmissionsService } from './attendance-submissions.service';
import {
  AttendanceSubmissionServiceError,
  attendanceSubmissionApproveSchema,
  attendanceSubmissionCancelSchema,
  attendanceSubmissionIdSchema,
  attendanceSubmissionIdempotencyKeySchema,
  attendanceSubmissionListEmployeeSchema,
  attendanceSubmissionListPeriodSchema,
  attendanceSubmissionListStatusSchema,
  attendanceSubmissionReturnSchema,
  createAttendanceSubmissionSchema,
} from './attendance-submissions.types';

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
  if (error instanceof AttendanceSubmissionServiceError) {
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
export class AttendanceSubmissionsController {
  constructor(
    @Inject(AttendanceSubmissionsService)
    private readonly service: AttendanceSubmissionsService,
  ) {}

  @Post(':agencyId/attendance-submissions')
  @RequirePermission('attendance.submissions.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = createAttendanceSubmissionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceSubmissionDetailDto(
        await this.service.create(
          context,
          parsed.data,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-submissions')
  @RequirePermission('attendance.days.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('attendancePeriodId') attendancePeriodId: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedPeriod = attendanceSubmissionListPeriodSchema.safeParse(attendancePeriodId);
    const parsedEmployee = attendanceSubmissionListEmployeeSchema.safeParse(employeeId);
    const parsedStatus = attendanceSubmissionListStatusSchema.safeParse(status);
    const parsedLimit =
      limit === undefined
        ? { success: true as const, data: undefined }
        : /^\d{1,3}$/.test(limit)
          ? { success: true as const, data: Number(limit) }
          : { success: false as const };
    if (
      !parsedPeriod.success ||
      !parsedEmployee.success ||
      !parsedStatus.success ||
      !parsedLimit.success
    ) {
      throw this.invalidInput(
        [
          ...(parsedPeriod.success ? [] : parsedPeriod.error.issues),
          ...(parsedEmployee.success ? [] : parsedEmployee.error.issues),
          ...(parsedStatus.success ? [] : parsedStatus.error.issues),
          ...(parsedLimit.success ? [] : [{ path: ['limit'], message: 'Invalid limit.' }]),
        ],
        context,
      );
    }
    try {
      return new AttendanceSubmissionListResponseDto(
        await this.service.list(context, {
          ...(parsedPeriod.data ? { attendancePeriodId: parsedPeriod.data } : {}),
          ...(parsedEmployee.data ? { employeeId: parsedEmployee.data } : {}),
          ...(parsedStatus.data ? { status: parsedStatus.data } : {}),
          ...(parsedLimit.data ? { limit: parsedLimit.data } : {}),
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-submissions/:submissionId')
  @RequirePermission('attendance.days.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('submissionId') submissionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceSubmissionIdSchema.safeParse(submissionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceSubmissionDetailDto(await this.service.findById(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-submissions/:submissionId/submit')
  @RequirePermission('attendance.submissions.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('submissionId') submissionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceSubmissionIdSchema.safeParse(submissionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceSubmissionDetailDto(
        await this.service.submit(
          context,
          parsed.data,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-submissions/:submissionId/return')
  @RequirePermission('attendance.submissions.return')
  async returnForReason(
    @Param('agencyId') agencyId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceSubmissionIdSchema.safeParse(submissionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceSubmissionReturnSchema.safeParse(body);
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    try {
      return new AttendanceSubmissionDetailDto(
        await this.service.returnForReason(context, parsed.data, decision.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-submissions/:submissionId/approve')
  @RequirePermission('attendance.submissions.approve')
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceSubmissionIdSchema.safeParse(submissionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceSubmissionApproveSchema.safeParse(body ?? {});
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    try {
      return new AttendanceSubmissionDetailDto(
        await this.service.approve(
          context,
          parsed.data,
          decision.data,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-submissions/:submissionId/cancel')
  @RequirePermission('attendance.submissions.cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceSubmissionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceSubmissionIdSchema.safeParse(submissionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceSubmissionCancelSchema.safeParse(body ?? {});
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    try {
      return new AttendanceSubmissionDetailDto(
        await this.service.cancel(context, parsed.data, decision.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private idempotencyKey(value: string | undefined, context: RequestContext): string | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = attendanceSubmissionIdempotencyKeySchema.safeParse(value);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    return parsed.data;
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'ATTENDANCE_SUBMISSION_NOT_FOUND',
            message: 'The requested Employee Attendance Submission could not be found.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string; keys?: string[] }[],
    context: RequestContext,
  ): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'The request body is invalid.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }
}
