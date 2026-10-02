import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from '../plantilla-positions/plantilla-positions.service';
import {
  personnelBaselineAuditWriter,
  PersonnelBaselinesService,
  type PersonnelBaselineInput,
} from './personnel-baselines.service';

const enabled = process.env.DATABASE_E2E === 'true';

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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'personnel-baseline-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'personnel.baselines.read', scopePolicy: 'AGENCY' },
      { code: 'personnel.baselines.prepare', scopePolicy: 'AGENCY' },
      { code: 'personnel.baselines.review', scopePolicy: 'AGENCY' },
      { code: 'personnel.baselines.effectuate', scopePolicy: 'AGENCY' },
      { code: 'personnel.baselines.audit.read', scopePolicy: 'AGENCY' },
      { code: 'personnel.baselines.correct', scopePolicy: 'AGENCY' },
      { code: 'personnel.employees.read', scopePolicy: 'AGENCY' },
      { code: 'positions.items.read', scopePolicy: 'AGENCY' },
      { code: 'positions.items.create', scopePolicy: 'AGENCY' },
      { code: 'positions.items.update', scopePolicy: 'AGENCY' },
      { code: 'positions.items.authorize', scopePolicy: 'AGENCY' },
      { code: 'positions.items.declare_vacant', scopePolicy: 'AGENCY' },
      { code: 'organization.units.read', scopePolicy: 'AGENCY' },
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
  documentNo: string,
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentNo,
      documentType: 'PERSONNEL_BASELINE_AUTHORITY',
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
      storageKey: `integration/${documentNo}`,
      contentHash: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id, status: 'APPROVED' },
  });
  return { documentId: document.id, versionId: version.id };
}

async function createVacantPosition(
  service: PlantillaPositionsService,
  context: RequestContext,
  input: {
    itemNumber: string;
    organizationUnitId: string;
    qualificationStandardVersionId: string;
    staffingAuthorityId: string;
    evidenceDocumentId: string;
    proposedDate: string;
    authorizedDate: string;
    vacantDate: string;
  },
): Promise<{ id: string; vacantDate: string }> {
  const position = await service.create(context, {
    itemNumber: input.itemNumber,
    title: 'Human Resource Management Officer III',
    parentheticalTitle: 'Personnel Records',
    salaryGrade: 18,
    organizationUnitId: input.organizationUnitId,
    fundingSource: 'General Appropriations Act',
    employmentCategory: 'PLANTILLA',
    qualificationStandardVersionId: input.qualificationStandardVersionId,
    staffingAuthorityId: input.staffingAuthorityId,
    effectiveDate: input.proposedDate,
  });
  await service.linkEvidence(context, position.id, {
    documentId: input.evidenceDocumentId,
    purpose: 'CREATION',
    effectiveDate: input.proposedDate,
  });
  await service.authorize(context, position.id, {
    effectiveDate: input.authorizedDate,
    reason: 'The authorized staffing record supports this baseline position.',
  });
  await service.declareVacant(context, position.id, {
    effectiveDate: input.vacantDate,
    reason: 'The position is vacant for initial personnel baseline adoption.',
  });
  return { id: position.id, vacantDate: input.vacantDate };
}

