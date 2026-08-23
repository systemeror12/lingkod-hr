import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { organizationAuditWriter, OrganizationService } from '../organization/organization.service';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from './plantilla-positions.service';

const enabled = process.env.DATABASE_E2E === 'true';

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'plantilla-position-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'positions.items.read', scopePolicy: 'AGENCY' },
      { code: 'positions.history.read', scopePolicy: 'AGENCY' },
      { code: 'positions.items.create', scopePolicy: 'AGENCY' },
      { code: 'positions.items.update', scopePolicy: 'AGENCY' },
      { code: 'organization.units.read', scopePolicy: 'AGENCY' },
      { code: 'organization.units.update', scopePolicy: 'AGENCY' },
      { code: 'organization.units.activate', scopePolicy: 'AGENCY' },
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

it.skipIf(!enabled)(
  'creates, versions, corrects, and projects Plantilla Position history atomically',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-plantilla-position-service`;
    const agency = await admin.agency.create({
      data: {
        code: `POSITION-${suffix}`,
        name: 'Plantilla Position Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'plantilla-position-integration',
        externalSubject: `plantilla-position-${suffix}`,
        emailNormalized: `plantilla-position-${suffix}@example.test`,
        displayName: 'Plantilla Position Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const service = new PlantillaPositionsService(
      plantillaPositionAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );
    const organizationService = new OrganizationService(organizationAuditWriter);

    let unitId = '';
    let unitVersionId = '';
    let qualificationStandardVersionId = '';
    let staffingAuthorityId = '';
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");

      const unit = await transaction.organizationUnit.create({
        data: {
          agencyId: agency.id,
          code: `HRM-${suffix}`,
          unitType: 'DIVISION',
          status: 'ACTIVE',
        },
      });
      unitId = unit.id;
      const unitVersion = await transaction.organizationUnitVersion.create({
        data: {
          agencyId: agency.id,
          organizationUnitId: unit.id,
          versionNo: 1,
          name: 'Human Resource Management Division',
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      unitVersionId = unitVersion.id;
      await transaction.organizationUnit.update({
        where: { id: unit.id },
        data: { currentVersionId: unitVersion.id },
      });

      async function evidence(documentNo: string, documentType: string) {
        const document = await transaction.document.create({
          data: {
            agencyId: agency.id,
            documentNo,
            documentType,
            classification: 'CONFIDENTIAL',
            status: 'APPROVED',
            createdByMembershipId: membership.id,
          },
        });
        const version = await transaction.documentVersion.create({
          data: {
            agencyId: agency.id,
            documentId: document.id,
            versionNo: 1,
            storageKey: `integration/${documentNo}`,
            contentHash: 'a'.repeat(64),
            mimeType: 'application/pdf',
            sizeBytes: 1,
            createdByMembershipId: membership.id,
          },
        });
        await transaction.document.update({
          where: { id: document.id },
          data: { currentVersionId: version.id },
        });
        return { documentId: document.id, versionId: version.id };
      }

      const source = await evidence(`POSITION-${suffix}-QS-SOURCE`, 'QUALIFICATION_STANDARD');
      const approval = await evidence(`POSITION-${suffix}-QS-APPROVAL`, 'QUALIFICATION_STANDARD');
      const authorityEvidence = await evidence(
        `POSITION-${suffix}-AUTHORITY`,
        'STAFFING_AUTHORITY',
      );
      const standard = await transaction.qualificationStandard.create({
        data: {
          agencyId: agency.id,
          code: `QS-${suffix}`,
          name: 'Plantilla Position Integration Standard',
          status: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      const standardVersion = await transaction.qualificationStandardVersion.create({
        data: {
          agencyId: agency.id,
          qualificationStandardId: standard.id,
          versionNo: 1,
          educationRequirement: 'Bachelor degree',
          eligibilityRequirement: 'Career service',
          sourceDocumentId: source.documentId,
          sourceEvidenceVersionId: source.versionId,
          sourceEvidenceValidatedAt: new Date('2026-01-02'),
          sourceEvidenceValidatedByMembershipId: membership.id,
          sourceEvidenceValidationReason: 'Reviewed the source standard.',
          approvalDocumentId: approval.documentId,
          approvalEvidenceVersionId: approval.versionId,
          approvalEvidenceValidatedAt: new Date('2026-01-02'),
          approvalEvidenceValidatedByMembershipId: membership.id,
          approvalEvidenceValidationReason: 'Reviewed the approving standard.',
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      qualificationStandardVersionId = standardVersion.id;
      await transaction.qualificationStandard.update({
        where: { id: standard.id },
        data: { currentVersionId: standardVersion.id },
      });
      const authority = await transaction.staffingAuthority.create({
        data: {
          agencyId: agency.id,
          authorityType: 'DBM_APPROVAL',
          referenceNo: `AUTH-${suffix}`,
          issuedDate: new Date('2025-12-01'),
          effectiveDate: new Date('2026-01-01'),
          documentId: authorityEvidence.documentId,
          evidenceVersionId: authorityEvidence.versionId,
          evidenceValidatedAt: new Date('2026-01-02'),
          evidenceValidatedByMembershipId: membership.id,
          evidenceValidationReason: 'Reviewed the staffing authority.',
          status: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      staffingAuthorityId = authority.id;
    });

    const input = {
      itemNumber: `ITEM-${suffix}`,
      title: 'Human Resource Management Officer III',
      parentheticalTitle: 'Records and Staffing',
      salaryGrade: 18,
      organizationUnitId: unitId,
      fundingSource: 'General Appropriations Act',
      employmentCategory: 'PLANTILLA' as const,
      qualificationStandardVersionId,
      staffingAuthorityId,
      effectiveDate: '2026-01-01',
    };
    const positionIdForCleanup = { id: '' };

    try {
      const created = await service.create(context, input);
      positionIdForCleanup.id = created.id;
      expect(created.currentVersion).toMatchObject({ versionNo: 1, versionState: 'ACTIVE' });

      const organizationSuccessor = await organizationService.createSuccessor(context, unitId);
      const updatedOrganizationDraft = await organizationService.updateDraft(
        context,
        unitId,
        organizationSuccessor.draft.id,
        {
          officialName: organizationSuccessor.draft.officialName,
          parentUnitId: organizationSuccessor.draft.parentUnitId,
          headPositionId: created.id,
          costCenterCode: organizationSuccessor.draft.costCenterCode,
          responsibilityCenterCode: organizationSuccessor.draft.responsibilityCenterCode,
          effectiveDate: organizationSuccessor.draft.effectiveFrom,
        },
      );
      expect(updatedOrganizationDraft.headPositionId).toBe(created.id);
      await organizationService.activateSuccessor(context, unitId, organizationSuccessor.draft.id, {
        reason: 'Assigned the eligible Plantilla Position as the Organization Unit head.',
      });
      await expect(
        admin.organizationUnitVersion.findUnique({ where: { id: unitVersionId } }),
      ).resolves.toMatchObject({ headPositionId: null });
      await expect(
        admin.organizationUnitVersion.findFirst({
          where: { agencyId: agency.id, organizationUnitId: unitId, headPositionId: created.id },
        }),
      ).resolves.toMatchObject({ headPositionId: created.id });

      await expect(service.findById(context, created.id, '2025-12-31')).resolves.toMatchObject({
        effective: null,
      });
      await expect(service.create(context, input)).rejects.toMatchObject({
        code: 'PLANTILLA_POSITION_ITEM_NUMBER_CONFLICT',
      });
      await expect(
        service.create(context, {
          ...input,
          itemNumber: `ATOMIC-${suffix}`,
          organizationUnitId: user.id,
        }),
      ).rejects.toMatchObject({ code: 'PLANTILLA_POSITION_ORGANIZATION_UNIT_INVALID' });
      await expect(
        admin.plantillaPosition.findUnique({ where: { id: created.id } }),
      ).resolves.toMatchObject({ currentVersionId: expect.any(String), status: 'PROPOSED' });
      await expect(
        admin.plantillaPosition.findFirst({ where: { itemNumber: `ATOMIC-${suffix}` } }),
      ).resolves.toBeNull();

      const successor = await service.createSuccessor(context, created.id);
      expect(successor.draft).toMatchObject({ versionNo: 2, versionState: 'DRAFT' });
      expect(successor.draft.effectiveFrom).toBe(addDays(today(), 1));
      await expect(service.createSuccessor(context, created.id)).resolves.toMatchObject({
        draft: { id: successor.draft.id },
      });

      const updatedDraft = await service.updateDraft(context, created.id, successor.draft.id, {
        ...input,
        title: 'Senior Human Resource Management Officer',
        effectiveDate: successor.draft.effectiveFrom,
        rowVersion: successor.draft.rowVersion,
      });
      expect(updatedDraft.title).toBe('Senior Human Resource Management Officer');
      const activated = await service.activate(
        context,
        created.id,
        successor.draft.id,
        'The successor was approved for the next effective period.',
      );
      expect(activated.currentVersion).toMatchObject({ versionNo: 1, versionState: 'SUPERSEDED' });

      const oldDetail = await service.findById(context, created.id, '2026-08-22');
      expect(oldDetail?.effective).toMatchObject({ versionNo: 1, versionState: 'SUPERSEDED' });
      const newDetail = await service.findById(context, created.id, successor.draft.effectiveFrom);
      expect(newDetail?.effective).toMatchObject({
        versionNo: 2,
        title: 'Senior Human Resource Management Officer',
        versionState: 'ACTIVE',
      });

      const corrected = await service.correct(context, created.id, successor.draft.id, {
        ...input,
        title: 'Senior Human Resource Management Officer (Corrected)',
        parentheticalTitle: null,
        salaryGrade: 19,
        reason: 'Corrected the approved title and salary grade.',
      });
      expect(corrected).toMatchObject({ versionNo: 3, versionState: 'ACTIVE', salaryGrade: 19 });
      const history = await service.findById(context, created.id);
      expect(history?.versions.map(({ versionState }) => versionState)).toEqual(
        expect.arrayContaining(['SUPERSEDED', 'VOIDED', 'ACTIVE']),
      );
      expect(history?.history.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'PLANTILLA_POSITION_CREATED',
          'PLANTILLA_POSITION_SUCCESSOR_CREATED',
          'PLANTILLA_POSITION_VERSION_ACTIVATED',
          'PLANTILLA_POSITION_VERSION_CORRECTED',
        ]),
      );
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.organizationUnit.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.qualificationStandard.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.plantillaPosition.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.plantillaPositionVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.plantillaPosition.deleteMany({ where: { agencyId: agency.id } });
        await transaction.staffingAuthority.deleteMany({ where: { agencyId: agency.id } });
        await transaction.qualificationStandardVersion.deleteMany({
          where: { agencyId: agency.id },
        });
        await transaction.qualificationStandard.deleteMany({ where: { agencyId: agency.id } });
        await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.organizationUnit.deleteMany({ where: { agencyId: agency.id } });
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
