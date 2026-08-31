import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { DocumentsService, type DocumentSummary } from '../documents/documents.service';

export const STAFFING_AUTHORITY_TYPES = [
  'LAW',
  'EXECUTIVE_ORDER',
  'DBM_APPROVAL',
  'BOARD_RESOLUTION',
  'OTHER',
] as const;

export type StaffingAuthorityType = (typeof STAFFING_AUTHORITY_TYPES)[number];
export type StaffingAuthorityStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
export type StaffingAuthoritySourceMetadata = Record<string, string>;

export interface StaffingAuthorityDraftInput {
  authorityType: StaffingAuthorityType;
  referenceNo: string;
  issuedDate: string;
  effectiveDate: string;
  sourceMetadata?: StaffingAuthoritySourceMetadata | undefined;
}

export interface StaffingAuthorityDraftUpdateInput extends StaffingAuthorityDraftInput {
  rowVersion: number;
}

export interface StaffingAuthorityEvidenceInput {
  documentId: string;
  validationReason: string;
}

export interface StaffingAuthoritySummary {
  id: string;
  authorityType: StaffingAuthorityType;
  referenceNo: string;
  issuedDate: string;
  effectiveDate: string;
  sourceMetadata: StaffingAuthoritySourceMetadata;
  status: StaffingAuthorityStatus;
  evidence: StaffingAuthorityEvidenceSummary | null;
  revocationEvidence: StaffingAuthorityLinkedEvidenceSummary | null;
  supersededEffectiveDate: string | null;
  revokedEffectiveDate: string | null;
  revocationReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StaffingAuthorityLinkedEvidenceSummary {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  versionNo: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface StaffingAuthorityEvidenceSummary extends StaffingAuthorityLinkedEvidenceSummary {
  validatedAt: string;
  validationReason: string;
}

export interface StaffingAuthorityHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface StaffingAuthorityDetail {
  authority: StaffingAuthoritySummary;
  history: StaffingAuthorityHistoryEntry[];
}

export interface StaffingAuthorityAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const STAFFING_AUTHORITY_AUDIT_WRITER = Symbol('STAFFING_AUTHORITY_AUDIT_WRITER');

export const staffingAuthorityAuditWriter: StaffingAuthorityAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class StaffingAuthorityServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'StaffingAuthorityServiceError';
  }
}

const documentSelect = {
  id: true,
  documentNo: true,
  documentType: true,
  classification: true,
  status: true,
  currentVersion: {
    select: {
      id: true,
      versionNo: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
} as const;

const evidenceVersionSelect = {
  id: true,
  versionNo: true,
  mimeType: true,
  sizeBytes: true,
} as const;

const authoritySelect = {
  id: true,
  agencyId: true,
  authorityType: true,
  referenceNo: true,
  issuedDate: true,
  effectiveDate: true,
  sourceMetadata: true,
  documentId: true,
  evidenceVersionId: true,
  evidenceValidatedAt: true,
  evidenceValidationReason: true,
  status: true,
  supersededEffectiveDate: true,
  revokedEffectiveDate: true,
  revocationReason: true,
  revocationDocumentId: true,
  revocationEvidenceVersionId: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  evidenceDocument: { select: documentSelect },
  evidenceVersion: { select: evidenceVersionSelect },
  revocationDocument: { select: documentSelect },
  revocationEvidenceVersion: { select: evidenceVersionSelect },
} as const;

type AuthorityRecord = Prisma.StaffingAuthorityGetPayload<{ select: typeof authoritySelect }>;
type EvidenceDocument = DocumentSummary;

function databaseContext(context: RequestContext, transition = false) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
    ...(transition ? { staffingAuthorityTransition: true } : {}),
  };
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toDatabaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StaffingAuthorityServiceError(
      'The date is invalid.',
      400,
      'STAFFING_AUTHORITY_DATE_INVALID',
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new StaffingAuthorityServiceError(
      'The date is invalid.',
      400,
      'STAFFING_AUTHORITY_DATE_INVALID',
    );
  }
  return date;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function normalizeMetadata(
  value: StaffingAuthoritySourceMetadata | undefined,
): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, item]) => [key.trim(), item.trim()]),
  ) as Prisma.InputJsonObject;
}

