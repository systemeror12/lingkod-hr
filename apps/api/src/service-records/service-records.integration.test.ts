import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { serviceRecordAuditWriter, ServiceRecordsService } from './service-records.service';

const enabled = process.env.DATABASE_E2E === 'true';

function context(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'service-record-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'personnel.service_records.read', scopePolicy: 'AGENCY' },
      { code: 'personnel.service_records.generate', scopePolicy: 'AGENCY' },
      { code: 'personnel.service_records.replace', scopePolicy: 'AGENCY' },
    ],
  };
}

it.skipIf(!enabled)(
  'reproduces dated history, preserves snapshots, replaces with evidence, and enforces RLS',
  async () => {
    const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!url) throw new Error('A database owner URL is required for the integration test.');
    const admin = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}-service-record`;
    let agencyId = '';
    let foreignAgencyId = '';
    let userId = '';
    let foreignUserId = '';

    try {
      const agency = await admin.agency.create({
        data: {
          code: `SR-${suffix}`,
          name: 'Service Record Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      agencyId = agency.id;
      const foreignAgency = await admin.agency.create({
        data: {
          code: `SR-F-${suffix}`,
          name: 'Foreign Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      foreignAgencyId = foreignAgency.id;
      const user = await admin.user.create({
        data: {
          emailNormalized: `service-record-${suffix}@example.test`,
          displayName: 'Service Record Generator',
          globalStatus: 'ACTIVE',
        },
      });
      userId = user.id;
      const foreignUser = await admin.user.create({
        data: {
          emailNormalized: `foreign-service-record-${suffix}@example.test`,
          displayName: 'Foreign User',
          globalStatus: 'ACTIVE',
        },
      });
      foreignUserId = foreignUser.id;
      const membership = await admin.agencyMembership.create({
        data: { agencyId, userId, status: 'ACTIVE' },
      });
      const foreignMembership = await admin.agencyMembership.create({
        data: { agencyId: foreignAgencyId, userId: foreignUserId, status: 'ACTIVE' },
      });
      const unit = await admin.organizationUnit.create({
        data: { agencyId, code: `UNIT-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
      });
      const unitVersion = await admin.organizationUnitVersion.create({
        data: {
          agencyId,
          organizationUnitId: unit.id,
          versionNo: 1,
          name: 'Personnel Division',
          effectiveFrom: new Date('2020-01-01'),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      await admin.organizationUnit.update({
        where: { id: unit.id },
        data: { currentVersionId: unitVersion.id },
      });
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-${suffix}`,
          legalName: 'Maria Santos',
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `maria-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      });
      await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId: membership.id,
          capabilities: ['employee-membership-link'],
        },
        (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId, id: membership.id } },
            data: { employeeId: employee.id },
          }),
      );
      const otherMembership = await admin.agencyMembership.create({
        data: { agencyId, userId: foreignUserId, status: 'ACTIVE' },
      });
      const evidenceDocument = await admin.document.create({
        data: {
          agencyId,
          documentNo: `CORR-${suffix}`,
          documentType: 'SERVICE_RECORD_SUPPORT',
          classification: 'CONFIDENTIAL',
          status: 'DRAFT',
          createdByMembershipId: membership.id,
        },
      });
      const evidenceVersion = await admin.documentVersion.create({
        data: {
          agencyId,
          documentId: evidenceDocument.id,
          versionNo: 1,
          storageKey: `service-record/${suffix}`,
          contentHash: 'b'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          createdByMembershipId: membership.id,
        },
      });
      await admin.document.update({
        where: { id: evidenceDocument.id },
        data: { currentVersionId: evidenceVersion.id, status: 'APPROVED' },
      });

      const serviceSegment = await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        (transaction) =>
          transaction.serviceSegment.create({
            data: {
              agencyId,
              employeeId: employee.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 18,
              salaryStep: 2,
              effectiveFrom: new Date('2020-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: membership.id,
            },
          }),
      );
      await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId: membership.id,
          capabilities: ['personnel-action-transition'],
        },
        async (transaction) => {
          const action = await transaction.personnelAction.create({
            data: {
              agencyId,
              employeeId: employee.id,
              actionType: 'STEP_INCREMENT',
              status: 'DRAFT',
              preparedByMembershipId: membership.id,
            },
          });
          const version = await transaction.personnelActionVersion.create({
            data: {
              agencyId,
              actionId: action.id,
              versionNo: 1,
              proposedEffectivity: new Date('2025-01-01'),
              fromServiceSegmentId: serviceSegment.id,
              targetFacts: { newSalaryStep: 2 },
              reason: 'Apply the approved step increment.',
              createdByMembershipId: membership.id,
            },
          });
          await transaction.personnelAction.update({
            where: { agencyId_id: { agencyId, id: action.id } },
            data: {
              currentVersionId: version.id,
              status: 'APPROVED',
              approvedByMembershipId: membership.id,
              approvedAt: new Date('2025-01-01'),
            },
          });
          await transaction.personnelAction.update({
            where: { agencyId_id: { agencyId, id: action.id } },
            data: {
              status: 'EFFECTIVE',
              effectuatedByMembershipId: membership.id,
              effectuatedAt: new Date('2025-01-01'),
              effectuationKey: `service-record-${suffix}`,
            },
          });
        },
      );

      const documentsService = new DocumentsService({} as never, documentAuditWriter);
      const service = new ServiceRecordsService(serviceRecordAuditWriter, documentsService);
      const requestContext = context(agencyId, userId, membership.id);
      const original = await service.generate(requestContext, {
        employeeId: employee.id,
        asOfDate: '2026-09-05',
      });
      expect(original.snapshot).toMatchObject({
        label: 'Printable System View',
        employee: { id: employee.id },
        serviceSegments: [{ id: serviceSegment.id, salaryStep: 2 }],
        personnelActions: [{ actionType: 'STEP_INCREMENT' }],
      });
      const ownContext = {
        ...requestContext,
        permissions: [{ code: 'personnel.service_records.read', scopePolicy: 'OWN' as const }],
      };
      await expect(service.list(ownContext)).resolves.toMatchObject({
        records: [{ id: original.id }],
        nextCursor: null,
      });
      await expect(service.findById(ownContext, original.id)).resolves.toMatchObject({
        id: original.id,
      });
      await expect(
        service.findById(
          { ...ownContext, userId: foreignUserId, membershipId: otherMembership.id },
          original.id,
        ),
      ).rejects.toMatchObject({ code: 'SERVICE_RECORD_READ_FORBIDDEN' });

      await expect(
        admin.serviceRecordSnapshot.update({
          where: { id: original.id },
          data: { renderingContractVersion: 'changed' },
        }),
      ).rejects.toThrow(/immutable/);

      const correctedSegment = await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => {
          await transaction.serviceSegment.update({
            where: { agencyId_id: { agencyId, id: serviceSegment.id } },
            data: { status: 'VOIDED' },
          });
          return transaction.serviceSegment.create({
            data: {
              agencyId,
              employeeId: employee.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 18,
              salaryStep: 3,
              effectiveFrom: new Date('2020-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: membership.id,
            },
          });
        },
      );

      const replacement = await service.replace(requestContext, original.id, {
        reason: 'Regenerate from the corrected retained source history.',
        evidenceDocumentId: evidenceDocument.id,
        evidenceDocumentVersionId: evidenceVersion.id,
      });
      expect(replacement).toMatchObject({
        supersedesSnapshotId: original.id,
        correctionReason: 'Regenerate from the corrected retained source history.',
        snapshot: { serviceSegments: [{ id: correctedSegment.id, salaryStep: 3 }] },
      });
      const firstPage = await service.list(requestContext, { limit: 1 });
      expect(firstPage).toMatchObject({ records: [{ id: replacement.id }] });
      expect(firstPage.nextCursor).toBe(replacement.id);
      await expect(
        service.list(requestContext, { limit: 1, cursor: firstPage.nextCursor ?? undefined }),
      ).resolves.toMatchObject({ records: [{ id: original.id }], nextCursor: null });
      await expect(service.findById(requestContext, original.id)).resolves.toMatchObject({
        snapshot: { serviceSegments: [{ salaryStep: 2 }] },
        replacementSnapshotId: replacement.id,
      });

      const foreignContext = context(foreignAgencyId, foreignUserId, foreignMembership.id);
      await expect(
        withDatabaseContext(
          { agencyId: foreignAgencyId, userId: foreignUserId, membershipId: foreignMembership.id },
          (transaction) =>
            transaction.serviceRecordSnapshot.findUnique({ where: { id: original.id } }),
        ),
      ).resolves.toBeNull();
      await expect(
        withDatabaseContext(
          {
            agencyId: foreignAgencyId,
            userId: foreignUserId,
            membershipId: foreignMembership.id,
            capabilities: ['service-record-transition'],
          },
          (transaction) =>
            transaction.serviceRecordSnapshot.create({
              data: {
                agencyId: foreignAgencyId,
                employeeId: employee.id,
                asOfDate: new Date('2026-09-05'),
                renderingContractVersion: 'service-record-printable-v1',
                snapshot: original.snapshot as unknown as Prisma.InputJsonValue,
                generatedByMembershipId: foreignMembership.id,
              },
            }),
        ),
      ).rejects.toThrow();
      await expect(
        service.generate(foreignContext, { employeeId: employee.id, asOfDate: '2026-09-05' }),
      ).rejects.toMatchObject({ code: 'SERVICE_RECORD_EMPLOYEE_NOT_FOUND' });
      await expect(service.findById(foreignContext, original.id)).resolves.toBeNull();

      const audit = await admin.auditEvent.findMany({
        where: { agencyId, entityType: 'ServiceRecordSnapshot' },
      });
      expect(audit.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'SERVICE_RECORD_GENERATED',
          'SERVICE_RECORD_REPLACED',
          'SERVICE_RECORD_ACCESSED',
        ]),
      );
    } finally {
      if (agencyId) {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await transaction.organizationUnit.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.document.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.agencyMembership.updateMany({
            where: { agencyId },
            data: { employeeId: null },
          });
          await transaction.auditEvent.deleteMany({ where: { agencyId } });
          await transaction.serviceRecordSnapshot.deleteMany({ where: { agencyId } });
          await transaction.personnelActionVersion.deleteMany({ where: { agencyId } });
          await transaction.personnelAction.deleteMany({ where: { agencyId } });
          await transaction.serviceSegment.deleteMany({ where: { agencyId } });
          await transaction.documentVersion.deleteMany({ where: { agencyId } });
          await transaction.document.deleteMany({ where: { agencyId } });
          await transaction.employee.deleteMany({ where: { agencyId } });
          await transaction.organizationUnitVersion.deleteMany({ where: { agencyId } });
          await transaction.organizationUnit.deleteMany({ where: { agencyId } });
        });
      }
      if (agencyId) await admin.agencyMembership.deleteMany({ where: { agencyId } });
      if (foreignAgencyId)
        await admin.agencyMembership.deleteMany({ where: { agencyId: foreignAgencyId } });
      if (agencyId) await admin.agency.delete({ where: { id: agencyId } });
      if (foreignAgencyId) await admin.agency.delete({ where: { id: foreignAgencyId } });
      if (userId) await admin.user.delete({ where: { id: userId } });
      if (foreignUserId) await admin.user.delete({ where: { id: foreignUserId } });
      await admin.$disconnect();
    }
  },
);
