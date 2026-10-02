import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { salnComplianceAuditWriter, SalnComplianceService } from './saln-compliance.service';

const enabled = process.env.DATABASE_E2E === 'true';

function adminUrl(): string {
  const value = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!value) throw new Error('An administrative database URL is required.');
  return value;
}

it.skipIf(!enabled)(
  'records and corrects metadata while preserving history and sanitizing Audit',
  async () => {
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    const suffix = String(Date.now());
    const agency = await admin.agency.create({
      data: { code: `SALN-${suffix}`, name: 'SALN Test', agencyType: 'NGA', status: 'ACTIVE' },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `saln-${suffix}@example.test`,
        displayName: 'SALN Officer',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `SALN-${suffix}`,
        legalName: `SALN Employee ${suffix}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `employee-${suffix}@example.test`,
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await admin.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('app.employee_membership_link', 'on', true)`;
      await transaction.agencyMembership.update({
        where: { id: membership.id },
        data: { employeeId: employee.id },
      });
    });
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentNo: `ACK-${suffix}`,
        documentType: 'SALN_ACKNOWLEDGMENT',
        classification: 'CONFIDENTIAL',
        status: 'DRAFT',
        createdByMembershipId: membership.id,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `saln-test/${suffix}`,
        contentHash: 'a'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        createdByMembershipId: membership.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id, status: 'APPROVED' },
    });
    const context: RequestContext = {
      requestId: `saln-${suffix}`,
      userId: user.id,
      agencyId: agency.id,
      membershipId: membership.id,
      primaryOrganizationUnitId: null,
      permissions: [
        { code: 'personnel.saln_compliance.read', scopePolicy: 'AGENCY' },
        { code: 'personnel.saln_compliance.update', scopePolicy: 'AGENCY' },
      ],
    };
    const service = new SalnComplianceService(
      salnComplianceAuditWriter,
      new DocumentsService({} as never, documentAuditWriter),
    );
    try {
      const first = await service.create(context, employee.id, {
        requirementReference: 'Agency memorandum 2026-04',
        filingYear: 2026,
        filingType: 'ANNUAL',
        status: 'ACKNOWLEDGED',
        submittedAt: '2026-04-30T09:00:00.000+08:00',
        repositoryReference: `secret-repository-${suffix}`,
        acknowledgmentDocumentId: document.id,
        acknowledgmentDocumentVersionId: version.id,
      });
      const updated = await service.update(context, employee.id, first.id, {
        requirementReference: first.requirementReference,
        filingYear: 2026,
        filingType: 'ANNUAL',
        status: 'ACKNOWLEDGED',
        submittedAt: first.submittedAt,
        repositoryReference: 'Records/2026/0041',
        acknowledgmentDocumentId: document.id,
        acknowledgmentDocumentVersionId: version.id,
      });
      const corrected = await service.correct(context, employee.id, updated.id, {
        requirementReference: first.requirementReference,
        filingYear: 2026,
        filingType: 'ANNUAL',
        status: 'ACKNOWLEDGED',
        submittedAt: first.submittedAt,
        repositoryReference: 'Records/2026/0042',
        acknowledgmentDocumentId: document.id,
        acknowledgmentDocumentVersionId: version.id,
        reason: 'Correct a transcription error.',
      });
      expect(await service.list(context, employee.id)).toEqual([
        expect.objectContaining({ id: corrected.id }),
      ]);
      expect(await service.history(context, employee.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: first.id }),
          expect.objectContaining({ id: updated.id, correctsRecordId: first.id }),
          expect.objectContaining({ id: corrected.id, correctsRecordId: updated.id }),
        ]),
      );
      const own = await service.list(
        {
          ...context,
          permissions: [{ code: 'personnel.saln_compliance.read', scopePolicy: 'OWN' }],
        },
        employee.id,
      );
      expect(own).toEqual([
        expect.not.objectContaining({
          repositoryReference: expect.anything(),
          requirementReference: expect.anything(),
        }),
      ]);
      expect(
        await service.history(
          {
            ...context,
            permissions: [{ code: 'personnel.saln_compliance.read', scopePolicy: 'OWN' }],
          },
          employee.id,
        ),
      ).toBeNull();
      const audit = await admin.auditEvent.findMany({
        where: { agencyId: agency.id, entityType: 'SalnComplianceRecord' },
      });
      expect(audit.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'SALN_COMPLIANCE_RECORDED',
          'SALN_COMPLIANCE_UPDATED',
          'SALN_COMPLIANCE_CORRECTED',
        ]),
      );
      expect(JSON.stringify(audit)).not.toContain(`secret-repository-${suffix}`);
      expect(JSON.stringify(audit)).not.toContain(version.id);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.salnComplianceRecord.deleteMany({ where: { agencyId: agency.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
        await transaction.$queryRaw`SELECT set_config('app.employee_membership_link', 'on', true)`;
        await transaction.agencyMembership.update({
          where: { id: membership.id },
          data: { employeeId: null },
        });
        await transaction.employee.delete({ where: { id: employee.id } });
        await transaction.agencyMembership.delete({ where: { id: membership.id } });
        await transaction.agency.delete({ where: { id: agency.id } });
        await transaction.user.delete({ where: { id: user.id } });
      });
      await admin.$disconnect();
    }
  },
);
