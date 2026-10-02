import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  staffingAuthorityAuditWriter,
  StaffingAuthorityService,
} from './staffing-authorities.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';

const enabled = process.env.DATABASE_E2E === 'true';

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'staffing-authority-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'staffing.authorities.read', scopePolicy: 'AGENCY' },
      { code: 'staffing.authorities.create', scopePolicy: 'AGENCY' },
      { code: 'staffing.authorities.update', scopePolicy: 'AGENCY' },
      { code: 'staffing.authorities.evidence.validate', scopePolicy: 'AGENCY' },
      { code: 'staffing.authorities.activate', scopePolicy: 'AGENCY' },
      { code: 'staffing.authorities.supersede', scopePolicy: 'AGENCY' },
      { code: 'staffing.authorities.revoke', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
    ],
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType: 'STAFFING_AUTHORITY',
      classification: 'CONFIDENTIAL',
      status: 'DRAFT',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `integration/${suffix}`,
      contentHash: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return document;
}

it.skipIf(!enabled)(
  'activates, supersedes, and revokes authorities without rewriting history',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-staffing-authority-service`;
    const agency = await admin.agency.create({
      data: {
        code: `SA-${suffix}`,
        name: 'Staffing Authority Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `staffing-authority-service-${suffix}@example.test`,
        displayName: 'Staffing Authority Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const service = new StaffingAuthorityService(
      staffingAuthorityAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );
    const originalEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-original`,
    );
    const successorEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-successor`,
    );

    try {
      const original = await service.create(context, {
        authorityType: 'LAW',
        referenceNo: `LAW-${suffix}`,
        issuedDate: '2026-08-01',
        effectiveDate: '2026-08-15',
        sourceMetadata: { issuer: 'Integration source' },
      });
      await expect(
        service.activate(context, original.id, 'Cannot activate before evidence.'),
      ).rejects.toMatchObject({ code: 'STAFFING_AUTHORITY_EVIDENCE_REQUIRED' });
      await service.validateEvidence(
        context,
        original.id,
        {
          documentId: originalEvidence.id,
          validationReason: 'Reviewed the official source.',
        },
        'validate-original',
      );
      await expect(
        service.validateEvidence(
          context,
          original.id,
          {
            documentId: originalEvidence.id,
            validationReason: 'Reviewed the official source.',
          },
          'validate-original',
        ),
      ).resolves.toMatchObject({ id: original.id, status: 'DRAFT' });
      const originalVersion = await admin.documentVersion.findFirstOrThrow({
        where: { documentId: originalEvidence.id, versionNo: 1 },
      });
      const replacementVersion = await admin.documentVersion.create({
        data: {
          agencyId: agency.id,
          documentId: originalEvidence.id,
          versionNo: 2,
          storageKey: `${suffix}-original-replacement`,
          contentHash: 'b'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          createdByMembershipId: membership.id,
        },
      });
      await admin.document.update({
        where: { id: originalEvidence.id },
        data: { currentVersionId: replacementVersion.id },
      });
      expect(replacementVersion.id).not.toBe(originalVersion.id);
      await expect(service.findById(context, original.id)).resolves.toMatchObject({
        authority: { evidence: { versionNo: 1 } },
      });
      const active = await service.activate(
        context,
        original.id,
        'Evidence reviewed and approved.',
        'activate-original',
      );
      expect(active.status).toBe('ACTIVE');
      await expect(
        service.activate(
          context,
          original.id,
          'Evidence reviewed and approved.',
          'activate-original',
        ),
      ).resolves.toMatchObject({ id: original.id, status: 'ACTIVE' });

      const successor = await service.create(context, {
        authorityType: 'DBM_APPROVAL',
        referenceNo: `DBM-${suffix}`,
        issuedDate: '2026-08-20',
        effectiveDate: '2026-09-01',
      });
      await service.validateEvidence(context, successor.id, {
        documentId: successorEvidence.id,
        validationReason: 'Reviewed the successor issuance.',
      });
      const successorActive = await service.supersede(
        context,
        original.id,
        successor.id,
        'The later issuance replaces the prior authority prospectively.',
        'supersede-original',
      );
      expect(successorActive.status).toBe('ACTIVE');
      await expect(
        service.supersede(
          context,
          original.id,
          successor.id,
          'The later issuance replaces the prior authority prospectively.',
          'supersede-original',
        ),
      ).resolves.toMatchObject({ id: successor.id, status: 'ACTIVE' });
      await expect(
        service.assertUsableForAction(context, original.id, '2026-08-31'),
      ).resolves.toMatchObject({
        id: original.id,
        status: 'SUPERSEDED',
      });
      await expect(
        service.assertUsableForAction(context, original.id, '2026-09-01'),
      ).rejects.toMatchObject({
        code: 'STAFFING_AUTHORITY_SUPERSEDED',
      });

      const revoked = await service.revoke(
        context,
        successor.id,
        '2026-10-01',
        'The authority was formally withdrawn.',
        successorEvidence.id,
        'revoke-successor',
      );
      expect(revoked.status).toBe('REVOKED');
      await expect(
        service.revoke(
          context,
          successor.id,
          '2026-10-01',
          'The authority was formally withdrawn.',
          successorEvidence.id,
          'revoke-successor',
        ),
      ).resolves.toMatchObject({ id: successor.id, status: 'REVOKED' });
      await expect(
        service.assertUsableForAction(context, successor.id, '2026-09-30'),
      ).resolves.toMatchObject({
        id: successor.id,
        status: 'REVOKED',
      });
      await expect(
        service.assertUsableForAction(context, successor.id, '2026-10-01'),
      ).rejects.toMatchObject({
        code: 'STAFFING_AUTHORITY_REVOKED',
      });

      const persisted = await admin.staffingAuthority.findMany({
        where: { agencyId: agency.id },
        select: {
          status: true,
          documentId: true,
          evidenceVersionId: true,
          revocationDocumentId: true,
          revocationEvidenceVersionId: true,
        },
      });
      expect(persisted).toHaveLength(2);
      expect(persisted).toEqual(
        expect.arrayContaining([
          {
            status: 'SUPERSEDED',
            documentId: originalEvidence.id,
            evidenceVersionId: originalVersion.id,
            revocationDocumentId: null,
            revocationEvidenceVersionId: null,
          },
          {
            status: 'REVOKED',
            documentId: successorEvidence.id,
            evidenceVersionId: expect.any(String),
            revocationDocumentId: successorEvidence.id,
            revocationEvidenceVersionId: expect.any(String),
          },
        ]),
      );
      await expect(
        admin.auditEvent.count({ where: { agencyId: agency.id, entityType: 'StaffingAuthority' } }),
      ).resolves.toBe(8);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.staffingAuthority.deleteMany({ where: { agencyId: agency.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.$disconnect();
    }
  },
);
