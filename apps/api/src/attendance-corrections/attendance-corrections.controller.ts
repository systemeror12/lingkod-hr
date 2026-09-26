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
  AttendanceCorrectionDetailDto,
  AttendanceCorrectionListResponseDto,
} from './attendance-corrections.dto';
import {
  AttendanceCorrectionServiceError,
  attendanceCorrectionCreateSchema,
  attendanceCorrectionDecisionSchema,
  attendanceCorrectionIdSchema,
  attendanceCorrectionIdempotencyKeySchema,
  attendanceCorrectionListSchema,
  attendanceCorrectionReasonSchema,
} from './attendance-corrections.types';
import { AttendanceCorrectionsService } from './attendance-corrections.service';

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
  if (error instanceof AttendanceCorrectionServiceError) {
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
export class AttendanceCorrectionsController {
  constructor(
    @Inject(AttendanceCorrectionsService) private readonly service: AttendanceCorrectionsService,
  ) {}

  @Post(':agencyId/attendance-corrections')
  @RequirePermission('attendance.corrections.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(
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

  @Get(':agencyId/attendance-corrections')
  @RequirePermission('attendance.days.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionListSchema.safeParse(query);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceCorrectionListResponseDto(await this.service.list(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-corrections/:correctionId')
  @RequirePermission('attendance.days.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(await this.service.findById(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-corrections/:correctionId/preview')
  @RequirePermission('attendance.corrections.create')
  async preview(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(await this.service.preview(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-corrections/:correctionId/submit')
  @RequirePermission('attendance.corrections.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(
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

  @Post(':agencyId/attendance-corrections/:correctionId/return')
  @RequirePermission('attendance.corrections.return')
  async returnForInformation(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceCorrectionDecisionSchema.safeParse(body);
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    if (!decision.data.comments) throw this.reasonRequired(context);
    try {
      return new AttendanceCorrectionDetailDto(
        await this.service.returnForInformation(
          context,
          parsed.data,
          decision.data.comments,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-corrections/:correctionId/reject')
  @RequirePermission('attendance.corrections.reject')
  async reject(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceCorrectionDecisionSchema.safeParse(body);
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    if (!decision.data.comments) throw this.reasonRequired(context);
    try {
      return new AttendanceCorrectionDetailDto(
        await this.service.reject(
          context,
          parsed.data,
          decision.data.comments,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-corrections/:correctionId/approve')
  @RequirePermission('attendance.corrections.approve')
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceCorrectionDecisionSchema.safeParse(body ?? {});
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(
        await this.service.approve(
          context,
          parsed.data,
          decision.data.comments,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-corrections/:correctionId/authorize-locked')
  @RequirePermission('attendance.corrections.authorize_locked')
  async authorizeLocked(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const decision = attendanceCorrectionDecisionSchema.safeParse(body ?? {});
    if (!decision.success) throw this.invalidInput(decision.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(
        await this.service.authorizeLocked(
          context,
          parsed.data,
          decision.data.comments,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-corrections/:correctionId/cancel')
  @RequirePermission('attendance.corrections.cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceCorrectionDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = attendanceCorrectionIdSchema.safeParse(correctionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const reason = attendanceCorrectionReasonSchema.safeParse(body);
    if (!reason.success) throw this.invalidInput(reason.error.issues, context);
    try {
      return new AttendanceCorrectionDetailDto(
        await this.service.cancel(
          context,
          parsed.data,
          reason.data.reason,
          this.idempotencyKey(idempotencyKey, context),
        ),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private idempotencyKey(value: string | undefined, context: RequestContext): string | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = attendanceCorrectionIdempotencyKeySchema.safeParse(value);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    return parsed.data;
  }

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'ATTENDANCE_CORRECTION_NOT_FOUND',
            message: 'The requested Attendance Correction could not be found.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
  }

  private reasonRequired(context: RequestContext): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED',
        message: 'A reason is required.',
        requestId: context.requestId,
      },
    });
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
