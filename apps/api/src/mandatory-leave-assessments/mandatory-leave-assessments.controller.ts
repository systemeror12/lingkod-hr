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
  MandatoryLeaveAgencyEvaluationDto,
  MandatoryLeaveAssessmentDetailDto,
  MandatoryLeaveAssessmentListResponseDto,
  MandatoryLeaveEmployeeLatestResponseDto,
} from './mandatory-leave-assessments.dto';
import {
  mandatoryLeaveAssessmentCursorParamSchema,
  mandatoryLeaveAssessmentEvaluateSchema,
  mandatoryLeaveAssessmentIdSchema,
  mandatoryLeaveAssessmentLimitSchema,
  mandatoryLeaveAssessmentResultSchema,
  mandatoryLeaveAssessmentYearSchema,
} from './mandatory-leave-assessments.schemas';
import {
  MandatoryLeaveAssessmentsService,
  MandatoryLeaveAssessmentServiceError,
  type MandatoryLeaveAssessmentFilters,
  type MandatoryLeaveAssessmentPageRequest,
} from './mandatory-leave-assessments.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof MandatoryLeaveAssessmentServiceError) {
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
export class MandatoryLeaveAssessmentsController {
  constructor(
    @Inject(MandatoryLeaveAssessmentsService)
    private readonly service: MandatoryLeaveAssessmentsService,
  ) {}

  @Get(':agencyId/mandatory-leave-assessments')
  @RequirePermission('leave.mandatory_assessments.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('year') year: string | undefined,
    @Query('result') result: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MandatoryLeaveAssessmentListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const filters = this.parseFilters({ employeeId, year, result }, context);
    const page = this.parsePage({ limit, cursor }, context);
    try {
      return new MandatoryLeaveAssessmentListResponseDto(
        await this.service.list(context, filters, page),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  /** Declared before `:assessmentId` so `latest` is not read as an assessment id. */
  @Get(':agencyId/mandatory-leave-assessments/latest')
  @RequirePermission('leave.mandatory_assessments.read')
  async latest(
    @Param('agencyId') agencyId: string,
    @Query('year') year: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<MandatoryLeaveEmployeeLatestResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsedYear = mandatoryLeaveAssessmentYearSchema.safeParse(year);
    if (year === undefined || !parsedYear.success) {
      throw this.invalidInput(parsedYear.error?.issues ?? [], context, 'year');
    }
    const page = this.parsePage({ limit, cursor }, context);
    try {
      return new MandatoryLeaveEmployeeLatestResponseDto(
        await this.service.latestByEmployee(context, parsedYear.data, page),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/mandatory-leave-assessments/:assessmentId')
  @RequirePermission('leave.mandatory_assessments.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('assessmentId') assessmentId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<MandatoryLeaveAssessmentDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = mandatoryLeaveAssessmentIdSchema.safeParse(assessmentId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data);
      if (!detail) throw this.notFound(context);
      return new MandatoryLeaveAssessmentDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/mandatory-leave-assessments/evaluations')
  @RequirePermission('leave.mandatory_assessments.evaluate')
  async evaluate(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<MandatoryLeaveAgencyEvaluationDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = mandatoryLeaveAssessmentEvaluateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return new MandatoryLeaveAgencyEvaluationDto(
        await this.service.evaluateAgencyYear(context, parsed.data.year),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseFilters(
    filters: {
      employeeId: string | undefined;
      year: string | undefined;
      result: string | undefined;
    },
    context: RequestContext,
  ): MandatoryLeaveAssessmentFilters {
    const parsed: MandatoryLeaveAssessmentFilters = {};
    if (filters.employeeId !== undefined) {
      const employeeId = mandatoryLeaveAssessmentIdSchema.safeParse(filters.employeeId);
      if (!employeeId.success)
        throw this.invalidInput(employeeId.error.issues, context, 'employeeId');
      parsed.employeeId = employeeId.data;
    }
    if (filters.year !== undefined) {
      const year = mandatoryLeaveAssessmentYearSchema.safeParse(filters.year);
      if (!year.success) throw this.invalidInput(year.error.issues, context, 'year');
      parsed.year = year.data;
    }
    if (filters.result !== undefined) {
      const result = mandatoryLeaveAssessmentResultSchema.safeParse(filters.result);
      if (!result.success) throw this.invalidInput(result.error.issues, context, 'result');
      parsed.result = result.data;
    }
    return parsed;
  }

  private parsePage(
    page: { limit: string | undefined; cursor: string | undefined },
    context: RequestContext,
  ): MandatoryLeaveAssessmentPageRequest {
    const parsed: MandatoryLeaveAssessmentPageRequest = {};
    if (page.limit !== undefined) {
      const limit = mandatoryLeaveAssessmentLimitSchema.safeParse(page.limit);
      if (!limit.success) throw this.invalidInput(limit.error.issues, context, 'limit');
      parsed.limit = limit.data;
    }
    if (page.cursor !== undefined) {
      const cursor = mandatoryLeaveAssessmentCursorParamSchema.safeParse(page.cursor);
      if (!cursor.success) throw this.invalidInput(cursor.error.issues, context, 'cursor');
      parsed.cursor = cursor.data;
    }
    return parsed;
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
            code: 'MANDATORY_LEAVE_ASSESSMENT_EVALUATE_FORBIDDEN',
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
    field?: string,
  ): BadRequestException {
    const fields = validationFields(issues);
    if (field && Object.keys(fields).length === 0) fields[field] = issues[0]?.message ?? 'Invalid';
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Mandatory Leave Assessment values.',
        fields,
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'MANDATORY_LEAVE_ASSESSMENT_NOT_FOUND',
          message: 'The Mandatory Leave Assessment could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
