import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccessRecord, type RequestContext } from '@lingkod-hr/auth';
import {
  ProtectedValueError,
  decryptProtectedValue,
  encryptProtectedValue,
  getConfig,
  normalizeProtectedValue,
  parseProtectedValueKey,
  sanitizeProtectedValueMetadata,
  type ProtectedValueKey,
} from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import type {
  GovernmentIdentifierStatus,
  GovernmentIdentifierType,
} from './government-identifiers.constants';
import { GOVERNMENT_IDENTIFIER_TYPES } from './government-identifiers.constants';

export interface GovernmentIdentifierCreateInput {
  identifierType: GovernmentIdentifierType;
  value: string;
  effectiveFrom?: string | undefined;
  verifiedAt?: string | null | undefined;
  reason?: string | null | undefined;
  evidenceDocumentId?: string | null | undefined;
  evidenceDocumentVersionId?: string | null | undefined;
}

export type GovernmentIdentifierReplaceInput = GovernmentIdentifierCreateInput & {
  reason: string;
};

export interface GovernmentIdentifierInvalidateInput {
  reason: string;
  effectiveTo?: string | null | undefined;
}

export interface GovernmentIdentifierRevealInput {
  reason?: string | null | undefined;
}

export interface GovernmentIdentifierSummary {
  id: string;
  employeeId: string;
  identifierType: GovernmentIdentifierType;
  maskedValue: string;
  verifiedAt: string | null;
  status: GovernmentIdentifierStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  evidenceDocumentId: string | null;
  evidenceDocumentVersionId: string | null;
  replacesIdentifierId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernmentIdentifierReveal extends GovernmentIdentifierSummary {
  value: string;
}

export interface GovernmentIdentifierHistoryEntry {
  id: string;
  identifierId: string;
  identifierType: GovernmentIdentifierType | null;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  maskedValue: string | null;
  reason: string | null;
  actorDisplayName: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  evidenceDocumentId: string | null;
  evidenceDocumentVersionId: string | null;
  replacesIdentifierId: string | null;
  actedAt: string;
}

export interface GovernmentIdentifierHistory {
  entries: GovernmentIdentifierHistoryEntry[];
}

export interface GovernmentIdentifierAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const GOVERNMENT_IDENTIFIER_AUDIT_WRITER = Symbol('GOVERNMENT_IDENTIFIER_AUDIT_WRITER');

export const governmentIdentifierAuditWriter: GovernmentIdentifierAuditWriter = {
  async write(transaction, event): Promise<void> {
    const { metadata, ...rest } = event;
    await transaction.auditEvent.create({
      data: { ...rest, metadata: sanitizeGovernmentIdentifierAuditMetadata(metadata) },
    });
  },
};

export class GovernmentIdentifiersServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GovernmentIdentifiersServiceError';
  }
}

const LIST_LIMIT = 200;
const ENCRYPTION_VERSION = 1;

const identifierSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  identifierType: true,
  encryptedValue: true,
  encryptionVersion: true,
  maskedValue: true,
  verifiedAt: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  reason: true,
  evidenceDocumentId: true,
  evidenceDocumentVersionId: true,
  replacesIdentifierId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const historyEventSelect = {
  id: true,
  entityId: true,
  action: true,
  previousStatus: true,
  newStatus: true,
  reason: true,
  occurredAt: true,
  metadata: true,
  actorUser: { select: { displayName: true } },
} as const;

type HistoryEventRecord = Prisma.AuditEventGetPayload<{ select: typeof historyEventSelect }>;

const employeeAccessSelect = {
  id: true,
  memberships: {
    where: { status: 'ACTIVE' },
    select: { id: true, userId: true },
  },
  currentServiceSegment: { select: { organizationUnitId: true } },
} as const;

