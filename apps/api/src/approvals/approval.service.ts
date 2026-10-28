import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { findDirectReportEmployeeIds, findSupervisorEmployeeIds } from '../direct-reports';
import {
  APPROVAL_REQUEST_SUBJECT_TYPES,
  approvalRouteDefinitionSchema,
  approvalRequestCursorSchema,
  approvalRouteCursorSchema,
  type ApprovalRouteDefinition,
  type ApprovalRouteStep,
  type approvalRequestCreateSchema,
  type approvalRouteCreateSchema,
} from './approval.schemas';

export const APPROVAL_ROUTE_STATUSES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
export type ApprovalRouteStatus = (typeof APPROVAL_ROUTE_STATUSES)[number];

export const APPROVAL_REQUEST_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'APPROVED',
  'REJECTED',
  'RETURNED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];
type ApprovalDecision = 'APPROVE' | 'RETURN' | 'REJECT';

export type ApprovalRouteInput = typeof approvalRouteCreateSchema._output;
export type ApprovalRequestInput = typeof approvalRequestCreateSchema._output;
/**
 * An owning domain names the subject Employee so a `SUBJECT_SUPERVISOR` step
 * can resolve to that Employee's Supervisor.
 */
export type ApprovalRequestDomainInput = ApprovalRequestInput & { subjectEmployeeId?: string };

export interface ApprovalPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApprovalRouteSummary {
  id: string;
  routeCode: string;
  versionNo: number;
  domain: string;
  stepDefinition: ApprovalRouteDefinition;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: ApprovalRouteStatus;
  createdAt: string;
}

export interface ApprovalStepSummary {
  id: string;
  stepNo: number;
  stepMode: string;
  requiredPermission: string;
  approvePermission: string;
  returnPermission: string;
  rejectPermission: string;
  assignedMembershipId: string | null;
  assignedRoleCode: string | null;
  requiresSeparateReview: boolean;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  decisions: ApprovalDecisionSummary[];
}

export interface ApprovalDecisionSummary {
  id: string;
  decidedByMembershipId: string;
  decision: string;
  comments: string | null;
  delegatedAuthorityId: string | null;
  decidedAt: string;
}

export interface ApprovalRequestSummary {
  id: string;
  route: ApprovalRouteSummary;
  subjectType: string;
  subjectId: string;
  requestedByMembershipId: string;
  status: ApprovalRequestStatus;
  currentStepNo: number | null;
  requestedAt: string;
  completedAt: string | null;
  steps: ApprovalStepSummary[];
}

export interface ApprovalRequestHistory {
  request: ApprovalRequestSummary;
  events: ApprovalHistoryEvent[];
}

export interface ApprovalHistoryEvent {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  requestId: string | null;
  occurredAt: string;
}

export class ApprovalServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApprovalServiceError';
  }
}

/**
 * Domain-supplied context that travels with an owning-domain decision. Approval
 * stores nothing from it: it is handed back to the registered completion handler
 * so a decision made through the owning domain can be told apart from the
 * generic Approval API, which passes no context and must fail closed.
 */
export interface ApprovalEffectContext {
  kind: string;
  payload: unknown;
}

export interface ApprovalCompletionRequest {
  approvalRequestId: string;
  agencyId: string;
  subjectType: string;
  subjectId: string;
  routeVersionId: string;
  effectContext?: ApprovalEffectContext;
}

export interface ApprovalCompletionHandler {
  complete(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void>;
  onDecision?(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
    outcome: 'RETURNED' | 'REJECTED',
  ): Promise<void>;
  /** Runs before unfinished route work is cancelled; a domain may refuse it. */
  onCancel?(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void>;
}

export type ApprovalCompletionCallback = ApprovalCompletionHandler['complete'];
export type ApprovalDecisionCallback = (
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  request: ApprovalCompletionRequest,
  outcome: 'RETURNED' | 'REJECTED',
) => Promise<void>;

export const APPROVAL_COMPLETION_HANDLER = Symbol('APPROVAL_COMPLETION_HANDLER');

export const approvalCompletionHandler: ApprovalCompletionHandler = {
  async complete(): Promise<void> {
    throw new ApprovalServiceError(
      'An owning domain completion handler is required before this Approval Request can take effect.',
      409,
      'APPROVAL_COMPLETION_HANDLER_REQUIRED',
    );
  },
};

/** Domains register their completion behavior without making Approval depend on them. */
@Injectable()
export class ApprovalCompletionRegistry implements ApprovalCompletionHandler {
  private readonly callbacks = new Map<string, ApprovalCompletionCallback>();
  private readonly decisionCallbacks = new Map<string, ApprovalDecisionCallback>();
  private readonly cancelCallbacks = new Map<string, ApprovalCompletionCallback>();

  register(subjectType: string, callback: ApprovalCompletionCallback): void {
    this.callbacks.set(subjectType, callback);
  }

  registerDecision(subjectType: string, callback: ApprovalDecisionCallback): void {
    this.decisionCallbacks.set(subjectType, callback);
  }

  registerCancel(subjectType: string, callback: ApprovalCompletionCallback): void {
    this.cancelCallbacks.set(subjectType, callback);
  }

  async complete(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    const callback = this.callbacks.get(request.subjectType);
    if (!callback) {
      return approvalCompletionHandler.complete(transaction, context, request);
    }
    await callback(transaction, context, request);
  }

  async onDecision(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
    outcome: 'RETURNED' | 'REJECTED',
  ): Promise<void> {
    await this.decisionCallbacks.get(request.subjectType)?.(transaction, context, request, outcome);
  }

  async onCancel(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    request: ApprovalCompletionRequest,
  ): Promise<void> {
    await this.cancelCallbacks.get(request.subjectType)?.(transaction, context, request);
  }
}

export interface ApprovalAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const APPROVAL_AUDIT_WRITER = Symbol('APPROVAL_AUDIT_WRITER');

export const approvalAuditWriter: ApprovalAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

const routeSelect = {
  id: true,
  agencyId: true,
  routeCode: true,
  versionNo: true,
  domain: true,
  stepDefinition: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  createdAt: true,
} as const;

const requestInclude = {
  routeVersion: { select: routeSelect },
  steps: {
    orderBy: { stepNo: 'asc' as const },
    include: {
      decisions: { orderBy: { decidedAt: 'asc' as const } },
    },
  },
} as const;

type RouteRecord = Prisma.ApprovalRouteVersionGetPayload<{ select: typeof routeSelect }>;
type RequestRecord = Prisma.ApprovalRequestGetPayload<{ include: typeof requestInclude }>;
type StepRecord = RequestRecord['steps'][number];

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function databaseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw new ApprovalServiceError('Enter a valid approval date.', 400, 'APPROVAL_DATE_INVALID');
  }
  return date;
}

