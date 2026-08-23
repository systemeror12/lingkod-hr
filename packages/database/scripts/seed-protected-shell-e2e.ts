import { PrismaClient } from '@prisma/client';

const issuer = process.env.OIDC_ISSUER ?? 'http://127.0.0.1:4100';
const databaseUrl =
  process.env.DATABASE_E2E_ADMIN_URL ??
  process.env.DATABASE_MIGRATION_OWNER_URL ??
  'postgresql://hris_local:local_only@localhost:55432/hris';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const foreignAgencyId = '11111111-1111-4111-8111-111111111111';
const foreignUnitId = '22222222-2222-4222-8222-222222222222';
const foreignUnitVersionId = '33333333-3333-4333-8333-333333333333';
const foreignAuditEventId = '44444444-4444-4444-8444-444444444444';

async function resetProfile(agency: {
  id: string;
  name: string;
  acronym: string | null;
  agencyType: string;
  status: string;
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.agency.update({
      where: { id: agency.id },
      data: { currentProfileVersionId: null },
    });
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, entityType: 'AgencyProfileVersion' },
    });
    await transaction.agencyProfileVersion.deleteMany({ where: { agencyId: agency.id } });
    const profile = await transaction.agencyProfileVersion.create({
      data: {
        agencyId: agency.id,
        versionNo: 1,
        officialName: agency.name,
        acronym: agency.acronym,
        agencyType: agency.agencyType,
        parentOrganization: 'Office of the President',
        reportingIdentifiers: 'UACS 240010000',
        appointingAuthorityTitle: 'Secretary',
        defaultTimezone: 'Asia/Manila',
        defaultCurrency: 'PHP',
        deploymentProfile: 'SHARED_SAAS',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
        domainStatus: agency.status,
      },
    });
    await transaction.agency.update({
      where: { id: agency.id },
      data: {
        currentProfileVersionId: profile.id,
        name: agency.name,
        acronym: agency.acronym,
        agencyType: agency.agencyType,
        status: agency.status,
        defaultTimezone: 'Asia/Manila',
        defaultCurrency: 'PHP',
      },
    });
  });
}