interface IdentifierRecord {
  id: string;
  agencyId: string;
  employeeId: string;
  identifierType: string;
  encryptedValue: Buffer;
  encryptionVersion: number;
  maskedValue: string;
  verifiedAt: Date | null;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string | null;
  evidenceDocumentId: string | null;
  evidenceDocumentVersionId: string | null;
  replacesIdentifierId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
type EmployeeAccessRecord = Prisma.EmployeeGetPayload<{ select: typeof employeeAccessSelect }>;
type IdentifierClient = {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Record<string, string>[];
    take: number;
    select: typeof identifierSelect;
  }): Promise<IdentifierRecord[]>;
  findFirst(args: {
    where: Record<string, unknown>;
    select: typeof identifierSelect;
  }): Promise<IdentifierRecord | null>;
  create(args: {
    data: Record<string, unknown>;
    select: typeof identifierSelect;
  }): Promise<IdentifierRecord>;
  update(args: {
    where: { agencyId_id: { agencyId: string; id: string } };
    data: Record<string, unknown>;
    select: typeof identifierSelect;
  }): Promise<IdentifierRecord>;
};

function governmentIdentifiers(transaction: Prisma.TransactionClient): IdentifierClient {
  return (transaction as Prisma.TransactionClient & { governmentIdentifier: IdentifierClient })
    .governmentIdentifier;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function todayDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function toDatabaseDate(value: string, code: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new GovernmentIdentifiersServiceError(
      'Enter a valid government identifier effective date.',
      400,
      code,
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw new GovernmentIdentifiersServiceError(
      'Enter a valid government identifier effective date.',
      400,
      code,
    );
  }
  return date;
}

function optionalDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new GovernmentIdentifiersServiceError(
      'Enter a valid government identifier verification timestamp.',
      400,
      'GOVERNMENT_IDENTIFIER_VERIFIED_AT_INVALID',
    );
  }
  return date;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function ownerUserId(record: EmployeeAccessRecord): string | null {
  return record.memberships[0]?.userId ?? null;
}

function accessRecord(context: RequestContext, employee: EmployeeAccessRecord) {
  const owner = ownerUserId(employee);
  return {
    agencyId: context.agencyId,
    ...(owner ? { ownerUserId: owner } : {}),
    ...(employee.currentServiceSegment
      ? { organizationUnitId: employee.currentServiceSegment.organizationUnitId }
      : {}),
  };
}

function summary(record: IdentifierRecord): GovernmentIdentifierSummary {
  return {
    id: record.id,
    employeeId: record.employeeId,
    identifierType: record.identifierType as GovernmentIdentifierType,
    maskedValue: record.maskedValue,
    verifiedAt: record.verifiedAt ? formatDateTime(record.verifiedAt) : null,
    status: record.status as GovernmentIdentifierStatus,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    reason: record.reason,
    evidenceDocumentId: record.evidenceDocumentId,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    replacesIdentifierId: record.replacesIdentifierId,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function auditMetadata(
  value: GovernmentIdentifierSummary,
  extra: Prisma.InputJsonObject = {},
): Prisma.InputJsonObject {
  return {
    employeeId: value.employeeId,
    identifierType: value.identifierType,
    maskedValue: value.maskedValue,
    status: value.status,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    evidenceDocumentId: value.evidenceDocumentId,
    evidenceDocumentVersionId: value.evidenceDocumentVersionId,
    replacesIdentifierId: value.replacesIdentifierId,
    ...extra,
  };
}

export function sanitizeGovernmentIdentifierAuditMetadata(value: unknown): Prisma.InputJsonObject {
  return sanitizeProtectedValueMetadata(value) as Prisma.InputJsonObject;
}

function protectedValueMatchesRecord(
  metadata: Buffer,
  employeeId: string,
  identifierType: string,
): boolean {
  try {
    const value: unknown = JSON.parse(metadata.toString('utf8'));
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { employeeId?: unknown }).employeeId === employeeId &&
      (value as { identifierType?: unknown }).identifierType === identifierType
    );
  } catch {
    return false;
  }
}

type GovernmentIdentifierRevealResult =
  | { kind: 'denied' }
  | { kind: 'reason-required' }
  | { kind: 'encryption-unavailable' }
  | { kind: 'failed' }
  | { kind: 'revealed'; value: GovernmentIdentifierReveal };
type GovernmentIdentifierRevealAuditStatus = 'DENIED' | 'FAILED' | 'REVEALED';

function metadataObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function metadataString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function metadataField(metadata: unknown, field: string): string | null {
  const root = metadataObject(metadata);
  if (!root) return null;
  const after = metadataObject(root.after);
  const before = metadataObject(root.before);
  return (
    metadataString(after?.[field]) ?? metadataString(root[field]) ?? metadataString(before?.[field])
  );
}

function metadataIdentifierType(metadata: unknown): GovernmentIdentifierType | null {
  const value = metadataField(metadata, 'identifierType');
  return value && (GOVERNMENT_IDENTIFIER_TYPES as readonly string[]).includes(value)
    ? (value as GovernmentIdentifierType)
    : null;
}

function replacementLineageIds(
  records: readonly IdentifierRecord[],
  selectedId: string,
): Set<string> {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ids = new Set<string>([selectedId]);
  let current = byId.get(selectedId);
  while (current?.replacesIdentifierId) {
    const parent = byId.get(current.replacesIdentifierId);
    if (!parent) break;
    ids.add(parent.id);
    current = parent;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (
        record.replacesIdentifierId &&
        ids.has(record.replacesIdentifierId) &&
        !ids.has(record.id)
      ) {
        ids.add(record.id);
        changed = true;
      }
    }
  }
  return ids;
}

function historyEntry(event: HistoryEventRecord): GovernmentIdentifierHistoryEntry {
  return {
    id: event.id,
    identifierId: event.entityId,
    identifierType: metadataIdentifierType(event.metadata),
    action: event.action,
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
    maskedValue: metadataField(event.metadata, 'maskedValue'),
    reason: event.reason,
    actorDisplayName: event.actorUser?.displayName ?? null,
    effectiveFrom: metadataField(event.metadata, 'effectiveFrom'),
    effectiveTo: metadataField(event.metadata, 'effectiveTo'),
    evidenceDocumentId: metadataField(event.metadata, 'evidenceDocumentId'),
    evidenceDocumentVersionId: metadataField(event.metadata, 'evidenceDocumentVersionId'),
    replacesIdentifierId: metadataField(event.metadata, 'replacesIdentifierId'),
    actedAt: formatDateTime(event.occurredAt),
  };
}

@Injectable()
export class GovernmentIdentifiersService {
  private readonly protectedValueKey: ProtectedValueKey | null;

  constructor(
    @Inject(GOVERNMENT_IDENTIFIER_AUDIT_WRITER)
    private readonly auditWriter: GovernmentIdentifierAuditWriter,
  ) {
    const rawKey = getConfig().DATA_ENCRYPTION_KEY;
    if (!rawKey) {
      this.protectedValueKey = null;
      return;
    }
    try {
      this.protectedValueKey = parseProtectedValueKey(rawKey);
    } catch (error: unknown) {
      if (!(error instanceof ProtectedValueError)) throw error;
      this.protectedValueKey = null;
    }
  }

  async listActive(
    context: RequestContext,
    employeeId: string,
  ): Promise<GovernmentIdentifierSummary[] | null> {
    this.assertPermission(
      context,
      'personnel.identifiers.read',
      'GOVERNMENT_IDENTIFIER_READ_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context),
      async (transaction: Prisma.TransactionClient) => {
        const employee = await this.employeeAccess(transaction, context, employeeId);
        if (!employee) return null;
        if (!this.canAccess(context, 'personnel.identifiers.read', employee)) return null;
        const records = await governmentIdentifiers(transaction).findMany({
          where: { agencyId: context.agencyId, employeeId, status: 'ACTIVE' },
          orderBy: [{ identifierType: 'asc' }, { effectiveFrom: 'desc' }],
          take: LIST_LIMIT,
          select: identifierSelect,
        });
        return records.map(summary);
      },
    );
  }

