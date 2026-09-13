import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { AuthService } from '../auth/auth.service';
import { AppointmentReadModel, AppointmentsService } from '../appointments/appointments.service';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from '../plantilla-positions/plantilla-positions.service';
import { separationAuditWriter, SeparationsService } from '../separations/separations.service';
import type {
  PersonnelActionEvidenceInput,
  PersonnelActionInput,
} from './personnel-actions.schemas';
import {
  personnelActionAuditWriter,
  personnelActionCanBeEffectuated,
  PersonnelActionsService,
} from './personnel-actions.service';

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

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: string[],
): RequestContext {
  return {
    requestId: `personnel-action-${membershipId}`,
    agencyId,
    userId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions: permissions.map((code) => ({ code, scopePolicy: 'AGENCY' })),
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

async function createActor(admin: PrismaClient, agencyId: string, suffix: string, name: string) {
  const user = await admin.user.create({
    data: {
      identityProvider: 'personnel-action-integration',
      externalSubject: `${name}-${suffix}`,
      emailNormalized: `${name}-${suffix}@example.test`,
      displayName: name,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId, userId: user.id, status: 'ACTIVE' },
  });
  return { userId: user.id, membershipId: membership.id };
}

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  evidenceType: PersonnelActionEvidenceInput['evidenceType'],
  signatureMetadata?: Prisma.InputJsonObject,
): Promise<PersonnelActionEvidenceInput> {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentNo: `${evidenceType}-${suffix}`,
      documentType: evidenceType,
      classification: 'INTERNAL',
      status: 'DRAFT',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `personnel-action/${suffix}/${evidenceType}`,
      contentHash: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
      ...(signatureMetadata ? { signatureMetadata } : {}),
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id, status: 'APPROVED' },
  });
  return {
    evidenceType,
    documentId: document.id,
    documentVersionId: version.id,
    sourceDate: manilaDate(-5),
  };
}

