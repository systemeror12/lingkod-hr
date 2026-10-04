import { PrismaClient, type Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import type { DocumentStorage } from './documents.storage';
import {
  documentAuditWriter,
  DocumentsService,
  DocumentsServiceError,
  type UploadedDocumentFile,
} from './documents.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const enabled = process.env.DATABASE_E2E === 'true';

function context(
  permissions: RequestContext['permissions'] = [
    { code: 'documents.evidence.create', scopePolicy: 'AGENCY' },
    { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
    { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
  ],
): RequestContext {
  return {
    requestId: 'documents-test-request',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function file(overrides: Partial<UploadedDocumentFile> = {}): UploadedDocumentFile {
  return { buffer: Buffer.from('%PDF-1.7 evidence'), mimetype: 'application/pdf', ...overrides };
}

const storage: DocumentStorage = {
  putObject: vi.fn().mockResolvedValue(undefined),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  signedReadUrl: vi.fn().mockResolvedValue('https://storage.example/signed'),
};

it('rechecks document permissions at the service boundary', async () => {
  const service = new DocumentsService(storage, documentAuditWriter);

  await expect(
    service.create(context([]), {
      documentNo: null,
      documentType: 'STAFFING_AUTHORITY',
      classification: 'CONFIDENTIAL',
      idempotencyKey: 'permission-check',
      file: file(),
    }),
  ).rejects.toMatchObject({ code: 'DOCUMENT_CREATE_FORBIDDEN', statusCode: 403 });
  await expect(
    service.findById(context([]), '00000000-0000-4000-8000-000000000004'),
  ).rejects.toMatchObject({
    code: 'DOCUMENT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('validates configured file size, emptiness, and MIME type before storage', async () => {
  const service = new DocumentsService(storage, documentAuditWriter);
  const input = {
    documentNo: null,
    documentType: 'STAFFING_AUTHORITY',
    classification: 'CONFIDENTIAL' as const,
  };

  await expect(
    service.create(context(), {
      ...input,
      idempotencyKey: 'empty-file',
      file: file({ buffer: Buffer.alloc(0) }),
    }),
  ).rejects.toMatchObject({
    code: 'DOCUMENT_EMPTY',
    statusCode: 400,
  });
  await expect(
    service.create(context(), {
      ...input,
      idempotencyKey: 'unsupported-file',
      file: file({ mimetype: 'application/octet-stream' }),
    }),
  ).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_NOT_ALLOWED', statusCode: 415 });
  await expect(
    service.create(context(), {
      ...input,
      idempotencyKey: 'mismatched-file',
      file: file({ mimetype: 'image/png' }),
    }),
  ).rejects.toMatchObject({ code: 'DOCUMENT_CONTENT_TYPE_MISMATCH', statusCode: 415 });
  expect(storage.putObject).not.toHaveBeenCalled();
});

it('does not persist an authoritative row when object storage fails', async () => {
  const failingStorage: DocumentStorage = {
    putObject: vi.fn().mockRejectedValue(new Error('provider failure')),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    signedReadUrl: vi.fn(),
  };
  const service = new DocumentsService(failingStorage, documentAuditWriter);

  await expect(
    service.create(context(), {
      documentNo: null,
      documentType: 'STAFFING_AUTHORITY',
      classification: 'CONFIDENTIAL',
      idempotencyKey: 'storage-failure',
      file: file(),
    }),
  ).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_FAILED', statusCode: 503 });
  expect(failingStorage.deleteObject).toHaveBeenCalledOnce();
});

it('uses a safe error type for document failures', () => {
  expect(new DocumentsServiceError('message', 400, 'CODE')).toBeInstanceOf(Error);
});

it('resolves External Evidence through the shared version, sensitivity, and status rules', async () => {
  const service = new DocumentsService(storage, documentAuditWriter);
  const record = {
    id: 'document-1',
    documentNo: null,
    documentType: 'PDS',
    classification: 'CONFIDENTIAL',
    status: 'APPROVED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    currentVersion: {
      id: 'version-1',
      versionNo: 1,
      contentHash: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 10n,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      issuedAt: null,
    },
  };
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce({ ...record, classification: 'HIGHLY_SENSITIVE' })
    .mockResolvedValueOnce({ ...record, status: 'DRAFT' });
  const transaction = { document: { findFirst } } as unknown as Prisma.TransactionClient;

  await expect(
    service.resolveExternalEvidenceInTransaction(transaction, context(), {
      documentId: record.id,
      allowSensitive: true,
      requirement: 'LINKABLE_STATUS',
    }),
  ).resolves.toMatchObject({ ok: true, document: { id: record.id } });
  await expect(
    service.resolveExternalEvidenceInTransaction(transaction, context(), {
      documentId: record.id,
      allowSensitive: false,
      requirement: 'LINKABLE_STATUS',
    }),
  ).resolves.toEqual({ ok: false, reason: 'SENSITIVE_FORBIDDEN' });
  await expect(
    service.resolveExternalEvidenceInTransaction(transaction, context(), {
      documentId: record.id,
      allowSensitive: true,
      requirement: 'LINKABLE_STATUS',
    }),
  ).resolves.toEqual({ ok: false, reason: 'STATUS_INELIGIBLE' });
});

class MemoryDocumentStorage implements DocumentStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string; contentHash: string }>();

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    contentHash: string;
  }): Promise<void> {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      contentHash: input.contentHash,
    });
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedReadUrl(key: string): Promise<string> {
    return `https://storage.example/signed/${encodeURIComponent(key)}`;
  }
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function cleanup(admin: PrismaClient, agencyId: string, userId: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({ where: { agencyId } });
    await transaction.documentVersion.deleteMany({ where: { agencyId } });
    await transaction.document.deleteMany({ where: { agencyId } });
  });
  await admin.agencyMembership.deleteMany({ where: { agencyId } });
  await admin.agency.delete({ where: { id: agencyId } });
  await admin.user.delete({ where: { id: userId } });
}

