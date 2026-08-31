import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import { DocumentStorage } from './documents.storage';

export const DOCUMENT_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_SENSITIVE',
] as const;

export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number];

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
}

export interface CreateDocumentInput {
  documentNo: string | null | undefined;
  documentType: string;
  classification: DocumentClassification;
  file: UploadedDocumentFile;
  idempotencyKey: string;
}

export interface DocumentVersionSummary {
  id: string;
  versionNo: number;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  issuedAt: string | null;
}

export interface DocumentSummary {
  id: string;
  documentNo: string | null;
  documentType: string;
  classification: DocumentClassification;
  status: string;
  createdAt: string;
  currentVersion: DocumentVersionSummary | null;
}

export interface DocumentAccess {
  document: DocumentSummary;
  accessUrl: string;
  expiresAt: string;
}

export const LINKABLE_EXTERNAL_EVIDENCE_STATUSES = ['APPROVED', 'ISSUED', 'SUPERSEDED'] as const;

export interface DocumentAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');
export const DOCUMENT_AUDIT_WRITER = Symbol('DOCUMENT_AUDIT_WRITER');

const DOCUMENT_AUDIT_METADATA_KEYS = new Set([
  'classification',
  'documentId',
  'documentType',
  'mimeType',
  'sizeBytes',
  'successorOfVersionNo',
  'versionNo',
]);

function safeDocumentAuditMetadata(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => DOCUMENT_AUDIT_METADATA_KEYS.has(key)),
  ) as Prisma.InputJsonObject;
}

export const documentAuditWriter: DocumentAuditWriter = {
  async write(transaction, event): Promise<void> {
    const { metadata, ...eventWithoutMetadata } = event;
    await transaction.auditEvent.create({
      data: { ...eventWithoutMetadata, metadata: safeDocumentAuditMetadata(metadata) },
    });
  },
};

export class DocumentsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DocumentsServiceError';
  }
}

const documentFields = {
  id: true,
  documentNo: true,
  documentType: true,
  classification: true,
  status: true,
  createdAt: true,
} as const;

const versionSelect = {
  id: true,
  versionNo: true,
  contentHash: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  issuedAt: true,
} as const;

const documentSelect = {
  ...documentFields,
  currentVersion: {
    select: versionSelect,
  },
} as const;

type DocumentRecord = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