  async create(
    context: RequestContext,
    employeeId: string,
    input: GovernmentIdentifierCreateInput,
  ): Promise<GovernmentIdentifierSummary> {
    this.assertPermission(
      context,
      'personnel.identifiers.manage',
      'GOVERNMENT_IDENTIFIER_MANAGE_FORBIDDEN',
    );
    const effectiveFrom = toDatabaseDate(
      input.effectiveFrom ?? todayDate(),
      'GOVERNMENT_IDENTIFIER_EFFECTIVE_FROM_INVALID',
    );
    const sealed = this.encrypt(input, employeeId);
    return withDatabaseContext(
      requestDatabaseContext(context, 'government-identifier-transition'),
      async (transaction: Prisma.TransactionClient) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        if (!employee) throw this.notFound();
        if (!this.canAccess(context, 'personnel.identifiers.manage', employee))
          throw this.notFound();
        await this.assertNoActive(transaction, context.agencyId, employeeId, input.identifierType);
        await this.assertEvidence(transaction, context, input);
        const created = await governmentIdentifiers(transaction).create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            identifierType: input.identifierType,
            encryptedValue: sealed.envelope,
            encryptionVersion: ENCRYPTION_VERSION,
            maskedValue: sealed.maskedValue,
            verifiedAt: optionalDateTime(input.verifiedAt),
            status: 'ACTIVE',
            effectiveFrom,
            reason: optionalTrimmed(input.reason),
            evidenceDocumentId: input.evidenceDocumentId ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: identifierSelect,
        });
        const value = summary(created);
        await this.writeAudit(transaction, context, 'GOVERNMENT_IDENTIFIER_CREATED', value, {
          previousStatus: 'NONE',
          newStatus: value.status,
          metadata: auditMetadata(value),
        });
        return value;
      },
    );
  }

  async history(
    context: RequestContext,
    employeeId: string,
    identifierId?: string,
  ): Promise<GovernmentIdentifierHistory | null> {
    this.assertPermission(
      context,
      'personnel.identifiers.history.read',
      'GOVERNMENT_IDENTIFIER_HISTORY_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context),
      async (transaction: Prisma.TransactionClient) => {
        const employee = await this.employeeAccess(transaction, context, employeeId);
        if (!employee) return null;
        if (!this.canAccess(context, 'personnel.identifiers.history.read', employee)) return null;
        const selected = identifierId
          ? await this.identifier(transaction, context.agencyId, employeeId, identifierId)
          : null;
        if (identifierId && !selected) return null;
        const records = await governmentIdentifiers(transaction).findMany({
          where: { agencyId: context.agencyId, employeeId },
          orderBy: [{ identifierType: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
          take: LIST_LIMIT,
          select: identifierSelect,
        });
        const identifierIds = selected
          ? replacementLineageIds(records, selected.id)
          : new Set(records.map((record) => record.id));
        if (identifierIds.size === 0) return { entries: [] };
        const events = await transaction.auditEvent.findMany({
          where: {
            agencyId: context.agencyId,
            entityType: 'GovernmentIdentifier',
            entityId: { in: [...identifierIds] },
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: LIST_LIMIT,
          select: historyEventSelect,
        });
        return { entries: events.map(historyEntry) };
      },
    );
  }

  async replace(
    context: RequestContext,
    employeeId: string,
    identifierId: string,
    input: GovernmentIdentifierReplaceInput,
  ): Promise<GovernmentIdentifierSummary> {
    this.assertPermission(
      context,
      'personnel.identifiers.manage',
      'GOVERNMENT_IDENTIFIER_MANAGE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.reasonRequired();
    const effectiveFrom = toDatabaseDate(
      input.effectiveFrom ?? todayDate(),
      'GOVERNMENT_IDENTIFIER_EFFECTIVE_FROM_INVALID',
    );
    const sealed = this.encrypt(input, employeeId);
    return withDatabaseContext(
      requestDatabaseContext(context, 'government-identifier-transition'),
      async (transaction: Prisma.TransactionClient) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        if (!employee) throw this.notFound();
        if (!this.canAccess(context, 'personnel.identifiers.manage', employee))
          throw this.notFound();
        const existing = await this.identifier(
          transaction,
          context.agencyId,
          employeeId,
          identifierId,
        );
        if (!existing || existing.status !== 'ACTIVE') throw this.notFound();
        if (existing.identifierType !== input.identifierType) {
          throw new GovernmentIdentifiersServiceError(
            'Replacement must keep the same government identifier type.',
            400,
            'GOVERNMENT_IDENTIFIER_TYPE_MISMATCH',
          );
        }
        if (effectiveFrom <= existing.effectiveFrom) {
          throw new GovernmentIdentifiersServiceError(
            'The replacement effective date must be after the existing identifier date.',
            400,
            'GOVERNMENT_IDENTIFIER_EFFECTIVE_PERIOD_INVALID',
          );
        }
        await this.assertEvidence(transaction, context, input);
        const replaced = await governmentIdentifiers(transaction).update({
          where: { agencyId_id: { agencyId: context.agencyId, id: identifierId } },
          data: {
            status: 'REPLACED',
            effectiveTo: addDays(effectiveFrom, -1),
            reason,
            updatedByMembershipId: context.membershipId,
          },
          select: identifierSelect,
        });
        const created = await governmentIdentifiers(transaction).create({
          data: {
            agencyId: context.agencyId,
            employeeId,
            identifierType: input.identifierType,
            encryptedValue: sealed.envelope,
            encryptionVersion: ENCRYPTION_VERSION,
            maskedValue: sealed.maskedValue,
            verifiedAt: optionalDateTime(input.verifiedAt),
            status: 'ACTIVE',
            effectiveFrom,
            reason,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
            evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
            replacesIdentifierId: identifierId,
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: identifierSelect,
        });
        const before = summary(replaced);
        const after = summary(created);
        await this.writeAudit(transaction, context, 'GOVERNMENT_IDENTIFIER_REPLACED', after, {
          previousStatus: 'ACTIVE',
          newStatus: 'REPLACED',
          reason,
          metadata: { before: auditMetadata(before), after: auditMetadata(after) },
        });
        return after;
      },
    );
  }

  async invalidate(
    context: RequestContext,
    employeeId: string,
    identifierId: string,
    input: GovernmentIdentifierInvalidateInput,
  ): Promise<GovernmentIdentifierSummary> {
    this.assertPermission(
      context,
      'personnel.identifiers.manage',
      'GOVERNMENT_IDENTIFIER_MANAGE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.reasonRequired();
    return withDatabaseContext(
      requestDatabaseContext(context, 'government-identifier-transition'),
      async (transaction: Prisma.TransactionClient) => {
        await this.lockEmployee(transaction, context.agencyId, employeeId);
        const employee = await this.employeeAccess(transaction, context, employeeId);
        if (!employee) throw this.notFound();
        if (!this.canAccess(context, 'personnel.identifiers.manage', employee))
          throw this.notFound();
        const existing = await this.identifier(
          transaction,
          context.agencyId,
          employeeId,
          identifierId,
        );
        if (!existing || existing.status !== 'ACTIVE') throw this.notFound();
        const before = summary(existing);
        const effectiveTo = input.effectiveTo
          ? toDatabaseDate(input.effectiveTo, 'GOVERNMENT_IDENTIFIER_EFFECTIVE_TO_INVALID')
          : toDatabaseDate(todayDate(), 'GOVERNMENT_IDENTIFIER_EFFECTIVE_TO_INVALID');
        if (effectiveTo < existing.effectiveFrom) {
          throw new GovernmentIdentifiersServiceError(
            'The invalidation date must be on or after the existing identifier date.',
            400,
            'GOVERNMENT_IDENTIFIER_EFFECTIVE_PERIOD_INVALID',
          );
        }
        const invalidated = await governmentIdentifiers(transaction).update({
          where: { agencyId_id: { agencyId: context.agencyId, id: identifierId } },
          data: {
            status: 'INVALID',
            effectiveTo,
            reason,
            updatedByMembershipId: context.membershipId,
          },
          select: identifierSelect,
        });
        const after = summary(invalidated);
        await this.writeAudit(transaction, context, 'GOVERNMENT_IDENTIFIER_INVALIDATED', after, {
          previousStatus: before.status,
          newStatus: after.status,
          reason,
          metadata: { before: auditMetadata(before), after: auditMetadata(after) },
        });
        return after;
      },
    );
  }

  async reveal(
    context: RequestContext,
    employeeId: string,
    identifierId: string,
    input: GovernmentIdentifierRevealInput = {},
  ): Promise<GovernmentIdentifierReveal> {
    this.assertContext(context);
    const result = await withDatabaseContext<GovernmentIdentifierRevealResult>(
      requestDatabaseContext(context),
      async (transaction: Prisma.TransactionClient) => {
        const record = await this.identifier(
          transaction,
          context.agencyId,
          employeeId,
          identifierId,
        );
        const employee = await this.employeeAccess(transaction, context, employeeId);
        const base = record ? summary(record) : null;
        const scoped =
          Boolean(record) &&
          Boolean(employee) &&
          this.canAccess(context, 'personnel.identifiers.reveal', employee as EmployeeAccessRecord);
        const reason = optionalTrimmed(input.reason);
        const allowed = scoped && record?.status === 'ACTIVE' && Boolean(reason);
        let auditStatus: GovernmentIdentifierRevealAuditStatus = 'DENIED';
        let result: GovernmentIdentifierRevealResult;
        if (!record || !employee || !scoped || record.status !== 'ACTIVE') {
          result = { kind: 'denied' };
        } else if (!reason) {
          result = { kind: 'reason-required' };
        } else if (!this.protectedValueKey) {
          auditStatus = 'FAILED';
          result = { kind: 'encryption-unavailable' };
        } else if (record.encryptionVersion !== ENCRYPTION_VERSION) {
          auditStatus = 'FAILED';
          result = { kind: 'failed' };
        } else {
          auditStatus = 'FAILED';
          try {
            const opened = decryptProtectedValue(record.encryptedValue, this.protectedValueKey);
            if (!protectedValueMatchesRecord(opened.metadata, employeeId, record.identifierType)) {
              result = { kind: 'failed' };
            } else {
              auditStatus = 'REVEALED';
              result = {
                kind: 'revealed',
                value: { ...base!, value: opened.plaintext },
              };
            }
          } catch {
            result = { kind: 'failed' };
          }
        }
        await this.auditRevealAttempt(
          transaction,
          context,
          identifierId,
          base,
          allowed,
          auditStatus,
        );
        return result;
      },
    );
    if (result.kind === 'denied') throw this.notFound();
    if (result.kind === 'reason-required') throw this.reasonRequired();
    if (result.kind === 'encryption-unavailable') throw this.encryptionUnavailable();
    if (result.kind === 'failed') {
      throw new GovernmentIdentifiersServiceError(
        'The government identifier cannot be revealed.',
        500,
        'GOVERNMENT_IDENTIFIER_REVEAL_FAILED',
      );
    }
    return result.value;
  }

  private encrypt(
    input: Pick<GovernmentIdentifierCreateInput, 'identifierType' | 'value'>,
    employeeId: string,
  ) {
    let value: string;
    try {
      value = normalizeProtectedValue(input.value);
    } catch (error: unknown) {
      if (!(error instanceof ProtectedValueError)) throw error;
      throw new GovernmentIdentifiersServiceError(
        'Enter a valid government identifier value.',
        400,
        'GOVERNMENT_IDENTIFIER_VALUE_INVALID',
      );
    }
    if (!value) {
      throw new GovernmentIdentifiersServiceError(
        'Enter a government identifier value.',
        400,
        'GOVERNMENT_IDENTIFIER_VALUE_REQUIRED',
      );
    }
    return encryptProtectedValue(value, this.key(), {
      metadata: JSON.stringify({ employeeId, identifierType: input.identifierType }),
    });
  }

  private key(): ProtectedValueKey {
    if (!this.protectedValueKey) {
      throw this.encryptionUnavailable();
    }
    return this.protectedValueKey;
  }

  private encryptionUnavailable(): GovernmentIdentifiersServiceError {
    return new GovernmentIdentifiersServiceError(
      'Government identifier encryption is not configured.',
      503,
      'GOVERNMENT_IDENTIFIER_ENCRYPTION_UNAVAILABLE',
    );
  }

  private async employeeAccess(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
  ): Promise<EmployeeAccessRecord | null> {
    return transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: employeeAccessSelect,
    });
  }

  private async identifier(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    identifierId: string,
  ): Promise<IdentifierRecord | null> {
    return governmentIdentifiers(transaction).findFirst({
      where: { agencyId, employeeId, id: identifierId },
      select: identifierSelect,
    });
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async assertNoActive(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    identifierType: GovernmentIdentifierType,
  ): Promise<void> {
    const existing = await governmentIdentifiers(transaction).findFirst({
      where: { agencyId, employeeId, identifierType, status: 'ACTIVE' },
      select: identifierSelect,
    });
    if (existing) {
      throw new GovernmentIdentifiersServiceError(
        'This Employee already has an active government identifier of that type.',
        409,
        'GOVERNMENT_IDENTIFIER_ACTIVE_CONFLICT',
      );
    }
  }

  private async assertEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      evidenceDocumentId?: string | null | undefined;
      evidenceDocumentVersionId?: string | null | undefined;
    },
  ): Promise<void> {
    const documentId = input.evidenceDocumentId ?? null;
    const versionId = input.evidenceDocumentVersionId ?? null;
    if (!documentId && !versionId) return;
    if (!documentId || !versionId) {
      throw new GovernmentIdentifiersServiceError(
        'Evidence must reference an exact Document Version.',
        400,
        'GOVERNMENT_IDENTIFIER_EVIDENCE_INVALID',
      );
    }
    const version = await transaction.documentVersion.findUnique({
      where: { agencyId_documentId_id: { agencyId: context.agencyId, documentId, id: versionId } },
      select: { id: true },
    });
    if (!version) throw this.notFound();
  }

  private canAccess(
    context: RequestContext,
    permission: string,
    employee: EmployeeAccessRecord,
  ): boolean {
    return canAccessRecord(context, permission, accessRecord(context, employee));
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    this.assertContext(context);
    if (!context.permissions.some((grant: { code: string }) => grant.code === permission)) {
      throw new GovernmentIdentifiersServiceError(
        'The current Agency Membership lacks the required government identifier permission.',
        403,
        code,
      );
    }
  }

  private assertContext(context: RequestContext): void {
    if (!context.agencyId || !context.userId || !context.membershipId) {
      throw new GovernmentIdentifiersServiceError(
        'The active Agency Context is required.',
        403,
        'GOVERNMENT_IDENTIFIER_CONTEXT_INVALID',
      );
    }
  }

  private notFound(): GovernmentIdentifiersServiceError {
    return new GovernmentIdentifiersServiceError(
      'The government identifier could not be found.',
      404,
      'GOVERNMENT_IDENTIFIER_NOT_FOUND',
    );
  }

  private reasonRequired(): GovernmentIdentifiersServiceError {
    return new GovernmentIdentifiersServiceError(
      'A reason is required for this government identifier change.',
      400,
      'GOVERNMENT_IDENTIFIER_REASON_REQUIRED',
    );
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    value: GovernmentIdentifierSummary,
    input: {
      previousStatus?: string | null;
      newStatus?: string | null;
      reason?: string | null;
      metadata: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'GovernmentIdentifier',
      entityId: value.id,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      reason: input.reason ?? null,
      requestId: context.requestId,
      occurredAt: new Date(),
      metadata: input.metadata,
    });
  }

  private async auditRevealAttempt(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    identifierId: string,
    value: GovernmentIdentifierSummary | null,
    allowed: boolean,
    status: GovernmentIdentifierRevealAuditStatus,
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'GOVERNMENT_IDENTIFIER_REVEAL_ATTEMPTED',
      entityType: 'GovernmentIdentifier',
      entityId: identifierId,
      previousStatus: value?.status ?? null,
      newStatus: status,
      reason: null,
      requestId: context.requestId,
      occurredAt: new Date(),
      metadata: value
        ? auditMetadata(value, { allowed, outcome: status })
        : ({ allowed, outcome: status, identifierFound: false } satisfies Prisma.InputJsonObject),
    });
  }
}
