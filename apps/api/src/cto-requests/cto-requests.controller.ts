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
import { ApprovalServiceError } from '../approvals/approval.service';
import { AttendanceCtoInputError } from '../attendance-cto-inputs/attendance-cto-inputs.types';
import { AttendanceDayServiceError } from '../attendance-days/attendance-days.types';
import { CocServiceError } from '../coc-accounts/coc-accounts.types';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { ApproveCtoRequestService } from './approve-cto-request.service';
import { CancelCtoRequestService } from './cancel-cto-request.service';
import { CreateCtoRequestService } from './create-cto-request.service';
import {
  ctoRequestApproveSchema,
  ctoRequestCancelSchema,
  ctoRequestCreateSchema,
  ctoRequestIdempotencyKeySchema,
  ctoRequestIdSchema,
  ctoRequestListSchema,
  ctoRequestRecommendSchema,
  ctoRequestRejectSchema,
  ctoRequestReturnSchema,
} from './cto-requests.schemas';
import {
  APPROVE_PERMISSION,
  CANCEL_PERMISSION,
  CREATE_PERMISSION,
  CtoRequestError,
  READ_PERMISSION,
  RECOMMEND_PERMISSION,
  REJECT_PERMISSION,
  RETURN_PERMISSION,
  SUBMIT_PERMISSION,
  WITHDRAW_PERMISSION,
  type CtoRequestDetail,
  type CtoRequestListResponse,
  type CtoRequestSummary,
} from './cto-requests.types';
import { DiscardCtoRequestService } from './discard-cto-request.service';
import { ReadCtoRequestsService } from './read-cto-requests.service';
import { RecommendCtoRequestService } from './recommend-cto-request.service';
import { RejectCtoRequestService } from './reject-cto-request.service';
import { ReturnCtoRequestService } from './return-cto-request.service';
import { SubmitCtoRequestService } from './submit-cto-request.service';
import { WithdrawCtoRequestService } from './withdraw-cto-request.service';

function validationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fields[field] === undefined) fields[field] = issue.message;
  }
  return fields;
}

function translateServiceError(error: unknown, requestId: string): never {
  if (
    error instanceof CtoRequestError ||
    error instanceof ApprovalServiceError ||
    error instanceof AttendanceCtoInputError ||
    error instanceof AttendanceDayServiceError ||
    error instanceof CocServiceError
  ) {
    const reasons = error instanceof CtoRequestError && error.reasons.length > 0;
    throw new HttpException(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(reasons ? { reasons: error.reasons } : {}),
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
export class CtoRequestsController {
  constructor(
    @Inject(CreateCtoRequestService) private readonly createService: CreateCtoRequestService,
    @Inject(DiscardCtoRequestService) private readonly discardService: DiscardCtoRequestService,
    @Inject(SubmitCtoRequestService) private readonly submitService: SubmitCtoRequestService,
    @Inject(WithdrawCtoRequestService) private readonly withdrawService: WithdrawCtoRequestService,
    @Inject(RecommendCtoRequestService)
    private readonly recommendService: RecommendCtoRequestService,
    @Inject(ReturnCtoRequestService) private readonly returnService: ReturnCtoRequestService,
    @Inject(ApproveCtoRequestService) private readonly approveService: ApproveCtoRequestService,
    @Inject(RejectCtoRequestService) private readonly rejectService: RejectCtoRequestService,
    @Inject(CancelCtoRequestService) private readonly cancelService: CancelCtoRequestService,
    @Inject(ReadCtoRequestsService) private readonly readService: ReadCtoRequestsService,
  ) {}

  /** Needs `overtime.coc.read`; the service limits the list to the reader's scope. */
  @Get(':agencyId/cto-requests')
  @RequirePermission(READ_PERMISSION)
  async list(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestListResponse> {
    this.assertAgency(agencyId, context, 'CTO_REQUEST_READ_FORBIDDEN');
    const parsed = ctoRequestListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return { requests: await this.readService.list(context, parsed.data) };
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Get(':agencyId/cto-requests/:requestId')
  @RequirePermission(READ_PERMISSION)
  async detail(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestDetail> {
    const id = this.requestId(agencyId, requestId, context, 'CTO_REQUEST_READ_FORBIDDEN');
    try {
      return await this.readService.detail(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests')
  @RequirePermission(CREATE_PERMISSION)
  async create(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    this.assertAgency(agencyId, context);
    const parsed = ctoRequestCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.createService.execute(context, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/discard')
  @RequirePermission(CREATE_PERMISSION)
  async discard(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    try {
      return await this.discardService.execute(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/submit')
  @RequirePermission(SUBMIT_PERMISSION)
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    try {
      return await this.submitService.execute(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/withdraw')
  @RequirePermission(WITHDRAW_PERMISSION)
  async withdraw(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    try {
      return await this.withdrawService.execute(context, id);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/recommend')
  @RequirePermission(RECOMMEND_PERMISSION)
  async recommend(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    const parsed = ctoRequestRecommendSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.recommendService.execute(context, id, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/return')
  @RequirePermission(RETURN_PERMISSION)
  async return(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    const parsed = ctoRequestReturnSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    try {
      return await this.returnService.execute(context, id, parsed.data);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/approve')
  @RequirePermission(APPROVE_PERMISSION)
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    const parsed = ctoRequestApproveSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.approveService.execute(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/reject')
  @RequirePermission(REJECT_PERMISSION)
  async reject(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    const parsed = ctoRequestRejectSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.rejectService.execute(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  @Post(':agencyId/cto-requests/:requestId/cancel')
  @RequirePermission(CANCEL_PERMISSION)
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentContext() context: RequestContext,
  ): Promise<CtoRequestSummary> {
    const id = this.requestId(agencyId, requestId, context);
    const parsed = ctoRequestCancelSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(parsed.error.issues, context);
    const key = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.cancelService.execute(context, id, parsed.data, key);
    } catch (error: unknown) {
      translateServiceError(error, context.requestId);
    }
  }

  private requestId(
    agencyId: string,
    requestId: string,
    context: RequestContext,
    forbiddenCode = 'CTO_REQUEST_WRITE_FORBIDDEN',
  ): string {
    this.assertAgency(agencyId, context, forbiddenCode);
    const parsed = ctoRequestIdSchema.safeParse(requestId);
    if (!parsed.success) {
      throw new HttpException(
        {
          error: {
            code: 'CTO_REQUEST_NOT_FOUND',
            message: 'The CTO Request could not be found.',
            requestId: context.requestId,
          },
        },
        404,
      );
    }
    return parsed.data;
  }

  private parseIdempotencyKey(
    value: string | undefined,
    context: RequestContext,
  ): string | undefined {
    if (value === undefined) return undefined;
    const parsed = ctoRequestIdempotencyKeySchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Enter a valid Idempotency-Key.',
        requestId: context.requestId,
      },
    });
  }

  private assertAgency(
    agencyId: string,
    context: RequestContext,
    code = 'CTO_REQUEST_WRITE_FORBIDDEN',
  ): void {
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
        message: 'Enter supported CTO Request values.',
        fields: validationFields(issues),
        requestId: context.requestId,
      },
    });
  }
}