async function seed(): Promise<void> {
  const agency = await prisma.agency.upsert({
    where: { code: 'E2E-WORK-QUEUE' },
    update: {
      name: 'National Archives Coordination Office',
      acronym: 'NACO',
      status: 'ACTIVE',
    },
    create: {
      code: 'E2E-WORK-QUEUE',
      name: 'National Archives Coordination Office',
      acronym: 'NACO',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  await resetProfile(agency);
  await prisma.invitation.deleteMany({
    where: { agencyId: agency.id, status: 'PENDING' },
  });
  const user = await prisma.user.upsert({
    where: { emailNormalized: 'marisol.santos@example.test' },
    update: {
      identityProvider: issuer,
      externalSubject: 'local-work-queue-user',
      displayName: 'Marisol Santos',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
    create: {
      identityProvider: issuer,
      externalSubject: 'local-work-queue-user',
      emailNormalized: 'marisol.santos@example.test',
      displayName: 'Marisol Santos',
      globalStatus: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const membership =
    (await prisma.agencyMembership.findFirst({
      where: { agencyId: agency.id, userId: user.id },
    })) ??
    (await prisma.agencyMembership.create({
      data: {
        agencyId: agency.id,
        userId: user.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    }));
  if (membership.status !== 'ACTIVE') {
    await prisma.agencyMembership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', activatedAt: new Date(), deactivatedAt: null },
    });
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, entityType: 'PlantillaPosition' },
    });
    await transaction.positionDocument.deleteMany({ where: { agencyId: agency.id } });
    await transaction.plantillaPositionVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.plantillaPosition.deleteMany({ where: { agencyId: agency.id } });
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, entityType: 'OrganizationUnit' },
    });
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, entityType: 'StaffingAuthority' },
    });
    await transaction.auditEvent.deleteMany({
      where: { agencyId: agency.id, entityType: 'QualificationStandard' },
    });
    await transaction.staffingAuthority.deleteMany({ where: { agencyId: agency.id } });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: agency.id } });
    await transaction.qualificationStandard.updateMany({
      where: { agencyId: agency.id },
      data: { currentVersionId: null },
    });
    await transaction.qualificationStandardVersion.deleteMany({ where: { agencyId: agency.id } });
    await transaction.qualificationStandard.deleteMany({ where: { agencyId: agency.id } });
    await transaction.documentVersion.deleteMany({
      where: {
        agencyId: agency.id,
        document: {
          documentNo: {
            in: ['E2E-PLANTILLA-QS-SOURCE', 'E2E-PLANTILLA-QS-APPROVAL', 'E2E-PLANTILLA-AUTHORITY'],
          },
        },
      },
    });
    await transaction.document.deleteMany({
      where: {
        agencyId: agency.id,
        documentNo: {
          in: ['E2E-PLANTILLA-QS-SOURCE', 'E2E-PLANTILLA-QS-APPROVAL', 'E2E-PLANTILLA-AUTHORITY'],
        },
      },
    });

    const unit = await transaction.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: 'HRM-DIV',
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
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
          status: 'DRAFT',
          createdByMembershipId: membership.id,
        },
      });
      const version = await transaction.documentVersion.create({
        data: {
          agencyId: agency.id,
          documentId: document.id,
          versionNo: 1,
          storageKey: `e2e/${documentNo}`,
          contentHash: 'a'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          createdByMembershipId: membership.id,
          issuedAt: new Date('2026-01-01'),
        },
      });
      return transaction.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id, status: 'APPROVED' },
        select: { id: true, currentVersionId: true },
      });
    }

    const sourceEvidence = await evidence('E2E-PLANTILLA-QS-SOURCE', 'QUALIFICATION_STANDARD');
    const approvalEvidence = await evidence('E2E-PLANTILLA-QS-APPROVAL', 'QUALIFICATION_STANDARD');
    const authorityEvidence = await evidence('E2E-PLANTILLA-AUTHORITY', 'STAFFING_AUTHORITY');
    const standard = await transaction.qualificationStandard.create({
      data: {
        agencyId: agency.id,
        code: 'QS-HRM-E2E',
        name: 'Human Resource Management',
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
        sourceDocumentId: sourceEvidence.id,
        sourceEvidenceVersionId: sourceEvidence.currentVersionId!,
        sourceEvidenceValidatedAt: new Date('2026-01-02'),
        sourceEvidenceValidatedByMembershipId: membership.id,
        sourceEvidenceValidationReason: 'Protected shell fixture source reviewed.',
        approvalDocumentId: approvalEvidence.id,
        approvalEvidenceVersionId: approvalEvidence.currentVersionId!,
        approvalEvidenceValidatedAt: new Date('2026-01-02'),
        approvalEvidenceValidatedByMembershipId: membership.id,
        approvalEvidenceValidationReason: 'Protected shell fixture approval reviewed.',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.qualificationStandard.update({
      where: { id: standard.id },
      data: { currentVersionId: standardVersion.id },
    });
    const authority = await transaction.staffingAuthority.create({
      data: {
        agencyId: agency.id,
        authorityType: 'DBM_APPROVAL',
        referenceNo: 'E2E-NOSCA-2026-001',
        issuedDate: new Date('2025-12-01'),
        effectiveDate: new Date('2026-01-01'),
        documentId: authorityEvidence.id,
        evidenceVersionId: authorityEvidence.currentVersionId!,
        evidenceValidatedAt: new Date('2026-01-02'),
        evidenceValidatedByMembershipId: membership.id,
        evidenceValidationReason: 'Protected shell fixture authority reviewed.',
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const position = await transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: 'HRM-000142',
        status: 'PROPOSED',
        createdFromAuthorityId: authority.id,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    const positionVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: agency.id,
        positionId: position.id,
        organizationUnitId: unit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: authority.id,
        versionNo: 1,
        positionTitle: 'Senior Human Resource Management Officer',
        parentheticalTitle: 'Records and Staffing',
        salaryGrade: 24,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
        domainStatus: 'PROPOSED',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: position.id },
      data: { currentVersionId: positionVersion.id },
    });
  });
  const role = await prisma.role.findFirstOrThrow({
    where: { agencyId: null, code: 'agency_administrator', status: 'ACTIVE' },
  });
  const assignment = await prisma.membershipRole.findFirst({
    where: { agencyId: agency.id, membershipId: membership.id, roleId: role.id },
  });
  if (!assignment) {
    await prisma.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId: membership.id,
        roleId: role.id,
        effectiveFrom: new Date(),
        assignedByMembershipId: membership.id,
        reason: 'Protected shell E2E fixture',
      },
    });
  }

  const foreignAgency = await prisma.agency.upsert({
    where: { id: foreignAgencyId },
    update: {
      code: 'E2E-FOREIGN-RECORDS',
      name: 'Synthetic Foreign Records Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
    create: {
      id: foreignAgencyId,
      code: 'E2E-FOREIGN-RECORDS',
      name: 'Synthetic Foreign Records Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  await resetProfile(foreignAgency);
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: foreignAgency.id } });
    await transaction.organizationUnit.create({
      data: {
        id: foreignUnitId,
        agencyId: foreignAgency.id,
        code: 'FOREIGN-RECORD',
        unitType: 'OFFICE',
        status: 'DRAFT',
      },
    });
    await transaction.organizationUnitVersion.create({
      data: {
        id: foreignUnitVersionId,
        agencyId: foreignAgency.id,
        organizationUnitId: foreignUnitId,
        versionNo: 1,
        name: 'Synthetic Foreign Records Office',
        effectiveFrom: new Date('2026-08-16'),
        status: 'DRAFT',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: foreignUnitId },
      data: { currentVersionId: foreignUnitVersionId },
    });
    await transaction.auditEvent.create({
      data: {
        id: foreignAuditEventId,
        agencyId: foreignAgency.id,
        actorType: 'SYSTEM',
        action: 'ORGANIZATION_UNIT_CREATED',
        entityType: 'OrganizationUnit',
        entityId: foreignUnitId,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        metadata: {
          officialName: 'Synthetic Foreign Records Office',
          code: 'FOREIGN-RECORD',
          unitType: 'OFFICE',
          effectiveDate: '2026-08-16',
        },
      },
    });
  });
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
