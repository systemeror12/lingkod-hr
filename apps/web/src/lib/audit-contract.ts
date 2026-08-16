export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  actorType: 'USER' | 'SYSTEM' | 'INTEGRATION';
  action: string;
  entityType: string;
  entityId: string;
  previousStatus: string | null;
  newStatus: string | null;
}

export interface AuditEventListResponse {
  events: AuditEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AuditEventDetail extends AuditEvent {
  requestId: string | null;
  before: unknown;
  after: unknown;
}

export function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<AuditEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.occurredAt === 'string' &&
    typeof event.actor === 'string' &&
    (event.actorType === 'USER' ||
      event.actorType === 'SYSTEM' ||
      event.actorType === 'INTEGRATION') &&
    typeof event.action === 'string' &&
    typeof event.entityType === 'string' &&
    typeof event.entityId === 'string' &&
    (event.previousStatus === null || typeof event.previousStatus === 'string') &&
    (event.newStatus === null || typeof event.newStatus === 'string')
  );
}

export function isAuditEventListResponse(value: unknown): value is AuditEventListResponse {
  if (typeof value !== 'object' || value === null) return false;
  const list = value as Partial<AuditEventListResponse>;
  return (
    Array.isArray(list.events) &&
    list.events.every(isAuditEvent) &&
    typeof list.hasMore === 'boolean' &&
    (list.nextCursor === null || typeof list.nextCursor === 'string')
  );
}

export function isAuditEventDetail(value: unknown): value is AuditEventDetail {
  if (typeof value !== 'object' || value === null || !isAuditEvent(value)) return false;
  const detail = value as Partial<AuditEventDetail>;
  return (
    (detail.requestId === null || typeof detail.requestId === 'string') &&
    'before' in detail &&
    'after' in detail
  );
}
