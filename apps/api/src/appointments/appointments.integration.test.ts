import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { DocumentsService } from '../documents/documents.service';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from '../plantilla-positions/plantilla-positions.service';
import type { QualificationStandardsService } from '../qualification-standards/qualification-standards.service';
import { SelectionService } from '../recruitment/selection.service';
import { AppointmentsService, type AppointmentLinkRole } from './appointments.service';

const enabled = process.env.DATABASE_E2E === 'true';

const PREPARER_PERMISSIONS = [
  'appointments.records.read',
  'appointments.records.create',
  'appointments.records.submit',
  'appointments.records.return',
  'appointments.records.endorse',
  'appointments.records.issue',
  'appointments.records.cancel',
  'appointments.settings.manage',
  'appointments.external_events.record',
  'appointments.external_actions.record',
];

const AUTHORITY_PERMISSIONS = [
  'appointments.records.read',
  'appointments.records.issue',
  'appointments.records.cancel',
];

const EVIDENCE_ROLES = [
  'PDS',
  'WORK_EXPERIENCE_SHEET',
  'ELIGIBILITY_PROOF',
  'POSITION_DESCRIPTION_FORM',
  'SELECTION_CERTIFICATION',
  'PUBLICATION_CERTIFICATION',
  'AUTHORITY_OR_DELEGATION',
] as const;

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  requestId: string,
  permissions: readonly string[],
): RequestContext {
  return {
    agencyId,
    userId,
    membershipId,
    requestId,
    primaryOrganizationUnitId: null,
    permissions: permissions.map((code) => ({ code, scopePolicy: 'AGENCY' })),
  };
}

