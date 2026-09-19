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
import { AttendanceContextDto, AttendanceContextListResponseDto } from './attendance-contexts.dto';
import {
  attendanceContextCoverageModeSchema,
  attendanceContextCreateSchema,
  attendanceContextEmployeeIdSchema,
  attendanceContextIdempotencyKeySchema,
  attendanceContextTypeSchema,
} from './attendance-contexts.schemas';
import { AttendanceContextsService } from './attendance-contexts.service';
import { AttendanceContextServiceError } from './attendance-contexts.types';

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
  if (error instanceof AttendanceContextServiceError) {
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
export class AttendanceContextsController {
  constructor(
    @Inject(AttendanceContextsService) private readonly service: AttendanceContextsService,
  ) {}

  @Get(':agencyId/attendance-contexts')
  @RequirePermission('attendance.contexts.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('contextType') contextType: string | undefined,
    @Query('coverageMode') coverageMode: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceContextListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedEmployeeId = attendanceContextEmployeeIdSchema.safeParse(employeeId);
    const parsedContextType = attendanceContextTypeSchema.safeParse(contextType);
    const parsedCoverageMode = attendanceContextCoverageModeSchema.safeParse(coverageMode);
    if (!parsedEmployeeId.success || !parsedContextType.success || !parsedCoverageMode.success) {
      throw this.invalidFilters(context);
    }
    try {
      return new AttendanceContextListResponseDto(
        await this.service.list(context, {
          employeeId: parsedEmployeeId.data,
          contextType: parsedContextType.data,
          coverageMode: parsedCoverageMode.data,
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-contexts')
  @RequirePermission('attendance.contexts.create')
  async record(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<AttendanceContextDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = attendanceContextCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      return new AttendanceContextDto(await this.service.record(context, parsed.data, parsedKey));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = attendanceContextIdempotencyKeySchema.safeParse(value);
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
            code: 'ATTENDANCE_CONTEXT_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
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
        message: 'Enter supported Attendance Context values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private invalidFilters(context: RequestContext): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Attendance Context filters.',
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'ATTENDANCE_CONTEXT_NOT_FOUND',
          message: 'The requested Attendance Context could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