function approvalDate(value?: string): Date {
  if (value) return databaseDate(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value: part }) => [type, part]);
  const values = Object.fromEntries(parts) as Record<string, string>;
  return databaseDate(`${values.year}-${values.month}-${values.day}`);
}

function roleEvaluationTime(asOf: Date): Date {
  const result = new Date(asOf);
  result.setUTCHours(12, 0, 0, 0);
  return result;
}

function routeDefinition(value: Prisma.JsonValue): ApprovalRouteDefinition {
  const parsed = approvalRouteDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApprovalServiceError(
      'The stored Approval Route Version is invalid and cannot be used.',
      409,
      'APPROVAL_ROUTE_INVALID',
    );
  }
  return parsed.data;
}

function routeStatus(value: string): ApprovalRouteStatus {
  if (APPROVAL_ROUTE_STATUSES.includes(value as ApprovalRouteStatus)) {
    return value as ApprovalRouteStatus;
  }
  throw new ApprovalServiceError(
    'The stored Approval Route status is invalid.',
    500,
    'APPROVAL_DATA_INVALID',
  );
}

function requestStatus(value: string): ApprovalRequestStatus {
  if (APPROVAL_REQUEST_STATUSES.includes(value as ApprovalRequestStatus)) {
    return value as ApprovalRequestStatus;
  }
  throw new ApprovalServiceError(
    'The stored Approval Request status is invalid.',
    500,
    'APPROVAL_DATA_INVALID',
  );
}

function routeSummary(record: RouteRecord): ApprovalRouteSummary {
  return {
    id: record.id,
    routeCode: record.routeCode,
    versionNo: record.versionNo,
    domain: record.domain,
    stepDefinition: routeDefinition(record.stepDefinition),
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    status: routeStatus(record.status),
    createdAt: record.createdAt.toISOString(),
  };
}

function decisionSummary(record: StepRecord['decisions'][number]): ApprovalDecisionSummary {
  return {
    id: record.id,
    decidedByMembershipId: record.decidedByMembershipId,
    decision: record.decision,
    comments: record.comments,
    delegatedAuthorityId: record.delegatedAuthorityId,
    decidedAt: record.decidedAt.toISOString(),
  };
}

function requestSummary(record: RequestRecord): ApprovalRequestSummary {
  return {
    id: record.id,
    route: routeSummary(record.routeVersion),
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    requestedByMembershipId: record.requestedByMembershipId,
    status: requestStatus(record.status),
    currentStepNo: record.currentStepNo,
    requestedAt: record.requestedAt.toISOString(),
    completedAt: formatDateTime(record.completedAt),
    steps: record.steps.map((step) => ({
      id: step.id,
      stepNo: step.stepNo,
      stepMode: step.stepMode,
      requiredPermission: step.requiredPermission,
      approvePermission: step.approvePermission,
      returnPermission: step.returnPermission,
      rejectPermission: step.rejectPermission,
      assignedMembershipId: step.assignedMembershipId,
      assignedRoleCode: step.assignedRoleCode,
      requiresSeparateReview: step.requiresSeparateReview,
      status: step.status,
      activatedAt: formatDateTime(step.activatedAt),
      completedAt: formatDateTime(step.completedAt),
      decisions: step.decisions.map(decisionSummary),
    })),
  };
}

function isApprovalSubjectType(
  value: string,
): value is (typeof APPROVAL_REQUEST_SUBJECT_TYPES)[number] {
  return APPROVAL_REQUEST_SUBJECT_TYPES.includes(
    value as (typeof APPROVAL_REQUEST_SUBJECT_TYPES)[number],
  );
}

function decisionPermission(
  step: ApprovalRouteStep | StepRecord,
  decision: ApprovalDecision,
): string {
  if (decision === 'APPROVE') return step.approvePermission ?? step.requiredPermission;
  if (decision === 'RETURN') return step.returnPermission ?? step.requiredPermission;
  return step.rejectPermission ?? step.requiredPermission;
}

function normalizeIdempotencyKey(value?: string): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor<T>(value: string, parse: (input: unknown) => T): T {
  try {
    return parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new ApprovalServiceError(
      'The approval list cursor is invalid.',
      400,
      'APPROVAL_CURSOR_INVALID',
    );
  }
}

function pageLimit(value?: number): number {
  const limit = value ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ApprovalServiceError(
      'The approval list limit must be between one and fifty.',
      400,
      'APPROVAL_LIST_LIMIT_INVALID',
    );
  }
  return limit;
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