function createFixtureIds() {
  return {
    statusEvidenceDocument: randomUUID(),
    statusEvidenceVersion: randomUUID(),
    formDocument: randomUUID(),
    formVersion: randomUUID(),
    signatureEvidenceDocument: randomUUID(),
    signatureEvidenceVersion: randomUUID(),
    correctionAuthorityDocument: randomUUID(),
    correctionAuthorityVersion: randomUUID(),
    cancellationAuthorityDocument: randomUUID(),
    cancellationAuthorityVersion: randomUUID(),
    unfinalizedDocument: randomUUID(),
    unfinalizedVersion: randomUUID(),
    staffingAuthority: randomUUID(),
    unit: randomUUID(),
    unitVersion: randomUUID(),
    qualificationStandard: randomUUID(),
    qualificationVersion: randomUUID(),
    position: randomUUID(),
    positionVersion: randomUUID(),
    handoff: randomUUID(),
    selectionDecision: randomUUID(),
    applicant: randomUUID(),
  };
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

interface Fixture {
  agencyId: string;
  suffix: string;
  ids: FixtureIds;
  admin: PrismaClient;
  preparer: RequestContext;
  authority: RequestContext;
  appointments: AppointmentsService;
  setQualificationUsable: (usable: boolean) => void;
  dispose: () => Promise<void>;
}

async function setupFixture(label: string): Promise<Fixture> {
  const runtimeUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!runtimeUrl || !adminUrl) {
    throw new Error('Runtime and administrative database URLs are required.');
  }
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const agency = await admin.agency.create({
    data: {
      code: `APPT-${label}-${suffix}`,
      name: `Appointment ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  async function createMember(name: string): Promise<{ userId: string; membershipId: string }> {
    const user = await admin.user.create({
      data: {
        identityProvider: `appointment-${label}`,
        externalSubject: `${label}-${name}-${suffix}`,
        emailNormalized: `${label}-${name}-${suffix}@example.test`,
        displayName: name,
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    return { userId: user.id, membershipId: membership.id };
  }
  const preparer = await createMember('Personnel Records Officer');
  const authority = await createMember('Appointing Authority');

  const ids = createFixtureIds();
  const finalized = new Map<
    string,
    { documentId: string; documentNo: string; documentType: string }
  >();
  const evidenceVersionIds = new Map<string, string>();

  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const documents: Array<{
      documentId: string;
      versionId: string;
      documentType: string;
      issued: boolean;
    }> = [
      {
        documentId: ids.statusEvidenceDocument,
        versionId: ids.statusEvidenceVersion,
        documentType: 'AGENCY_ACCREDITATION',
        issued: true,
      },
      {
        documentId: ids.formDocument,
        versionId: ids.formVersion,
        documentType: 'APPOINTMENT_FORM',
        issued: true,
      },
      {
        documentId: ids.signatureEvidenceDocument,
        versionId: ids.signatureEvidenceVersion,
        documentType: 'SIGNATURE_CERTIFICATION',
        issued: true,
      },
      {
        documentId: ids.correctionAuthorityDocument,
        versionId: ids.correctionAuthorityVersion,
        documentType: 'CORRECTION_AUTHORITY',
        issued: true,
      },
      {
        documentId: ids.cancellationAuthorityDocument,
        versionId: ids.cancellationAuthorityVersion,
        documentType: 'CANCELLATION_AUTHORITY',
        issued: true,
      },
      {
        documentId: ids.unfinalizedDocument,
        versionId: ids.unfinalizedVersion,
        documentType: 'UNFINALIZED_EVIDENCE',
        issued: false,
      },
      ...EVIDENCE_ROLES.map((role) => {
        const documentId = randomUUID();
        const versionId = randomUUID();
        evidenceVersionIds.set(role, versionId);
        return { documentId, versionId, documentType: role, issued: true };
      }),
    ];
    for (const [index, entry] of documents.entries()) {
      await transaction.$executeRaw`
        INSERT INTO "documents"
          ("id", "agency_id", "document_no", "document_type", "classification", "status",
           "created_by_membership_id")
        VALUES
          (${entry.documentId}::uuid, ${agency.id}::uuid,
           ${`APPT-${label}-${index}-${suffix}`}, ${entry.documentType}, 'CONFIDENTIAL',
           'APPROVED', ${preparer.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "document_versions"
          ("id", "agency_id", "document_id", "version_no", "storage_key", "content_hash",
           "mime_type", "size_bytes", "issued_at", "created_by_membership_id")
        VALUES
          (${entry.versionId}::uuid, ${agency.id}::uuid, ${entry.documentId}::uuid, 1,
           ${`e2e/appointment-${label}-${entry.versionId}`}, ${'a'.repeat(64)}, 'application/pdf',
           1, ${entry.issued ? new Date() : null}, ${preparer.membershipId}::uuid)
      `;
      if (entry.issued) {
        finalized.set(entry.versionId, {
          documentId: entry.documentId,
          documentNo: `APPT-${label}-${index}-${suffix}`,
          documentType: entry.documentType,
        });
      }
    }
    await transaction.$executeRaw`
      INSERT INTO "qualification_standards"
        ("id", "agency_id", "code", "name", "status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.qualificationStandard}::uuid, ${agency.id}::uuid, ${`APPT-QS-${suffix}`},
         'Appointment Standard', 'ACTIVE', ${preparer.membershipId}::uuid,
         ${preparer.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "qualification_standard_versions"
        ("id", "agency_id", "qualification_standard_id", "version_no",
         "education_requirement", "source_document_id", "source_evidence_version_id",
         "source_evidence_validated_at", "source_evidence_validated_by_membership_id",
         "source_evidence_validation_reason", "approval_document_id",
         "approval_evidence_version_id", "approval_evidence_validated_at",
         "approval_evidence_validated_by_membership_id", "approval_evidence_validation_reason",
         "effective_from", "status", "domain_status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.qualificationVersion}::uuid, ${agency.id}::uuid,
         ${ids.qualificationStandard}::uuid, 1, 'Bachelor degree',
         ${ids.formDocument}::uuid, ${ids.formVersion}::uuid, now(),
         ${preparer.membershipId}::uuid, 'Appointment fixture source reviewed.',
         ${ids.formDocument}::uuid, ${ids.formVersion}::uuid, now(),
         ${preparer.membershipId}::uuid, 'Appointment fixture approval reviewed.',
         '2000-01-01'::date, 'ACTIVE', 'ACTIVE', ${preparer.membershipId}::uuid,
         ${preparer.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "staffing_authorities"
        ("id", "agency_id", "authority_type", "reference_no", "issued_date", "effective_date",
         "document_id", "evidence_version_id", "evidence_validated_at",
         "evidence_validated_by_membership_id", "evidence_validation_reason", "status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.staffingAuthority}::uuid, ${agency.id}::uuid, 'DBM_APPROVAL',
         ${`APPT-AUTH-${suffix}`}, '2000-01-01'::date, '2000-01-01'::date,
         ${ids.formDocument}::uuid, ${ids.formVersion}::uuid, now(),
         ${preparer.membershipId}::uuid, 'Appointment fixture authority reviewed.', 'ACTIVE',
         ${preparer.membershipId}::uuid, ${preparer.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "organization_units"
        ("id", "agency_id", "code", "unit_type", "status", "current_version_id")
      VALUES
        (${ids.unit}::uuid, ${agency.id}::uuid, ${`APPT-UNIT-${suffix}`}, 'DIVISION',
         'ACTIVE', ${ids.unitVersion}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "organization_unit_versions"
        ("id", "agency_id", "organization_unit_id", "version_no", "name",
         "effective_from", "status", "domain_status")
      VALUES
        (${ids.unitVersion}::uuid, ${agency.id}::uuid, ${ids.unit}::uuid, 1,
         'Appointment Division', '2000-01-01'::date, 'ACTIVE', 'ACTIVE')
    `;
    await transaction.$executeRaw`
      INSERT INTO "plantilla_positions"
        ("id", "agency_id", "item_number", "status", "current_version_id",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.position}::uuid, ${agency.id}::uuid, ${`APPT-ITEM-${suffix}`}, 'RESERVED',
         ${ids.positionVersion}::uuid, ${preparer.membershipId}::uuid,
         ${preparer.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "plantilla_position_versions"
        ("id", "agency_id", "position_id", "organization_unit_id",
         "qualification_standard_version_id", "staffing_authority_id", "version_no",
         "position_title", "salary_grade", "funding_source", "employment_category",
         "effective_from", "status", "domain_status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.positionVersion}::uuid, ${agency.id}::uuid, ${ids.position}::uuid,
         ${ids.unit}::uuid, ${ids.qualificationVersion}::uuid, ${ids.staffingAuthority}::uuid, 1,
         'Human Resource Management Officer III', 18, 'General Appropriations Act',
         'PLANTILLA', '2000-01-01'::date, 'ACTIVE', 'RESERVED',
         ${preparer.membershipId}::uuid, ${preparer.membershipId}::uuid)
    `;
    const selectionPackage = {
      selectionDecisionId: ids.selectionDecision,
      decision: 'SELECTED',
      applicant: {
        id: ids.applicant,
        fullName: 'Ana Reyes',
        email: null,
        mobileNumber: null,
      },
      applicationNo: `APPT-APP-${suffix}`,
      qualificationStandardVersionId: ids.qualificationVersion,
      position: {
        id: ids.position,
        itemNumber: `APPT-ITEM-${suffix}`,
        positionVersionId: ids.positionVersion,
        title: 'Human Resource Management Officer III',
        salaryGrade: 18,
        organizationUnitId: ids.unit,
      },
      documents: [],
    };
    await transaction.$executeRaw`
      INSERT INTO "recruitment_appointment_handoffs"
        ("id", "agency_id", "selection_decision_id", "application_id", "position_id",
         "selection_package", "idempotency_key", "handed_off_at")
      VALUES
        (${ids.handoff}::uuid, ${agency.id}::uuid, ${ids.selectionDecision}::uuid,
         ${randomUUID()}::uuid, ${ids.position}::uuid,
         ${JSON.stringify(selectionPackage)}::jsonb, ${`APPT-HANDOFF-${suffix}`}, now())
    `;
  });

  let qualificationUsable = true;
  const documents = {
    resolveFinalizedVersionInTransaction: async (
      _transaction: unknown,
      _context: unknown,
      requestedDocumentVersionId: string,
    ) => {
      const entry = finalized.get(requestedDocumentVersionId);
      return entry
        ? {
            id: requestedDocumentVersionId,
            documentId: entry.documentId,
            documentNo: entry.documentNo,
            documentType: entry.documentType,
            classification: 'CONFIDENTIAL',
            status: 'APPROVED',
            issuedAt: new Date().toISOString(),
          }
        : null;
    },
  } as unknown as DocumentsService;
  const qualificationStandards = {
    resolveUsableInTransaction: async () =>
      qualificationUsable
        ? { usable: true as const, version: {} as never }
        : { usable: false as const, reason: 'EVIDENCE_REQUIRED' as const },
  } as unknown as QualificationStandardsService;
  const plantilla = new PlantillaPositionsService(plantillaPositionAuditWriter, documents as never);
  const selection = new SelectionService(plantilla, documents as never);
  const appointments = new AppointmentsService(
    documents as never,
    plantilla,
    qualificationStandards,
    selection,
  );

  return {
    agencyId: agency.id,
    suffix,
    ids,
    admin,
    preparer: context(
      agency.id,
      preparer.userId,
      preparer.membershipId,
      `appointment-preparer-${suffix}`,
      PREPARER_PERMISSIONS,
    ),
    authority: context(
      agency.id,
      authority.userId,
      authority.membershipId,
      `appointment-authority-${suffix}`,
      AUTHORITY_PERMISSIONS,
    ),
    appointments,
    setQualificationUsable: (usable: boolean) => {
      qualificationUsable = usable;
    },
    dispose: async () => {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of [
          'appointment_external_submission_events',
          'appointment_external_actions',
          'appointment_document_version_links',
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
          'audit_events',
        ]) {
          await transaction.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "agency_id" = '${agency.id}'::uuid`,
          );
        }
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.deleteMany({
        where: { emailNormalized: { endsWith: `-${suffix}@example.test` } },
      });
      await admin.$disconnect();
    },
  };
}

function versionInput(
  fixture: Fixture,
  overrides: Partial<{
    employmentStatus: 'PERMANENT';
    natureOfAppointment: 'ORIGINAL';
    salaryGrade: number;
    salaryStep: number;
    effectivityDate: string;
    appointingAuthorityMembershipId: string;
    signatureMethod: 'WET_INK' | 'ELECTRONIC';
    signatureEvidenceDocumentVersionId: string;
    appointmentDocumentVersionId: string;
    evidence: Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }>;
  }> = {},
) {
  return {
    employmentStatus: 'PERMANENT' as const,
    natureOfAppointment: 'ORIGINAL' as const,
    salaryGrade: 18,
    salaryStep: 1,
    effectivityDate: '2026-10-01',
    appointingAuthorityMembershipId: fixture.authority.membershipId,
    signatureMethod: 'WET_INK' as const,
    appointmentDocumentVersionId: fixture.ids.formVersion,
    evidence: [
      { linkRole: 'PDS', documentVersionId: fixture.ids.formVersion },
      { linkRole: 'WORK_EXPERIENCE_SHEET', documentVersionId: fixture.ids.formVersion },
      { linkRole: 'ELIGIBILITY_PROOF', documentVersionId: fixture.ids.formVersion },
      { linkRole: 'POSITION_DESCRIPTION_FORM', documentVersionId: fixture.ids.formVersion },
      { linkRole: 'SELECTION_CERTIFICATION', documentVersionId: fixture.ids.formVersion },
      { linkRole: 'PUBLICATION_CERTIFICATION', documentVersionId: fixture.ids.formVersion },
      { linkRole: 'AUTHORITY_OR_DELEGATION', documentVersionId: fixture.ids.formVersion },
    ] as Array<{ linkRole: AppointmentLinkRole; documentVersionId: string }>,
    ...overrides,
  };
}

it.skipIf(!enabled)(
  'prepares, reviews, issues, corrects, and cancels an Appointment through Plantilla',
  async () => {
    const fixture = await setupFixture('MAIN');
    const { ids, admin, preparer, authority, appointments } = fixture;
    try {
      await expect(
        appointments.create(preparer, {
          selectionDecisionId: ids.selectionDecision,
          ...versionInput(fixture),
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_AGENCY_CONFIGURATION_REQUIRED',
        statusCode: 409,
      });

      const settings = await appointments.configureSettings(preparer, {
        regulatoryStatus: 'REGULATED',
        statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
      });
      expect(settings.formVariant).toBe('CS_FORM_33_A_2025');

      const eligible = await appointments.listEligibleSelections(preparer);
      expect(eligible.selections).toHaveLength(1);
      expect(eligible.selections[0]?.appointment).toBeNull();
      expect(eligible.selections[0]?.applicant.fullName).toBe('Ana Reyes');

      const created = await appointments.create(
        preparer,
        { selectionDecisionId: ids.selectionDecision, ...versionInput(fixture) },
        'main-create',
      );
      expect(created.workflowStatus).toBe('DRAFT');
      expect(created.currentVersion?.status).toBe('DRAFT');
      expect(created.currentVersion?.formVariant).toBe('CS_FORM_33_A_2025');
      expect(created.currentVersion?.effectivityDate).toBe('2026-10-01');
      expect(created.versions[0]?.evidence).toHaveLength(7);
      expect(created.history.map((event) => event.action)).toEqual(['APPOINTMENT_PREPARED']);

      const replayed = await appointments.create(
        preparer,
        { selectionDecisionId: ids.selectionDecision, ...versionInput(fixture) },
        'main-create',
      );
      expect(replayed.id).toBe(created.id);

      await expect(
        appointments.create(preparer, {
          selectionDecisionId: ids.selectionDecision,
          ...versionInput(fixture),
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_ALREADY_PREPARED', statusCode: 409 });

      const listed = await appointments.list(preparer, { status: 'DRAFT', limit: 50, offset: 0 });
      expect(listed.items.map((item) => item.id)).toEqual([created.id]);

      const updated = await appointments.updateDraft(
        preparer,
        created.id,
        versionInput(fixture, { salaryStep: 2 }),
      );
      expect(updated.currentVersion?.salaryStep).toBe(2);

      const submitted = await appointments.submit(preparer, created.id, 'main-submit');
      expect(submitted.workflowStatus).toBe('FOR_REVIEW');

      const returned = await appointments.returnForCorrection(
        preparer,
        created.id,
        { reason: 'Attach the signed publication certification.' },
        'main-return',
      );
      expect(returned.workflowStatus).toBe('DRAFT');
      expect(returned.currentVersion?.id).toBe(updated.currentVersion?.id);
      expect(returned.history.map((event) => event.action)).toEqual([
        'APPOINTMENT_PREPARED',
        'APPOINTMENT_DRAFT_UPDATED',
        'APPOINTMENT_SUBMITTED',
        'APPOINTMENT_RETURNED',
      ]);

      await appointments.submit(preparer, created.id);
      const endorsed = await appointments.endorse(preparer, created.id, 'main-endorse');
      expect(endorsed.workflowStatus).toBe('FOR_SIGNATURE');

      await expect(appointments.issue(preparer, created.id)).rejects.toMatchObject({
        code: 'APPOINTMENT_ISSUER_FORBIDDEN',
        statusCode: 403,
      });

      const issued = await appointments.issue(authority, created.id, 'main-issue');
      expect(issued.workflowStatus).toBe('ISSUED');
      expect(issued.currentVersion?.status).toBe('ISSUED');
      expect(issued.issuedAt).not.toBeNull();

      const reservedVersions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(reservedVersions.at(-1)?.domainStatus).toBe('RESERVED');

      await expect(
        appointments.updateDraft(preparer, created.id, versionInput(fixture)),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_TRANSITION_NOT_ALLOWED' });

      const corrected = await appointments.correct(
        preparer,
        created.id,
        {
          ...versionInput(fixture, { salaryStep: 3 }),
          reason: 'Correct the salary step after authority review.',
          authorityDocumentVersionId: ids.correctionAuthorityVersion,
        },
        'main-correct',
      );
      expect(corrected.workflowStatus).toBe('DRAFT');
      expect(corrected.versions).toHaveLength(2);
      const predecessor = corrected.versions[0];
      const successor = corrected.versions[1];
      expect(predecessor?.status).toBe('ISSUED');
      expect(successor?.status).toBe('DRAFT');
      expect(successor?.versionNo).toBe(2);
      expect(successor?.replacesVersionId).toBe(predecessor?.id);
      expect(successor?.correctionReason).toBe('Correct the salary step after authority review.');
      expect(successor?.correctionAuthorityDocumentVersionId).toBe(ids.correctionAuthorityVersion);

      await appointments.submit(preparer, created.id);
      await appointments.endorse(preparer, created.id);
      const reissued = await appointments.issue(authority, created.id);
      expect(reissued.workflowStatus).toBe('ISSUED');
      expect(reissued.versions.map((version) => version.status)).toEqual(['SUPERSEDED', 'ISSUED']);

      const cancelled = await appointments.cancel(
        authority,
        created.id,
        {
          reason: 'The appointing authority withdrew the appointment.',
          authorityDocumentVersionId: ids.cancellationAuthorityVersion,
        },
        'main-cancel',
      );
      expect(cancelled.workflowStatus).toBe('CANCELLED');

      const releasedVersions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(releasedVersions.at(-1)?.domainStatus).toBe('VACANT');
      const releaseEvent = await admin.auditEvent.findFirst({
        where: { agencyId: fixture.agencyId, action: 'PLANTILLA_POSITION_RESERVATION_RELEASED' },
      });
      expect(releaseEvent).not.toBeNull();
      const cancellationEvent = await admin.auditEvent.findFirst({
        where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_CANCELLED' },
      });
      expect(cancellationEvent?.metadata).toMatchObject({ reservationReleased: true });

      const eligibleAfter = await appointments.listEligibleSelections(preparer);
      expect(eligibleAfter.selections[0]?.appointment).toMatchObject({
        id: created.id,
        workflowStatus: 'CANCELLED',
      });
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'blocks preparation and endorsement without valid package, reservation, evidence, or configuration',
  async () => {
    const fixture = await setupFixture('GUARDS');
    const { ids, preparer, authority, appointments } = fixture;
    try {
      await appointments.configureSettings(preparer, {
        regulatoryStatus: 'REGULATED',
        statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
      });

      await expect(
        appointments.create(preparer, {
          selectionDecisionId: randomUUID(),
          ...versionInput(fixture),
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_SELECTION_NOT_FOUND', statusCode: 404 });

      const completeEvidence = versionInput(fixture).evidence;
      await expect(
        appointments.create(preparer, {
          selectionDecisionId: ids.selectionDecision,
          ...versionInput(fixture, { evidence: completeEvidence.slice(0, 6) }),
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_EVIDENCE_REQUIRED', statusCode: 409 });

      await expect(
        appointments.create(preparer, {
          selectionDecisionId: ids.selectionDecision,
          ...versionInput(fixture, {
            evidence: [
              ...completeEvidence.slice(0, 6),
              { linkRole: 'AUTHORITY_OR_DELEGATION', documentVersionId: ids.unfinalizedVersion },
            ],
          }),
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_EVIDENCE_INVALID', statusCode: 409 });

      await expect(
        appointments.create(preparer, {
          selectionDecisionId: ids.selectionDecision,
          ...versionInput(fixture, { salaryGrade: 19 }),
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_SALARY_GRADE_MISMATCH', statusCode: 409 });

      await expect(
        appointments.create(preparer, {
          selectionDecisionId: ids.selectionDecision,
          ...versionInput(fixture, { signatureMethod: 'ELECTRONIC' }),
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_SIGNATURE_EVIDENCE_REQUIRED',
        statusCode: 409,
      });

      const created = await appointments.create(preparer, {
        selectionDecisionId: ids.selectionDecision,
        ...versionInput(fixture),
      });
      await appointments.submit(preparer, created.id);

      fixture.setQualificationUsable(false);
      await expect(appointments.endorse(preparer, created.id)).rejects.toMatchObject({
        code: 'APPOINTMENT_QUALIFICATION_INVALID',
        statusCode: 409,
      });
      fixture.setQualificationUsable(true);
      await appointments.endorse(preparer, created.id);

      await appointments.configureSettings(preparer, {
        regulatoryStatus: 'ACCREDITED_OR_DEREGULATED',
        statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
      });
      await expect(appointments.issue(authority, created.id)).rejects.toMatchObject({
        code: 'APPOINTMENT_FORM_VARIANT_INVALID',
        statusCode: 409,
      });
      await appointments.configureSettings(preparer, {
        regulatoryStatus: 'REGULATED',
        statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
      });

      await expect(
        appointments.cancel(authority, created.id, {
          reason: 'The cancellation authority must be a finalized Document Version.',
          authorityDocumentVersionId: ids.unfinalizedVersion,
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_CANCELLATION_AUTHORITY_INVALID',
        statusCode: 409,
      });

      const cancelled = await appointments.cancel(authority, created.id, {
        reason: 'The appointing authority cancelled before signature.',
        authorityDocumentVersionId: ids.cancellationAuthorityVersion,
      });
      expect(cancelled.workflowStatus).toBe('CANCELLED');
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'tracks CSC submissions and official actions against the issued Appointment Version',
  async () => {
    const fixture = await setupFixture('EXTERNAL');
    const { ids, admin, preparer, authority, appointments } = fixture;
    try {
      await appointments.configureSettings(preparer, {
        regulatoryStatus: 'REGULATED',
        statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
      });
      const created = await appointments.create(preparer, {
        selectionDecisionId: ids.selectionDecision,
        ...versionInput(fixture),
      });
      const draftVersionId = created.currentVersion?.id ?? '';

      await expect(
        appointments.recordExternalSubmission(preparer, created.id, {
          appointmentVersionId: draftVersionId,
          eventType: 'SUBMITTED',
          occurredAt: '2026-10-02T01:00:00.000Z',
          receivingOffice: 'CSC Field Office',
          evidenceDocumentVersionId: ids.formVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_EXTERNAL_NOT_ISSUED', statusCode: 409 });

      await appointments.submit(preparer, created.id);
      await appointments.endorse(preparer, created.id);
      const issued = await appointments.issue(authority, created.id, 'external-issue');
      const versionId = issued.currentVersion?.id ?? '';
      expect(issued.externalStanding).toBe('NOT_SUBMITTED');

      await expect(
        appointments.recordExternalSubmission(preparer, created.id, {
          appointmentVersionId: versionId,
          eventType: 'SUBMITTED',
          occurredAt: '2026-10-02T01:00:00.000Z',
          receivingOffice: 'CSC Field Office',
          evidenceDocumentVersionId: ids.unfinalizedVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_EXTERNAL_EVIDENCE_INVALID', statusCode: 409 });

      await expect(
        appointments.recordExternalSubmission(preparer, created.id, {
          appointmentVersionId: randomUUID(),
          eventType: 'SUBMITTED',
          occurredAt: '2026-10-02T01:00:00.000Z',
          receivingOffice: 'CSC Field Office',
          evidenceDocumentVersionId: ids.formVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_EXTERNAL_VERSION_INVALID', statusCode: 409 });

      const submission = {
        appointmentVersionId: versionId,
        eventType: 'SUBMITTED' as const,
        externalReference: 'CSC-2026-0001',
        occurredAt: '2026-10-02T01:00:00.000Z',
        receivingOffice: 'CSC Field Office',
        evidenceDocumentVersionId: ids.formVersion,
      };
      const submitted = await appointments.recordExternalSubmission(
        preparer,
        created.id,
        submission,
        'external-submit',
      );
      expect(submitted.externalStanding).toBe('SUBMITTED');
      expect(submitted.externalSubmissions).toHaveLength(1);
      expect(submitted.externalSubmissions[0]).toMatchObject({
        eventType: 'SUBMITTED',
        externalReference: 'CSC-2026-0001',
        receivingOffice: 'CSC Field Office',
        occurredAt: '2026-10-02T01:00:00.000Z',
        recordedByMembershipId: preparer.membershipId,
        evidence: { documentVersionId: ids.formVersion, versionNo: 1 },
      });
      expect(submitted.externalActions).toHaveLength(0);

      const replayed = await appointments.recordExternalSubmission(
        preparer,
        created.id,
        submission,
        'external-submit',
      );
      expect(replayed.externalSubmissions).toHaveLength(1);

      const returned = await appointments.recordExternalSubmission(preparer, created.id, {
        appointmentVersionId: versionId,
        eventType: 'RETURNED',
        externalReference: 'CSC-2026-0001',
        occurredAt: '2026-10-03T01:00:00.000Z',
        receivingOffice: 'CSC Field Office',
        reason: 'Complete the missing attachment.',
        evidenceDocumentVersionId: ids.formVersion,
      });
      expect(returned.externalStanding).toBe('RETURNED');

      const resubmitted = await appointments.recordExternalSubmission(preparer, created.id, {
        appointmentVersionId: versionId,
        eventType: 'RESUBMITTED',
        occurredAt: '2026-10-04T01:00:00.000Z',
        receivingOffice: 'CSC Field Office',
        evidenceDocumentVersionId: ids.formVersion,
      });
      expect(resubmitted.externalStanding).toBe('RESUBMITTED');

      await expect(
        appointments.recordExternalAction(preparer, created.id, {
          appointmentVersionId: versionId,
          action: 'VALIDATED',
          externalReference: 'CSC-2026-0001',
          actionAt: '2026-10-05T01:00:00.000Z',
          evidenceDocumentVersionId: ids.formVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_EXTERNAL_ACTION_INVALID', statusCode: 409 });

      const approved = await appointments.recordExternalAction(
        preparer,
        created.id,
        {
          appointmentVersionId: versionId,
          action: 'APPROVED',
          externalReference: 'CSC-2026-0001',
          actionAt: '2026-10-05T01:00:00.000Z',
          reason: 'The Commission approved the appointment.',
          evidenceDocumentVersionId: ids.statusEvidenceVersion,
        },
        'external-approve',
      );
      expect(approved.externalStanding).toBe('APPROVED');
      expect(approved.workflowStatus).toBe('ISSUED');
      expect(approved.externalActions).toHaveLength(1);
      expect(approved.externalActions[0]).toMatchObject({
        action: 'APPROVED',
        externalReference: 'CSC-2026-0001',
        actionAt: '2026-10-05T01:00:00.000Z',
      });
      expect(approved.history.map((event) => event.action)).toEqual([
        'APPOINTMENT_PREPARED',
        'APPOINTMENT_SUBMITTED',
        'APPOINTMENT_ENDORSED',
        'APPOINTMENT_ISSUED',
      ]);

      const externalAuditEvents = await admin.auditEvent.findMany({
        where: { agencyId: fixture.agencyId, action: { startsWith: 'APPOINTMENT_EXTERNAL_' } },
        orderBy: { occurredAt: 'asc' },
      });
      expect(externalAuditEvents.map((event) => event.action)).toEqual([
        'APPOINTMENT_EXTERNAL_SUBMISSION_RECORDED',
        'APPOINTMENT_EXTERNAL_SUBMISSION_RECORDED',
        'APPOINTMENT_EXTERNAL_SUBMISSION_RECORDED',
        'APPOINTMENT_EXTERNAL_ACTION_RECORDED',
      ]);

      const listed = await appointments.list(preparer, { status: 'ISSUED', limit: 50, offset: 0 });
      expect(listed.items.find((item) => item.id === created.id)?.externalStanding).toBe(
        'APPROVED',
      );

      const correction = await appointments.correct(
        preparer,
        created.id,
        {
          ...versionInput(fixture, { salaryStep: 2 }),
          reason: 'Correct the salary step while external tracking continues.',
          authorityDocumentVersionId: ids.correctionAuthorityVersion,
        },
        'external-correction',
      );
      expect(correction.workflowStatus).toBe('DRAFT');

      const resubmittedWhileCorrecting = await appointments.recordExternalSubmission(
        preparer,
        created.id,
        {
          appointmentVersionId: versionId,
          eventType: 'RESUBMITTED',
          occurredAt: '2026-10-06T01:00:00.000Z',
          receivingOffice: 'CSC Field Office',
          evidenceDocumentVersionId: ids.formVersion,
        },
      );
      expect(resubmittedWhileCorrecting.workflowStatus).toBe('DRAFT');
      expect(resubmittedWhileCorrecting.externalStanding).toBe('RESUBMITTED');
    } finally {
      await fixture.dispose();
    }
  },
);
