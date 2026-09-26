import {
  BadRequestException,
  Controller,
  Get,
  Header,
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
  DtrDocumentDetailDto,
  DtrDocumentListResponseDto,
  DtrGenerateResponseDto,
  DtrPeriodVersionListResponseDto,
  DtrPreviewDto,
} from './dtrs.dto';
import { DtrsService } from './dtrs.service';
import {
  DtrServiceError,
  dtrDocumentIdSchema,
  dtrListCurrentSchema,
  dtrListEmployeeSchema,
  dtrListPeriodSchema,
  dtrPeriodIdSchema,
  dtrPreviewEmployeeSchema,
  dtrVersionIdSchema,
} from './dtrs.types';

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
  if (error instanceof DtrServiceError) {
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
export class DtrsController {
  constructor(@Inject(DtrsService) private readonly service: DtrsService) {}

  @Get(':agencyId/attendance-periods/:attendancePeriodId/dtr-preview')
  @RequirePermission('attendance.days.read')
  async preview(
    @Param('agencyId') agencyId: string,
    @Param('attendancePeriodId') attendancePeriodId: string,
    @Query('employeeId') employeeId: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<DtrPreviewDto> {
    this.assertAgency(agencyId, context);
    const parsedPeriod = dtrPeriodIdSchema.safeParse(attendancePeriodId);
    const parsedEmployee = dtrPreviewEmployeeSchema.safeParse(employeeId);
    if (!parsedPeriod.success || !parsedEmployee.success) {
      throw this.invalidInput(
        [
          ...(parsedPeriod.success ? [] : parsedPeriod.error.issues),
          ...(parsedEmployee.success ? [] : parsedEmployee.error.issues),
        ],
        context,
      );
    }
    try {
      return new DtrPreviewDto(
        await this.service.preview(context, {
          attendancePeriodId: parsedPeriod.data,
          ...(parsedEmployee.data ? { employeeId: parsedEmployee.data } : {}),
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-periods/:attendancePeriodId/dtr-preview/print')
  @RequirePermission('attendance.days.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async printPreview(
    @Param('agencyId') agencyId: string,
    @Param('attendancePeriodId') attendancePeriodId: string,
    @Query('employeeId') employeeId: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<string> {
    this.assertAgency(agencyId, context);
    const parsedPeriod = dtrPeriodIdSchema.safeParse(attendancePeriodId);
    const parsedEmployee = dtrPreviewEmployeeSchema.safeParse(employeeId);
    if (!parsedPeriod.success || !parsedEmployee.success) {
      throw this.invalidInput(
        [
          ...(parsedPeriod.success ? [] : parsedPeriod.error.issues),
          ...(parsedEmployee.success ? [] : parsedEmployee.error.issues),
        ],
        context,
      );
    }
    try {
      return await this.service.renderPreview(context, {
        attendancePeriodId: parsedPeriod.data,
        ...(parsedEmployee.data ? { employeeId: parsedEmployee.data } : {}),
      });
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/attendance-period-versions')
  @RequirePermission('attendance.days.read')
  async listPeriodVersions(
    @Param('agencyId') agencyId: string,
    @Query('attendancePeriodId') attendancePeriodId: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<DtrPeriodVersionListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsed = dtrPeriodIdSchema.safeParse(attendancePeriodId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new DtrPeriodVersionListResponseDto(
        await this.service.listPeriodVersions(context, parsed.data),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/dtrs')
  @RequirePermission('attendance.reports.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('attendancePeriodId') attendancePeriodId: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('currentOnly') currentOnly: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<DtrDocumentListResponseDto> {
    this.assertAgency(agencyId, context);
    const parsedPeriod = dtrListPeriodSchema.safeParse(attendancePeriodId);
    const parsedEmployee = dtrListEmployeeSchema.safeParse(employeeId);
    const parsedCurrent = dtrListCurrentSchema.safeParse(currentOnly);
    const parsedLimit =
      limit === undefined
        ? { success: true as const, data: undefined }
        : /^\d{1,3}$/.test(limit)
          ? { success: true as const, data: Number(limit) }
          : { success: false as const };
    if (
      !parsedPeriod.success ||
      !parsedEmployee.success ||
      !parsedCurrent.success ||
      !parsedLimit.success
    ) {
      throw this.invalidInput(
        [
          ...(parsedPeriod.success ? [] : parsedPeriod.error.issues),
          ...(parsedEmployee.success ? [] : parsedEmployee.error.issues),
          ...(parsedCurrent.success ? [] : parsedCurrent.error.issues),
          ...(parsedLimit.success ? [] : [{ path: ['limit'], message: 'Invalid limit.' }]),
        ],
        context,
      );
    }
    try {
      return new DtrDocumentListResponseDto(
        await this.service.list(context, {
          ...(parsedPeriod.data ? { attendancePeriodId: parsedPeriod.data } : {}),
          ...(parsedEmployee.data ? { employeeId: parsedEmployee.data } : {}),
          ...(parsedCurrent.data ? { currentOnly: parsedCurrent.data === 'true' } : {}),
          ...(parsedLimit.data ? { limit: parsedLimit.data } : {}),
        }),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/dtrs/:dtrDocumentId')
  @RequirePermission('attendance.reports.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('dtrDocumentId') dtrDocumentId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<DtrDocumentDetailDto> {
    this.assertAgency(agencyId, context);
    const parsed = dtrDocumentIdSchema.safeParse(dtrDocumentId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new DtrDocumentDetailDto(await this.service.findById(context, parsed.data));
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/dtrs/:dtrDocumentId/print')
  @RequirePermission('attendance.reports.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async print(
    @Param('agencyId') agencyId: string,
    @Param('dtrDocumentId') dtrDocumentId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<string> {
    this.assertAgency(agencyId, context);
    const parsed = dtrDocumentIdSchema.safeParse(dtrDocumentId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.service.render(context, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/attendance-period-versions/:versionId/dtrs')
  @RequirePermission('attendance.dtr.generate')
  async generate(
    @Param('agencyId') agencyId: string,
    @Param('versionId') versionId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<DtrGenerateResponseDto> {
    this.assertAgency(agencyId, context);
    const parsed = dtrVersionIdSchema.safeParse(versionId);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new DtrGenerateResponseDto(await this.service.generate(context, parsed.data));
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
            code: 'DTR_NOT_FOUND',
            message: 'The requested Finalized Daily Time Record could not be found.',
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
