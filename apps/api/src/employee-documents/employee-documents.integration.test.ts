import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import type { DocumentStorage } from '../documents/documents.storage';
import {
  employeeDocumentAuditWriter,
  EmployeeDocumentsService,
} from './employee-documents.service';

const enabled = process.env.DATABASE_E2E === 'true';

class MemoryDocumentStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();

  async putObject(input: { key: string; body: Buffer }): Promise<void> {
    this.objects.set(input.key, Buffer.from(input.body));
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedReadUrl(key: string): Promise<string> {
    return `https://storage.example/${encodeURIComponent(key)}`;
  }
}

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'],
): RequestContext {
  return {
    requestId: `employee-documents-${Date.now()}`,
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

async function cleanup(admin: PrismaClient, agencyIds: string[], userIds: string[]): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.employeeDocument.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await transaction.documentVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await transaction.document.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await transaction.employee.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await transaction.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
    await transaction.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

it.skipIf(!enabled)(
  'links exact versions, scopes own uploads, filters restricted evidence, and audits unlinking',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();
    const suffix = `${Date.now()}-employee-documents`;
    const agency = await admin.agency.create({
      data: {
        code: `ED-${suffix}`,
        name: 'Employee Documents Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `ED-F-${suffix}`,
        name: 'Foreign Employee Documents Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const owner = await admin.user.create({
      data: {
        emailNormalized: `employee-documents-owner-${suffix}@example.test`,
        displayName: 'Employee Document Owner',
        globalStatus: 'ACTIVE',
      },
    });
    const hr = await admin.user.create({
      data: {
        emailNormalized: `employee-documents-hr-${suffix}@example.test`,
        displayName: 'Personnel Records Officer',
        globalStatus: 'ACTIVE',
      },
    });
    const ownerMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: owner.id, status: 'ACTIVE' },
    });
    const hrMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: hr.id, status: 'ACTIVE' },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `ED-${suffix}`,
        legalName: 'Employee Document Owner',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: owner.emailNormalized,
        createdByMembershipId: hrMembership.id,
        updatedByMembershipId: hrMembership.id,
      },
    });
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.agencyMembership.update({
        where: { id: ownerMembership.id },
        data: { employeeId: employee.id },
      });
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: owner.id, status: 'ACTIVE' },
    });
    const foreignEmployee = await admin.employee.create({
      data: {
        agencyId: foreignAgency.id,
        employeeNumber: `ED-F-${suffix}`,
        legalName: 'Foreign Employee',
        birthDate: new Date('1991-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: 'foreign@example.test',
        createdByMembershipId: foreignMembership.id,
        updatedByMembershipId: foreignMembership.id,
      },
    });
    const storage = new MemoryDocumentStorage();
    const documents = new DocumentsService(storage, documentAuditWriter);
    const employeeDocuments = new EmployeeDocumentsService(employeeDocumentAuditWriter, documents);
    const ownerContext = context(agency.id, owner.id, ownerMembership.id, [
      { code: 'personnel.documents.read', scopePolicy: 'OWN' },
      { code: 'personnel.documents.upload', scopePolicy: 'OWN' },
    ]);
    const hrContext = context(agency.id, hr.id, hrMembership.id, [
      { code: 'documents.evidence.create', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
      { code: 'personnel.documents.read', scopePolicy: 'AGENCY' },
      { code: 'personnel.documents.classify', scopePolicy: 'AGENCY' },
      { code: 'personnel.documents.read_sensitive', scopePolicy: 'AGENCY' },
    ]);

    try {
      const ownUpload = await employeeDocuments.upload(ownerContext, employee.id, {
        classification: 'CONFIDENTIAL',
        personnelClassification: 'MEDICAL',
        purpose: 'OWN_RECORD_UPLOAD',
        idempotencyKey: 'own-medical-upload',
        file: { buffer: Buffer.from('%PDF-1.7 own evidence'), mimetype: 'application/pdf' },
      });
      expect(ownUpload).toMatchObject({
        employeeId: employee.id,
        personnelClassification: 'MEDICAL',
        releaseState: 'PENDING',
        versionNo: 1,
      });
      expect(ownUpload.documentVersionId).toBeTruthy();
      await expect(employeeDocuments.list(ownerContext, foreignEmployee.id)).resolves.toBeNull();
      await expect(
        employeeDocuments.access(ownerContext, employee.id, ownUpload.id),
      ).resolves.toBeNull();

      const source = await documents.create(hrContext, {
        documentNo: `PDS-${suffix}`,
        documentType: 'PDS',
        classification: 'CONFIDENTIAL',
        idempotencyKey: 'pds-source',
        file: { buffer: Buffer.from('%PDF-1.7 pds v1'), mimetype: 'application/pdf' },
      });
      const firstVersionId = source.currentVersion?.id;
      if (!firstVersionId) throw new Error('The source Document version was not created.');
      await admin.document.update({ where: { id: source.id }, data: { status: 'ISSUED' } });
      await documents.createVersion(
        hrContext,
        source.id,
        { buffer: Buffer.from('%PDF-1.7 pds v2'), mimetype: 'application/pdf' },
        'pds-successor',
      );
      const sourceVersions = await documents.listFinalizedVersionsForLinking(hrContext);
      expect(
        sourceVersions.some(
          (candidate) =>
            candidate.documentId === source.id && candidate.version.id === firstVersionId,
        ),
      ).toBe(true);
      const classifierWithoutSourceRead = context(agency.id, hr.id, hrMembership.id, [
        { code: 'personnel.documents.read', scopePolicy: 'AGENCY' },
        { code: 'personnel.documents.classify', scopePolicy: 'AGENCY' },
      ]);
      await expect(
        employeeDocuments.link(classifierWithoutSourceRead, employee.id, {
          documentId: source.id,
          documentVersionId: firstVersionId,
          personnelClassification: 'PDS',
          purpose: 'PDS_SUPPORT',
          releaseState: 'RELEASED',
        }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_DOCUMENT_SOURCE_READ_FORBIDDEN' });
      await expect(
        employeeDocuments.link(hrContext, employee.id, {
          documentId: source.id,
          documentVersionId: ownUpload.documentVersionId,
          personnelClassification: 'PDS',
          purpose: 'PDS_SUPPORT',
          releaseState: 'RELEASED',
        }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_DOCUMENT_SOURCE_NOT_FOUND' });
      const exactLink = await employeeDocuments.link(hrContext, employee.id, {
        documentId: source.id,
        documentVersionId: firstVersionId,
        personnelClassification: 'PDS',
        purpose: 'PDS_SUPPORT',
        releaseState: 'RELEASED',
      });
      expect(exactLink).toMatchObject({
        documentId: source.id,
        documentVersionId: firstVersionId,
        versionNo: 1,
        releaseState: 'RELEASED',
      });

      const readOnlyHr = context(agency.id, hr.id, hrMembership.id, [
        { code: 'personnel.documents.read', scopePolicy: 'AGENCY' },
      ]);
      await expect(employeeDocuments.list(readOnlyHr, employee.id)).resolves.toEqual([
        expect.objectContaining({ personnelClassification: 'PDS' }),
      ]);
      await employeeDocuments.remove(
        hrContext,
        employee.id,
        exactLink.id,
        'Attached to the wrong record.',
      );
      await expect(employeeDocuments.list(hrContext, employee.id)).resolves.toEqual([
        expect.objectContaining({ personnelClassification: 'MEDICAL' }),
      ]);
      await expect(
        admin.employeeDocument.findUnique({ where: { id: exactLink.id } }),
      ).resolves.toBeNull();
      await expect(admin.document.findUnique({ where: { id: source.id } })).resolves.toBeTruthy();
      await expect(
        admin.documentVersion.findUnique({ where: { id: firstVersionId } }),
      ).resolves.toBeTruthy();
      const unlinkAudit = await admin.auditEvent.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          action: 'EMPLOYEE_DOCUMENT_UNLINKED',
          entityId: exactLink.id,
        },
      });
      expect(unlinkAudit.reason).toBe('Attached to the wrong record.');
      expect(JSON.stringify(unlinkAudit.metadata)).not.toContain('storageKey');
      expect(JSON.stringify(unlinkAudit.metadata)).not.toContain('signed');
    } finally {
      await cleanup(admin, [agency.id, foreignAgency.id], [owner.id, hr.id]);
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
