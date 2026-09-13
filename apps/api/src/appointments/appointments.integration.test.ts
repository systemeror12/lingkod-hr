import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { ApprovalCompletionRegistry } from '../approvals/approval.service';
import { DocumentsService } from '../documents/documents.service';
import { EmployeesService, employeeAuditWriter } from '../employees/employees.service';
import {
  plantillaPositionAuditWriter,
  PlantillaPositionsService,
} from '../plantilla-positions/plantilla-positions.service';
import type { QualificationStandardsService } from '../qualification-standards/qualification-standards.service';
import { ApplicationsService } from '../recruitment/applications.service';
import { RecruitmentService } from '../recruitment/recruitment.service';
import { SelectionService } from '../recruitment/selection.service';
import { AssumedAppointmentActivation } from './assumed-appointment-activation';
import {
  AppointmentReadModel,
  AppointmentsService,
  type AppointmentLinkRole,
} from './appointments.service';

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
  'appointments.assumption.create',
  'appointments.assumption.fail',
  'personnel.employees.create',
  'personnel.employees.activate',
];

const AUTHORITY_PERMISSIONS = [
  'appointments.records.read',
  'appointments.records.issue',
  'appointments.records.cancel',
  'appointments.oath.record',
  'appointments.assumption.certify',
  'appointments.assumption.correct',
  'appointments.assumption.cancel',
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
    request: randomUUID(),
    publication: randomUUID(),
    application: randomUUID(),
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
  activation: AssumedAppointmentActivation;
  employees: EmployeesService;
  setQualificationUsable: (usable: boolean) => void;
  dispose: () => Promise<void>;
}

