import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { AppointmentReadModel, AppointmentsService } from '../appointments/appointments.service';
import { AuthService } from '../auth/auth.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from '../plantilla-positions/plantilla-positions.service';
import { separationAuditWriter, SeparationsService } from '../separations/separations.service';
import type {
  PersonnelActionEvidenceInput,
  PersonnelActionInput,
} from './personnel-actions.schemas';
import { personnelActionAuditWriter, PersonnelActionsService } from './personnel-actions.service';

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
    requestId: `movement-${membershipId}`,
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
      emailNormalized: `movement-${name}-${suffix}@example.test`,
      displayName: name,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId, userId: user.id, status: 'ACTIVE' },
  });
  return { userId: user.id, membershipId: membership.id };
}

async function createEvidenceDocument(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  documentType: string,
  sourceDate: string,
): Promise<PersonnelActionEvidenceInput> {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentNo: `${documentType}-${suffix}`,
      documentType,
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
      storageKey: `movement/${suffix}/${documentType}`,
      contentHash: 'b'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(`${sourceDate}T00:00:00.000Z`),
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id, status: 'APPROVED' },
  });
  return {
    evidenceType: documentType as PersonnelActionEvidenceInput['evidenceType'],
    documentId: document.id,
    documentVersionId: version.id,
    sourceDate,
  };
}

interface MovementFixture {
  admin: PrismaClient;
  suffix: string;
  agencyId: string;
  preparer: RequestContext;
  reviewer: RequestContext;
  authority: RequestContext;
  service: PersonnelActionsService;
  appointments: AppointmentsService;
  personKey: string;
  employeeId: string;
  sourcePositionId: string;
  sourceSegmentId: string;
  targetPositionId: string;
  targetUnitId: string;
  appointment: { id: string; versionId: string; assumptionDate: string };
  evidence: Record<
    'AUTHORITY' | 'EXECUTORY_DECISION' | 'PRIOR_SEPARATION' | 'NO_MISCONDUCT',
    PersonnelActionEvidenceInput
  >;
  dispose: () => Promise<void>;
}

