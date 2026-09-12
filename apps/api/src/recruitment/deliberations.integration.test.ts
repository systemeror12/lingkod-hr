import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { ApplicationsService } from './applications.service';
import { DeliberationsService } from './deliberations.service';
import { EvaluationsService } from './evaluations.service';
import { SelectionService, type SelectionDecisionSummary } from './selection.service';
import {
  PlantillaPositionsService,
  plantillaPositionAuditWriter,
} from '../plantilla-positions/plantilla-positions.service';

const enabled = process.env.DATABASE_E2E === 'true';

const PLAN_DEFINITION = {
  stages: [
    {
      stageCode: 'WRITTEN_EXAM',
      stageType: 'ASSESSMENT',
      label: 'Written examination',
      criteria: [
        {
          criterionCode: 'JOB_KNOWLEDGE',
          label: 'Job knowledge',
          criterionType: 'NUMERIC',
          weight: 100,
          minimumScore: 0,
          maximumScore: 100,
          passingScore: 70,
          evidenceRequired: false,
          commentsRequired: false,
          evaluatorRoleCodes: ['hrmo_administrator'],
        },
      ],
      aggregation: {
        method: 'MEAN',
        evaluatorMethod: 'MEAN',
        rounding: { mode: 'HALF_UP', decimals: 2 },
        passingScore: 70,
        tieBreakers: [],
      },
    },
    {
      stageCode: 'PANEL_INTERVIEW',
      stageType: 'INTERVIEW',
      label: 'Panel interview',
      feedback: {
        minimumScore: 0,
        maximumScore: 100,
        passingScore: 70,
        evidenceRequired: false,
        commentsRequired: false,
        evaluatorRoleCodes: ['hrmo_administrator'],
      },
      aggregation: {
        evaluatorMethod: 'MEAN',
        rounding: { mode: 'HALF_UP', decimals: 2 },
        passingScore: 70,
      },
    },
  ],
};

const PERMISSIONS = [
  'recruitment.applications.read',
  'recruitment.applications.screen',
  'recruitment.applications.close',
  'recruitment.assessments.manage',
  'recruitment.interviews.manage',
  'recruitment.deliberations.read',
  'recruitment.deliberations.submit',
  'recruitment.deliberations.recommend',
  'recruitment.selection.select',
  'recruitment.selection.decide',
];

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  requestId: string,
): RequestContext {
  return {
    agencyId,
    userId,
    membershipId,
    requestId,
    primaryOrganizationUnitId: null,
    permissions: PERMISSIONS.map((code) => ({ code, scopePolicy: 'AGENCY' })),
  };
}

function createFixtureIds() {
  return {
    boardAuthorityDocument: randomUUID(),
    boardAuthorityVersion: randomUUID(),
    reportDocument: randomUUID(),
    reportVersion: randomUUID(),
    minutesDocument: randomUUID(),
    minutesVersion: randomUUID(),
    decisionDocument: randomUUID(),
    decisionVersion: randomUUID(),
    qualificationStandard: randomUUID(),
    qualificationVersion: randomUUID(),
    staffingAuthority: randomUUID(),
    unit: randomUUID(),
    unitVersion: randomUUID(),
    position: randomUUID(),
    positionVersion: randomUUID(),
    plan: randomUUID(),
    criteriaSet: randomUUID(),
    boardDefinition: randomUUID(),
    request: randomUUID(),
    publication: randomUUID(),
    applicantOne: randomUUID(),
    applicantTwo: randomUUID(),
    applicationOne: randomUUID(),
    applicationTwo: randomUUID(),
    assessmentOne: randomUUID(),
    assessmentTwo: randomUUID(),
    interviewOne: randomUUID(),
    interviewTwo: randomUUID(),
  };
}

type FixtureIds = ReturnType<typeof createFixtureIds>;

interface Fixture {
  agencyId: string;
  suffix: string;
  ids: FixtureIds;
  admin: PrismaClient;
  actor: RequestContext;
  chair: RequestContext;
  alternate: RequestContext;
  deliberations: DeliberationsService;
  selection: SelectionService;
  evaluations: EvaluationsService;
  applications: ApplicationsService;
  dispose: () => Promise<void>;
}