it.skipIf(!enabled)(
  'effectuates an evidence-backed baseline atomically and rolls back owner-transition failures',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-personnel-baseline`;
    let agencyId = '';
    let userId = '';
    let membershipId = '';

    try {
      const agency = await admin.agency.create({
        data: {
          code: `BASELINE-${suffix}`,
          name: 'Personnel Baseline Integration Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      agencyId = agency.id;
      const user = await admin.user.create({
        data: {
          emailNormalized: `personnel-baseline-${suffix}@example.test`,
          displayName: 'Personnel Baseline Integration User',
          globalStatus: 'ACTIVE',
        },
      });
      userId = user.id;
      const membership = await admin.agencyMembership.create({
        data: { agencyId, userId, status: 'ACTIVE' },
      });
      membershipId = membership.id;
      const context = createContext(agencyId, userId, membershipId);
      const documentsService = new DocumentsService({} as never, documentAuditWriter);
      const plantillaPositionsService = new PlantillaPositionsService(
        plantillaPositionAuditWriter,
        documentsService,
      );
      const service = new PersonnelBaselinesService(
        personnelBaselineAuditWriter,
        documentsService,
        plantillaPositionsService,
      );

      const organizationUnit = await admin.organizationUnit.create({
        data: {
          agencyId,
          code: `HRM-${suffix}`,
          unitType: 'DIVISION',
          status: 'ACTIVE',
        },
      });
      const organizationUnitVersion = await admin.organizationUnitVersion.create({
        data: {
          agencyId,
          organizationUnitId: organizationUnit.id,
          versionNo: 1,
          name: 'Human Resource Management Division',
          effectiveFrom: new Date(manilaDate(-30)),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      await admin.organizationUnit.update({
        where: { id: organizationUnit.id },
        data: { currentVersionId: organizationUnitVersion.id },
      });

      const sourceEvidence = await createEvidence(
        admin,
        agencyId,
        membershipId,
        `BASELINE-${suffix}-QS-SOURCE`,
      );
      const approvalEvidence = await createEvidence(
        admin,
        agencyId,
        membershipId,
        `BASELINE-${suffix}-QS-APPROVAL`,
      );
      const authorityEvidence = await createEvidence(
        admin,
        agencyId,
        membershipId,
        `BASELINE-${suffix}-AUTHORITY`,
      );
      const qualificationStandard = await withDatabaseContext(
        {
          agencyId,
          userId,
          membershipId,
          capabilities: ['qualification-standard-transition'],
        },
        async (transaction) => {
          const standard = await transaction.qualificationStandard.create({
            data: {
              agencyId,
              code: `QS-${suffix}`,
              name: 'Personnel Baseline Integration Standard',
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
              updatedByMembershipId: membershipId,
            },
          });
          const version = await transaction.qualificationStandardVersion.create({
            data: {
              agencyId,
              qualificationStandardId: standard.id,
              versionNo: 1,
              educationRequirement: 'Bachelor degree',
              eligibilityRequirement: 'Career service',
              sourceDocumentId: sourceEvidence.documentId,
              sourceEvidenceVersionId: sourceEvidence.versionId,
              sourceEvidenceValidatedAt: new Date(),
              sourceEvidenceValidatedByMembershipId: membershipId,
              sourceEvidenceValidationReason: 'The source qualification evidence was reviewed.',
              approvalDocumentId: approvalEvidence.documentId,
              approvalEvidenceVersionId: approvalEvidence.versionId,
              approvalEvidenceValidatedAt: new Date(),
              approvalEvidenceValidatedByMembershipId: membershipId,
              approvalEvidenceValidationReason:
                'The approving qualification evidence was reviewed.',
              effectiveFrom: new Date(manilaDate(-30)),
              status: 'ACTIVE',
              domainStatus: 'ACTIVE',
              createdByMembershipId: membershipId,
              updatedByMembershipId: membershipId,
            },
          });
          await transaction.qualificationStandard.update({
            where: { id: standard.id },
            data: { currentVersionId: version.id },
          });
          return { id: standard.id, versionId: version.id };
        },
      );
      const staffingAuthority = await withDatabaseContext(
        { agencyId, userId, membershipId, capabilities: ['staffing-authority-transition'] },
        (transaction) =>
          transaction.staffingAuthority.create({
            data: {
              agencyId,
              authorityType: 'DBM_APPROVAL',
              referenceNo: `AUTH-${suffix}`,
              issuedDate: new Date(manilaDate(-30)),
              effectiveDate: new Date(manilaDate(-30)),
              documentId: authorityEvidence.documentId,
              evidenceVersionId: authorityEvidence.versionId,
              evidenceValidatedAt: new Date(),
              evidenceValidatedByMembershipId: membershipId,
              evidenceValidationReason: 'The staffing authority evidence was reviewed.',
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
              updatedByMembershipId: membershipId,
            },
          }),
      );

      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-${suffix}`,
          legalName: 'Mara Villanueva Santos',
          birthDate: new Date('1994-05-12'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `mara-${suffix}@example.test`,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const proposedDate = manilaDate(-12);
      const authorizedDate = addDays(proposedDate, 1);
      const vacantDate = addDays(proposedDate, 2);
      const position = await createVacantPosition(plantillaPositionsService, context, {
        itemNumber: `ITEM-${suffix}`,
        organizationUnitId: organizationUnit.id,
        qualificationStandardVersionId: qualificationStandard.versionId,
        staffingAuthorityId: staffingAuthority.id,
        evidenceDocumentId: authorityEvidence.documentId,
        proposedDate,
        authorizedDate,
        vacantDate,
      });
      const input: PersonnelBaselineInput = {
        employeeId: employee.id,
        authorityDocumentId: authorityEvidence.documentId,
        authorityEvidenceVersionId: authorityEvidence.versionId,
        firstGovernmentServiceDate: manilaDate(-20),
        agencyServiceStartDate: addDays(vacantDate, 1),
        organizationUnitId: organizationUnit.id,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 18,
        salaryStep: 3,
        positionId: position.id,
        reason: 'Adopt the verified existing personnel record without issuing an Appointment.',
      };

      const prepared = await service.create(context, input);
      expect(prepared).toMatchObject({
        status: 'DRAFT',
        employee: { serviceStatus: 'PREBOARDING' },
      });
      await service.submit(context, prepared.id);
      await service.review(context, prepared.id, {
        decision: 'APPROVE',
        reason: 'The baseline evidence and effective-dated references were reviewed.',
      });
      const effective = await service.effectuate(context, prepared.id, 'baseline-effectuate');
      expect(effective).toMatchObject({
        status: 'EFFECTIVE',
        employee: { serviceStatus: 'ACTIVE' },
        serviceSegment: {
          positionId: position.id,
          appointmentStatus: 'PERMANENT',
          salaryGrade: 18,
          salaryStep: 3,
          status: 'ACTIVE',
        },
        positionIncumbency: {
          positionId: position.id,
          employeeId: employee.id,
          status: 'ACTIVE',
        },
      });
      await expect(
        service.effectuate(context, prepared.id, 'baseline-effectuate'),
      ).resolves.toMatchObject({
        id: prepared.id,
        status: 'EFFECTIVE',
      });
      await expect(
        admin.serviceSegment.count({ where: { agencyId, employeeId: employee.id } }),
      ).resolves.toBe(1);
      await expect(
        admin.positionIncumbency.count({ where: { agencyId, positionId: position.id } }),
      ).resolves.toBe(1);
      await expect(
        admin.outboxEvent.count({
          where: {
            agencyId,
            aggregateId: prepared.id,
            eventType: 'PERSONNEL_BASELINE_EFFECTUATED',
          },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.plantillaPositionVersion.findFirst({
          where: { agencyId, positionId: position.id, domainStatus: 'OCCUPIED' },
        }),
      ).resolves.toBeTruthy();
      const history = await service.history(context, prepared.id);
      expect(history?.entries.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'PERSONNEL_BASELINE_PREPARED',
          'PERSONNEL_BASELINE_SUBMITTED',
          'PERSONNEL_BASELINE_REVIEWED',
          'PERSONNEL_BASELINE_EFFECTUATED',
        ]),
      );

      await expect(
        service.correct(context, prepared.id, {
          ...input,
          agencyServiceStartDate: addDays(input.agencyServiceStartDate, 1),
          reason: 'Attempt to move the corrected service start date.',
        }),
      ).rejects.toMatchObject({
        code: 'PERSONNEL_BASELINE_CORRECTION_SERVICE_START_UNSUPPORTED',
      });

      const historicalEmployee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-HISTORICAL-${suffix}`,
          legalName: 'Historical Position Employee',
          birthDate: new Date('1990-05-12'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `historical-${suffix}@example.test`,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      await expect(
        service.create(context, {
          ...input,
          employeeId: historicalEmployee.id,
          agencyServiceStartDate: position.vacantDate,
          reason: 'Attempt to use a historical vacant version of an occupied position.',
        }),
      ).rejects.toMatchObject({ code: 'PERSONNEL_BASELINE_POSITION_INELIGIBLE' });

      const concurrentEmployee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-CONCURRENT-${suffix}`,
          legalName: 'Concurrent Baseline Employee',
          birthDate: new Date('1991-05-12'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `concurrent-${suffix}@example.test`,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const concurrentPosition = await createVacantPosition(plantillaPositionsService, context, {
        itemNumber: `CONCURRENT-${suffix}`,
        organizationUnitId: organizationUnit.id,
        qualificationStandardVersionId: qualificationStandard.versionId,
        staffingAuthorityId: staffingAuthority.id,
        evidenceDocumentId: authorityEvidence.documentId,
        proposedDate,
        authorizedDate,
        vacantDate,
      });
      const concurrentBaselineInput = {
        ...input,
        employeeId: concurrentEmployee.id,
        positionId: concurrentPosition.id,
        firstGovernmentServiceDate: manilaDate(-18),
      } satisfies PersonnelBaselineInput;
      const concurrentBaselineA = await service.create(context, {
        ...concurrentBaselineInput,
        agencyServiceStartDate: addDays(concurrentPosition.vacantDate, 1),
        reason: 'The first concurrent baseline is approved for serialization coverage.',
      });
      const concurrentBaselineB = await service.create(context, {
        ...concurrentBaselineInput,
        agencyServiceStartDate: addDays(concurrentPosition.vacantDate, 2),
        reason: 'The second concurrent baseline must not create a conflicting service fact.',
      });
      for (const baseline of [concurrentBaselineA, concurrentBaselineB]) {
        await service.submit(context, baseline.id);
        await service.review(context, baseline.id, {
          decision: 'APPROVE',
          reason: 'The concurrent baseline is approved for transaction serialization coverage.',
        });
      }
      const concurrentResults = await Promise.allSettled([
        service.effectuate(context, concurrentBaselineA.id, 'concurrent-effectuate-a'),
        service.effectuate(context, concurrentBaselineB.id, 'concurrent-effectuate-b'),
      ]);
      expect(concurrentResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const concurrentFailure = concurrentResults.find((result) => result.status === 'rejected');
      expect(concurrentFailure?.status).toBe('rejected');
      if (!concurrentFailure || concurrentFailure.status !== 'rejected') {
        throw new Error('Expected one concurrent Personnel Baseline effectuation to fail.');
      }
      expect(concurrentFailure.reason).toMatchObject({
        code: 'PERSONNEL_BASELINE_EMPLOYEE_STATUS_INVALID',
      });
      await expect(
        admin.serviceSegment.count({ where: { agencyId, employeeId: concurrentEmployee.id } }),
      ).resolves.toBe(1);
      await expect(
        admin.positionIncumbency.count({
          where: { agencyId, positionId: concurrentPosition.id },
        }),
      ).resolves.toBe(1);

      const rollbackEmployee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-ROLLBACK-${suffix}`,
          legalName: 'Rollback Baseline Employee',
          birthDate: new Date('1992-05-12'),
          sex: 'MALE',
          civilStatus: 'SINGLE',
          contactEmail: `rollback-${suffix}@example.test`,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const rollbackPosition = await createVacantPosition(plantillaPositionsService, context, {
        itemNumber: `ROLLBACK-${suffix}`,
        organizationUnitId: organizationUnit.id,
        qualificationStandardVersionId: qualificationStandard.versionId,
        staffingAuthorityId: staffingAuthority.id,
        evidenceDocumentId: authorityEvidence.documentId,
        proposedDate,
        authorizedDate,
        vacantDate,
      });
      const rollbackInput: PersonnelBaselineInput = {
        ...input,
        employeeId: rollbackEmployee.id,
        positionId: rollbackPosition.id,
        firstGovernmentServiceDate: manilaDate(-18),
        agencyServiceStartDate: vacantDate,
        reason: 'Exercise transaction rollback when the owner rejects an invalid transition date.',
      };
      const rollbackBaseline = await service.create(context, rollbackInput);
      await service.submit(context, rollbackBaseline.id);
      await service.review(context, rollbackBaseline.id, {
        decision: 'APPROVE',
        reason: 'The rollback case is approved before effectuation.',
      });
      await expect(
        service.effectuate(context, rollbackBaseline.id, 'rollback-effectuate'),
      ).rejects.toMatchObject({
        code: 'PLANTILLA_POSITION_TRANSITION_DATE_INVALID',
      });
      await expect(
        admin.serviceSegment.count({ where: { agencyId, employeeId: rollbackEmployee.id } }),
      ).resolves.toBe(0);
      await expect(
        admin.positionIncumbency.count({ where: { agencyId, positionId: rollbackPosition.id } }),
      ).resolves.toBe(0);
      await expect(
        admin.personnelBaseline.findUnique({
          where: { agencyId_id: { agencyId, id: rollbackBaseline.id } },
        }),
      ).resolves.toMatchObject({ status: 'APPROVED', serviceSegmentId: null });
      await expect(
        admin.employee.findUnique({
          where: { agencyId_id: { agencyId, id: rollbackEmployee.id } },
        }),
      ).resolves.toMatchObject({ serviceStatus: 'PREBOARDING', currentServiceSegmentId: null });
    } finally {
      if (agencyId) {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await transaction.organizationUnit.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.qualificationStandard.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.plantillaPosition.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.employee.updateMany({
            where: { agencyId },
            data: { currentServiceSegmentId: null },
          });
          await transaction.auditEvent.deleteMany({ where: { agencyId } });
          await transaction.outboxEvent.deleteMany({ where: { agencyId } });
          await transaction.personnelBaseline.deleteMany({ where: { agencyId } });
          await transaction.positionIncumbency.deleteMany({ where: { agencyId } });
          await transaction.serviceSegment.deleteMany({ where: { agencyId } });
          await transaction.employee.deleteMany({ where: { agencyId } });
          await transaction.positionDocument.deleteMany({ where: { agencyId } });
          await transaction.plantillaPositionVersion.deleteMany({ where: { agencyId } });
          await transaction.plantillaPosition.deleteMany({ where: { agencyId } });
          await transaction.staffingAuthority.deleteMany({ where: { agencyId } });
          await transaction.qualificationStandardVersion.deleteMany({ where: { agencyId } });
          await transaction.qualificationStandard.deleteMany({ where: { agencyId } });
          await transaction.organizationUnitVersion.deleteMany({ where: { agencyId } });
          await transaction.organizationUnit.deleteMany({ where: { agencyId } });
          await transaction.documentVersion.deleteMany({ where: { agencyId } });
          await transaction.document.deleteMany({ where: { agencyId } });
        });
        await admin.agencyMembership.deleteMany({ where: { agencyId } });
        await admin.agency.delete({ where: { id: agencyId } });
      }
      if (userId) await admin.user.delete({ where: { id: userId } });
      await admin.$disconnect();
    }
  },
);