function readMetadata(value: unknown): StaffingAuthoritySourceMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => typeof item === 'string'),
  ) as StaffingAuthoritySourceMetadata;
}

function normalizeDraftInput(input: StaffingAuthorityDraftInput): StaffingAuthorityDraftInput {
  return {
    authorityType: input.authorityType,
    referenceNo: input.referenceNo.trim(),
    issuedDate: input.issuedDate,
    effectiveDate: input.effectiveDate,
    sourceMetadata: readMetadata(normalizeMetadata(input.sourceMetadata)),
  };
}

function authorityAuditData(value: StaffingAuthoritySummary): Prisma.InputJsonObject {
  return {
    authorityType: value.authorityType,
    referenceNo: value.referenceNo,
    issuedDate: value.issuedDate,
    effectiveDate: value.effectiveDate,
    status: value.status,
    sourceMetadataKeys: Object.keys(value.sourceMetadata),
    evidenceDocumentId: value.evidence?.documentId ?? null,
    evidenceVersionNo: value.evidence?.versionNo ?? null,
    revocationDocumentId: value.revocationEvidence?.documentId ?? null,
    revocationEvidenceVersionNo: value.revocationEvidence?.versionNo ?? null,
    supersededEffectiveDate: value.supersededEffectiveDate,
    revokedEffectiveDate: value.revokedEffectiveDate,
  };
}

function canExposeEvidence(
  context: RequestContext | undefined,
  classification: string | undefined,
): boolean {
  if (!context) return true;
  return (
    hasPermission(context, 'documents.evidence.read', { agencyId: context.agencyId }) &&
    (classification !== 'HIGHLY_SENSITIVE' ||
      hasPermission(context, 'documents.evidence.read_sensitive', { agencyId: context.agencyId }))
  );
}

function linkedEvidenceSummary(
  document: AuthorityRecord['evidenceDocument'] | AuthorityRecord['revocationDocument'],
  version: AuthorityRecord['evidenceVersion'] | AuthorityRecord['revocationEvidenceVersion'],
  context?: RequestContext,
): StaffingAuthorityLinkedEvidenceSummary | null {
  if (!document || !version || !canExposeEvidence(context, document.classification)) return null;
  return {
    documentId: document.id,
    documentNo: document.documentNo ?? null,
    documentType: document.documentType,
    classification: document.classification,
    status: document.status,
    versionNo: version.versionNo,
    mimeType: version.mimeType,
    sizeBytes: Number(version.sizeBytes),
  };
}

function evidenceSummary(
  record: AuthorityRecord,
  context?: RequestContext,
): StaffingAuthorityEvidenceSummary | null {
  if (
    !record.documentId ||
    !record.evidenceVersionId ||
    !record.evidenceValidatedAt ||
    !record.evidenceValidationReason
  ) {
    return null;
  }
  const linked = linkedEvidenceSummary(record.evidenceDocument, record.evidenceVersion, context);
  if (!linked) return null;
  return {
    ...linked,
    validatedAt: formatDateTime(record.evidenceValidatedAt),
    validationReason: record.evidenceValidationReason,
  };
}

