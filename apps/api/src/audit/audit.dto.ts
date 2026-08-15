import type {
  AuditEventDetail,
  AuditEventList,
  AuditEventListItem,
  SanitizedAuditValue,
} from './audit.service';

export class AuditEventListItemDto {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly actorType: AuditEventListItem['actorType'];
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;

  constructor(event: AuditEventListItem) {
    this.id = event.id;
    this.occurredAt = event.occurredAt;
    this.actor = event.actor;
    this.actorType = event.actorType;
    this.action = event.action;
    this.entityType = event.entityType;
    this.entityId = event.entityId;
    this.previousStatus = event.previousStatus;
    this.newStatus = event.newStatus;
  }
}

export class AuditEventListResponseDto {
  readonly events: AuditEventListItemDto[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;

  constructor(result: AuditEventList) {
    this.events = result.events.map((event) => new AuditEventListItemDto(event));
    this.nextCursor = result.nextCursor;
    this.hasMore = result.hasMore;
  }
}

export class AuditEventDetailDto extends AuditEventListItemDto {
  readonly requestId: string | null;
  readonly before: SanitizedAuditValue | null;
  readonly after: SanitizedAuditValue | null;

  constructor(event: AuditEventDetail) {
    super(event);
    this.requestId = event.requestId;
    this.before = event.before;
    this.after = event.after;
  }
}
