import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import type { DocumentStorage } from '../documents/documents.storage';
import { pdsAuditWriter, PdsService } from './pds.service';

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
  primaryOrganizationUnitId: string | null = null,
): RequestContext {
  return {
    requestId: `pds-${Date.now()}`,
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId,
    permissions,
  };
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

it.skipIf(!enabled)('maintains ordered qualification rows and exact evidence safely', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = await adminClient();
  const suffix = `${Date.now()}-pds-api`;
  const agency = await admin.agency.create({
    data: { code: `PDSI-${suffix}`, name: 'PDS API Agency', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const foreignAgency = await admin.agency.create({
    data: {
      code: `PDSIF-${suffix}`,
      name: 'Foreign PDS API Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `pds-api-${suffix}@example.test`,
      displayName: 'PDS API User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const otherUser = await admin.user.create({
    data: {
      emailNormalized: `pds-api-other-${suffix}@example.test`,
      displayName: 'Other PDS API User',
      globalStatus: 'ACTIVE',
    },
  });
  const otherMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: otherUser.id, status: 'ACTIVE' },
  });
  const foreignMembership = await admin.agencyMembership.create({
    data: { agencyId: foreignAgency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `PDSI-${suffix}`,
      legalName: 'PDS API Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: user.emailNormalized,
      createdByMembershipId: membership.id,
      updatedByMembershipId: membership.id,
    },
  });
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT set_config('app.employee_membership_link', 'on', true)
    `;
    await transaction.agencyMembership.update({
      where: { id: membership.id },
      data: { employeeId: employee.id },
    });
  });
  const organizationUnit = await admin.organizationUnit.create({
    data: {
      agencyId: agency.id,
      code: `PDSI-UNIT-${suffix}`,
      unitType: 'OFFICE',
      status: 'ACTIVE',
    },
  });
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT set_config('app.personnel_baseline_transition', 'on', true)
    `;
    const created = await transaction.serviceSegment.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        organizationUnitId: organizationUnit.id,
        appointmentStatus: 'PERMANENT',
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        createdByMembershipId: membership.id,
      },
    });
    await transaction.employee.update({
      where: { id: employee.id },
      data: { currentServiceSegmentId: created.id },
    });
  });
  const foreignEmployee = await admin.employee.create({
    data: {
      agencyId: foreignAgency.id,
      employeeNumber: `PDSIF-${suffix}`,
      legalName: 'Foreign PDS API Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'MALE',
      civilStatus: 'SINGLE',
      contactEmail: `foreign-${suffix}@example.test`,
      createdByMembershipId: foreignMembership.id,
      updatedByMembershipId: foreignMembership.id,
    },
  });
  const storage = new MemoryDocumentStorage();
  const documents = new DocumentsService(storage, documentAuditWriter);
  const pds = new PdsService(pdsAuditWriter, documents);
  const hrContext = context(agency.id, user.id, membership.id, [
    { code: 'personnel.pds.read', scopePolicy: 'AGENCY' },
    { code: 'personnel.pds.read_sensitive', scopePolicy: 'AGENCY' },
    { code: 'personnel.pds.update', scopePolicy: 'AGENCY' },
    { code: 'documents.evidence.create', scopePolicy: 'AGENCY' },
    { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
    { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
  ]);
  const employeeContext = context(agency.id, user.id, membership.id, [
    { code: 'personnel.pds.read', scopePolicy: 'OWN' },
    { code: 'personnel.pds.read_sensitive', scopePolicy: 'OWN' },
    { code: 'personnel.pds.update', scopePolicy: 'OWN' },
  ]);
  const redactedHrContext = context(agency.id, user.id, membership.id, [
    { code: 'personnel.pds.read', scopePolicy: 'AGENCY' },
    { code: 'personnel.pds.update', scopePolicy: 'AGENCY' },
  ]);
  const source = await documents.create(hrContext, {
    documentNo: `EDU-${suffix}`,
    documentType: 'Education certificate',
    classification: 'CONFIDENTIAL',
    idempotencyKey: `education-${suffix}`,
    file: { buffer: Buffer.from('%PDF-1.7 education'), mimetype: 'application/pdf' },
  });
  const sourceVersionId = source.currentVersion?.id;
  if (!sourceVersionId) throw new Error('The source Document Version was not created.');
  await admin.document.update({ where: { id: source.id }, data: { status: 'APPROVED' } });
  const otherSource = await documents.create(
    context(agency.id, otherUser.id, otherMembership.id, [
      { code: 'documents.evidence.create', scopePolicy: 'AGENCY' },
    ]),
    {
      documentNo: `OTHER-${suffix}`,
      documentType: 'Other employee evidence',
      classification: 'CONFIDENTIAL',
      idempotencyKey: `other-${suffix}`,
      file: { buffer: Buffer.from('%PDF-1.7 other'), mimetype: 'application/pdf' },
    },
  );
  const otherSourceVersionId = otherSource.currentVersion?.id;
  if (!otherSourceVersionId) throw new Error('The other Document Version was not created.');
  await admin.document.update({ where: { id: otherSource.id }, data: { status: 'APPROVED' } });

  try {
    const created = await pds.create(hrContext, {
      employeeId: employee.id,
      education: [
        {
          level: 'COLLEGE',
          sequenceNo: 2,
          schoolName: 'Second University',
          degreeCourse: 'Second Course',
          periodOfAttendance: '2015-2018',
          highestLevelUnits: null,
          yearGraduated: 2018,
          honors: 'N/A',
          documentId: source.id,
          documentVersionId: sourceVersionId,
        },
        {
          level: 'ELEMENTARY',
          sequenceNo: 1,
          schoolName: 'Elementary School',
          degreeCourse: 'Basic Education',
          periodOfAttendance: '1996-2002',
          highestLevelUnits: 'Grade 6',
          yearGraduated: 2002,
          honors: 'N/A',
        },
      ],
      eligibility: [
        {
          sequenceNo: 1,
          eligibilityName: "Driver's License",
          rating: 'Passed',
          examDate: '2020-01-15',
          examPlace: 'Manila',
          licenseNo: 'DL-123',
          validUntil: '2030-01-15',
        },
      ],
    });
    expect(created.education.map((record) => record.level)).toEqual(['ELEMENTARY', 'COLLEGE']);
    expect(created.education[1]).toMatchObject({
      documentId: source.id,
      documentVersionId: sourceVersionId,
    });
    expect(created.eligibility[0]).toMatchObject({
      eligibilityName: "Driver's License",
      rating: 'Passed',
      licenseNo: 'DL-123',
      validUntil: '2030-01-15',
    });
    const employeeLinked = await pds.update(employeeContext, created.id, {
      rowVersion: created.rowVersion,
      certification: {
        photoDocumentId: source.id,
        photoDocumentVersionId: sourceVersionId,
      },
    });
    expect(employeeLinked.certification).toMatchObject({
      photoDocumentId: source.id,
      photoDocumentVersionId: sourceVersionId,
    });
    await expect(
      pds.update(employeeContext, created.id, {
        rowVersion: employeeLinked.rowVersion,
        certification: {
          photoDocumentId: otherSource.id,
          photoDocumentVersionId: otherSourceVersionId,
        },
      }),
    ).rejects.toMatchObject({ code: 'PDS_EVIDENCE_FORBIDDEN' });

    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { agencyId: agency.id, action: 'PDS_EDUCATION_UPDATED' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Second University');
    expect(JSON.stringify(audit.metadata)).toContain('evidenceLinkCount');

    const updated = await pds.update(hrContext, created.id, {
      rowVersion: employeeLinked.rowVersion,
      education: [
        {
          level: 'COLLEGE',
          sequenceNo: 1,
          schoolName: 'Second University',
          degreeCourse: 'Second Course',
          periodOfAttendance: '2015-2018',
          highestLevelUnits: null,
          yearGraduated: 2018,
          honors: 'N/A',
          documentId: source.id,
          documentVersionId: sourceVersionId,
        },
      ],
    });
    expect(updated.education).toHaveLength(1);
    expect(updated.education[0]?.sequenceNo).toBe(1);
    expect(updated.eligibility).toHaveLength(1);

    const redacted = await pds.findById(
      context(
        agency.id,
        user.id,
        membership.id,
        [{ code: 'personnel.pds.read', scopePolicy: 'ASSIGNED_OFFICE' }],
        organizationUnit.id,
      ),
      created.id,
    );
    expect(redacted).toMatchObject({
      personal: null,
      education: [{ schoolName: 'Second University', documentId: null }],
      eligibility: [
        {
          eligibilityName: "Driver's License",
          examPlace: 'Manila',
          rating: null,
          licenseNo: null,
          validUntil: null,
          documentId: null,
          documentVersionId: null,
        },
      ],
    });

    const cleared = await pds.update(hrContext, created.id, {
      rowVersion: updated.rowVersion,
      education: [],
    });
    expect(cleared.education).toHaveLength(0);
    expect(cleared.eligibility).toHaveLength(1);
    const redactedMutation = await pds.update(redactedHrContext, created.id, {
      rowVersion: cleared.rowVersion,
      education: [],
    });
    expect(redactedMutation).toMatchObject({
      fieldScope: 'REDACTED',
      personal: null,
      certification: null,
    });

    await expect(
      pds.update(hrContext, created.id, {
        rowVersion: redactedMutation.rowVersion,
        education: [
          {
            level: 'COLLEGE',
            schoolName: 'Foreign',
            degreeCourse: 'Foreign',
            periodOfAttendance: '2010-2014',
            highestLevelUnits: 'N/A',
            yearGraduated: 2014,
            honors: 'N/A',
            documentId: source.id,
            documentVersionId: '00000000-0000-4000-8000-000000000099',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PDS_EVIDENCE_INVALID' });

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.pdsVersion.update({
        where: { id: created.id },
        data: { status: 'CERTIFIED' },
      });
      await transaction.pdsOutputArtifact.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          pdsVersionId: created.id,
          outputKey: `${created.id}:PDS:CS_FORM_212_REVISED_2026`,
          outputType: 'PDS',
          formVersion: 'CS_FORM_212_REVISED_2026',
          sourceArtifactId: `pds:${created.id}`,
          sourceArtifactHash: 'a'.repeat(64),
          dataAsOfDate: new Date('2026-08-31'),
          renderingMetadata: { revision: 'CS_FORM_212_REVISED_2026' },
          signatureMetadata: { signatureDocumentId: 'restricted' },
          renderedContent: { governmentIdNumber: 'restricted' },
        },
      });
    });
    const fullOutputs = await pds.listOutputs(
      context(agency.id, user.id, membership.id, [
        { code: 'personnel.pds.read', scopePolicy: 'AGENCY' },
        { code: 'personnel.pds.read_sensitive', scopePolicy: 'AGENCY' },
      ]),
      created.id,
    );
    expect(fullOutputs).toMatchObject({
      fieldScope: 'FULL',
      outputs: [{ renderedContent: { governmentIdNumber: 'restricted' } }],
    });
    const redactedOutputs = await pds.listOutputs(redactedHrContext, created.id);
    expect(redactedOutputs).toMatchObject({
      fieldScope: 'REDACTED',
      outputs: [{ renderedContent: null, signatureMetadata: null }],
    });
    await expect(
      pds.listOutputs(
        context(agency.id, otherUser.id, otherMembership.id, [
          { code: 'personnel.pds.read', scopePolicy: 'OWN' },
        ]),
        created.id,
      ),
    ).rejects.toMatchObject({ code: 'PDS_NOT_FOUND' });
    await expect(
      pds.update(hrContext, created.id, { rowVersion: cleared.rowVersion, education: [] }),
    ).rejects.toMatchObject({ code: 'PDS_VERSION_IMMUTABLE' });
    await expect(pds.list(hrContext, foreignEmployee.id)).rejects.toMatchObject({
      code: 'PDS_NOT_FOUND',
    });
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.pdsOutputArtifact.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.pdsEligibilityRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agency.id, foreignAgency.id] } } },
      });
      await transaction.pdsEducationRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agency.id, foreignAgency.id] } } },
      });
      await transaction.pdsFamilyRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agency.id, foreignAgency.id] } } },
      });
      await transaction.pdsPersonalDetails.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.pdsVersion.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.auditEvent.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.documentVersion.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.document.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.employee.updateMany({
        where: { agencyId: agency.id },
        data: { currentServiceSegmentId: null },
      });
      await transaction.serviceSegment.deleteMany({ where: { agencyId: agency.id } });
      await transaction.employee.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.organizationUnit.delete({ where: { id: organizationUnit.id } });
      await transaction.agencyMembership.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await transaction.agency.deleteMany({ where: { id: { in: [agency.id, foreignAgency.id] } } });
      await transaction.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });
    });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
