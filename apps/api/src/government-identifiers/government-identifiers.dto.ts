import type {
  GovernmentIdentifierHistory,
  GovernmentIdentifierHistoryEntry,
  GovernmentIdentifierReveal,
  GovernmentIdentifierSummary,
} from './government-identifiers.service';

export class GovernmentIdentifierDto {
  readonly id: string;
  readonly employeeId: string;
  readonly identifierType: GovernmentIdentifierSummary['identifierType'];
  readonly maskedValue: string;
  readonly verifiedAt: string | null;
  readonly status: GovernmentIdentifierSummary['status'];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reason: string | null;
  readonly evidenceDocumentId: string | null;
  readonly evidenceDocumentVersionId: string | null;
  readonly replacesIdentifierId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(identifier: GovernmentIdentifierSummary) {
    this.id = identifier.id;
    this.employeeId = identifier.employeeId;
    this.identifierType = identifier.identifierType;
    this.maskedValue = identifier.maskedValue;
    this.verifiedAt = identifier.verifiedAt;
    this.status = identifier.status;
    this.effectiveFrom = identifier.effectiveFrom;
    this.effectiveTo = identifier.effectiveTo;
    this.reason = identifier.reason;
    this.evidenceDocumentId = identifier.evidenceDocumentId;
    this.evidenceDocumentVersionId = identifier.evidenceDocumentVersionId;
    this.replacesIdentifierId = identifier.replacesIdentifierId;
    this.createdAt = identifier.createdAt;
    this.updatedAt = identifier.updatedAt;
  }
}

export class GovernmentIdentifierListResponseDto {
  readonly identifiers: GovernmentIdentifierDto[];

  constructor(identifiers: GovernmentIdentifierSummary[]) {
    this.identifiers = identifiers.map((identifier) => new GovernmentIdentifierDto(identifier));
  }
}

export class GovernmentIdentifierHistoryEntryDto {
  readonly id: string;
  readonly identifierId: string;
  readonly identifierType: GovernmentIdentifierHistoryEntry['identifierType'];
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly maskedValue: string | null;
  readonly reason: string | null;
  readonly actorDisplayName: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly evidenceDocumentId: string | null;
  readonly evidenceDocumentVersionId: string | null;
  readonly replacesIdentifierId: string | null;
  readonly actedAt: string;

  constructor(entry: GovernmentIdentifierHistoryEntry) {
    this.id = entry.id;
    this.identifierId = entry.identifierId;
    this.identifierType = entry.identifierType;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.maskedValue = entry.maskedValue;
    this.reason = entry.reason;
    this.actorDisplayName = entry.actorDisplayName;
    this.effectiveFrom = entry.effectiveFrom;
    this.effectiveTo = entry.effectiveTo;
    this.evidenceDocumentId = entry.evidenceDocumentId;
    this.evidenceDocumentVersionId = entry.evidenceDocumentVersionId;
    this.replacesIdentifierId = entry.replacesIdentifierId;
    this.actedAt = entry.actedAt;
  }
}

export class GovernmentIdentifierHistoryResponseDto {
  readonly entries: GovernmentIdentifierHistoryEntryDto[];

  constructor(history: GovernmentIdentifierHistory) {
    this.entries = history.entries.map((entry) => new GovernmentIdentifierHistoryEntryDto(entry));
  }
}

export class GovernmentIdentifierRevealDto extends GovernmentIdentifierDto {
  readonly value: string;

  constructor(identifier: GovernmentIdentifierReveal) {
    super(identifier);
    this.value = identifier.value;
  }
}