function databaseContext(context: RequestContext) {
  return {
    agencyId: context.agencyId,
    userId: context.userId,
    membershipId: context.membershipId,
  };
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function toVersionSummary(
  version: NonNullable<DocumentRecord['currentVersion']>,
): DocumentVersionSummary {
  return {
    id: version.id,
    versionNo: version.versionNo,
    contentHash: version.contentHash,
    mimeType: version.mimeType,
    sizeBytes: Number(version.sizeBytes),
    createdAt: formatDateTime(version.createdAt),
    issuedAt: version.issuedAt ? formatDateTime(version.issuedAt) : null,
  };
}

function toSummary(record: DocumentRecord): DocumentSummary {
  return {
    id: record.id,
    documentNo: record.documentNo,
    documentType: record.documentType,
    classification: record.classification as DocumentClassification,
    status: record.status,
    createdAt: formatDateTime(record.createdAt),
    currentVersion: record.currentVersion ? toVersionSummary(record.currentVersion) : null,
  };
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

const contentMatchers: Record<string, (buffer: Buffer) => boolean> = {
  'application/pdf': (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/png': (buffer) =>
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  'text/plain': (buffer) => {
    if (buffer.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return true;
    } catch {
      return false;
    }
  },
};

function stableDocumentId(agencyId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`lingkod-hr:external-evidence:${agencyId}:${idempotencyKey}`)
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

@Injectable()
export class DocumentsService {
  private readonly config = getConfig();

  constructor(
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENT_AUDIT_WRITER) private readonly auditWriter: DocumentAuditWriter,
  ) {}

  async create(context: RequestContext, input: CreateDocumentInput): Promise<DocumentSummary> {
    this.assertPermission(context, 'documents.evidence.create', 'DOCUMENT_CREATE_FORBIDDEN');
    const file = this.validateFile(input.file);
    const documentType = input.documentType.trim();
    const documentNo = this.normalizeDocumentNo(input.documentNo);
    const idempotencyKey = this.normalizeIdempotencyKey(input.idempotencyKey);
    const documentId = idempotencyKey
      ? stableDocumentId(context.agencyId, idempotencyKey)
      : randomUUID();
    const versionId = randomUUID();
    const storageKey = this.storageKey();
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    if (idempotencyKey) {
      const existing = await withDatabaseContext(databaseContext(context), (transaction) =>
        transaction.document.findFirst({
          where: { id: documentId, agencyId: context.agencyId },
          select: documentSelect,
        }),
      );
      if (existing) {
        if (
          this.matchesIdempotentRequest(existing, {
            documentNo,
            documentType,
            classification: input.classification,
            file,
            contentHash,
          })
        ) {
          return toSummary(existing);
        }
        throw new DocumentsServiceError(
          'The Idempotency-Key was already used for different External Evidence.',
          409,
          'DOCUMENT_IDEMPOTENCY_CONFLICT',
        );
      }
    }

    await this.store(storageKey, file, contentHash);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const document = await transaction.document.create({
          data: {
            id: documentId,
            agencyId: context.agencyId,
            documentNo,
            documentType,
            classification: input.classification,
            status: 'DRAFT',
            createdByMembershipId: context.membershipId,
            updatedByMembershipId: context.membershipId,
          },
        });
        const version = await transaction.documentVersion.create({
          data: {
            id: versionId,
            agencyId: context.agencyId,
            documentId: document.id,
            versionNo: 1,
            storageKey,
            contentHash,
            mimeType: file.mimetype,
            sizeBytes: BigInt(file.buffer.byteLength),
            createdByMembershipId: context.membershipId,
          },
        });
        await transaction.document.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: document.id } },
          data: { currentVersionId: version.id, updatedByMembershipId: context.membershipId },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'DOCUMENT_CREATED',
          entityType: 'Document',
          entityId: document.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: this.auditMetadata(input, file, 1),
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'DOCUMENT_VERSION_CREATED',
          entityType: 'DocumentVersion',
          entityId: version.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: this.auditMetadata(input, file, 1),
        });
        return toSummary(
          await transaction.document.findUniqueOrThrow({
            where: { agencyId_id: { agencyId: context.agencyId, id: document.id } },
            select: documentSelect,
          }),
        );
      });
    } catch (error: unknown) {
      await this.removeObject(storageKey);
      if (isKnownPrismaError(error, 'P2002') && idempotencyKey) {
        const existing = await withDatabaseContext(databaseContext(context), (transaction) =>
          transaction.document.findFirst({
            where: { id: documentId, agencyId: context.agencyId },
            select: documentSelect,
          }),
        );
        if (
          existing &&
          this.matchesIdempotentRequest(existing, {
            documentNo,
            documentType,
            classification: input.classification,
            file,
            contentHash,
          })
        ) {
          return toSummary(existing);
        }
      }
      if (isKnownPrismaError(error, 'P2002')) {
        throw new DocumentsServiceError(
          'A Document with this Agency reference already exists.',
          409,
          'DOCUMENT_REFERENCE_CONFLICT',
        );
      }
      throw error;
    }
  }

  async createVersion(
    context: RequestContext,
    documentId: string,
    fileInput: UploadedDocumentFile,
    rawIdempotencyKey: string,
  ): Promise<DocumentSummary> {
    this.assertPermission(
      context,
      'documents.evidence.create',
      'DOCUMENT_VERSION_CREATE_FORBIDDEN',
    );
    const file = this.validateFile(fileInput);
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    const document = await withDatabaseContext(databaseContext(context), (transaction) =>
      transaction.document.findFirst({
        where: { id: documentId, agencyId: context.agencyId, status: { not: 'VOIDED' } },
        select: {
          id: true,
          status: true,
          currentVersion: { select: { id: true, issuedAt: true } },
          versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { versionNo: true } },
        },
      }),
    );
    if (!document) return this.notFound();
    const versionNo = (document.versions[0]?.versionNo ?? 0) + 1;
    const versionId = idempotencyKey
      ? stableDocumentId(context.agencyId, `version:${documentId}:${idempotencyKey}`)
      : randomUUID();
    const storageKey = this.storageKey();

    if (idempotencyKey) {
      const existingVersion = await withDatabaseContext(databaseContext(context), (transaction) =>
        transaction.documentVersion.findFirst({
          where: { id: versionId, agencyId: context.agencyId, documentId },
          select: { contentHash: true, mimeType: true, sizeBytes: true },
        }),
      );
      if (existingVersion) {
        if (
          this.matchesVersionRequest(existingVersion, {
            contentHash,
            mimeType: file.mimetype,
            sizeBytes: file.buffer.byteLength,
          })
        ) {
          const existingDocument = await withDatabaseContext(
            databaseContext(context),
            (transaction) =>
              transaction.document.findFirst({
                where: { id: documentId, agencyId: context.agencyId },
                select: documentSelect,
              }),
          );
          if (existingDocument) return toSummary(existingDocument);
        }
        throw new DocumentsServiceError(
          'The Idempotency-Key was already used for different External Evidence.',
          409,
          'DOCUMENT_IDEMPOTENCY_CONFLICT',
        );
      }
    }

    await this.store(storageKey, file, contentHash);
    try {
      return await withDatabaseContext(databaseContext(context), async (transaction) => {
        const wasFinalized = ['APPROVED', 'ISSUED', 'ARCHIVED', 'SUPERSEDED'].includes(
          document.status,
        );
        if (wasFinalized) {
          await transaction.document.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: document.id } },
            data: { status: 'DRAFT', updatedByMembershipId: context.membershipId },
          });
          if (document.currentVersion && !document.currentVersion.issuedAt) {
            await transaction.documentVersion.update({
              where: { id: document.currentVersion.id },
              data: { issuedAt: new Date() },
            });
          }
        }
        const version = await transaction.documentVersion.create({
          data: {
            id: versionId,
            agencyId: context.agencyId,
            documentId: document.id,
            versionNo,
            storageKey,
            contentHash,
            mimeType: file.mimetype,
            sizeBytes: BigInt(file.buffer.byteLength),
            createdByMembershipId: context.membershipId,
          },
        });
        await transaction.document.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: document.id } },
          data: {
            currentVersionId: version.id,
            status: 'DRAFT',
            updatedByMembershipId: context.membershipId,
          },
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'DOCUMENT_VERSION_CREATED',
          entityType: 'DocumentVersion',
          entityId: version.id,
          previousStatus: document.status,
          newStatus: 'DRAFT',
          requestId: context.requestId,
          metadata: {
            versionNo,
            successorOfVersionNo: versionNo - 1,
            mimeType: file.mimetype,
            sizeBytes: file.buffer.byteLength,
          },
        });
        return toSummary(
          await transaction.document.findUniqueOrThrow({
            where: { agencyId_id: { agencyId: context.agencyId, id: document.id } },
            select: documentSelect,
          }),
        );
      });
    } catch (error: unknown) {
      await this.removeObject(storageKey);
      if (isKnownPrismaError(error, 'P2002') && idempotencyKey) {
        const existingVersion = await withDatabaseContext(databaseContext(context), (transaction) =>
          transaction.documentVersion.findFirst({
            where: { id: versionId, agencyId: context.agencyId, documentId },
            select: { contentHash: true, mimeType: true, sizeBytes: true },
          }),
        );
        if (
          existingVersion &&
          this.matchesVersionRequest(existingVersion, {
            contentHash,
            mimeType: file.mimetype,
            sizeBytes: file.buffer.byteLength,
          })
        ) {
          const existingDocument = await withDatabaseContext(
            databaseContext(context),
            (transaction) =>
              transaction.document.findFirst({
                where: { id: documentId, agencyId: context.agencyId },
                select: documentSelect,
              }),
          );
          if (existingDocument) return toSummary(existingDocument);
        }
      }
      if (isKnownPrismaError(error, 'P2002')) {
        throw new DocumentsServiceError(
          'The Document changed while the successor version was being stored. Retry the upload.',
          409,
          'DOCUMENT_VERSION_CONFLICT',
        );
      }
      throw error;
    }
  }

  async findById(context: RequestContext, documentId: string): Promise<DocumentSummary | null> {
    this.assertReadPermission(context);
    const record = await withDatabaseContext(databaseContext(context), (transaction) =>
      transaction.document.findFirst({
        where: { id: documentId, agencyId: context.agencyId },
        select: documentSelect,
      }),
    );
    if (!record) return null;
    this.assertClassificationPermission(context, record.classification);
    return toSummary(record);
  }

  async listForLinking(context: RequestContext): Promise<DocumentSummary[]> {
    this.assertReadPermission(context);
    const canReadSensitive = hasPermission(context, 'documents.evidence.read_sensitive', {
      agencyId: context.agencyId,
    });
    const records = await withDatabaseContext(databaseContext(context), (transaction) =>
      transaction.document.findMany({
        where: {
          agencyId: context.agencyId,
          status: { in: [...LINKABLE_EXTERNAL_EVIDENCE_STATUSES] },
          currentVersionId: { not: null },
          ...(canReadSensitive ? {} : { classification: { not: 'HIGHLY_SENSITIVE' } }),
        },
        orderBy: [{ createdAt: 'desc' }, { documentNo: 'asc' }],
        take: 200,
        select: documentSelect,
      }),
    );
    return records.map(toSummary);
  }

  /** Internal contract: callers own authorization and use this only inside their transaction. */
  async findDocumentForLinkingInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    documentId: string,
    versionId?: string,
  ): Promise<DocumentSummary | null> {
    if (versionId) {
      const record = await transaction.document.findFirst({
        where: { id: documentId, agencyId: context.agencyId },
        select: {
          ...documentFields,
          versions: {
            where: { id: versionId, agencyId: context.agencyId },
            take: 1,
            select: versionSelect,
          },
        },
      });
      if (!record) return null;
      const version = record.versions[0] ?? null;
      return {
        id: record.id,
        documentNo: record.documentNo,
        documentType: record.documentType,
        classification: record.classification as DocumentClassification,
        status: record.status,
        createdAt: formatDateTime(record.createdAt),
        currentVersion: version ? toVersionSummary(version) : null,
      };
    }
    const record = await transaction.document.findFirst({
      where: { id: documentId, agencyId: context.agencyId },
      select: documentSelect,
    });
    if (!record) return null;
    return toSummary(record);
  }

  async issueAccessLink(
    context: RequestContext,
    documentId: string,
    versionId?: string,
  ): Promise<DocumentAccess | null> {
    this.assertReadPermission(context);
    const versionArgs = versionId
      ? { where: { id: versionId, agencyId: context.agencyId }, select: versionSelect }
      : { orderBy: { versionNo: 'desc' as const }, take: 1, select: versionSelect };
    const record = await withDatabaseContext(databaseContext(context), (transaction) =>
      transaction.document.findFirst({
        where: { id: documentId, agencyId: context.agencyId },
        select: {
          ...documentFields,
          versions: versionArgs,
        },
      }),
    );
    if (!record) return null;
    this.assertClassificationPermission(context, record.classification);
    const version = record.versions[0];
    if (!version) return null;

    const storageKey = await withDatabaseContext(databaseContext(context), (transaction) =>
      transaction.documentVersion.findFirst({
        where: { id: version.id, documentId, agencyId: context.agencyId },
        select: { storageKey: true },
      }),
    );
    if (!storageKey) return null;
    let accessUrl: string;
    try {
      accessUrl = await this.storage.signedReadUrl(
        storageKey.storageKey,
        this.config.EXTERNAL_EVIDENCE_SIGNED_URL_TTL_SECONDS,
      );
    } catch {
      throw new DocumentsServiceError(
        'External Evidence storage is unavailable.',
        503,
        'DOCUMENT_STORAGE_FAILED',
      );
    }
    const expiresAt = new Date(
      Date.now() + this.config.EXTERNAL_EVIDENCE_SIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString();
    const documentSummary: DocumentSummary = {
      id: record.id,
      documentNo: record.documentNo,
      documentType: record.documentType,
      classification: record.classification as DocumentClassification,
      status: record.status,
      createdAt: formatDateTime(record.createdAt),
      currentVersion: version ? toVersionSummary(version) : null,
    };
    await withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'DOCUMENT_ACCESS_LINK_ISSUED',
        entityType: 'DocumentVersion',
        entityId: version.id,
        requestId: context.requestId,
        metadata: {
          documentId,
          versionNo: version.versionNo,
          classification: record.classification,
        },
      });
    });
    return { document: documentSummary, accessUrl, expiresAt };
  }

  private validateFile(file: UploadedDocumentFile): UploadedDocumentFile {
    const size = file.buffer?.byteLength ?? 0;
    const allowedTypes = new Set(
      this.config.EXTERNAL_EVIDENCE_ALLOWED_MIME_TYPES.split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    if (size === 0) {
      throw new DocumentsServiceError('External Evidence cannot be empty.', 400, 'DOCUMENT_EMPTY');
    }
    if (size > this.config.EXTERNAL_EVIDENCE_MAX_SIZE_BYTES) {
      throw new DocumentsServiceError(
        'External Evidence exceeds the configured size limit.',
        413,
        'DOCUMENT_TOO_LARGE',
      );
    }
    if (!allowedTypes.has(file.mimetype.toLowerCase())) {
      throw new DocumentsServiceError(
        'The External Evidence file type is not allowed.',
        415,
        'DOCUMENT_TYPE_NOT_ALLOWED',
      );
    }
    const contentMatcher = contentMatchers[file.mimetype.toLowerCase()];
    if (!contentMatcher || !contentMatcher(file.buffer)) {
      throw new DocumentsServiceError(
        'The External Evidence content does not match its declared file type.',
        415,
        'DOCUMENT_CONTENT_TYPE_MISMATCH',
      );
    }
    return { buffer: file.buffer, mimetype: file.mimetype.toLowerCase() };
  }

  private async store(key: string, file: UploadedDocumentFile, contentHash: string): Promise<void> {
    try {
      await this.storage.putObject({
        key,
        body: file.buffer,
        contentType: file.mimetype,
        contentHash,
      });
    } catch {
      await this.removeObject(key);
      throw new DocumentsServiceError(
        'External Evidence storage is unavailable.',
        503,
        'DOCUMENT_STORAGE_FAILED',
      );
    }
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.storage.deleteObject(key);
    } catch {
      // Cleanup is best effort; no database row is committed until storage succeeds.
    }
  }

  private storageKey(): string {
    return `external-evidence/${randomUUID()}`;
  }

  private normalizeDocumentNo(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
  }

  private normalizeIdempotencyKey(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length < 1 || normalized.length > 200) {
      throw new DocumentsServiceError(
        'The Idempotency-Key is invalid.',
        400,
        'DOCUMENT_IDEMPOTENCY_KEY_INVALID',
      );
    }
    return normalized;
  }

  private matchesIdempotentRequest(
    record: DocumentRecord,
    input: {
      documentNo: string | null;
      documentType: string;
      classification: DocumentClassification;
      file: UploadedDocumentFile;
      contentHash: string;
    },
  ): boolean {
    return (
      record.documentNo === input.documentNo &&
      record.documentType === input.documentType &&
      record.classification === input.classification &&
      record.currentVersion?.contentHash === input.contentHash &&
      record.currentVersion?.mimeType === input.file.mimetype &&
      record.currentVersion?.sizeBytes === BigInt(input.file.buffer.byteLength)
    );
  }

  private matchesVersionRequest(
    record: { contentHash: string; mimeType: string; sizeBytes: bigint },
    input: { contentHash: string; mimeType: string; sizeBytes: number },
  ): boolean {
    return (
      record.contentHash === input.contentHash &&
      record.mimeType === input.mimeType &&
      record.sizeBytes === BigInt(input.sizeBytes)
    );
  }

  private auditMetadata(
    input: CreateDocumentInput,
    file: UploadedDocumentFile,
    versionNo: number,
  ): Prisma.InputJsonObject {
    return {
      documentType: input.documentType.trim(),
      classification: input.classification,
      versionNo,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.byteLength,
    };
  }

  private assertReadPermission(context: RequestContext): void {
    this.assertPermission(context, 'documents.evidence.read', 'DOCUMENT_READ_FORBIDDEN');
  }

  private assertClassificationPermission(context: RequestContext, classification: string): void {
    if (
      classification === 'HIGHLY_SENSITIVE' &&
      !hasPermission(context, 'documents.evidence.read_sensitive', { agencyId: context.agencyId })
    ) {
      throw new DocumentsServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        'DOCUMENT_SENSITIVE_READ_FORBIDDEN',
      );
    }
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission, { agencyId: context.agencyId })
    ) {
      throw new DocumentsServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private notFound(): never {
    throw new DocumentsServiceError('The Document could not be found.', 404, 'DOCUMENT_NOT_FOUND');
  }
}