async function setupFixture(label: string): Promise<Fixture> {
  const runtimeUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!runtimeUrl || !adminUrl)
    throw new Error('Runtime and administrative database URLs are required.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const agency = await admin.agency.create({
    data: {
      code: `DELIB-${label}-${suffix}`,
      name: `Deliberation ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  async function createMember(name: string): Promise<{ userId: string; membershipId: string }> {
    const user = await admin.user.create({
      data: {
        identityProvider: `deliberation-${label}`,
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
  const actor = await createMember('Recruitment Officer');
  const chair = await createMember('Board Chair');
  const boardMember = await createMember('Board Member');
  const boardAlternate = await createMember('Board Alternate');
  const secretariat = await createMember('Board Secretariat');
  const evaluatorRole = await admin.role.findFirstOrThrow({
    where: { agencyId: null, code: 'hrmo_administrator' },
  });
  for (const membershipId of [actor.membershipId, chair.membershipId]) {
    await admin.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId,
        roleId: evaluatorRole.id,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
  }

  const ids = createFixtureIds();
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const documents: Array<[string, string, string]> = [
      [ids.boardAuthorityDocument, 'BOARD_AUTHORITY', 'APPROVED'],
      [ids.reportDocument, 'CANDIDATE_EVALUATION_REPORT', 'APPROVED'],
      [ids.minutesDocument, 'BOARD_MINUTES', 'APPROVED'],
      [ids.decisionDocument, 'SELECTION_DECISION', 'APPROVED'],
    ];
    for (const [documentId, documentType, status] of documents) {
      await transaction.$executeRaw`
        INSERT INTO "documents"
          ("id", "agency_id", "document_no", "document_type", "classification", "status",
           "created_by_membership_id")
        VALUES
          (${documentId}::uuid, ${agency.id}::uuid, ${`${label}-${documentType}-${suffix}`},
           ${documentType}, 'CONFIDENTIAL', ${status}, ${actor.membershipId}::uuid)
      `;
    }
    for (const [documentId, versionId] of [
      [ids.boardAuthorityDocument, ids.boardAuthorityVersion],
      [ids.reportDocument, ids.reportVersion],
      [ids.minutesDocument, ids.minutesVersion],
      [ids.decisionDocument, ids.decisionVersion],
    ]) {
      await transaction.$executeRaw`
        INSERT INTO "document_versions"
          ("id", "agency_id", "document_id", "version_no", "storage_key", "content_hash",
           "mime_type", "size_bytes", "issued_at", "created_by_membership_id")
        VALUES
          (${versionId}::uuid, ${agency.id}::uuid, ${documentId}::uuid, 1,
           ${`e2e/deliberation-${label}-${versionId}`}, ${'a'.repeat(64)}, 'application/pdf', 1,
           now(), ${actor.membershipId}::uuid)
      `;
    }
    await transaction.$executeRaw`
      INSERT INTO "qualification_standards"
        ("id", "agency_id", "code", "name", "status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.qualificationStandard}::uuid, ${agency.id}::uuid, ${`QS-${label}-${suffix}`},
         'Deliberation Standard', 'ACTIVE', ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
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
         ${ids.boardAuthorityDocument}::uuid, ${ids.boardAuthorityVersion}::uuid, now(),
         ${actor.membershipId}::uuid, 'Deliberation fixture source reviewed.',
         ${ids.decisionDocument}::uuid, ${ids.decisionVersion}::uuid, now(),
         ${actor.membershipId}::uuid, 'Deliberation fixture approval reviewed.',
         '2000-01-01'::date, 'ACTIVE', 'ACTIVE', ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "staffing_authorities"
        ("id", "agency_id", "authority_type", "reference_no", "issued_date", "effective_date",
         "document_id", "evidence_version_id", "evidence_validated_at",
         "evidence_validated_by_membership_id", "evidence_validation_reason", "status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.staffingAuthority}::uuid, ${agency.id}::uuid, 'DBM_APPROVAL',
         ${`DELIB-AUTH-${suffix}`}, '2000-01-01'::date, '2000-01-01'::date,
         ${ids.boardAuthorityDocument}::uuid, ${ids.boardAuthorityVersion}::uuid, now(),
         ${actor.membershipId}::uuid, 'Deliberation fixture authority reviewed.', 'ACTIVE',
         ${actor.membershipId}::uuid, ${actor.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "organization_units"
        ("id", "agency_id", "code", "unit_type", "status", "current_version_id")
      VALUES
        (${ids.unit}::uuid, ${agency.id}::uuid, ${`DELIB-UNIT-${suffix}`}, 'DIVISION',
         'ACTIVE', ${ids.unitVersion}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "organization_unit_versions"
        ("id", "agency_id", "organization_unit_id", "version_no", "name",
         "effective_from", "status", "domain_status")
      VALUES
        (${ids.unitVersion}::uuid, ${agency.id}::uuid, ${ids.unit}::uuid, 1,
         'Deliberation Division', '2000-01-01'::date, 'ACTIVE', 'ACTIVE')
    `;
    await transaction.$executeRaw`
      INSERT INTO "plantilla_positions"
        ("id", "agency_id", "item_number", "status", "current_version_id",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.position}::uuid, ${agency.id}::uuid, ${`DELIB-ITEM-${suffix}`}, 'VACANT',
         ${ids.positionVersion}::uuid, ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
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
         'PLANTILLA', '2000-01-01'::date, 'ACTIVE', 'VACANT',
         ${actor.membershipId}::uuid, ${actor.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "agency_merit_selection_plan_versions"
        ("id", "agency_id", "plan_code", "version_no", "applicability",
         "effective_from", "status", "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.plan}::uuid, ${agency.id}::uuid, ${`DELIB-MSP-${suffix}`}, 1, '{}'::jsonb,
         '2000-01-01'::date, 'ACTIVE', ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "merit_selection_criteria_sets"
        ("id", "agency_id", "plan_version_id", "criteria_code", "applicability",
         "criteria_definition", "status", "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.criteriaSet}::uuid, ${agency.id}::uuid, ${ids.plan}::uuid,
         ${`DELIB-CRITERIA-${suffix}`}, '{}'::jsonb,
         ${JSON.stringify(PLAN_DEFINITION)}::jsonb, 'ACTIVE', ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "board_definitions"
        ("id", "agency_id", "plan_version_id", "board_code", "version_no", "applicability",
         "seat_definition", "quorum_definition", "status",
         "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.boardDefinition}::uuid, ${agency.id}::uuid, ${ids.plan}::uuid,
         ${`DELIB-BOARD-${suffix}`}, 1, '{}'::jsonb,
         ${JSON.stringify({
           seats: [
             { seatCode: 'CHAIR', required: true, boardRole: 'CHAIR', voting: true },
             { seatCode: 'MEMBER', required: true, boardRole: 'MEMBER', voting: true },
             { seatCode: 'SECRETARIAT', required: true, boardRole: 'SECRETARIAT', voting: false },
           ],
         })}::jsonb,
         ${JSON.stringify({ minimum: 1 })}::jsonb, 'ACTIVE', ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
    `;
    const appointments: Array<[string, string, string]> = [
      ['CHAIR', chair.membershipId, 'PRINCIPAL'],
      ['MEMBER', boardMember.membershipId, 'PRINCIPAL'],
      ['MEMBER', boardAlternate.membershipId, 'ALTERNATE'],
      ['SECRETARIAT', secretariat.membershipId, 'PRINCIPAL'],
    ];
    for (const [seatCode, membershipId, appointmentKind] of appointments) {
      await transaction.$executeRaw`
        INSERT INTO "board_appointments"
          ("id", "agency_id", "board_definition_id", "seat_code", "membership_id",
           "appointment_kind", "effective_from", "authority_document_version_id", "status",
           "created_by_membership_id")
        VALUES
          (${randomUUID()}::uuid, ${agency.id}::uuid, ${ids.boardDefinition}::uuid,
           ${seatCode}, ${membershipId}::uuid, ${appointmentKind}, '2000-01-01'::date,
           ${ids.boardAuthorityVersion}::uuid, 'ACTIVE', ${actor.membershipId}::uuid)
      `;
    }
    await transaction.$executeRaw`
      INSERT INTO "requests_to_fill"
        ("id", "agency_id", "request_no", "position_id", "requesting_unit_id",
         "requested_by_membership_id", "justification",
         "qualification_standard_version_id", "msp_plan_version_id", "criteria_set_id",
         "board_definition_id", "binding_set_no", "bindings_resolved_at", "binding_frozen_at",
         "status", "approved_at", "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.request}::uuid, ${agency.id}::uuid,
         nextval('"requests_to_fill_request_no_seq"'), ${ids.position}::uuid,
         ${ids.unit}::uuid, ${actor.membershipId}::uuid, 'Deliberation service fixture.',
         ${ids.qualificationVersion}::uuid, ${ids.plan}::uuid, ${ids.criteriaSet}::uuid,
         ${ids.boardDefinition}::uuid, 1, now(), now(), 'APPROVED', now(),
         ${actor.membershipId}::uuid, ${actor.membershipId}::uuid)
    `;
    await transaction.$executeRaw`
      INSERT INTO "vacancy_publications"
        ("id", "agency_id", "publication_no", "request_to_fill_id",
         "qualification_standard_version_id", "form_document_version_id",
         "approval_route_version_id", "opening_date", "closing_date", "channels",
         "position_details", "application_requirements", "contact_details", "status",
         "published_at", "created_by_membership_id", "updated_by_membership_id")
      VALUES
        (${ids.publication}::uuid, ${agency.id}::uuid,
         nextval('"vacancy_publications_publication_no_seq"'), ${ids.request}::uuid,
         ${ids.qualificationVersion}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
         '2000-01-01'::date, '2000-01-31'::date, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
         '{}'::jsonb, 'PUBLISHED', now(), ${actor.membershipId}::uuid,
         ${actor.membershipId}::uuid)
    `;
    const applicants: Array<[string, string, string, string]> = [
      [ids.applicantOne, 'Ana', 'Reyes', ids.applicationOne],
      [ids.applicantTwo, 'Bea', 'Cruz', ids.applicationTwo],
    ];
    for (const [applicantId, firstName, lastName, applicationId] of applicants) {
      await transaction.$executeRaw`
        INSERT INTO "applicants"
          ("id", "agency_id", "first_name", "last_name", "privacy_notice_version",
           "consented_at", "deduplication_key", "created_by_membership_id")
        VALUES
          (${applicantId}::uuid, ${agency.id}::uuid, ${firstName}, ${lastName},
           'Privacy Notice v1', '2026-01-02T00:00:00Z'::timestamptz,
           ${`delib-dedup-${applicationId}`}, ${actor.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "applications"
          ("id", "agency_id", "application_no", "vacancy_publication_id", "applicant_id",
           "qualification_standard_version_id", "status", "received_at",
           "received_by_membership_id", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${applicationId}::uuid, ${agency.id}::uuid,
           nextval('applications_application_no_seq'), ${ids.publication}::uuid,
           ${applicantId}::uuid, ${ids.qualificationVersion}::uuid, 'FOR_INTERVIEW',
           '2026-01-04T00:00:00Z'::timestamptz, ${actor.membershipId}::uuid,
           ${actor.membershipId}::uuid, ${actor.membershipId}::uuid)
      `;
    }
    const stageRows: Array<[string, string, string]> = [
      [ids.applicationOne, ids.assessmentOne, 'WRITTEN_EXAM'],
      [ids.applicationTwo, ids.assessmentTwo, 'WRITTEN_EXAM'],
    ];
    for (const [applicationId, assessmentId, stageCode] of stageRows) {
      await transaction.$executeRaw`
        INSERT INTO "assessments"
          ("id", "agency_id", "application_id", "criteria_set_id", "stage_code", "stage_type",
           "status", "completed_at", "created_by_membership_id", "updated_by_membership_id")
        VALUES
          (${assessmentId}::uuid, ${agency.id}::uuid, ${applicationId}::uuid,
           ${ids.criteriaSet}::uuid, ${stageCode}, 'ASSESSMENT', 'COMPLETED', now(),
           ${actor.membershipId}::uuid, ${actor.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "assessment_result_versions"
          ("id", "agency_id", "assessment_id", "criterion_code", "evaluated_by_membership_id",
           "version_no", "score", "recorded_at")
        VALUES
          (${randomUUID()}::uuid, ${agency.id}::uuid, ${assessmentId}::uuid, 'JOB_KNOWLEDGE',
           ${actor.membershipId}::uuid, 1, 85, now())
      `;
    }
    const interviewRows: Array<[string, string]> = [
      [ids.applicationOne, ids.interviewOne],
      [ids.applicationTwo, ids.interviewTwo],
    ];
    for (const [applicationId, interviewId] of interviewRows) {
      await transaction.$executeRaw`
        INSERT INTO "interviews"
          ("id", "agency_id", "application_id", "criteria_set_id", "stage_code",
           "scheduled_at", "status", "completed_at", "created_by_membership_id",
           "updated_by_membership_id")
        VALUES
          (${interviewId}::uuid, ${agency.id}::uuid, ${applicationId}::uuid,
           ${ids.criteriaSet}::uuid, 'PANEL_INTERVIEW', now(), 'COMPLETED', now(),
           ${actor.membershipId}::uuid, ${actor.membershipId}::uuid)
      `;
      await transaction.$executeRaw`
        INSERT INTO "interview_feedback_versions"
          ("id", "agency_id", "interview_id", "interviewer_membership_id", "version_no",
           "score", "recommendation", "submitted_at")
        VALUES
          (${randomUUID()}::uuid, ${agency.id}::uuid, ${interviewId}::uuid,
           ${actor.membershipId}::uuid, 1, 80, 'PROCEED', now())
      `;
    }
  });

  const knownVersions = new Map<string, string>([
    [ids.boardAuthorityVersion, ids.boardAuthorityDocument],
    [ids.reportVersion, ids.reportDocument],
    [ids.minutesVersion, ids.minutesDocument],
    [ids.decisionVersion, ids.decisionDocument],
  ]);
  const documents = {
    resolveFinalizedVersionInTransaction: async (
      _transaction: unknown,
      _context: unknown,
      requestedDocumentVersionId: string,
    ) =>
      knownVersions.has(requestedDocumentVersionId)
        ? {
            id: requestedDocumentVersionId,
            documentId: knownVersions.get(requestedDocumentVersionId) as string,
          }
        : null,
    resolveExternalEvidenceInTransaction: async () => ({ ok: true }),
  };
  const plantilla = new PlantillaPositionsService(plantillaPositionAuditWriter, documents as never);
  const deliberations = new DeliberationsService(documents as never);
  const selection = new SelectionService(plantilla, documents as never);
  const evaluations = new EvaluationsService(documents as never);
  const applications = new ApplicationsService(documents as never);

  return {
    agencyId: agency.id,
    suffix,
    ids,
    admin,
    actor: context(agency.id, actor.userId, actor.membershipId, `deliberation-${suffix}`),
    chair: context(agency.id, chair.userId, chair.membershipId, `deliberation-chair-${suffix}`),
    alternate: context(
      agency.id,
      boardAlternate.userId,
      boardAlternate.membershipId,
      `deliberation-alternate-${suffix}`,
    ),
    deliberations,
    selection,
    evaluations,
    applications,
    dispose: async () => {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of [
          'recruitment_appointment_handoffs',
          'selection_decisions',
          'candidate_evaluation_report_versions',
          'board_recommendations',
          'applicant_quorum_snapshots',
          'conflict_declarations',
          'board_member_participations',
          'board_roster_snapshot_members',
          'selection_board_sessions',
          'interview_feedback_versions',
          'interviews',
          'assessment_result_versions',
          'assessments',
          'application_documents',
          'application_screenings',
          'applications',
          'applicants',
          'vacancy_publications',
          'requests_to_fill',
          'board_appointments',
          'board_definitions',
          'merit_selection_criteria_sets',
          'agency_merit_selection_plan_versions',
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
      await admin.membershipRole.deleteMany({ where: { agencyId: agency.id } });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.deleteMany({
        where: {
          emailNormalized: { endsWith: `-${suffix}@example.test` },
        },
      });
      await app.$disconnect();
      await admin.$disconnect();
    },
  };
}

it.skipIf(!enabled)(
  'freezes the board roster and quorum, records advisory output, and selects with a reserved handoff',
  async () => {
    const fixture = await setupFixture('MAIN');
    const { ids, actor, deliberations, selection, applications, agencyId } = fixture;
    const admin = fixture.admin;
    try {
      const session = await deliberations.createSession(
        actor,
        { vacancyPublicationId: ids.publication, sessionDate: '2026-09-10' },
        `session-${fixture.suffix}`,
      );
      expect(session.status).toBe('DRAFT');

      const unauthorized = { ...actor, permissions: [] };
      await expect(deliberations.startSession(unauthorized, session.id)).rejects.toMatchObject({
        code: 'RECRUITMENT_DELIBERATION_SUBMIT_FORBIDDEN',
      });
      await expect(
        selection.recordDecision(unauthorized, ids.applicationOne, {
          decision: 'SELECTED',
          reason: 'Unauthorized selection attempt.',
          authorityDocumentVersionId: ids.decisionVersion,
        }),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_SELECTION_SELECT_FORBIDDEN' });
      await expect(
        selection.recordDecision(unauthorized, ids.applicationOne, {
          decision: 'RETURNED',
          reason: 'Unauthorized return attempt.',
        }),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_SELECTION_DECIDE_FORBIDDEN' });
      expect(session.roster).toHaveLength(4);
      const secretariat = session.roster.find(({ seatCode }) => seatCode === 'SECRETARIAT');
      expect(secretariat?.isVoting).toBe(false);
      const alternate = session.roster.find(({ isAlternate }) => isAlternate);
      expect(alternate?.seatCode).toBe('MEMBER');

      for (const member of session.roster) {
        const attendance =
          member.seatCode === 'MEMBER' && !member.isAlternate ? 'ABSENT' : 'PRESENT';
        await deliberations.recordParticipation(
          actor,
          session.id,
          { rosterSnapshotMemberId: member.id, attendanceStatus: attendance },
          `participation-${member.id}`,
        );
      }

      const started = await deliberations.startSession(
        actor,
        session.id,
        `start-${fixture.suffix}`,
      );
      expect(started.status).toBe('IN_PROGRESS');
      expect(started.rosterFrozenAt).not.toBeNull();
      expect(started.quorum).toHaveLength(2);
      for (const quorum of started.quorum) {
        expect(quorum.votingSeats).toBe(2);
        expect(quorum.nationalFloor).toBe(2);
        expect(quorum.requiredVotingMembers).toBe(2);
        expect(quorum.presentVotingMembers).toBe(2);
        expect(quorum.satisfied).toBe(true);
        expect(quorum.eligibleVotingMembers).toBe(2);
      }
      const applicationsByNumber = await admin.application.findMany({
        where: { agencyId },
        select: { id: true, applicationNo: true, status: true },
        orderBy: { applicationNo: 'asc' },
      });
      expect(applicationsByNumber.map(({ status }) => status)).toEqual([
        'FOR_DELIBERATION',
        'FOR_DELIBERATION',
      ]);

      await deliberations.recordRecommendation(
        fixture.chair,
        session.id,
        {
          applicationId: ids.applicationOne,
          recommendation: 'RECOMMENDED',
          rankNo: 1,
          compositeScore: 85,
          reason: 'Highest comparative standing.',
        },
        `recommend-1-${fixture.suffix}`,
      );
      await deliberations.recordRecommendation(
        fixture.chair,
        session.id,
        {
          applicationId: ids.applicationTwo,
          recommendation: 'RECOMMENDED',
          rankNo: 2,
          compositeScore: 80,
        },
        `recommend-2-${fixture.suffix}`,
      );
      const recommended = await deliberations.findSession(actor, session.id);
      expect(recommended?.recommendations).toHaveLength(2);
      expect(recommended?.recommendations[0]?.rankNo).toBe(1);

      const withReport = await deliberations.issueReport(
        actor,
        session.id,
        { reportDocumentVersionId: ids.reportVersion },
        `report-${fixture.suffix}`,
      );
      expect(withReport.reports).toHaveLength(1);
      expect(withReport.reports[0]?.versionNo).toBe(1);

      const completed = await deliberations.completeSession(
        actor,
        session.id,
        { minutesDocumentVersionId: ids.minutesVersion },
        `complete-${fixture.suffix}`,
      );
      expect(completed.status).toBe('COMPLETED');
      expect(completed.minutesDocumentVersionId).toBe(ids.minutesVersion);

      // Concurrency: two recommended Applications compete for the same single
      // Plantilla Position; exactly one reservation and handoff may commit.
      const selectionReason = 'The appointing authority selects the recommended candidate.';
      const selectionKey = (applicationId: string) =>
        `select-${applicationId === ids.applicationOne ? 'one' : 'two'}-${fixture.suffix}`;
      const [firstSelection, secondSelection] = await Promise.allSettled([
        selection.recordDecision(
          actor,
          ids.applicationOne,
          {
            decision: 'SELECTED',
            reason: selectionReason,
            authorityDocumentVersionId: ids.decisionVersion,
          },
          selectionKey(ids.applicationOne),
        ),
        selection.recordDecision(
          actor,
          ids.applicationTwo,
          {
            decision: 'SELECTED',
            reason: selectionReason,
            authorityDocumentVersionId: ids.decisionVersion,
          },
          selectionKey(ids.applicationTwo),
        ),
      ]);
      const fulfilled = [firstSelection, secondSelection].filter(
        (result): result is PromiseFulfilledResult<SelectionDecisionSummary> =>
          result.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(1);
      const winner = fulfilled[0]!.value;
      expect(winner.decision).toBe('SELECTED');
      expect(winner.handoff).not.toBeNull();
      const handoff = winner.handoff as NonNullable<typeof winner.handoff>;
      const packageData = handoff.selectionPackage as Record<string, unknown>;
      expect(packageData.applicationId).toBe(winner.applicationId);
      expect(packageData.qualificationStandardVersionId).toBe(ids.qualificationVersion);
      expect(packageData.mspPlanVersionId).toBe(ids.plan);
      expect(packageData.criteriaSetId).toBe(ids.criteriaSet);
      expect(packageData.boardDefinitionId).toBe(ids.boardDefinition);

      const loserId =
        winner.applicationId === ids.applicationOne ? ids.applicationTwo : ids.applicationOne;
      const loserBeforeDecision = await admin.application.findFirstOrThrow({
        where: { agencyId, id: loserId },
        select: { status: true },
      });
      expect(loserBeforeDecision.status).toBe('RECOMMENDED');

      const reservedPosition = await admin.plantillaPosition.findFirstOrThrow({
        where: { agencyId, id: ids.position },
        select: { status: true, currentVersion: { select: { domainStatus: true } } },
      });
      expect(reservedPosition.status).toBe('RESERVED');
      expect(reservedPosition.currentVersion?.domainStatus).toBe('RESERVED');
      const winnerApplication = await admin.application.findFirstOrThrow({
        where: { agencyId, id: winner.applicationId },
        select: { status: true },
      });
      expect(winnerApplication.status).toBe('SELECTED');

      const replayed = await selection.recordDecision(
        actor,
        winner.applicationId,
        {
          decision: 'SELECTED',
          reason: selectionReason,
          authorityDocumentVersionId: ids.decisionVersion,
        },
        selectionKey(winner.applicationId),
      );
      expect(replayed.id).toBe(winner.id);

      const notSelected = await selection.recordDecision(
        actor,
        loserId,
        {
          decision: 'NOT_SELECTED',
          reason: 'The appointing authority declines this recommendation.',
        },
        `decline-${fixture.suffix}`,
      );
      expect(notSelected.decision).toBe('NOT_SELECTED');
      expect(notSelected.handoff).toBeNull();

      const closed = await applications.closeApplication(
        actor,
        loserId,
        'Notice and recruitment outcome handled.',
      );
      expect(closed.status).toBe('CLOSED');

      await expect(
        selection.recordDecision(
          actor,
          winner.applicationId,
          {
            decision: 'SELECTED',
            reason: 'Attempt a duplicate final selection.',
            authorityDocumentVersionId: ids.decisionVersion,
          },
          `select-again-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_SELECTION_NOT_READY' });

      const decisions = await admin.selectionDecision.count({
        where: { agencyId, applicationId: winner.applicationId },
      });
      const handoffs = await admin.recruitmentAppointmentHandoff.count({ where: { agencyId } });
      expect(decisions).toBe(1);
      expect(handoffs).toBe(1);

      const withRecruitmentCapability = async (
        work: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ): Promise<void> => {
        await admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            "SELECT set_config('app.recruitment_transition', 'on', true)",
          );
          await work(transaction);
        });
      };
      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "selection_decisions" SET "reason" = 'Silently rewritten.'
            WHERE "id" = ${winner.id}::uuid
          `,
        ),
      ).rejects.toThrow(/immutable/i);
      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`DELETE FROM "board_recommendations" WHERE "session_id" = ${session.id}::uuid`,
        ),
      ).rejects.toThrow(/immutable/i);
      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "selection_board_sessions"
            SET "status" = 'CANCELLED', "cancelled_at" = now(), "cancellation_reason" = 'Reopened.'
            WHERE "id" = ${session.id}::uuid
          `,
        ),
      ).rejects.toThrow(/immutable/i);
      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "applicant_quorum_snapshots" SET "satisfied" = false
            WHERE "session_id" = ${session.id}::uuid
          `,
        ),
      ).rejects.toThrow(/immutable/i);
      await expect(
        withRecruitmentCapability(
          (transaction) =>
            transaction.$executeRaw`
            UPDATE "recruitment_appointment_handoffs" SET "accepted_at" = now()
            WHERE "id" = ${handoff.id}::uuid
          `,
        ),
      ).rejects.toThrow(/immutable/i);
    } finally {
      await fixture.dispose();
    }
  },
);

it.skipIf(!enabled)(
  'excludes conflicted participants per applicant and never weakens the national quorum floor',
  async () => {
    const fixture = await setupFixture('QUORUM');
    const { ids, actor, chair, deliberations, evaluations, agencyId } = fixture;
    const admin = fixture.admin;
    try {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          UPDATE "board_definitions"
          SET "quorum_definition" = '{"minimum":3}'::jsonb
          WHERE "id" = ${ids.boardDefinition}::uuid
        `;
      });
      await expect(
        deliberations.createSession(
          actor,
          { vacancyPublicationId: ids.publication, sessionDate: '2026-09-10' },
          `invalid-quorum-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_BOARD_QUORUM_INVALID' });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          UPDATE "board_definitions"
          SET "quorum_definition" = '{"minimum":1}'::jsonb
          WHERE "id" = ${ids.boardDefinition}::uuid
        `;
        await transaction.$executeRaw`
          UPDATE "board_definitions"
          SET "seat_definition" = ${JSON.stringify({
            seats: [
              { seatCode: 'CHAIR', required: true, boardRole: 'CHAIR', voting: true },
              { seatCode: 'MEMBER', required: true, boardRole: 'MEMBER', voting: true },
              { seatCode: 'SECRETARIAT', required: true, boardRole: 'SECRETARIAT', voting: false },
              { seatCode: 'EXTRA', required: false, boardRole: 'MEMBER', voting: true },
            ],
          })}::jsonb
          WHERE "id" = ${ids.boardDefinition}::uuid
        `;
        await transaction.$executeRaw`
          INSERT INTO "board_appointments"
            ("id", "agency_id", "board_definition_id", "seat_code", "membership_id",
             "appointment_kind", "effective_from", "authority_document_version_id", "status",
             "created_by_membership_id")
          SELECT ${randomUUID()}::uuid, ${agencyId}::uuid, ${ids.boardDefinition}::uuid,
                 'EXTRA', appointment."membership_id", 'PRINCIPAL', '2000-01-01'::date,
                 ${ids.boardAuthorityVersion}::uuid, 'ACTIVE', ${actor.membershipId}::uuid
          FROM "board_appointments" appointment
          WHERE appointment."agency_id" = ${agencyId}::uuid
            AND appointment."board_definition_id" = ${ids.boardDefinition}::uuid
            AND appointment."seat_code" = 'CHAIR'
        `;
      });
      await expect(
        deliberations.createSession(
          actor,
          { vacancyPublicationId: ids.publication, sessionDate: '2026-09-10' },
          `duplicate-member-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_BOARD_MEMBER_DUPLICATED' });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.$executeRaw`
          DELETE FROM "board_appointments"
          WHERE "agency_id" = ${agencyId}::uuid AND "seat_code" = 'EXTRA'
        `;
        await transaction.$executeRaw`
          UPDATE "board_definitions"
          SET "seat_definition" = ${JSON.stringify({
            seats: [
              { seatCode: 'CHAIR', required: true, boardRole: 'CHAIR', voting: true },
              { seatCode: 'MEMBER', required: true, boardRole: 'MEMBER', voting: true },
              { seatCode: 'SECRETARIAT', required: true, boardRole: 'SECRETARIAT', voting: false },
            ],
          })}::jsonb
          WHERE "id" = ${ids.boardDefinition}::uuid
        `;
      });

      const session = await deliberations.createSession(
        actor,
        { vacancyPublicationId: ids.publication, sessionDate: '2026-09-10' },
        `session-${fixture.suffix}`,
      );
      for (const member of session.roster) {
        const attendance =
          member.seatCode === 'MEMBER' && !member.isAlternate ? 'ABSENT' : 'PRESENT';
        await deliberations.recordParticipation(
          actor,
          session.id,
          { rosterSnapshotMemberId: member.id, attendanceStatus: attendance },
          `participation-${member.id}`,
        );
      }
      const refreshed = await deliberations.findSession(actor, session.id);
      const chairRosterId = refreshed?.roster.find(
        ({ seatCode }) => seatCode === 'CHAIR',
      )?.membershipId;
      const chairParticipationId = refreshed?.participations.find(
        ({ membershipId }) => membershipId === chairRosterId,
      )?.id as string;
      expect(chairParticipationId).toBeTruthy();

      await deliberations.declareConflict(
        chair,
        session.id,
        {
          participationId: chairParticipationId,
          applicationId: ids.applicationOne,
          hasConflict: true,
          details: 'A declared relationship with the affected applicant.',
        },
        `conflict-${fixture.suffix}`,
      );

      await expect(
        evaluations.recordAssessmentResult(
          chair,
          ids.applicationOne,
          ids.assessmentOne,
          { criterionCode: 'JOB_KNOWLEDGE', score: 90 },
          `conflicted-result-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_EVALUATOR_CONFLICTED' });

      const started = await deliberations.startSession(
        actor,
        session.id,
        `start-${fixture.suffix}`,
      );
      const conflictedQuorum = started.quorum.find(
        ({ applicationId }) => applicationId === ids.applicationOne,
      );
      const cleanQuorum = started.quorum.find(
        ({ applicationId }) => applicationId === ids.applicationTwo,
      );
      expect(conflictedQuorum?.presentVotingMembers).toBe(1);
      expect(conflictedQuorum?.requiredVotingMembers).toBe(2);
      expect(conflictedQuorum?.satisfied).toBe(false);
      expect(cleanQuorum?.presentVotingMembers).toBe(2);
      expect(cleanQuorum?.satisfied).toBe(true);

      await expect(
        deliberations.recordRecommendation(
          chair,
          session.id,
          {
            applicationId: ids.applicationOne,
            recommendation: 'NOT_RECOMMENDED',
            reason: 'No quorum.',
          },
          `conflicted-recommendation-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_BOARD_MEMBER_CONFLICTED' });
      await expect(
        deliberations.recordRecommendation(
          fixture.alternate,
          session.id,
          {
            applicationId: ids.applicationOne,
            recommendation: 'NOT_RECOMMENDED',
            reason: 'No quorum.',
          },
          `quorum-recommendation-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_QUORUM_NOT_SATISFIED' });
      await expect(
        deliberations.recordRecommendation(
          actor,
          session.id,
          { applicationId: ids.applicationTwo, recommendation: 'RECOMMENDED', rankNo: 1 },
          `outsider-recommendation-${fixture.suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'RECRUITMENT_BOARD_MEMBER_NOT_IN_ROSTER' });

      await deliberations.recordRecommendation(
        chair,
        session.id,
        { applicationId: ids.applicationTwo, recommendation: 'RECOMMENDED', rankNo: 1 },
        `recommendation-${fixture.suffix}`,
      );
      const recorded = await deliberations.findSession(actor, session.id);
      expect(recorded?.recommendations).toHaveLength(1);
      expect(
        recorded?.conflicts.find(({ applicationId }) => applicationId === ids.applicationOne)
          ?.hasConflict,
      ).toBe(true);

      const conflictRows = await admin.conflictDeclaration.findMany({
        where: { agencyId, applicationId: ids.applicationTwo },
      });
      expect(conflictRows).toHaveLength(0);
    } finally {
      await fixture.dispose();
    }
  },
);
