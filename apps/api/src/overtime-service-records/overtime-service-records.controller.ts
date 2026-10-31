import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { AttendanceLockedDayError } from '../attendance-locked-days/attendance-locked-days.types';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import {
  overtimeServiceCertificationSchema,
  overtimeServiceDeclineSchema,
  overtimeServiceRecordIdSchema,
  overtimeServiceRecordSchema,
} from './overtime-service-records.schemas';
import { OvertimeServiceRecordsService } from './overtime-service-records.service';
import {
  OvertimeServiceRecordError,
  type OvertimeServiceRecordSummary,
} from './overtime-service-records.types';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function invalidInput(
  issues: readonly { path: PropertyKey[]; message: string }[],
  requestId: string,
) {
  return new BadRequestException({
    error: {
      code: 'INVALID_INPUT',
      message: 'Enter supported Overtime Service Record values.',
      fields: validationFields(issues),
      requestId,
    },
  });
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof OvertimeServiceRecordError || error instanceof AttendanceLockedDayError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class OvertimeServiceRecordsController {
  constructor(
    @Inject(OvertimeServiceRecordsService)
    private readonly service: OvertimeServiceRecordsService,
  ) {}

  @Post(':agencyId/overtime-service-records')
  @RequirePermission('overtime.service.record')
  async record(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeServiceRecordSummary> {
    this.assertWriteAgency(agencyId, context);
    const parsed = overtimeServiceRecordSchema.safeParse(body);
    if (!parsed.success) throw invalidInput(parsed.error.issues, context.requestId);
    try {
      return await this.service.record(context, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-service-records/:recordId/submit')
  @RequirePermission('overtime.service.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('recordId') recordId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeServiceRecordSummary> {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRecordId(recordId, context);
    try {
      return await this.service.submit(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-service-records/:recordId/certify')
  @RequirePermission('overtime.service.certify')
  async certify(
    @Param('agencyId') agencyId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeServiceRecordSummary> {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRecordId(recordId, context);
    const parsed = overtimeServiceCertificationSchema.safeParse(body);
    if (!parsed.success) throw invalidInput(parsed.error.issues, context.requestId);
    try {
      return await this.service.certify(context, id, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-service-records/:recordId/decline')
  @RequirePermission('overtime.service.reject')
  async decline(
    @Param('agencyId') agencyId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeServiceRecordSummary> {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRecordId(recordId, context);
    const parsed = overtimeServiceDeclineSchema.safeParse(body);
    if (!parsed.success) throw invalidInput(parsed.error.issues, context.requestId);
    try {
      return await this.service.decline(context, id, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseRecordId(recordId: string, context: RequestContext): string {
    const parsed = overtimeServiceRecordIdSchema.safeParse(recordId);
    if (parsed.success) return parsed.data;
    throw new HttpException(
      {
        error: {
          code: 'OVERTIME_SERVICE_RECORD_NOT_FOUND',
          message: 'The Overtime Service Record could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'OVERTIME_SERVICE_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }
}
