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
  TerminalLeaveInputAssessmentDetailDto,
  TerminalLeaveInputAssessmentDto,
  TerminalLeaveInputAssessmentListResponseDto,
  TerminalLeaveInputCandidateListResponseDto,
} from './terminal-leave-inputs.dto';
import {
  terminalLeaveInputIdSchema,
  terminalLeaveInputIdempotencyKeySchema,
  terminalLeaveInputPreserveSchema,
  terminalLeaveInputResultSchema,
} from './terminal-leave-inputs.schemas';
import {
  TerminalLeaveInputsService,
  TerminalLeaveInputServiceError,
  type TerminalLeaveInputAssessmentFilters,
} from './terminal-leave-inputs.service';

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
  if (error instanceof TerminalLeaveInputServiceError) {
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
export class TerminalLeaveInputsController {
  constructor(
    @Inject(TerminalLeaveInputsService) private readonly service: TerminalLeaveInputsService,
  ) {}

  @Get(':agencyId/terminal-leave-inputs/candidates')
  @RequirePermission('leave.terminal_inputs.read')
  async listCandidates(
    @Param('agencyId') agencyId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<TerminalLeaveInputCandidateListResponseDto> {
    this.assertReadAgency(agencyId, context);
    try {
      return new TerminalLeaveInputCandidateListResponseDto(
        await this.service.listCandidates(context),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/terminal-leave-inputs/assessments')
  @RequirePermission('leave.terminal_inputs.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('separationCaseId') separationCaseId: string | undefined,
    @Query('result') result: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<TerminalLeaveInputAssessmentListResponseDto> {
    this.assertReadAgency(agencyId, context);
    const parsed = this.parseFilters({ employeeId, separationCaseId, result }, context);
    try {
      return new TerminalLeaveInputAssessmentListResponseDto(
        await this.service.list(context, parsed),
      );
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/terminal-leave-inputs/assessments/:assessmentId')
  @RequirePermission('leave.terminal_inputs.read')
  async findById(
    @Param('agencyId') agencyId: string,
    @Param('assessmentId') assessmentId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<TerminalLeaveInputAssessmentDetailDto> {
    this.assertReadAgency(agencyId, context);
    const parsedId = terminalLeaveInputIdSchema.safeParse(assessmentId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      const detail = await this.service.findById(context, parsedId.data);
      if (!detail) throw this.notFound(context);
      return new TerminalLeaveInputAssessmentDetailDto(detail);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/terminal-leave-inputs/assessments')
  @RequirePermission('leave.terminal_inputs.preserve')
  async preserve(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<TerminalLeaveInputAssessmentDto> {
    this.assertWriteAgency(agencyId, context);
    const parsed = terminalLeaveInputPreserveSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const parsedKey = this.parseIdempotencyKey(idempotencyKey, context.requestId);
    try {
      const detail = await this.service.preserve(context, parsed.data, parsedKey);
      return new TerminalLeaveInputAssessmentDto(detail.assessment);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private parseFilters(
    filters: {
      employeeId: string | undefined;
      separationCaseId: string | undefined;
      result: string | undefined;
    },
    context: RequestContext,
  ): TerminalLeaveInputAssessmentFilters {
    const parsed: TerminalLeaveInputAssessmentFilters = {};
    const employeeId = terminalLeaveInputIdSchema.safeParse(filters.employeeId);
    if (filters.employeeId !== undefined && !employeeId.success) {
      throw this.invalidInput(employeeId.error.issues, context);
    }
    if (employeeId.success) parsed.employeeId = employeeId.data;
    const separationCaseId = terminalLeaveInputIdSchema.safeParse(filters.separationCaseId);
    if (filters.separationCaseId !== undefined && !separationCaseId.success) {
      throw this.invalidInput(separationCaseId.error.issues, context);
    }
    if (separationCaseId.success) parsed.separationCaseId = separationCaseId.data;
    const result = terminalLeaveInputResultSchema.safeParse(filters.result);
    if (filters.result !== undefined && !result.success) {
      throw this.invalidInput(result.error.issues, context);
    }
    if (result.success) parsed.result = result.data;
    return parsed;
  }

  private parseIdempotencyKey(value: string | undefined, requestId: string): string | undefined {
    if (value === undefined) return undefined;
    const parsed = terminalLeaveInputIdempotencyKeySchema.safeParse(value);
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
            code: 'TERMINAL_LEAVE_INPUT_PRESERVE_FORBIDDEN',
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
        message: 'Enter supported Terminal Leave Input values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'TERMINAL_LEAVE_INPUT_ASSESSMENT_NOT_FOUND',
          message: 'The Terminal Leave Input Assessment could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
