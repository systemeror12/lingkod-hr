import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { auditEventCursorSchema } from './audit.schemas';

export const ORGANIZATION_UNIT_AUDIT_ENTITY = 'OrganizationUnit';
export const ORGANIZATION_UNIT_CREATED_AUDIT_ACTION = 'ORGANIZATION_UNIT_CREATED';
export const ORGANIZATION_UNIT_ACTIVATED_AUDIT_ACTION = 'ORGANIZATION_UNIT_ACTIVATED';
const DEFAULT_PAGE_SIZE = 25;

export type AuditActorType = 'USER' | 'SYSTEM' | 'INTEGRATION';

export type SanitizedAuditValue =
  null | boolean | number | string | SanitizedAuditValue[] | { [key: string]: SanitizedAuditValue };

export interface AuditEventListItem {
  id: string;
  occurredAt: string;
  actor: string;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId: string;
  previousStatus: string | null;
  newStatus: string | null;
}

export interface AuditEventDetail extends AuditEventListItem {
  requestId: string | null;
  before: SanitizedAuditValue | null;
  after: SanitizedAuditValue | null;
}

export interface AuditEventList {
  events: AuditEventListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AuditEventListQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export class AuditServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AuditServiceError';
  }
}

const SENSITIVE_KEY =
  /(token|secret|password|credential|authorization|cookie|session|private.?key|api.?key|access.?key|refresh)/i;
const PERSONAL_KEY = /^(email|phone|mobile|address|birth|dob|ssn|tax|bank|account|salary)/i;
const ORGANIZATION_UNIT_EVIDENCE_FIELDS = [
  'officialName',
  'code',
  'unitType',
  'effectiveDate',
  'parentUnitId',
  'versionState',
  'lifecycleStatus',
] as const;

const ORGANIZATION_UNIT_AUDIT_TRANSITIONS: Prisma.AuditEventWhereInput[] = [
  {
    action: ORGANIZATION_UNIT_CREATED_AUDIT_ACTION,
    previousStatus: 'None',
    newStatus: 'DRAFT',
  },
  {
    action: ORGANIZATION_UNIT_ACTIVATED_AUDIT_ACTION,
    previousStatus: 'DRAFT',
    newStatus: 'ACTIVE',
  },
];

