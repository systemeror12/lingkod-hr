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
  async putObject(): Promise<void> {}

  async deleteObject(): Promise<void> {}

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
    requestId: `employee-documents-own-sensitive-${Date.now()}`,
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

// docs/hris-controls.md §8.1: an Employee may access "own documents explicitly
// released for self-service". The seeded employee role holds no
// personnel.documents.read_sensitive grant, so the own Employee reads a released
// restricted document through the own-record rule alone, while a reader without
// the sensitive permission does not.
it.skipIf(!enabled)(
  'lets the own Employee read a released restricted document without the sensitive permission',
  async () => {
    const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!url) throw new Error('A database owner URL is required for the integration test.');
    const admin = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}-own-sensitive`;
    const agency = await admin.agency.create({
      data: {
        code: `EDS-${suffix}`,
        name: 'Own Sensitive Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const owner = await admin.user.create({
      data: {
        emailNormalized: `own-sensitive-owner-${suffix}@example.test`,
        displayName: 'Own Sensitive Owner',
        globalStatus: 'ACTIVE',
      },
    });
    const hr = await admin.user.create({
      data: {
        emailNormalized: `own-sensitive-hr-${suffix}@example.test`,
        displayName: 'Personnel Records Officer',
        globalStatus: 'ACTIVE',
      },
    });

    try {
      const ownerMembership = await admin.agencyMembership.create({
        data: { agencyId: agency.id, userId: owner.id, status: 'ACTIVE' },
      });
      const hrMembership = await admin.agencyMembership.create({
        data: { agencyId: agency.id, userId: hr.id, status: 'ACTIVE' },
      });
      const employee = await admin.employee.create({
        data: {
          agencyId: agency.id,
          employeeNumber: `EDS-${suffix}`,
          legalName: 'Own Sensitive Owner',
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

      const documents = new DocumentsService(new MemoryDocumentStorage(), documentAuditWriter);
      const employeeDocuments = new EmployeeDocumentsService(
        employeeDocumentAuditWriter,
        documents,
      );
      const hrContext = context(agency.id, hr.id, hrMembership.id, [
        { code: 'documents.evidence.create', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
        { code: 'personnel.documents.read', scopePolicy: 'AGENCY' },
        { code: 'personnel.documents.classify', scopePolicy: 'AGENCY' },
        { code: 'personnel.documents.read_sensitive', scopePolicy: 'AGENCY' },
      ]);
      // The seeded employee role's grants (migration 0041).
      const ownerContext = context(agency.id, owner.id, ownerMembership.id, [
        { code: 'personnel.documents.read', scopePolicy: 'OWN' },
        { code: 'personnel.documents.upload', scopePolicy: 'OWN' },
      ]);
      const readerWithoutSensitive = context(agency.id, hr.id, hrMembership.id, [
        { code: 'personnel.documents.read', scopePolicy: 'AGENCY' },
      ]);

      const medical = await documents.create(hrContext, {
        documentNo: `MED-${suffix}`,
        documentType: 'MEDICAL',
        classification: 'CONFIDENTIAL',
        idempotencyKey: 'own-sensitive-medical',
        file: { buffer: Buffer.from('%PDF-1.7 medical certificate'), mimetype: 'application/pdf' },
      });
      const versionId = medical.currentVersion?.id;
      if (!versionId) throw new Error('The medical Document version was not created.');
      await admin.document.update({ where: { id: medical.id }, data: { status: 'ISSUED' } });
      const released = await employeeDocuments.link(hrContext, employee.id, {
        documentId: medical.id,
        documentVersionId: versionId,
        personnelClassification: 'MEDICAL',
        purpose: 'PDS_SUPPORT',
        releaseState: 'RELEASED',
      });
      expect(released).toMatchObject({
        personnelClassification: 'MEDICAL',
        releaseState: 'RELEASED',
      });

      await expect(employeeDocuments.list(ownerContext, employee.id)).resolves.toEqual([
        expect.objectContaining({ id: released.id, personnelClassification: 'MEDICAL' }),
      ]);
      await expect(
        employeeDocuments.access(ownerContext, employee.id, released.id),
      ).resolves.toMatchObject({ id: released.id, accessUrl: expect.any(String) });

      await expect(employeeDocuments.list(readerWithoutSensitive, employee.id)).resolves.toEqual(
        [],
      );
      await expect(
        employeeDocuments.access(readerWithoutSensitive, employee.id, released.id),
      ).resolves.toBeNull();
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.employeeDocument.deleteMany({ where: { agencyId: agency.id } });
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agency.delete({ where: { id: agency.id } });
        await transaction.user.deleteMany({ where: { id: { in: [owner.id, hr.id] } } });
      });
      await admin.$disconnect();
    }
  },
);