async function setupMovementFixture(options: {
  label: string;
  employeeStatus: 'ACTIVE' | 'SEPARATED';
  nature: 'PROMOTION' | 'TRANSFER' | 'DEMOTION' | 'RECLASSIFICATION' | 'REINSTATEMENT';
}): Promise<MovementFixture> {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const agency = await admin.agency.create({
    data: {
      code: `MOVE-${options.label}-${suffix}`,
      name: `Movement ${options.label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const agencyId = agency.id;
  const preparer = await createActor(admin, agencyId, suffix, 'preparer');
  const reviewer = await createActor(admin, agencyId, suffix, 'reviewer');
  const authority = await createActor(admin, agencyId, suffix, 'authority');
  const appointingRole = await admin.role.findFirstOrThrow({
    where: { code: 'appointing_authority' },
  });
  await admin.membershipRole.create({
    data: {
      agencyId,
      membershipId: authority.membershipId,
      roleId: appointingRole.id,
      effectiveFrom: new Date(manilaDate(-30)),
      assignedByMembershipId: authority.membershipId,
      reason: 'Exercise appointing authority in the movement integration test.',
    },
  });

  const evidence = {
    AUTHORITY: await createEvidenceDocument(
      admin,
      agencyId,
      preparer.membershipId,
      suffix,
      'AUTHORITY',
      manilaDate(-5),
    ),
    EXECUTORY_DECISION: await createEvidenceDocument(
      admin,
      agencyId,
      preparer.membershipId,
      suffix,
      'EXECUTORY_DECISION',
      manilaDate(-5),
    ),
    PRIOR_SEPARATION: await createEvidenceDocument(
      admin,
      agencyId,
      preparer.membershipId,
      suffix,
      'PRIOR_SEPARATION',
      manilaDate(-5),
    ),
    NO_MISCONDUCT: await createEvidenceDocument(
      admin,
      agencyId,
      preparer.membershipId,
      suffix,
      'NO_MISCONDUCT',
      manilaDate(-5),
    ),
  };

  const seeded = await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const sourceUnit = await transaction.organizationUnit.create({
      data: {
        agencyId,
        code: `SRC-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const sourceUnitVersion = await transaction.organizationUnitVersion.create({
      data: {
        agencyId,
        organizationUnitId: sourceUnit.id,
        versionNo: 1,
        name: 'Source Division',
        effectiveFrom: new Date(manilaDate(-1000)),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: sourceUnit.id },
      data: { currentVersionId: sourceUnitVersion.id },
    });
    const targetUnit = await transaction.organizationUnit.create({
      data: {
        agencyId,
        code: `TGT-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const targetUnitVersion = await transaction.organizationUnitVersion.create({
      data: {
        agencyId,
        organizationUnitId: targetUnit.id,
        versionNo: 1,
        name: 'Target Division',
        effectiveFrom: new Date(manilaDate(-1000)),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: targetUnit.id },
      data: { currentVersionId: targetUnitVersion.id },
    });

    const standard = await transaction.qualificationStandard.create({
      data: {
        agencyId,
        code: `MOVE-QS-${suffix}`,
        name: 'Movement qualification standard',
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
        sourceDocumentId: evidence.AUTHORITY.documentId,
        sourceEvidenceVersionId: evidence.AUTHORITY.documentVersionId,
        sourceEvidenceValidatedAt: new Date(manilaDate(-5)),
        sourceEvidenceValidatedByMembershipId: preparer.membershipId,
        sourceEvidenceValidationReason: 'Validated the qualification source.',
        approvalDocumentId: evidence.AUTHORITY.documentId,
        approvalEvidenceVersionId: evidence.AUTHORITY.documentVersionId,
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
        referenceNo: `MOVE-AUTH-${suffix}`,
        issuedDate: new Date(manilaDate(-1000)),
        effectiveDate: new Date(manilaDate(-1000)),
        documentId: evidence.AUTHORITY.documentId,
        evidenceVersionId: evidence.AUTHORITY.documentVersionId,
        evidenceValidatedAt: new Date(manilaDate(-5)),
        evidenceValidatedByMembershipId: preparer.membershipId,
        evidenceValidationReason: 'Validated the staffing authority.',
        status: 'ACTIVE',
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });

    const sourcePosition = await transaction.plantillaPosition.create({
      data: {
        agencyId,
        itemNumber: `MOVE-SRC-${suffix}`,
        status: 'OCCUPIED',
        createdFromAuthorityId: staffingAuthority.id,
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    const sourceVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId,
        positionId: sourcePosition.id,
        organizationUnitId: sourceUnit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: staffingAuthority.id,
        versionNo: 1,
        positionTitle: 'Administrative Officer IV',
        salaryGrade: 12,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date(manilaDate(-1000)),
        status: 'ACTIVE',
        domainStatus: 'OCCUPIED',
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: sourcePosition.id },
      data: { currentVersionId: sourceVersion.id },
    });

    const targetPosition = await transaction.plantillaPosition.create({
      data: {
        agencyId,
        itemNumber: `MOVE-TGT-${suffix}`,
        status: 'RESERVED',
        createdFromAuthorityId: staffingAuthority.id,
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    const targetVersion = await transaction.plantillaPositionVersion.create({
      data: {
        agencyId,
        positionId: targetPosition.id,
        organizationUnitId: targetUnit.id,
        qualificationStandardVersionId: standardVersion.id,
        staffingAuthorityId: staffingAuthority.id,
        versionNo: 1,
        positionTitle: 'Human Resource Management Officer III',
        salaryGrade: 13,
        fundingSource: 'General Appropriations Act',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date(manilaDate(-30)),
        status: 'ACTIVE',
        domainStatus: 'RESERVED',
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    await transaction.plantillaPosition.update({
      where: { id: targetPosition.id },
      data: { currentVersionId: targetVersion.id },
    });

    return {
      sourcePositionId: sourcePosition.id,
      sourceUnitId: sourceUnit.id,
      targetPositionId: targetPosition.id,
      targetUnitId: targetUnit.id,
      targetItemNumber: targetPosition.itemNumber,
      targetVersionId: targetVersion.id,
      qualificationVersionId: standardVersion.id,
    };
  });

  const personKey = randomUUID();
  const employee = await admin.employee.create({
    data: {
      agencyId,
      employeeNumber: `MOVE-EMP-${suffix}`,
      personKey,
      legalName: 'Ana Reyes',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `movement-employee-${suffix}@example.test`,
      serviceStatus: options.employeeStatus,
      firstGovernmentServiceDate: new Date(manilaDate(-1000)),
      agencyServiceStartDate: new Date(manilaDate(-900)),
      createdByMembershipId: preparer.membershipId,
      updatedByMembershipId: preparer.membershipId,
    },
  });

  const sourceSegment = await withDatabaseContext(
    {
      agencyId,
      userId: preparer.userId,
      membershipId: preparer.membershipId,
      capabilities: ['personnel-baseline-transition', 'plantilla-position-transition'],
    },
    async (segmentTransaction) => {
      const separated = options.employeeStatus === 'SEPARATED';
      const segment = await segmentTransaction.serviceSegment.create({
        data: {
          agencyId,
          employeeId: employee.id,
          positionId: seeded.sourcePositionId,
          organizationUnitId: seeded.sourceUnitId,
          appointmentStatus: 'PERMANENT',
          salaryGrade: 12,
          salaryStep: 2,
          effectiveFrom: new Date(manilaDate(-900)),
          effectiveTo: separated ? new Date(manilaDate(-10)) : null,
          status: separated ? 'CLOSED' : 'ACTIVE',
          createdByMembershipId: preparer.membershipId,
        },
      });
      if (!separated) {
        await segmentTransaction.positionIncumbency.create({
          data: {
            agencyId,
            positionId: seeded.sourcePositionId,
            employeeId: employee.id,
            serviceSegmentId: segment.id,
            effectiveFrom: new Date(manilaDate(-900)),
            status: 'ACTIVE',
            createdByMembershipId: preparer.membershipId,
          },
        });
        await segmentTransaction.employee.update({
          where: { id: employee.id },
          data: { currentServiceSegmentId: segment.id },
        });
      }
      return segment;
    },
  );

  const seed = { ...seeded, employeeId: employee.id, sourceSegmentId: sourceSegment.id };

  const assumptionDate = manilaDate(-1);
  const selectionPackage = {
    selectionDecisionId: randomUUID(),
    decision: 'SELECTED',
    applicant: {
      id: personKey,
      fullName: 'Ana Reyes',
      email: null,
      mobileNumber: null,
    },
    applicationNo: `MOVE-APP-${suffix}`,
    qualificationStandardVersionId: seed.qualificationVersionId,
    position: {
      id: seed.targetPositionId,
      itemNumber: seed.targetItemNumber,
      positionVersionId: seed.targetVersionId,
      title: 'Human Resource Management Officer III',
      salaryGrade: 13,
      organizationUnitId: seed.targetUnitId,
    },
    documents: [],
  } satisfies Prisma.InputJsonObject;

  const seededAppointment = await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const handoff = await transaction.recruitmentAppointmentHandoff.create({
      data: {
        agencyId,
        selectionDecisionId: randomUUID(),
        applicationId: randomUUID(),
        positionId: seed.targetPositionId,
        selectionPackage,
        idempotencyKey: `MOVE-HANDOFF-${suffix}`,
      },
    });
    const appointment = await transaction.appointment.create({
      data: {
        agencyId,
        recruitmentHandoffId: handoff.id,
        recruitmentSelectionPackage: selectionPackage,
        positionId: seed.targetPositionId,
        appointeePersonKey: personKey,
        workflowStatus: 'ISSUED',
        issuedAt: new Date(),
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    const appointmentVersion = await transaction.appointmentVersion.create({
      data: {
        agencyId,
        appointmentId: appointment.id,
        versionNo: 1,
        employmentStatus: 'PERMANENT',
        natureOfAppointment: options.nature,
        salaryGrade: 13,
        salaryStep: 3,
        effectivityDate: new Date(assumptionDate),
        appointingAuthorityMembershipId: authority.membershipId,
        formVariant: 'CS_FORM_33_A_2025',
        signatureMethod: 'WET_INK',
        appointmentDocumentVersionId: evidence.AUTHORITY.documentVersionId,
        status: 'ISSUED',
        issuedAt: new Date(),
        issuedByMembershipId: authority.membershipId,
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    await transaction.appointment.update({
      where: { id: appointment.id },
      data: { currentVersionId: appointmentVersion.id },
    });
    await transaction.appointmentAcknowledgment.create({
      data: {
        agencyId,
        appointmentVersionId: appointmentVersion.id,
        acknowledgedAt: new Date(`${manilaDate(-3)}T00:00:00.000Z`),
        evidenceDocumentVersionId: evidence.PRIOR_SEPARATION.documentVersionId,
      },
    });
    const oath = await transaction.oathOfOffice.create({
      data: {
        agencyId,
        appointmentVersionId: appointmentVersion.id,
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    const oathVersion = await transaction.oathVersion.create({
      data: {
        agencyId,
        oathId: oath.id,
        versionNo: 1,
        oathDate: new Date(manilaDate(-2)),
        administeredByMembershipId: authority.membershipId,
        authority: 'Agency Human Resource Management Officer',
        documentVersionId: evidence.NO_MISCONDUCT.documentVersionId,
      },
    });
    await transaction.oathOfOffice.update({
      where: { id: oath.id },
      data: { currentVersionId: oathVersion.id },
    });
    const assumption = await transaction.assumptionToDuty.create({
      data: {
        agencyId,
        appointmentVersionId: appointmentVersion.id,
        status: 'PENDING',
        createdByMembershipId: preparer.membershipId,
        updatedByMembershipId: preparer.membershipId,
      },
    });
    const assumptionVersion = await transaction.assumptionVersion.create({
      data: {
        agencyId,
        assumptionId: assumption.id,
        versionNo: 1,
        oathVersionId: oathVersion.id,
        actualAssumptionDate: new Date(assumptionDate),
        certifiedByMembershipId: authority.membershipId,
        certifyingAuthority: 'Agency Human Resource Management Officer',
        certifiedAt: new Date(`${assumptionDate}T01:00:00.000Z`),
        documentVersionId: evidence.EXECUTORY_DECISION.documentVersionId,
      },
    });
    await transaction.assumptionToDuty.update({
      where: { id: assumption.id },
      data: { currentVersionId: assumptionVersion.id, status: 'ASSUMED' },
    });
    return { appointment, appointmentVersion };
  });
  const { appointment, appointmentVersion } = seededAppointment;

  const documentsService = new DocumentsService({} as never, documentAuditWriter);
  const plantillaService = new PlantillaPositionsService(
    plantillaPositionAuditWriter,
    documentsService,
  );
  const appointmentReadModel = new AppointmentReadModel({} as never, plantillaService);
  const appointments = new AppointmentsService(
    documentsService,
    plantillaService,
    {} as never,
    {} as never,
    appointmentReadModel,
  );
  const service = new PersonnelActionsService(
    personnelActionAuditWriter,
    documentsService,
    plantillaService,
    new AuthService(),
    new SeparationsService(separationAuditWriter),
    appointments,
  );

  return {
    admin,
    suffix,
    agencyId,
    preparer: context(agencyId, preparer.userId, preparer.membershipId, [
      'personnel.actions.read',
      'personnel.actions.create',
      'personnel.actions.correct',
      'personnel.actions.submit',
      'personnel.actions.effectuate',
      'documents.evidence.read',
    ]),
    reviewer: context(agencyId, reviewer.userId, reviewer.membershipId, [
      'personnel.actions.endorse',
      'documents.evidence.read',
    ]),
    authority: context(agencyId, authority.userId, authority.membershipId, [
      'personnel.actions.approve',
      'appointments.records.read',
      'documents.evidence.read',
    ]),
    service,
    appointments,
    personKey,
    employeeId: seed.employeeId,
    sourcePositionId: seed.sourcePositionId,
    sourceSegmentId: seed.sourceSegmentId,
    targetPositionId: seed.targetPositionId,
    targetUnitId: seed.targetUnitId,
    appointment: { id: appointment.id, versionId: appointmentVersion.id, assumptionDate },
    evidence,
    dispose: async () => {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of [
          'outbox_events',
          'audit_events',
          'personnel_action_evidence',
          'personnel_action_versions',
          'personnel_actions',
          'position_incumbencies',
          'service_segments',
          'employees',
          'appointment_external_submission_events',
          'appointment_external_actions',
          'appointment_document_version_links',
          'assumption_outcome_events',
          'assumption_versions',
          'assumptions_to_duty',
          'oath_versions',
          'oaths_of_office',
          'appointment_acknowledgments',
          'appointment_versions',
          'appointments',
          'appointment_agency_settings',
          'recruitment_appointment_handoffs',
          'plantilla_position_versions',
          'plantilla_positions',
          'staffing_authorities',
          'organization_unit_versions',
          'organization_units',
          'qualification_standard_versions',
          'qualification_standards',
          'document_versions',
          'documents',
          'membership_roles',
        ]) {
          await transaction.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "agency_id" = '${agencyId}'::uuid`,
          );
        }
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId } });
      await admin.agency.delete({ where: { id: agencyId } });
      await admin.user.deleteMany({
        where: { emailNormalized: { endsWith: `-${suffix}@example.test` } },
      });
      await admin.$disconnect();
    },
  };
}

