import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RequestContext } from '@lingkod-hr/auth';
import { ApprovalServiceError } from '../approvals/approval.service';
import { AttendanceCtoInputError } from '../attendance-cto-inputs/attendance-cto-inputs.types';
import { AttendanceDayServiceError } from '../attendance-days/attendance-days.types';
import { CurrentContext, RequirePermission } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { agencyIdSchema } from '../auth/auth.schemas';
import { PermissionGuard } from '../auth/permission.guard';
import { ApproveCtoRequestService } from './approve-cto-request.service';
import { CreateCtoRequestService } from './create-cto-request.service';
import {
  ctoRequestApproveSchema,
  ctoRequestCreateSchema,
  ctoRequestIdempotencyKeySchema,
  ctoRequestIdSchema,
  ctoRequestRecommendSchema,
  ctoRequestRejectSchema,
  ctoRequestReturnSchema,
} from './cto-requests.schemas';
import {
  APPROVE_PERMISSION,
  CREATE_PERMISSION,
  CtoRequestError,
  RECOMMEND_PERMISSION,
  REJECT_PERMISSION,
  RETURN_PERMISSION,
  SUBMIT_PERMISSION,
  WITHDRAW_PERMISSION,
  type CtoRequestSummary,
} from './cto-requests.types';
import { DiscardCtoRequestService } from './discard-cto-request.service';
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
    error instanceof AttendanceDayServiceError
  ) {
    throw new HttpException(
      { error: { code: error.code, message: error.message, requestId } },
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
  ) {}

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

  private requestId(agencyId: string, requestId: string, context: RequestContext): string {
    this.assertAgency(agencyId, context);
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

  private assertAgency(agencyId: string, context: RequestContext): void {
    const parsed = agencyIdSchema.safeParse(agencyId);
    if (!parsed.success || parsed.data !== context.agencyId) {
      throw new HttpException(
        {
          error: {
            code: 'CTO_REQUEST_WRITE_FORBIDDEN',
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