it.skipIf(!enabled)(
  'preserves returned history and approves an exact version through effective delegation',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}`;
    let agencyId = '';
    const userIds: string[] = [];

    try {
      const agency = await admin.agency.create({
        data: {
          code: `ACTION-${suffix}`,
          name: 'Personnel Action Integration Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      agencyId = agency.id;
      const preparer = await createActor(admin, agencyId, suffix, 'preparer');
      const reviewer = await createActor(admin, agencyId, suffix, 'reviewer');
      const appointingAuthority = await createActor(admin, agencyId, suffix, 'authority');
      const delegate = await createActor(admin, agencyId, suffix, 'delegate');
      userIds.push(preparer.userId, reviewer.userId, appointingAuthority.userId, delegate.userId);

      const unit = await admin.organizationUnit.create({
        data: { agencyId, code: `HR-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
      });
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `EMP-${suffix}`,
          legalName: 'Maria Santos',
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `employee-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          firstGovernmentServiceDate: new Date(manilaDate(-1000)),
          agencyServiceStartDate: new Date(manilaDate(-900)),
          createdByMembershipId: preparer.membershipId,
          updatedByMembershipId: preparer.membershipId,
        },
      });
      const serviceSegment = await withDatabaseContext(
        {
          agencyId,
          userId: preparer.userId,
          membershipId: preparer.membershipId,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => {
          const segment = await transaction.serviceSegment.create({
            data: {
              agencyId,
              employeeId: employee.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 12,
              salaryStep: 2,
              effectiveFrom: new Date(manilaDate(-900)),
              status: 'ACTIVE',
              createdByMembershipId: preparer.membershipId,
            },
          });
          await transaction.employee.update({
            where: { agencyId_id: { agencyId, id: employee.id } },
            data: { currentServiceSegmentId: segment.id },
          });
          return segment;
        },
      );

      const evidence = await Promise.all(
        (
          [
            'NOSI',
            'CURRENT_COMPENSATION',
            'PERFORMANCE_OR_SERVICE',
            'SERVICE_CONTINUITY',
            'AUTHORITY',
          ] as const
        ).map((type) => createEvidence(admin, agencyId, preparer.membershipId, suffix, type)),
      );
      const authorityEvidence = evidence.find(({ evidenceType }) => evidenceType === 'AUTHORITY');
      if (!authorityEvidence) throw new Error('Authority evidence fixture is missing.');

      const position = await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const standard = await transaction.qualificationStandard.create({
          data: {
            agencyId,
            code: `QS-${suffix}`,
            name: 'Compensation action qualification standard',
            status: 'ACTIVE',
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        const standardVersion = await transaction.qualificationStandardVersion.create({
          data: {
            agencyId,
            qualificationStandardId: standard.id,
            versionNo: 1,
            educationRequirement: 'Bachelor degree',
            eligibilityRequirement: 'Career service',
            sourceDocumentId: authorityEvidence.documentId,
            sourceEvidenceVersionId: authorityEvidence.documentVersionId,
            sourceEvidenceValidatedAt: new Date(manilaDate(-5)),
            sourceEvidenceValidatedByMembershipId: preparer.membershipId,
            sourceEvidenceValidationReason: 'Validated the qualification source.',
            approvalDocumentId: authorityEvidence.documentId,
            approvalEvidenceVersionId: authorityEvidence.documentVersionId,
            approvalEvidenceValidatedAt: new Date(manilaDate(-5)),
            approvalEvidenceValidatedByMembershipId: preparer.membershipId,
            approvalEvidenceValidationReason: 'Validated the qualification approval.',
            effectiveFrom: new Date(manilaDate(-1000)),
            status: 'ACTIVE',
            domainStatus: 'ACTIVE',
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        await transaction.qualificationStandard.update({
          where: { id: standard.id },
          data: { currentVersionId: standardVersion.id },
        });
        const staffingAuthority = await transaction.staffingAuthority.create({
          data: {
            agencyId,
            authorityType: 'DBM_APPROVAL',
            referenceNo: `AUTH-${suffix}`,
            issuedDate: new Date(manilaDate(-1000)),
            effectiveDate: new Date(manilaDate(-1000)),
            documentId: authorityEvidence.documentId,
            evidenceVersionId: authorityEvidence.documentVersionId,
            evidenceValidatedAt: new Date(manilaDate(-5)),
            evidenceValidatedByMembershipId: preparer.membershipId,
            evidenceValidationReason: 'Validated the staffing authority.',
            status: 'ACTIVE',
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        const item = await transaction.plantillaPosition.create({
          data: {
            agencyId,
            itemNumber: `ITEM-${suffix}`,
            status: 'OCCUPIED',
            createdFromAuthorityId: staffingAuthority.id,
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        const oldVersion = await transaction.plantillaPositionVersion.create({
          data: {
            agencyId,
            positionId: item.id,
            organizationUnitId: unit.id,
            qualificationStandardVersionId: standardVersion.id,
            staffingAuthorityId: staffingAuthority.id,
            versionNo: 1,
            positionTitle: 'Administrative Officer',
            salaryGrade: 12,
            fundingSource: 'General Appropriations Act',
            employmentCategory: 'PLANTILLA',
            effectiveFrom: new Date(manilaDate(-900)),
            effectiveTo: new Date(manilaDate(-1)),
            status: 'ACTIVE',
            domainStatus: 'OCCUPIED',
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        const currentVersion = await transaction.plantillaPositionVersion.create({
          data: {
            agencyId,
            positionId: item.id,
            organizationUnitId: unit.id,
            qualificationStandardVersionId: standardVersion.id,
            staffingAuthorityId: staffingAuthority.id,
            versionNo: 2,
            positionTitle: 'Administrative Officer',
            salaryGrade: 13,
            fundingSource: 'General Appropriations Act',
            employmentCategory: 'PLANTILLA',
            effectiveFrom: new Date(manilaDate()),
            status: 'ACTIVE',
            domainStatus: 'OCCUPIED',
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        await transaction.plantillaPosition.update({
          where: { id: item.id },
          data: { currentVersionId: currentVersion.id },
        });
        await transaction.serviceSegment.update({
          where: { id: serviceSegment.id },
          data: { positionId: item.id },
        });
        return { id: item.id, oldVersionId: oldVersion.id, currentVersionId: currentVersion.id };
      });

      const role = await admin.role.findFirstOrThrow({ where: { code: 'appointing_authority' } });
      await admin.membershipRole.create({
        data: {
          agencyId,
          membershipId: appointingAuthority.membershipId,
          roleId: role.id,
          effectiveFrom: new Date(manilaDate(-30)),
          assignedByMembershipId: appointingAuthority.membershipId,
          reason: 'Exercise appointing authority in the Personnel Action integration test.',
        },
      });
      const delegation = await admin.delegatedAuthority.create({
        data: {
          agencyId,
          delegatorMembershipId: appointingAuthority.membershipId,
          delegateMembershipId: delegate.membershipId,
          permissionCode: 'personnel.actions.approve',
          organizationUnitId: unit.id,
          effectiveFrom: new Date(manilaDate(-10)),
          effectiveTo: new Date(`${manilaDate(60)}T23:59:59.000Z`),
          status: 'ACTIVE',
          authorityDocumentId: authorityEvidence.documentId,
        },
      });

      const documentsService = new DocumentsService({} as never, documentAuditWriter);
      const plantillaPositionsService = new PlantillaPositionsService(
        plantillaPositionAuditWriter,
        documentsService,
      );
      const appointmentReadModel = new AppointmentReadModel({} as never, plantillaPositionsService);
      const service = new PersonnelActionsService(
        personnelActionAuditWriter,
        documentsService,
        plantillaPositionsService,
        new AuthService(),
        new SeparationsService(separationAuditWriter),
        new AppointmentsService(
          documentsService,
          plantillaPositionsService,
          {} as never,
          {} as never,
          appointmentReadModel,
        ),
      );
      const preparerContext = context(agencyId, preparer.userId, preparer.membershipId, [
        'personnel.actions.read',
        'personnel.actions.create',
        'personnel.actions.correct',
        'personnel.actions.submit',
        'personnel.actions.audit.read',
        'personnel.actions.effectuate',
        'documents.evidence.read',
      ]);
      const reviewerContext = context(agencyId, reviewer.userId, reviewer.membershipId, [
        'personnel.actions.read',
        'personnel.actions.return',
        'personnel.actions.endorse',
        'documents.evidence.read',
      ]);
      const delegateContext = context(agencyId, delegate.userId, delegate.membershipId, [
        'personnel.actions.read',
        'documents.evidence.read',
      ]);
      const proposedEffectivity = manilaDate(-1);
      const baseInput = {
        employeeId: employee.id,
        actionType: 'STEP_INCREMENT' as const,
        proposedEffectivity,
        targetFacts: { newSalaryStep: 3 },
        reason: 'Apply the signed Notice of Step Increment on its stated date.',
      };

      const prepared = await service.create(preparerContext, {
        ...baseInput,
        evidence: evidence.slice(0, 1),
      });
      await expect(service.submit(preparerContext, prepared.id)).rejects.toMatchObject({
        code: 'PERSONNEL_ACTION_EVIDENCE_INCOMPLETE',
      });
      const complete = await service.updateDraft(preparerContext, prepared.id, {
        ...baseInput,
        evidence,
      });
      await service.submit(preparerContext, prepared.id);
      await service.review(reviewerContext, prepared.id, {
        decision: 'RETURN',
        reason: 'Clarify the service-continuity certification period.',
      });
      const revised = await service.updateDraft(
        preparerContext,
        prepared.id,
        { ...baseInput, evidence, reason: 'Clarified continuity certification; apply the NOSI.' },
        complete.rowVersion + 2,
      );
      expect(revised.currentVersion.versionNo).toBe(3);
      await service.submit(preparerContext, prepared.id);
      await service.review(reviewerContext, prepared.id, {
        decision: 'ENDORSE',
        reason: 'The exact evidence package is complete and internally consistent.',
      });
      await expect(service.authority(delegateContext, prepared.id)).resolves.toMatchObject({
        canApprove: true,
        canReject: false,
      });
      const replacementAuthorityVersion = await admin.documentVersion.create({
        data: {
          agencyId,
          documentId: authorityEvidence.documentId,
          versionNo: 2,
          storageKey: `personnel-action/${suffix}/AUTHORITY-2`,
          contentHash: 'b'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          issuedAt: new Date(`${manilaDate(-4)}T00:00:00.000Z`),
          createdByMembershipId: preparer.membershipId,
        },
      });
      await admin.document.update({
        where: { id: authorityEvidence.documentId },
        data: { currentVersionId: replacementAuthorityVersion.id },
      });
      await expect(service.authority(delegateContext, prepared.id)).resolves.toMatchObject({
        canApprove: false,
      });
      await expect(
        service.decide(delegateContext, prepared.id, {
          decision: 'APPROVE',
          reason: 'Attempted approval under an unpinned delegation version.',
        }),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_AUTHORITY_REQUIRED' });
      await admin.document.update({
        where: { id: authorityEvidence.documentId },
        data: { currentVersionId: authorityEvidence.documentVersionId },
      });
      await expect(
        service.decide(preparerContext, prepared.id, {
          decision: 'APPROVE',
          reason: 'Attempted self-approval.',
        }),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_SEGREGATION_REQUIRED' });
      const approved = await service.decide(delegateContext, prepared.id, {
        decision: 'APPROVE',
        reason: 'Approved under the documented, effective delegation.',
      });
      expect(approved).toMatchObject({
        status: 'APPROVED',
        approvalDelegationId: delegation.id,
        currentVersion: { versionNo: 3, fromServiceSegment: { id: serviceSegment.id } },
      });
      await expect(
        service.effectuate(
          context(agencyId, preparer.userId, preparer.membershipId, [
            'personnel.actions.effectuate',
          ]),
          approved.id,
        ),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_EVIDENCE_READ_FORBIDDEN' });
      const duplicate = await service.create(preparerContext, {
        ...baseInput,
        evidence,
      });
      await expect(service.submit(preparerContext, duplicate.id)).rejects.toMatchObject({
        code: 'PERSONNEL_ACTION_DUPLICATE_INCREMENT',
      });
      await expect(
        service.create(
          context('00000000-0000-4000-8000-000000000099', preparer.userId, preparer.membershipId, [
            'personnel.actions.create',
            'documents.evidence.read',
          ]),
          { ...baseInput, evidence: [] },
        ),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_EMPLOYEE_NOT_FOUND' });
      await admin.document.update({
        where: { id: authorityEvidence.documentId },
        data: { currentVersionId: replacementAuthorityVersion.id },
      });
      await expect(
        service.effectuate(preparerContext, approved.id, 'stale-authority-key'),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_APPROVAL_INVALID' });
      await admin.document.update({
        where: { id: authorityEvidence.documentId },
        data: { currentVersionId: authorityEvidence.documentVersionId },
      });
      const [firstEffect, retriedEffect] = await Promise.all([
        service.effectuate(preparerContext, approved.id, 'step-effectuation-key'),
        service.effectuate(preparerContext, approved.id, 'step-effectuation-key'),
      ]);
      expect(firstEffect).toMatchObject({
        status: 'EFFECTIVE',
        effect: { salaryGrade: 12, salaryStep: 3 },
      });
      expect(retriedEffect.effect?.serviceSegmentId).toBe(firstEffect.effect?.serviceSegmentId);
      const effectedSegmentId = firstEffect.effect?.serviceSegmentId;
      if (!effectedSegmentId) throw new Error('Effectuation did not return its Service Segment.');
      const concurrentInput = {
        ...baseInput,
        proposedEffectivity: manilaDate(31),
        targetFacts: { newSalaryStep: 4 },
        evidence,
      };
      const [concurrentA, concurrentB] = await Promise.all([
        service.create(preparerContext, concurrentInput),
        service.create(preparerContext, concurrentInput),
      ]);
      const concurrentSubmissions = await Promise.allSettled([
        service.submit(preparerContext, concurrentA.id),
        service.submit(preparerContext, concurrentB.id),
      ]);
      expect(concurrentSubmissions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(concurrentSubmissions.filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: 'PERSONNEL_ACTION_DUPLICATE_INCREMENT' }),
        }),
      ]);
      const futureAction =
        concurrentSubmissions[0]?.status === 'fulfilled' ? concurrentA : concurrentB;
      await service.review(reviewerContext, futureAction.id, {
        decision: 'ENDORSE',
        reason: 'The future-dated increment package is complete.',
      });
      await service.decide(delegateContext, futureAction.id, {
        decision: 'APPROVE',
        reason: 'Approved for its stated future date.',
      });
      await expect(service.effectuate(preparerContext, futureAction.id)).rejects.toMatchObject({
        code: 'PERSONNEL_ACTION_NOT_YET_EFFECTIVE',
      });
      const changed = await admin.employee.findUniqueOrThrow({
        where: { agencyId_id: { agencyId, id: employee.id } },
        include: { currentServiceSegment: true },
      });
      expect(changed).toMatchObject({
        serviceStatus: 'ACTIVE',
        currentServiceSegment: {
          id: effectedSegmentId,
          salaryGrade: 12,
          salaryStep: 3,
          personnelActionId: approved.id,
        },
      });
      await expect(
        admin.serviceSegment.findUniqueOrThrow({ where: { id: serviceSegment.id } }),
      ).resolves.toMatchObject({ status: 'CLOSED', effectiveTo: new Date(manilaDate(-2)) });
      await expect(
        admin.outboxEvent.count({
          where: { agencyId, aggregateId: approved.id, eventType: 'PERSONNEL_ACTION_EFFECTUATED' },
        }),
      ).resolves.toBe(1);

      const salaryEvidence = await Promise.all(
        (
          [
            'PAY_AUTHORITY',
            'SALARY_ADJUSTMENT_NOTICE',
            'CURRENT_COMPENSATION',
            'PAY_TABLE_VERSION',
          ] as const
        ).map((type) =>
          createEvidence(admin, agencyId, preparer.membershipId, `${suffix}-salary`, type),
        ),
      );
      const salaryAction = await service.create(preparerContext, {
        employeeId: employee.id,
        actionType: 'SALARY_ADJUSTMENT',
        proposedEffectivity: manilaDate(),
        targetFacts: {
          newSalaryGrade: 13,
          newSalaryStep: 3,
          payTableVersion: `PAY_TABLE_VERSION-${suffix}-salary`,
        },
        reason: 'Apply the authorized position salary-grade adjustment.',
        evidence: [...salaryEvidence, authorityEvidence],
      });
      await service.submit(preparerContext, salaryAction.id);
      await service.review(reviewerContext, salaryAction.id, {
        decision: 'ENDORSE',
        reason: 'The salary authority and exact pay-table version are complete.',
      });
      await service.decide(delegateContext, salaryAction.id, {
        decision: 'APPROVE',
        reason: 'Approved under the applicable delegated authority.',
      });
      const failingService = new PersonnelActionsService(
        { write: async () => Promise.reject(new Error('audit unavailable')) },
        documentsService,
        plantillaPositionsService,
        new AuthService(),
        new SeparationsService(separationAuditWriter),
        {} as never,
      );
      await expect(
        failingService.effectuate(preparerContext, salaryAction.id, 'salary-effectuation-key'),
      ).rejects.toThrow('audit unavailable');
      await expect(
        admin.employee.findUniqueOrThrow({
          where: { agencyId_id: { agencyId, id: employee.id } },
          include: { currentServiceSegment: true },
        }),
      ).resolves.toMatchObject({
        currentServiceSegment: { id: effectedSegmentId, salaryGrade: 12, salaryStep: 3 },
      });
      const adjusted = await service.effectuate(
        preparerContext,
        salaryAction.id,
        'salary-effectuation-key',
      );
      expect(adjusted).toMatchObject({
        status: 'EFFECTIVE',
        effect: {
          salaryGrade: 13,
          salaryStep: 3,
          serviceSegmentId: expect.any(String),
        },
      });
      const adjustedSegmentId = adjusted.effect?.serviceSegmentId;
      if (!adjustedSegmentId) throw new Error('Expected a successor service segment.');
      await expect(
        admin.serviceSegment.findUniqueOrThrow({ where: { id: adjustedSegmentId } }),
      ).resolves.toMatchObject({ positionId: position.id });
      await expect(
        admin.plantillaPosition.findUniqueOrThrow({ where: { id: position.id } }),
      ).resolves.toMatchObject({ status: 'OCCUPIED' });
      await expect(
        admin.personnelActionVersion.update({
          where: { id: approved.currentVersion.id },
          data: { reason: 'Rewrite approved history.' },
        }),
      ).rejects.toThrow(/immutable/i);
      await withDatabaseContext(
        {
          agencyId,
          userId: preparer.userId,
          membershipId: preparer.membershipId,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => {
          await transaction.serviceSegment.update({
            where: { id: adjustedSegmentId },
            data: { status: 'CLOSED', effectiveTo: new Date(manilaDate()) },
          });
          return transaction.employee.update({
            where: { id: employee.id },
            data: { currentServiceSegmentId: null, serviceStatus: 'SEPARATED' },
          });
        },
      );
      await expect(
        service.create(preparerContext, {
          employeeId: employee.id,
          actionType: 'SAME_ITEM_REINSTATEMENT',
          proposedEffectivity,
          targetFacts: {
            originalPositionId: '00000000-0000-4000-8000-000000000098',
            backPayDetermination: 'Use the executory decision.',
          },
          reason: 'Restore the Employee to the original item under the executory decision.',
          evidence: [],
        }),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_TARGET_INVALID' });
      const foreignContext = context(
        '00000000-0000-4000-8000-000000000099',
        delegate.userId,
        delegate.membershipId,
        ['personnel.actions.read'],
      );
      await expect(service.list(foreignContext)).resolves.toEqual({
        actions: [],
        nextCursor: null,
      });

      const history = await service.history(preparerContext, prepared.id);
      expect(history?.versions.map(({ versionNo }) => versionNo)).toEqual([3, 2, 1]);
      expect(history?.entries.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'PERSONNEL_ACTION_PREPARED',
          'PERSONNEL_ACTION_RETURNED',
          'PERSONNEL_ACTION_ENDORSED',
          'PERSONNEL_ACTION_APPROVED',
          'PERSONNEL_ACTION_EFFECTUATED',
        ]),
      );
      for (const entry of history?.entries ?? []) {
        expect(entry).toMatchObject({ requestId: expect.any(String) });
        expect(JSON.stringify(entry.metadata)).not.toContain('newSalaryStep');
      }
    } finally {
      if (agencyId) {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await transaction.employee.updateMany({
            where: { agencyId },
            data: { currentServiceSegmentId: null },
          });
          await transaction.auditEvent.deleteMany({ where: { agencyId } });
          await transaction.outboxEvent.deleteMany({ where: { agencyId } });
          await transaction.personnelActionEvidence.deleteMany({ where: { agencyId } });
          await transaction.personnelAction.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.personnelActionVersion.deleteMany({ where: { agencyId } });
          await transaction.personnelAction.deleteMany({ where: { agencyId } });
          await transaction.delegatedAuthority.deleteMany({ where: { agencyId } });
          await transaction.membershipRole.deleteMany({ where: { agencyId } });
          await transaction.serviceSegment.deleteMany({ where: { agencyId } });
          await transaction.employee.deleteMany({ where: { agencyId } });
          await transaction.plantillaPositionVersion.deleteMany({ where: { agencyId } });
          await transaction.plantillaPosition.deleteMany({ where: { agencyId } });
          await transaction.qualificationStandardVersion.deleteMany({ where: { agencyId } });
          await transaction.qualificationStandard.deleteMany({ where: { agencyId } });
          await transaction.staffingAuthority.deleteMany({ where: { agencyId } });
          await transaction.organizationUnit.deleteMany({ where: { agencyId } });
          await transaction.documentVersion.deleteMany({ where: { agencyId } });
          await transaction.document.deleteMany({ where: { agencyId } });
        });
        await admin.agencyMembership.deleteMany({ where: { agencyId } });
        await admin.agency.delete({ where: { id: agencyId } });
      }
      await admin.user.deleteMany({ where: { id: { in: userIds } } });
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'effectuates every supported service-status action atomically and idempotently',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-service-status`;
    let agencyId = '';
    const userIds: string[] = [];

    try {
      const agency = await admin.agency.create({
        data: {
          code: `STATUS-${suffix}`,
          name: 'Personnel Action Service Status Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      agencyId = agency.id;
      const preparer = await createActor(admin, agencyId, suffix, 'status-preparer');
      const reviewer = await createActor(admin, agencyId, suffix, 'status-reviewer');
      const authority = await createActor(admin, agencyId, suffix, 'status-authority');
      userIds.push(preparer.userId, reviewer.userId, authority.userId);

      const unit = await admin.organizationUnit.create({
        data: { agencyId, code: `STATUS-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
      });
      const unitVersion = await admin.organizationUnitVersion.create({
        data: {
          agencyId,
          organizationUnitId: unit.id,
          versionNo: 1,
          name: 'Personnel Records Division',
          effectiveFrom: new Date(manilaDate(-60)),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      await admin.organizationUnit.update({
        where: { id: unit.id },
        data: { currentVersionId: unitVersion.id },
      });

      const plantillaEvidence = await createEvidence(
        admin,
        agencyId,
        preparer.membershipId,
        `${suffix}-plantilla`,
        'AUTHORITY',
      );
      const standard = await withDatabaseContext(
        {
          agencyId,
          userId: preparer.userId,
          membershipId: preparer.membershipId,
          capabilities: ['qualification-standard-transition'],
        },
        async (transaction) => {
          const record = await transaction.qualificationStandard.create({
            data: {
              agencyId,
              code: `QS-${suffix}`,
              name: 'Service Status Test Standard',
              status: 'ACTIVE',
              createdByMembershipId: preparer.membershipId,
              updatedByMembershipId: preparer.membershipId,
            },
          });
          const version = await transaction.qualificationStandardVersion.create({
            data: {
              agencyId,
              qualificationStandardId: record.id,
              versionNo: 1,
              sourceDocumentId: plantillaEvidence.documentId,
              sourceEvidenceVersionId: plantillaEvidence.documentVersionId,
              sourceEvidenceValidatedAt: new Date(),
              sourceEvidenceValidatedByMembershipId: preparer.membershipId,
              sourceEvidenceValidationReason: 'The qualification source was reviewed.',
              approvalDocumentId: plantillaEvidence.documentId,
              approvalEvidenceVersionId: plantillaEvidence.documentVersionId,
              approvalEvidenceValidatedAt: new Date(),
              approvalEvidenceValidatedByMembershipId: preparer.membershipId,
              approvalEvidenceValidationReason: 'The qualification approval was reviewed.',
              effectiveFrom: new Date(manilaDate(-60)),
              status: 'ACTIVE',
              domainStatus: 'ACTIVE',
              createdByMembershipId: preparer.membershipId,
              updatedByMembershipId: preparer.membershipId,
            },
          });
          await transaction.qualificationStandard.update({
            where: { id: record.id },
            data: { currentVersionId: version.id },
          });
          return version;
        },
      );
      const staffingAuthority = await withDatabaseContext(
        {
          agencyId,
          userId: preparer.userId,
          membershipId: preparer.membershipId,
          capabilities: ['staffing-authority-transition'],
        },
        (transaction) =>
          transaction.staffingAuthority.create({
            data: {
              agencyId,
              authorityType: 'DBM_APPROVAL',
              referenceNo: `STATUS-AUTH-${suffix}`,
              issuedDate: new Date(manilaDate(-60)),
              effectiveDate: new Date(manilaDate(-60)),
              documentId: plantillaEvidence.documentId,
              evidenceVersionId: plantillaEvidence.documentVersionId,
              evidenceValidatedAt: new Date(),
              evidenceValidatedByMembershipId: preparer.membershipId,
              evidenceValidationReason: 'The staffing authority evidence was reviewed.',
              status: 'ACTIVE',
              createdByMembershipId: preparer.membershipId,
              updatedByMembershipId: preparer.membershipId,
            },
          }),
      );
      const authorityRole = await admin.role.findFirstOrThrow({
        where: { code: 'appointing_authority' },
      });
      await admin.membershipRole.create({
        data: {
          agencyId,
          membershipId: authority.membershipId,
          roleId: authorityRole.id,
          effectiveFrom: new Date(manilaDate(-60)),
          assignedByMembershipId: authority.membershipId,
          reason: 'Exercise appointing authority for service-status effectuation tests.',
        },
      });

      const documentsService = new DocumentsService({} as never, documentAuditWriter);
      const plantillaService = new PlantillaPositionsService(
        plantillaPositionAuditWriter,
        documentsService,
      );
      const service = new PersonnelActionsService(
        personnelActionAuditWriter,
        documentsService,
        plantillaService,
        new AuthService(),
        new SeparationsService(separationAuditWriter),
        {} as never,
      );
      const preparerContext = context(agencyId, preparer.userId, preparer.membershipId, [
        'personnel.actions.read',
        'personnel.actions.create',
        'personnel.actions.correct',
        'personnel.actions.submit',
        'personnel.actions.effectuate',
        'documents.evidence.read',
        'positions.items.create',
        'positions.items.update',
        'positions.items.authorize',
        'positions.items.declare_vacant',
      ]);
      const reviewerContext = context(agencyId, reviewer.userId, reviewer.membershipId, [
        'personnel.actions.endorse',
        'documents.evidence.read',
      ]);
      const authorityContext = context(agencyId, authority.userId, authority.membershipId, [
        'personnel.actions.approve',
        'documents.evidence.read',
      ]);

      const scenarios = [
        {
          actionType: 'SEPARATION_RESIGNATION',
          targetFacts: {
            acceptanceDate: manilaDate(-2),
            noticeDate: manilaDate(-3),
            withdrawalState: 'NONE',
            mutuallyAgreedEarlier: true,
          },
          evidence: ['WRITTEN_RESIGNATION', 'ACCEPTANCE', 'NOTICE', 'WITHDRAWAL_STATE'],
          expectedStatus: 'SEPARATED',
        },
        {
          actionType: 'SEPARATION_DISMISSAL',
          targetFacts: { decisionFinalityDate: manilaDate(-2), appealState: 'FINAL' },
          evidence: ['EXECUTORY_DECISION', 'CSC_SUBMISSION', 'APPEAL_STATE'],
          expectedStatus: 'SEPARATED',
        },
        {
          actionType: 'SEPARATION_DROPPING_FROM_ROLLS',
          targetFacts: { orderDate: manilaDate(-2) },
          evidence: ['DROPPING_ORDER', 'ABSENCE_RECORD', 'NOTICE', 'DUE_PROCESS'],
          expectedStatus: 'SEPARATED',
        },
        {
          actionType: 'SEPARATION_EXPIRATION',
          targetFacts: { appointmentEndDate: manilaDate() },
          evidence: ['APPOINTMENT_TERM', 'CSC_SUBMISSION'],
          expectedStatus: 'SEPARATED',
        },
        {
          actionType: 'SEPARATION_TERMINATION',
          targetFacts: { terminationOrderDate: manilaDate(-2) },
          evidence: ['APPOINTMENT_TERM', 'TERMINATION_ORDER', 'CSC_SUBMISSION'],
          expectedStatus: 'SEPARATED',
        },
        {
          actionType: 'SEPARATION_DEATH',
          targetFacts: { dateOfDeath: manilaDate() },
          evidence: ['DEATH_CERTIFICATE', 'CSC_SUBMISSION'],
          expectedStatus: 'DECEASED',
        },
      ] as const;

      let reinstatementSource: {
        employeeId: string;
        positionId: string;
        separationActionId: string;
      } | null = null;
      for (const [index, scenario] of scenarios.entries()) {
        const position = await plantillaService.create(preparerContext, {
          itemNumber: `STATUS-${index}-${suffix}`,
          title: 'Administrative Officer V',
          parentheticalTitle: null,
          salaryGrade: 18,
          organizationUnitId: unit.id,
          fundingSource: 'General Appropriations Act',
          employmentCategory: 'PLANTILLA',
          qualificationStandardVersionId: standard.id,
          staffingAuthorityId: staffingAuthority.id,
          effectiveDate: manilaDate(-30),
        });
        await plantillaService.linkEvidence(preparerContext, position.id, {
          documentId: plantillaEvidence.documentId,
          purpose: 'CREATION',
          effectiveDate: manilaDate(-30),
        });
        await plantillaService.authorize(preparerContext, position.id, {
          effectiveDate: manilaDate(-29),
          reason: 'The source-backed Plantilla Position is authorized.',
        });
        await plantillaService.declareVacant(preparerContext, position.id, {
          effectiveDate: manilaDate(-28),
          reason: 'The authorized position is vacant before incumbency begins.',
        });
        const employee = await admin.employee.create({
          data: {
            agencyId,
            employeeNumber: `STATUS-${index}-${suffix}`,
            legalName: `Service Status Employee ${index}`,
            birthDate: new Date(`199${index}-01-01`),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `status-${index}-${suffix}@example.test`,
            serviceStatus: 'ACTIVE',
            firstGovernmentServiceDate: new Date(manilaDate(-25)),
            agencyServiceStartDate: new Date(manilaDate(-25)),
            createdByMembershipId: preparer.membershipId,
            updatedByMembershipId: preparer.membershipId,
          },
        });
        const employeeUser = await admin.user.create({
          data: {
            identityProvider: 'personnel-action-integration',
            externalSubject: `separating-${index}-${suffix}`,
            emailNormalized: `separating-${index}-${suffix}@example.test`,
            displayName: `Separating Employee ${index}`,
            globalStatus: 'ACTIVE',
          },
        });
        userIds.push(employeeUser.id);
        const employeeMembership = await withDatabaseContext(
          {
            agencyId,
            userId: employeeUser.id,
            capabilities: ['employee-membership-link'],
          },
          (transaction) =>
            transaction.agencyMembership.create({
              data: {
                agencyId,
                userId: employeeUser.id,
                employeeId: employee.id,
                status: 'ACTIVE',
              },
            }),
        );
        await admin.userSession.create({
          data: {
            agencyId,
            userId: employeeUser.id,
            agencyMembershipId: employeeMembership.id,
            sessionTokenHash: randomBytes(32),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
        const source = await withDatabaseContext(
          {
            agencyId,
            userId: preparer.userId,
            membershipId: preparer.membershipId,
            capabilities: ['personnel-baseline-transition', 'plantilla-position-transition'],
          },
          async (transaction) => {
            const segment = await transaction.serviceSegment.create({
              data: {
                agencyId,
                employeeId: employee.id,
                positionId: position.id,
                organizationUnitId: unit.id,
                appointmentStatus: 'PERMANENT',
                salaryGrade: 18,
                salaryStep: 3,
                effectiveFrom: new Date(manilaDate(-25)),
                status: 'ACTIVE',
                createdByMembershipId: preparer.membershipId,
              },
            });
            await transaction.positionIncumbency.create({
              data: {
                agencyId,
                positionId: position.id,
                employeeId: employee.id,
                serviceSegmentId: segment.id,
                effectiveFrom: new Date(manilaDate(-25)),
                status: 'ACTIVE',
                createdByMembershipId: preparer.membershipId,
              },
            });
            await transaction.employee.update({
              where: { id: employee.id },
              data: { currentServiceSegmentId: segment.id },
            });
            await plantillaService.occupyInTransaction(
              transaction,
              preparerContext,
              position.id,
              manilaDate(-25),
              'The employee assumed the Plantilla Position.',
              `occupy-${index}-${suffix}`,
            );
            return segment;
          },
        );
        const evidence = await Promise.all(
          scenario.evidence.map((type) =>
            createEvidence(
              admin,
              agencyId,
              preparer.membershipId,
              `${suffix}-${index}`,
              type,
              type === 'APPOINTMENT_TERM'
                ? {
                    appointmentType: 'TEMPORARY',
                    appointmentEndDate:
                      scenario.actionType === 'SEPARATION_EXPIRATION'
                        ? manilaDate()
                        : manilaDate(30),
                  }
                : undefined,
            ),
          ),
        );
        const input = {
          employeeId: employee.id,
          actionType: scenario.actionType,
          proposedEffectivity: manilaDate(),
          targetFacts: scenario.targetFacts,
          reason: `Effectuate ${scenario.actionType} from its exact approved evidence.`,
          evidence,
        } as PersonnelActionInput;
        if (index === 0 && scenario.actionType === 'SEPARATION_RESIGNATION') {
          await expect(
            service.create(preparerContext, {
              ...input,
              targetFacts: { ...scenario.targetFacts, mutuallyAgreedEarlier: false },
              reason: 'A shortened notice period without written agreement must fail.',
            } as PersonnelActionInput),
          ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_TARGET_INVALID' });
          const mismatchedEvidence = await service.create(preparerContext, {
            ...input,
            evidence: input.evidence.map((item, evidenceIndex) =>
              evidenceIndex === 0 ? { ...item, sourceDate: manilaDate(-4) } : item,
            ),
            reason: 'A client-supplied source date must match the issued evidence version.',
          });
          await expect(
            service.submit(preparerContext, mismatchedEvidence.id),
          ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_EVIDENCE_DATE_INVALID' });
        }
        const prepared = await service.create(preparerContext, input);
        await service.submit(preparerContext, prepared.id);
        await service.review(reviewerContext, prepared.id, {
          decision: 'ENDORSE',
          reason: 'The evidence package is complete.',
        });
        await service.decide(authorityContext, prepared.id, {
          decision: 'APPROVE',
          reason: 'The action is approved under current authority.',
        });
        const separationCase = await admin.separationCase.create({
          data: {
            agencyId,
            employeeId: employee.id,
            separationType: scenario.actionType.replace('SEPARATION_', ''),
            proposedEffectiveDate: new Date(manilaDate()),
            approvedEffectiveDate: new Date(manilaDate()),
            status: index === 0 ? 'APPROVED' : 'CLEARED',
            reason: input.reason,
            initiatedByMembershipId: preparer.membershipId,
            approvedByMembershipId: authority.membershipId,
            serviceSegmentId: source.id,
          },
        });
        if (index === 0) {
          await expect(
            service.effectuate(preparerContext, prepared.id, `uncleared-${suffix}`),
          ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_CLEARANCE_PENDING' });
          await admin.separationCase.update({
            where: { id: separationCase.id },
            data: { status: 'CLEARED' },
          });
          const future = await service.create(preparerContext, {
            ...input,
            proposedEffectivity: manilaDate(1),
            reason: 'Prove that approval cannot bypass the applicable date.',
          });
          await service.submit(preparerContext, future.id);
          await service.review(reviewerContext, future.id, {
            decision: 'ENDORSE',
            reason: 'The future-dated evidence package is complete.',
          });
          await service.decide(authorityContext, future.id, {
            decision: 'APPROVE',
            reason: 'Approval does not waive effectivity.',
          });
          await expect(
            service.effectuate(preparerContext, future.id, `future-${suffix}`),
          ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_EFFECTIVITY_PENDING' });

          const failingService = new PersonnelActionsService(
            personnelActionAuditWriter,
            documentsService,
            {
              lockInTransaction: () => undefined,
              vacateInTransaction: () => {
                throw new Error('Injected Plantilla transition failure.');
              },
            } as never,
            new AuthService(),
            new SeparationsService(separationAuditWriter),
            {} as never,
          );
          await expect(
            failingService.effectuate(preparerContext, prepared.id, `rollback-${suffix}`),
          ).rejects.toThrow('Injected Plantilla transition failure.');
          await expect(
            admin.personnelAction.findUniqueOrThrow({ where: { id: prepared.id } }),
          ).resolves.toMatchObject({ status: 'APPROVED', effectuatedAt: null });
          await expect(
            admin.serviceSegment.findUniqueOrThrow({ where: { id: source.id } }),
          ).resolves.toMatchObject({ status: 'ACTIVE', effectiveTo: null });
        }
        const [effective, retried] = await Promise.all([
          service.effectuate(preparerContext, prepared.id, `effect-${index}-${suffix}`),
          service.effectuate(preparerContext, prepared.id, `effect-${index}-${suffix}`),
        ]);
        expect(effective).toMatchObject({
          status: 'EFFECTIVE',
          employee: { serviceStatus: scenario.expectedStatus },
        });
        expect(retried.id).toBe(effective.id);
        await expect(
          admin.separationCase.findUniqueOrThrow({ where: { id: separationCase.id } }),
        ).resolves.toMatchObject({ status: 'EFFECTIVE' });
        await expect(
          admin.separationEffect.count({ where: { separationCaseId: separationCase.id } }),
        ).resolves.toBe(5);
        await expect(
          admin.separationEffect.findFirstOrThrow({
            where: { separationCaseId: separationCase.id, effectType: 'STOP_PAYROLL' },
          }),
        ).resolves.toMatchObject({ targetType: 'ServiceSegment', targetId: source.id });
        if (index === 0) {
          await expect(
            withDatabaseContext(
              {
                agencyId: '00000000-0000-4000-8000-000000000099',
                userId: reviewer.userId,
                membershipId: reviewer.membershipId,
                capabilities: [],
              },
              (transaction) =>
                Promise.all([
                  transaction.separationCase.count({ where: { id: separationCase.id } }),
                  transaction.separationEffect.count({
                    where: { separationCaseId: separationCase.id },
                  }),
                ]),
            ),
          ).resolves.toEqual([0, 0]);
        }
        await expect(
          admin.agencyMembership.findUniqueOrThrow({ where: { id: employeeMembership.id } }),
        ).resolves.toMatchObject({ status: 'DEACTIVATED' });
        await expect(
          admin.userSession.findFirstOrThrow({
            where: { agencyMembershipId: employeeMembership.id },
          }),
        ).resolves.toMatchObject({ revokedAt: expect.any(Date) });
        await expect(
          admin.serviceSegment.findUniqueOrThrow({ where: { id: source.id } }),
        ).resolves.toMatchObject({ status: 'CLOSED', effectiveTo: new Date(manilaDate(-1)) });
        await expect(
          admin.positionIncumbency.findUniqueOrThrow({
            where: { agencyId_serviceSegmentId: { agencyId, serviceSegmentId: source.id } },
          }),
        ).resolves.toMatchObject({ status: 'ENDED', effectiveTo: new Date(manilaDate(-1)) });
        await expect(
          admin.outboxEvent.count({
            where: {
              agencyId,
              aggregateId: prepared.id,
              eventType: 'PERSONNEL_ACTION_EFFECTUATED',
            },
          }),
        ).resolves.toBe(1);
        await expect(
          admin.auditEvent.count({
            where: {
              agencyId,
              entityType: 'SeparationCase',
              entityId: separationCase.id,
              action: 'SEPARATION_EFFECTUATED',
            },
          }),
        ).resolves.toBe(1);
        if (index === 0) {
          reinstatementSource = {
            employeeId: employee.id,
            positionId: position.id,
            separationActionId: prepared.id,
          };
        }
      }

      if (!reinstatementSource) throw new Error('The reinstatement source was not created.');
      const reinstatementEvidence = await Promise.all(
        (
          [
            'EXECUTORY_DECISION',
            'PRIOR_SEPARATION',
            'NO_MISCONDUCT',
            'ORIGINAL_ITEM',
            'BACK_PAY_DETERMINATION',
          ] as const
        ).map((type) =>
          createEvidence(admin, agencyId, preparer.membershipId, `${suffix}-reinstate`, type),
        ),
      );
      const reinstatement = await service.replace(
        preparerContext,
        reinstatementSource.separationActionId,
        {
          employeeId: reinstatementSource.employeeId,
          actionType: 'SAME_ITEM_REINSTATEMENT',
          proposedEffectivity: manilaDate(),
          targetFacts: {
            originalPositionId: reinstatementSource.positionId,
            backPayDetermination:
              'Apply the executory decision through authoritative payroll rules.',
          },
          reason: 'Restore continuous service under the executory decision.',
          evidence: reinstatementEvidence,
        },
      );
      await service.submit(preparerContext, reinstatement.id);
      await service.review(reviewerContext, reinstatement.id, {
        decision: 'ENDORSE',
        reason: 'The restoration evidence is complete.',
      });
      await service.decide(authorityContext, reinstatement.id, {
        decision: 'APPROVE',
        reason: 'The executory restoration is approved.',
      });
      await expect(
        service.effectuate(preparerContext, reinstatement.id, `reinstate-${suffix}`),
      ).resolves.toMatchObject({ status: 'EFFECTIVE', employee: { serviceStatus: 'ACTIVE' } });
      await expect(
        admin.serviceSegment.count({
          where: { agencyId, personnelActionId: reinstatement.id, status: 'ACTIVE' },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.plantillaPositionVersion.findFirstOrThrow({
          where: { agencyId, positionId: reinstatementSource.positionId, status: 'ACTIVE' },
        }),
      ).resolves.toMatchObject({ domainStatus: 'OCCUPIED', effectiveFrom: new Date(manilaDate()) });

      expect(personnelActionCanBeEffectuated('SEPARATION_RETIREMENT')).toBe(false);
    } finally {
      if (agencyId) {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await transaction.employee.updateMany({
            where: { agencyId },
            data: { currentServiceSegmentId: null },
          });
          await transaction.outboxEvent.deleteMany({ where: { agencyId } });
          await transaction.auditEvent.deleteMany({ where: { agencyId } });
          await transaction.separationEffect.deleteMany({ where: { agencyId } });
          await transaction.separationCase.deleteMany({ where: { agencyId } });
          await transaction.personnelActionEvidence.deleteMany({ where: { agencyId } });
          await transaction.personnelAction.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.personnelActionVersion.deleteMany({ where: { agencyId } });
          await transaction.personnelAction.deleteMany({ where: { agencyId } });
          await transaction.positionIncumbency.deleteMany({ where: { agencyId } });
          await transaction.serviceSegment.deleteMany({ where: { agencyId } });
          await transaction.employee.deleteMany({ where: { agencyId } });
          await transaction.plantillaPosition.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.positionDocument.deleteMany({ where: { agencyId } });
          await transaction.plantillaPositionVersion.deleteMany({ where: { agencyId } });
          await transaction.plantillaPosition.deleteMany({ where: { agencyId } });
          await transaction.qualificationStandard.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.qualificationStandardVersion.deleteMany({ where: { agencyId } });
          await transaction.qualificationStandard.deleteMany({ where: { agencyId } });
          await transaction.staffingAuthority.deleteMany({ where: { agencyId } });
          await transaction.membershipRole.deleteMany({ where: { agencyId } });
          await transaction.organizationUnit.updateMany({
            where: { agencyId },
            data: { currentVersionId: null },
          });
          await transaction.organizationUnitVersion.deleteMany({ where: { agencyId } });
          await transaction.organizationUnit.deleteMany({ where: { agencyId } });
          await transaction.documentVersion.deleteMany({ where: { agencyId } });
          await transaction.document.deleteMany({ where: { agencyId } });
        });
        await admin.userSession.deleteMany({ where: { agencyId } });
        await admin.agencyMembership.deleteMany({ where: { agencyId } });
        await admin.agency.delete({ where: { id: agencyId } });
      }
      await admin.user.deleteMany({ where: { id: { in: userIds } } });
      await admin.$disconnect();
    }
  },
);