const activeMovementScenarios = ['PROMOTION', 'TRANSFER', 'DEMOTION', 'RECLASSIFICATION'] as const;

for (const actionType of activeMovementScenarios) {
  it.skipIf(!enabled)(
    `effectuates a ${actionType} into the reserved Appointment target and stays retry-safe`,
    async () => {
      const fixture = await setupMovementFixture({
        label: actionType.toLowerCase(),
        employeeStatus: 'ACTIVE',
        nature: actionType,
      });
      const { admin } = fixture;
      try {
        const candidates = await fixture.appointments.listMovementCandidates(fixture.authority);
        expect(candidates.map(({ appointmentVersionId }) => appointmentVersionId)).toContain(
          fixture.appointment.versionId,
        );

        const input: PersonnelActionInput = {
          employeeId: fixture.employeeId,
          actionType,
          proposedEffectivity: fixture.appointment.assumptionDate,
          targetFacts: { appointmentVersionId: fixture.appointment.versionId },
          reason: `The Appointing Authority approved the ${actionType.toLowerCase()}.`,
          evidence: [fixture.evidence.AUTHORITY],
        };

        if (actionType === 'PROMOTION') {
          await expect(
            fixture.service.create(fixture.preparer, {
              employeeId: fixture.employeeId,
              actionType: 'TRANSFER',
              proposedEffectivity: fixture.appointment.assumptionDate,
              targetFacts: { appointmentVersionId: fixture.appointment.versionId },
              reason: input.reason,
              evidence: [fixture.evidence.AUTHORITY],
            }),
          ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_APPOINTMENT_NATURE_INVALID' });
        }
        await expect(
          fixture.service.create(fixture.preparer, {
            ...input,
            proposedEffectivity: manilaDate(1),
          }),
        ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_EFFECTIVITY_INVALID' });
        const incomplete = await fixture.service.create(fixture.preparer, {
          ...input,
          evidence: [],
        });
        await expect(fixture.service.submit(fixture.preparer, incomplete.id)).rejects.toMatchObject(
          {
            code: 'PERSONNEL_ACTION_EVIDENCE_INCOMPLETE',
          },
        );

        const created = await fixture.service.create(fixture.preparer, input);
        expect(created.currentVersion.targetPositionId).toBe(fixture.targetPositionId);
        expect(created.currentVersion.targetOrganizationUnitId).toBe(fixture.targetUnitId);
        expect(created.effectuationAvailable).toBe(true);

        await fixture.service.submit(fixture.preparer, created.id);
        await fixture.service.review(fixture.reviewer, created.id, {
          decision: 'ENDORSE',
          reason: 'The movement record is complete.',
        });
        await fixture.service.decide(fixture.authority, created.id, {
          decision: 'APPROVE',
          reason: 'The promotion is approved under current authority.',
        });

        const effectuationKey = `movement-${actionType.toLowerCase()}-${fixture.suffix}`;
        const effectuated = await fixture.service.effectuate(
          fixture.preparer,
          created.id,
          effectuationKey,
        );
        expect(effectuated.status).toBe('EFFECTIVE');
        expect(effectuated.effect?.serviceSegmentId).toBeTruthy();

        const sourceSegment = await admin.serviceSegment.findUniqueOrThrow({
          where: { id: fixture.sourceSegmentId },
        });
        expect(sourceSegment.status).toBe('CLOSED');
        expect(sourceSegment.effectiveTo).toEqual(new Date(manilaDate(-2)));

        const sourceIncumbency = await admin.positionIncumbency.findFirstOrThrow({
          where: { agencyId: fixture.agencyId, serviceSegmentId: fixture.sourceSegmentId },
        });
        expect(sourceIncumbency.status).toBe('ENDED');
        expect(sourceIncumbency.effectiveTo).toEqual(new Date(manilaDate(-2)));

        const sourcePosition = await admin.plantillaPosition.findUniqueOrThrow({
          where: { id: fixture.sourcePositionId },
        });
        expect(sourcePosition.status).toBe('VACANT');

        const successor = await admin.serviceSegment.findFirstOrThrow({
          where: { agencyId: fixture.agencyId, personnelActionId: created.id },
        });
        expect(successor).toMatchObject({
          employeeId: fixture.employeeId,
          appointmentId: fixture.appointment.id,
          positionId: fixture.targetPositionId,
          organizationUnitId: fixture.targetUnitId,
          segmentType: 'PRIMARY',
          appointmentStatus: 'PERMANENT',
          salaryGrade: 13,
          salaryStep: 3,
          status: 'ACTIVE',
          effectiveTo: null,
        });
        expect(successor.effectiveFrom).toEqual(new Date(fixture.appointment.assumptionDate));

        const targetIncumbency = await admin.positionIncumbency.findFirstOrThrow({
          where: { agencyId: fixture.agencyId, serviceSegmentId: successor.id },
        });
        expect(targetIncumbency).toMatchObject({
          employeeId: fixture.employeeId,
          positionId: fixture.targetPositionId,
          status: 'ACTIVE',
        });

        const targetPosition = await admin.plantillaPosition.findUniqueOrThrow({
          where: { id: fixture.targetPositionId },
        });
        expect(targetPosition.status).toBe('OCCUPIED');

        const employee = await admin.employee.findUniqueOrThrow({
          where: { id: fixture.employeeId },
        });
        expect(employee).toMatchObject({
          serviceStatus: 'ACTIVE',
          currentServiceSegmentId: successor.id,
        });

        const audit = await admin.auditEvent.findFirstOrThrow({
          where: {
            agencyId: fixture.agencyId,
            action: 'PERSONNEL_ACTION_EFFECTUATED',
            entityId: created.id,
          },
        });
        expect(audit.idempotencyKey).toBe(effectuationKey);
        expect(audit.metadata).toMatchObject({
          appointmentId: fixture.appointment.id,
          appointmentVersionId: fixture.appointment.versionId,
          targetPositionId: fixture.targetPositionId,
        });

        const outbox = await admin.outboxEvent.findFirstOrThrow({
          where: {
            agencyId: fixture.agencyId,
            eventType: 'PERSONNEL_ACTION_EFFECTUATED',
            aggregateId: created.id,
          },
        });
        expect(outbox.payload).toMatchObject({
          actionType,
          sourceServiceSegmentId: fixture.sourceSegmentId,
          successorServiceSegmentId: successor.id,
          sourcePositionId: fixture.sourcePositionId,
          targetPositionId: fixture.targetPositionId,
          appointmentId: fixture.appointment.id,
          appointmentVersionId: fixture.appointment.versionId,
          effectivity: fixture.appointment.assumptionDate,
        });

        const retried = await fixture.service.effectuate(
          fixture.preparer,
          created.id,
          effectuationKey,
        );
        expect(retried.status).toBe('EFFECTIVE');
        await expect(
          fixture.service.effectuate(fixture.preparer, created.id, `other-${fixture.suffix}`),
        ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_IDEMPOTENCY_CONFLICT' });

        const remaining = await fixture.appointments.listMovementCandidates(fixture.authority);
        expect(remaining.map(({ appointmentVersionId }) => appointmentVersionId)).not.toContain(
          fixture.appointment.versionId,
        );
      } finally {
        await fixture.dispose();
      }
    },
  );
}

it.skipIf(!enabled)(
  'stops consuming an Appointment version once a correction makes it stale',
  async () => {
    const fixture = await setupMovementFixture({
      label: 'stale-contract',
      employeeStatus: 'ACTIVE',
      nature: 'PROMOTION',
    });
    const { admin } = fixture;
    try {
      const created = await fixture.service.create(fixture.preparer, {
        employeeId: fixture.employeeId,
        actionType: 'PROMOTION',
        proposedEffectivity: fixture.appointment.assumptionDate,
        targetFacts: { appointmentVersionId: fixture.appointment.versionId },
        reason: 'The Appointing Authority promoted the Employee to the reserved item.',
        evidence: [fixture.evidence.AUTHORITY],
      });
      await fixture.service.submit(fixture.preparer, created.id);
      await fixture.service.review(fixture.reviewer, created.id, {
        decision: 'ENDORSE',
        reason: 'The movement record is complete.',
      });

      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const successor = await transaction.appointmentVersion.create({
          data: {
            agencyId: fixture.agencyId,
            appointmentId: fixture.appointment.id,
            versionNo: 2,
            employmentStatus: 'PERMANENT',
            natureOfAppointment: 'PROMOTION',
            salaryGrade: 13,
            salaryStep: 3,
            effectivityDate: new Date(fixture.appointment.assumptionDate),
            appointingAuthorityMembershipId: fixture.authority.membershipId,
            formVariant: 'CS_FORM_33_A_2025',
            signatureMethod: 'WET_INK',
            appointmentDocumentVersionId: fixture.evidence.AUTHORITY.documentVersionId,
            status: 'DRAFT',
            replacesVersionId: fixture.appointment.versionId,
            correctionReason: 'The Appointing Authority corrected the Appointment.',
            correctionAuthorityDocumentVersionId: fixture.evidence.AUTHORITY.documentVersionId,
            createdByMembershipId: fixture.preparer.membershipId,
            updatedByMembershipId: fixture.preparer.membershipId,
          },
          select: { id: true },
        });
        await transaction.appointment.update({
          where: { id: fixture.appointment.id },
          data: { workflowStatus: 'DRAFT', currentVersionId: successor.id },
        });
      });

      const candidates = await fixture.appointments.listMovementCandidates(fixture.authority);
      expect(candidates.map(({ appointmentVersionId }) => appointmentVersionId)).not.toContain(
        fixture.appointment.versionId,
      );

      await expect(
        fixture.service.decide(fixture.authority, created.id, {
          decision: 'APPROVE',
          reason: 'The promotion is approved under current authority.',
        }),
      ).rejects.toMatchObject({ code: 'PERSONNEL_ACTION_APPOINTMENT_CONTRACT_INVALID' });
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'effectuates a comparable reinstatement from a preserved closed Service Segment',
  async () => {
    const fixture = await setupMovementFixture({
      label: 'reinstatement',
      employeeStatus: 'SEPARATED',
      nature: 'REINSTATEMENT',
    });
    const { admin } = fixture;
    try {
      const input: PersonnelActionInput = {
        employeeId: fixture.employeeId,
        actionType: 'COMPARABLE_REINSTATEMENT',
        proposedEffectivity: fixture.appointment.assumptionDate,
        targetFacts: { appointmentVersionId: fixture.appointment.versionId },
        reason: 'The Appointing Authority approved the comparable reinstatement.',
        evidence: [
          fixture.evidence.EXECUTORY_DECISION,
          fixture.evidence.PRIOR_SEPARATION,
          fixture.evidence.NO_MISCONDUCT,
          fixture.evidence.AUTHORITY,
        ],
      };

      const created = await fixture.service.create(fixture.preparer, input);
      expect(created.currentVersion.targetPositionId).toBe(fixture.targetPositionId);

      await fixture.service.submit(fixture.preparer, created.id);
      await fixture.service.review(fixture.reviewer, created.id, {
        decision: 'ENDORSE',
        reason: 'The reinstatement record is complete.',
      });
      await fixture.service.decide(fixture.authority, created.id, {
        decision: 'APPROVE',
        reason: 'The comparable reinstatement is approved under current authority.',
      });

      const effectuated = await fixture.service.effectuate(
        fixture.preparer,
        created.id,
        `movement-reinstatement-${fixture.suffix}`,
      );
      expect(effectuated.status).toBe('EFFECTIVE');

      const sourceSegment = await admin.serviceSegment.findUniqueOrThrow({
        where: { id: fixture.sourceSegmentId },
      });
      expect(sourceSegment.status).toBe('CLOSED');
      expect(sourceSegment.effectiveTo).toEqual(new Date(manilaDate(-10)));

      const sourcePosition = await admin.plantillaPosition.findUniqueOrThrow({
        where: { id: fixture.sourcePositionId },
      });
      expect(sourcePosition.status).toBe('OCCUPIED');

      const successor = await admin.serviceSegment.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, personnelActionId: created.id },
      });
      expect(successor).toMatchObject({
        appointmentId: fixture.appointment.id,
        positionId: fixture.targetPositionId,
        organizationUnitId: fixture.targetUnitId,
        appointmentStatus: 'PERMANENT',
        salaryGrade: 13,
        salaryStep: 3,
        status: 'ACTIVE',
      });
      expect(successor.effectiveFrom).toEqual(new Date(fixture.appointment.assumptionDate));

      const targetPosition = await admin.plantillaPosition.findUniqueOrThrow({
        where: { id: fixture.targetPositionId },
      });
      expect(targetPosition.status).toBe('OCCUPIED');

      const employee = await admin.employee.findUniqueOrThrow({
        where: { id: fixture.employeeId },
      });
      expect(employee).toMatchObject({
        serviceStatus: 'ACTIVE',
        currentServiceSegmentId: successor.id,
      });
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'rejects a movement when the Employee is not the Appointment appointee',
  async () => {
    const fixture = await setupMovementFixture({
      label: 'identity-mismatch',
      employeeStatus: 'ACTIVE',
      nature: 'PROMOTION',
    });
    try {
      const input: PersonnelActionInput = {
        employeeId: fixture.employeeId,
        actionType: 'PROMOTION',
        proposedEffectivity: fixture.appointment.assumptionDate,
        targetFacts: { appointmentVersionId: fixture.appointment.versionId },
        reason: 'The Appointing Authority approved the promotion.',
        evidence: [fixture.evidence.AUTHORITY],
      };

      await fixture.admin.employee.update({
        where: { id: fixture.employeeId },
        data: { personKey: null },
      });
      await expect(fixture.service.create(fixture.preparer, input)).rejects.toMatchObject({
        code: 'PERSONNEL_ACTION_APPOINTEE_MISMATCH',
        statusCode: 409,
      });

      await fixture.admin.employee.update({
        where: { id: fixture.employeeId },
        data: { personKey: randomUUID() },
      });
      await expect(fixture.service.create(fixture.preparer, input)).rejects.toMatchObject({
        code: 'PERSONNEL_ACTION_APPOINTEE_MISMATCH',
        statusCode: 409,
      });

      await fixture.admin.employee.update({
        where: { id: fixture.employeeId },
        data: { personKey: fixture.personKey },
      });
      const created = await fixture.service.create(fixture.preparer, input);
      expect(created.effectuationAvailable).toBe(true);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'rejects effectuation when the Employee loses their bound person identity after approval',
  async () => {
    const fixture = await setupMovementFixture({
      label: 'identity-drift',
      employeeStatus: 'ACTIVE',
      nature: 'PROMOTION',
    });
    try {
      const created = await fixture.service.create(fixture.preparer, {
        employeeId: fixture.employeeId,
        actionType: 'PROMOTION',
        proposedEffectivity: fixture.appointment.assumptionDate,
        targetFacts: { appointmentVersionId: fixture.appointment.versionId },
        reason: 'The Appointing Authority approved the promotion.',
        evidence: [fixture.evidence.AUTHORITY],
      });
      await fixture.service.submit(fixture.preparer, created.id);
      await fixture.service.review(fixture.reviewer, created.id, {
        decision: 'ENDORSE',
        reason: 'The movement record is complete.',
      });
      await fixture.service.decide(fixture.authority, created.id, {
        decision: 'APPROVE',
        reason: 'The promotion is approved under current authority.',
      });

      await fixture.admin.employee.update({
        where: { id: fixture.employeeId },
        data: { personKey: null },
      });

      await expect(
        fixture.service.effectuate(
          fixture.preparer,
          created.id,
          `movement-identity-drift-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({
        code: 'PERSONNEL_ACTION_APPOINTEE_MISMATCH',
        statusCode: 409,
      });
      expect(
        await fixture.admin.serviceSegment.count({
          where: { agencyId: fixture.agencyId, personnelActionId: created.id },
        }),
      ).toBe(0);
    } finally {
      await fixture.dispose();
    }
  },
);