function toSummary(record: AuthorityRecord, context?: RequestContext): StaffingAuthoritySummary {
  return {
    id: record.id,
    authorityType: record.authorityType as StaffingAuthorityType,
    referenceNo: record.referenceNo,
    issuedDate: formatDate(record.issuedDate),
    effectiveDate: formatDate(record.effectiveDate),
    sourceMetadata: readMetadata(record.sourceMetadata),
    status: record.status as StaffingAuthorityStatus,
    evidence: evidenceSummary(record, context),
    revocationEvidence:
      record.revocationDocumentId && record.revocationEvidenceVersionId
        ? linkedEvidenceSummary(
            record.revocationDocument,
            record.revocationEvidenceVersion,
            context,
          )
        : null,
    supersededEffectiveDate: record.supersededEffectiveDate
      ? formatDate(record.supersededEffectiveDate)
      : null,
    revokedEffectiveDate: record.revokedEffectiveDate
      ? formatDate(record.revokedEffectiveDate)
      : null,
    revocationReason: record.revocationReason,
    rowVersion: record.rowVersion,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function isEvidenceUsable(document: EvidenceDocument | null): document is EvidenceDocument {
  return Boolean(document && document.status !== 'VOIDED' && document.currentVersion);
}

@Injectable()
export class StaffingAuthorityService {
  constructor(
    @Inject(STAFFING_AUTHORITY_AUDIT_WRITER)
    private readonly auditWriter: StaffingAuthorityAuditWriter,
    private readonly documentsService: DocumentsService,
  ) {}

  async list(context: RequestContext): Promise<StaffingAuthoritySummary[]> {
    this.assertPermission(
      context,
      'staffing.authorities.read',
      'STAFFING_AUTHORITY_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.staffingAuthority.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: authoritySelect,
      });
      return records.map((record) => toSummary(record, context));
    });
  }

  async findById(
    context: RequestContext,
    authorityId: string,
  ): Promise<StaffingAuthorityDetail | null> {
    this.assertPermission(
      context,
      'staffing.authorities.read',
      'STAFFING_AUTHORITY_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.staffingAuthority.findFirst({
        where: { id: authorityId, agencyId: context.agencyId },
        select: authoritySelect,
      });
      if (!record) return null;
      const events = await transaction.auditEvent.findMany({
        where: { agencyId: context.agencyId, entityId: authorityId },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          reason: true,
          metadata: true,
          occurredAt: true,
        },
      });
      return {
        authority: toSummary(record, context),
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          reason: event.reason,
          effectiveDate: this.metadataString(event.metadata, 'effectiveDate'),
          occurredAt: formatDateTime(event.occurredAt),
        })),
      };
    });
  }

  async create(
    context: RequestContext,
    rawInput: StaffingAuthorityDraftInput,
  ): Promise<StaffingAuthoritySummary> {
    this.assertPermission(
      context,
      'staffing.authorities.create',
      'STAFFING_AUTHORITY_CREATE_FORBIDDEN',
    );
    const input = normalizeDraftInput(rawInput);
    const issuedDate = toDatabaseDate(input.issuedDate);
    const effectiveDate = toDatabaseDate(input.effectiveDate);
    if (!input.referenceNo) throw this.referenceRequired();

    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const created = await transaction.staffingAuthority.create({
          data: {
            agencyId: context.agencyId,
            authorityType: input.authorityType,
            referenceNo: input.referenceNo,
            issuedDate,
            effectiveDate,
            sourceMetadata: normalizeMetadata(input.sourceMetadata),
            status: 'DRAFT',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
          select: authoritySelect,
        });
        const summary = toSummary(created, context);
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'STAFFING_AUTHORITY_DRAFT_CREATED',
          entityType: 'StaffingAuthority',
          entityId: created.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: { after: authorityAuditData(summary) },
        });
        return summary;
      });
    } catch (error: unknown) {
      if (isKnownPrismaError(error, 'P2002')) throw this.referenceConflict();
      throw error;
    }
  }

  async updateDraft(
    context: RequestContext,
    authorityId: string,
    rawInput: StaffingAuthorityDraftUpdateInput,
  ): Promise<StaffingAuthoritySummary> {
    this.assertPermission(
      context,
      'staffing.authorities.update',
      'STAFFING_AUTHORITY_UPDATE_FORBIDDEN',
    );
    const input = normalizeDraftInput(rawInput);
    const issuedDate = toDatabaseDate(input.issuedDate);
    const effectiveDate = toDatabaseDate(input.effectiveDate);
    if (!input.referenceNo) throw this.referenceRequired();

    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const draft = await transaction.staffingAuthority.findFirst({
          where: { id: authorityId, agencyId: context.agencyId, status: 'DRAFT' },
          select: authoritySelect,
        });
        if (!draft) throw this.notFound();
        const result = await transaction.staffingAuthority.updateMany({
          where: {
            id: authorityId,
            agencyId: context.agencyId,
            status: 'DRAFT',
            rowVersion: rawInput.rowVersion,
          },
          data: {
            authorityType: input.authorityType,
            referenceNo: input.referenceNo,
            issuedDate,
            effectiveDate,
            sourceMetadata: normalizeMetadata(input.sourceMetadata),
            updatedByMembershipId: context.membershipId,
          },
        });
        if (result.count !== 1) throw this.draftConflict();
        const updated = await transaction.staffingAuthority.findFirstOrThrow({
          where: { id: authorityId, agencyId: context.agencyId },
          select: authoritySelect,
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'STAFFING_AUTHORITY_DRAFT_UPDATED',
          entityType: 'StaffingAuthority',
          entityId: authorityId,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: {
            before: authorityAuditData(toSummary(draft, context)),
            after: authorityAuditData(toSummary(updated, context)),
          },
        });
        return toSummary(updated, context);
      });
    } catch (error: unknown) {
      if (isKnownPrismaError(error, 'P2002')) throw this.referenceConflict();
      throw error;
    }
  }

  async validateEvidence(
    context: RequestContext,
    authorityId: string,
    input: StaffingAuthorityEvidenceInput,
    rawIdempotencyKey?: string,
  ): Promise<StaffingAuthoritySummary> {
    this.assertPermission(
      context,
      'staffing.authorities.evidence.validate',
      'STAFFING_AUTHORITY_EVIDENCE_FORBIDDEN',
    );
    this.assertDocumentReadPermission(context);
    const reason = input.validationReason.trim();
    if (!reason) throw this.evidenceReasonRequired();
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

    return withDatabaseContext(databaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'STAFFING_AUTHORITY_EVIDENCE_VALIDATED',
            entityId: authorityId,
            idempotencyKey,
          },
          select: { reason: true, metadata: true },
        });
        if (completed) {
          if (
            completed.reason !== reason ||
            this.metadataString(completed.metadata, 'documentId') !== input.documentId
          ) {
            throw this.idempotencyConflict();
          }
          const existing = await transaction.staffingAuthority.findFirst({
            where: { id: authorityId, agencyId: context.agencyId, status: 'DRAFT' },
            select: authoritySelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return toSummary(existing, context);
        }
      }
      const authority = await transaction.staffingAuthority.findFirst({
        where: { id: authorityId, agencyId: context.agencyId, status: 'DRAFT' },
        select: authoritySelect,
      });
      if (!authority) throw this.notFound();
      const document = await this.documentForValidation(transaction, context, input.documentId);
      if (!isEvidenceUsable(document)) throw this.evidenceInvalid();
      await transaction.staffingAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
        data: {
          documentId: document.id,
          evidenceVersionId: document.currentVersion!.id,
          evidenceValidatedAt: new Date(),
          evidenceValidatedByMembershipId: context.membershipId,
          evidenceValidationReason: reason,
          updatedByMembershipId: context.membershipId,
        },
        select: authoritySelect,
      });
      const updated = await transaction.staffingAuthority.findFirstOrThrow({
        where: { id: authorityId, agencyId: context.agencyId },
        select: authoritySelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'STAFFING_AUTHORITY_EVIDENCE_VALIDATED',
        entityType: 'StaffingAuthority',
        entityId: authorityId,
        previousStatus: 'DRAFT',
        newStatus: 'DRAFT',
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          documentId: document.id,
          versionId: document.currentVersion?.id ?? null,
          versionNo: document.currentVersion?.versionNo ?? null,
        },
      });
      return toSummary(updated, context);
    });
  }

  async activate(
    context: RequestContext,
    authorityId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<StaffingAuthoritySummary> {
    this.assertPermission(
      context,
      'staffing.authorities.activate',
      'STAFFING_AUTHORITY_ACTIVATE_FORBIDDEN',
    );
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.activationReasonRequired();
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'STAFFING_AUTHORITY_ACTIVATED',
            entityId: authorityId,
            idempotencyKey,
          },
          select: { reason: true },
        });
        if (completed) {
          if (completed.reason !== normalizedReason) throw this.idempotencyConflict();
          const existing = await transaction.staffingAuthority.findFirst({
            where: { id: authorityId, agencyId: context.agencyId, status: 'ACTIVE' },
            select: authoritySelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return toSummary(existing, context);
        }
      }
      const draft = await transaction.staffingAuthority.findFirst({
        where: { id: authorityId, agencyId: context.agencyId, status: 'DRAFT' },
        select: authoritySelect,
      });
      if (!draft) throw this.notFound();
      const evidence = await this.validatedEvidence(transaction, context, draft);
      if (!evidence) throw this.evidenceRequired();
      const activated = await transaction.staffingAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
        data: {
          status: 'ACTIVE',
          updatedByMembershipId: context.membershipId,
        },
        select: authoritySelect,
      });
      const summary = toSummary(activated, context);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'STAFFING_AUTHORITY_ACTIVATED',
        entityType: 'StaffingAuthority',
        entityId: authorityId,
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        reason: normalizedReason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          effectiveDate: summary.effectiveDate,
          evidenceDocumentId: evidence.id,
          after: authorityAuditData(summary),
        },
      });
      return summary;
    });
  }

  async supersede(
    context: RequestContext,
    authorityId: string,
    successorId: string,
    reason: string,
    rawIdempotencyKey?: string,
  ): Promise<StaffingAuthoritySummary> {
    this.assertPermission(
      context,
      'staffing.authorities.supersede',
      'STAFFING_AUTHORITY_SUPERSEDE_FORBIDDEN',
    );
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.supersessionReasonRequired();
    if (authorityId === successorId) throw this.successorInvalid();
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'STAFFING_AUTHORITY_SUPERSEDED',
            entityId: authorityId,
            idempotencyKey,
          },
          select: { reason: true, metadata: true },
        });
        if (completed) {
          if (
            completed.reason !== normalizedReason ||
            this.metadataString(completed.metadata, 'successorId') !== successorId
          ) {
            throw this.idempotencyConflict();
          }
          const existing = await transaction.staffingAuthority.findFirst({
            where: { id: successorId, agencyId: context.agencyId, status: 'ACTIVE' },
            select: authoritySelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return toSummary(existing, context);
        }
      }
      const authority = await transaction.staffingAuthority.findFirst({
        where: { id: authorityId, agencyId: context.agencyId, status: 'ACTIVE' },
        select: authoritySelect,
      });
      const successor = await transaction.staffingAuthority.findFirst({
        where: { id: successorId, agencyId: context.agencyId, status: 'DRAFT' },
        select: authoritySelect,
      });
      if (!authority || !successor) throw this.successorInvalid();
      if (successor.effectiveDate <= authority.effectiveDate) {
        throw new StaffingAuthorityServiceError(
          'The successor Staffing Authority must take effect after its predecessor.',
          409,
          'STAFFING_AUTHORITY_SUCCESSOR_DATE_INVALID',
        );
      }
      const evidence = await this.validatedEvidence(transaction, context, successor);
      if (!evidence) throw this.evidenceRequired();

      const superseded = await transaction.staffingAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: authority.id } },
        data: {
          status: 'SUPERSEDED',
          supersededEffectiveDate: successor.effectiveDate,
          updatedByMembershipId: context.membershipId,
        },
        select: authoritySelect,
      });
      const activated = await transaction.staffingAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: successor.id } },
        data: { status: 'ACTIVE', updatedByMembershipId: context.membershipId },
        select: authoritySelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'STAFFING_AUTHORITY_SUPERSEDED',
        entityType: 'StaffingAuthority',
        entityId: authority.id,
        previousStatus: 'ACTIVE',
        newStatus: 'SUPERSEDED',
        reason: normalizedReason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          effectiveDate: formatDate(successor.effectiveDate),
          successorId: successor.id,
          evidenceDocumentId: evidence.id,
          before: authorityAuditData(toSummary(authority, context)),
          after: authorityAuditData(toSummary(superseded, context)),
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'STAFFING_AUTHORITY_SUCCESSOR_ACTIVATED',
        entityType: 'StaffingAuthority',
        entityId: activated.id,
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        reason: normalizedReason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          effectiveDate: formatDate(activated.effectiveDate),
          predecessorId: authority.id,
          after: authorityAuditData(toSummary(activated, context)),
        },
      });
      return toSummary(activated, context);
    });
  }

  async revoke(
    context: RequestContext,
    authorityId: string,
    effectiveDateValue: string,
    reason: string,
    documentId: string,
    rawIdempotencyKey?: string,
  ): Promise<StaffingAuthoritySummary> {
    this.assertPermission(
      context,
      'staffing.authorities.revoke',
      'STAFFING_AUTHORITY_REVOKE_FORBIDDEN',
    );
    this.assertDocumentReadPermission(context);
    const effectiveDate = toDatabaseDate(effectiveDateValue);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw this.revocationReasonRequired();
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'STAFFING_AUTHORITY_REVOKED',
            entityId: authorityId,
            idempotencyKey,
          },
          select: { reason: true, metadata: true },
        });
        if (completed) {
          if (
            completed.reason !== normalizedReason ||
            this.metadataString(completed.metadata, 'effectiveDate') !== effectiveDateValue ||
            this.metadataString(completed.metadata, 'revocationDocumentId') !== documentId
          ) {
            throw this.idempotencyConflict();
          }
          const existing = await transaction.staffingAuthority.findFirst({
            where: { id: authorityId, agencyId: context.agencyId, status: 'REVOKED' },
            select: authoritySelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return toSummary(existing, context);
        }
      }
      const authority = await transaction.staffingAuthority.findFirst({
        where: { id: authorityId, agencyId: context.agencyId, status: 'ACTIVE' },
        select: authoritySelect,
      });
      if (!authority) throw this.notFound();
      if (effectiveDate < authority.effectiveDate) {
        throw new StaffingAuthorityServiceError(
          'Revocation cannot take effect before the Staffing Authority.',
          409,
          'STAFFING_AUTHORITY_REVOCATION_DATE_INVALID',
        );
      }
      const evidence = await this.documentForValidation(transaction, context, documentId);
      if (!isEvidenceUsable(evidence)) throw this.evidenceInvalid();
      await transaction.staffingAuthority.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: authorityId } },
        data: {
          status: 'REVOKED',
          revokedEffectiveDate: effectiveDate,
          revocationReason: normalizedReason,
          revocationDocumentId: evidence.id,
          revocationEvidenceVersionId: evidence.currentVersion!.id,
          updatedByMembershipId: context.membershipId,
        },
        select: authoritySelect,
      });
      const revokedRecord = await transaction.staffingAuthority.findFirstOrThrow({
        where: { id: authorityId, agencyId: context.agencyId },
        select: authoritySelect,
      });
      const summary = toSummary(revokedRecord, context);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'STAFFING_AUTHORITY_REVOKED',
        entityType: 'StaffingAuthority',
        entityId: authorityId,
        previousStatus: 'ACTIVE',
        newStatus: 'REVOKED',
        reason: normalizedReason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          effectiveDate: effectiveDateValue,
          revocationDocumentId: evidence.id,
          before: authorityAuditData(toSummary(authority, context)),
          after: authorityAuditData(summary),
        },
      });
      return summary;
    });
  }

  async assertUsableForAction(
    context: RequestContext,
    authorityId: string,
    actionDateValue: string,
  ): Promise<StaffingAuthoritySummary> {
    const actionDate = toDatabaseDate(actionDateValue);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const authority = await transaction.staffingAuthority.findFirst({
        where: { id: authorityId, agencyId: context.agencyId },
        select: authoritySelect,
      });
      if (!authority) throw this.notFound();
      if (authority.status === 'DRAFT') throw this.notActive();
      if (authority.effectiveDate > actionDate) {
        throw new StaffingAuthorityServiceError(
          'The Staffing Authority is not effective for this action date.',
          409,
          'STAFFING_AUTHORITY_NOT_YET_EFFECTIVE',
        );
      }
      if (authority.supersededEffectiveDate && actionDate >= authority.supersededEffectiveDate) {
        throw new StaffingAuthorityServiceError(
          'The Staffing Authority cannot support a new action after supersession.',
          409,
          'STAFFING_AUTHORITY_SUPERSEDED',
        );
      }
      if (authority.revokedEffectiveDate && actionDate >= authority.revokedEffectiveDate) {
        throw new StaffingAuthorityServiceError(
          'The Staffing Authority cannot support a new action after revocation effectivity.',
          409,
          'STAFFING_AUTHORITY_REVOKED',
        );
      }
      if (!(await this.validatedEvidence(transaction, context, authority))) {
        throw this.evidenceRequired();
      }
      return toSummary(authority, context);
    });
  }

  private async validatedEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    authority: AuthorityRecord,
  ): Promise<EvidenceDocument | null> {
    if (
      !authority.documentId ||
      !authority.evidenceValidatedAt ||
      !authority.evidenceValidationReason
    ) {
      return null;
    }
    const document = await this.documentsService.findDocumentForLinkingInTransaction(
      transaction,
      context,
      authority.documentId,
      authority.evidenceVersionId ?? undefined,
    );
    return isEvidenceUsable(document) ? document : null;
  }

  private async documentForValidation(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string,
  ): Promise<EvidenceDocument | null> {
    const document = await this.documentsService.findDocumentForLinkingInTransaction(
      transaction,
      context,
      documentId,
    );
    if (!document) throw this.evidenceNotFound();
    this.assertDocumentReadPermission(context);
    if (
      document.classification === 'HIGHLY_SENSITIVE' &&
      !hasPermission(context, 'documents.evidence.read_sensitive', { agencyId: context.agencyId })
    ) {
      throw new StaffingAuthorityServiceError(
        'The current Agency Membership cannot inspect this External Evidence.',
        403,
        'STAFFING_AUTHORITY_EVIDENCE_SENSITIVE_FORBIDDEN',
      );
    }
    return document;
  }

  private assertDocumentReadPermission(context: RequestContext): void {
    this.assertPermission(
      context,
      'documents.evidence.read',
      'STAFFING_AUTHORITY_EVIDENCE_FORBIDDEN',
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new StaffingAuthorityServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const item = value[key];
    return typeof item === 'string' ? item : null;
  }

  private referenceRequired(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'An official Staffing Authority reference is required.',
      400,
      'STAFFING_AUTHORITY_REFERENCE_REQUIRED',
    );
  }

  private referenceConflict(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'A Staffing Authority with this Agency reference already exists.',
      409,
      'STAFFING_AUTHORITY_REFERENCE_CONFLICT',
    );
  }

  private draftConflict(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'The Draft Staffing Authority changed before it could be saved. Reload and try again.',
      409,
      'STAFFING_AUTHORITY_DRAFT_CONFLICT',
    );
  }

  private evidenceReasonRequired(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'A reason for External Evidence validation is required.',
      400,
      'STAFFING_AUTHORITY_EVIDENCE_REASON_REQUIRED',
    );
  }

  private evidenceRequired(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'Validated External Evidence is required before activation.',
      409,
      'STAFFING_AUTHORITY_EVIDENCE_REQUIRED',
    );
  }

  private evidenceInvalid(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'The selected External Evidence must have a usable version and cannot be voided.',
      409,
      'STAFFING_AUTHORITY_EVIDENCE_INVALID',
    );
  }

  private evidenceNotFound(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'The External Evidence could not be found in this Agency Context.',
      404,
      'STAFFING_AUTHORITY_EVIDENCE_NOT_FOUND',
    );
  }

  private activationReasonRequired(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'A reason for activation is required.',
      400,
      'STAFFING_AUTHORITY_ACTIVATION_REASON_REQUIRED',
    );
  }

  private supersessionReasonRequired(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'A reason for supersession is required.',
      400,
      'STAFFING_AUTHORITY_SUPERSESSION_REASON_REQUIRED',
    );
  }

  private revocationReasonRequired(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'A reason for revocation is required.',
      400,
      'STAFFING_AUTHORITY_REVOCATION_REASON_REQUIRED',
    );
  }

  private idempotencyConflict(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'The Idempotency-Key was already used for a different Staffing Authority request.',
      409,
      'STAFFING_AUTHORITY_IDEMPOTENCY_CONFLICT',
    );
  }

  private successorInvalid(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'The active Staffing Authority or Draft successor could not be found.',
      409,
      'STAFFING_AUTHORITY_SUCCESSOR_INVALID',
    );
  }

  private notActive(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'A Draft Staffing Authority cannot support an Organization or Plantilla action.',
      409,
      'STAFFING_AUTHORITY_NOT_ACTIVE',
    );
  }

  private notFound(): StaffingAuthorityServiceError {
    return new StaffingAuthorityServiceError(
      'The Staffing Authority could not be found.',
      404,
      'STAFFING_AUTHORITY_NOT_FOUND',
    );
  }
}