function isRecord(value: SanitizedAuditValue | null): value is Record<string, SanitizedAuditValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown, depth: number): SanitizedAuditValue | undefined {
  if (depth > 4) return '[omitted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 497)}…` : value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is SanitizedAuditValue => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;

  const result: Record<string, SanitizedAuditValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      SENSITIVE_KEY.test(key) ||
      PERSONAL_KEY.test(key)
    ) {
      continue;
    }
    const sanitized = sanitizeValue(item, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

export function sanitizeAuditValue(value: unknown): SanitizedAuditValue | null {
  return sanitizeValue(value, 0) ?? null;
}

function organizationUnitEvidence(value: SanitizedAuditValue | null): SanitizedAuditValue | null {
  if (!isRecord(value)) return null;
  const evidence: Record<string, SanitizedAuditValue> = {};
  for (const field of ORGANIZATION_UNIT_EVIDENCE_FIELDS) {
    if (typeof value[field] === 'string' || value[field] === null) evidence[field] = value[field];
  }
  return evidence;
}

function changeData(metadata: unknown): {
  before: SanitizedAuditValue | null;
  after: SanitizedAuditValue | null;
} {
  const sanitized = sanitizeAuditValue(metadata);
  if (!isRecord(sanitized)) return { before: null, after: null };

  const hasBefore = Object.prototype.hasOwnProperty.call(sanitized, 'before');
  const hasAfter = Object.prototype.hasOwnProperty.call(sanitized, 'after');
  if (!hasBefore && !hasAfter) return { before: null, after: organizationUnitEvidence(sanitized) };

  return {
    before: organizationUnitEvidence(sanitized.before ?? null),
    after: organizationUnitEvidence(sanitized.after ?? null),
  };
}

function manilaTimestamp(value: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value: part }) => [type, part]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(value.getUTCMilliseconds()).padStart(3, '0')}+08:00`;
}

function actorLabel(actorType: AuditActorType, displayName: string | null): string {
  if (displayName) return displayName;
  if (actorType === 'SYSTEM') return 'System';
  if (actorType === 'INTEGRATION') return 'Integration';
  return 'Unknown user';
}

const auditEventSelect = {
  id: true,
  actorType: true,
  action: true,
  entityType: true,
  entityId: true,
  previousStatus: true,
  newStatus: true,
  requestId: true,
  occurredAt: true,
  metadata: true,
  actorUser: { select: { displayName: true } },
} as const;

type AuditEventRecord = Prisma.AuditEventGetPayload<{ select: typeof auditEventSelect }>;

function actorType(value: string): AuditActorType {
  if (value === 'USER' || value === 'SYSTEM' || value === 'INTEGRATION') return value;
  return 'SYSTEM';
}

function listItemFromRecord(record: AuditEventRecord): AuditEventListItem {
  const type = actorType(record.actorType);
  return {
    id: record.id,
    occurredAt: manilaTimestamp(record.occurredAt),
    actor: actorLabel(type, record.actorUser?.displayName ?? null),
    actorType: type,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    previousStatus: record.previousStatus,
    newStatus: record.newStatus,
  };
}

function encodeCursor(record: Pick<AuditEventRecord, 'id' | 'occurredAt'>): string {
  return Buffer.from(
    JSON.stringify({ id: record.id, occurredAt: record.occurredAt.toISOString() }),
  ).toString('base64url');
}

function decodeCursor(value: string): { id: string; occurredAt: Date } {
  try {
    const decoded = auditEventCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return { id: decoded.id, occurredAt: new Date(decoded.occurredAt) };
  } catch {
    throw new AuditServiceError('The audit event cursor is invalid.', 400, 'INVALID_CURSOR');
  }
}

function databaseContext(context: RequestContext) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
  };
}

@Injectable()
export class AuditService {
  async list(context: RequestContext, query: AuditEventListQuery = {}): Promise<AuditEventList> {
    this.assertReadAccess(context);
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new AuditServiceError('The Audit Log page size is invalid.', 400, 'INVALID_PAGE_SIZE');
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const where: Prisma.AuditEventWhereInput = {
        agencyId: context.agencyId,
        entityType: ORGANIZATION_UNIT_AUDIT_ENTITY,
        OR: ORGANIZATION_UNIT_AUDIT_TRANSITIONS,
      };
      if (cursor) {
        where.AND = [
          {
            OR: [
              { occurredAt: { lt: cursor.occurredAt } },
              { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
            ],
          },
        ];
      }

      const records = await transaction.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: auditEventSelect,
      });
      const hasMore = records.length > limit;
      const visibleRecords = hasMore ? records.slice(0, limit) : records;
      return {
        events: visibleRecords.map(listItemFromRecord),
        hasMore,
        nextCursor: hasMore ? encodeCursor(visibleRecords[visibleRecords.length - 1]!) : null,
      };
    });
  }

  async findById(context: RequestContext, id: string): Promise<AuditEventDetail | null> {
    this.assertReadAccess(context);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.auditEvent.findFirst({
        where: {
          id,
          agencyId: context.agencyId,
          entityType: ORGANIZATION_UNIT_AUDIT_ENTITY,
          OR: ORGANIZATION_UNIT_AUDIT_TRANSITIONS,
        },
        select: auditEventSelect,
      });
      if (!record) return null;
      const item = listItemFromRecord(record);
      const changes = changeData(record.metadata);
      return {
        ...item,
        requestId: record.requestId,
        before: changes.before,
        after: changes.after,
      };
    });
  }

  private assertReadAccess(context: RequestContext): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, 'audit.events.read', { agencyId: context.agencyId })
    ) {
      throw new AuditServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        'AUDIT_EVENT_READ_FORBIDDEN',
      );
    }
  }
}
