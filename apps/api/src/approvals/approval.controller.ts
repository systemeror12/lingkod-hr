import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
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
  approvalDecisionSchema,
  approvalIdempotencyKeySchema,
  approvalReasonSchema,
  approvalRequestCreateSchema,
  approvalRequestIdSchema,
  approvalRequestListSchema,
  approvalRouteCreateSchema,
  approvalRouteIdSchema,
  approvalRouteListSchema,
  approvalRouteSupersedeSchema,
} from './approval.schemas';
import { ApprovalServiceError, ApprovalsService } from './approval.service';

function translateApprovalError(error: unknown, requestId: string): never {
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
export class ApprovalController {
  constructor(@Inject(ApprovalsService) private readonly service: ApprovalsService) {}

  @Get(':agencyId/approval-routes')
  @RequirePermission('approvals.routes.read')
  async listRoutes(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = approvalRouteListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(context);
    try {
      const page = await this.service.listRoutes(context, parsed.data);
      return { routes: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Get(':agencyId/approval-routes/:routeId')
  @RequirePermission('approvals.routes.read')
  async findRoute(
    @Param('agencyId') agencyId: string,
    @Param('routeId') routeId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseRouteId(routeId, context);
    try {
      const route = await this.service.findRoute(context, id);
      if (!route) throw this.notFound(context);
      return route;
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-routes')
  @RequirePermission('approvals.routes.create')
  async createRoute(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = approvalRouteCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.createRoute(context, parsed.data, parsedIdempotencyKey);
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-routes/:routeId/activate')
  async activateRoute(
    @Param('agencyId') agencyId: string,
    @Param('routeId') routeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseRouteId(routeId, context);
    const parsed = approvalReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.activateRoute(
        context,
        parsedId,
        parsed.data.reason,
        parsedIdempotencyKey,
      );
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-routes/:routeId/supersede')
  async supersedeRoute(
    @Param('agencyId') agencyId: string,
    @Param('routeId') routeId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsedId = this.parseRouteId(routeId, context);
    const parsed = approvalRouteSupersedeSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.supersedeRoute(
        context,
        parsedId,
        parsed.data,
        parsedIdempotencyKey,
      );
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Get(':agencyId/approval-requests')
  @RequirePermission('approvals.requests.read')
  async listRequests(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const parsed = approvalRequestListSchema.safeParse(query ?? {});
    if (!parsed.success) throw this.invalidInput(context);
    try {
      const page = await this.service.listRequests(context, parsed.data);
      return { requests: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-requests')
  @RequirePermission('approvals.requests.create')
  async createRequest(
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const parsed = approvalRequestCreateSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.createRequest(context, parsed.data, parsedIdempotencyKey);
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Get(':agencyId/approval-requests/:requestId')
  @RequirePermission('approvals.requests.read')
  async findRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    try {
      const request = await this.service.findRequest(context, id);
      if (!request) throw this.notFound(context);
      return request;
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Get(':agencyId/approval-requests/:requestId/history')
  @RequirePermission('approvals.requests.audit.read')
  async history(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
  ) {
    this.assertReadAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    try {
      const history = await this.service.history(context, id);
      if (!history) throw this.notFound(context);
      return history;
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-requests/:requestId/submit')
  async submit(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.submit(context, id, parsedIdempotencyKey);
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-requests/:requestId/approve')
  async approve(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    const parsed = approvalDecisionSchema.safeParse(body ?? {});
    if (!parsed.success) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.approve(context, id, parsed.data.comments, parsedIdempotencyKey);
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-requests/:requestId/return')
  async returnRequest(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    const parsed = approvalDecisionSchema.safeParse(body ?? {});
    if (!parsed.success || !parsed.data.comments) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.returnRequest(
        context,
        id,
        parsed.data.comments,
        parsedIdempotencyKey,
      );
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-requests/:requestId/reject')
  async reject(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    const parsed = approvalDecisionSchema.safeParse(body ?? {});
    if (!parsed.success || !parsed.data.comments) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.reject(context, id, parsed.data.comments, parsedIdempotencyKey);
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  @Post(':agencyId/approval-requests/:requestId/cancel')
  async cancel(
    @Param('agencyId') agencyId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentContext() context: RequestContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    this.assertWriteAgency(agencyId, context);
    const id = this.parseRequestId(requestId, context);
    const parsed = approvalReasonSchema.safeParse(body);
    if (!parsed.success) throw this.invalidInput(context);
    const parsedIdempotencyKey = this.parseIdempotencyKey(idempotencyKey, context);
    try {
      return await this.service.cancel(context, id, parsed.data.reason, parsedIdempotencyKey);
    } catch (error: unknown) {
      translateApprovalError(error, context.requestId);
    }
  }

  private parseRouteId(value: string, context: RequestContext): string {
    const parsed = approvalRouteIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context);
    return parsed.data;
  }

  private parseRequestId(value: string, context: RequestContext): string {
    const parsed = approvalRequestIdSchema.safeParse(value);
    if (!parsed.success) throw this.notFound(context);
    return parsed.data;
  }

  private parseIdempotencyKey(
    value: string | undefined,
    context: RequestContext,
  ): string | undefined {
    if (value === undefined) return undefined;
    const parsed = approvalIdempotencyKeySchema.safeParse(value);
    if (!parsed.success) throw this.invalidInput(context);
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
            code: 'APPROVAL_WRITE_FORBIDDEN',
            message: 'The requested Agency is outside the active context.',
            requestId: context.requestId,
          },
        },
        403,
      );
    }
  }

  private invalidInput(context: RequestContext): HttpException {
    return new HttpException(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'The Approval input is invalid.',
          requestId: context.requestId,
        },
      },
      400,
    );
  }

  private notFound(context: RequestContext): NotFoundException {
    return new NotFoundException({
      error: {
        code: 'APPROVAL_NOT_FOUND',
        message: 'The Approval record could not be found.',
        requestId: context.requestId,
      },
    });
  }
}