it.skipIf(!enabled)(
  'stores, versions, retrieves, audits, and protects External Evidence',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-documents`;
    const agency = await admin.agency.create({
      data: { code: `DOC-${suffix}`, name: 'Evidence Agency', agencyType: 'NGA', status: 'ACTIVE' },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `documents-${suffix}@example.test`,
        displayName: 'Evidence Officer',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const requestContext = context([
      { code: 'documents.evidence.create', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
    ]);
    requestContext.agencyId = agency.id;
    requestContext.userId = user.id;
    requestContext.membershipId = membership.id;
    const objectStorage = new MemoryDocumentStorage();
    const service = new DocumentsService(objectStorage, documentAuditWriter);

    try {
      const first = file();
      const created = await service.create(requestContext, {
        documentNo: `SA-${suffix}`,
        documentType: 'STAFFING_AUTHORITY',
        classification: 'CONFIDENTIAL',
        idempotencyKey: 'initial-upload',
        file: first,
      });
      expect(created.currentVersion).toMatchObject({
        versionNo: 1,
        mimeType: 'application/pdf',
        sizeBytes: first.buffer.byteLength,
        contentHash: createHash('sha256').update(first.buffer).digest('hex'),
      });
      expect(objectStorage.objects.size).toBe(1);

      await expect(
        service.create(requestContext, {
          documentNo: `SA-${suffix}`,
          documentType: 'STAFFING_AUTHORITY',
          classification: 'CONFIDENTIAL',
          idempotencyKey: 'initial-upload',
          file: first,
        }),
      ).resolves.toMatchObject({ id: created.id });
      expect(objectStorage.objects.size).toBe(1);

      const access = await service.issueAccessLink(requestContext, created.id);
      expect(access).toMatchObject({
        accessUrl: expect.stringContaining('https://storage.example/'),
      });
      expect(access?.document.currentVersion?.versionNo).toBe(1);

      const second = file({ buffer: Buffer.from('%PDF-1.7 successor') });
      const versioned = await service.createVersion(
        requestContext,
        created.id,
        second,
        'successor-2',
      );
      expect(versioned.currentVersion).toMatchObject({
        versionNo: 2,
        sizeBytes: second.buffer.byteLength,
      });
      expect(objectStorage.objects.size).toBe(2);

      const oldVersion = await admin.documentVersion.findFirstOrThrow({
        where: { documentId: created.id, versionNo: 1 },
      });
      await expect(
        admin.documentVersion.update({
          where: { id: oldVersion.id },
          data: { contentHash: '0'.repeat(64) },
        }),
      ).rejects.toThrow(/immutable/i);

      await admin.document.update({ where: { id: created.id }, data: { status: 'APPROVED' } });
      await expect(
        admin.documentVersion.update({
          where: { id: oldVersion.id },
          data: { signatureMetadata: { attempted: true } },
        }),
      ).rejects.toThrow(/immutable/i);
      await admin.document.update({ where: { id: created.id }, data: { status: 'ISSUED' } });
      const currentVersion = await admin.documentVersion.findFirstOrThrow({
        where: { documentId: created.id, versionNo: 2 },
      });
      await expect(
        admin.documentVersion.update({
          where: { id: currentVersion.id },
          data: { signatureMetadata: { attempted: true } },
        }),
      ).rejects.toThrow(/immutable/i);
      await admin.document.update({ where: { id: created.id }, data: { status: 'DRAFT' } });
      await expect(
        admin.documentVersion.update({
          where: { id: currentVersion.id },
          data: { signatureMetadata: { attempted: true } },
        }),
      ).rejects.toThrow(/immutable/i);
      await admin.document.update({ where: { id: created.id }, data: { status: 'ISSUED' } });

      const successorAfterIssued = await service.createVersion(
        requestContext,
        created.id,
        file({ buffer: Buffer.from('%PDF-1.7 post-issued successor') }),
        'successor-3',
      );
      expect(successorAfterIssued.currentVersion?.versionNo).toBe(3);
      await expect(
        service.create(requestContext, {
          documentNo: `SA-${suffix}`,
          documentType: 'STAFFING_AUTHORITY',
          classification: 'CONFIDENTIAL',
          idempotencyKey: 'different-upload',
          file: file({ buffer: Buffer.from('%PDF-1.7 rolled back') }),
        }),
      ).rejects.toMatchObject({ code: 'DOCUMENT_REFERENCE_CONFLICT', statusCode: 409 });
      expect(objectStorage.objects.size).toBe(3);
      await expect(admin.document.count({ where: { agencyId: agency.id } })).resolves.toBe(1);

      const highlySensitive = await service.create(requestContext, {
        documentNo: null,
        documentType: 'IDENTITY_EVIDENCE',
        classification: 'HIGHLY_SENSITIVE',
        idempotencyKey: 'sensitive-upload',
        file: file({ buffer: Buffer.from('%PDF-1.7 sensitive') }),
      });
      const readOnlyContext: RequestContext = {
        ...requestContext,
        permissions: [{ code: 'documents.evidence.read', scopePolicy: 'AGENCY' }],
      };
      await expect(
        service.issueAccessLink(readOnlyContext, highlySensitive.id),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_SENSITIVE_READ_FORBIDDEN',
        statusCode: 403,
      });

      await expect(
        admin.documentVersion.update({
          where: { id: currentVersion.id },
          data: { signatureMetadata: { attempted: true } },
        }),
      ).rejects.toThrow(/immutable/i);

      const audit = await admin.auditEvent.findFirstOrThrow({
        where: { agencyId: agency.id, action: 'DOCUMENT_ACCESS_LINK_ISSUED' },
      });
      expect(audit).toMatchObject({ actorUserId: user.id, actorMembershipId: membership.id });
      expect(JSON.stringify(audit.metadata)).not.toContain('storageKey');
      expect(JSON.stringify(audit.metadata)).not.toContain('signed');
    } finally {
      await cleanup(admin, agency.id, user.id);
      await admin.$disconnect();
    }
  },
);