function metadataNumber(metadata: Prisma.JsonValue, key: string): number | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'number' ? value : null;
}

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(APPROVAL_AUDIT_WRITER)
    private readonly auditWriter: ApprovalAuditWriter = approvalAuditWriter,
    @Inject(APPROVAL_COMPLETION_HANDLER)
    private readonly completionHandler: ApprovalCompletionHandler = approvalCompletionHandler,
  ) {}

  async listRoutes(
    context: RequestContext,
    filter: {
      status?: ApprovalRouteStatus | undefined;
      routeCode?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<ApprovalPage<ApprovalRouteSummary>> {
    this.assertPermission(context, 'approvals.routes.read', 'APPROVAL_ROUTE_READ_FORBIDDEN');
    const limit = pageLimit(filter.limit);
    const cursor = filter.cursor
      ? decodeCursor(filter.cursor, (value) => approvalRouteCursorSchema.parse(value))
      : null;
    const where: Prisma.ApprovalRouteVersionWhereInput = {
      agencyId: context.agencyId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.routeCode ? { routeCode: filter.routeCode } : {}),
      ...(cursor
        ? {
            OR: [
              { routeCode: { gt: cursor.routeCode } },
              { routeCode: cursor.routeCode, versionNo: { lt: cursor.versionNo } },
              { routeCode: cursor.routeCode, versionNo: cursor.versionNo, id: { gt: cursor.id } },
            ],
          }
        : {}),
    };
    const records = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.approvalRouteVersion.findMany({
        where,
        orderBy: [{ routeCode: 'asc' }, { versionNo: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        select: routeSelect,
      }),
    );
    const hasMore = records.length > limit;
    const items = records.slice(0, limit).map(routeSummary);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ routeCode: last.routeCode, versionNo: last.versionNo, id: last.id })
          : null,
    };
  }

  async findRoute(context: RequestContext, routeId: string): Promise<ApprovalRouteSummary | null> {
    this.assertPermission(context, 'approvals.routes.read', 'APPROVAL_ROUTE_READ_FORBIDDEN');
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.approvalRouteVersion.findFirst({
        where: { agencyId: context.agencyId, id: routeId },
        select: routeSelect,
      }),
    );
    return record ? routeSummary(record) : null;
  }

  /** Internal contract: an owning domain binds one exact active route version before approval. */
  async resolveActiveRoute(
    context: RequestContext,
    routeCode: string,
    effectiveDate?: string,
  ): Promise<ApprovalRouteSummary> {
    this.assertPermission(context, 'approvals.routes.read', 'APPROVAL_ROUTE_READ_FORBIDDEN');
    if (effectiveDate) approvalDate(effectiveDate);
    const route = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      this.resolveActiveRouteInTransaction(transaction, context, routeCode, effectiveDate),
    );
    return route;
  }

  /** Internal contract: resolve a route without opening a second transaction. */
  async resolveActiveRouteInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    routeCode: string,
    effectiveDate?: string,
  ): Promise<ApprovalRouteSummary> {
    this.assertOperationalPermission(
      context,
      'approvals.routes.read',
      'APPROVAL_ROUTE_READ_FORBIDDEN',
    );
    const asOf = approvalDate(effectiveDate);
    return routeSummary(await this.resolveRoute(transaction, context.agencyId, routeCode, asOf));
  }

  async createRoute(
    context: RequestContext,
    input: ApprovalRouteInput,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRouteSummary> {
    this.assertPermission(context, 'approvals.routes.create', 'APPROVAL_ROUTE_CREATE_FORBIDDEN');
    const definition = approvalRouteDefinitionSchema.parse(input.stepDefinition);
    const effectiveFrom = databaseDate(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? databaseDate(input.effectiveTo) : null;
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPROVAL_ROUTE_CREATED',
          idempotencyKey,
        );
        if (previous) {
          if (
            metadataString(previous.metadata, 'routeCode') !== input.routeCode ||
            metadataNumber(previous.metadata, 'versionNo') !== input.versionNo
          ) {
            throw this.idempotencyConflict();
          }
          const existing = await transaction.approvalRouteVersion.findFirst({
            where: { agencyId: context.agencyId, id: previous.entityId },
            select: routeSelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return routeSummary(existing);
        }
        await this.validateRouteDefinition(transaction, context.agencyId, definition);
        const record = await transaction.approvalRouteVersion.create({
          data: {
            agencyId: context.agencyId,
            routeCode: input.routeCode,
            versionNo: input.versionNo,
            domain: input.domain,
            stepDefinition: definition as Prisma.InputJsonValue,
            effectiveFrom,
            effectiveTo,
            status: 'DRAFT',
          },
          select: routeSelect,
        });
        await this.writeAudit(transaction, context, {
          action: 'APPROVAL_ROUTE_CREATED',
          entityType: 'ApprovalRouteVersion',
          entityId: record.id,
          previousStatus: null,
          newStatus: 'DRAFT',
          reason: 'Draft Approval Route Version created.',
          metadata: { routeCode: record.routeCode, versionNo: record.versionNo },
          idempotencyKey,
        });
        return routeSummary(record);
      },
    );
  }

  async activateRoute(
    context: RequestContext,
    routeId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRouteSummary> {
    this.assertPermission(
      context,
      'approvals.routes.activate',
      'APPROVAL_ROUTE_ACTIVATE_FORBIDDEN',
    );
    this.assertReason(reason, 'APPROVAL_ROUTE_REASON_REQUIRED');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPROVAL_ROUTE_ACTIVATED',
          idempotencyKey,
          routeId,
        );
        if (previous) {
          if (previous.reason !== reason.trim()) throw this.idempotencyConflict();
          const existing = await this.lockRoute(transaction, context.agencyId, routeId);
          if (!existing) throw this.idempotencyConflict();
          return routeSummary(existing);
        }
        const current = await this.lockRoute(transaction, context.agencyId, routeId);
        if (!current) throw this.notFound('Approval Route Version');
        if (current.status !== 'DRAFT') throw this.routeWorkflowError('activate', current.status);
        const definition = routeDefinition(current.stepDefinition);
        await this.validateRouteDefinition(transaction, context.agencyId, definition);
        const record = await transaction.approvalRouteVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: routeId } },
          data: { status: 'ACTIVE' },
          select: routeSelect,
        });
        await this.writeAudit(transaction, context, {
          action: 'APPROVAL_ROUTE_ACTIVATED',
          entityType: 'ApprovalRouteVersion',
          entityId: record.id,
          previousStatus: 'DRAFT',
          newStatus: 'ACTIVE',
          reason: reason.trim(),
          metadata: { routeCode: record.routeCode, versionNo: record.versionNo },
          idempotencyKey,
        });
        return routeSummary(record);
      },
    );
  }

  async supersedeRoute(
    context: RequestContext,
    routeId: string,
    input: { effectiveTo: string; reason: string },
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRouteSummary> {
    this.assertPermission(
      context,
      'approvals.routes.supersede',
      'APPROVAL_ROUTE_SUPERSEDE_FORBIDDEN',
    );
    this.assertReason(input.reason, 'APPROVAL_ROUTE_REASON_REQUIRED');
    const effectiveTo = databaseDate(input.effectiveTo);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      async (transaction) => {
        const previous = await this.idempotentEvent(
          transaction,
          context,
          'APPROVAL_ROUTE_SUPERSEDED',
          idempotencyKey,
          routeId,
        );
        if (previous) {
          if (previous.reason !== input.reason.trim()) throw this.idempotencyConflict();
          const existing = await this.lockRoute(transaction, context.agencyId, routeId);
          if (!existing) throw this.idempotencyConflict();
          return routeSummary(existing);
        }
        const current = await this.lockRoute(transaction, context.agencyId, routeId);
        if (!current) throw this.notFound('Approval Route Version');
        if (current.status !== 'ACTIVE') throw this.routeWorkflowError('supersede', current.status);
        if (effectiveTo < current.effectiveFrom) {
          throw new ApprovalServiceError(
            'The supersession date cannot precede the route effectivity date.',
            400,
            'APPROVAL_ROUTE_DATE_INVALID',
          );
        }
        const record = await transaction.approvalRouteVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: routeId } },
          data: { status: 'SUPERSEDED', effectiveTo },
          select: routeSelect,
        });
        await this.writeAudit(transaction, context, {
          action: 'APPROVAL_ROUTE_SUPERSEDED',
          entityType: 'ApprovalRouteVersion',
          entityId: record.id,
          previousStatus: 'ACTIVE',
          newStatus: 'SUPERSEDED',
          reason: input.reason.trim(),
          metadata: { routeCode: record.routeCode, versionNo: record.versionNo },
          idempotencyKey,
        });
        return routeSummary(record);
      },
    );
  }

  async listRequests(
    context: RequestContext,
    filter: {
      status?: ApprovalRequestStatus | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<ApprovalPage<ApprovalRequestSummary>> {
    this.assertPermission(context, 'approvals.requests.read', 'APPROVAL_REQUEST_READ_FORBIDDEN');
    const limit = pageLimit(filter.limit);
    const cursor = filter.cursor
      ? decodeCursor(filter.cursor, (value) => approvalRequestCursorSchema.parse(value))
      : null;
    const cursorRequestedAt = cursor ? new Date(cursor.requestedAt) : null;
    const where: Prisma.ApprovalRequestWhereInput = {
      agencyId: context.agencyId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(cursor
        ? {
            OR: [
              { requestedAt: { lt: cursorRequestedAt as Date } },
              { requestedAt: cursorRequestedAt as Date, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const records = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.approvalRequest.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: requestInclude,
      }),
    );
    const hasMore = records.length > limit;
    const items = records.slice(0, limit).map(requestSummary);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ requestedAt: last.requestedAt, id: last.id }) : null,
    };
  }

  async findRequest(
    context: RequestContext,
    requestId: string,
  ): Promise<ApprovalRequestSummary | null> {
    this.assertPermission(context, 'approvals.requests.read', 'APPROVAL_REQUEST_READ_FORBIDDEN');
    const record = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.approvalRequest.findFirst({
        where: { agencyId: context.agencyId, id: requestId },
        include: requestInclude,
      }),
    );
    return record ? requestSummary(record) : null;
  }

  async history(
    context: RequestContext,
    requestId: string,
  ): Promise<ApprovalRequestHistory | null> {
    this.assertPermission(
      context,
      'approvals.requests.audit.read',
      'APPROVAL_REQUEST_AUDIT_READ_FORBIDDEN',
    );
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await transaction.approvalRequest.findFirst({
        where: { agencyId: context.agencyId, id: requestId },
        include: requestInclude,
      });
      if (!record) return null;
      const events = await transaction.auditEvent.findMany({
        where: { agencyId: context.agencyId, entityType: 'ApprovalRequest', entityId: requestId },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          reason: true,
          requestId: true,
          occurredAt: true,
        },
      });
      return {
        request: requestSummary(record),
        events: events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
      };
    });
  }

  async createRequest(
    context: RequestContext,
    input: ApprovalRequestInput,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertPermission(
      context,
      'approvals.requests.create',
      'APPROVAL_REQUEST_CREATE_FORBIDDEN',
    );
    if (!isApprovalSubjectType(input.subjectType)) {
      throw new ApprovalServiceError(
        'Board Recommendations and Selection Decisions use their Recruitment-owned records.',
        400,
        'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
      );
    }
    approvalDate(input.effectiveDate);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      (transaction) =>
        this.createRequestInTransaction(transaction, context, input, rawIdempotencyKey),
    );
  }

  /**
   * Internal contract: create an Approval Request in the caller's transaction.
   * The owning domain asserts its own scoped authority; the operational
   * Approval create grant is still required in AGENCY or OWN scope.
   */
  async createRequestInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: ApprovalRequestDomainInput,
    rawIdempotencyKey?: string,
    boundRouteVersionId?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertOperationalPermission(
      context,
      'approvals.requests.create',
      'APPROVAL_REQUEST_CREATE_FORBIDDEN',
    );
    if (!isApprovalSubjectType(input.subjectType)) {
      throw new ApprovalServiceError(
        'Board Recommendations and Selection Decisions use their Recruitment-owned records.',
        400,
        'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
      );
    }
    const effectiveDate = approvalDate(input.effectiveDate);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const previous = await this.idempotentEvent(
      transaction,
      context,
      'APPROVAL_REQUEST_CREATED',
      idempotencyKey,
    );
    if (previous) {
      if (
        metadataString(previous.metadata, 'subjectType') !== input.subjectType ||
        metadataString(previous.metadata, 'subjectId') !== input.subjectId ||
        metadataString(previous.metadata, 'routeCode') !== input.routeCode
      ) {
        throw this.idempotencyConflict();
      }
      const existing = await this.requireRequest(transaction, context.agencyId, previous.entityId);
      return requestSummary(existing);
    }
    const route = boundRouteVersionId
      ? await this.requireBoundRoute(
          transaction,
          context.agencyId,
          boundRouteVersionId,
          input.routeCode,
          effectiveDate,
        )
      : await this.resolveRoute(transaction, context.agencyId, input.routeCode, effectiveDate);
    const definition = routeDefinition(route.stepDefinition);
    const assignments = await this.resolveAssignments(
      transaction,
      context.agencyId,
      definition,
      effectiveDate,
      context.membershipId,
      input.subjectEmployeeId,
    );
    const request = await transaction.approvalRequest.create({
      data: {
        agencyId: context.agencyId,
        routeVersionId: route.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        requestedByMembershipId: context.membershipId,
        status: 'PENDING',
        steps: {
          create: assignments.map((assignment) => ({
            stepNo: assignment.step.stepNo,
            stepMode: assignment.step.stepMode,
            requiredPermission: assignment.step.requiredPermission,
            approvePermission: decisionPermission(assignment.step, 'APPROVE'),
            returnPermission: decisionPermission(assignment.step, 'RETURN'),
            rejectPermission: decisionPermission(assignment.step, 'REJECT'),
            assignedMembershipId: assignment.membershipId,
            assignedRoleCode: assignment.roleCode,
            requiresSeparateReview: assignment.step.requiresSeparateReview,
            status: 'PENDING',
          })),
        },
      },
      include: requestInclude,
    });
    await this.writeAudit(transaction, context, {
      action: 'APPROVAL_REQUEST_CREATED',
      entityType: 'ApprovalRequest',
      entityId: request.id,
      previousStatus: null,
      newStatus: 'PENDING',
      reason: 'Approval Request created with a server-resolved route snapshot.',
      metadata: {
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        routeCode: input.routeCode,
        routeVersionId: request.routeVersionId,
        assignedMembershipIds: assignments.map(({ membershipId }) => membershipId),
        effectiveDate: formatDate(effectiveDate),
      },
      idempotencyKey,
    });
    return requestSummary(request);
  }

  async submit(
    context: RequestContext,
    requestId: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertPermission(
      context,
      'approvals.requests.submit',
      'APPROVAL_REQUEST_SUBMIT_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      (transaction) => this.submitInTransaction(transaction, context, requestId, rawIdempotencyKey),
    );
  }

  /**
   * Internal contract: submit an Approval Request in the caller's transaction.
   * The owning domain enforces its own permission; the public `submit` keeps
   * the Approval-owned check. Pass `requireDrafter: false` when the owning
   * domain submits on behalf of a drafter who cannot submit from its own role.
   */
  async submitInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    requestId: string,
    rawIdempotencyKey?: string,
    options?: { requireDrafter?: boolean },
  ): Promise<ApprovalRequestSummary> {
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const previous = await this.idempotentEvent(
      transaction,
      context,
      'APPROVAL_REQUEST_SUBMITTED',
      idempotencyKey,
      requestId,
    );
    if (previous)
      return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
    const current = await this.lockRequest(transaction, context.agencyId, requestId);
    if (!current) throw this.notFound('Approval Request');
    if (
      (options?.requireDrafter ?? true) &&
      current.requestedByMembershipId !== context.membershipId
    ) {
      throw new ApprovalServiceError(
        'Only the Approval Request drafter can submit it.',
        403,
        'APPROVAL_REQUEST_DRAFTER_REQUIRED',
      );
    }
    if (!['PENDING', 'RETURNED'].includes(current.status)) {
      throw this.requestWorkflowError('submit', current.status);
    }
    const stepNo = current.currentStepNo ?? 1;
    const step = current.steps.find(({ stepNo: candidate }) => candidate === stepNo);
    if (!step || !['PENDING', 'RETURNED'].includes(step.status)) {
      throw new ApprovalServiceError(
        'The Approval Request has no resumable current step.',
        409,
        'APPROVAL_STEP_INVALID',
      );
    }
    await transaction.approvalStep.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: step.id } },
      data: {
        status: 'ACTIVE',
        activatedAt: step.activatedAt ?? new Date(),
        completedAt: null,
      },
    });
    await transaction.approvalRequest.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
      data: { status: 'IN_PROGRESS', currentStepNo: stepNo },
    });
    await this.writeAudit(transaction, context, {
      action: 'APPROVAL_REQUEST_SUBMITTED',
      entityType: 'ApprovalRequest',
      entityId: requestId,
      previousStatus: current.status,
      newStatus: 'IN_PROGRESS',
      reason: 'Approval Request submitted for assigned review.',
      metadata: { currentStepNo: stepNo },
      idempotencyKey,
    });
    return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
  }

  async approve(
    context: RequestContext,
    requestId: string,
    comments?: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    return this.decide(context, requestId, 'APPROVE', comments, rawIdempotencyKey);
  }

  async returnRequest(
    context: RequestContext,
    requestId: string,
    comments: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    return this.decide(context, requestId, 'RETURN', comments, rawIdempotencyKey);
  }

  async reject(
    context: RequestContext,
    requestId: string,
    comments: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    return this.decide(context, requestId, 'REJECT', comments, rawIdempotencyKey);
  }

  async cancel(
    context: RequestContext,
    requestId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertPermission(
      context,
      'approvals.requests.cancel',
      'APPROVAL_REQUEST_CANCEL_FORBIDDEN',
    );
    this.assertReason(reason, 'APPROVAL_REQUEST_REASON_REQUIRED');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      (transaction) =>
        this.cancelWorkInTransaction(transaction, context, requestId, reason, idempotencyKey, true),
    );
  }

  /**
   * Internal contract: an owning domain that already asserted its own authority
   * cancels unfinished route work in the caller's transaction. Leave owns the
   * withdrawal decision; Approval owns the request state.
   */
  async cancelInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    requestId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertReason(reason, 'APPROVAL_REQUEST_REASON_REQUIRED');
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    return this.cancelWorkInTransaction(
      transaction,
      context,
      requestId,
      reason,
      idempotencyKey,
      false,
    );
  }

  private async cancelWorkInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    requestId: string,
    reason: string,
    idempotencyKey: string | null,
    requireDrafter: boolean,
  ): Promise<ApprovalRequestSummary> {
    const previous = await this.idempotentEvent(
      transaction,
      context,
      'APPROVAL_REQUEST_CANCELLED',
      idempotencyKey,
      requestId,
    );
    if (previous) {
      if (previous.reason !== reason.trim()) throw this.idempotencyConflict();
      return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
    }
    const current = await this.lockRequest(transaction, context.agencyId, requestId);
    if (!current) throw this.notFound('Approval Request');
    if (requireDrafter && current.requestedByMembershipId !== context.membershipId) {
      throw new ApprovalServiceError(
        'Only the Approval Request drafter can cancel it.',
        403,
        'APPROVAL_REQUEST_DRAFTER_REQUIRED',
      );
    }
    if (!['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(current.status)) {
      throw this.requestWorkflowError('cancel', current.status);
    }
    await this.completionHandler.onCancel?.(transaction, context, {
      approvalRequestId: current.id,
      agencyId: current.agencyId,
      subjectType: current.subjectType,
      subjectId: current.subjectId,
      routeVersionId: current.routeVersionId,
    });
    await transaction.approvalStep.updateMany({
      where: {
        agencyId: context.agencyId,
        approvalRequestId: requestId,
        status: { in: ['PENDING', 'ACTIVE', 'RETURNED'] },
      },
      data: { status: 'SKIPPED', completedAt: new Date() },
    });
    await transaction.approvalRequest.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await this.writeAudit(transaction, context, {
      action: 'APPROVAL_REQUEST_CANCELLED',
      entityType: 'ApprovalRequest',
      entityId: requestId,
      previousStatus: current.status,
      newStatus: 'CANCELLED',
      reason: reason.trim(),
      metadata: {},
      idempotencyKey,
    });
    return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
  }

  private async decide(
    context: RequestContext,
    requestId: string,
    decision: ApprovalDecision,
    rawComments?: string,
    rawIdempotencyKey?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertDecisionReason(decision, rawComments);
    return withDatabaseContext(
      requestDatabaseContext(context, 'approval-transition'),
      (transaction) =>
        this.decideInTransaction(
          transaction,
          context,
          requestId,
          decision,
          rawComments,
          rawIdempotencyKey,
        ),
    );
  }

  private assertDecisionReason(decision: ApprovalDecision, rawComments?: string): void {
    const comments = rawComments?.trim() ?? '';
    if (decision !== 'APPROVE' && comments.length === 0) {
      throw new ApprovalServiceError(
        'A return or rejection reason is required.',
        400,
        'APPROVAL_DECISION_REASON_REQUIRED',
      );
    }
  }

  /**
   * Internal contract: record an Approval Decision inside the caller's
   * transaction so the owning domain can bind it to its own effects atomically.
   * Decision authorization still uses the bound Approval Step snapshot. The
   * optional effect context is echoed back to the completion handler so the
   * owning domain can apply its effects against the decision it just made.
   * An owning domain that names the subject Employee lets the assigned
   * Supervisor decide on a `DIRECT_REPORTS` grant while that Employee is still
   * their direct report.
   */
  async decideInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    requestId: string,
    decision: ApprovalDecision,
    rawComments?: string,
    rawIdempotencyKey?: string,
    effectContext?: ApprovalEffectContext,
    subjectEmployeeId?: string,
  ): Promise<ApprovalRequestSummary> {
    this.assertDecisionReason(decision, rawComments);
    const comments = rawComments?.trim() ?? '';
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const action =
      decision === 'APPROVE'
        ? 'APPROVAL_REQUEST_APPROVED'
        : decision === 'RETURN'
          ? 'APPROVAL_REQUEST_RETURNED'
          : 'APPROVAL_REQUEST_REJECTED';
    const previous = await this.idempotentEvent(
      transaction,
      context,
      action,
      idempotencyKey,
      requestId,
    );
    if (previous) {
      if (previous.reason !== (comments || 'Approval step decision recorded.')) {
        throw this.idempotencyConflict();
      }
      return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
    }
    const current = await this.lockRequest(transaction, context.agencyId, requestId);
    if (!current) throw this.notFound('Approval Request');
    if (current.status !== 'IN_PROGRESS' || current.currentStepNo === null) {
      throw this.requestWorkflowError('decide', current.status);
    }
    const step = current.steps.find(
      ({ stepNo, status }) => stepNo === current.currentStepNo && status === 'ACTIVE',
    );
    if (!step || !step.assignedMembershipId) {
      throw new ApprovalServiceError(
        'The Approval Request has no active assigned reviewer.',
        409,
        'APPROVAL_STEP_INVALID',
      );
    }
    if (step.requiresSeparateReview && context.membershipId === current.requestedByMembershipId) {
      throw new ApprovalServiceError(
        'The drafter cannot satisfy a step that requires separate review.',
        403,
        'APPROVAL_SEGREGATION_REQUIRED',
      );
    }
    const delegationId = await this.assertDecisionAuthority(
      transaction,
      context,
      step,
      decisionPermission(step, decision),
      subjectEmployeeId,
    );
    const now = new Date();
    await transaction.approvalDecision.create({
      data: {
        agencyId: context.agencyId,
        approvalStepId: step.id,
        decidedByMembershipId: context.membershipId,
        decision,
        comments: comments || null,
        delegatedAuthorityId: delegationId,
        requestId: context.requestId,
      },
    });
    const nextStep = current.steps.find(
      ({ stepNo, status }) => stepNo === current.currentStepNo! + 1 && status === 'PENDING',
    );
    const nextRequestStatus =
      decision === 'RETURN'
        ? 'RETURNED'
        : decision === 'REJECT'
          ? 'REJECTED'
          : nextStep
            ? 'IN_PROGRESS'
            : 'APPROVED';
    await transaction.approvalStep.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: step.id } },
      data: {
        status:
          decision === 'APPROVE' ? 'APPROVED' : decision === 'RETURN' ? 'RETURNED' : 'REJECTED',
        completedAt: now,
      },
    });
    if (nextStep && nextRequestStatus === 'IN_PROGRESS') {
      await transaction.approvalStep.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: nextStep.id } },
        data: { status: 'ACTIVE', activatedAt: now },
      });
    }
    const updated = await transaction.approvalRequest.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: requestId } },
      data: {
        status: nextRequestStatus,
        currentStepNo:
          nextRequestStatus === 'APPROVED' || nextRequestStatus === 'REJECTED'
            ? null
            : nextRequestStatus === 'IN_PROGRESS'
              ? (nextStep?.stepNo ?? current.currentStepNo)
              : current.currentStepNo,
        completedAt: ['APPROVED', 'REJECTED'].includes(nextRequestStatus) ? now : null,
      },
    });
    if (nextRequestStatus === 'APPROVED') {
      await this.completionHandler.complete(transaction, context, {
        approvalRequestId: updated.id,
        agencyId: updated.agencyId,
        subjectType: updated.subjectType,
        subjectId: updated.subjectId,
        routeVersionId: updated.routeVersionId,
        ...(effectContext ? { effectContext } : {}),
      });
    }
    if (nextRequestStatus === 'RETURNED' || nextRequestStatus === 'REJECTED') {
      await this.completionHandler.onDecision?.(
        transaction,
        context,
        {
          approvalRequestId: updated.id,
          agencyId: updated.agencyId,
          subjectType: updated.subjectType,
          subjectId: updated.subjectId,
          routeVersionId: updated.routeVersionId,
          ...(effectContext ? { effectContext } : {}),
        },
        nextRequestStatus,
      );
    }
    await this.writeAudit(transaction, context, {
      action: `APPROVAL_REQUEST_${decision === 'APPROVE' ? 'APPROVED' : decision === 'RETURN' ? 'RETURNED' : 'REJECTED'}`,
      entityType: 'ApprovalRequest',
      entityId: requestId,
      previousStatus: current.status,
      newStatus: nextRequestStatus,
      reason: comments || 'Approval step decision recorded.',
      metadata: { stepId: step.id, stepNo: step.stepNo, delegatedAuthorityId: delegationId },
      idempotencyKey,
    });
    return requestSummary(await this.requireRequest(transaction, context.agencyId, requestId));
  }

  private async validateRouteDefinition(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    definition: ApprovalRouteDefinition,
  ): Promise<void> {
    const requiredPermissions = [
      ...new Set(
        definition.steps.flatMap((step) => [
          step.requiredPermission,
          decisionPermission(step, 'APPROVE'),
          decisionPermission(step, 'RETURN'),
          decisionPermission(step, 'REJECT'),
        ]),
      ),
    ];
    const permissions = await transaction.permission.findMany({
      where: { code: { in: requiredPermissions } },
      select: { code: true },
    });
    const knownPermissions = new Set(permissions.map(({ code }) => code.toLowerCase()));
    const unknownPermission = requiredPermissions.find(
      (code) => !knownPermissions.has(code.toLowerCase()),
    );
    if (unknownPermission) {
      throw new ApprovalServiceError(
        `The Approval Route requires an unknown permission: ${unknownPermission}.`,
        409,
        'APPROVAL_ROUTE_PERMISSION_UNKNOWN',
      );
    }
    for (const step of definition.steps) {
      if (step.assignment.kind !== 'MEMBERSHIP') {
        const role = await transaction.role.findFirst({
          where: {
            code: step.assignment.roleCode,
            status: 'ACTIVE',
            OR: [{ agencyId }, { agencyId: null }],
          },
          select: { id: true },
        });
        if (!role) {
          throw new ApprovalServiceError(
            `The Approval Route role ${step.assignment.roleCode} is not active in this Agency.`,
            409,
            'APPROVAL_ROUTE_ROLE_INVALID',
          );
        }
      } else {
        const membership = await transaction.agencyMembership.findFirst({
          where: { agencyId, id: step.assignment.membershipId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!membership) {
          throw new ApprovalServiceError(
            'Every named Approval Route Membership must be active in the Agency.',
            409,
            'APPROVAL_ROUTE_MEMBERSHIP_INVALID',
          );
        }
      }
    }
  }

  private async resolveRoute(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    routeCode: string,
    asOf: Date,
  ): Promise<RouteRecord> {
    const routes = await transaction.approvalRouteVersion.findMany({
      where: {
        agencyId,
        routeCode,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { versionNo: 'desc' },
      select: routeSelect,
    });
    if (routes.length !== 1) {
      throw new ApprovalServiceError(
        'Exactly one active Approval Route Version must apply to the request date.',
        409,
        'APPROVAL_ROUTE_RESOLUTION_FAILED',
      );
    }
    const route = routes[0];
    if (!route) {
      throw new ApprovalServiceError(
        'Exactly one active Approval Route Version must apply to the request date.',
        409,
        'APPROVAL_ROUTE_RESOLUTION_FAILED',
      );
    }
    return route;
  }

  private async requireBoundRoute(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    routeVersionId: string,
    routeCode: string,
    asOf: Date,
  ): Promise<RouteRecord> {
    const route = await transaction.approvalRouteVersion.findFirst({
      where: {
        agencyId,
        id: routeVersionId,
        routeCode,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      select: routeSelect,
    });
    if (!route) {
      throw new ApprovalServiceError(
        'The bound Approval Route Version is no longer active for the request date.',
        409,
        'APPROVAL_ROUTE_RESOLUTION_FAILED',
      );
    }
    return route;
  }

  private async resolveAssignments(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    definition: ApprovalRouteDefinition,
    asOf: Date,
    requesterMembershipId: string,
    subjectEmployeeId: string | undefined,
  ): Promise<Array<{ step: ApprovalRouteStep; membershipId: string; roleCode: string | null }>> {
    const assignments: Array<{
      step: ApprovalRouteStep;
      membershipId: string;
      roleCode: string | null;
    }> = [];
    for (const step of definition.steps) {
      // A subject Supervisor step without one Supervisor falls back to its role,
      // as does a separate-review step whose Supervisor drafted the request.
      const supervisor =
        step.assignment.kind === 'SUBJECT_SUPERVISOR'
          ? await this.resolveSubjectSupervisor(
              transaction,
              agencyId,
              step,
              asOf,
              subjectEmployeeId,
            )
          : null;
      const resolved =
        (supervisor &&
        !(step.requiresSeparateReview && supervisor.membershipId === requesterMembershipId)
          ? supervisor
          : null) ?? (await this.resolveConfiguredAssignment(transaction, agencyId, step, asOf));
      if (step.requiresSeparateReview && resolved.membershipId === requesterMembershipId) {
        throw new ApprovalServiceError(
          'The drafter cannot be assigned to a step that requires separate review.',
          409,
          'APPROVAL_SEGREGATION_REQUIRED',
        );
      }
      assignments.push({ step, ...resolved });
    }
    return assignments;
  }

  /**
   * Resolve a step to the one active Membership it names, or the one holder of
   * its role, with an AGENCY-scoped grant of the step permission.
   */
  private async resolveConfiguredAssignment(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    step: ApprovalRouteStep,
    asOf: Date,
  ): Promise<{ membershipId: string; roleCode: string | null }> {
    const evaluationTime = roleEvaluationTime(asOf);
    const assignedRoleCode =
      step.assignment.kind === 'MEMBERSHIP' ? null : step.assignment.roleCode;
    const rows = await transaction.membershipRole.findMany({
      where: {
        agencyId,
        effectiveFrom: { lte: evaluationTime },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: evaluationTime } }],
        membership: {
          status: 'ACTIVE',
          ...(step.assignment.kind === 'MEMBERSHIP' ? { id: step.assignment.membershipId } : {}),
        },
        role: {
          status: 'ACTIVE',
          permissions: {
            some: {
              scopePolicy: 'AGENCY',
              permission: { code: step.requiredPermission },
            },
          },
          ...(assignedRoleCode
            ? { code: assignedRoleCode, OR: [{ agencyId }, { agencyId: null }] }
            : {}),
        },
      },
      select: { membershipId: true, role: { select: { code: true } } },
    });
    const unique = new Map(rows.map((row) => [row.membershipId, row.role.code]));
    if (unique.size !== 1) {
      throw new ApprovalServiceError(
        unique.size === 0
          ? 'The Approval Route has no active assigned Membership for one of its steps.'
          : 'The Approval Route resolves more than one assigned Membership for one of its steps.',
        409,
        unique.size === 0 ? 'APPROVAL_ASSIGNMENT_UNRESOLVED' : 'APPROVAL_ASSIGNMENT_AMBIGUOUS',
      );
    }
    const assignment = [...unique.entries()][0];
    if (!assignment) {
      throw new ApprovalServiceError(
        'The Approval Route assignment could not be resolved.',
        409,
        'APPROVAL_ASSIGNMENT_UNRESOLVED',
      );
    }
    const [membershipId, roleCode] = assignment;
    return { membershipId, roleCode: assignedRoleCode ?? roleCode };
  }

  /**
   * Resolve a `SUBJECT_SUPERVISOR` step to the subject Employee's one
   * Supervisor on the request date: their active Membership whose role grants
   * the step permission. Returns null, so the step falls back to its role, when
   * the Employee has no Supervisor, more than one, or a Supervisor without such
   * a Membership.
   */
  private async resolveSubjectSupervisor(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    step: ApprovalRouteStep,
    asOf: Date,
    subjectEmployeeId: string | undefined,
  ): Promise<{ membershipId: string; roleCode: string } | null> {
    if (!subjectEmployeeId) {
      throw new ApprovalServiceError(
        "The Approval Route assigns a step to the subject Employee's Supervisor, but the request names no subject Employee.",
        409,
        'APPROVAL_ASSIGNMENT_UNRESOLVED',
      );
    }
    const supervisorIds = await findSupervisorEmployeeIds(
      transaction,
      agencyId,
      subjectEmployeeId,
      formatDate(asOf),
    );
    const [supervisorId] = supervisorIds;
    if (supervisorIds.length !== 1 || !supervisorId) return null;
    const evaluationTime = roleEvaluationTime(asOf);
    const rows = await transaction.membershipRole.findMany({
      where: {
        agencyId,
        effectiveFrom: { lte: evaluationTime },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: evaluationTime } }],
        membership: { status: 'ACTIVE', employeeId: supervisorId },
        role: {
          status: 'ACTIVE',
          permissions: {
            some: {
              scopePolicy: { in: ['AGENCY', 'DIRECT_REPORTS'] },
              permission: { code: step.requiredPermission },
            },
          },
        },
      },
      select: { membershipId: true, role: { select: { code: true } } },
    });
    const unique = new Map(rows.map((row) => [row.membershipId, row.role.code]));
    const [assignment] = [...unique.entries()];
    if (unique.size !== 1 || !assignment) return null;
    return { membershipId: assignment[0], roleCode: assignment[1] };
  }

  /**
   * Checks that the caller is the active step's assigned or delegated
   * authority for a decision, without recording one. Owning domains use it for
   * step actions that do not move the request, such as recording a blocker.
   */
  async assertCurrentStepAuthorityInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const current = await this.requireRequest(transaction, context.agencyId, requestId);
    const step = current.steps.find(
      ({ stepNo, status }) => stepNo === current.currentStepNo && status === 'ACTIVE',
    );
    if (current.status !== 'IN_PROGRESS' || !step || !step.assignedMembershipId) {
      throw new ApprovalServiceError(
        'The Approval Request has no active assigned reviewer.',
        409,
        'APPROVAL_STEP_INVALID',
      );
    }
    await this.assertDecisionAuthority(
      transaction,
      context,
      step,
      decisionPermission(step, decision),
    );
  }

  private async assertDecisionAuthority(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    step: StepRecord,
    actionPermission: string,
    subjectEmployeeId?: string,
  ): Promise<string | null> {
    const now = new Date();
    const roleWindow = {
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    };
    const direct = await transaction.membershipRole.findFirst({
      where: {
        agencyId: context.agencyId,
        membershipId: context.membershipId,
        membership: { status: 'ACTIVE' },
        role: {
          status: 'ACTIVE',
          permissions: {
            some: {
              scopePolicy: 'AGENCY',
              permission: { code: step.requiredPermission },
            },
          },
          AND: [
            {
              permissions: {
                some: {
                  scopePolicy: 'AGENCY',
                  permission: { code: actionPermission },
                },
              },
            },
          ],
        },
        ...roleWindow,
      },
      select: { id: true },
    });
    if (direct && step.assignedMembershipId === context.membershipId) return null;
    if (
      subjectEmployeeId &&
      step.assignedMembershipId === context.membershipId &&
      (await this.isAssignedSupervisor(
        transaction,
        context,
        step,
        actionPermission,
        subjectEmployeeId,
      ))
    ) {
      return null;
    }

    const delegation = step.assignedMembershipId
      ? await transaction.delegatedAuthority.findFirst({
          where: {
            agencyId: context.agencyId,
            delegatorMembershipId: step.assignedMembershipId,
            delegateMembershipId: context.membershipId,
            permissionCode: actionPermission,
            status: 'ACTIVE',
            effectiveFrom: { lte: now },
            effectiveTo: { gt: now },
            delegate: {
              status: 'ACTIVE',
            },
            delegator: {
              status: 'ACTIVE',
              membershipRoles: {
                some: {
                  ...roleWindow,
                  role: {
                    status: 'ACTIVE',
                    permissions: {
                      some: {
                        scopePolicy: 'AGENCY',
                        permission: { code: step.requiredPermission },
                      },
                    },
                  },
                  AND: [
                    {
                      role: {
                        permissions: {
                          some: {
                            scopePolicy: 'AGENCY',
                            permission: { code: actionPermission },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          select: { id: true },
        })
      : null;
    if (delegation) return delegation.id;
    throw new ApprovalServiceError(
      'The current user is not the assigned or delegated Approval Step authority.',
      403,
      'APPROVAL_AUTHORITY_REQUIRED',
    );
  }

  /**
   * The assigned Membership decides on a `DIRECT_REPORTS` grant only while the
   * subject Employee is its Employee's direct report on the decision date.
   */
  private async isAssignedSupervisor(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    step: StepRecord,
    actionPermission: string,
    subjectEmployeeId: string,
  ): Promise<boolean> {
    const now = new Date();
    const membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: context.membershipId, status: 'ACTIVE' },
      select: { employeeId: true },
    });
    if (!membership?.employeeId) return false;
    const grant = await transaction.membershipRole.findFirst({
      where: {
        agencyId: context.agencyId,
        membershipId: context.membershipId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        role: {
          status: 'ACTIVE',
          permissions: {
            some: {
              scopePolicy: 'DIRECT_REPORTS',
              permission: { code: step.requiredPermission },
            },
          },
          AND: [
            {
              permissions: {
                some: {
                  scopePolicy: 'DIRECT_REPORTS',
                  permission: { code: actionPermission },
                },
              },
            },
          ],
        },
      },
      select: { id: true },
    });
    if (!grant) return false;
    const reports = await findDirectReportEmployeeIds(
      transaction,
      context.agencyId,
      membership.employeeId,
      formatDate(approvalDate()),
    );
    return reports.includes(subjectEmployeeId);
  }

  private async lockRoute(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    routeId: string,
  ): Promise<RouteRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "approval_route_versions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${routeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return transaction.approvalRouteVersion.findUnique({
      where: { agencyId_id: { agencyId, id: routeId } },
      select: routeSelect,
    });
  }

  private async lockRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<RequestRecord | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "approval_requests" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${requestId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return this.requireRequest(transaction, agencyId, requestId);
  }

  private async requireRequest(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    requestId: string,
  ): Promise<RequestRecord> {
    const request = await transaction.approvalRequest.findUnique({
      where: { agencyId_id: { agencyId, id: requestId } },
      include: requestInclude,
    });
    if (!request) throw this.notFound('Approval Request');
    return request;
  }

  private async idempotentEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    idempotencyKey: string | null,
    entityId?: string,
  ): Promise<{ entityId: string; reason: string | null; metadata: Prisma.JsonValue } | null> {
    if (!idempotencyKey) return null;
    return transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action,
        idempotencyKey,
        ...(entityId ? { entityId } : {}),
      },
      select: { entityId: true, reason: true, metadata: true },
    });
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      entityType: string;
      entityId: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string;
      metadata: Prisma.InputJsonValue;
      idempotencyKey?: string | null;
    },
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      reason: input.reason,
      requestId: context.requestId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      metadata: input.metadata,
    });
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new ApprovalServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  /**
   * Internal contract: the owning domain already asserted its own scoped
   * authority, so accept an operational grant in either AGENCY or OWN scope.
   * Public Approval endpoints keep the narrower AGENCY-only check.
   */
  private assertOperationalPermission(
    context: RequestContext,
    permission: string,
    code: string,
  ): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !context.permissions.some((grant) => grant.code === permission)
    ) {
      throw new ApprovalServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private assertReason(reason: string, code: string): void {
    if (reason.trim().length === 0) {
      throw new ApprovalServiceError(
        'A reason is required for this Approval transition.',
        400,
        code,
      );
    }
  }

  private notFound(entity: string): ApprovalServiceError {
    return new ApprovalServiceError(`The ${entity} could not be found.`, 404, 'APPROVAL_NOT_FOUND');
  }

  private routeWorkflowError(action: string, status: string): ApprovalServiceError {
    return new ApprovalServiceError(
      `The Approval Route cannot ${action} from ${status}.`,
      409,
      'APPROVAL_ROUTE_INVALID_TRANSITION',
    );
  }

  private requestWorkflowError(action: string, status: string): ApprovalServiceError {
    return new ApprovalServiceError(
      `The Approval Request cannot ${action} from ${status}.`,
      409,
      'APPROVAL_REQUEST_INVALID_TRANSITION',
    );
  }

  private idempotencyConflict(): ApprovalServiceError {
    return new ApprovalServiceError(
      'The Idempotency-Key was already used for a different Approval command.',
      409,
      'APPROVAL_IDEMPOTENCY_CONFLICT',
    );
  }
}
