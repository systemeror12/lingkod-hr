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
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  AttendancePayrollPublicationDetailDto,
  AttendancePeriodLockResponseDto,
  AttendancePeriodReconciliationDto,
  AttendancePeriodVersionDetailDto,
  AttendancePeriodVersionListResponseDto,
} from './attendance-periods.dto';
import { AttendancePeriodsService } from './attendance-periods.service';
import {
  AttendancePeriodServiceError,
  attendancePeriodDecisionSchema,
  attendancePeriodIdempotencyKeySchema,
  attendancePeriodIdSchema,
  attendancePeriodReturnSchema,
  attendancePeriodVersionIdSchema,
} from './attendance-periods.types';

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
  if (error instanceof AttendancePeriodServiceError) {
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
export class AttendancePeriodsController {
  constructor(
    @Inject(AttendancePeriodsService) private readonly service: AttendancePeriodsService,
  ) {}

  @Get(':agencyId/attendance-periods/:attendancePeriodId/versions')
  @RequirePermission('attendance.reports.read')
  async listVersions(
    @Param('agencyId') agencyId: string,
    @Param('attendancePeriodId') attendancePeriodId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodVersionListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendancePeriodIdSchema.safeParse(attendancePeriodId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendancePeriodVersionListResponseDto(
        await this.service.list(context, { attendancePeriodId: parsed.data }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-periods/:attendancePeriodId/versions')
  @RequirePermission('attendance.periods.submit')
  async submitForReview(
    @Param('agencyId') agencyId: string,
    @Param('attendancePeriodId') attendancePeriodId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodVersionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendancePeriodIdSchema.safeParse(attendancePeriodId);
    const parsedKey = attendancePeriodIdempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    if (idempotencyKey !== undefined && !parsedKey.success) {
      throw this.invalidInput(parsedKey.error.issues, context);
    }
    try {
      return new AttendancePeriodVersionDetailDto(
        await this.service.submitForReview(
          context,
          parsed.data,
          parsedKey.success ? parsedKey.data : undefined,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-period-versions/:versionId')
  @RequirePermission('attendance.reports.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodVersionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendancePeriodVersionIdSchema.safeParse(versionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendancePeriodVersionDetailDto(
        await this.service.findById(context, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-period-versions/:versionId/reconciliation')
  @RequirePermission('attendance.reports.read')
  async reconcile(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodReconciliationDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendancePeriodVersionIdSchema.safeParse(versionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendancePeriodReconciliationDto(
        await this.service.reconcile(context, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-period-versions/:versionId/return')
  @RequirePermission('attendance.periods.return')
  async returnForReason(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodVersionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsedId = attendancePeriodVersionIdSchema.safeParse(versionId);
    const parsedBody = attendancePeriodReturnSchema.safeParse(body);
    const parsedKey = attendancePeriodIdempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsedId.success) throw this.invalidInput(parsedId.error.issues, context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    if (idempotencyKey !== undefined && !parsedKey.success) {
      throw this.invalidInput(parsedKey.error.issues, context);
    }
    try {
      return new AttendancePeriodVersionDetailDto(
        await this.service.returnForReason(
          context,
          parsedId.data,
          parsedBody.data,
          parsedKey.success ? parsedKey.data : undefined,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-period-versions/:versionId/approve')
  @RequirePermission('attendance.periods.approve')
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodVersionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsedId = attendancePeriodVersionIdSchema.safeParse(versionId);
    const parsedBody = attendancePeriodDecisionSchema.safeParse(body ?? {});
    const parsedKey = attendancePeriodIdempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsedId.success) throw this.invalidInput(parsedId.error.issues, context);
    if (!parsedBody.success) throw this.invalidInput(parsedBody.error.issues, context);
    if (idempotencyKey !== undefined && !parsedKey.success) {
      throw this.invalidInput(parsedKey.error.issues, context);
    }
    try {
      return new AttendancePeriodVersionDetailDto(
        await this.service.approve(
          context,
          parsedId.data,
          parsedBody.data,
          parsedKey.success ? parsedKey.data : undefined,
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-period-versions/:versionId/lock')
  @RequirePermission('attendance.periods.lock')
  async lock(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePeriodLockResponseDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendancePeriodVersionIdSchema.safeParse(versionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendancePeriodLockResponseDto(await this.service.lock(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-period-versions/:versionId/publication')
  @RequirePermission('attendance.payroll_publications.read')
  async findPublication(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendancePayrollPublicationDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendancePeriodVersionIdSchema.safeParse(versionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendancePayrollPublicationDetailDto(
        await this.service.findPublication(context, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'ATTENDANCE_PERIOD_VERSION_NOT_FOUND',
            message: 'The requested Attendance Period Version could not be found.',
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
