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
} from './mandatory-leave-assessments.dto';
import {
  mandatoryLeaveAssessmentEvaluateSchema,
  mandatoryLeaveAssessmentIdSchema,
  mandatoryLeaveAssessmentResultSchema,
  mandatoryLeaveAssessmentYearSchema,
} from './mandatory-leave-assessments.schemas';
import {
  MandatoryLeaveAssessmentsService,
  MandatoryLeaveAssessmentServiceError,
  type MandatoryLeaveAssessmentFilters,
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
    @CurrentContext() context: RequestContext,
  ): Promise<MandatoryLeaveAssessmentListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const filters = this.parseFilters({ employeeId, year, result }, context);
    try {
      return new MandatoryLeaveAssessmentListResponseDto(await this.service.list(context, filters));
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
