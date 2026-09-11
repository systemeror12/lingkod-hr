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
import { recruitmentIdSchema, recruitmentIdempotencyKeySchema } from './recruitment.schemas';
import { selectionDecisionListSchema, selectionDecisionSchema } from './deliberations.schemas';
import { SelectionService } from './selection.service';
import { RecruitmentServiceError } from './recruitment.service';

function translateSelectionError(error: unknown, requestId: string): never {
  if (error instanceof RecruitmentServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class SelectionController {
  constructor(@Inject(SelectionService) private readonly service: SelectionService) {}

  @Get(':agencyId/recruitment/selection-decisions')
  @RequirePermission('recruitment.deliberations.read')
  async listDecisions(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = selectionDecisionListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      const page = await this.service.listDecisions(context, parsed.data);
      return {
        decisions: page.items,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      };
    } catch (error: unknown) {
      translateSelectionError(error, context.requestId);
    }
  }

  @Get(':agencyId/recruitment/selection-decisions/:decisionId')
  @RequirePermission('recruitment.deliberations.read')
  async findDecision(
    @Param('agencyId') agencyId: string,
    @Param('decisionId') decisionId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseId(decisionId, context);
    try {
      const result = await this.service.findDecision(context, id);
      if (!result) throw this.notFound(context, 'RECRUITMENT_NOT_FOUND');
      return result;
    } catch (error: unknown) {
      translateSelectionError(error, context.requestId);
    }
  }

  /** The service selects the required permission per decision outcome. */
  @Post(':agencyId/recruitment/applications/:applicationId/selection-decision')
  async recordDecision(
    @Param('agencyId') agencyId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseId(applicationId, context);
    const parsed = selectionDecisionSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.recordDecision(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateSelectionError(error, context.requestId);
    }
  }

  private parseId(value: string, context: RequestContext): string {
    const parsed = recruitmentIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context, 'RECRUITMENT_NOT_FOUND');
    return parsed.data;
  }

  private parseIdempotencyKey(
    value: string | undefined,
    context: RequestContext,
  ): string | undefined {
    if (value === undefined) return undefined;
    const parsed = recruitmentIdempotencyKeySchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException({
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Enter a valid Idempotency-Key.',
          requestId: context.requestId,
        },
      });
    return parsed.data;
  }

  private assertReadAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId)
      throw this.notFound(context, 'RECRUITMENT_NOT_FOUND');
  }

  private assertWriteAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId)
      throw new HttpException(
        {
          error: {
            code: 'RECRUITMENT_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
  }

  private invalidInput(
    issues: readonly { path: PropertyKey[]; message: string }[],
    context: RequestContext,
  ): BadRequestException {
    const fields: Record<string, string> = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
    }
    return new BadRequestException({
      error: {
        code: 'INVALID_INPUT',
        message: 'Enter supported Recruitment values.',
        fields,
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext, code: string): HttpException {
    return new HttpException(
      {
        error: {
          code,
          message: 'The Recruitment record could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
