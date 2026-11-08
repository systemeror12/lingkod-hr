import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { ApprovalServiceError } from '../approvals/approval.service';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { ApproveOvertimeAuthorityService } from './approve-overtime-authority.service';
import { CancelOvertimeAuthorityService } from './cancel-overtime-authority.service';
import { CreateOvertimeAuthorityService } from './create-overtime-authority.service';
import {
  overtimeAuthorityApproveSchema,
  overtimeAuthorityDraftSchema,
  overtimeAuthorityIdSchema,
  overtimeAuthorityListSchema,
  overtimeAuthorityRejectSchema,
  overtimeAuthorityReviewSchema,
} from './overtime-authorities.schemas';
import {
  OvertimeAuthorityServiceError,
  type OvertimeAuthorityDetail,
  type OvertimeAuthorityListResponse,
  type OvertimeAuthoritySummary,
} from './overtime-authorities.types';
import { ReadOvertimeAuthoritiesService } from './read-overtime-authorities.service';
import { RejectOvertimeAuthorityService } from './reject-overtime-authority.service';
import { ReviewOvertimeAuthorityService } from './review-overtime-authority.service';
import { SubmitOvertimeAuthorityService } from './submit-overtime-authority.service';
import { UpdateOvertimeAuthorityService } from './update-overtime-authority.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (error instanceof OvertimeAuthorityServiceError) {
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.refusals.length > 0 ? { refusals: error.refusals } : {}),
          requestId,
        },
      },
      error.statusCode,
    );
  }
  if (error instanceof ApprovalServiceError) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
      error.statusCode,
    );
  }
  throw error;
}

@Controller('agencies')
@UseGuards(AuthGuard, PermissionGuard)
export class OvertimeAuthoritiesController {
  constructor(
    @Inject(CreateOvertimeAuthorityService)
    private readonly createService: CreateOvertimeAuthorityService,
    @Inject(UpdateOvertimeAuthorityService)
    private readonly updateService: UpdateOvertimeAuthorityService,
    @Inject(SubmitOvertimeAuthorityService)
    private readonly submitService: SubmitOvertimeAuthorityService,
    @Inject(CancelOvertimeAuthorityService)
    private readonly cancelService: CancelOvertimeAuthorityService,
    @Inject(ReviewOvertimeAuthorityService)
    private readonly reviewService: ReviewOvertimeAuthorityService,
    @Inject(ApproveOvertimeAuthorityService)
    private readonly approveService: ApproveOvertimeAuthorityService,
    @Inject(RejectOvertimeAuthorityService)
    private readonly rejectService: RejectOvertimeAuthorityService,
    @Inject(ReadOvertimeAuthoritiesService)
    private readonly readService: ReadOvertimeAuthoritiesService,
  ) {}

  @Get(':agencyId/overtime-authorities')
  @RequirePermission('overtime.authorities.read')
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthorityListResponse> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_READ_FORBIDDEN');
    const parsed = overtimeAuthorityListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return { authorities: await this.readService.list(context, parsed.data) };
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/overtime-authorities/:authorityId')
  @RequirePermission('overtime.authorities.read')
  async detail(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthorityDetail> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_READ_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return await this.readService.detail(context, parsedId.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-authorities')
  @RequirePermission('overtime.authorities.create')
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsed = overtimeAuthorityDraftSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.createService.execute(context, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Put(':agencyId/overtime-authorities/:authorityId')
  @RequirePermission('overtime.authorities.create')
  async update(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = overtimeAuthorityDraftSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.updateService.execute(context, parsedId.data, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-authorities/:authorityId/submit')
  @RequirePermission('overtime.authorities.submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return await this.submitService.execute(context, parsedId.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-authorities/:authorityId/cancel')
  @RequirePermission('overtime.authorities.cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    try {
      return await this.cancelService.execute(context, parsedId.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-authorities/:authorityId/review')
  @RequirePermission('overtime.authorities.review')
  async review(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = overtimeAuthorityReviewSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.reviewService.execute(context, parsedId.data, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-authorities/:authorityId/approve')
  @RequirePermission('overtime.authorities.approve')
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = overtimeAuthorityApproveSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.approveService.execute(context, parsedId.data, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/overtime-authorities/:authorityId/reject')
  @RequirePermission('overtime.authorities.reject')
  async reject(
    @Param('agencyId') agencyId: string,
    @Param('authorityId') authorityId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<OvertimeAuthoritySummary> {
    this.assertAgency(agencyId, context, 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN');
    const parsedId = overtimeAuthorityIdSchema.safeParse(authorityId);
    if (!parsedId.success) throw this.notFound(context);
    const parsed = overtimeAuthorityRejectSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.rejectService.execute(context, parsedId.data, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private assertAgency(agencyId: string, context: RequestContext, code: string): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code,
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
        message: 'Enter supported Overtime Authority values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }

  private notFound(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'OVERTIME_AUTHORITY_NOT_FOUND',
          message: 'The Overtime Authority could not be found.',
          requestId: context.requestId,
        },
      },
      404,
    );
  }
}
