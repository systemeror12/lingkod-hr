import { PrismaClient, type Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  qualificationStandardAuditWriter,
  QualificationStandardsService,
} from './qualification-standards.service';

const enabled = process.env.DATABASE_E2E === 'true';

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'qualification-standard-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'qualification.standards.read', scopePolicy: 'AGENCY' },
      { code: 'qualification.standards.create', scopePolicy: 'AGENCY' },
      { code: 'qualification.standards.update', scopePolicy: 'AGENCY' },
      { code: 'qualification.standards.evidence.validate', scopePolicy: 'AGENCY' },
      { code: 'qualification.standards.activate', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
    ],
  };
}

function manilaDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
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
      documentType: 'QUALIFICATION_STANDARD',
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
  'activates, supersedes, corrects, and protects Qualification Standard history',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-qualification-standard-service`;
    const initialEffectiveDate = manilaDate(-9);
    const successorEffectiveDate = manilaDate(1);
    const agency = await admin.agency.create({
      data: {
        code: `QS-${suffix}`,
        name: 'Qualification Standard Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'qualification-standard-integration',
        externalSubject: `qualification-standard-${suffix}`,
        emailNormalized: `qualification-standard-${suffix}@example.test`,
        displayName: 'Qualification Standard Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const service = new QualificationStandardsService(
      qualificationStandardAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );
    const sourceEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-source`,
    );
    const approvalEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-approval`,
    );
    const successorSourceEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-successor-source`,
    );
    const successorApprovalEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-successor-approval`,
    );

    try {
      const created = await service.create(context, {
        code: `QS-${suffix}`,
        name: 'Qualification Standard Integration',
        effectiveDate: initialEffectiveDate,
        trainingHoursRequired: 40,
        experienceMonthsRequired: 12,
        competencyRequirements: [{ code: 'LEADERSHIP' }],
      });
      if (!created.draft) throw new Error('The initial Draft was not created.');

      await expect(
        service.activate(context, created.id, created.draft.id, 'Evidence is incomplete.'),
      ).rejects.toMatchObject({ code: 'QUALIFICATION_STANDARD_EVIDENCE_REQUIRED' });
      await service.linkEvidence(context, created.id, created.draft.id, {
        kind: 'SOURCE',
        documentId: sourceEvidence.id,
        validationReason: 'Reviewed the source instrument.',
      });
      await service.linkEvidence(context, created.id, created.draft.id, {
        kind: 'APPROVAL',
        documentId: approvalEvidence.id,
        validationReason: 'Reviewed the approving instrument.',
      });
      const active = await service.activate(
        context,
        created.id,
        created.draft.id,
        'Both evidence records were reviewed.',
        'activate-initial',
      );
      if (!active.currentVersion) throw new Error('The initial version was not projected current.');
      expect(active.status).toBe('ACTIVE');

      const activeVersion = await admin.qualificationStandardVersion.findFirstOrThrow({
        where: { id: active.currentVersion.id },
      });
      await expect(
        withDatabaseContext(
          { agencyId: agency.id, userId: user.id, membershipId: membership.id },
          (transaction) =>
            transaction.qualificationStandardVersion.update({
              where: { agencyId_id: { agencyId: agency.id, id: activeVersion.id } },
              data: { educationRequirement: 'Tampered outside the service' },
            }),
        ),
      ).rejects.toThrow(/application service|immutable/i);

      await expect(
        withDatabaseContext(
          {
            agencyId: agency.id,
            userId: user.id,
            membershipId: membership.id,
            qualificationStandardTransition: true,
          },
          (transaction) =>
            transaction.qualificationStandardVersion.create({
              data: {
                agencyId: agency.id,
                qualificationStandardId: created.id,
                versionNo: 99,
                educationRequirement: activeVersion.educationRequirement,
                trainingHoursRequired: activeVersion.trainingHoursRequired,
                experienceMonthsRequired: activeVersion.experienceMonthsRequired,
                eligibilityRequirement: activeVersion.eligibilityRequirement,
                competencyRequirements: (activeVersion.competencyRequirements ??
                  []) as Prisma.InputJsonValue,
                licenseRequirements: (activeVersion.licenseRequirements ??
                  []) as Prisma.InputJsonValue,
                specialRequirements: activeVersion.specialRequirements,
                sourceDocumentId: activeVersion.sourceDocumentId,
                sourceEvidenceVersionId: activeVersion.sourceEvidenceVersionId,
                sourceEvidenceValidatedAt: activeVersion.sourceEvidenceValidatedAt,
                sourceEvidenceValidatedByMembershipId:
                  activeVersion.sourceEvidenceValidatedByMembershipId,
                sourceEvidenceValidationReason: activeVersion.sourceEvidenceValidationReason,
                approvalDocumentId: activeVersion.approvalDocumentId,
                approvalEvidenceVersionId: activeVersion.approvalEvidenceVersionId,
                approvalEvidenceValidatedAt: activeVersion.approvalEvidenceValidatedAt,
                approvalEvidenceValidatedByMembershipId:
                  activeVersion.approvalEvidenceValidatedByMembershipId,
                approvalEvidenceValidationReason: activeVersion.approvalEvidenceValidationReason,
                effectiveFrom: activeVersion.effectiveFrom,
                status: 'ACTIVE',
                domainStatus: 'ACTIVE',
                createdByMembershipId: membership.id,
                updatedByMembershipId: membership.id,
              },
            }),
        ),
      ).rejects.toThrow(/overlap|exclusion/i);

      const successor = await service.createSuccessor(context, created.id);
      await service.linkEvidence(context, created.id, successor.draft.id, {
        kind: 'SOURCE',
        documentId: successorSourceEvidence.id,
        validationReason: 'Reviewed the successor source.',
      });
      await service.linkEvidence(context, created.id, successor.draft.id, {
        kind: 'APPROVAL',
        documentId: successorApprovalEvidence.id,
        validationReason: 'Reviewed the successor approval.',
      });
      const successorActive = await service.activate(
        context,
        created.id,
        successor.draft.id,
        'The later version is effective tomorrow.',
        'activate-successor',
      );
      expect(successorActive.currentVersion?.versionNo).toBe(active.currentVersion.versionNo);

      const corrected = await service.correct(context, created.id, successor.draft.id, {
        educationRequirement: 'Corrected education requirement',
        trainingHoursRequired: 40,
        experienceMonthsRequired: 12,
        competencyRequirements: [{ code: 'LEADERSHIP' }],
        reason: 'Corrected a factual requirement.',
      });
      expect(corrected.versionState).toBe('ACTIVE');
      expect(corrected.id).not.toBe(successor.draft.id);
      await expect(
        service.assertUsableForAction(context, corrected.id, successorEffectiveDate),
      ).resolves.toMatchObject({ id: corrected.id });
      await expect(
        service.assertUsableForAction(context, active.currentVersion.id, successorEffectiveDate),
      ).rejects.toMatchObject({ code: 'QUALIFICATION_STANDARD_NOT_EFFECTIVE' });

      const detail = await service.findById(context, created.id);
      expect(detail?.versions.map(({ versionState }) => versionState)).toEqual(
        expect.arrayContaining(['VOIDED', 'SUPERSEDED', 'ACTIVE']),
      );
      expect(detail?.history.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'QUALIFICATION_STANDARD_VERSION_ACTIVATED',
          'QUALIFICATION_STANDARD_VERSION_CORRECTED',
        ]),
      );
      await expect(
        admin.auditEvent.count({
          where: { agencyId: agency.id, entityType: 'QualificationStandard' },
        }),
      ).resolves.toBe(9);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.qualificationStandardVersion.deleteMany({
          where: { agencyId: agency.id },
        });
        await transaction.qualificationStandard.deleteMany({ where: { agencyId: agency.id } });
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