async function setupFixture(
  label: string,
  options: { recruitmentChain?: boolean } = {},
): Promise<Fixture> {
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
    if (options.recruitmentChain) {
      await transaction.$executeRaw`
        INSERT INTO "applicants"
          ("id", "agency_id", "first_name", "last_name", "privacy_notice_version",
           "consented_at", "deduplication_key", "created_by_membership_id")
        VALUES
          (${ids.applicant}::uuid, ${agency.id}::uuid, 'Ana', 'Reyes', 'v1', now(),
           ${`APPT-APPLICANT-${suffix}`}, ${preparer.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "requests_to_fill"
          ("id", "agency_id", "position_id", "requesting_unit_id",
           "requested_by_membership_id", "justification", "qualification_standard_version_id",
           "status", "approved_at", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${ids.request}::uuid, ${agency.id}::uuid, ${ids.position}::uuid,
           ${ids.unit}::uuid, ${preparer.membershipId}::uuid,
           'Appointment activation fixture request.', ${ids.qualificationVersion}::uuid,
           'APPROVED', now(), ${preparer.membershipId}::uuid, ${preparer.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "vacancy_publications"
          ("id", "agency_id", "request_to_fill_id", "qualification_standard_version_id",
           "form_document_version_id", "approval_route_version_id", "opening_date",
           "closing_date", "status", "published_at", "created_by_membership_id",
           "updated_by_membership_id")
        VALUES
          (${ids.publication}::uuid, ${agency.id}::uuid, ${ids.request}::uuid,
           ${ids.qualificationVersion}::uuid, ${ids.formVersion}::uuid, ${randomUUID()}::uuid,
           '2026-07-01'::date, '2026-07-31'::date, 'PUBLISHED', now(),
           ${preparer.membershipId}::uuid, ${preparer.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "applications"
          ("id", "agency_id", "vacancy_publication_id", "applicant_id",
           "qualification_standard_version_id", "status", "received_at",
           "received_by_membership_id", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${ids.application}::uuid, ${agency.id}::uuid, ${ids.publication}::uuid,
           ${ids.applicant}::uuid, ${ids.qualificationVersion}::uuid, 'SELECTED', now(),
           ${preparer.membershipId}::uuid, ${preparer.membershipId}::uuid,
           ${preparer.membershipId}::uuid)
      `;
    }
    await transaction.$executeRaw`
      INSERT INTO "recruitment_appointment_handoffs"
        ("id", "agency_id", "selection_decision_id", "application_id", "position_id",
         "selection_package", "idempotency_key", "handed_off_at")
      VALUES
        (${ids.handoff}::uuid, ${agency.id}::uuid, ${ids.selectionDecision}::uuid,
         ${options.recruitmentChain ? ids.application : randomUUID()}::uuid,
         ${ids.position}::uuid,
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
  const employees = new EmployeesService(employeeAuditWriter);
  const applications = new ApplicationsService(documents as never);
  const recruitment = new RecruitmentService(
    plantilla,
    documents as never,
    {} as never,
    new ApprovalCompletionRegistry(),
  );
  const readModel = new AppointmentReadModel(employees, plantilla);
  const appointments = new AppointmentsService(
    documents as never,
    plantilla,
    qualificationStandards,
    selection,
    readModel,
  );
  const activation = new AssumedAppointmentActivation(
    readModel,
    employees,
    plantilla,
    applications,
    recruitment,
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
    activation,
    employees,
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
          'assumption_outcome_events',
          'assumption_versions',
          'assumptions_to_duty',
          'oath_versions',
          'oaths_of_office',
          'appointment_acknowledgments',
          'appointment_versions',
          'appointments',
          'appointment_agency_settings',
          'position_incumbencies',
          'service_segments',
          'employees',
          'outbox_events',
          'recruitment_appointment_handoffs',
          'applications',
          'vacancy_publications',
          'requests_to_fill',
          'applicants',
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

interface AssumedAppointment {
  appointmentId: string;
  versionId: string;
  oathVersionId: string;
  assumptionVersionId: string;
}

async function assumeAppointment(fixture: Fixture, label: string): Promise<AssumedAppointment> {
  const { ids, preparer, authority, appointments } = fixture;
  await appointments.configureSettings(preparer, {
    regulatoryStatus: 'REGULATED',
    statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
  });
  const created = await appointments.create(preparer, {
    selectionDecisionId: ids.selectionDecision,
    ...versionInput(fixture),
  });
  await appointments.submit(preparer, created.id);
  await appointments.endorse(preparer, created.id);
  const issued = await appointments.issue(authority, created.id, `${label}-issue`);
  const versionId = issued.currentVersion?.id ?? '';
  await appointments.recordReceipt(preparer, created.id, {
    acknowledgedAt: '2026-10-02T01:00:00.000Z',
    evidenceDocumentVersionId: ids.formVersion,
  });
  const sworn = await appointments.recordOath(authority, created.id, {
    oathDate: '2026-10-03',
    administeredByMembershipId: authority.membershipId,
    authority: 'City Mayor',
    place: 'City Hall',
    documentVersionId: ids.formVersion,
  });
  const oathVersionId =
    sworn.versions.find((version) => version.id === versionId)?.oath?.currentVersion?.id ?? '';
  const assumed = await appointments.recordAssumption(authority, created.id, {
    oathVersionId,
    actualAssumptionDate: '2026-10-05',
    certifiedByMembershipId: authority.membershipId,
    certifyingAuthority: 'City Mayor',
    certifiedAt: '2026-10-05T01:00:00.000Z',
    documentVersionId: ids.formVersion,
  });
  const assumptionVersionId =
    assumed.versions.find((version) => version.id === versionId)?.assumption?.currentVersion?.id ??
    '';
  return { appointmentId: created.id, versionId, oathVersionId, assumptionVersionId };
}

function employeeInput(fixture: Fixture, prefix: string) {
  return {
    employeeNumber: `E2E-${prefix}-${fixture.suffix}`,
    birthDate: '1990-05-15',
    sex: 'FEMALE' as const,
    civilStatus: 'SINGLE' as const,
    contactEmail: `${prefix.toLowerCase()}-${fixture.suffix}@example.test`,
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

it.skipIf(!enabled)(
  'records the appointee acknowledgment, oath, and Assumption to Duty through corrections',
  async () => {
    const fixture = await setupFixture('OATH');
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
      await appointments.submit(preparer, created.id);
      await appointments.endorse(preparer, created.id);
      const issued = await appointments.issue(authority, created.id, 'oath-issue');
      const issuedVersionId = issued.currentVersion?.id ?? '';
      expect(issued.workflowStatus).toBe('ISSUED');

      const oathInput = {
        oathDate: '2026-10-03',
        administeredByMembershipId: authority.membershipId,
        authority: 'City Mayor',
        place: 'City Hall',
        documentVersionId: ids.formVersion,
      };
      await expect(appointments.recordOath(authority, created.id, oathInput)).rejects.toMatchObject(
        { code: 'APPOINTMENT_ASSUMPTION_NOT_READY', statusCode: 409 },
      );

      const receiptInput = {
        acknowledgedAt: '2026-10-02T01:00:00.000Z',
        evidenceDocumentVersionId: ids.formVersion,
      };
      await expect(
        appointments.recordReceipt(preparer, created.id, {
          ...receiptInput,
          acknowledgedAt: '2000-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_RECEIPT_DATE_INVALID', statusCode: 409 });
      await expect(
        appointments.recordReceipt(preparer, created.id, {
          ...receiptInput,
          evidenceDocumentVersionId: ids.unfinalizedVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_RECEIPT_EVIDENCE_INVALID', statusCode: 409 });

      const receipt = await appointments.recordReceipt(
        preparer,
        created.id,
        receiptInput,
        'oath-receipt',
      );
      const receivedVersion = receipt.versions.find((version) => version.id === issuedVersionId);
      expect(receivedVersion?.acknowledgment?.acknowledgedAt).toBe('2026-10-02T01:00:00.000Z');
      expect(receivedVersion?.acknowledgment?.evidence.documentVersionId).toBe(ids.formVersion);
      expect(receivedVersion?.assumption?.status).toBe('PENDING');
      expect(receivedVersion?.assumption?.currentVersion).toBeNull();

      const replayedReceipt = await appointments.recordReceipt(
        preparer,
        created.id,
        receiptInput,
        'oath-receipt',
      );
      expect(
        await admin.auditEvent.count({
          where: {
            agencyId: fixture.agencyId,
            action: 'APPOINTMENT_RECEIPT_RECORDED',
            entityId: created.id,
          },
        }),
      ).toBe(1);
      expect(
        replayedReceipt.versions.find((version) => version.id === issuedVersionId)?.assumption
          ?.status,
      ).toBe('PENDING');

      await expect(
        appointments.recordReceipt(preparer, created.id, receiptInput),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_RECEIPT_ALREADY_RECORDED',
        statusCode: 409,
      });

      await expect(
        appointments.recordOath(authority, created.id, { ...oathInput, oathDate: '2026-10-01' }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_OATH_DATE_INVALID', statusCode: 409 });
      await expect(
        appointments.recordOath(authority, created.id, {
          ...oathInput,
          documentVersionId: ids.unfinalizedVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_OATH_EVIDENCE_INVALID', statusCode: 409 });
      await expect(
        appointments.recordOath(authority, created.id, {
          ...oathInput,
          administeredByMembershipId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_OATH_ADMINISTRATOR_INVALID', statusCode: 409 });

      const sworn = await appointments.recordOath(authority, created.id, oathInput, 'oath-record');
      const oath = sworn.versions.find((version) => version.id === issuedVersionId)?.oath;
      expect(oath?.versions).toHaveLength(1);
      expect(oath?.currentVersion).toMatchObject({ versionNo: 1, oathDate: '2026-10-03' });
      const firstOathVersionId = oath?.currentVersion?.id ?? '';

      await expect(appointments.recordOath(authority, created.id, oathInput)).rejects.toMatchObject(
        { code: 'APPOINTMENT_OATH_ALREADY_RECORDED', statusCode: 409 },
      );

      const correctedOathDetail = await appointments.correctOath(
        authority,
        created.id,
        {
          ...oathInput,
          oathDate: '2026-10-04',
          reason: 'Correct the recorded oath date.',
          authorityDocumentVersionId: ids.correctionAuthorityVersion,
        },
        'oath-correct',
      );
      const correctedOath = correctedOathDetail.versions.find(
        (version) => version.id === issuedVersionId,
      )?.oath;
      expect(correctedOath?.versions.map((version) => version.versionNo)).toEqual([1, 2]);
      expect(correctedOath?.currentVersion).toMatchObject({
        versionNo: 2,
        oathDate: '2026-10-04',
        replacesOathVersionId: firstOathVersionId,
        correctionReason: 'Correct the recorded oath date.',
        correctionAuthorityDocumentVersionId: ids.correctionAuthorityVersion,
      });
      const currentOathVersionId = correctedOath?.currentVersion?.id ?? '';

      const assumptionInput = {
        oathVersionId: currentOathVersionId,
        actualAssumptionDate: '2026-10-05',
        certifiedByMembershipId: authority.membershipId,
        certifyingAuthority: 'City Mayor',
        certifiedAt: '2026-10-05T01:00:00.000Z',
        documentVersionId: ids.formVersion,
      };
      await expect(
        appointments.recordAssumption(authority, created.id, {
          ...assumptionInput,
          oathVersionId: firstOathVersionId,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_OATH_MISMATCH', statusCode: 409 });
      await expect(
        appointments.recordAssumption(authority, created.id, {
          ...assumptionInput,
          actualAssumptionDate: '2026-10-03',
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_DATE_INVALID', statusCode: 409 });
      await expect(
        appointments.recordAssumption(authority, created.id, {
          ...assumptionInput,
          certifiedByMembershipId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_ASSUMPTION_CERTIFIER_INVALID',
        statusCode: 409,
      });

      const assumedDetail = await appointments.recordAssumption(
        authority,
        created.id,
        assumptionInput,
        'assume-record',
      );
      expect(assumedDetail.workflowStatus).toBe('ISSUED');
      const assumption = assumedDetail.versions.find(
        (version) => version.id === issuedVersionId,
      )?.assumption;
      expect(assumption?.status).toBe('ASSUMED');
      expect(assumption?.versions).toHaveLength(1);
      expect(assumption?.currentVersion).toMatchObject({
        versionNo: 1,
        oathVersionId: currentOathVersionId,
        actualAssumptionDate: '2026-10-05',
      });
      const firstAssumptionVersionId = assumption?.currentVersion?.id ?? '';

      const issuedContract = await admin.$transaction((transaction) =>
        appointments.resolveIssuedAppointmentContractInTransaction(
          transaction,
          { agencyId: fixture.agencyId },
          issuedVersionId,
        ),
      );
      expect(issuedContract).toMatchObject({
        contractSchemaVersion: 1,
        appointmentId: created.id,
        appointmentVersionId: issuedVersionId,
        fullName: 'Ana Reyes',
        applicationNo: `APPT-APP-${fixture.suffix}`,
        reservation: { status: 'RESERVED' },
        externalStanding: 'NOT_SUBMITTED',
      });
      expect(issuedContract?.acknowledgment?.acknowledgedAt).toBe('2026-10-02T01:00:00.000Z');
      expect(issuedContract?.oath?.currentVersion?.id).toBe(currentOathVersionId);

      const assumedContract = await admin.$transaction((transaction) =>
        appointments.resolveAssumedAppointmentContractInTransaction(
          transaction,
          { agencyId: fixture.agencyId },
          issuedVersionId,
        ),
      );
      expect(assumedContract?.assumption).toMatchObject({
        status: 'ASSUMED',
        currentVersion: { id: firstAssumptionVersionId },
      });

      const correctedAssumptionDetail = await appointments.correctAssumption(
        authority,
        created.id,
        {
          ...assumptionInput,
          actualAssumptionDate: '2026-10-06',
          reason: 'Correct the recorded assumption date.',
          authorityDocumentVersionId: ids.correctionAuthorityVersion,
        },
        'assume-correct',
      );
      const correctedAssumption = correctedAssumptionDetail.versions.find(
        (version) => version.id === issuedVersionId,
      )?.assumption;
      expect(correctedAssumption?.versions.map((version) => version.versionNo)).toEqual([1, 2]);
      expect(correctedAssumption?.currentVersion).toMatchObject({
        versionNo: 2,
        actualAssumptionDate: '2026-10-06',
        replacesAssumptionVersionId: firstAssumptionVersionId,
        correctionReason: 'Correct the recorded assumption date.',
      });

      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          INSERT INTO "service_segments"
            ("id", "agency_id", "employee_id", "appointment_id", "organization_unit_id",
             "appointment_status", "effective_from", "status", "created_by_membership_id")
          VALUES
            (${randomUUID()}::uuid, ${fixture.agencyId}::uuid, ${randomUUID()}::uuid,
             ${created.id}::uuid, ${ids.unit}::uuid, 'PERMANENT', '2026-10-06'::date,
             'ACTIVE', ${preparer.membershipId}::uuid)
        `;
      });

      await expect(
        appointments.correctAssumption(authority, created.id, {
          ...assumptionInput,
          reason: 'Correct again after service began.',
          authorityDocumentVersionId: ids.correctionAuthorityVersion,
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_ASSUMPTION_ACTIVATED',
        statusCode: 409,
      });

      expect(correctedAssumptionDetail.history.map((event) => event.action)).toEqual([
        'APPOINTMENT_PREPARED',
        'APPOINTMENT_SUBMITTED',
        'APPOINTMENT_ENDORSED',
        'APPOINTMENT_ISSUED',
      ]);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'records an evidenced failure to assume and releases the reservation',
  async () => {
    const fixture = await setupFixture('OUTCOME');
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
      await appointments.submit(preparer, created.id);
      await appointments.endorse(preparer, created.id);
      await appointments.issue(authority, created.id, 'outcome-issue');
      await appointments.recordReceipt(
        preparer,
        created.id,
        {
          acknowledgedAt: '2026-10-02T01:00:00.000Z',
          evidenceDocumentVersionId: ids.formVersion,
        },
        'outcome-receipt',
      );

      const failureInput = {
        noticeDate: '2026-10-03',
        deadlineDate: '2026-10-05',
        outcomeDate: '2026-10-06',
        reason: 'The appointee did not report for duty.',
        authorizedByMembershipId: preparer.membershipId,
        authorityDocumentVersionId: ids.cancellationAuthorityVersion,
        evidenceDocumentVersionId: ids.formVersion,
      };
      await expect(
        appointments.recordAssumptionFailure(preparer, created.id, {
          ...failureInput,
          outcomeDate: '2000-01-01',
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_ASSUMPTION_OUTCOME_DATE_INVALID',
        statusCode: 409,
      });
      await expect(
        appointments.recordAssumptionFailure(preparer, created.id, {
          ...failureInput,
          evidenceDocumentVersionId: ids.unfinalizedVersion,
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_ASSUMPTION_OUTCOME_EVIDENCE_INVALID',
        statusCode: 409,
      });
      await expect(
        appointments.recordAssumptionFailure(preparer, created.id, {
          ...failureInput,
          authorizedByMembershipId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_ASSUMPTION_OUTCOME_AUTHORIZER_INVALID',
        statusCode: 409,
      });

      const failed = await appointments.recordAssumptionFailure(
        preparer,
        created.id,
        failureInput,
        'outcome-fail',
      );
      expect(failed.workflowStatus).toBe('ISSUED');
      const assumption = failed.versions.find(
        (version) => version.id === failed.currentVersion?.id,
      )?.assumption;
      expect(assumption?.status).toBe('DID_NOT_ASSUME');
      expect(assumption?.currentVersion).toBeNull();
      expect(assumption?.outcome).toMatchObject({
        outcome: 'DID_NOT_ASSUME',
        noticeDate: '2026-10-03',
        deadlineDate: '2026-10-05',
        outcomeDate: '2026-10-06',
        reason: 'The appointee did not report for duty.',
        authorizedByMembershipId: preparer.membershipId,
        authorityDocumentVersionId: ids.cancellationAuthorityVersion,
        evidenceDocumentVersionId: ids.formVersion,
      });

      const versions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(versions.at(-1)?.domainStatus).toBe('VACANT');
      const failureEvent = await admin.auditEvent.findFirst({
        where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_ASSUMPTION_FAILED' },
      });
      expect(failureEvent?.metadata).toMatchObject({ reservationReleased: true });

      const replayed = await appointments.recordAssumptionFailure(
        preparer,
        created.id,
        failureInput,
        'outcome-fail',
      );
      expect(replayed.workflowStatus).toBe('ISSUED');
      expect(
        await admin.auditEvent.count({
          where: {
            agencyId: fixture.agencyId,
            action: 'APPOINTMENT_ASSUMPTION_FAILED',
            entityId: created.id,
          },
        }),
      ).toBe(1);

      await expect(
        appointments.recordAssumption(authority, created.id, {
          oathVersionId: randomUUID(),
          actualAssumptionDate: '2026-10-06',
          certifiedByMembershipId: authority.membershipId,
          certifyingAuthority: 'City Mayor',
          certifiedAt: '2026-10-06T01:00:00.000Z',
          documentVersionId: ids.formVersion,
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_ASSUMPTION_NOT_PENDING',
        statusCode: 409,
      });
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'records a lawful pre-assumption cancellation and releases the reservation',
  async () => {
    const fixture = await setupFixture('CANCEL');
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
      await appointments.submit(preparer, created.id);
      await appointments.endorse(preparer, created.id);
      await appointments.issue(authority, created.id, 'cancel-issue');
      await appointments.recordReceipt(
        preparer,
        created.id,
        {
          acknowledgedAt: '2026-10-02T01:00:00.000Z',
          evidenceDocumentVersionId: ids.formVersion,
        },
        'cancel-receipt',
      );

      const cancelled = await appointments.recordAssumptionCancellation(
        authority,
        created.id,
        {
          outcomeDate: '2026-10-06',
          reason: 'The appointing authority cancelled before the assumption.',
          authorizedByMembershipId: authority.membershipId,
          authorityDocumentVersionId: ids.cancellationAuthorityVersion,
          evidenceDocumentVersionId: ids.formVersion,
        },
        'outcome-cancel',
      );
      expect(cancelled.workflowStatus).toBe('CANCELLED');
      const assumption = cancelled.versions.find(
        (version) => version.id === cancelled.currentVersion?.id,
      )?.assumption;
      expect(assumption?.status).toBe('CANCELLED');
      expect(assumption?.outcome).toMatchObject({
        outcome: 'CANCELLED',
        outcomeDate: '2026-10-06',
        reason: 'The appointing authority cancelled before the assumption.',
      });

      const versions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(versions.at(-1)?.domainStatus).toBe('VACANT');
      const cancellationEvent = await admin.auditEvent.findFirst({
        where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_ASSUMPTION_CANCELLED' },
      });
      expect(cancellationEvent?.metadata).toMatchObject({ reservationReleased: true });
      const appointmentCancellationEvent = await admin.auditEvent.findFirst({
        where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_CANCELLED' },
      });
      expect(appointmentCancellationEvent).toMatchObject({
        previousStatus: 'ISSUED',
        newStatus: 'CANCELLED',
        entityId: created.id,
      });
      expect(appointmentCancellationEvent?.metadata).toMatchObject({
        assumptionId: assumption?.id,
        reservationReleased: true,
      });
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'refuses activation from an issued Appointment with no Assumption to Duty',
  async () => {
    const fixture = await setupFixture('ACTIVATION-GATE', { recruitmentChain: true });
    const { ids, admin, preparer, authority, appointments, activation } = fixture;
    try {
      await appointments.configureSettings(preparer, {
        regulatoryStatus: 'REGULATED',
        statusEvidenceDocumentVersionId: ids.statusEvidenceVersion,
      });
      const created = await appointments.create(preparer, {
        selectionDecisionId: ids.selectionDecision,
        ...versionInput(fixture),
      });
      await appointments.submit(preparer, created.id);
      await appointments.endorse(preparer, created.id);
      await appointments.issue(authority, created.id, 'gate-issue');

      await expect(
        activation.execute({
          context: preparer,
          appointmentId: created.id,
          input: { employee: employeeInput(fixture, 'GATE') },
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_SERVICE_ASSUMPTION_REQUIRED',
        statusCode: 409,
      });

      expect(
        await admin.serviceSegment.count({
          where: { agencyId: fixture.agencyId, appointmentId: created.id },
        }),
      ).toBe(0);
      expect(
        await admin.positionIncumbency.count({
          where: { agencyId: fixture.agencyId, positionId: ids.position },
        }),
      ).toBe(0);
      const application = await admin.application.findUniqueOrThrow({
        where: { id: ids.application },
      });
      expect(application.status).toBe('SELECTED');
      const publication = await admin.vacancyPublication.findUniqueOrThrow({
        where: { id: ids.publication },
      });
      expect(publication.status).toBe('PUBLISHED');
      const request = await admin.requestToFill.findUniqueOrThrow({ where: { id: ids.request } });
      expect(request.status).toBe('APPROVED');
      const versions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(versions.at(-1)?.domainStatus).toBe('RESERVED');
      expect(
        await admin.auditEvent.count({
          where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_SERVICE_ACTIVATED' },
        }),
      ).toBe(0);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'activates service from an assumed Appointment and closes the recruitment chain',
  async () => {
    const fixture = await setupFixture('ACTIVATE', { recruitmentChain: true });
    const { ids, admin, preparer, authority, appointments, activation } = fixture;
    try {
      const { appointmentId, oathVersionId, assumptionVersionId } = await assumeAppointment(
        fixture,
        'activate',
      );

      const activationInput = { employee: employeeInput(fixture, 'ACTIVATE') };
      const activated = await activation.execute({
        context: preparer,
        appointmentId,
        input: activationInput,
        idempotencyKey: 'activate-1',
      });
      expect(activated.activation).toMatchObject({
        employeeNumber: `E2E-ACTIVATE-${fixture.suffix}`,
        legalName: 'Ana Reyes',
        effectiveFrom: '2026-10-05',
        positionId: ids.position,
        appointmentStatus: 'PERMANENT',
      });
      const employeeId = activated.activation?.employeeId ?? '';
      const serviceSegmentId = activated.activation?.serviceSegmentId ?? '';

      const employee = await admin.employee.findUniqueOrThrow({
        where: { agencyId_id: { agencyId: fixture.agencyId, id: employeeId } },
      });
      expect(employee.serviceStatus).toBe('ACTIVE');
      expect(employee.currentServiceSegmentId).toBe(serviceSegmentId);
      expect(employee.personKey).toBe(ids.applicant);
      expect(employee.firstGovernmentServiceDate?.toISOString().slice(0, 10)).toBe('2026-10-05');

      const segment = await admin.serviceSegment.findUniqueOrThrow({
        where: { id: serviceSegmentId },
      });
      expect(segment).toMatchObject({
        appointmentId,
        positionId: ids.position,
        status: 'ACTIVE',
        appointmentStatus: 'PERMANENT',
      });

      const incumbency = await admin.positionIncumbency.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, serviceSegmentId },
      });
      expect(incumbency).toMatchObject({ positionId: ids.position, employeeId, status: 'ACTIVE' });

      const versions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(versions.map((version) => version.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
      expect(versions.map((version) => version.domainStatus)).toEqual(['RESERVED', 'OCCUPIED']);
      expect(versions[0]?.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-10-04');

      expect(
        (await admin.application.findUniqueOrThrow({ where: { id: ids.application } })).status,
      ).toBe('CLOSED');
      expect(
        (await admin.vacancyPublication.findUniqueOrThrow({ where: { id: ids.publication } }))
          .status,
      ).toBe('CLOSED');
      expect(
        (await admin.requestToFill.findUniqueOrThrow({ where: { id: ids.request } })).status,
      ).toBe('CLOSED');

      const outbox = await admin.outboxEvent.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, eventType: 'APPOINTMENT_SERVICE_ACTIVATED' },
      });
      expect(outbox.aggregateId).toBe(appointmentId);

      const activationEvent = await admin.auditEvent.findFirstOrThrow({
        where: {
          agencyId: fixture.agencyId,
          action: 'APPOINTMENT_SERVICE_ACTIVATED',
          entityId: appointmentId,
        },
      });
      expect(activationEvent.metadata).toMatchObject({
        appointmentVersionId: activated.currentVersion?.id,
        employeeId,
        serviceSegmentId,
        positionIncumbencyId: incumbency.id,
        actualAssumptionDate: '2026-10-05',
        applicationId: ids.application,
        publicationId: ids.publication,
        requestId: ids.request,
      });
      expect(activationEvent.metadata).not.toHaveProperty('contactEmail');
      expect(activationEvent.metadata).not.toHaveProperty('birthDate');

      const replayed = await activation.execute({
        context: preparer,
        appointmentId,
        input: activationInput,
        idempotencyKey: 'activate-1',
      });
      expect(replayed.activation?.serviceSegmentId).toBe(serviceSegmentId);
      expect(await admin.employee.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(await admin.serviceSegment.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(await admin.positionIncumbency.count({ where: { agencyId: fixture.agencyId } })).toBe(
        1,
      );
      expect(await admin.outboxEvent.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(
        await admin.auditEvent.count({
          where: {
            agencyId: fixture.agencyId,
            action: 'APPOINTMENT_SERVICE_ACTIVATED',
            entityId: appointmentId,
          },
        }),
      ).toBe(1);

      await expect(
        activation.execute({
          context: preparer,
          appointmentId,
          input: activationInput,
          idempotencyKey: 'activate-2',
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_SERVICE_ALREADY_ACTIVATED',
        statusCode: 409,
      });
      const replayedWithoutKey = await activation.execute({
        context: preparer,
        appointmentId,
        input: activationInput,
      });
      expect(replayedWithoutKey.id).toBe(appointmentId);

      await expect(
        appointments.correctAssumption(authority, appointmentId, {
          oathVersionId,
          actualAssumptionDate: '2026-10-06',
          certifiedByMembershipId: authority.membershipId,
          certifyingAuthority: 'City Mayor',
          certifiedAt: '2026-10-06T01:00:00.000Z',
          documentVersionId: ids.formVersion,
          reason: 'Correct after activation.',
          authorityDocumentVersionId: ids.correctionAuthorityVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_ACTIVATED', statusCode: 409 });
      await expect(
        appointments.recordAssumptionFailure(preparer, appointmentId, {
          noticeDate: '2026-10-06',
          deadlineDate: '2026-10-08',
          outcomeDate: '2026-10-09',
          reason: 'Attempted outcome after activation.',
          authorizedByMembershipId: preparer.membershipId,
          authorityDocumentVersionId: ids.cancellationAuthorityVersion,
          evidenceDocumentVersionId: ids.formVersion,
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_ASSUMPTION_NOT_PENDING', statusCode: 409 });

      const assumptionEvent = await admin.assumptionVersion.findUniqueOrThrow({
        where: { id: assumptionVersionId },
      });
      expect(assumptionEvent.versionNo).toBe(1);
      expect(
        (await admin.application.findUniqueOrThrow({ where: { id: ids.application } })).status,
      ).toBe('CLOSED');
      expect(
        await admin.auditEvent.count({
          where: {
            agencyId: fixture.agencyId,
            action: { in: ['APPLICATION_REOPENED', 'APPLICATION_STATUS_CHANGED'] },
          },
        }),
      ).toBe(0);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'links an existing preboarding Employee and rejects cross-agency activation',
  async () => {
    const fixture = await setupFixture('LINK', { recruitmentChain: true });
    const other = await setupFixture('OTHER');
    try {
      const { admin, preparer, activation, employees } = fixture;
      const existing = await employees.create(preparer, {
        legalName: 'Ana Reyes',
        ...employeeInput(fixture, 'LINK'),
      });
      expect(existing.serviceStatus).toBe('PREBOARDING');
      const otherEmployee = await other.employees.create(other.preparer, {
        legalName: 'Other Candidate',
        ...employeeInput(other, 'OTHER'),
      });

      const { appointmentId } = await assumeAppointment(fixture, 'link');

      await expect(
        other.activation.execute({
          context: other.preparer,
          appointmentId,
          input: { employeeId: otherEmployee.id },
          idempotencyKey: 'cross-agency-appointment',
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND', statusCode: 404 });
      await expect(
        activation.execute({
          context: preparer,
          appointmentId,
          input: { employeeId: otherEmployee.id },
          idempotencyKey: 'cross-agency-employee',
        }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND', statusCode: 404 });

      const activated = await activation.execute({
        context: preparer,
        appointmentId,
        input: { employeeId: existing.id },
        idempotencyKey: 'link-1',
      });
      expect(activated.activation).toMatchObject({
        employeeId: existing.id,
        employeeNumber: existing.employeeNumber,
        effectiveFrom: '2026-10-05',
      });
      const linked = await admin.employee.findUniqueOrThrow({
        where: { agencyId_id: { agencyId: fixture.agencyId, id: existing.id } },
      });
      expect(linked.serviceStatus).toBe('ACTIVE');
      expect(linked.personKey).toBe(fixture.ids.applicant);
      expect(await admin.employee.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(await admin.serviceSegment.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(
        (
          await other.admin.employee.findUniqueOrThrow({
            where: {
              agencyId_id: { agencyId: other.agencyId, id: otherEmployee.id },
            },
          })
        ).serviceStatus,
      ).toBe('PREBOARDING');
    } finally {
      await fixture.dispose();
      await other.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'rejects activation when the Employee is not the Appointment appointee',
  async () => {
    const fixture = await setupFixture('IDENTITY', { recruitmentChain: true });
    const { admin, preparer, activation, employees, ids } = fixture;
    try {
      const candidate = await employees.create(preparer, {
        legalName: 'Ana Reyes',
        ...employeeInput(fixture, 'IDENTITY'),
      });
      const otherPerson = await employees.create(preparer, {
        legalName: 'Other Person',
        ...employeeInput(fixture, 'IDENTITY'),
        employeeNumber: `E2E-OTHER-${fixture.suffix}`,
        contactEmail: `other-${fixture.suffix}@example.test`,
      });

      const { appointmentId } = await assumeAppointment(fixture, 'identity');

      await admin.employee.update({
        where: { id: candidate.id },
        data: { personKey: randomUUID() },
      });
      await expect(
        activation.execute({
          context: preparer,
          appointmentId,
          input: { employeeId: candidate.id },
          idempotencyKey: 'identity-mismatch',
        }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_IDENTITY_MISMATCH', statusCode: 409 });

      await admin.employee.update({
        where: { id: candidate.id },
        data: { personKey: null },
      });
      await admin.employee.update({
        where: { id: otherPerson.id },
        data: { personKey: ids.applicant },
      });
      await expect(
        activation.execute({
          context: preparer,
          appointmentId,
          input: { employeeId: candidate.id },
          idempotencyKey: 'identity-reuse',
        }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_IDENTITY_CONFLICT', statusCode: 409 });

      expect(
        (
          await admin.employee.findUniqueOrThrow({
            where: { agencyId_id: { agencyId: fixture.agencyId, id: candidate.id } },
          })
        ).serviceStatus,
      ).toBe('PREBOARDING');
      expect(await admin.serviceSegment.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'serializes concurrent activation attempts on one assumed Appointment',
  async () => {
    const fixture = await setupFixture('RACE', { recruitmentChain: true });
    const { admin, preparer, activation } = fixture;
    try {
      const { appointmentId } = await assumeAppointment(fixture, 'race');
      const activationInput = { employee: employeeInput(fixture, 'RACE') };

      const results = await Promise.allSettled([
        activation.execute({
          context: preparer,
          appointmentId,
          input: activationInput,
          idempotencyKey: 'race-a',
        }),
        activation.execute({
          context: preparer,
          appointmentId,
          input: activationInput,
          idempotencyKey: 'race-b',
        }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      if (!failure || failure.status !== 'rejected') {
        throw new Error('Expected one concurrent activation attempt to fail.');
      }
      expect(failure.reason).toMatchObject({
        code: 'APPOINTMENT_SERVICE_ALREADY_ACTIVATED',
        statusCode: 409,
      });
      expect(await admin.employee.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(await admin.serviceSegment.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(await admin.positionIncumbency.count({ where: { agencyId: fixture.agencyId } })).toBe(
        1,
      );
      expect(await admin.outboxEvent.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      expect(
        await admin.auditEvent.count({
          where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_SERVICE_ACTIVATED' },
        }),
      ).toBe(1);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'rolls back every owner when the reserved position cannot be consumed',
  async () => {
    const fixture = await setupFixture('ROLLBACK', { recruitmentChain: true });
    const { ids, admin, preparer, activation } = fixture;
    try {
      const { appointmentId } = await assumeAppointment(fixture, 'rollback');
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          INSERT INTO "position_incumbencies"
            ("id", "agency_id", "position_id", "employee_id", "service_segment_id",
             "effective_from", "status", "created_by_membership_id")
          VALUES
            (${randomUUID()}::uuid, ${fixture.agencyId}::uuid, ${ids.position}::uuid,
             ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2026-09-01'::date, 'ACTIVE',
             ${preparer.membershipId}::uuid)
        `;
      });

      await expect(
        activation.execute({
          context: preparer,
          appointmentId,
          input: { employee: employeeInput(fixture, 'ROLLBACK') },
          idempotencyKey: 'rollback-1',
        }),
      ).rejects.toMatchObject({
        code: 'PLANTILLA_POSITION_INCUMBENCY_CONFLICT',
        statusCode: 409,
      });

      expect(await admin.employee.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
      expect(await admin.serviceSegment.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
      expect(await admin.outboxEvent.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
      expect(
        await admin.auditEvent.count({
          where: { agencyId: fixture.agencyId, action: 'APPOINTMENT_SERVICE_ACTIVATED' },
        }),
      ).toBe(0);
      expect(
        (await admin.application.findUniqueOrThrow({ where: { id: ids.application } })).status,
      ).toBe('SELECTED');
      expect(
        (await admin.vacancyPublication.findUniqueOrThrow({ where: { id: ids.publication } }))
          .status,
      ).toBe('PUBLISHED');
      expect(
        (await admin.requestToFill.findUniqueOrThrow({ where: { id: ids.request } })).status,
      ).toBe('APPROVED');
      const versions = await admin.plantillaPositionVersion.findMany({
        where: { positionId: ids.position },
        orderBy: { versionNo: 'asc' },
      });
      expect(versions.at(-1)?.domainStatus).toBe('RESERVED');
    } finally {
      await fixture.dispose();
    }
  },
);
